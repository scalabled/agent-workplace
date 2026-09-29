// Ported from biz-bot/worker/src/providers/responses.js — the Responses API dialect OpenAI and xAI share:
// neutral messages → `input` items, and the SSE event stream → ModelEvents, with completion enforcement
// (a stream without response.completed is an error, never a short answer).
import { ProviderError } from '../errors';
import { parseSSE } from '../lib/sse';
import { ToolNames, callId, normalizeArguments, objectSchema } from '../lib/tools';
import type { ChatMessage, ChatRequest, FinishReason, ModelEvent, ProviderId, ToolSpec } from '../types';
import { NOT_PRICED } from './common';

export function toInputItems(messages: ChatMessage[], names: ToolNames): unknown[] {
  const items: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (m.content.trim()) items.push({ role: 'assistant', content: [{ type: 'output_text', text: m.content }] });
      for (const tc of m.toolCalls ?? []) items.push({ type: 'function_call', call_id: tc.id, name: names.wire(tc.name), arguments: tc.arguments || '{}' });
      continue;
    }
    if (m.role === 'tool') {
      items.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.isError ? `Error: ${m.content}` : m.content });
      continue;
    }
    items.push({ role: 'user', content: [...(m.images ?? []).map((im) => ({ type: 'input_image', image_url: `data:${im.mime};base64,${im.data}` })), { type: 'input_text', text: m.content || ' ' }] });
  }
  return items;
}

export function toResponsesTools(tools: ToolSpec[] | undefined, names: ToolNames): unknown[] {
  return (tools ?? []).map((t) => ({ type: 'function', name: names.wire(t.name), description: t.description || '', parameters: objectSchema(t.parameters), strict: false }));
}

export function toResponsesToolChoice(choice: ChatRequest['toolChoice'], names: ToolNames): unknown {
  if (!choice || choice === 'auto') return undefined;
  if (choice === 'none' || choice === 'required') return choice;
  return { type: 'function', name: names.wire(choice.name) };
}

interface ResponsesEvent {
  type?: string;
  delta?: string;
  text?: string;
  item_id?: string;
  output_index?: number;
  content_index?: number;
  arguments?: string;
  part?: { type?: string; text?: string; refusal?: string };
  item?: ResponsesItem;
  annotation?: { type?: string; url?: string; title?: string };
  response?: {
    status?: string;
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    incomplete_details?: { reason?: string };
    error?: { message?: string; code?: string };
    output?: ResponsesItem[];
    citations?: unknown[];
  };
  message?: string;
  code?: string;
  error?: { message?: string; code?: string };
}

interface ResponsesItem {
  id?: string;
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type?: string; text?: string; refusal?: string; annotations?: { type?: string; url?: string; title?: string }[] }[];
  action?: { sources?: { url?: string; title?: string }[] };
  error?: unknown;
}

/**
 * Parse a Responses SSE stream into ModelEvents: text deltas (with final-only text recovered and duplicated
 * parts never emitted twice), reasoning summaries, url citations, function calls, refusals and usage.
 */
