// Team projects inside the Everyday ProjectDO (Inc 1). The ProjectDO lends its SQLite, ledger (frames mirrored to the
// owner feed), alarm and model registry; this module owns the tables and the lifecycle:
//   proposeProject → (owner approves the raised hand) → running: ready steps in parallel, each work → review → one
//   revision if asked → done; when every step is done the lead writes the deliverable → done.
// The owner steers without stopping anyone: a note (to the team or one member) reaches the next step that starts, and
// pause lets steps under way finish but starts nothing new until resume.
// One alarm tick advances each running project by one "unit" (up to MAX_PARALLEL ready steps at once, or the
// deliverable). A cancel bumps the project's fence, so a late result from an aborted call is discarded.
import { fullIndex } from '@headcount/catalog/full';
import type { Persona } from '@headcount/catalog';
import { MissingProviderError, deadlineSignal } from '@headcount/models';
import type { FrameInput, FrameType } from '@headcount/protocol';
import { OUTPUT_FRAME_MAX, PROJECT_NOTE_MAX, type Decision, type ProjectNote, type ProjectStep, type StaffingContext, type TeamMember, type TeamProjectSnapshot, type TeamProjectStatus } from '@headcount/protocol/ext/projects';
import type { Env } from '../env';
import { clipText } from '../jobs/job-view';
import { WorkCancelled, WorkError } from '../jobs/work-loop';
import { DailyCounter, dailyLimit, limitMessage } from '../lib/limits';
import { logError, runtime } from '../workspace/runtime';
import { forecastOf, forecastSentence, readySteps, recipesOf, shortlist, staffingNote, stepsFrom, teamFrom, titleFromGoal, type Recipe } from './staffing';
import { chooseRecipe, doStepWork, reviewStep, reviseStep, writeDeliverable, type ProjectBrief, type TeamDeps } from './team-work';

export const MAX_PARALLEL = 2;
export const MAX_ACTIVE_PROJECTS_DEFAULT = 2;
const MAX_ATTEMPTS = 3;
const UNIT_BUDGET_MS = 300_000;
const GOAL_MAX = 2000;

export interface ProposeRequest {
  goal: string;
  title?: string;
  opId?: string;
  chiefName: string;
  /** The Chief of Staff's lead: their voices are kept free so they can join any team meeting. */
  leadId?: string | null;
}

export type ProjectRefusal = { accepted: false; code: 'not_found' | 'conflict' | 'bad_request' | 'rate_limited' | 'not_configured'; message: string };

export interface TeamHostPorts {
  storage: DurableObjectStorage;
  env: Env;
  usage: DailyCounter;
  append<T extends FrameType>(input: FrameInput<T>): void;
  /** Mirror frames to the owner feed now (single-flight in the ProjectDO). */
  flush(): Promise<void>;
  armAlarm(at: number): Promise<void>;
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
};
type NoteRow = { note_id: string; project_id: string; op_id: string | null; to_id: string | null; via: string; text: string; status: string; at: string; applied_at: string | null; applied_step: string | null };
type DecisionRow = { decision_id: string; kind: string; project_id: string; title: string; body: string; status: string; created_at: string; resolved_at: string | null };

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
];

/** Projects that are under way (they count toward the cap and take notes). */
const ACTIVE = `('proposed','running','paused')`;

const iso = () => new Date(runtime.now()).toISOString();
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

function maxActiveProjects(env: Env): number {
  const n = Number(env.MAX_ACTIVE_PROJECTS);
  return env.MAX_ACTIVE_PROJECTS && Number.isInteger(n) && n >= 0 ? n : MAX_ACTIVE_PROJECTS_DEFAULT;
}

export class TeamProjects {
  private readonly inflight = new Map<string, AbortController>();
  private readonly index = fullIndex;

  constructor(private readonly p: TeamHostPorts) {
    for (const stmt of TEAM_SCHEMA) p.storage.sql.exec(stmt);
  }

  private get sql() {
    return this.p.storage.sql;
  }

  // ── RPC ───────────────────────────────────────────────────────────────────────────

