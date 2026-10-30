// Reflex and ambient lanes of the audio engine: prepare/playPrepared, the priority ladder,
// interjections, stopAtBoundary, activity, the keyless browser lane and the owner VAD, on a fake clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine, INTERJECT_GAP_S, REFLEX_FADE_S, REFLEX_LEAD_S, SCHEDULE_LEAD_S, VAD_PAUSE_MS } from './engine';
import {
  FakeAudioContext,
  FakeGain,
  FakeOfflineAudioContext,
  FakeRecorder,
  FakeSynth,
  FakeUtterance,
  fakeClip,
  fakeMediaDevices,
  type FakeNode,
} from './test/fakes';
import type { AudioEngineDeps, OwnerVadEvent, SpeakChunk } from './types';

const realTimeout = globalThis.setTimeout.bind(globalThis);
const settle = () => new Promise<void>((r) => realTimeout(r, 0));
const WALL0 = 1_790_000_000_000;

function setup(extra: Partial<AudioEngineDeps> = {}) {
  let t = 1000;
  const now = () => t;
  FakeAudioContext.clock = now;
  const synth = new FakeSynth();
  const engine = createAudioEngine({
    AudioContext: FakeAudioContext as unknown as new () => AudioContext,
    OfflineAudioContext: FakeOfflineAudioContext as unknown as AudioEngineDeps['OfflineAudioContext'],
    speechSynthesis: synth as unknown as SpeechSynthesis,
    SpeechSynthesisUtterance: FakeUtterance as unknown as new (text?: string) => SpeechSynthesisUtterance,
    SpeechRecognition: null,
    MediaRecorder: null,
    mediaDevices: null,
    gestureTarget: null,
    now,
    wallClock: () => WALL0 + t,
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
  return { engine, synth, ctx, play, now };
}

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

function path(start: FakeNode): string[] {
  const out: string[] = [];
  let n: FakeNode | undefined = start;
  while (n) {
    out.push(n.kind);
    n = n.outputs[0];
  }
  return out;
}

/** Product of every gain on the first-output path from `start` (linear). */
function pathGain(start: FakeNode): number {
  let g = 1;
  let n: FakeNode | undefined = start;
  while (n) {
    if (n instanceof FakeGain) g *= n.gain.value;
    n = n.outputs[0];
  }
  return g;
}

const db = (linear: number) => 20 * Math.log10(linear);
const outcome = <T>(p: Promise<T>) => {
  const box: { value: T | undefined } = { value: undefined };
  void p.then((v) => (box.value = v));
  return box;
};

beforeEach(() => {
  FakeAudioContext.instances = [];
  FakeOfflineAudioContext.instances = [];
  FakeRecorder.instances = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('prepare', () => {
  it('decodes before arm() on an OfflineAudioContext, without creating the main context', async () => {
    const { engine, ctx } = setup();
    const alignment = { chars: ['h', 'i'], startsMs: [0, 100], endsMs: [100, 200] };
    const p = await engine.prepare(fakeClip(0.8), { key: 'c1_abc', alignment, text: 'Hi.' });
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(FakeOfflineAudioContext.instances).toHaveLength(1);
    expect(p).toMatchObject({ key: 'c1_abc', durationMs: 800, alignment, text: 'Hi.' });
    expect(p.bytes).toBe(0.8 * 8000 * 4); // one channel of float32 at the fake 8 kHz
    // Decoded once, then played on the main context after the gesture.
    await engine.arm();
    engine.playPrepared({ speakerId: 'cw_chief', audio: p, bus: 'reflex', gainDb: 0, priority: 2, ttlMs: 500 });
    expect(ctx().sources).toHaveLength(1);
    expect(ctx().sources[0]!.buffer!.duration).toBe(0.8);
    expect(FakeOfflineAudioContext.instances[0]!.decodes).toBe(1);
  });

  it('falls back to the main context without OfflineAudioContext, and rejects bytes it cannot decode', async () => {
    const { engine } = setup({ OfflineAudioContext: null });
    const p = await engine.prepare(fakeClip(0.3));
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0]!.state).toBe('suspended'); // decoding needs no gesture
    expect(p.key).toMatch(/^prepared-/);
    expect(p.text).toBeNull();
    await expect(engine.prepare(new ArrayBuffer(2))).rejects.toThrow();
    await expect(engine.prepare(new ArrayBuffer(0))).rejects.toThrow('no audio');
  });
});

describe('playPrepared', () => {
  it('starts within 30 ms, plays through the speaker tap, and never counts as speaking', async () => {
    const { engine, ctx, play, now } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(0.4));
    let startedAt = 0;
    const called = now();
    const h = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: -8, priority: 2, ttlMs: 400, onStart: () => (startedAt = now()) });
    const src = ctx().sources[0]!;
    expect(src.startAt! - ctx().currentTime).toBeCloseTo(REFLEX_LEAD_S, 9);
    // source → play gain (gainDb) → speaker reflex bus → speaker gain → analyser tap → voices → ducker → master
    expect(path(src)).toEqual(['source', 'gain', 'gain', 'gain', 'analyser', 'gain', 'gain', 'gain', 'destination']);
    expect(db((src.outputs[0] as FakeGain).gain.value)).toBeCloseTo(-8);
    await play(REFLEX_LEAD_S - 0.001);
    expect(startedAt).toBe(0);
    await play(0.001);
    expect(startedAt - called).toBeLessThanOrEqual(30);
    expect(startedAt - called).toBe(REFLEX_LEAD_S * 1000);
    expect(await h.started).toBe(true);
    expect(engine.speaking()).toEqual([]); // reflexes move the mouth, never the presence
    expect(engine.activity('cw_chief')).toMatchObject({ conversation: false, reflex: true, ambient: false });
    await play(0.4);
    expect(await h.done).toBe('completed');
    expect(engine.activity('cw_chief').reflex).toBe(false);
    await play(0.2);
    expect(src.outputs).toEqual([]); // unhooked after the fade window
  });

  it('drops when the context is not armed, and for audio it did not prepare', async () => {
    const { engine } = setup();
    const clip = await engine.prepare(fakeClip(0.2));
    const h = engine.playPrepared({ speakerId: 'a', audio: clip, bus: 'reflex', gainDb: 0, priority: 2, ttlMs: 500 });
    expect(await h.started).toBe(false);
    expect(await h.done).toBe('dropped');
    await engine.arm();
    const fake = { key: 'x', durationMs: 100, alignment: null, text: null, bytes: 1 };
    expect(await engine.playPrepared({ speakerId: 'a', audio: fake, bus: 'reflex', gainDb: 0, priority: 2, ttlMs: 500 }).done).toBe('dropped');
  });

  it('stop() fades over 60 ms and is idempotent', async () => {
    const { engine, ctx, play } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(1));
    const h = engine.playPrepared({ speakerId: 'a', audio: clip, bus: 'reflex', gainDb: 0, priority: 2, ttlMs: 500 });
    await play(0.2);
    const src = ctx().sources[0]!;
    const gain = src.outputs[0] as FakeGain;
    const t = ctx().currentTime;
    h.stop();
    h.stop();
    expect(gain.gain.events.at(-1)).toEqual({ kind: 'ramp', value: 0, time: t + REFLEX_FADE_S });
    expect(src.stopAt).toBeCloseTo(t + REFLEX_FADE_S);
    expect(await h.done).toBe('stopped');
    expect(await h.started).toBe(true);
  });
});

