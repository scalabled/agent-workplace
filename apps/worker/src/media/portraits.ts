import { ProviderError, type Resolved } from '@headcount/models';
import { LANDMARKS_MAX_BYTES, normalizeLandmarks, type LandmarksResponse, type PortraitListResponse, type ProviderId } from '@headcount/protocol';
import { PORTRAIT_DAILY_LIMIT_DEFAULT, PORTRAIT_HEADERS, type PortraitGenerateResult, type PortraitJobState } from '@headcount/protocol/ext/media';
import type { Env } from '../env';
import { HttpError, errorResponse, json, readJson, type RouteHandler } from '../lib/http';
import { ImageError, decodeImage, promptHash, warpablePrompt } from './image';
import { claimJob, completeJob, failJob, forgetImage, getRow, portraitKey, readyPortrait, releaseJob, saveLandmarks, type PortraitRow } from './portrait-store';
import { findSubject, subjectIdParam, type PortraitSubject } from './subjects';
import { consumeDaily, refundDaily } from './usage';

// Portrait routes (owned by media). Images: R2 `portraits/<personaId>.<ext>` (catalog faces are the same in every
// workspace). Rows, the generation lock and landmarks: D1 `portraits` (0002_media.sql). Generation needs a real
// image provider (xAI grok-imagine or OpenAI gpt-image via the registry); keyless, GET answers 404 and the
// client draws the procedural face.

export function portraitDailyLimit(env: Env): number {
  const raw = Number(env.PORTRAIT_DAILY_LIMIT);
  return Number.isInteger(raw) && raw >= 0 ? raw : PORTRAIT_DAILY_LIMIT_DEFAULT;
}

/** How long one generation may take before it is abandoned. */
export const PORTRAIT_TIMEOUT_MS = 180_000;
/** The daily image budget (media_usage kind) shared by portraits and POST /api/media/image, capped by PORTRAIT_DAILY_LIMIT. */
export const IMAGE_USAGE_KIND = 'portrait';
const USAGE_KIND = IMAGE_USAGE_KIND;
const flag = (url: URL, name: string) => ['1', 'true', 'yes'].includes(url.searchParams.get(name) ?? '');

/**
 * GET /api/portraits → which faces have a stored image, so the web asks once instead of probing every id.
 * R2 objects that D1 lost are adopted back (same rule as GET /api/portraits/:personaId).
 */
