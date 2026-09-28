import { describe, expect, it } from 'vitest';
import { collectEvents } from '../collect';
import { collect, fakeFetch, jsonResponse, sseResponse, type RecordedRequest } from '../testing/fake-fetch';
import type { ChatMessage, ChatProvider, ToolSpec } from '../types';
import { createAnthropicProvider } from './anthropic';

const KEY = 'sk-ant-test-0123456789abcdef';
const tools: ToolSpec[] = [{ name: 'start_job', description: 'Start a job', parameters: { type: 'object', properties: { title: { type: 'string' } } } }];

function setup(handler: (req: RecordedRequest, n: number) => Response | Promise<Response>) {
  const f = fakeFetch(handler);
  const chat = createAnthropicProvider({ ANTHROPIC_API_KEY: KEY }, { fetch: f })!.chat as ChatProvider;
  return { f, chat };
}

const toolTurn = (id: string) => [
  ['message_start', { type: 'message_start', message: { usage: { input_tokens: 20, cache_read_input_tokens: 5 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'They want research.' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Starting it.' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 1 }],
  ['content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id, name: 'start_job', input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"title":' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"Coffee"}' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 2 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } }],
  ['message_stop', { type: 'message_stop' }],
] as [string, object][];

describe('anthropic adapter', () => {
  it('streams thinking, text and an accumulated tool_use, and builds the Messages request', async () => {
    const { f, chat } = setup(() => sseResponse(toolTurn('toolu_1')));
    const events = await collect(chat.chat({ system: 'You are the Chief of Staff.', messages: [{ role: 'user', content: 'look into coffee' }], tools, maxTokens: 800 }));
    const out = await collectEvents((async function* () {
      yield* events;
    })());
    expect(out.reasoning).toBe('They want research.');
    expect(out.text).toBe('Starting it.');
    expect(out.toolCalls).toEqual([{ id: 'toolu_1', name: 'start_job', arguments: '{"title":"Coffee"}' }]);
    expect(out.finish).toBe('tool_calls');
    expect(events.find((e) => e.type === 'usage')).toEqual({ type: 'usage', input: 25, output: 30, cached: 5, usd: null, costStatus: 'unavailable' });
    const req = f.calls[0]!;
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' });
    const body = req.body as Record<string, any>;
    expect(body).toMatchObject({ model: 'claude-opus-5', max_tokens: 800, stream: true, fallbacks: 'default', thinking: { type: 'adaptive', display: 'summarized' } });
    expect(body.system).toEqual([{ type: 'text', text: 'You are the Chief of Staff.', cache_control: { type: 'ephemeral' } }]);
    expect(body.tools).toEqual([{ name: 'start_job', description: 'Start a job', input_schema: tools[0]!.parameters }]);
    expect(body.temperature).toBeUndefined();
  });

  it('replays thinking blocks with signatures when continuing after tool results', async () => {
    const { f, chat } = setup((_r, n) =>
      n === 0
        ? sseResponse(toolTurn('toolu_replay'))
        : sseResponse([
            ['message_start', { type: 'message_start', message: { usage: { input_tokens: 1 } } }],
            ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Started.' } }],
            ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }],
            ['message_stop', { type: 'message_stop' }],
          ]),
    );
    const first = await collectEvents(chat.chat({ messages: [{ role: 'user', content: 'look into coffee' }], tools }));
    const history: ChatMessage[] = [
      { role: 'user', content: 'look into coffee' },
      { role: 'assistant', content: first.text, toolCalls: first.toolCalls },
      { role: 'tool', toolCallId: 'toolu_replay', name: 'start_job', content: '{"jobId":"job_1"}' },
    ];
    const second = await collectEvents(chat.chat({ messages: history, tools }));
    expect(second.text).toBe('Started.');
    const body = f.calls[1]!.body as Record<string, any>;
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(body.messages[1].content[0]).toEqual({ type: 'thinking', thinking: 'They want research.', signature: 'sig-abc' });
    expect(body.messages[1].content.map((b: { type: string }) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
    expect(body.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_replay', content: '{"jobId":"job_1"}' }] });
  });

  it('runs a continuation without thinking when its thinking blocks are unknown, and maps tool_choice', async () => {
    const done = () => sseResponse([['message_start', { type: 'message_start', message: {} }], ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' } }], ['message_stop', { type: 'message_stop' }]]);
    const { f, chat } = setup(done);
    await collectEvents(
      chat.chat({
        messages: [
          { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_unknown', name: 'start_job', arguments: '{}' }] },
          { role: 'tool', toolCallId: 'toolu_unknown', name: 'start_job', content: 'ok', isError: true },
        ],
        tools,
      }),
    );
    const body = f.calls[0]!.body as Record<string, any>;
    expect(body.thinking).toBeUndefined();
    expect(body.messages[0]).toEqual({ role: 'user', content: '(conversation start)' });
    expect(body.messages[2].content[0]).toMatchObject({ type: 'tool_result', is_error: true });
    await collectEvents(chat.chat({ model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'x' }], tools, toolChoice: { name: 'start_job' }, reasoningEffort: 'high' }));
    const b2 = f.calls[1]!.body as Record<string, any>;
    expect(b2.tool_choice).toEqual({ type: 'tool', name: 'start_job' });
    expect(b2.thinking).toBeUndefined();
    expect(b2.output_config).toBeUndefined();
    expect(f.calls[1]!.headers['anthropic-beta']).toBeUndefined();
    await collectEvents(chat.chat({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'x' }], reasoningEffort: 'low', responseFormat: { type: 'json_schema', name: 'r', schema: { type: 'object' } } }));
    expect((f.calls[2]!.body as Record<string, any>).output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } });
  });

  it('errors when the stream ends without message_stop, and maps overloaded errors as retryable', async () => {
    const cut = setup(() => sseResponse([['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half' } }]]));
    expect((await collect(cut.chat.chat({ messages: [{ role: 'user', content: 'x' }] }))).at(-1)).toMatchObject({ type: 'error', code: 'incomplete' });
    const busy = setup(() => sseResponse([['error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]]));
    expect((await collect(busy.chat.chat({ messages: [{ role: 'user', content: 'x' }] }))).at(-1)).toMatchObject({ type: 'error', retryable: true, code: 'upstream' });
  });

  it('reports refusals with a sentence and names the key on 401', async () => {
    const refused = setup(() => sseResponse([['message_start', { type: 'message_start', message: {} }], ['message_delta', { type: 'message_delta', delta: { stop_reason: 'refusal' } }], ['message_stop', { type: 'message_stop' }]]));
    const out = await collectEvents(refused.chat.chat({ messages: [{ role: 'user', content: 'x' }] }));
    expect(out.finish).toBe('refusal');
    expect(out.text).toBeTruthy();
    const auth = setup(() => jsonResponse({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401));
    const err = (await collect(auth.chat.chat({ messages: [{ role: 'user', content: 'x' }] }))).at(-1)!;
    expect(err).toMatchObject({ type: 'error', code: 'auth' });
    expect(JSON.stringify(err)).toContain('ANTHROPIC_API_KEY');
  });

  it('picks models per tier', () => {
    const { chat } = setup(() => jsonResponse({}));
    expect([chat.defaultModel('reason'), chat.defaultModel('fast'), chat.defaultModel('voice')]).toEqual(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']);
  });
});
