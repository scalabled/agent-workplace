import { ProviderError, createRegistry, type ProviderFactory, type Registry, type SpeechProvider, type SttRequest, type TtsRequest } from '@headcount/models';
import { matchRoute, type ProviderId, type TtsJsonResponse } from '@headcount/protocol';
import { fullIndex } from '@headcount/catalog/full';
import { describe, expect, it } from 'vitest';
import { FakeD1, FakeR2, applyMigrations } from '../../test/fake-cloud';
import type { Env } from '../env';
import { HANDLERS, handle, toErrorResponse } from '../index';
import type { RouteContext } from '../lib/http';

// ── harness: env over fake D1/R2 and a registry with injectable fake providers ─────────────────────────────
async function mediaEnv(vars: Record<string, string> = {}) {
  const d1 = new FakeD1();
  await applyMigrations(d1);
  const env = { WORKSPACE_ID: 'local', ENABLE_MOCK: 'true', DEFAULT_CHAT: 'mock', MOCK_DELAY_MS: '0', DB: d1, BLOBS: new FakeR2(), ...vars } as unknown as Env;
  const waiting: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void waiting.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  return { env, ctx };
}

async function invoke(t: { env: Env; ctx: ExecutionContext }, registry: Registry, method: string, path: string, init: RequestInit = {}) {
  const url = new URL(`http://localhost${path}`);
  const found = matchRoute(method, url.pathname);
  if (!found || !('match' in found)) throw new Error(`no route ${method} ${path}`);
  const { id, params } = found.match;
  const rc: RouteContext = { env: t.env, identity: { email: '', name: '', role: 'owner', actualRole: 'owner', orgId: 'local', platform: true }, ctx: t.ctx, route: id, params, url, registry: () => registry };
  try {
    return await HANDLERS[id](new Request(url, { method, ...init }), rc);
  } catch (err) {
    return toErrorResponse(err, id);
  }
}

const postJson = (body: unknown): RequestInit => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

interface Call {
  provider: ProviderId;
  tts?: TtsRequest;
  stt?: SttRequest;
}

/** A cloud speech provider that records calls; `fail` throws on every call. */
function fakeSpeech(id: 'openai' | 'xai', calls: Call[], fail?: () => Error): ProviderFactory {
  const speech: SpeechProvider = {
    id,
    kind: 'cloud',
    family: id === 'openai' ? 'gpt' : 'grok',
    async tts(req) {
      calls.push({ provider: id, tts: req });
      if (fail) throw fail();
      const voice = (id === 'openai' ? req.voice.openai : req.voice.xai) ?? 'default';
      return { audio: new Uint8Array([0x49, 0x44, 0x33, 4]).buffer, mime: 'audio/mpeg', provider: id, voice, alignment: req.withAlignment ? { chars: ['h', 'i'], startsMs: [0, 50], endsMs: [50, 100] } : null };
    },
    async stt(req) {
      calls.push({ provider: id, stt: req });
      if (fail) throw fail();
      return { text: `  heard ${req.audio.byteLength} bytes  `, provider: id, language: 'en' };
    },
  };
  return () => ({ speech });
}

function cloudRegistry(env: Env, factories: Partial<Record<ProviderId, ProviderFactory>>) {
  return createRegistry(env, { providers: factories, fetch: async () => new Response('offline', { status: 503 }) });
}

const lead = fullIndex.catalog.leads[0]!;
const persona = fullIndex.catalog.personas[0]!;

