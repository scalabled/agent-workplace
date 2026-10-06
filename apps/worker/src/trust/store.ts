// Inc 6 trust records in D1 (migrations/0005_trust.sql): the owner's autonomy level per kind of action, grants that
// reach past one approval, and the audit trail. D1 so every object reads the same policy: the Everyday ProjectDO gates
// emails, the WorkspaceDO records the team's changes, and the routes show and undo them.
import { DEFAULT_WORKSPACE_ID } from '@headcount/protocol';
import {
  ACTION_CLASSES,
  defaultPolicy,
  type ActionClass,
  type AuditEntry,
  type AuditKind,
  type AuditResponse,
  type Autonomy,
  type AutonomyPolicy,
  type Grant,
  type GrantKind,
  type Receipt,
} from '@headcount/protocol/ext/trust';
import type { Env } from '../env';
import { logError } from '../workspace/runtime';

export const wsOf = (env: Pick<Env, 'WORKSPACE_ID'>): string => env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID;

export class TrustError extends Error {
  constructor(
    message: string,
    readonly code: 'bad_request' | 'not_found' | 'conflict' = 'bad_request',
  ) {
    super(message);
  }
}

const rand = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const trustId = (prefix: 'grt' | 'aud' | 'rcp') => `${prefix}_${rand(10)}`;

// ── the autonomy dial ─────────────────────────────────────────────────────────────────

export async function loadPolicy(db: D1Database, ws: string): Promise<AutonomyPolicy> {
  const policy = defaultPolicy();
  try {
    const rows = (await db.prepare('SELECT action_class, level FROM autonomy WHERE ws_id = ?').bind(ws).all<{ action_class: string; level: string }>()).results ?? [];
    for (const r of rows) {
      const info = ACTION_CLASSES.find((c) => c.id === r.action_class);
      // A level the class no longer allows (a ceiling lowered in a release) falls back to the default.
      if (info && info.allowed.includes(r.level as Autonomy)) policy[info.id] = r.level as Autonomy;
    }
  } catch (err) {
    // An unmigrated database: the defaults stand (the safe ones).
    logError('trust.policy', err);
  }
  return policy;
}

