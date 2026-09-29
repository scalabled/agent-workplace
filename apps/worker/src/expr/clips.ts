// The clip service (docs/dev/INC05-PLAN.md §3.5, §4 A2): render a line once per content-addressed key in exactly the
// requested voice provider (no failover: a clip keyed for xAI is xAI audio), store it in R2 with its metadata and
// alignment, and answer later requests from storage. Concurrent renders of one key in an isolate share one call.
import { ProviderError, type Registry } from '@headcount/models';
import type { TtsDelivery } from '@headcount/expressions';
import type { Alignment, VoiceRef } from '@headcount/protocol';
import type { ExprClipAlignment, ExprTtsProvider } from '@headcount/protocol/ext/expressions';
import type { Env } from '../env';
import { HttpError } from '../lib/http';
import { consumeDaily, refundDaily, utcDay } from '../media/usage';
import { logError } from '../workspace/runtime';
import { clipDurationMs, clipExtension } from './audio-meta';
import { EXPR_CLIP_USAGE_KIND, exprLimit } from './config';

export const CLIP_KEY_RE = /^c1_[a-z2-7]{32}$/;
export type ClipScope = 'shared' | 'workspace';

const EXTENSIONS = ['mp3', 'wav'] as const;

/** R2 key of a clip's audio: shared clips under `expr/clips/`, workspace clips under `ws/<ws>/expr/`. */
export function clipObjectKey(scope: ClipScope, ws: string, clipKey: string, ext: 'mp3' | 'wav'): string {
  return scope === 'shared' ? `expr/clips/${clipKey}.${ext}` : `ws/${ws}/expr/${clipKey}.${ext}`;
}

/** R2 key of a clip's alignment sidecar. */
export function alignObjectKey(scope: ClipScope, ws: string, clipKey: string): string {
  return scope === 'shared' ? `expr/clips/${clipKey}.align.json` : `ws/${ws}/expr/${clipKey}.align.json`;
}

/** `customMetadata` of a stored clip (all strings in R2). */
export interface ClipMeta {
  durationMs: number;
  mime: string;
  provider: ExprTtsProvider;
  voiceKey: string;
  scope: ClipScope;
  lineId: string;
  fillKey: string;
  catalogVersion: string;
  alignment: 'chars' | 'none';
  createdAt: string;
}

export interface StoredClip {
  scope: ClipScope;
  objectKey: string;
  durationMs: number;
  mime: string;
  alignment: boolean;
}