export const handleListPortraits: RouteHandler = async (_req, { env }) => {
  const rows = await env.DB.prepare('SELECT persona_id, version, landmarks IS NOT NULL AS has_landmarks FROM portraits WHERE r2_key IS NOT NULL AND version IS NOT NULL')
    .all<{ persona_id: string; version: string; has_landmarks: number }>();
  const byId = new Map(rows.results.map((r) => [r.persona_id, { personaId: r.persona_id, version: r.version, hasLandmarks: !!r.has_landmarks }]));
  let cursor: string | undefined;
  do {
    const listed = await env.BLOBS.list({ prefix: 'portraits/', ...(cursor ? { cursor } : {}) });
    for (const obj of listed.objects) {
      const m = /^portraits\/([^/]+)\.(png|jpg|webp)$/.exec(obj.key);
      if (!m || byId.has(m[1]!)) continue;
      const { ready } = await readyPortrait(env, m[1]!);
      if (ready) byId.set(ready.persona_id, { personaId: ready.persona_id, version: ready.version, hasLandmarks: !!ready.landmarks });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return json<PortraitListResponse>({ portraits: [...byId.values()].sort((a, b) => a.personaId.localeCompare(b.personaId)) });
};

/** POST /api/portraits/:personaId/generate[?force=1][&wait=1] → 202 {status: exists|generating} | 200 {status: exists, created} (wait). */
export const handleGeneratePortrait: RouteHandler = async (_req, rc) => {
  const { env } = rc;
  const personaId = subjectIdParam(rc.params.personaId);
  const subject = findSubject(personaId);
  if (!subject) throw new HttpError('not_found', `The catalog has no coworker or lead with the id ${personaId}.`);
  if (!subject.portraitPrompt.trim()) throw new HttpError('bad_request', `${subject.name} has no portrait prompt in the catalog yet.`);
  const force = flag(rc.url, 'force');
  const wait = flag(rc.url, 'wait');

  let { ready } = await readyPortrait(env, personaId, subject.kind);
  if (ready && !(await env.BLOBS.head(ready.r2_key))) {
    await forgetImage(env.DB, personaId, ready.r2_key);
    ready = null;
  }
  if (ready && !force) return json<PortraitGenerateResult>({ personaId, status: 'exists', ...(ready.provider ? { provider: ready.provider as ProviderId } : {}) }, { status: 202 });

  // Keyless → MissingProviderError → 503 not_configured naming OPENAI_API_KEY / XAI_API_KEY. Mock is not
  // allowed: its SVG placeholder is not a portrait (the procedural face is the keyless face).
  const resolved = rc.registry().resolve('image', { allowMock: false });

  const jobId = `pjob_${crypto.randomUUID()}`;
  if (!(await claimJob(env.DB, personaId, subject.kind, jobId))) {
    return json<PortraitGenerateResult>({ personaId, status: 'generating', provider: resolved.providerId }, { status: 202 });
  }
  const limit = portraitDailyLimit(env);
  const use = await consumeDaily(env.DB, env.WORKSPACE_ID, USAGE_KIND, limit);
  if (!use.allowed) {
    await releaseJob(env.DB, personaId, jobId);
    throw new HttpError('rate_limited', `Portrait generation is paused until tomorrow (UTC): today's limit of ${limit} is used up. Raise PORTRAIT_DAILY_LIMIT in apps/worker/.dev.vars to allow more.`);
  }

  const job = runPortraitJob(env, { subject, jobId, resolved, day: use.day, previousKey: ready?.r2_key ?? null });
  if (wait) {
    const outcome = await job;
    if (!outcome.ok) throw outcome.error;
    return json<PortraitGenerateResult>({ personaId, status: 'exists', provider: outcome.provider, created: true, remainingToday: use.remaining });
  }
  rc.ctx.waitUntil(job);
  return json<PortraitGenerateResult>({ personaId, status: 'generating', provider: resolved.providerId, remainingToday: use.remaining }, { status: 202 });
};

type JobOutcome = { ok: true; provider: ProviderId } | { ok: false; error: Error };

/** Generate → validate → store → point the row at it. Never rejects (safe for waitUntil); failures are recorded on the row. */
async function runPortraitJob(
  env: Env,
  job: { subject: PortraitSubject; jobId: string; resolved: Resolved<'image'>; day: string; previousKey: string | null },
): Promise<JobOutcome> {
  const { subject, jobId, resolved } = job;
  const personaId = subject.id;
  try {
    const prompt = warpablePrompt(subject.portraitPrompt);
    const result = await resolved.provider.generate({ prompt, aspect: '3:4', signal: AbortSignal.timeout(PORTRAIT_TIMEOUT_MS) });
    let image;
    try {
      image = decodeImage(result.image);
    } catch (err) {
      if (err instanceof ImageError) {
        throw new HttpError('provider_error', `The image provider returned something we cannot use as a portrait (${err.reason === 'too_large' ? 'over 5 MB' : 'not a PNG, JPEG or WebP image'}). Try again.`);
      }
      throw err;
    }
    const provider = result.provider ?? resolved.providerId;
    const version = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const generatedAt = new Date().toISOString();
    const hash = await promptHash(prompt);
    const r2Key = portraitKey(personaId, image.ext);
    await env.BLOBS.put(r2Key, image.bytes, {
      httpMetadata: { contentType: image.mime },
      customMetadata: { personaId, subjectKind: subject.kind, provider, model: result.model ?? '', promptHash: hash, version, generatedAt },
    });
    const current = await completeJob(env.DB, personaId, jobId, { r2Key, mime: image.mime, bytes: image.bytes.byteLength, version, provider, model: result.model ?? '', promptHash: hash, generatedAt });
    if (current && job.previousKey && job.previousKey !== r2Key) await env.BLOBS.delete(job.previousKey);
    if (!current) {
      // A newer job took over while this one ran; keep the row consistent with R2.
      const row = await getRow(env.DB, personaId);
      if (row?.r2_key !== r2Key) await env.BLOBS.delete(r2Key);
    }
    return { ok: true, provider };
  } catch (err) {
    const error = describeFailure(err, resolved.providerId);
    // Provider errors normally cost nothing: give the use back. An unusable image was paid for: keep it counted.
    if (err instanceof ProviderError) await refundDaily(env.DB, env.WORKSPACE_ID, USAGE_KIND, job.day).catch(() => undefined);
    await failJob(env.DB, personaId, jobId, error.message).catch(() => undefined);
    const cause = err instanceof Error && err !== error ? ` (${err.name}: ${err.message.slice(0, 200)})` : '';
    console.error(`[portraits] ${personaId}: ${error.message}${cause}`);
    return { ok: false, error };
  }
}

/** An owner-facing error (never a provider payload). */
function describeFailure(err: unknown, provider: ProviderId): Error {
  if (err instanceof HttpError) return err;
  if (err instanceof ProviderError) return new HttpError('provider_error', `The ${err.provider} image provider failed${err.status ? ` (${err.status})` : ''}. Try again in a moment.`);
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new HttpError('provider_error', `The ${provider} image provider took longer than ${PORTRAIT_TIMEOUT_MS / 1000} seconds. Try again.`);
  }
  return new HttpError('internal', 'Something went wrong while painting the portrait. Try again.');
}

function jobState(row: PortraitRow | null): PortraitJobState {
  if (row?.job_status === 'generating') return 'generating';
  if (row?.job_status === 'failed') return 'failed';
  return 'none';
}

function notFound(personaId: string, row: PortraitRow | null): Response {
  const state = jobState(row);
  const message =
    state === 'generating'
      ? `The portrait for ${personaId} is still being painted.`
      : state === 'failed'
        ? `The last portrait for ${personaId} failed: ${row?.job_error ?? 'unknown error'}`
        : `There is no portrait for ${personaId} yet.`;
  return errorResponse('not_found', message, { headers: { [PORTRAIT_HEADERS.status]: state } });
}

/** GET /api/portraits/:personaId[?v=<version>] → the image (ETag, revalidated unless `v` is current), or 404 + X-Portrait-Status. */
export const handleGetPortrait: RouteHandler = async (req, rc) => {
  const { env } = rc;
  const personaId = subjectIdParam(rc.params.personaId);
  const { ready, row } = await readyPortrait(env, personaId, findSubject(personaId)?.kind);
  if (!ready) return notFound(personaId, row);
  const etag = `"${ready.version}"`;
  const asked = rc.url.searchParams.get('v');
  const headers = new Headers({
    etag,
    // Revalidate every time: a forced regeneration must reach the face renderer before it measures landmarks.
    // A versioned URL (?v=<X-Portrait-Version>, as listed by GET /api/portraits) names one image forever, so it
    // may be cached for good (set below, once the stored bytes are known to be that version).
    'cache-control': 'private, no-cache',
    'x-content-type-options': 'nosniff',
    [PORTRAIT_HEADERS.version]: ready.version,
  });
  if (ready.generated_at) headers.set('last-modified', new Date(ready.generated_at).toUTCString());
  const inm = req.headers.get('if-none-match');
  if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers });
  const obj = await env.BLOBS.get(ready.r2_key);
  if (!obj) {
    await forgetImage(env.DB, personaId, ready.r2_key);
    return notFound(personaId, null);
  }
  // The R2 key is not versioned: a regeneration overwrites it before D1 moves to the new version (and stays that
  // way if the job then fails). Only bytes stamped with the asked-for version may be cached for good; anything
  // else is served revalidating, under the ETag of what it really is.
  const stored = obj.customMetadata?.version;
  if (asked && asked === ready.version && stored === ready.version) headers.set('cache-control', 'private, max-age=31536000, immutable');
  else if (stored && stored !== ready.version) headers.set('etag', `"${stored}"`);
  headers.set('content-type', ready.mime);
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { headers });
};

