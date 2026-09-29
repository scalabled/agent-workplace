// The owner's overrides for coworkers and skills, kept in the WorkspaceDO's SQLite (biz-bot parity: store.js saveBot,
// saveSkill, rollbackSkill). Agent instructions keep a short history (biz-bot keeps none); skill edits are versioned
// with rollback. The ProjectDO reads them over RPC when a coworker starts a piece of work.
import { fullIndex } from '@headcount/catalog/full';
import { PROVIDERS } from '@headcount/models';
import { INSTRUCTIONS_MAX, TOOL_GRANT_IDS, type AgentConfig, type AgentConfigPatch, type InstructionVersion, type ReasoningChoice, type SkillVersion } from '@headcount/protocol/ext/agents';
import { catalogSkill, type SkillOverride } from './skills';

export const AGENT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS agent_config (persona_id TEXT PRIMARY KEY, config TEXT NOT NULL, history TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS skill_overrides (skill_id TEXT PRIMARY KEY, instructions TEXT NOT NULL, version INTEGER NOT NULL, history TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL)`,
];

const HISTORY_MAX = 10;
const SKILL_HISTORY_MAX = 20;
const REASONING: readonly ReasoningChoice[] = ['default', 'low', 'medium', 'high'];

export class AgentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentConfigError';
  }
}

/** What a coworker's work needs from the owner's overrides (sent to the ProjectDO). */
export interface AgentSetup {
  configs: Record<string, AgentConfig>;
  skills: Record<string, SkillOverride>;
}

type Row = { persona_id: string; config: string; history: string; updated_at: string };
type SkillRow = { skill_id: string; instructions: string; version: number; history: string; updated_at: string };

export class AgentStore {
  constructor(private readonly sql: SqlStorage) {
    for (const stmt of AGENT_SCHEMA) sql.exec(stmt);
  }

  config(personaId: string): AgentConfig | undefined {
    const r = this.sql.exec<Row>('SELECT * FROM agent_config WHERE persona_id = ?', personaId).toArray()[0];
    return r ? (JSON.parse(r.config) as AgentConfig) : undefined;
  }

  history(personaId: string): InstructionVersion[] {
    const r = this.sql.exec<Row>('SELECT * FROM agent_config WHERE persona_id = ?', personaId).toArray()[0];
    return r ? (JSON.parse(r.history) as InstructionVersion[]) : [];
  }

  /** Configs and skill overrides for these coworkers (their skills only). */
  setup(personaIds: readonly string[]): AgentSetup {
    const configs: Record<string, AgentConfig> = {};
    const skillIds = new Set<string>();
    for (const id of personaIds) {
      const c = this.config(id);
      if (c) configs[id] = c;
      const p = fullIndex.persona(id);
      for (const s of [...(p?.skills.primary ?? []), ...(p?.skills.secondary ?? [])]) skillIds.add(s);
    }
    const skills: Record<string, SkillOverride> = {};
    for (const id of skillIds) {
      const o = this.skillOverride(id);
      if (o) skills[id] = o;
    }
    return { configs, skills };
  }

  /** Apply the owner's change (validated); the previous instructions go to the history. */
  patch(personaId: string, patch: AgentConfigPatch, at: string): AgentConfig {
    const persona = fullIndex.persona(personaId);
    if (!persona) throw new AgentConfigError('There is no such coworker.');
    const cur = this.config(personaId) ?? {};
    const next: AgentConfig = { ...cur };
    const history = this.history(personaId);

    if (patch.instructions !== undefined) {
      const text = patch.instructions === null ? null : String(patch.instructions).replace(/\r\n/g, '\n').trim();
      if (text !== null && !text) throw new AgentConfigError('Instructions cannot be empty; reset them to the catalog instead.');
      if (text && text.length > INSTRUCTIONS_MAX) throw new AgentConfigError(`Keep instructions under ${INSTRUCTIONS_MAX} characters.`);
      if ((text ?? undefined) !== cur.instructions) {
        history.unshift({ instructions: cur.instructions ?? null, at, ...(patch.note ? { note: String(patch.note).slice(0, 200) } : {}) });
        if (text) next.instructions = text;
        else delete next.instructions;
      }
    }
    if (patch.skillsOff !== undefined) {
      const mine = new Set([...persona.skills.primary, ...persona.skills.secondary]);
      if (!Array.isArray(patch.skillsOff) || patch.skillsOff.some((s) => typeof s !== 'string' || !mine.has(s))) throw new AgentConfigError('Only this coworker’s own skills can be switched off.');
      if (patch.skillsOff.length) next.skillsOff = [...new Set(patch.skillsOff)];
      else delete next.skillsOff;
    }
    if (patch.tools !== undefined) {
      const tools: NonNullable<AgentConfig['tools']> = { ...cur.tools };
      for (const [k, v] of Object.entries(patch.tools ?? {})) {
        if (!(TOOL_GRANT_IDS as readonly string[]).includes(k) || typeof v !== 'boolean') throw new AgentConfigError(`Unknown tool grant: ${k}.`);
        tools[k as keyof typeof tools] = v;
      }
      next.tools = tools;
    }
    if (patch.connectors !== undefined) {
      if (!Array.isArray(patch.connectors) || patch.connectors.length > 40 || patch.connectors.some((c) => typeof c !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(c))) throw new AgentConfigError('Connectors are a list of connector ids.');
      if (patch.connectors.length) next.connectors = [...new Set(patch.connectors)];
      else delete next.connectors;
    }
    if (patch.model !== undefined) {
      if (patch.model === null) delete next.model;
      else {
        const m = patch.model;
        if (m.provider !== undefined && !PROVIDERS.some((d) => d.id === m.provider)) throw new AgentConfigError(`Unknown provider: ${m.provider}.`);
        if (m.model !== undefined && (typeof m.model !== 'string' || !/^[\w.:/-]{1,120}$/.test(m.model))) throw new AgentConfigError('That is not a model id.');
        if (m.model && !m.provider) throw new AgentConfigError('Choose the provider for that model.');
        if (m.reasoning !== undefined && !REASONING.includes(m.reasoning)) throw new AgentConfigError('Reasoning is default, low, medium or high.');
        const model = { ...(m.provider ? { provider: m.provider } : {}), ...(m.model ? { model: m.model } : {}), ...(m.reasoning && m.reasoning !== 'default' ? { reasoning: m.reasoning } : {}) };
        if (Object.keys(model).length) next.model = model;
        else delete next.model;
      }
    }
    next.updatedAt = at;
    this.sql.exec(
      `INSERT INTO agent_config (persona_id, config, history, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(persona_id) DO UPDATE SET config = excluded.config, history = excluded.history, updated_at = excluded.updated_at`,
      personaId,
      JSON.stringify(next),
      JSON.stringify(history.slice(0, HISTORY_MAX)),
      at,
    );
    return next;
  }

  /** Back to the catalog for everything (the instruction history keeps the last owner text). */
  reset(personaId: string, at: string): void {
    const cur = this.config(personaId);
    if (!cur) return;
    const history = this.history(personaId);
    if (cur.instructions) history.unshift({ instructions: cur.instructions, at, note: 'Reset to the catalog' });
    this.sql.exec(`UPDATE agent_config SET config = ?, history = ?, updated_at = ? WHERE persona_id = ?`, JSON.stringify({ updatedAt: at }), JSON.stringify(history.slice(0, HISTORY_MAX)), at, personaId);
  }

  // ── skills ─────────────────────────────────────────────────────────────────────

  skillOverride(skillId: string): SkillOverride | undefined {
    const r = this.sql.exec<SkillRow>('SELECT * FROM skill_overrides WHERE skill_id = ?', skillId).toArray()[0];
    return r ? { instructions: r.instructions, version: Number(r.version), history: JSON.parse(r.history) as SkillVersion[] } : undefined;
  }

  skillOverrides(): Map<string, SkillOverride> {
    const out = new Map<string, SkillOverride>();
    for (const r of this.sql.exec<SkillRow>('SELECT * FROM skill_overrides').toArray()) out.set(r.skill_id, { instructions: r.instructions, version: Number(r.version), history: JSON.parse(r.history) as SkillVersion[] });
    return out;
  }

  /** A new version of a skill's instructions for this workspace; the previous one goes to the history. */
  editSkill(skillId: string, instructions: string, at: string, note?: string): SkillOverride {
    const skill = catalogSkill(skillId);
    if (!skill) throw new AgentConfigError('There is no such skill.');
    const text = String(instructions ?? '').replace(/\r\n/g, '\n').trim();
    if (!text) throw new AgentConfigError('A skill needs instructions.');
    if (text.length > 12_000) throw new AgentConfigError('Keep a skill under 12,000 characters.');
    const cur = this.skillOverride(skillId);
    const catalogVersion = typeof skill.version === 'number' && skill.version > 0 ? skill.version : 1;
    const curVersion = cur?.version ?? catalogVersion;
    const curText = cur?.instructions ?? skill.instructions;
    if (text === curText) return cur ?? { instructions: curText, version: curVersion, history: [] };
    const history = [{ version: curVersion, instructions: curText, at, ...(note ? { note: String(note).slice(0, 200) } : {}) }, ...(cur?.history ?? [])].slice(0, SKILL_HISTORY_MAX);
    const next: SkillOverride = { instructions: text, version: curVersion + 1, history };
    this.writeSkill(skillId, next, at);
    return next;
  }

  /** Bring back an earlier version's text as a new version (nothing is lost). */
  rollbackSkill(skillId: string, version: number, at: string): SkillOverride {
    const cur = this.skillOverride(skillId);
    const past = cur?.history.find((h) => h.version === version);
    if (!cur || !past) throw new AgentConfigError(`There is no version ${version} of that skill to roll back to.`);
    return this.editSkill(skillId, past.instructions, at, `Rolled back to v${version}`);
  }

  private writeSkill(skillId: string, o: SkillOverride, at: string): void {
    this.sql.exec(
      `INSERT INTO skill_overrides (skill_id, instructions, version, history, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(skill_id) DO UPDATE SET instructions = excluded.instructions, version = excluded.version, history = excluded.history, updated_at = excluded.updated_at`,
      skillId,
      o.instructions,
      o.version,
      JSON.stringify(o.history),
      at,
    );
  }
}
