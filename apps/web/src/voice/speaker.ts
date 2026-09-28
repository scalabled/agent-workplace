// Spoken messages for one agent. A streamed message becomes one utterance: the audio package's
// SpeechStream cuts it into sentences, synthesises each in the agent's catalog voice (in order, with
// prefetch) and feeds AudioEngine.speak() as one AsyncIterable, so the face (engine.sampler) follows the
// audio actually playing. Without TTS each sentence is spoken by the browser voice instead.
// Barge-in stops what plays, drops what is loading and silences the rest of that message.
import { createSpeechStream, type AudioEngine, type BrowserVoiceHint, type SpeakHandle, type SpeechChunk, type SpeechStream } from '@headcount/audio';
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

/** One spoken message (or one full text). */
export class Utterance {
  readonly stream: SpeechStream;
  readonly handle: SpeakHandle;
  private received = '';
  private ended = false;

  constructor(speakerId: string, voice: VoiceSpec, deps: SpeakerDeps) {
    const voiceRef = voice.voiceRef;
    const synthesize = voiceRef && deps.ttsAvailable() ? (text: string, signal: AbortSignal) => deps.synthesize(text, voiceRef, speakerId, signal) : undefined;
    // The browser voice speaks each chunk whole, and Chrome cuts long lines: keep its sentences short (the
    // engine's own string path uses the same 60 tokens), so a stalled line never leaves a long silent mouth.
    this.stream = createSpeechStream(synthesize ? { synthesize } : { chunker: { maxTokens: BROWSER_MAX_TOKENS } });
    this.handle = deps.engine().speak({ speakerId, chunks: this.stream, ...(voice.hint ? { voiceHint: voice.hint } : {}) });
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
    u = new Utterance(this.speakerId, this.voice(), this.deps);
    const made = u;
    this.live.set(messageId, made);
    this.playing.add(made);
    void made.handle.done.then(() => this.playing.delete(made));
    return made;
  }
}

function remember(set: Set<string>, id: string) {
  set.add(id);
  if (set.size > 200) set.delete(set.values().next().value!);
}
