// Agent configuration and transparency (biz-bot parity, Stage 2): the owner sees and edits how each coworker works —
// instructions, skills, tool grants, model — and sees the exact system prompt each surface assembles and every model
// call a project made. biz-bot shows only the editable pieces; here the assembled prompt and the calls are visible too.

/** Tools the owner grants per coworker (connectors are granted by id in `connectors`). */
export type ToolGrantId = 'web_search' | 'fetch_page' | 'ask_coworker';
export const TOOL_GRANT_IDS: readonly ToolGrantId[] = ['web_search', 'fetch_page', 'ask_coworker'];

export type ReasoningChoice = 'default' | 'low' | 'medium' | 'high';

export interface AgentModelChoice {
  /** Provider id; absent → the persona's catalog preference order. */
  provider?: string;
  /** Model id on that provider; absent → the provider's default for the persona's tier. */
  model?: string;
  reasoning?: ReasoningChoice;
}

/** The owner's overrides for one coworker (everything optional: absent means the catalog default). */
export interface AgentConfig {
  /** Replaces the catalog instructions ("How they work"). */
  instructions?: string;
  /** Skill ids switched off for this coworker. */
  skillsOff?: string[];
  tools?: Partial<Record<ToolGrantId, boolean>>;
  /** Connector ids this coworker may use (Stage 5). */
  connectors?: string[];
  model?: AgentModelChoice;
  updatedAt?: string;
}

export interface InstructionVersion {
  /** null: the catalog instructions were in force. */
  instructions: string | null;
  at: string;
  note?: string;
}

export const INSTRUCTIONS_MAX = 8000;

/** One labelled part of an assembled system prompt, so the owner can see where each sentence comes from. */
export interface PromptSection {
  id: string;
  title: string;
  text: string;
  origin: 'platform' | 'persona' | 'owner' | 'skills' | 'tools' | 'project' | 'state';
}

export type PromptSurface = 'work' | 'review' | 'desk' | 'room' | 'chief';

export interface ToolView {
  name: string;
  description: string;
  /** JSON Schema of the arguments (function tools). */
  parameters?: unknown;
  kind: 'function' | 'hosted';
}

export interface PromptView {
  surface: PromptSurface;
  label: string;
  /** When the prompt is used, in one sentence. */
  when: string;
  sections: PromptSection[];
  /** The exact text sent as the system prompt. */
  text: string;
  tools: ToolView[];
}

export interface SkillView {
  id: string;
  name: string;
  icon: string;
  category: string;
  one_liner: string;
  description: string;
  when: string;
  instructions: string;
  quality_checks: string[];
  tools: string[];
  outputs: { name: string; format?: string; description?: string }[];
  version: number;
  /** The owner edited the instructions (a workspace version is in force). */
  edited: boolean;
}

export interface SkillVersion {
  version: number;
  instructions: string;
  at: string;
  note?: string;
}

export interface SkillDetail extends SkillView {
  history: SkillVersion[];
  catalogInstructions: string;
}

export interface AgentSkill extends SkillView {
  level: 'primary' | 'secondary';
  enabled: boolean;
}

export interface GrantView {
  id: ToolGrantId;
  label: string;
  description: string;
  granted: boolean;
  /** False when the workspace cannot offer it (e.g. web tools switched off). */
  available: boolean;
  note?: string;
}

export interface AgentView {
  personaId: string;
  name: string;
  title: string;
  catalogInstructions: string;
  /** The instructions in force (the owner's, else the catalog's). */
  instructions: string;
  edited: boolean;
  config: AgentConfig;
  history: InstructionVersion[];
  skills: AgentSkill[];
  grants: GrantView[];
  model: {
    policy: { tier: string; providerPreference: string[]; reasoning: string | null };
    choice: AgentModelChoice;
    /** Who would answer now, or null when no provider is configured. */
    resolved: { provider: string; model: string } | null;
  };
  prompts: PromptView[];
}

export interface AgentConfigPatch {
  /** null resets to the catalog instructions. */
  instructions?: string | null;
  note?: string;
  skillsOff?: string[];
  tools?: Partial<Record<ToolGrantId, boolean>>;
  connectors?: string[];
  /** null resets to the catalog policy. */
  model?: AgentModelChoice | null;
}

export interface SkillPatch {
  instructions: string;
  note?: string;
}

export interface SkillsResponse {
  skills: (Pick<SkillView, 'id' | 'name' | 'icon' | 'category' | 'one_liner' | 'version' | 'edited'> & { usedBy: number })[];
}

export interface ModelsResponse {
  providers: { id: string; label: string; configured: boolean; models: { id: string; latencyClass: string }[] }[];
}

/** One model call of a project, as the run inspector shows it. */
export interface RunTrace {
  runId: string;
  projectId: string;
  /** null: the deliverable (or QA of it). */
  stepId: string | null;
  phase: 'plan' | 'work' | 'review' | 'revise' | 'deliverable' | 'qa' | 'ask' | 'discussion';
  personaId: string;
  provider: string;
  model: string;
  system: string;
  prompt: string;
  calls: { name: string; args: string; result: string; ok: boolean }[];
  text: string;
  sources: { url: string; title?: string }[];
  usage: { input: number; output: number; usd: number | null };
  steps: number;
  finish: string;
  startedAt: string;
  ms: number;
}

export interface RunsResponse {
  runs: RunTrace[];
}

export interface ProjectUsage {
  input: number;
  output: number;
  /** null when any call's price is unknown. */
  usd: number | null;
  calls: number;
}
