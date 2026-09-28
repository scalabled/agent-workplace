/**
 * Ids and stream names. Ids are prefixed, time-sortable strings (ULID-style: 10 chars of
 * Crockford base32 time + 16 random chars). Paths and events carry ids, never names.
 */

export type WorkspaceId = string;
/** `everyday` is the built-in project for one-off tasks; real projects are `prj_…`. */
export type ProjectId = 'everyday' | `prj_${string}`;
export type JobId = `job_${string}`;
export type TurnId = `turn_${string}`;
export type MessageId = `msg_${string}`;
export type SteerId = `steer_${string}`;
/** Client-generated idempotency key for a command (ULID recommended). */
export type OpId = string;

/** Coworker / Chief of Staff agent id. Catalog coworkers are `cw_<personaId>`. */
export type AgentId = `cw_${string}`;
/** Who produced an event. */
export type ActorId = AgentId | `owner:${string}` | 'owner' | 'system';

/** The Chief of Staff's agent id (one per workspace; the lead persona behind it can change). */
export const CHIEF_ID = 'cw_chief' as const satisfies AgentId;
/** Inc 0 is single-owner, single-workspace. */
export const OWNER_ACTOR = 'owner' as const satisfies ActorId;
export const DEFAULT_WORKSPACE_ID: WorkspaceId = 'local';
export const EVERYDAY_PROJECT_ID = 'everyday' as const satisfies ProjectId;

export function coworkerAgentId(personaId: string): AgentId {
  return `cw_${personaId}`;
}

/** Returns the catalog persona id behind a coworker agent id, or null for the Chief of Staff / non-coworkers. */
export function personaIdFromAgentId(agentId: string): string | null {
  if (agentId === CHIEF_ID || !agentId.startsWith('cw_')) return null;
  return agentId.slice(3);
}

// ── streams ─────────────────────────────────────────────────────────────────────
export type StreamId = `ws:${string}` | `p:${string}` | `rm:${string}` | `run:${string}`;

/** The owner feed: the one stream a client socket subscribes to in Inc 0 (see CONTRACTS.md §Events). */
export function workspaceStream(ws: WorkspaceId): StreamId {
  return `ws:${ws}`;
}

/** A project's ledger stream. Everyday is keyed per workspace: `p:everyday:<ws>`. */
export function projectStream(ws: WorkspaceId, projectId: ProjectId): StreamId {
  return projectId === EVERYDAY_PROJECT_ID ? `p:everyday:${ws}` : `p:${projectId}`;
}

/** Durable Object names (use with `namespace.idFromName`). */
export const doNames = {
  workspace: (ws: WorkspaceId) => `ws:${ws}`,
  project: (ws: WorkspaceId, projectId: ProjectId) => (projectId === EVERYDAY_PROJECT_ID ? `p:everyday:${ws}` : `p:${projectId}`),
  room: (roomId: string) => `rm:${roomId}`,
  run: (jobId: string) => `run:${jobId}`,
} as const;

// ── id generation ───────────────────────────────────────────────────────────────
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const c = (globalThis as unknown as { crypto?: CryptoLike }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** 26-char ULID-style string (uppercase Crockford base32), sortable by creation time. */
export function ulid(now: number = Date.now()): string {
  let t = Math.max(0, Math.floor(now));
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[rnd[i]! % 32];
  return time + rand;
}

/** `newId('job')` → `job_01J9ZK4Q2M…` (lowercase). */
export function newId<P extends string>(prefix: P, now?: number): `${P}_${string}` {
  return `${prefix}_${ulid(now).toLowerCase()}`;
}

export const ids = {
  job: (): JobId => newId('job'),
  turn: (): TurnId => newId('turn'),
  message: (): MessageId => newId('msg'),
  steer: (): SteerId => newId('steer'),
  op: (): OpId => newId('op'),
} as const;
