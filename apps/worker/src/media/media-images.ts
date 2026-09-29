// General image generation (owned by media): POST /api/media/image and GET /api/media/:key. Used by tooling
// (scripts/marketing-images.mjs) to art-direct images through the same provider fabric as portraits, without the
// keys ever leaving the worker. Images are stored in R2 at `media/<key>.<ext>` and share the portraits' daily
// budget (PORTRAIT_DAILY_LIMIT). These routes are not in the protocol route table: the router hands every
// unmatched /api/media/* path to handleMediaRoute (one line in src/index.ts), after its origin guard ran.
//
// Safety: prompts are capped at 1500 characters, bodies at 8 KB, images at 10 MB and checked by magic bytes
// (PNG, JPEG or WebP only); the request never names a URL to fetch, and Mock placeholders are never stored.
import { ProviderError, createRegistry, type Registry } from '@headcount/models';
import type { ProviderId } from '@headcount/protocol';
import type { Env } from '../env';
import { HttpError, errorResponse, json, mimeEssence } from '../lib/http';
import { EXT_BY_MIME, ImageError, decodeImage, promptHash, type PortraitMime } from './image';
import { IMAGE_USAGE_KIND, portraitDailyLimit } from './portraits';
import { consumeDaily, refundDaily } from './usage';

export const MEDIA_PATH_PREFIX = '/api/media/';
export const MEDIA_PROMPT_MAX_CHARS = 1500;
export const MEDIA_BODY_CAP = 8 * 1024;
export const MEDIA_MAX_BYTES = 10_000_000;
export const MEDIA_TIMEOUT_MS = 180_000;
export const MEDIA_ASPECTS = ['16:9', '4:3', '1:1', '3:4'] as const;
export type MediaAspect = (typeof MEDIA_ASPECTS)[number];
export const MEDIA_PROVIDERS = ['openai', 'xai'] as const;
export type MediaProvider = (typeof MEDIA_PROVIDERS)[number];

/** Lowercase slug, at most 64 characters. `image` is the generate route itself, so it is not a key. */
const MEDIA_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESERVED_KEYS = new Set(['image']);
const STORED_KEY = /^media\/([a-z0-9][a-z0-9-]{0,63})\.(png|jpg|webp)$/;
const MIME_BY_EXT: Record<string, PortraitMime> = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m as PortraitMime]));
const PROVIDER_KEY: Record<MediaProvider, string> = { openai: 'OPENAI_API_KEY', xai: 'XAI_API_KEY' };
const PROVIDER_LABEL: Record<MediaProvider, string> = { openai: 'OpenAI', xai: 'xAI' };

/** Test seam: the registry these routes resolve providers from (tests swap it; production uses the env's). */
export const mediaRuntime = {
  registry: (env: Env): Registry => createRegistry(env),
};
export const defaultMediaRuntime = { ...mediaRuntime };

export const mediaObjectKey = (key: string, ext: string): string => `media/${key}.${ext}`;
export const mediaUrl = (key: string, version: string): string => `${MEDIA_PATH_PREFIX}${key}?v=${encodeURIComponent(version)}`;

export interface MediaImageRequest {
  prompt: string;
  aspect: MediaAspect;
  provider?: MediaProvider;
  key: string;
}

export interface MediaImageResult {
  key: string;
  /** Versioned path to GET the stored image (immutable while the version is current). */
  url: string;
  version: string;
  mime: PortraitMime;
  bytes: number;
  aspect: MediaAspect;
  provider: ProviderId;
  model: string;
  revisedPrompt?: string;
  /** Generations left today under PORTRAIT_DAILY_LIMIT (shared with portraits). */
  remainingToday: number;
}

/**
 * Route /api/media/* (called by the router for paths the protocol table does not know). Returns null for any
 * other path, so the router answers its usual 404.
 */
export async function handleMediaRoute(req: Request, url: URL, env: Env): Promise<Response | null> {
  if (!url.pathname.startsWith(MEDIA_PATH_PREFIX)) return null;
  const rest = url.pathname.slice(MEDIA_PATH_PREFIX.length).replace(/\/$/, '');
  if (!rest || rest.includes('/')) return null;
  const method = req.method.toUpperCase();
  if (rest === 'image') {
    if (method !== 'POST') return errorResponse('method_not_allowed', `Use POST for ${url.pathname}.`, { headers: { allow: 'POST' } });
    return handleGenerateMediaImage(req, env);
  }
  if (method !== 'GET' && method !== 'HEAD') return errorResponse('method_not_allowed', `Use GET for ${url.pathname}.`, { headers: { allow: 'GET, HEAD' } });
  return handleGetMediaImage(req, url, env, rest);
}

