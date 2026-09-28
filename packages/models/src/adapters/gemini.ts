// Gemini native dialect [NEW — no reference code uses Gemini]: streamGenerateContent (SSE) with function
// calling, systemInstruction, responseSchema and thought summaries; batchEmbedContents for embeddings.
// Model ids are `-latest` aliases; a 404 triggers one live discovery (GET /models) per isolate and a retry.
import { ProviderError } from '../errors';
import { LruMap } from '../lib/lru';
import { parseSSE } from '../lib/sse';
import { guardStream } from '../lib/stream';
import { ToolNames, argumentsObject, callId, normalizeArguments } from '../lib/tools';
import { BASE_URLS, CHAT_CATALOG, EMBEDDING_MODELS } from '../model-catalog';
import { normalizeTier, type ChatMessage, type ChatProvider, type ChatRequest, type EmbeddingProvider, type FinishReason, type JsonSchema, type ModelEvent, type ModelTier, type ProviderFactory } from '../types';
import { HttpClient, NOT_PRICED } from './common';

const LABEL = 'Google Gemini';
/** Documented placeholder for a function call whose thought signature is not available (history from elsewhere). */
const SKIP_SIGNATURE = 'skip_thought_signature_validator';

/** thoughtSignature per function-call id: Gemini 3 requires it back on the functionCall part. */
const signatures = new LruMap<string, string>(512);
/** Discovered model per tier, per base URL (after a 404 on an alias). */
const discovered = new Map<string, string>();

const TYPE_MAP: Record<string, string> = { string: 'STRING', number: 'NUMBER', integer: 'INTEGER', boolean: 'BOOLEAN', array: 'ARRAY', object: 'OBJECT' };

/** JSON Schema → the OpenAPI subset Gemini's `Schema` accepts (types upper-case, unsupported keywords dropped). */
export function toGeminiSchema(schema: JsonSchema | undefined, depth = 0): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || depth > 12) return { type: 'STRING' };
  const out: Record<string, unknown> = {};
  let type = schema.type;
  let nullable = false;
  if (Array.isArray(type)) {
    nullable = type.includes('null');
    type = type.find((t) => t !== 'null') ?? 'string';
  }
  if (schema.const !== undefined) {
    type = typeof schema.const === 'number' ? 'number' : typeof schema.const === 'boolean' ? 'boolean' : 'string';
    if (type === 'string') out.enum = [String(schema.const)];
  }
  if (!type && schema.properties) type = 'object';
  if (!type && schema.items) type = 'array';
  const variants = schema.anyOf ?? schema.oneOf;
  if (!type && variants?.length) {
    const nonNull = variants.filter((v) => v.type !== 'null');
    if (nonNull.length === 1) return { ...toGeminiSchema(nonNull[0], depth + 1), ...(nonNull.length < variants.length ? { nullable: true } : {}), ...(schema.description ? { description: schema.description } : {}) };
    return { anyOf: nonNull.map((v) => toGeminiSchema(v, depth + 1)), ...(schema.description ? { description: schema.description } : {}) };
  }
  const t = typeof type === 'string' ? type : 'string';
  out.type = TYPE_MAP[t] ?? 'STRING';
  if (nullable) out.nullable = true;
  if (schema.description) out.description = schema.description;
  if (Array.isArray(schema.enum) && t === 'string') {
    out.enum = schema.enum.map(String);
    out.format = 'enum';
  }
  if (t === 'object') {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) props[k] = toGeminiSchema(v, depth + 1);
    out.properties = props;
    const required = (schema.required ?? []).filter((k) => k in props);
    if (required.length) out.required = required;
  }
  if (t === 'array') {
    out.items = toGeminiSchema(schema.items ?? { type: 'string' }, depth + 1);
    if (typeof schema.minItems === 'number') out.minItems = schema.minItems;
    if (typeof schema.maxItems === 'number') out.maxItems = schema.maxItems;
  }
  if ((t === 'number' || t === 'integer') && typeof schema.minimum === 'number') out.minimum = schema.minimum;
  if ((t === 'number' || t === 'integer') && typeof schema.maximum === 'number') out.maximum = schema.maximum;
  return out;
}

interface Content {
  role: 'user' | 'model';
  parts: Record<string, unknown>[];
}

function toolResponse(content: string, isError: boolean | undefined): Record<string, unknown> {
  if (isError) return { error: content };
  try {
    const v = JSON.parse(content) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return { result: v };
  } catch {
    return { result: content };
  }
}

