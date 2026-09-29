import type { ReasoningEffort } from '@headcount/models';

// Call sizing lives in @headcount/models (the failover chain re-sizes calls per candidate); re-exported here for
// the loop's callers.
export { callBudget, REASONING_ALLOWANCE, type CallBudget } from '@headcount/models';

/** One notch less thinking: high → medium → low; low and none stay; unset stays unset (a local model keeps thinking off). */
export function lowerEffort<E extends ReasoningEffort | undefined>(effort: E): E {
  if (effort === 'high') return 'medium' as E;
  if (effort === 'medium') return 'low' as E;
  return effort;
}
