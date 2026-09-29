// Spoken messages for one agent. A streamed message becomes one utterance: the audio package's
// SpeechStream cuts it into sentences, synthesises each in the agent's catalog voice (in order, with
// prefetch) and feeds AudioEngine.speak() as one AsyncIterable, so the face (engine.sampler) follows the
// audio actually playing. Without TTS each sentence is spoken by the browser voice instead.
// Barge-in stops what plays, drops what is loading and silences the rest of that message.
import { createSpeechStream, type AudioEngine, type BrowserVoiceHint, type SpeakHandle, type SpeakOutcome, type SpeechChunk, type SpeechStream } from '@headcount/audio';
import type { MouthSampler, VoiceRef } from '@headcount/protocol';

/** Longest sentence handed to the browser voice (tokens), as in the audio engine's browser path. */
export const BROWSER_MAX_TOKENS = 60;

export interface SpeakerDeps {
  engine(): AudioEngine;
  /** One sentence → audio (+ alignment). Rejects when TTS fails: that sentence falls back to the browser voice. */
  synthesize(text: string, voiceRef: VoiceRef, speakerId: string, signal: AbortSignal): Promise<SpeechChunk>;
  /** A provider TTS is configured (capabilities). */
  ttsAvailable(): boolean;
}

export interface VoiceSpec {
  /** Provider voice (catalog); null → browser voice. */
  voiceRef: VoiceRef | null;
  hint?: BrowserVoiceHint;
}

/** What a speaker's messages are doing, for the living layer (first audio, the end). */
export interface SpeakerObserver {
  /** The engine took the message's first chunk: its audio starts now (it waited for anything queued before it). */
  started?(messageId: string): void;
  /** The message's audio is over (completed, stopped or failed). */
  ended?(messageId: string, status: SpeakOutcome['status']): void;
}

/** One spoken message (or one full text). */
export class Utterance {
  readonly stream: SpeechStream;
  readonly handle: SpeakHandle;
  private received = '';
  private ended = false;
  /** Characters of text the engine has taken so far (synthesised, or handed to the browser voice). */
  private taken = 0;
  private startedAudio = false;

  constructor(speakerId: string, voice: VoiceSpec, deps: SpeakerDeps, onStart?: () => void, gate?: Promise<void> | null) {
    const voiceRef = voice.voiceRef;
    const synthesize = voiceRef && deps.ttsAvailable() ? (text: string, signal: AbortSignal) => deps.synthesize(text, voiceRef, speakerId, signal) : undefined;
    // The browser voice speaks each chunk whole, and Chrome cuts long lines: keep its sentences short (the
    // engine's own string path uses the same 60 tokens), so a stalled line never leaves a long silent mouth.
    this.stream = createSpeechStream(synthesize ? { synthesize } : { chunker: { maxTokens: BROWSER_MAX_TOKENS } });
    this.handle = deps.engine().speak({ speakerId, chunks: this.counted(onStart, gate ?? null), ...(voice.hint ? { voiceHint: voice.hint } : {}) });
  }

  /**
   * The stream as the engine reads it, counting what it has taken (for "how long is left"). A `gate` holds the
   * first chunk back (a "back with you" plays between two answers first).
   */
  private async *counted(onStart: (() => void) | undefined, gate: Promise<void> | null): AsyncGenerator<SpeechChunk> {
    for await (const chunk of this.stream) {
      if (gate) {
        await gate;
        gate = null;
        if (this.stream.cancelled) return;
      }
      if (!this.startedAudio) {
        this.startedAudio = true;
        try {
          onStart?.();
        } catch {
          /* an observer never breaks speech */
        }
      }
      this.taken += chunk.text?.length ?? 0;
      yield chunk;
    }
  }

  /** Text that has streamed in but the engine has not taken yet (0 once the message is fully handed over). */
  get pendingChars(): number {
    return Math.max(0, this.received.length - this.taken);
  }

  /** The message is still streaming in (more text may come). */
  get open(): boolean {
    return !this.ended;
  }

  /** Append streamed text. */
  push(delta: string): void {
    if (this.ended || !delta) return;
    this.received += delta;
    this.stream.push(delta);
  }

  /** The message is complete. `finalText` reconciles with what streamed (a missing tail, or the whole text). */
  finish(finalText?: string): void {
    if (this.ended) return;
    if (finalText !== undefined) {
      if (!this.received) this.push(finalText);
      else if (finalText.startsWith(this.received)) this.push(finalText.slice(this.received.length));
    }
    this.ended = true;
    this.stream.end();
  }

  get sentences(): readonly string[] {
    return this.stream.sentences;
  }

  stop(): void {
    this.stream.cancel();
    this.handle.stop();
  }
}

