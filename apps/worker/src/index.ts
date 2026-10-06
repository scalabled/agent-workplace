// Headcount worker router (integrator-owned). Every route in @headcount/protocol ROUTES is registered
// here to a handler in its owner's directory; the Record<RouteId, …> type makes a missing handler a type error.
import { MissingProviderError, ProviderError, createRegistry, type Registry } from '@headcount/models';
import { homeWorkspace, withTenant } from './lib/tenant';
import { LandmarksError, ROUTES, matchRoute, type RouteDef, type RouteId } from '@headcount/protocol';
import type { Env } from './env';
import { handleCancelJob, handleGetJob, handleListJobs, handleSteerJob } from './jobs/routes';
import { handleHealth } from './lib/health';
import { handleDeskSay } from './desk/routes';
import { handleExprAgent, handleExprAlign, handleExprCatalog, handleExprClip, handleExprPrevoice, handleExprPrevoiceStatus, handleExprRender } from './expr/routes';
import { handleExprHuddleRender } from './expr/huddle-render';
import { HttpError, errorResponse, type RouteContext, type RouteHandler } from './lib/http';
import { guardHost, guardRequest, originPolicy, type OriginPolicy } from './lib/origin';
import { authorize, handleAuthRoute, isLoopback } from './auth/auth';
import { handleAdminConfig, handleAdminUsage, handleListMembers, handlePutAdminConfig, handlePutMember, handlePutPrices, handleRemoveMember } from './admin/routes';
import { handleApplyHandbookSuggestion, handleGetTeam, handlePutSecondBrain, handlePutTeam, handleStartTeamTask } from './team/routes';
import { handleListThreads, handleReplyThread, handleResolveThread, handleStartThread } from './threads/routes';
import { metered } from './usage/meter';
import { d1Sink } from './usage/store';
import { configured, loadConfig } from './admin/config';
import { handleCapabilities } from './media/capabilities';
import { handleMediaRoute } from './media/media-images';
import { handleGeneratePortrait, handleGetLandmarks, handleGetPortrait, handleListPortraits, handlePutLandmarks } from './media/portraits';
import { handleStt, handleTts } from './media/speech';
import { handleOfficePeople } from './rooms/people';
import { handleRoomCancel, handleRoomSay } from './rooms/routes';
import { handleAddStep, handleAnswerDecision, handleDiscuss, handleGetMeeting, handleMeetingSay, handleProjectMeetings, handlePostChannel, handleProjectChannel, handleApproveProject, handleCancelProject, handleEditPlan, handleEditStep, handleGetProject, handleListProjects, handleNoteProject, handlePauseProject, handleProjectRuns, handleRemoveStep, handleResumeProject, handleStopAll } from './projects/routes';
import { handleAddCard, handleAddMemory, handleCardFile, handleGetCard, handleGetHandbook, handleListCards, handleListMemory, handleGetMemory, handlePatchMemory, handlePutHandbook, handleRemoveCard, handleRemoveMemory, handleStartInterview, handleStopInterview } from './memory/routes';
import { handleCanvasSource, handleCreateCanvas, handleDownloadCanvas, handleGetCanvas, handleListCanvas, handlePrintCanvas, handleRemoveCanvas, handleRepairCanvas, handleRetryCanvas, handleReviseCanvas, handleViewCanvas } from './canvas/routes';
import { handleAddAutomation, handleListAutomations, handlePutAutomation, handleRemoveAutomation, handleRunAutomation } from './automations/routes';
import { handleAddConnector, handleListConnectors, handlePatchConnector, handleRemoveConnector, handleRevokeConnectorGrant, handleTestConnector } from './connectors/routes';
import { handleChiefPrompt, handleGetAgent, handleGetSkill, handleListModels, handleListSkills, handlePutAgent, handlePutSkill, handleResetAgent, handleRollbackSkill } from './agents/routes';
import { handleGetWorkspace, handlePutWorkspace, handleTalk, handleWs } from './workspace/routes';
import { handleCreateOrg, handleListOrgs, handlePlatformOrgs, handleRenameOrg, handleSwitchOrg } from './auth/orgs';
import { handleGetTrust, handleListAudit, handlePutAutonomy, handleResumeAll, handleRevokeGrant, handleTestEmail, handleTestMailbox, handleUndoAudit } from './trust/routes';

export { ProjectDO } from './jobs/project-do';
export { RoomDO } from './rooms/room-do';
export { RunDO } from './runs/run-do';
export { WorkspaceDO } from './workspace/workspace-do';