export async function setAutonomy(db: D1Database, ws: string, actionClass: ActionClass, level: Autonomy, by: string): Promise<{ before: Autonomy; policy: AutonomyPolicy }> {
  const info = ACTION_CLASSES.find((c) => c.id === actionClass);
  if (!info) throw new TrustError('There is no such kind of action.');
  if (!info.allowed.includes(level)) throw new TrustError(info.allowed.length ? `${info.label}: choose ${info.allowed.join(', ')}.` : `${info.label} cannot be changed.`);
  const before = (await loadPolicy(db, ws))[actionClass];
  await db
    .prepare(
      `INSERT INTO autonomy (ws_id, action_class, level, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(ws_id, action_class) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(ws, actionClass, level, new Date().toISOString(), by)
    .run();
  return { before, policy: await loadPolicy(db, ws) };
}

// ── grants ────────────────────────────────────────────────────────────────────────

type GrantRow = {
  grant_id: string;
  action_class: string;
  tool: string;
  kind: string;
  subject: string;
  task_id: string | null;
  project_id: string | null;
  expires_at: string | null;
  created_at: string;
  created_by: string;
  uses: number;
  used_at: string | null;
  note: string | null;
};

function toGrant(r: GrantRow): Grant {
  return {
    grantId: r.grant_id,
    actionClass: r.action_class as ActionClass,
    tool: r.tool,
    kind: r.kind as GrantKind,
    subject: r.subject,
    ...(r.task_id ? { taskId: r.task_id } : {}),
    ...(r.project_id ? { projectId: r.project_id } : {}),
    ...(r.expires_at ? { expiresAt: r.expires_at } : {}),
    createdAt: r.created_at,
    createdBy: r.created_by,
    uses: Number(r.uses),
    ...(r.used_at ? { usedAt: r.used_at } : {}),
    ...(r.note ? { note: r.note } : {}),
  };
}

/** Does this grant cover an action by `subject` in this task and project, now? A project grant never matches outside its project. */
export function grantCovers(g: Grant, q: { tool: string; subject: string; taskId?: string; projectId?: string; now: number }): boolean {
  if (g.tool !== q.tool) return false;
  if (g.subject !== '*' && g.subject !== q.subject) return false;
  if (g.kind === 'task') return !!q.taskId && g.taskId === q.taskId && (g.projectId ?? '') === (q.projectId ?? '');
  if (g.kind === 'project') return !!q.projectId && g.projectId === q.projectId;
  if (g.kind === 'day') return !!g.expiresAt && Date.parse(g.expiresAt) > q.now;
  return false;
}

export async function findGrant(db: D1Database, ws: string, q: { tool: string; subject: string; taskId?: string; projectId?: string; now: number }): Promise<Grant | null> {
  try {
    const rows = (await db.prepare('SELECT * FROM grants WHERE ws_id = ? AND tool = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 200').bind(ws, q.tool).all<GrantRow>()).results ?? [];
    return rows.map(toGrant).find((g) => grantCovers(g, q)) ?? null;
  } catch (err) {
    logError('trust.grants', err);
    return null;
  }
}

export async function addGrant(
  db: D1Database,
  ws: string,
  g: { actionClass: ActionClass; tool: string; kind: Exclude<GrantKind, 'once'>; subject: string; taskId?: string; projectId?: string; by: string; note?: string; now: number },
): Promise<Grant> {
  const grantId = trustId('grt');
  const createdAt = new Date(g.now).toISOString();
  const expiresAt = g.kind === 'day' ? new Date(g.now + 24 * 3600_000).toISOString() : null;
  await db
    .prepare(
      `INSERT INTO grants (grant_id, ws_id, action_class, tool, kind, subject, task_id, project_id, expires_at, created_at, created_by, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(grantId, ws, g.actionClass, g.tool, g.kind, g.subject, g.kind === 'task' ? (g.taskId ?? null) : null, g.kind === 'day' ? null : (g.projectId ?? null), expiresAt, createdAt, g.by, g.note ?? null)
    .run();
  const row = await db.prepare('SELECT * FROM grants WHERE grant_id = ?').bind(grantId).first<GrantRow>();
  return toGrant(row!);
}

export async function useGrant(db: D1Database, grantId: string, now: number): Promise<void> {
  await db.prepare('UPDATE grants SET uses = uses + 1, used_at = ? WHERE grant_id = ?').bind(new Date(now).toISOString(), grantId).run();
}

export async function revokeGrant(db: D1Database, ws: string, grantId: string): Promise<Grant | null> {
  const row = await db.prepare('SELECT * FROM grants WHERE grant_id = ? AND ws_id = ? AND revoked_at IS NULL').bind(grantId, ws).first<GrantRow>();
  if (!row) return null;
  await db.prepare('UPDATE grants SET revoked_at = ? WHERE grant_id = ?').bind(new Date().toISOString(), grantId).run();
  return toGrant(row);
}

/** Grants still in force: not revoked, not expired, and task grants from the last day (a task that long is over). */
export async function activeGrants(db: D1Database, ws: string, now: number): Promise<Grant[]> {
  try {
    const rows = (await db.prepare('SELECT * FROM grants WHERE ws_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 100').bind(ws).all<GrantRow>()).results ?? [];
    return rows
      .map(toGrant)
      .filter((g) => (g.kind === 'day' ? Date.parse(g.expiresAt ?? '') > now : g.kind === 'task' ? Date.parse(g.createdAt) > now - 24 * 3600_000 : true));
  } catch (err) {
    logError('trust.grants', err);
    return [];
  }
}

// ── the audit trail ───────────────────────────────────────────────────────────────

/** What Undo does for an entry (run by src/trust/routes.ts), or why there is none. */
export type UndoSpec =
  | { type: 'handbook.restore'; section: string; before: string; label: string }
  | { type: 'memory.forget'; memoryId: string; label: string }
  | { type: 'instructions.restore'; personaId: string; before: string | null; label: string }
  | { type: 'automation.remove'; automationId: string; label: string }
  | { type: 'grant.revoke'; grantId: string; label: string }
  | { type: 'autonomy.restore'; actionClass: ActionClass; before: Autonomy; label: string }
  | { type: 'team.letgo'; personaId: string; label: string }
  | { type: 'none'; label: string };

export interface AuditInput {
  actor: string;
  kind: AuditKind;
  action: string;
  summary: string;
  target?: string;
  link?: string;
  receipt?: Receipt;
  undo?: UndoSpec;
  at?: string;
}

type AuditRow = {
  audit_id: string;
  at: string;
  actor: string;
  kind: string;
  action: string;
  summary: string;
  target: string | null;
  link: string | null;
  receipt: string | null;
  undo: string | null;
  undone_at: string | null;
  undone_by: string | null;
};

/** Append to the audit trail. Never throws: a failed write is logged, the action it records already happened. */
export async function audit(db: D1Database, ws: string, e: AuditInput): Promise<string | null> {
  const auditId = trustId('aud');
  try {
    await db
      .prepare(`INSERT INTO audit_log (audit_id, ws_id, at, actor, kind, action, summary, target, link, receipt, undo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(auditId, ws, e.at ?? new Date().toISOString(), e.actor, e.kind, e.action, e.summary.slice(0, 600), e.target?.slice(0, 300) ?? null, e.link ?? null, e.receipt ? JSON.stringify(e.receipt) : null, e.undo ? JSON.stringify(e.undo) : null)
      .run();
    return auditId;
  } catch (err) {
    logError('trust.audit', err);
    return null;
  }
}

function toEntry(r: AuditRow): AuditEntry {
  const undo = r.undo ? (JSON.parse(r.undo) as UndoSpec) : null;
  return {
    auditId: r.audit_id,
    at: r.at,
    actor: r.actor,
    kind: r.kind as AuditKind,
    action: r.action,
    summary: r.summary,
    ...(r.target ? { target: r.target } : {}),
    ...(r.link ? { link: r.link } : {}),
    ...(r.receipt ? { receipt: JSON.parse(r.receipt) as Receipt } : {}),
    ...(undo
      ? { undo: r.undone_at ? { can: false, label: undo.label, undoneAt: r.undone_at, ...(r.undone_by ? { undoneBy: r.undone_by } : {}) } : { can: undo.type !== 'none', label: undo.label } }
      : {}),
  };
}

export const AUDIT_PAGE = 50;

export async function listAudit(db: D1Database, ws: string, opts: { before?: string; kind?: AuditKind; limit?: number } = {}): Promise<AuditResponse> {
  const limit = Math.min(Math.max(opts.limit ?? AUDIT_PAGE, 1), 200);
  const where = ['ws_id = ?'];
  const args: unknown[] = [ws];
  if (opts.kind) {
    where.push('kind = ?');
    args.push(opts.kind);
  }
  if (opts.before) {
    const [at, id] = opts.before.split('|');
    where.push('(at < ? OR (at = ? AND audit_id < ?))');
    args.push(at, at, id ?? '');
  }
  const rows = (await db.prepare(`SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY at DESC, audit_id DESC LIMIT ?`).bind(...args, limit + 1).all<AuditRow>()).results ?? [];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { entries: page.map(toEntry), ...(rows.length > limit && last ? { next: `${last.at}|${last.audit_id}` } : {}) };
}

export async function auditRow(db: D1Database, ws: string, auditId: string): Promise<{ entry: AuditEntry; undo: UndoSpec | null; undone: boolean } | null> {
  const r = await db.prepare('SELECT * FROM audit_log WHERE audit_id = ? AND ws_id = ?').bind(auditId, ws).first<AuditRow>();
  return r ? { entry: toEntry(r), undo: r.undo ? (JSON.parse(r.undo) as UndoSpec) : null, undone: !!r.undone_at } : null;
}

/** Mark undone (once: a second Undo of the same entry is refused). */
export async function markUndone(db: D1Database, ws: string, auditId: string, by: string): Promise<boolean> {
  const r = await db.prepare('UPDATE audit_log SET undone_at = ?, undone_by = ? WHERE audit_id = ? AND ws_id = ? AND undone_at IS NULL').bind(new Date().toISOString(), by, auditId, ws).run();
  return (r.meta?.changes ?? 0) > 0;
}
