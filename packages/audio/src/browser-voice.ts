// Browser speechSynthesis fallback (no TTS key). speechSynthesis is one global queue per page, so
// all speakers share one lane: only one utterance is handed to the synthesiser at a time, which lets
// barge-in on one speaker cancel exactly that speaker's line and nothing else.
// Behaviour follows oncloudnine/shared/Modules/SpeechOutput.ts speakLocally (never throws, reports
// which source spoke), plus the onerror/stuck-onend guards that code lacked.

import type { BrowserVoiceHint } from './types';

export type BrowserSayResult = { status: 'completed' | 'stopped' | 'failed'; error?: string };

export interface BrowserSayJob {
  speakerId: string;
  text: string;
  hint?: BrowserVoiceHint;
  onStart?: (now: number) => void;
  onBoundary?: (charIndex: number, now: number) => void;
}

export interface BrowserSayHandle {
  done: Promise<BrowserSayResult>;
  cancel(): void;
}

interface Pending extends BrowserSayJob {
  resolve: (r: BrowserSayResult) => void;
  settled: boolean;
  utterance?: SpeechSynthesisUtterance;
  timers: ReturnType<typeof setTimeout>[];
}

/** No `onstart` within this long → the synthesiser is stuck or blocked. */
const START_TIMEOUT_MS = 5000;
/** Chrome can drop speak() issued right after cancel(). */
const CANCEL_SETTLE_MS = 60;

export class BrowserVoiceLane {
  private queue: Pending[] = [];
  private current: Pending | null = null;
  private lastCancelAt = -Infinity;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly synth: SpeechSynthesis,
    private readonly Utterance: new (text?: string) => SpeechSynthesisUtterance,
    private readonly now: () => number,
  ) {}

  say(job: BrowserSayJob): BrowserSayHandle {
    let resolve!: (r: BrowserSayResult) => void;
    const done = new Promise<BrowserSayResult>((r) => (resolve = r));
    const p: Pending = { ...job, resolve, settled: false, timers: [] };
    this.queue.push(p);
    this.pump();
    return { done, cancel: () => this.cancel(p) };
  }

  /** Cancel every job of one speaker (or all). */
  cancelSpeaker(speakerId?: string): void {
    for (const p of [...this.queue]) if (!speakerId || p.speakerId === speakerId) this.cancel(p);
    if (this.current && (!speakerId || this.current.speakerId === speakerId)) this.cancel(this.current);
  }

  private cancel(p: Pending): void {
    if (p.settled) return;
    const i = this.queue.indexOf(p);
    if (i >= 0) this.queue.splice(i, 1);
    if (this.current === p) {
      this.current = null;
      this.lastCancelAt = this.now();
      this.detach(p);
      try {
        this.synth.cancel();
      } catch {
        /* ignore */
      }
    }
    this.settle(p, { status: 'stopped' });
    this.pump();
  }

  private settle(p: Pending, r: BrowserSayResult): void {
    if (p.settled) return;
    p.settled = true;
    for (const t of p.timers) clearTimeout(t);
    p.timers = [];
    p.resolve(r);
  }

  private detach(p: Pending): void {
    const u = p.utterance;
    if (!u) return;
    u.onstart = null;
    u.onend = null;
    u.onerror = null;
    u.onboundary = null;
  }

  private pump(): void {
    if (this.current || !this.queue.length || this.pumpTimer) return;
    const wait = this.lastCancelAt + CANCEL_SETTLE_MS - this.now();
    if (wait > 0) {
      this.pumpTimer = setTimeout(() => {
        this.pumpTimer = null;
        this.pump();
      }, wait);
      return;
    }
    const p = this.queue.shift()!;
    this.current = p;
    const finish = (r: BrowserSayResult) => {
      if (this.current === p) this.current = null;
      this.detach(p);
      this.settle(p, r);
      this.pump();
    };
    let u: SpeechSynthesisUtterance;
    try {
      u = new this.Utterance(p.text);
    } catch (err) {
      finish({ status: 'failed', error: String(err) });
      return;
    }
    p.utterance = u;
    const hint = p.hint;
    if (hint?.rate) u.rate = Math.min(10, Math.max(0.1, hint.rate));
    if (hint?.pitch) u.pitch = Math.min(2, Math.max(0, hint.pitch));
    const voice = pickVoice(safeVoices(this.synth), hint, p.speakerId);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else if (hint?.lang) u.lang = hint.lang;
    let started = false;
    u.onstart = () => {
      if (started) return;
      started = true;
      p.onStart?.(this.now());
      // Guard against engines that never fire onend (long lines, some Chrome voices).
      const expected = (p.text.length / (14 * (u.rate || 1))) * 1000;
      p.timers.push(setTimeout(() => finish({ status: 'completed' }), expected * 3 + 5000));
    };
    u.onboundary = (e: SpeechSynthesisEvent) => {
      if (typeof e.charIndex === 'number') p.onBoundary?.(e.charIndex, this.now());
    };
    u.onend = () => finish({ status: 'completed' });
    u.onerror = (e: SpeechSynthesisErrorEvent) => {
      const code = e?.error ?? 'unknown';
      if (code === 'interrupted' || code === 'canceled') finish({ status: 'stopped' });
      else finish({ status: 'failed', error: code === 'not-allowed' ? 'The browser blocked speech until you click or press a key.' : `Browser speech failed (${code}).` });
    };
    p.timers.push(
      setTimeout(() => {
        if (started) return;
        try {
          this.synth.cancel();
        } catch {
          /* ignore */
        }
        this.lastCancelAt = this.now();
        finish({ status: 'failed', error: 'The browser voice did not start.' });
      }, START_TIMEOUT_MS),
    );
    try {
      this.synth.speak(u);
    } catch (err) {
      finish({ status: 'failed', error: String(err) });
    }
  }

  destroy(): void {
    this.cancelSpeaker();
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
  }
}

