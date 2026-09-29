// "Only when it matters" (biz-bot triggers.js gate, quiet): a short model call decides whether a routine automation
// run is worth interrupting the owner for — a material change, a decision they must make, or a failure.
import { callBudget, runTurn, type AgentTool } from '@headcount/agent-loop';
import { deadlineSignal } from '@headcount/models';
import type { Env } from '../env';
import { models } from '../workspace/runtime';

const JUDGE_SYSTEM =
  'You decide whether a finished background run is worth interrupting a small-business owner for. Interrupt only for a material change, a decision the owner must make, or a failure; routine "nothing new" results are not worth it. Call submit_verdict.';

export async function judgeRun(env: Env, name: string, result: string): Promise<{ matters: boolean; reason: string }> {
  const resolved = models(env, { surface: 'automation' }).resolve('chat', { tier: 'fast', needs: ['tools'] });
  let verdict: { matters: boolean; reason: string } | null = null;
  const tool: AgentTool<{ matters?: unknown; reason?: unknown }> = {
    spec: {
      name: 'submit_verdict',
      description: 'Say whether the owner should hear about this run now, and why in one short sentence.',
      parameters: {
        type: 'object',
        properties: { matters: { type: 'boolean' }, reason: { type: 'string', description: 'One short sentence' } },
        required: ['matters', 'reason'],
        additionalProperties: false,
      },
      mock: { triggers: ['^Automation'], args: () => ({ matters: false, reason: 'A routine result (mock check).' }), reply: () => 'Noted.' },
    },
    async execute(args) {
      verdict = { matters: args.matters === true, reason: typeof args.reason === 'string' ? args.reason.trim().slice(0, 200) : '' };
      return { ok: true, content: 'Noted.', endTurn: true };
    },
  };
  await runTurn({
    provider: resolved.provider,
    model: resolved.model,
    system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content: `Automation “${name}” finished.\n\nResult:\n${result.slice(0, 4000) || '(no summary)'}` }],
    tools: [tool],
    toolChoice: { name: 'submit_verdict' },
    maxSteps: 2,
    ...callBudget(resolved.provider, resolved.model, 400, 'low'),
    signal: deadlineSignal(20_000),
  });
  return verdict ?? { matters: false, reason: 'Nothing material.' };
}
