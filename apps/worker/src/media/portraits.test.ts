import { ProviderError, createRegistry, type ImageProvider, type ImageRequest, type ProviderFactory, type Registry } from '@headcount/models';
import { matchRoute, type FaceLandmarks, type ProviderId } from '@headcount/protocol';
import { fullIndex } from '@headcount/catalog/full';
import { describe, expect, it } from 'vitest';
import { FakeD1, FakeR2, applyMigrations } from '../../test/fake-cloud';
import type { Env } from '../env';
import { HANDLERS, handle, toErrorResponse } from '../index';
import type { RouteContext } from '../lib/http';
import { WARPABLE_PREFIX } from './image';
import { claimJob, getRow } from './portrait-store';

// ── harness: env over fake D1/R2, drainable waitUntil, registry with a fake image provider ─────────────────
async function mediaEnv(vars: Record<string, string> = {}) {
  const d1 = new FakeD1();
  await applyMigrations(d1);
  const r2 = new FakeR2();
  const env = { WORKSPACE_ID: 'local', ENABLE_MOCK: 'true', DEFAULT_CHAT: 'mock', MOCK_DELAY_MS: '0', DB: d1, BLOBS: r2, ...vars } as unknown as Env;
  const waiting: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void waiting.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const drain = async () => {
    while (waiting.length) await Promise.all(waiting.splice(0));
  };
  return { env, ctx, d1, r2, drain };
}
type T = Awaited<ReturnType<typeof mediaEnv>>;

async function invoke(t: T, registry: Registry, method: string, path: string, init: RequestInit = {}) {
  const url = new URL(`http://localhost${path}`);
  const found = matchRoute(method, url.pathname);
  if (!found || !('match' in found)) throw new Error(`no route ${method} ${path}`);
  const { id, params } = found.match;
  const rc: RouteContext = { env: t.env, identity: { email: '', name: '', role: 'owner', actualRole: 'owner' }, ctx: t.ctx, route: id, params, url, registry: () => registry };
  try {
    return await HANDLERS[id](new Request(url, { method, ...init }), rc);
  } catch (err) {
    return toErrorResponse(err, id);
  }
}

const body = async (res: Response) => (await res.json()) as Record<string, any>;

const png = (seed = 1) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, seed + 1, seed + 2, 0, 0, 0, 13]);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);

interface FakeImage {
  calls: ImageRequest[];
  /** What the next generate returns (bytes) or throws; defaults to a PNG. */
  next: Array<() => Uint8Array | Error>;
  /** When set, generate waits for it (to observe the in-flight state). */
  gate?: Promise<void>;
}

function fakeImageFactory(id: 'openai' | 'xai', fake: FakeImage): ProviderFactory {
  const image: ImageProvider = {
    id,
    kind: 'cloud',
    family: id === 'openai' ? 'gpt' : 'grok',
    async generate(req) {
      fake.calls.push(req);
      if (fake.gate) await fake.gate;
      const out = (fake.next.shift() ?? (() => png(fake.calls.length)))();
      if (out instanceof Error) throw out;
      return { image: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer, mime: 'image/png', provider: id, model: `${id}-image-test` };
    },
  };
  return () => ({ image });
}

async function withImage(vars: Record<string, string> = {}, provider: 'openai' | 'xai' = 'xai') {
  const keys: Record<string, string> = provider === 'xai' ? { XAI_API_KEY: 'test-xai' } : { OPENAI_API_KEY: 'test-openai' };
  const t = await mediaEnv({ ...keys, ...vars });
  const fake: FakeImage = { calls: [], next: [] };
  const reg = createRegistry(t.env, { providers: { [provider]: fakeImageFactory(provider, fake) } as Partial<Record<ProviderId, ProviderFactory>>, fetch: async () => new Response('offline', { status: 503 }) });
  return { t, fake, reg };
}

const lead = fullIndex.catalog.leads[0]!;
const persona = fullIndex.catalog.personas[0]!;

