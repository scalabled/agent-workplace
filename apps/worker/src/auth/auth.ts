// Google sign-in for the deployed app (docs/DEPLOY.md, Phase B). Ported from personagram-ai's authRoute and
// user() (src/worker/security.ts): OAuth 2.0 authorization code + PKCE (S256), a one-time state stored hashed in D1
// and echoed in a short-lived cookie, and a random session token whose SHA-256 is the only thing stored.
//
// Multi-tenant (ext/orgs.ts): a session works in one organization at a time (auth_sessions.org_id). Who may sign in:
// the deployment's owners (OWNER_EMAILS, owners of the home organization), anyone invited to an organization
// (D1 `members`, a role per organization: owner, contributor or reader), and, while sign-up is open (SIGNUP_MODE),
// anyone with a verified Google account, who then starts their own organization. Every API route names the least
// role it needs in the current organization (packages/protocol/src/routes.ts); an owner can preview a lower role.
//
// Fail closed: sign-in is required unless AUTH_MODE is "off" AND the request's host is loopback (local dev). With
// AUTH_MODE unset, loopback hosts are open and every other host requires a session.
import { BRAND, ROUTES, type RouteId } from '@headcount/protocol';
import { atLeast, ROLE_RANK, type Me, type Role } from '@headcount/protocol/ext/admin';
import type { Env } from '../env';
import { errorResponse, json } from '../lib/http';
import { homeWorkspace } from '../lib/tenant';

export const SESSION_COOKIE = 'hc_session';
export const STATE_COOKIE = 'hc_oauth';
/** An owner's (or contributor's) preview of a lower role. It can only lower what they may do, never raise it. */
export const VIEW_AS_COOKIE = 'hc_view_as';
const SESSION_TTL_S = 30 * 86_400;
const STATE_TTL_S = 600;
const SESSION_CACHE_MS = 30_000;
/** Sign-ins in flight at once (unexpired oauth_states rows) before new starts are refused. */
export const MAX_PENDING_SIGNINS = 200;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Routes anyone may call: health and the read-only portraits the public landing page shows. */
const PUBLIC_ROUTES = new Set<RouteId>(['health', 'listPortraits', 'getPortrait', 'getLandmarks']);

export type AuthMode = 'google' | 'off';

export interface Session {
  email: string;
  name: string;
  /** The organization this session works in (null: none chosen yet). */
  orgId: string | null;
  /** SHA-256 of the cookie token (to move the session to another organization). */
  tokenHash: string;
}

/** Who is asking, and what they may do. Local mode (loopback, sign-in off) is the owner, with no email. */
export interface Identity {
  email: string;
  name: string;
  role: Role;
  actualRole: Role;
  /** The organization the request works for. */
  orgId: string;
  /** One of the deployment's owners (OWNER_EMAILS). */
  platform: boolean;
}

/** Signed in, whether or not they belong to an organization yet (account-level routes). */
export interface Account {
  email: string;
  name: string;
  tokenHash: string;
  orgId: string | null;
  platform: boolean;
}

export function isLoopback(hostname: string): boolean {
  return LOOPBACK.has(hostname.toLowerCase());
}

/** "off" only on a loopback host (and only if not forced to google); everywhere else sign-in is required. */
export function authMode(env: Pick<Env, 'AUTH_MODE'>, url: URL): AuthMode {
  const mode = (env.AUTH_MODE ?? '').trim().toLowerCase();
  if (mode === 'google') return 'google';
  return isLoopback(url.hostname) ? 'off' : 'google';
}

/** The owner allowlist: lower-cased, comma/space/semicolon separated. Empty means nobody may sign in. */
export function ownerEmails(env: Pick<Env, 'OWNER_EMAILS'>): Set<string> {
  return new Set(
    (env.OWNER_EMAILS ?? '')
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@')),
  );
}

