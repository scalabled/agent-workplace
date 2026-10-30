import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSessionCache, hash, safeReturnTo } from '../src/auth/auth';
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
  OWNER_EMAILS: `${OWNER}, second@example.com`,
};

type T = Awaited<ReturnType<typeof createTestEnv>>;

async function send(t: T, path: string, init: RequestInit & { base?: string } = {}) {
  const { base = HOST, ...rest } = init;
  return handle(new Request(`${base}${path}`, rest), t.env, t.ctx);
}

function cookieValue(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    if (c.startsWith(`${name}=`)) return c.slice(name.length + 1).split(';')[0]!;
  }
  return null;
}

/** Stub Google: the token exchange and userinfo. */
function stubGoogle(profile: Record<string, unknown>, opts: { tokenOk?: boolean } = {}) {
  const calls: { url: string; body?: string }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, body: init?.body ? String(init.body) : undefined });
    if (url === 'https://oauth2.googleapis.com/token') return opts.tokenOk === false ? new Response('{}', { status: 400 }) : Response.json({ access_token: 'at-123', id_token: 'x' });
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json(profile);
    return new Response('unexpected', { status: 500 });
  });
  return calls;
}

/** Start sign-in, then complete the callback as Google would. Returns the final response. */
async function signIn(t: T, profile: Record<string, unknown>, returnTo = '/app/floor') {
  const start = await send(t, `/api/auth/google?return=${encodeURIComponent(returnTo)}`, { headers: { 'sec-fetch-site': 'none' } });
  expect(start.status).toBe(302);
  const google = new URL(start.headers.get('location')!);
  const state = google.searchParams.get('state')!;
  const stateCookie = cookieValue(start, 'hc_oauth')!;
  stubGoogle(profile);
  const cb = await send(t, `/api/auth/callback?state=${encodeURIComponent(state)}&code=auth-code`, { headers: { cookie: `hc_oauth=${stateCookie}`, 'sec-fetch-site': 'cross-site' } });
  return { start, google, state, cb };
}

beforeEach(() => clearSessionCache());
afterEach(() => vi.unstubAllGlobals());

describe('auth: local dev', () => {
  it('leaves loopback hosts open when AUTH_MODE is unset', async () => {
    const t = await createTestEnv();
    expect((await send(t, '/api/workspace', { base: 'http://localhost' })).status).toBe(200);
    expect(await (await send(t, '/api/auth/me', { base: 'http://localhost' })).json()).toEqual({ mode: 'off', signedIn: true, role: 'owner', org: { orgId: 'local', name: 'Agent Workplace' } });
  });

  it('requires sign-in on loopback when AUTH_MODE=google', async () => {
    const t = await createTestEnv({ AUTH_MODE: 'google' });
    const res = await send(t, '/api/workspace', { base: 'http://localhost' });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'unauthenticated' } });
  });
});

