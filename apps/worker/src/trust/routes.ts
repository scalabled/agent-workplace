// Inc 6 trust routes (packages/protocol/src/ext/trust.ts): the autonomy dial and grants (Admin → Autonomy), the audit
// trail with Undo (Admin → Audit log), resuming after Everyone stop, and email's test mailbox and test send.
import { ACTION_CLASSES, type ActionClass, type AuditKind, type AuditResponse, type Autonomy, type EffectView, type PutAutonomyRequest, type StopState, type TestMailbox, type TrustResponse } from '@headcount/protocol/ext/trust';
import { HttpError, json, readJson, type RouteContext, type RouteHandler } from '../lib/http';
import { projectStub, workspaceStub } from '../lib/stubs';
import { runtime } from '../workspace/runtime';
import type { EffectResult } from './effects';
import { isEmailAddress, mailStatus } from './mail';
import { activeGrants, audit, auditRow, listAudit, loadPolicy, markUndone, revokeGrant, setAutonomy, TrustError, wsOf, type UndoSpec } from './store';

const AUDIT_KINDS: readonly AuditKind[] = ['email', 'decision', 'grant', 'change', 'autonomy', 'stop', 'app', 'undo'];

/** Who did it, for the audit trail: the signed-in owner's email, or "owner" on this computer. */
export const whoOf = (rc: Pick<RouteContext, 'identity'>): string => rc.identity?.email || 'owner';

function trustFail(err: unknown): never {
  if (err instanceof TrustError) throw new HttpError(err.code, err.message);
  throw err;
}

/** GET /api/trust: the dial, grants in force, email's state, Everyone stop, and emails waiting or held. */
export const handleGetTrust: RouteHandler = async (_req, { env }) => {
  const ws = wsOf(env);
  const now = runtime.now();
  const [policy, grants, state] = await Promise.all([
    loadPolicy(env.DB, ws),
    activeGrants(env.DB, ws, now),
    (projectStub(env).trustState() as unknown as Promise<{ effects: EffectView[]; stopped: StopState | null }>).catch(() => ({ effects: [], stopped: null })),
  ]);
  return json<TrustResponse>({ policy, classes: ACTION_CLASSES, grants, email: mailStatus(env), stopped: state.stopped, effects: state.effects });
};

/** PUT /api/trust/autonomy {actionClass, level} (owners). */
export const handlePutAutonomy: RouteHandler = async (req, rc) => {
  const body = await readJson<Partial<PutAutonomyRequest>>(req);
  if (!body || typeof body.actionClass !== 'string' || typeof body.level !== 'string') throw new HttpError('bad_request', 'Say which kind of action, and its level.');
  const ws = wsOf(rc.env);
  const by = whoOf(rc);
  const r = await setAutonomy(rc.env.DB, ws, body.actionClass as ActionClass, body.level as Autonomy, by).catch(trustFail);
  const info = ACTION_CLASSES.find((c) => c.id === body.actionClass)!;
  if (r.before !== body.level)
    await audit(rc.env.DB, ws, {
      actor: `owner:${by}`,
      kind: 'autonomy',
      action: 'autonomy.changed',
      summary: `${info.label}: ${r.before} → ${body.level}`,
      link: '/app/admin/autonomy',
      undo: { type: 'autonomy.restore', actionClass: info.id, before: r.before, label: `Back to ${r.before}` },
    });
  return json({ policy: r.policy });
};

/** DELETE /api/trust/grants/:id (owners): take a permission back. */
export const handleRevokeGrant: RouteHandler = async (_req, rc) => {
  const ws = wsOf(rc.env);
  const g = await revokeGrant(rc.env.DB, ws, rc.params.id ?? '');
  if (!g) throw new HttpError('not_found', 'That permission is not in force.');
  await audit(rc.env.DB, ws, { actor: `owner:${whoOf(rc)}`, kind: 'grant', action: 'grant.revoked', summary: `Took back: ${g.note ?? `${g.tool} (${g.kind})`}`, link: '/app/admin/autonomy', undo: { type: 'none', label: 'Grant it again from the next approval' } });
  return json({ revoked: true });
};

