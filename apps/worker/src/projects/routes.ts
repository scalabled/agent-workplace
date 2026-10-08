import { CHANNEL_POST_MAX, MEETING_PEOPLE_MAX, MEETING_SAY_MAX, MEETING_TOPIC_MAX, type CallMeetingRequest, type CallMeetingResponse, PROJECT_NOTE_MAX, type ChannelEntry, type DecisionAccepted, type MeetingResponse, type MeetingSay, type MeetingSummary, type MeetingWorkResponse, type MeetingsResponse, type TeamProjectSnapshot, type ChannelPost, type ChannelResponse, type DecisionAnswer, type DiscussRequest, type PlanEdit, type ProjectActionAccepted, type ProjectNoteRequest, type ProjectResponse, type ProjectsResponse, type StepEdit, type StopAllResponse } from '@headcount/protocol/ext/projects';
import { whoOf } from '../trust/routes';
import type { RunsResponse } from '@headcount/protocol/ext/agents';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { projectStub, workspaceStub } from '../lib/stubs';

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
export const handleStopAll: RouteHandler = async (_req, rc) => json<StopAllResponse>(await projectStub(rc.env).stopAll('owner', whoOf(rc)));

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

const isDecisionId = (id: string | undefined): id is string => !!id && /^dec_[a-z0-9]{8,40}$/.test(id);
const isStepId = (id: string | undefined): id is string => !!id && /^[\w-]{1,48}$/.test(id);
type Refusal = { accepted: false; code: 'not_found' | 'conflict' | 'bad_request' | 'rate_limited' | 'not_configured'; message: string };
const accepted = (r: { accepted: true; project: ProjectResponse } | Refusal) => {
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json<ProjectActionAccepted>({ accepted: true, project: r.project }, { status: 202 });
};
const strs = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined);

function stepEditOf(body: Record<string, unknown> | null): StepEdit {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('bad_request', 'Send the change as a JSON object.');
  const e: StepEdit = {};
  for (const k of ['title', 'brief', 'acceptance'] as const) {
    if (body[k] === undefined) continue;
    if (typeof body[k] !== 'string') throw new HttpError('bad_request', `${k} must be text.`);
    e[k] = body[k] as string;
  }
  for (const k of ['ownerIds', 'reviewerIds', 'dependsOn'] as const) {
    if (body[k] === undefined) continue;
    const list = strs(body[k]);
    if (!list) throw new HttpError('bad_request', `${k} must be a list of ids.`);
    e[k] = list;
  }
  return e;
}

/** POST /api/decisions/:id → the owner answers a raised hand (approve, decline, or words). */
export const handleAnswerDecision: RouteHandler = async (req, rc) => {
  const { env, params } = rc;
  if (!isDecisionId(params.id)) throw new HttpError('not_found', 'No such decision.');
  const body = await readJson<Partial<DecisionAnswer>>(req);
  if (!body || !['approve', 'decline', 'answer'].includes(String(body.action))) throw new HttpError('bad_request', 'Approve, decline or answer.');
  if (body.text !== undefined && typeof body.text !== 'string') throw new HttpError('bad_request', 'The answer must be text.');
  if (body.scope !== undefined && !['once', 'project', 'always'].includes(String(body.scope))) throw new HttpError('bad_request', 'Allow once, for this project, or always.');
  if (body.grant !== undefined && !['once', 'task', 'project', 'day'].includes(String(body.grant))) throw new HttpError('bad_request', 'Once, for this task, for this project, or for 24 hours.');
  const r = (await projectStub(env).answerDecision(params.id, { action: body.action as DecisionAnswer['action'], ...(body.text ? { text: body.text } : {}), ...(body.scope ? { scope: body.scope } : {}), ...(body.grant ? { grant: body.grant } : {}) }, whoOf(rc))) as unknown as DecisionAccepted | Refusal;
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json<DecisionAccepted>({ accepted: true, decision: r.decision, ...(r.project ? { project: r.project } : {}) }, { status: 202 });
};

export const handleEditStep: RouteHandler = async (req, { env, params }) => {
  if (!isProjectId(params.id) || !isStepId(params.stepId)) throw new HttpError('not_found', 'No such step.');
  const edit = stepEditOf(await readJson<Record<string, unknown>>(req));
  return accepted((await projectStub(env).editStep(params.id, params.stepId, edit)) as unknown as { accepted: true; project: ProjectResponse } | Refusal);
};

export const handleAddStep: RouteHandler = async (req, { env, params }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  const edit = stepEditOf(await readJson<Record<string, unknown>>(req));
  return accepted((await projectStub(env).addStep(params.id, edit)) as unknown as { accepted: true; project: ProjectResponse } | Refusal);
};

