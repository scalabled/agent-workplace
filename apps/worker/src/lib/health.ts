import type { HealthResponse } from '@headcount/protocol';
import { json, type RouteHandler } from './http';

export const handleHealth: RouteHandler = (_req, { env }) =>
  json<HealthResponse>({ ok: true, service: 'headcount-worker', version: env.APP_VERSION ?? 'dev', time: new Date().toISOString(), workspaceId: env.WORKSPACE_ID });
