// The room's voicer ‖ player (OFFICE-PHASE2 §4.4.1). The server writes a room turn at machine speed (up to three
// responders and a wrap-up, one after the other); this plays their lines in server order, one at a time, each in its
// own voice. For line k the speaker is fed only while k ≤ playing + 2 (two lines of TTS look-ahead), and each fed line
// waits behind a gate that opens when the line before it has ended and 250 ms have passed, so audio never overlaps.
// Whether a line is voiced is decided again when it starts (one voice per workspace can move meanwhile); a line that
// is not voiced is shown as a caption for its reading time. Barge-in (hush) stops every room speaker at once and drops
// what has not played yet.
import type { SpeakerObserver } from '../voice/speaker';

/** Lines of TTS fed ahead of the one playing. */
export const LOOKAHEAD_LINES = 2;
/** Silence between two speakers. */
export const SPEAKER_GAP_MS = 250;
/**
 * A catalog reflex reply (phatic mode) waits this long before it is voiced here: when the server also sends its
 * pre-voiced clip (`reflex.say`), the clip voices it and this tab does not synthesise it a second time.
 */
export const REFLEX_GRACE_MS = 200;
/** A voiced line that has not started sounding this long after its turn came is shown as text instead. */
export const START_STALL_MS = 8000;

/** How long a line that is not voiced stays up: `clamp(1800 + 55 ms × characters, 2200, 6000)`. */
export function readingMs(text: string): number {
  return Math.min(6000, Math.max(2200, 1800 + 55 * text.length));
}

/** What the player needs of an agent's speaker (voice/speaker.ts `AgentSpeaker`). */
export interface RoomSpeaker {
  holdNext(release: Promise<void>): void;
  delta(messageId: string, text: string): void;
  complete(messageId: string, finalText?: string): void;
  endHere(messageId: string): void;
  stop(): void;
  observe(o: SpeakerObserver): () => void;
}

/** May this tab voice a room line now, and should an unvoiced line say NOT VOICED (voice off, or keyless)? */
export interface VoiceVerdict {
  voiced: boolean;
  notVoicedTag: boolean;
}

export interface PlayerDeps {
  speakerOf(agentId: string): RoomSpeaker | null;
  /** Synthesised lines: voice on, this tab has the voice (settled), provider TTS configured. */
  voice(): VoiceVerdict;
  /** Lines voiced by their own pre-voiced clip (the living runtime plays it): the same, without the TTS condition. */
  clipVoice(): VoiceVerdict;
  now(): number;
  schedule(fn: () => void, ms: number): () => void;
}

export interface PlayerLine {
  readonly agentId: string;
  readonly messageId: string;
  readonly text: string;
  readonly final: boolean;
  /** It started (voiced, or shown as a caption for its reading time). */
  readonly heard: boolean;
  readonly state: 'waiting' | 'playing' | 'done' | 'dropped';
}

export interface PlayerEvents {
  /** The line's turn came: its audio started (voiced), or its caption goes up for its reading time. */
  onStart(line: PlayerLine, voiced: boolean, notVoicedTag: boolean): void;
  /** Its text grew or became final. */
  onText(line: PlayerLine): void;
  onEnd(line: PlayerLine): void;
  /** Everything of the turn has played, and the turn is over. */
  onIdle(): void;
  /** Which lines wait changed (the floor queue). */
  onChange(): void;
}

interface Line {
  agentId: string;
  messageId: string;
  text: string;
  final: boolean;
  heard: boolean;
  state: PlayerLine['state'];
  /** How it is fed: not yet, to its speaker (TTS), as text only, or voiced by its reflex clip elsewhere. */
  mode: 'none' | 'voice' | 'text' | 'clip';
  reflex: boolean;
  clipMs: number | null;
  /** Not before (a reflex waits for its clip). */
  readyAt: number;
  speaker: RoomSpeaker | null;
  release: (() => void) | null;
  /** The speaker is done with it (played, stopped, failed). */
  speakerEnded: boolean;
  audioStarted: boolean;
  /** Playing as voice (else as text). */
  voicedNow: boolean;
  startedAt: number;
  cancelEnd: (() => void) | null;
  cancelStall: (() => void) | null;
}

