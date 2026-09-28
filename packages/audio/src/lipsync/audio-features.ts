// Ported from personagram-ai/src/web/avatar/audio-features.js (DOM-free spectral features for lip sync).
//
// Turns raw audio into per-frame features a mouth sampler maps to shapes:
//   band energies     low (jaw-open vowels), mid (vowel body), high (sibilants)
//   spectral centroid front vs back vowel discrimination (WIDE vs ROUND)
//   energy envelope   timing without timestamps
//
// LIVE: featuresFromFloatFreq() on AnalyserNode.getFloatFrequencyData output, once per frame.
// OFFLINE: analyzeBuffer() on a decoded clip before it plays; with segmentSpeech() +
// warpTimelineToSegments() a text-derived viseme timeline is re-timed onto the actual speech.

import type { VisemeId } from '@headcount/protocol';

export interface AudioFeatures {
  energy: number;
  low: number;
  mid: number;
  high: number;
  centroid: number;
  voiced: boolean;
}

export interface FeatureFrame extends AudioFeatures {
  /** Frame start, ms from the start of the clip. */
  t: number;
}

export interface SpeechSegment {
  startMs: number;
  endMs: number;
}

export interface VisemeSegment {
  viseme: VisemeId;
  /** ms from the start of the clip */
  time: number;
  duration: number;
}

export interface FrameClass {
  /** null = no override, keep the timeline's shape. */
  viseme: VisemeId | null;
  openScale: number;
  voiced: boolean;
}

/** Minimal AudioBuffer shape (decoded clip). */
export interface ChannelSource {
  getChannelData(channel: number): Float32Array;
  readonly sampleRate: number;
}

export const BANDS = {
  low: [80, 400], // fundamental + first formant → jaw openness
  mid: [400, 2000], // vowel formants
  high: [4000, 10000], // sibilance / fricatives → TEETH
} as const;

const SILENCE_DB = -70; // getFloatFrequencyData floor clamp (-Infinity on silence)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Features from AnalyserNode.getFloatFrequencyData output (dB values). Safari reports -Infinity for
 * silent bins; those clamp to −70 dB.
 */
export function featuresFromFloatFreq(freqDb: ArrayLike<number>, sampleRate: number): AudioFeatures {
  const bins = freqDb.length;
  const hzPerBin = sampleRate / 2 / Math.max(1, bins);
  let total = 0;
  let low = 0;
  let mid = 0;
  let high = 0;
  let centroidNum = 0;
  for (let i = 1; i < bins; i++) {
    const raw = freqDb[i]!;
    const db = clamp(Number.isFinite(raw) ? raw : SILENCE_DB, SILENCE_DB, 0);
    const mag = Math.pow(10, db / 20);
    const e = mag * mag;
    const hz = i * hzPerBin;
    total += e;
    centroidNum += e * hz;
    if (hz >= BANDS.low[0] && hz < BANDS.low[1]) low += e;
    else if (hz >= BANDS.mid[0] && hz < BANDS.mid[1]) mid += e;
    else if (hz >= BANDS.high[0] && hz < BANDS.high[1]) high += e;
  }
  const centroid = total > 0 ? centroidNum / total : 0;
  // Perceptual-ish 0..1: silence floor ≈ 0.0095, speech ≈ 0.2–0.9.
  const energy = clamp(Math.sqrt(total / Math.max(1, bins)) * 30, 0, 1);
  return {
    energy,
    low: total > 0 ? low / total : 0,
    mid: total > 0 ? mid / total : 0,
    high: total > 0 ? high / total : 0,
    centroid,
    voiced: energy > 0.04,
  };
}

/** Per-frame features of a decoded clip (default 20 ms hop, 256-point FFT). */
export function analyzeBuffer(buffer: ChannelSource, hopMs = 20): FeatureFrame[] {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const hop = Math.max(1, Math.round((hopMs / 1000) * rate));
  const N = 256;
  const frames: FeatureFrame[] = [];
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const hzPerBin = rate / N;
  for (let start = 0; start + N <= data.length; start += hop) {
    let rms = 0;
    for (let i = 0; i < N; i++) {
      const s = data[start + i]!;
      rms += s * s;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      re[i] = s * w;
      im[i] = 0;
    }
    rms = Math.sqrt(rms / N);
    fftRadix2(re, im);
    let total = 0;
    let low = 0;
    let mid = 0;
    let high = 0;
    let centroidNum = 0;
    for (let i = 1; i < N / 2; i++) {
      const e = re[i]! * re[i]! + im[i]! * im[i]!;
      const hz = i * hzPerBin;
      total += e;
      centroidNum += e * hz;
      if (hz >= BANDS.low[0] && hz < BANDS.low[1]) low += e;
      else if (hz >= BANDS.mid[0] && hz < BANDS.mid[1]) mid += e;
      else if (hz >= BANDS.high[0] && hz < BANDS.high[1]) high += e;
    }
    const energy = clamp(rms * 6, 0, 1);
    frames.push({
      t: (start / rate) * 1000,
      energy,
      low: total > 0 ? low / total : 0,
      mid: total > 0 ? mid / total : 0,
      high: total > 0 ? high / total : 0,
      centroid: total > 0 ? centroidNum / total : 0,
      voiced: energy > 0.03,
    });
  }
  return frames;
}

