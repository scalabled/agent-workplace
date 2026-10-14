// Ported from oncloudnine/server/lib/agentRuntime.ts (runAgentLoop: step ceiling, argsError, wrap-up turn)
// and biz-bot/public/js/agent.js (runBotTurn: parallel tool calls, identical-failure guard, text across steps).
import { collectEvents, type ChatMessage, type ChatRequest, type ToolCall } from '@headcount/models';
import { lowerEffort } from './budget';
import type { AgentTool, CheckpointDirective, LoopEvent, RunTurnOptions, ToolOutcome, TurnResult } from './types';

export const DEFAULT_MAX_STEPS = 8;
export const HARD_MAX_STEPS = 24;
/**
 * Tool output longer than this is cut before it goes back to the model (ARCHITECTURE §4.1). The cut keeps the start
 * and the end, with a stub between them that says what was left out (`clipToolOutput`).
 */
export const TOOL_OUTPUT_LIMIT = 20_000;
/** An identical call (same tool, same arguments) that already failed this many times is not run again [BB]. */
export const IDENTICAL_FAILURE_LIMIT = 2;
/**
 * An identical call runs at most this many times per turn. A later repeat does not run: the model gets the earlier
 * successful result back with a note to use it or try something different.
 */
export const IDENTICAL_CALL_LIMIT = 2;
/**
 * After this many tool rounds in a row in which every call failed, the turn makes one tool-free wrap-up call and
 * ends as `stuck`, so a failing loop does not spend the whole step ceiling.
 */
export const STUCK_ROUND_LIMIT = 4;

const STUCK_NOTE = `Your last ${STUCK_ROUND_LIMIT} rounds of tool calls all failed. Do not call tools again in this turn. Say what you tried and what blocked you. Then give your best answer with what you have.`;

/**
 * One agent turn: call the model, run any tool calls (in parallel), feed results back, repeat until the
 * model stops or the step ceiling is hit (then one tool-free wrap-up call; the same after `STUCK_ROUND_LIMIT` failed
 * tool rounds in a row, which ends the turn as `stuck`). Between tool rounds the
 * optional `checkpoint` hook can inject steering or stop the turn. A call that spends its whole budget thinking
 * (ends `length` with nothing to show) is sent again once with more room and less effort. Never throws for model
 * or tool failures: they come back as `finish: 'error'` (with the partial text) or as tool error outcomes.
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
  const repeats = new Map<string, Repeat>();
  const texts: string[] = [];
  const citations = new Map<string, { url: string; title?: string }>();
  let steps = 0;
  let toolCalls = 0;
  let text = '';
  // The call budget; raised once (and for the rest of the turn) after a call that only thought.
  let maxTokens = opts.maxTokens;
  let reasoningEffort = opts.reasoningEffort;
  let budget = opts.budget;
  let lengthRetryLeft = opts.emptyLengthRetry !== false;
  let failedRounds = 0;
  let stuck = false;

  const addUsage = (u: TurnResult['usage']) => {
    usage.input += u.input;
    usage.output += u.output;
    usage.usd = usage.usd === null || u.usd === null ? null : usage.usd + u.usd;
  };
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
    citations: [...citations.values()],
    ...extra,
  });

  while (true) {
    if (signal.aborted) return result('cancelled');
    const wrapUp = stuck || steps >= maxSteps;
    steps++;
    emit({ type: 'step', step: steps, ...(wrapUp ? { wrapUp: true } : {}) });

    let collected;
    for (;;) {
      const req: ChatRequest = { system: opts.system, messages: [...transcript], signal };
      if (opts.model !== undefined) req.model = opts.model;
      if (specs.length) {
        req.tools = specs;
        // Wrap-up keeps the tool definitions (providers reject tool results without them) but forbids calls.
        if (wrapUp) req.toolChoice = 'none';
        else if (steps === 1 && opts.toolChoice !== undefined) req.toolChoice = opts.toolChoice;
      }
      if (opts.hostedTools?.length && !wrapUp) req.hostedTools = opts.hostedTools;
      if (maxTokens !== undefined) req.maxTokens = maxTokens;
      if (opts.temperature !== undefined) req.temperature = opts.temperature;
      if (reasoningEffort !== undefined) req.reasoningEffort = reasoningEffort;
      if (budget !== undefined) req.budget = budget;
      if (opts.responseFormat !== undefined) req.responseFormat = opts.responseFormat;

      try {
        collected = await collectEvents(opts.provider.chat(req), emit);
      } catch (err) {
        // Adapters should end with an `error` event, but a thrown stream is handled the same way.
        if (signal.aborted) return result('cancelled');
        return result('error', { error: { message: err instanceof Error ? err.message : String(err) } });
      }
      const onlyThought = !collected.error && collected.finish === 'length' && !collected.text.trim() && !collected.toolCalls.length;
      if (!onlyThought || !lengthRetryLeft || signal.aborted) break;
      // The model spent the whole budget thinking and produced nothing: once per turn, give it more room and
      // ask for less thinking, then send the same call again.
      lengthRetryLeft = false;
      addUsage(collected.usage);
      const override = opts.emptyLengthRetry || undefined;
      maxTokens = override?.maxTokens ?? (maxTokens !== undefined ? maxTokens * 2 : undefined);
      reasoningEffort = override?.reasoningEffort ?? lowerEffort(reasoningEffort);
      // A failover candidate re-sizes from the hint: it gets the same doubling and the same lower effort.
      if (budget) budget = { output: budget.output * 2, effort: override?.reasoningEffort ?? lowerEffort(budget.effort) };
      emit({ type: 'retry', step: steps, reason: 'empty_length', ...(maxTokens !== undefined ? { maxTokens } : {}), ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) });
    }
    addUsage(collected.usage);
    for (const c of collected.citations) if (!citations.has(c.url)) citations.set(c.url, c);
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
      // Reaching the wrap-up call means the step ceiling was hit [BB] or the turn is stuck: report that even if it answered.
      if (wrapUp) return result(stuck ? 'stuck' : 'length');
      return result(collected.finish === 'tool_calls' ? 'stop' : (collected.finish ?? 'incomplete'));
    }

    push({ role: 'assistant', content: collected.text, toolCalls: collected.toolCalls });
    const outcomes = await Promise.all(collected.toolCalls.map((call) => runTool(call, tools, repeats, steps, signal, emit)));
    toolCalls += collected.toolCalls.length;
    collected.toolCalls.forEach((call, i) => {
      const o = outcomes[i]!;
      push({ role: 'tool', toolCallId: call.id, name: call.name, content: clipToolOutput(o.ok ? o.content : (o.content ?? o.error)), ...(o.ok ? {} : { isError: true }) });
    });

    const ender = collected.toolCalls.find((_, i) => {
      const o = outcomes[i]!;
      return o.ok && o.endTurn;
    });
    if (ender) return result('stop', { endedBy: ender.name });
    if (signal.aborted) return result('cancelled');

    const notes: string[] = [];
    if (opts.checkpoint) {
      let directive: CheckpointDirective | void;
      try {
        directive = await opts.checkpoint({ step: steps, toolCalls, messages: transcript });
      } catch (err) {
        return result('error', { error: { message: err instanceof Error ? err.message : String(err), code: 'checkpoint' } });
      }
      notes.push(...(directive?.inject ?? []).map((s) => s.trim()).filter(Boolean));
      emit({ type: 'checkpoint', step: steps, injected: notes.length });
      if (directive?.stop) {
        if (notes.length) push({ role: 'user', content: notes.join('\n\n') });
        return result(directive.stop === 'cancelled' ? 'cancelled' : 'stop');
      }
    }
    failedRounds = outcomes.every((o) => !o.ok) ? failedRounds + 1 : 0;
    if (failedRounds >= STUCK_ROUND_LIMIT) {
      stuck = true;
      notes.push(STUCK_NOTE);
    }
    // One user message: some providers reject two in a row.
    if (notes.length) push({ role: 'user', content: notes.join('\n\n') });
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

/** What the turn has seen of one signature (tool name plus arguments). */
interface Repeat {
  calls: number;
  failures: number;
  /** Content of the latest successful run. */
  ok?: string;
}

