// The client audio engine (ARCHITECTURE §8.6, EXPERIENCE §5):
//
//   sources → utterance gain (fade on stop) → speaker gain → analyser tap → voices bus → ducker → master → out
//   reflex clips → play gain (gainDb, 60 ms fade) → speaker reflex | ambient bus ↗ (same speaker gain and tap)
//
// One AudioContext for the page, created/resumed in a user gesture (PG armAudio). Every decoded chunk is
// scheduled gaplessly into its speaker's channel, so the analyser tap always hears exactly what plays
// (the OC SpeechOutput.captureTap idea, without media elements). Barge-in by generations
// (PG transports.ts outputGeneration, OC SpeechOutput generation): stopSpeaker() bumps the speaker's
// generation, stops every scheduled and playing source at once (BB only reset a playhead and let sources
// run on) and any chunk that arrives or finishes decoding later is dropped.
//
// Living workforce (Inc 0.5, INC05-PLAN §3.6): short pre-voiced clips play on a per-speaker reflex or ambient
// bus under the same speaker channel, so one mouth tap follows answers and micro-talk alike. Who may sound is a
// ladder, owner > answer > reflex > ambient:
//   1. the owner speaking (mic live) drops reflexes, except a `duringOwner` backchannel, ducked only 6 dB;
//   2. an answer sounding drops other speakers' reflexes; the same speaker may only `interject` at its next
//      chunk boundary (the answer's later chunks move behind the clip);
//   3. an answer starting for a speaker waits for that speaker's reflex, and fades everyone else's;
//   4. one reflex voice at a time (a more important one fades the other);
//   5. ambient only in silence, faded by anything else.
// Reflexes move the mouth but never count as "speaking" (presence stays honest).

import type { Alignment, MouthSampler } from '@headcount/protocol';
import { BrowserVoiceLane } from './browser-voice';
import { SentenceChunker } from './chunker';
import { startRecognition } from './dictation';
import { micError, openRecorder, type RecorderSession } from './mic';
import { analyzeBuffer, segmentSpeech, warpTimelineToSegments, type VisemeSegment } from './lipsync/audio-features';
import { SpeakerSampler, SpectrumReader, TEXT_CPS, UtteranceSampler } from './lipsync/sampler';
import { alignmentToVisemeSequence, textToVisemeSequence } from './lipsync/visemes';
import { speakable } from './speakable';
import type {
  AudioEngine,
  AudioEngineDeps,
  AudioSupport,
  DictationOptions,
  DictationSession,
  MicSession,
  OwnerVadEvent,
  PlayPreparedRequest,
  PreparedAudio,
  ReflexHandle,
  SpeakChunk,
  SpeakerActivity,
  SpeakHandle,
  SpeakOutcome,
  SpeakReflexTextRequest,
  SpeakRequest,
  SpeechChunk,
} from './types';

/** Scheduling lead so the first chunk never starts in the past. */
export const SCHEDULE_LEAD_S = 0.03;
/** Fade applied on stop (click-free, still "at once"). */
export const STOP_FADE_S = 0.015;
/** Owner speech ducks voices by 18 dB (EXPERIENCE §10.7). */
export const DUCK_GAIN = Math.pow(10, -18 / 20);
const DUCK_TIME_CONSTANT_S = 0.01; // ≈30 ms to settle
/** Nothing playing for this long between chunks → the speaker is no longer "speaking". */
export const STARVE_MS = 350;
/** How long speak() waits for a suspended context (autoplay policy) before giving up on audio. */
const RESUME_WAIT_MS = 2500;

/**
 * Lead for a reflex clip played now: a single clip needs no gapless chaining, so it is scheduled closer than an
 * answer chunk (sound starts ≤ 30 ms after playPrepared even with timer jitter; output latency is the device's).
 */
export const REFLEX_LEAD_S = 0.01;
/** Reflex and ambient clips fade out over this when stopped or preempted. */
export const REFLEX_FADE_S = 0.06;
/** While the owner speaks, a `duringOwner` reflex is ducked only this many dB (voices: 18). */
export const OWNER_REFLEX_DUCK_DB = 6;
/** Lift on the reflex bus that turns the voices' 18 dB duck into 6 dB for a `duringOwner` reflex. */
const OWNER_REFLEX_LIFT = Math.pow(10, (18 - OWNER_REFLEX_DUCK_DB) / 20);
/** Silence between a reflex and the answer that waited for it (an interjection, or rule 3). */
export const INTERJECT_GAP_S = 0.15;
/** An answer never waits longer than this for its own speaker's reflex (intent max_ms ≤ 2.5 s). */
export const REFLEX_HOLD_MAX_MS = 2500;
/** Owner VAD (rule 9): mic level sampling and thresholds on its 0–1 scale. */
export const VAD_INTERVAL_MS = 50;
export const VAD_ON = 0.04;
export const VAD_OFF = 0.02;
export const VAD_PAUSE_MS = 350;
/** Sample rate of the decode-only context used before the main context exists. */
const OFFLINE_RATE = 48000;

type ReflexOutcome = 'completed' | 'stopped' | 'dropped';
type ReflexBus = 'reflex' | 'ambient';

interface Channel {
  gain: GainNode;
  analyser: AnalyserNode;
  reader: SpectrumReader;
  sampler: SpeakerSampler;
  /** Created on the first reflex / ambient clip of this speaker. */
  reflexBus: GainNode | null;
  ambientBus: GainNode | null;
  /** Current gain target of the reflex bus (1, or the owner-duck lift). */
  lift: number;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  ducker: GainNode;
  voices: GainNode;
}

/** One decoded chunk of an answer on the audio clock (re-timed by interjections, cut at a boundary). */
interface ChunkRec {
  src: AudioBufferSourceNode;
  buffer: AudioBuffer;
  /** Context time. */
  startAt: number;
  endAt: number;
  /** Heard time (performance.now() ms). */
  perfStart: number;
  perfEnd: number;
  seq: VisemeSegment[] | null;
  seqSource: 'alignment' | 'timeline';
  /** Where sentences (`s`) and clauses (`c`) end inside the chunk (seconds from its start), for stopAtBoundary(). */
  stops: ChunkStop[];
}

/** A place a chunk can end early: the end of a sentence or of a clause (seconds from the chunk's start). */
interface ChunkStop {
  at: number;
  kind: 's' | 'c';
}

/** stopAtBoundary() ends within this long: the sentence playing, else a clause, else a short fade (LIVING-WORKFORCE §2.3). */
export const BOUNDARY_MAX_S = 4;
/** A breath after the sentence's last sound before the cut, and the fade that avoids a click. */
const BOUNDARY_TAIL_S = 0.08;
const BOUNDARY_FADE_S = 0.05;

/**
 * Sentence and clause ends of a chunk: from its character alignment when the provider gave one, else spread over
 * the text by character position (the clip's text-timed estimate).
 */
export function chunkStops(text: string | undefined, alignment: Alignment | null | undefined, durationS: number): ChunkStop[] {
  const out: ChunkStop[] = [];
  const kindOf = (ch: string, next: string | undefined): ChunkStop['kind'] | null => {
    if (next !== undefined && !/\s/.test(next)) return null;
    if (/[.!?…]/.test(ch)) return 's';
    if (/[,;:—–]/.test(ch)) return 'c';
    return null;
  };
  if (alignment?.chars?.length && alignment.endsMs?.length === alignment.chars.length) {
    const cs = alignment.chars;
    for (let i = 0; i < cs.length - 1; i++) {
      const k = kindOf(cs[i]!, cs[i + 1]);
      if (k) out.push({ at: alignment.endsMs[i]! / 1000, kind: k });
    }
    return out;
  }
  const t = (text ?? '').trim();
  if (!t || !(durationS > 0)) return out;
  for (let i = 0; i < t.length - 1; i++) {
    const k = kindOf(t[i]!, t[i + 1]);
    if (k) out.push({ at: ((i + 1) / t.length) * durationS, kind: k });
  }
  return out;
}

/**
 * Where to end a chunk that is sounding at `elapsed` seconds into it when the answer stops at its boundary: the next
 * sentence end within BOUNDARY_MAX_S, else a clause end, else its own end when that is near, else BOUNDARY_MAX_S from
 * now. Null: let the chunk finish.
 */