export const handleRemoveStep: RouteHandler = async (_req, { env, params }) => {
  if (!isProjectId(params.id) || !isStepId(params.stepId)) throw new HttpError('not_found', 'No such step.');
  return accepted((await projectStub(env).removeStep(params.id, params.stepId)) as unknown as { accepted: true; project: ProjectResponse } | Refusal);
};

export const handleEditPlan: RouteHandler = async (req, { env, params }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  const body = await readJson<Partial<PlanEdit>>(req);
  const e: PlanEdit = {};
  if (body?.deliverableKind !== undefined) e.deliverableKind = body.deliverableKind;
  if (body?.finisherId !== undefined) {
    if (typeof body.finisherId !== 'string') throw new HttpError('bad_request', 'finisherId must be a persona id.');
    e.finisherId = body.finisherId;
  }
  return accepted((await projectStub(env).editPlan(params.id, e)) as unknown as { accepted: true; project: ProjectResponse } | Refusal);
};

/** GET /api/projects/:id/runs[?stepId=] → every model call of the project (the run inspector). */
export const handleProjectRuns: RouteHandler = async (_req, { env, params, url }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  const stepId = url.searchParams.get('stepId') ?? undefined;
  if (stepId !== undefined && !isStepId(stepId)) throw new HttpError('bad_request', 'That is not a step id.');
  const runs = (await projectStub(env).projectRuns(params.id, stepId)) as unknown as RunsResponse['runs'];
  return json<RunsResponse>({ runs });
};

/** GET /api/projects/:id/channel → the team channel (oldest first). */
export const handleProjectChannel: RouteHandler = async (_req, { env, params }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  const entries = (await projectStub(env).projectChannel(params.id)) as unknown as ChannelEntry[];
  return json<ChannelResponse>({ entries });
};

/** POST /api/projects/:id/channel → 202: the owner writes to the team (@Name to address someone). */
export const handlePostChannel: RouteHandler = async (req, { env, params }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  const body = await readJson<Partial<ChannelPost>>(req);
  if (!body || typeof body.text !== 'string' || !body.text.trim()) throw new HttpError('bad_request', 'Say something to the team.');
  if (body.text.length > CHANNEL_POST_MAX) throw new HttpError('payload_too_large', `Keep it under ${CHANNEL_POST_MAX} characters.`);
  const r = (await projectStub(env).postChannel(params.id, body.text)) as unknown as { accepted: true; entry: ChannelEntry } | Refusal;
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json<{ accepted: true; entry: ChannelEntry }>(r, { status: 202 });
};

/** POST /api/projects/:id/discuss → 202: the team discusses a question (the chair frames, members speak, the chair sums up). */
export const handleDiscuss: RouteHandler = async (req, { env, params }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  const body = await readJson<Partial<DiscussRequest>>(req);
  const kind = body?.kind === 'review' ? 'review' : 'discussion';
  if (!body || (body.question !== undefined && typeof body.question !== 'string')) throw new HttpError('bad_request', 'Say what the team should discuss.');
  if (kind === 'discussion' && !body.question?.trim()) throw new HttpError('bad_request', 'Say what the team should discuss.');
  const rounds = typeof body.rounds === 'number' ? body.rounds : undefined;
  const r = (await projectStub(env).discuss(params.id, body.question ?? '', rounds, kind)) as unknown as ({ accepted: true; project: ProjectResponse; meetingId: string }) | Refusal;
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json<ProjectActionAccepted>({ accepted: true, project: r.project, meetingId: r.meetingId }, { status: 202 });
};

const isMeetingId = (id: string | undefined): id is string => !!id && /^mtg_[a-f0-9]{8,40}$/.test(id);

/** GET /api/projects/:id/meetings → the project's meetings, newest first. */
export const handleProjectMeetings: RouteHandler = async (_req, { env, params }) => {
  if (!isProjectId(params.id)) throw new HttpError('not_found', 'That project does not exist.');
  return json<MeetingsResponse>({ meetings: (await projectStub(env).projectMeetings(params.id)) as unknown as MeetingSummary[] });
};

/** GET /api/projects/:id/meetings/:meetingId → one meeting with its lines (for reading, listening and replay). */
export const handleGetMeeting: RouteHandler = async (_req, { env, params }) => {
  if (!isProjectId(params.id) || !isMeetingId(params.meetingId)) throw new HttpError('not_found', 'No such meeting.');
  const m = (await projectStub(env).getMeeting(params.id, params.meetingId)) as unknown as MeetingResponse | null;
  if (!m) throw new HttpError('not_found', 'No such meeting.');
  return json<MeetingResponse>(m);
};

