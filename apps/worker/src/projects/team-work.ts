// The work of a team project: choose a recipe, plan the steps, then per step the lead works in character, the cluster
// reviews, the lead revises when asked; the finisher writes the deliverable and a reviewer checks it. Every call runs
// as a configured agent (the owner's instructions, skills, tool grants and model for that coworker) and is captured
// for the run inspector. Structured outputs are forced tool calls, deterministic on the keyless Mock provider through
// the tools' mock hints.
import { callBudget, runTurn, type AgentTool, type TurnResult } from '@headcount/agent-loop';
import type { Persona } from '@headcount/catalog';
import type { ChatProvider, ReasoningEffort } from '@headcount/models';
import type { PromptSection } from '@headcount/protocol/ext/agents';
import type { DeliverableKind, ProjectStep, TeamMember } from '@headcount/protocol/ext/projects';
import type { Agent } from '../agents/agent';
import { coworkerSections, joinSections } from '../agents/prompt';
import { useSkillTool } from '../agents/skills';
import { clipText, firstSentence } from '../jobs/job-view';
import { WorkCancelled, WorkError } from '../jobs/work-loop';
import type { KitFactory } from '../tools/kit';
import { SourceCollector, mergeSources, sourcesBlock, withSources, type Source } from '../tools/web-search';
import { firstName, type Recipe } from './staffing';

/** A plain model for calls that are not a coworker's (choosing the playbook). */
export interface TeamDeps {
  provider: ChatProvider;
  model: string;
  signal: AbortSignal;
}

/** One coworker set up to work: persona and overrides, the model that answers for them, and their tools. */
export interface Worker {
  agent: Agent;
  provider: ChatProvider;
  providerId: string;
  model: string;
  signal: AbortSignal;
  /** Web search and page reading, per the coworker's grants (absent: none). */
  research?: KitFactory;
  /** Tools the project adds for this piece of work (ask the owner, consult a teammate…). */
  extraTools?: AgentTool<any>[];
  /** One line for the prompt's Tools section describing the extra tools. */
  extraDescribe?: string;
  /** True when the work stopped on purpose (the lead asked the owner): no output is expected. */
  paused?: () => boolean;
}

/** A model call as the run inspector keeps it. */
export interface Captured {
  sections: PromptSection[];
  system: string;
  prompt: string;
  result: TurnResult;
  startedAt: string;
  ms: number;
}

/** What a piece of step work produced: the Markdown, one sentence for the team, and the sources it relied on. */
export interface WorkOutput {
  markdown: string;
  summary: string;
  sources: Source[];
  run: Captured;
}

export interface Verdict {
  approved: boolean;
  notes: string;
  sources: Source[];
  run: Captured;
}

export interface ProjectBrief {
  title: string;
  goal: string;
  team: TeamMember[];
  steps: ProjectStep[];
  chiefName: string;
  /** The owner's direction since the plan was made (to the team, or to one member by persona id). */
  notes?: { text: string; toId?: string }[];
  /** The team channel's recent lines (the shared record: asks, answers, decisions). */
  channel?: string;
}

type Phase = 'choose' | 'plan' | 'work' | 'review' | 'deliverable';
const BUDGETS: Readonly<Record<Phase, { output: number; effort: ReasoningEffort }>> = {
  choose: { output: 400, effort: 'low' },
  plan: { output: 3000, effort: 'medium' },
  work: { output: 1800, effort: 'medium' },
  review: { output: 600, effort: 'low' },
  deliverable: { output: 6000, effort: 'medium' },
};
const budget = (provider: ChatProvider, model: string, phase: Phase, effort?: ReasoningEffort) => callBudget(provider, model, BUDGETS[phase].output, effort ?? BUDGETS[phase].effort);

/** Inputs from earlier steps are capped so a long chain never blows the context. */
const INPUTS_BUDGET = 9000;

function check(result: TurnResult): void {
  if (result.finish === 'cancelled') throw new WorkCancelled();
  if (result.finish === 'error') throw new WorkError(result.error?.message ?? 'The model call failed.', result.error?.retryable ?? true);
}

// ── choosing the recipe ─────────────────────────────────────────────────────────────

