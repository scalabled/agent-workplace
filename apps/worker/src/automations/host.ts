// Automations (biz-bot parity, stage 3b; ported from worker/src/runtime/triggers.js): schedules and page watchers,
// kept in the ProjectDO beside the jobs and team projects they start, and ticked by its alarm. A run is a background
// job or a team project; when it ends, the gate decides whether the Chief of Staff tells the owner (after every run;
// only when it matters — failures, page changes, or a short model judgement that the result is material; never).
// Unlike biz-bot: a daily time first fires at its next occurrence (not at once), page checks are paced (≥ 15 min),
// extraction patterns are screened for catastrophic backtracking, and a run the team is still busy with is skipped.
import type { FrameInput, FrameType } from '@headcount/protocol';
import {
  AUTOMATION_GOAL_MAX,
  MAX_AUTOMATIONS,
  MIN_AUTOMATION_MINUTES,
  PAGE_CONDITIONS,
  type AutomationAction,
  type AutomationGate,
  type AutomationRun,
  type AutomationSpec,
  type AutomationView,
  type PageCondition,
} from '@headcount/protocol/ext/automations';

export const AUTOMATION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS automations (
     automation_id TEXT PRIMARY KEY, spec TEXT NOT NULL, enabled INTEGER NOT NULL, created_by TEXT NOT NULL,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_checked_at INTEGER, last_fired_at INTEGER,
     last_value TEXT, last_match INTEGER NOT NULL DEFAULT 0, last_result TEXT, last_error TEXT, runs INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS automation_runs (
     run_id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, run_kind TEXT NOT NULL, fired_at TEXT NOT NULL, context TEXT NOT NULL,
     status TEXT NOT NULL, finished_at TEXT, notified INTEGER, why TEXT)`,
  `CREATE INDEX IF NOT EXISTS automation_runs_by ON automation_runs (automation_id, fired_at)`,
];

const HISTORY = 10;
const PAGE_DEFAULT_MINUTES = 60;
const TERMINAL = new Set(['done', 'partial', 'failed', 'cancelled']);

type Row = {
  automation_id: string;
  spec: string;
  enabled: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_checked_at: number | null;
  last_fired_at: number | null;
  last_value: string | null;
  last_match: number;
  last_result: string | null;
  last_error: string | null;
  runs: number;
};
type RunRow = { run_id: string; automation_id: string; run_kind: string; fired_at: string; context: string; status: string; finished_at: string | null; notified: number | null; why: string | null };

export type StartOutcome = { ok: true; runId: string } | { ok: false; message: string };

export interface AutomationPorts {
  sql: SqlStorage;
  now(): number;
  append<T extends FrameType>(input: FrameInput<T>): void;
  flush(): Promise<void>;
  startJob(title: string, brief: string): Promise<StartOutcome>;
  proposeProject(goal: string, title: string, automation: { automationId: string; name: string; autoStart: boolean }): Promise<StartOutcome>;
  /** A page as text (the SSRF-guarded reader, within the daily page cap). */
  readPage(url: string): Promise<string>;
  /** "Only when it matters": is this finished run worth interrupting the owner for? */
  judge(name: string, result: string): Promise<{ matters: boolean; reason: string }>;
  background(work: Promise<unknown>): void;
}

export class AutomationError extends Error {
  constructor(
    message: string,
    readonly code: 'bad_request' | 'not_found' | 'conflict',
  ) {
    super(message);
  }
}

const newId = () => `aut_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
const iso = (ms: number) => new Date(ms).toISOString();

// ── the spec ─────────────────────────────────────────────────────────────────────

/** A pattern with a quantified group that itself repeats ((a+)+, (a*)*, (a|a)+) can backtrack for ever: refused. */
export function riskyPattern(p: string): boolean {
  return /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(p) || /\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)\s*[+*{]/.test(p);
}

/** Validate and normalise the owner's (or the Chief's) spec. Throws AutomationError with one sentence. */
export function normalizeSpec(raw: Partial<AutomationSpec>): AutomationSpec {
  const name = String(raw.name ?? '').trim().slice(0, 120);
  if (!name) throw new AutomationError('Give the automation a name.', 'bad_request');
  const kind = raw.kind === 'page' ? 'page' : raw.kind === 'schedule' ? 'schedule' : null;
  if (!kind) throw new AutomationError('An automation runs on a schedule or watches a page.', 'bad_request');
  const type: AutomationAction = raw.action?.type === 'project' ? 'project' : 'job';
  const goal = String(raw.action?.goal ?? '').trim().slice(0, AUTOMATION_GOAL_MAX);
  if (goal.length < 8) throw new AutomationError('Say in a sentence what each run should do.', 'bad_request');
  const gate: AutomationGate = raw.gate === 'on' || raw.gate === 'off' ? raw.gate : 'quiet';
  const spec: AutomationSpec = { name, kind, action: { type, goal, ...(type === 'project' ? { autoStart: raw.action?.autoStart !== false } : {}) }, gate, enabled: raw.enabled !== false };
  if (kind === 'schedule') {
    const dailyAt = String(raw.schedule?.dailyAt ?? '').trim();
    const every = Number(raw.schedule?.everyMinutes ?? 0);
    if (dailyAt) {
      const m = /^(\d{2}):(\d{2})$/.exec(dailyAt);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new AutomationError('A daily time is HH:MM (UTC), e.g. 09:00.', 'bad_request');
      spec.schedule = { dailyAt };
    } else {
      if (!Number.isFinite(every) || every <= 0) throw new AutomationError('A schedule needs an interval or a daily time.', 'bad_request');
      if (every < MIN_AUTOMATION_MINUTES) throw new AutomationError(`Runs at most every ${MIN_AUTOMATION_MINUTES} minutes.`, 'bad_request');
      spec.schedule = { everyMinutes: Math.min(Math.round(every), 60 * 24 * 31) };
    }
  } else {
    const url = String(raw.page?.url ?? '').trim();
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new AutomationError('A page watcher needs the page’s https address.', 'bad_request');
    }
    if (u.protocol !== 'https:') throw new AutomationError('A page watcher needs an https address.', 'bad_request');
    const condition: PageCondition = PAGE_CONDITIONS.includes(raw.page?.condition as PageCondition) ? (raw.page!.condition as PageCondition) : 'changed';
    const extract = String(raw.page?.extract ?? '').slice(0, 200);
    if (extract) {
      try {
        new RegExp(extract, 'i');
      } catch {
        throw new AutomationError('That extraction pattern is not a valid regular expression.', 'bad_request');
      }
      if (riskyPattern(extract)) throw new AutomationError('That pattern repeats a repeated group, which can take for ever; simplify it.', 'bad_request');
    }
    const value = String(raw.page?.value ?? '').slice(0, 200);
    if (condition !== 'changed' && !value.trim()) throw new AutomationError('Say what the page should contain, or the number to compare with.', 'bad_request');
    if ((condition === 'below' || condition === 'above') && !Number.isFinite(numberIn(value))) throw new AutomationError('Give a number to compare with.', 'bad_request');
    const every = Number(raw.page?.everyMinutes ?? PAGE_DEFAULT_MINUTES);
    if (!Number.isFinite(every) || every < MIN_AUTOMATION_MINUTES) throw new AutomationError(`A page is checked at most every ${MIN_AUTOMATION_MINUTES} minutes.`, 'bad_request');
    spec.page = { url: u.toString(), condition, ...(extract ? { extract } : {}), ...(value ? { value } : {}), everyMinutes: Math.min(Math.round(every), 60 * 24 * 7) };
  }
  return spec;
}

