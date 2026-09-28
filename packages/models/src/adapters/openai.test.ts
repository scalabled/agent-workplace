import { describe, expect, it } from 'vitest';
import { collectEvents } from '../collect';
import { bytesResponse, collect, fakeFetch, jsonResponse, sseResponse, type RecordedRequest } from '../testing/fake-fetch';
import type { ChatProvider, ToolSpec } from '../types';
import { createOpenAIProvider } from './openai';

const KEY = 'sk-test-openai-0123456789';
const tools: ToolSpec[] = [
  { name: 'start_job', description: 'Start a job', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }, mock: { triggers: ['x'] } },
  { name: 'crm.search', description: 'Search', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
];

function setup(handler: (req: RecordedRequest, n: number) => Response | Promise<Response>) {
  const f = fakeFetch(handler);
  const inst = createOpenAIProvider({ OPENAI_API_KEY: KEY }, { fetch: f })!;
  return { f, inst, chat: inst.chat as ChatProvider };
}

const completed = (usage = { input_tokens: 12, output_tokens: 5, input_tokens_details: { cached_tokens: 4 } }) => ({ type: 'response.completed', response: { status: 'completed', usage } });

describe('openai adapter', () => {
  it('is not configured without OPENAI_API_KEY', () => {
    expect(createOpenAIProvider({}, { fetch: fakeFetch(() => jsonResponse({})) })).toBeNull();
  });

  it('streams text over the Responses API and builds the request the owner code builds', async () => {
    const { f, chat } = setup(() =>
      sseResponse([
        { type: 'response.created' },
        { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_1', type: 'message' } },
        { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Hello ' },
        { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'there.' },
        { type: 'response.output_text.done', item_id: 'msg_1', output_index: 0, content_index: 0, text: 'Hello there.' },
        completed(),
      ]),
    );
    const events = await collect(chat.chat({ system: 'Be brief.', messages: [{ role: 'user', content: 'hi' }], tools, maxTokens: 50, reasoningEffort: 'low' }));
    const out = await collectEvents((async function* () {
      yield* events;
    })());
    expect(out.text).toBe('Hello there.');
    expect(out.finish).toBe('stop');
    expect(events.find((e) => e.type === 'usage')).toEqual({ type: 'usage', input: 12, output: 5, cached: 4, usd: null, costStatus: 'unavailable' });
    const req = f.calls[0]!;
    expect(req.url).toBe('https://api.openai.com/v1/responses');
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
    const body = req.body as Record<string, any>;
    expect(body).toMatchObject({ model: 'gpt-5.6-sol', stream: true, store: false, instructions: 'Be brief.', max_output_tokens: 50, reasoning: { summary: 'auto', effort: 'low' } });
    expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }]);
    expect(body.tools[0]).toEqual({ type: 'function', name: 'start_job', description: 'Start a job', parameters: tools[0]!.parameters, strict: false });
    expect(body.tools[1].name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(JSON.stringify(body)).not.toContain('triggers');
    expect(body.temperature).toBeUndefined();
  });

  it('emits function calls (streamed arguments) with the local tool name and finish tool_calls', async () => {
    const { chat } = setup(() =>
      sseResponse([
        { type: 'response.output_item.added', output_index: 0, item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'crm_search', arguments: '' } },
        { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"q":' },
        { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '"acme"}' },
        { type: 'response.output_item.done', output_index: 0, item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'crm_search' } },
        completed(),
      ]),
    );
    const out = await collectEvents(chat.chat({ messages: [{ role: 'user', content: 'find acme' }], tools }));
    expect(out.toolCalls).toEqual([{ id: 'call_1', name: 'crm.search', arguments: '{"q":"acme"}' }]);
    expect(out.finish).toBe('tool_calls');
  });

  it('sends tool history as function_call / function_call_output items', async () => {
    const { f, chat } = setup(() => sseResponse([{ type: 'response.output_text.delta', delta: 'ok' }, completed()]));
    await collectEvents(
      chat.chat({
        model: 'gpt-4.1',
        temperature: 0.2,
        messages: [
          { role: 'user', content: 'look into x' },
          { role: 'assistant', content: 'Starting.', toolCalls: [{ id: 'call_9', name: 'start_job', arguments: '{"title":"x"}' }] },
          { role: 'tool', toolCallId: 'call_9', name: 'start_job', content: '{"jobId":"job_1"}' },
        ],
        tools,
      }),
    );
    const body = f.calls[0]!.body as Record<string, any>;
    expect(body.input.slice(1)).toEqual([
      { role: 'assistant', content: [{ type: 'output_text', text: 'Starting.' }] },
      { type: 'function_call', call_id: 'call_9', name: 'start_job', arguments: '{"title":"x"}' },
      { type: 'function_call_output', call_id: 'call_9', output: '{"jobId":"job_1"}' },
    ]);
    expect(body.temperature).toBe(0.2);
    expect(body.reasoning).toBeUndefined();
  });

  it('recovers final-only text from response.completed and marks max_output_tokens as length', async () => {
    const { chat } = setup(() =>
      sseResponse([
        { type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ id: 'm1', type: 'message', content: [{ type: 'output_text', text: 'Only at the end.' }] }] } },
      ]),
    );
    const out = await collectEvents(chat.chat({ messages: [{ role: 'user', content: 'x' }] }));
    expect(out.text).toBe('Only at the end.');
    expect(out.finish).toBe('length');
  });

  it('never reports a truncated stream as success', async () => {
    const { chat } = setup(() => sseResponse([{ type: 'response.output_text.delta', delta: 'partial' }]));
    const events = await collect(chat.chat({ messages: [{ role: 'user', content: 'x' }] }));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'incomplete', retryable: true });
    expect(events.filter((e) => e.type === 'done' || e.type === 'error')).toHaveLength(1);
  });

  it('turns response.failed and HTTP errors into one error event without the key', async () => {
    const failed = setup(() => sseResponse([{ type: 'response.failed', response: { error: { code: 'server_error', message: 'overloaded' } } }]));
    const e1 = (await collect(failed.chat.chat({ messages: [{ role: 'user', content: 'x' }] }))).at(-1)!;
    expect(e1).toMatchObject({ type: 'error', retryable: true });
    const auth = setup(() => jsonResponse({ error: { message: `Incorrect API key provided: ${KEY}` } }, 401));
    const e2 = (await collect(auth.chat.chat({ messages: [{ role: 'user', content: 'x' }] }))).at(-1)!;
    expect(e2).toMatchObject({ type: 'error', code: 'auth', status: 401, retryable: false });
    expect(JSON.stringify(e2)).toContain('OPENAI_API_KEY');
    expect(JSON.stringify(e2)).not.toContain('0123456789');
  });

  it('cancels upstream and ends with done: cancelled when the caller aborts mid-stream', async () => {
    const ac = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'one ' })}\n\n`));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { chat } = setup(() => new Response(body as unknown as BodyInit, { headers: { 'content-type': 'text/event-stream' } }));
    const seen: string[] = [];
    for await (const ev of chat.chat({ messages: [{ role: 'user', content: 'x' }], signal: ac.signal })) {
      seen.push(ev.type === 'done' ? `done:${ev.finish}` : ev.type);
      if (ev.type === 'text') ac.abort();
    }
    expect(seen).toEqual(['text', 'done:cancelled']);
    expect(cancelled).toBe(true);
  });

  it('speaks with gpt-4o-mini-tts, the catalog voice and its instructions', async () => {
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);
    const { f, inst } = setup(() => bytesResponse(mp3, 'audio/mpeg'));
    const out = await inst.speech!.tts!({ text: 'Morning.', voice: { openai: 'Verse', xai: 'rex', speed: 1.07, instructions: 'Bright and quick.' } });
    expect(out).toMatchObject({ mime: 'audio/mpeg', provider: 'openai', voice: 'verse', alignment: null });
    expect(new Uint8Array(out.audio)).toEqual(mp3);
    expect(f.calls[0]!.url).toBe('https://api.openai.com/v1/audio/speech');
    expect(f.calls[0]!.body).toEqual({ model: 'gpt-4o-mini-tts', voice: 'verse', input: 'Morning.', response_format: 'mp3', instructions: 'Bright and quick.', speed: 1.07 });
    await inst.speech!.tts!({ text: 'x', voice: { openai: 'not-a-voice' }, format: 'wav' });
    expect(f.calls[1]!.body).toMatchObject({ voice: 'marin', response_format: 'wav' });
  });

  it('transcribes with gpt-4o-transcribe and falls back to whisper-1 when the model is unavailable', async () => {
    const { f, inst } = setup((req, n) => (n === 0 ? jsonResponse({ error: { message: 'The model `gpt-4o-transcribe` does not exist' } }, 404) : jsonResponse({ text: ' Also check pricing. ' })));
    const out = await inst.speech!.stt!({ audio: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, mime: 'audio/webm;codecs=opus', language: 'en' });
    expect(out).toEqual({ text: 'Also check pricing.', provider: 'openai', language: 'en' });
    const [first, second] = f.calls.map((c) => c.body as FormData);
    expect(f.calls[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(first!.get('model')).toBe('gpt-4o-transcribe');
    expect(second!.get('model')).toBe('whisper-1');
    expect((first!.get('file') as File).name).toBe('audio.webm');
  });

  it('generates gpt-image-2 portraits (3:4 → 1024x1536) and returns bytes', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let b64 = '';
    for (const b of png) b64 += String.fromCharCode(b);
    const { f, inst } = setup(() => jsonResponse({ data: [{ b64_json: btoa(b64), revised_prompt: 'A portrait' }], output_format: 'png' }));
    const out = await inst.image!.generate({ prompt: 'portrait', aspect: '3:4' });
    expect(out).toMatchObject({ mime: 'image/png', provider: 'openai', model: 'gpt-image-2', revisedPrompt: 'A portrait' });
    expect(new Uint8Array(out.image)).toEqual(png);
    expect(f.calls[0]!.body).toMatchObject({ model: 'gpt-image-2', size: '1024x1536', n: 1 });
  });

  it('embeds with text-embedding-3-small, re-sorted by index', async () => {
    const { inst } = setup(() => jsonResponse({ model: 'text-embedding-3-small', data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }));
    const out = await inst.embeddings!.embed({ texts: ['a', 'b'] });
    expect(out).toEqual({ vectors: [[1, 0], [0, 1]], model: 'text-embedding-3-small', dims: 2, provider: 'openai' });
  });

  it('picks models per tier', () => {
    const { chat } = setup(() => jsonResponse({}));
    expect([chat.defaultModel(), chat.defaultModel('reason'), chat.defaultModel('fast'), chat.defaultModel('voice'), chat.defaultModel('deep')]).toEqual(['gpt-5.6-sol', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-luna', 'gpt-5.6-sol']);
  });
});
