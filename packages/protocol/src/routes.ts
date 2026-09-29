/**
 * The Inc 0 route table (ARCHITECTURE §2.1 policy table, trimmed). The worker router registers a
 * handler for every id here (a typed Record<RouteId, …>, so a missing handler fails typecheck), and
 * the web client builds URLs from it. Unlisted /api/* paths are 404.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RouteDef {
  method: HttpMethod;
  /** Express-style pattern; `:name` segments become params. */
  path: string;
  /** Inc 0 is single-owner local mode: `owner` routes are open locally and session-gated later. */
  auth: 'public' | 'owner';
  /** Max request body in bytes (enforced by the router before the handler runs). */
  bodyCap?: number;
  /** Request body content type the router accepts. */
  body?: 'json' | 'binary';
  /** WebSocket upgrade route. */
  upgrade?: 'websocket';
}

export const ROUTES = {
  health: { method: 'GET', path: '/api/health', auth: 'public' },
  capabilities: { method: 'GET', path: '/api/capabilities', auth: 'owner' },
  getWorkspace: { method: 'GET', path: '/api/workspace', auth: 'owner' },
  putWorkspace: { method: 'PUT', path: '/api/workspace', auth: 'owner', body: 'json', bodyCap: 4 * 1024 },
  ws: { method: 'GET', path: '/api/ws', auth: 'owner', upgrade: 'websocket' },
  talk: { method: 'POST', path: '/api/talk', auth: 'owner', body: 'json', bodyCap: 64 * 1024 },
  listJobs: { method: 'GET', path: '/api/jobs', auth: 'owner' },
  getJob: { method: 'GET', path: '/api/jobs/:id', auth: 'owner' },
  steerJob: { method: 'POST', path: '/api/jobs/:id/steer', auth: 'owner', body: 'json', bodyCap: 16 * 1024 },
  cancelJob: { method: 'POST', path: '/api/jobs/:id/cancel', auth: 'owner', bodyCap: 1024 },
  // Inc 1 team projects (ext/projects.ts).
  listProjects: { method: 'GET', path: '/api/projects', auth: 'owner' },
  getProject: { method: 'GET', path: '/api/projects/:id', auth: 'owner' },
  approveProject: { method: 'POST', path: '/api/projects/:id/approve', auth: 'owner', bodyCap: 1024 },
  cancelProject: { method: 'POST', path: '/api/projects/:id/cancel', auth: 'owner', bodyCap: 1024 },
  noteProject: { method: 'POST', path: '/api/projects/:id/note', auth: 'owner', bodyCap: 4096 },
  pauseProject: { method: 'POST', path: '/api/projects/:id/pause', auth: 'owner', bodyCap: 1024 },
  resumeProject: { method: 'POST', path: '/api/projects/:id/resume', auth: 'owner', bodyCap: 1024 },
  stopAll: { method: 'POST', path: '/api/stop-all', auth: 'owner', bodyCap: 1024 },
  tts: { method: 'POST', path: '/api/speech/tts', auth: 'owner', body: 'json', bodyCap: 32 * 1024 },
  stt: { method: 'POST', path: '/api/speech/stt', auth: 'owner', body: 'binary', bodyCap: 10 * 1024 * 1024 },
  listPortraits: { method: 'GET', path: '/api/portraits', auth: 'owner' },
  generatePortrait: { method: 'POST', path: '/api/portraits/:personaId/generate', auth: 'owner', bodyCap: 4 * 1024 },
  getPortrait: { method: 'GET', path: '/api/portraits/:personaId', auth: 'owner' },
  getLandmarks: { method: 'GET', path: '/api/portraits/:personaId/landmarks', auth: 'owner' },
  putLandmarks: { method: 'PUT', path: '/api/portraits/:personaId/landmarks', auth: 'owner', body: 'json', bodyCap: 110 * 1024 },
  // Inc 0.5 living workforce (ext/expressions.ts).
  exprCatalog: { method: 'GET', path: '/api/expr/catalog', auth: 'owner' },
  exprAgent: { method: 'GET', path: '/api/expr/agents/:agentId', auth: 'owner' },
  exprClip: { method: 'GET', path: '/api/expr/clips/:clipKey', auth: 'owner' },
  exprAlign: { method: 'GET', path: '/api/expr/clips/:clipKey/align', auth: 'owner' },
  exprRender: { method: 'POST', path: '/api/expr/render', auth: 'owner', body: 'json', bodyCap: 8 * 1024 },
  exprPrevoice: { method: 'POST', path: '/api/expr/prevoice', auth: 'owner', body: 'json', bodyCap: 128 * 1024 },
  exprPrevoiceStatus: { method: 'GET', path: '/api/expr/prevoice/:runId', auth: 'owner' },
  deskSay: { method: 'POST', path: '/api/desk/:personaId/say', auth: 'owner', body: 'json', bodyCap: 16 * 1024 },
  // Office Phase 2 (ext/rooms.ts). `:roomId` is `skyline`, `garden` or `huddle:<hash>` (routePath URI-encodes the colon).
  roomSay: { method: 'POST', path: '/api/rooms/:roomId/say', auth: 'owner', body: 'json', bodyCap: 16 * 1024 },
  roomCancel: { method: 'POST', path: '/api/rooms/:roomId/cancel', auth: 'owner', body: 'json', bodyCap: 4 * 1024 },
  officePeople: { method: 'GET', path: '/api/office/people', auth: 'owner' },
  exprHuddleRender: { method: 'POST', path: '/api/expr/huddle/render', auth: 'owner', body: 'json', bodyCap: 8 * 1024 },
} as const satisfies Record<string, RouteDef>;