const CONDITION_WORDS: Record<PageCondition, string> = { changed: 'changes', contains: 'contains', not_contains: 'no longer contains', below: 'drops below', above: 'rises above' };

export function describeSpec(s: AutomationSpec): string {
  const when =
    s.kind === 'schedule'
      ? s.schedule?.dailyAt
        ? `Every day at ${s.schedule.dailyAt} UTC`
        : `Every ${minutesWords(s.schedule?.everyMinutes ?? 0)}`
      : `When ${hostOf(s.page?.url)} ${CONDITION_WORDS[s.page?.condition ?? 'changed']}${s.page?.condition !== 'changed' && s.page?.value ? ` “${s.page.value}”` : ''} (checked every ${minutesWords(s.page?.everyMinutes ?? PAGE_DEFAULT_MINUTES)})`;
  const what = s.action.type === 'project' ? `a team project${s.action.autoStart === false ? ' (the plan waits for your OK)' : ''}` : 'a background job';
  return `${when} → ${what}`;
}

function minutesWords(m: number): string {
  if (m % (60 * 24 * 7) === 0) return m === 60 * 24 * 7 ? 'week' : `${m / (60 * 24 * 7)} weeks`;
  if (m % (60 * 24) === 0) return m === 60 * 24 ? 'day' : `${m / (60 * 24)} days`;
  if (m % 60 === 0) return m === 60 ? 'hour' : `${m / 60} hours`;
  return `${m} minutes`;
}

