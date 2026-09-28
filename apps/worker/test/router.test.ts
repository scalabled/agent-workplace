import { ROUTE_IDS, STT_MAX_BYTES } from '@headcount/protocol';
import { describe, expect, it } from 'vitest';
import { HANDLERS, handle, toErrorResponse } from '../src/index';
import { HttpError } from '../src/lib/http';
import { createTestEnv, splitSql } from './fake-cloud';

async function call(method: string, path: string, init: RequestInit = {}) {
  const t = await createTestEnv();
  const res = await handle(new Request(`http://localhost${path}`, { method, ...init }), t.env, t.ctx);
  const body = (res.headers.get('content-type')?.includes('json') ? await res.json() : null) as Record<string, any> | null;
  return { res, body, t };
}

describe('router', () => {
  it('registers a handler for every protocol route', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual([...ROUTE_IDS].sort());
  });

  it('serves health', async () => {
    const { res, body } = await call('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, service: 'headcount-worker', workspaceId: 'local' });
  });

  it('reports capabilities without leaking keys', async () => {
    const t = await createTestEnv({ OPENAI_API_KEY: 'sk-secret-value' });
    const res = await handle(new Request('http://localhost/api/capabilities'), t.env, t.ctx);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain('sk-secret-value');
    expect(JSON.parse(text).modalities.chat.available).toBe(true);
  });

  it('round-trips workspace settings through the WorkspaceDO', async () => {
    const t = await createTestEnv();
    const put = await handle(new Request('http://localhost/api/workspace', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leadId: 'lead-warm-mentor', chiefName: '  Rosa ' }) }), t.env, t.ctx);
    expect(await put.json()).toMatchObject({ leadId: 'lead-warm-mentor', chiefName: 'Rosa', voiceOn: true });
    const get = await handle(new Request('http://localhost/api/workspace'), t.env, t.ctx);
    expect(await get.json()).toMatchObject({ leadId: 'lead-warm-mentor', chiefName: 'Rosa' });
  });

  it('returns typed errors: 404, 405, 413, 400', async () => {
    expect((await call('GET', '/api/nope')).res.status).toBe(404);
    const m = await call('DELETE', '/api/workspace');
    expect(m.res.status).toBe(405);
    expect(m.res.headers.get('allow')).toBe('GET, PUT');
    const big = await call('POST', '/api/talk', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(70_000), opId: 'o' }) });
    expect(big.res.status).toBe(413);
    const bad = await call('POST', '/api/talk', { headers: { 'content-type': 'application/json' }, body: '{' });
    expect(bad.body).toMatchObject({ error: { code: 'bad_request' } });
    const stt = await call('POST', '/api/speech/stt', { headers: { 'content-type': 'audio/webm', 'content-length': String(STT_MAX_BYTES + 1) }, body: new Uint8Array(8) });
    expect(stt.res.status).toBe(413);
  });

  it('keyless: TTS/STT answer 503 naming the keys and capabilities hide them', async () => {
    const tts = await call('POST', '/api/speech/tts', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi', voiceRef: {}, speakerId: 'cw_chief' }) });
    expect(tts.res.status).toBe(503);
    expect(tts.body?.error).toMatchObject({ code: 'not_configured', missingKeys: expect.arrayContaining(['OPENAI_API_KEY', 'XAI_API_KEY']) });
    const stt = await call('POST', '/api/speech/stt', { headers: { 'content-type': 'audio/webm' }, body: new Uint8Array(64) });
    expect(stt.res.status).toBe(503);
    const caps = await call('GET', '/api/capabilities');
    for (const m of ['tts', 'stt', 'image']) {
      expect(caps.body?.modalities[m].available).toBe(false);
      expect(caps.body?.modalities[m].missingKeys).toEqual(expect.arrayContaining(['OPENAI_API_KEY', 'XAI_API_KEY']));
    }
  });

  it('MOCK_MEDIA=true serves Mock speech and reports it available', async () => {
    const t = await createTestEnv({ MOCK_MEDIA: 'true' });
    const res = await handle(new Request('http://localhost/api/speech/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi', voiceRef: {}, speakerId: 'cw_chief' }) }), t.env, t.ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-speech-provider')).toBe('mock');
    const caps = (await (await handle(new Request('http://localhost/api/capabilities'), t.env, t.ctx)).json()) as Record<string, any>;
    expect(caps.modalities.tts.available).toBe(true);
    expect(caps.modalities.stt.available).toBe(true);
    expect(caps.modalities.image.available).toBe(false);
  });

  it('names the image keys when a portrait is requested keyless', async () => {
    const { res, body } = await call('POST', '/api/portraits/lead-warm-mentor/generate');
    expect(res.status).toBe(503);
    expect(body?.error.code).toBe('not_configured');
    expect(body?.error.missingKeys).toEqual(expect.arrayContaining(['OPENAI_API_KEY', 'XAI_API_KEY']));
  });

  it('lists jobs and portraits', async () => {
    const jobs = await call('GET', '/api/jobs');
    expect(jobs.res.status).toBe(200);
    expect(jobs.body).toEqual({ jobs: [] });
    expect((await call('GET', '/api/jobs/job_missing')).res.status).toBe(404);
    const portraits = await call('GET', '/api/portraits');
    expect(portraits.res.status).toBe(200);
    expect(portraits.body).toEqual({ portraits: [] });
  });

  it('maps rate_limited to 429', async () => {
    const res = toErrorResponse(new HttpError('rate_limited', 'Try tomorrow.'), 'generatePortrait');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: 'rate_limited', message: 'Try tomorrow.' } });
  });

  it('rejects invalid landmarks with 400', async () => {
    const { res, body } = await call('PUT', '/api/portraits/p1/landmarks', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ landmarks: { face: {} } }) });
    expect(res.status).toBe(400);
    expect(body?.error.code).toBe('bad_request');
  });
});