export type RouteId = keyof typeof ROUTES;
export const ROUTE_IDS = Object.keys(ROUTES) as RouteId[];

type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

/** Params required by a route, e.g. RouteParams<'steerJob'> = { id: string }. */
export type RouteParams<R extends RouteId> = { [K in ParamNames<(typeof ROUTES)[R]['path']>]: string };

/** Build a concrete path: `routePath('steerJob', { id })` → `/api/jobs/job_…/steer`. Params are URI-encoded. */
export function routePath<R extends RouteId>(id: R, params?: RouteParams<R>): string {
  const p = (params ?? {}) as Record<string, string>;
  return ROUTES[id].path.replace(/:([A-Za-z_]+)/g, (_m, name: string) => {
    const v = p[name];
    if (v === undefined) throw new Error(`routePath(${id}): missing param ${name}`);
    return encodeURIComponent(v);
  });
}

export interface RouteMatch {
  id: RouteId;
  params: Record<string, string>;
}

const compiled = ROUTE_IDS.map((id) => {
  const names: string[] = [];
  const source = ROUTES[id].path.replace(/:([A-Za-z_]+)/g, (_m, name: string) => {
    names.push(name);
    return '([^/]+)';
  });
  return { id, re: new RegExp(`^${source}/?$`), names };
});

function decodeParam(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null; // a malformed %-escape: no route, never an uncaught URIError
  }
}

/**
 * Match a pathname against the table. Returns `{ match }` when the path and method match,
 * `{ allowed }` when the path exists under other methods (→ 405), or null (→ 404, also for a param
 * that is not valid percent-encoding).
 */
export function matchRoute(method: string, pathname: string): { match: RouteMatch } | { allowed: HttpMethod[] } | null {
  const allowed: HttpMethod[] = [];
  for (const r of compiled) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    const def = ROUTES[r.id];
    if (def.method !== method.toUpperCase()) {
      allowed.push(def.method);
      continue;
    }
    const params: Record<string, string> = {};
    let valid = true;
    r.names.forEach((n, i) => {
      const v = decodeParam(m[i + 1]!);
      if (v === null) valid = false;
      else params[n] = v;
    });
    if (!valid) return null;
    return { match: { id: r.id, params } };
  }
  return allowed.length ? { allowed } : null;
}