/** GET /api/audit?before=&kind= (owners). */
export const handleListAudit: RouteHandler = async (_req, { env, url }) => {
  const kind = url.searchParams.get('kind');
  if (kind && !AUDIT_KINDS.includes(kind as AuditKind)) throw new HttpError('bad_request', `Filter by one of: ${AUDIT_KINDS.join(', ')}.`);
  const before = url.searchParams.get('before');
  if (before && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|aud_[a-f0-9]{20}$/.test(before)) throw new HttpError('bad_request', 'That page marker is not valid.');
  return json<AuditResponse>(await listAudit(env.DB, wsOf(env), { ...(kind ? { kind: kind as AuditKind } : {}), ...(before ? { before } : {}) }));
};

/** POST /api/audit/:id/undo (owners): run the entry's Undo once, and record it. */
export const handleUndoAudit: RouteHandler = async (_req, rc) => {
  const { env } = rc;
  const ws = wsOf(env);
  const found = await auditRow(env.DB, ws, rc.params.id ?? '');
  if (!found) throw new HttpError('not_found', 'No such entry in the audit log.');
  if (found.undone) throw new HttpError('conflict', 'That was already undone.');
  const u = found.undo;
  if (!u || u.type === 'none') throw new HttpError('conflict', u?.label ?? 'That cannot be undone.');
  const by = whoOf(rc);
  const r = await runUndo(rc, u);
  if (!r.ok) throw new HttpError('conflict', r.message);
  if (!(await markUndone(env.DB, ws, found.entry.auditId, by))) throw new HttpError('conflict', 'That was already undone.');
  await audit(env.DB, ws, { actor: `owner:${by}`, kind: 'undo', action: 'undo', summary: `Undid: ${found.entry.summary}`, ...(found.entry.link ? { link: found.entry.link } : {}) });
  return json({ undone: true });
};

async function runUndo(rc: RouteContext, u: UndoSpec): Promise<{ ok: true } | { ok: false; message: string }> {
  const { env } = rc;
  switch (u.type) {
    case 'grant.revoke':
      return (await revokeGrant(env.DB, wsOf(env), u.grantId)) ? { ok: true } : { ok: false, message: 'That permission was already taken back.' };
    case 'autonomy.restore':
      try {
        await setAutonomy(env.DB, wsOf(env), u.actionClass, u.before, whoOf(rc));
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'It could not be changed back.' };
      }
    case 'automation.remove': {
      const r = (await projectStub(env).removeAutomation(u.automationId)) as unknown as { removed: boolean };
      return r.removed ? { ok: true } : { ok: false, message: 'That automation is already gone.' };
    }
    case 'handbook.restore':
    case 'memory.forget':
    case 'instructions.restore':
      return (await workspaceStub(env).undoChange(u)) as unknown as { ok: true } | { ok: false; message: string };
    default:
      return { ok: false, message: 'That cannot be undone.' };
  }
}

/** POST /api/resume-all (owners): Everyone stop ends; held emails with an OK go out. */
export const handleResumeAll: RouteHandler = async (_req, rc) => json(await projectStub(rc.env).resumeAll(whoOf(rc)));

/** GET /api/email/test-mailbox (owners): what went to the test mailbox. */
export const handleTestMailbox: RouteHandler = async (_req, { env }) => {
  if (mailStatus(env).provider !== 'sink') return json<TestMailbox>({ messages: [] });
  return json<TestMailbox>((await projectStub(env).testMailbox()) as unknown as TestMailbox);
};

/** POST /api/email/test {to?} (owners): a test email to yourself, to check the setup. */
export const handleTestEmail: RouteHandler = async (req, rc) => {
  const status = mailStatus(rc.env);
  if (!status.ready) throw new HttpError('not_configured', status.why ?? 'Email is not set up.');
  const body = (await readJson<{ to?: string }>(req).catch(() => ({}))) as { to?: string };
  const to = (body.to ?? rc.identity?.email ?? '').trim();
  if (!to || !isEmailAddress(to)) throw new HttpError('bad_request', 'Say which address to send the test to.');
  const r = (await projectStub(rc.env).sendTestEmail(to, whoOf(rc))) as unknown as EffectResult | { status: 'invalid'; message: string };
  if (r.status === 'invalid') throw new HttpError('bad_request', r.message);
  if (r.status === 'failed') throw new HttpError('conflict', r.note);
  return json({ result: r });
};
