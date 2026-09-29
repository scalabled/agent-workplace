import type { Alignment, Modality, ProviderId, ProviderKind, VoiceRef } from '@headcount/protocol';

export type { Alignment, Modality, ProviderId, ProviderKind, VoiceRef };

// ── chat: the neutral transcript ────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  /** JSON string exactly as the model produced it (may be unparseable → the loop returns argsError). */
  arguments: string;
}

/** An image the owner showed (a photo, a screenshot, a camera snapshot), sent to vision-capable models. */
export interface ImagePart {
  /** image/png, image/jpeg, image/webp or image/gif. */
  mime: string;
  /** Base64, no data: prefix. */
  data: string;
}

export type ChatMessage =
  | { role: 'user'; content: string; images?: ImagePart[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

/** JSON Schema (draft 2020-12 subset the adapters understand). */
export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  description?: string;
  default?: unknown;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  [key: string]: unknown;
};

/** Hints only the Mock provider reads, so keyless tests and demos can exercise tool paths deterministically. */
export interface MockToolHints {
  /** Regex sources (case-insensitive) matched against the latest user message; a match makes Mock call this tool. */
  triggers?: string[];
  /** Arguments Mock sends; default: schema-filled, with string fields taken from the user's text. */
  args?: (userText: string) => Record<string, unknown>;
  /** What Mock says after the tool returns; default: a short sentence built from the tool output. */
  reply?: (toolOutput: string) => string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: JsonSchema;
  /** In-process only; adapters never send it to a provider. */
  mock?: MockToolHints;
}

/**
 * Provider-hosted tools the provider runs itself (no executor on our side): web search and X search. Results come
 * back as `citation` events (and the model's text). Adapters for providers without them ignore the request.
 */
export type HostedToolKind = 'web_search' | 'x_search';
export interface HostedTool {
  type: HostedToolKind;
  /** Restrict web search to these domains (providers that support it). */
  allowedDomains?: string[];
  /** Anthropic: searches per request (default 5). */
  maxUses?: number;
}
/**
 * How a provider hosts a tool: `with_tools` next to function tools, `solo` only in a call without function tools
 * (Gemini grounding). Absent: not hosted (the worker's `web_search` function tool stands in).
 */
export type HostedSupport = Partial<Record<HostedToolKind, 'with_tools' | 'solo'>>;

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'refusal' | 'incomplete' | 'cancelled';

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

/** The visible output and thinking effort a call was sized from (see `callBudget`). */
export interface BudgetHint {
  output: number;
  effort: ReasoningEffort;
}

export interface ChatRequest {
  /** Provider model id; omitted → the provider's default for the tier. */
  model?: string;
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  /** Provider-hosted tools (web search). Sent only where `ChatProvider.hosted` supports them. */
  hostedTools?: HostedTool[];
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  /**
   * What `maxTokens` and `reasoningEffort` were sized from (`callBudget`). A failover chain re-sizes the call
   * for the candidate that actually answers, so a local fallback never gets a cloud thinking effort and a
   * reasoning fallback gets its room to think. Adapters ignore it.
   */
  budget?: BudgetHint;
  /**
   * Structured output. Mock generates schema-valid JSON from it. `strict` asks providers that support it
   * for strict schema adherence (default: false on OpenAI, true on xAI — as in biz-bot).
   */
  responseFormat?: { type: 'json_schema'; name: string; schema: JsonSchema; strict?: boolean };
  /**
   * Cancel and deadline in one signal. Use `deadlineSignal(ms, parent)` for a deadline: providers then wait
   * that long (instead of their default 60 s / 180 s budget), and an expired deadline ends the stream with
   * `{type:'error', code:'timeout'}` while a cancelled caller gets `{type:'done', finish:'cancelled'}`.
   */
  signal?: AbortSignal;
}

/**
 * The normalised provider event vocabulary (biz-bot: text|reasoning|tool_call|citation|usage|done|error).
 * Every stream ends with exactly one `done` or `error`.
 */
export type ModelEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'citation'; url: string; title?: string }
  | {
      type: 'usage';
      input: number;
      output: number;
      cached?: number;
      /** USD when priced; null when unknown (costStatus 'unavailable' — never treated as free). */
      usd: number | null;
      costStatus: 'priced' | 'unavailable' | 'free';
    }
  | { type: 'done'; finish: FinishReason }
  | { type: 'error'; message: string; code?: string; status?: number; retryable?: boolean };

/** Per-model capability flags (ARCHITECTURE §12.1). Modalities plus what a chat model can take or do. */
export type ModelFlag = Modality | 'tools' | 'vision' | 'reasoning' | 'json';

/** Latency class (PRODUCT §8.2): realtime (voice), fast, reason. */
export type LatencyClass = 'realtime' | 'fast' | 'reason';

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  family: string;
  flags: ModelFlag[];
  latencyClass: LatencyClass;
  contextWindow?: number;
}

