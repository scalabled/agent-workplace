// Portrait rows (D1 `portraits`, 0002_media.sql) and images (R2 `portraits/<personaId>.<ext>`).
import { EXT_BY_MIME, type PortraitMime } from './image';

export interface PortraitRow {
  persona_id: string;
  subject_kind: string;
  r2_key: string | null;
  mime: string | null;
  bytes: number | null;
  version: string | null;
  provider: string | null;
  model: string | null;
  prompt_hash: string | null;
  generated_at: string | null;
  landmarks: string | null;
  landmarks_at: string | null;
  job_id: string | null;
  job_status: 'generating' | 'failed' | null;
  job_started_at: number | null;
  job_error: string | null;
}

/** A row that has an image. */
export type ReadyPortrait = PortraitRow & { r2_key: string; mime: string; version: string };

/** A generation lock older than this can be taken over (the worker running it is gone). */
export const JOB_STALE_MS = 5 * 60_000;

export const portraitKey = (personaId: string, ext: string): string => `portraits/${personaId}.${ext}`;
const KEY_EXT = /\.(png|jpg|webp)$/;
const MIME_BY_EXT: Record<string, PortraitMime> = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m as PortraitMime]));

const nowIso = () => new Date().toISOString();
const isReady = (row: PortraitRow | null): row is ReadyPortrait => !!row?.r2_key && !!row.mime && !!row.version;

export async function getRow(db: D1Database, personaId: string): Promise<PortraitRow | null> {
  return db.prepare('SELECT * FROM portraits WHERE persona_id = ?').bind(personaId).first<PortraitRow>();
}

/**
 * The current image row. When D1 has no image but R2 does (D1 was reset), the object is adopted back into D1
 * from its metadata, so an existing portrait is never paid for twice.
 */
export async function readyPortrait(env: { DB: D1Database; BLOBS: R2Bucket }, personaId: string, subjectKind = 'persona'): Promise<{ ready: ReadyPortrait | null; row: PortraitRow | null }> {
  const row = await getRow(env.DB, personaId);
  if (isReady(row)) return { ready: row, row };
  const listed = await env.BLOBS.list({ prefix: portraitKey(personaId, ''), include: ['httpMetadata', 'customMetadata'] });
  const obj = listed.objects.find((o) => KEY_EXT.test(o.key));
  if (!obj) return { ready: null, row };
  const meta = obj.customMetadata ?? {};
  const mime = MIME_BY_EXT[KEY_EXT.exec(obj.key)![1]!]!;
  const version = meta.version || `adopted-${obj.uploaded.getTime().toString(36)}`;
  const at = nowIso();
  await env.DB.prepare(
    `INSERT INTO portraits (persona_id, subject_kind, r2_key, mime, bytes, version, provider, model, prompt_hash, generated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (persona_id) DO UPDATE SET r2_key = excluded.r2_key, mime = excluded.mime, bytes = excluded.bytes, version = excluded.version,
       provider = excluded.provider, model = excluded.model, prompt_hash = excluded.prompt_hash, generated_at = excluded.generated_at,
       landmarks = NULL, landmarks_at = NULL, updated_at = excluded.updated_at
     WHERE portraits.r2_key IS NULL`,
  )
    .bind(personaId, meta.subjectKind || subjectKind, obj.key, mime, obj.size, version, meta.provider || null, meta.model || null, meta.promptHash || null, meta.generatedAt || obj.uploaded.toISOString(), at, at)
    .run();
  const adopted = await getRow(env.DB, personaId);
  return { ready: isReady(adopted) ? adopted : null, row: adopted };
}

/** Forget an image whose R2 object is gone (so the next generate call paints a new one). */
export async function forgetImage(db: D1Database, personaId: string, r2Key: string): Promise<void> {
  await db
    .prepare('UPDATE portraits SET r2_key = NULL, mime = NULL, bytes = NULL, version = NULL, landmarks = NULL, landmarks_at = NULL, updated_at = ? WHERE persona_id = ? AND r2_key = ?')
    .bind(nowIso(), personaId, r2Key)
    .run();
}

