// Mouth samplers: the one coupling between what plays and a face (MouthSampler.sample(now)).
// Source fusion and level normalisation ported from personagram-ai/src/web/avatar/viseme-driver.js
// (AGC + voiced hysteresis, spectral corrections, dead-analyser detection); the text-timed mode for
// browser speech follows oncloudnine's "fail soft to text visemes" (shared/Modules/SpeechOutput.ts).

import { REST_SAMPLE, type MouthSample, type MouthSampler, type VisemeId, type VisemeParams } from '@headcount/protocol';
import { classifyFrame, featuresFromFloatFreq, type AudioFeatures, type VisemeSegment } from './audio-features';
import { cleanForVisemes, mouthFromParams, VISEMES, visemeForChar } from './visemes';

/** Level normalisation of the live spectrum: the recent peak maps to AGC_TARGET. */
export const AGC_TARGET = 0.45;
const AGC_MAX_GAIN = 12;
/** Per-read decay of the tracked peak (≈60 reads/s → halves in about 20 s). */
const AGC_DECAY = 0.9994;
const VOICED_ON = 0.06;
const VOICED_OFF = 0.035;
/** Raw energy below this (digital silence reads ≈0.0095) or below PEAK_FRACTION of the peak is never voiced. */
const NOISE_FLOOR = 0.016;
const PEAK_FRACTION = 0.12;
/**
 * In-window time without a single voiced read, with a timeline to play, before a tap is judged dead (iOS
 * silent taps, Mock's silent audio). Measured in time, not frames, so a 30 fps tile decides as fast as a hero.
 */
export const DEAD_TAP_MS = 400;
/** Below this output latency the analyser is read as is; above it, its features are delayed to match the ear. */
export const SPECTRUM_DELAY_MIN_MS = 15;
/** A delayed feature older than this before its target time is stale (sampling paused): none is used. */
const SPECTRUM_MAX_GAP_MS = 120;
/** Browser speech: how long the open/close rhythm may run past the text estimate before the mouth rests. */
export const TEXT_OVERRUN_MS = 1500;
/** Browser speech: default and clamp for characters per second at rate 1. */
export const TEXT_CPS = 14;
const CPS_MIN = 8;
const CPS_MAX = 26;

/** The buffer type AnalyserNode accepts (generic in newer DOM libs, plain in older ones). */
type FreqBuffer = Parameters<AnalyserNode['getFloatFrequencyData']>[0];

/** Minimal AnalyserNode shape (so tests can fake it). */
export interface AnalyserLike {
  readonly frequencyBinCount: number;
  getFloatFrequencyData(array: FreqBuffer): void;
}

/**
 * Reads one speaker's analyser tap, normalised (AGC + hysteresis). Reads are cached per `now`, so
 * several faces sampling the same speaker in one frame see one value and decay the peak once.
 *
 * The analyser holds the audio being rendered now, which the owner hears one output latency later, while the
 * timeline and windows are in heard time. So with `latencyMs` above SPECTRUM_DELAY_MIN_MS, `read(now)` returns
 * the features read `latencyMs` earlier: gating and jaw scale line up with the sound on Bluetooth too.
 */
export class SpectrumReader {
  private buf: FreqBuffer | null = null;
  private peak = 0;
  private voicedState = false;
  private lastNow = Number.NaN;
  private last: AudioFeatures | null = null;
  private history: { at: number; f: AudioFeatures | null }[] = [];

  constructor(
    readonly analyser: AnalyserLike,
    private readonly sampleRate: number,
    private readonly latencyMs: () => number = () => 0,
  ) {}

  read(now: number): AudioFeatures | null {
    if (now === this.lastNow) return this.last;
    this.lastNow = now;
    const current = this.readNow();
    let lat = 0;
    try {
      lat = Math.max(0, this.latencyMs() || 0);
    } catch {
      lat = 0;
    }
    if (lat < SPECTRUM_DELAY_MIN_MS) {
      this.history.length = 0;
      return (this.last = current);
    }
    this.history.push({ at: now, f: current });
    const target = now - lat;
    // Keep the newest entry at or before the target at the head; drop older ones.
    while (this.history.length > 1 && this.history[1]!.at <= target) this.history.shift();
    const head = this.history[0]!;
    return (this.last = head.at <= target && target - head.at <= SPECTRUM_MAX_GAP_MS ? head.f : null);
  }

  /** Forget the level history (new speaker voice, long silence). */
  reset(): void {
    this.peak = 0;
    this.voicedState = false;
    this.lastNow = Number.NaN;
    this.last = null;
    this.history = [];
  }

  private readNow(): AudioFeatures | null {
    const a = this.analyser;
    if (!this.buf || this.buf.length !== a.frequencyBinCount) this.buf = new Float32Array(a.frequencyBinCount) as FreqBuffer;
    try {
      a.getFloatFrequencyData(this.buf);
    } catch {
      return null;
    }
    return this.normalize(featuresFromFloatFreq(this.buf, this.sampleRate || 48000));
  }

