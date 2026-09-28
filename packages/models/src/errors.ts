import type { Capability, ProviderId } from './types';

/** Owner-facing name of each capability, for error sentences (no jargon like "tts"). */
const CAPABILITY_WORDS: Record<Capability, string> = {
  chat: 'chat',
  tts: 'spoken replies (text to speech)',
  stt: 'voice input (speech to text)',
  image: 'portraits (image generation)',
  embeddings: 'embeddings',
};

/** No configured provider can serve a capability. The message names the env vars that would fix it. */
export class MissingProviderError extends Error {
  readonly code = 'not_configured' as const;
  constructor(
    readonly capability: Capability,
    readonly missingKeys: string[],
    readonly skipped: { id: ProviderId; reason: string }[] = [],
    /** Extra sentence, e.g. why a configured local provider could not be used. */
    hint?: string,
  ) {
    super(
      (missingKeys.length
        ? `No provider is configured for ${CAPABILITY_WORDS[capability] ?? capability}. Add ${formatKeys(missingKeys)} to apps/worker/.dev.vars.`
        : `No provider is available for ${CAPABILITY_WORDS[capability] ?? capability}${skipped.length ? ` (${skipped.map((s) => `${s.id}: ${s.reason}`).join('; ')})` : ''}.`) + (hint ? ` ${hint}` : ''),
    );
    this.name = 'MissingProviderError';
  }
}

/**
 * Why a provider call failed, so callers can decide what to do next without parsing messages.
 * `rate_limited`, `upstream`, `unreachable`, `timeout` and `incomplete` are retryable; the rest are not.
 */
export type ProviderErrorKind =
  | 'auth'
  | 'bad_request'
  | 'model_not_found'
  | 'rate_limited'
  | 'upstream'
  | 'unreachable'
  | 'timeout'
  | 'incomplete'
  | 'bad_response'
  | 'refused';

/** A provider call failed. `retryable` for 429/5xx/timeouts; never for an aborted caller. */
export class ProviderError extends Error {
  readonly code = 'provider_error' as const;
  constructor(
    readonly provider: ProviderId,
    message: string,
    readonly status?: number,
    readonly retryable = false,
    readonly kind: ProviderErrorKind = retryable ? 'upstream' : 'bad_request',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function formatKeys(keys: string[]): string {
  if (keys.length === 1) return keys[0]!;
  return `${keys.slice(0, -1).join(', ')} or ${keys[keys.length - 1]}`;
}