/** Take the generation lock. False when another fresh job holds it. */
export async function claimJob(db: D1Database, personaId: string, subjectKind: string, jobId: string, now = Date.now()): Promise<boolean> {
  const at = new Date(now).toISOString();
  const res = await db
    .prepare(
      `INSERT INTO portraits (persona_id, subject_kind, job_id, job_status, job_started_at, job_error, created_at, updated_at)
       VALUES (?, ?, ?, 'generating', ?, NULL, ?, ?)
       ON CONFLICT (persona_id) DO UPDATE SET job_id = excluded.job_id, job_status = 'generating', job_started_at = excluded.job_started_at,
         job_error = NULL, updated_at = excluded.updated_at
       WHERE portraits.job_status IS NOT 'generating' OR portraits.job_started_at IS NULL OR portraits.job_started_at < ?`,
    )
    .bind(personaId, subjectKind, jobId, now, at, at, now - JOB_STALE_MS)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Drop the lock without recording a failure (the job never started). */
export async function releaseJob(db: D1Database, personaId: string, jobId: string): Promise<void> {
  await db
    .prepare('UPDATE portraits SET job_id = NULL, job_status = NULL, job_started_at = NULL, updated_at = ? WHERE persona_id = ? AND job_id = ?')
    .bind(nowIso(), personaId, jobId)
    .run();
}

export async function failJob(db: D1Database, personaId: string, jobId: string, message: string): Promise<void> {
  await db
    .prepare("UPDATE portraits SET job_id = NULL, job_status = 'failed', job_started_at = NULL, job_error = ?, updated_at = ? WHERE persona_id = ? AND job_id = ?")
    .bind(message.slice(0, 300), nowIso(), personaId, jobId)
    .run();
}

export interface StoredImage {
  r2Key: string;
  mime: PortraitMime;
  bytes: number;
  version: string;
  provider: string;
  model: string;
  promptHash: string;
  generatedAt: string;
}

/**
 * Point the row at a newly stored image and clear its landmarks (they described the old face). Only the job
 * holding the lock may do this; returns false when a newer job took over.
 */
export async function completeJob(db: D1Database, personaId: string, jobId: string, img: StoredImage): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE portraits SET r2_key = ?, mime = ?, bytes = ?, version = ?, provider = ?, model = ?, prompt_hash = ?, generated_at = ?,
         landmarks = NULL, landmarks_at = NULL, job_id = NULL, job_status = NULL, job_started_at = NULL, job_error = NULL, updated_at = ?
       WHERE persona_id = ? AND job_id = ?`,
    )
    .bind(img.r2Key, img.mime, img.bytes, img.version, img.provider, img.model, img.promptHash, img.generatedAt, nowIso(), personaId, jobId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export type LandmarksOutcome = 'saved' | 'same' | 'conflict' | 'stale' | 'no_portrait';

/**
 * First valid write wins, per portrait version: a conditional UPDATE sets landmarks only while they are empty
 * (atomic, so two browsers racing cannot both win). An identical re-send is 'same'; `force` replaces;
 * `portraitVersion`, when given, must match the current image.
 */
export async function saveLandmarks(db: D1Database, personaId: string, serialized: string, opts: { force?: boolean; portraitVersion?: string } = {}): Promise<LandmarksOutcome> {
  const at = nowIso();
  const version = opts.portraitVersion ?? null;
  const first = await db
    .prepare(
      'UPDATE portraits SET landmarks = ?, landmarks_at = ?, updated_at = ? WHERE persona_id = ? AND r2_key IS NOT NULL AND landmarks IS NULL AND (? IS NULL OR version = ?)',
    )
    .bind(serialized, at, at, personaId, version, version)
    .run();
  if ((first.meta?.changes ?? 0) > 0) return 'saved';
  const row = await getRow(db, personaId);
  if (!isReady(row)) return 'no_portrait';
  if (version !== null && row.version !== version) return 'stale';
  if (row.landmarks === serialized) return 'same';
  if (!opts.force) return 'conflict';
  const forced = await db
    .prepare('UPDATE portraits SET landmarks = ?, landmarks_at = ?, updated_at = ? WHERE persona_id = ? AND version = ?')
    .bind(serialized, at, at, personaId, row.version)
    .run();
  return (forced.meta?.changes ?? 0) > 0 ? 'saved' : 'stale';
}
