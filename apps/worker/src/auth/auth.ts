// Google sign-in for the deployed app (docs/DEPLOY.md, Phase B). Ported from personagram-ai's authRoute and
// user() (src/worker/security.ts): OAuth 2.0 authorization code + PKCE (S256), a one-time state stored hashed in D1
// and echoed in a short-lived cookie, the verified Google email checked against OWNER_EMAILS, and a random session
// token whose SHA-256 is the only thing stored. Who may sign in: the owners named in OWNER_EMAILS, and the members an
// owner invited on the admin page (D1 `members`), each with a role: owner, contributor or reader. Every API route
// names the least role it needs (packages/protocol/src/routes.ts); an owner can preview a lower role ("view as").
//
// Fail closed: sign-in is required unless AUTH_MODE is "off" AND the request's host is loopback (local dev). With
// AUTH_MODE unset, loopback hosts are open and every other host requires a session.
import { ROUTES, type RouteId } from '@headcount/protocol';
import { atLeast, ROLE_RANK, type Me, type Role } from '@headcount/protocol/ext/admin';
import type { Env } from '../env';
import { errorResponse, json } from '../lib/http';

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
}

/** Who is asking, and what they may do. Local mode (loopback, sign-in off) is the owner, with no email. */
export interface Identity {
  email: string;
  name: string;
  role: Role;
  actualRole: Role;
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
  const row = await env.DB.prepare('SELECT email, name FROM auth_sessions WHERE token_hash = ? AND expires_at > ?').bind(key, now).first<Session>();
  const session = row ? { email: row.email, name: row.name ?? '' } : null;
  cache.set(key, { session, until: now + SESSION_CACHE_MS });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return session;
}

const roles = new Map<string, { role: Role | null; until: number }>();

export function clearRoleCache(): void {
  roles.clear();
}

const isRole = (v: unknown): v is Role => v === 'owner' || v === 'contributor' || v === 'reader';

/** A signed-in email's role: an owner named in the deployment, an invited member, or null (not allowed in). */
export async function roleFor(env: Pick<Env, 'OWNER_EMAILS' | 'DB' | 'WORKSPACE_ID'>, email: string, now = Date.now()): Promise<Role | null> {
  const e = email.trim().toLowerCase();
  if (ownerEmails(env).has(e)) return 'owner';
  const hit = roles.get(e);
  if (hit && hit.until > now) return hit.role;
  let role: Role | null = null;
  try {
    const row = await env.DB.prepare('SELECT role FROM members WHERE ws_id = ? AND email = ?').bind(env.WORKSPACE_ID || 'local', e).first<{ role: string }>();
    role = isRole(row?.role) ? row.role : null;
  } catch {
    role = null; // an unmigrated database: owners only
  }
  roles.set(e, { role, until: now + SESSION_CACHE_MS });
  if (roles.size > 500) roles.delete(roles.keys().next().value as string);
  return role;
}

/** The lower of a role and the "view as" preview. */
function viewed(req: Request, actual: Role): Role {
  const want = readCookie(req, VIEW_AS_COOKIE);
  return isRole(want) && ROLE_RANK[want] < ROLE_RANK[actual] ? want : actual;
}

/** Who this request comes from, or null when it needs a session it does not have (or a member was removed). */
export async function identify(req: Request, env: Env, url: URL): Promise<Identity | null> {
  if (authMode(env, url) === 'off') return { email: '', name: '', role: viewed(req, 'owner'), actualRole: 'owner' };
  const session = await sessionFor(req, env);
  if (!session) return null;
  const actual = await roleFor(env, session.email);
  return actual ? { email: session.email, name: session.name, role: viewed(req, actual), actualRole: actual } : null;
}

const ROLE_REFUSAL: Record<Role, string> = {
  reader: 'Sign in to continue.',
  contributor: 'Readers can see everything but not change it. An owner can make you a contributor on the People page.',
  owner: 'Only an owner can change this. Ask an owner, or they can make you one on the People page.',
};

/**
 * The identity a request may go on with (null for a public read), or the 401/403 to answer. The least role comes
 * from the route table; paths outside it (/api/media/*) need a reader to read and a contributor to change.
 */
export async function authorize(req: Request, env: Env, url: URL, route: RouteId | null): Promise<{ identity: Identity | null } | Response> {
  const reading = req.method === 'GET' || req.method === 'HEAD';
  if (route && reading && (PUBLIC_ROUTES.has(route) || ROUTES[route].auth === 'public')) return { identity: null };
  const needed: Role = route ? (ROUTES[route].auth === 'public' ? 'reader' : (ROUTES[route].auth as Role)) : reading ? 'reader' : 'contributor';
  const identity = await identify(req, env, url);
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
    if (!who) return json({ mode, signedIn: false, role: 'reader' } satisfies Me);
    if (who.email)
      await env.DB.prepare('UPDATE members SET last_seen_at = ?, name = CASE WHEN name = \'\' THEN ? ELSE name END WHERE ws_id = ? AND email = ?')
        .bind(new Date().toISOString(), who.name, env.WORKSPACE_ID || 'local', who.email)
        .run()
        .catch(() => undefined);
    return json({ mode, signedIn: true, ...(who.email ? { email: who.email, name: who.name } : {}), role: who.role, ...(who.role !== who.actualRole ? { actualRole: who.actualRole } : {}) } satisfies Me);
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
    if (!(await roleFor(env, email))) return backToApp(origin, 'denied', secure);

    const session = token();
    const now = Date.now();
    await env.DB.prepare('INSERT INTO auth_sessions (token_hash, email, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await hash(session), email, (profile.name ?? '').slice(0, 120), now, now + SESSION_TTL_S * 1000)
      .run();
    return redirect(`${origin}${safeReturnTo(row.return_to)}`, [cookieHeader(SESSION_COOKIE, session, SESSION_TTL_S, secure), cookieHeader(STATE_COOKIE, '', 0, secure, '/api/auth')]);
  }

  return errorResponse('not_found', `No route for ${url.pathname}.`);
}