export function toGeminiContents(messages: ChatMessage[], names: ToolNames): Content[] {
  const out: Content[] = [];
  const push = (role: Content['role'], parts: Record<string, unknown>[]) => {
    const last = out[out.length - 1];
    if (last?.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  };
  for (const m of messages) {
    if (m.role === 'assistant') {
      const parts: Record<string, unknown>[] = [];
      if (m.content.trim()) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: names.wire(tc.name), args: argumentsObject(tc.arguments) }, thoughtSignature: signatures.get(tc.id) ?? SKIP_SIGNATURE });
      }
      if (parts.length) push('model', parts);
    } else if (m.role === 'tool') {
      push('user', [{ functionResponse: { name: names.wire(m.name), response: toolResponse(m.content, m.isError) } }]);
    } else {
      push('user', [{ text: m.content || ' ' }]);
    }
  }
  if (!out.length || out[0]!.role !== 'user') out.unshift({ role: 'user', parts: [{ text: '(conversation start)' }] });
  return out;
}

function toolConfig(choice: ChatRequest['toolChoice'], names: ToolNames): Record<string, unknown> | undefined {
  if (!choice || choice === 'auto') return undefined;
  if (choice === 'none') return { functionCallingConfig: { mode: 'NONE' } };
  if (choice === 'required') return { functionCallingConfig: { mode: 'ANY' } };
  return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [names.wire(choice.name)] } };
}

interface GeminiChunk {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { name?: string; args?: unknown; id?: string } }[] };
    finishReason?: string;
    citationMetadata?: { citationSources?: { uri?: string; title?: string }[] };
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; code?: number; status?: string };
}

const REFUSALS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'LANGUAGE']);