async function runTool(
  call: ToolCall,
  tools: Map<string, AgentTool<any>>,
  repeats: Map<string, Repeat>,
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
  const seen = repeats.get(signature) ?? { calls: 0, failures: 0 };
  repeats.set(signature, seen);
  seen.calls++;
  if (seen.calls > IDENTICAL_CALL_LIMIT && seen.ok !== undefined) {
    const note = `[You already called ${call.name} with these arguments, and this is the earlier result. Use it, or try something different.]`;
    return end({ ok: true, content: `${note}\n\n${seen.ok}`, summary: 'repeated call' });
  }
  if (seen.failures >= IDENTICAL_FAILURE_LIMIT) {
    return end({ ok: false, error: 'This identical tool call has already failed twice. Change the inputs, try another approach, or report the blocker.' }, 'repeated failure');
  }
  if (signal.aborted) return end({ ok: false, error: 'Cancelled before the tool ran.' }, 'cancelled');

  let outcome: ToolOutcome;
  try {
    outcome = await tool.execute(args as Record<string, unknown>, { callId: call.id, step, signal });
  } catch (err) {
    outcome = { ok: false, error: `The tool failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (outcome.ok) {
    seen.failures = 0;
    seen.ok = outcome.content;
  } else seen.failures++;
  return end(outcome, outcome.ok ? undefined : 'failed');
}

/**
 * Long tool output keeps its start and its end; a stub line between them says what was left out. The cuts move to
 * a line break when one is close, so neither part ends or starts mid-line.
 */
export function clipToolOutput(s: string, limit = TOOL_OUTPUT_LIMIT): string {
  if (s.length <= limit) return s;
  const headMax = Math.floor(limit * 0.7);
  const tailMax = limit - headMax;
  let head = headMax;
  const headBreak = s.lastIndexOf('\n', headMax);
  if (headBreak >= headMax * 0.8) head = headBreak;
  let tail = s.length - tailMax;
  const tailBreak = s.indexOf('\n', tail - 1);
  if (tailBreak >= 0 && tailBreak < tail + tailMax * 0.2) tail = tailBreak + 1;
  const cut = s.slice(head, tail);
  const lines = Math.max(1, cut.split('\n').length - (cut.startsWith('\n') ? 1 : 0) - (cut.endsWith('\n') ? 1 : 0));
  const stub = `[tool output elided: ${lines} ${lines === 1 ? 'line' : 'lines'} / ${cut.length} chars. Narrow the call to see that part.]`;
  return `${s.slice(0, head)}\n${stub}\n${s.slice(tail)}`;
}