export const HANDLERS: Record<RouteId, RouteHandler> = {
  health: handleHealth,
  capabilities: handleCapabilities,
  getWorkspace: handleGetWorkspace,
  putWorkspace: handlePutWorkspace,
  ws: handleWs,
  talk: handleTalk,
  listJobs: handleListJobs,
  getJob: handleGetJob,
  steerJob: handleSteerJob,
  cancelJob: handleCancelJob,
  tts: handleTts,
  stt: handleStt,
  listPortraits: handleListPortraits,
  generatePortrait: handleGeneratePortrait,
  getPortrait: handleGetPortrait,
  getLandmarks: handleGetLandmarks,
  putLandmarks: handlePutLandmarks,
  exprCatalog: handleExprCatalog,
  exprAgent: handleExprAgent,
  exprClip: handleExprClip,
  exprAlign: handleExprAlign,
  exprRender: handleExprRender,
  exprPrevoice: handleExprPrevoice,
  exprPrevoiceStatus: handleExprPrevoiceStatus,
  deskSay: handleDeskSay,
  roomSay: handleRoomSay,
  roomCancel: handleRoomCancel,
  officePeople: handleOfficePeople,
  exprHuddleRender: handleExprHuddleRender,
  listProjects: handleListProjects,
  getProject: handleGetProject,
  approveProject: handleApproveProject,
  stopAll: handleStopAll,
  noteProject: handleNoteProject,
  pauseProject: handlePauseProject,
  resumeProject: handleResumeProject,
  answerDecision: handleAnswerDecision,
  editStep: handleEditStep,
  addStep: handleAddStep,
  removeStep: handleRemoveStep,
  editPlan: handleEditPlan,
  projectRuns: handleProjectRuns,
  projectChannel: handleProjectChannel,
  postChannel: handlePostChannel,
  discuss: handleDiscuss,
  getAgent: handleGetAgent,
  putAgent: handlePutAgent,
  resetAgent: handleResetAgent,
  listSkills: handleListSkills,
  getSkill: handleGetSkill,
  putSkill: handlePutSkill,
  rollbackSkill: handleRollbackSkill,
  chiefPrompt: handleChiefPrompt,
  listModels: handleListModels,
  cancelProject: handleCancelProject,
  listConnectors: handleListConnectors,
  addConnector: handleAddConnector,
  patchConnector: handlePatchConnector,
  removeConnector: handleRemoveConnector,
  testConnector: handleTestConnector,
  revokeConnectorGrant: handleRevokeConnectorGrant,
  listAutomations: handleListAutomations,
  addAutomation: handleAddAutomation,
  putAutomation: handlePutAutomation,
  removeAutomation: handleRemoveAutomation,
  runAutomation: handleRunAutomation,
  projectMeetings: handleProjectMeetings,
  getMeeting: handleGetMeeting,
  meetingSay: handleMeetingSay,
  listCanvas: handleListCanvas,
  createCanvas: handleCreateCanvas,
  getCanvas: handleGetCanvas,
  reviseCanvas: handleReviseCanvas,
  repairCanvas: handleRepairCanvas,
  retryCanvas: handleRetryCanvas,
  removeCanvas: handleRemoveCanvas,
  viewCanvas: handleViewCanvas,
  downloadCanvas: handleDownloadCanvas,
  printCanvas: handlePrintCanvas,
  canvasSource: handleCanvasSource,
  listMemory: handleListMemory,
  addMemory: handleAddMemory,
  getMemory: handleGetMemory,
  cardFile: handleCardFile,
  patchMemory: handlePatchMemory,
  removeMemory: handleRemoveMemory,
  getHandbook: handleGetHandbook,
  putHandbook: handlePutHandbook,
  startInterview: handleStartInterview,
  stopInterview: handleStopInterview,
  listCards: handleListCards,
  addCard: handleAddCard,
  getCard: handleGetCard,
  removeCard: handleRemoveCard,
  getTeam: handleGetTeam,
  putTeam: handlePutTeam,
  startTeamTask: handleStartTeamTask,
  putSecondBrain: handlePutSecondBrain,
  applyHandbookSuggestion: handleApplyHandbookSuggestion,
  listThreads: handleListThreads,
  startThread: handleStartThread,
  replyThread: handleReplyThread,
  resolveThread: handleResolveThread,
  adminConfig: handleAdminConfig,
  putAdminConfig: handlePutAdminConfig,
  listMembers: handleListMembers,
  putMember: handlePutMember,
  removeMember: handleRemoveMember,
  adminUsage: handleAdminUsage,
  putPrices: handlePutPrices,
  listOrgs: handleListOrgs,
  createOrg: handleCreateOrg,
  switchOrg: handleSwitchOrg,
  renameOrg: handleRenameOrg,
  platformOrgs: handlePlatformOrgs,
  getTrust: handleGetTrust,
  putAutonomy: handlePutAutonomy,
  revokeGrant: handleRevokeGrant,
  listAudit: handleListAudit,
  undoAudit: handleUndoAudit,
  resumeAll: handleResumeAll,
  testMailbox: handleTestMailbox,
  testEmail: handleTestEmail,
};

/** Reject bodies over the route's cap before the handler runs (Content-Length, or by counting a streamed body). */
async function enforceBodyCap(req: Request, cap: number | undefined): Promise<Request | Response> {
  if (cap === undefined || req.method === 'GET' || req.method === 'HEAD' || !req.body) return req;
  const tooLarge = () => errorResponse('payload_too_large', `The request body is over ${cap} bytes.`);
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) return tooLarge();
  if (req.headers.has('content-length')) return req;
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return tooLarge();
    }
    parts.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    body.set(p, offset);
    offset += p.byteLength;
  }
  return new Request(req, { body });
}

