// Delivery mapping per TTS provider and content-addressed clip keys (§5.6, §7.2).
import type { VoiceRef } from '@headcount/protocol';
import { base32, base32Int, cyrb53, sha256Async, utf8 } from './hash';
import { clamp, num } from './internal';
import type { SlotValues, TtsDelivery, Utterance } from './types';
import type { TtsProvider } from './vocab';

/** Default TTS models per provider (overridable with `opts.model`). */
export const DEFAULT_TTS_MODEL: Readonly<Record<TtsProvider, string | null>> = Object.freeze({
  xai: 'grok-tts',
  openai: 'gpt-4o-mini-tts',
  browser: null,
  mock: 'mock-tts',
});

/**
 * What a TTS provider should render for an utterance, or null when this provider cannot voice it
 * (no voice id for the provider, or a nonverbal line the provider cannot perform: face only then).
 * - xAI: `speakable(tags.xai)`, tags are the expressive channel; no instructions.
 * - OpenAI: `say` (pauses as "…"); instructions = voice `tts_instructions` + archetype + intent + line hints.
 * - Browser: the caption text; nonverbal lines are face only.
 * - Mock: the caption text (deterministic synthetic audio).
 */
export function toDelivery(u: Utterance, voice: VoiceRef, provider: TtsProvider, opts?: { model?: string; lang?: string }): TtsDelivery | null {
  const speed = Math.round(clamp(num(voice?.speed, 1), 0.85, 1.15) * 100) / 100;
  const lang = opts?.lang ?? 'en';
  const model = opts?.model ?? DEFAULT_TTS_MODEL[provider];
  switch (provider) {
    case 'xai': {
      if (!voice?.xai || !u.speak.xai) return null;
      return { provider, model, voiceId: voice.xai, speed, lang, input: u.speak.xai, instructions: null };
    }
    case 'openai': {
      if (!voice?.openai || !u.speak.openai?.input) return null;
      const instructions = [voice.instructions, u.speak.openai.instructions].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
      return { provider, model, voiceId: voice.openai, speed, lang, input: u.speak.openai.input, instructions: instructions || null };
    }
    case 'browser': {
      if (!u.speak.browser) return null;
      return { provider, model: null, voiceId: null, speed, lang, input: u.speak.browser, instructions: null };
    }
    case 'mock': {
      if (!u.caption) return null;
      return { provider, model, voiceId: voice?.xai ?? voice?.openai ?? 'mock', speed, lang, input: u.caption, instructions: null };
    }
    default:
      return null;
  }
}

/**
 * Content-addressed clip key (§7.2): "c1_" + base32(sha256(JSON [1, provider, model, voiceId, speed, lang, input,
 * instructions]))[0..32]. Identical in the worker and the browser; changing any delivery input changes the key.
 */
export async function clipKey(d: TtsDelivery): Promise<string> {
  const payload = JSON.stringify([1, d.provider, d.model ?? '', d.voiceId ?? '', d.speed.toFixed(2), d.lang, d.input, d.instructions ?? '']);
  return `c1_${base32(await sha256Async(utf8(payload))).slice(0, 32)}`;
}

/** Stable key for a set of slot fills: '' when there are none, else "f_" + a hash of the sorted pairs (§5.5). */
export function fillKeyOf(fills: SlotValues): string {
  const pairs = Object.entries(fills ?? {})
    .filter(([, v]) => typeof v === 'string' && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`);
  if (!pairs.length) return '';
  return `f_${base32Int(cyrb53(pairs.join('\u0001'), 7))}`;
}

/** A stable identity for a voice across providers, used by clip manifests (`ClipManifest.voiceKey`). */
export function voiceKeyOf(voice: VoiceRef, provider: TtsProvider): string {
  const id = provider === 'xai' ? voice?.xai : provider === 'openai' ? voice?.openai : provider;
  const speed = clamp(num(voice?.speed, 1), 0.85, 1.15).toFixed(2);
  return `${provider}:${id ?? '-'}:${speed}:${base32Int(cyrb53(voice?.instructions ?? '', 3))}`;
}