describe('the ladder', () => {
  it('rule 1: while the owner speaks only a duringOwner reflex plays, ducked 6 dB instead of 18', async () => {
    const { engine, ctx } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(0.5));
    engine.duck(true);
    const plain = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: -8, priority: 5, ttlMs: 500 });
    expect(await plain.done).toBe('dropped');
    const amb = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'ambient', gainDb: -6, priority: 6, ttlMs: 500, duringOwner: true });
    expect(await amb.done).toBe('dropped');
    const bc = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: -8, priority: 5, ttlMs: 500, duringOwner: true });
    const src = ctx().sources[0]!;
    expect(db(pathGain(src))).toBeCloseTo(-8 - 6, 5); // the clip's −8, ducked 6 dB
    // The owner stops talking: the voices come back and the lift goes with them (net: just the clip's −8).
    engine.duck(false);
    expect(db(pathGain(src))).toBeCloseTo(-8, 5);
    engine.duck(true);
    expect(db(pathGain(src))).toBeCloseTo(-14, 5);
    const bus = src.outputs[0]!.outputs[0] as FakeGain;
    expect(db(bus.gain.value)).toBeCloseTo(12, 5);
    bc.stop();
    expect(bus.gain.value).toBe(1); // lift released with the reflex
  });

  it('rule 1: a live push-to-talk mic drops reflexes and stops ambient chatter', async () => {
    const devices = fakeMediaDevices();
    const { engine } = setup({ mediaDevices: devices, MediaRecorder: FakeRecorder as unknown as AudioEngineDeps['MediaRecorder'], secureContext: true });
    await engine.arm();
    const clip = await engine.prepare(fakeClip(2));
    const amb = engine.playPrepared({ speakerId: 'cw_a', audio: clip, bus: 'ambient', gainDb: -6, priority: 6, ttlMs: 500 });
    const session = await engine.startPushToTalk();
    expect(await amb.done).toBe('dropped');
    expect(await engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: 0, priority: 1, ttlMs: 500 }).done).toBe('dropped');
    session.cancel();
  });

  it('rule 2: an answer sounding drops other speakers, and the same speaker unless it interjects', async () => {
    const { engine, play } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(0.3));
    const h = engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(2)) });
    await settle();
    await play(0.1);
    const other = engine.playPrepared({ speakerId: 'cw_jelena', audio: clip, bus: 'reflex', gainDb: 0, priority: 1, ttlMs: 5000 });
    expect(await other.done).toBe('dropped');
    const now_ = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: 0, priority: 1, ttlMs: 5000 });
    expect(await now_.done).toBe('dropped');
    const amb = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'ambient', gainDb: 0, priority: 1, ttlMs: 5000, mode: 'interject' });
    expect(await amb.done).toBe('dropped');
    h.stop();
  });

  it('rule 2: before an answer sounds the same speaker may fill, and the answer waits for it (rule 3)', async () => {
    const { engine, ctx, play } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(0.6));
    const f = feed();
    const h = engine.speak({ speakerId: 'cw_chief', chunks: f }); // the reply's TTS is still loading
    await settle();
    expect(engine.foregroundActive()).toBe(true);
    const filler = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: 0, priority: 3, ttlMs: 800 });
    const fillerSrc = ctx().sources[0]!;
    await play(0.2);
    expect(await filler.started).toBe(true);
    f.push(fakeClip(1)); // the first sentence arrives while the filler sounds
    await settle();
    const answer = ctx().sources[1]!;
    expect(answer.startAt!).toBeCloseTo(fillerSrc.startAt! + 0.6 + INTERJECT_GAP_S, 6);
    expect(engine.speaking()).toEqual([]);
    f.close();
    await play(2);
    expect(await filler.done).toBe('completed');
    expect((await h.done).status).toBe('completed');
  });

  it('rule 3: an answer from another speaker fades the reflex out', async () => {
    const { engine, ctx, play } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(1));
    const r = engine.playPrepared({ speakerId: 'cw_jelena', audio: clip, bus: 'reflex', gainDb: -4, priority: 5, ttlMs: 800 });
    await play(0.2);
    engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(1)) });
    await settle();
    expect(await r.done).toBe('stopped');
    const gain = ctx().sources[0]!.outputs[0] as FakeGain;
    expect(gain.gain.events.at(-1)).toMatchObject({ kind: 'ramp', value: 0 });
    expect(ctx().sources[1]!.startAt!).toBeCloseTo(ctx().currentTime + SCHEDULE_LEAD_S, 6); // the answer does not wait
  });

  it('rule 3: an answer waiting for its speaker’s reflex moves up when that reflex is stopped early', async () => {
    const { engine, ctx, play } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(2));
    const r = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: 0, priority: 3, ttlMs: 800 });
    engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(1)) });
    await settle();
    const waiting = ctx().sources[1]!;
    expect(waiting.startAt!).toBeCloseTo(REFLEX_LEAD_S + 2 + INTERJECT_GAP_S, 6);
    await play(0.5);
    r.stop();
    const moved = ctx().sources[2]!;
    expect(waiting.stopAt).not.toBeNull();
    expect(moved.buffer!.duration).toBe(1);
    expect(moved.startAt!).toBeCloseTo(0.5 + REFLEX_FADE_S + SCHEDULE_LEAD_S, 6);
  });

  it('rule 4: one reflex voice at a time; a more important one fades the other', async () => {
    const { engine, play } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(1));
    const quip = engine.playPrepared({ speakerId: 'cw_a', audio: clip, bus: 'reflex', gainDb: 0, priority: 6, ttlMs: 500 });
    await play(0.1);
    const same = engine.playPrepared({ speakerId: 'cw_b', audio: clip, bus: 'reflex', gainDb: 0, priority: 6, ttlMs: 500 });
    expect(await same.done).toBe('dropped');
    const phatic = engine.playPrepared({ speakerId: 'cw_b', audio: clip, bus: 'reflex', gainDb: 0, priority: 1, ttlMs: 500 });
    expect(await quip.done).toBe('stopped');
    await play(0.1);
    expect(await phatic.started).toBe(true);
    expect(engine.activity('cw_a').reflex).toBe(false);
    expect(engine.activity('cw_b').reflex).toBe(true);
  });

  it('rule 5: ambient plays only in silence and is faded by a reflex or an answer', async () => {
    const { engine, play } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(1));
    const a1 = engine.playPrepared({ speakerId: 'cw_a', audio: clip, bus: 'ambient', gainDb: -6, priority: 6, ttlMs: 500 });
    await play(0.1);
    expect(engine.activity('cw_a').ambient).toBe(true);
    const r = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: 0, priority: 6, ttlMs: 500 });
    expect(await a1.done).toBe('stopped');
    const a2 = engine.playPrepared({ speakerId: 'cw_a', audio: clip, bus: 'ambient', gainDb: -6, priority: 1, ttlMs: 500 });
    expect(await a2.done).toBe('dropped'); // a reflex is sounding
    await play(1.2);
    expect(await r.done).toBe('completed');
    const f = feed();
    const h = engine.speak({ speakerId: 'cw_chief', chunks: f }); // queued, nothing sounding yet
    expect(await engine.playPrepared({ speakerId: 'cw_a', audio: clip, bus: 'ambient', gainDb: -6, priority: 6, ttlMs: 500 }).done).toBe('dropped');
    f.close();
    await h.done;
    const a3 = engine.playPrepared({ speakerId: 'cw_a', audio: clip, bus: 'ambient', gainDb: -6, priority: 6, ttlMs: 500 });
    await play(0.1);
    engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(1)) });
    await settle();
    expect(await a3.done).toBe('stopped');
  });
});