export async function* parseResponsesStream(body: ReadableStream<Uint8Array>, provider: ProviderId, label: string, names: ToolNames, signal?: AbortSignal): AsyncGenerator<ModelEvent> {
  let finish: FinishReason = 'stop';
  const calls = new Map<string, { call_id?: string; name?: string; arguments: string }>();
  const emittedCalls = new Set<string>();
  const toolCall = (callIdValue: string | undefined, name: string, args: unknown): ModelEvent => {
    const id = callIdValue || callId();
    emittedCalls.add(id);
    finish = 'tool_calls';
    return { type: 'tool_call', id, name: names.local(name), arguments: normalizeArguments(args) };
  };
  let usage: { input: number; output: number; cached?: number } | null = null;
  let completed = false;
  let sawText = false;
  const textParts = new Map<string, string>();
  const outputIds = new Map<number, string>();
  const seenCitations = new Set<string>();
  let tail = '';
  let toolSinceText = false;

  const partKey = (ev: { item_id?: string; output_index?: number; content_index?: number }, item: { id?: string } = {}, contentIndex = ev.content_index ?? 0) => {
    const id = ev.item_id || item.id || (ev.output_index !== undefined ? outputIds.get(ev.output_index) : undefined);
    const fallback = `#${ev.output_index ?? 0}:${contentIndex}`;
    const key = id ? `${id}:${contentIndex}` : fallback;
    if (id && ev.output_index != null) {
      outputIds.set(ev.output_index, id);
      if (!textParts.has(key) && textParts.has(fallback)) {
        textParts.set(key, textParts.get(fallback)!);
        textParts.delete(fallback);
      }
    }
    return key;
  };
  const emitText = (delta: string): ModelEvent => {
    sawText = true;
    toolSinceText = false;
    tail = (tail + delta).slice(-4);
    return { type: 'text', delta };
  };
  // Grok's agentic mode streams narration bursts between server-side searches with no whitespace between them.
  const needsBreak = (delta: string) => sawText && !/\s$/.test(tail) && ((toolSinceText && /^\S/.test(delta)) || (/[.!?:]$/.test(tail) && /^[A-Z][a-z]/.test(delta)));
  const separator = (): ModelEvent | null => (sawText && !/\n\n$/.test(tail) ? emitText(/\n$/.test(tail) ? '\n' : '\n\n') : null);
  const citation = (url: string | undefined, title?: string): ModelEvent | null => {
    if (!url || seenCitations.has(url)) return null;
    seenCitations.add(url);
    return { type: 'citation', url, ...(title && !/^\d+$/.test(title) ? { title } : {}) };
  };
  function* completeText(ev: { item_id?: string; output_index?: number; content_index?: number }, item: { id?: string }, part: { type?: string; text?: string }, index: number): Generator<ModelEvent> {
    if (part.type !== 'output_text' || !part.text) return;
    const key = partKey(ev, item, index);
    const previous = textParts.get(key) || '';
    if (!part.text.startsWith(previous)) throw new ProviderError(provider, `${label} sent inconsistent streamed output. Try again.`, 502, true, 'incomplete');
    const remaining = part.text.slice(previous.length);
    if (remaining) {
      if (!previous) {
        const sep = separator();
        if (sep) yield sep;
      }
      yield emitText(remaining);
    }
    textParts.set(key, part.text);
  }

  for await (const { data } of parseSSE(body, signal)) {
    if (data === '[DONE]') break;
    let ev: ResponsesEvent;
    try {
      ev = JSON.parse(data) as ResponsesEvent;
    } catch {
      continue;
    }
    if (!ev?.type) continue;
    switch (ev.type) {
      case 'response.output_text.delta':
        if (ev.delta) {
          const key = partKey(ev);
          textParts.set(key, (textParts.get(key) || '') + ev.delta);
          if (needsBreak(ev.delta)) yield emitText('\n\n');
          yield emitText(ev.delta);
        }
        break;
      case 'response.output_text.done':
        yield* completeText(ev, {}, { type: 'output_text', ...(ev.text !== undefined ? { text: ev.text } : {}) }, ev.content_index ?? 0);
        break;
      case 'response.content_part.done':
        yield* completeText(ev, {}, ev.part || {}, ev.content_index ?? 0);
        break;
      case 'response.content_part.added':
        if ((ev.part?.type || 'output_text') === 'output_text') {
          const sep = separator();
          if (sep) yield sep;
        }
        break;
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        if (ev.delta) yield { type: 'reasoning', delta: ev.delta };
        break;
      case 'response.reasoning_summary_part.done':
      case 'response.reasoning_summary_text.done':
        yield { type: 'reasoning', delta: '\n\n' };
        break;
      case 'response.output_text.annotation.added': {
        const a = ev.annotation || {};
        if (a.type === 'url_citation') {
          const c = citation(a.url, a.title);
          if (c) yield c;
        }
        break;
      }
      case 'response.output_item.added': {
        const item = ev.item || {};
        partKey(ev, item);
        if (item.type === 'function_call') calls.set(item.id || item.call_id || '', { ...(item.call_id ? { call_id: item.call_id } : {}), ...(item.name ? { name: item.name } : {}), arguments: item.arguments || '' });
        if (sawText && item.type && item.type !== 'message') toolSinceText = true;
        if (item.type === 'message') {
          const sep = separator();
          if (sep) yield sep;
        }
        break;
      }
      case 'response.function_call_arguments.delta': {
        const c = calls.get(ev.item_id || '');
        if (c) c.arguments += ev.delta || '';
        break;
      }
      case 'response.function_call_arguments.done': {
        const c = calls.get(ev.item_id || '');
        if (c && ev.arguments) c.arguments = ev.arguments;
        break;
      }
      case 'response.output_item.done': {
        const item = ev.item || {};
        if (item.type === 'function_call') {
          const key = item.id || item.call_id || '';
          const c = calls.get(key);
          calls.delete(key);
          const name = item.name || c?.name;
          const id = item.call_id || c?.call_id;
          if (name && !(id && emittedCalls.has(id))) yield toolCall(id, name, item.arguments || c?.arguments);
        } else if (item.type === 'web_search_call' || item.type === 'x_search_call') {
          for (const s of item.action?.sources || []) {
            const c = citation(s.url, s.title);
            if (c) yield c;
          }
        } else if (item.type === 'message') {
          for (const [index, part] of (item.content || []).entries()) {
            if (part.type === 'refusal') {
              yield emitText(`${sawText ? '\n\n' : ''}${part.refusal || 'I cannot help with that.'}`);
              finish = 'refusal';
            }
            for (const a of part.annotations || []) {
              if (a.type !== 'url_citation') continue;
              const c = citation(a.url, a.title);
              if (c) yield c;
            }
            // Some servers only send the full text on item.done (no deltas): surface it.
            yield* completeText(ev, item, part, index);
          }
        }
        break;
      }
      case 'response.completed':
      case 'response.incomplete': {
        const r = ev.response || {};
        completed = true;
        if (r.usage) {
          usage = { input: r.usage.input_tokens ?? 0, output: r.usage.output_tokens ?? 0 };
          const cached = r.usage.input_tokens_details?.cached_tokens;
          if (cached != null) usage.cached = cached;
        }
        if (ev.type === 'response.incomplete' || r.status === 'incomplete') finish = r.incomplete_details?.reason === 'max_output_tokens' ? 'length' : 'incomplete';
        for (const url of r.citations || []) {
          if (typeof url === 'string' && /^https?:/.test(url)) {
            const c = citation(url);
            if (c) yield c;
          }
        }
        // Recover each missing part, even when an earlier item streamed normally; and any function call
        // that only appears in the completed payload.
        for (const [outputIndex, item] of (r.output || []).entries()) {
          if (item.type === 'function_call' && item.name && !(item.call_id && emittedCalls.has(item.call_id))) {
            calls.delete(item.id || item.call_id || '');
            yield toolCall(item.call_id, item.name, item.arguments);
          }
          if (item.type !== 'message') continue;
          for (const [index, part] of (item.content || []).entries()) {
            yield* completeText({ output_index: outputIndex }, item, part, index);
            if (part.type === 'refusal') finish = 'refusal';
          }
        }
        break;
      }
      case 'response.failed': {
        const err = ev.response?.error;
        const retryable = /server_error|rate_limit|overloaded/i.test(err?.code ?? '');
        throw new ProviderError(provider, `${label}: ${err?.message || 'the response failed'}`, 502, retryable, retryable ? 'upstream' : 'bad_request');
      }
      case 'error': {
        const msg = ev.message || ev.error?.message || 'stream error';
        const retryable = /server_error|rate_limit|overloaded/i.test(ev.code ?? ev.error?.code ?? '');
        throw new ProviderError(provider, `${label}: ${msg}`, 502, retryable, retryable ? 'upstream' : 'bad_request');
      }
      default:
        break;
    }
  }
  if (!completed) throw new ProviderError(provider, `${label} stopped before the reply was complete. Try again.`, 502, true, 'incomplete');
  // A function call that never got its output_item.done still counts.
  for (const c of calls.values()) if (c.name && !(c.call_id && emittedCalls.has(c.call_id))) yield toolCall(c.call_id, c.name, c.arguments);
  if (usage) yield { type: 'usage', ...usage, ...NOT_PRICED };
  yield { type: 'done', finish };
}
