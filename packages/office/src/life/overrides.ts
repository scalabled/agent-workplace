// Real state always wins: the claim ladder. Pure.
import type { PlaceRef } from './types';

export type ClaimKind = 'owner' | 'room' | 'hand' | 'work' | 'conversation' | 'call' | 'host';

export interface Claim {
  kind: ClaimKind;
  /** Where the claim wants the person ('here' = stay put). Defaults per kind. */
  where?: 'here' | 'desk' | 'workplace' | 'booth' | PlaceRef;
}

export interface Resolved {
  kind: ClaimKind;
  where: 'here' | 'desk' | 'workplace' | 'booth' | 'room' | PlaceRef;
  /** 'none': nobody moves (a two-second think never moves anyone). */
  pace: 'none' | 'brisk';
}

/** Priority order: the owner's attention first, the ambient plan last (it is not a claim). */
export const CLAIM_ORDER: readonly ClaimKind[] = ['owner', 'room', 'hand', 'work', 'conversation', 'call', 'host'];

const DEFAULT_WHERE: Record<ClaimKind, Resolved['where']> = {
  owner: 'here',
  room: 'room',
  hand: 'desk',
  work: 'workplace',
  conversation: 'here',
  call: 'booth',
  host: 'here',
};

export function resolveClaim(claims: readonly Claim[]): Resolved | null {
  let best: Claim | null = null;
  for (const c of claims) if (!best || CLAIM_ORDER.indexOf(c.kind) < CLAIM_ORDER.indexOf(best.kind)) best = c;
  if (!best) return null;
  const where = best.where ?? DEFAULT_WHERE[best.kind];
  const pace: Resolved['pace'] = where === 'here' || where === 'room' ? 'none' : 'brisk';
  return { kind: best.kind, where, pace };
}
