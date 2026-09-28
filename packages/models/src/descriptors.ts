import { isLocalUrl } from './lib/http';
import type { Modality, ProviderEnv, ProviderId, ProviderKind } from './types';

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  family: string;
  /** Modalities the provider can serve once its adapter exists and it is configured. */
  modalities: Modality[];
  /** Env var names that configure it (all required). */
  keys: (keyof ProviderEnv)[];
  configured(env: ProviderEnv): boolean;
}

const has = (v: string | undefined) => typeof v === 'string' && v.trim() !== '';

/** One table of providers (ARCHITECTURE §12.2). Adapters live in ./adapters/* and are registered in DEFAULT_FACTORIES. */
export const PROVIDERS: readonly ProviderDescriptor[] = [
  { id: 'anthropic', label: 'Anthropic', kind: 'cloud', family: 'claude', modalities: ['chat'], keys: ['ANTHROPIC_API_KEY'], configured: (e) => has(e.ANTHROPIC_API_KEY) },
  { id: 'openai', label: 'OpenAI', kind: 'cloud', family: 'gpt', modalities: ['chat', 'tts', 'stt', 'image', 'embeddings'], keys: ['OPENAI_API_KEY'], configured: (e) => has(e.OPENAI_API_KEY) },
  { id: 'xai', label: 'xAI', kind: 'cloud', family: 'grok', modalities: ['chat', 'tts', 'stt', 'image'], keys: ['XAI_API_KEY'], configured: (e) => has(e.XAI_API_KEY) },
  { id: 'gemini', label: 'Google Gemini', kind: 'cloud', family: 'gemini', modalities: ['chat', 'embeddings'], keys: ['GEMINI_API_KEY'], configured: (e) => has(e.GEMINI_API_KEY) },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible',
    kind: 'cloud',
    family: 'compatible',
    modalities: ['chat', 'embeddings'],
    keys: ['OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_API_KEY'],
    configured: (e) => has(e.OPENAI_COMPATIBLE_BASE_URL),
  },
  { id: 'ollama', label: 'Local (Ollama)', kind: 'local', family: 'qwen', modalities: ['chat', 'embeddings'], keys: ['OLLAMA_BASE_URL'], configured: (e) => has(e.OLLAMA_BASE_URL) },
  { id: 'mock', label: 'Mock', kind: 'mock', family: 'mock', modalities: ['chat', 'tts', 'stt', 'image', 'embeddings'], keys: ['ENABLE_MOCK'], configured: (e) => e.ENABLE_MOCK === 'true' },
];

/** Preference order per capability when DEFAULT_CHAT is "auto" / no policy.prefer (mock always last). */
export const PREFERENCE: Readonly<Record<Modality, readonly ProviderId[]>> = {
  chat: ['anthropic', 'openai', 'xai', 'gemini', 'openai-compatible', 'ollama', 'mock'],
  tts: ['xai', 'openai', 'mock'],
  stt: ['openai', 'xai', 'mock'],
  image: ['xai', 'openai', 'mock'],
  embeddings: ['openai', 'gemini', 'ollama', 'openai-compatible', 'mock'],
};

/** Runs on this machine: Ollama always; an OpenAI-compatible endpoint when its base URL is loopback. */
export function isLocalProvider(d: ProviderDescriptor, env: ProviderEnv): boolean {
  if (d.kind === 'local') return true;
  return d.id === 'openai-compatible' && isLocalUrl(env.OPENAI_COMPATIBLE_BASE_URL?.trim());
}

export function descriptor(id: ProviderId): ProviderDescriptor {
  const d = PROVIDERS.find((p) => p.id === id);
  if (!d) throw new Error(`unknown provider ${id}`);
  return d;
}

export const PROVIDER_IDS: readonly ProviderId[] = PROVIDERS.map((p) => p.id);

export function isProviderId(v: string): v is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(v);
}