/** Ask the model to pick one recipe from the shortlist and name the project. Null when it picks nothing valid. */
export async function chooseRecipe(deps: TeamDeps, goal: string, shortlist: Recipe[]): Promise<{ recipeId: string; title: string } | null> {
  if (!shortlist.length) return null;
  let chosen: { recipe_id?: unknown; title?: unknown } | null = null;
  const tool: AgentTool<{ recipe_id?: unknown; title?: unknown }> = {
    spec: {
      name: 'choose_playbook',
      description: 'Choose the one team playbook that best delivers the owner goal, and give the project a short title.',
      parameters: {
        type: 'object',
        properties: {
          recipe_id: { type: 'string', enum: shortlist.map((r) => r.id), description: 'The playbook id.' },
          title: { type: 'string', description: 'A short project title (3–7 words), in the owner’s terms.' },
        },
        required: ['recipe_id', 'title'],
        additionalProperties: false,
      },
      mock: { triggers: ['^Choose the playbook'], args: () => ({ recipe_id: shortlist[0]!.id, title: '' }), reply: () => 'Chosen.' },
    },
    async execute(args) {
      chosen = args;
      return { ok: true, content: 'Chosen.', endTurn: true };
    },
  };
  const list = shortlist.map((r) => `- ${r.id}: ${r.name}. ${clipText(r.outcome ?? '', 200)}${r.when_to_use ? ` Use when: ${clipText(r.when_to_use, 160)}` : ''}`).join('\n');
  const result = await runTurn({
    provider: deps.provider,
    model: deps.model,
    signal: deps.signal,
    system: 'You staff projects for a small-business owner. Pick the playbook whose outcome best matches the goal; prefer the most specific fit.',
    messages: [{ role: 'user', content: `Choose the playbook for this goal and title the project.\n\nGoal: ${goal}\n\nPlaybooks:\n${list}` }],
    tools: [tool],
    toolChoice: { name: 'choose_playbook' },
    maxSteps: 2,
    ...budget(deps.provider, deps.model, 'choose'),
  });
  check(result);
  const c = chosen as { recipe_id?: unknown; title?: unknown } | null;
  const id = typeof c?.recipe_id === 'string' ? c.recipe_id : '';
  if (!shortlist.some((r) => r.id === id)) return null;
  const title = typeof c?.title === 'string' ? c.title.trim().slice(0, 80) : '';
  return { recipeId: id, title };
}

// ── planning (biz-bot plan.js PLAN_SYSTEM / planSchema) ──────────────────────────────

export interface RawPlan {
  deliverable?: { kind?: unknown; title?: unknown };
  finisher?: unknown;
  tasks?: unknown;
}

export const PLAN_SYSTEM = [
  'You plan the work of a small team for a business owner. Rules:',
  '- Plan between 2 and 8 tasks that together produce the goal. No "coordinate", "summarise" or final "assemble" tasks: the finisher assembles the deliverable automatically.',
  '- Make it a graph, not a list: depend only on the tasks whose output a task really needs, so independent work runs in parallel.',
  '- Each task has 1 to 3 owners (the first is the lead; co-owners help and review) and 0 to 2 reviewers from a different discipline. Match members to tasks by their titles and expertise.',
  '- Put the member whose job is to challenge the plan (the sceptic) as a reviewer where being wrong is most expensive. The finisher is never the sceptic.',
  '- A brief says what to do in 40–120 words; acceptance says how to tell it is done in 1–3 checks.',
  '- Choose the deliverable kind: "document" (Markdown), "web" (one self-contained HTML page or small app) or "code" (one file). Most business goals are documents.',
].join('\n');

