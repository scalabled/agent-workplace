// Clip service and routes (INC05-PLAN §3.2, §3.5): render once in exactly the agent's provider, store by scope with
// metadata and alignment, answer repeats from storage, and hold the budgets.
import { ProviderError } from '@headcount/models';
import { afterEach, describe, expect, it } from 'vitest';
import { exprSetup, fakeTts, useProviders, type SpeechCall } from '../../test/expr-kit';
import { defaultRuntime, runtime } from '../workspace/runtime';
import { EXPR_CATALOG_VERSION, chiefProfile, indexFor } from './catalog';

afterEach(() => Object.assign(runtime, defaultRuntime));

const XAI = { XAI_API_KEY: 'xai-test-key' };
const LEAD = 'lead-warm-mentor';

function chiefIndex(chiefName: string | null = null) {
  return indexFor(chiefProfile({ leadId: LEAD, chiefName })!);
}

/** Verbal lines of the Chief with exactly these slots, across intents. */
function linesWith(slots: string[], chiefName: string | null = null) {
  const index = chiefIndex(chiefName);
  const out = [];
  for (const intent of ['acknowledge', 'thinking_filler', 'gratitude_reply', 'greeting', 'sign_off', 'holding_filler', 'passing_by', 'micro_status'] as const) {
    for (const w of index.candidates(intent)) if (!w.line.nonverbal && [...w.line.slots].sort().join() === [...slots].sort().join()) out.push(w.line);
  }
  return out;
}