/** Validate a POST /api/media/image body. Throws HttpError (400/413) with one sentence and its fix. */
export function parseMediaImageRequest(body: unknown): MediaImageRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('bad_request', 'Send {prompt, aspect, key} as JSON.');
  const b = body as Record<string, unknown>;
  if (b.key === undefined || b.key === null || b.key === '') throw new HttpError('bad_request', 'Include a key (a lowercase slug such as "hero") to store the image under.');
  if (typeof b.key !== 'string' || !MEDIA_KEY.test(b.key)) throw new HttpError('bad_request', 'Use a key of lowercase letters, digits and dashes (at most 64), for example "hero".');
  if (RESERVED_KEYS.has(b.key)) throw new HttpError('bad_request', `"${b.key}" is reserved. Choose another key.`);
  if (typeof b.prompt !== 'string' || !b.prompt.trim()) throw new HttpError('bad_request', 'Include a prompt describing the image.');
  const prompt = b.prompt.replace(/\s+/g, ' ').trim();
  if (prompt.length > MEDIA_PROMPT_MAX_CHARS) throw new HttpError('payload_too_large', `Keep the prompt under ${MEDIA_PROMPT_MAX_CHARS} characters.`);
  if (typeof b.aspect !== 'string' || !(MEDIA_ASPECTS as readonly string[]).includes(b.aspect)) throw new HttpError('bad_request', `Use aspect ${MEDIA_ASPECTS.map((a) => `"${a}"`).join(', ')}.`);
  if (b.provider !== undefined && b.provider !== null && (typeof b.provider !== 'string' || !(MEDIA_PROVIDERS as readonly string[]).includes(b.provider))) {
    throw new HttpError('bad_request', 'Use provider "openai" or "xai", or leave it out.');
  }
  return { prompt, aspect: b.aspect as MediaAspect, key: b.key, ...(typeof b.provider === 'string' ? { provider: b.provider as MediaProvider } : {}) };
}

/** Read a JSON body of at most MEDIA_BODY_CAP bytes (these routes are outside the router's bodyCap table). */
async function readCappedJson(req: Request): Promise<unknown> {
  if (mimeEssence(req.headers.get('content-type')) !== 'application/json') throw new HttpError('unsupported_media_type', 'Send the body as application/json.');
  const tooLarge = () => new HttpError('payload_too_large', `The request body is over ${MEDIA_BODY_CAP} bytes.`);
  const declared = Number(req.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > MEDIA_BODY_CAP) throw tooLarge();
  if (!req.body) throw new HttpError('bad_request', 'Send {prompt, aspect, key} as JSON.');
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MEDIA_BODY_CAP) {
      await reader.cancel();
      throw tooLarge();
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError('bad_request', 'The request body is not valid JSON.');
  }
}

