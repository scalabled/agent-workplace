import type { ErrorCode, JobSnapshot, ProviderId, WorkspaceSettings } from './api';
import type { ActorId, AgentId, JobId, MessageId, OpId, SteerId, StreamId, TurnId, WorkspaceId } from './ids';
import type {
  AttentionChangedData,
  ExprIntentId,
  ExprRecentOp,
  MoodChangedData,
  ReactHint,
  ReflexFaceData,
  ReflexSayData,
  SideTalkLineData,
  TalkSurface,
  ViewerOp,
} from './ext/expressions';
import type { PresenceData } from './presence';

/**
 * Event envelope (ARCHITECTURE §3.1, trimmed for Inc 0).
 * - Persisted frames carry `seq` (gap-free per stream, assigned inside the writer's storage transaction).
 * - Ephemeral frames (deltas, presence, ready, error) carry no `seq`; they carry `after` = the last
 *   persisted seq of that stream when they were emitted.
 * Builders may add frame types only via packages/protocol/src/ext/<builder>.ts (see CONTRACTS.md).
 */
export const PROTOCOL_VERSION = 1 as const;

export interface Cause {
  streamId: StreamId;
  seq: number;
}

export interface FrameEnvelope<T extends FrameType = FrameType> {
  v: typeof PROTOCOL_VERSION;
  streamId: StreamId;
  /** Persisted frames only. */
  seq?: number;
  /** Ephemeral frames only: last persisted seq at emit time. */
  after?: number;
  /** ISO-8601 time of emission. */
  ts: string;
  type: T;
  /** The client command this frame answers (idempotency / optimistic UI reconciliation). */
  opId?: OpId;
  actor?: ActorId;
  /** The event that produced this one (e.g. a mirrored project event). */
  cause?: Cause;
  data: FrameDataMap[T];
}

export type TalkFinish = 'stop' | 'cancelled' | 'error' | 'length';

export interface UsageSummary {
  provider: ProviderId;
  input: number;
  output: number;
  /** null = unknown (never shown as free). */
  usd: number | null;
}

export interface FrameDataMap {
  /** First frame on every socket. Ephemeral. */
  ready: { workspaceId: WorkspaceId; streamId: StreamId; lastSeq: number; replayFrom: number; serverTime: string };

  /**
   * The owner's message, echoed with its opId. Persisted. `agentId` is the addressee (absent = the Chief of Staff);
   * `surface: 'floor'` marks a Floor quick-chat (never in the Talk transcript or the Chief's history).
   */
  'talk.owner': { turnId: TurnId; messageId: MessageId; text: string; via: 'text' | 'voice'; agentId?: AgentId; surface?: TalkSurface };
  /**
   * Streaming text of a reply. Ephemeral. `hint`: on the first delta of a Chief turn only, the reaction the model
   * asked for with its `⟦react:…⟧` head token (already stripped from the text).
   */
  'talk.delta': { turnId: TurnId; messageId: MessageId; agentId: AgentId; delta: string; surface?: TalkSurface; hint?: ReactHint };
  /** A complete Chief of Staff message: a turn's reply, or a proactive one (job done). Persisted. */
  'talk.message': {
    turnId: TurnId | null;
    messageId: MessageId;
    agentId: AgentId;
    text: string;
    /**
     * reply = answer to the owner; announcement = proactive (e.g. job finished); status = from live job state;
     * reflex = a phatic reply picked from the expression catalog without a model call (Inc 0.5).
     */
    kind: 'reply' | 'announcement' | 'status' | 'reflex';
    /** Job this message is about, if any. */
    jobId?: JobId;
    surface?: TalkSurface;
    /** `kind: 'reflex'` only: the intent and catalog line that produced the text. */
    intent?: ExprIntentId;
    lineId?: string;
  };
  /** The turn is over. Persisted. */
  'talk.done': {
    turnId: TurnId;
    messageId: MessageId | null;
    /** Who answered (absent = the Chief of Staff). */
    agentId?: AgentId;
    surface?: TalkSurface;
    finish: TalkFinish;
    /** What the Chief of Staff did: answer | delegate | status | steer | cancel. */
    route?: string;
    usage?: UsageSummary;
  };