/** The planner: the lead drafts the plan (the playbook's usual plan is its starting point). */
export async function planProject(w: Worker, goal: string, team: readonly TeamMember[], seed: readonly { title: string; brief: string; acceptance: string; ownerId: string; reviewerIds: string[]; dependsOn: string[]; id: string }[], preferKind?: DeliverableKind): Promise<{ plan: RawPlan | null; run: Captured }> {
  const ids = team.map((m) => m.personaId);
  let submitted: RawPlan | null = null;
  const tool: AgentTool<RawPlan> = {
    spec: {
      name: 'submit_plan',
      description: 'Submit the plan: the deliverable, who finishes it, and the tasks.',
      parameters: {
        type: 'object',
        properties: {
          deliverable: {
            type: 'object',
            properties: { kind: { type: 'string', enum: ['document', 'web', 'code'] }, title: { type: 'string', description: 'The deliverable’s title' } },
            required: ['kind', 'title'],
            additionalProperties: false,
          },
          finisher: { type: 'string', enum: ids, description: 'Who assembles the deliverable (never the sceptic).' },
          tasks: {
            type: 'array',
            minItems: 2,
            maxItems: 8,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Short id, e.g. t1' },
                title: { type: 'string', description: '2–6 words' },
                brief: { type: 'string', description: '40–120 words: what to do' },
                acceptance: { type: 'string', description: '1–3 checks: how to tell it is done' },
                owners: { type: 'array', items: { type: 'string', enum: ids }, minItems: 1, maxItems: 3 },
                reviewers: { type: 'array', items: { type: 'string', enum: ids }, maxItems: 2 },
                dependsOn: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'title', 'brief', 'acceptance', 'owners', 'reviewers', 'dependsOn'],
              additionalProperties: false,
            },
          },
        },
        required: ['deliverable', 'finisher', 'tasks'],
        additionalProperties: false,
      },
      mock: {
        triggers: ['^Plan the project'],
        args: () => ({
          deliverable: { kind: preferKind ?? 'document', title: '' },
          finisher: team.find((m) => m.role === 'lead')?.personaId ?? ids[0]!,
          tasks: seed.map((s) => ({ id: s.id, title: s.title, brief: s.brief, acceptance: s.acceptance, owners: [s.ownerId], reviewers: s.reviewerIds, dependsOn: s.dependsOn })),
        }),
        reply: () => 'Planned.',
      },
    },
    async execute(args) {
      submitted = args;
      return { ok: true, content: 'Planned.', endTurn: true };
    },
  };
  const members = team.map((m) => `- ${m.personaId}: ${m.name}, ${m.title} (${m.role.replace('_', '-')}). ${clipText(m.why, 160)}`).join('\n');
  const usual = seed.map((s, i) => `${i + 1}. ${s.title} — ${clipText(s.brief, 200)} (owner ${s.ownerId}${s.reviewerIds.length ? `, reviewed by ${s.reviewerIds.join(', ')}` : ''}${s.dependsOn.length ? `, after ${s.dependsOn.join(', ')}` : ''})`).join('\n');
  const prompt = `Plan the project for this goal and submit it with submit_plan.\n\n<goal>\n${clipText(goal, 6000)}\n</goal>\n<team>\n${members}\n</team>\n<usual_plan>\nThe playbook usually runs like this; adapt it to the goal (drop, merge or add tasks):\n${usual}\n</usual_plan>${preferKind ? `\nThe owner wants a ${preferKind} deliverable.` : ''}`;
  const { result, run } = await runAgentTurn(w, {
    surface: 'work',
    prefix: [{ id: 'planner', title: 'Planning', origin: 'platform', text: PLAN_SYSTEM }],
    prompt,
    tools: [tool],
    force: 'submit_plan',
    phase: 'plan',
    research: false,
  });
  return { plan: submitted ?? null, run };
}

// ── prompts ─────────────────────────────────────────────────────────────────────────

/**
 * The owner's direction since the plan was made, as `for` sees it: the team's notes and their own (null: the team's
 * only; '*': every note, for the deliverable). Newest last; capped.
 */
export function notesBlock(brief: ProjectBrief, forId: string | null | '*'): string {
  const notes = (brief.notes ?? []).filter((n) => forId === '*' || !n.toId || n.toId === forId).slice(-8);
  if (!notes.length) return '';
  const who = (id?: string) => (id ? `to ${firstName(brief.team.find((m) => m.personaId === id)?.name ?? 'a teammate')}` : 'to the team');
  return ['Direction from the owner since the plan was made (follow it where it applies; newest last):', ...notes.map((n) => `- (${who(n.toId)}) ${clipText(n.text, 600)}`)].join('\n');
}

function projectBlock(brief: ProjectBrief, step: ProjectStep, forId: string | null = step.ownerId): string {
  const notes = notesBlock(brief, forId);
  return [`<project>`, `Title: ${brief.title}`, `Owner's goal: ${brief.goal}`, `Your step: ${step.title}`, `Brief: ${step.brief}`, `Done when: ${step.acceptance}`, ...(notes ? [notes] : []), `</project>`].join('\n');
}

function inputsBlock(brief: ProjectBrief, step: ProjectStep): string {
  const deps = brief.steps.filter((s) => step.dependsOn.includes(s.id) && s.output);
  if (!deps.length) return '';
  let left = INPUTS_BUDGET;
  const parts: string[] = [];
  for (const d of deps) {
    const owner = brief.team.find((m) => m.personaId === d.ownerId);
    const text = clipText(d.output ?? '', Math.max(400, Math.floor(left / deps.length)));
    left -= text.length;
    parts.push(`## ${d.title} (by ${owner ? firstName(owner.name) : 'a teammate'})\n${text}`);
  }
  return `<inputs>\n${parts.join('\n\n')}\n</inputs>`;
}

const channelBlock = (brief: ProjectBrief) => (brief.channel ? `\n<team_channel>\nWhat the team has said so far (reference):\n${brief.channel}\n</team_channel>` : '');

