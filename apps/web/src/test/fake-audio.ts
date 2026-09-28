// A recording AudioEngine for tests: speak() drains its chunks and reports what it would have played.
import { REST_SAMPLE, type MouthSampler } from '@headcount/protocol';
import type { AudioEngine, AudioSupport, SpeakChunk, SpeakHandle, SpeakOutcome, SpeakRequest } from '@headcount/audio';

export interface SpokenRecord {
  speakerId: string;
  /** For string requests: the text; for chunk streams: each chunk as received. */
  chunks: SpeakChunk[];
  text: string | null;
  stopped: boolean;
  done: Promise<SpeakOutcome>;
}

export interface FakeAudio extends AudioEngine {
  spoken: SpokenRecord[];
  stops: string[];
  /** Wait until every speak() has drained its chunks. */
  drain(): Promise<void>;
}

export function createFakeAudio(support: Partial<AudioSupport> = {}): FakeAudio {
  const spoken: SpokenRecord[] = [];
  const stops: string[] = [];
  const pending: Promise<unknown>[] = [];
  const gens = new Map<string, number>();
  const listeners = new Set<(id: string, on: boolean) => void>();
  const sampler: MouthSampler = { sample: () => REST_SAMPLE };

  const engine: FakeAudio = {
    spoken,
    stops,
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
    micLive: () => false,
    onMicChange: () => () => undefined,
    support: () => ({ webAudio: true, mic: false, speechSynthesis: true, speechRecognition: false, ...support }),
    destroy() {},
  };
  return engine;
}