function landmarks(shift = 0): FaceLandmarks {
  const p = (x: number, y: number) => ({ x: x + shift, y });
  const contour = (y: number) => [p(0.4, y), p(0.5, y + 0.01), p(0.6, y)];
  return {
    face: { x: 0.2, y: 0.1, width: 0.6, height: 0.7, centerX: 0.5, centerY: 0.45 },
    leftEye: p(0.4, 0.4),
    rightEye: p(0.6, 0.4),
    mouth: p(0.5, 0.65),
    eyeSpan: 0.2,
    leftEyeWidth: 0.05,
    rightEyeWidth: 0.05,
    mouthWidth: 0.12,
    mouthHeight: 0.02,
    lipUpperOuter: contour(0.63),
    lipUpperInner: contour(0.64),
    lipLowerOuter: contour(0.67),
    lipLowerInner: contour(0.66),
    jawContour: contour(0.8),
  };
}
const putJson = (value: unknown): RequestInit => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

describe('portraits keyless', () => {
  it('GET answers 404 (procedural fallback) and generate answers 503 naming the image keys', async () => {
    const t = await mediaEnv();
    const get = await handle(new Request(`http://localhost/api/portraits/${lead.id}`), t.env, t.ctx);
    expect(get.status).toBe(404);
    expect(get.headers.get('x-portrait-status')).toBe('none');
    const gen = await handle(new Request(`http://localhost/api/portraits/${lead.id}/generate`, { method: 'POST' }), t.env, t.ctx);
    const b = await body(gen);
    expect(gen.status).toBe(503);
    expect(b.error.code).toBe('not_configured');
    expect(b.error.missingKeys).toEqual(expect.arrayContaining(['OPENAI_API_KEY', 'XAI_API_KEY']));
    expect(await t.d1.prepare('SELECT COUNT(*) AS n FROM media_usage').first('n')).toBe(0);
  });

  it('rejects unknown and malformed ids', async () => {
    const { t, reg } = await withImage();
    expect((await invoke(t, reg, 'POST', '/api/portraits/nobody-here/generate')).status).toBe(404);
    expect((await invoke(t, reg, 'POST', '/api/portraits/..%2Fsecret/generate')).status).toBe(400);
    expect((await invoke(t, reg, 'GET', '/api/portraits/UPPER')).status).toBe(400);
  });
});