// ── one agent turn ──────────────────────────────────────────────────────────────────

interface TurnSpec {
  surface: 'work' | 'review';
  prompt: string;
  tools: AgentTool<any>[];
  /** The submit tool: forced at once when the agent has nothing to look up first ('' for a plain-text turn). */
  force: string;
  phase: Phase;
  /** Extra sections before the agent's own (the planner's rules). */
  prefix?: PromptSection[];
  /** false: no research tools for this call (planning, the deliverable). */
  research?: boolean;
  project?: ProjectBrief;
  maxSteps?: number;
}

/**
 * Run one call as the worker's agent: their labelled prompt (identity, instructions, project, skills, tools, rules),
 * their research kit, `use_skill`, and the project's extra tools. Returns the turn, its sources and its capture.
 */
export async function runAgentTurn(w: Worker, spec: TurnSpec): Promise<{ result: TurnResult; sources: Source[]; run: Captured }> {
  const collector = new SourceCollector();
  const kit = spec.research === false ? undefined : w.research?.(collector);
  const skill = useSkillTool(w.agent.skills);
  const extra = spec.research === false ? [] : (w.extraTools ?? []);
  const looksUp = !!kit && (kit.tools.length > 0 || kit.hosted.length > 0);
  const optional = [...(kit?.tools ?? []), ...(skill ? [skill] : []), ...extra];
  const sections = [
    ...(spec.prefix ?? []),
    ...coworkerSections(
      {
        persona: w.agent.persona,
        instructions: w.agent.instructions,
        edited: w.agent.edited,
        skills: w.agent.skills,
        research: kit?.describe ?? '',
        ...(spec.project ? { project: { title: spec.project.title, team: spec.project.team, chiefName: spec.project.chiefName } } : {}),
        ...(w.extraDescribe && extra.length ? { collaborate: w.extraDescribe } : {}),
      },
      spec.surface,
    ),
  ];
  const system = joinSections(sections);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const result = await runTurn({
    provider: w.provider,
    model: w.model,
    signal: w.signal,
    system,
    messages: [{ role: 'user', content: spec.prompt }],
    // Project tools first (asking the owner outranks submitting), then the submit tool, then research and skills.
    tools: [...extra, ...spec.tools, ...(kit?.tools ?? []), ...(skill ? [skill] : [])],
    ...(kit?.hosted.length ? { hostedTools: kit.hosted } : {}),
    // Anything to look up or load first: the model decides; otherwise the submit is forced at once.
    ...(spec.force ? { toolChoice: optional.length || looksUp ? ('auto' as const) : { name: spec.force } } : {}),
    maxSteps: spec.maxSteps ?? (optional.length || looksUp ? 8 : 2),
    ...budget(w.provider, w.model, spec.phase, w.agent.effort),
  });
  collector.addAll(result.citations);
  return { result, sources: collector.list(), run: { sections, system, prompt: spec.prompt, result, startedAt, ms: Date.now() - t0 } };
}

// ── the step: work, review, revise ──────────────────────────────────────────────────

function mockWork(p: Persona, step: ProjectStep, revise: boolean): { markdown: string; summary: string } {
  const lead = revise ? 'Revised after review.' : `${p.name.split(' ')[0]}'s draft.`;
  return {
    markdown: `### ${step.title}\n\n${lead} Placeholder output from the mock model: no real work was done. Add a provider key or start Ollama for real work.\n\n- Covers: ${clipText(step.acceptance, 160)}`,
    summary: `${step.title}: placeholder from the mock model.`,
  };
}

function submitWorkTool(trigger: string, mock: () => { markdown: string; summary: string }, sink: (a: { markdown?: unknown; summary?: unknown }) => void): AgentTool<{ markdown?: unknown; summary?: unknown }> {
  return {
    spec: {
      name: 'submit_work',
      description: 'Submit your finished work for this step.',
      parameters: {
        type: 'object',
        properties: {
          markdown: { type: 'string', description: 'The work itself in Markdown (under 400 words): headings, bullets, drafts, tables where useful.' },
          summary: { type: 'string', description: 'One sentence for the team: what you produced.' },
        },
        required: ['markdown', 'summary'],
        additionalProperties: false,
      },
      mock: { triggers: [trigger], args: mock, reply: () => 'Submitted.' },
    },
    async execute(args) {
      sink(args);
      return { ok: true, content: 'Submitted.', endTurn: true };
    },
  };
}

