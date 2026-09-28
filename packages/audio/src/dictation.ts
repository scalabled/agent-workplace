// Keyless STT through the browser's SpeechRecognition (webkit-prefixed in Chrome/Safari).
// Chrome ends "continuous" sessions after a pause; the session restarts itself until stop() so a
// held push-to-talk is not cut short, and keeps what was already recognised.

import { recognitionError } from './mic';
import type { BrowserRecognition, DictationOptions, DictationSession, MicError } from './types';

const MAX_RESTARTS = 8;
const STOP_TIMEOUT_MS = 2500;

export function startRecognition(Ctor: new () => BrowserRecognition, opts: DictationOptions & { onLive?: (live: boolean) => void } = {}): DictationSession {
  const rec = new Ctor();
  rec.lang = opts.lang ?? 'en-US';
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 1;
  let committed = ''; // text from sessions that already ended (restarts)
  let current = '';
  let stopRequested = false;
  let cancelled = false;
  let ended = false;
  let restarts = 0;
  let error: MicError | null = null;
  let live = false;
  const waiters: ((t: string) => void)[] = [];

  const text = () => `${committed} ${current}`.replace(/\s+/g, ' ').trim();
  const setLive = (on: boolean) => {
    if (live === on) return;
    live = on;
    opts.onLive?.(on);
  };
  const settle = () => {
    ended = true;
    setLive(false);
    const t = cancelled ? '' : text();
    for (const w of waiters.splice(0)) w(t);
  };

  rec.onstart = () => setLive(true);
  rec.onresult = (e) => {
    let s = '';
    for (let i = 0; i < e.results.length; i++) s += e.results[i]![0]?.transcript ?? '';
    current = s;
    opts.onPartial?.(text());
  };
  rec.onerror = (e) => {
    const err = recognitionError(e.error);
    if (!err) return;
    error = err;
    opts.onError?.(err);
  };
  rec.onend = () => {
    if (!stopRequested && !cancelled && !error && restarts < MAX_RESTARTS) {
      committed = text();
      current = '';
      restarts++;
      try {
        rec.start();
        return;
      } catch {
        /* fall through to settle */
      }
    }
    settle();
  };
  try {
    rec.start();
    setLive(true);
  } catch {
    error = recognitionError('unknown');
    settle();
  }

  return {
    partial: text,
    error: () => error,
    stop() {
      if (ended) return Promise.resolve(cancelled ? '' : text());
      stopRequested = true;
      return new Promise<string>((resolve) => {
        waiters.push(resolve);
        const timer = setTimeout(() => {
          if (!ended) settle();
        }, STOP_TIMEOUT_MS);
        waiters.push(() => clearTimeout(timer));
        try {
          rec.stop();
        } catch {
          settle();
        }
      });
    },
    cancel() {
      if (ended) return;
      cancelled = true;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      settle();
    },
  };
}
