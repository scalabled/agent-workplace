// Push-to-talk gestures over AudioEngine (EXPERIENCE §5.1): hold Space or the bubble and release to
// send, or click to start and click again to stop. The web maps pointer/keyboard events to press()
// and release(); this decides when a recording starts, ends, or is too short to send.

import { micError } from './mic';
import { MicError, type AudioEngine, type DictationSession, type MicSession } from './types';

/**
 * - `hold`: press starts, release sends.
 * - `toggle`: a click starts, the next click sends (release is ignored).
 * - `auto` (default): holding longer than `holdMs` behaves like `hold`; a quick tap latches like `toggle`.
 */
export type PushToTalkMode = 'hold' | 'toggle' | 'auto';
export type PushToTalkState = 'idle' | 'starting' | 'recording' | 'finishing';
export type PushToTalkResult =
  | { kind: 'audio'; blob: Blob; mime: string; durationMs: number }
  | { kind: 'text'; text: string; durationMs: number };

export interface PushToTalkOptions {
  mode?: PushToTalkMode;
  /** Use the browser recognizer instead of recording (STT unavailable). A function is read at each press. */
  dictation?: boolean | (() => boolean);
  lang?: string;
  /** `auto`: presses shorter than this latch into toggle mode. Default 300 ms. */
  holdMs?: number;
  /** Held recordings shorter than this are discarded as accidental. Default 250 ms. */
  minMs?: number;
  /** Recording stops by itself after this long. Default 60 s. */
  maxMs?: number;
  now?: () => number;
  onResult: (result: PushToTalkResult) => void;
  onState?: (state: PushToTalkState) => void;
  onError?: (error: MicError) => void;
  /** Interim transcript while dictating. */
  onPartial?: (text: string) => void;
  /** A press was too short to send (show a quiet "Hold to talk" hint). */
  onTooShort?: () => void;
}

export interface PushToTalk {
  press(): void;
  release(): void;
  /** Stop and discard (Escape, navigation). */
  cancel(): void;
  readonly state: PushToTalkState;
  /** True while a tap has latched the mic open (the next press sends). */
  readonly latched: boolean;
  /** 0–1 mic level while recording (0 when dictating: the recognizer exposes no stream). */
  level(): number;
  /** Interim transcript while dictating. */
  partial(): string;
  destroy(): void;
}

export function createPushToTalk(engine: AudioEngine, opts: PushToTalkOptions): PushToTalk {
  const mode = opts.mode ?? 'auto';
  const holdMs = opts.holdMs ?? 300;
  const minMs = opts.minMs ?? 250;
  const maxMs = opts.maxMs ?? 60_000;
  const now = opts.now ?? (() => performance.now());
  let state: PushToTalkState = 'idle';
  let latched = false;
  let held = false;
  let pressAt = 0;
  let startedAt = 0;
  let pendingFinish = false;
  let recording: MicSession | null = null;
  let dictating: DictationSession | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let destroyed = false;

  const setState = (s: PushToTalkState) => {
    if (state === s) return;
    state = s;
    opts.onState?.(s);
  };
  const reset = () => {
    if (maxTimer) clearTimeout(maxTimer);
    maxTimer = null;
    recording = null;
    dictating = null;
    latched = false;
    held = false;
    pendingFinish = false;
    setState('idle');
  };
  const useDictation = () => (typeof opts.dictation === 'function' ? opts.dictation() : !!opts.dictation);

  async function start(): Promise<void> {
    const my = ++attempt;
    setState('starting');
    try {
      if (useDictation()) {
        const d = engine.startDictation({
          ...(opts.lang ? { lang: opts.lang } : {}),
          ...(opts.onPartial ? { onPartial: opts.onPartial } : {}),
          onError: (e) => opts.onError?.(e),
        });
        if (!d) throw micError('unsupported');
        dictating = d;
      } else {
        recording = await engine.startPushToTalk();
      }
    } catch (err) {
      if (my !== attempt) return;
      reset();
      opts.onError?.(err instanceof MicError ? err : micError('failed'));
      return;
    }
    if (my !== attempt || destroyed) {
      recording?.cancel();
      dictating?.cancel();
      return;
    }
    startedAt = now();
    setState('recording');
    maxTimer = setTimeout(() => void finish(), maxMs);
    if (pendingFinish) void finish();
  }

  async function finish(): Promise<void> {
    if (state === 'starting') {
      pendingFinish = true;
      return;
    }
    if (state !== 'recording') return;
    const wasLatched = latched;
    setState('finishing');
    if (maxTimer) clearTimeout(maxTimer);
    maxTimer = null;
    const durationMs = now() - startedAt;
    const my = attempt;
    const tooShort = durationMs < minMs && !wasLatched;
    if (dictating) {
      const d = dictating;
      if (tooShort) {
        d.cancel();
        reset();
        opts.onTooShort?.();
        return;
      }
      const text = (await d.stop()).trim();
      if (my !== attempt) return;
      reset();
      if (text) opts.onResult({ kind: 'text', text, durationMs });
      return;
    }
    const rec = recording;
    if (!rec) return reset();
    if (tooShort) {
      rec.cancel();
      reset();
      opts.onTooShort?.();
      return;
    }
    const blob = await rec.stop();
    if (my !== attempt) return;
    reset();
    if (blob.size > 0) opts.onResult({ kind: 'audio', blob, mime: rec.mime, durationMs });
  }

  function cancel(): void {
    attempt++; // a start still waiting on permission cancels itself when it resolves
    recording?.cancel();
    dictating?.cancel();
    reset();
  }

  return {
    press() {
      if (destroyed) return;
      if (state === 'idle') {
        held = true;
        latched = false;
        pressAt = now();
        void start();
        return;
      }
      if ((state === 'recording' || state === 'starting') && latched) {
        held = false;
        void finish();
      }
    },
    release() {
      if (!held) return;
      held = false;
      if (mode === 'toggle') {
        latched = true;
        return;
      }
      if (mode === 'auto' && now() - pressAt < holdMs) {
        latched = true;
        return;
      }
      void finish();
    },
    cancel,
    get state() {
      return state;
    },
    get latched() {
      return latched;
    },
    level: () => (state === 'recording' && recording ? recording.level() : 0),
    partial: () => dictating?.partial() ?? '',
    destroy() {
      cancel();
      destroyed = true;
    },
  };
}
