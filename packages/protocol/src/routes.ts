/**
 * The Inc 0 route table (ARCHITECTURE §2.1 policy table, trimmed). The worker router registers a
 * handler for every id here (a typed Record<RouteId, …>, so a missing handler fails typecheck), and
 * the web client builds URLs from it. Unlisted /api/* paths are 404.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** A member's role (ext/admin.ts): owner > contributor > reader. */
export type Role = 'owner' | 'contributor' | 'reader';

export interface RouteDef {
  method: HttpMethod;
  /** Express-style pattern; `:name` segments become params. */
  path: string;
  /**
   * Who may call it: anyone (`public`), any signed-in person whether or not they belong to an organization yet
   * (`account`: their organizations), the deployment's owners (`platform`), or a member of the current organization
   * with at least this role (readers read, contributors work with the team, owners configure). Local mode (loopback,
   * sign-in off) is the owner.
   */
  auth: 'public' | 'account' | 'platform' | Role;
  /** Max request body in bytes (enforced by the router before the handler runs). */
  bodyCap?: number;
  /** Request body content type the router accepts. */
  body?: 'json' | 'binary';
  /** WebSocket upgrade route. */
  upgrade?: 'websocket';
}

export const ROUTES = {
  health: { method: 'GET', path: '/api/health', auth: 'public' },
  capabilities: { method: 'GET', path: '/api/capabilities', auth: 'reader' },
  getWorkspace: { method: 'GET', path: '/api/workspace', auth: 'reader' },
  putWorkspace: { method: 'PUT', path: '/api/workspace', auth: 'owner', body: 'json', bodyCap: 4 * 1024 },
  ws: { method: 'GET', path: '/api/ws', auth: 'reader', upgrade: 'websocket' },
  talk: { method: 'POST', path: '/api/talk', auth: 'contributor', body: 'json', bodyCap: 64 * 1024 },
  listJobs: { method: 'GET', path: '/api/jobs', auth: 'reader' },
  getJob: { method: 'GET', path: '/api/jobs/:id', auth: 'reader' },
  steerJob: { method: 'POST', path: '/api/jobs/:id/steer', auth: 'contributor', body: 'json', bodyCap: 16 * 1024 },
  cancelJob: { method: 'POST', path: '/api/jobs/:id/cancel', auth: 'contributor', bodyCap: 1024 },
  // Inc 1 team projects (ext/projects.ts).
  listProjects: { method: 'GET', path: '/api/projects', auth: 'reader' },
  getProject: { method: 'GET', path: '/api/projects/:id', auth: 'reader' },
  approveProject: { method: 'POST', path: '/api/projects/:id/approve', auth: 'contributor', bodyCap: 1024 },
  cancelProject: { method: 'POST', path: '/api/projects/:id/cancel', auth: 'contributor', bodyCap: 1024 },
  noteProject: { method: 'POST', path: '/api/projects/:id/note', auth: 'contributor', bodyCap: 4096 },
  pauseProject: { method: 'POST', path: '/api/projects/:id/pause', auth: 'contributor', bodyCap: 1024 },
  resumeProject: { method: 'POST', path: '/api/projects/:id/resume', auth: 'contributor', bodyCap: 1024 },
  stopAll: { method: 'POST', path: '/api/stop-all', auth: 'contributor', bodyCap: 1024 },
  // Parity stage 3: decisions, plan editing and the run inspector.
  answerDecision: { method: 'POST', path: '/api/decisions/:id', auth: 'contributor', body: 'json', bodyCap: 8 * 1024 },
  editStep: { method: 'PUT', path: '/api/projects/:id/steps/:stepId', auth: 'contributor', body: 'json', bodyCap: 16 * 1024 },
  addStep: { method: 'POST', path: '/api/projects/:id/steps', auth: 'contributor', body: 'json', bodyCap: 16 * 1024 },
  removeStep: { method: 'DELETE', path: '/api/projects/:id/steps/:stepId', auth: 'contributor' },
  editPlan: { method: 'PUT', path: '/api/projects/:id/plan', auth: 'contributor', body: 'json', bodyCap: 4 * 1024 },
  projectRuns: { method: 'GET', path: '/api/projects/:id/runs', auth: 'reader' },
  // Parity stage 4: the team channel and discussions.
  projectChannel: { method: 'GET', path: '/api/projects/:id/channel', auth: 'reader' },
  postChannel: { method: 'POST', path: '/api/projects/:id/channel', auth: 'contributor', body: 'json', bodyCap: 8 * 1024 },
  discuss: { method: 'POST', path: '/api/projects/:id/discuss', auth: 'contributor', body: 'json', bodyCap: 4 * 1024 },
  // Inc 2: meetings (ext/projects.ts).
  projectMeetings: { method: 'GET', path: '/api/projects/:id/meetings', auth: 'reader' },
  getMeeting: { method: 'GET', path: '/api/projects/:id/meetings/:meetingId', auth: 'reader' },
  meetingSay: { method: 'POST', path: '/api/projects/:id/meetings/:meetingId/say', auth: 'contributor', body: 'json', bodyCap: 4 * 1024 },
  // Meetings across the office: live first, then the latest; call one about a project or on its own.
  listMeetings: { method: 'GET', path: '/api/meetings', auth: 'reader' },
  callMeeting: { method: 'POST', path: '/api/meetings', auth: 'contributor', body: 'json', bodyCap: 8 * 1024 },
  findMeeting: { method: 'GET', path: '/api/meetings/:meetingId', auth: 'reader' },
  // Files (ext/files.ts): images and videos made here, per organization; Markdown documents as Word, Excel or PowerPoint.
  listFiles: { method: 'GET', path: '/api/files', auth: 'reader' },
  getFile: { method: 'GET', path: '/api/files/:fileName', auth: 'reader' },
  makeImage: { method: 'POST', path: '/api/files/image', auth: 'contributor', body: 'json', bodyCap: 8 * 1024 },
  makeVideo: { method: 'POST', path: '/api/files/video', auth: 'contributor', body: 'json', bodyCap: 8 * 1024 },
  removeFile: { method: 'DELETE', path: '/api/files/:fileName', auth: 'contributor' },
  exportDocument: { method: 'POST', path: '/api/export', auth: 'reader', body: 'json', bodyCap: 512 * 1024 },
  // Parity stage 5: MCP connectors (ext/connectors.ts).
  listConnectors: { method: 'GET', path: '/api/connectors', auth: 'reader' },
  addConnector: { method: 'POST', path: '/api/connectors', auth: 'owner', body: 'json', bodyCap: 8 * 1024 },
  patchConnector: { method: 'PUT', path: '/api/connectors/:id', auth: 'owner', body: 'json', bodyCap: 8 * 1024 },
  removeConnector: { method: 'DELETE', path: '/api/connectors/:id', auth: 'owner' },
  testConnector: { method: 'POST', path: '/api/connectors/:id/test', auth: 'owner', bodyCap: 1024 },
  revokeConnectorGrant: { method: 'DELETE', path: '/api/connectors/:id/grants/:grantId', auth: 'owner' },
  // The canvas (ext/canvas.ts): apps and documents built from a brief, served sandboxed.
  listCanvas: { method: 'GET', path: '/api/canvas', auth: 'reader' },
  createCanvas: { method: 'POST', path: '/api/canvas', auth: 'contributor', body: 'json', bodyCap: 8 * 1024 },
  getCanvas: { method: 'GET', path: '/api/canvas/:id', auth: 'reader' },
  reviseCanvas: { method: 'POST', path: '/api/canvas/:id/revise', auth: 'contributor', body: 'json', bodyCap: 8 * 1024 },
  repairCanvas: { method: 'POST', path: '/api/canvas/:id/repair', auth: 'contributor', body: 'json', bodyCap: 8 * 1024 },
  retryCanvas: { method: 'POST', path: '/api/canvas/:id/retry', auth: 'contributor', bodyCap: 1024 },
  removeCanvas: { method: 'DELETE', path: '/api/canvas/:id', auth: 'contributor' },
  viewCanvas: { method: 'GET', path: '/api/canvas/:id/view', auth: 'reader' },
  downloadCanvas: { method: 'GET', path: '/api/canvas/:id/download', auth: 'reader' },
  printCanvas: { method: 'GET', path: '/api/canvas/:id/print', auth: 'reader' },
  canvasSource: { method: 'GET', path: '/api/canvas/:id/source', auth: 'reader' },
  // Inc 4: context and memory (ext/memory.ts).
  listMemory: { method: 'GET', path: '/api/memory', auth: 'reader' },
  addMemory: { method: 'POST', path: '/api/memory', auth: 'contributor', body: 'json', bodyCap: 4 * 1024 },
  getMemory: { method: 'GET', path: '/api/memory/:id', auth: 'reader' },
  patchMemory: { method: 'PUT', path: '/api/memory/:id', auth: 'contributor', body: 'json', bodyCap: 4 * 1024 },
  removeMemory: { method: 'DELETE', path: '/api/memory/:id', auth: 'contributor' },
  getHandbook: { method: 'GET', path: '/api/handbook', auth: 'reader' },
  putHandbook: { method: 'PUT', path: '/api/handbook/:section', auth: 'contributor', body: 'json', bodyCap: 16 * 1024 },
  startInterview: { method: 'POST', path: '/api/handbook/interview', auth: 'contributor', bodyCap: 1024 },
  stopInterview: { method: 'DELETE', path: '/api/handbook/interview', auth: 'contributor' },
  listCards: { method: 'GET', path: '/api/cards', auth: 'reader' },
  addCard: { method: 'POST', path: '/api/cards', auth: 'contributor', body: 'binary', bodyCap: 10 * 1024 * 1024 },
  getCard: { method: 'GET', path: '/api/cards/:id', auth: 'reader' },
  cardFile: { method: 'GET', path: '/api/cards/:id/file', auth: 'reader' },
  removeCard: { method: 'DELETE', path: '/api/cards/:id', auth: 'contributor' },
  // Parity stage 3b: automations (ext/automations.ts).
  listAutomations: { method: 'GET', path: '/api/automations', auth: 'reader' },
  addAutomation: { method: 'POST', path: '/api/automations', auth: 'owner', body: 'json', bodyCap: 16 * 1024 },
  putAutomation: { method: 'PUT', path: '/api/automations/:id', auth: 'owner', body: 'json', bodyCap: 16 * 1024 },
  removeAutomation: { method: 'DELETE', path: '/api/automations/:id', auth: 'owner' },
  runAutomation: { method: 'POST', path: '/api/automations/:id/run', auth: 'contributor', bodyCap: 1024 },
  // Parity stage 2: agent configuration and transparency (ext/agents.ts).
  getAgent: { method: 'GET', path: '/api/agents/:personaId', auth: 'reader' },
  putAgent: { method: 'PUT', path: '/api/agents/:personaId', auth: 'owner', body: 'json', bodyCap: 24 * 1024 },
  resetAgent: { method: 'POST', path: '/api/agents/:personaId/reset', auth: 'owner', bodyCap: 1024 },
  listSkills: { method: 'GET', path: '/api/skills', auth: 'reader' },
  getSkill: { method: 'GET', path: '/api/skills/:id', auth: 'reader' },
  putSkill: { method: 'PUT', path: '/api/skills/:id', auth: 'owner', body: 'json', bodyCap: 32 * 1024 },
  rollbackSkill: { method: 'POST', path: '/api/skills/:id/rollback', auth: 'owner', body: 'json', bodyCap: 1024 },
  chiefPrompt: { method: 'GET', path: '/api/chief/prompt', auth: 'reader' },
  listModels: { method: 'GET', path: '/api/models', auth: 'reader' },
  tts: { method: 'POST', path: '/api/speech/tts', auth: 'reader', body: 'json', bodyCap: 32 * 1024 },
  stt: { method: 'POST', path: '/api/speech/stt', auth: 'contributor', body: 'binary', bodyCap: 10 * 1024 * 1024 },
  listPortraits: { method: 'GET', path: '/api/portraits', auth: 'public' },
  // Portraits are shared by every organization: only the deployment's owners make them (local mode: the owner).
  generatePortrait: { method: 'POST', path: '/api/portraits/:personaId/generate', auth: 'platform', bodyCap: 4 * 1024 },
  getPortrait: { method: 'GET', path: '/api/portraits/:personaId', auth: 'public' },
  getLandmarks: { method: 'GET', path: '/api/portraits/:personaId/landmarks', auth: 'public' },
  putLandmarks: { method: 'PUT', path: '/api/portraits/:personaId/landmarks', auth: 'owner', body: 'json', bodyCap: 110 * 1024 },
  // Inc 0.5 living workforce (ext/expressions.ts).
  exprCatalog: { method: 'GET', path: '/api/expr/catalog', auth: 'reader' },
  exprAgent: { method: 'GET', path: '/api/expr/agents/:agentId', auth: 'reader' },
  exprClip: { method: 'GET', path: '/api/expr/clips/:clipKey', auth: 'reader' },
  exprAlign: { method: 'GET', path: '/api/expr/clips/:clipKey/align', auth: 'reader' },
  exprRender: { method: 'POST', path: '/api/expr/render', auth: 'reader', body: 'json', bodyCap: 8 * 1024 },
  exprPrevoice: { method: 'POST', path: '/api/expr/prevoice', auth: 'owner', body: 'json', bodyCap: 128 * 1024 },
  exprPrevoiceStatus: { method: 'GET', path: '/api/expr/prevoice/:runId', auth: 'reader' },
  deskSay: { method: 'POST', path: '/api/desk/:personaId/say', auth: 'contributor', body: 'json', bodyCap: 16 * 1024 },
  // Office Phase 2 (ext/rooms.ts). `:roomId` is `skyline`, `garden` or `huddle:<hash>` (routePath URI-encodes the colon).
  roomSay: { method: 'POST', path: '/api/rooms/:roomId/say', auth: 'contributor', body: 'json', bodyCap: 16 * 1024 },
  roomCancel: { method: 'POST', path: '/api/rooms/:roomId/cancel', auth: 'contributor', body: 'json', bodyCap: 4 * 1024 },
  officePeople: { method: 'GET', path: '/api/office/people', auth: 'reader' },
  exprHuddleRender: { method: 'POST', path: '/api/expr/huddle/render', auth: 'reader', body: 'json', bodyCap: 8 * 1024 },
  // Your team (ext/team.ts): meet them, start their first jobs, the weekly second-brain tidy.
  getTeam: { method: 'GET', path: '/api/team', auth: 'reader' },
  suggestHires: { method: 'GET', path: '/api/team/suggest', auth: 'reader' },
  hire: { method: 'POST', path: '/api/team/hire', auth: 'owner', body: 'json', bodyCap: 4 * 1024 },
  letGo: { method: 'DELETE', path: '/api/team/:personaId', auth: 'owner' },
  putTeam: { method: 'PUT', path: '/api/team', auth: 'owner', body: 'json', bodyCap: 4 * 1024 },
  startTeamTask: { method: 'POST', path: '/api/team/:personaId/start', auth: 'contributor', bodyCap: 1024 },
  putSecondBrain: { method: 'PUT', path: '/api/team/second-brain', auth: 'owner', body: 'json', bodyCap: 1024 },
  applyHandbookSuggestion: { method: 'POST', path: '/api/team/second-brain/handbook', auth: 'contributor', body: 'json', bodyCap: 8 * 1024 },
  // Side chats in documents (ext/threads.ts): ask about a passage, pinned to that spot.
  listThreads: { method: 'GET', path: '/api/threads', auth: 'reader' },
  startThread: { method: 'POST', path: '/api/threads', auth: 'contributor', body: 'json', bodyCap: 8 * 1024 },
  replyThread: { method: 'POST', path: '/api/threads/:id', auth: 'contributor', body: 'json', bodyCap: 8 * 1024 },
  resolveThread: { method: 'PUT', path: '/api/threads/:id', auth: 'contributor', body: 'json', bodyCap: 1024 },
  // Admin (ext/admin.ts): every setting, people and roles, token usage.
  adminConfig: { method: 'GET', path: '/api/admin/config', auth: 'owner' },
  putAdminConfig: { method: 'PUT', path: '/api/admin/config', auth: 'owner', body: 'json', bodyCap: 32 * 1024 },
  listMembers: { method: 'GET', path: '/api/admin/members', auth: 'owner' },
  putMember: { method: 'PUT', path: '/api/admin/members/:email', auth: 'owner', body: 'json', bodyCap: 2 * 1024 },
  removeMember: { method: 'DELETE', path: '/api/admin/members/:email', auth: 'owner' },
  adminUsage: { method: 'GET', path: '/api/admin/usage', auth: 'owner' },
  putPrices: { method: 'PUT', path: '/api/admin/prices', auth: 'owner', body: 'json', bodyCap: 32 * 1024 },
  // Organizations (ext/orgs.ts): start one, switch between them, rename; the platform page for the deployment's owners.
  listOrgs: { method: 'GET', path: '/api/orgs', auth: 'account' },
  createOrg: { method: 'POST', path: '/api/orgs', auth: 'account', body: 'json', bodyCap: 2 * 1024 },
  switchOrg: { method: 'POST', path: '/api/orgs/:id/switch', auth: 'account', bodyCap: 1024 },
  renameOrg: { method: 'PUT', path: '/api/org', auth: 'owner', body: 'json', bodyCap: 2 * 1024 },
  platformOrgs: { method: 'GET', path: '/api/platform/orgs', auth: 'platform' },
  // Inc 6 trust (ext/trust.ts): the autonomy dial, grants, the audit trail with Undo, email, resuming after Everyone stop.
  getTrust: { method: 'GET', path: '/api/trust', auth: 'reader' },
  putAutonomy: { method: 'PUT', path: '/api/trust/autonomy', auth: 'owner', body: 'json', bodyCap: 1024 },
  revokeGrant: { method: 'DELETE', path: '/api/trust/grants/:id', auth: 'owner' },
  listAudit: { method: 'GET', path: '/api/audit', auth: 'owner' },
  undoAudit: { method: 'POST', path: '/api/audit/:id/undo', auth: 'owner', bodyCap: 1024 },
  resumeAll: { method: 'POST', path: '/api/resume-all', auth: 'owner', bodyCap: 1024 },
  testMailbox: { method: 'GET', path: '/api/email/test-mailbox', auth: 'owner' },
  testEmail: { method: 'POST', path: '/api/email/test', auth: 'owner', body: 'json', bodyCap: 2 * 1024 },
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
