import type { MouthSample } from '@headcount/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine, DUCK_GAIN, SCHEDULE_LEAD_S, STARVE_MS, STOP_FADE_S } from './engine';
import { createSpeechStream } from './speech-stream';
import { FakeAudioContext, FakeGain, FakeSynth, FakeUtterance, fakeClip, type FakeNode } from './test/fakes';
import type { AudioEngineDeps, SpeakChunk } from './types';

const realTimeout = globalThis.setTimeout.bind(globalThis);
/** Let every pending promise chain run (decode → resume → schedule). */
const settle = () => new Promise<void>((r) => realTimeout(r, 0));

const VISEMES = ['REST', 'CLOSED', 'OPEN_SMALL', 'OPEN_MED', 'OPEN_WIDE', 'ROUND', 'WIDE', 'TEETH', 'TONGUE'];

function setup(extra: Partial<AudioEngineDeps> = {}) {
  let t = 1000;
  const now = () => t;
  FakeAudioContext.clock = now;
  const synth = new FakeSynth();
  const engine = createAudioEngine({
    AudioContext: FakeAudioContext as unknown as new () => AudioContext,
    speechSynthesis: synth as unknown as SpeechSynthesis,
    SpeechSynthesisUtterance: FakeUtterance as unknown as new (text?: string) => SpeechSynthesisUtterance,
    SpeechRecognition: null,
    MediaRecorder: null,
    mediaDevices: null,
    gestureTarget: null,
    now,
    ...extra,
  });
  const ctx = () => FakeAudioContext.instances[FakeAudioContext.instances.length - 1]!;
  /** Advance the audio clock and the performance clock together. */
  const play = async (seconds: number) => {
    FakeAudioContext.instances[FakeAudioContext.instances.length - 1]?.advance(seconds);
    t += seconds * 1000;
    await vi.advanceTimersByTimeAsync(seconds * 1000);
    await settle();
  };
  return { engine, synth, ctx, play, now, setNow: (v: number) => (t = v) };
}

/** An async iterable the test feeds by hand; records whether the consumer called return(). */
function feed() {
  const queue: SpeakChunk[] = [];
  let waiting: ((r: IteratorResult<SpeakChunk>) => void) | null = null;
  let closed = false;
  const state = { returned: false };
  return {
    state,
    push(v: SpeakChunk) {
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ done: false, value: v });
      } else queue.push(v);
    },
    close() {
      closed = true;
      waiting?.({ done: true, value: undefined });
      waiting = null;
    },
    [Symbol.asyncIterator](): AsyncIterator<SpeakChunk> {
      return {
        next: () =>
          queue.length
            ? Promise.resolve({ done: false, value: queue.shift()! })
            : closed
              ? Promise.resolve({ done: true, value: undefined })
              : new Promise((r) => (waiting = r)),
        return: async () => {
          state.returned = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
}

async function* list(...chunks: SpeakChunk[]) {
  for (const c of chunks) yield c;
}

/** Follow the first output of each node from `start`, returning node kinds. */
function path(start: FakeNode): string[] {
  const out: string[] = [];
  let n: FakeNode | undefined = start;
  while (n) {
    out.push(n.kind);
    n = n.outputs[0];
  }
  return out;
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AudioEngine playback', () => {
  it('uses one AudioContext and schedules chunks gaplessly through the speaker tap', async () => {
    const { engine, ctx, play } = setup();
    await engine.arm();
    const h1 = engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(0.5), fakeClip(0.4)) });
    const h2 = engine.speak({ speakerId: 'cw_other', chunks: list(fakeClip(0.2)) });
    await settle();
    expect(FakeAudioContext.instances).toHaveLength(1);
    const c = ctx();
    expect(c.state).toBe('running');
    const [a, other, b] = c.sources; // created in arrival order across speakers
    expect(b!.outputs[0]).toBe(a!.outputs[0]); // same utterance
    expect(a!.startAt).toBeCloseTo(SCHEDULE_LEAD_S);
    expect(b!.startAt).toBeCloseTo(SCHEDULE_LEAD_S + 0.5);
    expect(other!.startAt).toBeCloseTo(SCHEDULE_LEAD_S);
    // source → utterance gain → speaker gain → analyser → voices bus → ducker → master → out
    expect(path(a!)).toEqual(['source', 'gain', 'gain', 'analyser', 'gain', 'gain', 'gain', 'destination']);
    // Each speaker has its own analyser tap.
    expect(a!.outputs[0]!.outputs[0]!.outputs[0]).not.toBe(other!.outputs[0]!.outputs[0]!.outputs[0]);

    const changes: [string, boolean][] = [];
    engine.onSpeakingChange((id, on) => changes.push([id, on]));
    expect(engine.speaking()).toEqual([]); // not until the audio is actually heard
    await play(SCHEDULE_LEAD_S);
    expect(engine.speaking().sort()).toEqual(['cw_chief', 'cw_other']);

    await play(0.25);
    expect(await h2.done).toEqual({ status: 'completed', source: 'audio', playedMs: 200 });
    await play(1);
    expect(await h1.done).toMatchObject({ status: 'completed', source: 'audio' });
    await play(STARVE_MS / 1000);
    expect(engine.speaking()).toEqual([]);
    expect(changes).toContainEqual(['cw_chief', true]);
    expect(changes).toContainEqual(['cw_chief', false]);
  });

  it('queues a second utterance for the same speaker behind the first', async () => {
    const { engine, ctx, play } = setup();
    const h1 = engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(0.5)) });
    const h2 = engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(0.3)) });
    await settle();
    expect(ctx().sources).toHaveLength(1);
    await play(0.6);
    expect((await h1.done).status).toBe('completed');
    await settle();
    expect(ctx().sources).toHaveLength(2);
    expect(ctx().sources[1]!.startAt!).toBeGreaterThanOrEqual(0.5);
    await play(0.4);
    expect((await h2.done).status).toBe('completed');
  });
});