describe('interject and stopAtBoundary', () => {
  it('interject waits for the next chunk boundary, then the answer resumes behind it', async () => {
    const { engine, ctx, play, now } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(0.5), { text: 'Hold that thought.' });
    const f = feed();
    f.push(fakeClip(1));
    f.push(fakeClip(1));
    const h = engine.speak({ speakerId: 'cw_chief', chunks: f });
    await settle();
    const [a, b] = ctx().sources;
    expect(b!.startAt!).toBeCloseTo(SCHEDULE_LEAD_S + 1, 6);
    await play(0.2);
    // Too far from the boundary for its ttl: dropped, and nothing moves.
    const late = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: 0, priority: 1, ttlMs: 300, mode: 'interject' });
    expect(await late.done).toBe('dropped');
    expect(b!.stopAt).toBeNull();
    const j = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: 0, priority: 1, ttlMs: 2500, mode: 'interject' });
    const reflex = ctx().sources[2]!;
    expect(reflex.startAt!).toBeCloseTo(a!.startAt! + 1, 6); // at the boundary
    expect(b!.stopAt).not.toBeNull(); // the next sentence left the clock…
    const resumed = ctx().sources[3]!;
    expect(resumed.startAt!).toBeCloseTo(reflex.startAt! + 0.5 + INTERJECT_GAP_S, 6); // …and resumes behind the reflex
    f.push(fakeClip(1)); // a sentence arriving during the interjection queues after the resumed one
    await settle();
    expect(ctx().sources[4]!.startAt!).toBeCloseTo(resumed.startAt! + 1, 6);
    // The mouth follows the reflex in its window (text-timed), the answer around it.
    ctx().analysers[0]!.db = -30;
    await play(0.9); // ctx 1.1: inside the reflex
    expect(engine.sampler('cw_chief').sample(now()).source).toBe('timeline');
    expect(ctx().audible()).toEqual([reflex]);
    expect(await j.started).toBe(true);
    expect(engine.speaking()).toEqual(['cw_chief']); // the answer is paused, not over
    await play(0.6); // ctx 1.7: the answer again
    expect(ctx().audible()).toEqual([resumed]);
    expect(await j.done).toBe('completed');
    f.close();
    await play(2.5);
    expect((await h.done).status).toBe('completed');
    expect(ctx().audible()).toEqual([]);
    for (const s of [b!]) expect(s.ended || s.stopAt !== null).toBe(true);
  });

  it('interject over browser speech waits for the sentence to end, and the next sentence waits for it', async () => {
    const { engine, synth, ctx, play } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(0.5));
    const h = engine.speak({ speakerId: 'cw_chief', chunks: list({ text: 'First sentence here.' }, { text: 'Second one.' }) });
    await settle();
    expect(synth.spoken).toEqual(['First sentence here.']);
    const j = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: 0, priority: 1, ttlMs: 4000, mode: 'interject' });
    expect(engine.activity('cw_chief').reflex).toBe(true);
    expect(ctx().sources).toHaveLength(0); // pending: the sentence is still being spoken
    synth.finish();
    await settle();
    expect(ctx().sources).toHaveLength(1);
    expect(synth.spoken).toEqual(['First sentence here.']);
    await play(0.6);
    expect(await j.done).toBe('completed');
    expect(synth.spoken).toEqual(['First sentence here.']); // the gap after the reflex
    await play(INTERJECT_GAP_S + 0.01);
    expect(synth.spoken).toEqual(['First sentence here.', 'Second one.']);
    synth.finish();
    expect((await h.done).status).toBe('completed');
  });

  it('a pending interjection is dropped at its ttl', async () => {
    const { engine, play } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(0.5));
    engine.speak({ speakerId: 'cw_chief', chunks: 'A long sentence that keeps going for a while.' });
    await settle();
    const j = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: 0, priority: 1, ttlMs: 300, mode: 'interject' });
    await play(0.31);
    expect(await j.done).toBe('dropped');
    expect(await j.started).toBe(false);
  });

  it('stopAtBoundary ends the answer after the chunk now sounding and drops the rest', async () => {
    const { engine, ctx, play } = setup();
    await engine.arm();
    const f = feed();
    for (let i = 0; i < 3; i++) f.push(fakeClip(1));
    const h = engine.speak({ speakerId: 'cw_chief', chunks: f });
    const queued = engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(1)) });
    await settle();
    const [a, b, c] = ctx().sources;
    await play(0.5);
    engine.stopAtBoundary('cw_chief');
    await settle();
    expect(f.state.returned).toBe(true); // the producer stops synthesising
    expect(a!.stopAt).toBeNull(); // the sentence now playing finishes
    expect(b!.stopAt).not.toBeNull();
    expect(c!.stopAt).not.toBeNull();
    expect((await queued.done).status).toBe('stopped');
    const done = outcome(h.done);
    expect(engine.generation('cw_chief')).toBe(0); // not a barge-in
    f.push(fakeClip(1)); // arrives late: never scheduled
    await play(0.4);
    expect(done.value).toBeUndefined();
    expect(engine.speaking()).toEqual(['cw_chief']);
    expect(engine.activity('cw_chief').remainingMs).toBe(130);
    for (let i = 0; i < 30; i++) {
      await play(0.05);
      expect(ctx().audible().filter((s) => s === b || s === c)).toEqual([]);
    }
    expect(done.value).toMatchObject({ status: 'stopped', source: 'audio' });
    expect(done.value!.playedMs).toBeGreaterThanOrEqual(999);
    expect(ctx().sources).toHaveLength(3);
    // The next answer plays normally.
    const next = engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(0.2)) });
    await settle();
    expect(ctx().sources).toHaveLength(4);
    await play(0.3);
    expect((await next.done).status).toBe('completed');
  });

  it('stopAtBoundary inside a long chunk ends at the sentence playing, not at the end of the chunk (≤ 4 s)', async () => {
    const { engine, ctx, play } = setup();
    await engine.arm();
    const text = 'Confirm quantities and lock the POs. Then we book the carrier and send the numbers over by Friday afternoon.';
    const f = feed();
    f.push({ audio: fakeClip(9), text });
    const h = engine.speak({ speakerId: 'cw_chief', chunks: f });
    await settle();
    const [a] = ctx().sources;
    await play(1);
    engine.stopAtBoundary('cw_chief');
    await settle();
    // The first sentence ends about a third of the way into the 9 s chunk: the cut lands there, not at 9 s.
    const sentenceEnd = ((text.indexOf('.') + 1) / text.length) * 9;
    expect(a!.stopAt).not.toBeNull();
    const played = a!.stopAt! - a!.startAt!;
    expect(played).toBeGreaterThan(sentenceEnd - 0.01);
    expect(played).toBeLessThan(sentenceEnd + 0.2);
    await play(4);
    expect((await h.done).status).toBe('stopped');
  });

  it('stopAtBoundary over browser speech lets the sentence finish, then stops', async () => {
    const { engine, synth } = setup();
    const h = engine.speak({ speakerId: 'cw_chief', chunks: 'First part. Second part. Third part.' });
    await settle();
    engine.stopAtBoundary('cw_chief');
    expect(synth.cancels).toBe(0);
    synth.finish();
    expect(await h.done).toMatchObject({ status: 'stopped', source: 'browser' });
    expect(synth.spoken).toEqual(['First part.']);
  });
});

