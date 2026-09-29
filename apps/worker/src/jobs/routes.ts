import type { CancelJobAccepted, JobResponse, JobsResponse, SteerJobAccepted, SteerJobRequest } from '@headcount/protocol';
import { isClientId } from '@headcount/protocol/ext/voice-owner';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { projectStub, workspaceStub } from '../lib/stubs';

// Route handlers for background jobs (owned by worker-core). Both return 202 at once: steering lands at
// the job's next checkpoint and cancellation fences the job; the frames arrive on the owner feed.

const STEER_MAX = 2000;

/** POST /api/jobs/:id/steer {text} → 202 SteerJobAccepted; applied at the job's next checkpoint. */
export const handleSteerJob: RouteHandler = async (req, { env, params }) => {
  const body = await readJson<SteerJobRequest>(req);
  if (!params.id?.startsWith('job_')) throw new HttpError('not_found', 'That job does not exist.');
  if (!body || typeof body.text !== 'string' || !body.text.trim()) throw new HttpError('bad_request', 'Add what the job should change.');
  if (body.text.length > STEER_MAX) throw new HttpError('payload_too_large', `Keep steering under ${STEER_MAX} characters.`);
  const opId = typeof body.opId === 'string' && body.opId ? body.opId.slice(0, 128) : undefined;
  // The steering tab speaks (one voice per workspace): its claim lands before the acknowledgement.
  if (isClientId(body.clientId)) await workspaceStub(env).voiceClaim(body.clientId, 'steer');
  const r = await projectStub(env).steerJob(params.id, body.text.trim(), opId);
  if (!r.accepted) throw new HttpError(r.code, r.message, opId ? { opId } : {});
  return json<SteerJobAccepted>({ accepted: true, jobId: r.jobId, steerId: r.steerId }, { status: 202 });
};

/** POST /api/jobs/:id/cancel → 202 CancelJobAccepted. */
export const handleCancelJob: RouteHandler = async (_req, { env, params }) => {
  if (!params.id?.startsWith('job_')) throw new HttpError('not_found', 'That job does not exist.');
  const r = await projectStub(env).cancelJob(params.id, 'Cancelled by the owner.', 'owner');
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json<CancelJobAccepted>({ accepted: true, jobId: r.jobId }, { status: 202 });
};

/** GET /api/jobs[?limit=n] → recent Everyday jobs, newest first (live snapshots; never waits on work). */
export const handleListJobs: RouteHandler = async (_req, { env, url }) => {
  const raw = Number(url.searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(100, Math.trunc(raw))) : 20;
  return json<JobsResponse>({ jobs: await projectStub(env).listJobs(limit) });
};

/** GET /api/jobs/:id → one job's snapshot, including its Markdown result once done. */
export const handleGetJob: RouteHandler = async (_req, { env, params }) => {
  if (!params.id?.startsWith('job_')) throw new HttpError('not_found', 'That job does not exist.');
  const job = await projectStub(env).getJob(params.id);
  if (!job) throw new HttpError('not_found', 'That job does not exist.');
  return json<JobResponse>(job);
};
