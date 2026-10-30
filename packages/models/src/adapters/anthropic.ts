// Ported from biz-bot/worker/src/providers/anthropic.js — Messages API over raw HTTP, normalised to the
// ModelEvent stream: adaptive thinking, output_config (effort, json_schema), refusal fallbacks, tool_use
// accumulation by block index, and completion enforcement (no message_stop → error).
import { ProviderError } from '../errors';
import { LruMap } from '../lib/lru';
import { parseSSE } from '../lib/sse';
import { guardStream } from '../lib/stream';
import { ToolNames, argumentsObject, callId, normalizeArguments, objectSchema } from '../lib/tools';
import { ANTHROPIC_VERSION, BASE_URLS, CHAT_CATALOG } from '../model-catalog';
import { normalizeTier, type ChatMessage, type ChatProvider, type ChatRequest, type FinishReason, type HostedSupport, type ModelEvent, type ProviderFactory } from '../types';
import { hostedFor } from '../lib/hosted';
import { HttpClient, NOT_PRICED } from './common';

const LABEL = 'Anthropic';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const supportsEffort = (model: string) => !/haiku/.test(model);
const supportsAdaptiveThinking = (model: string) => !/haiku|opus-4-[015]|sonnet-4-[05]|opus-4-1/.test(model);
const supportsThinkingDisplay = (model: string) => /opus-5|sonnet-5|fable-5|mythos-5|opus-4-[78]/.test(model);
const usesFallbackDefault = (model: string) => /^claude-(opus-5|fable-5|mythos-5)/.test(model);
/** Omitting `thinking` runs adaptive thinking on these, so `reasoningEffort: 'none'` must send `{type: 'disabled'}`. */
const thinksUnlessDisabled = (model: string) => /^claude-(opus-5(?!-5)|sonnet-5)/.test(model);
/** Thinking cannot be switched off here (`disabled` is a 400): 'none' becomes their lowest effort. */
const alwaysThinks = (model: string) => /^claude-(fable-5|mythos-5|opus-5-5)/.test(model);

type Block = Record<string, unknown>;

/**
 * The assistant content of a turn that thought and then called tools, block for block as Anthropic sent it, keyed by
 * tool_use id. With thinking on, the continuation after tool results must send that message back unchanged: the
 * thinking blocks with their signatures, in their places among text, hosted search and tool_use blocks. Our neutral
 * transcript does not carry provider state, so the adapter keeps it here (per isolate; a tool loop runs inside one
 * Durable Object). When it is gone, that continuation runs without thinking instead of failing.
 */
const turnByToolUse = new LruMap<string, Block[]>(512);

interface Converted {
  messages: { role: 'user' | 'assistant'; content: string | Block[] }[];
  /** The request continues a tool round whose assistant message has its thinking blocks replayed. */
  continuationWithThinking: boolean;
  /** The request continues a tool round (last message is a tool result). */
  continuation: boolean;
}

export function toAnthropicMessages(messages: ChatMessage[], names: ToolNames, replayThinking: boolean): Converted {
  const out: Converted['messages'] = [];
  const lastAssistant = messages.map((m) => m.role).lastIndexOf('assistant');
  const continuation = messages[messages.length - 1]?.role === 'tool';
  let continuationWithThinking = false;
  const pushUser = (blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last?.role === 'user') {
      const prev = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
      last.content = [...prev, ...blocks];
    } else out.push({ role: 'user', content: blocks });
  };
  messages.forEach((m, i) => {
    if (m.role === 'assistant') {
      const blocks: Block[] = [];
      const original = replayThinking && continuation && i === lastAssistant && m.toolCalls?.length ? turnByToolUse.get(m.toolCalls[0]!.id) : undefined;
      if (original && m.toolCalls!.every((tc) => original.some((b) => b.type === 'tool_use' && b.id === tc.id))) {
        out.push({ role: 'assistant', content: original });
        continuationWithThinking = true;
        return;
      }
      if (m.content.trim()) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: tc.id, name: names.wire(tc.name), input: argumentsObject(tc.arguments) });
      if (!blocks.length) blocks.push({ type: 'text', text: '(no content)' });
      out.push({ role: 'assistant', content: blocks });
    } else if (m.role === 'tool') {
      pushUser([{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content || '(empty)', ...(m.isError ? { is_error: true } : {}) }]);
    } else {
      pushUser([...(m.images ?? []).map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } })), { type: 'text', text: m.content || ' ' }]);
    }
  });
  // Anthropic requires the first message to be from the user.
  if (!out.length || out[0]!.role !== 'user') out.unshift({ role: 'user', content: '(conversation start)' });
  return { messages: out, continuationWithThinking, continuation };
}

function toToolChoice(choice: ChatRequest['toolChoice'], names: ToolNames): Block | undefined {
  if (!choice || choice === 'auto') return undefined;
  if (choice === 'none') return { type: 'none' };
  if (choice === 'required') return { type: 'any' };
  return { type: 'tool', name: names.wire(choice.name) };
}

