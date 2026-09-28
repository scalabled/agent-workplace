// Ported from oncloudnine/server/lib/agentRuntime.ts (runAgentLoop: step ceiling, argsError, wrap-up turn)
// and biz-bot/public/js/agent.js (runBotTurn: parallel tool calls, identical-failure guard, text across steps).
import { collectEvents, type ChatMessage, type ChatRequest, type ToolCall } from '@headcount/models';
import type { AgentTool, CheckpointDirective, LoopEvent, RunTurnOptions, ToolOutcome, TurnResult } from './types';

export const DEFAULT_MAX_STEPS = 8;
export const HARD_MAX_STEPS = 24;
/** Tool output longer than this is cut before it goes back to the model (ARCHITECTURE §4.1). */
export const TOOL_OUTPUT_LIMIT = 20_000;
/** An identical call (same tool, same arguments) that already failed this many times is not run again [BB]. */
export const IDENTICAL_FAILURE_LIMIT = 2;

/**
 * One agent turn: call the model, run any tool calls (in parallel), feed results back, repeat until the
 * model stops or the step ceiling is hit (then one tool-free wrap-up call). Between tool rounds the
 * optional `checkpoint` hook can inject steering or stop the turn. Never throws for model or tool
 * failures: they come back as `finish: 'error'` (with the partial text) or as tool error outcomes.
 */
export async function runTurn(opts: RunTurnOptions): Promise<TurnResult> {
  const maxSteps = Math.min(Math.max(1, Math.floor(opts.maxSteps ?? DEFAULT_MAX_STEPS)), HARD_MAX_STEPS);
  const signal = opts.signal ?? new AbortController().signal;
  const emit = (e: LoopEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      /* a listener must not break the loop */
    }
  };
  const tools = new Map<string, AgentTool<any>>((opts.tools ?? []).map((t) => [t.spec.name, t]));
  const specs = [...tools.values()].map((t) => t.spec);
  const transcript: ChatMessage[] = [...opts.messages];
  const produced: ChatMessage[] = [];
  const usage: TurnResult['usage'] = { input: 0, output: 0, usd: 0 };
  const failures = new Map<string, number>();
  const texts: string[] = [];
  let steps = 0;
  let toolCalls = 0;
  let text = '';

  const push = (m: ChatMessage) => {
    transcript.push(m);
    produced.push(m);
  };
  const result = (finish: TurnResult['finish'], extra: Partial<TurnResult> = {}): TurnResult => ({
    text,
    fullText: texts.filter((t) => t.trim()).join('\n\n'),
    finish,
    messages: produced,
    usage,
    steps,
    toolCalls,
    ...extra,
  });

  while (true) {
    if (signal.aborted) return result('cancelled');
    const wrapUp = steps >= maxSteps;
    steps++;
    emit({ type: 'step', step: steps, ...(wrapUp ? { wrapUp: true } : {}) });

    const req: ChatRequest = { system: opts.system, messages: [...transcript], signal };
    if (opts.model !== undefined) req.model = opts.model;
    if (specs.length) {
      req.tools = specs;
      // Wrap-up keeps the tool definitions (providers reject tool results without them) but forbids calls.
      if (wrapUp) req.toolChoice = 'none';
      else if (steps === 1 && opts.toolChoice !== undefined) req.toolChoice = opts.toolChoice;
    }
    if (opts.maxTokens !== undefined) req.maxTokens = opts.maxTokens;
    if (opts.temperature !== undefined) req.temperature = opts.temperature;
    if (opts.reasoningEffort !== undefined) req.reasoningEffort = opts.reasoningEffort;
    if (opts.responseFormat !== undefined) req.responseFormat = opts.responseFormat;

    let collected;
    try {
      collected = await collectEvents(opts.provider.chat(req), emit);
    } catch (err) {
      // Adapters should end with an `error` event, but a thrown stream is handled the same way.
      if (signal.aborted) return result('cancelled');
      return result('error', { error: { message: err instanceof Error ? err.message : String(err) } });
    }
    usage.input += collected.usage.input;
    usage.output += collected.usage.output;
    usage.usd = usage.usd === null || collected.usage.usd === null ? null : usage.usd + collected.usage.usd;
    text = collected.text;
    if (collected.text) texts.push(collected.text);

    if (collected.error) {
      if (signal.aborted) return result('cancelled');
      const e = collected.error;
      return result('error', {
        error: { message: e.message, ...(e.code !== undefined ? { code: e.code } : {}), ...(e.retryable !== undefined ? { retryable: e.retryable } : {}) },
      });
    }
    if (collected.finish === 'cancelled' || signal.aborted) {
      if (collected.text) push({ role: 'assistant', content: collected.text });
      return result('cancelled');
    }

    if (!collected.toolCalls.length || wrapUp) {
      push({ role: 'assistant', content: collected.text });
      // Reaching the wrap-up call means the step ceiling was hit [BB]: report `length` even if it answered.
      if (wrapUp) return result('length');
      return result(collected.finish === 'tool_calls' ? 'stop' : (collected.finish ?? 'incomplete'));
    }

    push({ role: 'assistant', content: collected.text, toolCalls: collected.toolCalls });
    const outcomes = await Promise.all(collected.toolCalls.map((call) => runTool(call, tools, failures, steps, signal, emit)));
    toolCalls += collected.toolCalls.length;
    collected.toolCalls.forEach((call, i) => {
      const o = outcomes[i]!;
      push({ role: 'tool', toolCallId: call.id, name: call.name, content: clip(o.ok ? o.content : (o.content ?? o.error)), ...(o.ok ? {} : { isError: true }) });
    });

    const ender = collected.toolCalls.find((_, i) => {
      const o = outcomes[i]!;
      return o.ok && o.endTurn;
    });
    if (ender) return result('stop', { endedBy: ender.name });
    if (signal.aborted) return result('cancelled');

    if (opts.checkpoint) {
      let directive: CheckpointDirective | void;
      try {
        directive = await opts.checkpoint({ step: steps, toolCalls, messages: transcript });
      } catch (err) {
        return result('error', { error: { message: err instanceof Error ? err.message : String(err), code: 'checkpoint' } });
      }
      const notes = (directive?.inject ?? []).map((s) => s.trim()).filter(Boolean);
      if (notes.length) push({ role: 'user', content: notes.join('\n\n') });
      emit({ type: 'checkpoint', step: steps, injected: notes.length });
      if (directive?.stop === 'cancelled') return result('cancelled');
      if (directive?.stop === 'done') return result('stop');
    }
  }
}