describe('activity', () => {
  it('reports conversation, reflex, ambient, heard-time remaining and an open stream', async () => {
    const { engine, play } = setup();
    await engine.arm();
    expect(engine.activity('cw_chief')).toEqual({ conversation: false, reflex: false, ambient: false, remainingMs: null, streamOpen: false });
    expect(engine.foregroundActive()).toBe(false);
    const f = feed();
    const h = engine.speak({ speakerId: 'cw_chief', chunks: f });
    expect(engine.activity('cw_chief')).toMatchObject({ conversation: true, remainingMs: null, streamOpen: true });
    expect(engine.foregroundActive()).toBe(true);
    f.push(fakeClip(1));
    await settle();
    expect(engine.activity('cw_chief').remainingMs).toBe(1000);
    await play(0.53);
    expect(engine.activity('cw_chief').remainingMs).toBe(500);
    f.close();
    await settle();
    expect(engine.activity('cw_chief').streamOpen).toBe(false);
    await play(0.6);
    await h.done;
    expect(engine.activity('cw_chief')).toMatchObject({ conversation: false, remainingMs: null });
    expect(engine.foregroundActive()).toBe(false);
    expect(engine.activity('cw_other').conversation).toBe(false);
  });

  it('estimates browser speech still to come', async () => {
    const { engine } = setup();
    engine.speak({ speakerId: 'cw_chief', chunks: 'Fourteen chars. And fourteen more.' });
    await settle();
    const r = engine.activity('cw_chief');
    expect(r.conversation).toBe(true);
    expect(r.streamOpen).toBe(false);
    expect(r.remainingMs).toBeGreaterThan(1500);
  });
});