const view = (l: Line): PlayerLine => l;

export class RoomPlayer {
  private readonly lines: Line[] = [];
  private readonly byId = new Map<string, Line>();
  /** Index of the line playing, or the next one to play. */
  private cur = 0;
  private gapUntil = 0;
  private over = false;
  private idleSent = true;
  private cancelPump: (() => void) | null = null;
  private readonly watched = new Map<RoomSpeaker, () => void>();
  /** Nothing was handed to a speaker since the last hush: a hush has no audio to stop. */
  private quiet = true;
  private destroyed = false;

  constructor(
    private readonly deps: PlayerDeps,
    private readonly ev: PlayerEvents,
  ) {}

  /** A new turn begins (the owner said something): lines that arrive now belong to it. */
  beginTurn(): void {
    this.over = false;
    this.idleSent = false;
  }

  /** The server will write no more lines for this turn. */
  turnOver(): void {
    this.over = true;
    this.pump();
  }

  /** Streamed text of a responder's line (whole sentences). */
  append(agentId: string, messageId: string, delta: string): void {
    if (this.destroyed || !delta) return;
    const line = this.lineFor(agentId, messageId);
    if (!line || line.final || line.state === 'dropped' || line.state === 'done') return;
    line.text += delta;
    if (line.mode === 'voice') line.speaker?.delta(messageId, delta);
    this.ev.onText(view(line));
    this.pump();
  }

  /** The line is complete. `reflex`: a catalog reply (phatic mode), which may come with its own clip. */
  finish(agentId: string, messageId: string, text: string, opts: { reflex?: boolean } = {}): void {
    if (this.destroyed) return;
    const fresh = !this.byId.has(messageId);
    const line = this.lineFor(agentId, messageId);
    if (!line || line.final || line.state === 'dropped' || line.state === 'done') return;
    if (fresh && opts.reflex) {
      line.reflex = true;
      line.readyAt = this.deps.now() + REFLEX_GRACE_MS;
    }
    // The persisted text is the truth; it only differs from what streamed when a delta was lost.
    if (text) line.text = text;
    line.final = true;
    if (line.mode === 'voice') line.speaker?.complete(messageId, line.text);
    this.ev.onText(view(line));
    if (line.state === 'playing' && !line.voicedNow) this.scheduleTextEnd(line);
    this.pump();
  }

  /** A responder's reply failed or was cut: what streamed ends where it is (nothing new is said). */
  fail(agentId: string, messageId: string | null): void {
    if (this.destroyed) return;
    const line = messageId ? this.byId.get(messageId) : [...this.lines].reverse().find((l) => l.agentId === agentId && !l.final);
    if (!line || line.final) return;
    line.final = true;
    if (line.mode === 'voice') line.speaker?.endHere(line.messageId);
    this.ev.onText(view(line));
    if (line.state === 'playing' && !line.voicedNow) this.scheduleTextEnd(line);
    this.pump();
  }

  /** The feed was cut (the socket came back): every line still streaming ends where it is; its rest never arrives. */
  failOpen(): void {
    if (this.destroyed) return;
    for (const l of [...this.lines]) if (!l.final && l.state !== 'dropped') this.fail(l.agentId, l.messageId);
  }

  /** The server sent this agent's line as a pre-voiced clip (reflex.say): the clip voices it, not this player. */
  clip(agentId: string, durationMs: number | null): void {
    const line = [...this.lines].reverse().find((l) => l.agentId === agentId && l.reflex && l.state === 'waiting');
    if (!line || line.mode !== 'none') return;
    line.mode = 'clip';
    line.clipMs = durationMs;
    this.pump();
  }