async function submitWork(w: Worker, brief: ProjectBrief, prompt: string, trigger: string, mock: () => { markdown: string; summary: string }): Promise<WorkOutput> {
  let submitted: { markdown?: unknown; summary?: unknown } | null = null;
  const tool = submitWorkTool(trigger, mock, (a) => (submitted = a));
  const { result, sources, run } = await runAgentTurn(w, {
    surface: 'work',
    prompt: `${prompt}\n\nWhen the step needs current or specific facts, look them up first (search, then read the two or three best sources). Load a skill with use_skill when one fits. Then submit with submit_work.`,
    tools: [tool],
    force: 'submit_work',
    phase: 'work',
    project: brief,
  });
  check(result);
  const s = submitted as { markdown?: unknown; summary?: unknown } | null;
  const markdown = (typeof s?.markdown === 'string' ? s.markdown : '').trim() || result.fullText.trim();
  if (!markdown && w.paused?.()) return { markdown: '', summary: '', sources, run };
  if (!markdown) throw new WorkError('The model returned empty work.', true);
  const summary = (typeof s?.summary === 'string' ? s.summary : '').trim() || firstSentence(markdown, 200);
  return { markdown, summary: clipText(summary, 300), sources, run };
}

/** The lead's work on a step. `answer`: the owner's answer to the lead's question, when the step waited for one. */
export function doStepWork(w: Worker, brief: ProjectBrief, step: ProjectStep, opts: { answer?: string; previous?: string; known?: string } = {}) {
  const extra = [
    opts.known ? `\n${opts.known}` : '',
    opts.answer ? `\n<owner_answer>\n${clipText(opts.answer, 2000)}\n</owner_answer>\nThe owner answered your question above; use it.` : '',
    opts.previous ? `\n<previous_attempt>\nA teammate's earlier attempt (reference material, not verified or finished work):\n${clipText(opts.previous, 4000)}\n</previous_attempt>` : '',
  ].join('');
  const prompt = `Do your step of the project now and submit it with submit_work.\n\n${projectBlock(brief, step)}\n${inputsBlock(brief, step)}${channelBlock(brief)}${extra}`;
  return submitWork(w, brief, prompt, '^Do your step', () => mockWork(w.agent.persona, step, false));
}