describe('POST /api/portraits/:personaId/generate', () => {
  it('generates a 3:4 warpable portrait, stores it in R2 with metadata and serves it with caching headers', async () => {
    const { t, fake, reg } = await withImage();
    const res = await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?wait=1`);
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ personaId: lead.id, status: 'exists', provider: 'xai', created: true, remainingToday: 199 });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.aspect).toBe('3:4');
    expect(fake.calls[0]!.prompt.startsWith(WARPABLE_PREFIX)).toBe(true);
    expect(fake.calls[0]!.prompt).toContain(lead.avatar.portrait_prompt.slice(WARPABLE_PREFIX.length, WARPABLE_PREFIX.length + 40).trim());

    const stored = t.r2.objects.get(`portraits/${lead.id}.png`)!;
    expect(stored.httpMetadata.contentType).toBe('image/png');
    expect(stored.customMetadata).toMatchObject({ personaId: lead.id, subjectKind: 'lead', provider: 'xai', model: 'xai-image-test' });
    expect(stored.customMetadata.promptHash).toMatch(/^[0-9a-f]{16}$/);

    const get = await invoke(t, reg, 'GET', `/api/portraits/${lead.id}`);
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
    expect(get.headers.get('cache-control')).toBe('private, no-cache');
    expect(get.headers.get('x-portrait-version')).toBe(stored.customMetadata.version);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(png(1));
    const etag = get.headers.get('etag')!;
    const cached = await invoke(t, reg, 'GET', `/api/portraits/${lead.id}`, { headers: { 'if-none-match': etag } });
    expect(cached.status).toBe(304);
  });

  it('caches a versioned URL for good, and a force regeneration bumps the version, clears landmarks and relists', async () => {
    const { t, reg } = await withImage();
    await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?wait=1`);
    const v1 = (await body(await invoke(t, reg, 'GET', '/api/portraits'))).portraits[0].version as string;
    expect((await invoke(t, reg, 'GET', `/api/portraits/${lead.id}?v=${v1}`)).headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect((await invoke(t, reg, 'GET', `/api/portraits/${lead.id}?v=old`)).headers.get('cache-control')).toBe('private, no-cache');
    const put = await invoke(t, reg, 'PUT', `/api/portraits/${lead.id}/landmarks`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ landmarks: landmarks(), portraitVersion: v1 }),
    });
    expect(put.status).toBe(200);
    expect((await body(await invoke(t, reg, 'GET', '/api/portraits'))).portraits[0]).toEqual({ personaId: lead.id, version: v1, hasLandmarks: true });

    expect((await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?force=1&wait=1`)).status).toBe(200);
    const [after] = (await body(await invoke(t, reg, 'GET', '/api/portraits'))).portraits;
    expect(after.version).not.toBe(v1);
    expect(after.hasLandmarks).toBe(false);
    expect((await getRow(t.env.DB, lead.id))!.landmarks).toBeNull();
    // The old versioned URL is no longer pinned; the new one is.
    expect((await invoke(t, reg, 'GET', `/api/portraits/${lead.id}?v=${v1}`)).headers.get('cache-control')).toBe('private, no-cache');
    expect((await invoke(t, reg, 'GET', `/api/portraits/${lead.id}?v=${after.version}`)).headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  });

  it('never pins bytes a regeneration wrote before D1 moved to their version (the R2 key is not versioned)', async () => {
    const { t, reg } = await withImage();
    await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?wait=1`);
    const v1 = (await getRow(t.env.DB, lead.id))!.version!;
    // A forced regeneration has put the new image in place but not yet completed (or its completion failed).
    const obj = t.r2.objects.get(`portraits/${lead.id}.png`)!;
    obj.customMetadata = { ...obj.customMetadata, version: 'v2-in-flight' };
    const res = await invoke(t, reg, 'GET', `/api/portraits/${lead.id}?v=${v1}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('etag')).toBe('"v2-in-flight"');
  });

  it('is idempotent: returns the existing portrait unless ?force=1', async () => {
    const { t, fake, reg } = await withImage();
    await invoke(t, reg, 'POST', `/api/portraits/${persona.id}/generate?wait=1`);
    const again = await invoke(t, reg, 'POST', `/api/portraits/${persona.id}/generate`);
    expect(again.status).toBe(202);
    expect(await body(again)).toEqual({ personaId: persona.id, status: 'exists', provider: 'xai' });
    expect(fake.calls).toHaveLength(1);

    const v1 = (await getRow(t.env.DB, persona.id))!.version;
    fake.next.push(() => jpeg());
    const forced = await invoke(t, reg, 'POST', `/api/portraits/${persona.id}/generate?force=1&wait=1`);
    expect(forced.status).toBe(200);
    expect(fake.calls).toHaveLength(2);
    const row = (await getRow(t.env.DB, persona.id))!;
    expect(row.version).not.toBe(v1);
    expect(row.r2_key).toBe(`portraits/${persona.id}.jpg`);
    expect(t.r2.objects.has(`portraits/${persona.id}.png`)).toBe(false); // old extension removed
    expect((await invoke(t, reg, 'GET', `/api/portraits/${persona.id}`)).headers.get('content-type')).toBe('image/jpeg');
  });

  it('runs in the background by default: 202 generating, GET 404 while painting, then the image', async () => {
    const { t, fake, reg } = await withImage({}, 'openai');
    let open!: () => void;
    fake.gate = new Promise<void>((r) => (open = r));
    const res = await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate`);
    expect(res.status).toBe(202);
    expect(await body(res)).toMatchObject({ status: 'generating', provider: 'openai' });

    const during = await invoke(t, reg, 'GET', `/api/portraits/${lead.id}`);
    expect(during.status).toBe(404);
    expect(during.headers.get('x-portrait-status')).toBe('generating');
    const second = await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate`);
    expect(await body(second)).toMatchObject({ status: 'generating' });

    open();
    await t.drain();
    expect(fake.calls).toHaveLength(1); // the second request did not start another job
    expect((await invoke(t, reg, 'GET', `/api/portraits/${lead.id}`)).status).toBe(200);
  });

  it('takes over a stale generation lock', async () => {
    const { t, fake, reg } = await withImage();
    expect(await claimJob(t.env.DB, lead.id, 'lead', 'pjob_old', Date.now() - 10 * 60_000)).toBe(true);
    const res = await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?wait=1`);
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(1);
  });

  it('refuses images that are not PNG/JPEG/WebP (or over 5 MB) and records the failure', async () => {
    const { t, fake, reg } = await withImage();
    fake.next.push(() => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    const res = await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?wait=1`);
    expect(res.status).toBe(502);
    expect((await body(res)).error.message).toMatch(/not a PNG, JPEG or WebP/);
    expect(t.r2.objects.size).toBe(0);
    const get = await invoke(t, reg, 'GET', `/api/portraits/${lead.id}`);
    expect(get.status).toBe(404);
    expect(get.headers.get('x-portrait-status')).toBe('failed');

    const big = new Uint8Array(5_000_001);
    big.set(png());
    fake.next.push(() => big);
    expect((await body(await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?wait=1`))).error.message).toMatch(/over 5 MB/);
    // Unusable images were paid for: both stay counted.
    expect(await t.d1.prepare("SELECT count FROM media_usage WHERE kind = 'portrait'").first('count')).toBe(2);
  });

  it('gives the daily use back when the provider fails, and never leaks provider payloads', async () => {
    const { t, fake, reg } = await withImage();
    fake.next.push(() => new ProviderError('xai', 'upstream said: secret-ish body', 500, true));
    const res = await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?wait=1`);
    const b = await body(res);
    expect(res.status).toBe(502);
    expect(b.error.message).not.toContain('secret-ish');
    expect(await t.d1.prepare("SELECT count FROM media_usage WHERE kind = 'portrait'").first('count')).toBe(0);
    expect((await getRow(t.env.DB, lead.id))!.job_status).toBe('failed');
  });

  it('stops at the daily limit with 429 and releases the lock', async () => {
    const { t, fake, reg } = await withImage({ PORTRAIT_DAILY_LIMIT: '2' });
    expect((await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?wait=1`)).status).toBe(200);
    expect((await invoke(t, reg, 'POST', `/api/portraits/${persona.id}/generate?wait=1`)).status).toBe(200);
    const third = await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?force=1&wait=1`);
    expect(third.status).toBe(429);
    expect((await body(third)).error).toMatchObject({ code: 'rate_limited', message: expect.stringMatching(/PORTRAIT_DAILY_LIMIT/) });
    expect(fake.calls).toHaveLength(2);
    const row = (await getRow(t.env.DB, lead.id))!;
    expect(row.job_status).toBeNull();
    expect(row.r2_key).toBe(`portraits/${lead.id}.png`); // the existing portrait is untouched
    // Refused attempts use nothing up.
    await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?force=1&wait=1`);
    expect(await t.d1.prepare("SELECT count FROM media_usage WHERE kind = 'portrait'").first('count')).toBe(3);
  });

  it('adopts an R2 image that D1 lost instead of paying for it again', async () => {
    const { t, fake, reg } = await withImage();
    await t.r2.put(`portraits/${lead.id}.webp`, new Uint8Array([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBP')]), {
      httpMetadata: { contentType: 'image/webp' },
      customMetadata: { version: 'v-old', provider: 'openai', subjectKind: 'lead' },
    });
    const res = await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate`);
    expect(await body(res)).toMatchObject({ status: 'exists', provider: 'openai' });
    expect(fake.calls).toHaveLength(0);
    const get = await invoke(t, reg, 'GET', `/api/portraits/${lead.id}`);
    expect(get.headers.get('content-type')).toBe('image/webp');
    expect(get.headers.get('etag')).toBe('"v-old"');
  });

  it('regenerates when D1 points at an R2 object that is gone', async () => {
    const { t, fake, reg } = await withImage();
    await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?wait=1`);
    t.r2.objects.clear();
    expect((await invoke(t, reg, 'GET', `/api/portraits/${lead.id}`)).status).toBe(404);
    expect((await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?wait=1`)).status).toBe(200);
    expect(fake.calls).toHaveLength(2);
  });
});

describe('GET /api/portraits', () => {
  it('lists stored portraits once (with landmark status) and adopts R2 images D1 lost', async () => {
    const { t, reg } = await withImage();
    expect(await body(await invoke(t, reg, 'GET', '/api/portraits'))).toEqual({ portraits: [] });
    expect((await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?wait=1`)).status).toBe(200);
    await t.r2.put(`portraits/${persona.id}.png`, png(9), { httpMetadata: { contentType: 'image/png' }, customMetadata: { version: 'v-adopted' } });
    const listed = await body(await invoke(t, reg, 'GET', '/api/portraits'));
    expect(listed.portraits).toHaveLength(2);
    expect(listed.portraits).toEqual(
      expect.arrayContaining([
        { personaId: lead.id, version: expect.any(String), hasLandmarks: false },
        { personaId: persona.id, version: 'v-adopted', hasLandmarks: false },
      ]),
    );
    expect((await getRow(t.env.DB, persona.id))?.r2_key).toBe(`portraits/${persona.id}.png`);
  });
});