describe('stopReflexes and barge-in', () => {
  it('stops by speaker and bus; stopSpeaker and stopAll silence reflexes too', async () => {
    const { engine, play } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(2));
    const amb = engine.playPrepared({ speakerId: 'cw_a', audio: clip, bus: 'ambient', gainDb: -6, priority: 6, ttlMs: 500 });
    await play(0.1);
    engine.stopReflexes({ bus: 'reflex' });
    expect(engine.activity('cw_a').ambient).toBe(true);
    engine.stopReflexes({ speakerId: 'cw_b' });
    expect(engine.activity('cw_a').ambient).toBe(true);
    engine.stopReflexes({ speakerId: 'cw_a', bus: 'ambient' });
    expect(await amb.done).toBe('stopped');
    const r = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: 0, priority: 2, ttlMs: 500 });
    engine.stopSpeaker('cw_chief');
    expect(await r.done).toBe('stopped');
    const r2 = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: 0, priority: 2, ttlMs: 500 });
    engine.stopAll();
    expect(await r2.done).toBe('stopped');
  });
});

describe('lip sync of prepared audio', () => {
  it('follows provider alignment first', async () => {
    const { engine, ctx, play, now } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(0.6), { alignment: { chars: ['m', 'a', 's'], startsMs: [0, 200, 400], endsMs: [200, 400, 600] }, text: 'mas' });
    const face = engine.sampler('cw_chief');
    const h = engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: 0, priority: 2, ttlMs: 500 });
    ctx().analysers[0]!.db = -30;
    await play(SCHEDULE_LEAD_S + 0.05);
    expect(face.sample(now())).toMatchObject({ shape: 'CLOSED', source: 'alignment', heard: true });
    await play(0.2);
    expect(face.sample(now()).shape).toBe('OPEN_WIDE');
    await play(0.5);
    expect(await h.done).toBe('completed');
    expect(face.sample(now())).toMatchObject({ openness: 0, done: true });
  });

  it('text-times the mouth over the clip without alignment, and uses energy without text', async () => {
    const { engine, ctx, play, now } = setup();
    await engine.arm();
    const timed = await engine.prepare(fakeClip(1), { text: 'Mama made a banana bread.' });
    const face = engine.sampler('cw_chief');
    engine.playPrepared({ speakerId: 'cw_chief', audio: timed, bus: 'reflex', gainDb: 0, priority: 2, ttlMs: 500 });
    ctx().analysers[0]!.db = -30;
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      await play(0.04);
      const m = face.sample(now());
      if (m.source === 'timeline') seen.add(m.shape!);
    }
    expect(seen.size).toBeGreaterThan(2);
    await play(0.5);
    const bare = await engine.prepare(fakeClip(0.5));
    engine.playPrepared({ speakerId: 'cw_chief', audio: bare, bus: 'reflex', gainDb: 0, priority: 2, ttlMs: 500 });
    await play(0.1);
    const m = face.sample(now());
    expect(m.source).toBe('spectrum');
    expect(m.openness).toBeGreaterThan(0);
  });

  it('a backchannel through the owner’s pause moves the mouth (it is heard), a ducked answer does not', async () => {
    const { engine, ctx, play, now } = setup();
    await engine.arm();
    const clip = await engine.prepare(fakeClip(0.5), { text: 'Mm-hm.' });
    engine.duck(true);
    engine.playPrepared({ speakerId: 'cw_chief', audio: clip, bus: 'reflex', gainDb: -8, priority: 5, ttlMs: 500, duringOwner: true });
    ctx().analysers[0]!.db = -30;
    await play(0.15);
    expect(engine.sampler('cw_chief').sample(now()).heard).toBe(true);
  });
});

