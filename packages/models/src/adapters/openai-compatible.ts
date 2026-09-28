// Ported from biz-bot/bridge/src/providers/openai-compat.js (and oncloudnine providers/openaiCompatible.ts) —
// any OpenAI-compatible endpoint (LM Studio, vLLM, llama.cpp, hosted gateways) over /chat/completions:
// streamed tool-call fragments assembled by index, reasoning_content → reasoning, json_schema output,
// completion enforcement (no finish_reason and no [DONE] → error); embeddings over /embeddings.
import { ProviderError } from '../errors';
import { isLocalUrl, trimSlash } from '../lib/http';
import { parseSSE } from '../lib/sse';
import { guardStream } from '../lib/stream';
import { ThinkSplitter } from '../lib/think';
import { IndexedToolCalls, ToolNames, objectSchema } from '../lib/tools';
import type { ChatMessage, ChatProvider, ChatRequest, EmbeddingProvider, LocalHealth, ModelEvent, ProviderFactory, ProviderInstance } from '../types';
import { FREE, HttpClient, NOT_PRICED } from './common';

const LABEL = 'OpenAI-compatible';

/** A base URL without a path gets `/v1` (LM Studio, vLLM and llama.cpp serve there). */
export function compatibleBaseUrl(url: string): string {
  const u = trimSlash(url.trim());
  try {
    const parsed = new URL(u);
    return parsed.pathname === '/' || parsed.pathname === '' ? `${u}/v1` : u;
  } catch {
    return u;
  }
}

export function toCompatMessages(system: string | undefined, messages: ChatMessage[], names: ToolNames): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.isError ? `Error: ${m.content}` : m.content });
    else if (m.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant', content: m.content || null };
      if (m.toolCalls?.length) msg.tool_calls = m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: names.wire(tc.name), arguments: tc.arguments || '{}' } }));
      out.push(msg);
    } else out.push({ role: 'user', content: m.content || ' ' });
  }
  return out;
}

