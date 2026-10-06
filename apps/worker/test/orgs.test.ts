// Multi-tenant Headcount: anyone with a verified Google account signs in and starts an organization of their own; each
// organization's data lives apart (its own Durable Objects, rows and files); people invited to several organizations
// switch between them; sign-up can be invite-only or closed; the deployment's owners see every organization.
import { ids } from '@headcount/protocol';
import type { Me } from '@headcount/protocol/ext/admin';
import type { OrgsResponse, PlatformResponse } from '@headcount/protocol/ext/orgs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRoleCache, clearSessionCache } from '../src/auth/auth';
import { handle } from '../src/index';
import type { Env } from '../src/env';
import { createTestEnv } from './fake-cloud';

const HOST = 'https://hc.example.workers.dev';
const OWNER = 'owner@example.com';
const deployed: Partial<Env> = {
  ALLOWED_ORIGINS: HOST,
  APP_ORIGIN: HOST,
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  OWNER_EMAILS: OWNER,
};

type T = Awaited<ReturnType<typeof createTestEnv>>;

beforeEach(() => {
  clearSessionCache();
  clearRoleCache();
});
afterEach(() => vi.unstubAllGlobals());

const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1).split(';')[0] ?? null;

/** Sign in as this Google account; returns a client that carries its session. */
async function signIn(t: T, email: string, name = email.split('@')[0]!) {
  const start = await handle(new Request(`${HOST}/api/auth/google?return=/app`, { headers: { 'sec-fetch-site': 'none' } }), t.env, t.ctx);
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'at' });
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ sub: `g-${email}`, email, email_verified: true, name });
    return new Response('unexpected', { status: 500 });
  });
  const cb = await handle(new Request(`${HOST}/api/auth/callback?state=${encodeURIComponent(state)}&code=c`, { headers: { cookie: `hc_oauth=${cookieOf(start, 'hc_oauth')}`, 'sec-fetch-site': 'cross-site' } }), t.env, t.ctx);
  vi.unstubAllGlobals();
  const session = cookieOf(cb, 'hc_session');
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await handle(
      new Request(`${HOST}${path}`, { method, headers: { origin: HOST, ...(session ? { cookie: `hc_session=${session}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
      t.env,
      t.ctx,
    );
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  return { cb, session, api };
}

describe('organizations', () => {
  it('a stranger signs in, starts an organization, and works in their own office', async () => {
    const t = await createTestEnv(deployed);
    const dana = await signIn(t, 'dana@cafe.example', 'Dana');
    expect(dana.cb.headers.get('location')).toBe(`${HOST}/app`);
    // In no organization yet: the app asks them to start one; the office's routes are closed to them.
    expect((await dana.api('GET', '/api/auth/me')).body).toMatchObject({ signedIn: true, email: 'dana@cafe.example', needsOrg: true, canCreateOrg: true });
    expect((await dana.api('GET', '/api/workspace')).status).toBe(401);
    expect((await dana.api('POST', '/api/orgs', { name: '' })).status).toBe(400);
    const made = await dana.api('POST', '/api/orgs', { name: 'Harbor Café' });
    expect(made.status).toBe(201);
    const orgId = made.body.org.orgId as string;
    expect(orgId).toMatch(/^org_[a-z0-9]{12}$/);
    const me = (await dana.api('GET', '/api/auth/me')).body as Me;
    expect(me).toMatchObject({ role: 'owner', org: { orgId, name: 'Harbor Café' } });
    expect(me.needsOrg).toBeUndefined();
    // Their own office: its own WorkspaceDO (ws:<org>), settings and a fresh start.
    const ws = (await dana.api('GET', '/api/workspace')).body;
    expect(ws).toMatchObject({ workspaceId: orgId, leadId: null });
    expect(t.namespaces.WORKSPACE.state(`ws:${orgId}`)).toBeTruthy();
    expect((await dana.api('GET', '/api/orgs')).body as OrgsResponse).toMatchObject({ current: orgId, orgs: [{ orgId, name: 'Harbor Café', role: 'owner' }] });
  });

  it('each organization’s data lives apart: memory, files, Handbook, decisions, the audit log', async () => {
    const t = await createTestEnv(deployed);
    const owner = await signIn(t, OWNER, 'Olive');
    const dana = await signIn(t, 'dana@cafe.example', 'Dana');
    const danaOrg = (await dana.api('POST', '/api/orgs', { name: 'Harbor Café' })).body.org.orgId as string;
    // The owner's office (the home organization) has things in it.
    await owner.api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
    expect((await owner.api('POST', '/api/memory', { text: 'Our wholesale price for sourdough is 3.10', kind: 'fact' })).status).toBe(201);
    await owner.api('PUT', '/api/handbook/business', { content: 'A bakery in Leeds.' });
    await owner.api('PUT', '/api/trust/autonomy', { actionClass: 'external_send', level: 'propose' });
    await owner.api('POST', '/api/talk', { text: 'Put together a team to launch our spring menu', opId: ids.op() });
    await t.ctx.drain();
    // Dana sees none of it.
    expect(((await dana.api('GET', '/api/memory')).body.memories as unknown[]).length).toBe(0);
    expect(((await dana.api('GET', '/api/handbook')).body.sections as { content: string }[]).every((s) => !s.content)).toBe(true);
    expect((await dana.api('GET', '/api/trust')).body.policy.external_send).toBe('ask');
    expect((await dana.api('GET', '/api/audit')).body.entries).toEqual([]);
    expect(((await dana.api('GET', '/api/projects')).body.projects ?? []).length).toBe(0);
    // And the owner sees none of Dana's.
    await dana.api('POST', '/api/memory', { text: 'Harbor Café closes at 4pm on Sundays', kind: 'fact' });
    const ownerMem = (await owner.api('GET', '/api/memory')).body.memories as { text: string }[];
    expect(ownerMem.some((m) => m.text.includes('Harbor Café'))).toBe(false);
    // Files land under the organization's own R2 prefix.
    const up = await handle(new Request(`${HOST}/api/cards`, { method: 'POST', headers: { origin: HOST, cookie: `hc_session=${dana.session}`, 'content-type': 'text/plain', 'x-file-name': 'menu.txt' }, body: 'Latte 3.20' }), t.env, t.ctx);
    expect(up.status).toBe(201);
    const listed = await t.env.BLOBS.list({ prefix: `ws/${danaOrg}/cards/` });
    expect(listed.objects.length).toBe(1);
    // An id from another organization is simply not there.
    const ownerCard = await handle(new Request(`${HOST}/api/cards`, { method: 'POST', headers: { origin: HOST, cookie: `hc_session=${owner.session}`, 'content-type': 'text/plain', 'x-file-name': 'secret.txt' }, body: 'Only ours' }), t.env, t.ctx);
    const cardId = ((await ownerCard.json()) as { card: { cardId: string } }).card.cardId;
    expect((await dana.api('GET', `/api/cards/${cardId}`)).status).toBe(404);
  });

  it('invited to someone’s office, then starting your own: switch between them, with a role in each', async () => {
    const t = await createTestEnv(deployed);
    const owner = await signIn(t, OWNER);
    expect((await owner.api('PUT', '/api/admin/members/sam@example.com', { role: 'contributor' })).status).toBe(200);
    const sam = await signIn(t, 'sam@example.com', 'Sam');
    expect((await sam.api('GET', '/api/auth/me')).body).toMatchObject({ role: 'contributor', org: { orgId: 'local' } });
    expect((await sam.api('PUT', '/api/trust/autonomy', { actionClass: 'external_send', level: 'propose' })).status).toBe(403);
    const own = (await sam.api('POST', '/api/orgs', { name: 'Sam’s studio' })).body.org.orgId as string;
    expect((await sam.api('GET', '/api/auth/me')).body).toMatchObject({ role: 'owner', org: { orgId: own } });
    const orgs = (await sam.api('GET', '/api/orgs')).body as OrgsResponse;
    expect(orgs.orgs.map((o) => [o.orgId, o.role])).toEqual(
      expect.arrayContaining([
        ['local', 'contributor'],
        [own, 'owner'],
      ]),
    );
    expect((await sam.api('POST', '/api/orgs/local/switch')).status).toBe(200);
    expect((await sam.api('GET', '/api/auth/me')).body).toMatchObject({ role: 'contributor', org: { orgId: 'local' } });
    expect((await sam.api('POST', '/api/orgs/org_zzzzzzzzzzzz/switch')).status).toBe(404);
    // Removed from the owner's office: Sam is moved to their own, not signed out.
    expect((await owner.api('DELETE', '/api/admin/members/sam@example.com')).status).toBe(200);
    clearSessionCache();
    clearRoleCache();
    expect((await sam.api('GET', '/api/auth/me')).body).toMatchObject({ role: 'owner', org: { orgId: own } });
    // The People page of Sam's organization lists Sam, not the deployment's owners.
    const people = (await sam.api('GET', '/api/admin/members')).body.members as { email: string }[];
    expect(people.map((p) => p.email)).toEqual(['sam@example.com']);
  });

  it('sign-up modes: invite-only lets in only people invited somewhere; closed starts no new organizations', async () => {
    const t = await createTestEnv({ ...deployed, SIGNUP_MODE: 'invite' });
    const stranger = await signIn(t, 'stranger@example.com');
    expect(stranger.cb.headers.get('location')).toBe(`${HOST}/app?signin=denied`);
    const owner = await signIn(t, OWNER);
    await owner.api('PUT', '/api/admin/members/ivy@example.com', { role: 'reader' });
    const ivy = await signIn(t, 'ivy@example.com');
    expect((await ivy.api('GET', '/api/auth/me')).body).toMatchObject({ role: 'reader', canCreateOrg: true });
    const t2 = await createTestEnv({ ...deployed, SIGNUP_MODE: 'closed' });
    const owner2 = await signIn(t2, OWNER);
    await owner2.api('PUT', '/api/admin/members/ivy@example.com', { role: 'reader' });
    const ivy2 = await signIn(t2, 'ivy@example.com');
    expect((await ivy2.api('POST', '/api/orgs', { name: 'Ivy & Co' })).status).toBe(403);
  });

  it('caps: one person may start a few organizations; the platform page is for the deployment’s owners', async () => {
    const t = await createTestEnv({ ...deployed, MAX_ORGS_PER_USER: '1' });
    const dana = await signIn(t, 'dana@cafe.example');
    expect((await dana.api('POST', '/api/orgs', { name: 'One' })).status).toBe(201);
    const second = await dana.api('POST', '/api/orgs', { name: 'Two' });
    expect(second.status).toBe(403);
    expect(second.body.error.message).toMatch(/the most for now/);
    expect((await dana.api('GET', '/api/platform/orgs')).status).toBe(403);
    const owner = await signIn(t, OWNER);
    const platform = (await owner.api('GET', '/api/platform/orgs')).body as PlatformResponse;
    expect(platform).toMatchObject({ signup: 'open', orgs: [{ name: 'One', createdBy: 'dana@cafe.example', members: 1 }] });
  });
});

describe('settings in a new organization', () => {
  it('spending limits and how work runs are the platform’s; email, voice and keys are the organization’s', async () => {
    const t = await createTestEnv(deployed);
    const dana = await signIn(t, 'dana@cafe.example');
    await dana.api('POST', '/api/orgs', { name: 'Harbor Café' });
    const view = (await dana.api('GET', '/api/admin/config')).body as { values: { key: string; locked?: boolean }[] };
    expect(view.values.find((v) => v.key === 'CHAT_DAILY_LIMIT')).toMatchObject({ locked: true });
    expect(view.values.find((v) => v.key === 'MAIL_PROVIDER')?.locked).toBeUndefined();
    const raised = await dana.api('PUT', '/api/admin/config', { values: { CHAT_DAILY_LIMIT: '100000' } });
    expect(raised.status).toBe(400);
    expect(raised.body.error.message).toMatch(/set by Headcount for every organization/);
    expect((await dana.api('PUT', '/api/admin/config', { values: { MAIL_PROVIDER: 'sink' } })).status).toBe(200);
    // The home organization's owner keeps every setting.
    const owner = await signIn(t, OWNER);
    const home = (await owner.api('GET', '/api/admin/config')).body as { values: { key: string; locked?: boolean }[] };
    expect(home.values.find((v) => v.key === 'CHAT_DAILY_LIMIT')?.locked).toBeUndefined();
    // Dana's email setting did not reach the home organization.
    expect(home.values.find((v) => v.key === 'MAIL_PROVIDER')).toMatchObject({ source: 'default' });
  });
});
