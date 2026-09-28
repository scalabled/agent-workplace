// Streaming reply text → per-sentence TTS → one AsyncIterable of chunks for AudioEngine.speak().
// The first sentence (or first clause ≥60 chars) is synthesised the moment it completes, the next
// ones are fetched in parallel (bounded) while it plays, and they are yielded strictly in order.
// This is the "sentence-level chunking with pipelined fetches" the OC SpeechOutput review called for,
// on top of the PG SentenceChunker.

import type { Alignment, TtsJsonResponse } from '@headcount/protocol';
import { SentenceChunker, type ChunkerOptions } from './chunker';
import { SpeakableFilter } from './speakable';
import type { SpeechChunk } from './types';

export type Synthesize = (text: string, signal: AbortSignal) => Promise<ArrayBuffer | SpeechChunk>;

export interface SpeechStreamOptions {
  /**
   * Turns one sentence into audio (e.g. `api.tts` + speechChunkFromResponse). Omit when TTS is
   * unavailable: chunks then carry text only and the engine speaks them with the browser voice.
   */
  synthesize?: Synthesize;
  /** Sentences synthesised ahead of the one being consumed (default 2, min 1). */
  prefetch?: number;
  chunker?: Omit<ChunkerOptions, 'onChunk'>;
  /** A sentence failed to synthesise; its chunk falls back to text (browser voice). */
  onError?: (error: unknown, text: string) => void;
  /** Every sentence as it is cut (captions). */
  onSentence?: (text: string) => void;
}

export interface SpeechStream extends AsyncIterable<SpeechChunk> {
  /** Feed a streamed delta of reply text (Markdown is made speakable). */
  push(delta: string): void;
  /** The reply is complete: flush the last sentence and finish the iteration after it. */
  end(): void;
  /** Abort pending synthesis and end the iteration now (barge-in). Idempotent. */
  cancel(): void;
  readonly cancelled: boolean;
  /** Sentences cut so far. */
  readonly sentences: readonly string[];
}

interface Job {
  text: string;
  promise: Promise<SpeechChunk | null> | null;
}

export function createSpeechStream(opts: SpeechStreamOptions = {}): SpeechStream {
  const prefetch = Math.max(1, opts.prefetch ?? 2);
  const ctrl = new AbortController();
  // Resolves on cancel even when a synthesizer ignores its AbortSignal.
  const aborted = new Promise<null>((r) => ctrl.signal.addEventListener('abort', () => r(null), { once: true }));
  const filter = new SpeakableFilter();
  const jobs: Job[] = [];
  const sentences: string[] = [];
  let head = 0; // next job to yield
  let started = 0;
  let ended = false;
  let cancelled = false;
  let wake: (() => void) | null = null;
  let iterating = false;

  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  const run = (job: Job) => {
    const synth = opts.synthesize;
    if (!synth) {
      job.promise = Promise.resolve({ text: job.text });
      return;
    }
    job.promise = Promise.resolve()
      .then(() => synth(job.text, ctrl.signal))
      .then((v): SpeechChunk => (isBuffer(v) ? { audio: v, text: job.text } : { ...v, text: v.text ?? job.text }))
      .catch((err: unknown): SpeechChunk | null => {
        if (ctrl.signal.aborted) return null;
        opts.onError?.(err, job.text);
        return { text: job.text };
      });
  };

  const pump = () => {
    while (!cancelled && started < jobs.length && started - head < prefetch) run(jobs[started++]!);
  };

  const chunker = new SentenceChunker({
    ...opts.chunker,
    onChunk: (raw) => {
      const text = filter.push(raw);
      if (!text || !/[\p{L}\p{N}]/u.test(text)) return;
      sentences.push(text);
      opts.onSentence?.(text);
      jobs.push({ text, promise: null });
      pump();
      notify();
    },
  });

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    ctrl.abort();
    chunker.reset();
    notify();
  };

  const iterator: AsyncIterator<SpeechChunk> = {
    async next(): Promise<IteratorResult<SpeechChunk>> {
      for (;;) {
        if (cancelled) return { done: true, value: undefined };
        if (head < jobs.length) {
          pump();
          const job = jobs[head]!;
          if (!job.promise) run(job);
          const chunk = await Promise.race([job.promise!, aborted]);
          if (cancelled || !chunk) return { done: true, value: undefined };
          head++;
          pump();
          return { done: false, value: chunk };
        }
        if (ended) return { done: true, value: undefined };
        await new Promise<void>((r) => (wake = r));
      }
    },
    async return(): Promise<IteratorResult<SpeechChunk>> {
      cancel();
      return { done: true, value: undefined };
    },
  };

  return {
    push(delta: string) {
      if (ended || cancelled || !delta) return;
      chunker.push(delta);
    },
    end() {
      if (ended || cancelled) return;
      chunker.flush();
      ended = true;
      notify();
    },
    cancel,
    get cancelled() {
      return cancelled;
    },
    get sentences() {
      return sentences;
    },
    [Symbol.asyncIterator]() {
      if (iterating) throw new Error('A SpeechStream can be consumed once.');
      iterating = true;
      return iterator;
    },
  };
}

function isBuffer(v: unknown): v is ArrayBuffer {
  return v instanceof ArrayBuffer || Object.prototype.toString.call(v) === '[object ArrayBuffer]';
}

/** Error thrown by speechChunkFromResponse for a non-2xx TTS response (503 not_configured → browser voice). */
export class TtsHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly missingKeys?: string[],
  ) {
    super(message);
    this.name = 'TtsHttpError';
  }
}

/**
 * POST /api/speech/tts response → SpeechChunk. Handles raw audio bytes and `response: "json"`
 * (TtsJsonResponse with base64 audio and alignment). Throws TtsHttpError for non-2xx.
 */
export async function speechChunkFromResponse(res: Response, text?: string): Promise<SpeechChunk> {
  if (!res.ok) {
    let code = 'http_error';
    let message = `Speech failed (${res.status}).`;
    let missingKeys: string[] | undefined;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string; missingKeys?: string[] } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      missingKeys = body.error?.missingKeys;
    } catch {
      /* not JSON */
    }
    throw new TtsHttpError(res.status, code, message, missingKeys);
  }
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  const withText = (c: SpeechChunk): SpeechChunk => (text !== undefined ? { ...c, text } : c);
  if (type.includes('application/json')) {
    const body = (await res.json()) as TtsJsonResponse;
    return withText({ audio: base64ToArrayBuffer(body.audioBase64), mime: body.mime, alignment: validAlignment(body.alignment) });
  }
  return withText({ audio: await res.arrayBuffer(), mime: type.split(';')[0] || 'audio/mpeg' });
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function validAlignment(a: Alignment | null | undefined): Alignment | null {
  if (!a || !Array.isArray(a.chars) || !Array.isArray(a.startsMs) || a.chars.length !== a.startsMs.length) return null;
  return a;
}
