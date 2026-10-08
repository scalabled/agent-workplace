// Speech to text on this device: the fallback that works in every modern browser (voice/ptt.ts). Used when the office
// has no speech service set up, or when it cannot be reached; browser speech recognition (unreliable on many phones)
// comes last. The recording is decoded and resampled to 16 kHz mono here, and Whisper tiny transcribes it in a worker
// (whisper.worker.ts). The first use downloads the model once (about 40 MB); later uses start at once.

/** English-only tiny Whisper is the more accurate for English; the multilingual one for everything else. */
export function whisperModel(lang: string | undefined): string {
  return !lang || /^en\b/i.test(lang) ? 'Xenova/whisper-tiny.en' : 'Xenova/whisper-tiny';
}

/** The language Whisper is told: "fr-CA" → "fr"; English needs none (the English-only model). */
export function whisperLanguage(lang: string | undefined): string | undefined {
  const two = (lang ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return /^[a-z]{2}$/.test(two) && two !== 'en' ? two : undefined;
}

/** Can this browser record and run the model? (A worker, WebAssembly, the mic and an audio decoder.) */
export function localSttSupported(): boolean {
  try {
    return (
      typeof Worker === 'function' &&
      typeof WebAssembly === 'object' &&
      typeof MediaRecorder === 'function' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof (globalThis.OfflineAudioContext ?? (globalThis as { webkitOfflineAudioContext?: unknown }).webkitOfflineAudioContext) === 'function'
    );
  } catch {
    return false;
  }
}

type Out = { id: number; type: 'progress'; pct: number } | { id: number; type: 'ready' } | { id: number; type: 'done'; text: string } | { id: number; type: 'error'; message: string };

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve(text: string): void; reject(err: Error): void; onProgress?: (pct: number) => void }>();
/** The model is in memory (a transcription can start at once). */
let ready = false;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<Out>) => {
    const d = e.data;
    const w = waiting.get(d.id);
    if (d.type === 'progress') return w?.onProgress?.(d.pct);
    if (d.type !== 'error') ready = true;
    if (!w) return;
    waiting.delete(d.id);
    if (d.type === 'error') w.reject(new Error(d.message));
    else w.resolve(d.type === 'done' ? d.text : '');
  };
  worker.onerror = () => {
    for (const w of waiting.values()) w.reject(new Error('Speech recognition on this device stopped.'));
    waiting.clear();
    worker?.terminate();
    worker = null;
    ready = false;
  };
  return worker;
}

function ask(msg: { audio?: Float32Array; model: string; language?: string; warm?: boolean }, onProgress?: (pct: number) => void): Promise<string> {
  const id = ++seq;
  return new Promise<string>((resolve, reject) => {
    waiting.set(id, { resolve, reject, ...(onProgress ? { onProgress } : {}) });
    getWorker().postMessage({ id, ...msg }, msg.audio ? [msg.audio.buffer] : []);
  });
}

/** Start loading the model (on the first press, so it is ready by the time the owner lets go). */
export function warmLocalStt(lang?: string): void {
  if (ready || !localSttSupported()) return;
  ask({ model: whisperModel(lang), warm: true }).catch(() => undefined);
}

/** True once the model is loaded (no download wait). */
export function localSttReady(): boolean {
  return ready;
}

/** A recording → 16 kHz mono samples (what Whisper expects). */
export async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  const Ctx = (globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)!;
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      // Older Safari only has the callback form.
      const p = ctx.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined;
      p?.then(resolve, reject);
    });
  } finally {
    void ctx.close().catch(() => undefined);
  }
  const rate = 16_000;
  const Offline = (globalThis.OfflineAudioContext ?? (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext)!;
  const offline = new Offline(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const out = await offline.startRendering();
  return out.getChannelData(0).slice();
}

/** What the owner said in a recording, transcribed on this device. `onProgress` reports the first download (0–99). */
export async function transcribeLocally(blob: Blob, opts: { lang?: string; onProgress?: (pct: number) => void } = {}): Promise<string> {
  const audio = await decodeTo16k(blob);
  const language = whisperLanguage(opts.lang);
  return ask({ audio, model: whisperModel(opts.lang), ...(language ? { language } : {}) }, opts.onProgress);
}
