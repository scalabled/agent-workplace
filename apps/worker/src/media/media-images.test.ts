import { ProviderError, createRegistry, type ImageProvider, type ImageRequest, type ProviderFactory } from '@headcount/models';
import type { ProviderId } from '@headcount/protocol';
import { fullIndex } from '@headcount/catalog/full';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeD1, FakeR2, applyMigrations } from '../../test/fake-cloud';
import type { Env } from '../env';
import { handle } from '../index';
import { MEDIA_BODY_CAP, MEDIA_PROMPT_MAX_CHARS, defaultMediaRuntime, mediaRuntime, parseMediaImageRequest } from './media-images';

// ── harness: the real router over fake D1/R2, with the media registry swapped for fake image providers ───────
const png = (seed = 1) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, seed + 1, seed + 2, 0, 0, 0, 13]);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
const svg = () => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

interface Fake {
  calls: Array<ImageRequest & { provider: ProviderId }>;
  next: Array<() => Uint8Array | Error>;
}

function fakeImageFactory(id: 'openai' | 'xai', fake: Fake): ProviderFactory {
  const image: ImageProvider = {
    id,
    kind: 'cloud',
    family: id === 'openai' ? 'gpt' : 'grok',
    async generate(req) {
      fake.calls.push({ ...req, provider: id });
      const out = (fake.next.shift() ?? (() => png(fake.calls.length)))();
      if (out instanceof Error) throw out;
      return { image: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer, mime: 'image/png', provider: id, model: `${id}-image-test`, revisedPrompt: 'revised' };
    },
  };
  return () => ({ image });
}

