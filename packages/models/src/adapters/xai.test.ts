import { describe, expect, it } from 'vitest';
import { collectEvents } from '../collect';
import { bytesResponse, fakeFetch, jsonResponse, sseResponse, type RecordedRequest } from '../testing/fake-fetch';
import type { ChatProvider } from '../types';
import { createXaiProvider, xaiAlignment } from './xai';

const KEY = 'xai-test-key-abcdef123456';

function setup(handler: (req: RecordedRequest, n: number) => Response | Promise<Response>) {
  const f = fakeFetch(handler);
  const inst = createXaiProvider({ XAI_API_KEY: KEY }, { fetch: f })!;
  return { f, inst, chat: inst.chat as ChatProvider };
}

describe('xai adapter', () => {
  it('chats over /v1/responses with strict JSON schema by default and no effort on non-reasoning models', async () => {
    const { f, chat } = setup(() => sseResponse([{ type: 'response.output_text.delta', delta: '{"ok":true}' }, { type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 2 } } }]));
    const out = await collectEvents(
      chat.chat({ model: chat.defaultModel('fast'), system: 'sys', messages: [{ role: 'user', content: 'x' }], reasoningEffort: 'high', temperature: 0.3, responseFormat: { type: 'json_schema', name: 'v', schema: { type: 'object' } } }),
    );
    expect(out.text).toBe('{"ok":true}');
    const req = f.calls[0]!;
    expect(req.url).toBe('https://api.x.ai/v1/responses');
    expect(req.body).toMatchObject({ model: 'grok-4.20-non-reasoning', instructions: 'sys', store: false, temperature: 0.3, text: { format: { type: 'json_schema', name: 'v', strict: true } } });
    expect((req.body as Record<string, unknown>).reasoning).toBeUndefined();
  });

  it('passes effort to reasoning models and splits Grok narration bursts', async () => {
    const { f, chat } = setup(() =>
      sseResponse([
        { type: 'response.output_text.delta', item_id: 'a', delta: 'Checking the notes.' },
        { type: 'response.output_item.added', output_index: 1, item: { id: 'ws', type: 'web_search_call' } },
        { type: 'response.output_item.done', output_index: 1, item: { id: 'ws', type: 'web_search_call', action: { sources: [{ url: 'https://example.com/a', title: 'A' }] } } },
        { type: 'response.output_text.delta', item_id: 'a', delta: 'Got them.' },
        { type: 'response.completed', response: {} },
      ]),
    );
    const out = await collectEvents(chat.chat({ messages: [{ role: 'user', content: 'x' }], reasoningEffort: 'high' }));
    expect(out.text).toBe('Checking the notes.\n\nGot them.');
    expect(out.citations).toEqual([{ url: 'https://example.com/a', title: 'A' }]);
    expect(f.calls[0]!.body).toMatchObject({ model: 'grok-4.6', reasoning: { effort: 'high' } });
  });

  it('speaks via POST /v1/tts as mp3 with the catalog voice and clamped speed', async () => {
    const { f, inst } = setup(() => bytesResponse(new Uint8Array([0xff, 0xf3, 1]), 'audio/mpeg'));
    const out = await inst.speech!.tts!({ text: 'Hello.', voice: { openai: 'verse', xai: 'Rex', speed: 2 } });
    expect(out).toMatchObject({ mime: 'audio/mpeg', provider: 'xai', voice: 'rex', alignment: null });
    expect(f.calls[0]!.url).toBe('https://api.x.ai/v1/tts');
    expect(f.calls[0]!.body).toEqual({ text: 'Hello.', voice_id: 'rex', language: 'en', output_format: { codec: 'mp3', sample_rate: 24000, bit_rate: 128000 }, speed: 1.5 });
  });

  it('returns character alignment when asked with_timestamps', async () => {
    const { f, inst } = setup(() => jsonResponse({ audio: btoa('abc'), content_type: 'audio/mpeg', audio_timestamps: { graph_chars: ['H', 'i'], graph_times: [[0, 0.1], [0.1, 0.25]] } }));
    const out = await inst.speech!.tts!({ text: 'Hi', voice: { xai: 'eve' }, withAlignment: true });
    expect(f.calls[0]!.body).toMatchObject({ with_timestamps: true });
    expect(out.alignment).toEqual({ chars: ['H', 'i'], startsMs: [0, 100], endsMs: [100, 250] });
    expect(new TextDecoder().decode(out.audio)).toBe('abc');
  });

  it('normalises both alignment shapes and rejects bad ones', () => {
    expect(xaiAlignment({ characters: ['a'], character_start_times_seconds: [0.5], character_end_times_seconds: [0.6] })).toEqual({ chars: ['a'], startsMs: [500], endsMs: [600] });
    expect(xaiAlignment({ graph_chars: ['a'], graph_times: [[0.2, 0.1]] })).toBeNull();
    expect(xaiAlignment(null)).toBeNull();
  });

  it('transcribes via POST /v1/stt with the file part last', async () => {
    const { f, inst } = setup(() => jsonResponse({ text: 'hello there', language: 'en', duration: 1.5 }));
    const out = await inst.speech!.stt!({ audio: new Uint8Array([1]).buffer as ArrayBuffer, mime: 'audio/webm' });
    expect(out).toEqual({ text: 'hello there', provider: 'xai', language: 'en', durationMs: 1500 });
    const form = f.calls[0]!.body as FormData;
    expect([...form.keys()]).toEqual(['language', 'format', 'file']);
    expect(f.calls[0]!.url).toBe('https://api.x.ai/v1/stt');
  });

  it('generates grok-imagine-image-2.0 portraits at 3:4 as bytes, and edits with a data URL', async () => {
    const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0));
    const { f, inst } = setup(() => jsonResponse({ data: [{ b64_json: jpeg }] }));
    const out = await inst.image!.generate({ prompt: 'A single adult, front-facing portrait' });
    expect(out).toMatchObject({ mime: 'image/jpeg', provider: 'xai', model: 'grok-imagine-image-2.0' });
    expect(f.calls[0]!.body).toEqual({ model: 'grok-imagine-image-2.0', prompt: 'A single adult, front-facing portrait', n: 1, response_format: 'b64_json', aspect_ratio: '3:4' });
    await inst.image!.generate({ prompt: 'same person, smiling', source: { data: new Uint8Array([1, 2]).buffer as ArrayBuffer, mime: 'image/png' } });
    expect(f.calls[1]!.url).toBe('https://api.x.ai/v1/images/edits');
    expect(f.calls[1]!.body).toMatchObject({ image: { type: 'image_url', url: 'data:image/png;base64,AQI=' } });
  });

  it('downloads a URL answer without sending the key', async () => {
    const { f, inst } = setup((req) => (req.url.startsWith('https://cdn') ? bytesResponse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png') : jsonResponse({ data: [{ url: 'https://cdn.example/img.png' }] })));
    const out = await inst.image!.generate({ prompt: 'p' });
    expect(out.mime).toBe('image/png');
    expect(f.calls[1]!.headers.authorization).toBeUndefined();
  });
});

