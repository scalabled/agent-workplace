// Admin: settings changed on the admin page reach the Durable Objects; people and roles (owner, contributor, reader)
// gate every route, with "view as"; token usage is metered for every model call and reported with today's limits.
import { ids } from '@headcount/protocol';
import type { ConfigResponse, Me, MembersResponse, UsageResponse } from '@headcount/protocol/ext/admin';
import { describe, expect, it } from 'vitest';
import { hash } from '../src/auth/auth';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { d1Sink, flushUsage, usageReport } from '../src/usage/store';
import { createTestEnv } from './fake-cloud';

const HOST = 'https://hc.example.workers.dev';
const OWNER = 'owner@example.com';
const deployed: Partial<Env> = { ALLOWED_ORIGINS: HOST, APP_ORIGIN: HOST, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', OWNER_EMAILS: OWNER, CONNECTOR_SECRET: 'a-long-enough-connector-secret' };
type T = Awaited<ReturnType<typeof createTestEnv>>;

async function sessionFor(t: T, email: string, name = ''): Promise<string> {
  const token = `tok-${email}-${Math.random().toString(36).slice(2)}`;
  await t.env.DB.prepare('INSERT INTO auth_sessions (token_hash, email, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(await hash(token), email, name, Date.now(), Date.now() + 86_400_000).run();
  return token;
}

function client(t: T, base: string, cookie = '') {
  return async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { ...(base === HOST ? { origin: base } : {}), ...(cookie ? { cookie } : {}) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await handle(new Request(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), t.env, t.ctx);
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json, res };
  };
}

describe('settings from the admin page', () => {
  it('shows every option with its source, validates, and applies a change inside the Durable Objects', async () => {
    const t = await createTestEnv({ CONNECTOR_SECRET: 'a-long-enough-connector-secret' });
    const api = client(t, 'http://localhost');
    await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
    let view = (await api('GET', '/api/admin/config')).body as ConfigResponse;
    expect(view.canStoreKeys).toBe(true);
    expect(view.values.find((v) => v.key === 'CHAT_DAILY_LIMIT')).toEqual({ key: 'CHAT_DAILY_LIMIT', value: '1500', source: 'default' });
    expect(view.values.find((v) => v.key === 'DEFAULT_CHAT')).toMatchObject({ value: 'mock', source: 'deployment' });

    expect((await api('PUT', '/api/admin/config', { values: { CHAT_DAILY_LIMIT: 'lots' } })).status).toBe(400);
    expect((await api('PUT', '/api/admin/config', { values: { OWNER_EMAILS: 'me@example.com' } })).body.error.message).toMatch(/changes only with the deployment/);
    const saved = await api('PUT', '/api/admin/config', { values: { CHAT_DAILY_LIMIT: '1', OPENAI_API_KEY: 'sk-test-1234567890' } });
    expect(saved.status).toBe(200);
    view = saved.body as ConfigResponse;
    expect(view.values.find((v) => v.key === 'CHAT_DAILY_LIMIT')).toMatchObject({ value: '1', source: 'admin', updatedBy: 'owner' });
    expect(view.values.find((v) => v.key === 'OPENAI_API_KEY')).toMatchObject({ value: '', set: true, source: 'admin' });
    // The key is stored sealed, never in the clear.
    const row = await t.env.DB.prepare("SELECT value, sealed FROM settings_kv WHERE key = 'OPENAI_API_KEY'").first<{ value: string; sealed: number }>();
    expect(row).toMatchObject({ sealed: 1 });
    expect(row!.value).not.toContain('sk-test');

    // The WorkspaceDO counts replies against the new limit.
    expect((await api('POST', '/api/talk', { text: 'What should we focus on this week?', opId: ids.op() })).status).toBe(202);
    await t.ctx.drain();
    const second = await api('POST', '/api/talk', { text: 'Which supplier is cheapest for flour?', opId: ids.op() });
    expect(second.status).toBe(429);
    expect(second.body.error.message).toMatch(/Admin → Settings \(CHAT_DAILY_LIMIT\)/);
    // Back to the default.
    view = (await api('PUT', '/api/admin/config', { values: { CHAT_DAILY_LIMIT: null, OPENAI_API_KEY: null } })).body as ConfigResponse;
    expect(view.values.find((v) => v.key === 'CHAT_DAILY_LIMIT')).toMatchObject({ value: '1500', source: 'default' });
    expect(view.values.find((v) => v.key === 'OPENAI_API_KEY')).toMatchObject({ set: false });
  });
});

describe('people and roles', () => {
  it('owners invite contributors and readers; each route asks for the role it needs', async () => {
    const t = await createTestEnv(deployed);
    const owner = client(t, HOST, `hc_session=${await sessionFor(t, OWNER, 'Olive')}`);
    expect(((await owner('GET', '/api/auth/me')).body as Me)).toMatchObject({ signedIn: true, email: OWNER, role: 'owner' });
    await owner('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });

    // Not a member yet: no way in.
    const stranger = client(t, HOST, `hc_session=${await sessionFor(t, 'sam@example.com')}`);
    expect((await stranger('GET', '/api/projects')).status).toBe(401);

    let list = (await owner('PUT', `/api/admin/members/${encodeURIComponent('Sam@Example.com')}`, { role: 'contributor', name: 'Sam' })).body as MembersResponse;
    list = (await owner('PUT', `/api/admin/members/${encodeURIComponent('rita@example.com')}`, { role: 'reader' })).body as MembersResponse;
    expect(list.signIn).toBe(true);
    expect(list.members.map((m) => [m.email, m.role, m.source])).toEqual([
      [OWNER, 'owner', 'deployment'],
      ['sam@example.com', 'contributor', 'invited'],
      ['rita@example.com', 'reader', 'invited'],
    ]);
    expect((await owner('PUT', `/api/admin/members/${encodeURIComponent(OWNER)}`, { role: 'reader' })).status).toBe(409);

    const sam = stranger;
    expect((await sam('GET', '/api/projects')).status).toBe(200);
    expect((await sam('POST', '/api/talk', { text: 'hello', opId: ids.op() })).status).toBe(202);
    const samAdmin = await sam('GET', '/api/admin/config');
    expect(samAdmin.status).toBe(403);
    expect(samAdmin.body.error.message).toMatch(/Only an owner/);

    const rita = client(t, HOST, `hc_session=${await sessionFor(t, 'rita@example.com', 'Rita')}`);
    expect((await rita('GET', '/api/auth/me')).body).toMatchObject({ email: 'rita@example.com', role: 'reader' });
    expect((await rita('GET', '/api/handbook')).status).toBe(200);
    const denied = await rita('POST', '/api/talk', { text: 'hello', opId: ids.op() });
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toMatch(/Readers can see everything/);
    expect((await rita('PUT', '/api/handbook/rules', { content: 'x' })).status).toBe(403);

    // Removing a member signs them out everywhere.
    await owner('DELETE', `/api/admin/members/${encodeURIComponent('rita@example.com')}`);
    expect((await rita('GET', '/api/handbook')).status).toBe(401);
  });

  it('view as: an owner previews a lower role, and can never raise one', async () => {
    const t = await createTestEnv();
    const api = client(t, 'http://localhost');
    const set = await api('POST', '/api/auth/view-as', { role: 'reader' });
    const cookie = set.res.headers.getSetCookie()[0]!.split(';')[0]!;
    const asReader = client(t, 'http://localhost', cookie);
    expect((await asReader('GET', '/api/auth/me')).body).toEqual({ mode: 'off', signedIn: true, role: 'reader', actualRole: 'owner', org: { orgId: 'local', name: 'Agent Workplace' } });
    expect((await asReader('POST', '/api/talk', { text: 'hi', opId: ids.op() })).status).toBe(403);
    expect((await api('POST', '/api/auth/view-as', { role: 'owner' })).status).toBe(400);
  });
});

describe('token usage', () => {
  it('meters every model call by surface and coworker, with today’s limits', async () => {
    const t = await createTestEnv();
    const api = client(t, 'http://localhost');
    await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
    await api('POST', '/api/talk', { text: 'Our café is on Market Street and we open at 7am.', opId: ids.op() });
    await t.ctx.drain();
    const u = (await api('GET', '/api/admin/usage?days=7')).body as UsageResponse;
    expect(u.days).toBe(7);
    expect(u.byDay).toHaveLength(7);
    const talk = u.bySurface.find((r) => r.key === 'talk')!;
    expect(talk).toMatchObject({ label: 'Talk (Chief of Staff)', errors: 0, usd: 0 });
    expect(talk.calls).toBeGreaterThanOrEqual(1);
    expect(talk.input).toBeGreaterThan(0);
    expect(u.bySurface.map((r) => r.key)).toContain('memory'); // the turn was distilled
    expect(u.byAgent.find((r) => r.key === 'cw_chief')?.label).toBe('Eddie');
    expect(u.recent[0]).toMatchObject({ provider: 'mock', ok: true });
    expect(u.limits.find((l) => l.key === 'CHAT_DAILY_LIMIT')).toEqual({ key: 'CHAT_DAILY_LIMIT', label: 'Replies', used: 1, limit: 1500 });
  });

  it('prices what the provider did not, at the owner’s prices per million tokens', async () => {
    const t = await createTestEnv();
    const sink = d1Sink(t.env);
    const call = { at: Date.now(), surface: 'project' as const, agentId: 'cw_x', projectId: '', provider: 'openai', model: 'gpt-test', capability: 'chat' as const, input: 1_000_000, output: 500_000, cached: 200_000, usd: null, ms: 1200, firstMs: 300, ok: true };
    sink(call);
    sink({ ...call, ok: false, error: 'boom', input: 0, output: 0, cached: 0 });
    await flushUsage();
    const names = (id: string) => id;
    let r = await usageReport(t.env, 1, { names, limits: [] });
    expect(r.total).toMatchObject({ calls: 2, errors: 1, input: 1_000_000, output: 500_000, cached: 200_000, usd: null, priced: 0, avgMs: 1200, avgFirstMs: 300 });
    const api = client(t, 'http://localhost');
    expect((await api('PUT', '/api/admin/prices', { prices: [{ provider: 'openai', model: 'gpt-test', input: 2, output: 8, cached: 0.5 }] })).status).toBe(200);
    r = await usageReport(t.env, 1, { names, limits: [] });
    // 800k fresh × $2 + 200k cached × $0.50 + 500k out × $8 per million.
    expect(r.total.usd).toBe(1.6 + 0.1 + 4);
    expect(r.recent.find((c) => c.ok)?.usd).toBe(5.7);
    expect(r.byModel[0]!.label).toBe('gpt-test · openai');
  });
});
