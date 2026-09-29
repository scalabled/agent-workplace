/**
 * Voice identity as it travels between catalog, worker and browser.
 * The worker picks a provider from the registry and uses the matching voice id; the browser
 * never picks a provider. No voice cloning, ever.
 */
export interface VoiceRef {
  /** OpenAI TTS voice id (catalog `voice.openai_tts` for leads, `voice.openai.voice` for personas). */
  openai?: string;
  /** xAI TTS voice id (catalog `voice.xai_tts` / `voice.xai.voice`). */
  xai?: string;
  /** 0.85–1.15; catalog speeds are 0.90–1.10. */
  speed?: number;
  /** Style instruction for providers that accept one (catalog `tts_instructions`). */
  instructions?: string;
  /** Speak through this provider first (a team's voices stay distinct only on one: `TeamMember.voice.prefer`). */
  provider?: 'openai' | 'xai';
}

/** Character-level timing for a spoken line (xAI `with_timestamps` normalised; mock synthesises it). */
export interface Alignment {
  chars: string[];
  startsMs: number[];
  endsMs: number[];
}

export const SPEECH_HEADERS = {
  provider: 'X-Speech-Provider',
  voice: 'X-Speech-Voice',
} as const;