describe('portrait landmarks', () => {
  async function withPortrait() {
    const ctx = await withImage();
    await invoke(ctx.t, ctx.reg, 'POST', `/api/portraits/${lead.id}/generate?wait=1`);
    return ctx;
  }
  const path = `/api/portraits/${lead.id}/landmarks`;

  it('validates geometry before anything else (400), and needs a portrait (404)', async () => {
    const { t, reg } = await withImage();
    expect((await invoke(t, reg, 'PUT', path, putJson({ landmarks: { face: {} } }))).status).toBe(400);
    expect((await invoke(t, reg, 'PUT', path, putJson({ landmarks: { ...landmarks(), mouthWidth: 2 } }))).status).toBe(400);
    const lips = landmarks() as Partial<FaceLandmarks>;
    delete lips.jawContour;
    expect((await body(await invoke(t, reg, 'PUT', path, putJson({ landmarks: lips })))).error.message).toMatch(/Incomplete face contours/);
    expect((await invoke(t, reg, 'PUT', path, putJson({}))).status).toBe(400);
    expect((await invoke(t, reg, 'PUT', path, putJson({ landmarks: landmarks() }))).status).toBe(404);
    expect(await body(await invoke(t, reg, 'GET', path))).toEqual({ personaId: lead.id, landmarks: null });
  });

  it('first valid write wins; identical re-sends are fine; later writes get 409 unless force', async () => {
    const { t, reg } = await withPortrait();
    const first = await invoke(t, reg, 'PUT', path, putJson({ landmarks: { ...landmarks(), extra: 'dropped', nose: { x: 0.5, y: 0.5, z: 9 } } }));
    expect(first.status).toBe(200);
    const saved = (await body(first)).landmarks;
    expect(saved.extra).toBeUndefined();
    expect(saved.nose).toEqual({ x: 0.5, y: 0.5 });

    expect((await invoke(t, reg, 'PUT', path, putJson({ landmarks: { ...landmarks(), extra: 'dropped', nose: { x: 0.5, y: 0.5 } } }))).status).toBe(200);
    const second = await invoke(t, reg, 'PUT', path, putJson({ landmarks: landmarks(0.01) }));
    expect(second.status).toBe(409);
    expect((await body(second)).error.code).toBe('conflict');
    expect((await body(await invoke(t, reg, 'GET', path))).landmarks.leftEye).toEqual({ x: 0.4, y: 0.4 });

    const forced = await invoke(t, reg, 'PUT', path, putJson({ landmarks: landmarks(0.01), force: true }));
    expect(forced.status).toBe(200);
    expect((await body(await invoke(t, reg, 'GET', path))).landmarks.leftEye.x).toBeCloseTo(0.41);
  });

  it('binds landmarks to the portrait version and clears them when the portrait is regenerated', async () => {
    const { t, reg } = await withPortrait();
    const get = await invoke(t, reg, 'GET', `/api/portraits/${lead.id}`);
    const version = get.headers.get('x-portrait-version')!;
    expect((await invoke(t, reg, 'PUT', path, putJson({ landmarks: landmarks(), portraitVersion: 'not-this-one' }))).status).toBe(409);
    expect((await invoke(t, reg, 'PUT', path, putJson({ landmarks: landmarks(), portraitVersion: version }))).status).toBe(200);

    await invoke(t, reg, 'POST', `/api/portraits/${lead.id}/generate?force=1&wait=1`);
    const after = await invoke(t, reg, 'GET', path);
    expect((await body(after)).landmarks).toBeNull();
    expect(after.headers.get('x-portrait-version')).not.toBe(version);
    expect((await invoke(t, reg, 'PUT', path, putJson({ landmarks: landmarks(0.02) }))).status).toBe(200);
  });

  it('keeps the first of two racing writers', async () => {
    const { t, reg } = await withPortrait();
    const [a, b] = await Promise.all([invoke(t, reg, 'PUT', path, putJson({ landmarks: landmarks() })), invoke(t, reg, 'PUT', path, putJson({ landmarks: landmarks(0.03) }))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});