export interface ProviderBase {
  id: ProviderId;
  kind: ProviderKind;
  /** Model family, for policy `excludeFamilies` (e.g. "claude", "gpt", "grok", "gemini", "qwen", "mock"). */
  family: string;
}

export interface ChatProvider extends ProviderBase {
  /** Default model per tier (no tier → `reason`, the provider's flagship). */
  defaultModel(tier?: TierLike): string;
  /** Hosted tools this provider runs natively (web search). */
  hosted?: HostedSupport;
  chat(req: ChatRequest): AsyncIterable<ModelEvent>;
}

// ── speech ──────────────────────────────────────────────────────────────────────

export interface TtsRequest {
  text: string;
  voice: VoiceRef;
  format?: 'mp3' | 'wav' | 'pcm16';
  /** Ask for character alignment when the provider can give it (xAI `with_timestamps`; Mock synthesises it). */
  withAlignment?: boolean;
  /** Provider TTS model; default per provider (OpenAI `gpt-4o-mini-tts`). */
  model?: string;
  /** BCP-47 language; default "en". */
  language?: string;
  signal?: AbortSignal;
}

export interface TtsResult {
  audio: ArrayBuffer;
  mime: string;
  provider: ProviderId;
  /** The concrete provider voice id used. */
  voice: string;
  alignment: Alignment | null;
  durationMs?: number;
}

export interface SttRequest {
  audio: ArrayBuffer;
  mime: string;
  language?: string;
  /** Provider STT model; default per provider (OpenAI `gpt-4o-transcribe`, falling back to `whisper-1`). */
  model?: string;
  /** Context hint (OpenAI `prompt`, e.g. the rolling transcript). */
  prompt?: string;
  signal?: AbortSignal;
}

export interface SttResult {
  text: string;
  provider: ProviderId;
  language?: string;
  durationMs?: number;
}

/** A provider serves `tts`, `stt` or both; the registry resolves each capability separately. */
export interface SpeechProvider extends ProviderBase {
  tts?(req: TtsRequest): Promise<TtsResult>;
  stt?(req: SttRequest): Promise<SttResult>;
}

// ── images ──────────────────────────────────────────────────────────────────────

export interface ImageRequest {
  prompt: string;
  /** Portraits are 3:4 (EXPERIENCE §10.5). */
  aspect?: '3:4' | '1:1' | '4:3' | '16:9';
  /** Identity-preserving edit of an existing image (PG edit prefix). */
  source?: { data: ArrayBuffer; mime: string };
  /** Provider image model; default per provider (OpenAI `gpt-image-2`, xAI `grok-imagine-image-2.0`). */
  model?: string;
  signal?: AbortSignal;
}

export interface ImageResult {
  image: ArrayBuffer;
  mime: string;
  provider: ProviderId;
  model: string;
  revisedPrompt?: string;
}

export interface ImageProvider extends ProviderBase {
  generate(req: ImageRequest): Promise<ImageResult>;
}

// ── embeddings ──────────────────────────────────────────────────────────────────

export interface EmbeddingRequest {
  texts: string[];
  model?: string;
  signal?: AbortSignal;
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dims: number;
  provider: ProviderId;
}

export interface EmbeddingProvider extends ProviderBase {
  embed(req: EmbeddingRequest): Promise<EmbeddingResult>;
}

// ── registry ────────────────────────────────────────────────────────────────────

export type Capability = Modality;
/**
 * Model tiers (PRODUCT §8.3): `reason` = strongest reasoner (planners, jobs), `fast` = room routing and paced
 * turns, `voice` = lowest latency for spoken replies.
 */
export type ModelTier = 'fast' | 'reason' | 'voice';
/** A tier, or a legacy alias from the scaffold (`deep` → reason, `balanced` → fast). */
export type TierLike = ModelTier | 'deep' | 'balanced';

export function normalizeTier(tier: TierLike | undefined): ModelTier {
  if (tier === 'fast' || tier === 'voice') return tier;
  if (tier === 'balanced') return 'fast';
  return 'reason';
}

export interface CapabilityProviderMap {
  chat: ChatProvider;
  tts: SpeechProvider & Required<Pick<SpeechProvider, 'tts'>>;
  stt: SpeechProvider & Required<Pick<SpeechProvider, 'stt'>>;
  image: ImageProvider;
  embeddings: EmbeddingProvider;
}