export function token(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export async function hash(value: string): Promise<string> {
  return [...(await sha256(value))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return btoa(String.fromCharCode(...(await sha256(verifier)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Equal-time string comparison (the state cookie vs the callback's state). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function readCookie(req: Request, name: string): string {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const p = part.trim();
    if (p.startsWith(name + '=')) return p.slice(name.length + 1);
  }
  return '';
}

/** The origin Google redirects back to: APP_ORIGIN when set (required when deployed), else the request's own. */
export function appOrigin(env: Pick<Env, 'APP_ORIGIN'>, url: URL): string {
  const raw = (env.APP_ORIGIN ?? '').trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      /* fall through */
    }
  }
  return url.origin;
}

function cookieHeader(name: string, value: string, maxAge: number, secure: boolean, path = '/'): string {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/** Only same-site paths: "/app…" style, never "//host" or a scheme. */
export function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.length > 512) return '/app';
  return raw;
}

// A short per-isolate cache so a burst of API calls does not hit D1 for every request.
const cache = new Map<string, { session: Session | null; until: number }>();

export function clearSessionCache(): void {
  cache.clear();
}

/** The signed-in owner for this request, or null. Expired and unknown tokens are null. */
export async function sessionFor(req: Request, env: Pick<Env, 'DB'>, now = Date.now()): Promise<Session | null> {
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw || raw.length > 128) return null;
  const key = await hash(raw);
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.session;
  const row = await env.DB.prepare('SELECT email, name, org_id FROM auth_sessions WHERE token_hash = ? AND expires_at > ?').bind(key, now).first<{ email: string; name: string | null; org_id: string | null }>();
  const session = row ? { email: row.email, name: row.name ?? '', orgId: row.org_id ?? null, tokenHash: key } : null;
  cache.set(key, { session, until: now + SESSION_CACHE_MS });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return session;
}

const roles = new Map<string, { role: Role | null; until: number }>();

export function clearRoleCache(): void {
  roles.clear();
}

const isRole = (v: unknown): v is Role => v === 'owner' || v === 'contributor' || v === 'reader';

/**
 * A signed-in email's role in an organization (by default the deployment's home one): an owner named in the
 * deployment (home organization only), an invited member, or null (not a member).
 */
export async function roleFor(env: Pick<Env, 'OWNER_EMAILS' | 'DB' | 'WORKSPACE_ID' | 'HOME_WORKSPACE_ID'>, email: string, now = Date.now(), ws = homeWorkspace(env)): Promise<Role | null> {
  const e = email.trim().toLowerCase();
  if (ws === homeWorkspace(env) && ownerEmails(env).has(e)) return 'owner';
  const cacheKey = `${ws}|${e}`;
  const hit = roles.get(cacheKey);
  if (hit && hit.until > now) return hit.role;
  let role: Role | null = null;
  try {
    const row = await env.DB.prepare('SELECT role FROM members WHERE ws_id = ? AND email = ?').bind(ws, e).first<{ role: string }>();
    role = isRole(row?.role) ? row.role : null;
  } catch {
    role = null; // an unmigrated database: owners only
  }
  roles.set(cacheKey, { role, until: now + SESSION_CACHE_MS });
  if (roles.size > 500) roles.delete(roles.keys().next().value as string);
  return role;
}

/** The organizations an email belongs to: the home one for the deployment's owners, and every invitation. */
export async function orgsFor(env: Pick<Env, 'OWNER_EMAILS' | 'DB' | 'WORKSPACE_ID' | 'HOME_WORKSPACE_ID'>, email: string): Promise<{ orgId: string; name: string; role: Role; home: boolean; createdAt?: string }[]> {
  const e = email.trim().toLowerCase();
  const home = homeWorkspace(env);
  let rows: { ws_id: string; role: string; name: string | null; created_at: string | null }[] = [];
  try {
    rows = (await env.DB.prepare('SELECT m.ws_id, m.role, o.name, o.created_at FROM members m LEFT JOIN orgs o ON o.org_id = m.ws_id WHERE m.email = ? ORDER BY m.added_at, m.rowid').bind(e).all<(typeof rows)[number]>()).results ?? [];
  } catch {
    rows = []; // an unmigrated database: the home organization only
  }
  const out = rows.filter((r) => isRole(r.role)).map((r) => ({ orgId: r.ws_id, name: r.name || (r.ws_id === home ? BRAND.name : 'My office'), role: r.role as Role, home: r.ws_id === home, ...(r.created_at ? { createdAt: r.created_at } : {}) }));
  if (ownerEmails(env).has(e)) {
    const at = out.findIndex((o) => o.orgId === home);
    const name = (await homeName(env)) ?? out[at]?.name ?? BRAND.name;
    if (at >= 0) out.splice(at, 1);
    out.unshift({ orgId: home, name, role: 'owner', home: true });
  }
  return out;
}

async function homeName(env: Pick<Env, 'DB' | 'WORKSPACE_ID' | 'HOME_WORKSPACE_ID'>): Promise<string | null> {
  try {
    return (await env.DB.prepare('SELECT name FROM orgs WHERE org_id = ?').bind(homeWorkspace(env)).first<string>('name')) ?? null;
  } catch {
    return null;
  }
}

/** Point a session at an organization (or none). */
export async function setSessionOrg(env: Pick<Env, 'DB'>, tokenHash: string, orgId: string | null): Promise<void> {
  await env.DB.prepare('UPDATE auth_sessions SET org_id = ? WHERE token_hash = ?').bind(orgId, tokenHash).run();
  cache.delete(tokenHash);
}

/** The lower of a role and the "view as" preview. */
function viewed(req: Request, actual: Role): Role {
  const want = readCookie(req, VIEW_AS_COOKIE);
  return isRole(want) && ROLE_RANK[want] < ROLE_RANK[actual] ? want : actual;
}

/** The signed-in person (whether or not they belong to an organization yet), or null. Local mode has no account. */
export async function account(req: Request, env: Env): Promise<Account | null> {
  const session = await sessionFor(req, env);
  return session ? { email: session.email, name: session.name, tokenHash: session.tokenHash, orgId: session.orgId, platform: ownerEmails(env).has(session.email.toLowerCase()) } : null;
}

/**
 * Who this request comes from and the organization it works for, or null when it needs a session it does not have,
 * or the person belongs to no organization (yet). A session whose organization is gone (removed from it) moves to
 * their first remaining one.
 */
export async function identify(req: Request, env: Env, url: URL): Promise<Identity | null> {
  const home = homeWorkspace(env);
  if (authMode(env, url) === 'off') return { email: '', name: '', role: viewed(req, 'owner'), actualRole: 'owner', orgId: home, platform: true };
  const session = await sessionFor(req, env);
  if (!session) return null;
  const platform = ownerEmails(env).has(session.email.toLowerCase());
  let orgId = session.orgId;
  let actual = orgId ? await roleFor(env, session.email, Date.now(), orgId) : null;
  if (!actual) {
    // No organization chosen yet, or no longer a member of it: the first one they belong to.
    const first = (await orgsFor(env, session.email))[0];
    if (!first) return null;
    orgId = first.orgId;
    actual = first.role;
    await setSessionOrg(env, session.tokenHash, orgId).catch(() => undefined);
  }
  return { email: session.email, name: session.name, role: viewed(req, actual), actualRole: actual, orgId: orgId!, platform };
}

/** Who may start an organization. */
export function signupMode(env: Pick<Env, 'SIGNUP_MODE'>): 'open' | 'invite' | 'closed' {
  const m = (env.SIGNUP_MODE ?? '').trim().toLowerCase();
  return m === 'invite' || m === 'closed' ? m : 'open';
}

const intOr = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
};
export const maxOrgs = (env: Pick<Env, 'MAX_ORGS'>): number => intOr(env.MAX_ORGS, 100);
export const maxOrgsPerUser = (env: Pick<Env, 'MAX_ORGS_PER_USER'>): number => intOr(env.MAX_ORGS_PER_USER, 3);