  private normalize(raw: AudioFeatures): AudioFeatures {
    this.peak = Math.max(raw.energy, this.peak * AGC_DECAY);
    const gain = Math.min(AGC_MAX_GAIN, Math.max(1, AGC_TARGET / Math.max(this.peak, 0.02)));
    const energy = Math.min(1, raw.energy * gain);
    const aboveFloor = raw.energy > NOISE_FLOOR && raw.energy > this.peak * PEAK_FRACTION;
    this.voicedState = aboveFloor && (this.voicedState ? energy > VOICED_OFF : energy > VOICED_ON);
    return { ...raw, energy, voiced: this.voicedState };
  }
}

interface TimedViseme {
  start: number;
  end: number;
  viseme: VisemeId;
}

interface Window {
  start: number;
  end: number;
}

interface TextTrack {
  chars: VisemeId[];
  anchorIndex: number;
  anchorAt: number;
  startedAt: number;
  cps: number;
}

export type UtterancePhase = 'pending' | 'playing' | 'ended';

/**
 * The mouth for one utterance. Fed by the engine as it schedules audio (absolute performance-time
 * windows, viseme timelines from alignment or text re-timed onto the decoded clip, a live analyser
 * tap) or as browser speech runs (text timing, re-anchored on word boundaries).
 */
export class UtteranceSampler implements MouthSampler {
  phase: UtterancePhase = 'pending';
  private spectrum: SpectrumReader | null = null;
  private timeline: TimedViseme[] = [];
  private windows: Window[] = [];
  private text: TextTrack | null = null;
  private smoothedEnergy = 0;
  private everVoiced = false;
  /** When the tap was first read unvoiced in a window, before it ever carried voice (dead-tap detection). */
  private silentSince: number | null = null;
  private timelineSource: 'alignment' | 'timeline' = 'timeline';
  private lastNow = Number.NaN;
  private lastHeard = true;
  private last: MouthSample | null = null;

  constructor(private readonly heard: () => boolean = () => true) {}

  attachSpectrum(reader: SpectrumReader | null): void {
    this.last = null;
    this.spectrum = reader;
    this.everVoiced = false;
    this.silentSince = null;
  }

  /** Audio is scheduled to be heard from `start` to `end` (performance.now() ms). */
  addWindow(start: number, end: number): void {
    this.last = null;
    this.windows.push({ start, end });
    if (this.phase === 'pending') this.phase = 'playing';
  }

  /** A clip-relative viseme sequence whose t=0 is heard at `offset` (performance.now() ms). */
  addTimeline(seq: readonly VisemeSegment[], offset: number, source: 'alignment' | 'timeline'): void {
    this.last = null;
    for (const e of seq) this.timeline.push({ start: offset + e.time, end: offset + e.time + e.duration, viseme: e.viseme });
    this.timeline.sort((a, b) => a.start - b.start);
    if (source === 'alignment') this.timelineSource = 'alignment';
  }

  /** Browser speech started speaking `text` at `now`. */
  startText(text: string, now: number, rate = 1): void {
    this.last = null;
    const clean = cleanForVisemes(text);
    const chars: VisemeId[] = [];
    for (let i = 0; i < clean.length; i++) chars.push(visemeForChar(clean[i]!, clean[i + 1]));
    const cps = Math.min(CPS_MAX, Math.max(CPS_MIN, TEXT_CPS * (rate || 1)));
    this.text = { chars, anchorIndex: 0, anchorAt: now, startedAt: now, cps };
    this.phase = 'playing';
  }

  /** A word boundary from speechSynthesis: re-anchor the text cursor and learn the real pace. */
  boundary(charIndex: number, now: number): void {
    this.last = null;
    const t = this.text;
    if (!t || !(charIndex >= 0)) return;
    const elapsed = now - t.startedAt;
    if (charIndex >= 3 && elapsed > 150) {
      const measured = Math.min(CPS_MAX, Math.max(CPS_MIN, (charIndex / elapsed) * 1000));
      t.cps += (measured - t.cps) * 0.3;
    }
    t.anchorIndex = Math.min(t.chars.length, charIndex);
    t.anchorAt = now;
  }

  /** Browser speech segment finished (the utterance may continue with more audio). */
  endText(): void {
    this.last = null;
    this.text = null;
  }

  end(): void {
    this.last = null;
    this.phase = 'ended';
    this.text = null;
  }

  /** Idempotent per `now`: several faces may sample one utterance in the same frame. */
  sample(now: number): MouthSample {
    if (this.phase === 'ended') return REST_SAMPLE;
    if (this.phase === 'pending') return { ...REST_SAMPLE, done: false };
    const heard = this.heard();
    if (this.last && now === this.lastNow && heard === this.lastHeard) return this.last;
    this.lastNow = now;
    this.lastHeard = heard;
    return (this.last = this.compute(now, heard));
  }