describe('barge-in', () => {
  it('generation drops stale chunks that arrive after stopSpeaker', async () => {
    const { engine, ctx, play } = setup();
    const f = feed();
    const h = engine.speak({ speakerId: 'cw_chief', chunks: f });
    expect(h.generation).toBe(0);
    f.push(fakeClip(0.5));
    await settle();
    expect(ctx().sources).toHaveLength(1);

    engine.stopSpeaker('cw_chief');
    expect(engine.generation('cw_chief')).toBe(1);
    expect(await h.done).toMatchObject({ status: 'stopped', source: 'audio' });

    f.push(fakeClip(0.5)); // the next sentence's TTS arrives late
    await settle();
    await play(1);
    expect(ctx().sources).toHaveLength(1); // never decoded or scheduled
    expect(f.state.returned).toBe(true); // the producer was told to cancel
  });

  it('drops a chunk whose decode finishes after the stop', async () => {
    const { engine, ctx } = setup();
    await engine.arm();
    ctx().holdDecodes = true;
    const h = engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(0.5)) });
    await settle();
    engine.stopSpeaker('cw_chief');
    ctx().releaseDecodes();
    await settle();
    expect(ctx().sources).toHaveLength(0);
    expect((await h.done).status).toBe('stopped');

    // The next utterance belongs to the new generation and plays normally.
    ctx().holdDecodes = false;
    const next = engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(0.2)) });
    expect(next.generation).toBe(1);
    await settle();
    expect(ctx().sources).toHaveLength(1);
  });

  it('stopSpeaker stops playing, scheduled, queued and loading audio at once', async () => {
    const { engine, ctx, play } = setup();
    const changes: [string, boolean][] = [];
    engine.onSpeakingChange((id, on) => changes.push([id, on]));
    const loading = feed(); // three sentences arrived, the fourth is still loading
    for (let i = 0; i < 3; i++) loading.push(fakeClip(1));
    const playing = engine.speak({ speakerId: 'cw_chief', chunks: loading });
    const queued = engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(1)) });
    const other = engine.speak({ speakerId: 'cw_other', chunks: list(fakeClip(3)) });
    await settle();
    await play(0.2);
    expect(engine.speaking().sort()).toEqual(['cw_chief', 'cw_other']);
    const chiefSources = ctx().sources.filter((s) => s.buffer!.duration === 1);
    expect(chiefSources).toHaveLength(3);
    expect(chiefSources.every((s) => s.startAt !== null)).toBe(true);

    engine.stopSpeaker('cw_chief');
    const t = ctx().currentTime;
    for (const s of chiefSources) {
      expect(s.stopAt).not.toBeNull();
      expect(s.stopAt!).toBeLessThanOrEqual(t + STOP_FADE_S + 1e-9);
    }
    const utteranceGain = chiefSources[0]!.outputs[0] as FakeGain;
    expect(utteranceGain.gain.value).toBe(0);
    expect(engine.speaking()).toEqual(['cw_other']);
    expect(changes).toContainEqual(['cw_chief', false]);
    expect((await playing.done).status).toBe('stopped');
    expect((await queued.done).status).toBe('stopped');

    // Nothing from the chief is ever audible again; the other speaker plays on.
    for (let i = 0; i < 30; i++) {
      await play(0.1);
      expect(ctx().audible().filter((s) => chiefSources.includes(s))).toEqual([]);
    }
    loading.push(fakeClip(1)); // the loading sentence lands after the stop
    await settle();
    expect(loading.state.returned).toBe(true);
    expect(ctx().sources).toHaveLength(4); // neither the late chunk nor the queued utterance scheduled anything
    expect((await other.done).status).toBe('completed');
  });

  it('stopAll stops every speaker and the browser voice', async () => {
    const { engine, synth } = setup();
    const a = engine.speak({ speakerId: 'a', chunks: list(fakeClip(1)) });
    const b = engine.speak({ speakerId: 'b', chunks: 'Hello from the browser voice.' });
    await settle();
    expect(synth.current).not.toBeNull();
    engine.stopAll();
    expect((await a.done).status).toBe('stopped');
    expect((await b.done).status).toBe('stopped');
    expect(synth.cancels).toBe(1);
    expect(engine.generation('a')).toBe(1);
    expect(engine.generation('b')).toBe(1);
  });

  it('handle.stop() stops one utterance and is idempotent', async () => {
    const { engine, ctx } = setup();
    const h = engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(1)) });
    await settle();
    h.stop();
    h.stop();
    expect((await h.done).status).toBe('stopped');
    expect(ctx().sources[0]!.stopAt).not.toBeNull();
  });
});

