import type { BudgetHint, ChatMessage, ChatProvider, ChatRequest, FinishReason, ModelEvent, ReasoningEffort, ToolSpec } from '@headcount/models';

/** Outcome of one tool execution, returned to the model as a `tool` message. */
export type ToolOutcome =
  | {
      ok: true;
      content: string;
      summary?: string;
      /**
       * End the turn after this tool round without another model call (a submit/hand-off tool whose
       * arguments are the result). The turn finishes with `stop`.
       */
      endTurn?: boolean;
    }
  | { ok: false; error: string; content?: string };

export interface ToolContext {
  callId: string;
  step: number;
  signal: AbortSignal;
}

/** A tool the loop may call: its spec (sent to the model) plus the in-process executor. */
export interface AgentTool<Args = Record<string, unknown>> {
  spec: ToolSpec;
  execute(args: Args, ctx: ToolContext): Promise<ToolOutcome>;
}

/** Everything the loop reports while it runs: provider events plus loop bookkeeping. */
export type LoopEvent =
  | ModelEvent
  | { type: 'step'; step: number; wrapUp?: boolean }
  | { type: 'tool_start'; callId: string; name: string; args: unknown }
  | { type: 'tool_end'; callId: string; name: string; ok: boolean; summary?: string; durationMs: number }
  | { type: 'checkpoint'; step: number; injected: number }
  /**
   * A model call spent its whole budget thinking and ended `length` with no text and no tool call; it is sent
   * again once with this budget (see `RunTurnOptions.emptyLengthRetry`).
   */
  | { type: 'retry'; step: number; reason: 'empty_length'; maxTokens?: number; reasoningEffort?: ReasoningEffort };

/** What the loop passes to `checkpoint` after each tool round, before the next model call. */
export interface CheckpointInfo {
  /** Model calls made so far. */
  step: number;
  /** Tool calls executed so far in this turn. */
  toolCalls: number;
  /** The transcript as the next model call will see it (read-only). */
  messages: readonly ChatMessage[];
}

/**
 * A safe checkpoint's answer (OWNER-DIRECTIVES D2: steering lands between steps or tool calls).
 * - `inject`: notes added to the transcript as one user message before the next model call (e.g. owner steering).
 * - `stop: 'cancelled'` ends the turn as cancelled; `stop: 'done'` ends it with `stop` and the text so far.
 */
export interface CheckpointDirective {
  inject?: string[];
  stop?: 'done' | 'cancelled';
}

export interface RunTurnOptions {
  provider: ChatProvider;
  model?: string;
  system: string;
  /** Transcript so far, ending with the new user message. Not mutated. */
  messages: ChatMessage[];
  tools?: AgentTool<any>[];
  onEvent?: (event: LoopEvent) => void;
  /** Carries cancel, deadline and budget (ARCHITECTURE §4.1). */
  signal?: AbortSignal;
  /** Model calls with tools before one tool-free wrap-up call. Default 8, hard max 24. */
  maxSteps?: number;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  /** What `maxTokens`/`reasoningEffort` were sized from (`callBudget`), passed on so a failover re-sizes the call. */
  budget?: BudgetHint;
  /** Tool choice for the FIRST model call only (e.g. force a submit tool); later calls use the provider default. */
  toolChoice?: ChatRequest['toolChoice'];
  /** Structured output for every model call of the turn. */
  responseFormat?: ChatRequest['responseFormat'];
  /**
   * A call that ends `length` with no text and no tool call (a reasoning model spent `maxTokens` thinking) is
   * sent again once per turn, by default with `maxTokens` doubled and the effort one notch lower
   * (`lowerEffort`); the raised budget then holds for the rest of the turn. Pass values to override the retry
   * budget, or `false` to return the empty `length` result instead.
   */
  emptyLengthRetry?: false | { maxTokens?: number; reasoningEffort?: ReasoningEffort };
  /** Called after every tool round, before the next model call: apply steering, check fences. */
  checkpoint?: (info: CheckpointInfo) => CheckpointDirective | void | Promise<CheckpointDirective | void>;
}

export interface TurnResult {
  /** Final assistant text (the last model call's text). */
  text: string;
  /** Every assistant text of the turn, joined with blank lines (what a streaming UI showed). */
  fullText: string;
  finish: FinishReason | 'error';
  /** Transcript entries produced during this turn (assistant/tool/injected user messages), in order. */
  messages: ChatMessage[];
  usage: { input: number; output: number; usd: number | null };
  /** Model calls made. */
  steps: number;
  toolCalls: number;
  /** Name of the tool whose outcome ended the turn (`endTurn`), if any. */
  endedBy?: string;
  error?: { message: string; code?: string; retryable?: boolean };
}