/** Selection policy (ARCHITECTURE §12.3; PRODUCT §8.3). All fields optional. */
export interface ModelPolicy {
  /** Explicit provider order; overrides DEFAULT_CHAT / the built-in preference order. */
  prefer?: ProviderId[];
  tier?: TierLike;
  /** Pin a model id on the chosen provider. */
  model?: string;
  /** Never leave the machine (mock + local providers only). */
  localOnly?: boolean;
  excludeFamilies?: string[];
  /** Default true when ENABLE_MOCK=true. Set false to require a real provider. */
  allowMock?: boolean;
  /** Chat only: flags the chosen model must have (e.g. ['tools'], ['vision']). Unknown models pass. */
  needs?: ModelFlag[];
}

export interface Resolved<C extends Capability> {
  capability: C;
  provider: CapabilityProviderMap[C];
  providerId: ProviderId;
  /** Model the provider will use (chat/image/embeddings); '' when not applicable. */
  model: string;
  /** Why this one was chosen, for route.model logs. */
  reason: string;
  skipped: { id: ProviderId; reason: string }[];
  /** Tier the model was chosen for. */
  tier: ModelTier;
  /**
   * Providers the returned `provider` falls through to, in order: an unreachable local provider (probed on
   * first use) hands over to the next candidate; a real provider that fails before any output with a
   * retryable error (429/5xx/unreachable) hands over to the next real one, never local → cloud and never to Mock.
   */
  fallbacks: ProviderId[];
}

/**
 * Worker env as the provider fabric sees it. Keys are read ONLY server-side from apps/worker/.dev.vars
 * (or Worker secrets). Never send them to the browser or log them.
 */
export interface ProviderEnv {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  XAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_COMPATIBLE_BASE_URL?: string;
  OPENAI_COMPATIBLE_API_KEY?: string;
  /** Chat model on the OpenAI-compatible endpoint; default: the first id its /models lists. */
  OPENAI_COMPATIBLE_MODEL?: string;
  /** Embedding model on the OpenAI-compatible endpoint; default: the first /models id containing "embed". */
  OPENAI_COMPATIBLE_EMBED_MODEL?: string;
  /** Optional base URL overrides (gateways, proxies). Defaults are the providers' public APIs. */
  ANTHROPIC_BASE_URL?: string;
  OPENAI_BASE_URL?: string;
  XAI_BASE_URL?: string;
  GEMINI_BASE_URL?: string;
  OLLAMA_BASE_URL?: string;
  /** Default qwen3:32b. */
  OLLAMA_CHAT_MODEL?: string;
  /** Default nomic-embed-text. */
  OLLAMA_EMBED_MODEL?: string;
  /** "true" enables the keyless Mock provider. */
  ENABLE_MOCK?: string;
  /** "auto" or a ProviderId. */
  DEFAULT_CHAT?: string;
  /** Mock streaming delay per chunk (ms) so demos look live; tests use 0. */
  MOCK_DELAY_MS?: string;
}

export interface RouteNotice {
  capability: Capability;
  from: ProviderId;
  to: ProviderId | null;
  reason: string;
}

export interface RegistryOptions {
  /** Injected fetch (tests, service bindings). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Extra/override provider factories (tests). */
  providers?: Partial<Record<ProviderId, ProviderFactory>>;
  /** Reachability cache for local providers. Defaults to one shared per isolate (probes are cached ~30 s). */
  health?: HealthCacheLike;
  /** Probe timeout for local providers (default 800 ms). */
  probeTimeoutMs?: number;
  /** Called when a call falls through to another provider (`route.model` logging). Never receives keys. */
  onRoute?: (notice: RouteNotice) => void;
}

/** Builds whatever capability objects a provider supports from env; returns null when unconfigured. */
export type ProviderFactory = (env: ProviderEnv, opts: { fetch: typeof fetch }) => ProviderInstance | null;

/** Result of probing a local provider (Ollama, a localhost OpenAI-compatible server). */
export interface LocalHealth {
  ok: boolean;
  /** Owner-readable reason when not ok, e.g. "not reachable at http://127.0.0.1:11434". */
  reason?: string;
  /** Per-capability verdict when the server answers but lacks a model (e.g. qwen3:32b not pulled). */
  capabilities?: Partial<Record<Capability, { ok: boolean; reason?: string }>>;
  /** Flags per model id as the server reports them (Ollama /api/tags `capabilities`). */
  models?: Record<string, ModelFlag[]>;
}

export interface HealthCacheLike {
  peek(key: string): LocalHealth | undefined;
  check(key: string, probe: () => Promise<LocalHealth>): Promise<LocalHealth>;
  /** Record a verdict learned outside a probe (a call found the server gone). */
  set(key: string, health: LocalHealth): void;
}

export interface ProviderInstance {
  chat?: ChatProvider;
  speech?: SpeechProvider;
  image?: ImageProvider;
  embeddings?: EmbeddingProvider;
  /** Local providers: how to probe reachability. `key` identifies the endpoint + models for caching. */
  health?: { key: string; check(signal?: AbortSignal): Promise<LocalHealth> };
}