  /** A background job started (Everyday ProjectDO). Persisted. */
  'job.started': { job: JobSnapshot };
  /** A checkpoint passed; `label` is the new running sentence. Persisted (sentence-rate, never token-rate). */
  'job.progress': { jobId: JobId; label: string; step: number; of: number | null; partial?: string };
  /** A steer was queued, then applied at the next checkpoint. Persisted. */
  'job.steered': { jobId: JobId; steerId: SteerId; text: string; status: 'queued' | 'applied' };
  /** Finished with a result. Persisted. */
  'job.done': { jobId: JobId; summary: string; result: string; finishedText: string };
  /** Failed after retries. Persisted. */
  'job.failed': { jobId: JobId; code: ErrorCode; message: string; retryable: boolean };
  /**
   * Cancelled by the owner. Persisted. `by`: 'owner' when they pressed Stop (the Chief of Staff then acknowledges
   * it in the thread), 'chief' when the Chief of Staff stopped it on their word (and already said so).
   */
  'job.cancelled': { jobId: JobId; reason?: string; by?: 'owner' | 'chief' };

  /** A face state claim. Ephemeral; recomputable from the ledger. */
  presence: PresenceData;
  /** Owner settings changed (another tab, onboarding). Persisted. */
  'workspace.updated': { settings: WorkspaceSettings };
  /** A command or turn failed. Ephemeral. One sentence with its fix; names missing keys. */
  error: { code: ErrorCode; message: string; opId?: OpId; turnId?: TurnId; missingKeys?: string[] };

  // ── Inc 0.5 living workforce (ext/expressions.ts). All ephemeral: never persisted, never replayed. ──
  /** A reflex micro-utterance to voice, caption and animate. */
  'reflex.say': ReflexSayData;
  /** A face gesture only. */
  'reflex.face': ReflexFaceData;
  /** One line of coworker side-talk (Inc 1; the runner already handles it). */
  'sidetalk.line': SideTalkLineData;
  /** An agent's mood moved enough to show on the face. */
  'mood.changed': MoodChangedData;
  /** An agent's focus and background threads changed. */
  'attention.changed': AttentionChangedData;
}

export type FrameType = keyof FrameDataMap;

/** Discriminated union of all frames: `switch (frame.type)` narrows `frame.data`. */
export type Frame = { [K in FrameType]: FrameEnvelope<K> }[FrameType];

export const PERSISTED_FRAME_TYPES: ReadonlySet<FrameType> = new Set<FrameType>([
  'talk.owner',
  'talk.message',
  'talk.done',
  'job.started',
  'job.progress',
  'job.steered',
  'job.done',
  'job.failed',
  'job.cancelled',
  'workspace.updated',
]);

export const EPHEMERAL_FRAME_TYPES: ReadonlySet<FrameType> = new Set<FrameType>([
  'ready',
  'talk.delta',
  'presence',
  'error',
  'reflex.say',
  'reflex.face',
  'sidetalk.line',
  'mood.changed',
  'attention.changed',
]);

export function isPersisted(type: FrameType): boolean {
  return PERSISTED_FRAME_TYPES.has(type);
}

/** What a writer supplies; the ledger adds v, streamId, seq/after and ts. */
export type FrameInput<T extends FrameType = FrameType> = Pick<FrameEnvelope<T>, 'type' | 'data' | 'opId' | 'actor' | 'cause'>;

export function makeFrame<T extends FrameType>(
  streamId: StreamId,
  input: FrameInput<T>,
  position: { seq: number } | { after: number },
  now: Date = new Date(),
): FrameEnvelope<T> {
  const frame: FrameEnvelope<T> = { v: PROTOCOL_VERSION, streamId, ts: now.toISOString(), type: input.type, data: input.data };
  if ('seq' in position) frame.seq = position.seq;
  else frame.after = position.after;
  if (input.opId !== undefined) frame.opId = input.opId;
  if (input.actor !== undefined) frame.actor = input.actor;
  if (input.cause !== undefined) frame.cause = input.cause;
  return frame;
}

/**
 * Client → server socket messages. Commands go over HTTP with an opId; the socket carries keepalive, replay paging
 * and (Inc 0.5) the fire-and-forget viewer and expression-recency ops.
 */
export type ClientSocketMessage = { op: 'ping'; t?: number } | { op: 'resume'; since: number } | ViewerOp | ExprRecentOp;
/** Server replies to `ping` with this (not a frame). */
export interface PongMessage {
  op: 'pong';
  t?: number;
}

/** Parse and minimally validate a socket message from the server. Returns null for pongs/garbage. */
export function parseFrame(raw: string): Frame | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const f = value as Partial<FrameEnvelope>;
  if (f.v !== PROTOCOL_VERSION || typeof f.type !== 'string' || typeof f.streamId !== 'string' || !f.data) return null;
  return value as Frame;
}
