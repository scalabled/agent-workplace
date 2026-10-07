// Who may talk to the worker. Inc 0 is a single-owner app on the owner's own machine, so the only callers are
// the app's own pages (Vite on the web port, or the worker origin itself) and local tools (curl, the portrait
// CLI, Playwright's request API), which send no Origin. Two browser attacks are closed here:
// - cross-site requests: WebSockets are not covered by CORS, and "text/plain" POSTs skip the preflight, so a
//   page on any site could otherwise read the owner feed or talk as the owner (CSRF);
// - DNS rebinding: a hostile name that resolves to 127.0.0.1 reaches the worker as "same origin", so the
//   Host header must be a loopback name (or a host the owner allowed).
import { BRAND } from '@headcount/protocol';
import type { RouteId } from '@headcount/protocol';
import { errorResponse } from './http';

/** Defaults when ALLOWED_ORIGINS is unset: the dev ports (`pnpm dev` passes the real ones). */
export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8787', 'http://127.0.0.1:8787'];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface OriginPolicy {
  origins: Set<string>;
  hosts: Set<string>;
}

/** ALLOWED_ORIGINS is a comma-separated list of origins ("http://localhost:5173,…"). Hosts: loopback + theirs. */
export function originPolicy(raw: string | undefined): OriginPolicy {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origins = new Set<string>();
  const hosts = new Set<string>(LOOPBACK_HOSTS);
  for (const entry of list.length ? list : DEFAULT_ALLOWED_ORIGINS) {
    try {
      const u = new URL(entry);
      origins.add(u.origin);
      hosts.add(u.hostname.toLowerCase());
    } catch {
      /* not an origin: ignored */
    }
  }
  return { origins, hosts };
}

/** Hostname of a Host header value ("localhost:5173" → "localhost", "[::1]:8787" → "[::1]"). */
export function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.replace(/:\d+$/, '');
}

/**
 * Host check only (DNS rebinding): the Host header and URL host must be loopback or an allowed host. Used alone for
 * the sign-in navigations (/api/auth/google and the Google callback), which are top-level GETs that arrive
 * cross-site by design (Sec-Fetch-Site: cross-site, no Origin) and are protected by the OAuth state instead.
 */
export function guardHost(req: Request, url: URL, policy: OriginPolicy): Response | null {
  const header = req.headers.get('host');
  for (const name of [header ? hostName(header) : null, url.hostname.toLowerCase()]) {
    if (name !== null && !policy.hosts.has(name)) return errorResponse('forbidden', `This address is not ${BRAND.name}. Open the app at its own address instead.`);
  }
  return null;
}

/**
 * Refuse requests that do not come from the app itself. Returns a 403 response, or null to go on.
 * - Host (header and URL) must be loopback or an allowed host: blocks DNS rebinding.
 * - A present Origin must be allowed ("null" never is): blocks cross-site fetches and sockets.
 * - Without an Origin, a browser's Sec-Fetch-Site must not say the request is cross-site.
 * - The WebSocket route requires an allowed Origin (browsers always send one on a handshake).
 */
export function guardRequest(req: Request, url: URL, route: RouteId | null, policy: OriginPolicy): Response | null {
  const badHost = guardHost(req, url, policy);
  if (badHost) return badHost;
  const origin = req.headers.get('origin');
  if (origin !== null) {
    if (!policy.origins.has(origin)) return errorResponse('forbidden', `Requests from other sites are not allowed. Open ${BRAND.name} itself, or add its address to ALLOWED_ORIGINS.`);
    return null;
  }
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return errorResponse('forbidden', 'Requests from other sites are not allowed.');
  if (route === 'ws') return errorResponse('forbidden', `Open the feed from the ${BRAND.name} app.`);
  return null;
}