/** GET /api/meetings → every meeting in the office: live ones first, then the latest. */
export const handleListMeetings: RouteHandler = async (_req, { env }) => json<MeetingsResponse>({ meetings: (await projectStub(env).allMeetings()) as unknown as MeetingSummary[] });

/** GET /api/meetings/:meetingId → one meeting with its lines, by its id alone. */
export const handleFindMeeting: RouteHandler = async (_req, { env, params }) => {
  if (!isMeetingId(params.meetingId)) throw new HttpError('not_found', 'No such meeting.');
  const m = (await projectStub(env).findMeeting(params.meetingId)) as unknown as MeetingResponse | null;
  if (!m) throw new HttpError('not_found', 'No such meeting.');
  return json<MeetingResponse>(m);
};

/**
 * POST /api/meetings → 202: call a meeting. With a projectId, that project's team meets (a discussion or a review);
 * without, the people chosen from the team meet about the topic, the Chief of Staff moderating.
 */
export const handleCallMeeting: RouteHandler = async (req, { env }) => {
  const body = await readJson<Partial<CallMeetingRequest>>(req);
  if (!body || typeof body.topic !== 'string') throw new HttpError('bad_request', 'Say what the meeting is about.');
  const kind = body.kind === 'review' ? 'review' : 'discussion';
  const topic = body.topic.trim();
  if (topic.length > MEETING_TOPIC_MAX) throw new HttpError('bad_request', `Keep the topic under ${MEETING_TOPIC_MAX} characters.`);
  const rounds = typeof body.rounds === 'number' ? body.rounds : undefined;
  if (body.projectId !== undefined) {
    if (!isProjectId(body.projectId)) throw new HttpError('not_found', 'That project does not exist.');
    if (kind === 'discussion' && !topic) throw new HttpError('bad_request', 'Say what the team should discuss.');
    const r = (await projectStub(env).discuss(body.projectId, topic, rounds, kind)) as unknown as { accepted: true; meetingId: string } | Refusal;
    if (!r.accepted) throw new HttpError(r.code, r.message);
    const m = (await projectStub(env).findMeeting(r.meetingId)) as unknown as MeetingResponse | null;
    if (!m) throw new HttpError('not_found', 'No such meeting.');
    return json<CallMeetingResponse>({ meeting: m.meeting }, { status: 202 });
  }
  const people = Array.isArray(body.people) ? body.people.filter((p): p is string => typeof p === 'string' && /^[a-z0-9][a-z0-9-]{0,80}$/.test(p)) : [];
  if (!people.length) throw new HttpError('bad_request', 'Invite at least one coworker.');
  if (people.length > MEETING_PEOPLE_MAX) throw new HttpError('bad_request', `Invite at most ${MEETING_PEOPLE_MAX} people.`);
  if (topic.length < 3) throw new HttpError('bad_request', 'Say what the meeting is about.');
  const r = (await workspaceStub(env).callMeeting({ topic, people, ...(rounds ? { rounds } : {}), ...(body.followUp === false ? { followUp: false } : {}) })) as unknown as { accepted: true; meeting: MeetingSummary } | Refusal;
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json<CallMeetingResponse>({ meeting: r.meeting }, { status: 202 });
};

/** POST /api/meetings/:meetingId/work → 202: the people at the table start on what the meeting agreed (the chair leads). */
export const handleMeetingWork: RouteHandler = async (_req, { env, params }) => {
  if (!isMeetingId(params.meetingId)) throw new HttpError('not_found', 'No such meeting.');
  const r = (await projectStub(env).meetingWork(params.meetingId)) as unknown as { project: TeamProjectSnapshot } | Refusal;
  if ('accepted' in r) throw new HttpError(r.code, r.message);
  return json<MeetingWorkResponse>({ project: r.project }, { status: 202 });
};

/** POST /api/projects/:id/meetings/:meetingId/say → the owner takes the floor, or whispers to one coworker. */
export const handleMeetingSay: RouteHandler = async (req, { env, params }) => {
  if (!isProjectId(params.id) || !isMeetingId(params.meetingId)) throw new HttpError('not_found', 'No such meeting.');
  const body = await readJson<Partial<MeetingSay>>(req);
  if (!body || typeof body.text !== 'string' || !body.text.trim()) throw new HttpError('bad_request', 'Say something.');
  if (body.text.length > MEETING_SAY_MAX) throw new HttpError('bad_request', `Keep it under ${MEETING_SAY_MAX} characters.`);
  if (body.toId !== undefined && typeof body.toId !== 'string') throw new HttpError('bad_request', 'Speak to one coworker.');
  const r = (await projectStub(env).meetingSay(params.id, params.meetingId, body.text, body.toId, body.whisper === true)) as unknown as { accepted: true; entry: ChannelEntry } | Refusal;
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json({ accepted: true, entry: r.entry }, { status: 202 });
};
