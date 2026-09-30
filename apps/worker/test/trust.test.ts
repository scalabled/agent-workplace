// Inc 6 · trust and real actions: the autonomy dial (only the levels a kind of action allows), emails that go out
// exactly once with a receipt (the owner's OK, grants that reach further, reconciling after a crash, Everyone stop
// holding them), a coworker proposing a change to how they work, the audit trail with Undo, and the honesty filter.
import { ids, parseFrame, type Frame } from '@headcount/protocol';
import type { Decision } from '@headcount/protocol/ext/projects';
import type { AuditEntry, TrustResponse } from '@headcount/protocol/ext/trust';
import { describe, expect, it } from 'vitest';
import { handle } from '../src/index';
import type { ProjectDO } from '../src/jobs/project-do';
import { claimsSent, ReceiptGuard } from '../src/trust/email-tool';
import { effectKey, normalizeEmail, type EffectResult } from '../src/trust/effects';
import { MailRefused, MailUnavailable, resendSender, RESEND_IDEMPOTENCY_MS } from '../src/trust/mail';
import { grantCovers } from '../src/trust/store';
import type { Env } from '../src/env';
import type { WorkspaceDO } from '../src/workspace/workspace-do';
import { createTestEnv } from './fake-cloud';

async function setup(overrides: Partial<Env> = { MAIL_PROVIDER: 'sink' }) {
  const t = await createTestEnv(overrides);
  const ws = t.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
  const project = t.namespaces.PROJECT.getByName('p:everyday:local') as ProjectDO;
  const sql = t.namespaces.PROJECT.state('p:everyday:local').storage.sql;
  t.namespaces.WORKSPACE.state('ws:local').getWebSockets = () => [{ send: (m: string) => void parseFrame(m) } as unknown as WebSocket];
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await handle(new Request(`http://localhost${path}`, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }), t.env, t.ctx);
    return { status: res.status, body: (await res.json()) as any };
  };
  const frames = async () => ws.frames(0, 5000);
  const lastFrom = async (agentId: string) => (await frames()).filter((f): f is Extract<Frame, { type: 'talk.message' }> => f.type === 'talk.message' && f.data.agentId === agentId).at(-1)?.data;
  const talk = async (text: string) => {
    await api('POST', '/api/talk', { text, opId: ids.op() });
    await t.ctx.drain();
    return lastFrom('cw_chief');
  };
  const desk = async (personaId: string, text: string) => {
    await api('POST', `/api/desk/${personaId}/say`, { text, opId: ids.op() });
    await t.ctx.drain();
    return lastFrom(`cw_${personaId}`);
  };
  const open = async (kind: Decision['kind']) => ((await project.openDecisions()) as Decision[]).filter((d) => d.kind === kind);
  const mailbox = async () => (await api('GET', '/api/email/test-mailbox')).body.messages as { to: string[]; subject: string; text: string }[];
  const audit = async (kind?: string) => (await api('GET', `/api/audit${kind ? `?kind=${kind}` : ''}`)).body.entries as AuditEntry[];
  const request = (email: { to: string[]; subject: string; text: string }, opts: { scope?: string; taskId?: string; projectId?: string; agentId?: string } = {}) =>
    project.requestEffect({ agentId: opts.agentId ?? 'cw_chief', agentName: 'Eddie', taskId: opts.taskId ?? 'turn:t1', scope: opts.scope ?? 'talk:t1', email, ...(opts.projectId ? { projectId: opts.projectId } : {}) }) as unknown as Promise<EffectResult>;
  await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
  return { t, ws, project, sql, api, frames, talk, desk, open, mailbox, audit, request };
}

const note = { to: ['jo@example.com'], subject: 'The spring menu', text: 'Hello Jo,\n\nOur spring menu starts Monday.\n\nEddie' };