  /**
   * Barge-in: every room speaker stops now, and lines not yet played are dropped (they stay in the transcript as not
   * heard). A line playing as text ends at once.
   */
  hush(): void {
    const wasBusy = !this.idleSent;
    this.cancelPump?.();
    this.cancelPump = null;
    for (let k = this.cur; k < this.lines.length; k++) {
      const l = this.lines[k]!;
      l.cancelEnd?.();
      l.cancelStall?.();
      if (l.state === 'playing') {
        l.state = 'done';
        this.ev.onEnd(view(l));
      } else if (l.state === 'waiting') l.state = 'dropped';
    }
    if (!this.quiet) {
      this.quiet = true;
      for (const sp of this.watched.keys()) {
        try {
          sp.stop();
        } catch {
          /* no audio */
        }
      }
    }
    // A gated utterance was stopped with its stream: let its reader see that and finish.
    for (const l of this.lines) {
      l.release?.();
      l.release = null;
    }
    this.cur = this.lines.length;
    this.over = true;
    this.idleSent = true;
    this.ev.onChange();
    // The cut line's caption clears like any finished turn's (a barge-in with no words after it leaves nothing up).
    if (wasBusy && !this.destroyed) this.ev.onIdle();
  }

  /** Agents whose lines have arrived but not started, in order. */
  waiting(): string[] {
    const out: string[] = [];
    for (let k = this.cur; k < this.lines.length; k++) {
      const l = this.lines[k]!;
      if (l.state === 'waiting') out.push(l.agentId);
    }
    return out;
  }

  /** The line (as the transcript shows it), or undefined. */
  get(messageId: string): PlayerLine | undefined {
    return this.byId.get(messageId);
  }