function parseLandmarks(stored: string | null): LandmarksResponse['landmarks'] {
  if (!stored) return null;
  try {
    return normalizeLandmarks(JSON.parse(stored));
  } catch {
    return null;
  }
}

/** GET /api/portraits/:personaId/landmarks → {personaId, landmarks | null} for the current image. */
export const handleGetLandmarks: RouteHandler = async (_req, rc) => {
  const personaId = subjectIdParam(rc.params.personaId);
  const row = await getRow(rc.env.DB, personaId);
  const landmarks = row?.r2_key ? parseLandmarks(row.landmarks) : null;
  return json<LandmarksResponse>({ personaId, landmarks }, row?.version ? { headers: { [PORTRAIT_HEADERS.version]: row.version } } : {});
};

/** PUT /api/portraits/:personaId/landmarks {landmarks, force?, portraitVersion?} → LandmarksResponse; first valid write wins (409 after). */
export const handlePutLandmarks: RouteHandler = async (req, rc) => {
  const personaId = subjectIdParam(rc.params.personaId);
  const body = await readJson<unknown>(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('bad_request', 'Include landmarks.');
  const b = body as Record<string, unknown>;
  if (b.landmarks == null) throw new HttpError('bad_request', 'Include landmarks.');
  const normalized = normalizeLandmarks(b.landmarks); // LandmarksError → 400
  const serialized = JSON.stringify(normalized);
  if (serialized.length > LANDMARKS_MAX_BYTES) throw new HttpError('payload_too_large', 'Landmark data is too large.');
  if (b.portraitVersion !== undefined && typeof b.portraitVersion !== 'string') throw new HttpError('bad_request', 'portraitVersion must be text.');

  const outcome = await saveLandmarks(rc.env.DB, personaId, serialized, {
    force: b.force === true,
    ...(typeof b.portraitVersion === 'string' ? { portraitVersion: b.portraitVersion } : {}),
  });
  switch (outcome) {
    case 'no_portrait':
      throw new HttpError('not_found', `There is no portrait for ${personaId} yet, so there is nothing to measure.`);
    case 'stale':
      throw new HttpError('conflict', `The portrait for ${personaId} changed. Measure the new image.`);
    case 'conflict':
      throw new HttpError('conflict', `Landmarks for ${personaId} are already saved. The first valid measurement wins.`);
    default: {
      const row = await getRow(rc.env.DB, personaId);
      return json<LandmarksResponse>({ personaId, landmarks: parseLandmarks(row?.landmarks ?? serialized) }, row?.version ? { headers: { [PORTRAIT_HEADERS.version]: row.version } } : {});
    }
  }
};
