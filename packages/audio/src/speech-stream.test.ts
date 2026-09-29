import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine } from './engine';
import { createSpeechStream, speechChunkFromResponse, TtsHttpError } from './speech-stream';
import { FakeAudioContext, fakeClip } from './test/fakes';
import type { SpeechChunk } from './types';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

async function collect(it: AsyncIterable<SpeechChunk>) {
  const out: SpeechChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe('createSpeechStream', () => {
  it('starts synthesising the first sentence before the reply is complete', async () => {
    const calls: string[] = [];
    const s = createSpeechStream({
      synthesize: async (text) => {
        calls.push(text);
        return new ArrayBuffer(4);
      },
    });
    s.push('On it. I will');
    await tick();
    expect(calls).toEqual(['On it.']);
    s.push(' look into the suppliers now.');
    s.end();
    const out = await collect(s);
    expect(out.map((c) => c.text)).toEqual(['On it.', 'I will look into the suppliers now.']);
    expect(out.every((c) => c.audio instanceof ArrayBuffer)).toBe(true);
  });

  it('yields strictly in order and bounds prefetch', async () => {
    const pending: Record<string, ReturnType<typeof deferred<ArrayBuffer>>> = {};
    const started: string[] = [];
    const s = createSpeechStream({
      prefetch: 2,
      synthesize: (text) => {
        started.push(text);
        pending[text] = deferred<ArrayBuffer>();
        return pending[text]!.promise;
      },
    });
    s.push('The first sentence is here. The second sentence is here. The third sentence is here. The fourth sentence is here.');
    s.end();
    await tick();
    expect(started).toEqual(['The first sentence is here.', 'The second sentence is here.']);
    const it = s[Symbol.asyncIterator]();
    const first = it.next();
    pending['The second sentence is here.']!.resolve(new ArrayBuffer(2)); // resolves out of order
    await tick();
    pending['The first sentence is here.']!.resolve(new ArrayBuffer(1));
    expect((await first).value?.text).toBe('The first sentence is here.');
    await tick();
    expect(started).toHaveLength(3); // one consumed → one more may start
    expect((await it.next()).value?.text).toBe('The second sentence is here.');
    await tick();
    pending['The third sentence is here.']!.resolve(new ArrayBuffer(3));
    expect((await it.next()).value?.text).toBe('The third sentence is here.');
    pending['The fourth sentence is here.']!.resolve(new ArrayBuffer(4));
    expect((await it.next()).value?.text).toBe('The fourth sentence is here.');
    expect((await it.next()).done).toBe(true);
  });

  it('falls back to a text-only chunk when one sentence fails to synthesise', async () => {
    const errors: string[] = [];
    const s = createSpeechStream({
      synthesize: async (text) => {
        if (text.startsWith('Bad')) throw new Error('503');
        return { audio: new ArrayBuffer(4), mime: 'audio/wav' };
      },
      onError: (_e, text) => errors.push(text),
    });
    s.push('Good sentence number one. Bad sentence right in the middle. Good sentence again at the end.');
    s.end();
    const out = await collect(s);
    expect(out.map((c) => [c.text, !!c.audio])).toEqual([
      ['Good sentence number one.', true],
      ['Bad sentence right in the middle.', false],
      ['Good sentence again at the end.', true],
    ]);
    expect(out[0]!.mime).toBe('audio/wav');
    expect(errors).toEqual(['Bad sentence right in the middle.']);
  });

  it('without synthesize yields text chunks for the browser voice', async () => {
    const s = createSpeechStream();
    s.push('Hello there. How are you?');
    s.end();
    expect(await collect(s)).toEqual([{ text: 'Hello there.' }, { text: 'How are you?' }]);
  });

  it('end({ dropUnfinished }) finishes after the whole sentences and never speaks the half one', async () => {
    const s = createSpeechStream();
    s.push('Hello there. How are you? I was just looking at the');
    s.end({ dropUnfinished: true });
    s.push('ignored');
    s.end();
    expect(await collect(s)).toEqual([{ text: 'Hello there.' }, { text: 'How are you?' }]);
    expect(s.sentences).toEqual(['Hello there.', 'How are you?']);
  });

  it('makes Markdown speakable and skips code blocks', async () => {
    const s = createSpeechStream();
    s.push('**Summary:** see [the doc](https://example.com/x).\n```js\nconst x = 1;\n```\n- First point\n');
    s.end();
    expect((await collect(s)).map((c) => c.text)).toEqual(['Summary: see the doc.', 'First point']);
  });

  it('cancel aborts pending synthesis and ends the iteration', async () => {
    let signal!: AbortSignal;
    const s = createSpeechStream({
      synthesize: (_t, sig) => {
        signal = sig;
        return new Promise<ArrayBuffer>(() => undefined);
      },
    });
    s.push('A sentence that never finishes loading.');
    s.end();
    await tick();
    const next = s[Symbol.asyncIterator]().next();
    s.cancel();
    expect(signal.aborted).toBe(true);
    expect((await next).done).toBe(true);
    expect(s.cancelled).toBe(true);
  });

  it('can be consumed once', () => {
    const s = createSpeechStream();
    s[Symbol.asyncIterator]();
    expect(() => s[Symbol.asyncIterator]()).toThrow(/once/);
  });
});

describe('speechChunkFromResponse', () => {
  it('reads raw audio bytes', async () => {
    const res = new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
    const c = await speechChunkFromResponse(res, 'Hi.');
    expect(c).toMatchObject({ mime: 'audio/mpeg', text: 'Hi.' });
    expect(c.audio!.byteLength).toBe(3);
  });

  it('reads the JSON form with alignment', async () => {
    const body = { mime: 'audio/wav', audioBase64: btoa('abcd'), alignment: { chars: ['h', 'i'], startsMs: [0, 90], endsMs: [90, 200] }, provider: 'mock', voice: 'eve' };
    const res = new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    const c = await speechChunkFromResponse(res);
    expect(c.mime).toBe('audio/wav');
    expect(new TextDecoder().decode(c.audio!)).toBe('abcd');
    expect(c.alignment).toEqual(body.alignment);
  });

  it('throws a typed error naming the missing keys on 503', async () => {
    const res = new Response(JSON.stringify({ error: { code: 'not_configured', message: 'No speech provider.', missingKeys: ['XAI_API_KEY', 'OPENAI_API_KEY'] } }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
    const err = await speechChunkFromResponse(res).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TtsHttpError);
    expect(err).toMatchObject({ status: 503, code: 'not_configured', missingKeys: ['XAI_API_KEY', 'OPENAI_API_KEY'] });
  });
});

describe('SpeechStream + AudioEngine', () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  it('barge-in cancels the stream and its pending TTS requests', async () => {
    const signals: AbortSignal[] = [];
    const engine = createAudioEngine({
      AudioContext: FakeAudioContext as unknown as new () => AudioContext,
      speechSynthesis: null,
      gestureTarget: null,
    });
    const s = createSpeechStream({
      synthesize: (_text, signal) => {
        signals.push(signal);
        return signals.length === 1 ? Promise.resolve(fakeClip(2)) : new Promise<ArrayBuffer>(() => undefined);
      },
    });
    const h = engine.speak({ speakerId: 'cw_chief', chunks: s });
    s.push('First sentence plays now. Second one is still loading.');
    await tick();
    await tick();
    expect(FakeAudioContext.instances[0]!.sources).toHaveLength(1);
    engine.stopSpeaker('cw_chief');
    expect((await h.done).status).toBe('stopped');
    await tick();
    expect(s.cancelled).toBe(true);
    expect(signals.every((sig) => sig.aborted)).toBe(true);
    engine.destroy();
  });
});