function signatureOf(name: string, args: unknown): string {
  return `${name}:${stableJson(args)}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`;
}

async function runTool(
  call: ToolCall,
  tools: Map<string, AgentTool<any>>,
  failures: Map<string, number>,
  step: number,
  signal: AbortSignal,
  emit: (e: LoopEvent) => void,
): Promise<ToolOutcome> {
  const started = Date.now();
  const end = (o: ToolOutcome, summary?: string): ToolOutcome => {
    const s = o.ok ? o.summary : summary;
    emit({ type: 'tool_end', callId: call.id, name: call.name, ok: o.ok, ...(s ? { summary: s } : {}), durationMs: Date.now() - started });
    return o;
  };

  let args: unknown;
  try {
    args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('not an object');
  } catch {
    emit({ type: 'tool_start', callId: call.id, name: call.name, args: call.arguments });
    return end({ ok: false, error: JSON.stringify({ argsError: `Arguments for ${call.name} were not a valid JSON object. Send the arguments as a JSON object matching the tool's schema.` }) }, 'invalid arguments');
  }
  emit({ type: 'tool_start', callId: call.id, name: call.name, args });

  const tool = tools.get(call.name);
  if (!tool) return end({ ok: false, error: `There is no tool called "${call.name}". Available tools: ${[...tools.keys()].join(', ') || 'none'}.` }, 'unknown tool');

  const signature = signatureOf(call.name, args);
  if ((failures.get(signature) ?? 0) >= IDENTICAL_FAILURE_LIMIT) {
    return end({ ok: false, error: 'This identical tool call has already failed twice. Change the inputs, try another approach, or report the blocker.' }, 'repeated failure');
  }
  if (signal.aborted) return end({ ok: false, error: 'Cancelled before the tool ran.' }, 'cancelled');

  let outcome: ToolOutcome;
  try {
    outcome = await tool.execute(args as Record<string, unknown>, { callId: call.id, step, signal });
  } catch (err) {
    outcome = { ok: false, error: `The tool failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  failures.set(signature, outcome.ok ? 0 : (failures.get(signature) ?? 0) + 1);
  return end(outcome, outcome.ok ? undefined : 'failed');
}

function clip(s: string): string {
  return s.length > TOOL_OUTPUT_LIMIT ? `${s.slice(0, TOOL_OUTPUT_LIMIT)}\n…[truncated ${s.length - TOOL_OUTPUT_LIMIT} characters]` : s;
}
