import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine, DUCK_GAIN } from './engine';
import { baseMime, MIC_MESSAGES, toMicError } from './mic';
import { createPushToTalk, type PushToTalkResult } from './push-to-talk';
import { FakeAudioContext, fakeMediaDevices, FakeRecognition, FakeRecorder } from './test/fakes';
import { MicError, type AudioEngineDeps } from './types';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function setup(extra: Partial<AudioEngineDeps> = {}) {
  let t = 0;
  const devices = fakeMediaDevices();
  const engine = createAudioEngine({
    AudioContext: FakeAudioContext as unknown as new () => AudioContext,
    speechSynthesis: null,
    MediaRecorder: FakeRecorder as unknown as AudioEngineDeps['MediaRecorder'],
    mediaDevices: devices,
    SpeechRecognition: FakeRecognition as unknown as AudioEngineDeps['SpeechRecognition'],
    gestureTarget: null,
    now: () => t,
    ...extra,
  });
  return { engine, devices, advance: (ms: number) => (t += ms), now: () => t };
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  FakeRecorder.instances = [];
  FakeRecognition.instances = [];
});
afterEach(() => vi.useRealTimers());

describe('startPushToTalk', () => {
  it('records webm/opus, meters the level, ducks voices and releases the mic on stop', async () => {
    const { engine, devices, advance } = setup();
    const mic: boolean[] = [];
    engine.onMicChange((on) => mic.push(on));
    const session = await engine.startPushToTalk();
    expect(FakeRecorder.instances[0]!.mimeType).toBe('audio/webm;codecs=opus');
    expect(session.mime).toBe('audio/webm');
    expect(engine.micLive()).toBe(true);
    expect(engine.ducked).toBe(true);
    const ctx = FakeAudioContext.instances[0]!;
    expect(ctx.gains[1]!.gain.value).toBeCloseTo(DUCK_GAIN);

    const meter = ctx.analysers[0]!;
    meter.sample = 0.1; // −20 dBFS
    expect(session.level()).toBeGreaterThan(0.8);
    meter.sample = 0;
    expect(session.level()).toBeLessThan(0.8); // releases, does not snap
    advance(1200);
    expect(session.elapsedMs()).toBe(1200);

    const blob = await session.stop();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('audio/webm');
    expect(await session.stop()).toBe(blob); // idempotent
    expect(devices.streams[0]!.tracks[0]!.stopped).toBe(true);
    expect(engine.micLive()).toBe(false);
    expect(engine.ducked).toBe(false);
    expect(mic).toEqual([true, false]);
  });

  it('cancel discards and releases', async () => {
    const { engine, devices } = setup();
    const session = await engine.startPushToTalk();
    session.cancel();
    expect(devices.streams[0]!.tracks[0]!.stopped).toBe(true);
    expect(engine.micLive()).toBe(false);
    expect(session.level()).toBe(0);
  });

  it('turns permission and device failures into readable sentences', async () => {
    const cases: [string, MicError['code']][] = [
      ['NotAllowedError', 'denied'],
      ['NotFoundError', 'no-device'],
      ['NotReadableError', 'busy'],
      ['SecurityError', 'insecure'],
      ['Weird', 'failed'],
    ];
    for (const [name, code] of cases) {
      const { engine } = setup({ mediaDevices: fakeMediaDevices(name) });
      const err = (await engine.startPushToTalk().catch((e: unknown) => e)) as MicError;
      expect(err).toBeInstanceOf(MicError);
      expect(err.code).toBe(code);
      expect(err.message).toBe(MIC_MESSAGES[code]);
      expect(err.message).toMatch(/\.$/);
      expect(err.message).not.toMatch(/!/);
      expect(engine.ducked).toBe(false);
      expect(engine.micLive()).toBe(false);
    }
    const insecure = setup({ mediaDevices: null, secureContext: false });
    await expect(insecure.engine.startPushToTalk()).rejects.toMatchObject({ code: 'insecure' });
    const noRecorder = setup({ MediaRecorder: null });
    await expect(noRecorder.engine.startPushToTalk()).rejects.toMatchObject({ code: 'unsupported' });
    expect(noRecorder.engine.support().mic).toBe(false);
  });

  it('helpers', () => {
    expect(baseMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(baseMime('audio/mp4')).toBe('audio/mp4');
    expect(baseMime('')).toBe('audio/webm');
    expect(toMicError({ name: 'PermissionDeniedError' }).code).toBe('denied');
  });
});

describe('startDictation', () => {
  it('returns the transcript, restarts when the browser ends early and marks the mic live', async () => {
    const { engine } = setup();
    const partials: string[] = [];
    const d = engine.startDictation({ onPartial: (p) => partials.push(p) })!;
    const rec = FakeRecognition.instances[0]!;
    expect(rec.continuous).toBe(true);
    expect(engine.micLive()).toBe(true);
    expect(engine.ducked).toBe(true);
    rec.emit([['look into', true]]);
    rec.endByItself(); // Chrome ends continuous sessions after a pause
    expect(rec.starts).toBe(2);
    rec.emit([['office chairs', false]]);
    expect(d.partial()).toBe('look into office chairs');
    expect(await d.stop()).toBe('look into office chairs');
    expect(partials.at(-1)).toBe('look into office chairs');
    expect(engine.micLive()).toBe(false);
    expect(engine.ducked).toBe(false);
    expect(await d.stop()).toBe('look into office chairs'); // after the end: resolves at once
  });

  it('reports recognizer errors as sentences', async () => {
    const { engine } = setup();
    const errors: MicError[] = [];
    const d = engine.startDictation({ onError: (e) => errors.push(e) })!;
    FakeRecognition.instances[0]!.onerror?.({ error: 'not-allowed' });
    FakeRecognition.instances[0]!.endByItself();
    expect(errors[0]!.code).toBe('denied');
    expect(d.error()?.message).toBe(MIC_MESSAGES.denied);
    expect(await d.stop()).toBe('');
  });

  it('is null without SpeechRecognition', () => {
    const { engine } = setup({ SpeechRecognition: null });
    expect(engine.startDictation()).toBeNull();
    expect(engine.support().speechRecognition).toBe(false);
  });
});

describe('createPushToTalk', () => {
  function ptt(mode: 'hold' | 'toggle' | 'auto', extra: { dictation?: boolean } = {}) {
    const s = setup();
    const results: PushToTalkResult[] = [];
    const states: string[] = [];
    let short = 0;
    const errors: MicError[] = [];
    const c = createPushToTalk(s.engine, {
      mode,
      now: s.now,
      onResult: (r) => results.push(r),
      onState: (st) => states.push(st),
      onTooShort: () => short++,
      onError: (e) => errors.push(e),
      ...extra,
    });
    return { ...s, c, results, states, errors, short: () => short };
  }

  it('hold: press starts, release sends the recording', async () => {
    const { c, results, states, advance } = ptt('hold');
    c.press();
    await tick();
    expect(c.state).toBe('recording');
    advance(900);
    c.release();
    await tick();
    await tick();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'audio', mime: 'audio/webm', durationMs: 900 });
    expect(states).toEqual(['starting', 'recording', 'finishing', 'idle']);
  });

  it('hold: a blip is discarded', async () => {
    const p = ptt('hold');
    p.c.press();
    await tick();
    p.advance(80);
    p.c.release();
    await tick();
    expect(p.results).toEqual([]);
    expect(p.short()).toBe(1);
    expect(p.engine.micLive()).toBe(false);
  });

  it('hold: releasing while permission is pending sends nothing', async () => {
    const p = ptt('hold');
    p.c.press();
    p.c.release(); // before getUserMedia resolved
    await tick();
    await tick();
    expect(p.results).toEqual([]);
    expect(p.c.state).toBe('idle');
    expect(p.engine.micLive()).toBe(false);
  });

  it('toggle: click starts, the next click sends', async () => {
    const { c, results, advance } = ptt('toggle');
    c.press();
    c.release();
    await tick();
    expect(c.latched).toBe(true);
    expect(c.state).toBe('recording');
    advance(100); // short is fine when latched
    c.press();
    c.release();
    await tick();
    await tick();
    expect(results).toHaveLength(1);
  });

  it('auto: a quick tap latches, a long hold sends on release', async () => {
    const p = ptt('auto');
    p.c.press();
    await tick();
    p.advance(120);
    p.c.release();
    expect(p.c.latched).toBe(true);
    p.advance(2000);
    p.c.press();
    await tick();
    await tick();
    expect(p.results).toHaveLength(1);

    p.c.press();
    await tick();
    p.advance(1500);
    p.c.release();
    await tick();
    await tick();
    expect(p.results).toHaveLength(2);
  });

  it('dictation mode yields text', async () => {
    const p = ptt('hold', { dictation: true });
    p.c.press();
    await tick();
    p.advance(700);
    FakeRecognition.instances[0]!.emit([['how is it going', true]]);
    expect(p.c.partial()).toBe('how is it going');
    p.c.release();
    await tick();
    await tick();
    expect(p.results).toEqual([{ kind: 'text', text: 'how is it going', durationMs: 700 }]);
  });

  it('surfaces a denied mic as a readable error and returns to idle', async () => {
    const s = setup({ mediaDevices: fakeMediaDevices('NotAllowedError') });
    const errors: MicError[] = [];
    const c = createPushToTalk(s.engine, { mode: 'hold', onResult: () => undefined, onError: (e) => errors.push(e) });
    c.press();
    await tick();
    expect(errors[0]!.message).toBe(MIC_MESSAGES.denied);
    expect(c.state).toBe('idle');
  });

  it('cancel discards a recording', async () => {
    const { c, results, engine } = ptt('hold');
    c.press();
    await tick();
    c.cancel();
    c.release();
    await tick();
    expect(results).toEqual([]);
    expect(engine.micLive()).toBe(false);
  });
});
