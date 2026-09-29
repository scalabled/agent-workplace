import { modelFlags } from './model-catalog';
import type { BudgetHint, ChatProvider, ChatRequest, ReasoningEffort } from './types';

/**
 * Room to think, per reasoning effort, added on top of a call's visible output. It is a ceiling, not a spend:
 * the effort decides how much the model actually thinks. Reasoning models count their thinking against the
 * same cap as their answer (Anthropic adaptive thinking against `max_tokens`, OpenAI and xAI reasoning against
 * `max_output_tokens`, Gemini thoughts against `maxOutputTokens`), so an output-only cap can be spent entirely
 * on thinking and return nothing ("The model returned an empty step.").
 */
export const REASONING_ALLOWANCE: Readonly<Record<Exclude<ReasoningEffort, 'none'>, number>> = { low: 4000, medium: 8000, high: 16000 };

export interface CallBudget {
  maxTokens: number;
  /** Only set for cloud models that reason: an explicit effort, never the provider's default. */
  reasoningEffort?: ReasoningEffort;
  /** What the call was sized from: a failover chain re-sizes it for the provider that actually answers. */
  budget: BudgetHint;
}

/**
 * Size one model call: `output` visible tokens (text and tool arguments) plus room to think at `effort`.
 * - Mock and local providers get the output budget only and no effort: Ollama thinks only when an effort is
 *   set (qwen3's thinking pass costs seconds per turn), so local work keeps thinking off.
 * - Cloud models the catalog marks as reasoning get the effort and the allowance ('none' still gets the low
 *   allowance: some models cannot switch thinking off and treat 'none' as their lowest effort).
 * - Cloud models the catalog does not know (an OpenAI-compatible gateway, a pinned model id) get the output
 *   budget only: many cap output well below `output + allowance` (a 400), and a call that spends it all thinking
 *   is sent again with twice the room by `runTurn`.
 * - Models that do not reason get the output budget only.
 */
export function callBudget(provider: Pick<ChatProvider, 'id' | 'kind'>, model: string | undefined, output: number, effort: ReasoningEffort): CallBudget {
  const budget: BudgetHint = { output, effort };
  if (provider.kind === 'mock' || provider.kind === 'local') return { maxTokens: output, budget };
  const flags = model ? modelFlags(provider.id, model) : null;
  if (!flags || !flags.includes('reasoning')) return { maxTokens: output, budget };
  return { maxTokens: output + REASONING_ALLOWANCE[effort === 'none' ? 'low' : effort], reasoningEffort: effort, budget };
}

/**
 * A request sized for one provider, re-sized for another (a failover candidate): from its `budget` hint when it
 * has one, else at least never switching a local model's thinking on.
 */
export function resizeRequest(req: ChatRequest, provider: Pick<ChatProvider, 'id' | 'kind'>, model: string): ChatRequest {
  const { maxTokens, reasoningEffort: _effort, ...rest } = req;
  if (req.budget) {
    const sized = callBudget(provider, model, req.budget.output, req.budget.effort);
    return { ...rest, model, maxTokens: sized.maxTokens, ...(sized.reasoningEffort !== undefined ? { reasoningEffort: sized.reasoningEffort } : {}) };
  }
  if (provider.kind === 'local' || provider.kind === 'mock') return { ...rest, model, ...(maxTokens !== undefined ? { maxTokens } : {}) };
  return { ...req, model };
}