async function setup(keys: Array<'openai' | 'xai'> = ['xai'], vars: Record<string, string> = {}) {
  const d1 = new FakeD1();
  await applyMigrations(d1);
  const r2 = new FakeR2();
  const env = {
    WORKSPACE_ID: 'local',
    ENABLE_MOCK: 'true',
    DEFAULT_CHAT: 'mock',
    MOCK_DELAY_MS: '0',
    DB: d1,
    BLOBS: r2,
    ...(keys.includes('openai') ? { OPENAI_API_KEY: 'test-openai' } : {}),
    ...(keys.includes('xai') ? { XAI_API_KEY: 'test-xai' } : {}),
    ...vars,
  } as unknown as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const fake: Fake = { calls: [], next: [] };
  const providers = { openai: fakeImageFactory('openai', fake), xai: fakeImageFactory('xai', fake) } as Partial<Record<ProviderId, ProviderFactory>>;
  mediaRuntime.registry = (e) => createRegistry(e, { providers, fetch: async () => new Response('offline', { status: 503 }) });
  const call = async (method: string, path: string, init: RequestInit = {}) => handle(new Request(`http://localhost${path}`, { method, ...init }), env, ctx);
  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    call('POST', '/api/media/image', { headers: { 'content-type': 'application/json', ...headers }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  return { env, d1, r2, fake, call, post };
}

const body = async (res: Response) => (await res.json()) as Record<string, any>;
const HERO = { prompt: 'A luminous studio office at night, no text.', aspect: '16:9', key: 'hero' };

afterEach(() => {
  Object.assign(mediaRuntime, defaultMediaRuntime);
});

describe('parseMediaImageRequest', () => {
  it('accepts a prompt, an aspect, a key and an optional provider; collapses whitespace', () => {
    expect(parseMediaImageRequest({ prompt: '  a  b\n c ', aspect: '4:3', key: 'voice-2' })).toEqual({ prompt: 'a b c', aspect: '4:3', key: 'voice-2' });
    expect(parseMediaImageRequest({ ...HERO, provider: 'openai' })).toMatchObject({ provider: 'openai' });
  });

  it('refuses a missing or malformed key, prompt, aspect or provider with a sentence naming the fix', () => {
    expect(() => parseMediaImageRequest({ prompt: 'x', aspect: '1:1' })).toThrow(/Include a key/);
    expect(() => parseMediaImageRequest({ ...HERO, key: 'Hero' })).toThrow(/lowercase letters/);
    expect(() => parseMediaImageRequest({ ...HERO, key: '../etc' })).toThrow(/lowercase letters/);
    expect(() => parseMediaImageRequest({ ...HERO, key: 'image' })).toThrow(/reserved/);
    expect(() => parseMediaImageRequest({ ...HERO, key: 'a'.repeat(65) })).toThrow(/lowercase letters/);
    expect(() => parseMediaImageRequest({ ...HERO, prompt: '   ' })).toThrow(/Include a prompt/);
    expect(() => parseMediaImageRequest({ ...HERO, prompt: 'x'.repeat(MEDIA_PROMPT_MAX_CHARS + 1) })).toThrow(/under 1500 characters/);
    expect(() => parseMediaImageRequest({ ...HERO, aspect: '21:9' })).toThrow(/Use aspect/);
    expect(() => parseMediaImageRequest({ ...HERO, provider: 'mock' })).toThrow(/"openai" or "xai"/);
    expect(() => parseMediaImageRequest([HERO])).toThrow(/Send \{prompt, aspect, key\}/);
  });
});

describe('POST /api/media/image', () => {
  it('generates through the registry, stores media/<key>.<ext> in R2 and answers a versioned url', async () => {
    const t = await setup(['xai']);
    const res = await t.post(HERO);
    expect(res.status).toBe(200);
    const out = await body(res);
    expect(out).toMatchObject({ key: 'hero', mime: 'image/png', aspect: '16:9', provider: 'xai', model: 'xai-image-test', revisedPrompt: 'revised', bytes: png().byteLength });
    expect(out.url).toBe(`/api/media/hero?v=${encodeURIComponent(out.version)}`);
    expect(t.fake.calls).toHaveLength(1);
    expect(t.fake.calls[0]).toMatchObject({ prompt: HERO.prompt, aspect: '16:9', provider: 'xai' });
    const stored = t.r2.objects.get('media/hero.png')!;
    expect(stored.httpMetadata.contentType).toBe('image/png');
    expect(stored.customMetadata).toMatchObject({ key: 'hero', aspect: '16:9', provider: 'xai', version: out.version });
    expect(stored.customMetadata.promptHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('uses the requested provider, and refuses one that has no key instead of silently switching', async () => {
    const both = await setup(['openai', 'xai']);
    expect((await both.post({ ...HERO, provider: 'openai' })).status).toBe(200);
    expect(both.fake.calls.at(-1)!.provider).toBe('openai');
    expect((await both.post({ ...HERO, provider: 'xai' })).status).toBe(200);
    expect(both.fake.calls.at(-1)!.provider).toBe('xai');

    const xaiOnly = await setup(['xai']);
    const res = await xaiOnly.post({ ...HERO, provider: 'openai' });
    expect(res.status).toBe(503);
    expect((await body(res)).error).toMatchObject({ code: 'not_configured', missingKeys: ['OPENAI_API_KEY'], message: expect.stringMatching(/OPENAI_API_KEY/) });
    expect(xaiOnly.fake.calls).toHaveLength(0);
  });

  it('keyless: 503 naming the image keys (Mock placeholders are never stored), nothing counted', async () => {
    const t = await setup([]);
    const res = await t.post(HERO);
    expect(res.status).toBe(503);
    const err = (await body(res)).error;
    expect(err.code).toBe('not_configured');
    expect(err.missingKeys).toEqual(expect.arrayContaining(['OPENAI_API_KEY', 'XAI_API_KEY']));
    expect(t.r2.objects.size).toBe(0);
    expect(await t.d1.prepare('SELECT count(*) AS n FROM media_usage').first('n')).toBe(0);
  });

  it('validates the request: key required, JSON only, body and prompt capped', async () => {
    const t = await setup(['xai']);
    const noKey = await t.post({ prompt: 'x', aspect: '1:1' });
    expect(noKey.status).toBe(400);
    expect((await body(noKey)).error.message).toMatch(/Include a key/);
    expect((await t.post(HERO, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await t.post('{not json')).status).toBe(400);
    expect((await t.post({ ...HERO, prompt: 'x'.repeat(MEDIA_PROMPT_MAX_CHARS + 1) })).status).toBe(413);
    expect((await t.post({ ...HERO, pad: 'x'.repeat(MEDIA_BODY_CAP) })).status).toBe(413);
    // A streamed body without Content-Length is counted too.
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(`{"key":"hero","pad":"${'x'.repeat(MEDIA_BODY_CAP)}"}`));
        c.close();
      },
    });
    const streamed = await t.call('POST', '/api/media/image', { headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(t.fake.calls).toHaveLength(0);
  });

  it('shares the daily image budget with portraits (PORTRAIT_DAILY_LIMIT)', async () => {
    const lead = fullIndex.catalog.leads[0]!;
    const t = await setup(['xai'], { PORTRAIT_DAILY_LIMIT: '2' });
    const { HANDLERS } = await import('../index');
    expect((await t.post(HERO)).status).toBe(200);
    // A portrait uses the same counter …
    const url = new URL(`http://localhost/api/portraits/${lead.id}/generate?wait=1`);
    const portrait = await HANDLERS.generatePortrait(new Request(url, { method: 'POST' }), {
      env: t.env,
      identity: { email: '', name: '', role: 'owner', actualRole: 'owner', orgId: 'local', platform: true },
      ctx: { waitUntil() {} } as unknown as ExecutionContext,
      route: 'generatePortrait',
      params: { personaId: lead.id },
      url,
      registry: () => mediaRuntime.registry(t.env),
    });
    expect(portrait.status).toBe(200);
    // … so the third image of the day is refused, naming the variable.
    const third = await t.post({ ...HERO, key: 'floor' });
    expect(third.status).toBe(429);
    expect((await body(third)).error).toMatchObject({ code: 'rate_limited', message: expect.stringMatching(/PORTRAIT_DAILY_LIMIT/) });
    expect(t.fake.calls).toHaveLength(2);
    expect(t.r2.objects.has('media/floor.png')).toBe(false);
  });

  it('gives the use back when the provider fails, and never leaks provider payloads', async () => {
    const t = await setup(['xai'], { PORTRAIT_DAILY_LIMIT: '5' });
    t.fake.next.push(() => new ProviderError('xai', 'upstream said: secret-ish payload', 500, true, 'upstream'));
    const res = await t.post(HERO);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('secret-ish');
    expect(JSON.parse(text).error.message).toMatch(/xai image provider failed \(500\)/);
    expect(await t.d1.prepare("SELECT count FROM media_usage WHERE kind = 'portrait'").first('count')).toBe(0);
    expect(t.r2.objects.size).toBe(0);
  });

  it('refuses bytes that are not PNG/JPEG/WebP and stores nothing (the paid call stays counted)', async () => {
    const t = await setup(['xai']);
    t.fake.next.push(svg);
    const res = await t.post(HERO);
    expect(res.status).toBe(502);
    expect((await body(res)).error.message).toMatch(/not a PNG, JPEG or WebP/);
    expect(t.r2.objects.size).toBe(0);
    expect(await t.d1.prepare("SELECT count FROM media_usage WHERE kind = 'portrait'").first('count')).toBe(1);
  });

  it('keeps one image per key: a JPEG replaces an earlier PNG', async () => {
    const t = await setup(['xai']);
    await t.post(HERO);
    t.fake.next.push(jpeg);
    const second = await body(await t.post(HERO));
    expect(second.mime).toBe('image/jpeg');
    expect([...t.r2.objects.keys()]).toEqual(['media/hero.jpg']);
    const got = await t.call('GET', second.url);
    expect(got.headers.get('content-type')).toBe('image/jpeg');
  });

  it('is behind the origin guard like every other route', async () => {
    const t = await setup(['xai']);
    expect((await t.post(HERO, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await t.call('GET', '/api/media/hero', { headers: { host: 'rebind.example' } })).status).toBe(403);
    expect((await t.post(HERO, { origin: 'http://localhost:5173' })).status).toBe(200);
    expect(t.fake.calls).toHaveLength(1);
  });
});

describe('GET /api/media/:key', () => {
  it('serves the stored image with an ETag, 304 on match, and immutable caching for the current ?v=', async () => {
    const t = await setup(['xai']);
    const out = await body(await t.post(HERO));
    const plain = await t.call('GET', '/api/media/hero');
    expect(plain.status).toBe(200);
    expect(plain.headers.get('content-type')).toBe('image/png');
    expect(plain.headers.get('etag')).toBe(`"${out.version}"`);
    expect(plain.headers.get('cache-control')).toBe('private, no-cache');
    expect(plain.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await plain.arrayBuffer())).toEqual(png(1));

    const pinned = await t.call('GET', out.url);
    expect(pinned.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const old = await t.call('GET', '/api/media/hero?v=not-current');
    expect(old.headers.get('cache-control')).toBe('private, no-cache');

    const revalidated = await t.call('GET', '/api/media/hero', { headers: { 'if-none-match': `"${out.version}"` } });
    expect(revalidated.status).toBe(304);
    const head = await t.call('HEAD', '/api/media/hero');
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(png().byteLength));
  });

  it('answers 404 for an unknown key, 400 for a malformed one and 405 for other methods', async () => {
    const t = await setup(['xai']);
    const missing = await t.call('GET', '/api/media/nothing-here');
    expect(missing.status).toBe(404);
    expect((await body(missing)).error.code).toBe('not_found');
    expect((await t.call('GET', '/api/media/Bad_Key')).status).toBe(400);
    expect((await t.call('GET', '/api/media/%zz')).status).toBe(400);
    expect((await t.call('GET', '/api/media/image')).status).toBe(405);
    const del = await t.call('DELETE', '/api/media/hero');
    expect(del.status).toBe(405);
    expect(del.headers.get('allow')).toBe('GET, HEAD');
    expect((await t.call('GET', '/api/media/a/b')).status).toBe(404);
    expect((await t.call('GET', '/api/mediax')).status).toBe(404);
  });
});