/** In-place radix-2 FFT (length must be a power of two). */
export function fftRadix2(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len / 2;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const uRe = re[a]!;
        const uIm = im[a]!;
        const vRe = re[b]! * curRe - im[b]! * curIm;
        const vIm = re[b]! * curIm + im[b]! * curRe;
        re[a] = uRe + vRe;
        im[a] = uIm + vIm;
        re[b] = uRe - vRe;
        im[b] = uIm - vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

/** Voiced segments from analyzeBuffer frames: gaps < gapMs are bridged, blips < minMs dropped. */
export function segmentSpeech(frames: FeatureFrame[], { gapMs = 180, minMs = 60 } = {}): SpeechSegment[] {
  const segs: SpeechSegment[] = [];
  let cur: SpeechSegment | null = null;
  let lastVoicedT = -Infinity;
  const hop = frames.length > 1 ? frames[1]!.t - frames[0]!.t : 20;
  for (const f of frames) {
    if (!f.voiced) continue;
    if (cur && f.t - lastVoicedT <= gapMs) cur.endMs = f.t + hop;
    else {
      if (cur && cur.endMs - cur.startMs >= minMs) segs.push(cur);
      cur = { startMs: f.t, endMs: f.t + hop };
    }
    lastVoicedT = f.t;
  }
  if (cur && cur.endMs - cur.startMs >= minMs) segs.push(cur);
  return segs;
}

/**
 * Re-time a text-derived viseme sequence onto voiced segments so nothing is articulated during
 * silence; REST entries are inserted across gaps over 40 ms. Returns a new sequence.
 */
export function warpTimelineToSegments(seq: VisemeSegment[], segments: SpeechSegment[]): VisemeSegment[] {
  if (!seq.length || !segments.length) return seq;
  const speechTotal = segments.reduce((s, g) => s + (g.endMs - g.startMs), 0);
  if (speechTotal <= 0) return seq;
  const seqTotal = seq.reduce((s, e) => s + e.duration, 0);
  if (seqTotal <= 0) return seq;
  // Adaptation: PG used `<=` for both ends, so a start exactly on a segment boundary landed at the end
  // of the previous segment and the entry stretched across the silence. Starts belong to the next
  // segment, ends to the previous one.
  const toReal = (seqT: number, isEnd: boolean): number => {
    let speechT = (seqT / seqTotal) * speechTotal;
    for (const g of segments) {
      const len = g.endMs - g.startMs;
      if (isEnd ? speechT <= len : speechT < len) return g.startMs + speechT;
      speechT -= len;
    }
    return segments[segments.length - 1]!.endMs;
  };
  const out: VisemeSegment[] = [];
  let acc = 0;
  let lastEnd = 0;
  for (const e of seq) {
    const start = toReal(acc, false);
    const end = toReal(acc + e.duration, true);
    acc += e.duration;
    if (e.viseme === 'REST' && end - start < 1) continue;
    if (start - lastEnd > 40) out.push({ viseme: 'REST', time: lastEnd, duration: start - lastEnd });
    out.push({ viseme: e.viseme, time: start, duration: Math.max(1, end - start) });
    lastEnd = Math.max(lastEnd, end);
  }
  return out;
}

/**
 * Classify a feature frame into a coarse viseme hint + jaw scale: sibilance → TEETH, silence → REST,
 * low band scales the jaw, centroid discriminates ROUND (back vowels) vs WIDE (front vowels).
 */
export function classifyFrame(f: AudioFeatures | null): FrameClass {
  if (!f || !f.voiced) return { viseme: 'REST', openScale: 0, voiced: false };
  if (f.high > 0.45 && f.high > f.low * 1.5) return { viseme: 'TEETH', openScale: 0.5, voiced: true };
  const openScale = clamp(0.5 + f.low * 1.2 + f.energy * 0.6, 0.3, 1.6);
  if (f.centroid > 0 && f.centroid < 1200 && f.low > 0.35) return { viseme: 'ROUND', openScale, voiced: true };
  if (f.centroid >= 1800 && f.mid > 0.3) return { viseme: 'WIDE', openScale, voiced: true };
  return { viseme: null, openScale, voiced: true };
}