/** Speaks one agent's messages; one Utterance per message id. */
export class AgentSpeaker {
  private live = new Map<string, Utterance>();
  private playing = new Set<Utterance>();
  private done = new Set<string>();
  private silenced = new Set<string>();
  private observers = new Set<SpeakerObserver>();
  /** Message id of every utterance in hand (queued, loading or playing), and which of them have started. */
  private ids = new Map<Utterance, string>();
  private started = new Set<Utterance>();
  private gate: Promise<void> | null = null;

  constructor(
    readonly speakerId: string,
    private readonly deps: SpeakerDeps,
    private readonly voice: () => VoiceSpec,
  ) {}

  /** Stable mouth for this speaker's faces: follows whatever it is playing. */
  get mouth(): MouthSampler {
    return this.deps.engine().sampler(this.speakerId);
  }

  /** Can anything be heard at all (provider TTS or the browser voice)? */
  get canSpeak(): boolean {
    try {
      return this.deps.ttsAvailable() || this.deps.engine().support().speechSynthesis;
    } catch {
      return false;
    }
  }

  /** Streamed text for a message. */
  delta(messageId: string, text: string): void {
    if (this.silenced.has(messageId) || this.done.has(messageId)) return;
    this.utterance(messageId)?.push(text);
  }

  /** A message is complete (with its final text when known). */
  complete(messageId: string, finalText?: string): void {
    if (this.silenced.has(messageId) || this.done.has(messageId)) return;
    const u = this.live.get(messageId) ?? (finalText ? this.utterance(messageId) : undefined);
    if (!u) return;
    u.finish(finalText);
    this.live.delete(messageId);
    remember(this.done, messageId);
  }

  /** Speak a full text now (greeting, voice sample). */
  say(text: string, id = `say:${Date.now()}`): Utterance | null {
    const u = this.utterance(id);
    if (!u) return null;
    u.finish(text);
    this.live.delete(id);
    return u;
  }

  /** Is anything of this agent loading or playing? */
  get active(): boolean {
    if (this.live.size > 0 || this.playing.size > 0) return true;
    try {
      return this.deps.engine().speaking().includes(this.speakerId);
    } catch {
      return false;
    }
  }

  /** Watch this speaker's messages start and end (the living layer's conversation events). */
  observe(o: SpeakerObserver): () => void {
    this.observers.add(o);
    return () => this.observers.delete(o);
  }

  /** The next new message waits for `release` before its audio starts (it still loads meanwhile). */
  holdNext(release: Promise<void>): void {
    this.gate = release;
  }

  /** Streamed text of the messages in hand that is not synthesised yet. */
  pendingChars(): number {
    let n = 0;
    for (const u of this.playing) n += u.pendingChars;
    return n;
  }

  /** The message whose audio is sounding now (the most recent one to start), or null. */
  soundingMessage(): string | null {
    let last: string | null = null;
    for (const u of this.started) last = this.ids.get(u) ?? last;
    return last;
  }

  /** Is this message queued, loading or playing here? */
  has(messageId: string): boolean {
    for (const id of this.ids.values()) if (id === messageId) return true;
    return false;
  }

  /** Barge-in: stop playing and loading, and never resume the interrupted messages. */
  stop(): void {
    for (const [id, u] of this.live) {
      u.stop();
      remember(this.silenced, id);
    }
    this.live.clear();
    for (const u of this.playing) u.stop();
    this.playing.clear();
    try {
      this.deps.engine().stopSpeaker(this.speakerId);
    } catch {
      /* no audio */
    }
  }

  private utterance(messageId: string): Utterance | null {
    let u = this.live.get(messageId);
    if (u) return u;
    if (!this.canSpeak) return null;
    let made: Utterance | null = null;
    const gate = this.gate;
    this.gate = null;
    u = new Utterance(
      this.speakerId,
      this.voice(),
      this.deps,
      () => {
        if (!made || !this.ids.has(made)) return;
        this.started.add(made);
        for (const o of this.observers) o.started?.(messageId);
      },
      gate,
    );
    made = u;
    const mine = made;
    this.live.set(messageId, mine);
    this.playing.add(mine);
    this.ids.set(mine, messageId);
    void mine.handle.done.then((outcome) => {
      this.playing.delete(mine);
      this.ids.delete(mine);
      this.started.delete(mine);
      for (const o of this.observers) {
        try {
          o.ended?.(messageId, outcome.status);
        } catch {
          /* an observer never breaks speech */
        }
      }
    });
    return mine;
  }
}

function remember(set: Set<string>, id: string) {
  set.add(id);
  if (set.size > 200) set.delete(set.values().next().value!);
}