describe('only the app itself may call (CSRF, feed socket, DNS rebinding)', () => {
  const talkBody = JSON.stringify({ text: 'hi', opId: 'op_x' });
  const env = { ALLOWED_ORIGINS: 'http://localhost:5183,http://127.0.0.1:5183' };

  it('refuses a foreign Origin on commands and on the feed', async () => {
    const t = await createTestEnv(env);
    const talk = await handle(new Request('http://localhost/api/talk', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: talkBody }), t.env, t.ctx);
    expect(talk.status).toBe(403);
    expect(await talk.json()).toMatchObject({ error: { code: 'forbidden' } });
    const ws = await handle(new Request('http://localhost/api/ws?since=0', { headers: { upgrade: 'websocket', origin: 'https://evil.example' } }), t.env, t.ctx);
    expect(ws.status).toBe(403);
    const nullOrigin = await handle(new Request('http://localhost/api/jobs/job_1/cancel', { method: 'POST', headers: { origin: 'null' } }), t.env, t.ctx);
    expect(nullOrigin.status).toBe(403);
    const portrait = await handle(new Request('http://localhost/api/portraits/lead-warm-mentor/generate?force=1', { method: 'POST', headers: { origin: 'http://localhost:3000' } }), t.env, t.ctx);
    expect(portrait.status).toBe(403);
  });

  it('refuses a feed socket without an Origin and cross-site fetch metadata', async () => {
    const t = await createTestEnv(env);
    expect((await handle(new Request('http://localhost/api/ws?since=0', { headers: { upgrade: 'websocket' } }), t.env, t.ctx)).status).toBe(403);
    const site = await handle(new Request('http://localhost/api/jobs/job_1/cancel', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }), t.env, t.ctx);
    expect(site.status).toBe(403);
  });

  it('refuses host names that are not loopback (DNS rebinding)', async () => {
    const t = await createTestEnv(env);
    const res = await handle(new Request('http://attacker.example:8795/api/workspace', { headers: { host: 'attacker.example:8795' } }), t.env, t.ctx);
    expect(res.status).toBe(403);
    const header = await handle(new Request('http://127.0.0.1:8797/api/jobs', { headers: { host: 'attacker.example' } }), t.env, t.ctx);
    expect(header.status).toBe(403);
  });

  it("allows the app's own origin, loopback hosts and local tools without an Origin", async () => {
    const t = await createTestEnv(env);
    const own = await handle(new Request('http://127.0.0.1:8797/api/talk', { method: 'POST', headers: { host: 'localhost:5183', origin: 'http://localhost:5183', 'content-type': 'application/json' }, body: talkBody }), t.env, t.ctx);
    expect(own.status).toBe(202);
    const tool = await handle(new Request('http://127.0.0.1:8797/api/workspace', { headers: { host: '127.0.0.1:8797' } }), t.env, t.ctx);
    expect(tool.status).toBe(200);
    const v6 = await handle(new Request('http://[::1]:8797/api/health', { headers: { host: '[::1]:8797', 'sec-fetch-site': 'none' } }), t.env, t.ctx);
    expect(v6.status).toBe(200);
  });

  it('requires the JSON essence exactly (text/plain;application/json skips the preflight)', async () => {
    const t = await createTestEnv(env);
    const res = await handle(new Request('http://localhost/api/talk', { method: 'POST', headers: { 'content-type': 'text/plain;application/json' }, body: talkBody }), t.env, t.ctx);
    expect(res.status).toBe(415);
    const ok = await handle(new Request('http://localhost/api/talk', { method: 'POST', headers: { 'content-type': 'Application/JSON; charset=utf-8' }, body: JSON.stringify({ text: 'hi', opId: 'op_y' }) }), t.env, t.ctx);
    expect(ok.status).toBe(202);
  });

  it('answers a malformed percent-escape with a JSON 404, not an uncaught 500', async () => {
    const { res, body } = await call('GET', '/api/jobs/%E0%A4%A');
    expect(res.status).toBe(404);
    expect(body?.error.code).toBe('not_found');
  });
});

