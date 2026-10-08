// Speech to text on this device (voice/local-stt.ts): Whisper tiny through Transformers.js, in a worker so the page
// never stalls. The model (about 40 MB, quantized) downloads once from the Hugging Face hub and stays in the browser's
// cache; the audio never leaves the device. Messages: {id, audio: Float32Array (16 kHz mono), model, language?} in;
// {id, type: 'progress', pct} while the model loads, then {id, type: 'done', text} or {id, type: 'error', message}.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

env.allowLocalModels = false;

type In = { id: number; audio?: Float32Array; model: string; language?: string; warm?: boolean };

let loaded: { model: string; asr: Promise<AutomaticSpeechRecognitionPipeline> } | null = null;
/** Bytes per file while the model downloads, for one overall percentage. */
const files = new Map<string, { loaded: number; total: number }>();

function load(model: string, id: number): Promise<AutomaticSpeechRecognitionPipeline> {
  if (loaded?.model === model) return loaded.asr;
  files.clear();
  const asr = pipeline('automatic-speech-recognition', model, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let got = 0;
      let all = 0;
      for (const f of files.values()) {
        got += f.loaded;
        all += f.total;
      }
      self.postMessage({ id, type: 'progress', pct: all ? Math.min(99, Math.round((got / all) * 100)) : 0 });
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  loaded = { model, asr };
  asr.catch(() => {
    if (loaded?.asr === asr) loaded = null;
  });
  return asr;
}

self.onmessage = async (e: MessageEvent<In>) => {
  const { id, audio, model, language, warm } = e.data;
  try {
    const asr = await load(model, id);
    if (warm || !audio) {
      self.postMessage({ id, type: 'ready' });
      return;
    }
    const out = (await asr(audio, { ...(language ? { language, task: 'transcribe' } : {}), chunk_length_s: 30, stride_length_s: 5 })) as { text?: string } | { text?: string }[];
    const text = (Array.isArray(out) ? out.map((o) => o.text ?? '').join(' ') : (out.text ?? '')).trim();
    self.postMessage({ id, type: 'done', text });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