  /** Staff a team and propose its plan; raises the plan-approval hand. Idempotent by opId. */
  async propose(req: ProposeRequest): Promise<{ project: TeamProjectSnapshot; decision: Decision } | ProjectRefusal> {
    const goal = (req.goal ?? '').replace(/\s+/g, ' ').trim().slice(0, GOAL_MAX);
    if (goal.length < 8) return { accepted: false, code: 'bad_request', message: 'Say in a sentence what the team should deliver.' };
    if (req.opId) {
      const prior = this.sql.exec<ProjectRow>('SELECT * FROM tprojects WHERE op_id = ?', req.opId).toArray()[0];
      if (prior) return { project: this.snapshot(prior), decision: this.decision(prior.decision_id!)! };
    }
    const active = Number(this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM tprojects WHERE status IN ${ACTIVE}`).toArray()[0]?.n ?? 0);
    const max = maxActiveProjects(this.p.env);
    if (active >= max) return { accepted: false, code: 'conflict', message: `${active} team projects are already proposed or running (the most at once is ${max}). Finish or cancel one first.` };
    const now = runtime.now();
    const daily = dailyLimit(this.p.env, 'project');
    if (!this.p.usage.take('project', daily, now).allowed) return { accepted: false, code: 'rate_limited', message: limitMessage('project', daily) };

    // Choose the recipe: the model picks from a keyword shortlist; keyword order is the fallback (and Mock's pick).
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
    const decisionId = newId('dec');
    const at = iso();
    const note = staffingNote(team, recipe.name);
    this.sql.exec(
      `INSERT INTO tprojects (project_id, op_id, title, goal, recipe_id, recipe_name, staffing_note, team, status, decision_id, chief_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`,
      projectId, req.opId ?? null, title, goal, recipe.id, recipe.name, note, JSON.stringify(team), decisionId, req.chiefName, at, at,
    );
    steps.forEach((s, i) =>
      this.sql.exec(
        `INSERT INTO tsteps (project_id, step_id, idx, title, brief, acceptance, owner_id, reviewer_ids, depends_on, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`,
        projectId, s.id, i, s.title, s.brief, s.acceptance, s.ownerId, JSON.stringify(s.reviewerIds), JSON.stringify(s.dependsOn),
      ),
    );
    const body = `${note} ${steps.length} steps, each reviewed before it counts. ${forecastSentence(forecastOf(steps))}`;
    this.sql.exec(`INSERT INTO tdecisions (decision_id, kind, project_id, title, body, status, created_at) VALUES (?, 'plan_approval', ?, ?, ?, 'open', ?)`, decisionId, projectId, `Approve the plan for “${title}”?`, body, at);
    const row = this.row(projectId)!;
    const project = this.snapshot(row);
    const decision = this.decision(decisionId)!;
    this.p.append({ type: 'project.proposed', data: { project: this.clip(project), decision } });
    void this.p.flush();
    return { project, decision };
  }

  /** The owner approved the plan: start work on the next alarm. */
  async approve(projectId: string): Promise<{ accepted: true; project: TeamProjectSnapshot } | ProjectRefusal> {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (row.status === 'running') return { accepted: true, project: this.snapshot(row) };
    if (row.status !== 'proposed') return { accepted: false, code: 'conflict', message: `That project is ${row.status}.` };
    const at = iso();
    this.sql.exec(`UPDATE tprojects SET status = 'running', next_at = ?, updated_at = ? WHERE project_id = ?`, runtime.now(), at, projectId);
    if (row.decision_id) this.resolve(row.decision_id, 'approved', at);
    this.emit(projectId);
    await this.p.armAlarm(runtime.now() + 10);
    void this.p.flush();
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  /** Stop a project for good (or decline its plan). Aborts in-flight calls; late results are fenced out. */
  async cancel(projectId: string, reason = 'Stopped by the owner.'): Promise<{ accepted: true; project: TeamProjectSnapshot } | ProjectRefusal> {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (row.status === 'done' || row.status === 'failed' || row.status === 'cancelled') return { accepted: true, project: this.snapshot(row) };
    const at = iso();
    this.sql.exec(`UPDATE tprojects SET status = 'cancelled', error = ?, fence = fence + 1, updated_at = ?, finished_at = ? WHERE project_id = ?`, reason, at, at, projectId);
    this.sql.exec(`UPDATE tsteps SET status = 'waiting' WHERE project_id = ? AND status IN ('working','reviewing','revising')`, projectId);
    if (row.decision_id && row.status === 'proposed') this.resolve(row.decision_id, 'declined', at);
    this.inflight.get(projectId)?.abort();
    this.emit(projectId);
    void this.p.flush();
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  /**
   * Direction from the owner for a project under way: queued, then picked up by the next step that starts (the whole
   * team's, or only `toId`'s). Idempotent by opId.
   */
  note(projectId: string, req: { text: string; toId?: string; via: ProjectNote['via']; opId?: string }): { accepted: true; project: TeamProjectSnapshot; note: ProjectNote } | ProjectRefusal {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (req.opId) {
      const prior = this.sql.exec<NoteRow>('SELECT * FROM tnotes WHERE op_id = ?', req.opId).toArray()[0];
      if (prior) return { accepted: true, project: this.snapshot(row), note: this.toNote(prior) };
    }
    if (!['proposed', 'running', 'paused'].includes(row.status)) return { accepted: false, code: 'conflict', message: `“${row.title}” is ${row.status === 'done' ? 'finished' : row.status}; there is no work left to steer.` };
    const text = (req.text ?? '').replace(/\s+/g, ' ').trim().slice(0, PROJECT_NOTE_MAX);
    if (!text) return { accepted: false, code: 'bad_request', message: 'Say what the team should know.' };
    const team = JSON.parse(row.team) as TeamMember[];
    if (req.toId && !team.some((m) => m.personaId === req.toId)) return { accepted: false, code: 'bad_request', message: 'That person is not on this project.' };
    const noteId = newId('note');
    const at = iso();
    this.sql.exec(`INSERT INTO tnotes (note_id, project_id, op_id, to_id, via, text, status, at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`, noteId, projectId, req.opId ?? null, req.toId ?? null, req.via, text, at);
    this.sql.exec('UPDATE tprojects SET updated_at = ? WHERE project_id = ?', at, projectId);
    this.emit(projectId);
    void this.p.flush();
    const note = this.toNote(this.sql.exec<NoteRow>('SELECT * FROM tnotes WHERE note_id = ?', noteId).toArray()[0]!);
    return { accepted: true, project: this.snapshot(this.row(projectId)!), note };
  }

  /** Pause: steps under way finish; nothing new starts until resume. */
  pause(projectId: string): { accepted: true; project: TeamProjectSnapshot } | ProjectRefusal {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (row.status === 'paused') return { accepted: true, project: this.snapshot(row) };
    if (row.status !== 'running') return { accepted: false, code: 'conflict', message: `Only a running project can pause; “${row.title}” is ${row.status}.` };
    this.sql.exec(`UPDATE tprojects SET status = 'paused', updated_at = ? WHERE project_id = ?`, iso(), projectId);
    this.emit(projectId);
    void this.p.flush();
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  async resume(projectId: string): Promise<{ accepted: true; project: TeamProjectSnapshot } | ProjectRefusal> {
    const row = this.row(projectId);
    if (!row) return { accepted: false, code: 'not_found', message: 'No such project.' };
    if (row.status === 'running') return { accepted: true, project: this.snapshot(row) };
    if (row.status !== 'paused') return { accepted: false, code: 'conflict', message: `Only a paused project can resume; “${row.title}” is ${row.status}.` };
    this.sql.exec(`UPDATE tprojects SET status = 'running', next_at = ?, updated_at = ? WHERE project_id = ?`, runtime.now(), iso(), projectId);
    this.emit(projectId);
    await this.p.armAlarm(runtime.now() + 10);
    void this.p.flush();
    return { accepted: true, project: this.snapshot(this.row(projectId)!) };
  }

  /** A coworker's part in the projects under way (for their desk quick chat). */
  staffingOf(personaId: string): StaffingContext[] {
    const out: StaffingContext[] = [];
    for (const r of this.sql.exec<ProjectRow>(`SELECT * FROM tprojects WHERE status IN ${ACTIVE} ORDER BY created_at ASC`).toArray()) {
      const team = JSON.parse(r.team) as TeamMember[];
      const member = team.find((m) => m.personaId === personaId);
      if (!member) continue;
      const s = this.snapshot(r);
      const mine = s.steps.filter((st) => st.ownerId === personaId || st.reviewerIds.includes(personaId));
      const latest = [...s.steps].reverse().find((st) => st.ownerId === personaId && st.output)?.output;
      out.push({
        projectId: s.projectId,
        title: s.title,
        status: s.status,
        role: member.role,
        mine: mine.map((st) => ({ stepId: st.id, title: st.title, status: st.status, reviewing: st.ownerId !== personaId })),
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

  /** Projects under way (proposed, running, paused) for the Chief of Staff's live work state. */
  active(): TeamProjectSnapshot[] {
    return this.sql.exec<ProjectRow>(`SELECT * FROM tprojects WHERE status IN ${ACTIVE} ORDER BY created_at ASC`).toArray().map((r) => this.snapshot(r));
  }

  /** Earliest due time among running projects (null when none). */
  nextDue(): number | null {
    const at = this.sql.exec<{ at: number | null }>(`SELECT MIN(next_at) AS at FROM tprojects WHERE status = 'running'`).toArray()[0]?.at;
    return at === null || at === undefined ? null : Number(at);
  }

  /** Alarm tick: advance each due running project by one unit, concurrently. */
  async tick(now: number): Promise<void> {
    const due = this.sql.exec<{ project_id: string }>(`SELECT project_id FROM tprojects WHERE status = 'running' AND next_at <= ? ORDER BY created_at ASC`, now).toArray().filter((r) => !this.inflight.has(r.project_id));
    await Promise.all(due.map((r) => this.advance(r.project_id)));
  }

  // ── the lifecycle ─────────────────────────────────────────────────────────────────

  private async advance(projectId: string): Promise<void> {
    const row = this.row(projectId);
    if (!row || row.status !== 'running') return;
    const fence = row.fence;
    const ac = new AbortController();
    this.inflight.set(projectId, ac);
    try {
      let deps: TeamDeps;
      try {
        const resolved = runtime.registry(this.p.env).resolve('chat', { tier: 'reason', needs: ['tools'] });
        deps = { provider: resolved.provider, model: resolved.model, signal: deadlineSignal(UNIT_BUDGET_MS, ac.signal) };
      } catch (err) {
        if (err instanceof MissingProviderError) return this.fail(projectId, fence, err.message);
        throw err;
      }
      const snap = this.snapshot(row);
      const ready = readySteps(snap.steps).slice(0, MAX_PARALLEL);
      if (ready.length) await Promise.all(ready.map((s) => this.runStep(projectId, fence, deps, s.id)));
      else if (snap.steps.every((s) => s.status === 'done')) await this.finish(projectId, fence, deps);
      else if (!snap.steps.some((s) => s.status === 'working' || s.status === 'reviewing' || s.status === 'revising')) {
        // Nothing ready and nothing running: a dependency failed or the plan has a cycle.
        return this.fail(projectId, fence, 'The plan is stuck: a step depends on work that cannot finish.');
      }
      if (this.live(projectId, fence)) this.sql.exec('UPDATE tprojects SET attempts = 0, next_at = ? WHERE project_id = ? AND fence = ?', runtime.now(), projectId, fence);
    } catch (err) {
      if (!this.live(projectId, fence) || (err instanceof WorkCancelled && ac.signal.aborted)) return;
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

  private async runStep(projectId: string, fence: number, deps: TeamDeps, stepId: string): Promise<void> {
    const brief = (): ProjectBrief => this.briefOf(projectId);
    const step = () => brief().steps.find((s) => s.id === stepId)!;
    const owner = this.persona(step().ownerId);
    if (!owner) throw new WorkError(`The owner of “${step().title}” is not in the catalog.`, false);
    this.applyNotes(projectId, fence, stepId, owner.id);
    this.setStep(projectId, fence, stepId, { status: 'working', started_at: iso(), error: null });
    const work = await doStepWork(deps, owner, brief(), step());
    if (!this.live(projectId, fence)) throw new WorkCancelled();
    let output = work.markdown;
    const reviewer = this.persona(step().reviewerIds[0] ?? '');
    if (reviewer) {
      this.setStep(projectId, fence, stepId, { status: 'reviewing', output });
      const v = await reviewStep(deps, reviewer, brief(), step(), output);
      if (!this.live(projectId, fence)) throw new WorkCancelled();
      const verdict = { approved: v.approved, notes: v.notes, reviewerId: reviewer.id };
      if (!v.approved) {
        this.applyNotes(projectId, fence, stepId, owner.id);
        this.setStep(projectId, fence, stepId, { status: 'revising', verdict: JSON.stringify(verdict) });
        const revised = await reviseStep(deps, owner, brief(), step(), output, v.notes);
        if (!this.live(projectId, fence)) throw new WorkCancelled();
        output = revised.markdown;
        this.setStep(projectId, fence, stepId, { revised: 1 });
      } else this.setStep(projectId, fence, stepId, { verdict: JSON.stringify(verdict) }, false);
    }
    this.setStep(projectId, fence, stepId, { status: 'done', output, finished_at: iso() });
  }

  private async finish(projectId: string, fence: number, deps: TeamDeps): Promise<void> {
    const s = this.snapshot(this.row(projectId)!);
    const leadId = s.team.find((m) => m.role === 'lead')?.personaId ?? s.team[0]?.personaId ?? '';
    const lead = this.persona(leadId);
    if (!lead) throw new WorkError('The project lead is not in the catalog.', false);
    const d = await writeDeliverable(deps, lead, this.briefOf(projectId));
    if (!this.live(projectId, fence)) throw new WorkCancelled();
    const at = iso();
    this.sql.exec(`UPDATE tprojects SET status = 'done', deliverable = ?, summary = ?, updated_at = ?, finished_at = ? WHERE project_id = ? AND fence = ?`, d.markdown, d.summary, at, at, projectId, fence);
    this.emit(projectId);
  }

  private fail(projectId: string, fence: number, message: string): void {
    const at = iso();
    this.sql.exec(`UPDATE tprojects SET status = 'failed', error = ?, updated_at = ?, finished_at = ? WHERE project_id = ? AND fence = ?`, message, at, at, projectId, fence);
    this.emit(projectId);
  }

  // ── rows, snapshots, frames ───────────────────────────────────────────────────────

  private persona(id: string): Persona | undefined {
    return id ? this.index.persona(id) : undefined;
  }

  private row(projectId: string): ProjectRow | undefined {
    return this.sql.exec<ProjectRow>('SELECT * FROM tprojects WHERE project_id = ?', projectId).toArray()[0];
  }

  /** Still this run of the project: running, or paused (a step under way finishes and keeps its result). */
  private live(projectId: string, fence: number): boolean {
    const r = this.sql.exec<{ status: string; fence: number }>('SELECT status, fence FROM tprojects WHERE project_id = ?', projectId).toArray()[0];
    return !!r && (r.status === 'running' || r.status === 'paused') && Number(r.fence) === fence;
  }

  private briefOf(projectId: string): ProjectBrief {
    const row = this.row(projectId)!;
    const s = this.snapshot(row);
    return { title: s.title, goal: s.goal, team: s.team, steps: s.steps, chiefName: row.chief_name, notes: (s.notes ?? []).map((n) => ({ text: n.text, ...(n.toId ? { toId: n.toId } : {}) })) };
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

  private resolve(decisionId: string, status: 'approved' | 'declined', at: string): void {
    this.sql.exec(`UPDATE tdecisions SET status = ?, resolved_at = ? WHERE decision_id = ? AND status = 'open'`, status, at, decisionId);
    const d = this.decision(decisionId);
    if (d) this.p.append({ type: 'decision.resolved', data: { decision: d } });
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
    return { decisionId: r.decision_id, kind: 'plan_approval', projectId: r.project_id, title: r.title, body: r.body, status: r.status as Decision['status'], createdAt: r.created_at, ...(r.resolved_at ? { resolvedAt: r.resolved_at } : {}) };
  }

  snapshot(r: ProjectRow): TeamProjectSnapshot {
    const steps = this.sql.exec<StepRow>('SELECT * FROM tsteps WHERE project_id = ? ORDER BY idx ASC', r.project_id).toArray().map(
      (s): ProjectStep => ({
        id: s.step_id,
        title: s.title,
        brief: s.brief,
        acceptance: s.acceptance,
        ownerId: s.owner_id,
        reviewerIds: JSON.parse(s.reviewer_ids) as string[],
        dependsOn: JSON.parse(s.depends_on) as string[],
        status: s.status as ProjectStep['status'],
        ...(s.output ? { output: s.output } : {}),
        ...(s.verdict ? { verdict: JSON.parse(s.verdict) as ProjectStep['verdict'] } : {}),
        ...(s.revised ? { revised: true } : {}),
        ...(s.started_at ? { startedAt: s.started_at } : {}),
        ...(s.finished_at ? { finishedAt: s.finished_at } : {}),
        ...(s.error ? { error: s.error } : {}),
      }),
    );
    const notes = this.sql.exec<NoteRow>('SELECT * FROM tnotes WHERE project_id = ? ORDER BY at ASC, note_id ASC', r.project_id).toArray().map((n) => this.toNote(n));
    return {
      projectId: r.project_id,
      title: r.title,
      goal: r.goal,
      recipeId: r.recipe_id,
      recipeName: r.recipe_name,
      staffingNote: r.staffing_note,
      team: JSON.parse(r.team) as TeamMember[],
      steps,
      status: r.status as TeamProjectStatus,
      decisionId: r.status === 'proposed' ? r.decision_id : null,
      forecast: forecastOf(steps),
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
