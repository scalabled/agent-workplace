// Real actions that happen exactly once (ARCHITECTURE §6.6), hosted by the Everyday ProjectDO: the one place an email
// goes out. An effect is keyed by what it intends (who asked it in which piece of work, the recipients and the
// content), so asking twice for the same email is the same effect. It passes the gate (the autonomy dial, then the
// owner's grants), is written down as pending before any I/O, goes out with its key as the provider's idempotency key,
// and gets a receipt. After a crash a pending effect is reconciled against the provider, never blindly replayed; when
// nobody can tell whether it went out, the owner decides. Everyone stop holds what has not gone out.
import { BRAND } from '@headcount/protocol';
import { CHIEF_ID, type ActorId, type FrameInput } from '@headcount/protocol';
import type { Decision, DecisionAnswer } from '@headcount/protocol/ext/projects';
import {
  EMAIL_BODY_MAX,
  EMAIL_RECIPIENTS_MAX,
  EMAIL_SUBJECT_MAX,
  needsOk,
  type EffectAsk,
  type EffectStatus,
  type EffectView,
  type EmailMessage,
  type Grant,
  type GrantKind,
  type Receipt,
  type StopState,
} from '@headcount/protocol/ext/trust';
import type { Env } from '../env';
import { logError } from '../workspace/runtime';
import { addressOf, isEmailAddress, MailRefused, mailStatus, withDisclosure, type MailSender, type OutgoingMail } from './mail';
import { addGrant, audit, findGrant, loadPolicy, trustId, useGrant, wsOf } from './store';