async function usage(s: Awaited<ReturnType<typeof exprSetup>>) {
  const row = await s.t.d1.prepare(`SELECT count FROM media_usage WHERE kind = 'expr_clip'`).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

describe('POST /api/expr/render', () => {
  it('renders once in the agent’s provider, stores audio + alignment, then answers from storage', async () => {
    const calls: SpeechCall[] = [];
    useProviders({ speech: { xai: fakeTts('xai', calls) } });
    const s = await exprSetup(XAI);
    const line = linesWith([])[0]!;
    const first = await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: line.id, fills: {}, provider: 'xai' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ scope: 'shared', cached: false });
    const key: string = first.body.clipKey;
    expect(key).toMatch(/^c1_[a-z2-7]{32}$/);
    expect(first.body.url).toBe(`/api/expr/clips/${key}`);
    expect(first.body.alignmentUrl).toBe(`/api/expr/clips/${key}/align`);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.req).toMatchObject({ withAlignment: true, voice: { xai: chiefIndex().voice.xai } });
    expect(calls[0]!.req.model).toBeUndefined(); // the model is passed to OpenAI only

    const audio = s.t.r2.objects.get(`expr/clips/${key}.mp3`)!;
    expect(audio.customMetadata).toMatchObject({ provider: 'xai', scope: 'shared', lineId: line.id, fillKey: '', catalogVersion: EXPR_CATALOG_VERSION, alignment: 'chars', mime: 'audio/mpeg' });
    expect(Number(audio.customMetadata.durationMs)).toBeGreaterThan(0);
    expect(s.t.r2.objects.has(`expr/clips/${key}.align.json`)).toBe(true);

    const again = await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: line.id, fills: {}, provider: 'xai' });
    expect(again.body).toMatchObject({ clipKey: key, cached: true });
    expect(calls).toHaveLength(1);
    expect(await usage(s)).toBe(1);

    const agent = await s.api('GET', '/api/expr/agents/cw_chief');
    expect(agent.body.manifest.clips[`${line.id}|`]).toMatchObject({ clipKey: key, scope: 'shared' });

    const clip = await s.api('GET', `/api/expr/clips/${key}`);
    expect(clip.status).toBe(200);
    expect(clip.headers.get('content-type')).toBe('audio/mpeg');
    expect(clip.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(Number(clip.headers.get('x-clip-duration-ms'))).toBeGreaterThan(0);
    const align = await s.api('GET', `/api/expr/clips/${key}/align`);
    expect(align.body).toMatchObject({ clipKey: key, text: line.text });
    expect(align.body.alignment.chars.length).toBeGreaterThan(0);
  });

  it('keeps clips with workspace data (a renamed Chief’s name) under the workspace prefix', async () => {
    const calls: SpeechCall[] = [];
    useProviders({ speech: { xai: fakeTts('xai', calls) } });
    const s = await exprSetup(XAI, { chiefName: 'Rosa' });
    const line = linesWith(['self_name'], 'Rosa')[0];
    expect(line, 'the lead has a line that says its own name').toBeTruthy();
    const r = await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: line!.id, fills: { self_name: 'Rosa' }, provider: 'xai' });
    expect(r.body).toMatchObject({ scope: 'workspace', cached: false });
    expect(s.t.r2.objects.has(`ws/local/expr/${r.body.clipKey}.mp3`)).toBe(true);
    expect(s.t.r2.objects.has(`ws/local/expr/${r.body.clipKey}.align.json`)).toBe(true);
    expect((await s.api('GET', `/api/expr/clips/${r.body.clipKey}`)).headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  });

  it('answers 409 when the provider changed, 404 for an unknown line or agent, 400 for invalid fills', async () => {
    useProviders({ speech: { xai: fakeTts('xai', []) } });
    const s = await exprSetup(XAI);
    const line = linesWith([])[0]!;
    const withSlot = chiefIndex()
      .candidates('micro_status')
      .find((w) => w.line.slots.includes('step_label'))!.line;
    const conflict = await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: line.id, fills: {}, provider: 'openai' });
    expect(conflict).toMatchObject({ status: 409, body: { error: { code: 'conflict', message: expect.stringContaining('xai') } } });
    expect((await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: 'no.such.line', fills: {}, provider: 'xai' })).status).toBe(404);
    expect((await s.api('POST', '/api/expr/render', { agentId: 'cw_nobody-at-all', lineId: line.id, fills: {}, provider: 'xai' })).status).toBe(404);
    const invalid = await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: withSlot.id, fills: {}, provider: 'xai' });
    expect(invalid).toMatchObject({ status: 400, body: { error: { code: 'bad_request', message: expect.stringContaining('missing') } } });
    const markup = await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: withSlot.id, fills: Object.fromEntries(withSlot.slots.map((k) => [k, '<b>x</b>'])), provider: 'xai' });
    expect(markup.status).toBe(400);
    expect((await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', provider: 'xai' })).status).toBe(400);
  });

  it('holds EXPR_RENDER_PER_MIN (renders only; stored clips are free)', async () => {
    useProviders({ speech: { xai: fakeTts('xai', []) } });
    const s = await exprSetup({ ...XAI, EXPR_RENDER_PER_MIN: '1' });
    const [a, b] = linesWith([]);
    expect((await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: a!.id, fills: {}, provider: 'xai' })).status).toBe(200);
    const limited = await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: b!.id, fills: {}, provider: 'xai' });
    expect(limited).toMatchObject({ status: 429, body: { error: { code: 'rate_limited', message: expect.stringContaining('EXPR_RENDER_PER_MIN') } } });
    expect((await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: a!.id, fills: {}, provider: 'xai' })).body.cached).toBe(true);
  });

  it('holds EXPR_CLIP_DAILY_LIMIT and gives a failed render back', async () => {
    const calls: SpeechCall[] = [];
    useProviders({ speech: { xai: fakeTts('xai', calls, { fail: () => new ProviderError('xai', 'down', 503, true) }) } });
    const s = await exprSetup({ ...XAI, EXPR_CLIP_DAILY_LIMIT: '1' });
    const [a, b] = linesWith([]);
    const failed = await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: a!.id, fills: {}, provider: 'xai' });
    expect(failed).toMatchObject({ status: 502, body: { error: { code: 'provider_error' } } });
    expect(await usage(s)).toBe(0);
    useProviders({ speech: { xai: fakeTts('xai', calls) } });
    expect((await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: a!.id, fills: {}, provider: 'xai' })).status).toBe(200);
    const over = await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: b!.id, fills: {}, provider: 'xai' });
    expect(over).toMatchObject({ status: 429, body: { error: { code: 'rate_limited', message: expect.stringContaining('EXPR_CLIP_DAILY_LIMIT') } } });
  });

  it('renders Mock clips for free (MOCK_MEDIA) and answers 503 when only the browser voice exists', async () => {
    useProviders();
    const mock = await exprSetup({ MOCK_MEDIA: 'true', EXPR_CLIP_DAILY_LIMIT: '0' });
    expect((await mock.api('GET', '/api/expr/agents/cw_chief')).body.provider).toBe('mock');
    for (const line of linesWith([]).slice(0, 2)) {
      const r = await mock.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: line.id, fills: {}, provider: 'mock' });
      expect(r).toMatchObject({ status: 200, body: { cached: false } });
      expect(mock.t.r2.objects.get(`expr/clips/${r.body.clipKey}.wav`)?.httpMetadata.contentType).toBe('audio/wav');
    }
    expect(await usage(mock)).toBe(0);

    const browser = await exprSetup({});
    expect((await browser.api('GET', '/api/expr/agents/cw_chief')).body.provider).toBe('browser');
    const r = await browser.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: linesWith([])[0]!.id, fills: {}, provider: 'browser' });
    expect(r).toMatchObject({ status: 503, body: { error: { code: 'not_configured', missingKeys: ['XAI_API_KEY', 'OPENAI_API_KEY'] } } });
  });
});

describe('GET /api/expr/clips', () => {
  it('rejects a malformed key and answers 404 for one never rendered', async () => {
    useProviders();
    const s = await exprSetup({});
    expect((await s.api('GET', '/api/expr/clips/not-a-key')).status).toBe(400);
    expect((await s.api('GET', '/api/expr/clips/c1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(404);
    expect((await s.api('GET', '/api/expr/clips/c1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/align')).status).toBe(404);
  });
});
