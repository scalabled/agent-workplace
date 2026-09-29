// One place that builds an agent's research kit inside a Durable Object: the grants (the owner's switch and, from
// Stage 2, the coworker's tool grants), the daily caps and the registry for the search fallback.
import type { ChatProvider } from '@headcount/models';
import type { Env } from '../env';
import { dailyLimit, limitMessage, type DailyCounter } from '../lib/limits';
import { runtime } from '../workspace/runtime';
import { researchTools, type ResearchGrants, type ResearchKit } from './research';
import type { SourceCollector } from './web-search';

export type KitFactory = (sources: SourceCollector) => ResearchKit;

export function webToolsOn(env: Env): boolean {
  return (env.WEB_TOOLS ?? '').toLowerCase() !== 'off';
}

export function researchKitFactory(env: Env, usage: DailyCounter, provider: Pick<ChatProvider, 'hosted'>, grants?: Partial<ResearchGrants>): KitFactory {
  const on = webToolsOn(env);
  const g: ResearchGrants = { webSearch: on && grants?.webSearch !== false, fetchPage: on && grants?.fetchPage !== false, xSearch: on && grants?.xSearch === true };
  return (sources) =>
    researchTools({
      provider,
      registry: runtime.registry(env),
      grants: g,
      sources,
      take: (kind) => {
        const limit = dailyLimit(env, kind);
        return usage.take(kind, limit, runtime.now()).allowed ? { allowed: true } : { allowed: false, message: limitMessage(kind, limit) };
      },
    });
}