export const EFFECTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS effects (
     key TEXT PRIMARY KEY, tool TEXT NOT NULL, action_class TEXT NOT NULL, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL,
     project_id TEXT NOT NULL DEFAULT '', step_id TEXT, task_id TEXT NOT NULL, email TEXT NOT NULL,
     status TEXT NOT NULL, decision_id TEXT, approved_by TEXT, receipt TEXT, note TEXT,
     attempts INTEGER NOT NULL DEFAULT 0, first_attempt_at INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS effects_status ON effects (status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS effects_decision ON effects (decision_id)`,
];

/** A pending effect untouched this long after its attempt is checked against the provider. */
export const RECONCILE_AFTER_MS = 30_000;

type Row = {
  key: string;
  tool: string;
  action_class: string;
  agent_id: string;
  agent_name: string;
  project_id: string;
  step_id: string | null;
  task_id: string;
  email: string;
  status: string;
  decision_id: string | null;
  approved_by: string | null;
  receipt: string | null;
  note: string | null;
  attempts: number;
  first_attempt_at: number | null;
  created_at: string;
  updated_at: string;
};

export interface EffectRequest {
  /** Who asks (CHIEF_ID, or a coworker's agent id). */
  agentId: string;
  agentName: string;
  /** A team project and step, when a step's lead sends. */
  projectId?: string;
  stepId?: string;
  /** The piece of work, for "for the rest of this task" grants. */
  taskId: string;
  /** What makes two requests the same effect: the project, or the conversation turn. */
  scope: string;
  email: EmailMessage;
}

export type EffectResult =
  | { status: 'done'; key: string; receipt: Receipt; existing: boolean; test: boolean }
  | { status: 'awaiting'; key: string; decisionId: string | null }
  | { status: 'pending'; key: string }
  | { status: 'held'; key: string }
  | { status: 'declined'; key: string }
  | { status: 'failed'; key: string; note: string }
  | { status: 'unknown'; key: string; decisionId: string | null };

export class EffectError extends Error {}

export interface RaiseEffect {
  taskId: string;
  projectId: string;
  stepId?: string;
  fromId: string;
  fromName: string;
  emails: EffectAsk['emails'];
  allowedGrants: GrantKind[];
  unknown?: boolean;
}

export interface EffectPorts {
  sql: SqlStorage;
  env: Env;
  now(): number;
  append(input: FrameInput<'effect.updated'>): void;
  flush(): Promise<void>;
  armAlarm(at: number): Promise<void>;
  stopped(): StopState | null;
  /** The daily email limit (atomic in the DO's own counter). */
  takeEmail(): boolean;
  limitMessage(): string;
  sender(): MailSender | null;
  ownerName(): Promise<string | null>;
  /** Open the owner's decision for these emails, or add them to the open one for the same task. Synchronous. */
  raise(input: RaiseEffect): Decision;
}

const iso = (ms: number) => new Date(ms).toISOString();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A clean message, or why not (in words an agent can fix). */
export function normalizeEmail(e: Partial<EmailMessage>): EmailMessage {
  const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : []).map((x) => String(x).trim()).filter(Boolean);
  const to = [...new Set(list(e.to).map((x) => addressOf(x).toLowerCase()))];
  const cc = [...new Set(list(e.cc).map((x) => addressOf(x).toLowerCase()))].filter((x) => !to.includes(x));
  if (!to.length) throw new EffectError('Say who it goes to (an email address).');
  const bad = [...to, ...cc].filter((x) => !isEmailAddress(x));
  if (bad.length) throw new EffectError(`Not an email address: ${bad.join(', ')}. Use the full address, or ask the owner for it.`);
  if (to.length + cc.length > EMAIL_RECIPIENTS_MAX) throw new EffectError(`At most ${EMAIL_RECIPIENTS_MAX} recipients per email; send separate emails.`);
  const subject = String(e.subject ?? '').replace(/\s+/g, ' ').trim();
  const text = String(e.text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!subject) throw new EffectError('Give the email a subject.');
  if (subject.length > EMAIL_SUBJECT_MAX) throw new EffectError(`Keep the subject under ${EMAIL_SUBJECT_MAX} characters.`);
  if (text.length < 2) throw new EffectError('Write the email itself.');
  if (text.length > EMAIL_BODY_MAX) throw new EffectError(`Keep the email under ${EMAIL_BODY_MAX.toLocaleString()} characters.`);
  const replyTo = e.replyTo ? addressOf(String(e.replyTo)) : '';
  return { to, ...(cc.length ? { cc } : {}), subject, text, ...(replyTo && isEmailAddress(replyTo) ? { replyTo } : {}) };
}

/** The same intended email in the same piece of work is the same effect. */
export async function effectKey(scope: string, e: EmailMessage): Promise<string> {
  return `eff_${(await sha256Hex(['email.send', scope, [...e.to].sort().join(','), [...(e.cc ?? [])].sort().join(','), e.subject, e.text].join('\n'))).slice(0, 32)}`;
}

export class Effects {
  private readonly inflight = new Set<string>();

  constructor(private readonly p: EffectPorts) {
    for (const s of EFFECTS_SCHEMA) p.sql.exec(s);
  }

  private get db(): D1Database {
    return this.p.env.DB;
  }

  private get ws(): string {
    return wsOf(this.p.env);
  }

  private row(key: string): Row | undefined {
    return this.p.sql.exec<Row>('SELECT * FROM effects WHERE key = ?', key).toArray()[0];
  }

  private set(key: string, patch: Partial<Pick<Row, 'status' | 'decision_id' | 'approved_by' | 'receipt' | 'note' | 'attempts' | 'first_attempt_at'>>): Row {
    const cols = Object.keys(patch);
    if (cols.length) this.p.sql.exec(`UPDATE effects SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE key = ?`, ...cols.map((c) => (patch as Record<string, unknown>)[c] ?? null), iso(this.p.now()), key);
    const r = this.row(key)!;
    this.p.append({ type: 'effect.updated', data: { effect: this.view(r) }, actor: r.agent_id as ActorId });
    return r;
  }

  view(r: Row): EffectView {
    return {
      key: r.key,
      tool: 'email.send',
      actionClass: 'external_send',
      status: r.status as EffectStatus,
      agentId: r.agent_id,
      ...(r.project_id ? { projectId: r.project_id } : {}),
      ...(r.step_id ? { stepId: r.step_id } : {}),
      email: JSON.parse(r.email) as EmailMessage,
      ...(r.decision_id ? { decisionId: r.decision_id } : {}),
      ...(r.receipt ? { receipt: JSON.parse(r.receipt) as Receipt } : {}),
      ...(r.note ? { note: r.note } : {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private result(r: Row, existing: boolean): EffectResult {
    switch (r.status as EffectStatus) {
      case 'done': {
        const receipt = JSON.parse(r.receipt!) as Receipt;
        return { status: 'done', key: r.key, receipt, existing, test: receipt.provider === 'sink' };
      }
      case 'awaiting':
        return { status: 'awaiting', key: r.key, decisionId: r.decision_id };
      case 'unknown':
        return { status: 'unknown', key: r.key, decisionId: r.decision_id };
      case 'failed':
        return { status: 'failed', key: r.key, note: r.note ?? 'It could not be sent.' };
      default:
        return { status: r.status as 'pending' | 'held' | 'declined', key: r.key };
    }
  }

  /** Grants a decision may offer: a project step can reach the task and the project; a conversation, one day at most. */
  static grantsFor(projectId: string | undefined): GrantKind[] {
    return projectId ? ['once', 'task', 'project', 'day'] : ['once', 'day'];
  }

  /** Ask for an email. Returns at once: sent (a receipt), waiting for the owner, held, or refused. */
  async request(req: EffectRequest): Promise<EffectResult> {
    const email = normalizeEmail(req.email);
    const key = await effectKey(req.scope, email);
    const had = this.row(key);
    // The same email asked again: its outcome stands (a failed one may be tried again).
    if (had && had.status !== 'failed') return this.result(had, true);
    const now = this.p.now();
    const [policy, grant] = await Promise.all([
      loadPolicy(this.db, this.ws),
      findGrant(this.db, this.ws, { tool: 'email.send', subject: req.agentId, ...(req.taskId ? { taskId: req.taskId } : {}), ...(req.projectId ? { projectId: req.projectId } : {}), now }),
    ]);
    // Another call may have asked for the same email while we looked.
    const raced = this.row(key);
    if (raced && raced.status !== 'failed') return this.result(raced, true);
    const free = !needsOk(policy.external_send);
    const approvedBy = grant ? `grant:${grant.grantId}` : free ? 'policy:act' : null;
    const stop = this.p.stopped();
    const status: EffectStatus = stop ? 'held' : approvedBy ? 'pending' : 'awaiting';
    const at = iso(now);
    this.p.sql.exec(
      `INSERT INTO effects (key, tool, action_class, agent_id, agent_name, project_id, step_id, task_id, email, status, approved_by, created_at, updated_at)
       VALUES (?, 'email.send', 'external_send', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET status = excluded.status, approved_by = excluded.approved_by, note = NULL, decision_id = NULL, updated_at = excluded.updated_at`,
      key, req.agentId, req.agentName, req.projectId ?? '', req.stepId ?? null, req.taskId, JSON.stringify(email), status, approvedBy, at, at,
    );
    const target = email.to.join(', ');
    if (status === 'held') {
      this.set(key, {});
      await audit(this.db, this.ws, { actor: req.agentId, kind: 'email', action: 'email.held', summary: `Held (Everyone stop): “${email.subject}” to ${target}`, target, link: '/app/admin/audit' });
      return { status: 'held', key };
    }
    if (approvedBy) {
      if (grant) await useGrant(this.db, grant.grantId, now);
      return this.result(await this.execute(key), false);
    }
    const d = this.p.raise({
      taskId: req.taskId,
      projectId: req.projectId ?? '',
      ...(req.stepId ? { stepId: req.stepId } : {}),
      fromId: req.agentId,
      fromName: req.agentName,
      emails: [{ key, to: email.to, ...(email.cc ? { cc: email.cc } : {}), subject: email.subject, text: email.text }],
      allowedGrants: Effects.grantsFor(req.projectId),
    });
    this.set(key, { decision_id: d.decisionId });
    await audit(this.db, this.ws, { actor: req.agentId, kind: 'email', action: 'email.asked', summary: `${req.agentName} asked to send “${email.subject}” to ${target}`, target, link: `/app/inbox?at=${d.decisionId}` });
    void this.p.flush();
    return { status: 'awaiting', key, decisionId: d.decisionId };
  }

  /** The owner answered an email decision: send (with a grant that reaches further, or just these), or not. */
  async answer(d: Decision, a: DecisionAnswer, by: string): Promise<{ ok: true; summary: string; sent: Receipt[]; grant?: Grant } | { ok: false; message: string }> {
    const ask = d.effect;
    if (!ask) return { ok: false, message: 'Nothing to send here.' };
    const rows = ask.keys.map((k) => this.row(k)).filter((r): r is Row => !!r);
    const open = rows.filter((r) => r.status === 'awaiting' || r.status === 'unknown');
    if (a.action !== 'approve') {
      for (const r of open) {
        this.set(r.key, { status: 'declined' });
        const e = JSON.parse(r.email) as EmailMessage;
        await audit(this.db, this.ws, { actor: by, kind: 'email', action: 'email.declined', summary: `Declined: “${e.subject}” to ${e.to.join(', ')} (asked by ${r.agent_name})`, target: e.to.join(', '), link: `/app/inbox?at=${d.decisionId}` });
      }
      void this.p.flush();
      return { ok: true, summary: open.length === 1 ? 'The owner said not to send it. Nothing was sent.' : `The owner said not to send these ${open.length} emails. Nothing was sent.`, sent: [] };
    }
    const kind: GrantKind = a.grant ?? 'once';
    if (!ask.allowedGrants.includes(kind)) return { ok: false, message: 'That approval is not offered for this.' };
    const first = open[0] ?? rows[0];
    let grant: Grant | undefined;
    if (kind !== 'once' && first) {
      grant = await addGrant(this.db, this.ws, {
        actionClass: 'external_send',
        tool: 'email.send',
        kind,
        subject: first.agent_id,
        ...(first.task_id ? { taskId: first.task_id } : {}),
        ...(first.project_id ? { projectId: first.project_id } : {}),
        by,
        note: d.title,
        now: this.p.now(),
      });
      await audit(this.db, this.ws, {
        actor: by,
        kind: 'grant',
        action: 'grant.created',
        summary: `Allowed ${first.agent_name} to send email ${kind === 'task' ? 'for the rest of this task' : kind === 'project' ? 'for the rest of this project' : 'for 24 hours'}`,
        target: first.agent_name,
        link: '/app/admin/autonomy',
        undo: { type: 'grant.revoke', grantId: grant.grantId, label: 'Take the permission back' },
      });
    }
    const sent: Receipt[] = [];
    let held = 0;
    const failed: string[] = [];
    for (const r of open) {
      this.set(r.key, { approved_by: grant ? `grant:${grant.grantId}` : `owner:${by}` });
      if (grant) await useGrant(this.db, grant.grantId, this.p.now());
      if (this.p.stopped()) {
        this.set(r.key, { status: 'held' });
        held++;
        continue;
      }
      const done = await this.execute(r.key);
      if (done.status === 'done') sent.push(JSON.parse(done.receipt!) as Receipt);
      else if (done.status === 'failed') failed.push(done.note ?? 'It could not be sent.');
    }
    void this.p.flush();
    const parts = [
      sent.length ? `${sent.length === 1 ? 'The email was' : `${sent.length} emails were`} sent (receipt${sent.length === 1 ? '' : 's'} ${sent.map((x) => x.receiptId).join(', ')}).` : '',
      held ? `${held} held: Everyone stop is on.` : '',
      failed.length ? `Not sent: ${failed.join('; ')}` : '',
    ].filter(Boolean);
    return { ok: true, summary: parts.join(' ') || 'Nothing was waiting to send.', sent, ...(grant ? { grant } : {}) };
  }

  /** Send it: pending first (durable before any I/O), then the provider with the key, then the receipt. */
  private async execute(key: string): Promise<Row> {
    const r0 = this.row(key)!;
    if (r0.status === 'done' || this.inflight.has(key)) return r0;
    const sender = this.p.sender();
    if (!sender) return this.set(key, { status: 'failed', note: mailStatus(this.p.env).why ?? 'Email is off.' });
    if (!this.p.takeEmail()) return this.set(key, { status: 'failed', note: this.p.limitMessage() });
    const now = this.p.now();
    this.set(key, { status: 'pending', attempts: Number(r0.attempts) + 1, first_attempt_at: r0.first_attempt_at ?? now, note: null });
    this.inflight.add(key);
    try {
      const mail = await this.compose(r0);
      const { providerId } = await sender.send(key, mail);
      return await this.receipted(key, providerId, mail, sender.provider);
    } catch (err) {
      const e = JSON.parse(r0.email) as EmailMessage;
      if (err instanceof MailRefused) {
        const r = this.set(key, { status: 'failed', note: err.message });
        await audit(this.db, this.ws, { actor: r0.agent_id, kind: 'email', action: 'email.failed', summary: `Not sent: “${e.subject}” to ${e.to.join(', ')}. ${err.message}`, target: e.to.join(', ') });
        return r;
      }
      // It may or may not have gone out: pending stays, and recovery checks with the provider.
      logError('effects.send', err);
      const r = this.set(key, { note: err instanceof Error ? err.message : 'The email provider did not answer.' });
      await this.p.armAlarm(this.p.now() + RECONCILE_AFTER_MS);
      return r;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async compose(r: Row): Promise<OutgoingMail> {
    const e = JSON.parse(r.email) as EmailMessage;
    const status = mailStatus(this.p.env);
    const replyTo = e.replyTo || this.p.env.MAIL_REPLY_TO?.trim() || '';
    return {
      from: status.from ?? '',
      to: e.to,
      ...(e.cc?.length ? { cc: e.cc } : {}),
      ...(replyTo ? { replyTo } : {}),
      subject: e.subject,
      text: withDisclosure(e.text, { agentName: r.agent_name, ownerName: await this.p.ownerName().catch(() => null) }),
    };
  }

  private async receipted(key: string, providerId: string, mail: OutgoingMail | null, provider: MailSender['provider'], note?: string): Promise<Row> {
    const r0 = this.row(key)!;
    const e = JSON.parse(r0.email) as EmailMessage;
    const receipt: Receipt = {
      receiptId: trustId('rcp'),
      key,
      action: 'email.send',
      target: e.to.join(', '),
      payloadHash: await sha256Hex(JSON.stringify(mail ?? e)),
      approvedBy: r0.approved_by ?? 'unknown',
      at: iso(this.p.now()),
      provider,
      providerId,
      undo: 'No undo: an email cannot be recalled.',
    };
    const r = this.set(key, { status: 'done', receipt: JSON.stringify(receipt), note: note ?? null });
    await audit(this.db, this.ws, {
      actor: r0.agent_id,
      kind: 'email',
      action: 'email.sent',
      summary: `${r0.agent_name} sent “${e.subject}” to ${receipt.target}${provider === 'sink' ? ` (test mailbox: nothing left ${BRAND.name})` : ''}${note ? `. ${note}` : ''}`,
      target: receipt.target,
      receipt,
      undo: { type: 'none', label: receipt.undo },
    });
    return r;
  }

  /** After a restart: every pending effect is checked with the provider (sent → receipt; provably not → send with the same key; unknown → ask). */
  async recover(): Promise<void> {
    const now = this.p.now();
    const stale = this.p.sql
      .exec<Row>(`SELECT * FROM effects WHERE status = 'pending' AND updated_at <= ?`, iso(now - RECONCILE_AFTER_MS))
      .toArray()
      .filter((r) => !this.inflight.has(r.key));
    for (const r of stale) {
      if (this.p.stopped()) {
        this.set(r.key, { status: 'held' });
        continue;
      }
      const sender = this.p.sender();
      if (!sender) continue;
      try {
        const got = await sender.reconcile(r.key, r.first_attempt_at ?? now, now);
        if (got.status === 'sent') await this.receipted(r.key, got.providerId, null, sender.provider, 'Confirmed with the provider after a restart');
        else if (got.status === 'safe_retry') await this.execute(r.key);
        else {
          const e = JSON.parse(r.email) as EmailMessage;
          const d = this.p.raise({
            taskId: `unknown:${r.key}`,
            projectId: r.project_id,
            ...(r.step_id ? { stepId: r.step_id } : {}),
            fromId: r.agent_id,
            fromName: r.agent_name,
            emails: [{ key: r.key, to: e.to, ...(e.cc ? { cc: e.cc } : {}), subject: e.subject, text: e.text }],
            allowedGrants: ['once'],
            unknown: true,
          });
          this.set(r.key, { status: 'unknown', decision_id: d.decisionId, note: 'It may or may not have gone out: the provider can no longer tell.' });
          await audit(this.db, this.ws, { actor: 'system', kind: 'email', action: 'email.unknown', summary: `Can't confirm “${e.subject}” to ${e.to.join(', ')} went out; asked the owner`, target: e.to.join(', '), link: `/app/inbox?at=${d.decisionId}` });
        }
      } catch (err) {
        logError('effects.recover', err);
      }
    }
    if (stale.length) void this.p.flush();
  }

  /** When recovery should look again (pending effects), or null. */
  nextDue(): number | null {
    const r = this.p.sql.exec<{ at: string | null }>(`SELECT MIN(updated_at) AS at FROM effects WHERE status = 'pending'`).toArray()[0]?.at;
    return r ? Date.parse(r) + RECONCILE_AFTER_MS : null;
  }

  /** Everyone stop ended: held emails that had an OK go out; the rest wait for one. */
  async resume(): Promise<void> {
    const held = this.p.sql.exec<Row>(`SELECT * FROM effects WHERE status = 'held' ORDER BY created_at`).toArray();
    for (const r of held) {
      if (r.approved_by) {
        await this.execute(r.key);
        continue;
      }
      const e = JSON.parse(r.email) as EmailMessage;
      const d = this.p.raise({
        taskId: r.task_id,
        projectId: r.project_id,
        ...(r.step_id ? { stepId: r.step_id } : {}),
        fromId: r.agent_id,
        fromName: r.agent_name,
        emails: [{ key: r.key, to: e.to, ...(e.cc ? { cc: e.cc } : {}), subject: e.subject, text: e.text }],
        allowedGrants: Effects.grantsFor(r.project_id || undefined),
      });
      this.set(r.key, { status: 'awaiting', decision_id: d.decisionId });
    }
    if (held.length) void this.p.flush();
  }

  /** An email the owner sends themself from Admin → Email, to check the setup. It needs no OK: the owner is sending it. */
  async ownerTest(to: string, by: string): Promise<EffectResult> {
    const email = normalizeEmail({ to: [to], subject: `${BRAND.name}: a test email`, text: `This is a test from ${BRAND.name}. If you can read it, your coworkers can send email.` });
    const key = await effectKey(`test:${by}:${Math.floor(this.p.now() / 60_000)}`, email);
    const had = this.row(key);
    if (had) return this.result(had, true);
    const at = iso(this.p.now());
    this.p.sql.exec(
      `INSERT INTO effects (key, tool, action_class, agent_id, agent_name, project_id, task_id, email, status, approved_by, created_at, updated_at)
       VALUES (?, 'email.send', 'external_send', ?, 'You', '', 'test', ?, 'pending', ?, ?, ?)`,
      key, `owner:${by}`, JSON.stringify(email), `owner:${by}`, at, at,
    );
    return this.result(await this.execute(key), false);
  }

  /** Emails waiting, held, going out, uncertain, or failed in the last day. */
  open(): EffectView[] {
    const since = iso(this.p.now() - 24 * 3600_000);
    return this.p.sql
      .exec<Row>(`SELECT * FROM effects WHERE status IN ('awaiting','held','pending','unknown') OR (status = 'failed' AND updated_at >= ?) ORDER BY created_at DESC LIMIT 50`, since)
      .toArray()
      .map((r) => this.view(r));
  }

  /** The latest emails an agent asked for, whatever became of them (the Chief's context: what went out, what waits). */
  recent(agentId: string = CHIEF_ID, limit = 5): EffectView[] {
    return this.p.sql
      .exec<Row>('SELECT * FROM effects WHERE agent_id = ? ORDER BY updated_at DESC LIMIT ?', agentId, limit)
      .toArray()
      .map((r) => this.view(r));
  }

  /** The emails behind a decision (for its step's answer). */
  forDecision(decisionId: string): EffectView[] {
    return this.p.sql.exec<Row>('SELECT * FROM effects WHERE decision_id = ?', decisionId).toArray().map((r) => this.view(r));
  }
}