describe('mouth sampler', () => {
  function expectShape(m: MouthSample) {
    for (const k of ['openness', 'width', 'round', 'energy'] as const) {
      expect(m[k]).toBeGreaterThanOrEqual(0);
      expect(m[k]).toBeLessThanOrEqual(1);
    }
  }

  it('follows the audio actually playing through the analyser tap', async () => {
    const { engine, ctx, play, now } = setup();
    const face = engine.sampler('cw_chief');
    expect(face.sample(now())).toMatchObject({ openness: 0, done: true });

    const h = engine.speak({ speakerId: 'cw_chief', chunks: list({ audio: fakeClip(1), text: 'Hello there, how are you today?' }) });
    await settle();
    expect(h.sampler.sample(now())).toMatchObject({ openness: 0, done: false, voiced: false }); // scheduled, not heard yet
    const analyser = ctx().analysers[0]!;
    analyser.db = -30; // loud speech
    await play(0.2);
    const m = h.sampler.sample(now());
    expectShape(m);
    expect(m.voiced).toBe(true);
    expect(m.heard).toBe(true);
    expect(m.done).toBe(false);
    expect(m.source).toBe('timeline');
    expect(VISEMES).toContain(m.shape);
    expect(Object.keys(m.params!).sort()).toEqual(['cornerPull', 'jawDrop', 'openY', 'round', 'stretchX']);
    expect(face.sample(now())).toEqual(m); // the per-speaker sampler follows the same utterance

    // Silence in the tap closes the mouth even though the timeline still has text.
    analyser.db = -100;
    for (let i = 0; i < 10; i++) await play(0.01);
    expect(h.sampler.sample(now()).shape).toBe('REST');
    expect(h.sampler.sample(now()).openness).toBe(0);

    // Ducked (owner talking): the mouth rests.
    analyser.db = -30;
    engine.duck(true);
    const ducked = h.sampler.sample(now() + 1);
    expect(ducked.heard).toBe(false);
    expect(ducked.openness).toBe(0);
    engine.duck(false);

    await play(1);
    expect((await h.done).status).toBe('completed');
    expect(h.sampler.sample(now())).toMatchObject({ openness: 0, done: true });
    expect(face.sample(now())).toMatchObject({ done: true });
  });

  it('keeps the mouth and speaking on until the tail is heard (output latency)', async () => {
    const { engine, ctx, play, now } = setup();
    await engine.arm();
    const c = ctx();
    // Bluetooth-like output: what the context renders now is heard 250 ms later.
    c.getOutputTimestamp = () => ({ contextTime: c.currentTime, performanceTime: FakeAudioContext.clock() + 250 });
    const changes: [boolean, number][] = [];
    engine.onSpeakingChange((_id, on) => changes.push([on, now()]));
    const start = now();
    const h = engine.speak({ speakerId: 'cw_chief', chunks: list({ audio: fakeClip(1), text: 'Hello there.' }) });
    await settle();
    let finished = false;
    void h.done.then(() => (finished = true));
    // Step the clocks together (the source ends on the audio clock part-way through).
    const steps = Math.round((SCHEDULE_LEAD_S + 1.05) / 0.025);
    for (let i = 0; i < steps; i++) await play(0.025);
    expect(c.sources[0]!.ended).toBe(true); // the source ended on the audio clock…
    expect(finished).toBe(false); // …but the last 250 ms are still reaching the speakers
    expect(engine.speaking()).toEqual(['cw_chief']);
    expect(h.sampler.sample(now()).done).toBe(false);
    for (let i = 0; i < 10; i++) await play(0.025);
    const out = await h.done;
    expect(out.status).toBe('completed');
    expect(out.playedMs).toBeGreaterThanOrEqual(975); // the whole clip was heard (it used to report ~750 here)
    const heardStart = start + SCHEDULE_LEAD_S * 1000 + 250;
    expect(changes[0]![0]).toBe(true);
    expect(changes[0]![1]).toBeGreaterThanOrEqual(heardStart - 1);
    const off = changes.find(([on]) => !on)!;
    expect(off[1]).toBeGreaterThanOrEqual(heardStart + 1000 - 30);
  });

  it('uses provider alignment for exact shapes', async () => {
    const { engine, ctx, play, now } = setup();
    const h = engine.speak({
      speakerId: 'cw_chief',
      chunks: list(fakeClip(0.6)),
      alignment: { chars: ['m', 'a', 's'], startsMs: [0, 200, 400], endsMs: [200, 400, 600] },
    });
    await settle();
    ctx().analysers[0]!.db = -30;
    await play(SCHEDULE_LEAD_S + 0.05);
    const closed = h.sampler.sample(now());
    expect(closed).toMatchObject({ shape: 'CLOSED', source: 'alignment' });
    await play(0.2);
    const open = h.sampler.sample(now());
    expect(open.shape).toBe('OPEN_WIDE');
    expect(open.openness).toBeGreaterThan(0.5);
  });

  it('falls back to the spectrum when there is no text', async () => {
    const { engine, ctx, play, now } = setup();
    const h = engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(0.5)) });
    await settle();
    ctx().analysers[0]!.db = -30;
    await play(0.1);
    const m = h.sampler.sample(now());
    expect(m.source).toBe('spectrum');
    expect(m.openness).toBeGreaterThan(0);
    expect(m.energy).toBeGreaterThan(0);
  });

  it('text-times the mouth for browser speech', async () => {
    const { engine, synth, play, now } = setup();
    const h = engine.speak({ speakerId: 'cw_chief', chunks: 'Mama made a banana bread. Then we ate it.' });
    await settle();
    expect(synth.spoken).toEqual(['Mama made a banana bread.']);
    expect(engine.speaking()).toEqual(['cw_chief']);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const m = h.sampler.sample(now());
      expectShape(m);
      expect(m.source).toBe('text');
      seen.add(m.shape!);
      await play(0.03);
    }
    expect(seen.size).toBeGreaterThan(2); // the mouth moves through several shapes
    synth.boundary(5); // "made" starts now
    expect(h.sampler.sample(now()).shape).toBe('CLOSED'); // 'm'
    synth.finish();
    await settle();
    expect(synth.spoken).toEqual(['Mama made a banana bread.', 'Then we ate it.']);
    synth.finish();
    expect(await h.done).toMatchObject({ status: 'completed', source: 'browser' });
    await play(STARVE_MS / 1000);
    expect(engine.speaking()).toEqual([]);
  });
});