describe('auth: deployed host fails closed', () => {
  it('401s owner routes, the feed socket and media without a session', async () => {
    const t = await createTestEnv(deployed);
    for (const [method, path] of [['GET', '/api/workspace'], ['POST', '/api/talk'], ['GET', '/api/capabilities'], ['GET', '/api/ws'], ['POST', '/api/media/image'], ['PUT', '/api/portraits/lead-steady-operator/landmarks']] as const) {
      const res = await send(t, path, { method, headers: { origin: HOST, ...(path === '/api/ws' ? { upgrade: 'websocket' } : {}) } });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it('keeps health and the read-only landing portraits public', async () => {
    const t = await createTestEnv(deployed);
    expect((await send(t, '/api/health')).status).toBe(200);
    expect((await send(t, '/api/portraits')).status).toBe(200);
  });

  it('AUTH_MODE=off cannot open a non-loopback host', async () => {
    const t = await createTestEnv({ ...deployed, AUTH_MODE: 'off' });
    expect((await send(t, '/api/workspace', { headers: { origin: HOST } })).status).toBe(401);
  });

  it('still refuses cross-site API calls before auth', async () => {
    const t = await createTestEnv(deployed);
    expect((await send(t, '/api/workspace', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await send(t, '/api/workspace', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
  });
});

describe('auth: Google sign-in', () => {
  it('starts with PKCE S256 and a hashed one-time state', async () => {
    const t = await createTestEnv(deployed);
    const res = await send(t, '/api/auth/google?return=/app', { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(res.status).toBe(302);
    const google = new URL(res.headers.get('location')!);
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(google.searchParams.get('code_challenge_method')).toBe('S256');
    expect(google.searchParams.get('redirect_uri')).toBe(`${HOST}/api/auth/callback`);
    expect(google.searchParams.get('scope')).toBe('openid email profile');
    const state = google.searchParams.get('state')!;
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('hc_oauth='))!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/api/auth');
    const row = await t.env.DB.prepare('SELECT state_hash FROM oauth_states').first<{ state_hash: string }>();
    expect(row?.state_hash).toBe(await hash(state));
    expect(row?.state_hash).not.toBe(state);
  });

  it('signs in an allowlisted, verified owner and opens the API', async () => {
    const t = await createTestEnv(deployed);
    const { cb } = await signIn(t, { sub: 'g-1', email: 'Owner@Example.com', email_verified: true, name: 'Owner' });
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe(`${HOST}/app/floor`);
    const session = cookieValue(cb, 'hc_session')!;
    expect(session).toBeTruthy();
    const setCookie = cb.headers.getSetCookie().find((c) => c.startsWith('hc_session='))!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    // Only the hash is stored.
    const stored = await t.env.DB.prepare('SELECT token_hash, email FROM auth_sessions').first<{ token_hash: string; email: string }>();
    expect(stored).toEqual({ token_hash: await hash(session), email: OWNER });
    const headers = { cookie: `hc_session=${session}`, origin: HOST };
    expect((await send(t, '/api/workspace', { headers })).status).toBe(200);
    expect(await (await send(t, '/api/auth/me', { headers })).json()).toEqual({ mode: 'google', signedIn: true, email: OWNER, name: 'Owner', role: 'owner', org: { orgId: 'local', name: 'Agent Workplace' }, canCreateOrg: true, platform: true });
  });

  it('refuses an email that is not on the allowlist while sign-up is closed', async () => {
    const t = await createTestEnv({ ...deployed, SIGNUP_MODE: 'closed' });
    const { cb } = await signIn(t, { sub: 'g-2', email: 'stranger@example.com', email_verified: true });
    expect(cb.headers.get('location')).toBe(`${HOST}/app?signin=denied`);
    expect(cookieValue(cb, 'hc_session')).toBeNull();
    expect(await t.env.DB.prepare('SELECT count(*) AS n FROM auth_sessions').first('n')).toBe(0);
  });

  it('refuses an unverified email, and anyone when sign-up is closed and the allowlist is empty', async () => {
    const t = await createTestEnv(deployed);
    expect((await signIn(t, { sub: 'g-3', email: OWNER, email_verified: false })).cb.headers.get('location')).toBe(`${HOST}/app?signin=denied`);
    const t2 = await createTestEnv({ ...deployed, OWNER_EMAILS: '', SIGNUP_MODE: 'closed' });
    expect((await signIn(t2, { sub: 'g-4', email: OWNER, email_verified: true })).cb.headers.get('location')).toBe(`${HOST}/app?signin=denied`);
  });

  it('rejects a state that does not match the cookie, and a replayed state', async () => {
    const t = await createTestEnv(deployed);
    const start = await send(t, '/api/auth/google', { headers: { 'sec-fetch-site': 'none' } });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    stubGoogle({ sub: 'g-5', email: OWNER, email_verified: true });
    const mismatch = await send(t, `/api/auth/callback?state=${state}&code=c`, { headers: { cookie: 'hc_oauth=someone-else' } });
    expect(mismatch.headers.get('location')).toBe(`${HOST}/app?signin=expired`);
    const ok = await send(t, `/api/auth/callback?state=${state}&code=c`, { headers: { cookie: `hc_oauth=${state}` } });
    expect(cookieValue(ok, 'hc_session')).toBeTruthy();
    const replay = await send(t, `/api/auth/callback?state=${state}&code=c`, { headers: { cookie: `hc_oauth=${state}` } });
    expect(replay.headers.get('location')).toBe(`${HOST}/app?signin=expired`);
  });

  it('never redirects off-site after sign-in', async () => {
    expect(safeReturnTo('//evil.example/x')).toBe('/app');
    expect(safeReturnTo('https://evil.example')).toBe('/app');
    expect(safeReturnTo('/\\evil.example')).toBe('/app');
    expect(safeReturnTo('/app/talk')).toBe('/app/talk');
    const t = await createTestEnv(deployed);
    const { cb } = await signIn(t, { sub: 'g-6', email: OWNER, email_verified: true }, '//evil.example');
    expect(cb.headers.get('location')).toBe(`${HOST}/app`);
  });

  it('sends the user back with a reason when Google refuses or is unconfigured', async () => {
    const t = await createTestEnv(deployed);
    const start = await send(t, '/api/auth/google', { headers: { 'sec-fetch-site': 'none' } });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    stubGoogle({}, { tokenOk: false });
    const failed = await send(t, `/api/auth/callback?state=${state}&code=c`, { headers: { cookie: `hc_oauth=${state}` } });
    expect(failed.headers.get('location')).toBe(`${HOST}/app?signin=failed`);
    const t2 = await createTestEnv({ ...deployed, GOOGLE_CLIENT_SECRET: '' });
    const res = await send(t2, '/api/auth/google', { headers: { 'sec-fetch-site': 'none' } });
    expect(res.headers.get('location')).toBe(`${HOST}/app?signin=unconfigured`);
  });

  it('logs out (same-origin only) and the session stops working', async () => {
    const t = await createTestEnv(deployed);
    const session = cookieValue((await signIn(t, { sub: 'g-7', email: OWNER, email_verified: true })).cb, 'hc_session')!;
    const cookie = `hc_session=${session}`;
    expect((await send(t, '/api/auth/logout', { method: 'POST', headers: { cookie, origin: 'https://evil.example' } })).status).toBe(403);
    const out = await send(t, '/api/auth/logout', { method: 'POST', headers: { cookie, origin: HOST } });
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().some((c) => c.startsWith('hc_session=;') && c.includes('Max-Age=0'))).toBe(true);
    expect((await send(t, '/api/workspace', { headers: { cookie, origin: HOST } })).status).toBe(401);
  });

  it('treats an expired session as signed out', async () => {
    const t = await createTestEnv(deployed);
    const session = cookieValue((await signIn(t, { sub: 'g-8', email: OWNER, email_verified: true })).cb, 'hc_session')!;
    await t.env.DB.prepare('UPDATE auth_sessions SET expires_at = ?').bind(Date.now() - 1).run();
    clearSessionCache();
    expect((await send(t, '/api/workspace', { headers: { cookie: `hc_session=${session}`, origin: HOST } })).status).toBe(401);
  });

  it('caps sign-ins in flight so an anonymous loop cannot burn the D1 write quota', async () => {
    const t = await createTestEnv(deployed);
    const future = Date.now() + 600_000;
    for (let i = 0; i < 200; i++) await t.env.DB.prepare('INSERT INTO oauth_states (state_hash, verifier, return_to, expires_at) VALUES (?, ?, ?, ?)').bind(`h${i}`, 'v', '/app', future).run();
    const res = await send(t, '/api/auth/google', { headers: { 'sec-fetch-site': 'none' } });
    expect(res.headers.get('location')).toBe(`${HOST}/app?signin=failed`);
    expect(await t.env.DB.prepare('SELECT count(*) AS n FROM oauth_states').first('n')).toBe(200);
  });

  it('keeps generic image generation off on a deployed host unless ENABLE_MEDIA_TOOLS=true', async () => {
    const t = await createTestEnv(deployed);
    const session = cookieValue((await signIn(t, { sub: 'g-9', email: OWNER, email_verified: true })).cb, 'hc_session')!;
    const init = { method: 'POST', headers: { cookie: `hc_session=${session}`, origin: HOST, 'content-type': 'application/json' }, body: '{}' };
    expect((await send(t, '/api/media/image', init)).status).toBe(404);
    const t2 = await createTestEnv({ ...deployed, ENABLE_MEDIA_TOOLS: 'true' });
    const s2 = cookieValue((await signIn(t2, { sub: 'g-10', email: OWNER, email_verified: true })).cb, 'hc_session')!;
    expect((await send(t2, '/api/media/image', { ...init, headers: { ...init.headers, cookie: `hc_session=${s2}` } })).status).not.toBe(404);
  });
});