/** What the agent that asked tells the owner, truthfully (addressed to them). */
export function effectSay(r: EffectResult): string {
  switch (r.status) {
    case 'done':
      return `${r.existing ? 'That email already went out' : 'Sent'} to ${r.receipt.target}${r.test ? ` (the test mailbox: nothing left ${BRAND.name})` : ''}, receipt ${r.receipt.receiptId}.`;
    case 'awaiting':
      return "It's waiting for your OK in the Inbox; nothing has been sent yet.";
    case 'pending':
      return "It's going out now; I'll have the receipt in a moment.";
    case 'held':
      return "Everyone stop is on, so it's held until you resume; nothing was sent.";
    case 'declined':
      return 'You said not to send that one, so it has not gone out.';
    case 'failed':
      return `It could not be sent: ${r.note} Nothing went out.`;
    case 'unknown':
      return "I can't confirm it went out, so I've asked you whether to send it again.";
  }
}

/** What the model is told to do with the result (not said to the owner). */
export function effectGuidance(r: EffectResult): string {
  if (r.status === 'done') return 'Tell the owner it was sent, with the receipt id.';
  if (r.status === 'failed') return 'Fix what the error says and try again, or tell the owner plainly.';
  return 'Do not say it was sent: tell the owner where it stands, as in "say".';
}

export const clipSubject = (s: string) => clip(s, 80);