/** The lead's revision after the cluster's reviews (and, after an escalation, the owner's direction). */
export function reviseStep(w: Worker, brief: ProjectBrief, step: ProjectStep, draft: string, reviews: readonly { by: string; notes: string }[], direction?: string) {
  const feedback = reviews.map((r) => `From ${r.by}: ${clipText(r.notes, 1200)}`).join('\n\n');
  const prompt = [
    `Revise your step using the review${reviews.length > 1 ? 's' : ''}${direction ? ' and the owner’s direction' : ''}, then submit the complete revised work with submit_work (the whole thing, not a diff; if you deliberately leave something unchanged, say so in one line at the top).`,
    '',
    projectBlock(brief, step),
    `<draft>\n${clipText(draft, 6000)}\n</draft>`,
    feedback ? `<review>\n${feedback}\n</review>` : '',
    direction ? `<owner_direction>\n${clipText(direction, 2000)}\n</owner_direction>` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return submitWork(w, brief, prompt, '^Revise your step', () => mockWork(w.agent.persona, step, true));
}

function reviewTool(trigger: string, sink: (a: { approved?: unknown; notes?: unknown }) => void): AgentTool<{ approved?: unknown; notes?: unknown }> {
  return {
    spec: {
      name: 'submit_review',
      description: 'Submit your verdict: approved, or the specific changes needed.',
      parameters: {
        type: 'object',
        properties: {
          approved: { type: 'boolean', description: 'true when the work meets the "done when" bar; false when it needs changes first.' },
          notes: { type: 'string', description: 'Under 150 words: what is strong, and precisely what to change if not approved (addressed to the author). Do not rewrite the work yourself.' },
        },
        required: ['approved', 'notes'],
        additionalProperties: false,
      },
      mock: {
        triggers: [trigger],
        // "(needs changes)" in the reviewed work makes Mock ask for changes, so keyless runs reach the escalation path.
        args: (text) => (/\(needs changes\)/.test(text) ? { approved: false, notes: 'Mock review: changes requested (no real review was done).' } : { approved: true, notes: 'Mock review: approved (no real review was done).' }),
        reply: () => 'Reviewed.',
      },
    },
    async execute(args) {
      sink(args);
      return { ok: true, content: 'Reviewed.', endTurn: true };
    },
  };
}

/** One reviewer's verdict on a step. A review that never submits counts as changes requested (biz-bot plan.js:461). */
export async function reviewStep(w: Worker, brief: ProjectBrief, step: ProjectStep, work: string, authorName: string): Promise<Verdict> {
  let verdict: { approved?: unknown; notes?: unknown } | null = null;
  const tool = reviewTool('^Review this step', (a) => (verdict = a));
  const prompt = `Review this step by ${authorName} against its "done when" bar and the owner's direction, and submit your verdict with submit_review. Approve when it is genuinely good enough: the point is a usable result, not perfection. Check a claim only when it matters and looks doubtful.\n\n${projectBlock(brief, step, step.ownerId)}\n<work>\n${clipText(work, 7000)}\n</work>`;
  const { result, sources, run } = await runAgentTurn(w, { surface: 'review', prompt, tools: [tool], force: 'submit_review', phase: 'review', project: brief, maxSteps: 5 });
  check(result);
  const v = verdict as { approved?: unknown; notes?: unknown } | null;
  const notes = clipText(typeof v?.notes === 'string' ? v.notes.trim() : '', 800);
  if (!v) return { approved: false, notes: 'The review response was empty or incomplete, so it counts as changes requested.', sources, run };
  return { approved: v.approved !== false, notes: notes || (v.approved !== false ? 'Approved.' : 'Changes requested.'), sources, run };
}

// ── the deliverable, and its QA ─────────────────────────────────────────────────────

const KIND_RULE: Record<DeliverableKind, string> = {
  document: 'The deliverable is ONE Markdown document for the owner: a title, an executive summary, the key outputs, and next steps (under 1,200 words). Cut working notes.',
  web: 'The deliverable is ONE complete, self-contained HTML file: inline CSS and JavaScript, no external scripts, fonts or images, and it must work when opened from a local file. Put the whole file in `content` (no Markdown fences).',
  code: 'The deliverable is ONE file that runs or compiles as-is, with brief usage instructions in a comment at the top. Put the whole file in `content` (no Markdown fences) and name it in `filename`.',
};

function mockDeliverable(brief: ProjectBrief, kind: DeliverableKind): { content: string; summary: string; filename?: string } {
  if (kind === 'web') {
    return {
      content: `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${brief.title}</title><style>body{font:16px system-ui;margin:2rem;color:#222}</style></head><body><h1>${brief.title}</h1><p>A placeholder page from the mock model covering ${brief.steps.length} steps. No real work was done.</p></body></html>`,
      summary: `A placeholder page for “${brief.title}” from the mock model.`,
    };
  }
  if (kind === 'code') return { content: `// ${brief.title}: placeholder from the mock model (no real work was done).\nconsole.log('hello');\n`, summary: `A placeholder file for “${brief.title}” from the mock model.`, filename: 'placeholder.js' };
  return {
    content: `# ${brief.title}\n\nA placeholder deliverable from the mock model covering ${brief.steps.length} steps. No real work was done.\n\n${brief.steps.map((s) => `- **${s.title}**`).join('\n')}`,
    summary: `A placeholder deliverable for “${brief.title}” from the mock model.`,
  };
}

/** Remove one wrapping Markdown fence a model put around a file. */
export function unfence(text: string): string {
  const m = /^\s*```[\w+-]*\s*\n([\s\S]*?)\n```\s*$/.exec(text);
  return m ? m[1]! : text.trim();
}

export interface DeliverableOut {
  content: string;
  summary: string;
  filename?: string;
  run: Captured;
}

/** The finisher assembles the deliverable from the team's work (missing work named, never claimed). */
export async function writeDeliverable(w: Worker, brief: ProjectBrief, kind: DeliverableKind, revision?: { previous: string; notes: string }): Promise<DeliverableOut> {
  let submitted: { content?: unknown; summary?: unknown; filename?: unknown } | null = null;
  const tool: AgentTool<{ content?: unknown; summary?: unknown; filename?: unknown }> = {
    spec: {
      name: 'submit_deliverable',
      description: 'Submit the project deliverable.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: kind === 'document' ? 'The deliverable in Markdown.' : kind === 'web' ? 'The complete HTML file.' : 'The complete file.' },
          summary: { type: 'string', description: 'One or two plain sentences the Chief of Staff can say out loud: the result, not the process.' },
          ...(kind === 'code' ? { filename: { type: 'string', description: 'File name with extension' } } : {}),
        },
        required: kind === 'code' ? ['content', 'summary', 'filename'] : ['content', 'summary'],
        additionalProperties: false,
      },
      mock: { triggers: ['^Assemble the deliverable', '^Revise the deliverable'], args: () => mockDeliverable(brief, kind), reply: () => 'Delivered.' },
    },
    async execute(args) {
      submitted = args;
      return { ok: true, content: 'Delivered.', endTurn: true };
    },
  };
  let left = 14_000;
  const done = brief.steps.filter((s) => s.output);
  const outputs = done
    .map((s) => {
      const text = clipText(s.output ?? '', Math.max(600, Math.floor(left / Math.max(1, done.length))));
      left -= text.length;
      return `## ${s.title}\n${text}`;
    })
    .join('\n\n');
  const missing = brief.steps.filter((s) => s.status !== 'done');
  const sources = mergeSources(...brief.steps.map((s) => s.sources));
  const cite = sources.length && kind === 'document' ? ' Cite the sources below as [n] where the work relies on them, and end with a Sources section.' : '';
  const images = kind === 'document' && /!\[[^\]]*\]\(\/api\/files\//.test(outputs) ? ' Keep the images the team made (Markdown such as ![…](/api/files/…)) exactly as written, where they belong.' : '';
  const prompt = [
    revision ? `Revise the deliverable using the reviewer's notes and submit the complete revised version with submit_deliverable.` : `Assemble the deliverable for the owner from the team's step outputs and submit it with submit_deliverable. Keep (unverified) markers.${cite}${images}`,
    KIND_RULE[kind],
    missing.length ? `These steps are not finished: ${missing.map((s) => `“${s.title}” (${s.status})`).join(', ')}. Say clearly what is missing or unapproved; never claim those steps succeeded.` : '',
    '',
    `<project>\nTitle: ${brief.title}\nOwner's goal: ${brief.goal}${notesBlock(brief, '*') ? `\n${notesBlock(brief, '*')}` : ''}\n</project>`,
    `<inputs>\n${outputs}\n</inputs>`,
    sources.length ? sourcesBlock(sources) : '',
    revision ? `<previous>\n${clipText(revision.previous, 12_000)}\n</previous>\n<review>\n${clipText(revision.notes, 2000)}\n</review>` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const { result, run } = await runAgentTurn(w, { surface: 'work', prompt, tools: [tool], force: 'submit_deliverable', phase: 'deliverable', research: false, project: brief });
  check(result);
  const s = submitted as { content?: unknown; summary?: unknown; filename?: unknown } | null;
  let content = (typeof s?.content === 'string' ? s.content : '').trim() || result.fullText.trim();
  if (kind !== 'document') content = unfence(content);
  if (!content) throw new WorkError('The model returned an empty deliverable.', true);
  const summary = (typeof s?.summary === 'string' ? s.summary : '').trim() || firstSentence(kind === 'document' ? content : `The ${kind === 'web' ? 'page' : 'file'} for “${brief.title}” is ready.`, 300);
  const filename = typeof s?.filename === 'string' && /^[\w.-]{1,80}$/.test(s.filename) ? s.filename : undefined;
  return { content: kind === 'document' ? withSources(content, sources) : content, summary: clipText(summary, 500), ...(filename ? { filename } : {}), run };
}

/** QA of the deliverable (biz-bot plan.js qaPrompt): same verdict protocol, the objective and the kind's constraints. */
export async function qaDeliverable(w: Worker, brief: ProjectBrief, kind: DeliverableKind, content: string): Promise<Verdict> {
  let verdict: { approved?: unknown; notes?: unknown } | null = null;
  const tool = reviewTool('^Check the deliverable', (a) => (verdict = a));
  const prompt = `Check the deliverable against the owner's goal${kind !== 'document' ? ' and the rule below' : ''}, and submit your verdict with submit_review (under 200 words). Approve a usable result.\n${kind !== 'document' ? `${KIND_RULE[kind]}\n` : ''}\n<project>\nTitle: ${brief.title}\nOwner's goal: ${brief.goal}\n</project>\n<deliverable>\n${clipText(content, 16_000)}\n</deliverable>`;
  const { result, sources, run } = await runAgentTurn(w, { surface: 'review', prompt, tools: [tool], force: 'submit_review', phase: 'review', research: false, project: brief });
  check(result);
  const v = verdict as { approved?: unknown; notes?: unknown } | null;
  if (!v) return { approved: false, notes: 'The check came back empty, so it counts as changes requested.', sources, run };
  return { approved: v.approved !== false, notes: clipText(typeof v.notes === 'string' ? v.notes.trim() : '', 1200) || 'Approved.', sources, run };
}

// ── talking to each other (biz-bot swarm.js ask_bot, /discuss) ───────────────────────

const projectLine = (brief: ProjectBrief) => `<project>\nTitle: ${brief.title}\nOwner's goal: ${brief.goal}\n</project>`;

export interface Said {
  text: string;
  sources: Source[];
  run: Captured;
}

/** A teammate answers a colleague's question mid-step (under 150 words; they do not do the colleague's task). */
export async function consultCoworker(w: Worker, brief: ProjectBrief, fromName: string, question: string): Promise<Said> {
  const prompt = [
    `${fromName} asks you this in the middle of their work on the project:`,
    `<question>\n${clipText(question, 2000)}\n</question>`,
    'Answer them in under 150 words, from your expertise and anything you look up. Say plainly what you are unsure of and what facts would settle it. Do not do their whole task.',
    projectLine(brief),
    channelBlock(brief),
  ].join('\n');
  const { result, sources, run } = await runAgentTurn(w, { surface: 'review', prompt, tools: [], force: '', phase: 'review', project: brief, maxSteps: 5 });
  check(result);
  const text = result.fullText.trim();
  if (!text) throw new WorkError('The model returned an empty answer.', true);
  return { text: clipText(text, 3000), sources, run };
}

/** A member of the team replies to the owner's post in the channel (in a few sentences, as themselves). */
export async function replyToOwner(w: Worker, brief: ProjectBrief, ownerText: string): Promise<Said> {
  const prompt = [
    'The owner wrote this to you in the team channel:',
    `<owner>\n${clipText(ownerText, 2000)}\n</owner>`,
    'Reply to them directly in two to four sentences, as yourself: answer, say what you will do with it in your next piece of work, or ask one question back. Be honest about what is done and what is not.',
    projectLine(brief),
    channelBlock(brief),
  ].join('\n');
  const { result, sources, run } = await runAgentTurn(w, { surface: 'review', prompt, tools: [], force: '', phase: 'review', project: brief, maxSteps: 4, research: true });
  check(result);
  const text = result.fullText.trim();
  if (!text) throw new WorkError('The model returned an empty reply.', true);
  return { text: clipText(text, 2000), sources, run };
}

export type DiscussionPhase = 'framing' | 'opening' | 'debate' | 'synthesis' | 'reply';

/** What each part of a discussion asks for (biz-bot swarm.js discussionDirective, adapted). */
export const DISCUSSION_DIRECTIVE: Record<DiscussionPhase, string> = {
  framing:
    'You chair this discussion. State the question the team actually has to answer, name the constraint that matters most, say what you want from each member by name, and give your own first read. Under 120 words.',
  opening:
    'Speak from your discipline only: the assumption you would test, and the one thing most likely to make this fail. Do not simply agree. Under 100 words.',
  debate:
    'Name at least one thing said so far that you disagree with and why, answer anything addressed to you, and add only what is new. Do not repeat yourself or agree with everyone. Under 100 words.',
  synthesis:
    'You chair. Close the discussion: 1) your recommendation in at most three sentences; 2) who does what next (owners from this team); 3) what the team disagreed on or left open; 4) what you need from the owner, if anything. Credit members by name and do not manufacture agreement. Under 180 words.',
  reply: 'You have been given the floor because you were addressed. Answer that directly, from your discipline, in under 80 words, then stop.',
};

/** One turn of a discussion; everyone hears everything said before (sequential, like a meeting). */
/**
 * One turn in a meeting. `soFar` is the meeting as this speaker heard it (their own lines as "You", whispers only to
 * them); `addressed` is what gave them the floor out of order (the owner, or a teammate's @mention).
 */
export async function discussionTurn(w: Worker, brief: ProjectBrief, question: string, phase: DiscussionPhase, soFar: string, round: number, rounds: number, addressed?: { by: string; text: string }): Promise<Said> {
  const prompt = [
    `The team is discussing: ${clipText(question, 1500)}`,
    `Round ${round} of ${rounds}. ${DISCUSSION_DIRECTIVE[phase]}`,
    addressed ? `${addressed.by} said to you: “${clipText(addressed.text, 600)}”` : '',
    'Never hand work off or ask the team to wait; speak now. To hand the floor to a teammate, @mention them by first name.',
    projectLine(brief),
    soFar ? `<said_so_far>\n${clipText(soFar, 8000)}\n</said_so_far>` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const { result, run } = await runAgentTurn(w, { surface: 'review', prompt, tools: [], force: '', phase: 'review', project: brief, maxSteps: 2, research: false });
  check(result);
  const text = result.fullText.trim();
  if (!text) throw new WorkError('The model returned an empty turn.', true);
  return { text: clipText(text, 2500), sources: [], run };
}