  private compute(now: number, heard: boolean): MouthSample {
    let name: VisemeId;
    let voiced: boolean;
    let source: string;
    let openScale = 1;
    let targetEnergy: number;

    if (this.text) {
      const t = this.text;
      const pos = t.anchorIndex + ((now - t.anchorAt) / 1000) * t.cps;
      const estimateEnd = t.anchorAt + (Math.max(0, t.chars.length - t.anchorIndex) / t.cps) * 1000;
      if (pos < t.chars.length) name = t.chars[Math.max(0, Math.floor(pos))]!;
      else if (now < estimateEnd + TEXT_OVERRUN_MS) {
        // Speech is still going past our estimate: keep a gentle open/close rhythm for a little while.
        name = Math.floor((now - t.startedAt) / 140) % 2 === 0 ? 'OPEN_SMALL' : 'CLOSED';
      } else {
        // Far past the estimate with no end event (a stalled or cut-off synthesiser): the mouth rests, since
        // mouths move only while audio plays.
        name = 'REST';
      }
      voiced = name !== 'REST';
      source = 'text';
      const wobble = 0.5 + 0.5 * Math.sin((now - t.startedAt) / 45);
      targetEnergy = voiced ? 0.35 + 0.35 * mouthFromParams(VISEMES[name]).openness + 0.15 * wobble : 0.05;
    } else if (this.inWindow(now)) {
      let feat = this.spectrum?.read(now) ?? null;
      if (feat && this.spectrum) {
        if (feat.voiced) {
          this.everVoiced = true;
          this.silentSince = null;
        } else if (!this.everVoiced && this.timeline.length) {
          this.silentSince ??= now;
          if (now - this.silentSince >= DEAD_TAP_MS) {
            this.spectrum = null; // dead-from-birth tap: trust the timeline
            feat = null;
          }
        }
      }
      const tl = this.timelineAt(now);
      // With a timeline, the spectrum gates the mouth only once the tap has carried voice: a silent tap (Mock
      // audio, an iOS dead tap) never holds the mouth shut while it is being judged.
      const gating = !!feat && (this.everVoiced || !this.timeline.length);
      const cls = gating ? classifyFrame(feat!) : null;
      voiced = gating ? feat!.voiced : tl !== null ? tl !== 'REST' : feat ? feat.voiced : true;
      name = tl ?? (voiced ? 'OPEN_SMALL' : 'REST');
      source = tl ? this.timelineSource : feat ? 'spectrum' : 'energy';
      if (cls) {
        if (!cls.voiced) name = 'REST';
        else if (cls.viseme === 'TEETH') name = 'TEETH';
        else if (cls.viseme && (name === 'OPEN_SMALL' || name === 'OPEN_MED')) name = cls.viseme;
        openScale = cls.voiced ? cls.openScale : 0;
      }
      targetEnergy = gating ? feat!.energy : voiced ? 0.4 : 0;
    } else {
      // Between chunks (the next sentence is still loading) or before the first one is heard.
      name = 'REST';
      voiced = false;
      source = 'gap';
      targetEnergy = 0;
    }
    this.smoothedEnergy += (targetEnergy - this.smoothedEnergy) * 0.25;
    const shape = name;

    if (!heard) {
      this.smoothedEnergy *= 0.5;
      return { openness: 0, width: 0, round: 0, energy: 0, voiced, done: false, heard: false, params: { ...VISEMES.REST }, shape, source };
    }
    const base = VISEMES[name];
    const params: VisemeParams = {
      openY: base.openY * openScale,
      stretchX: base.stretchX,
      jawDrop: base.jawDrop * openScale,
      cornerPull: base.cornerPull,
      round: base.round,
    };
    const mouth = mouthFromParams(params);
    return { ...mouth, energy: Math.max(0, Math.min(1, this.smoothedEnergy)), voiced, done: false, heard: true, params, shape, source };
  }

  private inWindow(now: number): boolean {
    for (let i = this.windows.length - 1; i >= 0; i--) {
      const w = this.windows[i]!;
      if (now >= w.start && now < w.end) return true;
    }
    return false;
  }

  private timelineAt(now: number): VisemeId | null {
    const tl = this.timeline;
    let lo = 0;
    let hi = tl.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tl[mid]!.start <= now) {
        hit = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (hit < 0) return null;
    const e = tl[hit]!;
    return now < e.end ? e.viseme : null;
  }
}

/** Follows whichever utterance a speaker is currently playing; rests otherwise. */
export class SpeakerSampler implements MouthSampler {
  current: MouthSampler | null = null;
  sample(now: number): MouthSample {
    return this.current ? this.current.sample(now) : REST_SAMPLE;
  }
}
