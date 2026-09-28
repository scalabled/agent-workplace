import type { AgentId } from './ids';

/**
 * Face/presence states for Inc 0 (EXPERIENCE §4.2, ARCHITECTURE §3.5). Faces are the status UI.
 * `speaking` is client-local truth: a face speaks only while its audio plays on this client.
 * Later increments add blocked, handing_off, attending, receiving, delivered, away.
 */
export type PresenceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'working' | 'raised_hand';

export const PRESENCE_STATES: readonly PresenceState[] = ['idle', 'listening', 'thinking', 'speaking', 'working', 'raised_hand'];

/** Highest first (ARCHITECTURE §3.5 merge order, restricted to the Inc 0 states). */
export const PRESENCE_PRIORITY: readonly PresenceState[] = ['speaking', 'raised_hand', 'listening', 'thinking', 'working', 'idle'];

/** Minimum time a state is held before it may change (ms). */
export const PRESENCE_DWELL_MS: Readonly<Record<PresenceState, number>> = {
  speaking: 300,
  raised_hand: 300,
  listening: 300,
  thinking: 600,
  working: 300,
  idle: 300,
};

export type PresenceBadge = 'hand' | 'lamp';

/** Payload of a `presence` frame. */
export interface PresenceData {
  agentId: AgentId;
  state: PresenceState;
  /** Human sentence for captions/tiles, e.g. "Reading 14 outdoor-retail reports". */
  label: string;
  /** `seq` of the persisted event that caused this state (null for client-local causes). */
  causeSeq: number | null;
  dwellMs?: number;
  badges?: PresenceBadge[];
  /** Project the claim comes from, when it comes from project work. */
  projectId?: string;
}

export function presenceRank(state: PresenceState): number {
  const i = PRESENCE_PRIORITY.indexOf(state);
  return i < 0 ? PRESENCE_PRIORITY.length : i;
}

/** Merge several claims for one agent: the highest-priority state wins; ties keep the first. */
export function mergePresence<T extends Pick<PresenceData, 'state'>>(claims: readonly T[]): T | null {
  let best: T | null = null;
  for (const c of claims) if (!best || presenceRank(c.state) < presenceRank(best.state)) best = c;
  return best;
}
