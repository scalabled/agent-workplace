// Hands-free live voice: a pause ends the owner's turn, the mic listens again at once, speaking over the Chief
// interrupts them (once the voice holds), blips are ignored, and ending it closes the mic.
import type { MicSession, OwnerVadEvent } from '@headcount/audio';
import { describe, expect, it } from 'vitest';
import { BARGE_IN_MS, END_OF_TURN_MS, MIN_UTTERANCE_MS, VAD_PAUSE_REPORTED_MS, createLiveVoice, type LiveVoiceState } from './live';

function harness(opts: { speaking?: boolean; transcript?: string } = {}) {
  let t = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const vad = new Set<(e: OwnerVadEvent) => void>();
  const mics: { session: MicSession; stopped: boolean; cancelled: boolean }[] = [];
  const sent: { text: string; at: number }[] = [];
  const states: LiveVoiceState[] = [];
  let barged = 0;
  let speaking = opts.speaking ?? false;
  const live = createLiveVoice({
    engine: {
      async startPushToTalk() {
        const m = { stopped: false, cancelled: false } as { session: MicSession; stopped: boolean; cancelled: boolean };
        m.session = {
          mime: 'audio/webm',
          level: () => 0,
          elapsedMs: () => 0,
          stop: async () => ((m.stopped = true), new Blob(['x'])),
          cancel: () => void (m.cancelled = true),
        };
        mics.push(m);
        return m.session;
      },
      onOwnerVad(cb) {
        vad.add(cb);
        return () => vad.delete(cb);
      },
    },
    transcribe: async () => opts.transcript ?? 'Find me a supplier',
    send: async (text, at) => void sent.push({ text, at }),
    speaking: () => speaking,
    bargeIn: () => {
      barged++;
      speaking = false;
    },
    schedule: (fn, ms) => {
      const timer = { at: t + ms, fn, live: true };
      timers.push(timer);
      return () => void (timer.live = false);
    },
    now: () => t,
    onState: (s) => void states.push(s),
    onError: (err) => {
      throw err;
    },
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const advance = async (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = timers.filter((x) => x.live && x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      t = next.at;
      next.live = false;
      next.fn();
      await settle();
    }
    t = end;
    await settle();
  };
  const emit = (kind: OwnerVadEvent['kind']) => {
    for (const cb of [...vad]) cb({ kind, at: t, utteranceMs: 0, ...(kind === 'pause' ? { pauseMs: VAD_PAUSE_REPORTED_MS } : {}) });
  };
  return { live, mics, sent, states, emit, advance, settle, barged: () => barged, setSpeaking: (v: boolean) => (speaking = v), vad };
}

describe('live voice (hands-free)', () => {
  it('a pause ends the turn: it is transcribed and sent, and the mic listens again at once', async () => {
    const h = harness();
    await h.live.start();
    expect(h.states.at(-1)!.phase).toBe('listening');
    h.emit('start');
    expect(h.states.at(-1)!.phase).toBe('hearing');
    await h.advance(1200);
    h.emit('pause'); // reported after 350 ms of quiet
    await h.advance(END_OF_TURN_MS - VAD_PAUSE_REPORTED_MS - 10);
    expect(h.sent).toHaveLength(0); // not yet: they may go on
    h.emit('resume');
    await h.advance(500);
    h.emit('pause');
    await h.advance(END_OF_TURN_MS);
    expect(h.sent.map((s) => s.text)).toEqual(['Find me a supplier']);
    expect(h.mics).toHaveLength(2);
    expect(h.mics[0]!.stopped).toBe(true);
    expect(h.mics[1]!.stopped || h.mics[1]!.cancelled).toBe(false);
    expect(h.states.at(-1)).toMatchObject({ phase: 'listening', turns: 1 });
  });

  it('a blip is not a turn', async () => {
    const h = harness();
    await h.live.start();
    h.emit('start');
    await h.advance(MIN_UTTERANCE_MS - 100 + VAD_PAUSE_REPORTED_MS); // voiced for less than the minimum, then quiet
    h.emit('pause');
    await h.advance(END_OF_TURN_MS);
    expect(h.sent).toHaveLength(0);
    expect(h.mics[0]!.cancelled).toBe(true);
    expect(h.mics).toHaveLength(2);
  });

  it('speaking over the Chief interrupts them once the voice holds; a breath does not', async () => {
    const h = harness({ speaking: true });
    await h.live.start();
    h.emit('start');
    await h.advance(BARGE_IN_MS - 100);
    h.emit('pause'); // a breath
    await h.advance(200);
    expect(h.barged()).toBe(0);
    h.emit('resume');
    await h.advance(BARGE_IN_MS + 10);
    expect(h.barged()).toBe(1);
  });

  it('ending it closes the mic and stops listening', async () => {
    const h = harness();
    await h.live.start();
    h.emit('start');
    h.live.stop();
    expect(h.mics[0]!.cancelled).toBe(true);
    expect(h.vad.size).toBe(0);
    expect(h.states.at(-1)!.phase).toBe('off');
    await h.advance(5000);
    expect(h.sent).toHaveLength(0);
  });
});
