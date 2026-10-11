// Files (Phase 4): images and short videos made from a description, kept per organization in its WorkspaceDO (the
// index) and R2 (`ws/<org>/files/<fileId>.<ext>`). Making one answers at once with a "working" file; the image is made
// in the background (OpenAI or xAI), the video is started at xAI and polled until ready, then copied into R2 because
// xAI's link is temporary. Each change is a `file.updated` frame, and the one who asked hears about it (the Chief posts
// it in Talk). With no provider and Mock on (development, tests), a placeholder stands in and says so.
import type { Registry } from '@headcount/models';
import { MissingProviderError, ProviderError } from '@headcount/models';
import {
  FILE_CHANGE_MAX,
  FILE_PROMPT_MAX,
  IMAGE_ASPECTS,
  VIDEO_ASPECTS,
  VIDEO_SECONDS_MAX,
  type FileStatus,
  type FileView,
  type ImageAspect,
  type VideoAspect,
} from '@headcount/protocol/ext/files';
import type { Env } from '../env';
import { clipText } from '../jobs/job-view';
import { decodeImage, ImageError } from '../media/image';
import { mediaRuntime } from '../media/media-images';
import { IMAGE_USAGE_KIND, portraitDailyLimit } from '../media/portraits';
import { consumeDaily, refundDaily } from '../media/usage';
import { MOCK_MP4_BASE64, startVideo, videoStatus, type VideoJob } from './video';