interface CompatChunk {
  choices?: { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null;
  error?: { message?: string } | string;
}

export const createOpenAICompatibleProvider: ProviderFactory = (env, { fetch }) => {
  const raw = env.OPENAI_COMPATIBLE_BASE_URL?.trim();
  if (!raw) return null;
  const key = env.OPENAI_COMPATIBLE_API_KEY?.trim();
  const baseUrl = compatibleBaseUrl(raw);
  const local = isLocalUrl(baseUrl);
  const http = new HttpClient({ provider: 'openai-compatible', label: LABEL, keyName: 'OPENAI_COMPATIBLE_API_KEY', baseUrl, headers: key ? { authorization: `Bearer ${key}` } : {}, fetch, secrets: [key] });
  const base = { id: 'openai-compatible', kind: local ? 'local' : 'cloud', family: 'compatible' } as const;
  let listed: Promise<string[]> | null = null;
  const listModels = (signal?: AbortSignal) =>
    (listed ??= http
      .json<{ data?: { id?: string }[]; models?: { id?: string; name?: string }[] }>('/models', { signal, retries: 0, timeoutMs: 4000 })
      .then((d) => [...(d.data ?? []), ...(d.models ?? [])].map((m) => (m as { id?: string }).id || (m as { name?: string }).name || '').filter(Boolean))
      .catch((e: unknown) => {
        listed = null;
        throw e;
      }));
  const envChat = env.OPENAI_COMPATIBLE_MODEL?.trim();
  const envEmbed = env.OPENAI_COMPATIBLE_EMBED_MODEL?.trim();

  async function chatModelFor(req: ChatRequest): Promise<string> {
    if (req.model && req.model !== 'auto') return req.model;
    if (envChat) return envChat;
    const ids = await listModels(req.signal);
    const pick = ids.find((id) => !/embed/i.test(id));
    if (!pick) throw new ProviderError('openai-compatible', `${LABEL} lists no chat model. Set OPENAI_COMPATIBLE_MODEL.`, 400, false, 'model_not_found');
    return pick;
  }

  async function* compatChat(req: ChatRequest): AsyncGenerator<ModelEvent> {
    const model = await chatModelFor(req);
    const names = ToolNames.forRequest(req.tools, req.messages);
    const body: Record<string, unknown> = { model, messages: toCompatMessages(req.system, req.messages, names), stream: true, stream_options: { include_usage: true } };
    const tools = req.toolChoice === 'none' ? [] : (req.tools ?? []);
    if (tools.length) {
      body.tools = tools.map((t) => ({ type: 'function', function: { name: names.wire(t.name), description: t.description || '', parameters: objectSchema(t.parameters) } }));
      const c = req.toolChoice;
      if (c === 'required') body.tool_choice = 'required';
      else if (c && typeof c === 'object') body.tool_choice = { type: 'function', function: { name: names.wire(c.name) } };
    }
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.temperature != null) body.temperature = req.temperature;
    if (req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;
    if (req.responseFormat?.type === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: req.responseFormat.name || 'result', schema: req.responseFormat.schema, strict: req.responseFormat.strict ?? false } };
    const res = await http.request('/chat/completions', { json: body, signal: req.signal, stream: true });
    const calls = new IndexedToolCalls();
    const split = new ThinkSplitter();
    let finish: string | null = null;
    let sawDone = false;
    let usage: { input: number; output: number; cached?: number } | null = null;
    for await (const { data } of parseSSE(http.body(res), req.signal)) {
      if (data === '[DONE]') {
        sawDone = true;
        break;
      }
      let ev: CompatChunk;
      try {
        ev = JSON.parse(data) as CompatChunk;
      } catch {
        continue;
      }
      if (ev.error) throw new ProviderError('openai-compatible', `${LABEL}: ${typeof ev.error === 'string' ? ev.error : ev.error.message || 'stream error'}`, 502, false, 'upstream');
      if (ev.usage) {
        usage = { input: ev.usage.prompt_tokens ?? 0, output: ev.usage.completion_tokens ?? 0 };
        if (ev.usage.prompt_tokens_details?.cached_tokens) usage.cached = ev.usage.prompt_tokens_details.cached_tokens;
      }
      const choice = ev.choices?.[0];
      if (!choice) continue;
      const d = choice.delta ?? {};
      const reasoning = d.reasoning_content ?? d.reasoning;
      if (reasoning) yield { type: 'reasoning', delta: reasoning };
      if (d.content) {
        const s = split.push(d.content);
        if (s.reasoning) yield { type: 'reasoning', delta: s.reasoning };
        if (s.text) yield { type: 'text', delta: s.text };
      }
      for (const tc of d.tool_calls ?? []) calls.add(tc);
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    if (!finish && !sawDone) throw new ProviderError('openai-compatible', `${LABEL} stopped before the reply was complete. Try again.`, 502, true, 'incomplete');
    const rest = split.flush();
    if (rest.reasoning) yield { type: 'reasoning', delta: rest.reasoning };
    if (rest.text) yield { type: 'text', delta: rest.text };
    const toolCalls = calls.drain(names);
    for (const c of toolCalls) yield { type: 'tool_call', ...c };
    if (usage) yield { type: 'usage', ...usage, ...(local ? FREE : NOT_PRICED) };
    yield { type: 'done', finish: toolCalls.length ? 'tool_calls' : finish === 'length' ? 'length' : finish === 'content_filter' ? 'refusal' : 'stop' };
  }

  const chat: ChatProvider = {
    ...base,
    defaultModel: () => envChat || 'auto',
    chat: (req) => guardStream('openai-compatible', LABEL, req.signal, () => compatChat(req), [key]),
  };

  const embeddings: EmbeddingProvider = {
    ...base,
    async embed(req) {
      let model = req.model ?? envEmbed;
      if (!model) model = (await listModels(req.signal)).find((id) => /embed/i.test(id));
      if (!model) throw new ProviderError('openai-compatible', `${LABEL} serves no embedding model. Set OPENAI_COMPATIBLE_EMBED_MODEL.`, 400, false, 'model_not_found');
      const out = await http.json<{ data?: { index: number; embedding: number[] }[] }>('/embeddings', { json: { model, input: req.texts }, signal: req.signal });
      const vectors = [...(out.data ?? [])].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (vectors.length !== req.texts.length) throw new ProviderError('openai-compatible', `${LABEL} returned ${vectors.length} embeddings for ${req.texts.length} texts.`, 502, true, 'bad_response');
      return { vectors, model, dims: vectors[0]?.length ?? 0, provider: 'openai-compatible' };
    },
  };

  const instance: ProviderInstance = { chat, embeddings };
  if (local) {
    instance.health = {
      key: `openai-compatible|${baseUrl}`,
      async check(signal?: AbortSignal): Promise<LocalHealth> {
        try {
          const ids = await http.json<{ data?: { id?: string }[] }>('/models', { signal, retries: 0, timeoutMs: 800 });
          const list = (ids.data ?? []).map((m) => m.id ?? '').filter(Boolean);
          return { ok: true, capabilities: { chat: envChat || list.some((id) => !/embed/i.test(id)) ? { ok: true } : { ok: false, reason: `${LABEL} lists no chat model.` }, embeddings: envEmbed || list.some((id) => /embed/i.test(id)) ? { ok: true } : { ok: false, reason: `${LABEL} serves no embedding model.` } } };
        } catch {
          return { ok: false, reason: `${LABEL} is not reachable at ${baseUrl}.` };
        }
      },
    };
  }
  return instance;
};
