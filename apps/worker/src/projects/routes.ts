import { PROJECT_NOTE_MAX, type ProjectActionAccepted, type ProjectNoteRequest, type ProjectResponse, type ProjectsResponse, type StopAllResponse } from '@headcount/protocol/ext/projects';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { projectStub } from '../lib/stubs';

// Route handlers for Inc 1 team projects (hosted in the Everyday ProjectDO). Approve and cancel answer at once; the
// work and every status change arrive on the owner feed as project.* frames.

const isProjectId = (id: string | undefined): id is string => !!id && /^prj_[a-z0-9]{8,40}$/.test(id);

/** GET /api/projects → team projects (newest first) and open decisions (the Inbox). */
export const handleListProjects: RouteHandler = async (_req, { env, url }) => {
  const raw = Number(url.searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(100, Math.trunc(raw))) : 20;
  return json<ProjectsResponse>(await projectStub(env).listProjects(limit));
};

/** GET /api/projects/:id → one project with full step outputs and deliverable. */
export const handleGetProject: RouteHandler = async (_req, { env, params }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  const project = await projectStub(env).getProject(params.id);
  if (!project) throw new HttpError('not_found', 'That project does not exist.');
  return json<ProjectResponse>(project);
};

/** POST /api/projects/:id/approve → 202: the owner approved the plan (the raised hand). */
export const handleApproveProject: RouteHandler = async (_req, { env, params }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  const r = await projectStub(env).approveProject(params.id);
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json<ProjectActionAccepted>({ accepted: true, project: r.project }, { status: 202 });
};

/** POST /api/projects/:id/cancel → 202: decline a proposed plan, or stop a running project. */
export const handleCancelProject: RouteHandler = async (_req, { env, params }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  const r = await projectStub(env).cancelProject(params.id, 'Stopped by the owner.');
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json<ProjectActionAccepted>({ accepted: true, project: r.project }, { status: 202 });
};

/** POST /api/stop-all → "Everyone stop": every running job and team project halts at once. */
export const handleStopAll: RouteHandler = async (_req, { env }) => json<StopAllResponse>(await projectStub(env).stopAll('owner'));

/** POST /api/projects/:id/note → 202: direction for the team (or `toId`), picked up by the next step that starts. */
export const handleNoteProject: RouteHandler = async (req, { env, params }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  const body = await readJson<Partial<ProjectNoteRequest>>(req);
  if (!body || typeof body !== 'object' || typeof body.text !== 'string' || !body.text.trim()) throw new HttpError('bad_request', 'Say what the team should know.');
  if (body.text.length > PROJECT_NOTE_MAX) throw new HttpError('payload_too_large', `Keep a note under ${PROJECT_NOTE_MAX} characters.`);
  if (body.toId !== undefined && typeof body.toId !== 'string') throw new HttpError('bad_request', 'toId must be a persona id.');
  if (body.opId !== undefined && (typeof body.opId !== 'string' || body.opId.length > 128)) throw new HttpError('bad_request', 'opId must be a short string.');
  const r = await projectStub(env).noteProject(params.id, { text: body.text, via: 'page', ...(body.toId ? { toId: body.toId } : {}), ...(body.opId ? { opId: body.opId } : {}) });
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json<ProjectActionAccepted>({ accepted: true, project: r.project }, { status: 202 });
};

/** POST /api/projects/:id/pause → 202: steps under way finish; nothing new starts. */
export const handlePauseProject: RouteHandler = async (_req, { env, params }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  const r = await projectStub(env).pauseProject(params.id);
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json<ProjectActionAccepted>({ accepted: true, project: r.project }, { status: 202 });
};

/** POST /api/projects/:id/resume → 202. */
export const handleResumeProject: RouteHandler = async (_req, { env, params }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  const r = await projectStub(env).resumeProject(params.id);
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json<ProjectActionAccepted>({ accepted: true, project: r.project }, { status: 202 });
};