/** POST /api/media/image {prompt, aspect, provider?, key} → MediaImageResult (the image is stored before answering). */
export async function handleGenerateMediaImage(req: Request, env: Env): Promise<Response> {
  const input = parseMediaImageRequest(await readCappedJson(req));
  const registry = mediaRuntime.registry(env);
  // Keyless → MissingProviderError → 503 naming OPENAI_API_KEY / XAI_API_KEY. Mock's SVG placeholder is never stored.
  const resolved = registry.resolve('image', { allowMock: false, ...(input.provider ? { prefer: [input.provider] } : {}) });
  if (input.provider && resolved.providerId !== input.provider) {
    const key = PROVIDER_KEY[input.provider];
    throw new HttpError('not_configured', `${PROVIDER_LABEL[input.provider]} is not configured for images. Add ${key} to apps/worker/.dev.vars, or leave provider out.`, { missingKeys: [key] });
  }

  const limit = portraitDailyLimit(env);
  const use = await consumeDaily(env.DB, env.WORKSPACE_ID, IMAGE_USAGE_KIND, limit);
  if (!use.allowed) {
    throw new HttpError('rate_limited', `Image generation is paused until tomorrow (UTC): today's limit of ${limit} (shared with portraits) is used up. Raise PORTRAIT_DAILY_LIMIT in apps/worker/.dev.vars to allow more.`);
  }

  let result;
  try {
    result = await resolved.provider.generate({ prompt: input.prompt, aspect: input.aspect, signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) });
  } catch (err) {
    // Provider errors normally cost nothing: give the use back.
    if (err instanceof ProviderError) await refundDaily(env.DB, env.WORKSPACE_ID, IMAGE_USAGE_KIND, use.day).catch(() => undefined);
    throw describeFailure(err, resolved.providerId);
  }

  let image;
  try {
    image = decodeImage(result.image, MEDIA_MAX_BYTES);
  } catch (err) {
    // An unusable image was paid for: it stays counted.
    if (err instanceof ImageError) {
      throw new HttpError('provider_error', `The image provider returned something we cannot store (${err.reason === 'too_large' ? `over ${MEDIA_MAX_BYTES / 1_000_000} MB` : 'not a PNG, JPEG or WebP image'}). Try again.`);
    }
    throw err;
  }

  const provider = result.provider ?? resolved.providerId;
  const model = result.model ?? '';
  const version = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const objectKey = mediaObjectKey(input.key, image.ext);
  await env.BLOBS.put(objectKey, image.bytes, {
    httpMetadata: { contentType: image.mime },
    customMetadata: { key: input.key, aspect: input.aspect, provider, model, promptHash: await promptHash(input.prompt), version, generatedAt: new Date().toISOString() },
  });
  // One image per key: drop an earlier one stored under another extension.
  const earlier = await env.BLOBS.list({ prefix: mediaObjectKey(input.key, '') });
  const stale = earlier.objects.map((o) => o.key).filter((k) => k !== objectKey && STORED_KEY.exec(k)?.[1] === input.key);
  if (stale.length) await env.BLOBS.delete(stale);

  return json<MediaImageResult>({
    key: input.key,
    url: mediaUrl(input.key, version),
    version,
    mime: image.mime,
    bytes: image.bytes.byteLength,
    aspect: input.aspect,
    provider,
    model,
    ...(result.revisedPrompt ? { revisedPrompt: result.revisedPrompt.slice(0, 2000) } : {}),
    remainingToday: use.remaining,
  });
}

/** An owner-facing error (never a provider payload). */
function describeFailure(err: unknown, provider: ProviderId): Error {
  if (err instanceof HttpError) return err;
  if (err instanceof ProviderError) return new HttpError('provider_error', `The ${err.provider} image provider failed${err.status ? ` (${err.status})` : ''}. Try again in a moment.`);
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new HttpError('provider_error', `The ${provider} image provider took longer than ${MEDIA_TIMEOUT_MS / 1000} seconds. Try again.`);
  }
  console.error('[media] image generation failed:', err instanceof Error ? err.message.slice(0, 200) : String(err));
  return new HttpError('internal', 'Something went wrong while generating the image. Try again.');
}

/** GET /api/media/:key[?v=<version>] → the stored image (ETag; immutable when `v` names the current version). */
export async function handleGetMediaImage(req: Request, url: URL, env: Env, key: string): Promise<Response> {
  if (!MEDIA_KEY.test(key) || RESERVED_KEYS.has(key)) throw new HttpError('bad_request', 'Use a key of lowercase letters, digits and dashes, for example "hero".');
  const listed = await env.BLOBS.list({ prefix: mediaObjectKey(key, ''), include: ['httpMetadata', 'customMetadata'] });
  const stored = listed.objects
    .filter((o) => STORED_KEY.exec(o.key)?.[1] === key)
    .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())[0];
  if (!stored) return errorResponse('not_found', `There is no image stored under ${key}.`);
  const version = stored.customMetadata?.version || `u-${stored.uploaded.getTime().toString(36)}`;
  const etag = `"${version}"`;
  const pinned = url.searchParams.get('v') === version;
  const headers = new Headers({
    etag,
    'cache-control': pinned ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'x-media-version': version,
  });
  const inm = req.headers.get('if-none-match');
  if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers });
  const ext = STORED_KEY.exec(stored.key)![2]!;
  headers.set('content-type', MIME_BY_EXT[ext]!);
  headers.set('content-length', String(stored.size));
  if (req.method.toUpperCase() === 'HEAD') return new Response(null, { headers });
  const obj = await env.BLOBS.get(stored.key);
  if (!obj) return errorResponse('not_found', `There is no image stored under ${key}.`);
  return new Response(obj.body, { headers });
}
