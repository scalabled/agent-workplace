// One coworker ready to work: their catalog persona with the owner's overrides applied — the instructions in force,
// their enabled skills, their tool grants and the model that answers for them (biz-bot parity: per-agent provider,
// model and reasoning effort; FORMATION: members start on their own provider preference, so a team's perspectives
// really differ). Pure, apart from resolving the model on a registry.
import type { Persona } from '@headcount/catalog';
import { isProviderId, type ProviderId, type ReasoningEffort, type Registry, type Resolved } from '@headcount/models';
import type { AgentConfig, AgentSkill, ToolGrantId } from '@headcount/protocol/ext/agents';
import { personaSkills, type SkillOverride } from './skills';
import type { AgentSetup } from './store';

export interface Agent {
  persona: Persona;
  config: AgentConfig;
  instructions: string;
  edited: boolean;
  skills: AgentSkill[];
  granted(tool: ToolGrantId): boolean;
  /** The effort the owner or the catalog chose for this coworker, if any. */
  effort?: ReasoningEffort;
}

export function agentOf(persona: Persona, setup?: AgentSetup): Agent {
  const config = setup?.configs[persona.id] ?? {};
  const overrides = new Map<string, SkillOverride>(Object.entries(setup?.skills ?? {}));
  const effort = toEffort(config.model?.reasoning ?? persona.model_policy?.reasoning_effort);
  return {
    persona,
    config,
    instructions: config.instructions ?? persona.instructions ?? '',
    edited: !!config.instructions,
    skills: personaSkills(persona, config, overrides),
    // Every coworker has web tools and can consult teammates unless the owner turned it off.
    granted: (tool) => config.tools?.[tool] !== false,
    ...(effort ? { effort } : {}),
  };
}

function toEffort(v: unknown): ReasoningEffort | undefined {
  return v === 'low' || v === 'medium' || v === 'high' ? v : undefined;
}

/** Catalog tier → registry tier (deep and balanced work on the reasoning tier, fast on the fast one). */
export function registryTier(tier: string | undefined): 'reason' | 'fast' {
  return tier === 'fast' ? 'fast' : 'reason';
}

/**
 * Who answers for this coworker: the owner's provider and model when set, else the persona's provider preference on
 * its tier. Falls through to any configured provider (the registry's order), so a missing key never stops work.
 */
export function resolveAgentModel(registry: Registry, agent: Pick<Agent, 'persona' | 'config'>): Resolved<'chat'> {
  const choice = agent.config.model;
  const pref = (choice?.provider ? [choice.provider] : (agent.persona.model_policy?.provider_preference ?? [])).filter(isProviderId) as ProviderId[];
  const tier = registryTier(agent.persona.model_policy?.tier);
  const base = { tier, needs: ['tools' as const], ...(pref.length ? { prefer: pref } : {}) };
  if (!choice?.provider || !choice.model) return registry.resolve('chat', base);
  // The pinned model belongs to the chosen provider: when that provider cannot answer, its fallback uses its own default.
  const pinned = registry.resolve('chat', { ...base, model: choice.model });
  return pinned.providerId === choice.provider ? pinned : registry.resolve('chat', base);
}
