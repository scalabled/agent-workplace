// Tool-call normalisation across the four dialects (ARCHITECTURE §4.1): Anthropic `tool_use`, Responses
// `function_call` (OpenAI, xAI), compatible `tool_calls` (OpenAI-compatible, Ollama) and Gemini `functionCall`.
// Every dialect ends up as {type:'tool_call', id, name, arguments: JSON string}.
import type { ChatMessage, JsonSchema, ToolCall, ToolSpec } from '../types';

/** What every provider accepts as a function name. */
export const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Per-request mapping between our tool names and provider-safe wire names. Names that are already valid
 * pass through unchanged (the common case); others (e.g. MCP `server.tool`) get a sanitised, de-duplicated
 * wire name that maps back exactly. After oncloudnine/server/mcp/schema.ts toolWireName/toolNameFromWire.
 */
export class ToolNames {
  private toWireMap = new Map<string, string>();
  private fromWireMap = new Map<string, string>();

  constructor(names: Iterable<string>) {
    for (const n of names) this.wire(n);
  }

  wire(name: string): string {
    const known = this.toWireMap.get(name);
    if (known) return known;
    let w = TOOL_NAME_RE.test(name) ? name : name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'tool';
    for (let i = 2; this.fromWireMap.has(w) && this.fromWireMap.get(w) !== name; i++) w = `${w.slice(0, 60)}_${i}`;
    this.toWireMap.set(name, w);
    this.fromWireMap.set(w, name);
    return w;
  }

  local(wire: string): string {
    return this.fromWireMap.get(wire) ?? wire;
  }

  /** Names seen in the tools list and in earlier tool calls of the transcript. */
  static forRequest(tools: ToolSpec[] | undefined, messages: ChatMessage[]): ToolNames {
    const names: string[] = (tools ?? []).map((t) => t.name);
    for (const m of messages) {
      if (m.role === 'assistant') for (const c of m.toolCalls ?? []) names.push(c.name);
      if (m.role === 'tool') names.push(m.name);
    }
    return new ToolNames(names);
  }
}

/** Arguments as a JSON string: objects are serialised, empty input is `{}`, strings pass through untouched. */
export function normalizeArguments(args: unknown): string {
  if (args === undefined || args === null) return '{}';
  if (typeof args === 'string') return args.trim() === '' ? '{}' : args;
  try {
    return JSON.stringify(args);
  } catch {
    return '{}';
  }
}

/** Parse arguments for dialects that want an object (Anthropic `input`, Ollama, Gemini `args`). */
export function argumentsObject(args: string): Record<string, unknown> {
  try {
    const v = JSON.parse(args || '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { _raw: args };
  }
}

/** Random call id for dialects that do not give one (Ollama, Gemini). */
export function callId(prefix = 'call'): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Chat Completions streams tool calls as fragments keyed by `index` (id and name arrive once, arguments in
 * pieces). Collect them and emit complete calls at the end of the stream.
 */
export class IndexedToolCalls {
  private slots = new Map<number, { id: string; name: string; arguments: string }>();

  add(fragment: { index?: number; id?: string; function?: { name?: string; arguments?: unknown } }): void {
    const index = typeof fragment.index === 'number' ? fragment.index : this.slots.size;
    const slot = this.slots.get(index) ?? { id: '', name: '', arguments: '' };
    if (fragment.id) slot.id = fragment.id;
    if (fragment.function?.name) slot.name += fragment.function.name;
    const a = fragment.function?.arguments;
    if (typeof a === 'string') slot.arguments += a;
    else if (a !== undefined && a !== null) slot.arguments = normalizeArguments(a);
    this.slots.set(index, slot);
  }

  get size(): number {
    return this.slots.size;
  }

  drain(names?: ToolNames): ToolCall[] {
    const out = [...this.slots.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, s]) => s.name)
      .map(([, s]) => ({ id: s.id || callId(), name: names ? names.local(s.name) : s.name, arguments: normalizeArguments(s.arguments) }));
    this.slots.clear();
    return out;
  }
}

/** Parameters schema with a guaranteed object root (providers reject anything else). */
export function objectSchema(schema: JsonSchema | undefined): JsonSchema {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  if (schema.type === 'object' || schema.properties) return { ...schema, type: 'object', properties: schema.properties ?? {} };
  return { type: 'object', properties: {} };
}