describe('POST /api/speech/tts', () => {
  it('answers 503 naming the keys when TTS is not configured (Mock speech is opt-in)', async () => {
    const t = await mediaEnv();
    const res = await handle(new Request('http://localhost/api/speech/tts', { method: 'POST', ...postJson({ text: 'Hello there.', voiceRef: {}, speakerId: 'cw_chief' }) }), t.env, t.ctx);
    expect(res.status).toBe(503);
    const b = (await res.json()) as { error: { code: string; message: string; missingKeys: string[] } };
    expect(b.error.code).toBe('not_configured');
    expect(b.error.message).toMatch(/OPENAI_API_KEY or XAI_API_KEY/);
    expect(b.error.missingKeys).toEqual(expect.arrayContaining(['OPENAI_API_KEY', 'XAI_API_KEY']));
  });

  it('speaks with Mock (silent WAV) when MOCK_MEDIA=true, and names provider and voice', async () => {
    const t = await mediaEnv({ MOCK_MEDIA: 'true' });
    const res = await handle(new Request('http://localhost/api/speech/tts', { method: 'POST', ...postJson({ text: 'Hello there.', voiceRef: { openai: 'echo', xai: 'leo', speed: 0.97 }, speakerId: 'cw_chief' }) }), t.env, t.ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(res.headers.get('x-speech-provider')).toBe('mock');
    expect(res.headers.get('x-speech-voice')).toBe('echo');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
  });

  it('returns JSON with base64 audio and alignment on request', async () => {
    const t = await mediaEnv({ MOCK_MEDIA: 'true' });
    const res = await handle(new Request('http://localhost/api/speech/tts', { method: 'POST', ...postJson({ text: 'Hi', voiceRef: { xai: 'ara' }, speakerId: 'cw_chief', response: 'json' }) }), t.env, t.ctx);
    const body = (await res.json()) as TtsJsonResponse;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ mime: 'audio/wav', provider: 'mock', voice: 'ara' });
    expect(atob(body.audioBase64).slice(0, 4)).toBe('RIFF');
    expect(body.alignment?.chars).toEqual(['H', 'i']);
  });

  it('keeps a meeting line for replay: the same words in the same voice come back without a provider call (Inc 2)', async () => {
    const t = await mediaEnv({ OPENAI_API_KEY: 'test-openai', XAI_API_KEY: 'test-xai', TTS_DAILY_LIMIT: '1' });
    const calls: Call[] = [];
    const reg = cloudRegistry(t.env, { openai: fakeSpeech('openai', calls), xai: fakeSpeech('xai', calls) });
    const line = { text: 'Instagram first, then the press.', voiceRef: { openai: 'echo', xai: 'rex' }, speakerId: 'cw_ann', response: 'json', cache: true };
    const a = await invoke(t, reg, 'POST', '/api/speech/tts', postJson(line));
    expect(a.status).toBe(200);
    expect(a.headers.get('x-tts-cache')).toBe('miss');
    const first = (await a.json()) as TtsJsonResponse;
    await new Promise((r) => setTimeout(r, 0)); // the R2 write runs in waitUntil
    // The daily limit (1) is spent, yet the replay is served from storage.
    const b = await invoke(t, reg, 'POST', '/api/speech/tts', postJson(line));
    expect(b.status).toBe(200);
    expect(b.headers.get('x-tts-cache')).toBe('hit');
    expect(await b.json()).toEqual(first);
    expect(calls).toHaveLength(1);
    // Other words (or another voice) are a new line.
    const c = await invoke(t, reg, 'POST', '/api/speech/tts', postJson({ ...line, voiceRef: { openai: 'nova', xai: 'ara' } }));
    expect(c.status).toBe(429);
  });

  it('canned speech is kept once for every office: another office gets it free; nothing personal is shared', async () => {
    const a = await mediaEnv({ OPENAI_API_KEY: 'test-openai', XAI_API_KEY: 'test-xai' });
    const calls: Call[] = [];
    const regA = cloudRegistry(a.env, { openai: fakeSpeech('openai', calls), xai: fakeSpeech('xai', calls) });
    const line = { text: 'On it.', voiceRef: { openai: 'echo', xai: 'rex' }, speakerId: 'cw_chief', response: 'json' };
    const first = await invoke(a, regA, 'POST', '/api/speech/tts', postJson(line));
    expect(first.headers.get('x-tts-cache')).toBe('miss');
    const body = (await first.json()) as TtsJsonResponse;
    await new Promise((r) => setTimeout(r, 0)); // the R2 write runs in waitUntil
    const blobs = a.env.BLOBS as unknown as FakeR2;
    expect([...blobs.objects.keys()].filter((k) => k.startsWith('speech/canned/'))).toHaveLength(1);
    // Another organization, its daily budget already spent: served from the shared copy, no provider call.
    const b = { env: { ...a.env, WORKSPACE_ID: 'org_bbbbbbbbbbbb', TTS_DAILY_LIMIT: '0' } as Env, ctx: a.ctx };
    const regB = cloudRegistry(b.env, { openai: fakeSpeech('openai', calls), xai: fakeSpeech('xai', calls) });
    const again = await invoke(b, regB, 'POST', '/api/speech/tts', postJson({ ...line, speakerId: 'cw_chief' }));
    expect(again.status).toBe(200);
    expect(again.headers.get('x-tts-cache')).toBe('shared');
    expect(await again.json()).toEqual(body);
    expect(calls).toHaveLength(1);
    // Plain audio too.
    const audio = await invoke(a, regA, 'POST', '/api/speech/tts', postJson({ text: 'Thank you, everyone.', voiceRef: { openai: 'echo', xai: 'rex' }, speakerId: 'cw_chief' }));
    expect(audio.headers.get('content-type')).toBe('audio/mpeg');
    await new Promise((r) => setTimeout(r, 0));
    const audioAgain = await invoke(b, regB, 'POST', '/api/speech/tts', postJson({ text: 'Thank you, everyone.', voiceRef: { openai: 'echo', xai: 'rex' }, speakerId: 'cw_chief' }));
    expect(audioAgain.headers.get('x-tts-cache')).toBe('shared');
    expect(audioAgain.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await audioAgain.arrayBuffer())).toEqual(new Uint8Array([0x49, 0x44, 0x33, 4]));
    // Anything else (a name, a number, the owner's words) is never kept in the shared space.
    await invoke(a, regA, 'POST', '/api/speech/tts', postJson({ ...line, text: 'Call Jo Smith at 555 0100 about the invoice.' }));
    await new Promise((r) => setTimeout(r, 0));
    expect([...blobs.objects.keys()].filter((k) => k.startsWith('speech/canned/'))).toHaveLength(2);
  });

  it('prefers xAI when both providers are configured and the voice has both ids (catalog lead voice)', async () => {
    const t = await mediaEnv({ OPENAI_API_KEY: 'test-openai', XAI_API_KEY: 'test-xai' });
    const calls: Call[] = [];
    const reg = cloudRegistry(t.env, { openai: fakeSpeech('openai', calls), xai: fakeSpeech('xai', calls) });
    const voiceRef = { openai: lead.voice.openai_tts, xai: lead.voice.xai_tts, speed: lead.voice.speed, instructions: lead.voice.tts_instructions };
    const res = await invoke(t, reg, 'POST', '/api/speech/tts', postJson({ text: 'Morning.', voiceRef, speakerId: 'cw_chief', format: 'mp3' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('x-speech-provider')).toBe('xai');
    expect(res.headers.get('x-speech-voice')).toBe(lead.voice.xai_tts);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tts).toMatchObject({ text: 'Morning.', format: 'mp3', voice: { openai: lead.voice.openai_tts, xai: lead.voice.xai_tts } });
  });

  it('routes to the provider the voice has an id for, and honours an explicit provider', async () => {
    const t = await mediaEnv({ OPENAI_API_KEY: 'test-openai', XAI_API_KEY: 'test-xai' });
    const calls: Call[] = [];
    const reg = cloudRegistry(t.env, { openai: fakeSpeech('openai', calls), xai: fakeSpeech('xai', calls) });
    const a = await invoke(t, reg, 'POST', '/api/speech/tts', postJson({ text: 'One.', voiceRef: { openai: 'sage' }, speakerId: 'cw_x' }));
    expect(a.headers.get('x-speech-provider')).toBe('openai');
    const b = await invoke(t, reg, 'POST', '/api/speech/tts', postJson({ text: 'Two.', voiceRef: { provider: 'openai', voice: 'coral', speed: 3 }, speakerId: 'cw_x' }));
    expect(b.headers.get('x-speech-provider')).toBe('openai');
    expect(b.headers.get('x-speech-voice')).toBe('coral');
    expect(calls[1]!.tts!.voice.speed).toBe(1.15); // clamped
  });

  it('uses the speaker’s catalog voice when the request has no voice ids', async () => {
    const t = await mediaEnv({ OPENAI_API_KEY: 'test-openai' });
    const calls: Call[] = [];
    const reg = cloudRegistry(t.env, { openai: fakeSpeech('openai', calls) });
    const res = await invoke(t, reg, 'POST', '/api/speech/tts', postJson({ text: 'Hello.', voiceRef: {}, speakerId: `cw_${persona.id}` }));
    expect(res.status).toBe(200);
    expect(calls[0]!.tts!.voice).toMatchObject({ openai: persona.voice.openai.voice, xai: persona.voice.xai.voice, speed: persona.voice.speed });
  });

  it('fails over to the other real provider when one fails, never to Mock', async () => {
    const t = await mediaEnv({ OPENAI_API_KEY: 'test-openai', XAI_API_KEY: 'test-xai' });
    const calls: Call[] = [];
    const reg = cloudRegistry(t.env, { openai: fakeSpeech('openai', calls), xai: fakeSpeech('xai', calls, () => new ProviderError('xai', 'unknown voice', 400, false)) });
    const res = await invoke(t, reg, 'POST', '/api/speech/tts', postJson({ text: 'Hi.', voiceRef: { openai: 'sage', xai: 'nope' }, speakerId: 'cw_x' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-speech-provider')).toBe('openai');
    expect(calls.map((c) => c.provider)).toEqual(['xai', 'openai']);

    const only = await mediaEnv({ XAI_API_KEY: 'test-xai' });
    const failing = cloudRegistry(only.env, { xai: fakeSpeech('xai', [], () => new ProviderError('xai', 'down', 503, true)) });
    const res2 = await invoke(only, failing, 'POST', '/api/speech/tts', postJson({ text: 'Hi.', voiceRef: { xai: 'ara' }, speakerId: 'cw_x' }));
    expect(res2.status).toBe(502);
    expect(((await res2.json()) as { error: { code: string } }).error.code).toBe('provider_error');
  });

  it('answers 503 naming the keys when no provider (not even Mock) can speak', async () => {
    const t = await mediaEnv({ ENABLE_MOCK: 'false' });
    const res = await handle(new Request('http://localhost/api/speech/tts', { method: 'POST', ...postJson({ text: 'Hi', voiceRef: {}, speakerId: 'cw_chief' }) }), t.env, t.ctx);
    const body = (await res.json()) as { error: { code: string; message: string; missingKeys: string[] } };
    expect(res.status).toBe(503);
    expect(body.error.code).toBe('not_configured');
    expect(body.error.missingKeys).toEqual(expect.arrayContaining(['OPENAI_API_KEY', 'XAI_API_KEY']));
    expect(body.error.message).toMatch(/OPENAI_API_KEY|XAI_API_KEY/);
  });

  it('validates the request', async () => {
    const t = await mediaEnv();
    const reg = cloudRegistry(t.env, {});
    const status = async (body: unknown) => (await invoke(t, reg, 'POST', '/api/speech/tts', postJson(body))).status;
    expect(await status({ text: '  ', voiceRef: {}, speakerId: 'cw_chief' })).toBe(400);
    expect(await status({ text: 'x'.repeat(4001), voiceRef: {}, speakerId: 'cw_chief' })).toBe(413);
    expect(await status({ text: 'hi', voiceRef: {} })).toBe(400);
    expect(await status({ text: 'hi', voiceRef: {}, speakerId: 'cw_chief', format: 'ogg' })).toBe(400);
    expect(await status({ text: 'hi', voiceRef: { openai: 'bad voice!' }, speakerId: 'cw_chief' })).toBe(400);
    expect(await status({ text: 'hi', voiceRef: { provider: 'acme', voice: 'x' }, speakerId: 'cw_chief' })).toBe(400);
    expect(await status({ text: 'hi', voiceRef: 'sage', speakerId: 'cw_chief' })).toBe(400);
    expect(await status([1, 2])).toBe(400);
  });
});

describe('POST /api/speech/stt', () => {
  const audio = (bytes = 2048, type = 'audio/webm;codecs=opus'): RequestInit => ({ headers: { 'content-type': type }, body: new Uint8Array(bytes) });

  it('answers 503 naming the keys keyless, and transcribes with Mock when MOCK_MEDIA=true', async () => {
    const keyless = await mediaEnv();
    const no = await handle(new Request('http://localhost/api/speech/stt', { method: 'POST', ...audio(1000) }), keyless.env, keyless.ctx);
    expect(no.status).toBe(503);
    expect(((await no.json()) as { error: { message: string } }).error.message).toMatch(/OPENAI_API_KEY or XAI_API_KEY/);
    const t = await mediaEnv({ MOCK_MEDIA: 'true' });
    const res = await handle(new Request('http://localhost/api/speech/stt', { method: 'POST', ...audio(1000) }), t.env, t.ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: 'This is a mock transcript of 1000 bytes of audio.', provider: 'mock' });
  });

  it('routes to OpenAI first, strips codec parameters and trims the text', async () => {
    const t = await mediaEnv({ OPENAI_API_KEY: 'test-openai', XAI_API_KEY: 'test-xai' });
    const calls: Call[] = [];
    const reg = cloudRegistry(t.env, { openai: fakeSpeech('openai', calls), xai: fakeSpeech('xai', calls) });
    const res = await invoke(t, reg, 'POST', '/api/speech/stt?language=en', audio(4096));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'heard 4096 bytes', provider: 'openai', language: 'en' });
    expect(calls[0]).toMatchObject({ provider: 'openai', stt: { mime: 'audio/webm', language: 'en' } });
  });

  it('falls back to xAI when OpenAI fails', async () => {
    const t = await mediaEnv({ OPENAI_API_KEY: 'test-openai', XAI_API_KEY: 'test-xai' });
    const calls: Call[] = [];
    const reg = cloudRegistry(t.env, { openai: fakeSpeech('openai', calls, () => new ProviderError('openai', 'bad file', 400)), xai: fakeSpeech('xai', calls) });
    const res = await invoke(t, reg, 'POST', '/api/speech/stt', audio(10, 'audio/wav'));
    expect(await res.json()).toMatchObject({ provider: 'xai' });
    expect(calls.map((c) => c.provider)).toEqual(['openai', 'xai']);
  });

  it('rejects non-audio, empty and over-10 MB recordings', async () => {
    const t = await mediaEnv();
    const reg = cloudRegistry(t.env, {});
    expect((await invoke(t, reg, 'POST', '/api/speech/stt', audio(10, 'text/plain'))).status).toBe(415);
    expect((await invoke(t, reg, 'POST', '/api/speech/stt', audio(0))).status).toBe(400);
    expect((await invoke(t, reg, 'POST', '/api/speech/stt', audio(10 * 1024 * 1024 + 1))).status).toBe(413);
    const declared = await invoke(t, reg, 'POST', '/api/speech/stt', { headers: { 'content-type': 'audio/wav', 'content-length': String(11 * 1024 * 1024) }, body: new Uint8Array(4) });
    expect(declared.status).toBe(413);
  });

  it('answers 503 naming the keys when STT is not configured', async () => {
    const t = await mediaEnv({ ENABLE_MOCK: 'false' });
    const res = await handle(new Request('http://localhost/api/speech/stt', { method: 'POST', ...audio(100) }), t.env, t.ctx);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { missingKeys: string[] } }).error.missingKeys).toEqual(expect.arrayContaining(['OPENAI_API_KEY', 'XAI_API_KEY']));
  });
});
