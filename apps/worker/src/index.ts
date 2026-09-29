// Headcount worker router (integrator-owned). Every Inc 0 route in @headcount/protocol ROUTES is registered
// here to a handler in its owner's directory; the Record<RouteId, …> type makes a missing handler a type error.
import { MissingProviderError, ProviderError, createRegistry, type Registry } from '@headcount/models';
import { LandmarksError, ROUTES, matchRoute, type RouteDef, type RouteId } from '@headcount/protocol';
import type { Env } from './env';
import { handleCancelJob, handleGetJob, handleListJobs, handleSteerJob } from './jobs/routes';
import { handleHealth } from './lib/health';
import { HttpError, errorResponse, type RouteContext, type RouteHandler } from './lib/http';
import { guardRequest, originPolicy, type OriginPolicy } from './lib/origin';
import { handleCapabilities } from './media/capabilities';
import { handleMediaRoute } from './media/media-images';
import { handleGeneratePortrait, handleGetLandmarks, handleGetPortrait, handleListPortraits, handlePutLandmarks } from './media/portraits';
import { handleStt, handleTts } from './media/speech';
import { handleGetWorkspace, handlePutWorkspace, handleTalk, handleWs } from './workspace/routes';

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

export async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let route: RouteId | 'router' = 'router';
  // Everything, including matching (a malformed %-escape) and the body cap (an aborted upload), answers an ApiErrorBody.
  try {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return errorResponse('not_found', 'Nothing here. The app is served by Vite on :5173 in dev.');
    const found = matchRoute(request.method, url.pathname);
    // Only the app itself may call: no cross-site pages (CSRF, the feed socket) and no rebound host names.
    const denied = guardRequest(request, url, found && 'match' in found ? found.match.id : null, policyFor(env));
    if (denied) return denied;
    // /api/media/* (media-owned, outside the protocol table): POST /api/media/image, GET /api/media/:key.
    if (!found) return (await handleMediaRoute(request, url, env)) ?? errorResponse('not_found', `No route for ${url.pathname}.`);
    if ('allowed' in found) return errorResponse('method_not_allowed', `Use ${found.allowed.join(' or ')} for ${url.pathname}.`, { headers: { allow: found.allowed.join(', ') } });

    const { id, params } = found.match;
    route = id;
    const def: RouteDef = ROUTES[id];
    const capped = await enforceBodyCap(request, def.bodyCap);
    if (capped instanceof Response) return capped;

    let registry: Registry | undefined;
    const rc: RouteContext = { env, ctx, route: id, params, url, registry: () => (registry ??= createRegistry(env)) };
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
