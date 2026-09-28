import { describe, expect, it } from 'vitest';
import { collectEvents } from '../collect';
import { collect, fakeFetch, jsonResponse, sseResponse, type RecordedRequest } from '../testing/fake-fetch';
import type { ChatProvider, ToolSpec } from '../types';
import { compatibleBaseUrl, createOpenAICompatibleProvider } from './openai-compatible';

const tools: ToolSpec[] = [{ name: 'job_status', description: 'Status', parameters: { type: 'object', properties: { jobId: { type: 'string' } } } }];

function setup(handler: (req: RecordedRequest, n: number) => Response | Promise<Response>, env: Record<string, string> = {}) {
  const f = fakeFetch(handler);
  const inst = createOpenAICompatibleProvider({ OPENAI_COMPATIBLE_BASE_URL: 'https://gateway.example/v1', OPENAI_COMPATIBLE_API_KEY: 'gw-key-0123456789', OPENAI_COMPATIBLE_MODEL: 'llama-4', ...env }, { fetch: f })!;
  return { f, inst, chat: inst.chat as ChatProvider };
}

const chunk = (delta: object, finish: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });

describe('openai-compatible adapter', () => {
  it('assembles streamed tool-call fragments by index and reports usage', async () => {
    const { f, chat } = setup(() =>
      sseResponse([
        chunk({ role: 'assistant', reasoning_content: 'Checking. ' }),
        chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'job_status', arguments: '' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"jobId":' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '"job_1"}' } }] }),
        chunk({}, 'tool_calls'),
        { choices: [], usage: { prompt_tokens: 5, completion_tokens: 6 } },
        '[DONE]',
      ]),
    );
    const events = await collect(chat.chat({ system: 'sys', messages: [{ role: 'user', content: "how's it going?" }], tools, toolChoice: 'required' }));
    const out = await collectEvents((async function* () {
      yield* events;
    })());
    expect(out.reasoning).toBe('Checking. ');
    expect(out.toolCalls).toEqual([{ id: 'call_a', name: 'job_status', arguments: '{"jobId":"job_1"}' }]);
    expect(out.finish).toBe('tool_calls');
    expect(events.find((e) => e.type === 'usage')).toMatchObject({ input: 5, output: 6, costStatus: 'unavailable' });
    const req = f.calls[0]!;
    expect(req.url).toBe('https://gateway.example/v1/chat/completions');
    expect(req.headers.authorization).toBe('Bearer gw-key-0123456789');
    expect(req.body).toMatchObject({ model: 'llama-4', stream: true, stream_options: { include_usage: true }, tool_choice: 'required', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: "how's it going?" }] });
  });

  it('sends tool history as tool_calls / role:tool and streams text', async () => {
    const { f, chat } = setup(() => sseResponse([chunk({ content: 'All ' }), chunk({ content: 'good.' }, 'stop'), '[DONE]']));
    const out = await collectEvents(
      chat.chat({
        messages: [
          { role: 'user', content: 'x' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'call_a', name: 'job_status', arguments: '{}' }] },
          { role: 'tool', toolCallId: 'call_a', name: 'job_status', content: 'running' },
        ],
      }),
    );
    expect(out.text).toBe('All good.');
    expect((f.calls[0]!.body as Record<string, any>).messages.slice(1)).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'job_status', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_a', content: 'running' },
    ]);
  });

  it('errors when the stream has neither finish_reason nor [DONE]', async () => {
    const { chat } = setup(() => sseResponse([chunk({ content: 'half' })]));
    expect((await collect(chat.chat({ messages: [{ role: 'user', content: 'x' }] }))).at(-1)).toMatchObject({ type: 'error', code: 'incomplete' });
  });

  it('discovers the model from /models, and embeds with an embed model', async () => {
    const { f, chat, inst } = setup(
      (req) => (req.url.endsWith('/models') ? jsonResponse({ data: [{ id: 'nomic-embed' }, { id: 'qwen2.5-7b' }] }) : req.url.endsWith('/embeddings') ? jsonResponse({ data: [{ index: 0, embedding: [1] }] }) : sseResponse([chunk({ content: 'hi' }, 'stop')])),
      { OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:1234', OPENAI_COMPATIBLE_MODEL: '', OPENAI_COMPATIBLE_API_KEY: '' },
    );
    expect(chat.kind).toBe('local');
    await collectEvents(chat.chat({ model: chat.defaultModel(), messages: [{ role: 'user', content: 'x' }] }));
    expect(f.calls.map((c) => c.url)).toEqual(['http://localhost:1234/v1/models', 'http://localhost:1234/v1/chat/completions']);
    expect((f.calls[1]!.body as Record<string, unknown>).model).toBe('qwen2.5-7b');
    expect(f.calls[1]!.headers.authorization).toBeUndefined();
    const emb = await inst.embeddings!.embed({ texts: ['a'] });
    expect(emb).toMatchObject({ model: 'nomic-embed', dims: 1 });
    expect(inst.health?.key).toBe('openai-compatible|http://localhost:1234/v1');
  });

  it('adds /v1 only to a bare origin', () => {
    expect(compatibleBaseUrl('http://localhost:1234/')).toBe('http://localhost:1234/v1');
    expect(compatibleBaseUrl('https://api.groq.com/openai/v1/')).toBe('https://api.groq.com/openai/v1');
  });
});
