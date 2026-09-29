// ▶ voice samples on the landing page: each lead in their own catalog voice (never a browser voice pretending to
// be theirs). A pre-voiced sample shipped with the page (public/marketing/voices: audio plus lip-sync timing)
// plays without a key and without spending the TTS budget; without one, the worker's TTS speaks the line when a
// provider is configured. Its own lazy chunk, loaded on the first press. The face's mouth follows the audio
// actually playing.
import { createAudioEngine, createSpeechStream, speechChunkFromResponse, type AudioEngine, type SpeechChunk } from '@headcount/audio';
import { routePath, type Alignment, type MouthSampler, type VoiceRef } from '@headcount/protocol';
import type { VoiceSample } from 'virtual:headcount-landing';

let engine: AudioEngine | null = null;
let current: (() => void) | null = null;

export interface SampleHandle {
  sampler: MouthSampler;
  stop(): void;
}

const TIMING_URL = '/marketing/voices/manifest.json';
let timings: Promise<Map<string, Alignment | null>> | null = null;

/** Lip-sync timing per sample file, from the samples' manifest (fetched once, on the first ▶). */
function timingFor(file: string): Promise<Alignment | null> {
  const load = async (): Promise<Map<string, Alignment | null>> => {
    const r = await fetch(TIMING_URL);
    const all: Record<string, VoiceSample> = r.ok ? ((await r.json()) as Record<string, VoiceSample>) : {};
    return new Map(Object.values(all).flatMap((v) => v.chunks.map((c): [string, Alignment | null] => [c.file, c.alignment ?? null])));
  };
  const got = (timings ??= load().catch(() => new Map<string, Alignment | null>()));
  return got.then((m) => m.get(file) ?? null);
}

/** The pre-voiced chunks, fetched in order (the next one downloads while the first plays). Without timing, the mouth follows the text. */
async function* staticChunks(sample: VoiceSample, signal: AbortSignal): AsyncGenerator<SpeechChunk> {
  const pending = sample.chunks.map((c) =>
    Promise.all([fetch(c.file, { signal }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`sample ${r.status}`)))), timingFor(c.file)]).then(
      ([audio, alignment]): SpeechChunk => ({ audio, mime: c.mime, text: c.text, alignment }),
    ),
  );
  // A chunk that fails later must not surface as an unhandled rejection while an earlier one plays.
  for (const p of pending) p.catch(() => undefined);
  for (const p of pending) {
    if (signal.aborted) return;
    yield await p;
  }
}

export function playSample(opts: { speakerId: string; text: string; voiceRef: VoiceRef; sample?: VoiceSample | null; onSpeaking(speaking: boolean): void; onEnd(): void }): SampleHandle {
  engine ??= createAudioEngine();
  void engine.arm().catch(() => undefined);
  current?.();
  let cancel: () => void;
  let chunks: AsyncIterable<SpeechChunk>;
  if (opts.sample?.chunks.length) {
    const ac = new AbortController();
    chunks = staticChunks(opts.sample, ac.signal);
    cancel = () => ac.abort();
  } else {
    const stream = createSpeechStream({
      synthesize: async (sentence, signal) => {
        const res = await fetch(routePath('tts'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: sentence, voiceRef: opts.voiceRef, speakerId: opts.speakerId, response: 'json' }),
          signal,
        });
        return speechChunkFromResponse(res, sentence);
      },
    });
    stream.push(opts.text);
    stream.end();
    chunks = stream;
    cancel = () => stream.cancel();
  }
  const handle = engine.speak({ speakerId: opts.speakerId, chunks });
  const unsubscribe = engine.onSpeakingChange((id, speaking) => id === opts.speakerId && opts.onSpeaking(speaking));
  const stop = () => {
    cancel();
    handle.stop();
  };
  current = stop;
  void handle.done.then(() => {
    unsubscribe();
    if (current === stop) current = null;
    opts.onSpeaking(false);
    opts.onEnd();
  });
  return { sampler: engine.sampler(opts.speakerId), stop };
}

/** Stop whatever sample plays (the landing unmounts, or another sample starts). */
export function stopSamples(): void {
  current?.();
}