describe('fallbacks', () => {
  it('speaks text-only chunks with the browser voice after the audio before them', async () => {
    const { engine, ctx, synth, play } = setup();
    const h = engine.speak({ speakerId: 'cw_chief', chunks: list({ audio: fakeClip(0.3), text: 'First.' }, { text: 'Second, from the browser.' }) });
    await settle();
    expect(ctx().sources).toHaveLength(1);
    expect(synth.spoken).toEqual([]); // waits for the audio to drain
    await play(0.4);
    expect(synth.spoken).toEqual(['Second, from the browser.']);
    synth.finish();
    expect(await h.done).toMatchObject({ status: 'completed', source: 'audio' });
  });

  it('falls back to the browser voice when a chunk cannot be decoded', async () => {
    const { engine, synth } = setup();
    const h = engine.speak({ speakerId: 'cw_chief', chunks: list({ audio: new ArrayBuffer(2), text: '**Done.** See [the doc](https://x.test).' }) });
    await settle();
    expect(synth.spoken).toEqual(['Done. See the doc.']);
    synth.finish();
    expect(await h.done).toMatchObject({ status: 'completed', source: 'browser' });
  });

  it('never rejects: no speechSynthesis → failed with source none', async () => {
    const { engine } = setup({ speechSynthesis: null });
    const h = engine.speak({ speakerId: 'cw_chief', chunks: 'Hello there' });
    expect(await h.done).toMatchObject({ status: 'failed', source: 'none' });
    expect(engine.speaking()).toEqual([]);
    expect(engine.support().speechSynthesis).toBe(false);
  });

  it('never rejects: a throwing chunk source fails the utterance', async () => {
    const { engine } = setup();
    // eslint-disable-next-line require-yield
    async function* broken(): AsyncGenerator<SpeakChunk> {
      throw new Error('tts exploded');
    }
    expect(await engine.speak({ speakerId: 'x', chunks: broken() }).done).toMatchObject({ status: 'failed', error: 'tts exploded' });
  });

  it('works with no Web Audio at all (text chunks still speak)', async () => {
    const { engine, synth } = setup({ AudioContext: null });
    expect(engine.support().webAudio).toBe(false);
    const h = engine.speak({ speakerId: 'cw_chief', chunks: list({ audio: fakeClip(1), text: 'Plan B.' }) });
    await settle();
    expect(synth.spoken).toEqual(['Plan B.']);
    synth.finish();
    expect((await h.done).status).toBe('completed');
  });
});

