import { describe, expect, it } from 'vitest';
import { collectEvents } from '../collect';
import { collect, fakeFetch, jsonResponse, sseResponse, type RecordedRequest } from '../testing/fake-fetch';
import type { ChatProvider, ToolSpec } from '../types';
import { createGeminiProvider, pickGeminiModel, toGeminiSchema } from './gemini';

const KEY = 'AIzaTestKey0123456789';
const tools: ToolSpec[] = [
  { name: 'steer_job', description: 'Steer', parameters: { type: 'object', properties: { jobId: { type: 'string' }, text: { type: ['string', 'null'] }, mode: { enum: ['add', 'replace'] } }, required: ['jobId', 'text', 'ghost'], additionalProperties: false } },
  { name: 'job_status', description: 'Status', parameters: { type: 'object', properties: {} } },
];

function setup(handler: (req: RecordedRequest, n: number) => Response | Promise<Response>, env: Record<string, string> = {}) {
  const f = fakeFetch(handler);
  const inst = createGeminiProvider({ GEMINI_API_KEY: KEY, ...env }, { fetch: f })!;
  return { f, inst, chat: inst.chat as ChatProvider };
}

describe('gemini adapter', () => {
  it('converts JSON Schema to the Gemini Schema subset', () => {
    expect(toGeminiSchema(tools[0]!.parameters)).toEqual({
      type: 'OBJECT',
      properties: { jobId: { type: 'STRING' }, text: { type: 'STRING', nullable: true }, mode: { type: 'STRING', enum: ['add', 'replace'], format: 'enum' } },
      required: ['jobId', 'text'],
    });
    expect(toGeminiSchema({ anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] })).toEqual({ type: 'INTEGER', minimum: 1, nullable: true });
    expect(toGeminiSchema({ const: 'x' })).toEqual({ type: 'STRING', enum: ['x'] });
  });

  it('streams text and usage via streamGenerateContent (SSE) and builds the request', async () => {
    const { f, chat } = setup(() =>
      sseResponse([
        { candidates: [{ content: { role: 'model', parts: [{ text: 'Hmm.', thought: true }] } }] },
        { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello ' }] } }] },
        { candidates: [{ content: { role: 'model', parts: [{ text: 'there.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3, thoughtsTokenCount: 2 } },
      ]),
    );
    const events = await collect(chat.chat({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools, toolChoice: 'required', maxTokens: 64, temperature: 0.1, reasoningEffort: 'low' }));
    const out = await collectEvents((async function* () {
      yield* events;
    })());
    expect(out).toMatchObject({ text: 'Hello there.', reasoning: 'Hmm.', finish: 'stop' });
    expect(events.find((e) => e.type === 'usage')).toMatchObject({ input: 9, output: 5 });
    const req = f.calls[0]!;
    expect(req.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:streamGenerateContent?alt=sse');
    expect(req.headers['x-goog-api-key']).toBe(KEY);
    const body = req.body as Record<string, any>;
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
    expect(body.tools[0].functionDeclarations[1]).toEqual({ name: 'job_status', description: 'Status' });
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY' } });
    expect(body.generationConfig).toEqual({ maxOutputTokens: 64, temperature: 0.1, thinkingConfig: { includeThoughts: true } });
  });

  it('emits functionCall parts as tool calls and replays their thought signatures', async () => {
    const { f, chat } = setup((_r, n) =>
      n === 0
        ? sseResponse([{ candidates: [{ content: { parts: [{ functionCall: { name: 'steer_job', args: { jobId: 'job_1', text: 'Also pricing' } }, thoughtSignature: 'sig-1' }] }, finishReason: 'STOP' }] }])
        : sseResponse([{ candidates: [{ content: { parts: [{ text: 'Noted.' }] }, finishReason: 'STOP' }] }]),
    );
    const first = await collectEvents(chat.chat({ messages: [{ role: 'user', content: 'also pricing' }], tools }));
    expect(first.finish).toBe('tool_calls');
    expect(first.toolCalls[0]).toMatchObject({ name: 'steer_job', arguments: '{"jobId":"job_1","text":"Also pricing"}' });
    await collectEvents(
      chat.chat({
        messages: [
          { role: 'user', content: 'also pricing' },
          { role: 'assistant', content: '', toolCalls: first.toolCalls },
          { role: 'tool', toolCallId: first.toolCalls[0]!.id, name: 'steer_job', content: '{"status":"queued"}' },
          { role: 'tool', toolCallId: 'other', name: 'job_status', content: 'plain text' },
        ],
        tools,
      }),
    );
    const contents = (f.calls[1]!.body as Record<string, any>).contents;
    expect(contents[1]).toEqual({ role: 'model', parts: [{ functionCall: { name: 'steer_job', args: { jobId: 'job_1', text: 'Also pricing' } }, thoughtSignature: 'sig-1' }] });
    expect(contents[2]).toEqual({
      role: 'user',
      parts: [{ functionResponse: { name: 'steer_job', response: { status: 'queued' } } }, { functionResponse: { name: 'job_status', response: { result: 'plain text' } } }],
    });
  });

  it('maps finish reasons and enforces completion', async () => {
    const len = setup(() => sseResponse([{ candidates: [{ content: { parts: [{ text: 'a' }] }, finishReason: 'MAX_TOKENS' }] }]));
    expect((await collectEvents(len.chat.chat({ messages: [{ role: 'user', content: 'x' }] }))).finish).toBe('length');
    const blocked = setup(() => sseResponse([{ promptFeedback: { blockReason: 'SAFETY' } }]));
    const b = await collectEvents(blocked.chat.chat({ messages: [{ role: 'user', content: 'x' }] }));
    expect(b.finish).toBe('refusal');
    const cut = setup(() => sseResponse([{ candidates: [{ content: { parts: [{ text: 'a' }] } }] }]));
    expect((await collect(cut.chat.chat({ messages: [{ role: 'user', content: 'x' }] }))).at(-1)).toMatchObject({ type: 'error', code: 'incomplete' });
  });

  it('rediscovers the model once when an alias 404s', async () => {
    const { f, chat } = setup((req) => {
      if (req.url.includes('gemini-flash-latest')) return jsonResponse({ error: { code: 404, message: 'models/gemini-flash-latest is not found', status: 'NOT_FOUND' } }, 404);
      if (req.url.includes('/models?')) return jsonResponse({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.1-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] }] });
      return sseResponse([{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }]);
    }, { GEMINI_BASE_URL: 'https://gemini.test/v1beta' });
    const out = await collectEvents(chat.chat({ model: chat.defaultModel('fast'), messages: [{ role: 'user', content: 'x' }] }));
    expect(out.text).toBe('ok');
    expect(f.calls.map((c) => c.url.replace('https://gemini.test/v1beta', ''))).toEqual(['/models/gemini-flash-latest:streamGenerateContent?alt=sse', '/models?pageSize=1000', '/models/gemini-3.1-flash:streamGenerateContent?alt=sse']);
    expect(pickGeminiModel([{ name: 'models/gemini-3-pro-preview', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }], 'reason')).toBe('gemini-3-pro-preview');
  });

  it('embeds with gemini-embedding-001 via batchEmbedContents', async () => {
    const { f, inst } = setup(() => jsonResponse({ embeddings: [{ values: [1, 2] }, { values: [3, 4] }] }));
    const out = await inst.embeddings!.embed({ texts: ['a', 'b'] });
    expect(out).toEqual({ vectors: [[1, 2], [3, 4]], model: 'gemini-embedding-001', dims: 2, provider: 'gemini' });
    expect(f.calls[0]!.url).toContain('/models/gemini-embedding-001:batchEmbedContents');
    expect(f.calls[0]!.body).toEqual({ requests: [{ model: 'models/gemini-embedding-001', content: { parts: [{ text: 'a' }] } }, { model: 'models/gemini-embedding-001', content: { parts: [{ text: 'b' }] } }] });
  });
});
