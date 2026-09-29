import type { ApiErrorBody, ErrorCode, RouteId } from '@headcount/protocol';
import type { Registry } from '@headcount/models';
import type { Env } from '../env';

/** Per-request context handed to every route handler. */
export interface RouteContext {
  env: Env;
  ctx: ExecutionContext;
  route: RouteId;
  params: Record<string, string>;
  url: URL;
  /** Provider registry for this request's env (created lazily, cached per request). */
  registry(): Registry;
}

export type RouteHandler = (req: Request, rc: RouteContext) => Response | Promise<Response>;

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  unsupported_media_type: 415,
  conflict: 409,
  rate_limited: 429,
  not_configured: 503,
  not_implemented: 501,
  provider_error: 502,
  cancelled: 499,
  internal: 500,
  unauthenticated: 401,
};

/** Throw from a handler to produce an ApiErrorBody response. Messages: one sentence with its fix; never secrets. */
export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: { missingKeys?: string[]; opId?: string; status?: number } = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
  get status(): number {
    return this.extra.status ?? STATUS[this.code];
  }
}

export function json<T>(body: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(code: ErrorCode, message: string, extra: { missingKeys?: string[]; opId?: string; status?: number; headers?: HeadersInit } = {}): Response {
  const body: ApiErrorBody = { error: { code, message } };
  if (extra.missingKeys?.length) body.error.missingKeys = extra.missingKeys;
  if (extra.opId) body.error.opId = extra.opId;
  return json(body, { status: extra.status ?? STATUS[code], ...(extra.headers ? { headers: extra.headers } : {}) });
}

/** Typed 501 for routes whose builder has not landed yet. */
export function notImplemented(route: RouteId): Response {
  return errorResponse('not_implemented', `${route} is not built yet.`);
}

/** The MIME essence of a Content-Type header ("text/plain;application/json" → "text/plain"). */
export function mimeEssence(header: string | null): string {
  return (header ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * Parse a JSON body (the router already enforced the route's bodyCap). The essence must be exactly
 * application/json: "text/plain;application/json" is CORS-safelisted (no preflight), so a substring match
 * would let a cross-site page post JSON without asking.
 */
export async function readJson<T>(req: Request): Promise<T> {
  if (mimeEssence(req.headers.get('content-type')) !== 'application/json') throw new HttpError('unsupported_media_type', 'Send the body as application/json.');
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError('bad_request', 'The request body is not valid JSON.');
  }
}