/** Hosted web search (Messages API server tool; biz-bot anthropic.js:88). The stable version is the fallback. */
export const ANTHROPIC_HOSTED: HostedSupport = { web_search: 'with_tools' };
export const WEB_SEARCH_TOOL = 'web_search_20260209';
export const WEB_SEARCH_TOOL_STABLE = 'web_search_20250305';

interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
  content_block?: { type?: string; id?: string; name?: string; text?: string; thinking?: string; signature?: string; data?: string; input?: unknown; content?: unknown };
  delta?: { type?: string; text?: string; thinking?: string; signature?: string; partial_json?: string; stop_reason?: string; citation?: { url?: string; title?: string } };
  usage?: { output_tokens?: number };
  error?: { type?: string; message?: string };
}

async function* anthropicChat(http: HttpClient, req: ChatRequest, model: string): AsyncGenerator<ModelEvent> {
  const names = ToolNames.forRequest(req.tools, req.messages);
  const wantsThinking = supportsAdaptiveThinking(model) && req.reasoningEffort !== 'none' && req.toolChoice !== 'required' && typeof req.toolChoice !== 'object';
  const conv = toAnthropicMessages(req.messages, names, wantsThinking);
  // A continuation may only think if the assistant turn it continues carries its thinking blocks.
  const thinking = wantsThinking && (!conv.continuation || conv.continuationWithThinking);
  const body: Record<string, unknown> = { model, max_tokens: req.maxTokens || 16_000, messages: conv.messages, stream: true };
  if (req.system) body.system = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }];
  const fns = req.toolChoice === 'none' ? [] : (req.tools ?? []).map((t) => ({ name: names.wire(t.name), description: t.description || '', input_schema: objectSchema(t.parameters) }));
  const hosted = hostedFor(req, ANTHROPIC_HOSTED, fns.length > 0);
  const searchTool = (version: string) =>
    hosted.map((t) => ({ type: version, name: 'web_search', max_uses: Math.min(10, Math.max(1, t.maxUses ?? 5)), ...(t.allowedDomains?.length ? { allowed_domains: t.allowedDomains.slice(0, 20) } : {}) }));
  const tools: unknown[] = [...fns, ...searchTool(WEB_SEARCH_TOOL)];
  if (tools.length) body.tools = tools;
  const tc = fns.length ? toToolChoice(req.toolChoice, names) : undefined;
  if (tc) body.tool_choice = tc;
  if (thinking) body.thinking = supportsThinkingDisplay(model) ? { type: 'adaptive', display: 'summarized' } : { type: 'adaptive' };
  else if (req.reasoningEffort === 'none' && thinksUnlessDisabled(model)) body.thinking = { type: 'disabled' };
  const outputConfig: Record<string, unknown> = {};
  if (req.reasoningEffort && req.reasoningEffort !== 'none' && supportsEffort(model)) outputConfig.effort = req.reasoningEffort;
  else if (req.reasoningEffort === 'none' && alwaysThinks(model)) outputConfig.effort = 'low';
  if (req.responseFormat?.type === 'json_schema') outputConfig.format = { type: 'json_schema', schema: req.responseFormat.schema };
  if (Object.keys(outputConfig).length) body.output_config = outputConfig;
  const headers: Record<string, string> = {};
  if (usesFallbackDefault(model)) {
    // Refusal fallbacks: on a policy decline the API re-runs the request on the recommended fallback model.
    headers['anthropic-beta'] = FALLBACK_BETA;
    body.fallbacks = 'default';
  }
  // No `temperature`: claude-opus-5 rejects it (oncloudnine providers/anthropic.ts), and thinking requires 1.

  let res: Response;
  try {
    res = await http.request('/messages', { json: body, headers, signal: req.signal, stream: true });
  } catch (err) {
    // An account or model without the newest web search tool: the stable version, once.
    if (!hosted.length || !(err instanceof ProviderError) || err.status !== 400 || !/web_search/i.test(err.message)) throw err;
    body.tools = [...fns, ...searchTool(WEB_SEARCH_TOOL_STABLE)];
    res = await http.request('/messages', { json: body, headers, signal: req.signal, stream: true });
  }

  const blocks = new Map<number, { type?: string; id?: string; name?: string; json: string; thinking: string; signature: string; data?: string }>();
  // Every block of the reply in its place, as sent, for an exact replay after tool results.
  const turn = new Map<number, Block>();
  let thought = false;
  const toolUseIds: string[] = [];
  let input = 0;
  let cached = 0;
  let output = 0;
  let stopReason = 'end_turn';
  let sawStop = false;
  let sawText = false;
  for await (const { event, data } of parseSSE(http.body(res), req.signal)) {
    let msg: AnthropicStreamEvent;
    try {
      msg = JSON.parse(data) as AnthropicStreamEvent;
    } catch {
      continue;
    }
    const type = msg.type || event;
    if (type === 'message_start') {
      const u = msg.message?.usage;
      cached = u?.cache_read_input_tokens ?? 0;
      input = (u?.input_tokens ?? 0) + cached + (u?.cache_creation_input_tokens ?? 0);
    } else if (type === 'content_block_start') {
      const cb = msg.content_block || {};
      blocks.set(msg.index ?? 0, { ...(cb.type ? { type: cb.type } : {}), ...(cb.id ? { id: cb.id } : {}), ...(cb.name ? { name: cb.name } : {}), json: '', thinking: cb.thinking ?? '', signature: cb.signature ?? '', ...(cb.data ? { data: cb.data } : {}) });
      turn.set(msg.index ?? 0, { ...(cb as Block) });
      if (cb.type === 'web_search_tool_result' && Array.isArray(cb.content)) {
        for (const r of cb.content as { type?: string; url?: string; title?: string }[]) if (r.type === 'web_search_result' && r.url) yield { type: 'citation', url: r.url, ...(r.title ? { title: r.title } : {}) };
      }
      if (cb.type === 'text' && cb.text) {
        sawText = true;
        yield { type: 'text', delta: cb.text };
      }
    } else if (type === 'content_block_delta') {
      const d = msg.delta || {};
      const block = blocks.get(msg.index ?? 0);
      const raw = turn.get(msg.index ?? 0);
      if (raw && d.type === 'text_delta' && d.text) raw.text = String(raw.text ?? '') + d.text;
      else if (raw && d.type === 'citations_delta' && d.citation) raw.citations = [...((raw.citations as unknown[]) ?? []), d.citation];
      if (d.type === 'text_delta' && d.text) {
        sawText = true;
        yield { type: 'text', delta: d.text };
      } else if (d.type === 'thinking_delta' && d.thinking) {
        if (block) block.thinking += d.thinking;
        yield { type: 'reasoning', delta: d.thinking };
      } else if (d.type === 'signature_delta' && d.signature) {
        if (block) block.signature += d.signature;
      } else if (d.type === 'input_json_delta') {
        if (block) block.json += d.partial_json || '';
      } else if (d.type === 'citations_delta' && d.citation?.url) {
        yield { type: 'citation', url: d.citation.url, ...(d.citation.title ? { title: d.citation.title } : {}) };
      }
    } else if (type === 'content_block_stop') {
      const block = blocks.get(msg.index ?? 0);
      const raw = turn.get(msg.index ?? 0);
      if (raw && block) {
        if (block.type === 'thinking') Object.assign(raw, { thinking: block.thinking, signature: block.signature });
        else if (block.type === 'tool_use' || block.type === 'server_tool_use') raw.input = argumentsObject(normalizeArguments(block.json || (raw.input ? JSON.stringify(raw.input) : '')));
        if (block.type === 'thinking' || block.type === 'redacted_thinking') thought = true;
      }
      if (block?.type === 'tool_use') {
        const id = block.id || callId('toolu');
        toolUseIds.push(id);
        yield { type: 'tool_call', id, name: names.local(block.name || ''), arguments: normalizeArguments(block.json) };
      }
    } else if (type === 'message_delta') {
      if (msg.delta?.stop_reason) stopReason = msg.delta.stop_reason;
      if (msg.usage?.output_tokens != null) output = msg.usage.output_tokens;
    } else if (type === 'message_stop') {
      sawStop = true;
    } else if (type === 'error') {
      const kind = msg.error?.type ?? '';
      const retryable = /overloaded|api_error|rate_limit/.test(kind);
      throw new ProviderError('anthropic', `${LABEL}: ${msg.error?.message || 'stream error'}`, 502, retryable, /rate_limit/.test(kind) ? 'rate_limited' : retryable ? 'upstream' : 'bad_request');
    }
  }
  // A stream that closes without message_stop was cut off; never report it as a complete reply.
  if (!sawStop) throw new ProviderError('anthropic', `${LABEL} stopped before the reply was complete. Try again.`, 502, true, 'incomplete');
  if (thought && toolUseIds.length) {
    const content = [...turn.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
    for (const id of toolUseIds) turnByToolUse.set(id, content);
  }
  const finish: FinishReason =
    stopReason === 'tool_use' ? 'tool_calls' : stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded' ? 'length' : stopReason === 'refusal' ? 'refusal' : stopReason === 'pause_turn' ? 'incomplete' : 'stop';
  if (finish === 'refusal' && !sawText) yield { type: 'text', delta: 'I cannot help with that.' };
  yield { type: 'usage', input, output, ...(cached ? { cached } : {}), ...NOT_PRICED };
  yield { type: 'done', finish };
}

export const createAnthropicProvider: ProviderFactory = (env, { fetch }) => {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  const http = new HttpClient({
    provider: 'anthropic',
    label: LABEL,
    keyName: 'ANTHROPIC_API_KEY',
    baseUrl: env.ANTHROPIC_BASE_URL?.trim() || BASE_URLS.anthropic,
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
    fetch,
    secrets: [key],
  });
  const chat: ChatProvider = {
    id: 'anthropic',
    kind: 'cloud',
    family: 'claude',
    hosted: ANTHROPIC_HOSTED,
    defaultModel: (tier) => CHAT_CATALOG.anthropic.defaults[normalizeTier(tier)],
    chat: (req) => guardStream('anthropic', LABEL, req.signal, () => anthropicChat(http, req, req.model || chat.defaultModel()), [key]),
  };
  return { chat };
};