describe('spending limits', () => {
  it('caps spoken sentences per day (TTS_DAILY_LIMIT) and refunds calls no provider answered', async () => {
    const tts = (t: Awaited<ReturnType<typeof createTestEnv>>) =>
      handle(new Request('http://localhost/api/speech/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi', voiceRef: {}, speakerId: 'cw_chief' }) }), t.env, t.ctx);
    const keyless = await createTestEnv({ TTS_DAILY_LIMIT: '1' });
    expect((await tts(keyless)).status).toBe(503);
    expect((await tts(keyless)).status).toBe(503); // refunded: still not rate limited
    const t = await createTestEnv({ MOCK_MEDIA: 'true', TTS_DAILY_LIMIT: '1' });
    expect((await tts(t)).status).toBe(200);
    const limited = await tts(t);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: 'rate_limited', message: expect.stringContaining('TTS_DAILY_LIMIT') } });
  });

  it('caps recordings per day (STT_DAILY_LIMIT)', async () => {
    const t = await createTestEnv({ MOCK_MEDIA: 'true', STT_DAILY_LIMIT: '1' });
    const stt = () => handle(new Request('http://localhost/api/speech/stt', { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: new Uint8Array(64) }), t.env, t.ctx);
    expect((await stt()).status).toBe(200);
    expect((await stt()).status).toBe(429);
  });
});

describe('fake cloud', () => {
  it('applies migrations to fake D1', async () => {
    const t = await createTestEnv();
    await t.d1.prepare('INSERT INTO workspaces (id) VALUES (?)').bind('local').run();
    expect(await t.d1.prepare('SELECT voice_on FROM workspaces WHERE id = ?').bind('local').first('voice_on')).toBe(1);
  });
  it('splits SQL safely', () => {
    expect(splitSql("CREATE TABLE a (x TEXT DEFAULT ';'); -- c;\nINSERT INTO a VALUES ('b;c');")).toEqual(["CREATE TABLE a (x TEXT DEFAULT ';')", "INSERT INTO a VALUES ('b;c')"]);
  });
});