/** May this person start an organization now? (Sign-up open, under the caps.) */
export async function mayCreateOrg(env: Env, email: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const mode = signupMode(env);
  const e = email.toLowerCase();
  const platform = ownerEmails(env).has(e);
  if (mode === 'closed' && !platform) return { ok: false, why: 'New organizations are not open right now. Ask someone to invite you to theirs.' };
  if (mode === 'invite' && !platform && (await orgsFor(env, e)).length === 0) return { ok: false, why: `${BRAND.name} is invite-only right now. Ask someone to invite you to their organization.` };
  try {
    const mine = (await env.DB.prepare('SELECT count(*) AS n FROM orgs WHERE created_by = ?').bind(e).first<number>('n')) ?? 0;
    if (!platform && mine >= maxOrgsPerUser(env)) return { ok: false, why: `You have started ${mine} organizations, the most for now.` };
    const all = (await env.DB.prepare('SELECT count(*) AS n FROM orgs').first<number>('n')) ?? 0;
    if (!platform && all >= maxOrgs(env)) return { ok: false, why: `${BRAND.name} is full for now. Try again later, or ask someone to invite you.` };
  } catch {
    return { ok: false, why: 'Organizations are not set up on this deployment yet.' };
  }
  return { ok: true };
}

const ROLE_REFUSAL: Record<Role, string> = {
  reader: 'Sign in to continue.',
  contributor: 'Readers can see everything but not change it. An owner can make you a contributor in Admin, under People and roles.',
  owner: 'Only an owner can change this. Ask an owner. They can make you an owner in Admin, under People and roles.',
};

