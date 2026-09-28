import type { Alignment, MouthSampler } from '@headcount/protocol';

export type { Alignment, MouthSampler };

/** Hints for the browser speechSynthesis fallback. */
export interface BrowserVoiceHint {
  lang?: string;
  /** Prefer a system voice whose name contains this. */
  name?: string;
  /** 0.1–10; catalog speeds are 0.90–1.10. */
  rate?: number;
  /** Prefer a feminine/masculine/neutral system voice when names don't match. */
  presentation?: 'feminine' | 'masculine' | 'neutral';
  /** 0–2, default 1. */
  pitch?: number;
}

/**
 * One piece of an utterance, usually one sentence's TTS response. Richer than a bare ArrayBuffer:
 * per-piece text and alignment give the mouth exact (alignment) or re-timed (text) shapes, and a
 * piece with text but no audio is spoken by the browser voice in sequence.
 */
export interface SpeechChunk {
  /** Encoded audio (audio/mpeg, audio/wav). Absent/null → `text` is spoken by the browser voice. */
  audio?: ArrayBuffer | null;
  mime?: string;
  /** What this piece says: text-timed mouth (re-timed onto the decoded clip), browser fallback, captions. */
  text?: string;
  /** Character timing for this piece, relative to its own start. */
  alignment?: Alignment | null;
}

/** A chunk as fed to speak(): bare audio bytes (contract form) or a SpeechChunk. */
export type SpeakChunk = ArrayBuffer | SpeechChunk;

export interface SpeakRequest {
  /** Agent id; one active utterance per speaker (a new speak() for the same speaker queues after it). */
  speakerId: string;
  /**
   * Audio chunks as they arrive (e.g. one TTS response per sentence, see createSpeechStream), or a
   * string → the browser speechSynthesis fallback (text-timed mouth, no analyser tap).
   */
  chunks: AsyncIterable<SpeakChunk> | string;
  /** MIME of bare ArrayBuffer chunks (audio/mpeg, audio/wav). Informational: decoding sniffs the bytes. */
  mime?: string;
  /** Character timing of the FIRST chunk when it is a bare ArrayBuffer (e.g. a pre-voiced clip). */
  alignment?: Alignment | null;
  /** Text of what is spoken (captions). */
  text?: string;
  voiceHint?: BrowserVoiceHint;
}

export type SpeakSource = 'audio' | 'browser' | 'none';

export interface SpeakOutcome {
  status: 'completed' | 'stopped' | 'failed';
  /** 'audio' if any decoded audio played, else 'browser' if the browser voice spoke, else 'none'. */
  source: SpeakSource;
  error?: string;
  /** Milliseconds of audio actually heard before the end or the stop (captions mark "interrupted"). */
  playedMs?: number;
}

export interface SpeakHandle {
  speakerId: string;
  /** Speaker generation this utterance belongs to; stopSpeaker() bumps it and late chunks are dropped. */
  generation: number;
  /** Mouth sampler for this utterance: follows the audio actually playing (analyser tap), else text timing. */
  sampler: MouthSampler;
  /** Resolves when playback ends, is stopped, or fails. Never rejects. */
  done: Promise<SpeakOutcome>;
  /** Stop this utterance now (barge-in). Idempotent. */
  stop(): void;
}

export interface MicSession {
  /** Container type of the recording without codec parameters (audio/webm, audio/ogg, audio/mp4). */
  readonly mime: string;
  /** 0–1 input level (smoothed RMS on a dB scale), for the listening ring. */
  level(): number;
  /** Milliseconds since recording started. */
  elapsedMs(): number;
  /** Stop recording and return the audio for POST /api/speech/stt. Idempotent. */
  stop(): Promise<Blob>;
  /** Stop and discard. */
  cancel(): void;
}

/** Browser SpeechRecognition fallback (keyless STT). */
export interface DictationSession {
  /** Latest transcript (final + interim). */
  partial(): string;
  /** Stop and return the final transcript ('' if nothing was heard). Never rejects. */
  stop(): Promise<string>;
  cancel(): void;
  /** The recognizer's error as a readable sentence, if it failed. */
  error(): MicError | null;
}

export interface DictationOptions {
  lang?: string;
  onPartial?: (text: string) => void;
  onError?: (error: MicError) => void;
}

export interface AudioSupport {
  webAudio: boolean;
  mic: boolean;
  speechSynthesis: boolean;
  speechRecognition: boolean;
}

export type MicErrorCode = 'denied' | 'no-device' | 'busy' | 'insecure' | 'unsupported' | 'network' | 'failed';

/** Microphone/recognizer failure whose message is one readable sentence with its fix (EXPERIENCE §10.8). */
export class MicError extends Error {
  constructor(
    readonly code: MicErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MicError';
  }
}

/**
 * The client audio engine (ARCHITECTURE §8.6): one AudioContext created in a user gesture;
 * voice sources → per-speaker gain → analyser tap → voices bus → ducker → master. Owner speech ducks voices.
 */
export interface AudioEngine {
  /** Create/resume the single AudioContext. Call from a user gesture (tap, key, hold). */
  arm(): Promise<void>;
  readonly armed: boolean;
  speak(req: SpeakRequest): SpeakHandle;
  /** Barge-in for one speaker: stop what plays, drop what is queued or loading, bump the generation. */
  stopSpeaker(speakerId: string): void;
  stopAll(): void;
  /** Speaker ids currently producing sound. */
  speaking(): string[];
  onSpeakingChange(cb: (speakerId: string, speaking: boolean) => void): () => void;
  /** A stable per-speaker sampler that follows whatever that speaker is playing (attach once per face). */
  sampler(speakerId: string): MouthSampler;
  /** Current generation of a speaker (starts at 0; bumped by stopSpeaker/stopAll). */
  generation(speakerId: string): number;
  /** Duck every voice by 18 dB (owner speaking). Mouths rest while ducked (`heard: false`). */
  duck(on: boolean): void;
  readonly ducked: boolean;
  /** Hold-to-talk: start capturing the mic (asks permission the first time). Ducks voices while live. Throws MicError. */
  startPushToTalk(): Promise<MicSession>;
  /** Keyless STT via the browser, or null when unsupported. Ducks voices while live. */
  startDictation(opts?: DictationOptions): DictationSession | null;
  /** True while any mic capture (recording or dictation) is live — drives the "Mic on" dot. */
  micLive(): boolean;
  onMicChange(cb: (live: boolean) => void): () => void;
  support(): AudioSupport;
  destroy(): void;
}

/** Minimal shape of the (vendor-prefixed) Web Speech recognition API. */
export interface BrowserRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives?: number;
  onresult: ((e: BrowserRecognitionEvent) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface BrowserRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type MediaRecorderCtor = {
  new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
  isTypeSupported?(type: string): boolean;
};

/** Injectable platform (tests, workers of the future). Omitted → taken from globalThis; null → unavailable. */
export interface AudioEngineDeps {
  AudioContext?: (new () => AudioContext) | null;
  speechSynthesis?: SpeechSynthesis | null;
  SpeechSynthesisUtterance?: (new (text?: string) => SpeechSynthesisUtterance) | null;
  SpeechRecognition?: (new () => BrowserRecognition) | null;
  MediaRecorder?: MediaRecorderCtor | null;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'> | null;
  /** performance.now()-domain clock (the same clock faces pass to sample()). */
  now?: () => number;
  /** Where to listen for the first gesture to arm the AudioContext. Default: document. null disables. */
  gestureTarget?: EventTarget | null;
  /** window.isSecureContext (the mic needs https or localhost). */
  secureContext?: boolean;
}
