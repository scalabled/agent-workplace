// Moments, autopilot and follow (OFFICE-LIFE §4): what is worth looking at, when the optional autopilot may fly,
// and the critically damped spring that follows a walker. Pure maths.
import type { Point } from '../types';
import type { Moment } from './types';

export const MOMENT_BASE: Readonly<Record<Moment['kind'], number>> = {
  raised_hand: 100,
  welcome: 80,
  win: 70,
  debate: 55,
  huddle: 45,
  work_move: 35,
  night_window: 25,
  arrival: 20,
};

/** A moment before scoring; `bonus` adds to the score (+20 a huddle mid-exchange, −200 a raised hand already shown). */
export type MomentCandidate = Omit<Moment, 'score'> & { bonus?: number };

export interface MomentContext {
  /** The camera centre (projected u). */
  center: Point;
  now: number;
  /** When each moment id was last shown (flown to). */
  shownAt?: ReadonlyMap<string, number>;
  /** People the owner talked to today. */
  regulars?: ReadonlySet<string>;
}

/** Score and sort moments (§4.1): base − 40 if shown in the last 3 min − 0.03/u beyond 300 u + 10 for regulars. */
export function scoreMoments(cands: readonly MomentCandidate[], ctx: MomentContext): Moment[] {
  const out: Moment[] = [];
  for (const c of cands) {
    if (c.kind !== 'raised_hand' && c.endsAt - ctx.now < 10_000) continue;
    let score = MOMENT_BASE[c.kind];
    const shown = ctx.shownAt?.get(c.id);
    if (shown !== undefined && ctx.now - shown < 180_000) score -= 40;
    const d = Math.hypot(c.at.x - ctx.center.x, c.at.y - ctx.center.y);
    score -= 0.03 * Math.max(0, d - 300);
    if (ctx.regulars && c.personIds.some((p) => ctx.regulars!.has(p))) score += 10;
    score += c.bonus ?? 0;
    const { bonus: _bonus, ...m } = c;
    out.push({ ...m, score: Math.round(score * 10) / 10 });
  }
  return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

// ── autopilot ────────────────────────────────────────────────────────────────────
export const AUTOPILOT = Object.freeze({
  /** Fly after this long without input. */
  idleMs: 20_000,
  flightMs: 2400,
  /** Hold a moment at least / at most this long. */
  holdMinMs: 8000,
  holdMaxMs: 25_000,
  /** At least this long between flights, and at most this many a minute. */
  gapMs: 10_000,
  perMinute: 5,
  /** After the owner interrupts, resume after this long without input. */
  resumeMs: 60_000,
  /** Frame moments at L1: legible bubbles, faces never close up. */
  zoom: 3.2,
  maxZoom: 3.4,
  /** A far moment is reached in two phases (out, then in) when farther than this many viewport widths. */
  farViewports: 1.5,
});

export interface AutopilotClock {
  lastInput: number;
  /** Times of recent flights. */
  flights: readonly number[];
  /** A moment is being held until then. */
  holdUntil: number;
  /** The owner interrupted at (resume after resumeMs). */
  interruptedAt: number | null;
}

/** May the autopilot start a flight now? */
export function autopilotDue(c: AutopilotClock, now: number): boolean {
  if (now - c.lastInput < AUTOPILOT.idleMs) return false;
  if (c.interruptedAt !== null && now - c.interruptedAt < AUTOPILOT.resumeMs) return false;
  if (now < c.holdUntil) return false;
  const last = c.flights[c.flights.length - 1];
  if (last !== undefined && now - last < AUTOPILOT.gapMs) return false;
  if (c.flights.filter((t) => now - t < 60_000).length >= AUTOPILOT.perMinute) return false;
  return true;
}

/** How long to hold a moment: its own hold when it has one (a raised hand ≤ 10 s, a huddle's remaining turns). */
export const holdFor = (m: Pick<Moment, 'endsAt' | 'holdMs'>, now: number): number =>
  m.holdMs !== undefined ? Math.max(4000, Math.min(AUTOPILOT.holdMaxMs, m.holdMs)) : Math.max(AUTOPILOT.holdMinMs, Math.min(AUTOPILOT.holdMaxMs, m.endsAt - now));

// ── follow ───────────────────────────────────────────────────────────────────────
/** One step of a critically damped spring (exact solution): position and velocity toward `target`. */
export function springStep(x: number, v: number, target: number, dt: number, omega = 3.5): [number, number] {
  const d = x - target;
  const e = Math.exp(-omega * dt);
  const nx = target + (d + (v + omega * d) * dt) * e;
  const nv = (v - omega * (v + omega * d) * dt) * e;
  return [nx, nv];
}

/**
 * Where the camera centre should be so that `p` stays inside the inset (a share of the half-view from each edge):
 * the smallest move, like a dead zone.
 */
export function followTarget(cam: Point, p: Point, halfW: number, halfH: number, inset = 0.25): Point {
  const ix = halfW * (1 - 2 * inset);
  const iy = halfH * (1 - 2 * inset);
  let { x, y } = cam;
  if (p.x < x - ix) x = p.x + ix;
  else if (p.x > x + ix) x = p.x - ix;
  if (p.y < y - iy) y = p.y + iy;
  else if (p.y > y + iy) y = p.y - iy;
  return { x, y };
}

/** Rate limits for camera motion (§4.4): ≤ 0.35 viewport widths per second of pan. */
export const MAX_PAN_VW_PER_S = 0.35;
