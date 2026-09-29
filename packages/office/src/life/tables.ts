// Office life tables (OFFICE-LIFE §2.2, §2.5, §2.6): Ambience caps, the time-of-day density curve, spot preferences
// per archetype, stroll speeds and the owner-local clock helpers. Pure data and tiny functions.
import type { Ambience, ArchetypeName, LifeCaps, SpotKind } from './types';

/**
 * The §2.5 Ambience table, as tuned by the office-life review: huddles talk in a rhythm (several exchanges 20–40 s
 * apart while someone watches), more people gather at once (the café and the lounge sofa take four outside anchors),
 * and the line budget keeps up. Bubbles on screen stay capped (A1): Quiet 0, Lively 2, Buzzing 3.
 */
export const LIFE_CAPS: Readonly<Record<Ambience, LifeCaps>> = Object.freeze({
  quiet: { walkers: 4, huddles: 3, maxHuddle: 2, maxAnchorHuddle: 2, huddleBubbles: 0, exchangesPerHuddle: 0, linesPerMin: 0, burst: 0, maxLines: 4 },
  lively: { walkers: 8, huddles: 6, maxHuddle: 3, maxAnchorHuddle: 4, huddleBubbles: 2, exchangesPerHuddle: 3, linesPerMin: 10, burst: 6, maxLines: 4 },
  buzzing: { walkers: 12, huddles: 8, maxHuddle: 4, maxAnchorHuddle: 4, huddleBubbles: 3, exchangesPerHuddle: 4, linesPerMin: 14, burst: 8, maxLines: 4 },
});

/** The gap between two exchanges of one huddle while it is in view at L1+ (ms, seeded per huddle). */
export const EXCHANGE_GAP_MS: readonly [number, number] = [20_000, 40_000];
/** After ten minutes of passive viewing, a new exchange at most about this often across the floor (habituation). */
export const HABITUATED_GAP_MS = 180_000;
export const HABITUATION_AFTER_MS = 600_000;

/** Phones keep fewer walkers (§2.5). */
export const PHONE_WALKERS: Readonly<Record<Ambience, number>> = { quiet: 3, lively: 5, buzzing: 6 };

/** Density multiplier per Ambience. */
export const AMBIENCE_K: Readonly<Record<Ambience, number>> = { quiet: 0.4, lively: 1.0, buzzing: 1.45 };

/** The time-of-day density curve (owner-local minutes from midnight). */
export const TOD_DENSITY: readonly { fromMin: number; k: number }[] = Object.freeze([
  { fromMin: 0, k: 0.25 },
  { fromMin: 6 * 60, k: 0.45 },
  { fromMin: 8 * 60, k: 0.8 },
  { fromMin: 9 * 60 + 30, k: 1.0 },
  { fromMin: 11 * 60 + 30, k: 0.9 },
  { fromMin: 14 * 60, k: 0.85 },
  { fromMin: 16 * 60 + 30, k: 1.0 },
  { fromMin: 18 * 60, k: 0.7 },
  { fromMin: 20 * 60, k: 0.45 },
]);

export function todDensity(minute: number): number {
  let k = TOD_DENSITY[0]!.k;
  for (const b of TOD_DENSITY) if (minute >= b.fromMin) k = b.k;
  return k;
}

/** Spot-kind preference multipliers by the time of day (§2.5 "Character" row, §2.8). */
export function todSpotFactor(kind: SpotKind, minute: number): number {
  const night = minute >= 22 * 60 || minute < 6 * 60;
  const late = minute >= 20 * 60 || minute < 6 * 60;
  if (kind === 'window') return late ? 2.2 : minute >= 16 * 60 + 30 ? 1.5 : 1;
  if (kind === 'coffee_bar') return night ? 0.6 : minute >= 8 * 60 && minute < 11 * 60 + 30 ? 1.3 : 1;
  if (kind === 'water_cooler') return night ? 0.8 : minute >= 16 * 60 + 30 && minute < 18 * 60 ? 1.3 : 1;
  if (kind === 'lounge') return minute >= 11 * 60 + 30 && minute < 14 * 60 ? 1.4 : late ? 1.2 : 1;
  if (kind === 'library') return late ? 1.2 : 1;
  if (kind === 'hallway') return night ? 0.5 : 1;
  if (kind === 'desk_dropby') return night ? 0.7 : 1;
  return 1;
}

export type PrefColumn = 'coffee_bar' | 'water_cooler' | 'lounge' | 'library' | 'window' | 'nook' | 'dropby' | 'hallway';

