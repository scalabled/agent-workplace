// Personality becomes habits: sociability, restlessness, humour and curiosity from the catalog
// sliders and traits, and spot preferences from the archetype blend. Pure.
import { ARCHETYPES, PREF } from './tables';
import type { PrefColumn } from './tables';
import type { ArchetypeName, OfficeSpot, PlannerPerson, SliderName } from './types';

export interface SliderStats {
  mean: Partial<Record<SliderName, number>>;
  std: Partial<Record<SliderName, number>>;
}

/** Catalog 1.0 statistics (§2.2); overridable with `sliderStats`. */
export const DEFAULT_SLIDER_STATS: SliderStats = {
  mean: { warmth: 72.0, humor: 58.7, pace: 55.7, detail: 78.3, directness: 68.4, risk_appetite: 50, formality: 50 },
  std: { warmth: 12.8, humor: 13.3, pace: 16.1, detail: 12.6, directness: 10.1, risk_appetite: 15, formality: 15 },
};

export interface LifeKnobs {
  /** Sociability 0.1–0.9. */
  s: number;
  /** Restlessness. */
  r: number;
  /** Humour. */
  h: number;
  /** Curiosity. */
  c: number;
  /** Normalised archetype blend. */
  blend: Readonly<Partial<Record<ArchetypeName, number>>>;
  /** The dominant archetype. */
  top: ArchetypeName;
}

const sigma = (x: number) => 1 / (1 + Math.exp(-x));
const SOCIAL = ['warm', 'playful', 'gregarious', 'outgoing', 'chatty', 'energetic', 'sociable', 'friendly', 'exuberant'];
const RESERVED = ['reserved', 'quiet', 'introverted', 'private', 'soft-spoken', 'understated', 'shy'];
const CALM = ['calm', 'steady', 'unflappable', 'composed', 'patient', 'even-keeled'];
const CURIOUS_GROUPS = /research|data|analy/;

const traitHits = (traits: readonly string[], list: readonly string[]) => Math.min(2, traits.filter((t) => list.includes(t.toLowerCase())).length);

export function lifeKnobs(p: PlannerPerson, stats: SliderStats = DEFAULT_SLIDER_STATS): LifeKnobs {
  const z = (k: SliderName) => {
    const v = p.sliders?.[k];
    const mean = stats.mean[k] ?? DEFAULT_SLIDER_STATS.mean[k] ?? 50;
    const sd = stats.std[k] ?? DEFAULT_SLIDER_STATS.std[k] ?? 15;
    if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
    return Math.max(-2.5, Math.min(2.5, (v - mean) / (sd || 1)));
  };
  const traits = p.traits ?? [];
  const s = Math.max(0.1, Math.min(0.9, sigma(0.9 * z('warmth') + 0.6 * z('humor') - 0.3 * z('detail') + 0.5 * traitHits(traits, SOCIAL) - 0.5 * traitHits(traits, RESERVED))));
  const r = sigma(1.0 * z('pace') + 0.3 * z('risk_appetite') - 0.4 * traitHits(traits, CALM));
  const h = sigma(1.1 * z('humor'));
  const c = sigma(0.7 * z('detail') + 0.4 * (CURIOUS_GROUPS.test(p.groupId) ? 1 : 0));
  const blend = normaliseBlend(p.blend);
  let top: ArchetypeName = 'calm-steady';
  let best = -1;
  for (const a of ARCHETYPES) {
    const w = blend[a] ?? 0;
    if (w > best) {
      best = w;
      top = a;
    }
  }
  return { s, r, h, c, blend, top };
}

export function normaliseBlend(b: OfficeLifePersonBlend | undefined): Partial<Record<ArchetypeName, number>> {
  const out: Partial<Record<ArchetypeName, number>> = {};
  let total = 0;
  for (const a of ARCHETYPES) {
    const w = b?.[a];
    if (typeof w === 'number' && w > 0) {
      out[a] = w;
      total += w;
    }
  }
  if (total <= 0) return { 'calm-steady': 1 };
  for (const a of Object.keys(out) as ArchetypeName[]) out[a] = out[a]! / total;
  return out;
}
type OfficeLifePersonBlend = Readonly<Partial<Record<ArchetypeName, number>>>;

export function prefColumn(spot: Pick<OfficeSpot, 'kind' | 'zoneId'>): PrefColumn {
  switch (spot.kind) {
    case 'lounge':
      return spot.zoneId ? 'nook' : 'lounge';
    case 'desk_dropby':
      return 'dropby';
    case 'phone_booth':
      return 'library';
    default:
      return spot.kind;
  }
}

/** Σ_a blend_a · PREF[a][column]. */
export function blendPref(blend: Readonly<Partial<Record<ArchetypeName, number>>>, col: PrefColumn): number {
  let v = 0;
  for (const a of ARCHETYPES) v += (blend[a] ?? 0) * PREF[a][col];
  return v;
}

/** Archetype fit for casting: how much a person's blend weights these archetypes. */
export function archetypeFit(blend: Readonly<Partial<Record<ArchetypeName, number>>>, want: readonly ArchetypeName[]): number {
  let v = 0;
  for (const a of want) v += blend[a] ?? 0;
  return v;
}