describe('context and ducking', () => {
  it('arms on the first gesture and ducks voices by 18 dB', async () => {
    const target = new EventTarget();
    const { engine, ctx } = setup({ gestureTarget: target });
    expect(engine.armed).toBe(false);
    target.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(engine.armed).toBe(true);
    const ducker = ctx().gains[1]!;
    engine.duck(true);
    expect(engine.ducked).toBe(true);
    expect(ducker.gain.value).toBeCloseTo(DUCK_GAIN);
    expect(20 * Math.log10(ducker.gain.value)).toBeCloseTo(-18);
    engine.duck(false);
    expect(ducker.gain.value).toBe(1);
  });

  it('destroy stops everything and closes the context', async () => {
    const { engine, ctx } = setup();
    const h = engine.speak({ speakerId: 'a', chunks: list(fakeClip(1)) });
    await settle();
    engine.destroy();
    expect((await h.done).status).toBe('stopped');
    expect(ctx().state).toBe('closed');
    expect((await engine.speak({ speakerId: 'a', chunks: 'late' }).done).status).toBe('stopped');
  });
});

describe('a speech stream that ends where it is', () => {
  it('an open stream holds its speaker; ended with dropUnfinished, the next line plays and the half sentence never does', async () => {
    const { engine, synth } = setup();
    const s = createSpeechStream({ chunker: { maxTokens: 60 } });
    const first = engine.speak({ speakerId: 'cw_chief', chunks: s });
    s.push('The first part is done. And the sec');
    await settle();
    expect(synth.spoken).toEqual(['The first part is done.']);
    synth.finish();
    const next = engine.speak({ speakerId: 'cw_chief', chunks: 'The suppliers job is done.' });
    for (let i = 0; i < 5; i++) await settle();
    // The reply's end never arrives: the next line waits behind the open stream.
    expect(synth.spoken).toEqual(['The first part is done.']);
    expect(engine.activity('cw_chief').streamOpen).toBe(true);
    s.end({ dropUnfinished: true });
    expect((await first.done).status).toBe('completed');
    for (let i = 0; i < 5; i++) await settle();
    synth.finish();
    expect((await next.done).status).toBe('completed');
    expect(synth.spoken).toEqual(['The first part is done.', 'The suppliers job is done.']);
  });
});
