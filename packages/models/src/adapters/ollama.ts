// Ported from biz-bot/bridge/src/providers/ollama.js — native /api/chat (NDJSON) with tools, thinking and
// JSON-schema output; /api/embed for embeddings; /api/tags for the reachability probe. Completion is enforced
// (a stream without `done` is an error) and a missing model names the `ollama pull` that fixes it.
import { ProviderError } from '../errors';
import { LruMap } from '../lib/lru';
import { parseNDJSON } from '../lib/sse';
import { guardStream } from '../lib/stream';
import { ThinkSplitter } from '../lib/think';
import { ToolNames, argumentsObject, callId, normalizeArguments, objectSchema } from '../lib/tools';
import { OLLAMA_DEFAULTS } from '../model-catalog';
import type { ChatMessage, ChatProvider, ChatRequest, EmbeddingProvider, LocalHealth, ModelEvent, ModelFlag, ProviderFactory } from '../types';
import { FREE, HttpClient } from './common';

const LABEL = 'Local (Ollama)';
const REASONING_LEVELS = ['low', 'medium', 'high'];

/** Flags per `${baseUrl}|${model}` learned from /api/tags (per isolate). */
const modelFlagsSeen = new LruMap<string, ModelFlag[]>(256);

/** "nomic-embed-text" matches "nomic-embed-text:latest" and vice versa. */
export function sameOllamaModel(a: string, b: string): boolean {
  const n = (s: string) => (s.includes(':') ? s : `${s}:latest`).toLowerCase();
  return n(a) === n(b);
}

function flagsFromCapabilities(caps: string[] | undefined): ModelFlag[] | null {
  if (!caps?.length) return null;
  const flags: ModelFlag[] = [];
  if (caps.includes('completion')) flags.push('chat', 'json');
  if (caps.includes('tools')) flags.push('tools');
  if (caps.includes('vision')) flags.push('vision');
  if (caps.includes('thinking')) flags.push('reasoning');
  if (caps.includes('embedding')) flags.push('embeddings');
  return flags;
}

export function toOllamaMessages(system: string | undefined, messages: ChatMessage[], names: ToolNames): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', content: m.isError ? `Error: ${m.content}` : m.content, tool_name: names.wire(m.name) });
    else if (m.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant', content: m.content || '' };
      if (m.toolCalls?.length) msg.tool_calls = m.toolCalls.map((tc) => ({ function: { name: names.wire(tc.name), arguments: argumentsObject(tc.arguments) } }));
      out.push(msg);
    } else out.push({ role: 'user', content: m.content || ' ' });
  }
  return out;
}

