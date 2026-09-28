import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../errors';
import { chunkedBody, collect, fakeFetch, jsonResponse, sseText } from '../testing/fake-fetch';
import type { ModelEvent } from '../types';
import { base64ToArrayBuffer, bytesToBase64, sniffImageMime } from './bytes';
import { deadlineSignal, fetchWithRetry, providerDeadlineMs, redact, upstreamError } from './http';
import { parseLenientJson, readJson } from './lenient-json';
import { parseNDJSON, parseSSE, sseResponse } from './sse';
import { guardStream } from './stream';
import { ThinkSplitter } from './think';
import { IndexedToolCalls, ToolNames, normalizeArguments } from './tools';

describe('parseSSE', () => {
  it('parses events split across chunks, CRLF, comments and multi-line data', async () => {
    const text = ': keepalive\r\n\r\nevent: ping\r\ndata: {"a":1}\r\n\r\ndata: line1\r\ndata: line2\r\n\r\ndata: [DONE]\r\n\r\n';
    for (const size of [1, 3, 7, 100]) {
      const out = await collect(parseSSE(chunkedBody(text, size)));
      expect(out).toEqual([
        { event: 'ping', data: '{"a":1}' },
        { event: undefined, data: 'line1\nline2' },
        { event: undefined, data: '[DONE]' },
      ]);
    }
  });

  it('flushes a final event without a trailing blank line and handles multi-byte characters', async () => {
    const out = await collect(parseSSE(chunkedBody('data: {"t":"héllo — ✓"}\n\ndata: tail', 2)));
    expect(out.map((r) => r.data)).toEqual(['{"t":"héllo — ✓"}', 'tail']);
  });

  it('cancels the upstream reader when the consumer stops early', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sseText([{ n: 1 }, { n: 2 }])));
      },
      cancel,
    });
    for await (const _ of parseSSE(body)) break;
    expect(cancel).toHaveBeenCalled();
  });
});

