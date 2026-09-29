// Casting the landing page's faces (D3 "modern, hip knowledge workers"): who appears first, and in what order.
// The catalog's own order front-loads its most senior, most formal looks; marketing surfaces lead with the
// younger half of the cast, mix pronouns, vary the rim-light colours next to each other and keep at most one
// person aged 45+ per row. Pure functions over catalog data (names are never hard-coded).
import { hexToOklch } from '../lib/accent';

export interface CastMember {
  id: string;
  pronouns: string;
  /** Catalog age range, e.g. "35-39". */
  age: string;
  accent: string;
}

/** The low end of an age range ("45-49" → 45); unknown → 35 (the middle of the cast). */
export function ageFloor(range: string): number {
  const n = Number.parseInt(range, 10);
  return Number.isFinite(n) ? n : 35;
}

export const isSenior = (m: Pick<CastMember, 'age'>) => ageFloor(m.age) >= 45;
export const isYoung = (m: Pick<CastMember, 'age'>) => ageFloor(m.age) < 40;

/** Hue distance in degrees (0–180) between two accents, via OKLCH. */
export function hueGap(a: string, b: string): number {
  const ha = hexToOklch(a)?.[2];
  const hb = hexToOklch(b)?.[2];
  if (ha === undefined || hb === undefined) return 180;
  const d = Math.abs(ha - hb) % 360;
  return d > 180 ? 360 - d : d;
}

/** Round-robin across pronoun groups, keeping each group's catalog order: no run of one gender. */
export function interleaveByPronouns<T extends CastMember>(people: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const p of people) {
    const g = groups.get(p.pronouns) ?? [];
    g.push(p);
    groups.set(p.pronouns, g);
  }
  const queues = [...groups.values()].sort((a, b) => b.length - a.length);
  const out: T[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
  return out;
}

/** Neighbouring faces should not share a rim colour. */
const MIN_HUE_GAP = 30;

/**
 * Order `people` for a grid `perRow` wide, `size` long: the under-40s first (pronouns interleaved), then the
 * early forties, then 45+; no 45+ person in the first `seniorFrom` slots and at most one per row; each face's
 * accent differs from its left and upper neighbours where the pool allows.
 */
export function curate<T extends CastMember>(people: readonly T[], opts: { size: number; perRow: number; seniorFrom?: number }): T[] {
  const { size, perRow } = opts;
  const seniorFrom = opts.seniorFrom ?? perRow;
  const pool = [...interleaveByPronouns(people.filter(isYoung)), ...interleaveByPronouns(people.filter((p) => !isYoung(p) && !isSenior(p))), ...interleaveByPronouns(people.filter(isSenior))];
  const out: T[] = [];
  while (out.length < size && pool.length) {
    const i = out.length;
    const rowStart = i - (i % perRow);
    const seniorsInRow = out.slice(rowStart).filter(isSenior).length;
    const left = i % perRow ? out[i - 1] : undefined;
    const above = i >= perRow ? out[i - perRow] : undefined;
    const allowed = (p: T) => !isSenior(p) || (i >= seniorFrom && seniorsInRow === 0);
    const distinct = (p: T) => (!left || hueGap(p.accent, left.accent) >= MIN_HUE_GAP) && (!above || hueGap(p.accent, above.accent) >= MIN_HUE_GAP);
    let k = pool.findIndex((p) => allowed(p) && distinct(p));
    if (k < 0) k = pool.findIndex(allowed);
    if (k < 0) break;
    out.push(pool.splice(k, 1)[0]!);
  }
  return out;
}
