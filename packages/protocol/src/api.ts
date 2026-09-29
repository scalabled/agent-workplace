import type { Ambience, ExprRecentOp, ViewerOp } from './ext/expressions';
import type { VoiceClaimOp } from './ext/voice-owner';
import type { FaceLandmarks } from './face';
import type { JobId, MessageId, OpId, ProjectId, SteerId, TurnId, WorkspaceId } from './ids';
import type { Alignment, VoiceRef } from './voice';

// ── errors ──────────────────────────────────────────────────────────────────────
export type ErrorCode =
  | 'bad_request'
  /** The request came from a page or host that is not the app itself (403): cross-site requests and DNS rebinding. */
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'conflict'
  /** A daily or per-minute limit is used up (429). The message says when it resets and which var raises it. */
  | 'rate_limited'
  /** No provider is configured for this capability. `missingKeys` names the env vars that would enable it. */
  | 'not_configured'
  | 'not_implemented'
  | 'provider_error'
  | 'cancelled'
  | 'internal'
  /** No valid session: sign in (Google) first. Only when AUTH_MODE requires it (deployed hosts). */
  | 'unauthenticated';

/** Every non-2xx JSON response has this body. Messages are one plain sentence with its fix. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Env var names (never values) that would enable the capability, e.g. ["OPENAI_API_KEY", "XAI_API_KEY"]. */
    missingKeys?: string[];
    opId?: OpId;
  };
}

// ── providers & capabilities ────────────────────────────────────────────────────
export type ProviderId = 'mock' | 'ollama' | 'openai-compatible' | 'anthropic' | 'openai' | 'xai' | 'gemini' | 'workers-ai';
export type ProviderKind = 'mock' | 'local' | 'cloud';
export type Modality = 'chat' | 'tts' | 'stt' | 'image' | 'embeddings';
export const MODALITIES: readonly Modality[] = ['chat', 'tts', 'stt', 'image', 'embeddings'];

export interface ProviderStatus {
  id: ProviderId;
  /** Owner-facing name without model names, e.g. "OpenAI", "Local (Ollama)". */
  label: string;
  kind: ProviderKind;
  /** Keys/URL present (mock: ENABLE_MOCK=true). */
  configured: boolean;
  /** Local providers only: answered a probe just now. */
  reachable?: boolean;
  /** Modalities this provider can serve once configured. */
  modalities: Modality[];
  /** Env var names required to configure it (names only). */
  keys: string[];
}

export interface ModalityStatus {
  /** True when a non-mock provider can serve it, or mock is the chosen default (tests, keyless demo). */
  available: boolean;
  /** Provider that would serve it now, or null. `mock` means synthetic output (silent audio, placeholder image). */
  provider: ProviderId | null;
  /** When unavailable (or mock-only): env var names that would enable a real provider. */
  missingKeys: string[];
}

/** GET /api/capabilities. Capabilities without a provider are hidden in the UI, never shown broken. */
export interface CapabilitiesResponse {
  providers: ProviderStatus[];
  modalities: Record<Modality, ModalityStatus>;
  /** DEFAULT_CHAT resolved ("auto" → first configured in preference order). */
  defaultChat: ProviderId | null;
  /** The Chief of Staff's realtime voice front (Inc 2): spoken turns get a quick spoken acknowledgement while the brain works. */
  voiceFront?: { available: boolean; provider: 'xai' | 'mock' | null };
}

// ── health ──────────────────────────────────────────────────────────────────────
export interface HealthResponse {
  ok: true;
  service: 'headcount-worker';
  version: string;
  time: string;
  workspaceId: WorkspaceId;
}