describe('speakReflexText (keyless)', () => {
  it('speaks in the browser voice with a text-timed mouth, and never counts as speaking', async () => {
    const { engine, synth, now } = setup();
    let started = false;
    const h = engine.speakReflexText({ speakerId: 'cw_chief', text: 'On it.', bus: 'reflex', priority: 2, ttlMs: 800, onStart: () => (started = true) })!;
    await settle();
    expect(synth.spoken).toEqual(['On it.']);
    expect(started).toBe(true);
    expect(await h.started).toBe(true);
    expect(engine.sampler('cw_chief').sample(now()).source).toBe('text');
    expect(engine.speaking()).toEqual([]);
    expect(engine.activity('cw_chief').reflex).toBe(true);
    synth.finish();
    expect(await h.done).toBe('completed');
    expect(engine.activity('cw_chief').reflex).toBe(false);
  });

  it('is null without speechSynthesis, drops past its ttl, and follows the ladder', async () => {
    expect(setup({ speechSynthesis: null }).engine.speakReflexText({ speakerId: 'a', text: 'Hi.', bus: 'reflex', priority: 2, ttlMs: 500 })).toBeNull();

    const stuck = setup();
    stuck.synth.speak = (u: FakeUtterance) => void stuck.synth.spoken.push(u.text); // never starts
    const h = stuck.engine.speakReflexText({ speakerId: 'a', text: 'Hi.', bus: 'reflex', priority: 2, ttlMs: 400 })!;
    await stuck.play(0.41);
    expect(await h.done).toBe('dropped');
    expect(await h.started).toBe(false);

    const { engine, synth, play } = setup();
    await engine.arm();
    engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(2)) });
    await settle();
    await play(0.1);
    const other = engine.speakReflexText({ speakerId: 'cw_jelena', text: 'Hello.', bus: 'reflex', priority: 1, ttlMs: 500 })!;
    expect(await other.done).toBe('dropped');
    expect(synth.spoken).toEqual([]);
    engine.duck(true);
    engine.stopAll();
    expect(await engine.speakReflexText({ speakerId: 'cw_jelena', text: 'Hello.', bus: 'reflex', priority: 1, ttlMs: 500 })!.done).toBe('dropped');
  });

  it('an answer’s audio waits for its own speaker’s browser-voice reflex', async () => {
    const { engine, synth, ctx, play } = setup();
    await engine.arm();
    const r = engine.speakReflexText({ speakerId: 'cw_chief', text: 'Hmm, one second.', bus: 'reflex', priority: 3, ttlMs: 800 })!;
    await settle();
    engine.speak({ speakerId: 'cw_chief', chunks: list(fakeClip(1)) });
    await settle();
    expect(ctx().sources).toHaveLength(0);
    synth.finish();
    expect(await r.done).toBe('completed');
    await play(INTERJECT_GAP_S + 0.01);
    expect(ctx().sources).toHaveLength(1);
  });
});