export function boundaryCutAt(stops: readonly ChunkStop[], elapsed: number, durationS: number): number | null {
  const ahead = (s: ChunkStop) => s.at > elapsed + 0.02 && s.at - elapsed <= BOUNDARY_MAX_S && s.at < durationS - 0.15;
  const sentence = stops.find((s) => s.kind === 's' && ahead(s));
  if (sentence) return sentence.at + BOUNDARY_TAIL_S;
  if (durationS - elapsed <= BOUNDARY_MAX_S) return null;
  const clause = stops.find((s) => s.kind === 'c' && ahead(s));
  if (clause) return clause.at + BOUNDARY_TAIL_S;
  return elapsed + BOUNDARY_MAX_S;
}

interface PreparedData {
  buffer: AudioBuffer;
  timeline: VisemeSegment[] | null;
  timelineSource: 'alignment' | 'timeline';
}

/** Decoded buffers behind the opaque PreparedAudio handles (an AudioBuffer plays in any context). */
const preparedData = new WeakMap<PreparedAudio, PreparedData>();
let preparedSeq = 0;

type G = typeof globalThis & {
  webkitAudioContext?: new () => AudioContext;
  webkitOfflineAudioContext?: AudioEngineDeps['OfflineAudioContext'];
  SpeechRecognition?: AudioEngineDeps['SpeechRecognition'];
  webkitSpeechRecognition?: AudioEngineDeps['SpeechRecognition'];
};

const HALT = Symbol('halt');