/** The §2.2 preference table (hallway added: brief stop-and-chats, the same for everyone). */
export const PREF: Readonly<Record<ArchetypeName, Record<PrefColumn, number>>> = {
  warm: { coffee_bar: 1.2, water_cooler: 1.4, lounge: 1.2, library: 0.6, window: 0.8, nook: 1.0, dropby: 1.5, hallway: 0.8 },
  'dry-wit': { coffee_bar: 1.0, water_cooler: 1.5, lounge: 0.8, library: 1.0, window: 1.0, nook: 0.8, dropby: 0.8, hallway: 0.8 },
  energetic: { coffee_bar: 1.6, water_cooler: 1.2, lounge: 0.8, library: 0.4, window: 0.6, nook: 0.8, dropby: 1.3, hallway: 0.8 },
  'calm-steady': { coffee_bar: 0.8, water_cooler: 0.8, lounge: 1.4, library: 1.0, window: 1.5, nook: 1.2, dropby: 0.6, hallway: 0.8 },
  blunt: { coffee_bar: 1.3, water_cooler: 1.0, lounge: 0.6, library: 0.8, window: 0.8, nook: 0.8, dropby: 1.0, hallway: 0.8 },
  playful: { coffee_bar: 1.2, water_cooler: 1.5, lounge: 1.4, library: 0.5, window: 0.8, nook: 1.0, dropby: 1.2, hallway: 0.8 },
  meticulous: { coffee_bar: 0.8, water_cooler: 0.8, lounge: 0.6, library: 1.6, window: 0.8, nook: 1.2, dropby: 0.6, hallway: 0.8 },
  gentle: { coffee_bar: 0.8, water_cooler: 1.0, lounge: 1.3, library: 1.2, window: 1.4, nook: 1.2, dropby: 0.8, hallway: 0.8 },
  hustler: { coffee_bar: 1.6, water_cooler: 1.2, lounge: 0.6, library: 0.4, window: 0.6, nook: 0.8, dropby: 1.4, hallway: 0.8 },
  visionary: { coffee_bar: 1.0, water_cooler: 1.0, lounge: 1.2, library: 0.8, window: 1.8, nook: 0.8, dropby: 1.0, hallway: 0.8 },
  analytical: { coffee_bar: 0.8, water_cooler: 0.9, lounge: 0.6, library: 1.7, window: 0.8, nook: 1.0, dropby: 0.6, hallway: 0.8 },
  veteran: { coffee_bar: 1.5, water_cooler: 1.0, lounge: 1.0, library: 1.0, window: 1.2, nook: 0.8, dropby: 0.8, hallway: 0.8 },
};

export const ARCHETYPES: readonly ArchetypeName[] = Object.keys(PREF) as ArchetypeName[];

/** Stroll cruise speed (u/s) before the person's restlessness (§2.6). */
export const STROLL = 42;
export const STROLL_MIN = 36;
export const STROLL_MAX = 52;
/** Real-state returns. */
export const BRISK = 90;
/** No walker ever goes faster. */
export const MAX_WALK_SPEED = 70;
/** Walks longer than this speed up to fit (never above MAX_WALK_SPEED). */
export const MAX_WALK_S = 16;
/** The trapezoid profile's ramps (s). */
export const ACCEL_S = 0.4;
export const DECEL_S = 0.5;

// ── the owner-local clock ────────────────────────────────────────────────────────
/** 'YYYY-MM-DD' of the owner-local calendar day. */
export function dayKeyOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** Local midnight at the start of the day, and the next one (23 or 25 h on daylight-saving days). */
export function dayBounds(d: Date): { start: number; end: number } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return { start, end };
}
/** Owner-local minutes from midnight for an epoch ms (DST-safe: read from the local clock). */
export function localMinute(t: number): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}
/** Epoch ms of a local clock time (minutes from midnight, may exceed 24 h) on a day. */
export function atLocal(day: Date, minute: number): number {
  const h = Math.floor(minute / 60);
  const m = minute - h * 60;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, Math.floor(m), Math.round((m % 1) * 60)).getTime();
}
export const isNightMinute = (m: number): boolean => m >= 22 * 60 || m < 6 * 60;

export const SPOT_LABEL: Readonly<Record<SpotKind, string>> = {
  coffee_bar: 'Coffee bar',
  water_cooler: 'Water cooler',
  lounge: 'Lounge',
  library: 'Library',
  phone_booth: 'Phone booth',
  window: 'By the window',
  hallway: 'Hallway',
  desk_dropby: 'At a desk',
};

/** Where a place is, as a phrase ("at the water cooler"): huddle cards say "Their usual 10:40 at the water cooler". */
export const SPOT_PHRASE: Readonly<Record<SpotKind, string>> = {
  coffee_bar: 'at the coffee bar',
  water_cooler: 'at the water cooler',
  lounge: 'in the lounge',
  library: 'in the library',
  phone_booth: 'in a phone booth',
  window: 'by the window',
  hallway: 'in the hallway',
  desk_dropby: 'at a desk',
};