// ── workspace (owner settings) ──────────────────────────────────────────────────
export interface WorkspaceSettings {
  workspaceId: WorkspaceId;
  /** Chosen catalog lead (`lead-…`), or null before onboarding. */
  leadId: string | null;
  /** The owner's name for their Chief of Staff; null → the lead's catalog first name. */
  chiefName: string | null;
  /** Speak the Chief of Staff's replies aloud. */
  voiceOn: boolean;
  /**
   * How much the office chatters (Inc 0.5). GET and PUT responses always fill it; absent in stored or replayed
   * settings means Lively (`ambienceOf` in ext/expressions).
   */
  ambience?: Ambience;
  /**
   * What the office calls the owner (Office Phase 2): optional, set in onboarding or ⌘K. Used only in greetings,
   * sign-offs and prompts, never in small talk. Absent or null = unset.
   */
  ownerName?: string | null;
  updatedAt: string;
}

/** GET /api/workspace and PUT /api/workspace response. */
export type WorkspaceResponse = WorkspaceSettings;

/** PUT /api/workspace body: any subset. `chiefName: null` resets to the lead's name. */
export interface UpdateWorkspaceRequest {
  leadId?: string | null;
  chiefName?: string | null;
  voiceOn?: boolean;
  ambience?: Ambience;
  /** Trimmed; blank → null; ≤ OWNER_NAME_MAX_CHARS; letters, spaces, apostrophes, hyphens and dots. */
  ownerName?: string | null;
}

export const OWNER_NAME_MAX_CHARS = 40;

/**
 * The owner's first name for greetings and prompts: the first word of `ownerName`, ≤ 24 characters of letters,
 * apostrophes and hyphens (trailing punctuation dropped). null when unset or when the first word is not a name.
 */