function hostOf(url?: string): string {
  try {
    return new URL(url ?? '').host;
  } catch {
    return 'the page';
  }
}

function numberIn(s: string): number {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(String(s ?? ''));
  return m ? Number(m[0].replace(/,/g, '')) : NaN;
}

/** The value a page watcher watches: the pattern's first group (or match), else a fingerprint of the whole text. */
export async function extractValue(text: string, extract?: string): Promise<string> {
  if (!extract) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return `sha256:${[...new Uint8Array(d)]
      .slice(0, 12)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  try {
    const m = new RegExp(extract, 'i').exec(text);
    return m ? (m[1] ?? m[0]).trim().slice(0, 500) : '';
  } catch {
    return '';
  }
}

/** biz-bot evaluateCondition: 'changed' fires on a change after the first look; the others fire when they become true. */
export function evaluate(condition: PageCondition, want: string | undefined, value: string, previous: string | null, wasMatch: boolean): { fire: boolean; match: boolean } {
  if (condition === 'changed') {
    const changed = previous !== null && value !== previous;
    return { fire: changed, match: changed };
  }
  const w = String(want ?? '');
  const match =
    condition === 'contains'
      ? value.toLowerCase().includes(w.toLowerCase())
      : condition === 'not_contains'
        ? !value.toLowerCase().includes(w.toLowerCase())
        : condition === 'below'
          ? numberIn(value) < numberIn(w)
          : numberIn(value) > numberIn(w);
  return { fire: match && !wasMatch, match };
}

/** The most recent HH:MM (UTC) at or before `now`. */
function lastDaily(now: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const at = new Date(now);
  at.setUTCHours(h!, m!, 0, 0);
  return at.getTime() > now ? at.getTime() - 86_400_000 : at.getTime();
}

// ── the host ─────────────────────────────────────────────────────────────────────

export class Automations {
  private ticking = false;

  constructor(private readonly p: AutomationPorts) {
    for (const stmt of AUTOMATION_SCHEMA) p.sql.exec(stmt);
  }

  list(): AutomationView[] {
    return this.rows().map((r) => this.view(r));
  }

  get(id: string): AutomationView | null {
    const r = this.row(id);
    return r ? this.view(r) : null;
  }

  create(raw: Partial<AutomationSpec>, by: 'owner' | 'chief'): AutomationView {
    if (this.rows().length >= MAX_AUTOMATIONS) throw new AutomationError(`At most ${MAX_AUTOMATIONS} automations; remove one first.`, 'conflict');
    const spec = normalizeSpec(raw);
    const id = newId();
    const at = iso(this.p.now());
    this.p.sql.exec('INSERT INTO automations (automation_id, spec, enabled, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, JSON.stringify(spec), spec.enabled === false ? 0 : 1, by, at, at);
    return this.view(this.row(id)!);
  }

  update(id: string, patch: Partial<AutomationSpec>): AutomationView {
    const r = this.row(id);
    if (!r) throw new AutomationError('No such automation.', 'not_found');
    const cur = JSON.parse(r.spec) as AutomationSpec;
    const next = normalizeSpec({ ...cur, ...patch, action: { ...cur.action, ...(patch.action ?? {}) }, ...(patch.page ? { page: { ...cur.page!, ...patch.page } } : {}), enabled: patch.enabled ?? r.enabled === 1 });
    // A different page or pattern starts from a fresh baseline.
    const rebase = cur.page?.url !== next.page?.url || cur.page?.extract !== next.page?.extract || cur.page?.condition !== next.page?.condition;
    this.p.sql.exec(
      `UPDATE automations SET spec = ?, enabled = ?, updated_at = ?${rebase ? ', last_value = NULL, last_match = 0' : ''} WHERE automation_id = ?`,
      JSON.stringify(next), next.enabled === false ? 0 : 1, iso(this.p.now()), id,
    );
    return this.view(this.row(id)!);
  }

  remove(id: string): boolean {
    if (!this.row(id)) return false;
    this.p.sql.exec('DELETE FROM automations WHERE automation_id = ?', id);
    this.p.sql.exec('DELETE FROM automation_runs WHERE automation_id = ?', id);
    return true;
  }

  /** "Run now": fire at once (a page watcher runs with the page as it is). */
  async runNow(id: string): Promise<AutomationView> {
    const r = this.row(id);
    if (!r) throw new AutomationError('No such automation.', 'not_found');
    await this.fire(r, 'Run by the owner');
    return this.view(this.row(id)!);
  }

  /** When the alarm should next look (null: nothing enabled). */
  nextDue(): number | null {
    const times = this.rows()
      .filter((r) => r.enabled === 1)
      .map((r) => this.nextAt(r))
      .filter((x): x is number => x !== null);
    return times.length ? Math.min(...times) : null;
  }

  async tick(now = this.p.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const r of this.rows()) {
        if (r.enabled !== 1) continue;
        const at = this.nextAt(r);
        if (at === null || at > now) continue;
        try {
          await this.check(r, now);
        } catch (err) {
          this.p.sql.exec('UPDATE automations SET last_error = ?, last_checked_at = ? WHERE automation_id = ?', err instanceof Error ? err.message.slice(0, 300) : 'Could not run.', now, r.automation_id);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Every frame the ProjectDO appends: the end of a run an automation started. */
  observe(input: FrameInput<FrameType>): void {
    let runId: string | null = null;
    let status = '';
    let text = '';
    if (input.type === 'job.done' || input.type === 'job.failed' || input.type === 'job.cancelled') {
      const d = input.data as { jobId: string; summary?: string; message?: string };
      runId = d.jobId;
      status = input.type === 'job.done' ? 'done' : input.type === 'job.failed' ? 'failed' : 'cancelled';
      text = d.summary ?? d.message ?? '';
    } else if (input.type === 'project.updated') {
      const p = (input.data as { project: { projectId: string; status: string; summary?: string; error?: string } }).project;
      if (!TERMINAL.has(p.status)) return;
      runId = p.projectId;
      status = p.status;
      text = p.summary ?? p.error ?? '';
    } else return;
    const run = this.p.sql.exec<RunRow>(`SELECT * FROM automation_runs WHERE run_id = ? AND status = 'started'`, runId).toArray()[0];
    if (!run) return;
    this.p.sql.exec('UPDATE automation_runs SET status = ?, finished_at = ? WHERE run_id = ?', status, iso(this.p.now()), runId);
    this.p.background(this.finish(run, status, text));
  }

  // ── internals ────────────────────────────────────────────────────────────────────

  private async check(r: Row, now: number): Promise<void> {
    const spec = JSON.parse(r.spec) as AutomationSpec;
    if (spec.kind === 'schedule') {
      this.p.sql.exec('UPDATE automations SET last_checked_at = ? WHERE automation_id = ?', now, r.automation_id);
      await this.fire(r, spec.schedule?.dailyAt ? `Scheduled run (every day at ${spec.schedule.dailyAt} UTC)` : `Scheduled run (every ${minutesWords(spec.schedule?.everyMinutes ?? 0)})`);
      return;
    }
    const page = spec.page!;
    this.p.sql.exec('UPDATE automations SET last_checked_at = ? WHERE automation_id = ?', now, r.automation_id);
    const text = (await this.p.readPage(page.url)).replace(/\s+/g, ' ').trim();
    const value = await extractValue(text, page.extract);
    const verdict = evaluate(page.condition, page.value, value, r.last_value, r.last_match === 1);
    this.p.sql.exec('UPDATE automations SET last_value = ?, last_match = ?, last_error = NULL WHERE automation_id = ?', value, verdict.match ? 1 : 0, r.automation_id);
    if (!verdict.fire) return;
    const shown = page.extract ? `: ${value}${r.last_value !== null ? ` (was ${r.last_value})` : ''}` : '';
    await this.fire(r, page.condition === 'changed' ? `The page changed${shown}` : `The page now ${CONDITION_WORDS[page.condition]} “${page.value}”${shown}`);
  }

  private async fire(r: Row, context: string): Promise<void> {
    const spec = JSON.parse(r.spec) as AutomationSpec;
    const now = this.p.now();
    // One run at a time: a run still under way skips this one (biz-bot: "the team is still busy").
    const busy = this.p.sql.exec<RunRow>(`SELECT * FROM automation_runs WHERE automation_id = ? AND status = 'started'`, r.automation_id).toArray()[0];
    if (busy) {
      this.p.sql.exec('UPDATE automations SET last_fired_at = ?, last_result = ? WHERE automation_id = ?', now, 'Skipped: the last run is still going.', r.automation_id);
      return;
    }
    const brief = `${spec.action.goal}\n\n(${context}. Started by the automation “${spec.name}”${spec.kind === 'page' ? `, watching ${spec.page!.url}` : ''}.)`;
    const out =
      spec.action.type === 'project'
        ? await this.p.proposeProject(brief, spec.name, { automationId: r.automation_id, name: spec.name, autoStart: spec.action.autoStart !== false })
        : await this.p.startJob(spec.name, brief);
    this.p.sql.exec('UPDATE automations SET last_fired_at = ?, runs = runs + 1, last_result = ?, last_error = ? WHERE automation_id = ?', now, out.ok ? 'Started.' : `Could not start: ${out.message}`, out.ok ? null : out.message, r.automation_id);
    const runId = out.ok ? out.runId : `refused_${crypto.randomUUID().slice(0, 8)}`;
    this.p.sql.exec('INSERT INTO automation_runs (run_id, automation_id, run_kind, fired_at, context, status, why) VALUES (?, ?, ?, ?, ?, ?, ?)', runId, r.automation_id, spec.action.type, iso(now), context, out.ok ? 'started' : 'refused', out.ok ? null : out.message);
    this.p.sql.exec('DELETE FROM automation_runs WHERE automation_id = ? AND run_id NOT IN (SELECT run_id FROM automation_runs WHERE automation_id = ? ORDER BY fired_at DESC LIMIT 50)', r.automation_id, r.automation_id);
    if (out.ok) this.p.append({ type: 'automation.fired', data: { automationId: r.automation_id, name: spec.name, runId, runKind: spec.action.type, context } });
  }

  private async finish(run: RunRow, status: string, text: string): Promise<void> {
    const r = this.row(run.automation_id);
    if (!r) return;
    const spec = JSON.parse(r.spec) as AutomationSpec;
    const attention = status !== 'done';
    let notify = spec.gate === 'on' || (spec.gate === 'quiet' && (attention || spec.kind === 'page'));
    let why = spec.gate === 'on' ? 'You asked to hear after every run.' : spec.gate === 'off' ? 'You asked not to be told.' : attention ? `The run ended ${status}.` : spec.kind === 'page' ? 'The watched page changed.' : '';
    if (spec.gate === 'quiet' && !notify) {
      try {
        const v = await this.p.judge(spec.name, text);
        notify = v.matters;
        why = v.reason || (v.matters ? 'Worth knowing.' : 'Nothing material.');
      } catch {
        why = 'Nothing material (the check could not run).';
      }
    }
    this.p.sql.exec('UPDATE automation_runs SET notified = ?, why = ? WHERE run_id = ?', notify ? 1 : 0, why.slice(0, 300), run.run_id);
    this.p.sql.exec('UPDATE automations SET last_result = ? WHERE automation_id = ?', `${status[0]!.toUpperCase()}${status.slice(1)}${text ? `: ${text.slice(0, 200)}` : ''}`, run.automation_id);
    const what = run.run_kind === 'project' ? 'the team project' : 'the background job';
    const said =
      status === 'done'
        ? `“${spec.name}” ran: ${text || `${what} is done`}`
        : status === 'partial'
          ? `“${spec.name}” ran, but ${what} only partly finished.`
          : status === 'cancelled'
            ? `“${spec.name}”: ${what} was stopped.`
            : `“${spec.name}” did not finish: ${text || `${what} failed`}.`;
    this.p.append({ type: 'automation.result', data: { automationId: run.automation_id, name: spec.name, runId: run.run_id, runKind: run.run_kind as AutomationAction, status, notify, why, text: said } });
    await this.p.flush();
  }

  private nextAt(r: Row): number | null {
    const spec = JSON.parse(r.spec) as AutomationSpec;
    const created = Date.parse(r.created_at);
    if (spec.kind === 'schedule') {
      if (spec.schedule?.dailyAt) {
        // The first run is the next occurrence after it was set up (biz-bot fires at once).
        const since = Math.max(r.last_fired_at ?? 0, created);
        const last = lastDaily(this.p.now(), spec.schedule.dailyAt);
        return last > since ? last : last + 86_400_000;
      }
      const every = (spec.schedule?.everyMinutes ?? 60) * 60_000;
      return r.last_fired_at ? r.last_fired_at + every : created;
    }
    const every = (spec.page?.everyMinutes ?? PAGE_DEFAULT_MINUTES) * 60_000;
    return r.last_checked_at ? r.last_checked_at + every : created;
  }

  private rows(): Row[] {
    return this.p.sql.exec<Row>('SELECT * FROM automations ORDER BY created_at').toArray();
  }

  private row(id: string): Row | undefined {
    return this.p.sql.exec<Row>('SELECT * FROM automations WHERE automation_id = ?', id).toArray()[0];
  }

  private view(r: Row): AutomationView {
    const spec = JSON.parse(r.spec) as AutomationSpec;
    const next = r.enabled === 1 ? this.nextAt(r) : null;
    const history: AutomationRun[] = this.p.sql
      .exec<RunRow>('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY fired_at DESC LIMIT ?', r.automation_id, HISTORY)
      .toArray()
      .map((h) => ({
        runId: h.run_id,
        runKind: h.run_kind as AutomationAction,
        firedAt: h.fired_at,
        context: h.context,
        status: h.status,
        ...(h.finished_at ? { finishedAt: h.finished_at } : {}),
        ...(h.notified !== null ? { notified: h.notified === 1 } : {}),
        ...(h.why ? { why: h.why } : {}),
      }));
    return {
      ...spec,
      automationId: r.automation_id,
      enabled: r.enabled === 1,
      createdBy: r.created_by === 'chief' ? 'chief' : 'owner',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      describe: describeSpec(spec),
      ...(next !== null ? { nextAt: iso(Math.max(next, this.p.now())) } : {}),
      ...(r.last_checked_at ? { lastCheckedAt: iso(r.last_checked_at) } : {}),
      ...(r.last_fired_at ? { lastFiredAt: iso(r.last_fired_at) } : {}),
      ...(r.last_value !== null ? { lastValue: r.last_value } : {}),
      ...(r.last_result ? { lastResult: r.last_result } : {}),
      ...(r.last_error ? { lastError: r.last_error } : {}),
      runs: Number(r.runs),
      history,
    };
  }
}