describe('the autonomy dial', () => {
  it('safe defaults, only the levels each kind allows, changes in the audit log with Undo', async () => {
    const s = await setup();
    const trust = (await s.api('GET', '/api/trust')).body as TrustResponse;
    expect(trust.policy).toMatchObject({ external_send: 'ask', app_write: 'propose', workspace: 'act_report' });
    expect(trust.email).toMatchObject({ provider: 'sink', ready: true });
    expect(trust.stopped).toBeNull();
    // Sending email can never act on its own; research cannot be changed.
    expect((await s.api('PUT', '/api/trust/autonomy', { actionClass: 'external_send', level: 'act_report' })).status).toBe(400);
    expect((await s.api('PUT', '/api/trust/autonomy', { actionClass: 'research', level: 'ask' })).status).toBe(400);
    expect((await s.api('PUT', '/api/trust/autonomy', { actionClass: 'external_send', level: 'propose' })).body.policy.external_send).toBe('propose');
    const [entry] = await s.audit('autonomy');
    expect(entry).toMatchObject({ action: 'autonomy.changed', summary: 'Sending email: ask → propose', undo: { can: true } });
    expect((await s.api('POST', `/api/audit/${entry!.auditId}/undo`)).status).toBe(200);
    expect((await s.api('GET', '/api/trust')).body.policy.external_send).toBe('ask');
    expect((await s.api('POST', `/api/audit/${entry!.auditId}/undo`)).status).toBe(409);
  });

  it('email off: nobody is offered send_email', async () => {
    const s = await setup({});
    expect((await s.api('GET', '/api/trust')).body.email).toMatchObject({ provider: 'none', ready: false });
    const view = (await s.api('GET', '/api/chief/prompt')).body as { tools: { name: string }[] };
    expect(view.tools.map((t) => t.name)).not.toContain('send_email');
  });
});

