import { describe, expect, it } from 'vitest';
import { FakeBuffer } from '../test/fakes';
import { analyzeBuffer, classifyFrame, featuresFromFloatFreq, segmentSpeech, warpTimelineToSegments, type FeatureFrame } from './audio-features';
import { DEAD_TAP_MS, SpectrumReader, TEXT_OVERRUN_MS, UtteranceSampler } from './sampler';
import { alignmentToVisemeSequence, mouthFromParams, textToVisemeSequence, VISEMES } from './visemes';

describe('audio features (ported from PG audio-features.js)', () => {
  it('treats -Infinity bins as silence and loud bins as voiced', () => {
    const silent = featuresFromFloatFreq(new Float32Array(256).fill(-Infinity), 48000);
    expect(silent.voiced).toBe(false);
    expect(silent.energy).toBeLessThan(0.02);
    const loud = featuresFromFloatFreq(new Float32Array(256).fill(-30), 48000);
    expect(loud.voiced).toBe(true);
    expect(loud.energy).toBeGreaterThan(0.5);
    expect(loud.low + loud.mid + loud.high).toBeLessThanOrEqual(1);
  });

  it('classifies sibilance, back vowels and silence', () => {
    expect(classifyFrame({ energy: 0.5, low: 0.1, mid: 0.2, high: 0.6, centroid: 6000, voiced: true }).viseme).toBe('TEETH');
    expect(classifyFrame({ energy: 0.5, low: 0.6, mid: 0.2, high: 0.05, centroid: 700, voiced: true }).viseme).toBe('ROUND');
    expect(classifyFrame({ energy: 0.5, low: 0.1, mid: 0.5, high: 0.1, centroid: 2200, voiced: true }).viseme).toBe('WIDE');
    expect(classifyFrame({ energy: 0, low: 0, mid: 0, high: 0, centroid: 0, voiced: false })).toEqual({ viseme: 'REST', openScale: 0, voiced: false });
  });

  it('analyses a decoded clip and finds its voiced segment', () => {
    const buf = new FakeBuffer(0.5, 8000);
    const data = buf.getChannelData();
    data.fill(0, 0, 800); // 100 ms of leading silence
    const frames = analyzeBuffer(buf);
    expect(frames.length).toBeGreaterThan(10);
    expect(frames[0]!.voiced).toBe(false);
    const segs = segmentSpeech(frames);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.startMs).toBeGreaterThanOrEqual(60);
    expect(segs[0]!.startMs).toBeLessThanOrEqual(120);
  });

  it('warps a text timeline onto speech so nothing is articulated in silence', () => {
    const seq = textToVisemeSequence('mama', 400);
    const warped = warpTimelineToSegments(seq, [
      { startMs: 100, endMs: 200 },
      { startMs: 300, endMs: 400 },
    ]);
    const spoken = warped.filter((e) => e.viseme !== 'REST');
    for (const e of spoken) {
      const inSpeech = (e.time >= 100 && e.time < 200) || (e.time >= 300 && e.time < 400);
      expect(inSpeech).toBe(true);
    }
    expect(warped.some((e) => e.viseme === 'REST' && e.time >= 199 && e.time < 201)).toBe(true);
  });

  it('segmentSpeech bridges short gaps and drops blips', () => {
    const f = (t: number, voiced: boolean): FeatureFrame => ({ t, voiced, energy: voiced ? 0.5 : 0, low: 0, mid: 0, high: 0, centroid: 0 });
    const frames = [f(0, true), f(20, true), f(40, true), f(60, false), f(80, true), f(100, true), f(120, false), f(400, true)];
    expect(segmentSpeech(frames, { gapMs: 180, minMs: 60 })).toEqual([{ startMs: 0, endMs: 120 }]);
  });
});

describe('visemes (ported from PG face-lipsync.js)', () => {
  it('maps text and digraphs to shapes', () => {
    expect(textToVisemeSequence('the moon', 800).map((e) => e.viseme)).toEqual(['TONGUE', 'OPEN_MED', 'WIDE', 'REST', 'CLOSED', 'ROUND', 'TONGUE']);
    expect(textToVisemeSequence('', 100)).toEqual([]);
  });

  it('turns provider alignment into timed shapes', () => {
    const seq = alignmentToVisemeSequence({ chars: ['M', 'a', 'a'], startsMs: [0, 100, 200], endsMs: [100, 200, 300] });
    expect(seq).toEqual([
      { viseme: 'CLOSED', time: 0, duration: 100 },
      { viseme: 'OPEN_WIDE', time: 100, duration: 200 },
    ]);
    expect(alignmentToVisemeSequence({ chars: ['a'], startsMs: [], endsMs: [] })).toBeNull();
    expect(alignmentToVisemeSequence(null)).toBeNull();
  });

  it('normalises params into 0–1 mouth fields', () => {
    expect(mouthFromParams(VISEMES.REST)).toEqual({ openness: 0, width: 0, round: 0 });
    expect(mouthFromParams(VISEMES.OPEN_WIDE).openness).toBeCloseTo(1);
    expect(mouthFromParams(VISEMES.WIDE).width).toBe(1);
    expect(mouthFromParams(VISEMES.ROUND)).toMatchObject({ round: 1, width: 0 });
    expect(mouthFromParams(VISEMES.CLOSED).openness).toBe(0);
  });
});

