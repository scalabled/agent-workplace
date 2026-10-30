// One file of model ids (ARCHITECTURE §12.1). Ids are spelled exactly as the owner's current code uses them
// (biz-bot worker/src/providers/*, oncloudnine server/providers/registry.ts, personagram-ai).
// Gemini has no reference code; its ids are `-latest` aliases and the adapter rediscovers on a 404.
import type { LatencyClass, ModelFlag, ModelInfo, ModelTier, ProviderId } from './types';

type ChatProviderId = 'anthropic' | 'openai' | 'xai' | 'gemini';

interface ChatModelSpec {
  id: string;
  flags: ModelFlag[];
  latencyClass: LatencyClass;
  contextWindow?: number;
}

interface ChatCatalogEntry {
  family: string;
  /** Default model per tier. */
  defaults: Record<ModelTier, string>;
  models: ChatModelSpec[];
}

const CHAT_TOOLS: ModelFlag[] = ['chat', 'tools', 'vision', 'json'];
const REASONING: ModelFlag[] = [...CHAT_TOOLS, 'reasoning'];

export const CHAT_CATALOG: Readonly<Record<ChatProviderId, ChatCatalogEntry>> = {
  anthropic: {
    family: 'claude',
    defaults: { reason: 'claude-opus-5', fast: 'claude-sonnet-5', voice: 'claude-haiku-4-5' },
    models: [
      { id: 'claude-opus-5', flags: REASONING, latencyClass: 'reason', contextWindow: 1_000_000 },
      { id: 'claude-sonnet-5', flags: REASONING, latencyClass: 'fast', contextWindow: 1_000_000 },
      { id: 'claude-haiku-4-5', flags: CHAT_TOOLS, latencyClass: 'realtime', contextWindow: 200_000 },
      { id: 'claude-fable-5', flags: REASONING, latencyClass: 'reason', contextWindow: 1_000_000 },
      { id: 'claude-opus-4-8', flags: REASONING, latencyClass: 'reason', contextWindow: 1_000_000 },
      { id: 'claude-sonnet-4-6', flags: REASONING, latencyClass: 'fast', contextWindow: 1_000_000 },
    ],
  },
  openai: {
    family: 'gpt',
    defaults: { reason: 'gpt-5.6-sol', fast: 'gpt-5.6-luna', voice: 'gpt-5.6-luna' },
    models: [
      { id: 'gpt-5.6-sol', flags: REASONING, latencyClass: 'reason', contextWindow: 1_050_000 },
      { id: 'gpt-5.6-terra', flags: REASONING, latencyClass: 'fast', contextWindow: 1_050_000 },
      { id: 'gpt-5.6-luna', flags: REASONING, latencyClass: 'realtime', contextWindow: 1_050_000 },
      { id: 'gpt-5.5', flags: REASONING, latencyClass: 'reason', contextWindow: 1_050_000 },
      { id: 'gpt-5.4', flags: REASONING, latencyClass: 'reason', contextWindow: 1_050_000 },
      { id: 'gpt-5.4-mini', flags: REASONING, latencyClass: 'fast', contextWindow: 400_000 },
      { id: 'gpt-5.4-nano', flags: REASONING, latencyClass: 'realtime', contextWindow: 400_000 },
      { id: 'gpt-5.2', flags: REASONING, latencyClass: 'reason', contextWindow: 400_000 },
      { id: 'gpt-5.1', flags: REASONING, latencyClass: 'reason', contextWindow: 400_000 },
      { id: 'gpt-4.1', flags: CHAT_TOOLS, latencyClass: 'fast', contextWindow: 1_047_576 },
      { id: 'gpt-4.1-mini', flags: CHAT_TOOLS, latencyClass: 'realtime', contextWindow: 1_047_576 },
    ],
  },
  xai: {
    family: 'grok',
    defaults: { reason: 'grok-4.6', fast: 'grok-4.20-non-reasoning', voice: 'grok-4.20-non-reasoning' },
    models: [
      { id: 'grok-4.6', flags: REASONING, latencyClass: 'reason', contextWindow: 500_000 },
      { id: 'grok-4.5', flags: REASONING, latencyClass: 'reason', contextWindow: 500_000 },
      { id: 'grok-4.3', flags: REASONING, latencyClass: 'fast', contextWindow: 1_000_000 },
      { id: 'grok-4.20-multi-agent', flags: REASONING, latencyClass: 'reason', contextWindow: 1_000_000 },
      { id: 'grok-4.20-reasoning', flags: REASONING, latencyClass: 'reason', contextWindow: 1_000_000 },
      { id: 'grok-4.20-non-reasoning', flags: CHAT_TOOLS, latencyClass: 'realtime', contextWindow: 1_000_000 },
      { id: 'grok-build-0.1', flags: REASONING, latencyClass: 'reason', contextWindow: 256_000 },
    ],
  },
  gemini: {
    family: 'gemini',
    defaults: { reason: 'gemini-pro-latest', fast: 'gemini-flash-latest', voice: 'gemini-flash-lite-latest' },
    models: [
      { id: 'gemini-pro-latest', flags: REASONING, latencyClass: 'reason', contextWindow: 1_000_000 },
      { id: 'gemini-flash-latest', flags: REASONING, latencyClass: 'fast', contextWindow: 1_000_000 },
      { id: 'gemini-flash-lite-latest', flags: REASONING, latencyClass: 'realtime', contextWindow: 1_000_000 },
    ],
  },
};

