// Typed HTTP client for the worker API (same origin; Vite proxies /api in dev). Owned by `web`.
import {
  ids,
  routePath,
  type ApiErrorBody,
  type CancelJobAccepted,
  type CapabilitiesResponse,
  type ErrorCode,
  type FaceLandmarks,
  type HealthResponse,
  type JobResponse,
  type JobsResponse,
  type LandmarksResponse,
  type PortraitGenerateResponse,
  type PortraitListResponse,
  type SteerJobAccepted,
  type SttResponse,
  type TalkAccepted,
  type TtsRequest,
  type UpdateWorkspaceRequest,
  type WorkspaceResponse,
} from '@headcount/protocol';
import type {
  DeskSayAccepted,
  ExprAgentResponse,
  ExprCatalogBundle,
  ExprClipAlignment,
  ExprClipRef,
  ExprPrevoiceAccepted,
  ExprPrevoiceRequest,
  ExprPrevoiceStatus,
  ExprRenderRequest,
} from '@headcount/protocol/ext/expressions';
import { PORTRAIT_HEADERS, type PutLandmarksRequestWithVersion } from '@headcount/protocol/ext/media';
import type { ExprHuddleRenderRequest, OfficePeopleResponse, RoomCancelRequest, RoomCancelResponse, RoomId, RoomSayAccepted, RoomSayRequest } from '@headcount/protocol/ext/rooms';
import { noteUnauthenticated } from '../auth/session';
import type { ChannelEntry, ChannelResponse, DecisionAccepted, DecisionAnswer, MeetingResponse, MeetingSay, MeetingsResponse, PlanEdit, ProjectActionAccepted, ProjectResponse, ProjectsResponse, StepEdit, StopAllResponse } from '@headcount/protocol/ext/projects';
import type { CanvasCreate, CanvasListResponse, CanvasResponse } from '@headcount/protocol/ext/canvas';
import type { ConfigResponse, MemberPut, MembersResponse, ModelPrice, UsageResponse } from '@headcount/protocol/ext/admin';
import type { DocRef, ThreadResponse, ThreadStart, ThreadsResponse } from '@headcount/protocol/ext/threads';
import type { TeamResponse, TeamStartResponse } from '@headcount/protocol/ext/team';
import type { OrgsResponse, PlatformResponse } from '@headcount/protocol/ext/orgs';
import type { AuditKind, AuditResponse, AutonomyPolicy, PutAutonomyRequest, TestMailbox, TrustResponse } from '@headcount/protocol/ext/trust';
import type { HandbookSectionId as SectionId } from '@headcount/protocol/ext/memory';
import type { CardResponse, CardsResponse, HandbookResponse, HandbookSectionId, MemoryCreate, MemoryItem, MemoryKind, MemoryListResponse, MemoryPatch } from '@headcount/protocol/ext/memory';
import type { AutomationPatch, AutomationResponse, AutomationsResponse } from '@headcount/protocol/ext/automations';
import type { ConnectorCreate, ConnectorPatch, ConnectorResponse, ConnectorsResponse } from '@headcount/protocol/ext/connectors';
import type { AgentConfigPatch, AgentView, ModelsResponse, PromptView, RunsResponse, SkillDetail, SkillsResponse } from '@headcount/protocol/ext/agents';
import { clientId } from '../lib/client-id';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly missingKeys: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