describe('SpectrumReader', () => {
  it('normalises quiet taps (AGC) with voiced hysteresis', () => {
    let db = -45; // a quiet tap: raw energy ≈ 0.17
    const reader = new SpectrumReader({ frequencyBinCount: 256, getFloatFrequencyData: (a) => a.fill(db) }, 48000);
    const first = reader.read(1)!;
    expect(first.voiced).toBe(true);
    expect(first.energy).toBeGreaterThan(0.4); // lifted towards AGC_TARGET
    db = -100;
    expect(reader.read(2)!.voiced).toBe(false);
    expect(reader.read(2)).toBe(reader.read(2)); // cached per frame
  });

  it('delays features by the output latency so gating matches what is heard', () => {
    let db = -100;
    const reader = new SpectrumReader({ frequencyBinCount: 256, getFloatFrequencyData: (a) => a.fill(db) }, 48000, () => 250);
    expect(reader.read(1000)).toBeNull(); // nothing rendered 250 ms ago yet
    db = -45; // voice starts rendering at 1016; it is heard at 1266
    for (let t = 1016; t < 1266; t += 16) expect(reader.read(t)?.voiced ?? false).toBe(false);
    expect(reader.read(1272)!.voiced).toBe(true);
    // Below the threshold the tap is read as is.
    const direct = new SpectrumReader({ frequencyBinCount: 256, getFloatFrequencyData: (a) => a.fill(-45) }, 48000, () => 5);
    expect(direct.read(1)!.voiced).toBe(true);
  });
});

describe('UtteranceSampler', () => {
  it('rests before audio, in gaps, and after the end', () => {
    const s = new UtteranceSampler();
    expect(s.sample(0)).toMatchObject({ openness: 0, done: false });
    s.addWindow(100, 200);
    s.addTimeline(textToVisemeSequence('aaaa', 100), 100, 'timeline');
    expect(s.sample(150)).toMatchObject({ shape: 'OPEN_WIDE', source: 'timeline', voiced: true });
    expect(s.sample(250)).toMatchObject({ shape: 'REST', source: 'gap', openness: 0 });
    s.end();
    expect(s.sample(300)).toMatchObject({ done: true, openness: 0 });
  });

  it('never holds the mouth shut on a silent tap, and drops it after DEAD_TAP_MS', () => {
    const reader = new SpectrumReader({ frequencyBinCount: 64, getFloatFrequencyData: (a) => a.fill(-Infinity) }, 48000);
    const s = new UtteranceSampler();
    s.attachSpectrum(reader);
    s.addWindow(0, 10_000);
    s.addTimeline(textToVisemeSequence('a'.repeat(100), 10_000), 0, 'timeline');
    // Mock's silent audio with alignment: the timeline drives from the first frame (it used to stay shut ~0.7 s).
    expect(s.sample(16)).toMatchObject({ shape: 'OPEN_WIDE', source: 'timeline', voiced: true });
    expect(s.sample(DEAD_TAP_MS + 16).shape).toBe('OPEN_WIDE'); // judged dead in time, not frames
    expect(s.sample(DEAD_TAP_MS + 32).shape).toBe('OPEN_WIDE');
  });

  it('lets a live tap gate the mouth once it has carried voice', () => {
    let db = -45;
    const reader = new SpectrumReader({ frequencyBinCount: 256, getFloatFrequencyData: (a) => a.fill(db) }, 48000);
    const s = new UtteranceSampler();
    s.attachSpectrum(reader);
    s.addWindow(0, 10_000);
    s.addTimeline(textToVisemeSequence('a'.repeat(100), 10_000), 0, 'timeline');
    expect(s.sample(16).voiced).toBe(true);
    db = -100; // a real pause in the audio
    expect(s.sample(32)).toMatchObject({ shape: 'REST', voiced: false });
  });

  it('keeps moving a little past the text estimate, then rests even without an end event', () => {
    const s = new UtteranceSampler();
    s.startText('hi', 0, 1);
    const shapes = new Set<string>();
    for (let t = 400; t < 1000; t += 50) shapes.add(s.sample(t).shape!);
    expect(shapes).toEqual(new Set(['OPEN_SMALL', 'CLOSED']));
    // 'hi' is ~143 ms at 14 cps: well past estimate + TEXT_OVERRUN_MS a stalled synthesiser leaves the mouth at rest.
    expect(s.sample(143 + TEXT_OVERRUN_MS + 100)).toMatchObject({ shape: 'REST', voiced: false });
    s.endText();
    expect(s.sample(2000)).toMatchObject({ shape: 'REST', source: 'gap' });
  });
});
