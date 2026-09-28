import { describe, expect, it } from 'vitest';
import { collectEvents } from '../collect';
import { collect, fakeFetch, jsonResponse, ndjsonResponse, type RecordedRequest } from '../testing/fake-fetch';
import type { ChatProvider, ToolSpec } from '../types';
import { createOllamaProvider, sameOllamaModel } from './ollama';

const tools: ToolSpec[] = [{ name: 'start_job', description: 'Start a job', parameters: { type: 'object', properties: { title: { type: 'string' } } } }];

function setup(handler: (req: RecordedRequest, n: number) => Response | Promise<Response>, env: Record<string, string> = {}) {
  const f = fakeFetch(handler);
  const inst = createOllamaProvider({ OLLAMA_BASE_URL: 'http://127.0.0.1:11434', ...env }, { fetch: f })!;
  return { f, inst, chat: inst.chat as ChatProvider };
}

const done = (extra: object = {}) => ({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 11, eval_count: 7, ...extra });

describe('ollama adapter', () => {
  it('is configured by OLLAMA_BASE_URL alone', () => {
    expect(createOllamaProvider({}, { fetch: fakeFetch(() => jsonResponse({})) })).toBeNull();
  });

  it('streams /api/chat NDJSON with qwen3:32b and thinking off by default', async () => {
    const { f, chat } = setup(() => ndjsonResponse([{ message: { content: 'Hello' } }, { message: { content: ' there.' } }, done()]));
    const events = await collect(chat.chat({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100, temperature: 0.4 }));
    const out = await collectEvents((async function* () {
      yield* events;
    })());
    expect(out.text).toBe('Hello there.');
    expect(out.finish).toBe('stop');
    expect(events.find((e) => e.type === 'usage')).toEqual({ type: 'usage', input: 11, output: 7, usd: 0, costStatus: 'free' });
    const req = f.calls[0]!;
    expect(req.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(req.body).toMatchObject({ model: 'qwen3:32b', stream: true, think: false, options: { num_predict: 100, temperature: 0.4 }, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }] });
  });

  it('turns tool_calls (object arguments) into tool_call events and sends tool history natively', async () => {
    const { f, chat } = setup(() => ndjsonResponse([{ message: { content: '', tool_calls: [{ function: { name: 'start_job', arguments: { title: 'Coffee suppliers' } } }] } }, done()]));
    const out = await collectEvents(
      chat.chat({
        messages: [
          { role: 'user', content: 'look into coffee' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'start_job', arguments: '{"title":"Tea"}' }] },
          { role: 'tool', toolCallId: 'c1', name: 'start_job', content: '{"ok":true}' },
          { role: 'user', content: 'and coffee' },
        ],
        tools,
        reasoningEffort: 'high',
      }),
    );
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]).toMatchObject({ name: 'start_job', arguments: '{"title":"Coffee suppliers"}' });
    expect(out.toolCalls[0]!.id).toMatch(/^call_/);
    expect(out.finish).toBe('tool_calls');
    const body = f.calls[0]!.body as Record<string, any>;
    expect(body.think).toBe(true);
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: 'start_job', description: 'Start a job', parameters: tools[0]!.parameters } });
    expect(body.messages.slice(1, 3)).toEqual([
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'start_job', arguments: { title: 'Tea' } } }] },
      { role: 'tool', content: '{"ok":true}', tool_name: 'start_job' },
    ]);
  });

  it('routes thinking and inline <think> tags to reasoning', async () => {
    const { chat } = setup(() => ndjsonResponse([{ message: { thinking: 'plan. ' } }, { message: { content: '<think>inner' } }, { message: { content: '</think>Answer.' } }, done()]));
    const out = await collectEvents(chat.chat({ messages: [{ role: 'user', content: 'x' }] }));
    expect(out.reasoning).toBe('plan. inner');
    expect(out.text).toBe('Answer.');
  });

  it('errors on a stream without done, and names `ollama pull` for a missing model', async () => {
    const cut = setup(() => ndjsonResponse([{ message: { content: 'half' } }]));
    expect((await collect(cut.chat.chat({ messages: [{ role: 'user', content: 'x' }] }))).at(-1)).toMatchObject({ type: 'error', code: 'incomplete' });
    const missing = setup(() => jsonResponse({ error: "model 'qwen3:32b' not found" }, 404));
    const err = (await collect(missing.chat.chat({ messages: [{ role: 'user', content: 'x' }] }))).at(-1)!;
    expect(err).toMatchObject({ type: 'error', code: 'model_not_found', retryable: false });
    expect((err as { message: string }).message).toContain('ollama pull qwen3:32b');
  });

  it('embeds with nomic-embed-text via /api/embed', async () => {
    const { f, inst } = setup(() => jsonResponse({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }));
    const out = await inst.embeddings!.embed({ texts: ['a', 'b'] });
    expect(out).toEqual({ vectors: [[0.1, 0.2], [0.3, 0.4]], model: 'nomic-embed-text', dims: 2, provider: 'ollama' });
    expect(f.calls[0]!.url).toBe('http://127.0.0.1:11434/api/embed');
    expect(f.calls[0]!.body).toMatchObject({ model: 'nomic-embed-text', input: ['a', 'b'] });
  });

  it('probes /api/tags: reachable with models, a missing model per capability, or unreachable', async () => {
    const tags = { models: [{ name: 'qwen3:32b', capabilities: ['completion', 'tools', 'thinking'] }, { name: 'nomic-embed-text:latest', capabilities: ['embedding'] }] };
    const ok = setup(() => jsonResponse(tags));
    expect(await ok.inst.health!.check()).toEqual({
      ok: true,
      models: { 'qwen3:32b': ['chat', 'json', 'tools', 'reasoning'], 'nomic-embed-text:latest': ['embeddings'] },
      capabilities: { chat: { ok: true }, embeddings: { ok: true } },
    });
    const partial = setup(() => jsonResponse({ models: [{ name: 'llama3:8b' }] }));
    const h = await partial.inst.health!.check();
    expect(h.ok).toBe(true);
    expect(h.capabilities?.chat).toMatchObject({ ok: false });
    expect(h.capabilities?.chat?.reason).toContain('ollama pull qwen3:32b');
    const down = setup(() => {
      throw new TypeError('fetch failed');
    });
    const d = await down.inst.health!.check();
    expect(d.ok).toBe(false);
    expect(d.reason).toContain('http://127.0.0.1:11434');
    expect(down.f.calls).toHaveLength(1);
  });

  it('matches :latest tags', () => {
    expect(sameOllamaModel('nomic-embed-text', 'nomic-embed-text:latest')).toBe(true);
    expect(sameOllamaModel('qwen3:32b', 'qwen3:8b')).toBe(false);
  });
});