  /** Is anything playing or waiting to play? */
  get busy(): boolean {
    return this.lines.slice(this.cur).some((l) => l.state === 'playing' || l.state === 'waiting');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.hush();
    this.destroyed = true;
    for (const off of this.watched.values()) off();
    this.watched.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private lineFor(agentId: string, messageId: string): Line | null {
    const have = this.byId.get(messageId);
    if (have) return have;
    if (this.over && this.idleSent) return null; // a hushed turn's late frames: never played
    const line: Line = {
      agentId,
      messageId,
      text: '',
      final: false,
      heard: false,
      state: 'waiting',
      mode: 'none',
      reflex: false,
      clipMs: null,
      readyAt: 0,
      speaker: null,
      release: null,
      speakerEnded: false,
      audioStarted: false,
      voicedNow: false,
      startedAt: 0,
      cancelEnd: null,
      cancelStall: null,
    };
    this.lines.push(line);
    this.byId.set(messageId, line);
    this.ev.onChange();
    return line;
  }

  private watch(sp: RoomSpeaker): void {
    if (this.watched.has(sp)) return;
    this.watched.set(
      sp,
      sp.observe({
        started: (id) => this.onAudioStarted(id),
        ended: (id) => this.onAudioEnded(id),
      }),
    );
  }

  private pump(): void {
    if (this.destroyed) return;
    this.cancelPump?.();
    this.cancelPump = null;
    const now = this.deps.now();
    let wakeAt = Infinity;
    for (let k = this.cur; k < this.lines.length && k <= this.cur + LOOKAHEAD_LINES; k++) {
      const wait = this.feed(this.lines[k]!, now);
      if (wait) wakeAt = Math.min(wakeAt, wait);
    }
    const line = this.lines[this.cur];
    if (line?.state === 'waiting') {
      if (line.final && !line.text.trim()) {
        line.state = 'dropped';
        this.cur++;
        this.ev.onChange();
        return this.pump();
      }
      if (line.text.trim()) {
        const at = Math.max(this.gapUntil, line.readyAt);
        if (now >= at) this.start(line, now);
        else wakeAt = Math.min(wakeAt, at);
      }
    } else if (line?.state === 'dropped') {
      this.cur++;
      return this.pump();
    }
    if (wakeAt !== Infinity) this.cancelPump = this.deps.schedule(() => this.pump(), Math.max(0, wakeAt - now));
    if (!this.lines[this.cur] && this.over && !this.idleSent) {
      this.idleSent = true;
      this.ev.onIdle();
    }
  }

  /** Feed a line to its speaker (or settle it as text). Returns when to look again, if it must wait. */
  private feed(line: Line, now: number): number | null {
    if (line.mode !== 'none' || line.state !== 'waiting') return null;
    if (line.reflex && now < line.readyAt) return line.readyAt;
    const sp = this.deps.voice().voiced ? this.deps.speakerOf(line.agentId) : null;
    if (!sp) {
      line.mode = 'text';
      return null;
    }
    this.toSpeaker(line, sp, true);
    return null;
  }

  private toSpeaker(line: Line, sp: RoomSpeaker, gated: boolean): void {
    this.quiet = false;
    line.mode = 'voice';
    line.speaker = sp;
    this.watch(sp);
    if (gated) sp.holdNext(new Promise<void>((resolve) => (line.release = resolve)));
    sp.delta(line.messageId, line.text);
    if (line.final) sp.complete(line.messageId, line.text);
  }

  private start(line: Line, now: number): void {
    line.state = 'playing';
    line.startedAt = now;
    line.heard = true;
    this.ev.onChange();
    if (line.mode === 'clip') {
      const v = this.deps.clipVoice();
      this.ev.onStart(view(line), v.voiced, v.voiced ? false : v.notVoicedTag);
      this.scheduleTextEnd(line);
      return;
    }
    const v = this.deps.voice();
    // Not fed as voice (this tab had no voice then) but it may voice now: feed it with no gate.
    if (line.mode === 'text' && v.voiced) {
      const sp = this.deps.speakerOf(line.agentId);
      if (sp) this.toSpeaker(line, sp, false);
    }
    if (line.mode === 'voice' && v.voiced && !line.speakerEnded) {
      line.voicedNow = true;
      line.release?.();
      line.release = null;
      line.cancelStall = this.deps.schedule(() => this.stalled(line), START_STALL_MS);
      return; // onStart when its audio starts
    }
    // Not voiced now (voice off, another tab took the voice, keyless): it must never sound here.
    if (line.mode === 'voice' && !line.speakerEnded) this.silence(line);
    this.asText(line, v.notVoicedTag);
  }

  private asText(line: Line, notVoicedTag: boolean): void {
    line.voicedNow = false;
    this.ev.onStart(view(line), false, notVoicedTag);
    this.scheduleTextEnd(line);
  }

  private silence(line: Line): void {
    line.speakerEnded = true;
    try {
      line.speaker?.stop();
    } catch {
      /* no audio */
    }
    line.release?.();
    line.release = null;
  }

  private stalled(line: Line): void {
    line.cancelStall = null;
    if (line.state !== 'playing' || !line.voicedNow || line.audioStarted) return;
    this.silence(line);
    this.asText(line, this.deps.voice().notVoicedTag);
  }

  private scheduleTextEnd(line: Line): void {
    line.cancelEnd?.();
    line.cancelEnd = null;
    if (!line.final) return; // it goes up now and stays until its text is complete, then for its reading time
    const ms = Math.max(readingMs(line.text), line.clipMs !== null ? line.clipMs + SPEAKER_GAP_MS : 0);
    const left = line.startedAt + ms - this.deps.now();
    line.cancelEnd = this.deps.schedule(() => this.end(line), Math.max(0, left));
  }

  private onAudioStarted(messageId: string): void {
    const line = this.byId.get(messageId);
    if (!line || line.state !== 'playing' || !line.voicedNow || line.audioStarted) return;
    line.audioStarted = true;
    line.cancelStall?.();
    line.cancelStall = null;
    this.ev.onStart(view(line), true, false);
  }

  private onAudioEnded(messageId: string): void {
    const line = this.byId.get(messageId);
    if (!line) return;
    line.speakerEnded = true;
    if (line.state !== 'playing' || !line.voicedNow) return;
    if (!line.audioStarted) {
      // It never sounded (stopped when the voice moved to another tab, or nothing could be synthesised): show it.
      line.cancelStall?.();
      line.cancelStall = null;
      this.asText(line, this.deps.voice().notVoicedTag);
      return;
    }
    this.end(line);
  }

  private end(line: Line): void {
    if (line.state !== 'playing') return;
    line.state = 'done';
    line.cancelEnd?.();
    line.cancelStall?.();
    line.cancelEnd = line.cancelStall = null;
    const k = this.lines.indexOf(line);
    if (k >= this.cur) this.cur = k + 1;
    this.gapUntil = this.deps.now() + SPEAKER_GAP_MS;
    this.ev.onEnd(view(line));
    this.ev.onChange();
    this.pump();
  }
}
