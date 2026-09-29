import { DurableObject } from 'cloudflare:workers';
import { fullIndex } from '@headcount/catalog/full';
import { chiefDisplayName } from '@headcount/catalog';
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
import type { PresenceClaim } from '../workspace/feed';
import { Ledger } from '../workspace/ledger';
import { rollupEvents, upsertJobs } from '../workspace/rollup';
import { logError, runtime } from '../workspace/runtime';
import { clipText, firstSentence, titleFromRequest } from './job-view';
import { MAX_WORK_STEPS, WorkCancelled, WorkError, planJob, runWorkStep, synthesize, type JobContext, type PlanStep, type StepNote, type WorkDeps } from './work-loop';

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

/** Batch the ProjectDO mirrors into the owner feed (WorkspaceDO.ingest). */
export interface MirrorBatch {
  source: StreamId;
  frames: Frame[];
  presence?: { agentId: typeof CHIEF_ID; claim: PresenceClaim | null };
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const stmt of SCHEMA) ctx.storage.sql.exec(stmt);
    this.ledger = new Ledger(ctx.storage, this.streamId, runtime.now);
    this.usage = new DailyCounter(ctx.storage);
  }

  private get workspaceId(): string {
    return this.env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID;
  }

  private get streamId(): StreamId {
    return projectStream(this.workspaceId, EVERYDAY_PROJECT_ID);
  }

  // ── RPC ─────────────────────────────────────────────────────────────────────────

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
    await Promise.all(due.map((r) => this.advance(r.job_id)));
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
        const resolved = runtime.registry(this.env).resolve('chat', { tier: 'reason', needs: ['tools'] });
        // Each checkpoint gets its own time budget (a local 32B model can take minutes on a work step).
        deps = { provider: resolved.provider, model: resolved.model, signal: deadlineSignal(CHECKPOINT_BUDGET_MS, ac.signal) };
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
    const notes = [...(JSON.parse(fresh.notes) as StepNote[]), { label: step.label, text: out.text }];
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
      if (!frames.length && key === this.lastClaimKey) return;
      const batch: MirrorBatch = { source: this.streamId, frames, presence: { agentId: CHIEF_ID, claim } };
      await workspaceStub(this.env).ingest(batch);
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
    const next = this.ctx.storage.sql.exec<{ at: number | null }>(`SELECT MIN(next_at) AS at FROM jobs WHERE status = 'running'`).toArray()[0]?.at;
    if (next !== null && next !== undefined) await this.ctx.storage.setAlarm(Math.max(Number(next), now + 10));
    else if (this.ledger.unforwarded(1).length) await this.ctx.storage.setAlarm(now + 5000);
    else await this.ctx.storage.deleteAlarm();
  }
}