let cachedPolicy: { raw: string | undefined; policy: OriginPolicy } | null = null;
function policyFor(env: Env): OriginPolicy {
  if (!cachedPolicy || cachedPolicy.raw !== env.ALLOWED_ORIGINS) cachedPolicy = { raw: env.ALLOWED_ORIGINS, policy: originPolicy(env.ALLOWED_ORIGINS) };
  return cachedPolicy.policy;
}

export async function handle(request: Request, deployed: Env, ctx: ExecutionContext): Promise<Response> {
  let route: RouteId | 'router' = 'router';
  // Sign-in and the origin guard read the deployment's own settings; everything after works for the organization.
  let env: Env = deployed;
  // Everything, including matching (a malformed %-escape) and the body cap (an aborted upload), answers an ApiErrorBody.
  try {
    const url = new URL(request.url);
    // Deployed, Workers Static Assets serves everything outside /api (run_worker_first: ["/api/*"]); in dev, Vite does.
    if (!url.pathname.startsWith('/api/')) return errorResponse('not_found', 'Nothing here.');
    const found = matchRoute(request.method, url.pathname);
    const routeId = found && 'match' in found ? found.match.id : null;
    // The sign-in navigations are cross-site by design (Google redirects back): host check only; the OAuth state
    // protects them. Everything else: only the app itself may call (no CSRF, no cross-site feed, no rebound hosts).
    const signInNav = url.pathname === '/api/auth/google' || url.pathname === '/api/auth/callback';
    const denied = signInNav ? guardHost(request, url, policyFor(env)) : guardRequest(request, url, routeId, policyFor(env));
    if (denied) return denied;
    // /api/auth/* (sign-in, outside the protocol table).
    const auth = await handleAuthRoute(request, url, env);
    if (auth) return auth;
    // Every other route needs a session unless it is public (health, the landing's read-only portraits) or the
    // host is loopback with sign-in off (local dev). Fails closed on any deployed host.
    const allowed = await authorize(request, env, url, routeId);
    if (allowed instanceof Response) return allowed;
    // From here the request works for the person's organization (its Durable Objects, rows and files), with that
    // organization's settings from the admin page over the deployment's (cached; read again every few seconds).
    const tenant = withTenant(deployed, allowed.identity?.orgId ?? homeWorkspace(deployed));
    await loadConfig(tenant);
    env = configured(tenant);
    // /api/media/* (media-owned, outside the protocol table): POST /api/media/image, GET /api/media/:key.
    if (!found) {
      // Generic image generation is tooling (marketing art): loopback dev, or ENABLE_MEDIA_TOOLS=true, only.
      if (url.pathname === '/api/media/image' && !isLoopback(url.hostname) && env.ENABLE_MEDIA_TOOLS !== 'true') return errorResponse('not_found', `No route for ${url.pathname}.`);
      return (await handleMediaRoute(request, url, env)) ?? errorResponse('not_found', `No route for ${url.pathname}.`);
    }
    if ('allowed' in found) return errorResponse('method_not_allowed', `Use ${found.allowed.join(' or ')} for ${url.pathname}.`, { headers: { allow: found.allowed.join(', ') } });

    const { id, params } = found.match;
    route = id;
    const def: RouteDef = ROUTES[id];
    const capped = await enforceBodyCap(request, def.bodyCap);
    if (capped instanceof Response) return capped;

    let registry: Registry | undefined;
    const rc: RouteContext = { env, identity: allowed.identity, ...(allowed.account !== undefined ? { account: allowed.account } : {}), ctx, route: id, params, url, registry: () => (registry ??= metered(createRegistry(env), d1Sink(env), { surface: id === 'generatePortrait' ? 'image' : 'speech' })) };
    return await HANDLERS[id](capped, rc);
  } catch (err) {
    return toErrorResponse(err, route);
  }
}

export function toErrorResponse(err: unknown, route: RouteId | 'router'): Response {
  if (err instanceof HttpError) return errorResponse(err.code, err.message, { status: err.status, ...(err.extra.missingKeys ? { missingKeys: err.extra.missingKeys } : {}), ...(err.extra.opId ? { opId: err.extra.opId } : {}) });
  if (err instanceof MissingProviderError) return errorResponse('not_configured', err.message, { missingKeys: err.missingKeys });
  if (err instanceof LandmarksError) return errorResponse('bad_request', err.message);
  if (err instanceof ProviderError) return errorResponse('provider_error', `The ${err.provider} provider failed. Try again in a moment.`);
  // Log the message only (never request bodies or env): keys must not reach logs.
  console.error(`[${route}]`, err instanceof Error ? err.message : String(err));
  return errorResponse('internal', 'Something went wrong on our side. Try again.');
}

export default {
  fetch: handle,
} satisfies ExportedHandler<Env>;