export function createAudioEngine(deps: AudioEngineDeps = {}): AudioEngine {
  const g = globalThis as G;
  const pick = <K extends keyof AudioEngineDeps>(key: K, fallback: AudioEngineDeps[K]): AudioEngineDeps[K] => (key in deps ? deps[key] : fallback);
  const Ctx = pick('AudioContext', g.AudioContext ?? g.webkitAudioContext ?? null);
  const Offline = pick('OfflineAudioContext', (g.OfflineAudioContext as AudioEngineDeps['OfflineAudioContext']) ?? g.webkitOfflineAudioContext ?? null);
  const synth = pick('speechSynthesis', typeof g.speechSynthesis === 'object' ? g.speechSynthesis : null);
  const Utter = pick('SpeechSynthesisUtterance', g.SpeechSynthesisUtterance ?? null);
  const Recognition = pick('SpeechRecognition', g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null);
  const Recorder = pick('MediaRecorder', g.MediaRecorder ?? null);
  const mediaDevices = pick('mediaDevices', g.navigator?.mediaDevices ?? null);
  const now = deps.now ?? (() => performance.now());
  const wallNow = deps.wallClock ?? (() => Date.now());
  const secureContext = pick('secureContext', typeof g.isSecureContext === 'boolean' ? g.isSecureContext : undefined);
  const gestureTarget = pick('gestureTarget', typeof g.document !== 'undefined' ? g.document : null);

  let graph: Graph | null = null;
  let offline: BaseAudioContext | null = null;
  let destroyed = false;
  let isDucked = false;
  const channels = new Map<string, Channel>();
  const speakerSamplers = new Map<string, SpeakerSampler>();
  const gens = new Map<string, number>();
  const live = new Map<string, Set<Utterance>>(); // queued, loading or playing
  const tails = new Map<string, Promise<unknown>>();
  const sounding = new Map<string, Set<Utterance>>();
  const speakingListeners = new Set<(id: string, on: boolean) => void>();
  const micListeners = new Set<(live: boolean) => void>();
  const vadListeners = new Set<(e: OwnerVadEvent) => void>();
  /** Active (pending, scheduled or sounding) reflex and ambient plays. */
  const plays = new Set<Play>();
  /** Interjections waiting for a browser-voice sentence of their speaker's answer to end. */
  const pendingBySpeaker = new Map<string, Play>();
  let micCount = 0;
  let duckHolds = 0;
  let mic: { cancel(): void } | null = null;
  let vad: { end(): void } | null = null;
  let dictation: DictationSession | null = null;
  const lane = synth && Utter ? new BrowserVoiceLane(synth, Utter, now) : null;

  // ── graph ──────────────────────────────────────────────────────────────────
  function ensureGraph(): Graph | null {
    if (graph || destroyed || !Ctx) return graph;
    try {
      const ctx = new Ctx();
      const master = ctx.createGain();
      const ducker = ctx.createGain();
      const voices = ctx.createGain();
      ducker.gain.value = isDucked ? DUCK_GAIN : 1;
      voices.connect(ducker);
      ducker.connect(master);
      master.connect(ctx.destination);
      graph = { ctx, master, ducker, voices };
    } catch {
      graph = null;
    }
    return graph;
  }

  function channel(speakerId: string): Channel | null {
    const gr = ensureGraph();
    if (!gr) return null;
    let ch = channels.get(speakerId);
    if (ch) return ch;
    const gain = gr.ctx.createGain();
    const analyser = gr.ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;
    gain.connect(analyser);
    analyser.connect(gr.voices);
    // The tap is read in render time; the reader delays it by the output latency so it matches what is heard.
    const ctx = gr.ctx;
    ch = {
      gain,
      analyser,
      reader: new SpectrumReader(analyser, ctx.sampleRate, () => perfAt(ctx, ctx.currentTime) - now()),
      sampler: speakerSampler(speakerId),
      reflexBus: null,
      ambientBus: null,
      lift: 1,
    };
    channels.set(speakerId, ch);
    return ch;
  }

  function busNode(gr: Graph, ch: Channel, bus: ReflexBus): GainNode {
    const existing = bus === 'reflex' ? ch.reflexBus : ch.ambientBus;
    if (existing) return existing;
    const node = gr.ctx.createGain();
    node.connect(ch.gain);
    if (bus === 'reflex') ch.reflexBus = node;
    else ch.ambientBus = node;
    return node;
  }

  function speakerSampler(speakerId: string): SpeakerSampler {
    let s = speakerSamplers.get(speakerId);
    if (!s) speakerSamplers.set(speakerId, (s = new SpeakerSampler()));
    return s;
  }

  /** performance.now() at which context time `t` reaches the speakers. */
  function perfAt(ctx: AudioContext, t: number): number {
    try {
      const ts = ctx.getOutputTimestamp?.();
      if (ts && typeof ts.performanceTime === 'number' && ts.performanceTime > 0 && typeof ts.contextTime === 'number') {
        return ts.performanceTime + (t - ts.contextTime) * 1000;
      }
    } catch {
      /* fall through */
    }
    const latency = (ctx.outputLatency || ctx.baseLatency || 0) * 1000;
    return now() + (t - ctx.currentTime) * 1000 + latency;
  }

  async function running(ctx: AudioContext, waitMs: number): Promise<boolean> {
    if (ctx.state === 'running') return true;
    if (ctx.state === 'closed') return false;
    const resumed = ctx.resume().then(
      () => true,
      () => false,
    );
    const deadline = new Promise<boolean>((r) => setTimeout(() => r(false), waitMs));
    await Promise.race([resumed, deadline]);
    if ((ctx.state as AudioContextState) === 'running') return true;
    // Still suspended (no gesture yet): wait for arm() on the next tap or key.
    return new Promise<boolean>((resolve) => {
      const onChange = () => {
        if (ctx.state !== 'running') return;
        clearTimeout(timer);
        ctx.removeEventListener?.('statechange', onChange);
        resolve(true);
      };
      const timer = setTimeout(() => {
        ctx.removeEventListener?.('statechange', onChange);
        resolve(ctx.state === 'running');
      }, waitMs);
      ctx.addEventListener?.('statechange', onChange);
    });
  }

  /** A context that can decode now without creating the main one before a gesture (prepare() before arm()). */
  function decodeContext(): BaseAudioContext | null {
    if (graph) return graph.ctx;
    if (!offline && Offline) {
      try {
        offline = new Offline(1, 1, OFFLINE_RATE);
      } catch {
        offline = null;
      }
    }
    return offline ?? ensureGraph()?.ctx ?? null;
  }

  // ── speaking state ─────────────────────────────────────────────────────────
  function setSounding(id: string, u: Utterance, on: boolean): void {
    let set = sounding.get(id);
    if (!set) sounding.set(id, (set = new Set()));
    const before = set.size > 0;
    if (on) set.add(u);
    else set.delete(u);
    const after = set.size > 0;
    if (before !== after) {
      for (const cb of [...speakingListeners]) {
        try {
          cb(id, after);
        } catch {
          /* a listener must not break playback */
        }
      }
    }
  }

  // ── ducking ────────────────────────────────────────────────────────────────
  function applyDuck(on: boolean): void {
    if (isDucked === on) return;
    isDucked = on;
    const gr = graph;
    if (!gr) return;
    const p = gr.ducker.gain;
    const t = gr.ctx.currentTime;
    try {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.setTargetAtTime(on ? DUCK_GAIN : 1, t, DUCK_TIME_CONSTANT_S);
    } catch {
      p.value = on ? DUCK_GAIN : 1;
    }
    // A backchannel playing through the owner's pause follows the duck on the same time constant.
    for (const id of channels.keys()) updateLift(id);
  }
  let manualDuck = false;
  const holdDuck = () => {
    duckHolds++;
    applyDuck(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      duckHolds = Math.max(0, duckHolds - 1);
      if (duckHolds === 0) applyDuck(manualDuck);
    };
  };
  const heard = () => !isDucked;
  /** Rule 1: the owner is speaking (a mic is live, or voices are ducked for them). */
  const ownerSpeaking = () => micCount > 0 || isDucked;

  /** The reflex bus of a speaker is lifted 12 dB while the owner speaks and a `duringOwner` clip plays on it. */
  function updateLift(id: string): void {
    const ch = channels.get(id);
    const bus = ch?.reflexBus;
    const gr = graph;
    if (!ch || !bus || !gr) return;
    let want = 1;
    if (isDucked) for (const p of plays) if (p.speakerId === id && p.duringOwner && p.bus === 'reflex' && p.scheduled) want = OWNER_REFLEX_LIFT;
    if (ch.lift === want) return;
    ch.lift = want;
    const t = gr.ctx.currentTime;
    try {
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.setTargetAtTime(want, t, DUCK_TIME_CONSTANT_S);
    } catch {
      bus.gain.value = want;
    }
  }

  function setMic(delta: 1 | -1): void {
    const before = micCount > 0;
    micCount = Math.max(0, micCount + delta);
    const after = micCount > 0;
    if (before === after) return;
    // Ambient chatter never runs under the owner's voice.
    if (after) for (const p of [...plays]) if (p.bus === 'ambient') p.end(p.heard ? 'stopped' : 'dropped');
    for (const cb of [...micListeners]) cb(after);
  }

  // ── reflex lanes ───────────────────────────────────────────────────────────
  /** Answers that have begun to sound (audio scheduled or browser speech started) and have not ended. */
  function soundingAnswers(): Utterance[] {
    const out: Utterance[] = [];
    for (const set of live.values()) for (const u of set) if (u.startedSound && !u.isEnded) out.push(u);
    return out;
  }

  function foregroundActive(): boolean {
    for (const set of live.values()) if (set.size > 0) return true;
    return false;
  }

  type Admission = { kind: 'now' } | { kind: 'at'; at: number; from: number; own: Utterance } | { kind: 'pending' } | { kind: 'drop' };

  /** The ladder (§3.6 rules 1, 2, 4, 5) for one new play. Nothing is changed here. */
  function admit(p: Play, mode: 'now' | 'interject', ttlMs: number): Admission {
    const drop: Admission = { kind: 'drop' };
    if (ownerSpeaking() && (p.bus === 'ambient' || !p.duringOwner)) return drop;
    const answers = soundingAnswers();
    if (answers.some((u) => u.speakerId !== p.speakerId)) return drop;
    if (p.bus === 'ambient') {
      if (foregroundActive()) return drop;
      for (const q of plays) if (q.bus === 'reflex') return drop;
    }
    for (const q of plays) if (q.bus === p.bus && q.priority <= p.priority) return drop;
    const own = answers.find((u) => u.speakerId === p.speakerId);
    if (!own) return { kind: 'now' };
    if (mode !== 'interject' || p.bus !== 'reflex' || p.kind !== 'clip') return drop;
    const gr = graph;
    if (!gr) return drop;
    const t = gr.ctx.currentTime;
    const boundary = own.nextBoundary(t);
    if (boundary === 'browser') return { kind: 'pending' };
    const at = Math.max(boundary, t + REFLEX_LEAD_S);
    if ((at - t) * 1000 > Math.max(ttlMs, REFLEX_LEAD_S * 1000) + 0.5) return drop;
    return { kind: 'at', at, from: boundary, own };
  }

  /** Rule 4 (one voice per bus) and rule 5 (a reflex fades ambient): make room for an admitted play. */
  function makeRoom(p: Play): void {
    for (const q of [...plays]) {
      if (q === p) continue;
      if (q.bus === p.bus || (p.bus === 'reflex' && q.bus === 'ambient')) q.end(q.heard ? 'stopped' : 'dropped');
    }
  }

  /** Rule 3: an answer begins for `id`: everyone else's reflexes and all ambient chatter fade out. */
  function claimForAnswer(id: string): void {
    for (const p of [...plays]) if (p.speakerId !== id || p.bus === 'ambient') p.end(p.heard ? 'stopped' : 'dropped');
  }

  /**
   * Rule 3 for audio: the context time before which `id`'s next answer chunk may not start (its own reflex
   * clip plus a short gap). A reflex longer than REFLEX_HOLD_MAX_MS from now is faded there.
   */
  function holdFor(id: string, t: number): number {
    let until = 0;
    for (const p of plays) {
      if (p.speakerId !== id || p.bus !== 'reflex' || !p.scheduled) continue;
      const cap = t + REFLEX_HOLD_MAX_MS / 1000;
      if (p.endAt > cap) p.fadeAt(cap);
      until = Math.max(until, p.endAt + INTERJECT_GAP_S);
    }
    return until;
  }

  /** A reflex that an answer waited for ended early: bring the waiting chunks forward. */
  function releaseHold(id: string): void {
    const gr = graph;
    if (!gr) return;
    const t = gr.ctx.currentTime;
    const to = Math.max(t + REFLEX_FADE_S + SCHEDULE_LEAD_S, holdFor(id, t));
    for (const u of live.get(id) ?? []) u.pullForward(t, to);
  }

  /** A browser-voice sentence of `id`'s answer ended: start the interjection that waited for it. */
  function launchPending(id: string): void {
    const p = pendingBySpeaker.get(id);
    if (!p) return;
    pendingBySpeaker.delete(id);
    p.pending = false;
    if (p.ended) return;
    const gr = graph;
    const ch = channel(id);
    if (!gr || !ch || !p.clip || gr.ctx.state !== 'running' || (ownerSpeaking() && !p.duringOwner)) return p.end('dropped');
    p.schedule(gr, ch, p.clip.data, gr.ctx.currentTime + REFLEX_LEAD_S, p.clip.gainDb);
  }

  /** One reflex or ambient sound (a prepared clip, or a browser-voice line in keyless mode). */
  class Play implements ReflexHandle {
    readonly started: Promise<boolean>;
    readonly done: Promise<ReflexOutcome>;
    readonly sampler: UtteranceSampler;
    heard = false;
    ended = false;
    /** On the audio clock (clips only). */
    scheduled = false;
    /** Waiting for a browser-voice sentence boundary (an interjection). */
    pending = false;
    clip: { data: PreparedData; gainDb: number } | null = null;
    startAt = 0;
    endAt = 0;
    perfStart = 0;
    perfEnd = 0;
    browserCancel: (() => void) | null = null;
    private src: AudioBufferSourceNode | null = null;
    private gain: GainNode | null = null;
    private timers: ReturnType<typeof setTimeout>[] = [];
    private endTimer: ReturnType<typeof setTimeout> | null = null;
    private resolveStarted!: (v: boolean) => void;
    private resolveDone!: (v: ReflexOutcome) => void;

    constructor(
      readonly speakerId: string,
      readonly bus: ReflexBus,
      readonly priority: number,
      readonly kind: 'clip' | 'text',
      readonly duringOwner: boolean,
      private readonly onStartCb: (() => void) | undefined,
    ) {
      this.sampler = new UtteranceSampler(() => this.duringOwner || !isDucked);
      this.started = new Promise<boolean>((r) => (this.resolveStarted = r));
      this.done = new Promise<ReflexOutcome>((r) => (this.resolveDone = r));
    }

    stop(): void {
      this.end('stopped');
    }

    after(ms: number, fn: () => void): void {
      this.timers.push(setTimeout(fn, Math.max(0, ms)));
    }

    /** Put the clip on the audio clock at context time `at`. */
    schedule(gr: Graph, ch: Channel, data: PreparedData, at: number, gainDb: number): void {
      if (this.ended) return;
      const ctx = gr.ctx;
      const gain = ctx.createGain();
      gain.gain.value = dbToGain(gainDb);
      gain.connect(busNode(gr, ch, this.bus));
      const src = ctx.createBufferSource();
      src.buffer = data.buffer;
      src.connect(gain);
      try {
        src.start(at);
      } catch {
        try {
          gain.disconnect();
        } catch {
          /* ignore */
        }
        return this.end('dropped');
      }
      this.src = src;
      this.gain = gain;
      this.scheduled = true;
      this.startAt = at;
      this.endAt = at + data.buffer.duration;
      this.perfStart = perfAt(ctx, at);
      this.perfEnd = this.perfStart + data.buffer.duration * 1000;
      this.sampler.attachSpectrum(ch.reader);
      this.sampler.addWindow(this.perfStart, this.perfEnd);
      if (data.timeline) this.sampler.addTimeline(data.timeline, this.perfStart, data.timelineSource);
      ch.sampler.overlay = this.sampler;
      this.after(this.perfStart - now(), () => this.markHeard());
      this.endTimer = setTimeout(() => this.end('completed'), Math.max(0, this.perfEnd - now()));
      if (this.duringOwner) updateLift(this.speakerId);
    }

    /** Fade out at context time `t` (a reflex that an answer will not wait for any longer). */
    fadeAt(t: number): void {
      const gr = graph;
      if (!gr || !this.src || !this.gain || this.ended || t >= this.endAt) return;
      const p = this.gain.gain;
      try {
        p.setValueAtTime(p.value, t);
        p.linearRampToValueAtTime(0, t + REFLEX_FADE_S);
      } catch {
        /* the stop below still cuts it */
      }
      try {
        this.src.stop(t + REFLEX_FADE_S);
      } catch {
        /* ignore */
      }
      this.endAt = t + REFLEX_FADE_S;
      this.perfEnd = perfAt(gr.ctx, this.endAt);
      if (this.endTimer) clearTimeout(this.endTimer);
      this.endTimer = setTimeout(() => this.end('completed'), Math.max(0, this.perfEnd - now()));
    }

    markHeard(): void {
      if (this.ended || this.heard) return;
      this.heard = true;
      this.resolveStarted(true);
      try {
        this.onStartCb?.();
      } catch {
        /* a caller's callback must not break playback */
      }
    }

    end(outcome: ReflexOutcome): void {
      if (this.ended) return;
      // A stop that lands after the first sample reached the ear (before its timer ran) still counts as heard.
      if (!this.heard && this.scheduled && outcome !== 'dropped' && now() >= this.perfStart) this.markHeard();
      this.ended = true;
      for (const t of this.timers) clearTimeout(t);
      this.timers = [];
      if (this.endTimer) clearTimeout(this.endTimer);
      this.endTimer = null;
      plays.delete(this);
      if (pendingBySpeaker.get(this.speakerId) === this) pendingBySpeaker.delete(this.speakerId);
      const gr = graph;
      const src = this.src;
      const gain = this.gain;
      if (gr && src && gain) {
        const t = gr.ctx.currentTime;
        if (outcome !== 'completed') {
          try {
            if (t < this.startAt) src.stop();
            else {
              gain.gain.cancelScheduledValues(t);
              gain.gain.setValueAtTime(gain.gain.value, t);
              gain.gain.linearRampToValueAtTime(0, t + REFLEX_FADE_S);
              src.stop(t + REFLEX_FADE_S);
            }
          } catch {
            gain.gain.value = 0;
          }
        }
        setTimeout(() => {
          for (const n of [src, gain]) {
            try {
              n.disconnect();
            } catch {
              /* ignore */
            }
          }
        }, REFLEX_FADE_S * 1000 + 40);
      }
      const cancel = this.browserCancel;
      this.browserCancel = null;
      cancel?.();
      this.sampler.end();
      const sp = speakerSamplers.get(this.speakerId);
      if (sp?.overlay === this.sampler) sp.overlay = null;
      if (this.duringOwner) updateLift(this.speakerId);
      this.resolveStarted(this.heard);
      this.resolveDone(outcome === 'completed' ? (this.heard ? 'completed' : 'dropped') : this.heard ? 'stopped' : outcome);
      if (this.scheduled && this.kind === 'clip' && this.bus === 'reflex' && outcome !== 'completed') releaseHold(this.speakerId);
    }
  }

  function playPrepared(req: PlayPreparedRequest): ReflexHandle {
    const bus: ReflexBus = req.bus === 'ambient' ? 'ambient' : 'reflex';
    const p = new Play(req.speakerId, bus, finite(req.priority, 6), 'clip', !!req.duringOwner && bus === 'reflex', req.onStart);
    const data = req.audio ? preparedData.get(req.audio) : undefined;
    const gr = graph;
    if (destroyed || !data || !gr || gr.ctx.state !== 'running') {
      p.end('dropped');
      return p;
    }
    const ttlMs = Math.max(0, finite(req.ttlMs, 0));
    const verdict = admit(p, req.mode === 'interject' ? 'interject' : 'now', ttlMs);
    if (verdict.kind === 'drop') {
      p.end('dropped');
      return p;
    }
    const ch = channel(req.speakerId);
    if (!ch) {
      p.end('dropped');
      return p;
    }
    const gainDb = finite(req.gainDb, 0);
    makeRoom(p);
    plays.add(p);
    if (verdict.kind === 'pending') {
      // The answer is in browser speech: the boundary is the end of its current sentence.
      pendingBySpeaker.get(req.speakerId)?.end('dropped');
      p.pending = true;
      p.clip = { data, gainDb };
      pendingBySpeaker.set(req.speakerId, p);
      p.after(ttlMs, () => {
        if (p.pending) p.end('dropped');
      });
      return p;
    }
    const at = verdict.kind === 'at' ? verdict.at : gr.ctx.currentTime + REFLEX_LEAD_S;
    p.schedule(gr, ch, data, at, gainDb);
    // Interjection: the answer's chunks from the boundary on move behind the clip, then the answer resumes.
    if (verdict.kind === 'at' && !p.ended) verdict.own.retime(verdict.from, p.endAt + INTERJECT_GAP_S);
    return p;
  }

  function speakReflexText(req: SpeakReflexTextRequest): ReflexHandle | null {
    if (!lane) return null;
    const bus: ReflexBus = req.bus === 'ambient' ? 'ambient' : 'reflex';
    const p = new Play(req.speakerId, bus, finite(req.priority, 6), 'text', false, req.onStart);
    const words = speakable(req.text ?? '');
    if (destroyed || !words || admit(p, 'now', 0).kind !== 'now') {
      p.end('dropped');
      return p;
    }
    makeRoom(p);
    plays.add(p);
    const rate = req.voiceHint?.rate ?? 1;
    const job = lane.say({
      speakerId: req.speakerId,
      text: words,
      hint: req.voiceHint,
      onStart: (t) => {
        if (p.ended) return;
        p.sampler.startText(words, t, rate);
        speakerSampler(req.speakerId).overlay = p.sampler;
        p.markHeard();
      },
      onBoundary: (i, t) => p.sampler.boundary(i, t),
    });
    p.browserCancel = job.cancel;
    p.after(Math.max(0, finite(req.ttlMs, 0)), () => {
      if (!p.heard) p.end('dropped');
    });
    void job.done.then((r) => {
      p.browserCancel = null;
      p.end(r.status === 'completed' ? 'completed' : p.heard ? 'stopped' : 'dropped');
    });
    return p;
  }

  function stopReflexes(filter?: { speakerId?: string; bus?: ReflexBus }): void {
    for (const p of [...plays]) {
      if (filter?.speakerId !== undefined && p.speakerId !== filter.speakerId) continue;
      if (filter?.bus !== undefined && p.bus !== filter.bus) continue;
      p.end('stopped');
    }
  }

  // ── owner VAD (rule 9) ─────────────────────────────────────────────────────
  function emitVad(e: OwnerVadEvent): void {
    for (const cb of [...vadListeners]) {
      try {
        cb(e);
      } catch {
        /* a listener must not break the mic */
      }
    }
  }

  /** Sample the recording's level at 20 Hz: start, pause (≥ 350 ms quiet), resume, end. */
  function startVad(session: RecorderSession): { end(): void } {
    let startAt: number | null = null;
    let voiced = false;
    let quietSince: number | null = null;
    let over = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const emit = (kind: OwnerVadEvent['kind'], pauseMs?: number) => {
      const e: OwnerVadEvent = { kind, at: wallNow(), utteranceMs: startAt === null ? 0 : Math.max(0, Math.round(now() - startAt)) };
      if (pauseMs !== undefined) e.pauseMs = Math.round(pauseMs);
      emitVad(e);
    };
    const tick = () => {
      timer = null;
      if (over) return;
      let level = 0;
      try {
        level = session.rawLevel();
      } catch {
        level = 0;
      }
      const t = now();
      if (startAt === null) {
        if (level >= VAD_ON) {
          startAt = t;
          voiced = true;
          emit('start');
        }
      } else if (voiced) {
        if (level < VAD_OFF) {
          quietSince ??= t;
          if (t - quietSince >= VAD_PAUSE_MS) {
            voiced = false;
            emit('pause', t - quietSince);
          }
        } else quietSince = null;
      } else if (level >= VAD_ON) {
        voiced = true;
        quietSince = null;
        emit('resume');
      }
      timer = setTimeout(tick, VAD_INTERVAL_MS);
    };
    timer = setTimeout(tick, VAD_INTERVAL_MS);
    return {
      end() {
        if (over) return;
        over = true;
        if (timer) clearTimeout(timer);
        timer = null;
        emit('end');
      },
    };
  }

  // ── utterances ─────────────────────────────────────────────────────────────
  class Utterance {
    readonly sampler: UtteranceSampler;
    readonly done: Promise<SpeakOutcome>;
    private resolveDone!: (o: SpeakOutcome) => void;
    private ended = false;
    stopped = false;
    /** run() has begun (its turn came); a queued utterance has not. */
    running = false;
    /** Audio was scheduled or browser speech started: the answer is sounding (§3.6 rule 2). */
    startedSound = false;
    /** The chunk stream has ended (always true for a whole string). */
    streamEnded: boolean;
    /** stopAtBoundary(): finish after the chunk now sounding. */
    boundaryStop = false;
    private sources = new Set<AudioBufferSourceNode>();
    private recs: ChunkRec[] = [];
    private gain: GainNode | null = null;
    private nextTime = 0;
    private iterator: AsyncIterator<SpeakChunk> | null = null;
    private browserCancel: (() => void) | null = null;
    private browserActive = false;
    /** Characters of known browser-voice text still to speak after the current sentence (string requests). */
    private browserQueuedChars = 0;
    private drainWaiters: (() => void)[] = [];
    private onTimer: ReturnType<typeof setTimeout> | null = null;
    private starveTimer: ReturnType<typeof setTimeout> | null = null;
    private playedAudio = false;
    private spokeBrowser = false;
    private browserMs = 0;
    private readonly halt: Promise<typeof HALT>;
    private releaseHalt!: () => void;

    constructor(
      readonly speakerId: string,
      readonly gen: number,
      readonly req: SpeakRequest,
    ) {
      this.sampler = new UtteranceSampler(heard);
      this.done = new Promise<SpeakOutcome>((r) => (this.resolveDone = r));
      this.halt = new Promise<typeof HALT>((r) => (this.releaseHalt = () => r(HALT)));
      this.streamEnded = typeof req.chunks === 'string';
    }

    get stale(): boolean {
      return this.stopped || this.ended || destroyed || (gens.get(this.speakerId) ?? 0) !== this.gen;
    }

    get isEnded(): boolean {
      return this.ended;
    }

    async run(turn: Promise<unknown>): Promise<void> {
      await turn;
      if (this.stale || this.boundaryStop) return this.finish('stopped');
      this.running = true;
      if (typeof this.req.chunks === 'string') return this.runBrowser(this.req.chunks);
      return this.runChunks(this.req.chunks);
    }

    // Browser speech for a whole string: sentence by sentence (Chrome cuts long lines, and a sentence
    // boundary is a clean place for barge-in).
    private async runBrowser(text: string): Promise<void> {
      if (!lane) return this.finish('failed', 'Browser speech is not available.');
      const sentences: string[] = [];
      const chunker = new SentenceChunker({ maxTokens: 60, firstClauseChars: 0, onChunk: (s) => sentences.push(s) });
      chunker.push(text);
      chunker.flush();
      this.browserQueuedChars = sentences.reduce((n, s) => n + s.length, 0);
      for (const s of sentences) {
        this.browserQueuedChars = Math.max(0, this.browserQueuedChars - s.length);
        const wait = this.reflexWait('any');
        if (wait) await wait;
        if (this.stale) return this.finish('stopped');
        if (this.boundaryStop) return this.finish('stopped');
        const r = await this.sayBrowser(s);
        if (this.stale) return this.finish('stopped');
        if (r.status === 'failed') return this.finish('failed', r.error);
        launchPending(this.speakerId);
        if (this.boundaryStop) return this.finish('stopped');
      }
      this.finish('completed');
    }

    /** Next chunk, or HALT when stopAtBoundary() ends the stream early. */
    private next(it: AsyncIterator<SpeakChunk>): Promise<IteratorResult<SpeakChunk> | typeof HALT> {
      return Promise.race([it.next(), this.halt]);
    }

    private async runChunks(chunks: AsyncIterable<SpeakChunk>): Promise<void> {
      let it: AsyncIterator<SpeakChunk>;
      try {
        it = chunks[Symbol.asyncIterator]();
      } catch (err) {
        this.streamEnded = true;
        return this.finish('failed', errorText(err));
      }
      this.iterator = it;
      let index = 0;
      let lastError: string | undefined;
      for (;;) {
        let r: IteratorResult<SpeakChunk> | typeof HALT;
        try {
          r = await this.next(it);
        } catch (err) {
          if (this.stale) return this.finish('stopped');
          lastError = errorText(err);
          break;
        }
        if (this.stale) return this.finish('stopped'); // late chunk after barge-in: dropped
        if (r === HALT || this.boundaryStop || r.done) break;
        const chunk = normalizeChunk(r.value, index === 0 ? this.req.alignment : null);
        index++;
        if (chunk.audio && isArrayBuffer(chunk.audio) && chunk.audio.byteLength > 0) {
          const played = await this.playAudio(chunk);
          if (this.stale) return this.finish('stopped');
          if (this.boundaryStop) break;
          if (played === 'ok') continue;
          lastError = played;
        }
        const words = chunk.text ? speakable(chunk.text) : '';
        if (words && !lane) lastError ??= 'Browser speech is not available.';
        if (words && lane) {
          await this.drain();
          if (this.stale) return this.finish('stopped');
          if (this.boundaryStop) break;
          const wait = this.reflexWait('any');
          if (wait) await wait;
          if (this.stale) return this.finish('stopped');
          if (this.boundaryStop) break;
          const s = await this.sayBrowser(words);
          if (this.stale) return this.finish('stopped');
          if (s.status === 'failed') lastError = s.error;
          launchPending(this.speakerId);
          if (this.boundaryStop) break;
        }
      }
      this.streamEnded = true;
      this.iterator = null;
      await this.drain();
      if (this.stale) return this.finish('stopped');
      // Sources end on the audio clock; the owner hears the tail one output latency later. The mouth and
      // `speaking` follow what is heard, so wait for the last window to end (barge-in still stops at once).
      await this.untilHeard();
      if (this.stale) return this.finish('stopped');
      if (this.boundaryStop) return this.finish('stopped');
      if (lastError && !this.playedAudio && !this.spokeBrowser) return this.finish('failed', lastError);
      this.finish('completed', lastError);
    }

    /** Heard time (performance ms) at which the last scheduled audio ends. */
    private heardEnd(): number {
      let end = 0;
      for (const r of this.recs) if (r.perfEnd > end) end = r.perfEnd;
      return end;
    }

    private untilHeard(): Promise<void> {
      const wait = this.heardEnd() - now();
      if (wait <= 0) return Promise.resolve();
      return new Promise((r) => {
        const t = setTimeout(r, wait);
        // finish() (barge-in, destroy) releases drain waiters: stop waiting then too.
        this.drainWaiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }

    /** Decode and schedule one chunk. Returns 'ok' or a reason it could not play. */
    private async playAudio(chunk: SpeechChunk): Promise<'ok' | string> {
      const ch = channel(this.speakerId);
      const gr = graph;
      if (!ch || !gr) return 'Web Audio is not available.';
      let buffer: AudioBuffer;
      try {
        buffer = await decode(gr.ctx, chunk.audio!);
      } catch (err) {
        return `Could not decode audio (${errorText(err)}).`;
      }
      if (this.stale || this.boundaryStop) return 'stale';
      if (!(await running(gr.ctx, RESUME_WAIT_MS))) return 'Audio is blocked until you click or press a key.';
      if (this.stale || this.boundaryStop) return 'stale';
      // A browser-voice reflex of this speaker has no clock end: the answer waits for it (rule 3).
      const wait = this.reflexWait('text');
      if (wait) await wait;
      if (this.stale || this.boundaryStop) return 'stale';
      this.schedule(gr, ch, buffer, chunk);
      return 'ok';
    }

    private schedule(gr: Graph, ch: Channel, buffer: AudioBuffer, chunk: SpeechChunk): void {
      const ctx = gr.ctx;
      if (!this.gain) {
        this.gain = ctx.createGain();
        this.gain.connect(ch.gain);
        this.sampler.attachSpectrum(ch.reader);
      }
      if (!this.startedSound) {
        this.startedSound = true;
        claimForAnswer(this.speakerId);
      }
      const startAt = Math.max(ctx.currentTime + SCHEDULE_LEAD_S, this.nextTime, holdFor(this.speakerId, ctx.currentTime));
      const durMs = buffer.duration * 1000;
      let seq = alignmentToVisemeSequence(chunk.alignment);
      let seqSource: ChunkRec['seqSource'] = 'alignment';
      if (!seq && chunk.text) {
        seqSource = 'timeline';
        seq = textToVisemeSequence(speakable(chunk.text), durMs);
        try {
          const segs = segmentSpeech(analyzeBuffer(buffer));
          if (segs.length) seq = warpTimelineToSegments(seq, segs);
        } catch {
          /* keep the even spread */
        }
      }
      const stops = chunkStops(chunk.text, chunk.alignment, buffer.duration);
      const rec: ChunkRec = { src: null as unknown as AudioBufferSourceNode, buffer, startAt: 0, endAt: 0, perfStart: 0, perfEnd: 0, seq, seqSource, stops };
      this.place(gr, rec, startAt);
      ch.sampler.current = this.sampler;

      if (this.starveTimer) {
        clearTimeout(this.starveTimer);
        this.starveTimer = null;
      }
      if (!this.onTimer && !sounding.get(this.speakerId)?.has(this)) {
        const delay = Math.max(0, rec.perfStart - now());
        this.onTimer = setTimeout(() => {
          this.onTimer = null;
          if (!this.stale) setSounding(this.speakerId, this, true);
        }, delay);
      }
    }

    /** Put one chunk on the audio clock at `startAt` (a fresh source: a source node plays once). */
    private place(gr: Graph, rec: ChunkRec, startAt: number): void {
      const ctx = gr.ctx;
      const src = ctx.createBufferSource();
      src.buffer = rec.buffer;
      src.connect(this.gain!);
      rec.src = src;
      rec.startAt = startAt;
      rec.endAt = startAt + rec.buffer.duration;
      this.nextTime = rec.endAt;
      this.sources.add(src);
      src.onended = () => this.sourceEnded(src);
      src.start(startAt);
      this.playedAudio = true;
      rec.perfStart = perfAt(ctx, startAt);
      rec.perfEnd = rec.perfStart + rec.buffer.duration * 1000;
      this.recs.push(rec);
      this.sampler.addWindow(rec.perfStart, rec.perfEnd);
      if (rec.seq) this.sampler.addTimeline(rec.seq, rec.perfStart, rec.seqSource);
    }

    /** End a sounding chunk early at context time `at`, with a short fade (a boundary stop mid-chunk). */
    private endChunkAt(gr: Graph, rec: ChunkRec, at: number): void {
      try {
        const g = this.gain?.gain;
        if (g) {
          const from = Math.max(gr.ctx.currentTime, at - BOUNDARY_FADE_S);
          g.setValueAtTime(g.value, from);
          g.linearRampToValueAtTime(0.0001, at);
        }
      } catch {
        /* no automation: the stop alone */
      }
      try {
        rec.src.stop(at);
      } catch {
        /* already stopped */
      }
      rec.endAt = at;
      rec.perfEnd = perfAt(gr.ctx, at);
      this.sampler.clipAt(rec.perfEnd);
      this.nextTime = this.recs.reduce((m, r) => Math.max(m, r === rec ? at : r.endAt), 0);
    }

    /** Take chunks off the audio clock (they never sound where they were scheduled). */
    private unplace(recs: ChunkRec[]): void {
      if (!recs.length) return;
      const set = new Set(recs);
      let perfFrom = Infinity;
      for (const r of recs) {
        perfFrom = Math.min(perfFrom, r.perfStart);
        r.src.onended = null;
        try {
          r.src.stop();
        } catch {
          /* ignore */
        }
        try {
          r.src.disconnect();
        } catch {
          /* ignore */
        }
        this.sources.delete(r.src);
      }
      this.recs = this.recs.filter((r) => !set.has(r));
      this.sampler.truncate(perfFrom);
      this.nextTime = this.recs.reduce((t, r) => Math.max(t, r.endAt), 0);
    }

    /** Context time of the next chunk boundary: the end of the chunk sounding now, else now. 'browser' → a sentence end. */
    nextBoundary(t: number): number | 'browser' {
      if (this.browserActive) return 'browser';
      for (const r of this.recs) if (r.startAt <= t + 1e-6 && t < r.endAt) return r.endAt;
      return t;
    }

    /** Move every chunk that starts at or after `from` (context time) to start at `to`, back to back. */
    retime(from: number, to: number): void {
      const gr = graph;
      if (!gr || this.ended) return;
      const moving = this.recs.filter((r) => r.startAt >= from - 1e-4);
      if (!moving.length) return;
      this.unplace(moving);
      let t = Math.max(to, this.nextTime);
      for (const r of moving) {
        this.place(gr, r, t);
        t = r.endAt;
      }
    }

    /** A reflex this answer waited for ended early: chunks not yet started move up to `to` (never over a sounding one). */
    pullForward(t: number, to: number): void {
      if (this.ended) return;
      const waiting = this.recs.filter((r) => r.startAt > t + 1e-6);
      if (!waiting.length) return;
      const first = waiting.reduce((a, b) => (a.startAt <= b.startAt ? a : b));
      let floor = to;
      for (const r of this.recs) if (r.startAt <= t + 1e-6) floor = Math.max(floor, r.endAt);
      if (first.startAt <= floor + 1e-3) return;
      this.retime(first.startAt, floor);
    }

    /** stopAtBoundary(): finish after the chunk sounding now; queued chunks and the rest of the stream are dropped. */
    endAtBoundary(): void {
      if (this.ended || this.boundaryStop) return;
      this.boundaryStop = true;
      this.releaseHalt();
      this.streamEnded = true;
      const it = this.iterator;
      this.iterator = null;
      if (it?.return) {
        void Promise.resolve()
          .then(() => it.return!())
          .catch(() => undefined);
      }
      const gr = graph;
      if (gr) {
        const t = gr.ctx.currentTime;
        const current = this.recs.find((r) => r.startAt <= t + 1e-6 && t < r.endAt);
        let cut = current ? current.endAt : t;
        // A long chunk (up to 120 tokens) ends at the sentence playing now, never 7 s later (§2.3: ≤ 4 s).
        const early = current ? boundaryCutAt(current.stops, t - current.startAt, current.buffer.duration) : null;
        if (current && early !== null && current.startAt + early < current.endAt - 0.05) {
          cut = current.startAt + early;
          this.endChunkAt(gr, current, cut);
        }
        this.unplace(this.recs.filter((r) => r.startAt >= cut - 1e-4));
      }
      if (!this.sources.size) for (const w of this.drainWaiters.splice(0)) w();
      // Browser speech: the sentence in progress finishes; the loop stops after it.
    }

    /** Heard ms of this answer still to come (scheduled audio, plus the browser sentence and known text). null → none. */
    remainingMs(t: number): number | null {
      let ms = 0;
      let any = false;
      for (const r of this.recs) {
        if (r.perfEnd <= t) continue;
        any = true;
        ms += r.perfEnd - Math.max(t, r.perfStart);
      }
      const spoken = this.browserActive ? this.sampler.textRemainingMs(t) : null;
      if (spoken !== null) {
        any = true;
        ms += spoken;
      }
      if (this.browserQueuedChars > 0 && (this.browserActive || this.running)) {
        any = true;
        ms += (this.browserQueuedChars / (TEXT_CPS * (this.req.voiceHint?.rate || 1))) * 1000;
      }
      return any ? ms : null;
    }

    /**
     * Rule 3 in browser speech (or for a browser-voice reflex before audio): wait until this speaker's reflexes
     * have ended (plus a short gap), at most REFLEX_HOLD_MAX_MS, then fade what is left. null → nothing to wait for.
     */
    private reflexWait(kind: 'text' | 'any'): Promise<void> | null {
      const mine = () => {
        const out: Play[] = [];
        for (const p of plays) if (p.speakerId === this.speakerId && p.bus === 'reflex' && !p.pending && (kind === 'any' || p.kind === 'text')) out.push(p);
        return out;
      };
      if (!mine().length) return null;
      return (async () => {
        const deadline = now() + REFLEX_HOLD_MAX_MS;
        let waited = false;
        for (let list = mine(); list.length && !this.stale; list = mine()) {
          const left = deadline - now();
          if (left <= 0) {
            for (const p of list) p.end(p.heard ? 'stopped' : 'dropped');
            break;
          }
          waited = true;
          await Promise.race([Promise.all(list.map((p) => p.done)), delay(left)]);
        }
        if (waited && !this.stale) await delay(INTERJECT_GAP_S * 1000);
      })();
    }

    private sourceEnded(src: AudioBufferSourceNode): void {
      if (!this.sources.delete(src)) return;
      try {
        src.disconnect();
      } catch {
        /* ignore */
      }
      if (this.sources.size) return;
      for (const w of this.drainWaiters.splice(0)) w();
      if (this.ended) return;
      // Nothing is playing; more chunks may still be on their way.
      if (this.onTimer) {
        clearTimeout(this.onTimer);
        this.onTimer = null;
      }
      if (!this.starveTimer) {
        // The tail is still reaching the speakers for one output latency: count the starve time from there.
        const tail = Math.max(0, this.heardEnd() - now());
        this.starveTimer = setTimeout(() => {
          this.starveTimer = null;
          if (!this.sources.size) setSounding(this.speakerId, this, false);
        }, tail + STARVE_MS);
      }
    }

    private drain(): Promise<void> {
      if (!this.sources.size) return Promise.resolve();
      return new Promise((r) => this.drainWaiters.push(r));
    }

    private async sayBrowser(text: string) {
      if (!lane) return { status: 'failed' as const, error: 'Browser speech is not available.' };
      if (!this.startedSound) {
        this.startedSound = true;
        claimForAnswer(this.speakerId);
      }
      let startedAt = 0;
      this.browserActive = true;
      const job = lane.say({
        speakerId: this.speakerId,
        text,
        hint: this.req.voiceHint,
        onStart: (t) => {
          if (this.stale) return;
          startedAt = t;
          if (this.starveTimer) {
            clearTimeout(this.starveTimer);
            this.starveTimer = null;
          }
          this.sampler.startText(text, t, this.req.voiceHint?.rate ?? 1);
          speakerSampler(this.speakerId).current = this.sampler;
          setSounding(this.speakerId, this, true);
        },
        onBoundary: (i, t) => this.sampler.boundary(i, t),
      });
      this.browserCancel = job.cancel;
      const r = await job.done;
      this.browserCancel = null;
      this.browserActive = false;
      this.sampler.endText();
      if (startedAt) {
        this.spokeBrowser = true;
        this.browserMs += now() - startedAt;
        if (!this.stale && !this.starveTimer) {
          this.starveTimer = setTimeout(() => {
            this.starveTimer = null;
            if (!this.sources.size) setSounding(this.speakerId, this, false);
          }, STARVE_MS);
        }
      }
      return r;
    }

    /** Barge-in: silence now, drop everything scheduled or still loading. */
    stop(): void {
      if (this.ended) return;
      this.stopped = true;
      const gr = graph;
      if (gr && (this.sources.size || this.gain)) {
        const t = gr.ctx.currentTime;
        if (this.gain) {
          const p = this.gain.gain;
          try {
            p.cancelScheduledValues(t);
            p.setValueAtTime(p.value, t);
            p.linearRampToValueAtTime(0, t + STOP_FADE_S);
          } catch {
            p.value = 0;
          }
        }
        for (const src of this.sources) {
          try {
            src.stop(t + STOP_FADE_S);
          } catch {
            /* never started or already stopped */
          }
        }
      }
      this.browserCancel?.();
      this.browserCancel = null;
      const it = this.iterator;
      this.iterator = null;
      if (it?.return) {
        // Tell the producer (e.g. a SpeechStream) to cancel its pending TTS requests.
        void Promise.resolve()
          .then(() => it.return!())
          .catch(() => undefined);
      }
      this.finish('stopped');
    }

    finish(status: SpeakOutcome['status'], error?: string): void {
      if (this.ended) return;
      this.ended = true;
      this.releaseHalt();
      if (this.onTimer) clearTimeout(this.onTimer);
      if (this.starveTimer) clearTimeout(this.starveTimer);
      this.onTimer = this.starveTimer = null;
      this.sampler.end();
      const sp = speakerSamplers.get(this.speakerId);
      if (sp?.current === this.sampler) sp.current = null;
      setSounding(this.speakerId, this, false);
      live.get(this.speakerId)?.delete(this);
      for (const w of this.drainWaiters.splice(0)) w();
      const gain = this.gain;
      if (gain) {
        // Let the stop fade finish, then unhook this utterance from the speaker channel.
        setTimeout(
          () => {
            for (const src of this.sources) {
              try {
                src.disconnect();
              } catch {
                /* ignore */
              }
            }
            this.sources.clear();
            try {
              gain.disconnect();
            } catch {
              /* ignore */
            }
          },
          status === 'stopped' ? 50 : 0,
        );
      }
      // An interjection waiting for this answer's next sentence boundary: the answer is over, play it now.
      if (!soundingAnswers().some((u) => u.speakerId === this.speakerId)) launchPending(this.speakerId);
      const source = this.playedAudio ? 'audio' : this.spokeBrowser ? 'browser' : 'none';
      const outcome: SpeakOutcome = { status, source, playedMs: Math.round(this.playedMs() + this.browserMs) };
      if (error && status !== 'stopped' && error !== 'stale') outcome.error = error;
      this.resolveDone(outcome);
    }

    private playedMs(): number {
      const t = now();
      let ms = 0;
      for (const r of this.recs) if (t > r.perfStart) ms += Math.min(t, r.perfEnd) - r.perfStart;
      return ms;
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────
  const support = (): AudioSupport => ({
    webAudio: !!Ctx,
    mic: !!mediaDevices?.getUserMedia && !!Recorder,
    speechSynthesis: !!lane,
    speechRecognition: !!Recognition,
  });

  async function arm(): Promise<void> {
    const gr = ensureGraph();
    if (!gr || gr.ctx.state === 'running' || gr.ctx.state === 'closed') return;
    try {
      await gr.ctx.resume();
    } catch {
      /* not in a gesture: the next one will do */
    }
  }

  // Stays attached: a context suspended later (iOS interruption, backgrounded tab) resumes on the next tap.
  const gestureEvents = ['pointerdown', 'keydown', 'touchend'] as const;
  const onGesture = () => {
    if (graph?.ctx.state !== 'running') void arm();
  };
  const removeGestureListeners = () => {
    for (const ev of gestureEvents) gestureTarget?.removeEventListener(ev, onGesture, true);
  };
  if (Ctx && gestureTarget) for (const ev of gestureEvents) gestureTarget.addEventListener(ev, onGesture, { capture: true, passive: true });

  function speak(req: SpeakRequest): SpeakHandle {
    const id = req.speakerId;
    const gen = gens.get(id) ?? 0;
    const u = new Utterance(id, gen, req);
    let set = live.get(id);
    if (!set) live.set(id, (set = new Set()));
    set.add(u);
    const turn = tails.get(id) ?? Promise.resolve();
    tails.set(
      id,
      Promise.all([turn, u.done]).then(
        () => undefined,
        () => undefined,
      ),
    );
    if (destroyed) u.stop();
    else
      void u.run(turn).catch((err: unknown) => {
        // run() handles its own failures; this is a last guard so done always resolves.
        u.finish('failed', errorText(err));
      });
    return { speakerId: id, generation: gen, sampler: u.sampler, done: u.done, stop: () => u.stop() };
  }

  function stopSpeaker(id: string): void {
    gens.set(id, (gens.get(id) ?? 0) + 1);
    for (const u of [...(live.get(id) ?? [])]) u.stop();
    lane?.cancelSpeaker(id);
    tails.delete(id);
    stopReflexes({ speakerId: id });
  }

  const engine: AudioEngine = {
    get armed() {
      return graph?.ctx.state === 'running';
    },
    get ducked() {
      return isDucked;
    },
    arm,
    speak,
    stopSpeaker,
    stopAll() {
      const ids = new Set<string>([...live.keys(), ...channels.keys(), ...gens.keys()]);
      for (const id of ids) stopSpeaker(id);
      lane?.cancelSpeaker();
      stopReflexes();
    },
    speaking: () => [...sounding.entries()].filter(([, s]) => s.size > 0).map(([id]) => id),
    onSpeakingChange(cb) {
      speakingListeners.add(cb);
      return () => speakingListeners.delete(cb);
    },
    sampler: (speakerId: string): MouthSampler => speakerSampler(speakerId),
    generation: (speakerId: string) => gens.get(speakerId) ?? 0,
    duck(on: boolean) {
      manualDuck = on;
      applyDuck(on || duckHolds > 0);
    },
    async startPushToTalk(opts?: { duck?: boolean }): Promise<MicSession> {
      if (destroyed) throw micError('failed');
      mic?.cancel();
      mic = null;
      const unduck = opts?.duck === false ? () => undefined : holdDuck();
      setMic(1);
      let released = false;
      let session: RecorderSession | null = null;
      let meter: { end(): void } | null = null;
      const release = () => {
        if (released) return;
        released = true;
        meter?.end();
        if (vad === meter) vad = null;
        unduck();
        setMic(-1);
      };
      try {
        session = await openRecorder({
          mediaDevices,
          Recorder,
          secureContext,
          context: () => {
            const gr = ensureGraph();
            if (gr && gr.ctx.state !== 'running') void gr.ctx.resume().catch(() => undefined);
            return gr?.ctx ?? null;
          },
          now,
          onRelease: release,
        });
      } catch (err) {
        release();
        throw err;
      }
      mic = session;
      if (!released) {
        vad?.end();
        vad = meter = startVad(session);
      }
      return session;
    },
    startDictation(opts?: DictationOptions): DictationSession | null {
      if (!Recognition || destroyed) return null;
      dictation?.cancel();
      const unduck = holdDuck();
      let on = false;
      const session = startRecognition(Recognition, {
        ...opts,
        onLive: (l) => {
          if (l === on) return;
          on = l;
          setMic(l ? 1 : -1);
          if (!l) unduck();
        },
      });
      if (!on) unduck(); // failed to start
      dictation = session;
      return session;
    },
    micLive: () => micCount > 0,
    onMicChange(cb) {
      micListeners.add(cb);
      return () => micListeners.delete(cb);
    },

    async prepare(bytes, opts = {}) {
      if (destroyed) throw new Error('Audio is shut down.');
      if (!isArrayBuffer(bytes) || bytes.byteLength === 0) throw new Error('There is no audio to decode.');
      const ctx = decodeContext();
      if (!ctx) throw new Error('Web Audio is not available.');
      const buffer = await decode(ctx, bytes);
      const durationMs = buffer.duration * 1000;
      const alignment = opts.alignment ?? null;
      const text = typeof opts.text === 'string' && opts.text.trim() ? opts.text : null;
      let timeline = alignmentToVisemeSequence(alignment);
      let timelineSource: PreparedData['timelineSource'] = 'alignment';
      if (!timeline && text) {
        timelineSource = 'timeline';
        timeline = textToVisemeSequence(speakable(text), durationMs);
        try {
          const segs = segmentSpeech(analyzeBuffer(buffer));
          if (segs.length) timeline = warpTimelineToSegments(timeline, segs);
        } catch {
          /* keep the even spread */
        }
      }
      const prepared: PreparedAudio = Object.freeze({
        key: opts.key ?? `prepared-${++preparedSeq}`,
        durationMs,
        alignment,
        text,
        bytes: buffer.length * buffer.numberOfChannels * 4,
      });
      preparedData.set(prepared, { buffer, timeline, timelineSource });
      return prepared;
    },
    playPrepared,
    speakReflexText,
    activity(speakerId: string): SpeakerActivity {
      const us = [...(live.get(speakerId) ?? [])];
      const t = now();
      let remaining: number | null = null;
      for (const u of us) {
        const r = u.remainingMs(t);
        if (r !== null) remaining = (remaining ?? 0) + r;
      }
      let reflex = false;
      let ambient = false;
      for (const p of plays) {
        if (p.speakerId !== speakerId) continue;
        if (p.bus === 'reflex') reflex = true;
        else ambient = true;
      }
      return {
        conversation: us.length > 0,
        reflex,
        ambient,
        remainingMs: remaining === null ? null : Math.round(remaining),
        streamOpen: us.some((u) => !u.streamEnded),
      };
    },
    foregroundActive,
    stopReflexes,
    stopAtBoundary(speakerId: string) {
      const us = [...(live.get(speakerId) ?? [])];
      const head = us.find((u) => u.running && !u.isEnded);
      for (const u of us) {
        if (u === head) u.endAtBoundary();
        else u.stop();
      }
    },
    onOwnerVad(cb) {
      vadListeners.add(cb);
      return () => vadListeners.delete(cb);
    },

    support,
    destroy() {
      if (destroyed) return;
      engine.stopAll();
      destroyed = true;
      mic?.cancel();
      dictation?.cancel();
      mic = dictation = null;
      vad?.end();
      vad = null;
      lane?.destroy();
      removeGestureListeners();
      const gr = graph;
      graph = null;
      offline = null;
      channels.clear();
      if (gr) void gr.ctx.close().catch(() => undefined);
      speakingListeners.clear();
      micListeners.clear();
      vadListeners.clear();
    },
  };
  return engine;
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function isArrayBuffer(v: unknown): v is ArrayBuffer {
  return v instanceof ArrayBuffer || Object.prototype.toString.call(v) === '[object ArrayBuffer]';
}

function normalizeChunk(value: SpeakChunk, alignment: Alignment | null | undefined): SpeechChunk {
  if (isArrayBuffer(value)) return { audio: value, alignment: alignment ?? null };
  if (ArrayBuffer.isView(value as unknown)) {
    const v = value as unknown as ArrayBufferView;
    return { audio: v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer, alignment: alignment ?? null };
  }
  return value;
}

function decode(ctx: BaseAudioContext, audio: ArrayBuffer): Promise<AudioBuffer> {
  // decodeAudioData detaches its argument; keep the caller's bytes intact.
  const copy = audio.slice(0);
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(copy, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