describe('download guard (provider-supplied URLs)', () => {
  const answer = (url: string) => jsonResponse({ data: [{ url }] });

  it.each(['http://cdn.example/img.png', 'https://127.0.0.1/img.png', 'https://localhost/img.png', 'https://10.1.2.3/x.png', 'https://169.254.169.254/latest', 'https://[::1]/x.png', 'https://[fd00::1]/x.png', 'file:///etc/passwd', 'https://metadata/x'])(
    'refuses %s without fetching it',
    async (url) => {
      const { f, inst } = setup(() => answer(url));
      await expect(inst.image!.generate({ prompt: 'p' })).rejects.toMatchObject({ name: 'ProviderError', kind: 'bad_response' });
      expect(f.calls).toHaveLength(1);
    },
  );

  it('aborts a body past the size cap, declared or streamed', async () => {
    const big = new Uint8Array(5_000_001);
    const declared = setup((req) => (req.url.startsWith('https://cdn') ? new Response(big, { headers: { 'content-type': 'image/png', 'content-length': String(big.byteLength) } }) : answer('https://cdn.example/a.png')));
    await expect(declared.inst.image!.generate({ prompt: 'p' })).rejects.toMatchObject({ kind: 'bad_response', message: expect.stringContaining('over 5 MB') });
    const streamed = setup((req) =>
      req.url.startsWith('https://cdn')
        ? new Response(new ReadableStream({ start: (c) => { for (let i = 0; i < 6; i++) c.enqueue(new Uint8Array(1_000_000)); c.close(); } }), { headers: { 'content-type': 'image/png' } })
        : answer('https://cdn.example/b.png'),
    );
    await expect(streamed.inst.image!.generate({ prompt: 'p' })).rejects.toMatchObject({ kind: 'bad_response' });
  });

  it('checks every redirect hop', async () => {
    const { f, inst } = setup((req) => (req.url === 'https://cdn.example/r.png' ? new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/secret' } }) : answer('https://cdn.example/r.png')));
    await expect(inst.image!.generate({ prompt: 'p' })).rejects.toMatchObject({ kind: 'bad_response' });
    expect(f.calls.map((c) => c.url)).toEqual(['https://api.x.ai/v1/images/generations', 'https://cdn.example/r.png']);
  });
});
