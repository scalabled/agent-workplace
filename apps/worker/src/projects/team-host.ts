// Team projects inside the Everyday ProjectDO. The ProjectDO lends its SQLite, ledger (frames mirrored to the owner
// feed), alarm and model registry; this module owns the tables and the lifecycle (biz-bot parity: plan.js executePlan):
//   propose → planning (the lead drafts the plan from the playbook, on the next tick, so the Chief never waits) →
//   proposed (a raised hand) → running: up to three ready steps at once, each a cluster — the lead works, co-owners and
//   reviewers review in parallel, the lead revises once; changes still wanted → the owner decides (accept, or give
//   direction for a fresh revision). A lead can ask the owner a question (only that step waits). A failed attempt
//   passes to the next owner; a step whose input failed is skipped. Then the finisher writes the deliverable
//   (document, web page or code file), a reviewer checks it (one revision), and the project ends done — or partial
//   when steps failed, never falsely "done".
// The owner steers without stopping anyone (notes reach the next step; pause lets steps under way finish), edits the
// plan while it is proposed or paused, and sees every model call (the run inspector). A token budget pauses the
// project with a raised hand. A cancel bumps the fence, so a late result from an aborted call is discarded.
import { fullIndex } from '@headcount/catalog/full';
import type { Persona } from '@headcount/catalog';
import type { AgentTool } from '@headcount/agent-loop';
import { MissingProviderError, deadlineSignal } from '@headcount/models';
import type { FrameInput, FrameType } from '@headcount/protocol';
import type { ProjectUsage, RunTrace } from '@headcount/protocol/ext/agents';
import {
  DECISION_ANSWER_MAX,
  OUTPUT_FRAME_MAX,
  PROJECT_NOTE_MAX,
  type Decision,
  type DecisionAnswer,
  type DecisionKind,
  type DeliverableKind,
  type PlanEdit,
  type ProjectNote,
  type ProjectStep,
  type StaffingContext,
  type StepEdit,
  type StepVerdict,
  type TeamMember,
  type TeamProjectSnapshot,
  type TeamProjectStatus,
} from '@headcount/protocol/ext/projects';
import { agentOf, resolveAgentModel } from '../agents/agent';
import type { AgentSetup } from '../agents/store';
import type { Env } from '../env';
import { clipText } from '../jobs/job-view';
import { WorkCancelled, WorkError } from '../jobs/work-loop';
import { DailyCounter, dailyLimit, limitMessage } from '../lib/limits';
import { researchKitFactory } from '../tools/kit';
import { mergeSources, type Source } from '../tools/web-search';
import { logError, runtime } from '../workspace/runtime';
import { MAX_EDITED_STEPS, forecastOf, forecastSentence, normalizePlan, ownersOf, readySteps, recipesOf, shortlist, staffingNote, stepEditError, stepsFrom, teamFrom, titleFromGoal, type Recipe } from './staffing';
import { chooseRecipe, consultCoworker, discussionTurn, doStepWork, planProject, qaDeliverable, replyToOwner, reviewStep, reviseStep, writeDeliverable, type Captured, type DiscussionPhase, type ProjectBrief, type Worker } from './team-work';
import { TeamChannel, mentionsIn } from './channel';
import { MAX_ADDED_SPECIALISTS, MAX_TEAM, collabTools, type CollabHost } from './collab';
import { words } from './staffing';
import type { ChannelEntry, ConnectorScope } from '@headcount/protocol/ext/projects';
import type { ConnectorAsk } from '@headcount/protocol/ext/connectors';
import type { AutomationSpec } from '@headcount/protocol/ext/automations';
import { describeSpec } from '../automations/host';
import type { ConnectorCallRequest, ConnectorCallResult, ConnectorGrantRequest } from '../connectors/store';
import { connectorTools, type ApprovalMode } from '../connectors/tools';

export const MAX_PARALLEL = 3;
export const MAX_ACTIVE_PROJECTS_DEFAULT = 2;
/** Tries per step before it fails (the second goes to the next owner). */
export const MAX_STEP_ATTEMPTS = 2;
/** Revisions before reviewers' remaining changes go to the owner. */
export const MAX_REVISIONS = 1;
export const PROJECT_TOKEN_BUDGET_DEFAULT = 1_500_000;
const MAX_ATTEMPTS = 3;
const UNIT_BUDGET_MS = 600_000;
const GOAL_MAX = 2000;
const RUNS_KEPT = 120;
/** A project waiting on the owner is not ticked. */
const IDLE = Number.MAX_SAFE_INTEGER;

export interface ProposeRequest {
  goal: string;
  title?: string;
  opId?: string;
  chiefName: string;
  /** The Chief of Staff's lead: their voices are kept free so they can join any team meeting. */
  leadId?: string | null;
  deliverableKind?: DeliverableKind;
  /** Started by an automation; autoStart skips the plan approval (the owner set that up). */
  automation?: { automationId: string; name: string; autoStart: boolean };
}

export type ProjectRefusal = { accepted: false; code: 'not_found' | 'conflict' | 'bad_request' | 'rate_limited' | 'not_configured'; message: string };
type Ok = { accepted: true; project: TeamProjectSnapshot };

export interface TeamHostPorts {
  storage: DurableObjectStorage;
  env: Env;
  usage: DailyCounter;
  append<T extends FrameType>(input: FrameInput<T>): void;
  /** Mirror frames to the owner feed now (single-flight in the ProjectDO). */
  flush(): Promise<void>;
  armAlarm(at: number): Promise<void>;
  /** The owner's overrides for these coworkers (WorkspaceDO); absent in tests → catalog defaults. */
  agents?(personaIds: string[]): Promise<AgentSetup>;
  /** Keep work alive after the request that started it answered (ctx.waitUntil). */
  background?(work: Promise<unknown>): void;
  /** Connector calls and the owner's grants run in the WorkspaceDO, where the keys are (Stage 5). */
  connectors?: {
    call(req: ConnectorCallRequest): Promise<ConnectorCallResult>;
    grant(req: ConnectorGrantRequest): Promise<void>;
  };
  /** Set up an automation the Chief proposed, once the owner allows it (stage 3b). */
  automations?: {
    create(spec: AutomationSpec): { ok: true; name: string } | { ok: false; message: string };
  };
}

type ProjectRow = {
  project_id: string;
  op_id: string | null;
  title: string;
  goal: string;
  recipe_id: string | null;
  recipe_name: string | null;
  staffing_note: string;
  team: string;
  status: string;
  decision_id: string | null;
  deliverable: string | null;
  summary: string | null;
  error: string | null;
  chief_name: string;
  fence: number;
  attempts: number;
  next_at: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  deliverable_kind: string | null;
  finisher_id: string | null;
  deliverable_filename: string | null;
  qa: string | null;
  budget_tokens: number | null;
  automation: string | null;
  final_direction: string | null;
  lead_id: string | null;
  kickoff: string | null;
  pending_discussion: string | null;
  discussion_state: string | null;
  added_count: number | null;
};
type StepRow = {
  project_id: string;
  step_id: string;
  idx: number;
  title: string;
  brief: string;
  acceptance: string;
  owner_id: string;
  reviewer_ids: string;
  depends_on: string;
  status: string;
  output: string | null;
  verdict: string | null;
  revised: number;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  sources: string | null;
  co_owner_ids: string | null;
  by_id: string | null;
  reviews: string | null;
  attempts: number | null;
  question: string | null;
  answer: string | null;
  direction: string | null;
  draft: string | null;
  revisions: number | null;
};
type NoteRow = { note_id: string; project_id: string; op_id: string | null; to_id: string | null; via: string; text: string; status: string; at: string; applied_at: string | null; applied_step: string | null; from_id: string | null };
type DecisionRow = { decision_id: string; kind: string; project_id: string; title: string; body: string; status: string; created_at: string; resolved_at: string | null; step_id: string | null; from_id: string | null; answer: string | null; meta: string | null; scope: string | null };
type RunRow = { run_id: string; project_id: string; step_id: string | null; phase: string; persona_id: string; at: string; in_tokens: number; out_tokens: number; usd: number | null; data: string };