/**
 * The identity a request may go on with (null for a public read), or the 401/403 to answer. The least role comes
 * from the route table; paths outside it (/api/media/*) need a reader to read and a contributor to change.
 */
export async function authorize(req: Request, env: Env, url: URL, route: RouteId | null): Promise<{ identity: Identity | null; account?: Account | null } | Response> {
  const reading = req.method === 'GET' || req.method === 'HEAD';
  if (route && reading && (PUBLIC_ROUTES.has(route) || ROUTES[route].auth === 'public')) return { identity: null };
  const level = route ? ROUTES[route].auth : null;
  if (level === 'account') {
    // Signed in, organization or not (their organizations). Local mode: the owner of the home organization.
    if (authMode(env, url) === 'off') return { identity: await identify(req, env, url), account: null };
    const acct = await account(req, env);
    if (!acct) return errorResponse('unauthenticated', 'Sign in to continue.');
    return { identity: await identify(req, env, url), account: acct };
  }
  const identity = await identify(req, env, url);
  if (level === 'platform') {
    if (!identity) return errorResponse('unauthenticated', 'Sign in to continue.');
    return identity.platform ? { identity } : errorResponse('forbidden', 'Only the deployment’s owners can see this.');
  }
  const needed: Role = level && level !== 'public' ? (level as Role) : reading ? 'reader' : 'contributor';
  if (!identity) return errorResponse('unauthenticated', 'Sign in to continue.');
  if (!atLeast(identity.role, needed)) return errorResponse('forbidden', ROLE_REFUSAL[needed]);
  return { identity };
}