describe('owner VAD', () => {
  it('turns a scripted mic level trace into start, pause, resume and end', async () => {
    const devices = fakeMediaDevices();
    const { engine, ctx, play } = setup({ mediaDevices: devices, MediaRecorder: FakeRecorder as unknown as AudioEngineDeps['MediaRecorder'], secureContext: true });
    const events: OwnerVadEvent[] = [];
    const off = engine.onOwnerVad((e) => events.push(e));
    const session = await engine.startPushToTalk();
    const mic = ctx().analysers.at(-1)!;
    const steps = async (sample: number, ms: number) => {
      mic.sample = sample;
      for (let i = 0; i < ms / 50; i++) await play(0.05);
    };
    await steps(0, 200); // silence before speaking: nothing
    expect(events).toEqual([]);
    await steps(0.1, 2000); // −20 dBFS: speaking
    expect(events.map((e) => e.kind)).toEqual(['start']);
    expect(events[0]!.utteranceMs).toBe(0);
    await steps(0, 200); // a short dip is not a pause
    await steps(0.00117, 300); // between the thresholds: still speaking
    await steps(0.1, 500);
    expect(events.map((e) => e.kind)).toEqual(['start']);
    await steps(0, 600);
    expect(events.map((e) => e.kind)).toEqual(['start', 'pause']);
    const pause = events[1]!;
    expect(pause.pauseMs).toBeGreaterThanOrEqual(VAD_PAUSE_MS);
    expect(pause.pauseMs).toBeLessThan(VAD_PAUSE_MS + 60);
    expect(pause.utteranceMs).toBeGreaterThan(3000);
    expect(pause.at).toBeGreaterThan(WALL0);
    await steps(0.1, 100);
    expect(events.map((e) => e.kind)).toEqual(['start', 'pause', 'resume']);
    await session.stop();
    await settle();
    expect(events.map((e) => e.kind)).toEqual(['start', 'pause', 'resume', 'end']);
    await steps(0.1, 200); // nothing after the session ended
    expect(events).toHaveLength(4);
    off();
  });

  it('emits nothing for browser dictation and stops with destroy()', async () => {
    const devices = fakeMediaDevices();
    const { engine, ctx, play } = setup({ mediaDevices: devices, MediaRecorder: FakeRecorder as unknown as AudioEngineDeps['MediaRecorder'], secureContext: true });
    const events: OwnerVadEvent[] = [];
    engine.onOwnerVad((e) => events.push(e));
    await engine.startPushToTalk();
    ctx().analysers.at(-1)!.sample = 0.1;
    await play(0.05);
    engine.destroy();
    expect(events.map((e) => e.kind)).toEqual(['start', 'end']);
  });
});