interface OllamaChunk {
  message?: { content?: string; thinking?: string; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export const createOllamaProvider: ProviderFactory = (env, { fetch }) => {
  const baseUrl = env.OLLAMA_BASE_URL?.trim();
  if (!baseUrl) return null;
  const chatModel = env.OLLAMA_CHAT_MODEL?.trim() || OLLAMA_DEFAULTS.chat;
  const embedModel = env.OLLAMA_EMBED_MODEL?.trim() || OLLAMA_DEFAULTS.embed;
  const http = new HttpClient({ provider: 'ollama', label: LABEL, baseUrl, headers: {}, fetch, secrets: [] });
  const base = { id: 'ollama', kind: 'local', family: 'qwen' } as const;

  const notPulled = (model: string) => `${LABEL} does not have ${model}. Run \`ollama pull ${model}\`.`;
  const rethrowMissingModel = (e: unknown, model: string): never => {
    if (e instanceof ProviderError && (e.kind === 'model_not_found' || (e.status === 400 && /not found/i.test(e.message)))) throw new ProviderError('ollama', notPulled(model), e.status, false, 'model_not_found');
    throw e;
  };

  function thinkParam(model: string, effort: ChatRequest['reasoningEffort']): boolean | string | undefined {
    const flags = modelFlagsSeen.get(`${http.baseUrl}|${model.toLowerCase()}`);
    const thinks = flags ? flags.includes('reasoning') : /qwen3|deepseek-r1|gpt-oss|qwq|magistral/i.test(model);
    if (!thinks) return undefined;
    // Thinking off unless asked: qwen3's thinking pass costs seconds before the first token (oncloudnine measured 9.8 s → 3.6 s).
    if (!effort || effort === 'none') return /^gpt-oss/i.test(model) ? 'low' : false;
    if (/^gpt-oss/i.test(model)) return REASONING_LEVELS.includes(effort) ? effort : 'medium';
    return true;
  }

  async function* ollamaChat(req: ChatRequest, model: string): AsyncGenerator<ModelEvent> {
    const names = ToolNames.forRequest(req.tools, req.messages);
    const body: Record<string, unknown> = { model, messages: toOllamaMessages(req.system, req.messages, names), stream: true, keep_alive: '30m' };
    const tools = req.toolChoice === 'none' ? [] : (req.tools ?? []);
    if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: names.wire(t.name), description: t.description || '', parameters: objectSchema(t.parameters) } }));
    const options: Record<string, unknown> = {};
    if (req.maxTokens) options.num_predict = req.maxTokens;
    if (req.temperature != null) options.temperature = req.temperature;
    if (Object.keys(options).length) body.options = options;
    if (req.responseFormat?.type === 'json_schema') body.format = req.responseFormat.schema;
    const think = thinkParam(model, req.reasoningEffort);
    if (think !== undefined) body.think = think;

    let res: Response;
    try {
      res = await http.request('/api/chat', { json: body, signal: req.signal, stream: true });
    } catch (e) {
      rethrowMissingModel(e, model);
      throw e;
    }
    const split = new ThinkSplitter();
    let completed = false;
    let sawTool = false;
    let doneReason = 'stop';
    let input = 0;
    let output = 0;
    for await (const raw of parseNDJSON(http.body(res), req.signal)) {
      const ev = raw as OllamaChunk;
      if (ev.error) throw new ProviderError('ollama', `${LABEL}: ${ev.error}`, 502, false, 'upstream');
      const msg = ev.message ?? {};
      if (msg.thinking) yield { type: 'reasoning', delta: msg.thinking };
      if (msg.content) {
        const { text, reasoning } = split.push(msg.content);
        if (reasoning) yield { type: 'reasoning', delta: reasoning };
        if (text) yield { type: 'text', delta: text };
      }
      for (const tc of msg.tool_calls ?? []) {
        if (!tc.function?.name) continue;
        sawTool = true;
        yield { type: 'tool_call', id: tc.id || callId(), name: names.local(tc.function.name), arguments: normalizeArguments(tc.function.arguments ?? {}) };
      }
      if (ev.done) {
        completed = true;
        input = ev.prompt_eval_count ?? 0;
        output = ev.eval_count ?? 0;
        doneReason = ev.done_reason ?? 'stop';
      }
    }
    if (!completed) throw new ProviderError('ollama', `${LABEL} stopped before the reply was complete. Try again.`, 502, true, 'incomplete');
    const rest = split.flush();
    if (rest.reasoning) yield { type: 'reasoning', delta: rest.reasoning };
    if (rest.text) yield { type: 'text', delta: rest.text };
    yield { type: 'usage', input, output, ...FREE };
    yield { type: 'done', finish: sawTool ? 'tool_calls' : doneReason === 'length' ? 'length' : 'stop' };
  }

  const chat: ChatProvider = {
    ...base,
    defaultModel: () => chatModel,
    chat: (req) => guardStream('ollama', LABEL, req.signal, () => ollamaChat(req, req.model || chatModel)),
  };

  const embeddings: EmbeddingProvider = {
    ...base,
    async embed(req) {
      const model = req.model ?? embedModel;
      let out: { embeddings?: number[][] };
      try {
        out = await http.json<{ embeddings?: number[][] }>('/api/embed', { json: { model, input: req.texts, keep_alive: '30m' }, signal: req.signal, timeoutMs: 120_000 });
      } catch (e) {
        return rethrowMissingModel(e, model);
      }
      const vectors = out.embeddings ?? [];
      if (vectors.length !== req.texts.length) throw new ProviderError('ollama', `${LABEL} returned ${vectors.length} embeddings for ${req.texts.length} texts.`, 502, true, 'bad_response');
      return { vectors, model, dims: vectors[0]?.length ?? 0, provider: 'ollama' };
    },
  };

  const health = {
    key: `ollama|${http.baseUrl}|${chatModel}|${embedModel}`,
    async check(signal?: AbortSignal): Promise<LocalHealth> {
      let tags: { models?: { name?: string; model?: string; capabilities?: string[] }[] };
      try {
        tags = await http.json('/api/tags', { signal, retries: 0, timeoutMs: 800 });
      } catch {
        return { ok: false, reason: `${LABEL} is not reachable at ${http.baseUrl}. Start it with \`ollama serve\`.` };
      }
      const models: Record<string, ModelFlag[]> = {};
      for (const m of tags.models ?? []) {
        const name = m.name ?? m.model;
        if (!name) continue;
        const flags = flagsFromCapabilities(m.capabilities);
        if (flags) {
          models[name] = flags;
          modelFlagsSeen.set(`${http.baseUrl}|${name.toLowerCase()}`, flags);
          if (name.endsWith(':latest')) modelFlagsSeen.set(`${http.baseUrl}|${name.slice(0, -7).toLowerCase()}`, flags);
        } else models[name] = [];
      }
      const has = (model: string) => Object.keys(models).some((n) => sameOllamaModel(n, model));
      return {
        ok: true,
        models,
        capabilities: {
          chat: has(chatModel) ? { ok: true } : { ok: false, reason: notPulled(chatModel) },
          embeddings: has(embedModel) ? { ok: true } : { ok: false, reason: notPulled(embedModel) },
        },
      };
    },
  };

  return { chat, embeddings, health };
};