async function toApiError(res: Response): Promise<ApiError> {
  let err: ApiError;
  try {
    const body = (await res.json()) as ApiErrorBody;
    err = new ApiError(res.status, body.error.code, body.error.message, body.error.missingKeys);
  } catch {
    err = new ApiError(res.status, 'internal', `Request failed (${res.status}).`);
  }
  // An expired or missing session (deployed, Google sign-in): back to the sign-in screen.
  if (res.status === 401) noteUnauthenticated();
  return err;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  health: () => request<HealthResponse>(routePath('health')),
  capabilities: () => request<CapabilitiesResponse>(routePath('capabilities')),
  getWorkspace: () => request<WorkspaceResponse>(routePath('getWorkspace')),
  putWorkspace: (patch: UpdateWorkspaceRequest) => request<WorkspaceResponse>(routePath('putWorkspace'), jsonInit('PUT', patch)),
  /** 202: the reply arrives on the socket as talk.* frames with this opId. The sending tab becomes the voice owner. */
  talk: (text: string, via: 'text' | 'voice' = 'text', opId: string = ids.op(), attachments: readonly string[] = []) =>
    request<TalkAccepted>(routePath('talk'), jsonInit('POST', { text, opId, via, clientId: clientId(), ...(attachments.length ? { attachments } : {}) })),
  /** An image file's picture (same-origin, sent with the session cookie). */
  cardFileUrl: (id: string) => routePath('cardFile', { id }),
  listJobs: (limit = 20) => request<JobsResponse>(`${routePath('listJobs')}?limit=${limit}`),
  getJob: (id: string) => request<JobResponse>(routePath('getJob', { id })),
  steerJob: (id: string, text: string, opId: string = ids.op()) => request<SteerJobAccepted>(routePath('steerJob', { id }), jsonInit('POST', { text, opId, clientId: clientId() })),
  cancelJob: (id: string) => request<CancelJobAccepted>(routePath('cancelJob', { id }), { method: 'POST' }),
  // Inc 1 team projects.
  listProjects: () => request<ProjectsResponse>(routePath('listProjects')),
  getProject: (id: string) => request<ProjectResponse>(routePath('getProject', { id })),
  approveProject: (id: string) => request<ProjectActionAccepted>(routePath('approveProject', { id }), { method: 'POST' }),
  cancelProject: (id: string) => request<ProjectActionAccepted>(routePath('cancelProject', { id }), { method: 'POST' }),
  noteProject: (id: string, text: string, toId?: string, opId: string = ids.op()) =>
    request<ProjectActionAccepted>(routePath('noteProject', { id }), jsonInit('POST', { text, opId, ...(toId ? { toId } : {}) })),
  pauseProject: (id: string) => request<ProjectActionAccepted>(routePath('pauseProject', { id }), { method: 'POST' }),
  resumeProject: (id: string) => request<ProjectActionAccepted>(routePath('resumeProject', { id }), { method: 'POST' }),
  // Parity stage 3: raised hands, plan editing, the run inspector.
  answerDecision: (id: string, a: DecisionAnswer) => request<DecisionAccepted>(routePath('answerDecision', { id }), jsonInit('POST', a)),
  listCanvas: () => request<CanvasListResponse>(routePath('listCanvas')),
  createCanvas: (c: CanvasCreate) => request<CanvasResponse>(routePath('createCanvas'), jsonInit('POST', c)),
  getCanvas: (id: string) => request<CanvasResponse>(routePath('getCanvas', { id })),
  reviseCanvas: (id: string, brief: string) => request<CanvasResponse>(routePath('reviseCanvas', { id }), jsonInit('POST', { brief })),
  repairCanvas: (id: string, errors: string[]) => request<CanvasResponse>(routePath('repairCanvas', { id }), jsonInit('POST', { errors })),
  retryCanvas: (id: string) => request<CanvasResponse>(routePath('retryCanvas', { id }), { method: 'POST' }),
  removeCanvas: (id: string) => request<{ removed: true }>(routePath('removeCanvas', { id }), { method: 'DELETE' }),
  canvasSource: async (id: string) => {
    const res = await fetch(routePath('canvasSource', { id }));
    if (!res.ok) throw new ApiError(res.status, 'not_found', 'The source could not be read.', []);
    return res.text();
  },
  // Your team.
  getTeam: () => request<TeamResponse>(routePath('getTeam')),
  putTeam: (members: string[]) => request<TeamResponse>(routePath('putTeam'), jsonInit('PUT', { members })),
  startTeamTask: (personaId: string) => request<TeamStartResponse>(routePath('startTeamTask', { personaId }), { method: 'POST' }),
  putSecondBrain: (on: boolean) => request<TeamResponse>(routePath('putSecondBrain'), jsonInit('PUT', { on })),
  applyHandbookSuggestion: (section: SectionId, suggestion: string) => request<TeamResponse>(routePath('applyHandbookSuggestion'), jsonInit('POST', { section, suggestion })),
  // Side chats in documents.
  listThreads: (doc: DocRef) => request<ThreadsResponse>(`${routePath('listThreads')}?doc=${encodeURIComponent(doc)}`),
  startThread: (t: ThreadStart) => request<ThreadResponse>(routePath('startThread'), jsonInit('POST', t)),
  replyThread: (id: string, text: string) => request<ThreadResponse>(routePath('replyThread', { id }), jsonInit('POST', { text })),
  resolveThread: (id: string, status: 'open' | 'resolved') => request<ThreadResponse>(routePath('resolveThread', { id }), jsonInit('PUT', { status })),
  // Admin: settings, people and roles, token usage.
  adminConfig: () => request<ConfigResponse>(routePath('adminConfig')),
  putAdminConfig: (values: Record<string, string | null>) => request<ConfigResponse>(routePath('putAdminConfig'), jsonInit('PUT', { values })),
  listMembers: () => request<MembersResponse>(routePath('listMembers')),
  putMember: (email: string, m: MemberPut) => request<MembersResponse>(routePath('putMember', { email }), jsonInit('PUT', m)),
  removeMember: (email: string) => request<MembersResponse>(routePath('removeMember', { email }), { method: 'DELETE' }),
  adminUsage: (days = 7) => request<UsageResponse>(`${routePath('adminUsage')}?days=${days}`),
  putPrices: (prices: ModelPrice[]) => request<{ prices: ModelPrice[] }>(routePath('putPrices'), jsonInit('PUT', { prices })),
  // Organizations.
  listOrgs: () => request<OrgsResponse>(routePath('listOrgs')),
  renameOrg: (name: string) => request<{ org: { orgId: string; name: string } }>(routePath('renameOrg'), jsonInit('PUT', { name })),
  platformOrgs: () => request<PlatformResponse>(routePath('platformOrgs')),
  // Inc 6 trust.
  getTrust: () => request<TrustResponse>(routePath('getTrust')),
  putAutonomy: (body: PutAutonomyRequest) => request<{ policy: AutonomyPolicy }>(routePath('putAutonomy'), jsonInit('PUT', body)),
  revokeGrant: (id: string) => request<{ revoked: true }>(routePath('revokeGrant', { id }), { method: 'DELETE' }),
  listAudit: (opts: { before?: string; kind?: AuditKind } = {}) => {
    const q = new URLSearchParams({ ...(opts.before ? { before: opts.before } : {}), ...(opts.kind ? { kind: opts.kind } : {}) }).toString();
    return request<AuditResponse>(`${routePath('listAudit')}${q ? `?${q}` : ''}`);
  },
  undoAudit: (id: string) => request<{ undone: true }>(routePath('undoAudit', { id }), { method: 'POST' }),
  resumeAll: () => request<{ resumed: boolean }>(routePath('resumeAll'), { method: 'POST' }),
  testMailbox: () => request<TestMailbox>(routePath('testMailbox')),
  testEmail: (to?: string) => request<{ result: { status: string; receipt?: { receiptId: string } } }>(routePath('testEmail'), jsonInit('POST', to ? { to } : {})),
  // Inc 4: context and memory.
  listMemory: (o: { q?: string; scope?: string; kind?: MemoryKind } = {}) => {
    const q = new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();
    return request<MemoryListResponse>(`${routePath('listMemory')}${q ? `?${q}` : ''}`);
  },
  addMemory: (m: MemoryCreate) => request<{ memory: MemoryItem }>(routePath('addMemory'), jsonInit('POST', m)),
  getMemory: (id: string) => request<{ memory: MemoryItem }>(routePath('getMemory', { id })),
  patchMemory: (id: string, p: MemoryPatch) => request<{ memory: MemoryItem }>(routePath('patchMemory', { id }), jsonInit('PUT', p)),
  removeMemory: (id: string) => request<{ removed: true }>(routePath('removeMemory', { id }), { method: 'DELETE' }),
  getHandbook: () => request<HandbookResponse>(routePath('getHandbook')),
  putHandbook: (section: HandbookSectionId, content: string) => request<HandbookResponse>(routePath('putHandbook', { section }), jsonInit('PUT', { content })),
  startInterview: () => request<HandbookResponse>(routePath('startInterview'), { method: 'POST' }),
  stopInterview: () => request<HandbookResponse>(routePath('stopInterview'), { method: 'DELETE' }),
  listCards: (scope?: string) => request<CardsResponse>(`${routePath('listCards')}${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`),
  /** A file as it is (raw bytes); where it was dropped sets its scope. */
  addCard: (file: File, scope?: string) =>
    request<CardResponse>(`${routePath('addCard')}${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`, {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
      body: file,
    }),
  getCard: (id: string) => request<CardResponse>(routePath('getCard', { id })),
  removeCard: (id: string) => request<{ removed: true }>(routePath('removeCard', { id }), { method: 'DELETE' }),
  listAutomations: () => request<AutomationsResponse>(routePath('listAutomations')),
  addAutomation: (spec: AutomationPatch) => request<AutomationResponse>(routePath('addAutomation'), jsonInit('POST', spec)),
  putAutomation: (id: string, patch: AutomationPatch) => request<AutomationResponse>(routePath('putAutomation', { id }), jsonInit('PUT', patch)),
  removeAutomation: (id: string) => request<{ removed: true }>(routePath('removeAutomation', { id }), { method: 'DELETE' }),
  runAutomation: (id: string) => request<AutomationResponse>(routePath('runAutomation', { id }), { method: 'POST' }),
  listConnectors: () => request<ConnectorsResponse>(routePath('listConnectors')),
  addConnector: (c: ConnectorCreate) => request<ConnectorResponse>(routePath('addConnector'), jsonInit('POST', c)),
  patchConnector: (id: string, p: ConnectorPatch) => request<ConnectorResponse>(routePath('patchConnector', { id }), jsonInit('PUT', p)),
  removeConnector: (id: string) => request<{ removed: true }>(routePath('removeConnector', { id }), { method: 'DELETE' }),
  testConnector: (id: string) => request<ConnectorResponse>(routePath('testConnector', { id }), { method: 'POST' }),
  revokeConnectorGrant: (id: string, grantId: string) => request<ConnectorResponse>(routePath('revokeConnectorGrant', { id, grantId }), { method: 'DELETE' }),
  editStep: (id: string, stepId: string, e: StepEdit) => request<ProjectActionAccepted>(routePath('editStep', { id, stepId }), jsonInit('PUT', e)),
  addStep: (id: string, e: StepEdit) => request<ProjectActionAccepted>(routePath('addStep', { id }), jsonInit('POST', e)),
  removeStep: (id: string, stepId: string) => request<ProjectActionAccepted>(routePath('removeStep', { id, stepId }), { method: 'DELETE' }),
  editPlan: (id: string, e: PlanEdit) => request<ProjectActionAccepted>(routePath('editPlan', { id }), jsonInit('PUT', e)),
  projectChannel: (id: string) => request<ChannelResponse>(routePath('projectChannel', { id })),
  postChannel: (id: string, text: string) => request<{ accepted: true; entry: ChannelEntry }>(routePath('postChannel', { id }), jsonInit('POST', { text })),
  discuss: (id: string, question: string, rounds?: number, kind?: 'discussion' | 'review') => request<ProjectActionAccepted>(routePath('discuss', { id }), jsonInit('POST', { question, ...(rounds ? { rounds } : {}), ...(kind ? { kind } : {}) })),
  projectMeetings: (id: string) => request<MeetingsResponse>(routePath('projectMeetings', { id })),
  getMeeting: (id: string, meetingId: string) => request<MeetingResponse>(routePath('getMeeting', { id, meetingId })),
  meetingSay: (id: string, meetingId: string, say: MeetingSay) => request<{ accepted: true; entry: ChannelEntry }>(routePath('meetingSay', { id, meetingId }), jsonInit('POST', say)),
  projectRuns: (id: string, stepId?: string) => request<RunsResponse>(`${routePath('projectRuns', { id })}${stepId ? `?stepId=${encodeURIComponent(stepId)}` : ''}`),
  // Parity stage 2: how each coworker works, skills, the Chief's prompt, models.
  getAgent: (personaId: string) => request<AgentView>(routePath('getAgent', { personaId })),
  putAgent: (personaId: string, patch: AgentConfigPatch) => request<AgentView>(routePath('putAgent', { personaId }), jsonInit('PUT', patch)),
  resetAgent: (personaId: string) => request<AgentView>(routePath('resetAgent', { personaId }), { method: 'POST' }),
  listSkills: () => request<SkillsResponse>(routePath('listSkills')),
  getSkill: (id: string) => request<SkillDetail>(routePath('getSkill', { id })),
  putSkill: (id: string, instructions: string, note?: string) => request<SkillDetail>(routePath('putSkill', { id }), jsonInit('PUT', { instructions, ...(note ? { note } : {}) })),
  rollbackSkill: (id: string, version: number) => request<SkillDetail>(routePath('rollbackSkill', { id }), jsonInit('POST', { version })),
  chiefPrompt: () => request<PromptView>(routePath('chiefPrompt')),
  listModels: () => request<ModelsResponse>(routePath('listModels')),
  /** "Everyone stop": every running job and team project halts; the feed carries each stop. */
  stopAll: () => request<StopAllResponse>(routePath('stopAll'), { method: 'POST' }),
  /** Raw audio response (Content-Type audio/*). Throws ApiError not_configured when no TTS provider. */
  async tts(req: TtsRequest, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(routePath('tts'), { ...jsonInit('POST', req), ...(signal ? { signal } : {}) });
    if (!res.ok) throw await toApiError(res);
    return res;
  },
  /** TTS for one sentence → encoded audio bytes (mp3 unless the provider says otherwise). */
  async ttsAudio(req: TtsRequest, signal?: AbortSignal): Promise<{ audio: ArrayBuffer; mime: string }> {
    const res = await api.tts(req, signal);
    return { audio: await res.arrayBuffer(), mime: res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg' };
  },
  stt: (audio: Blob) => request<SttResponse>(routePath('stt'), { method: 'POST', headers: { 'content-type': audio.type || 'audio/webm' }, body: audio }),
  // ?wait=1: generate inside the request. Deployed Workers stop waitUntil work ~30 s after the response, which could
  // strand a paid image mid-generation (DEPLOY.md H6); the request itself may run as long as the provider takes.
  generatePortrait: (personaId: string) => request<PortraitGenerateResponse>(`${routePath('generatePortrait', { personaId })}?wait=1`, { method: 'POST' }),
  /** Which faces have a stored portrait (one call instead of a probe per face). */
  listPortraits: () => request<PortraitListResponse>(routePath('listPortraits')),
  portraitUrl: (personaId: string) => routePath('getPortrait', { personaId }),
  /** The stored portrait and its version (X-Portrait-Version), or null when there is none yet (404). */
  async portraitImage(personaId: string, signal?: AbortSignal): Promise<{ blob: Blob; version: string | null } | null> {
    const res = await fetch(routePath('getPortrait', { personaId }), signal ? { signal } : {});
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    return { blob: await res.blob(), version: res.headers.get(PORTRAIT_HEADERS.version) };
  },
  /** The stored portrait, or null when there is none yet (404) or the route is not available. */
  async portraitBlob(personaId: string, signal?: AbortSignal): Promise<Blob | null> {
    return (await api.portraitImage(personaId, signal))?.blob ?? null;
  },
  getLandmarks: (personaId: string) => request<LandmarksResponse>(routePath('getLandmarks', { personaId })),
  /** Stored landmarks and the portrait version they belong to (X-Portrait-Version on the landmarks response). */
  async landmarksFor(personaId: string, signal?: AbortSignal): Promise<{ landmarks: FaceLandmarks | null; version: string | null }> {
    const res = await fetch(routePath('getLandmarks', { personaId }), signal ? { signal } : {});
    if (!res.ok) throw await toApiError(res);
    const body = (await res.json()) as LandmarksResponse;
    return { landmarks: body.landmarks ?? null, version: res.headers.get(PORTRAIT_HEADERS.version) };
  },
  /** First valid write wins. `portraitVersion` (from X-Portrait-Version) makes a replaced image answer 409, not store stale geometry. */
  putLandmarks: (personaId: string, landmarks: FaceLandmarks, portraitVersion?: string | null) =>
    request<LandmarksResponse>(routePath('putLandmarks', { personaId }), jsonInit('PUT', { landmarks, ...(portraitVersion ? { portraitVersion } : {}) } satisfies PutLandmarksRequestWithVersion)),

  // ── living workforce (Inc 0.5) ──
  /** The expression catalog bundle (about 2.9 MB; ETag-cached by the browser). Compile it off the critical path. */
  exprCatalog: () => request<ExprCatalogBundle>(routePath('exprCatalog')),
  exprAgent: (agentId: string) => request<ExprAgentResponse>(routePath('exprAgent', { agentId })),
  exprRender: (req: ExprRenderRequest) => request<ExprClipRef>(routePath('exprRender'), jsonInit('POST', req)),
  exprPrevoice: (req: ExprPrevoiceRequest) => request<ExprPrevoiceAccepted>(routePath('exprPrevoice'), jsonInit('POST', req)),
  exprPrevoiceStatus: (runId: string) => request<ExprPrevoiceStatus>(routePath('exprPrevoiceStatus', { runId })),
  exprAlignment: (clipKey: string) => request<ExprClipAlignment>(routePath('exprAlign', { clipKey })),
  /** 202: a Floor quick-chat to a catalog coworker; the reply streams on the socket (talk.* with surface 'floor'). */
  deskSay: (personaId: string, text: string, opId: string = ids.op()) =>
    request<DeskSayAccepted>(routePath('deskSay', { personaId }), jsonInit('POST', { text, opId, via: 'text', clientId: clientId() })),

  // ── the office (Office Phase 2, ext/rooms) ──
  /**
   * 202: an owner message to a conference room or a joined huddle; replies stream on the socket as talk.* frames with
   * `surface: 'room'`, this `roomId` and `meetingId`. The sending tab becomes the voice owner. A refusal throws ApiError
   * with the server's sentence (429 rate_limited, 503 not_configured, …).
   */
  roomSay: (roomId: RoomId, body: Omit<RoomSayRequest, 'clientId'>) => request<RoomSayAccepted>(routePath('roomSay', { roomId }), jsonInit('POST', { ...body, clientId: clientId() } satisfies RoomSayRequest)),
  /** Stop the room turn now (barge-in), or leave the meeting (`leave: true`: one note in Talk if the owner spoke). */
  roomCancel: (roomId: RoomId, body: Omit<RoomCancelRequest, 'clientId'>) => request<RoomCancelResponse>(routePath('roomCancel', { roomId }), jsonInit('POST', { ...body, clientId: clientId() } satisfies RoomCancelRequest)),
  /** Personality for office life and the huddle engine (ETag: the browser's HTTP cache revalidates it). */
  officePeople: () => request<OfficePeopleResponse>(routePath('officePeople')),
  /** One small-talk turn in the speaker's voice (listen-in). Pass a signal to give up on a late render. */
  exprHuddleRender: (req: ExprHuddleRenderRequest, signal?: AbortSignal) => request<ExprClipRef>(routePath('exprHuddleRender'), { ...jsonInit('POST', req), ...(signal ? { signal } : {}) }),
};
