// VoiceRef validation and provider preference for TTS.
import type { ProviderId, VoiceRef } from '@headcount/protocol';
import { HttpError } from '../lib/http';
import { catalogVoiceFor } from './subjects';

/** Providers that take a catalog voice id, in the registry's TTS preference order (xai → openai). */
const VOICE_PROVIDERS = ['xai', 'openai'] as const;
type VoiceProvider = (typeof VOICE_PROVIDERS)[number];

const VOICE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const SPEED_MIN = 0.85;
export const SPEED_MAX = 1.15;
export const INSTRUCTIONS_MAX_CHARS = 1000;

export interface VoiceChoice {
  voice: VoiceRef;
  /** Registry policy.prefer: providers this voice has an id for (an explicit `provider` first). */
  prefer: ProviderId[];
}

const isVoiceProvider = (v: unknown): v is VoiceProvider => typeof v === 'string' && (VOICE_PROVIDERS as readonly string[]).includes(v);

function voiceId(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !VOICE_ID.test(v)) throw new HttpError('bad_request', `voiceRef.${field} is not a valid voice id.`);
  return v;
}

/**
 * Normalise a TTS voice. Accepts the contract shape `{openai?, xai?, speed?, instructions?}` (catalog
 * `openai_tts` / `xai_tts` via leadVoiceRef, or persona voices via personaVoiceRef) and the loose shape
 * `{provider?, voice}`. With no voice ids at all, the speaker's catalog voice is used (`cw_<personaId>`).
 * Speed is clamped to 0.85–1.15 and instructions are capped.
 */
export function chooseVoice(input: unknown, speakerId: string): VoiceChoice {
  if (input !== undefined && input !== null && (typeof input !== 'object' || Array.isArray(input))) {
    throw new HttpError('bad_request', 'Send voiceRef as an object, for example {"openai": "sage", "xai": "ara"}.');
  }
  const raw = (input ?? {}) as Record<string, unknown>;
  const voice: VoiceRef = {};
  const openai = voiceId(raw.openai, 'openai');
  const xai = voiceId(raw.xai, 'xai');
  if (openai) voice.openai = openai;
  if (xai) voice.xai = xai;

  let explicit: VoiceProvider | null = null;
  if (raw.provider !== undefined && raw.provider !== null && raw.provider !== '') {
    if (!isVoiceProvider(raw.provider)) throw new HttpError('bad_request', 'voiceRef.provider must be "openai" or "xai".');
    explicit = raw.provider;
  }
  const loose = voiceId(raw.voice, 'voice');
  if (loose) {
    if (explicit) voice[explicit] ??= loose;
    else {
      voice.openai ??= loose;
      voice.xai ??= loose;
    }
  }

  if (!voice.openai && !voice.xai) {
    const fromCatalog = catalogVoiceFor(speakerId);
    if (fromCatalog?.openai) voice.openai = fromCatalog.openai;
    if (fromCatalog?.xai) voice.xai = fromCatalog.xai;
    if (raw.speed === undefined && fromCatalog?.speed !== undefined) voice.speed = fromCatalog.speed;
    if (raw.instructions === undefined && fromCatalog?.instructions) voice.instructions = fromCatalog.instructions;
  }

  if (raw.speed !== undefined && raw.speed !== null) {
    if (typeof raw.speed !== 'number' || !Number.isFinite(raw.speed)) throw new HttpError('bad_request', 'voiceRef.speed must be a number.');
    voice.speed = raw.speed;
  }
  if (voice.speed !== undefined) voice.speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, voice.speed));
  if (raw.instructions !== undefined && raw.instructions !== null) {
    if (typeof raw.instructions !== 'string') throw new HttpError('bad_request', 'voiceRef.instructions must be text.');
    const text = raw.instructions.trim().slice(0, INSTRUCTIONS_MAX_CHARS);
    if (text) voice.instructions = text;
  }

  const prefer: ProviderId[] = [];
  if (explicit) prefer.push(explicit);
  for (const p of VOICE_PROVIDERS) if (voice[p] && !prefer.includes(p)) prefer.push(p);
  return { voice, prefer };
}

/** Header-safe voice label (provider voice ids are ASCII slugs; anything else is dropped). */
export function voiceHeader(voice: string): string {
  return voice.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'default';
}