function metaOf(o: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } }, scope: ClipScope, objectKey: string): StoredClip {
  const m = o.customMetadata ?? {};
  return {
    scope,
    objectKey,
    durationMs: Math.max(0, Number(m.durationMs) || 0),
    mime: m.mime || o.httpMetadata?.contentType || (objectKey.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'),
    alignment: m.alignment === 'chars',
  };
}

/** Where a clip is stored (shared prefix first, then this workspace's), or null. Heads only. */
export async function findClip(env: Env, clipKey: string): Promise<StoredClip | null> {
  const ws = env.WORKSPACE_ID;
  for (const scope of ['shared', 'workspace'] as const) {
    for (const ext of EXTENSIONS) {
      const key = clipObjectKey(scope, ws, clipKey, ext);
      const head = await env.BLOBS.head(key);
      if (head) return metaOf(head, scope, key);
    }
  }
  return null;
}

/** A clip's bytes and metadata, or null when it was never rendered. */
export async function readClip(env: Env, clipKey: string): Promise<{ clip: StoredClip; body: ReadableStream | ArrayBuffer; size: number } | null> {
  const ws = env.WORKSPACE_ID;
  for (const scope of ['shared', 'workspace'] as const) {
    for (const ext of EXTENSIONS) {
      const key = clipObjectKey(scope, ws, clipKey, ext);
      const obj = await env.BLOBS.get(key);
      if (obj) return { clip: metaOf(obj, scope, key), body: obj.body as ReadableStream, size: obj.size };
    }
  }
  return null;
}

/** A clip's alignment sidecar (always has `text`; `alignment` null when the provider gave none), or null. */
export async function readAlignment(env: Env, clipKey: string): Promise<{ scope: ClipScope; value: ExprClipAlignment } | null> {
  for (const scope of ['shared', 'workspace'] as const) {
    const obj = await env.BLOBS.get(alignObjectKey(scope, env.WORKSPACE_ID, clipKey));
    if (!obj) continue;
    try {
      const value = JSON.parse(await obj.text()) as ExprClipAlignment;
      return { scope, value: { clipKey, text: String(value.text ?? ''), alignment: value.alignment ?? null } };
    } catch (err) {
      logError('expr.align', err);
      return { scope, value: { clipKey, text: '', alignment: null } };
    }
  }
  return null;
}

/** Cache-Control of a stored clip or its alignment: shared clips are public, workspace clips private. */
export function clipCacheControl(scope: ClipScope): string {
  return `${scope === 'shared' ? 'public' : 'private'}, max-age=31536000, immutable`;
}

// ── rendering ───────────────────────────────────────────────────────────────────
export interface RenderClipInput {
  delivery: TtsDelivery;
  clipKey: string;
  scope: ClipScope;
  /** Readable text of the line (captions, text-timed mouth when there is no alignment). */
  text: string;
  lineId: string;
  fillKey: string;
  voiceKey: string;
  catalogVersion: string;
}

export interface RenderedClip {
  clipKey: string;
  scope: ClipScope;
  durationMs: number;
  /** True when the clip already existed: no TTS call, no budget used. */
  cached: boolean;
  alignment: boolean;
}

/** One render per clip key at a time in this isolate. */
const inflight = new Map<string, Promise<RenderedClip>>();

/** The voice a provider needs for a delivery (voice id + speed; OpenAI also takes the instructions). */
function voiceFor(d: TtsDelivery): VoiceRef {
  const id = d.voiceId ?? undefined;
  switch (d.provider) {
    case 'openai':
      return { ...(id ? { openai: id } : {}), speed: d.speed, ...(d.instructions ? { instructions: d.instructions } : {}) };
    case 'xai':
    case 'mock':
      return { ...(id ? { xai: id } : {}), speed: d.speed };
    default:
      return { speed: d.speed };
  }
}

/** A readable limit message naming the variable that raises it. */
export function clipLimitMessage(limit: number): string {
  return `Voice clips are paused until tomorrow (UTC): today's limit of ${limit} renders is used up. An owner can raise it in Admin → Settings (EXPR_CLIP_DAILY_LIMIT).`;
}

/** The sentence when today's clip budget cannot be read: paid renders wait rather than go uncounted. */
export const CLIP_BUDGET_UNREADABLE = 'Voice clips are paused: today\'s clip budget could not be read. Try again in a moment; if it keeps happening, restart pnpm dev so the local database migrations apply.';

/**
 * Clip renders left today (UTC); Mock renders are uncounted, and so is a worker with no D1 binding at all (keyless
 * and test setups). A D1 error fails closed (500): the budget is never assumed to be free.
 */
export async function clipsRemainingToday(env: Env, provider: ExprTtsProvider): Promise<number> {
  const limit = exprLimit(env, 'clipDaily');
  if (provider === 'mock' || provider === 'browser' || !env.DB) return limit;
  try {
    const row = await env.DB.prepare('SELECT count FROM media_usage WHERE ws_id = ? AND day = ? AND kind = ?').bind(env.WORKSPACE_ID, utcDay(), EXPR_CLIP_USAGE_KIND).first<{ count: number }>();
    return Math.max(0, limit - Number(row?.count ?? 0));
  } catch (err) {
    logError('expr.usage', err);
    throw new HttpError('internal', CLIP_BUDGET_UNREADABLE);
  }
}

/** Count one real render (EXPR_CLIP_DAILY_LIMIT); returns the refund. Mock is free. A D1 error fails closed, like takeDaily. */
async function takeClipBudget(env: Env, provider: ExprTtsProvider): Promise<() => Promise<void>> {
  if (provider === 'mock' || !env.DB) return async () => undefined;
  const limit = exprLimit(env, 'clipDaily');
  let use;
  try {
    use = await consumeDaily(env.DB, env.WORKSPACE_ID, EXPR_CLIP_USAGE_KIND, limit);
  } catch (err) {
    logError('expr.usage', err);
    throw new HttpError('internal', CLIP_BUDGET_UNREADABLE);
  }
  if (!use.allowed) throw new HttpError('rate_limited', clipLimitMessage(limit));
  const db = env.DB;
  return () => refundDaily(db, env.WORKSPACE_ID, EXPR_CLIP_USAGE_KIND, use.day).catch(() => undefined);
}

/**
 * Render a clip once and store it (idempotent by clip key). Checks R2 first (`cached: true`), joins a render of the
 * same key already in flight, counts the daily budget (refunded when the provider fails), calls TTS in exactly
 * `delivery.provider`, and stores the audio with its metadata plus an `.align.json` sidecar.
 * Throws HttpError: rate_limited (budget), not_configured (that provider is gone), provider_error (it failed).
 */
export function renderClip(env: Env, registry: Registry, input: RenderClipInput, now: () => number = Date.now): Promise<RenderedClip> {
  const running = inflight.get(input.clipKey);
  if (running) return running.then((r) => ({ ...r, cached: true }));
  const p = doRender(env, registry, input, now).finally(() => inflight.delete(input.clipKey));
  inflight.set(input.clipKey, p);
  return p;
}

async function doRender(env: Env, registry: Registry, input: RenderClipInput, now: () => number): Promise<RenderedClip> {
  const existing = await findClip(env, input.clipKey);
  if (existing) return { clipKey: input.clipKey, scope: existing.scope, durationMs: existing.durationMs, cached: true, alignment: existing.alignment };
  const d = input.delivery;
  if (d.provider === 'browser') throw new HttpError('not_configured', 'Browser voices are spoken on the device; there is nothing to render.', { missingKeys: ['XAI_API_KEY', 'OPENAI_API_KEY'] });
  const resolved = registry.tryResolve('tts', { prefer: [d.provider], allowMock: d.provider === 'mock' });
  if (!resolved || resolved.providerId !== d.provider) {
    throw new HttpError('not_configured', `The ${d.provider} voice is not available any more. Reload to pick up the current voice.`, {
      missingKeys: d.provider === 'xai' ? ['XAI_API_KEY'] : d.provider === 'openai' ? ['OPENAI_API_KEY'] : [],
    });
  }
  const refund = await takeClipBudget(env, d.provider);
  let out;
  try {
    out = await resolved.provider.tts({
      text: d.input,
      voice: voiceFor(d),
      withAlignment: true,
      language: d.lang,
      ...(d.provider === 'openai' && d.model ? { model: d.model } : {}),
    });
  } catch (err) {
    await refund();
    if (err instanceof ProviderError) throw new HttpError('provider_error', `The ${d.provider} voice failed. Try again in a moment.`);
    throw err;
  }
  const alignment: Alignment | null = out.alignment && out.alignment.chars?.length ? out.alignment : null;
  const durationMs = clipDurationMs({ bytes: out.audio, mime: out.mime, providerMs: out.durationMs, alignment, text: input.text });
  const ext = clipExtension(out.mime);
  const meta: ClipMeta = {
    durationMs,
    mime: out.mime,
    provider: d.provider,
    voiceKey: input.voiceKey,
    scope: input.scope,
    lineId: input.lineId,
    fillKey: input.fillKey,
    catalogVersion: input.catalogVersion,
    alignment: alignment ? 'chars' : 'none',
    createdAt: new Date(now()).toISOString(),
  };
  const ws = env.WORKSPACE_ID;
  const sidecar: ExprClipAlignment = { clipKey: input.clipKey, text: input.text, alignment };
  // The sidecar first: a clip whose audio exists always has its alignment.
  await env.BLOBS.put(alignObjectKey(input.scope, ws, input.clipKey), JSON.stringify(sidecar), { httpMetadata: { contentType: 'application/json' } });
  await env.BLOBS.put(clipObjectKey(input.scope, ws, input.clipKey, ext), out.audio, {
    httpMetadata: { contentType: out.mime },
    customMetadata: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)])),
  });
  return { clipKey: input.clipKey, scope: input.scope, durationMs, cached: false, alignment: !!alignment };
}