export const TEAM_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tprojects (
     project_id TEXT PRIMARY KEY, op_id TEXT, title TEXT NOT NULL, goal TEXT NOT NULL,
     recipe_id TEXT, recipe_name TEXT, staffing_note TEXT NOT NULL, team TEXT NOT NULL,
     status TEXT NOT NULL, decision_id TEXT, deliverable TEXT, summary TEXT, error TEXT, chief_name TEXT NOT NULL,
     fence INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tprojects_op ON tprojects (op_id) WHERE op_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS tsteps (
     project_id TEXT NOT NULL, step_id TEXT NOT NULL, idx INTEGER NOT NULL, title TEXT NOT NULL, brief TEXT NOT NULL,
     acceptance TEXT NOT NULL, owner_id TEXT NOT NULL, reviewer_ids TEXT NOT NULL, depends_on TEXT NOT NULL,
     status TEXT NOT NULL, output TEXT, verdict TEXT, revised INTEGER NOT NULL DEFAULT 0,
     started_at TEXT, finished_at TEXT, error TEXT, PRIMARY KEY (project_id, step_id))`,
  `CREATE TABLE IF NOT EXISTS tdecisions (
     decision_id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
     status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS tnotes (
     note_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, op_id TEXT, to_id TEXT, via TEXT NOT NULL, text TEXT NOT NULL,
     status TEXT NOT NULL, at TEXT NOT NULL, applied_at TEXT, applied_step TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tnotes_op ON tnotes (op_id) WHERE op_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS truns (
     run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, step_id TEXT, phase TEXT NOT NULL, persona_id TEXT NOT NULL,
     at TEXT NOT NULL, in_tokens INTEGER NOT NULL DEFAULT 0, out_tokens INTEGER NOT NULL DEFAULT 0, usd REAL, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS truns_project ON truns (project_id, at)`,
];

/** Columns added after a table first shipped (each runs once; "duplicate column" means it already ran). */
const TEAM_MIGRATIONS = [
  'ALTER TABLE tsteps ADD COLUMN sources TEXT',
  'ALTER TABLE tsteps ADD COLUMN co_owner_ids TEXT',
  'ALTER TABLE tsteps ADD COLUMN by_id TEXT',
  'ALTER TABLE tsteps ADD COLUMN reviews TEXT',
  'ALTER TABLE tsteps ADD COLUMN attempts INTEGER',
  'ALTER TABLE tsteps ADD COLUMN question TEXT',
  'ALTER TABLE tsteps ADD COLUMN answer TEXT',
  'ALTER TABLE tsteps ADD COLUMN direction TEXT',
  'ALTER TABLE tsteps ADD COLUMN draft TEXT',
  'ALTER TABLE tsteps ADD COLUMN revisions INTEGER',
  'ALTER TABLE tprojects ADD COLUMN deliverable_kind TEXT',
  'ALTER TABLE tprojects ADD COLUMN finisher_id TEXT',
  'ALTER TABLE tprojects ADD COLUMN deliverable_filename TEXT',
  'ALTER TABLE tprojects ADD COLUMN qa TEXT',
  'ALTER TABLE tprojects ADD COLUMN budget_tokens INTEGER',
  'ALTER TABLE tprojects ADD COLUMN final_direction TEXT',
  'ALTER TABLE tprojects ADD COLUMN lead_id TEXT',
  'ALTER TABLE tdecisions ADD COLUMN step_id TEXT',
  'ALTER TABLE tdecisions ADD COLUMN from_id TEXT',
  'ALTER TABLE tdecisions ADD COLUMN answer TEXT',
  'ALTER TABLE tdecisions ADD COLUMN meta TEXT',
  'ALTER TABLE tprojects ADD COLUMN automation TEXT',
  'ALTER TABLE tdecisions ADD COLUMN scope TEXT',
  'ALTER TABLE tprojects ADD COLUMN kickoff TEXT',
  'ALTER TABLE tprojects ADD COLUMN pending_discussion TEXT',
  'ALTER TABLE tprojects ADD COLUMN discussion_state TEXT',
  'ALTER TABLE tprojects ADD COLUMN added_count INTEGER',
  'ALTER TABLE tnotes ADD COLUMN from_id TEXT',
];

/** A discussion to hold: the kickoff (teams of three or more) or one the owner asked for. */
interface PendingDiscussion {
  question: string;
  rounds: number;
  kind: 'kickoff' | 'discussion';
}

/** Projects under way: they count toward the cap, take notes, and show on the Floor. */
const ACTIVE = `('planning','proposed','running','paused','needs_review')`;
/** A step that finished (well or not): nothing more will happen to it. */
const TERMINAL = new Set(['done', 'failed', 'skipped']);

const iso = () => new Date(runtime.now()).toISOString();
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
const firstOf = (name: string) => name.split(/\s+/)[0] ?? name;
const json = <T>(v: string | null | undefined, fallback: T): T => {
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

function maxActiveProjects(env: Env): number {
  const n = Number(env.MAX_ACTIVE_PROJECTS);
  return env.MAX_ACTIVE_PROJECTS && Number.isInteger(n) && n >= 0 ? n : MAX_ACTIVE_PROJECTS_DEFAULT;
}

const scopeOf = (v: unknown): ConnectorScope => (v === 'project' || v === 'always' ? v : 'once');
const SCOPE_WORDS: Record<ConnectorScope, string> = { once: 'Allowed once.', project: 'Allowed for this project.', always: 'Always allowed.' };

function tokenBudget(env: Env): number {
  const n = Number(env.PROJECT_TOKEN_BUDGET);
  return env.PROJECT_TOKEN_BUDGET && Number.isFinite(n) && n > 0 ? Math.floor(n) : PROJECT_TOKEN_BUDGET_DEFAULT;
}

/** `request_owner_input` (biz-bot tools.js:98-105): the lead pauses this step for the owner; other steps continue. */
function askOwnerTool(sink: (q: { text: string; detail?: string }) => void): AgentTool<{ question?: unknown; detail?: unknown }> {
  return {
    spec: {
      name: 'request_owner_input',
      description:
        'Pause this step for a decision, missing input or permission only the owner can give. Other steps continue. Ask one specific question and explain why it is needed; put the options and your recommendation in detail.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'One specific question for the owner' },
          detail: { type: 'string', description: 'Why it is needed, the options, and your recommendation' },
        },
        required: ['question'],
        additionalProperties: false,
      },
      mock: { triggers: [String.raw`\(needs the owner\)`], args: () => ({ question: 'Which option should we go with?', detail: 'Mock question: two options, and I recommend the first.' }), reply: () => 'Asked.' },
    },
    async execute(args) {
      const text = typeof args.question === 'string' ? args.question.trim().slice(0, 500) : '';
      if (!text) return { ok: false, error: 'Ask one specific question.' };
      sink({ text, ...(typeof args.detail === 'string' && args.detail.trim() ? { detail: args.detail.trim().slice(0, 2000) } : {}) });
      return { ok: true, content: 'The owner has been asked. Stop here; you will continue with their answer.', endTurn: true };
    },
  };
}

export class TeamProjects {
  private readonly inflight = new Map<string, AbortController>();
  private readonly index = fullIndex;
  readonly channel: TeamChannel;

  constructor(private readonly p: TeamHostPorts) {
    for (const stmt of TEAM_SCHEMA) p.storage.sql.exec(stmt);
    this.channel = new TeamChannel(p.storage.sql, (input) => p.append(input), iso);
    for (const stmt of TEAM_MIGRATIONS) {
      try {
        p.storage.sql.exec(stmt);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
  }

  private get sql() {
    return this.p.storage.sql;
  }

  // ── RPC ───────────────────────────────────────────────────────────────────────────

  /**
   * Staff a team and start planning (the lead drafts the plan on the next tick; the raised hand follows). Idempotent
   * by opId. Only the playbook choice (fast tier) runs before this returns.
   */
  async propose(req: ProposeRequest): Promise<{ project: TeamProjectSnapshot; decision: Decision | null } | ProjectRefusal> {
    const goal = (req.goal ?? '').replace(/\s+/g, ' ').trim().slice(0, GOAL_MAX);
    if (goal.length < 8) return { accepted: false, code: 'bad_request', message: 'Say in a sentence what the team should deliver.' };
    if (req.opId) {
      const prior = this.sql.exec<ProjectRow>('SELECT * FROM tprojects WHERE op_id = ?', req.opId).toArray()[0];
      if (prior) return { project: this.snapshot(prior), decision: prior.decision_id ? this.decision(prior.decision_id) : null };
    }
    const active = Number(this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM tprojects WHERE status IN ${ACTIVE}`).toArray()[0]?.n ?? 0);
    const max = maxActiveProjects(this.p.env);
    if (active >= max) return { accepted: false, code: 'conflict', message: `${active} team projects are already under way (the most at once is ${max}). Finish or cancel one first.` };
    const now = runtime.now();
    const daily = dailyLimit(this.p.env, 'project');
    if (!this.p.usage.take('project', daily, now).allowed) return { accepted: false, code: 'rate_limited', message: limitMessage('project', daily) };

    // Choose the recipe: the fast model picks from a keyword shortlist; keyword order is the fallback (and Mock's pick).
    const recipes = recipesOf(this.index.catalog);
    const list = shortlist(goal, recipes, 12);
    let recipe: Recipe | undefined = list[0];
    let title = (req.title ?? '').trim();
    try {
      const resolved = runtime.registry(this.p.env).resolve('chat', { tier: 'fast', needs: ['tools'] });
      const pick = await chooseRecipe({ provider: resolved.provider, model: resolved.model, signal: deadlineSignal(30_000) }, goal, list);
      if (pick) {
        recipe = list.find((r) => r.id === pick.recipeId) ?? recipe;
        if (!title && pick.title) title = pick.title;
      }
    } catch (err) {
      if (err instanceof MissingProviderError) return { accepted: false, code: 'not_configured', message: err.message };
      logError('project.choose', err); // keep the keyword pick
    }
    if (!recipe) return { accepted: false, code: 'not_found', message: 'No team playbook fits that goal yet.' };
    const lead = req.leadId ? this.index.lead(req.leadId) : undefined;
    const team = teamFrom(recipe, (id) => this.index.persona(id), { lead, table: this.index.catalog.voices });
    if (team.length < 2) return { accepted: false, code: 'not_found', message: 'That playbook has no team in the catalog.' };
    const steps = stepsFrom(recipe, team, goal);
    title = (title || titleFromGoal(goal)).slice(0, 80);
    const projectId = newId('prj');
    const at = iso();
    const note = staffingNote(team, recipe.name);
    const finisher = team.find((m) => m.role === 'lead')?.personaId ?? team[0]!.personaId;
    this.sql.exec(
      `INSERT INTO tprojects (project_id, op_id, title, goal, recipe_id, recipe_name, staffing_note, team, status, chief_name, created_at, updated_at, next_at, deliverable_kind, finisher_id, budget_tokens, lead_id, automation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planning', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId, req.opId ?? null, title, goal, recipe.id, recipe.name, note, JSON.stringify(team), req.chiefName, at, at, now, req.deliverableKind ?? null, finisher, tokenBudget(this.p.env), req.leadId ?? null, req.automation ? JSON.stringify(req.automation) : null,
    );
    this.writeSteps(projectId, steps);
    this.emit(projectId);
    await this.p.armAlarm(now + 10);
    void this.p.flush();
    return { project: this.snapshot(this.row(projectId)!), decision: null };
  }

  /** The owner approved the plan: start work on the next alarm. */
  async approve(projectId: string, by?: string): Promise<Ok | ProjectRefusal> {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (row.status === 'running') return { accepted: true, project: this.snapshot(row) };
    if (row.status === 'planning') return { accepted: false, code: 'conflict', message: 'The plan is still being drafted; it will be in your Inbox in a moment.' };
    if (row.status !== 'proposed') return { accepted: false, code: 'conflict', message: `That project is ${row.status}.` };
    const at = iso();
    // Teams of three or more hold a kickoff before the first step (FORMATION: meetings).
    const kickoff = (JSON.parse(row.team) as TeamMember[]).length >= 3 && (this.p.env.KICKOFF ?? '').toLowerCase() !== 'off' ? 'pending' : 'skipped';
    this.sql.exec(`UPDATE tprojects SET status = 'running', next_at = ?, updated_at = ?, kickoff = COALESCE(kickoff, ?) WHERE project_id = ?`, runtime.now(), at, kickoff, projectId);
    if (row.decision_id) this.resolve(row.decision_id, 'approved', at);
    this.channel.add(projectId, { kind: 'decision', fromId: 'owner', text: by ?? 'The owner approved the plan. Work starts now.' });
    this.emit(projectId);
    await this.p.armAlarm(runtime.now() + 10);
    void this.p.flush();
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  /** Stop a project for good (or decline its plan). Aborts in-flight calls; late results are fenced out. */
  async cancel(projectId: string, reason = 'Stopped by the owner.'): Promise<Ok | ProjectRefusal> {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (['done', 'partial', 'failed', 'cancelled'].includes(row.status)) return { accepted: true, project: this.snapshot(row) };
    const at = iso();
    this.sql.exec(`UPDATE tprojects SET status = 'cancelled', error = ?, fence = fence + 1, updated_at = ?, finished_at = ? WHERE project_id = ?`, reason, at, at, projectId);
    this.sql.exec(`UPDATE tsteps SET status = 'waiting' WHERE project_id = ? AND status IN ('working','reviewing','revising')`, projectId);
    for (const d of this.sql.exec<DecisionRow>(`SELECT * FROM tdecisions WHERE project_id = ? AND status = 'open'`, projectId).toArray()) this.resolve(d.decision_id, 'declined', at);
    this.inflight.get(projectId)?.abort();
    this.emit(projectId);
    void this.p.flush();
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  /**
   * Direction from the owner for a project under way: queued, then picked up by the next step that starts (the whole
   * team's, or only `toId`'s). Idempotent by opId.
   */
  note(projectId: string, req: { text: string; toId?: string; via: ProjectNote['via']; opId?: string; fromId?: string }): { accepted: true; project: TeamProjectSnapshot; note: ProjectNote } | ProjectRefusal {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (req.opId) {
      const prior = this.sql.exec<NoteRow>('SELECT * FROM tnotes WHERE op_id = ?', req.opId).toArray()[0];
      if (prior) return { accepted: true, project: this.snapshot(row), note: this.toNote(prior) };
    }
    if (!['planning', 'proposed', 'running', 'paused', 'needs_review'].includes(row.status)) return { accepted: false, code: 'conflict', message: `“${row.title}” is ${row.status === 'done' ? 'finished' : row.status}; there is no work left to steer.` };
    const text = (req.text ?? '').replace(/\s+/g, ' ').trim().slice(0, PROJECT_NOTE_MAX);
    if (!text) return { accepted: false, code: 'bad_request', message: 'Say what the team should know.' };
    const team = JSON.parse(row.team) as TeamMember[];
    if (req.toId && !team.some((m) => m.personaId === req.toId)) return { accepted: false, code: 'bad_request', message: 'That person is not on this project.' };
    const noteId = newId('note');
    const at = iso();
    this.sql.exec(`INSERT INTO tnotes (note_id, project_id, op_id, to_id, via, text, status, at, from_id) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`, noteId, projectId, req.opId ?? null, req.toId ?? null, req.via, text, at, req.fromId ?? null);
    // The owner's direction is part of the team's record (a teammate's hand-off and a channel post already are).
    if (req.via !== 'teammate' && req.via !== 'channel') this.channel.add(projectId, { kind: 'owner', fromId: 'owner', ...(req.toId ? { toId: req.toId } : {}), text });
    this.sql.exec('UPDATE tprojects SET updated_at = ? WHERE project_id = ?', at, projectId);
    this.emit(projectId);
    void this.p.flush();
    const note = this.toNote(this.sql.exec<NoteRow>('SELECT * FROM tnotes WHERE note_id = ?', noteId).toArray()[0]!);
    return { accepted: true, project: this.snapshot(this.row(projectId)!), note };
  }

  /** Pause: steps under way finish; nothing new starts until resume. */
  pause(projectId: string): Ok | ProjectRefusal {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (row.status === 'paused') return { accepted: true, project: this.snapshot(row) };
    if (row.status !== 'running') return { accepted: false, code: 'conflict', message: `Only a running project can pause; “${row.title}” is ${row.status}.` };
    this.sql.exec(`UPDATE tprojects SET status = 'paused', updated_at = ? WHERE project_id = ?`, iso(), projectId);
    this.emit(projectId);
    void this.p.flush();
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  async resume(projectId: string): Promise<Ok | ProjectRefusal> {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (row.status === 'running') return { accepted: true, project: this.snapshot(row) };
    if (row.status !== 'paused') return { accepted: false, code: 'conflict', message: `Only a paused project can resume; “${row.title}” is ${row.status}.` };
    const used = this.usage(projectId);
    if (used.input + used.output >= (row.budget_tokens ?? tokenBudget(this.p.env))) return { accepted: false, code: 'conflict', message: 'The project has used its token budget; raise it in the Inbox first.' };
    this.sql.exec(`UPDATE tprojects SET status = 'running', next_at = ?, updated_at = ? WHERE project_id = ?`, runtime.now(), iso(), projectId);
    this.emit(projectId);
    await this.p.armAlarm(runtime.now() + 10);
    void this.p.flush();
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  /** The owner answers a raised hand: approve, decline, or words (an answer, or direction). */
  async answer(decisionId: string, a: DecisionAnswer): Promise<{ accepted: true; decision: Decision; project?: TeamProjectSnapshot } | ProjectRefusal> {
    const d = this.sql.exec<DecisionRow>('SELECT * FROM tdecisions WHERE decision_id = ?', decisionId).toArray()[0];
    if (!d) return { accepted: false, code: 'not_found', message: 'No such decision.' };
    if (d.status !== 'open') return { accepted: false, code: 'conflict', message: 'That was already decided.' };
    const kind0 = d.kind as DecisionKind;
    if (kind0 === 'connector' && !d.project_id) return this.answerChief(d, a);
    if (kind0 === 'automation') return this.answerAutomation(d, a);
    if (!this.row(d.project_id)) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (!['approve', 'decline', 'answer'].includes(a.action)) return { accepted: false, code: 'bad_request', message: 'Approve, decline or answer.' };
    const text = (a.text ?? '').trim().slice(0, DECISION_ANSWER_MAX);
    const at = iso();
    const kind = d.kind as DecisionKind;
    if (kind === 'plan_approval') {
      if (a.action === 'answer') return { accepted: false, code: 'bad_request', message: 'Approve or decline the plan (or edit it first).' };
      const r = a.action === 'approve' ? await this.approve(d.project_id) : await this.cancel(d.project_id, 'The owner declined the plan.');
      if (!r.accepted) return r;
      return { accepted: true, decision: this.decision(decisionId)!, project: r.project };
    }
    if (a.action === 'answer' && !text) return { accepted: false, code: 'bad_request', message: 'Say it in a few words.' };
    const step = d.step_id ? this.stepRow(d.project_id, d.step_id) : undefined;
    if (kind === 'input' && step) {
      const answer = a.action === 'answer' ? text : a.action === 'approve' ? 'Yes, go ahead with your recommendation.' : 'The owner would rather not decide this; proceed with reasonable assumptions and state them.';
      this.sql.exec(`UPDATE tsteps SET status = 'waiting', answer = ?, question = NULL, draft = NULL WHERE project_id = ? AND step_id = ?`, answer, d.project_id, d.step_id);
    } else if (kind === 'review' && step) {
      if (a.action === 'answer') this.sql.exec(`UPDATE tsteps SET status = 'waiting', direction = ?, revisions = 0 WHERE project_id = ? AND step_id = ?`, text, d.project_id, d.step_id);
      else this.sql.exec(`UPDATE tsteps SET status = 'done', output = draft, draft = NULL, finished_at = ?, error = NULL WHERE project_id = ? AND step_id = ?`, at, d.project_id, d.step_id);
    } else if (kind === 'deliverable') {
      if (a.action === 'answer') this.sql.exec(`UPDATE tprojects SET status = 'running', final_direction = ?, next_at = ? WHERE project_id = ?`, text, runtime.now(), d.project_id);
      else this.sql.exec(`UPDATE tprojects SET status = ?, finished_at = ? WHERE project_id = ?`, this.endStatus(d.project_id), at, d.project_id);
    } else if (kind === 'connector') {
      const ask = JSON.parse(d.meta ?? '{}') as ConnectorAsk;
      const scope = scopeOf(a.scope);
      if (a.action === 'approve') await this.p.connectors?.grant({ connectorId: ask.connectorId, tool: ask.tool, scope, subject: ask.subject, projectId: d.project_id });
      if (step) {
        const answer =
          a.action === 'approve'
            ? `The owner allowed ${ask.name} → ${ask.tool}${scope === 'once' ? ' for this call' : scope === 'project' ? ' for this project' : ''}. Call it again now and carry on.`
            : a.action === 'answer'
              ? `The owner did not allow ${ask.name} → ${ask.tool} and said: ${text}`
              : `The owner did not allow ${ask.name} → ${ask.tool}. Carry on without it and say what is missing.`;
        this.sql.exec(`UPDATE tsteps SET status = 'waiting', answer = ?, question = NULL, draft = NULL WHERE project_id = ? AND step_id = ?`, answer, d.project_id, d.step_id);
      }
    } else if (kind === 'budget' && a.action === 'approve') {
      this.sql.exec(`UPDATE tprojects SET budget_tokens = COALESCE(budget_tokens, ?) + ?, status = 'running', next_at = ? WHERE project_id = ?`, tokenBudget(this.p.env), tokenBudget(this.p.env), runtime.now(), d.project_id);
    }
    this.sql.exec(
      `UPDATE tdecisions SET status = ?, resolved_at = ?, answer = ?, scope = ? WHERE decision_id = ?`,
      a.action === 'answer' ? 'answered' : a.action === 'approve' ? 'approved' : 'declined', at, a.action === 'answer' ? text : null, kind === 'connector' && a.action === 'approve' ? scopeOf(a.scope) : null, decisionId,
    );
    this.channel.add(d.project_id, {
      kind: 'decision',
      fromId: 'owner',
      ...(d.from_id ? { toId: d.from_id } : {}),
      ...(d.step_id ? { stepId: d.step_id } : {}),
      text: `${d.title} — ${a.action === 'answer' ? text : a.action === 'approve' ? (kind === 'budget' ? 'Raised the budget.' : kind === 'input' ? 'Go with your recommendation.' : kind === 'connector' ? SCOPE_WORDS[scopeOf(a.scope)] : 'Accepted as it is.') : kind === 'budget' ? 'Kept it paused.' : kind === 'connector' ? 'Not allowed.' : 'Declined.'}`,
    });
    this.sql.exec(`UPDATE tprojects SET updated_at = ? WHERE project_id = ?`, at, d.project_id);
    const resolved = this.decision(decisionId)!;
    this.p.append({ type: 'decision.resolved', data: { decision: resolved } });
    const fresh = this.row(d.project_id)!;
    if (fresh.status === 'running') {
      this.sql.exec('UPDATE tprojects SET next_at = ? WHERE project_id = ?', runtime.now(), d.project_id);
      await this.p.armAlarm(runtime.now() + 10);
    }
    this.emit(d.project_id);
    void this.p.flush();
    return { accepted: true, decision: resolved, project: this.snapshot(this.row(d.project_id)!) };
  }

  /** The Chief of Staff proposes an automation (a raised hand with no project); approving it sets it up. */
  openChiefAutomation(spec: AutomationSpec, title: string): Decision {
    const decisionId = newId('dec');
    const describe = describeSpec(spec);
    this.sql.exec(
      `INSERT INTO tdecisions (decision_id, kind, project_id, title, body, status, created_at, meta) VALUES (?, 'automation', '', ?, ?, 'open', ?, ?)`,
      decisionId, clipText(title, 300), clipText(`${describe}.\n\n${spec.action.goal}`, 4000), iso(), JSON.stringify({ ...spec, describe }),
    );
    const d = this.decision(decisionId)!;
    this.p.append({ type: 'decision.opened', data: { decision: d } });
    void this.p.flush();
    return d;
  }

  /** The owner answers the Chief of Staff's connector ask: a grant (once or always), or no. */
  private async answerChief(d: DecisionRow, a: DecisionAnswer): Promise<{ accepted: true; decision: Decision } | ProjectRefusal> {
    if (!['approve', 'decline', 'answer'].includes(a.action)) return { accepted: false, code: 'bad_request', message: 'Allow or decline.' };
    const ask = JSON.parse(d.meta ?? '{}') as ConnectorAsk;
    // No project: "for this project" means this call.
    const scope = a.scope === 'always' ? 'always' : 'once';
    if (a.action === 'approve') await this.p.connectors?.grant({ connectorId: ask.connectorId, tool: ask.tool, scope, subject: ask.subject });
    const text = (a.text ?? '').trim().slice(0, DECISION_ANSWER_MAX);
    this.sql.exec(
      `UPDATE tdecisions SET status = ?, resolved_at = ?, answer = ?, scope = ? WHERE decision_id = ?`,
      a.action === 'approve' ? 'approved' : a.action === 'answer' ? 'answered' : 'declined', iso(), a.action === 'answer' && text ? text : null, a.action === 'approve' ? scope : null, d.decision_id,
    );
    const resolved = this.decision(d.decision_id)!;
    this.p.append({ type: 'decision.resolved', data: { decision: resolved } });
    void this.p.flush();
    return { accepted: true, decision: resolved };
  }

  private answerAutomation(d: DecisionRow, a: DecisionAnswer): { accepted: true; decision: Decision } | ProjectRefusal {
    if (a.action === 'approve') {
      const spec = JSON.parse(d.meta ?? '{}') as AutomationSpec & { describe?: string };
      delete spec.describe;
      const r = this.p.automations?.create(spec) ?? { ok: false as const, message: 'Automations are not available here.' };
      if (!r.ok) return { accepted: false, code: 'conflict', message: r.message };
    }
    const text = (a.text ?? '').trim().slice(0, DECISION_ANSWER_MAX);
    this.sql.exec(
      `UPDATE tdecisions SET status = ?, resolved_at = ?, answer = ? WHERE decision_id = ?`,
      a.action === 'approve' ? 'approved' : a.action === 'answer' ? 'answered' : 'declined', iso(), a.action === 'answer' && text ? text : null, d.decision_id,
    );
    const resolved = this.decision(d.decision_id)!;
    this.p.append({ type: 'decision.resolved', data: { decision: resolved } });
    void this.p.flush();
    return { accepted: true, decision: resolved };
  }

  // ── plan editing (while proposed or paused) ────────────────────────────────────────

  private editable(projectId: string): ProjectRow | ProjectRefusal {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (row.status !== 'proposed' && row.status !== 'paused') return { accepted: false, code: 'conflict', message: row.status === 'running' ? 'Pause the project to edit its plan.' : `The plan cannot change while the project is ${row.status}.` };
    return row;
  }

  editStep(projectId: string, stepId: string, e: StepEdit): Ok | ProjectRefusal {
    const row = this.editable(projectId);
    if ('accepted' in row) return row;
    const snap = this.snapshot(row);
    const step = snap.steps.find((s) => s.id === stepId);
    if (!step) return { accepted: false, code: 'not_found', message: 'No such step.' };
    if (step.status === 'done') return { accepted: false, code: 'conflict', message: 'That step is done; its output is kept. Add another step instead.' };
    const err = stepEditError(e, { steps: snap.steps, team: snap.team, stepId });
    if (err) return { accepted: false, code: 'bad_request', message: err };
    const owners = e.ownerIds ?? ownersOf(step);
    const patch: Record<string, string | number | null> = {
      ...(e.title !== undefined ? { title: e.title.trim() } : {}),
      ...(e.brief !== undefined ? { brief: e.brief.trim() } : {}),
      ...(e.acceptance !== undefined ? { acceptance: e.acceptance.trim() } : {}),
      ...(e.ownerIds !== undefined ? { owner_id: owners[0]!, co_owner_ids: JSON.stringify(owners.slice(1)) } : {}),
      ...(e.reviewerIds !== undefined ? { reviewer_ids: JSON.stringify(e.reviewerIds.filter((r) => !owners.includes(r))) } : {}),
      ...(e.dependsOn !== undefined ? { depends_on: JSON.stringify([...new Set(e.dependsOn)]) } : {}),
      // An edited step starts over (biz-bot applyTaskEdit): its draft, reviews and question are cleared.
      status: 'waiting',
      draft: null,
      reviews: null,
      verdict: null,
      question: null,
      attempts: 0,
      revisions: 0,
      by_id: null,
    };
    const keys = Object.keys(patch);
    this.sql.exec(`UPDATE tsteps SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE project_id = ? AND step_id = ?`, ...keys.map((k) => patch[k] ?? null), projectId, stepId);
    // A pending question or escalation about this step is superseded by the edit.
    for (const d of this.sql.exec<DecisionRow>(`SELECT * FROM tdecisions WHERE project_id = ? AND step_id = ? AND status = 'open'`, projectId, stepId).toArray()) this.resolve(d.decision_id, 'declined', iso());
    this.planChanged(projectId);
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  addStep(projectId: string, e: StepEdit): Ok | ProjectRefusal {
    const row = this.editable(projectId);
    if ('accepted' in row) return row;
    const snap = this.snapshot(row);
    if (snap.steps.length >= MAX_EDITED_STEPS) return { accepted: false, code: 'conflict', message: `A plan has at most ${MAX_EDITED_STEPS} steps.` };
    if (!e.title?.trim() || !e.brief?.trim()) return { accepted: false, code: 'bad_request', message: 'A new step needs a title and a brief.' };
    const lead = snap.team.find((m) => m.role === 'lead')?.personaId ?? snap.team[0]!.personaId;
    const owners = e.ownerIds?.length ? e.ownerIds : [lead];
    const edit = { ...e, ownerIds: owners, acceptance: e.acceptance?.trim() || 'The reviewers approve the work.', reviewerIds: e.reviewerIds ?? [] };
    const err = stepEditError(edit, { steps: snap.steps, team: snap.team, stepId: null });
    if (err) return { accepted: false, code: 'bad_request', message: err };
    let stepId = `s${snap.steps.length + 1}`;
    while (snap.steps.some((s) => s.id === stepId)) stepId = `${stepId}x`;
    this.sql.exec(
      `INSERT INTO tsteps (project_id, step_id, idx, title, brief, acceptance, owner_id, co_owner_ids, reviewer_ids, depends_on, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`,
      projectId, stepId, Math.max(-1, ...snap.steps.map((_, i) => i)) + 1, edit.title!.trim(), edit.brief!.trim(), edit.acceptance, owners[0]!, JSON.stringify(owners.slice(1)), JSON.stringify(edit.reviewerIds.filter((r) => !owners.includes(r))), JSON.stringify(e.dependsOn ?? []),
    );
    this.planChanged(projectId);
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  removeStep(projectId: string, stepId: string): Ok | ProjectRefusal {
    const row = this.editable(projectId);
    if ('accepted' in row) return row;
    const snap = this.snapshot(row);
    const step = snap.steps.find((s) => s.id === stepId);
    if (!step) return { accepted: false, code: 'not_found', message: 'No such step.' };
    if (step.status === 'done') return { accepted: false, code: 'conflict', message: 'That step is done; its output is kept.' };
    if (snap.steps.length <= 1) return { accepted: false, code: 'conflict', message: 'A plan needs at least one step.' };
    this.sql.exec('DELETE FROM tsteps WHERE project_id = ? AND step_id = ?', projectId, stepId);
    // Steps that waited on it no longer do.
    for (const s of snap.steps) if (s.dependsOn.includes(stepId)) this.sql.exec('UPDATE tsteps SET depends_on = ? WHERE project_id = ? AND step_id = ?', JSON.stringify(s.dependsOn.filter((d) => d !== stepId)), projectId, s.id);
    for (const d of this.sql.exec<DecisionRow>(`SELECT * FROM tdecisions WHERE project_id = ? AND step_id = ? AND status = 'open'`, projectId, stepId).toArray()) this.resolve(d.decision_id, 'declined', iso());
    this.planChanged(projectId);
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  editPlan(projectId: string, e: PlanEdit): Ok | ProjectRefusal {
    const row = this.editable(projectId);
    if ('accepted' in row) return row;
    const team = JSON.parse(row.team) as TeamMember[];
    if (e.deliverableKind !== undefined && !['document', 'web', 'code'].includes(e.deliverableKind)) return { accepted: false, code: 'bad_request', message: 'The deliverable is a document, a web page or a code file.' };
    if (e.finisherId !== undefined && !team.some((m) => m.personaId === e.finisherId)) return { accepted: false, code: 'bad_request', message: 'The finisher must be on the team.' };
    this.sql.exec('UPDATE tprojects SET deliverable_kind = COALESCE(?, deliverable_kind), finisher_id = COALESCE(?, finisher_id) WHERE project_id = ?', e.deliverableKind ?? null, e.finisherId ?? null, projectId);
    this.planChanged(projectId);
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  /** After an edit: the waiting plan's hand says what it now is (steps and forecast). */
  private planChanged(projectId: string): void {
    const row = this.row(projectId)!;
    const at = iso();
    this.sql.exec('UPDATE tprojects SET updated_at = ? WHERE project_id = ?', at, projectId);
    if (row.status === 'proposed' && row.decision_id) {
      const steps = this.snapshot(row).steps;
      this.sql.exec('UPDATE tdecisions SET body = ? WHERE decision_id = ?', `${row.staffing_note} ${steps.length} steps, each reviewed before it counts. ${forecastSentence(forecastOf(steps))}`, row.decision_id);
    }
    this.emit(projectId);
    void this.p.flush();
  }

  // ── reading ────────────────────────────────────────────────────────────────────────

  /** A coworker's part in the projects under way (for their desk quick chat). */
  staffingOf(personaId: string): StaffingContext[] {
    const out: StaffingContext[] = [];
    for (const r of this.sql.exec<ProjectRow>(`SELECT * FROM tprojects WHERE status IN ${ACTIVE} ORDER BY created_at ASC`).toArray()) {
      const team = JSON.parse(r.team) as TeamMember[];
      const member = team.find((m) => m.personaId === personaId);
      if (!member) continue;
      const s = this.snapshot(r);
      const mine = s.steps.filter((st) => ownersOf(st).includes(personaId) || st.reviewerIds.includes(personaId));
      const latest = [...s.steps].reverse().find((st) => (st.byId ?? st.ownerId) === personaId && st.output)?.output;
      out.push({
        projectId: s.projectId,
        title: s.title,
        status: s.status,
        role: member.role,
        mine: mine.map((st) => ({ stepId: st.id, title: st.title, status: st.status, reviewing: !ownersOf(st).includes(personaId) })),
        stepsDone: s.steps.filter((st) => st.status === 'done').length,
        stepsTotal: s.steps.length,
        ...(latest ? { latest: clipText(latest, 700) } : {}),
      });
    }
    return out;
  }

  list(limit = 20): { projects: TeamProjectSnapshot[]; decisions: Decision[] } {
    const projects = this.sql.exec<ProjectRow>('SELECT * FROM tprojects ORDER BY created_at DESC LIMIT ?', limit).toArray().map((r) => this.snapshot(r));
    const decisions = this.sql.exec<DecisionRow>(`SELECT * FROM tdecisions WHERE status = 'open' ORDER BY created_at DESC LIMIT 50`).toArray().map((r) => this.toDecision(r));
    return { projects, decisions };
  }

  get(projectId: string): TeamProjectSnapshot | null {
    const row = this.row(projectId);
    return row ? this.snapshot(row) : null;
  }

  /** Projects under way for the Chief of Staff's live work state. */
  active(): TeamProjectSnapshot[] {
    return this.sql.exec<ProjectRow>(`SELECT * FROM tprojects WHERE status IN ${ACTIVE} ORDER BY created_at ASC`).toArray().map((r) => this.snapshot(r));
  }

  /** Every model call of a project (oldest first), optionally of one step. */
  runs(projectId: string, stepId?: string): RunTrace[] {
    const rows = stepId
      ? this.sql.exec<RunRow>('SELECT * FROM truns WHERE project_id = ? AND step_id = ? ORDER BY at ASC', projectId, stepId).toArray()
      : this.sql.exec<RunRow>('SELECT * FROM truns WHERE project_id = ? ORDER BY at ASC', projectId).toArray();
    return rows.map((r) => JSON.parse(r.data) as RunTrace);
  }

  /** Earliest due time among projects that tick (planning and running). */
  nextDue(): number | null {
    const at = this.sql.exec<{ at: number | null }>(`SELECT MIN(next_at) AS at FROM tprojects WHERE status IN ('planning','running') AND next_at < ?`, IDLE).toArray()[0]?.at;
    return at === null || at === undefined ? null : Number(at);
  }

  /** Alarm tick: plan each due planning project, advance each due running one, concurrently. */
  async tick(now: number): Promise<void> {
    const due = this.sql
      .exec<{ project_id: string; status: string }>(
        `SELECT project_id, status FROM tprojects WHERE (status IN ('planning','running') AND next_at <= ?) OR (pending_discussion IS NOT NULL AND status IN ('proposed','paused','needs_review')) ORDER BY created_at ASC`,
        now,
      )
      .toArray()
      .filter((r) => !this.inflight.has(r.project_id));
    await Promise.all(due.map((r) => (r.status === 'planning' ? this.plan(r.project_id) : r.status === 'running' ? this.advance(r.project_id) : this.discussOnly(r.project_id))));
  }

  // ── the team channel, discussions and consultations (parity stage 4) ────────────────

  /** The channel of one project (the owner's view), oldest first. */
  channelEntries(projectId: string): ChannelEntry[] {
    return this.channel.list(projectId);
  }

  /**
   * The owner writes to the team. "@Ann" addresses someone (up to three answer; "@everyone" the first three), else the
   * lead answers. Answers come at once, in the background; the words also reach the addressees' next steps.
   */
  postChannel(projectId: string, text: string): { accepted: true; entry: ChannelEntry } | ProjectRefusal {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (row.status === 'cancelled') return { accepted: false, code: 'conflict', message: 'That project was stopped.' };
    const said = text.replace(/\r\n/g, '\n').trim().slice(0, 2000);
    if (!said) return { accepted: false, code: 'bad_request', message: 'Say something to the team.' };
    const team = JSON.parse(row.team) as TeamMember[];
    const { ids, everyone } = mentionsIn(said, team);
    const lead = team.find((m) => m.role === 'lead')?.personaId ?? team[0]!.personaId;
    const targets = (everyone ? team.map((m) => m.personaId) : ids.length ? ids : [lead]).slice(0, 3);
    const entry = this.channel.add(projectId, { kind: 'owner', fromId: 'owner', ...(ids.length === 1 && !everyone ? { toId: ids[0]! } : {}), text: said });
    // Work still to do takes it into account (as a note to those named, or to the team).
    if (['planning', 'proposed', 'running', 'paused', 'needs_review'].includes(row.status)) {
      if (ids.length && !everyone) for (const id of ids) this.note(projectId, { text: said, toId: id, via: 'channel' });
      else this.note(projectId, { text: said, via: 'channel' });
    }
    const work = (async () => {
      const setup = await this.setupOf(team);
      for (const id of targets) {
        try {
          const w = this.worker(id, setup, deadlineSignal(120_000), this.collabExtras(projectId, setup, new AbortController().signal, id, 1));
          const r = await replyToOwner(w, this.briefOf(projectId), said);
          this.recordRun(projectId, null, 'ask', w, r.run, r.sources);
          this.channel.add(projectId, { kind: 'answer', fromId: id, toId: 'owner', replyTo: entry.seq, text: r.text });
        } catch (err) {
          logError(`project.reply ${projectId}`, err);
          this.channel.add(projectId, { kind: 'system', fromId: 'chief', replyTo: entry.seq, text: `${firstOf(team.find((m) => m.personaId === id)?.name ?? id)} could not answer just now.` });
        }
        void this.p.flush();
      }
    })();
    if (this.p.background) this.p.background(work);
    else void work;
    void this.p.flush();
    return { accepted: true, entry };
  }

  /** The owner asks the team to discuss something (the chair frames it, members speak, the chair sums up). */
  async discuss(projectId: string, question: string, rounds = 2): Promise<Ok | ProjectRefusal> {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (!['proposed', 'running', 'paused', 'needs_review'].includes(row.status)) return { accepted: false, code: 'conflict', message: `The team cannot meet while the project is ${row.status}.` };
    if (row.pending_discussion || row.discussion_state) return { accepted: false, code: 'conflict', message: 'The team is already in a discussion.' };
    const q = question.replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (!q) return { accepted: false, code: 'bad_request', message: 'Say what the team should discuss.' };
    const r = Math.min(3, Math.max(1, Math.floor(rounds) || 2));
    this.sql.exec('UPDATE tprojects SET pending_discussion = ?, next_at = ?, updated_at = ? WHERE project_id = ?', JSON.stringify({ question: q, rounds: r, kind: 'discussion' } satisfies PendingDiscussion), runtime.now(), iso(), projectId);
    this.channel.add(projectId, { kind: 'owner', fromId: 'owner', text: `Let's discuss: ${q}` });
    this.emit(projectId);
    await this.p.armAlarm(runtime.now() + 10);
    void this.p.flush();
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  /** A discussion for a project that is not running (proposed, paused, waiting on the owner). */
  private async discussOnly(projectId: string): Promise<void> {
    const row = this.row(projectId);
    const pending = json<PendingDiscussion | null>(row?.pending_discussion, null);
    if (!row || !pending) return;
    const ac = new AbortController();
    this.inflight.set(projectId, ac);
    try {
      await this.runDiscussion(projectId, row.fence, await this.setupOf(JSON.parse(row.team) as TeamMember[]), ac.signal, pending);
    } catch (err) {
      logError(`project.discuss ${projectId}`, err);
      this.sql.exec('UPDATE tprojects SET pending_discussion = NULL, discussion_state = NULL WHERE project_id = ?', projectId);
    } finally {
      this.inflight.delete(projectId);
      void this.p.flush();
    }
  }

  /** Still this project and not stopped (a discussion may run while proposed or paused). */
  private meeting(projectId: string, fence: number): boolean {
    const r = this.sql.exec<{ status: string; fence: number }>('SELECT status, fence FROM tprojects WHERE project_id = ?', projectId).toArray()[0];
    return !!r && ['proposed', 'running', 'paused', 'needs_review'].includes(r.status) && Number(r.fence) === fence;
  }

  /**
   * A structured discussion (biz-bot swarm.js runDiscussion): round 1 the chair frames and each member opens; later
   * rounds each member debates; the chair sums up. Strictly one after another, each hearing everything before. A turn
   * that fails is noted and the discussion goes on. The chair's summary becomes direction for the team's next steps.
   */
  private async runDiscussion(projectId: string, fence: number, setup: AgentSetup, signal: AbortSignal, d: PendingDiscussion): Promise<void> {
    const row = this.row(projectId)!;
    const team = JSON.parse(row.team) as TeamMember[];
    const chair = team.find((m) => m.role === 'lead') ?? team[0]!;
    const members = team.filter((m) => m.personaId !== chair.personaId);
    const turns: { id: string; phase: DiscussionPhase; round: number }[] = [{ id: chair.personaId, phase: 'framing', round: 1 }, ...members.map((m) => ({ id: m.personaId, phase: 'opening' as const, round: 1 }))];
    for (let r = 2; r <= d.rounds; r++) turns.push(...members.map((m) => ({ id: m.personaId, phase: 'debate' as const, round: r })));
    turns.push({ id: chair.personaId, phase: 'synthesis', round: d.rounds });
    this.sql.exec('UPDATE tprojects SET pending_discussion = NULL WHERE project_id = ?', projectId);
    if (d.kind === 'discussion' || d.rounds > 1) this.channel.add(projectId, { kind: 'system', fromId: 'chief', text: `${chair.name.split(' ')[0]} chairs: ${turns.length} turns over ${d.rounds} round${d.rounds === 1 ? '' : 's'}.` });
    let soFar = '';
    let summary = '';
    for (const t of turns) {
      if (!this.meeting(projectId, fence)) return;
      const who = team.find((m) => m.personaId === t.id)!;
      this.sql.exec('UPDATE tprojects SET discussion_state = ? WHERE project_id = ?', JSON.stringify({ question: d.question, speakerId: t.id, round: t.round, rounds: d.rounds }), projectId);
      this.emit(projectId);
      void this.p.flush();
      try {
        const w = this.worker(t.id, setup, deadlineSignal(120_000, signal));
        const said = await discussionTurn(w, this.briefOf(projectId), d.question, t.phase, soFar, t.round, d.rounds);
        if (!this.meeting(projectId, fence)) return;
        this.recordRun(projectId, null, 'discussion', w, said.run, []);
        this.channel.add(projectId, { kind: 'discussion', fromId: t.id, round: t.round, phase: t.phase, text: said.text });
        soFar += `\n${who.name.split(' ')[0]} (${t.phase}): ${said.text}`;
        if (t.phase === 'synthesis') summary = said.text;
      } catch (err) {
        if (err instanceof MissingProviderError) throw err;
        logError(`project.discussion ${projectId}`, err);
        this.channel.add(projectId, { kind: 'system', fromId: 'chief', text: `${who.name.split(' ')[0]} could not take their turn.` });
      }
    }
    const kickoff = d.kind === 'kickoff';
    this.sql.exec(`UPDATE tprojects SET discussion_state = NULL${kickoff ? ", kickoff = 'done'" : ''}, updated_at = ? WHERE project_id = ?`, iso(), projectId);
    if (summary) this.note(projectId, { text: `${kickoff ? 'Kickoff agreement' : 'Discussion outcome'} (${chair.name.split(' ')[0]} chairing): ${clipText(summary, 900)}`, via: 'channel' });
    this.emit(projectId);
  }

  private teamOf(projectId: string): TeamMember[] {
    const row = this.row(projectId);
    return row ? (JSON.parse(row.team) as TeamMember[]) : [];
  }

  /** ask_coworker and friends for one coworker, when the owner lets them consult (their ask_coworker grant). */
  private collabExtras(projectId: string, setup: AgentSetup, signal: AbortSignal, selfId: string, depth: number, stepId?: string): Pick<Worker, 'extraTools' | 'extraDescribe'> {
    const persona = this.persona(selfId);
    if (!persona || !agentOf(persona, setup).granted('ask_coworker')) return {};
    const lead = this.teamOf(projectId).find((m) => m.role === 'lead')?.personaId === selfId;
    const host: CollabHost = {
      team: () => this.teamOf(projectId),
      consult: (from, to, question, d) => this.consult(projectId, setup, signal, from, to, question, d, stepId),
      handoff: (from, to, message) => this.handoff(projectId, from, to, message, stepId),
      findSpecialists: (need) => this.findSpecialists(projectId, need),
      addSpecialist: (by, personaId, why) => this.addSpecialist(projectId, by, personaId, why),
    };
    const kit = collabTools(host, selfId, { depth, lead });
    return kit.tools.length ? { extraTools: kit.tools, extraDescribe: kit.describe } : {};
  }

  /** The connectors this coworker may use (Stage 5), with what a call that needs the owner's OK does here. */
  private connectorExtras(projectId: string, setup: AgentSetup, selfId: string, stepId: string | undefined, mode: () => ApprovalMode): { tools: AgentTool<any>[]; describe: string } {
    const kits = setup.connectors?.[selfId] ?? [];
    const port = this.p.connectors;
    if (!kits.length || !port) return { tools: [], describe: '' };
    return connectorTools(kits, { call: (req) => port.call(req) }, { subject: selfId, projectId, ...(stepId ? { stepId } : {}), mode });
  }

  /** A teammate answers a colleague mid-step (in the channel and the inspector). */
  private async consult(projectId: string, setup: AgentSetup, signal: AbortSignal, fromId: string, toId: string, question: string, depth: number, stepId?: string): Promise<string> {
    const team = this.teamOf(projectId);
    const fromName = team.find((m) => m.personaId === fromId)?.name ?? fromId;
    const ask = this.channel.add(projectId, { kind: 'ask', fromId, toId, text: question, ...(stepId ? { stepId } : {}) });
    void this.p.flush();
    const w = this.worker(toId, setup, deadlineSignal(180_000, signal), this.collabExtras(projectId, setup, signal, toId, depth, stepId));
    const r = await consultCoworker(w, this.briefOf(projectId), fromName, question);
    this.recordRun(projectId, stepId ?? null, 'ask', w, r.run, r.sources);
    this.channel.add(projectId, { kind: 'answer', fromId: toId, toId: fromId, replyTo: ask.seq, text: r.text, ...(stepId ? { stepId } : {}) });
    void this.p.flush();
    return r.text;
  }

  /** A hand-off: the channel says so, and it reaches the teammate's next step as a note. */
  private handoff(projectId: string, fromId: string, toId: string, message: string, stepId?: string): void {
    this.channel.add(projectId, { kind: 'handoff', fromId, toId, text: message, ...(stepId ? { stepId } : {}) });
    this.note(projectId, { text: message, toId, via: 'teammate', fromId });
  }

  /** Coworkers not on the team whose discipline matches the need (keyword score over title, expertise and skills). */
  findSpecialists(projectId: string, need: string): { personaId: string; name: string; title: string; oneLiner: string }[] {
    const on = new Set(this.teamOf(projectId).map((m) => m.personaId));
    const want = new Set(words(need));
    if (!want.size) return [];
    return this.index.catalog.personas
      .filter((p) => !on.has(p.id))
      .map((p) => {
        const hay = words(`${p.title} ${p.title} ${p.one_liner} ${(p.expertise ?? []).join(' ')} ${[...p.skills.primary, ...p.skills.secondary].join(' ').replace(/-/g, ' ')}`);
        return { p, score: hay.filter((w) => want.has(w)).length };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ p }) => ({ personaId: p.id, name: p.name, title: p.title, oneLiner: p.one_liner }));
  }

  /** The lead brings a specialist onto the team (at most four added, the team at most twelve). */
  addSpecialist(projectId: string, byId: string, personaId: string, why: string): { ok: true; name: string } | { ok: false; error: string } {
    const row = this.row(projectId);
    const persona = this.persona(personaId);
    if (!row || !persona) return { ok: false, error: 'There is no such coworker in the office.' };
    const team = JSON.parse(row.team) as TeamMember[];
    if (team.some((m) => m.personaId === personaId)) return { ok: false, error: `${persona.name} is already on the team.` };
    if ((row.added_count ?? 0) >= MAX_ADDED_SPECIALISTS) return { ok: false, error: `The team has already brought in ${MAX_ADDED_SPECIALISTS} specialists.` };
    if (team.length >= MAX_TEAM) return { ok: false, error: `The team is full (${MAX_TEAM}).` };
    const member: TeamMember = { personaId, name: persona.name, title: persona.title, role: 'specialist', why: why || persona.one_liner };
    this.sql.exec('UPDATE tprojects SET team = ?, added_count = COALESCE(added_count, 0) + 1, updated_at = ? WHERE project_id = ?', JSON.stringify([...team, member]), iso(), projectId);
    this.channel.add(projectId, { kind: 'system', fromId: byId, text: `Brought in ${persona.name} (${persona.title})${why ? `: ${why}` : '.'}` });
    this.emit(projectId);
    return { ok: true, name: persona.name };
  }

  // ── the lifecycle ─────────────────────────────────────────────────────────────────

  /** The owner's overrides for the team (one RPC per unit of work). */
  private async setupOf(team: readonly TeamMember[]): Promise<AgentSetup> {
    if (!this.p.agents) return { configs: {}, skills: {} };
    try {
      return await this.p.agents(team.map((m) => m.personaId));
    } catch (err) {
      logError('project.agents', err);
      return { configs: {}, skills: {} };
    }
  }

  /** One coworker ready to work (their model, grants and tools). Throws MissingProviderError. */
  private worker(personaId: string, setup: AgentSetup, signal: AbortSignal, extra?: Pick<Worker, 'extraTools' | 'extraDescribe'>): Worker {
    const persona = this.persona(personaId);
    if (!persona) throw new WorkError(`${personaId} is not in the catalog.`, false);
    const agent = agentOf(persona, setup);
    const resolved = resolveAgentModel(runtime.registry(this.p.env), agent);
    const web = agent.granted('web_search');
    const read = agent.granted('fetch_page');
    return {
      agent,
      provider: resolved.provider,
      providerId: resolved.providerId,
      model: resolved.model,
      signal,
      ...(web || read ? { research: researchKitFactory(this.p.env, this.p.usage, resolved.provider, { webSearch: web, fetchPage: read }) } : {}),
      ...(extra ?? {}),
    };
  }

  /** The lead drafts the plan from the playbook (the planner); then the raised hand. */
  private async plan(projectId: string): Promise<void> {
    const row = this.row(projectId);
    if (!row || row.status !== 'planning') return;
    const fence = row.fence;
    const ac = new AbortController();
    this.inflight.set(projectId, ac);
    try {
      const team = JSON.parse(row.team) as TeamMember[];
      const leadId = team.find((m) => m.role === 'lead')?.personaId ?? team[0]!.personaId;
      const setup = await this.setupOf(team);
      let w: Worker;
      try {
        w = this.worker(leadId, setup, deadlineSignal(UNIT_BUDGET_MS, ac.signal));
      } catch (err) {
        if (err instanceof MissingProviderError) return this.fail(projectId, fence, err.message, ['planning']);
        throw err;
      }
      const kind = (row.deliverable_kind as DeliverableKind | null) ?? undefined;
      const out = await planProject(w, row.goal, team, this.snapshot(row).steps, kind);
      if (!this.planning(projectId, fence)) return;
      this.recordRun(projectId, null, 'plan', w, out.run, []);
      const plan = normalizePlan(out.plan, team, row.goal, kind);
      if (plan) {
        this.sql.exec('DELETE FROM tsteps WHERE project_id = ?', projectId);
        this.writeSteps(projectId, plan.steps);
        this.sql.exec('UPDATE tprojects SET deliverable_kind = ?, finisher_id = ? WHERE project_id = ?', plan.kind, plan.finisherId, projectId);
      }
      this.proposeReady(projectId);
    } catch (err) {
      if (!this.planning(projectId, fence) || (err instanceof WorkCancelled && ac.signal.aborted)) return;
      logError(`project.plan ${projectId}`, err);
      const attempts = row.attempts + 1;
      // The playbook's plan stands when the planner keeps failing: the owner still gets a plan to approve.
      if (attempts >= MAX_ATTEMPTS) this.proposeReady(projectId);
      else this.sql.exec('UPDATE tprojects SET attempts = ?, next_at = ? WHERE project_id = ? AND fence = ?', attempts, runtime.now() + 1000 * 2 ** attempts, projectId, fence);
    } finally {
      this.inflight.delete(projectId);
      void this.p.flush();
    }
  }

  /** The plan is ready: raise the plan-approval hand. */
  private proposeReady(projectId: string): void {
    const row = this.row(projectId)!;
    const steps = this.snapshot(row).steps;
    const decisionId = newId('dec');
    const at = iso();
    const body = `${row.staffing_note} ${steps.length} steps, each reviewed before it counts. ${forecastSentence(forecastOf(steps))}`;
    this.sql.exec(`INSERT INTO tdecisions (decision_id, kind, project_id, title, body, status, created_at) VALUES (?, 'plan_approval', ?, ?, ?, 'open', ?)`, decisionId, projectId, `Approve the plan for “${row.title}”?`, body, at);
    this.sql.exec(`UPDATE tprojects SET status = 'proposed', decision_id = ?, attempts = 0, updated_at = ? WHERE project_id = ?`, decisionId, at, projectId);
    const project = this.snapshot(this.row(projectId)!);
    this.p.append({ type: 'project.proposed', data: { project: this.clip(project), decision: this.decision(decisionId)! } });
    // An automation the owner set up to start on its own: the plan starts now.
    const auto = json<{ name: string; autoStart: boolean } | null>(row.automation, null);
    if (auto?.autoStart) void this.approve(projectId, `The automation “${auto.name}” started the plan, as the owner set it up. Work starts now.`).catch((err) => logError('project.autostart', err));
  }

  private planning(projectId: string, fence: number): boolean {
    const r = this.sql.exec<{ status: string; fence: number }>('SELECT status, fence FROM tprojects WHERE project_id = ?', projectId).toArray()[0];
    return !!r && r.status === 'planning' && Number(r.fence) === fence;
  }

  private async advance(projectId: string): Promise<void> {
    const row = this.row(projectId);
    if (!row || row.status !== 'running') return;
    const fence = row.fence;
    const ac = new AbortController();
    this.inflight.set(projectId, ac);
    try {
      // The token budget: a project that spent it pauses and asks.
      const used = this.usage(projectId);
      const budget = row.budget_tokens ?? tokenBudget(this.p.env);
      if (used.input + used.output >= budget) {
        this.sql.exec(`UPDATE tprojects SET status = 'paused', updated_at = ? WHERE project_id = ?`, iso(), projectId);
        this.openDecision(projectId, 'budget', { title: `“${row.title}” used its token budget`, body: `The team has used ${(used.input + used.output).toLocaleString('en-US')} tokens (the budget is ${budget.toLocaleString('en-US')}). Raise it by ${tokenBudget(this.p.env).toLocaleString('en-US')} and continue?` });
        return;
      }
      // A discussion the owner asked for, then the kickoff, come before more steps.
      const pending = json<PendingDiscussion | null>(row.pending_discussion, null);
      const setupD = pending || row.kickoff === 'pending' ? await this.setupOf(JSON.parse(row.team) as TeamMember[]) : null;
      if (pending) {
        await this.runDiscussion(projectId, fence, setupD!, ac.signal, pending);
        if (this.live(projectId, fence)) this.sql.exec('UPDATE tprojects SET next_at = ? WHERE project_id = ?', runtime.now(), projectId);
        return;
      }
      if (row.kickoff === 'pending') {
        await this.runDiscussion(projectId, fence, setupD!, ac.signal, { kind: 'kickoff', rounds: 1, question: `Kickoff: how will we deliver “${row.title}”? Agree the approach, the biggest risk, and who needs what from whom. (The owner's goal: ${clipText(row.goal, 400)})` });
        if (this.live(projectId, fence)) this.sql.exec('UPDATE tprojects SET next_at = ? WHERE project_id = ?', runtime.now(), projectId);
        return;
      }
      const snap = this.snapshot(row);
      // A step whose input failed or was skipped cannot run.
      const bad = new Set(snap.steps.filter((s) => s.status === 'failed' || s.status === 'skipped').map((s) => s.id));
      for (const s of snap.steps) if (s.status === 'waiting' && s.dependsOn.some((d) => bad.has(d))) this.setStep(projectId, fence, s.id, { status: 'skipped', error: 'An input step did not finish.' });
      const steps = this.snapshot(this.row(projectId)!).steps;
      const setup = await this.setupOf(snap.team);
      const ready = readySteps(steps).slice(0, MAX_PARALLEL);
      if (ready.length) {
        await Promise.all(ready.map((s) => this.runStep(projectId, fence, s.id, setup, ac.signal)));
      } else if (steps.some((s) => s.status === 'asking' || s.status === 'needs_review')) {
        // Only the owner can move this project now; their answer re-arms it.
        this.sql.exec('UPDATE tprojects SET next_at = ? WHERE project_id = ? AND fence = ?', IDLE, projectId, fence);
        return;
      } else if (steps.every((s) => TERMINAL.has(s.status))) {
        if (!steps.some((s) => s.status === 'done')) return this.fail(projectId, fence, 'No step could be finished, so there is nothing to deliver.');
        await this.finish(projectId, fence, setup, ac.signal);
        if (!this.live(projectId, fence) || this.row(projectId)!.status !== 'running') return;
      } else if (!steps.some((s) => s.status === 'working' || s.status === 'reviewing' || s.status === 'revising')) {
        return this.fail(projectId, fence, 'The plan is stuck: a step depends on work that cannot finish.');
      }
      if (this.live(projectId, fence)) this.sql.exec('UPDATE tprojects SET attempts = 0, next_at = ? WHERE project_id = ? AND fence = ?', runtime.now(), projectId, fence);
    } catch (err) {
      if (!this.live(projectId, fence) || (err instanceof WorkCancelled && ac.signal.aborted)) return;
      if (err instanceof MissingProviderError) return this.fail(projectId, fence, err.message);
      const attempts = row.attempts + 1;
      logError(`project.team ${projectId}`, err);
      const retryable = !(err instanceof WorkError) || err.retryable;
      // Reset steps caught mid-flight so the retry starts them cleanly.
      this.sql.exec(`UPDATE tsteps SET status = 'waiting' WHERE project_id = ? AND status IN ('working','reviewing','revising')`, projectId);
      if (!retryable || attempts >= MAX_ATTEMPTS) this.fail(projectId, fence, 'The model kept failing, so the team stopped. Try again in a minute, or check the provider key.');
      else {
        this.sql.exec('UPDATE tprojects SET attempts = ?, next_at = ? WHERE project_id = ? AND fence = ?', attempts, runtime.now() + 1000 * 2 ** attempts, projectId, fence);
        this.emit(projectId);
      }
    } finally {
      this.inflight.delete(projectId);
      void this.p.flush();
    }
  }

  /**
   * One step as a cluster (biz-bot plan.js runTask): the lead works (or answers the owner's question first), everyone
   * else in the cluster reviews in parallel, the lead revises once, and remaining changes go to the owner. A failed
   * attempt passes to the next owner; the second failure fails the step.
   */
  private async runStep(projectId: string, fence: number, stepId: string, setup: AgentSetup, signal: AbortSignal): Promise<void> {
    const brief = (): ProjectBrief => this.briefOf(projectId);
    const step = () => brief().steps.find((s) => s.id === stepId)!;
    const s0 = this.stepRow(projectId, stepId)!;
    const owners = ownersOf(step());
    const attempts = s0.attempts ?? 0;
    const lead = s0.draft && s0.by_id ? s0.by_id : owners[attempts % owners.length]!;
    const nameOf = (id: string) => brief().team.find((m) => m.personaId === id)?.name ?? id;
    try {
      let draft = s0.draft ?? '';
      let sources: Source[] = json<Source[]>(s0.sources, []);
      let asked: { text: string; detail?: string } | null = null;
      // A connector call that needs the owner's OK pauses the step while the lead works; later (revisions) it cannot.
      let approval: ConnectorAsk | null = null;
      let working = true;
      const collab = this.collabExtras(projectId, setup, signal, lead, 0, stepId);
      const conn = this.connectorExtras(projectId, setup, lead, stepId, () => (working ? { kind: 'pause', onAsk: (ask) => (approval ??= ask) } : { kind: 'note' }));
      const leadWorker = this.worker(lead, setup, deadlineSignal(UNIT_BUDGET_MS, signal), {
        // One question per step: after the owner answers, the lead works with the answer.
        extraTools: [...(s0.answer ? [] : [askOwnerTool((q) => (asked = q))]), ...(collab.extraTools ?? []), ...conn.tools],
        extraDescribe: [
          'If a decision, permission or input only the owner can give is missing, call request_owner_input (one specific question); continue with reasonable, stated assumptions for anything that does not block you.',
          collab.extraDescribe ?? '',
          conn.describe,
        ]
          .filter(Boolean)
          .join(' '),
      });

      if (!draft) {
        this.applyNotes(projectId, fence, stepId, lead);
        this.setStep(projectId, fence, stepId, { status: 'working', by_id: lead, started_at: iso(), error: null });
        const previous = s0.output ?? undefined;
        const out = await doStepWork({ ...leadWorker, paused: () => !!asked || !!approval }, brief(), step(), { ...(s0.answer ? { answer: s0.answer } : {}), ...(previous ? { previous } : {}) });
        if (!this.live(projectId, fence)) throw new WorkCancelled();
        this.recordRun(projectId, stepId, 'work', leadWorker, out.run, out.sources);
        const ok = approval as ConnectorAsk | null;
        if (ok) {
          const q = { text: `May I use ${ok.name} → ${ok.tool}?`, detail: `With these details:\n${ok.args}` };
          this.channel.add(projectId, { kind: 'ask', fromId: lead, toId: 'owner', stepId, text: `${q.text}\n\n${q.detail}` });
          this.setStep(projectId, fence, stepId, { status: 'asking', question: JSON.stringify(q) });
          this.openDecision(projectId, 'connector', { stepId, fromId: lead, connector: ok, title: `${firstOf(nameOf(lead))} wants to use ${ok.name} → ${ok.tool}`, body: `For “${step().title}”, with these details:\n${ok.args}` });
          return;
        }
        const q = asked as { text: string; detail?: string } | null;
        if (q) {
          this.channel.add(projectId, { kind: 'ask', fromId: lead, toId: 'owner', stepId, text: q.detail ? `${q.text}\n\n${q.detail}` : q.text });
          this.setStep(projectId, fence, stepId, { status: 'asking', question: JSON.stringify(q) });
          this.openDecision(projectId, 'input', { stepId, fromId: lead, title: `${firstOf(nameOf(lead))} asks: ${q.text}`, body: q.detail ? `${q.detail}\n\n(For “${step().title}”.)` : `For “${step().title}”.` });
          return;
        }
        draft = out.markdown;
        sources = mergeSources(sources, out.sources);
        this.channel.add(projectId, { kind: 'work', fromId: lead, stepId, text: `Handed in “${step().title}”: ${out.summary}` });
        this.setStep(projectId, fence, stepId, { draft, sources: JSON.stringify(sources), status: 'reviewing' });
      }
      working = false;

      // The owner's direction after an escalation: a fresh revision first.
      if (s0.direction) {
        this.setStep(projectId, fence, stepId, { status: 'revising', direction: null });
        const prior = json<StepVerdict[]>(s0.reviews, []).filter((v) => !v.approved);
        const out = await reviseStep(leadWorker, brief(), step(), draft, prior.map((v) => ({ by: nameOf(v.reviewerId), notes: v.notes })), s0.direction);
        if (!this.live(projectId, fence)) throw new WorkCancelled();
        this.recordRun(projectId, stepId, 'revise', leadWorker, out.run, out.sources);
        draft = out.markdown;
        sources = mergeSources(sources, out.sources);
        this.channel.add(projectId, { kind: 'work', fromId: lead, stepId, text: `Revised “${step().title}” with the owner’s direction: ${out.summary}` });
        // The owner's direction is this round's revision (biz-bot: a fresh allowance of one).
        this.setStep(projectId, fence, stepId, { draft, sources: JSON.stringify(sources), revised: 1, revisions: MAX_REVISIONS, status: 'reviewing' });
      }

      const reviewers = [...new Set([...owners.filter((o) => o !== lead), ...step().reviewerIds])].filter((r) => r !== lead);
      let revisions = s0.direction ? MAX_REVISIONS : (s0.revisions ?? 0);
      while (reviewers.length) {
        this.setStep(projectId, fence, stepId, { status: 'reviewing' });
        const results = await Promise.allSettled(
          reviewers.map(async (r) => {
            const w = this.worker(r, setup, deadlineSignal(UNIT_BUDGET_MS, signal));
            const v = await reviewStep(w, brief(), step(), draft, nameOf(lead));
            this.recordRun(projectId, stepId, 'review', w, v.run, v.sources);
            return v;
          }),
        );
        if (!this.live(projectId, fence)) throw new WorkCancelled();
        const verdicts: StepVerdict[] = results.map((res, i) =>
          res.status === 'fulfilled'
            ? { approved: res.value.approved, notes: res.value.notes, reviewerId: reviewers[i]! }
            : { approved: false, notes: `The review did not complete (${res.reason instanceof Error ? res.reason.message : 'error'}), so it counts as changes requested.`, reviewerId: reviewers[i]! },
        );
        for (const res of results) if (res.status === 'fulfilled') sources = mergeSources(sources, res.value.sources);
        for (const v of verdicts) this.channel.add(projectId, { kind: 'review', fromId: v.reviewerId, toId: lead, stepId, text: `${v.approved ? 'Approved' : 'Changes needed'}: ${v.notes}` });
        const changes = verdicts.filter((v) => !v.approved);
        this.setStep(projectId, fence, stepId, { reviews: JSON.stringify(verdicts), verdict: JSON.stringify(changes[0] ?? verdicts[0]), sources: JSON.stringify(sources) }, false);
        if (!changes.length) break;
        if (revisions >= MAX_REVISIONS) {
          this.setStep(projectId, fence, stepId, { status: 'needs_review', error: 'Reviewers still want changes after the revision.' });
          this.channel.add(projectId, { kind: 'system', fromId: 'chief', stepId, text: `“${step().title}” still has review issues after the revision; the owner decides.` });
          this.openDecision(projectId, 'review', {
            stepId,
            title: `Accept the remaining review issues for “${step().title}”, or give direction?`,
            body: changes.map((v) => `${firstOf(nameOf(v.reviewerId))}: ${v.notes}`).join('\n\n'),
          });
          return;
        }
        revisions++;
        this.setStep(projectId, fence, stepId, { status: 'revising', revisions });
        const out = await reviseStep(leadWorker, brief(), step(), draft, changes.map((v) => ({ by: nameOf(v.reviewerId), notes: v.notes })));
        if (!this.live(projectId, fence)) throw new WorkCancelled();
        this.recordRun(projectId, stepId, 'revise', leadWorker, out.run, out.sources);
        draft = out.markdown;
        sources = mergeSources(sources, out.sources);
        this.channel.add(projectId, { kind: 'work', fromId: lead, stepId, text: `Revised “${step().title}”: ${out.summary}` });
        this.setStep(projectId, fence, stepId, { draft, revised: 1, sources: JSON.stringify(sources) });
      }
      this.setStep(projectId, fence, stepId, { status: 'done', output: draft, draft: null, finished_at: iso(), error: null, ...(sources.length ? { sources: JSON.stringify(sources) } : {}) });
    } catch (err) {
      if (err instanceof WorkCancelled || !this.live(projectId, fence)) throw err;
      if (err instanceof MissingProviderError) throw err;
      logError(`project.step ${projectId}/${stepId}`, err);
      const next = attempts + 1;
      const message = err instanceof Error ? clipText(err.message, 300) : 'The step failed.';
      if (next < MAX_STEP_ATTEMPTS) {
        const taker = owners[next % owners.length]!;
        if (taker !== lead) this.channel.add(projectId, { kind: 'system', fromId: 'chief', stepId, text: `${firstOf(nameOf(lead))} could not finish “${step().title}”; ${firstOf(nameOf(taker))} takes it over.` });
        this.setStep(projectId, fence, stepId, { status: 'waiting', attempts: next, draft: null, by_id: null, error: taker !== lead ? `${firstOf(nameOf(lead))} could not finish (${message}); ${firstOf(nameOf(taker))} takes it over.` : `Retrying after: ${message}` });
      } else {
        this.setStep(projectId, fence, stepId, { status: 'failed', attempts: next, error: message, finished_at: iso() });
      }
    }
  }

  /** Done, or partial when some steps failed or were skipped (never falsely done). */
  private endStatus(projectId: string): TeamProjectStatus {
    return this.snapshot(this.row(projectId)!).steps.every((s) => s.status === 'done') ? 'done' : 'partial';
  }

  /** The finisher writes the deliverable; a reviewer checks it (one revision); remaining issues go to the owner. */
  private async finish(projectId: string, fence: number, setup: AgentSetup, signal: AbortSignal): Promise<void> {
    const row = this.row(projectId)!;
    const s = this.snapshot(row);
    const kind = (row.deliverable_kind as DeliverableKind | null) ?? 'document';
    const finisherId = row.finisher_id ?? s.team.find((m) => m.role === 'lead')?.personaId ?? s.team[0]!.personaId;
    const w = this.worker(finisherId, setup, deadlineSignal(UNIT_BUDGET_MS, signal));
    const d =
      row.final_direction && row.deliverable
        ? // The owner gave direction on the checked deliverable: revise it.
          await writeDeliverable(w, this.briefOf(projectId), kind, { previous: row.deliverable, notes: row.final_direction })
        : await writeDeliverable(w, this.briefOf(projectId), kind);
    if (!this.live(projectId, fence)) throw new WorkCancelled();
    if (row.final_direction) this.sql.exec('UPDATE tprojects SET final_direction = NULL WHERE project_id = ?', projectId);
    this.recordRun(projectId, null, 'deliverable', w, d.run, []);
    let content = d.content;
    let summary = d.summary;
    let filename = d.filename ?? null;
    let qa: { approved: boolean; notes: string; reviewerId: string } | null = null;
    const qaId = pickQaReviewer(s, finisherId);
    if (qaId) {
      const qw = this.worker(qaId, setup, deadlineSignal(UNIT_BUDGET_MS, signal));
      let v = await qaDeliverable(qw, this.briefOf(projectId), kind, content);
      this.recordRun(projectId, null, 'qa', qw, v.run, v.sources);
      if (!v.approved) {
        const r = await writeDeliverable(w, this.briefOf(projectId), kind, { previous: content, notes: v.notes });
        if (!this.live(projectId, fence)) throw new WorkCancelled();
        this.recordRun(projectId, null, 'deliverable', w, r.run, []);
        content = r.content;
        summary = r.summary;
        filename = r.filename ?? filename;
        v = await qaDeliverable(qw, this.briefOf(projectId), kind, content);
        this.recordRun(projectId, null, 'qa', qw, v.run, v.sources);
      }
      qa = { approved: v.approved, notes: v.notes, reviewerId: qaId };
    }
    if (!this.live(projectId, fence)) throw new WorkCancelled();
    const at = iso();
    if (qa && !qa.approved) {
      this.sql.exec(`UPDATE tprojects SET status = 'needs_review', deliverable = ?, summary = ?, qa = ?, deliverable_filename = ?, updated_at = ? WHERE project_id = ? AND fence = ?`, content, summary, JSON.stringify(qa), filename, at, projectId, fence);
      const who = s.team.find((m) => m.personaId === qa!.reviewerId)?.name;
      this.openDecision(projectId, 'deliverable', { title: `Accept the deliverable for “${row.title}” with the remaining issues, or give direction?`, body: `${who ? firstOf(who) : 'The reviewer'}: ${qa.notes}` });
      return;
    }
    this.sql.exec(
      `UPDATE tprojects SET status = ?, deliverable = ?, summary = ?, qa = ?, deliverable_filename = ?, updated_at = ?, finished_at = ? WHERE project_id = ? AND fence = ?`,
      this.endStatus(projectId), content, summary, qa ? JSON.stringify(qa) : null, filename, at, at, projectId, fence,
    );
    this.emit(projectId);
  }

  private fail(projectId: string, fence: number, message: string, from: string[] = ['running', 'paused']): void {
    const at = iso();
    this.sql.exec(`UPDATE tprojects SET status = 'failed', error = ?, updated_at = ?, finished_at = ? WHERE project_id = ? AND fence = ? AND status IN (${from.map(() => '?').join(',')})`, message, at, at, projectId, fence, ...from);
    this.emit(projectId);
  }

  // ── decisions ─────────────────────────────────────────────────────────────────────

  /**
   * The Chief of Staff wants to call a connector tool that needs the owner's OK (a raised hand with no project). A
   * newer ask for the same tool replaces one still unanswered.
   */
  openChiefApproval(ask: ConnectorAsk, title: string): Decision {
    const at = iso();
    for (const d of this.sql.exec<DecisionRow>(`SELECT * FROM tdecisions WHERE project_id = '' AND kind = 'connector' AND status = 'open'`).toArray()) {
      const m = JSON.parse(d.meta ?? '{}') as Partial<ConnectorAsk>;
      if (m.connectorId === ask.connectorId && m.tool === ask.tool) this.resolve(d.decision_id, 'declined', at);
    }
    const decisionId = newId('dec');
    this.sql.exec(
      `INSERT INTO tdecisions (decision_id, kind, project_id, title, body, status, created_at, meta) VALUES (?, 'connector', '', ?, ?, 'open', ?, ?)`,
      decisionId, clipText(title, 300), clipText(`With these details:\n${ask.args}`, 4000), at, JSON.stringify(ask),
    );
    const d = this.decision(decisionId)!;
    this.p.append({ type: 'decision.opened', data: { decision: d } });
    void this.p.flush();
    return d;
  }

  private openDecision(projectId: string, kind: Exclude<DecisionKind, 'plan_approval'>, d: { title: string; body: string; stepId?: string; fromId?: string; connector?: ConnectorAsk }): void {
    // One open hand per step (and one budget hand per project).
    const dup = this.sql.exec<DecisionRow>(`SELECT * FROM tdecisions WHERE project_id = ? AND kind = ? AND status = 'open' AND COALESCE(step_id, '') = ?`, projectId, kind, d.stepId ?? '').toArray()[0];
    if (dup) return;
    const decisionId = newId('dec');
    const at = iso();
    this.sql.exec(
      `INSERT INTO tdecisions (decision_id, kind, project_id, title, body, status, created_at, step_id, from_id, meta) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      decisionId, kind, projectId, clipText(d.title, 300), clipText(d.body, 4000), at, d.stepId ?? null, d.fromId ?? null, d.connector ? JSON.stringify(d.connector) : null,
    );
    this.sql.exec('UPDATE tprojects SET updated_at = ? WHERE project_id = ?', at, projectId);
    this.p.append({ type: 'decision.opened', data: { decision: this.decision(decisionId)! } });
    this.emit(projectId);
  }

  private resolve(decisionId: string, status: 'approved' | 'declined', at: string): void {
    this.sql.exec(`UPDATE tdecisions SET status = ?, resolved_at = ? WHERE decision_id = ? AND status = 'open'`, status, at, decisionId);
    const d = this.decision(decisionId);
    if (d) this.p.append({ type: 'decision.resolved', data: { decision: d } });
  }

  // ── rows, snapshots, frames, runs ─────────────────────────────────────────────────

  private writeSteps(projectId: string, steps: readonly ProjectStep[]): void {
    steps.forEach((s, i) =>
      this.sql.exec(
        `INSERT INTO tsteps (project_id, step_id, idx, title, brief, acceptance, owner_id, co_owner_ids, reviewer_ids, depends_on, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`,
        projectId, s.id, i, s.title, s.brief, s.acceptance, s.ownerId, JSON.stringify(s.coOwnerIds ?? []), JSON.stringify(s.reviewerIds), JSON.stringify(s.dependsOn),
      ),
    );
  }

  /** Keep a model call for the run inspector (clipped) and its usage for the project's totals. */
  private recordRun(projectId: string, stepId: string | null, phase: RunTrace['phase'], w: Worker, c: Captured, sources: readonly Source[]): void {
    const r = c.result;
    const calls: RunTrace['calls'] = [];
    const results = new Map<string, { content: string; ok: boolean }>();
    for (const m of r.messages) if (m.role === 'tool') results.set(m.toolCallId, { content: m.content, ok: !m.isError });
    for (const m of r.messages) {
      if (m.role !== 'assistant' || !m.toolCalls) continue;
      for (const tc of m.toolCalls) {
        const res = results.get(tc.id);
        calls.push({ name: tc.name, args: clipText(tc.arguments, 2000), result: clipText(res?.content ?? '', 3000), ok: res?.ok ?? false });
      }
    }
    const trace: RunTrace = {
      runId: newId('run'),
      projectId,
      stepId,
      phase,
      personaId: w.agent.persona.id,
      provider: w.providerId,
      model: w.model,
      system: clipText(c.system, 20_000),
      prompt: clipText(c.prompt, 30_000),
      calls: calls.slice(0, 40),
      text: clipText(r.fullText, 12_000),
      sources: [...sources].slice(0, 40),
      usage: r.usage,
      steps: r.steps,
      finish: r.finish,
      startedAt: c.startedAt,
      ms: c.ms,
    };
    this.sql.exec(
      'INSERT INTO truns (run_id, project_id, step_id, phase, persona_id, at, in_tokens, out_tokens, usd, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      trace.runId, projectId, stepId, phase, trace.personaId, `${c.startedAt}|${trace.runId}`, r.usage.input, r.usage.output, r.usage.usd, JSON.stringify(trace),
    );
    const n = Number(this.sql.exec<{ n: number }>('SELECT count(*) AS n FROM truns WHERE project_id = ?', projectId).toArray()[0]?.n ?? 0);
    if (n > RUNS_KEPT) this.sql.exec('DELETE FROM truns WHERE run_id IN (SELECT run_id FROM truns WHERE project_id = ? ORDER BY at ASC LIMIT ?)', projectId, n - RUNS_KEPT);
  }

  usage(projectId: string): ProjectUsage {
    const r = this.sql
      .exec<{ i: number | null; o: number | null; usd: number | null; unknown: number | null; n: number }>(
        'SELECT SUM(in_tokens) AS i, SUM(out_tokens) AS o, SUM(usd) AS usd, SUM(CASE WHEN usd IS NULL THEN 1 ELSE 0 END) AS unknown, count(*) AS n FROM truns WHERE project_id = ?',
        projectId,
      )
      .toArray()[0];
    return { input: Number(r?.i ?? 0), output: Number(r?.o ?? 0), usd: r && Number(r.unknown ?? 0) > 0 ? null : Number(r?.usd ?? 0), calls: Number(r?.n ?? 0) };
  }

  private persona(id: string): Persona | undefined {
    return id ? this.index.persona(id) : undefined;
  }

  private row(projectId: string): ProjectRow | undefined {
    return this.sql.exec<ProjectRow>('SELECT * FROM tprojects WHERE project_id = ?', projectId).toArray()[0];
  }

  private stepRow(projectId: string, stepId: string): StepRow | undefined {
    return this.sql.exec<StepRow>('SELECT * FROM tsteps WHERE project_id = ? AND step_id = ?', projectId, stepId).toArray()[0];
  }

  /** Still this run of the project: running, or paused (a step under way finishes and keeps its result). */
  private live(projectId: string, fence: number): boolean {
    const r = this.sql.exec<{ status: string; fence: number }>('SELECT status, fence FROM tprojects WHERE project_id = ?', projectId).toArray()[0];
    return !!r && (r.status === 'running' || r.status === 'paused') && Number(r.fence) === fence;
  }

  private briefOf(projectId: string): ProjectBrief {
    const row = this.row(projectId)!;
    const s = this.snapshot(row);
    const channel = this.channel.context(projectId, s.team);
    return { title: s.title, goal: s.goal, team: s.team, steps: s.steps, chiefName: row.chief_name, notes: (s.notes ?? []).map((n) => ({ text: n.text, ...(n.toId ? { toId: n.toId } : {}) })), ...(channel ? { channel } : {}) };
  }

  /** Queued notes for this step's owner (theirs and the team's) are picked up now. */
  private applyNotes(projectId: string, fence: number, stepId: string, ownerId: string): void {
    if (!this.live(projectId, fence)) return;
    this.sql.exec(`UPDATE tnotes SET status = 'applied', applied_at = ?, applied_step = ? WHERE project_id = ? AND status = 'queued' AND (to_id IS NULL OR to_id = ?)`, iso(), stepId, projectId, ownerId);
  }

  private toNote(r: NoteRow): ProjectNote {
    return {
      noteId: r.note_id,
      text: r.text,
      ...(r.to_id ? { toId: r.to_id } : {}),
      via: r.via as ProjectNote['via'],
      status: r.status as ProjectNote['status'],
      at: r.at,
      ...(r.applied_at ? { appliedAt: r.applied_at } : {}),
      ...(r.applied_step ? { appliedStepId: r.applied_step } : {}),
      ...(r.from_id ? { fromId: r.from_id } : {}),
    };
  }

  /** Patch a step (only while the project is still at this fence) and, by default, emit the project. */
  private setStep(projectId: string, fence: number, stepId: string, patch: Partial<Record<keyof StepRow, string | number | null>>, emit = true): void {
    if (!this.live(projectId, fence)) return;
    const keys = Object.keys(patch);
    if (!keys.length) return;
    this.sql.exec(`UPDATE tsteps SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE project_id = ? AND step_id = ?`, ...keys.map((k) => patch[k as keyof StepRow] ?? null), projectId, stepId);
    this.sql.exec('UPDATE tprojects SET updated_at = ? WHERE project_id = ?', iso(), projectId);
    if (emit) this.emit(projectId);
  }

  private emit(projectId: string): void {
    const row = this.row(projectId);
    if (row) this.p.append({ type: 'project.updated', data: { project: this.clip(this.snapshot(row)) } });
  }

  /** Frames carry clipped outputs; GET /api/projects/:id has them in full. */
  private clip(p: TeamProjectSnapshot): TeamProjectSnapshot {
    return {
      ...p,
      steps: p.steps.map((s) => (s.output ? { ...s, output: clipText(s.output, OUTPUT_FRAME_MAX) } : s)),
      ...(p.deliverable ? { deliverable: clipText(p.deliverable, OUTPUT_FRAME_MAX * 4) } : {}),
    };
  }

  private decision(decisionId: string): Decision | null {
    const r = this.sql.exec<DecisionRow>('SELECT * FROM tdecisions WHERE decision_id = ?', decisionId).toArray()[0];
    return r ? this.toDecision(r) : null;
  }

  private toDecision(r: DecisionRow): Decision {
    return {
      decisionId: r.decision_id,
      kind: r.kind as DecisionKind,
      projectId: r.project_id,
      ...(r.step_id ? { stepId: r.step_id } : {}),
      ...(r.from_id ? { fromId: r.from_id } : {}),
      title: r.title,
      body: r.body,
      status: r.status as Decision['status'],
      ...(r.answer ? { answer: r.answer } : {}),
      ...(r.meta && r.kind === 'connector' ? { connector: JSON.parse(r.meta) as ConnectorAsk } : {}),
      ...(r.meta && r.kind === 'automation' ? { automation: JSON.parse(r.meta) as AutomationSpec & { describe: string } } : {}),
      ...(r.scope ? { scope: r.scope as ConnectorScope } : {}),
      createdAt: r.created_at,
      ...(r.resolved_at ? { resolvedAt: r.resolved_at } : {}),
    };
  }

  snapshot(r: ProjectRow): TeamProjectSnapshot {
    const steps = this.sql.exec<StepRow>('SELECT * FROM tsteps WHERE project_id = ? ORDER BY idx ASC', r.project_id).toArray().map((s): ProjectStep => {
      const co = json<string[]>(s.co_owner_ids, []);
      const reviews = json<StepVerdict[]>(s.reviews, []);
      const question = json<{ text: string; detail?: string } | null>(s.question, null);
      const verdict = json<StepVerdict | null>(s.verdict, null);
      const output = s.output ?? s.draft;
      const sources = json<NonNullable<ProjectStep['sources']>>(s.sources, []);
      return {
        id: s.step_id,
        title: s.title,
        brief: s.brief,
        acceptance: s.acceptance,
        ownerId: s.owner_id,
        ...(co.length ? { coOwnerIds: co } : {}),
        reviewerIds: json<string[]>(s.reviewer_ids, []),
        dependsOn: json<string[]>(s.depends_on, []),
        status: s.status as ProjectStep['status'],
        ...(output ? { output } : {}),
        ...(verdict ? { verdict } : {}),
        ...(reviews.length ? { reviews } : {}),
        ...(s.revised ? { revised: true } : {}),
        ...(s.by_id && s.by_id !== s.owner_id ? { byId: s.by_id } : {}),
        ...(s.attempts ? { attempts: s.attempts } : {}),
        ...(question ? { question } : {}),
        ...(s.started_at ? { startedAt: s.started_at } : {}),
        ...(s.finished_at ? { finishedAt: s.finished_at } : {}),
        ...(s.error ? { error: s.error } : {}),
        ...(sources.length ? { sources } : {}),
      };
    });
    const notes = this.sql.exec<NoteRow>('SELECT * FROM tnotes WHERE project_id = ? ORDER BY at ASC, note_id ASC', r.project_id).toArray().map((n) => this.toNote(n));
    const u = this.usage(r.project_id);
    const auto = json<{ automationId: string; name: string } | null>(r.automation, null);
    return {
      projectId: r.project_id,
      title: r.title,
      goal: r.goal,
      ...(auto ? { automation: { automationId: auto.automationId, name: auto.name } } : {}),
      recipeId: r.recipe_id,
      recipeName: r.recipe_name,
      staffingNote: r.staffing_note,
      team: JSON.parse(r.team) as TeamMember[],
      steps,
      status: r.status as TeamProjectStatus,
      decisionId: r.status === 'proposed' ? r.decision_id : null,
      forecast: forecastOf(steps),
      ...(r.deliverable_kind ? { deliverableKind: r.deliverable_kind as DeliverableKind } : {}),
      ...(r.finisher_id ? { finisherId: r.finisher_id } : {}),
      ...(r.deliverable_filename ? { deliverableFilename: r.deliverable_filename } : {}),
      ...(r.qa ? { qa: json<NonNullable<TeamProjectSnapshot['qa']>>(r.qa, { approved: true, notes: '', reviewerId: '' }) } : {}),
      usage: { ...u, budgetTokens: r.budget_tokens ?? tokenBudget(this.p.env) },
      ...(r.kickoff ? { kickoff: r.kickoff as 'pending' | 'done' | 'skipped' } : {}),
      ...(r.discussion_state ? { discussion: json<NonNullable<TeamProjectSnapshot['discussion']>>(r.discussion_state, { question: '', speakerId: '', round: 1, rounds: 1 }) } : {}),
      ...(notes.length ? { notes } : {}),
      ...(r.deliverable ? { deliverable: r.deliverable } : {}),
      ...(r.summary ? { summary: r.summary } : {}),
      ...(r.error ? { error: r.error } : {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      ...(r.finished_at ? { finishedAt: r.finished_at } : {}),
    };
  }
}

/** The deliverable's checker (biz-bot plan.js pickQaReviewer): the most-used reviewer who is not the finisher. */
export function pickQaReviewer(p: Pick<TeamProjectSnapshot, 'steps' | 'team'>, finisherId: string): string | null {
  const count = new Map<string, number>();
  for (const s of p.steps) for (const r of s.reviewerIds) if (r !== finisherId) count.set(r, (count.get(r) ?? 0) + 1);
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ?? p.team.find((m) => m.personaId !== finisherId)?.personaId ?? null;
}
