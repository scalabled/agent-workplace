import { configured, loadConfig } from '../admin/config';
import { tenantOf, withTenant } from '../lib/tenant';
import { DurableObject } from 'cloudflare:workers';
import { fullIndex } from '@headcount/catalog/full';
import { chiefDisplayName } from '@headcount/catalog';
import type { FileView } from '@headcount/protocol/ext/files';
import { canMakeImages } from '../files/store';
import { MissingProviderError, deadlineSignal } from '@headcount/models';
import {
  CHIEF_ID,
  DEFAULT_WORKSPACE_ID,
  EVERYDAY_PROJECT_ID,
  ids,
  projectStream,
  type CancelJobAccepted,
  type ErrorCode,
  type Frame,
  type FrameInput,
  type FrameType,
  type JobId,
  type JobSnapshot,
  type JobStatus,
  type SteerId,
  type SteerJobAccepted,
  type StreamId,
} from '@headcount/protocol';
import type { CheckpointDirective } from '@headcount/agent-loop';
import type { Env } from '../env';
import { DailyCounter, dailyLimit, limitMessage, maxActiveJobs } from '../lib/limits';
import { workspaceStub } from '../lib/stubs';
import type { ConnectorCallResult } from '../connectors/store';
import type { ConnectorAsk } from '@headcount/protocol/ext/connectors';
import type { AgentSetup } from '../agents/store';
import type { PresenceClaim } from '../workspace/feed';
import { Ledger } from '../workspace/ledger';
import { rollupEvents, upsertJobs } from '../workspace/rollup';
import { logError, models, runtime } from '../workspace/runtime';
import { clipText, firstSentence, titleFromRequest } from './job-view';
import { MAX_WORK_STEPS, WorkCancelled, WorkError, planJob, runWorkStep, synthesize, type JobContext, type PlanStep, type StepNote, type WorkDeps } from './work-loop';
import type { ChannelEntry, Decision, DecisionAnswer, PlanEdit, ProjectNote, StaffingContext, StepEdit, StopAllResponse, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import type { RunTrace } from '@headcount/protocol/ext/agents';
import { researchKitFactory } from '../tools/kit';
import { Canvases } from '../canvas/host';
import type { CanvasKind, CanvasSnapshot } from '@headcount/protocol/ext/canvas';
import { Automations, AutomationError, normalizeSpec } from '../automations/host';
import { judgeRun } from '../automations/judge';
import type { AutomationSpec, AutomationView } from '@headcount/protocol/ext/automations';
import { fetchPage, FetchPageError } from '../tools/fetch-page';
import { TeamProjects, type ProjectRefusal, type ProposeRequest } from '../projects/team-host';
import type { ChangeAsk, EffectView, StopState, TestMailbox } from '@headcount/protocol/ext/trust';
import { EffectError, Effects, type EffectRequest, type EffectResult } from '../trust/effects';
import { mailSender, mailStatus, sinkMessages } from '../trust/mail';
import { audit, wsOf } from '../trust/store';

/** What the Chief of Staff hands to the Everyday project when the owner delegates. */
export interface StartJobRequest {
  title: string;
  brief: string;
  /** Idempotency key (the talk turn + tool call); a repeat returns the same job. */
  opId?: string;
  /** Who does the work (Inc 0: the Chief of Staff, in the chosen lead's voice). */
  leadId?: string | null;
  chiefName?: string | null;
}

/** A steer/cancel the ProjectDO refused (RPC-safe: returned, not thrown). */
export interface JobRefusal {
  accepted: false;
  code: Extract<ErrorCode, 'not_found' | 'conflict' | 'bad_request' | 'rate_limited'>;
  message: string;
}

/**
 * A work signal outside the ledger (Inc 0.5): a failed attempt that will be retried. Ephemeral: losing one loses nothing
 * (the WorkspaceDO folds it into mood and may play `oops`).
 */
export interface WorkSignal {
  kind: 'step.retry';
  jobId: JobId;
  /** Attempts failed so far (1 … MAX_ATTEMPTS − 1). */
  attempt: number;
  /** Epoch ms. */
  at: number;
}

/** Batch the ProjectDO mirrors into the owner feed (WorkspaceDO.ingest). */
export interface MirrorBatch {
  source: StreamId;
  frames: Frame[];
  presence?: { agentId: typeof CHIEF_ID; claim: PresenceClaim | null };
  signals?: WorkSignal[];
}

/** Pause between checkpoints when the Mock provider paces a demo (MOCK_DELAY_MS > 0), so there is time to steer. */
export const MOCK_CHECKPOINT_MS = 2500;
/** Keep-alive while a tick runs: if the object dies mid-step, the alarm fires again and recovers. */
export const LEASE_MS = 120_000;
/** Time budget for one checkpoint's model calls (plan, one work step, or the write-up). */
export const CHECKPOINT_BUDGET_MS = 300_000;
export const MAX_ATTEMPTS = 3;
const BRIEF_MAX = 4000;
const STEER_MAX = 2000;

type Phase = 'plan' | 'work' | 'synthesis' | 'finished';

type JobRow = {
  job_id: string;
  op_id: string | null;
  title: string;
  brief: string;
  status: string;
  phase: string;
  label: string;
  step: number;
  total: number | null;
  cursor: number;
  plan: string;
  notes: string;
  partial: string | null;
  result: string | null;
  summary: string | null;
  error_code: string | null;
  error_message: string | null;
  lead_id: string | null;
  chief_name: string | null;
  attempts: number;
  fence: number;
  next_at: number;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  rev: number;
  rolled_rev: number;
};

type SteerRow = { steer_id: string; job_id: string; text: string; status: string; at: string; applied_at: string | null; op_id: string | null };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jobs (
     job_id TEXT PRIMARY KEY, op_id TEXT, title TEXT NOT NULL, brief TEXT NOT NULL,
     status TEXT NOT NULL, phase TEXT NOT NULL, label TEXT NOT NULL,
     step INTEGER NOT NULL DEFAULT 1, total INTEGER, cursor INTEGER NOT NULL DEFAULT 0,
     plan TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '[]',
     partial TEXT, result TEXT, summary TEXT, error_code TEXT, error_message TEXT,
     lead_id TEXT, chief_name TEXT,
     attempts INTEGER NOT NULL DEFAULT 0, fence INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
     started_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
     rev INTEGER NOT NULL DEFAULT 1, rolled_rev INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS jobs_op ON jobs (op_id) WHERE op_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status, next_at)`,
  `CREATE TABLE IF NOT EXISTS steers (
     steer_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL,
     at TEXT NOT NULL, applied_at TEXT, op_id TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS steers_job ON steers (job_id, status, at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS steers_op ON steers (op_id) WHERE op_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS trust_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

const JOB_COLUMNS = new Set(['status', 'phase', 'label', 'step', 'total', 'cursor', 'plan', 'notes', 'partial', 'result', 'summary', 'error_code', 'error_message', 'attempts', 'next_at', 'finished_at']);
type JobPatch = Partial<Pick<JobRow, 'status' | 'phase' | 'label' | 'step' | 'total' | 'cursor' | 'plan' | 'notes' | 'partial' | 'result' | 'summary' | 'error_code' | 'error_message' | 'attempts' | 'next_at' | 'finished_at'>>;

/**
 * ProjectDO — one per project; Everyday is `p:everyday:<ws>` (ARCHITECTURE §2.2). In Inc 0 it runs the
 * Chief of Staff's background jobs durably: plan → 2–4 work steps → synthesis, one checkpoint per alarm
 * tick. At every checkpoint (between steps, and between tool calls inside a step) it applies queued
 * steering; cancel bumps the job's fence so a late result is discarded. Its ledger `p:everyday:<ws>` is
 * authoritative job state; every frame is mirrored into the owner feed through WorkspaceDO.ingest
 * (outbox + single-flight flush, deduplicated on the receiver). RPCs never wait for work (D2).
 */
export class ProjectDO extends DurableObject<Env> {
  private readonly ledger: Ledger;
  private readonly inflight = new Map<string, AbortController>();
  private flushChain: Promise<void> = Promise.resolve();
  private lastClaimKey: string | null = null;
  private readonly usage: DailyCounter;
  /** Inc 1 team projects, hosted here (their tables, lifecycle and frames: src/projects/team-host.ts). */
  private readonly team: TeamProjects;
  /** Automations: schedules and page watchers that start jobs and team projects (src/automations/host.ts). */
  private readonly automations: Automations;
  /** The canvas: apps and documents built from a brief (src/canvas/host.ts). */
  private readonly canvases: Canvases;
  /** Signals waiting for the next mirror batch (sent even when no frame is pending). */
  private readonly signals: WorkSignal[] = [];
  /** Inc 6: real actions (emails) that go out exactly once, with receipts (src/trust/effects.ts). */
  private readonly effects: Effects;

  constructor(ctx: DurableObjectState, env: Env) {
    // The organization this object works for comes from its name (p:everyday:<org>); its settings over the deployment's.
    super(ctx, configured(withTenant(env, tenantOf(ctx, env, 'p:everyday:'))));
    void ctx.blockConcurrencyWhile(() => loadConfig(this.env));
    // Everything below reads the admin page's settings over the deployment's.
    env = this.env;
    for (const stmt of SCHEMA) ctx.storage.sql.exec(stmt);
    this.ledger = new Ledger(ctx.storage, this.streamId, runtime.now);
    this.usage = new DailyCounter(ctx.storage);
    this.team = new TeamProjects({
      storage: ctx.storage,
      env,
      usage: this.usage,
      append: (input) => this.append(input),
      flush: () => this.flush(),
      armAlarm: (at) => this.armAlarm(at),
      // The owner's overrides for coworkers live in the WorkspaceDO.
      agents: async (ids) => (await workspaceStub(env).agentSetup(ids)) as unknown as AgentSetup,
      background: (work) => ctx.waitUntil(work.catch((err) => logError('project.background', err))),
      // Connector calls run where the keys are.
      connectors: {
        call: async (req) => (await workspaceStub(env).connectorCall(req)) as unknown as ConnectorCallResult,
        grant: async (req) => void (await workspaceStub(env).connectorGrant(req)),
      },
      // What the workspace knows (the Handbook, memories) lives in the WorkspaceDO.
      knowledge: async (query, scopes) => String(await workspaceStub(env).knowledgeFor(query, scopes)),
      distillMeeting: async (input) => void (await workspaceStub(env).distillMeeting(input)),
      // Phase 4: images for the work, made and kept in the WorkspaceDO's Files.
      media: {
        canImage: () => canMakeImages(this.env),
        image: async (req) => {
          const r = (await workspaceStub(env).makeImage({ prompt: req.prompt, ...(req.aspect ? { aspect: req.aspect } : {}), madeBy: req.madeBy, source: { kind: 'project', ref: req.projectId }, wait: true })) as unknown as { ok: true; file: FileView } | { ok: false; message: string };
          return r.ok ? { ok: true, file: r.file } : { ok: false, message: r.message };
        },
      },
      // Inc 6: emails (exactly once, with receipts) and changes the owner approved.
      effects: {
        ready: () => {
          const s = mailStatus(this.env);
          return { ready: s.ready, test: s.provider === 'sink' };
        },
        request: (req) => this.effects.request(req),
        answer: (d, a, by) => this.effects.answer(d, a, by),
        dropped: (decisionId) => {
          for (const e of this.effects.forDecision(decisionId)) if (e.status === 'awaiting' || e.status === 'unknown') this.ctx.storage.sql.exec(`UPDATE effects SET status = 'declined', updated_at = ? WHERE key = ?`, new Date(runtime.now()).toISOString(), e.key);
        },
      },
      changes: {
        apply: async (ask, by) => (await workspaceStub(env).applyChange(ask, by)) as unknown as { ok: true; summary: string } | { ok: false; message: string },
      },
      audited: (e) =>
        ctx.waitUntil(audit(env.DB, wsOf(env), { actor: e.actor, kind: 'change', action: 'automation.created', summary: e.summary, link: '/app/automations', undo: { type: 'automation.remove', automationId: e.automationId, label: 'Remove the automation' } })),
      // The owner allowed an automation the Chief proposed.
      automations: {
        create: (spec) => {
          try {
            const a = this.automations.create(spec, 'chief');
            void this.armAlarm(Math.max(this.automations.nextDue() ?? runtime.now(), runtime.now() + 10));
            return { ok: true, name: a.name, automationId: a.automationId };
          } catch (err) {
            if (err instanceof AutomationError) return { ok: false, message: err.message };
            throw err;
          }
        },
      },
    });
    this.automations = new Automations({
      sql: ctx.storage.sql,
      now: () => runtime.now(),
      append: (input) => this.ledger.append(input),
      flush: () => this.flush(),
      startJob: async (title, brief) => {
        const r = await this.startJob({ title, brief, ...(await this.chiefIdentity()) });
        return 'jobId' in r ? { ok: true, runId: r.jobId } : { ok: false, message: r.message };
      },
      proposeProject: async (goal, title, automation) => {
        const who = await this.chiefIdentity();
        const r = await this.team.propose({ goal, title, chiefName: who.chiefName ?? 'your Chief of Staff', leadId: who.leadId, automation });
        return 'project' in r ? { ok: true, runId: r.project.projectId } : { ok: false, message: r.message };
      },
      readPage: async (url) => {
        const limit = dailyLimit(env, 'fetch');
        if (!this.usage.take('fetch', limit, runtime.now()).allowed) throw new Error(limitMessage('fetch', limit));
        try {
          return (await fetchPage(url, { maxChars: 60_000 })).text;
        } catch (err) {
          throw new Error(err instanceof FetchPageError ? err.message : 'The page could not be read.');
        }
      },
      judge: (name, result) => judgeRun(env, name, result),
      background: (work) => ctx.waitUntil(work.catch((err) => logError('automation', err))),
    });
    this.effects = new Effects({
      sql: ctx.storage.sql,
      env,
      now: () => runtime.now(),
      append: (input) => this.ledger.append(input),
      flush: () => this.flush(),
      armAlarm: (at) => this.armAlarm(at),
      stopped: () => this.stopState(),
      takeEmail: () => this.usage.take('email', dailyLimit(env, 'email'), runtime.now()).allowed,
      limitMessage: () => limitMessage('email', dailyLimit(env, 'email')),
      sender: () => mailSender(env, ctx.storage.sql, () => runtime.now()),
      ownerName: async () => ((await workspaceStub(env).getSettings()) as unknown as { ownerName?: string | null }).ownerName ?? null,
      raise: (input) => this.team.raiseEffect(input),
    });
    this.canvases = new Canvases({
      sql: ctx.storage.sql,
      blobs: env.BLOBS,
      workspaceId: env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID,
      now: () => runtime.now(),
      append: (input) => this.ledger.append(input),
      flush: () => this.flush(),
      model: () => {
        const r = models(env, { surface: 'canvas' }).resolve('chat', { tier: 'reason' });
        return { provider: r.provider, model: r.model, mock: r.providerId === 'mock' };
      },
      take: () => this.usage.take('canvas', dailyLimit(env, 'canvas'), runtime.now()).allowed,
    });
  }

  private get workspaceId(): string {
    return this.env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID;
  }

  private get streamId(): StreamId {
    return projectStream(this.workspaceId, EVERYDAY_PROJECT_ID);
  }

  // ── RPC ─────────────────────────────────────────────────────────────────────────

  /** Today's use of the daily limits this object counts (the admin page). */
  async dailyCounts(): Promise<Record<string, number>> {
    return this.usage.today(runtime.now());
  }

  /**
   * Start a background job. Returns at once with its snapshot; the work runs on alarms. Refused (rate_limited)
   * when MAX_ACTIVE_JOBS are already running or JOB_DAILY_LIMIT is used up, so a model that keeps delegating
   * cannot spend without bound.
   */

  async startJob(req: StartJobRequest): Promise<JobSnapshot | JobRefusal> {
    if (req.opId) {
      const existing = this.ctx.storage.sql.exec<JobRow>('SELECT * FROM jobs WHERE op_id = ?', req.opId).toArray()[0];
      if (existing) return this.snapshot(existing);
    }
    const now = runtime.now();
    const maxActive = maxActiveJobs(this.env);
    const active = Number(this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE status IN ('running', 'queued')`).toArray()[0]?.n ?? 0);
    if (active >= maxActive) {
      return { accepted: false, code: 'rate_limited', message: `${active} background job${active === 1 ? ' is' : 's are'} already running, the most at once. Let one finish or stop one first (MAX_ACTIVE_JOBS in apps/worker/.dev.vars raises the limit).` };
    }
    const daily = dailyLimit(this.env, 'job');
    if (!this.usage.take('job', daily, now).allowed) return { accepted: false, code: 'rate_limited', message: limitMessage('job', daily) };
    const brief = String(req.brief ?? '').trim().slice(0, BRIEF_MAX);
    const title = clipText(String(req.title ?? '').trim() || titleFromRequest(brief), 80) || 'Background job';
    const iso = new Date(now).toISOString();
    const jobId = ids.job();
    this.ctx.storage.sql.exec(
      `INSERT INTO jobs (job_id, op_id, title, brief, status, phase, label, step, total, lead_id, chief_name, next_at, started_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', 'plan', ?, 1, NULL, ?, ?, ?, ?, ?)`,
      jobId,
      req.opId ?? null,
      title,
      brief || title,
      `Making a plan for “${title}”`,
      req.leadId ?? null,
      req.chiefName ?? null,
      now,
      iso,
      iso,
    );
    const job = this.snapshot(this.row(jobId)!);
    this.append({ type: 'job.started', data: { job }, actor: CHIEF_ID, ...(req.opId ? { opId: req.opId } : {}) });
    await this.armAlarm(now);
    await this.flush();
    return job;
  }

  /** Live state of recent jobs, newest first: the source for "how's it going?". Never waits on work. */
  // ── Inc 1 team projects (src/projects/team-host.ts) ──────────────────────────────

  /** Staff a team and propose its plan (raises the plan-approval hand in the Inbox). */
  proposeProject(req: ProposeRequest): Promise<{ project: TeamProjectSnapshot; decision: Decision | null } | ProjectRefusal> {
    return this.team.propose(req);
  }

  /** The owner answers a raised hand (a plan, a lead's question, a review escalation, the deliverable, the budget). */
  answerDecision(decisionId: string, a: DecisionAnswer, by = 'owner'): Promise<{ accepted: true; decision: Decision; project?: TeamProjectSnapshot } | ProjectRefusal> {
    return this.team.answer(decisionId, a, by);
  }

  // ── Inc 6 trust: emails exactly once, changes for the owner's OK, Everyone stop ─────────────

  /** An agent asks to send an email (the Chief of Staff, or a coworker at their desk). */
  async requestEffect(req: EffectRequest): Promise<EffectResult | { status: 'invalid'; message: string }> {
    try {
      return await this.effects.request(req);
    } catch (err) {
      if (err instanceof EffectError) return { status: 'invalid', message: err.message };
      throw err;
    }
  }

  /** A change inside Headcount for the owner's OK (a coworker's own instructions, a Handbook section). */
  async openChange(ask: ChangeAsk, fromId: string, title: string): Promise<Decision> {
    return this.team.openChange(ask, fromId, title);
  }

  async trustState(): Promise<{ effects: EffectView[]; stopped: StopState | null }> {
    return { effects: this.effects.open(), stopped: this.stopState() };
  }

  /** What an agent recently asked to send, and what became of it (its context for "did it go out?"). */
  async recentEffects(agentId: string, limit = 5): Promise<EffectView[]> {
    return this.effects.recent(agentId, limit);
  }

  async testMailbox(): Promise<TestMailbox> {
    return { messages: sinkMessages(this.ctx.storage.sql).map((m) => ({ key: m.key, at: m.at, from: m.mail.from, to: m.mail.to, ...(m.mail.cc ? { cc: m.mail.cc } : {}), subject: m.mail.subject, text: m.mail.text })) };
  }

  /** The owner's test email to themself (Admin → Email). */
  async sendTestEmail(to: string, by: string): Promise<EffectResult | { status: 'invalid'; message: string }> {
    try {
      const r = await this.effects.ownerTest(to, by);
      await this.flush();
      return r;
    } catch (err) {
      if (err instanceof EffectError) return { status: 'invalid', message: err.message };
      throw err;
    }
  }

  private stopState(): StopState | null {
    const r = this.ctx.storage.sql.exec<{ value: string }>(`SELECT value FROM trust_state WHERE key = 'stop'`).toArray()[0];
    return r ? (JSON.parse(r.value) as StopState) : null;
  }

  /** Everyone stop ends (an owner's on-screen OK): held emails that had an OK go out; the rest ask again. */
  async resumeAll(by: string): Promise<{ resumed: boolean }> {
    if (!this.stopState()) return { resumed: false };
    this.ctx.storage.sql.exec(`DELETE FROM trust_state WHERE key = 'stop'`);
    this.append({ type: 'trust.updated', data: { stopped: null } });
    await audit(this.env.DB, wsOf(this.env), { actor: `owner:${by}`, kind: 'stop', action: 'stop.resumed', summary: 'Resumed after Everyone stop', link: '/app/admin/autonomy' });
    await this.effects.resume();
    await this.flush();
    return { resumed: true };
  }

  /** The Chief of Staff asks the owner's OK for a connector call (a raised hand with no project). */
  async openChiefApproval(ask: ConnectorAsk, title: string): Promise<Decision> {
    return this.team.openChiefApproval(ask, title);
  }

  async editStep(projectId: string, stepId: string, e: StepEdit) {
    return this.team.editStep(projectId, stepId, e);
  }

  async addStep(projectId: string, e: StepEdit) {
    return this.team.addStep(projectId, e);
  }

  async removeStep(projectId: string, stepId: string) {
    return this.team.removeStep(projectId, stepId);
  }

  async editPlan(projectId: string, e: PlanEdit) {
    return this.team.editPlan(projectId, e);
  }

  /** The team channel of a project (oldest first). */
  async projectChannel(projectId: string): Promise<ChannelEntry[]> {
    return this.team.channelEntries(projectId);
  }

  /** The owner writes to the team; those named (or the lead) answer at once. */
  async postChannel(projectId: string, text: string): Promise<{ accepted: true; entry: ChannelEntry } | ProjectRefusal> {
    return this.team.postChannel(projectId, text);
  }

  /** The owner asks the team to discuss something. */
  async discuss(projectId: string, question: string, rounds?: number, kind?: 'discussion' | 'review') {
    return this.team.discuss(projectId, question, rounds, kind);
  }

  /** Inc 2: a project's meetings, one meeting with its lines, and the owner taking the floor or whispering. */
  async projectMeetings(projectId: string) {
    return this.team.meetings(projectId);
  }

  async getMeeting(projectId: string, meetingId: string) {
    return this.team.getMeeting(projectId, meetingId);
  }

  async meetingSay(projectId: string, meetingId: string, text: string, toId?: string, whisper?: boolean) {
    return this.team.meetingSay(projectId, meetingId, text, toId, whisper);
  }

  /** Every meeting in the office (live first), one by id, and a meeting called on its own. */
  async allMeetings(limit?: number) {
    return this.team.allMeetings(limit);
  }

  async findMeeting(meetingId: string) {
    return this.team.findMeeting(meetingId);
  }

  async callMeeting(req: { topic: string; people: string[]; rounds?: number; chiefName?: string; leadId?: string | null; context?: string; opener?: string }) {
    if (this.stopState()) return { accepted: false as const, code: 'conflict' as const, message: 'Everyone stop is on. An owner resumes work in Admin → Autonomy first.' };
    const who = req.chiefName ? { leadId: req.leadId ?? null, chiefName: req.chiefName } : await this.chiefIdentity();
    const lead = who.leadId ? fullIndex.lead(who.leadId) : undefined;
    return this.team.callMeeting({ ...req, chiefName: req.chiefName ?? chiefDisplayName(lead, who.chiefName), leadId: who.leadId });
  }

  /** Open raised hands (the Chief can relay the owner's answer). */
  async openDecisions(): Promise<Decision[]> {
    return this.team.list(1).decisions;
  }

  /** Every model call of a project (the run inspector). */
  async projectRuns(projectId: string, stepId?: string): Promise<RunTrace[]> {
    return this.team.runs(projectId, stepId);
  }

  approveProject(projectId: string): Promise<{ accepted: true; project: TeamProjectSnapshot } | ProjectRefusal> {
    return this.team.approve(projectId);
  }

  cancelProject(projectId: string, reason?: string): Promise<{ accepted: true; project: TeamProjectSnapshot } | ProjectRefusal> {
    return this.team.cancel(projectId, reason);
  }

  /** Owner direction for a project under way; it reaches the next step that starts. */
  async noteProject(projectId: string, req: { text: string; toId?: string; via: ProjectNote['via']; opId?: string }): Promise<{ accepted: true; project: TeamProjectSnapshot; note: ProjectNote } | ProjectRefusal> {
    return this.team.note(projectId, req);
  }

  async pauseProject(projectId: string): Promise<{ accepted: true; project: TeamProjectSnapshot } | ProjectRefusal> {
    return this.team.pause(projectId);
  }

  async resumeProject(projectId: string): Promise<{ accepted: true; project: TeamProjectSnapshot } | ProjectRefusal> {
    const r = await this.team.resume(projectId);
    if (r.accepted) await this.reschedule();
    return r;
  }

  /** A coworker's part in the projects under way (their desk quick chat reads it). */
  async staffingOf(personaId: string): Promise<StaffingContext[]> {
    return this.team.staffingOf(personaId);
  }

  async listProjects(limit = 20): Promise<{ projects: TeamProjectSnapshot[]; decisions: Decision[] }> {
    return this.team.list(limit);
  }

  async getProject(projectId: string): Promise<TeamProjectSnapshot | null> {
    return this.team.get(projectId);
  }

  /** Proposed and running projects, for the Chief of Staff's live work state. */
  async activeProjects(): Promise<TeamProjectSnapshot[]> {
    return this.team.active();
  }

  /** "Everyone stop": halt every running job and team project at once. Plans waiting for the owner's OK stay. */
  async stopAll(by: 'owner' | 'chief' = 'owner', who?: string): Promise<StopAllResponse> {
    // Inc 6: the stop stays on until an owner resumes; until then emails are held, not sent.
    if (!this.stopState()) {
      const stop: StopState = { at: new Date(runtime.now()).toISOString(), by: who ?? by };
      this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO trust_state (key, value) VALUES ('stop', ?)`, JSON.stringify(stop));
      this.append({ type: 'trust.updated', data: { stopped: stop } });
      this.ctx.waitUntil(audit(this.env.DB, wsOf(this.env), { actor: who ? `owner:${who}` : by, kind: 'stop', action: 'stop.on', summary: 'Everyone stop: all work halted; emails are held until an owner resumes', link: '/app/admin/autonomy' }));
    }
    const jobs = this.ctx.storage.sql.exec<{ job_id: string }>(`SELECT job_id FROM jobs WHERE status IN ('running','queued')`).toArray();
    let stoppedJobs = 0;
    for (const j of jobs) if ((await this.cancelJob(j.job_id, 'Everyone stop.', by)).accepted) stoppedJobs++;
    let stoppedProjects = 0;
    for (const p of this.team.active()) {
      if (p.status !== 'running' && p.status !== 'paused') continue;
      if ((await this.team.cancel(p.projectId, 'Everyone stop: the owner halted all work.')).accepted) stoppedProjects++;
    }
    this.team.stopMeetings();
    await this.flush();
    await this.reschedule();
    return { stoppedJobs, stoppedProjects };
  }

  async listJobs(limit = 20): Promise<JobSnapshot[]> {
    const rows = this.ctx.storage.sql.exec<JobRow>('SELECT * FROM jobs ORDER BY started_at DESC, job_id DESC LIMIT ?', Math.max(1, Math.min(100, limit))).toArray();
    return rows.map((r) => this.snapshot(r));
  }

  async getJob(jobId: string): Promise<JobSnapshot | null> {
    const row = this.row(jobId);
    return row ? this.snapshot(row) : null;
  }

  /** Queue steering; it is applied at the job's next checkpoint (job.steered queued → applied). */
  async steerJob(jobId: string, text: string, opId?: string): Promise<SteerJobAccepted | JobRefusal> {
    const clean = String(text ?? '').trim().slice(0, STEER_MAX);
    if (!clean) return { accepted: false, code: 'bad_request', message: 'Add what the job should change.' };
    if (opId) {
      const prior = this.ctx.storage.sql.exec<SteerRow>('SELECT * FROM steers WHERE op_id = ?', opId).toArray()[0];
      if (prior) return { accepted: true, jobId: prior.job_id as JobId, steerId: prior.steer_id as SteerId };
    }
    const row = this.row(jobId);
    if (!row) return { accepted: false, code: 'not_found', message: 'That job does not exist.' };
    if (row.status !== 'running' && row.status !== 'queued') return { accepted: false, code: 'conflict', message: `“${row.title}” is already ${row.status}; start a new job instead.` };
    const steerId = ids.steer();
    const iso = new Date(runtime.now()).toISOString();
    this.ctx.storage.sql.exec(`INSERT INTO steers (steer_id, job_id, text, status, at, op_id) VALUES (?, ?, ?, 'queued', ?, ?)`, steerId, jobId, clean, iso, opId ?? null);
    this.patch(jobId, null, {});
    this.append({ type: 'job.steered', data: { jobId: jobId as JobId, steerId, text: clean, status: 'queued' }, actor: 'owner', ...(opId ? { opId } : {}) });
    await this.flush();
    return { accepted: true, jobId: jobId as JobId, steerId };
  }

  /**
   * Stop a job for good: fence it, abort its in-flight model call, emit job.cancelled. `by` says who pressed it:
   * 'owner' from the UI (the Chief of Staff then acknowledges it in the thread), 'chief' from a turn.
   */
  async cancelJob(jobId: string, reason?: string, by: 'owner' | 'chief' = 'owner'): Promise<CancelJobAccepted | JobRefusal> {
    const row = this.row(jobId);
    if (!row) return { accepted: false, code: 'not_found', message: 'That job does not exist.' };
    if (row.status === 'cancelled') return { accepted: true, jobId: jobId as JobId };
    if (row.status !== 'running' && row.status !== 'queued') return { accepted: false, code: 'conflict', message: `“${row.title}” already ${row.status === 'done' ? 'finished' : 'failed'}.` };
    const iso = new Date(runtime.now()).toISOString();
    this.ctx.storage.sql.exec('UPDATE jobs SET fence = fence + 1 WHERE job_id = ?', jobId);
    this.patch(jobId, null, { status: 'cancelled', phase: 'finished', label: `Stopped “${row.title}”`, finished_at: iso });
    this.inflight.get(jobId)?.abort();
    this.append({ type: 'job.cancelled', data: { jobId: jobId as JobId, ...(reason ? { reason: clipText(reason, 200) } : {}), by }, actor: 'owner' });
    await this.flush();
    await this.reschedule();
    return { accepted: true, jobId: jobId as JobId };
  }

  /** One tick: advance every due job by one checkpoint, mirror the frames, re-arm. */
  override async alarm(): Promise<void> {
    const now = runtime.now();
    await this.ctx.storage.setAlarm(now + LEASE_MS);
    const due = this.ctx.storage.sql
      .exec<{ job_id: string }>(`SELECT job_id FROM jobs WHERE status = 'running' AND next_at <= ? ORDER BY started_at ASC`, now)
      .toArray()
      .filter((r) => !this.inflight.has(r.job_id));
    // Canvas builds run on their own (minutes of writing); the alarm only starts them and keeps its heartbeat.
    for (const build of this.canvases.tick()) this.ctx.waitUntil(build.catch((err) => logError('canvas.build', err)));
    await Promise.all([...due.map((r) => this.advance(r.job_id)), this.team.tick(now), this.automations.tick(now), this.effects.recover().catch((err) => logError('effects.recover', err))]);
    await this.flush();
    await this.reschedule();
  }

  // ── the work loop ─────────────────────────────────────────────────────────────

  private async advance(jobId: string): Promise<void> {
    let row = this.row(jobId);
    if (!row || row.status !== 'running') return;
    const fence = row.fence;
    // Checkpoint between steps: queued steering lands here.
    this.applySteers(row, 'between');
    row = this.row(jobId)!;

    const ac = new AbortController();
    this.inflight.set(jobId, ac);
    try {
      let deps: WorkDeps;
      let pace = 0;
      try {
        const resolved = models(this.env, { surface: 'job' }).resolve('chat', { tier: 'reason', needs: ['tools'] });
        // Each checkpoint gets its own time budget (a local 32B model can take minutes on a work step).
        deps = { provider: resolved.provider, model: resolved.model, signal: deadlineSignal(CHECKPOINT_BUDGET_MS, ac.signal), research: researchKitFactory(this.env, this.usage, resolved.provider) };
        if (resolved.providerId === 'mock' && Number(this.env.MOCK_DELAY_MS ?? 0) > 0) pace = MOCK_CHECKPOINT_MS;
      } catch (err) {
        if (err instanceof MissingProviderError) return this.fail(row, 'not_configured', err.message, false);
        throw err;
      }
      const phase = row.phase as Phase;
      if (phase === 'plan') await this.doPlan(row, deps);
      else if (phase === 'work') await this.doWork(row, deps);
      else if (phase === 'synthesis') await this.doSynthesis(row, deps);
      if (this.isLive(jobId, fence)) this.patch(jobId, fence, { attempts: 0, next_at: runtime.now() + pace });
    } catch (err) {
      if (!this.isLive(jobId, fence) || (err instanceof WorkCancelled && ac.signal.aborted)) return;
      // A WorkCancelled that the owner did not cause is the checkpoint's deadline: count it as a failed attempt.
      if (err instanceof WorkCancelled) err = new WorkError(`The checkpoint took longer than ${CHECKPOINT_BUDGET_MS / 60_000} minutes.`, true);
      const attempts = row.attempts + 1;
      const retryable = !(err instanceof WorkError) || err.retryable;
      logError(`project.job ${jobId} ${row.phase}`, err);
      if (!retryable || attempts >= MAX_ATTEMPTS) {
        // The reason only: the announcement and the status line already name the job ("I could not finish “…”.").
        this.fail(row, 'provider_error', 'The model kept failing, so I stopped retrying. Try again in a minute, or check the provider key.', true);
      } else {
        this.patch(jobId, fence, { attempts, next_at: runtime.now() + 1000 * 2 ** (attempts - 1) });
        this.signals.push({ kind: 'step.retry', jobId: jobId as JobId, attempt: attempts, at: runtime.now() });
      }
    } finally {
      this.inflight.delete(jobId);
      // Mirror this job's frames (progress, done) as soon as its checkpoint ends, not when the slowest
      // concurrent checkpoint of the same alarm tick does.
      void this.flush();
    }
  }

  private async doPlan(row: JobRow, deps: WorkDeps): Promise<void> {
    const ctx = this.context(row);
    const { steps } = await planJob(deps, ctx);
    if (!this.isLive(row.job_id, row.fence)) throw new WorkCancelled();
    const plan = steps.slice(0, MAX_WORK_STEPS);
    const total = plan.length + 2;
    const partial = `Plan: ${plan.map((p) => p.label).join(' → ')}.`;
    this.patch(row.job_id, row.fence, { plan: JSON.stringify(plan), phase: 'work', cursor: 0, step: 2, total, label: plan[0]!.label, partial });
    this.append({ type: 'job.progress', data: { jobId: row.job_id as JobId, label: plan[0]!.label, step: 2, of: total, partial }, actor: CHIEF_ID });
  }

  private async doWork(row: JobRow, deps: WorkDeps): Promise<void> {
    const ctx = this.context(row);
    const index = row.cursor;
    const step = ctx.plan[index];
    if (!step) {
      this.patch(row.job_id, row.fence, { phase: 'synthesis', label: 'Writing up the findings', step: ctx.plan.length + 2, total: ctx.plan.length + 2 });
      return;
    }
    const out = await runWorkStep(deps, ctx, index, {
      onFinding: (text) => this.recordFinding(row.job_id, row.fence, text),
      checkpoint: () => this.midStepCheckpoint(row.job_id, row.fence),
    });
    if (!this.isLive(row.job_id, row.fence)) throw new WorkCancelled();
    const fresh = this.row(row.job_id)!;
    const plan = JSON.parse(fresh.plan) as PlanStep[];
    const notes = [...(JSON.parse(fresh.notes) as StepNote[]), { label: step.label, text: out.text, ...(out.sources.length ? { sources: out.sources } : {}) }];
    const next = index + 1;
    const total = plan.length + 2;
    const done = next >= plan.length;
    const label = done ? 'Writing up the findings' : plan[next]!.label;
    const partial = clipText(out.findings.at(-1) ?? firstSentence(out.text), 300);
    this.patch(row.job_id, row.fence, { notes: JSON.stringify(notes), cursor: next, phase: done ? 'synthesis' : 'work', step: next + 2, total, label, partial });
    this.append({ type: 'job.progress', data: { jobId: row.job_id as JobId, label, step: next + 2, of: total, partial }, actor: CHIEF_ID });
  }

  private async doSynthesis(row: JobRow, deps: WorkDeps): Promise<void> {
    const ctx = this.context(row);
    const { summary, markdown } = await synthesize(deps, ctx);
    if (!this.isLive(row.job_id, row.fence)) throw new WorkCancelled();
    // Steering that arrived while the write-up was being written: this is its checkpoint. Apply it and write
    // the deliverable again at the next tick, so a note the owner was promised is never silently dropped.
    const late = this.applySteers(this.row(row.job_id)!, 'within');
    if (late.length) {
      const label = `Adding your note${late.length > 1 ? 's' : ''} to the write-up`;
      this.patch(row.job_id, row.fence, { label });
      this.append({ type: 'job.progress', data: { jobId: row.job_id as JobId, label, step: row.step, of: row.total, ...(row.partial ? { partial: row.partial } : {}) }, actor: CHIEF_ID });
      return;
    }
    const finishedText = `Finished “${row.title}”`;
    const total = ctx.plan.length + 2;
    this.patch(row.job_id, row.fence, { status: 'done', phase: 'finished', step: total, total, label: finishedText, result: markdown, summary, finished_at: new Date(runtime.now()).toISOString() });
    this.append({ type: 'job.done', data: { jobId: row.job_id as JobId, summary, result: markdown, finishedText }, actor: CHIEF_ID });
  }

  /** A finding recorded mid-step becomes the job's latest partial at once (sentence-rate progress). */
  private async recordFinding(jobId: string, fence: number, text: string): Promise<void> {
    if (!this.isLive(jobId, fence)) return;
    const row = this.row(jobId)!;
    const partial = clipText(text, 300);
    this.patch(jobId, fence, { partial });
    this.append({ type: 'job.progress', data: { jobId: jobId as JobId, label: row.label, step: row.step, of: row.total, partial }, actor: CHIEF_ID });
    void this.flush();
  }

  /** Checkpoint between tool calls inside a step: stop when fenced, inject queued steering. */
  private midStepCheckpoint(jobId: string, fence: number): CheckpointDirective | void {
    if (!this.isLive(jobId, fence)) return { stop: 'cancelled' };
    const applied = this.applySteers(this.row(jobId)!, 'within');
    if (!applied.length) return;
    void this.flush();
    return { inject: applied.map((s) => `Owner's steering (apply it from now on; it overrides the brief): ${s.text}`) };
  }

  /**
   * Apply queued steering at a checkpoint. Between steps during the work phase each note also becomes a
   * follow-up step (so the owner sees it being handled); inside a step it is injected into the transcript.
   */
  private applySteers(row: JobRow, mode: 'between' | 'within'): SteerRow[] {
    const queued = this.ctx.storage.sql.exec<SteerRow>(`SELECT * FROM steers WHERE job_id = ? AND status = 'queued' ORDER BY at ASC, rowid ASC`, row.job_id).toArray();
    if (!queued.length) return [];
    const iso = new Date(runtime.now()).toISOString();
    for (const s of queued) {
      this.ctx.storage.sql.exec(`UPDATE steers SET status = 'applied', applied_at = ? WHERE steer_id = ?`, iso, s.steer_id);
      this.append({ type: 'job.steered', data: { jobId: row.job_id as JobId, steerId: s.steer_id as SteerId, text: s.text, status: 'applied' }, actor: CHIEF_ID });
    }
    if (mode === 'between' && row.phase === 'work') {
      const plan = JSON.parse(row.plan) as PlanStep[];
      for (const s of queued) if (plan.length < MAX_WORK_STEPS) plan.push({ label: `Looking into your note: “${clipText(s.text, 60)}”`, goal: s.text, steerId: s.steer_id });
      const total = plan.length + 2;
      this.patch(row.job_id, row.fence, { plan: JSON.stringify(plan), total });
      this.append({ type: 'job.progress', data: { jobId: row.job_id as JobId, label: row.label, step: row.step, of: total, ...(row.partial ? { partial: row.partial } : {}) }, actor: CHIEF_ID });
    } else {
      this.patch(row.job_id, null, {});
    }
    return queued;
  }

  private fail(row: JobRow, code: ErrorCode, message: string, retryable: boolean): void {
    this.patch(row.job_id, row.fence, { status: 'failed', phase: 'finished', label: `Could not finish “${row.title}”`, error_code: code, error_message: message, finished_at: new Date(runtime.now()).toISOString() });
    this.append({ type: 'job.failed', data: { jobId: row.job_id as JobId, code, message, retryable }, actor: CHIEF_ID });
  }

  // ── state ─────────────────────────────────────────────────────────────────────

  private row(jobId: string): JobRow | undefined {
    return this.ctx.storage.sql.exec<JobRow>('SELECT * FROM jobs WHERE job_id = ?', jobId).toArray()[0];
  }

  private isLive(jobId: string, fence: number): boolean {
    const r = this.ctx.storage.sql.exec<{ status: string; fence: number }>('SELECT status, fence FROM jobs WHERE job_id = ?', jobId).toArray()[0];
    return !!r && r.status === 'running' && Number(r.fence) === fence;
  }

  /** Update a job (bumps rev for the D1 roll-up). With a fence, only while the job is still that fence. */
  private patch(jobId: string, fence: number | null, patch: JobPatch): boolean {
    const keys = Object.keys(patch).filter((k) => JOB_COLUMNS.has(k)) as (keyof JobPatch)[];
    const sets = [...keys.map((k) => `${k} = ?`), 'updated_at = ?', 'rev = rev + 1'];
    const values = [...keys.map((k) => patch[k] ?? null), new Date(runtime.now()).toISOString()];
    const where = fence === null ? 'job_id = ?' : 'job_id = ? AND fence = ?';
    const cursor = this.ctx.storage.sql.exec(`UPDATE jobs SET ${sets.join(', ')} WHERE ${where}`, ...values, jobId, ...(fence === null ? [] : [fence]));
    return cursor.rowsWritten > 0;
  }

  private steersFor(jobId: string): SteerRow[] {
    return this.ctx.storage.sql.exec<SteerRow>('SELECT * FROM steers WHERE job_id = ? ORDER BY at ASC, rowid ASC', jobId).toArray();
  }

  private context(row: JobRow): JobContext {
    const lead = row.lead_id ? fullIndex.lead(row.lead_id) : undefined;
    return {
      title: row.title,
      brief: row.brief,
      steers: this.steersFor(row.job_id)
        .filter((s) => s.status === 'applied')
        .map((s) => s.text),
      plan: JSON.parse(row.plan) as PlanStep[],
      notes: JSON.parse(row.notes) as StepNote[],
      chiefName: chiefDisplayName(lead, row.chief_name),
      lead,
    };
  }

  private snapshot(row: JobRow): JobSnapshot {
    const job: JobSnapshot = {
      jobId: row.job_id as JobId,
      projectId: EVERYDAY_PROJECT_ID,
      title: row.title,
      brief: row.brief,
      status: row.status as JobStatus,
      label: row.label,
      step: Number(row.step),
      of: row.total === null ? null : Number(row.total),
      agentId: CHIEF_ID,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      steers: this.steersFor(row.job_id).map((s) => ({ steerId: s.steer_id as SteerId, text: s.text, status: s.status as 'queued' | 'applied', at: s.at, ...(s.applied_at ? { appliedAt: s.applied_at } : {}) })),
    };
    if (row.finished_at) job.finishedAt = row.finished_at;
    if (row.partial) job.partial = row.partial;
    if (row.result) job.result = row.result;
    if (row.summary) job.summary = row.summary;
    if (row.error_code) job.error = { code: row.error_code as ErrorCode, message: row.error_message ?? '' };
    return job;
  }

  // ── ledger, mirror, roll-up, alarms ─────────────────────────────────────────────

  private append<T extends FrameType>(input: FrameInput<T>): void {
    this.ledger.append(input);
    // A job or team project an automation started may have just ended.
    this.automations?.observe(input as FrameInput<FrameType>);
  }

  /** Who the Chief of Staff is (their lead and name), for work an automation starts. */
  private async chiefIdentity(): Promise<{ leadId: string | null; chiefName: string | null }> {
    try {
      const s = (await workspaceStub(this.env).getSettings()) as unknown as { leadId: string | null; chiefName: string | null };
      return { leadId: s.leadId ?? null, chiefName: s.chiefName ?? null };
    } catch (err) {
      logError('automation.identity', err);
      return { leadId: null, chiefName: null };
    }
  }

  // ── the canvas ────────────────────────────────────────────────────────────────────

  async listCanvas(): Promise<CanvasSnapshot[]> {
    return this.canvases.list();
  }

  async getCanvas(canvasId: string) {
    return this.canvases.get(canvasId);
  }

  async createCanvas(req: { brief: string; title?: string; kind?: CanvasKind; by: 'owner' | 'chief' }) {
    return this.canvasOp(() => this.canvases.create(req));
  }

  async reviseCanvas(canvasId: string, brief: string, by: 'owner' | 'chief') {
    return this.canvasOp(() => this.canvases.revise(canvasId, brief, by));
  }

  async repairCanvas(canvasId: string, errors: unknown) {
    return this.canvasOp(() => this.canvases.repair(canvasId, errors));
  }

  async retryCanvas(canvasId: string) {
    return this.canvasOp(() => this.canvases.retry(canvasId));
  }

  async removeCanvas(canvasId: string): Promise<{ removed: boolean }> {
    return { removed: await this.canvases.remove(canvasId) };
  }

  /** The canvas's content for serving (the Worker renders it with its sandbox policy). */
  async canvasContent(canvasId: string, preview = false) {
    return this.canvases.content(canvasId, preview);
  }

  private async canvasOp<T extends { accepted: boolean }>(fn: () => T): Promise<T> {
    const r = fn();
    if (r.accepted) {
      await this.armAlarm(runtime.now() + 10);
      await this.flush();
    }
    return r;
  }

  // ── automations (stage 3b) ────────────────────────────────────────────────────────

  async listAutomations(): Promise<AutomationView[]> {
    return this.automations.list();
  }

  async addAutomation(spec: Partial<AutomationSpec>): Promise<{ automation: AutomationView } | { error: string; code: AutomationError['code'] }> {
    return this.automationOp(() => this.automations.create(spec, 'owner'));
  }

  async updateAutomation(id: string, patch: Partial<AutomationSpec>): Promise<{ automation: AutomationView } | { error: string; code: AutomationError['code'] }> {
    return this.automationOp(() => this.automations.update(id, patch));
  }

  async removeAutomation(id: string): Promise<{ removed: boolean }> {
    return { removed: this.automations.remove(id) };
  }

  async runAutomation(id: string): Promise<{ automation: AutomationView } | { error: string; code: AutomationError['code'] }> {
    return this.automationOp(() => this.automations.runNow(id));
  }

  /** The Chief proposes an automation: a raised hand; approving it sets it up. */
  async openChiefAutomation(spec: Partial<AutomationSpec>, title: string): Promise<Decision | { error: string }> {
    try {
      return this.team.openChiefAutomation(normalizeSpec(spec), title);
    } catch (err) {
      if (err instanceof AutomationError) return { error: err.message };
      throw err;
    }
  }

  private async automationOp(fn: () => AutomationView | Promise<AutomationView>): Promise<{ automation: AutomationView } | { error: string; code: AutomationError['code'] }> {
    try {
      const automation = await fn();
      const next = this.automations.nextDue();
      if (next !== null) await this.armAlarm(Math.max(next, runtime.now() + 10));
      await this.flush();
      return { automation: this.automations.get(automation.automationId) ?? automation };
    } catch (err) {
      if (err instanceof AutomationError) return { error: err.message, code: err.code };
      throw err;
    }
  }

  /**
   * This project's presence claim for the Chief of Staff. Always none: background jobs run in the work loop, and
   * the conversation loop stays available (D2: "working and available together, never busy"). The web shows
   * running jobs as a count beside the face, and each job's running sentence in its Activity row. A null claim
   * also clears a 'working' claim an earlier build persisted. The 'working' state is kept for coworkers who do
   * the work themselves (Inc 1).
   */
  private presenceClaim(): PresenceClaim | null {
    return null;
  }

  /** Mirror unforwarded frames (and the presence claim) to the owner feed, then roll up to D1. Single-flight, ordered. */
  private flush(): Promise<void> {
    const next = this.flushChain.then(() => this.forward()).then(() => this.rollup());
    this.flushChain = next.catch((err) => logError('project.flush', err));
    return this.flushChain;
  }

  private async forward(): Promise<void> {
    for (let page = 0; page < 50; page++) {
      const frames = this.ledger.unforwarded(100);
      const claim = this.presenceClaim();
      const key = JSON.stringify(claim);
      if (!frames.length && key === this.lastClaimKey && !this.signals.length) return;
      const signals = this.signals.splice(0);
      const batch: MirrorBatch = { source: this.streamId, frames, presence: { agentId: CHIEF_ID, claim }, ...(signals.length ? { signals } : {}) };
      try {
        await workspaceStub(this.env).ingest(batch);
      } catch (err) {
        this.signals.unshift(...signals);
        throw err;
      }
      this.lastClaimKey = key;
      if (!frames.length) return;
      this.ledger.markForwarded(frames[frames.length - 1]!.seq!);
    }
  }

  private async rollup(): Promise<void> {
    const db = this.env.DB;
    if (!db) return;
    for (let page = 0; page < 20; page++) {
      const frames = this.ledger.unrolled(200);
      if (!frames.length) break;
      await rollupEvents(db, this.workspaceId, frames);
      this.ledger.markRolled(frames[frames.length - 1]!.seq!);
    }
    const dirty = this.ctx.storage.sql.exec<JobRow>('SELECT * FROM jobs WHERE rev > rolled_rev LIMIT 50').toArray();
    if (!dirty.length) return;
    await upsertJobs(db, this.workspaceId, dirty.map((r) => this.snapshot(r)));
    for (const r of dirty) this.ctx.storage.sql.exec('UPDATE jobs SET rolled_rev = ? WHERE job_id = ? AND rolled_rev < ?', r.rev, r.job_id, r.rev);
  }

  private async armAlarm(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  private async reschedule(): Promise<void> {
    const now = runtime.now();
    const jobsNext = this.ctx.storage.sql.exec<{ at: number | null }>(`SELECT MIN(next_at) AS at FROM jobs WHERE status = 'running'`).toArray()[0]?.at;
    const teamNext = this.team.nextDue();
    const autoNext = this.automations.nextDue();
    const canvasNext = this.canvases.nextDue();
    const effectsNext = this.effects.nextDue();
    const candidates = [jobsNext, teamNext, autoNext, canvasNext, effectsNext].filter((x): x is number => x !== null && x !== undefined).map(Number);
    const next = candidates.length ? Math.min(...candidates) : null;
    if (next !== null) await this.ctx.storage.setAlarm(Math.max(next, now + 10));
    else if (this.ledger.unforwarded(1).length) await this.ctx.storage.setAlarm(now + 5000);
    else await this.ctx.storage.deleteAlarm();
  }
}