describe('email, exactly once', () => {
  it('the Chief asks; the owner approves (for 24 hours); it goes out once with a receipt and a disclosure line', async () => {
    const s = await setup();
    const reply = await s.talk('Email jo@example.com about the spring menu');
    expect(reply?.text).toMatch(/waiting for your OK in the Inbox; nothing has been sent yet/);
    expect(reply?.text).not.toMatch(/\bI('ve| have)? sent\b/);
    expect(await s.mailbox()).toEqual([]);
    const [d] = await s.open('effect');
    expect(d!.effect).toMatchObject({ allowedGrants: ['once', 'day'], emails: [{ to: ['jo@example.com'], subject: 'The spring menu' }] });
    // A grant the decision does not offer is refused (no silent mismatch).
    expect((await s.api('POST', `/api/decisions/${d!.decisionId}`, { action: 'approve', grant: 'project' })).status).toBe(400);
    expect((await s.api('POST', `/api/decisions/${d!.decisionId}`, { action: 'approve', grant: 'day' })).status).toBe(202);
    await s.t.ctx.drain();
    const box = await s.mailbox();
    expect(box).toHaveLength(1);
    expect(box[0]!.text).toContain('Sent by Eddie, an AI coworker');
    const done = (await s.frames()).filter((f) => f.type === 'effect.updated').at(-1);
    expect(done?.type === 'effect.updated' && done.data.effect).toMatchObject({ status: 'done', receipt: { action: 'email.send', target: 'jo@example.com', provider: 'sink', undo: 'No undo: an email cannot be recalled.' } });
    // The grant covers the next email in the next 24 hours: out at once, no card.
    const again = await s.talk('Email sam@example.com about opening hours');
    expect(again?.text).toMatch(/^Sent to sam@example\.com \(the test mailbox: nothing left Headcount\), receipt rcp_[a-f0-9]+\.$/);
    expect(await s.mailbox()).toHaveLength(2);
    expect(await s.open('effect')).toEqual([]);
    // The trail: asked, the grant (Undo takes it back), sent with its receipt (no undo).
    const log = await s.audit();
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(['email.asked', 'grant.created', 'email.sent']));
    expect(log.find((e) => e.action === 'email.sent')).toMatchObject({ receipt: { receiptId: expect.stringMatching(/^rcp_/) }, undo: { can: false, label: 'No undo: an email cannot be recalled.' } });
    const grant = log.find((e) => e.action === 'grant.created')!;
    expect(grant.undo).toMatchObject({ can: true });
    expect((await s.api('POST', `/api/audit/${grant.auditId}/undo`)).status).toBe(200);
    expect((await s.api('GET', '/api/trust')).body.grants).toEqual([]);
  });

  it('the same email asked twice is one effect; a declined one never goes out', async () => {
    const s = await setup();
    const a = await s.request(note);
    expect(a.status).toBe('awaiting');
    expect(await s.request(note)).toMatchObject({ status: 'awaiting', key: a.key });
    const [d] = await s.open('effect');
    expect(d!.effect!.keys).toEqual([a.key]);
    await s.api('POST', `/api/decisions/${d!.decisionId}`, { action: 'approve' });
    const first = await s.request(note);
    expect(first).toMatchObject({ status: 'done', existing: true });
    expect(await s.mailbox()).toHaveLength(1);
    // Declined.
    const b = await s.request({ ...note, subject: 'Prices are going up' }, { scope: 'talk:t2', taskId: 'turn:t2' });
    const d2 = (await s.open('effect')).find((x) => x.effect!.keys.includes(b.key))!;
    await s.api('POST', `/api/decisions/${d2.decisionId}`, { action: 'decline' });
    expect(await s.request({ ...note, subject: 'Prices are going up' }, { scope: 'talk:t2', taskId: 'turn:t2' })).toMatchObject({ status: 'declined' });
    expect(await s.mailbox()).toHaveLength(1);
  });

  it('a task’s emails wait on one card; “for the rest of this task” sends them and the next; never outside the project', async () => {
    const s = await setup();
    const task = { taskId: 'prj_1:s1', projectId: 'prj_1', scope: 'prj_1', agentId: 'cw_bookkeeper' };
    const r1 = await s.request({ ...note, to: ['a@example.com'] }, task);
    const r2 = await s.request({ ...note, to: ['b@example.com'] }, task);
    expect([r1.status, r2.status]).toEqual(['awaiting', 'awaiting']);
    const cards = await s.open('effect');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.effect).toMatchObject({ allowedGrants: ['once', 'task', 'project', 'day'], keys: [r1.key, r2.key] });
    expect(cards[0]!.title).toMatch(/wants to send 2 emails/);
    await s.api('POST', `/api/decisions/${cards[0]!.decisionId}`, { action: 'approve', grant: 'task' });
    expect(await s.mailbox()).toHaveLength(2);
    expect(await s.request({ ...note, to: ['c@example.com'] }, task)).toMatchObject({ status: 'done' });
    // Another task, and no project at all: the task grant does not reach them.
    expect(await s.request({ ...note, to: ['d@example.com'] }, { ...task, taskId: 'prj_1:s2' })).toMatchObject({ status: 'awaiting' });
    expect(await s.request({ ...note, to: ['e@example.com'] }, { taskId: 'turn:x', scope: 'talk:x', agentId: 'cw_bookkeeper' })).toMatchObject({ status: 'awaiting' });
    expect(await s.mailbox()).toHaveLength(3);
  });

  it('bad addresses come back to the agent to fix, never sent', async () => {
    expect(() => normalizeEmail({ to: ['jo at example'], subject: 's', text: 'hi there' })).toThrow(/Not an email address/);
    expect(() => normalizeEmail({ to: [], subject: 's', text: 'hi there' })).toThrow(/who it goes to/);
    expect(normalizeEmail({ to: ['Jo <JO@Example.com>'], cc: ['jo@example.com', 'x@y.co'], subject: '  Hi  there ', text: 'Body' })).toEqual({ to: ['jo@example.com'], cc: ['x@y.co'], subject: 'Hi there', text: 'Body' });
    const s = await setup();
    expect(await s.project.requestEffect({ agentId: 'cw_chief', agentName: 'Eddie', taskId: 't', scope: 't', email: { to: ['nope'], subject: 'x', text: 'hello' } })).toMatchObject({ status: 'invalid' });
  });
});

