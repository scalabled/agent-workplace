// A recording AudioEngine for tests: speak() drains its chunks and reports what it would have played.
import { REST_SAMPLE, type MouthSampler } from '@headcount/protocol';
import type {
  AudioEngine,
  AudioSupport,
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
} from '@headcount/audio';

export interface SpokenRecord {
  speakerId: string;
  /** For string requests: the text; for chunk streams: each chunk as received. */
  chunks: SpeakChunk[];
  text: string | null;
  stopped: boolean;
  done: Promise<SpeakOutcome>;
}

/** A reflex the fake engine was asked to play (a prepared clip or a browser-voice line). */
export interface ReflexRecord {
  speakerId: string;
  kind: 'clip' | 'text';
  /** Clip key, or the text for browser-voice lines. */
  key: string;
  bus: 'reflex' | 'ambient';
  priority: number;
  ttlMs: number;
  gainDb?: number;
  mode?: 'now' | 'interject';
  duringOwner?: boolean;
  stopped: boolean;
}

export interface FakeAudio extends AudioEngine {
  spoken: SpokenRecord[];
  stops: string[];
  /** Reflex plays, in order. */
  reflexes: ReflexRecord[];
  /** Keys decoded with prepare(). */
  prepared: string[];
  /** stopAtBoundary() calls, by speaker. */
  boundaryStops: string[];
  /** Wait until every speak() has drained its chunks. */
  drain(): Promise<void>;
  /** Pretend a speaker's audio is in this state (activity()). */
  setActivity(speakerId: string, a: Partial<SpeakerActivity> | null): void;
  setMicLive(on: boolean): void;
  /** Emit an owner VAD event to onOwnerVad listeners. */
  vad(e: OwnerVadEvent): void;
}

export function createFakeAudio(support: Partial<AudioSupport> = {}): FakeAudio {
  const spoken: SpokenRecord[] = [];
  const stops: string[] = [];
  const pending: Promise<unknown>[] = [];
  const gens = new Map<string, number>();
  const listeners = new Set<(id: string, on: boolean) => void>();
  const sampler: MouthSampler = { sample: () => REST_SAMPLE };
  const reflexes: ReflexRecord[] = [];
  const prepared: string[] = [];
  const boundaryStops: string[] = [];
  const activities = new Map<string, SpeakerActivity>();
  const vadListeners = new Set<(e: OwnerVadEvent) => void>();
  let mic = false;
  const IDLE: SpeakerActivity = { conversation: false, reflex: false, ambient: false, remainingMs: null, streamOpen: false };

  /** A reflex that "plays" for `ms` (real or fake timers), unless stopped first. */
  const reflex = (rec: ReflexRecord, ms: number, onStart?: () => void): ReflexHandle => {
    reflexes.push(rec);
    let finish!: (o: 'completed' | 'stopped' | 'dropped') => void;
    const done = new Promise<'completed' | 'stopped' | 'dropped'>((r) => (finish = r));
    const timer = setTimeout(() => finish('completed'), ms);
    onStart?.();
    return {
      started: Promise.resolve(true),
      done,
      stop() {
        rec.stopped = true;
        clearTimeout(timer);
        finish('stopped');
      },
    };
  };

  const engine: FakeAudio = {
    spoken,
    stops,
    reflexes,
    prepared,
    boundaryStops,
    setActivity(id, a) {
      if (a) activities.set(id, { ...IDLE, ...a });
      else activities.delete(id);
    },
    setMicLive(on) {
      mic = on;
    },
    vad(e) {
      for (const cb of vadListeners) cb(e);
    },
    async prepare(bytes: ArrayBuffer, opts?: { key?: string; alignment?: PreparedAudio['alignment']; text?: string }): Promise<PreparedAudio> {
      const key = opts?.key ?? `clip${prepared.length}`;
      prepared.push(key);
      return { key, durationMs: 600, alignment: opts?.alignment ?? null, text: opts?.text ?? null, bytes: Math.max(1, bytes.byteLength) * 16 };
    },
    playPrepared(req: PlayPreparedRequest): ReflexHandle {
      const rec: ReflexRecord = { speakerId: req.speakerId, kind: 'clip', key: req.audio.key, bus: req.bus, priority: req.priority, ttlMs: req.ttlMs, gainDb: req.gainDb, stopped: false };
      if (req.mode) rec.mode = req.mode;
      if (req.duringOwner !== undefined) rec.duringOwner = req.duringOwner;
      return reflex(rec, req.audio.durationMs, req.onStart);
    },
    speakReflexText(req: SpeakReflexTextRequest): ReflexHandle | null {
      return reflex({ speakerId: req.speakerId, kind: 'text', key: req.text, bus: req.bus, priority: req.priority, ttlMs: req.ttlMs, stopped: false }, 200 + req.text.length * 55, req.onStart);
    },
    activity: (id) => activities.get(id) ?? IDLE,
    foregroundActive: () => [...activities.values()].some((a) => a.conversation),
    stopReflexes(filter) {
      for (const r of reflexes) if ((!filter?.speakerId || r.speakerId === filter.speakerId) && (!filter?.bus || r.bus === filter.bus)) r.stopped = true;
    },
    stopAtBoundary(id) {
      boundaryStops.push(id);
    },
    onOwnerVad(cb) {
      vadListeners.add(cb);
      return () => vadListeners.delete(cb);
    },
    async drain() {
      for (let i = 0; i < 5; i++) await Promise.all(pending);
    },
    armed: true,
    async arm() {},
    speak(req: SpeakRequest): SpeakHandle {
      let finish!: (o: SpeakOutcome) => void;
      const done = new Promise<SpeakOutcome>((r) => (finish = r));
      const rec: SpokenRecord = { speakerId: req.speakerId, chunks: [], text: typeof req.chunks === 'string' ? req.chunks : null, stopped: false, done };
      spoken.push(rec);
      if (typeof req.chunks === 'string') finish({ status: 'completed', source: 'browser' });
      else {
        const chunks = req.chunks;
        pending.push(
          (async () => {
            for await (const c of chunks) {
              if (rec.stopped) break;
              rec.chunks.push(c);
            }
            finish({ status: rec.stopped ? 'stopped' : 'completed', source: 'audio' });
          })(),
        );
      }
      return {
        speakerId: req.speakerId,
        generation: gens.get(req.speakerId) ?? 0,
        sampler,
        done,
        stop() {
          rec.stopped = true;
          finish({ status: 'stopped', source: 'none' });
        },
      };
    },
    stopSpeaker(id) {
      stops.push(id);
      gens.set(id, (gens.get(id) ?? 0) + 1);
      for (const r of spoken) if (r.speakerId === id) r.stopped = true;
    },
    stopAll() {
      for (const id of new Set(spoken.map((r) => r.speakerId))) engine.stopSpeaker(id);
    },
    speaking: () => [],
    onSpeakingChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    sampler: () => sampler,
    generation: (id) => gens.get(id) ?? 0,
    duck() {},
    ducked: false,
    async startPushToTalk() {
      throw new Error('no mic in tests');
    },
    startDictation: () => null,
    micLive: () => mic,
    onMicChange: () => () => undefined,
    support: () => ({ webAudio: true, mic: false, speechSynthesis: true, speechRecognition: false, ...support }),
    destroy() {},
  };
  return engine;
}