export function ownerFirstNameOf(s: { ownerName?: string | null } | null | undefined): string | null {
  const raw = typeof s?.ownerName === 'string' ? s.ownerName.trim() : '';
  if (!raw) return null;
  const first = raw.split(/\s+/)[0]!.replace(/^['’-]+|['’.,-]+$/gu, '');
  if (!first || first.length > 24 || !/^\p{L}[\p{L}\p{M}'’-]*$/u.test(first)) return null;
  return first;
}

// ── talk ────────────────────────────────────────────────────────────────────────
export const TALK_MAX_CHARS = 8000;

/** POST /api/talk. Returns 202 immediately; the reply arrives as talk.* frames on the socket. */
export interface TalkRequest {
  text: string;
  opId: OpId;
  via?: 'text' | 'voice';
  /** The sending tab (ext/voice-owner): it becomes the voice owner. */
  clientId?: string;
}

export interface TalkAccepted {
  accepted: true;
  opId: OpId;
  turnId: TurnId;
  /** Id of the owner's message (echoed as a talk.owner frame). */
  messageId: MessageId;
  /** True when this opId was already accepted (idempotent retry). */
  duplicate?: boolean;
}

// ── jobs ────────────────────────────────────────────────────────────────────────
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobSteer {
  steerId: SteerId;
  text: string;
  /** queued until the job reaches its next checkpoint, then applied. */
  status: 'queued' | 'applied';
  at: string;
  appliedAt?: string;
}

/** Live state of a background job: the source of truth for "how's it going?". */
export interface JobSnapshot {
  jobId: JobId;
  projectId: ProjectId;
  title: string;
  /** What the owner asked for, in their words. */
  brief: string;
  status: JobStatus;
  /** The running sentence shown in the Activity row, e.g. "Reading supplier reviews". */
  label: string;
  /** 1-based checkpoint index and total, when known. */
  step: number;
  of: number | null;
  /** Agent doing the work (the Chief of Staff in Inc 0). */
  agentId: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  steers: JobSteer[];
  /** Notes gathered so far (short), for status answers mid-flight. */
  partial?: string;
  /** Final Markdown result. */
  result?: string;
  summary?: string;
  error?: { code: ErrorCode; message: string };
}

export interface SteerJobRequest {
  text: string;
  opId?: OpId;
  /** The steering tab (ext/voice-owner): it becomes the voice owner. */
  clientId?: string;
}

export interface SteerJobAccepted {
  accepted: true;
  jobId: JobId;
  steerId: SteerId;
}

export interface CancelJobAccepted {
  accepted: true;
  jobId: JobId;
}

/** GET /api/jobs: recent Everyday jobs, newest first (rebuilds the Projects list after a reload or a long gap). */
export interface JobsResponse {
  jobs: JobSnapshot[];
}

/** GET /api/jobs/:id: one job's live snapshot, including `result` (Markdown) once done. */
export type JobResponse = JobSnapshot;

// ── speech ──────────────────────────────────────────────────────────────────────
export const TTS_MAX_CHARS = 4000;
/** Largest recording POST /api/speech/stt accepts (the router rejects bigger bodies before buffering them). */
export const STT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/speech/tts. Default response: audio bytes (Content-Type audio/mpeg | audio/wav) with
 * X-Speech-Provider / X-Speech-Voice headers. With `response: "json"`: TtsJsonResponse (includes alignment).
 * 503 not_configured when no TTS provider → the browser falls back to speechSynthesis.
 */
export interface TtsRequest {
  text: string;
  voiceRef: VoiceRef;
  /** Agent id of the speaker (cache key, logs, mixer). */
  speakerId: string;
  format?: 'mp3' | 'wav';
  response?: 'audio' | 'json';
  /**
   * Keep the voiced line for replay (meeting lines, Inc 2): the same text in the same voice is served from storage
   * afterwards, without a provider call or a count against the daily limit. JSON responses only.
   */
  cache?: boolean;
}

export interface TtsJsonResponse {
  mime: string;
  audioBase64: string;
  alignment: Alignment | null;
  provider: ProviderId;
  voice: string;
}

/** POST /api/speech/stt with the raw audio as the body (Content-Type audio/webm, audio/wav, …). */
export interface SttResponse {
  text: string;
  provider: ProviderId;
  language?: string;
}

// ── portraits ───────────────────────────────────────────────────────────────────
/** POST /api/portraits/:personaId/generate (personaId may be a persona id or a lead id). */
export interface PortraitGenerateResponse {
  personaId: string;
  status: 'queued' | 'generating' | 'exists';
  provider?: ProviderId;
}

/** GET /api/portraits: which faces have a stored portrait, so clients do not probe every id (one call per page). */
export interface PortraitListResponse {
  portraits: { personaId: string; version: string; hasLandmarks: boolean }[];
}

/** GET /api/portraits/:personaId/landmarks */
export interface LandmarksResponse {
  personaId: string;
  landmarks: FaceLandmarks | null;
}

/** PUT /api/portraits/:personaId/landmarks. First valid write wins; later writes return 409 unless `force`. */
export interface PutLandmarksRequest {
  landmarks: FaceLandmarks;
  force?: boolean;
}

// ── socket ──────────────────────────────────────────────────────────────────────
/**
 * GET /api/ws?since=<seq>: the server sends `ready`, replays persisted frames with seq > since
 * (from the hot window, at most WS_REPLAY_LIMIT, oldest first), then a presence snapshot, then live
 * frames. `since` omitted = 0. A client keeps the highest seq it applied and reconnects with it.
 */
export interface WsQuery {
  since?: number;
  /** The tab's client id (ext/voice-owner): one voice per workspace. */
  client?: string;
}

export const WS_REPLAY_LIMIT = 500;

/**
 * Client → server socket messages (JSON text). Commands go over HTTP; the socket only carries these.
 * - `ping` → the server answers `{op: 'pong', t}` (not a frame).
 * - `resume` pages the replay: after `ready`, when the last replayed seq is still below `ready.lastSeq`, the
 *   client asks for the next page of persisted frames with seq > since (see feedCatchUp in ext/worker-core).
 */
export type WsClientMessage = { op: 'ping'; t: number } | { op: 'resume'; since: number } | ViewerOp | ExprRecentOp | VoiceClaimOp;