function safeVoices(synth: SpeechSynthesis): SpeechSynthesisVoice[] {
  try {
    return synth.getVoices?.() ?? [];
  } catch {
    return [];
  }
}

const FEMININE =
  /\b(female|woman|samantha|victoria|karen|moira|tessa|fiona|veena|serena|allison|ava|susan|zira|hazel|heera|catherine|jenny|aria|sonia|libby|emma|joanna|salli|kimberly|kendra|ivy|nicole|amy|olivia|natasha|clara|zoe|nora|siri female|google us english)\b/i;
const MASCULINE =
  /\b(male|man|daniel|alex|tom|aaron|arthur|gordon|lee|rishi|oliver|david|mark|george|james|ryan|guy|matthew|justin|joey|brian|russell|eric|thomas|evan|nathan|siri male)\b/i;
/** macOS novelty voices: never a coworker's voice. */
const NOVELTY =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|junior|ralph|fred|kathy|princess|grandma|grandpa|rocko|shelley|flo|eddy|reed|sandy)\b/i;

export function guessPresentation(name: string): 'feminine' | 'masculine' | null {
  if (FEMININE.test(name)) return 'feminine';
  if (MASCULINE.test(name)) return 'masculine';
  return null;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Pick a system voice: exact name hint, then language, then presentation; among equals the speaker id
 * picks deterministically, so different coworkers tend to get different voices.
 */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], hint?: BrowserVoiceHint, seed = ''): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  if (hint?.name) {
    const want = hint.name.toLowerCase();
    const named = voices.find((v) => v.name.toLowerCase().includes(want));
    if (named) return named;
  }
  const lang = (hint?.lang ?? 'en-US').toLowerCase();
  const base = lang.slice(0, 2);
  let pool = voices.filter((v) => !NOVELTY.test(v.name));
  if (!pool.length) pool = [...voices];
  const exact = pool.filter((v) => v.lang.toLowerCase().replace('_', '-') === lang);
  const sameBase = pool.filter((v) => v.lang.toLowerCase().startsWith(base));
  pool = exact.length ? exact : sameBase.length ? sameBase : pool;
  if (hint?.presentation && hint.presentation !== 'neutral') {
    const matching = pool.filter((v) => guessPresentation(v.name) === hint.presentation);
    if (matching.length) pool = matching;
  }
  const locals = pool.filter((v) => v.localService);
  // Local voices fire boundary events reliably (sharper text timing); network voices sound better.
  // Prefer local ones only when there is a real choice among them.
  if (locals.length >= 2) pool = locals;
  return pool[hash(seed) % pool.length] ?? null;
}