export const FILES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS files (
     file_id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
     ext TEXT, mime TEXT, bytes INTEGER, aspect TEXT, seconds INTEGER, made_by TEXT NOT NULL, source TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT, job TEXT, placeholder INTEGER)`,
  `CREATE INDEX IF NOT EXISTS files_created ON files (created_at)`,
];

/** Columns added after the table first shipped (each runs once; "duplicate column" means it already ran). */
const FILES_MIGRATIONS = ['ALTER TABLE files ADD COLUMN edit_of TEXT'];

type Row = {
  file_id: string;
  kind: string;
  title: string;
  prompt: string;
  status: string;
  ext: string | null;
  mime: string | null;
  bytes: number | null;
  aspect: string | null;
  seconds: number | null;
  made_by: string;
  source: string | null;
  created_at: string;
  updated_at: string;
  error: string | null;
  job: string | null;
  placeholder: number | null;
  edit_of: string | null;
};

export const VIDEO_DAILY_LIMIT_DEFAULT = 10;
const VIDEO_USAGE_KIND = 'video';
/** A video still not ready after this long has failed. */
const VIDEO_GIVE_UP_MS = 15 * 60_000;
/** How often a working video is checked. */
export const VIDEO_POLL_MS = 8_000;

export function videoDailyLimit(env: Env): number {
  const n = Number(env.VIDEO_DAILY_LIMIT);
  return env.VIDEO_DAILY_LIMIT && Number.isInteger(n) && n >= 0 ? n : VIDEO_DAILY_LIMIT_DEFAULT;
}

/** Whether images can be made with this configuration (a provider, or the placeholder with Mock on). */
export function canMakeImages(env: Env): boolean {
  try {
    mediaRuntime.registry(env).resolve('image', { allowMock: false });
    return true;
  } catch (err) {
    if (!(err instanceof MissingProviderError)) return false;
    return env.ENABLE_MOCK === 'true';
  }
}

export interface FilesPorts {
  sql: SqlStorage;
  env: Env;
  blobs: R2Bucket;
  workspaceId: string;
  registry(): Registry;
  now(): number;
  /** A file changed: the frame (and whoever is waiting on it). */
  changed(file: FileView, removed?: boolean): void;
  /** Keep work alive after the request answered. */
  background(work: Promise<unknown>): void;
  /** Check working videos again at this time. */
  pollAt(at: number): Promise<void>;
  /** Tests: the xAI video API. */
  fetch?: typeof fetch;
}

export type Made = { ok: true; file: FileView } | { ok: false; code: 'bad_request' | 'not_configured' | 'rate_limited' | 'not_found' | 'conflict'; message: string; missingKeys?: string[] };

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const titleOf = (prompt: string) => {
  const t = prompt.replace(/\s+/g, ' ').trim().replace(/^(an? |the )/i, '');
  return clipText(t.charAt(0).toUpperCase() + t.slice(1), 60);
};

export class Files {
  constructor(private readonly p: FilesPorts) {
    for (const stmt of FILES_SCHEMA) p.sql.exec(stmt);
    for (const stmt of FILES_MIGRATIONS) {
      try {
        p.sql.exec(stmt);
      } catch {
        /* already added */
      }
    }
  }

  /** What can be made here now: a provider, or the placeholder (Mock on). */
  can(): { image: boolean; video: boolean } {
    return { image: this.imageMode() !== null, video: this.videoMode() !== null };
  }

  list(limit = 100): FileView[] {
    return this.p.sql.exec<Row>('SELECT * FROM files ORDER BY created_at DESC LIMIT ?', Math.max(1, Math.min(200, limit))).toArray().map((r) => this.view(r));
  }

  get(fileId: string): FileView | null {
    const r = this.row(fileId);
    return r ? this.view(r) : null;
  }

  /** Where a ready file's bytes are (for serving). */
  stored(fileName: string): { key: string; mime: string; bytes: number } | null {
    const [fileId, ext] = fileName.split('.');
    const r = fileId ? this.row(fileId) : undefined;
    if (!r || r.status !== 'ready' || r.ext !== ext || !r.mime) return null;
    return { key: this.key(r.file_id, r.ext), mime: r.mime, bytes: Number(r.bytes ?? 0) };
  }

  async remove(fileName: string): Promise<boolean> {
    const fileId = fileName.split('.')[0] ?? '';
    const r = this.row(fileId);
    if (!r) return false;
    this.p.sql.exec('DELETE FROM files WHERE file_id = ?', fileId);
    if (r.ext) await this.p.blobs.delete(this.key(fileId, r.ext)).catch(() => undefined);
    this.p.changed(this.view(r), true);
    return true;
  }

  /** An image from a description: answers "working" at once; made in the background. */
  async makeImage(req: { prompt: string; aspect?: string; madeBy: string; source?: FileView['source']; wait?: boolean }): Promise<Made> {
    const prompt = req.prompt.replace(/\s+/g, ' ').trim().slice(0, FILE_PROMPT_MAX);
    if (prompt.length < 3) return { ok: false, code: 'bad_request', message: 'Describe the image in a few words.' };
    const aspect: ImageAspect = (IMAGE_ASPECTS as readonly string[]).includes(req.aspect ?? '') ? (req.aspect as ImageAspect) : '1:1';
    const mode = this.imageMode();
    if (!mode) return { ok: false, code: 'not_configured', message: 'Images need an OpenAI or xAI key. An owner adds one in Admin → Provider keys.', missingKeys: ['OPENAI_API_KEY', 'XAI_API_KEY'] };
    const limit = portraitDailyLimit(this.p.env);
    const use = await consumeDaily(this.p.env.DB, this.p.workspaceId, IMAGE_USAGE_KIND, limit);
    if (!use.allowed) return { ok: false, code: 'rate_limited', message: `Image making is paused until tomorrow (UTC): today's ${limit} are used.` };
    const file = this.insert({ kind: 'image', prompt, aspect, madeBy: req.madeBy, source: req.source });
    const work = this.renderImage(file.fileId, prompt, aspect, mode === 'mock', use.day);
    // Work in a project waits for its image (it goes into the work); everyone else hears when it is ready.
    if (req.wait) {
      await work;
      return { ok: true, file: this.get(file.fileId) ?? file };
    }
    this.p.background(work);
    return { ok: true, file };
  }

  /**
   * A new version of an image with one change, made from the image itself (the provider's edit, so the layout,
   * wording and style carry over). Answers "working" at once, like making one; the original is kept.
   */
  async editImage(req: { fileId: string; change: string; madeBy: string }): Promise<Made> {
    const original = this.row(req.fileId);
    if (!original || original.kind !== 'image') return { ok: false, code: 'not_found', message: 'No such image.' };
    if (original.status !== 'ready' || !original.ext) return { ok: false, code: 'conflict', message: 'That image is not ready yet. Edit it once it is.' };
    const change = req.change.replace(/\s+/g, ' ').trim().slice(0, FILE_CHANGE_MAX);
    if (change.length < 3) return { ok: false, code: 'bad_request', message: 'Say what should change, in a few words.' };
    const mode = this.imageMode();
    if (!mode) return { ok: false, code: 'not_configured', message: 'Images need an OpenAI or xAI key. An owner adds one in Admin → Provider keys.', missingKeys: ['OPENAI_API_KEY', 'XAI_API_KEY'] };
    const stored = await this.p.blobs.get(this.key(original.file_id, original.ext));
    if (!stored) return { ok: false, code: 'not_found', message: 'The original image is gone. Make a new one instead.' };
    const bytes = await stored.arrayBuffer();
    const limit = portraitDailyLimit(this.p.env);
    const use = await consumeDaily(this.p.env.DB, this.p.workspaceId, IMAGE_USAGE_KIND, limit);
    if (!use.allowed) return { ok: false, code: 'rate_limited', message: `Image making is paused until tomorrow (UTC): today's ${limit} are used.` };
    const aspect: ImageAspect = (IMAGE_ASPECTS as readonly string[]).includes(original.aspect ?? '') ? (original.aspect as ImageAspect) : '1:1';
    const prompt = clipText(`${original.prompt} Changed: ${change}`, FILE_PROMPT_MAX);
    const file = this.insert({ kind: 'image', prompt, aspect, madeBy: req.madeBy, source: { kind: 'files', ref: original.file_id }, title: original.title, editOf: original.file_id });
    // The provider edits the picture itself; a placeholder original (no provider) is simply made again.
    const source = original.mime && original.mime !== 'image/svg+xml' && mode !== 'mock' ? { data: bytes, mime: original.mime } : undefined;
    const instruction = source ? `Edit this image. Change: ${change}. Keep everything else as it is: the layout, the wording, the colors and the style. It was made from this description: ${original.prompt}` : prompt;
    this.p.background(this.renderImage(file.fileId, instruction, aspect, mode === 'mock', use.day, source));
    return { ok: true, file };
  }

  /** A short video from a description (xAI): answers "working" at once; checked until it is ready. */
  async makeVideo(req: { prompt: string; aspect?: string; seconds?: number; madeBy: string; source?: FileView['source'] }): Promise<Made> {
    const prompt = req.prompt.replace(/\s+/g, ' ').trim().slice(0, FILE_PROMPT_MAX);
    if (prompt.length < 3) return { ok: false, code: 'bad_request', message: 'Describe the video in a few words.' };
    const aspect: VideoAspect = (VIDEO_ASPECTS as readonly string[]).includes(req.aspect ?? '') ? (req.aspect as VideoAspect) : '16:9';
    const seconds = Math.min(VIDEO_SECONDS_MAX, Math.max(1, Math.round(req.seconds ?? 6)));
    const mode = this.videoMode();
    if (!mode) return { ok: false, code: 'not_configured', message: 'Videos need an xAI key. An owner adds XAI_API_KEY in Admin → Provider keys.', missingKeys: ['XAI_API_KEY'] };
    const limit = videoDailyLimit(this.p.env);
    const use = await consumeDaily(this.p.env.DB, this.p.workspaceId, VIDEO_USAGE_KIND, limit);
    if (!use.allowed) return { ok: false, code: 'rate_limited', message: `Video making is paused until tomorrow (UTC): today's ${limit} are used.` };
    const file = this.insert({ kind: 'video', prompt, aspect, seconds, madeBy: req.madeBy, source: req.source });
    if (mode === 'mock') {
      this.p.background(this.storeReady(file.fileId, Uint8Array.from(atob(MOCK_MP4_BASE64), (c) => c.charCodeAt(0)), 'video/mp4', 'mp4', true));
      return { ok: true, file };
    }
    try {
      const job = await startVideo({ key: this.p.env.XAI_API_KEY!, prompt, aspect, seconds, ...(this.p.fetch ? { fetch: this.p.fetch } : {}) });
      this.p.sql.exec('UPDATE files SET job = ?, updated_at = ? WHERE file_id = ?', JSON.stringify(job), this.iso(), file.fileId);
      await this.p.pollAt(this.p.now() + VIDEO_POLL_MS);
    } catch (err) {
      await refundDaily(this.p.env.DB, this.p.workspaceId, VIDEO_USAGE_KIND, use.day).catch(() => undefined);
      this.fail(file.fileId, err instanceof Error ? err.message : 'xAI did not take the request. Try again.');
      return { ok: true, file: this.get(file.fileId)! };
    }
    return { ok: true, file: this.get(file.fileId)! };
  }

  /** Check every working video once; returns whether any is still working (check again later). */
  async poll(): Promise<boolean> {
    const working = this.p.sql.exec<Row>(`SELECT * FROM files WHERE kind = 'video' AND status = 'working' AND job IS NOT NULL`).toArray();
    let pending = false;
    for (const r of working) {
      if (this.p.now() - Date.parse(r.created_at) > VIDEO_GIVE_UP_MS) {
        this.fail(r.file_id, 'The video took too long and was given up. Try again, or a shorter one.');
        continue;
      }
      try {
        const s = await videoStatus({ key: this.p.env.XAI_API_KEY ?? '', job: JSON.parse(r.job!) as VideoJob, ...(this.p.fetch ? { fetch: this.p.fetch } : {}) });
        if (s.status === 'pending') pending = true;
        else if (s.status === 'failed') this.fail(r.file_id, s.message);
        else {
          const got = await (this.p.fetch ?? fetch)(s.url, { signal: AbortSignal.timeout(60_000) });
          if (!got.ok) throw new Error(`The finished video could not be fetched (${got.status}).`);
          const bytes = new Uint8Array(await got.arrayBuffer());
          if (bytes.byteLength > 80_000_000) throw new Error('The video is too large to keep.');
          await this.storeReady(r.file_id, bytes, 'video/mp4', 'mp4', false, s.seconds);
        }
      } catch (err) {
        // A failed check is tried again on the next one (until the give-up time).
        pending = true;
        console.error('[files] video check failed:', err instanceof Error ? err.message.slice(0, 200) : String(err));
      }
    }
    return pending;
  }

  hasWorkingVideos(): boolean {
    return this.p.sql.exec(`SELECT file_id FROM files WHERE kind = 'video' AND status = 'working' AND job IS NOT NULL LIMIT 1`).toArray().length > 0;
  }

  // ── inside ─────────────────────────────────────────────────────────────────────

  private imageMode(): 'real' | 'mock' | null {
    try {
      this.p.registry().resolve('image', { allowMock: false });
      return 'real';
    } catch (err) {
      if (!(err instanceof MissingProviderError)) throw err;
      return this.p.env.ENABLE_MOCK === 'true' ? 'mock' : null;
    }
  }

  private videoMode(): 'real' | 'mock' | null {
    if (this.p.env.XAI_API_KEY) return 'real';
    return this.p.env.ENABLE_MOCK === 'true' ? 'mock' : null;
  }

  private async renderImage(fileId: string, prompt: string, aspect: ImageAspect, mock: boolean, day: string, source?: { data: ArrayBuffer; mime: string }): Promise<void> {
    try {
      const resolved = this.p.registry().resolve('image', mock ? {} : { allowMock: false });
      const result = await resolved.provider.generate({ prompt, aspect, ...(source ? { source } : {}), signal: AbortSignal.timeout(180_000) });
      if (result.mime === 'image/svg+xml') {
        await this.storeReady(fileId, new Uint8Array(result.image), 'image/svg+xml', 'svg', true);
        return;
      }
      const image = decodeImage(result.image, 10_000_000);
      await this.storeReady(fileId, image.bytes, image.mime, image.ext, false);
    } catch (err) {
      if (err instanceof ProviderError) await refundDaily(this.p.env.DB, this.p.workspaceId, IMAGE_USAGE_KIND, day).catch(() => undefined);
      this.fail(fileId, err instanceof ImageError ? 'The image came back in a form that cannot be kept. Try again.' : err instanceof ProviderError ? `The ${err.provider} image service failed. Try again in a moment.` : 'The image could not be made. Try again.');
    }
  }

  private async storeReady(fileId: string, bytes: Uint8Array, mime: string, ext: string, placeholder: boolean, seconds?: number): Promise<void> {
    if (!this.row(fileId)) return; // removed meanwhile
    await this.p.blobs.put(this.key(fileId, ext), bytes, { httpMetadata: { contentType: mime }, customMetadata: { fileId } });
    this.p.sql.exec(
      `UPDATE files SET status = 'ready', ext = ?, mime = ?, bytes = ?, placeholder = ?, seconds = COALESCE(?, seconds), job = NULL, updated_at = ? WHERE file_id = ?`,
      ext, mime, bytes.byteLength, placeholder ? 1 : 0, seconds ?? null, this.iso(), fileId,
    );
    this.p.changed(this.get(fileId)!);
  }

  private fail(fileId: string, message: string): void {
    this.p.sql.exec(`UPDATE files SET status = 'failed', error = ?, job = NULL, updated_at = ? WHERE file_id = ?`, clipText(message, 300), this.iso(), fileId);
    const f = this.get(fileId);
    if (f) this.p.changed(f);
  }

  private insert(f: { kind: 'image' | 'video'; prompt: string; aspect: string; seconds?: number; madeBy: string; source?: FileView['source']; title?: string; editOf?: string }): FileView {
    const fileId = `fil_${hex(10)}`;
    const at = this.iso();
    this.p.sql.exec(
      `INSERT INTO files (file_id, kind, title, prompt, status, aspect, seconds, made_by, source, created_at, updated_at, edit_of) VALUES (?, ?, ?, ?, 'working', ?, ?, ?, ?, ?, ?, ?)`,
      fileId, f.kind, f.title ?? titleOf(f.prompt), f.prompt, f.aspect, f.seconds ?? null, f.madeBy, f.source ? JSON.stringify(f.source) : null, at, at, f.editOf ?? null,
    );
    const view = this.get(fileId)!;
    this.p.changed(view);
    return view;
  }

  private key(fileId: string, ext: string): string {
    return `ws/${this.p.workspaceId}/files/${fileId}.${ext}`;
  }

  private row(fileId: string): Row | undefined {
    return this.p.sql.exec<Row>('SELECT * FROM files WHERE file_id = ?', fileId).toArray()[0];
  }

  private iso(): string {
    return new Date(this.p.now()).toISOString();
  }

  private view(r: Row): FileView {
    return {
      fileId: r.file_id,
      kind: r.kind as FileView['kind'],
      title: r.title,
      prompt: r.prompt,
      status: r.status as FileStatus,
      ...(r.status === 'ready' && r.ext ? { url: `/api/files/${r.file_id}.${r.ext}` } : {}),
      ...(r.mime ? { mime: r.mime } : {}),
      ...(r.bytes ? { bytes: Number(r.bytes) } : {}),
      ...(r.aspect ? { aspect: r.aspect } : {}),
      ...(r.seconds ? { seconds: Number(r.seconds) } : {}),
      madeBy: r.made_by,
      ...(r.source ? { source: JSON.parse(r.source) as NonNullable<FileView['source']> } : {}),
      createdAt: r.created_at,
      ...(r.error ? { error: r.error } : {}),
      ...(r.placeholder ? { placeholder: true } : {}),
      ...(r.edit_of ? { editOf: r.edit_of } : {}),
    };
  }
}