describe('parseNDJSON', () => {
  it('yields each JSON line and skips garbage', async () => {
    const out = await collect(parseNDJSON(chunkedBody('{"a":1}\nnot json\n\n{"b":2}', 3)));
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('sseResponse', () => {
  it('streams emitted events, forwards a thrown error and ends with [DONE]', async () => {
    const res = sseResponse(async (emit) => {
      await emit({ type: 'text', delta: 'hi' });
      throw Object.assign(new Error('boom'), { status: 502 });
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const out = await collect(parseSSE(res.body as unknown as ReadableStream<Uint8Array>));
    expect(out.map((r) => r.data)).toEqual(['{"type":"text","delta":"hi"}', '{"type":"error","message":"boom","status":502}', '[DONE]']);
  });

  it('aborts the producer signal when the parent aborts', async () => {
    const parent = new AbortController();
    let seen: AbortSignal | undefined;
    const res = sseResponse(
      async (_emit, signal) => {
        seen = signal;
        await new Promise((r) => signal.addEventListener('abort', r));
      },
      { signal: parent.signal },
    );
    parent.abort();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen?.aborted).toBe(true);
    await res.body?.cancel().catch(() => undefined);
  });
});

describe('ThinkSplitter', () => {
  it('routes <think> content to reasoning, even when tags are split', () => {
    const s = new ThinkSplitter();
    const parts = ['Hi <thi', 'nk>pon', 'der</th', 'ink> there'].map((d) => s.push(d));
    const rest = s.flush();
    expect(parts.map((p) => p.text).join('') + rest.text).toBe('Hi  there');
    expect(parts.map((p) => p.reasoning).join('') + rest.reasoning).toBe('ponder');
  });
});

describe('lenient JSON', () => {
  it('repairs the structural mistakes qwen3 makes', () => {
    expect(parseLenientJson('{"entities":[{"name":"a","type":"x"}},"relations":[]}')).toEqual({ entities: [{ name: 'a', type: 'x' }], relations: [] });
    expect(parseLenientJson('Here you go: {"a": [1, 2')).toEqual({ a: [1, 2] });
    expect(parseLenientJson('{"entities":[{"name":"n","observations":["a.","b."}],"relations":[]}')).toEqual({ entities: [{ name: 'n', observations: ['a.', 'b.'] }], relations: [] });
  });

  it('prefers clean parses, fences and spans before repairing', () => {
    expect(readJson('<think>hmm</think>```json\n{"ok":true}\n```')).toEqual({ value: { ok: true }, repaired: false });
    expect(readJson('Result: {"n": 1} done')).toEqual({ value: { n: 1 }, repaired: false });
    expect(readJson('{"n": 1')).toEqual({ value: { n: 1 }, repaired: true });
  });
});

describe('tool names and arguments', () => {
  it('maps invalid names to wire names and back', () => {
    const names = new ToolNames(['start_job', 'crm.search', 'crm_search']);
    expect(names.wire('start_job')).toBe('start_job');
    const wire = names.wire('crm.search');
    expect(wire).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(wire).not.toBe(names.wire('crm_search'));
    expect(names.local(wire)).toBe('crm.search');
  });

  it('normalises arguments to a JSON string', () => {
    expect(normalizeArguments({ a: 1 })).toBe('{"a":1}');
    expect(normalizeArguments('')).toBe('{}');
    expect(normalizeArguments(undefined)).toBe('{}');
    expect(normalizeArguments('{"raw":')).toBe('{"raw":');
  });

  it('assembles Chat Completions tool-call fragments by index', () => {
    const acc = new IndexedToolCalls();
    acc.add({ index: 0, id: 'c1', function: { name: 'start_', arguments: '{"ti' } });
    acc.add({ index: 1, id: 'c2', function: { name: 'job_status', arguments: '{}' } });
    acc.add({ index: 0, function: { name: 'job', arguments: 'tle":"x"}' } });
    expect(acc.drain()).toEqual([
      { id: 'c1', name: 'start_job', arguments: '{"title":"x"}' },
      { id: 'c2', name: 'job_status', arguments: '{}' },
    ]);
  });
});

describe('fetchWithRetry', () => {
  const opts = { provider: 'openai' as const, label: 'OpenAI' };

  it('retries 429 (honouring Retry-After) and 5xx, then returns the answer', async () => {
    const f = fakeFetch((_r, n) => (n === 0 ? jsonResponse({}, 429, { 'retry-after': '0' }) : n === 1 ? jsonResponse({}, 503) : jsonResponse({ ok: true })));
    const res = await fetchWithRetry(f, 'https://x.test/a', { method: 'POST' }, opts);
    expect(res.status).toBe(200);
    expect(f.calls).toHaveLength(3);
  });

  it('returns the last error response after two retries', async () => {
    const f = fakeFetch(() => jsonResponse({ error: { message: 'down' } }, 500));
    const res = await fetchWithRetry(f, 'https://x.test/a', {}, { ...opts, retries: 2 });
    expect(res.status).toBe(500);
    expect(f.calls).toHaveLength(3);
  });

  it('turns network failures into a retryable unreachable ProviderError', async () => {
    const f = fakeFetch(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    });
    const err = await fetchWithRetry(f, 'http://127.0.0.1:1/x', {}, { ...opts, retries: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'unreachable', retryable: true });
    expect((err as Error).message).toContain('ECONNREFUSED');
    expect(f.calls).toHaveLength(2);
  });

  it('never retries for a caller who already gave up', async () => {
    const ac = new AbortController();
    const f = fakeFetch(() => {
      ac.abort();
      return jsonResponse({}, 503);
    });
    await expect(fetchWithRetry(f, 'https://x.test', {}, { ...opts, signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.calls).toHaveLength(1);
  });

  it('carries a caller deadline on the signal', () => {
    const s = deadlineSignal(300_000);
    expect(providerDeadlineMs(s)).toBeGreaterThan(290_000);
  });
});

describe('errors never leak keys', () => {
  it('redacts key-shaped strings and exact secrets', () => {
    expect(redact('Incorrect API key provided: sk-proj-abc123DEF456ghi. Bearer xai-secretsecret', [])).not.toMatch(/abc123|secretsecret/);
    expect(redact('echo my-own-key-value here', ['my-own-key-value'])).toBe('echo [redacted] here');
  });

  it('names the env var on auth errors', async () => {
    const res = jsonResponse({ error: { message: 'Incorrect API key provided: sk-live-1234567890abcdef' } }, 401);
    const err = await upstreamError(res, { provider: 'openai', label: 'OpenAI', keyName: 'OPENAI_API_KEY', secrets: ['sk-live-1234567890abcdef'] });
    expect(err.message).toContain('OPENAI_API_KEY');
    expect(err.message).not.toContain('1234567890');
    expect(err).toMatchObject({ kind: 'auth', retryable: false, status: 401 });
  });
});

describe('guardStream', () => {
  async function* events(list: ModelEvent[], thenThrow?: Error): AsyncGenerator<ModelEvent> {
    for (const e of list) yield e;
    if (thenThrow) throw thenThrow;
  }

  it('ends a stream without a terminal event as incomplete', async () => {
    const out = await collect(guardStream('openai', 'OpenAI', undefined, () => events([{ type: 'text', delta: 'a' }])));
    expect(out.at(-1)).toMatchObject({ type: 'error', code: 'incomplete', retryable: true });
  });

  it('maps a thrown ProviderError to one error event and stops after the first terminal event', async () => {
    const out = await collect(guardStream('openai', 'OpenAI', undefined, () => events([{ type: 'text', delta: 'a' }], new ProviderError('openai', 'bad sk-proj-abcdefgh12345', 500, true, 'upstream'))));
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ type: 'error', code: 'upstream', retryable: true });
    expect(JSON.stringify(out)).not.toContain('abcdefgh12345');
    const two = await collect(guardStream('openai', 'OpenAI', undefined, () => events([{ type: 'done', finish: 'stop' }, { type: 'text', delta: 'late' }])));
    expect(two).toEqual([{ type: 'done', finish: 'stop' }]);
  });

  it('reports a cancelled caller as done: cancelled and an expired deadline as a timeout error', async () => {
    const ac = new AbortController();
    ac.abort();
    expect(await collect(guardStream('openai', 'OpenAI', ac.signal, () => events([])))).toEqual([{ type: 'done', finish: 'cancelled' }]);
    const deadline = deadlineSignal(1);
    await new Promise((r) => setTimeout(r, 10));
    expect((await collect(guardStream('openai', 'OpenAI', deadline, () => events([]))))[0]).toMatchObject({ type: 'error', code: 'timeout' });
  });
});

describe('bytes', () => {
  it('round-trips base64 and sniffs image types', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const b64 = bytesToBase64(png);
    const back = new Uint8Array(base64ToArrayBuffer(`data:image/png;base64,${b64}`));
    expect([...back]).toEqual([...png]);
    expect(sniffImageMime(back.buffer as ArrayBuffer)).toBe('image/png');
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer as ArrayBuffer)).toBe('image/jpeg');
  });
});