/** Null when the request may go on; a 401 when it needs a session it does not have. */
export async function requireSession(req: Request, env: Env, url: URL, route: RouteId | null): Promise<Response | null> {
  const r = await authorize(req, env, url, route);
  return r instanceof Response ? r : null;
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

/** Sign-in trouble goes back to the app with a reason the sign-in screen can explain (never a raw error page). */
function backToApp(origin: string, reason: 'denied' | 'failed' | 'expired' | 'unconfigured', secure: boolean): Response {
  return redirect(`${origin}/app?signin=${reason}`, [cookieHeader(STATE_COOKIE, '', 0, secure, '/api/auth')]);
}

/**
 * /api/auth/* (outside the protocol route table, like /api/media/*). Returns null for other paths.
 * - GET  /api/auth/google?return=/app…  → Google (PKCE, state)
 * - GET  /api/auth/callback             → session cookie, back to return_to
 * - GET  /api/auth/me                   → {mode, signedIn, email?, name?, role, actualRole?}
 * - POST /api/auth/view-as {role|null}  → preview a lower role
 * - POST /api/auth/logout               → clears the session
 */
export async function handleAuthRoute(req: Request, url: URL, env: Env, fetcher: typeof fetch = fetch): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/auth/')) return null;
  const path = url.pathname.slice('/api/auth/'.length);
  const origin = appOrigin(env, url);
  const secure = origin.startsWith('https:');
  const mode = authMode(env, url);

  if (path === 'me') {
    if (req.method !== 'GET') return errorResponse('method_not_allowed', 'Use GET for /api/auth/me.', { headers: { allow: 'GET' } });
    const who = await identify(req, env, url);
    if (!who) {
      // Signed in but in no organization yet: they may start one (or are waiting for an invitation).
      const acct = mode === 'google' ? await account(req, env) : null;
      if (acct) {
        const may = await mayCreateOrg(env, acct.email);
        return json({ mode, signedIn: true, email: acct.email, name: acct.name, role: 'reader', needsOrg: true, canCreateOrg: may.ok, ...(acct.platform ? { platform: true } : {}) } satisfies Me);
      }
      return json({ mode, signedIn: false, role: 'reader' } satisfies Me);
    }
    if (who.email)
      await env.DB.prepare('UPDATE members SET last_seen_at = ?, name = CASE WHEN name = \'\' THEN ? ELSE name END WHERE ws_id = ? AND email = ?')
        .bind(new Date().toISOString(), who.name, who.orgId, who.email)
        .run()
        .catch(() => undefined);
    const orgName = (await env.DB.prepare('SELECT name FROM orgs WHERE org_id = ?').bind(who.orgId).first<string>('name').catch(() => null)) ?? (who.orgId === homeWorkspace(env) ? BRAND.name : 'My office');
    const may = who.email ? await mayCreateOrg(env, who.email) : { ok: false as const, why: '' };
    return json({
      mode,
      signedIn: true,
      ...(who.email ? { email: who.email, name: who.name } : {}),
      role: who.role,
      ...(who.role !== who.actualRole ? { actualRole: who.actualRole } : {}),
      org: { orgId: who.orgId, name: orgName },
      ...(may.ok ? { canCreateOrg: true } : {}),
      ...(who.platform && who.email ? { platform: true } : {}),
    } satisfies Me);
  }

  // Preview a lower role (a cookie; it can only ever lower what the session may do).
  if (path === 'view-as') {
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 'Use POST for /api/auth/view-as.', { headers: { allow: 'POST' } });
    let role: unknown = null;
    try {
      role = ((await req.json()) as { role?: unknown }).role ?? null;
    } catch {
      /* no body: back to their own role */
    }
    if (role !== null && role !== 'contributor' && role !== 'reader') return errorResponse('bad_request', 'View as a contributor or a reader, or null for yourself.');
    const res = json({ ok: true });
    res.headers.append('set-cookie', role ? `${VIEW_AS_COOKIE}=${role}; Path=/; SameSite=Lax; Max-Age=86400${secure ? '; Secure' : ''}` : `${VIEW_AS_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
    return res;
  }

  if (path === 'logout') {
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 'Use POST for /api/auth/logout.', { headers: { allow: 'POST' } });
    const raw = readCookie(req, SESSION_COOKIE);
    if (raw) {
      const key = await hash(raw);
      await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(key).run();
      cache.delete(key);
    }
    const res = json({ ok: true });
    res.headers.append('set-cookie', cookieHeader(SESSION_COOKIE, '', 0, secure));
    return res;
  }

  if (path === 'google') {
    if (req.method !== 'GET') return errorResponse('method_not_allowed', 'Use GET for /api/auth/google.', { headers: { allow: 'GET' } });
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return backToApp(origin, 'unconfigured', secure);
    const now = Date.now();
    // Flood guard: each start writes a row, so an anonymous loop could burn the D1 write quota. A single owner never
    // has more than a handful of sign-ins in flight; past the cap, new ones wait for the old to expire (10 min).
    const pending = await env.DB.prepare('SELECT count(*) AS n FROM oauth_states WHERE expires_at > ?').bind(now).first<number>('n');
    if ((pending ?? 0) >= MAX_PENDING_SIGNINS) return backToApp(origin, 'failed', secure);
    const state = token();
    const verifier = token(48);
    const returnTo = safeReturnTo(url.searchParams.get('return'));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now),
      env.DB.prepare('INSERT INTO oauth_states (state_hash, verifier, return_to, expires_at) VALUES (?, ?, ?, ?)').bind(await hash(state), verifier, returnTo, now + STATE_TTL_S * 1000),
    ]);
    const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    google.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${origin}/api/auth/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return redirect(google.href, [cookieHeader(STATE_COOKIE, state, STATE_TTL_S, secure, '/api/auth')]);
  }

  if (path === 'callback') {
    if (req.method !== 'GET') return errorResponse('method_not_allowed', 'Use GET for /api/auth/callback.', { headers: { allow: 'GET' } });
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return backToApp(origin, 'unconfigured', secure);
    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code');
    const cookieState = readCookie(req, STATE_COOKIE);
    if (url.searchParams.get('error')) return backToApp(origin, 'failed', secure);
    if (!state || !code || !cookieState || !safeEqual(state, cookieState)) return backToApp(origin, 'expired', secure);
    const row = await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING verifier, return_to').bind(await hash(state), Date.now()).first<{ verifier: string; return_to: string }>();
    if (!row) return backToApp(origin, 'expired', secure);

    let profile: { sub?: string; email?: string; email_verified?: boolean; name?: string };
    try {
      const exchange = await fetcher('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${origin}/api/auth/callback`,
          grant_type: 'authorization_code',
          code_verifier: row.verifier,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!exchange.ok) return backToApp(origin, 'failed', secure);
      const tokens = (await exchange.json()) as { access_token?: string };
      if (!tokens.access_token) return backToApp(origin, 'failed', secure);
      const who = await fetcher('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) });
      if (!who.ok) return backToApp(origin, 'failed', secure);
      profile = (await who.json()) as typeof profile;
    } catch (err) {
      // Never log tokens or bodies: only that Google could not be reached.
      console.error('[auth] Google sign-in exchange failed:', err instanceof Error ? err.name : 'error');
      return backToApp(origin, 'failed', secure);
    }

    const email = (profile.email ?? '').trim().toLowerCase();
    if (!profile.sub || !email || profile.email_verified !== true) return backToApp(origin, 'denied', secure);
    // In: a member of an organization (or a deployment owner), or anyone who may start one while sign-up is open.
    const orgs = await orgsFor(env, email);
    if (!orgs.length && !(await mayCreateOrg(env, email)).ok) return backToApp(origin, 'denied', secure);

    const session = token();
    const now = Date.now();
    await env.DB.prepare('INSERT INTO auth_sessions (token_hash, email, name, created_at, expires_at, org_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await hash(session), email, (profile.name ?? '').slice(0, 120), now, now + SESSION_TTL_S * 1000, orgs[0]?.orgId ?? null)
      .run();
    return redirect(`${origin}${safeReturnTo(row.return_to)}`, [cookieHeader(SESSION_COOKIE, session, SESSION_TTL_S, secure), cookieHeader(STATE_COOKIE, '', 0, secure, '/api/auth')]);
  }

  return errorResponse('not_found', `No route for ${url.pathname}.`);
}