/** Ollama defaults (OC registry: qwen3:32b chat with tools, nomic-embed-text embeddings). */
export const OLLAMA_DEFAULTS = { chat: 'qwen3:32b', embed: 'nomic-embed-text', baseUrl: 'http://127.0.0.1:11434' } as const;
/** qwen3 has tools and thinking but no vision head. */
export const OLLAMA_DEFAULT_FLAGS: ModelFlag[] = ['chat', 'tools', 'json', 'reasoning'];

export const BASE_URLS = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
} as const;

export const ANTHROPIC_VERSION = '2023-06-01';

/** OpenAI audio (biz-bot openai.js): gpt-4o-mini-tts takes `instructions`; STT gpt-4o-transcribe → whisper-1. */
export const OPENAI_SPEECH = {
  ttsModel: 'gpt-4o-mini-tts',
  defaultVoice: 'marin',
  voices: ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'],
  maxChars: 4096,
  sttModel: 'gpt-4o-transcribe',
  sttFallbackModel: 'whisper-1',
} as const;

/** xAI voice (biz-bot xai.js, personagram-ai): POST /v1/tts and /v1/stt; neither takes a model id. */
export const XAI_SPEECH = {
  ttsLabel: 'grok-tts',
  sttLabel: 'grok-stt',
  defaultVoice: 'eve',
  voices: ['eve', 'ara', 'leo', 'rex', 'sal', 'carina', 'zagan', 'helix', 'orion', 'luna', 'iris', 'altair', 'zenith', 'perseus', 'helios', 'lux', 'kepler', 'rigel', 'cosmo', 'celeste', 'ursa', 'sirius', 'lumen', 'castor', 'naksh', 'atlas'],
  maxChars: 15_000,
  sampleRate: 24_000,
  bitRate: 128_000,
  minSpeed: 0.7,
  maxSpeed: 1.5,
} as const;

export const IMAGE_MODELS = { openai: 'gpt-image-2', xai: 'grok-imagine-image-2.0' } as const;

export const EMBEDDING_MODELS = {
  openai: { model: 'text-embedding-3-small', dims: 1536 },
  gemini: { model: 'gemini-embedding-001', dims: 3072 },
  ollama: { model: OLLAMA_DEFAULTS.embed, dims: 768 },
} as const;

/** The catalog entry for a chat model, if we know it. */
export function chatModelSpec(provider: ProviderId, model: string): ChatModelSpec | undefined {
  const entry = CHAT_CATALOG[provider as ChatProviderId];
  return entry?.models.find((m) => m.id === model);
}

/** Flags for a provider's model, or null when unknown (unknown models are not filtered out). */
export function modelFlags(provider: ProviderId, model: string): ModelFlag[] | null {
  if (provider === 'mock') return ['chat', 'tools', 'vision', 'json'];
  if (provider === 'ollama' && model === OLLAMA_DEFAULTS.chat) return OLLAMA_DEFAULT_FLAGS;
  return chatModelSpec(provider, model)?.flags ?? null;
}

/** Every known chat model as ModelInfo (for pickers and route logs). */
export function listChatModels(): ModelInfo[] {
  const out: ModelInfo[] = [];
  for (const [provider, entry] of Object.entries(CHAT_CATALOG) as [ChatProviderId, ChatCatalogEntry][]) {
    for (const m of entry.models) out.push({ id: m.id, provider, family: entry.family, flags: m.flags, latencyClass: m.latencyClass, ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}) });
  }
  out.push({ id: OLLAMA_DEFAULTS.chat, provider: 'ollama', family: 'qwen', flags: OLLAMA_DEFAULT_FLAGS, latencyClass: 'fast', contextWindow: 40_960 });
  out.push({ id: 'mock-1', provider: 'mock', family: 'mock', flags: ['chat', 'tools', 'vision', 'json'], latencyClass: 'realtime' });
  return out;
}
