// Skills (biz-bot parity: public/js/skills.js, agent.js skills index, tools.js use_skill). A coworker's prompt carries
// a one-line index of their skills (name and "use when"); the full instructions arrive through `use_skill`, so a
// prompt stays short while a skill's method is one call away. The owner can switch skills off per coworker and edit a
// skill's instructions for the workspace (a new version each time, with rollback).
import type { AgentTool } from '@headcount/agent-loop';
import type { Persona, Skill } from '@headcount/catalog';
import { fullIndex } from '@headcount/catalog/full';
import type { AgentConfig, AgentSkill, SkillVersion, SkillView } from '@headcount/protocol/ext/agents';

const SKILLS = new Map<string, Skill>(fullIndex.catalog.skills.map((s) => [s.id, s]));

/** A workspace edit of a skill's instructions (WorkspaceDO `skill_overrides`). */
export interface SkillOverride {
  instructions: string;
  version: number;
  history: SkillVersion[];
}

export function catalogSkill(id: string): Skill | undefined {
  return SKILLS.get(id);
}

export function allSkillIds(): string[] {
  return [...SKILLS.keys()];
}

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function skillView(id: string, override?: SkillOverride): SkillView | null {
  const s = SKILLS.get(id);
  if (!s) return null;
  const outputs = Array.isArray(s.outputs) ? (s.outputs as { name?: unknown; format?: unknown; description?: unknown }[]) : [];
  const catalogVersion = typeof s.version === 'number' && s.version > 0 ? s.version : 1;
  return {
    id: s.id,
    name: s.name,
    icon: s.icon ?? '',
    category: s.category,
    one_liner: typeof s.one_liner === 'string' ? s.one_liner : '',
    description: s.description ?? '',
    when: s.when ?? '',
    instructions: override?.instructions ?? s.instructions ?? '',
    quality_checks: strings(s.quality_checks),
    tools: strings(s.tools),
    outputs: outputs
      .filter((o) => typeof o.name === 'string')
      .map((o) => ({ name: o.name as string, ...(typeof o.format === 'string' ? { format: o.format } : {}), ...(typeof o.description === 'string' ? { description: o.description } : {}) })),
    version: override?.version ?? catalogVersion,
    edited: !!override,
  };
}

/** A coworker's skills: primary then secondary, each with whether the owner left it on. */
export function personaSkills(persona: Pick<Persona, 'skills'>, config: AgentConfig | undefined, overrides: ReadonlyMap<string, SkillOverride>): AgentSkill[] {
  const off = new Set(config?.skillsOff ?? []);
  const out: AgentSkill[] = [];
  const seen = new Set<string>();
  for (const [level, ids] of [
    ['primary', persona.skills.primary],
    ['secondary', persona.skills.secondary],
  ] as const) {
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const v = skillView(id, overrides.get(id));
      if (v) out.push({ ...v, level, enabled: !off.has(id) });
    }
  }
  return out;
}

/** The prompt's skills index (biz-bot agent.js:65-67): one line per enabled skill. */
export function skillsIndex(skills: readonly AgentSkill[]): string {
  const on = skills.filter((s) => s.enabled);
  if (!on.length) return '';
  return [
    'Your skills (call use_skill to load a skill’s full method before you do that kind of work):',
    ...on.map((s) => `- ${s.id}${s.version > 1 ? ` v${s.version}` : ''}: ${s.name}. Use when ${lowerFirst(s.when || s.one_liner).replace(/[\s.]*$/, '.')}`),
  ].join('\n');
}

/** The full method of one skill, as `use_skill` returns it. */
export function skillMethod(s: SkillView): string {
  return [
    `# ${s.name}${s.version > 1 ? ` (v${s.version})` : ''}`,
    s.instructions,
    s.quality_checks.length ? `\nQuality checks before you hand it in:\n${s.quality_checks.map((q) => `- ${q}`).join('\n')}` : '',
    s.outputs.length ? `\nTypical outputs: ${s.outputs.map((o) => `${o.name}${o.format ? ` (${o.format})` : ''}`).join('; ')}.` : '',
    '\nA step that needs a tool you do not have (sending, publishing, a connector) becomes a draft or a request to the owner.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** `use_skill`: load one skill's full method (only the coworker's enabled skills). */
export function useSkillTool(skills: readonly AgentSkill[], onUse?: (id: string) => void): AgentTool<{ skill?: unknown }> | null {
  const on = skills.filter((s) => s.enabled);
  if (!on.length) return null;
  const byId = new Map(on.map((s) => [s.id, s]));
  return {
    spec: {
      name: 'use_skill',
      description: 'Load the full method of one of your skills: its steps, quality checks and typical outputs. Call it before you do that kind of work. Fails for a skill that is not on your list.',
      parameters: { type: 'object', properties: { skill: { type: 'string', enum: on.map((s) => s.id), description: 'The skill id from your skills list.' } }, required: ['skill'], additionalProperties: false },
    },
    async execute(args) {
      const s = typeof args.skill === 'string' ? byId.get(args.skill) : undefined;
      if (!s) return { ok: false, error: `Not one of your skills. Use one of: ${[...byId.keys()].join(', ')}.` };
      onUse?.(s.id);
      return { ok: true, content: skillMethod(s), summary: `Loaded the ${s.name} method` };
    },
  };
}
