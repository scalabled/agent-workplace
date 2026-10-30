// Level of detail and the animation budget. Pure.
import type { FaceTier } from '../types';

export type Lod = 0 | 1 | 2;

/** Zoom thresholds (px per u) between L0 plan, L1 neighbourhood and L2 desk. */
export const LOD_THRESHOLDS = [2.2, 4.5] as const;
/** ±8 % hysteresis, so levels never thrash around a threshold. */
export const LOD_HYSTERESIS = 0.08;

export function lodFor(zoom: number, prev?: Lod | null): Lod {
  if (prev === undefined || prev === null) return zoom < LOD_THRESHOLDS[0] ? 0 : zoom < LOD_THRESHOLDS[1] ? 1 : 2;
  let l: number = prev;
  while (l < 2 && zoom > LOD_THRESHOLDS[l]! * (1 + LOD_HYSTERESIS)) l++;
  while (l > 0 && zoom < LOD_THRESHOLDS[l - 1]! * (1 - LOD_HYSTERESIS)) l--;
  return l as Lod;
}

/**
 * Face size in screen px per level (L0 draws people in world space instead): L1 clamp(24, 5.2 u × zoom, 32), so the
 * chair back and its star base stay visible around the badge; L2 clamp(40, 6.2 u × zoom, 58).
 */
export function faceSize(lod: Lod, zoom: number, chief = false): number {
  const k = chief ? 1.35 : 1;
  if (lod === 0) return 0;
  const [min, perU, max] = lod === 1 ? [24, 5.2, 32] : [40, 6.2, 58];
  return Math.round(Math.min(max, Math.max(min, perU * zoom)) * k);
}

/** Show first names from this zoom (L1); full names and titles at L2. */
export const NAMES_ZOOM = 3.0;

export interface TierCandidate {
  id: string;
  speaking?: boolean;
  dragging?: boolean;
  hovered?: boolean;
  focused?: boolean;
  bubble?: boolean;
}

/**
 * Desk-mode tiers: at most `max` tiles by priority (speaking > dragged > hovered > keyboard-focused > has a bubble);
 * everyone else is a token. Stable: ties keep input order.
 */
export function allocateTiers(cands: readonly TierCandidate[], max = 3): Map<string, FaceTier> {
  const score = (c: TierCandidate) => (c.speaking ? 16 : 0) + (c.dragging ? 8 : 0) + (c.hovered ? 4 : 0) + (c.focused ? 2 : 0) + (c.bubble ? 1 : 0);
  const ranked = cands
    .map((c, i) => ({ c, i, s: score(c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const out = new Map<string, FaceTier>();
  for (const c of cands) out.set(c.id, 'token');
  ranked.slice(0, max).forEach((x) => out.set(x.c.id, 'tile'));
  return out;
}