export async function* parseGeminiStream(body: ReadableStream<Uint8Array>, label: string, names: ToolNames, signal?: AbortSignal): AsyncGenerator<ModelEvent> {
  let finishReason: string | null = null;
  let sawTool = false;
  let sawText = false;
  let blocked: string | null = null;
  let usage: { input: number; output: number; cached?: number } | null = null;
  const seen = new Set<string>();
  for await (const { data } of parseSSE(body, signal)) {
    let chunk: GeminiChunk;
    try {
      chunk = JSON.parse(data) as GeminiChunk;
    } catch {
      continue;
    }
    if (chunk.error) throw new ProviderError('gemini', `${label}: ${chunk.error.message || 'stream error'}`, chunk.error.code ?? 502, (chunk.error.code ?? 500) >= 500 || chunk.error.code === 429, 'upstream');
    if (chunk.promptFeedback?.blockReason) blocked = chunk.promptFeedback.blockReason;
    if (chunk.usageMetadata) {
      const u = chunk.usageMetadata;
      usage = { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
      if (u.cachedContentTokenCount) usage.cached = u.cachedContentTokenCount;
    }
    const cand = chunk.candidates?.[0];
    if (!cand) continue;
    for (const part of cand.content?.parts ?? []) {
      if (part.functionCall?.name) {
        const id = part.functionCall.id || callId();
        if (part.thoughtSignature) signatures.set(id, part.thoughtSignature);
        sawTool = true;
        yield { type: 'tool_call', id, name: names.local(part.functionCall.name), arguments: normalizeArguments(part.functionCall.args ?? {}) };
      } else if (typeof part.text === 'string' && part.text) {
        if (part.thought) yield { type: 'reasoning', delta: part.text };
        else {
          sawText = true;
          yield { type: 'text', delta: part.text };
        }
      }
    }
    for (const s of cand.citationMetadata?.citationSources ?? []) {
      if (s.uri && !seen.has(s.uri)) {
        seen.add(s.uri);
        yield { type: 'citation', url: s.uri, ...(s.title ? { title: s.title } : {}) };
      }
    }
    for (const g of cand.groundingMetadata?.groundingChunks ?? []) {
      if (g.web?.uri && !seen.has(g.web.uri)) {
        seen.add(g.web.uri);
        yield { type: 'citation', url: g.web.uri, ...(g.web.title ? { title: g.web.title } : {}) };
      }
    }
    if (cand.finishReason) finishReason = cand.finishReason;
  }
  if (!finishReason && blocked) {
    finishReason = 'SAFETY';
  }
  if (!finishReason) throw new ProviderError('gemini', `${label} stopped before the reply was complete. Try again.`, 502, true, 'incomplete');
  let finish: FinishReason;
  if (sawTool) finish = 'tool_calls';
  else if (finishReason === 'STOP') finish = 'stop';
  else if (finishReason === 'MAX_TOKENS') finish = 'length';
  else if (REFUSALS.has(finishReason)) finish = 'refusal';
  else finish = 'incomplete';
  if (finish === 'refusal' && !sawText) yield { type: 'text', delta: 'I cannot help with that.' };
  if (usage) yield { type: 'usage', ...usage, ...NOT_PRICED };
  yield { type: 'done', finish };
}

/** Pick the newest stable model for a tier from GET /models. Exported for tests. */
export function pickGeminiModel(models: { name?: string; supportedGenerationMethods?: string[] }[], tier: ModelTier): string | null {
  const ids = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((id) => /^gemini-/.test(id) && !/(image|tts|audio|live|embedding|exp|thinking|vision|computer|robotics)/.test(id));
  const want = (id: string) => (tier === 'reason' ? /-pro/.test(id) : tier === 'voice' ? /flash-lite/.test(id) : /flash/.test(id) && !/lite/.test(id));
  const version = (id: string) => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
  const rank = (id: string) => version(id) * 10 - (/preview/.test(id) ? 1 : 0);
  const pool = ids.filter(want).length ? ids.filter(want) : ids.filter((id) => /flash/.test(id));
  pool.sort((a, b) => rank(b) - rank(a));
  return pool[0] ?? null;
}

async function* geminiChat(http: HttpClient, req: ChatRequest, requested: string, tierOf: (model: string) => ModelTier): AsyncGenerator<ModelEvent> {
  const names = ToolNames.forRequest(req.tools, req.messages);
  const body: Record<string, unknown> = { contents: toGeminiContents(req.messages, names) };
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  const decls = req.toolChoice === 'none' ? [] : (req.tools ?? []).map((t) => {
    const params = toGeminiSchema({ ...t.parameters, type: 'object' });
    const hasParams = params.properties && Object.keys(params.properties as object).length > 0;
    return { name: names.wire(t.name), description: t.description || '', ...(hasParams ? { parameters: params } : {}) };
  });
  if (decls.length) body.tools = [{ functionDeclarations: decls }];
  const tc = decls.length ? toolConfig(req.toolChoice, names) : undefined;
  if (tc) body.toolConfig = tc;
  const gen: Record<string, unknown> = {};
  if (req.maxTokens) gen.maxOutputTokens = req.maxTokens;
  if (req.temperature != null) gen.temperature = req.temperature;
  if (req.responseFormat?.type === 'json_schema') {
    gen.responseMimeType = 'application/json';
    gen.responseSchema = toGeminiSchema(req.responseFormat.schema);
  }
  if (req.reasoningEffort && req.reasoningEffort !== 'none') gen.thinkingConfig = { includeThoughts: true };
  if (Object.keys(gen).length) body.generationConfig = gen;

  const tier = tierOf(requested);
  const cacheKey = `${http.baseUrl}|${tier}`;
  let model = discovered.get(cacheKey) && requested === CHAT_CATALOG.gemini.defaults[tier] ? discovered.get(cacheKey)! : requested;
  let res: Response;
  try {
    res = await http.request(`/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { json: body, signal: req.signal, stream: true });
  } catch (e) {
    // The alias is gone (or never existed on this key): discover once, then retry with the newest match.
    if (!(e instanceof ProviderError) || e.kind !== 'model_not_found' || requested !== CHAT_CATALOG.gemini.defaults[tier]) throw e;
    const list = await http.json<{ models?: { name?: string; supportedGenerationMethods?: string[] }[] }>('/models?pageSize=1000', { signal: req.signal });
    const pick = pickGeminiModel(list.models ?? [], tier);
    if (!pick || pick === model) throw e;
    discovered.set(cacheKey, pick);
    model = pick;
    res = await http.request(`/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { json: body, signal: req.signal, stream: true });
  }
  yield* parseGeminiStream(http.body(res), LABEL, names, req.signal);
}

export const createGeminiProvider: ProviderFactory = (env, { fetch }) => {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const http = new HttpClient({ provider: 'gemini', label: LABEL, keyName: 'GEMINI_API_KEY', baseUrl: env.GEMINI_BASE_URL?.trim() || BASE_URLS.gemini, headers: { 'x-goog-api-key': key }, fetch, secrets: [key] });
  const base = { id: 'gemini', kind: 'cloud', family: 'gemini' } as const;
  const defaults = CHAT_CATALOG.gemini.defaults;
  const tierOf = (model: string): ModelTier => (model === defaults.reason ? 'reason' : model === defaults.voice ? 'voice' : 'fast');
  const chat: ChatProvider = {
    ...base,
    defaultModel: (tier) => defaults[normalizeTier(tier)],
    chat: (req) => guardStream('gemini', LABEL, req.signal, () => geminiChat(http, req, req.model || chat.defaultModel(), tierOf), [key]),
  };
  const embeddings: EmbeddingProvider = {
    ...base,
    async embed(req) {
      const model = req.model ?? EMBEDDING_MODELS.gemini.model;
      const out = await http.json<{ embeddings?: { values?: number[] }[] }>(`/models/${encodeURIComponent(model)}:batchEmbedContents`, {
        json: { requests: req.texts.map((text) => ({ model: `models/${model}`, content: { parts: [{ text }] } })) },
        signal: req.signal,
      });
      const vectors = (out.embeddings ?? []).map((e) => e.values ?? []);
      if (vectors.length !== req.texts.length) throw new ProviderError('gemini', `${LABEL} returned ${vectors.length} embeddings for ${req.texts.length} texts.`, 502, true, 'bad_response');
      return { vectors, model, dims: vectors[0]?.length ?? 0, provider: 'gemini' };
    },
  };
  return { chat, embeddings };
};