describe('after a crash: reconcile, never blindly replay', () => {
  const pending = async (s: Awaited<ReturnType<typeof setup>>, email = note, firstAttemptAgo = 60_000) => {
    const key = await effectKey('talk:crash', normalizeEmail(email));
    const old = new Date(Date.now() - firstAttemptAgo).toISOString();
    s.sql.exec(
      `INSERT INTO effects (key, tool, action_class, agent_id, agent_name, project_id, task_id, email, status, approved_by, attempts, first_attempt_at, created_at, updated_at)
       VALUES (?, 'email.send', 'external_send', 'cw_chief', 'Eddie', '', 'turn:crash', ?, 'pending', 'owner:owner', 1, ?, ?, ?)`,
      key, JSON.stringify(normalizeEmail(email)), Date.now() - firstAttemptAgo, old, old,
    );
    return key;
  };

  it('it went out before the crash: receipted, not sent again', async () => {
    const s = await setup();
    const key = await pending(s);
    s.sql.exec(`CREATE TABLE IF NOT EXISTS mail_sink (key TEXT PRIMARY KEY, provider_id TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL)`);
    s.sql.exec(`INSERT INTO mail_sink (key, provider_id, message, at) VALUES (?, 'sink_1', ?, ?)`, key, JSON.stringify({ ...note, from: 'x' }), new Date().toISOString());
    await s.project.alarm();
    expect(await s.mailbox()).toHaveLength(1);
    const row = s.sql.exec<{ status: string; receipt: string; note: string }>('SELECT status, receipt, note FROM effects WHERE key = ?', key).toArray()[0]!;
    expect(row.status).toBe('done');
    expect(JSON.parse(row.receipt)).toMatchObject({ providerId: 'sink_1' });
    expect(row.note).toMatch(/after a restart/);
  });

  it('provably not sent: sent once with the same key', async () => {
    const s = await setup();
    const key = await pending(s);
    await s.project.alarm();
    await s.project.alarm();
    expect(await s.mailbox()).toHaveLength(1);
    expect(s.sql.exec<{ status: string }>('SELECT status FROM effects WHERE key = ?', key).toArray()[0]!.status).toBe('done');
  });

  it('nobody can tell (past the provider’s idempotency window): the owner decides', async () => {
    const s = await setup({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test', MAIL_FROM: 'Eddie <office@example.com>' });
    const key = await pending(s, note, RESEND_IDEMPOTENCY_MS + 3600_000);
    await s.project.alarm();
    expect(s.sql.exec<{ status: string }>('SELECT status FROM effects WHERE key = ?', key).toArray()[0]!.status).toBe('unknown');
    const [d] = await s.open('effect');
    expect(d!.title).toMatch(/Send again\?/);
    expect(d!.effect).toMatchObject({ unknown: true, allowedGrants: ['once'] });
  });
});

describe('Everyone stop holds emails', () => {
  it('held while stopped; resuming asks for the ones without an OK and sends the ones with one', async () => {
    const s = await setup();
    // One approved before the stop, waiting on nothing; one asked during it.
    await s.api('POST', '/api/stop-all');
    expect((await s.api('GET', '/api/trust')).body.stopped).toMatchObject({ by: 'owner' });
    expect(await s.request(note)).toMatchObject({ status: 'held' });
    expect(await s.mailbox()).toEqual([]);
    expect((await s.api('POST', '/api/resume-all')).body).toEqual({ resumed: true });
    expect((await s.api('GET', '/api/trust')).body.stopped).toBeNull();
    const [d] = await s.open('effect');
    expect(d!.effect!.emails[0]).toMatchObject({ to: ['jo@example.com'] });
    await s.api('POST', `/api/decisions/${d!.decisionId}`, { action: 'approve' });
    expect(await s.mailbox()).toHaveLength(1);
    expect((await s.audit('stop')).map((e) => e.action)).toEqual(['stop.resumed', 'stop.on']);
  });
});

describe('a coworker changes how they work, with the owner’s OK', () => {
  it('proposed from their desk, applied on approval, undone from the audit log', async () => {
    const s = await setup();
    const reply = await s.desk('bookkeeper', 'From now on, always give me prices with VAT included in your summaries.');
    expect(reply?.text).toMatch(/takes effect once you OK it/);
    const [d] = await s.open('change');
    expect(d!.change).toMatchObject({ change: 'instructions', target: 'bookkeeper' });
    expect(d!.change!.after).toContain('always give me prices with VAT included');
    // Never granted ahead: only this change.
    expect((await s.api('POST', `/api/decisions/${d!.decisionId}`, { action: 'approve' })).status).toBe(202);
    const view = (await s.api('GET', '/api/agents/bookkeeper')).body as { instructions: string };
    expect(view.instructions).toContain('VAT included');
    const [entry] = await s.audit('change');
    expect(entry).toMatchObject({ action: 'instructions.changed', undo: { can: true, label: 'Restore their previous instructions' } });
    expect((await s.api('POST', `/api/audit/${entry!.auditId}/undo`)).status).toBe(200);
    expect(((await s.api('GET', '/api/agents/bookkeeper')).body as { instructions: string }).instructions).not.toContain('VAT included');
  });

  it('what the Chief remembers is in the audit log, and Undo forgets it', async () => {
    const s = await setup();
    await s.talk('Remember that we close early on Sundays.');
    await s.t.ctx.drain();
    const entry = (await s.audit('change')).find((e) => e.action === 'memory.saved')!;
    expect(entry.summary).toContain('close early on Sundays');
    const memoryId = /at=(mem_[a-z0-9]+)/.exec(entry.link ?? '')?.[1];
    expect(memoryId).toBeTruthy();
    expect((await s.api('GET', `/api/memory/${memoryId}`)).status).toBe(200);
    expect((await s.api('POST', `/api/audit/${entry.auditId}/undo`)).status).toBe(200);
    expect((await s.api('GET', `/api/memory/${memoryId}`)).status).toBe(404);
  });
});

describe('honesty and the pieces', () => {
  it('no "sent" without a receipt', () => {
    expect(claimsSent("I've sent the email to Jo.")).toBe(true);
    expect(claimsSent('The email was sent this morning.')).toBe(true);
    expect(claimsSent("I haven't sent it yet.")).toBe(false);
    expect(claimsSent('It will go out once you OK it.')).toBe(false);
    expect(claimsSent('Sent to Jo, receipt rcp_1a2b3c.')).toBe(false);
    let receipts = 0;
    const g = new ReceiptGuard(() => receipts);
    expect(g.push("Done! I've sent it to Jo. Anything else? ") + g.flush()).toBe('Done! Nothing has been sent yet: there is no receipt for it. Anything else? ');
    receipts = 1;
    expect(g.push("I've sent it to Jo. ") + g.flush()).toBe("I've sent it to Jo. ");
  });

  it('grants never reach past their scope', () => {
    const now = Date.now();
    const base = { grantId: 'g', actionClass: 'external_send' as const, tool: 'email.send', subject: 'cw_a', createdAt: '', createdBy: 'o', uses: 0 };
    expect(grantCovers({ ...base, kind: 'task', taskId: 'p1:s1', projectId: 'p1' }, { tool: 'email.send', subject: 'cw_a', taskId: 'p1:s1', projectId: 'p1', now })).toBe(true);
    expect(grantCovers({ ...base, kind: 'task', taskId: 'p1:s1', projectId: 'p1' }, { tool: 'email.send', subject: 'cw_a', taskId: 'p1:s1', now })).toBe(false);
    expect(grantCovers({ ...base, kind: 'project', projectId: 'p1' }, { tool: 'email.send', subject: 'cw_a', now })).toBe(false);
    expect(grantCovers({ ...base, kind: 'project', projectId: 'p1' }, { tool: 'email.send', subject: 'cw_b', projectId: 'p1', now })).toBe(false);
    expect(grantCovers({ ...base, kind: 'day', expiresAt: new Date(now - 1).toISOString() }, { tool: 'email.send', subject: 'cw_a', now })).toBe(false);
  });

  it('Resend: the effect key is the idempotency key; refusals and outages are told apart', async () => {
    const seen: { headers: Headers; body: Record<string, unknown> }[] = [];
    let status = 200;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen.push({ headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return new Response(JSON.stringify(status === 200 ? { id: 're_123' } : { message: 'The domain is not verified' }), { status });
    }) as unknown as typeof fetch;
    const r = resendSender({ RESEND_API_KEY: 're_key' } as Env, fetchFn);
    const mail = { from: 'Eddie <office@example.com>', to: ['jo@example.com'], subject: 'Hi', text: 'Hello' };
    expect(await r.send('eff_abc', mail)).toEqual({ providerId: 're_123' });
    expect(seen[0]!.headers.get('idempotency-key')).toBe('eff_abc');
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer re_key');
    expect(seen[0]!.body).toMatchObject({ from: mail.from, to: mail.to, subject: 'Hi', text: 'Hello', tags: [{ name: 'headcount_effect', value: 'eff_abc' }] });
    status = 422;
    await expect(r.send('eff_abc', mail)).rejects.toBeInstanceOf(MailRefused);
    status = 503;
    await expect(r.send('eff_abc', mail)).rejects.toBeInstanceOf(MailUnavailable);
    expect(await r.reconcile('eff_abc', 0, 3600_000)).toEqual({ status: 'safe_retry' });
    expect(await r.reconcile('eff_abc', 0, RESEND_IDEMPOTENCY_MS + 1)).toEqual({ status: 'unknown' });
  });
});
