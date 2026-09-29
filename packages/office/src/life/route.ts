// Walks (OFFICE-LIFE §2.6): routes from desks and spots along the office's lanes, with keep-right lanes, rounded
// corners and a trapezoid speed profile. Pure. The plan's own room walks (plan/walk.ts) are unchanged.
import { COL_PITCH, ROW_Y } from '../plan/geometry';
import type { OfficePlan, OfficeSeat } from '../plan/types';
import type { Facing, Point } from '../types';
import type { Attach, Exempt, LifeNav, Portal } from './nav';
import { AIS_Y, AISLE_OFFSET, BLV_Y, H_LINES, LANE_OFFSET, astar, attachPoint, clearSegment, hLineAt, laneRoute, pathLen, vLineAt } from './nav';
import { ACCEL_S, DECEL_S, MAX_WALK_S, MAX_WALK_SPEED } from './tables';
import type { OfficeSpot } from './types';

const CHAIR_EXEMPT = 6;

/** Ways out of a desk (cached per seat). The Chief leaves the corner office by its door. */
export function seatAttach(nav: LifeNav, plan: OfficePlan, seat: Pick<OfficeSeat, 'id' | 'x' | 'y' | 'kind'>): Attach[] {
  const hit = nav.seatAttach.get(seat.id);
  if (hit) return hit;
  const exempt: Exempt[] = [{ x: seat.x, y: seat.y, r: CHAIR_EXEMPT }];
  const from = { x: seat.x, y: seat.y };
  let out: Attach[] = [];
  if (seat.kind === 'chief') {
    const cell = plan.cells.find((c) => c.role === 'chief');
    const x = cell ? cell.x + 9 : seat.x;
    const line = hLineAt(nav, BLV_Y, x);
    if (line) out = attachPoint(nav, from, exempt, [{ line, x, y: BLV_Y }]);
  } else {
    const r = seat.y < ROW_Y[1] ? 0 : seat.y < ROW_Y[2] ? 1 : 2;
    const within = seat.y - ROW_Y[r];
    const straight = (y: number): Attach | null => {
      const line = hLineAt(nav, y, seat.x);
      if (!line) return null;
      const to = { x: seat.x, y };
      const portal: Portal = { line, x: seat.x, y };
      if (clearSegment(nav.grid, from, to, exempt)) return { portal, path: [from, to], len: Math.abs(y - seat.y) };
      const path = astar(nav.grid, from, to, exempt);
      return path ? { portal, path, len: pathLen(path) } : null;
    };
    if (within < 18) out = [straight(H_LINES[r]!)].filter((a): a is Attach => !!a);
    else if (within > 62) out = [straight(H_LINES[r + 1]!)].filter((a): a is Attach => !!a);
    else {
      const gapY = ROW_Y[r] + 40;
      const col = Math.floor(seat.x / COL_PITCH);
      const sides = [col * COL_PITCH - 8, (col + 1) * COL_PITCH - 8].filter((x) => nav.vx.some((v) => Math.abs(v - x) < 0.01));
      const g = { x: seat.x, y: gapY };
      for (const vx of sides) {
        const line = vLineAt(nav, vx, gapY);
        if (!line) continue;
        const to = { x: vx, y: gapY };
        const portal: Portal = { line, x: vx, y: gapY };
        if (clearSegment(nav.grid, from, g, exempt) && clearSegment(nav.grid, g, to, exempt)) {
          out.push({ portal, path: [from, g, to], len: Math.abs(gapY - seat.y) + Math.abs(vx - seat.x) });
        } else {
          const path = astar(nav.grid, from, to, exempt);
          if (path) out.push({ portal, path, len: pathLen(path) });
        }
      }
    }
    if (!out.length) out = attachPoint(nav, from, exempt);
  }
  nav.seatAttach.set(seat.id, out);
  return out;
}

/** Ways out of a spot slot: the slot, its front, then to the lanes (cached per slot). */
export function slotAttach(nav: LifeNav, spot: OfficeSpot, i: number): Attach[] {
  const key = `${spot.id}#${i}`;
  const hit = nav.slotAttach.get(key);
  if (hit) return hit;
  const slot = spot.slots[i]!;
  const f = slot.front;
  const sameAsFront = Math.hypot(slot.x - f.x, slot.y - f.y) < 0.05;
  const out = attachPoint(nav, f, []).map((a) => {
    const path = sameAsFront ? a.path : [{ x: slot.x, y: slot.y }, ...a.path];
    return { portal: a.portal, path, len: pathLen(path) };
  });
  nav.slotAttach.set(key, out);
  return out;
}

/** Ways from an arbitrary point (someone stopped mid-walk) to the lanes. */
export function pointAttach(nav: LifeNav, p: Point): Attach[] {
  return attachPoint(nav, p, [{ x: p.x, y: p.y, r: 3 }]);
}

export interface Route {
  pts: Point[];
  len: number;
}

const laneOffsetFor = (a: Point, b: Point): number => {
  if (Math.abs(a.y - b.y) < 0.01) return Math.abs(a.y - BLV_Y) < 0.01 || Math.abs(a.y - AIS_Y) < 0.01 ? LANE_OFFSET : 0;
  if (Math.abs(a.x - b.x) < 0.01) return AISLE_OFFSET;
  return 0;
};

/** Offset a lane polyline to the right of travel (keep-right lanes). */
function offsetLanes(pts: Point[]): Point[] {
  if (pts.length < 2) return pts.slice();
  const offs: Point[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const k = laneOffsetFor(a, b);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    offs.push({ x: -uy * k, y: ux * k });
  }
  const out: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const o1 = offs[i - 1];
    const o2 = offs[i];
    if (!o1) out.push({ x: p.x + o2!.x, y: p.y + o2!.y });
    else if (!o2) out.push({ x: p.x + o1.x, y: p.y + o1.y });
    else {
      // Perpendicular turns: the offset lines meet at p + o1 + o2; collinear: p + o2.
      const perp = Math.abs(o1.x * o2.x + o1.y * o2.y) < 1e-6 && (Math.hypot(o1.x, o1.y) > 0 || Math.hypot(o2.x, o2.y) > 0);
      out.push(perp ? { x: p.x + o1.x + o2.x, y: p.y + o1.y + o2.y } : { x: p.x + o2.x, y: p.y + o2.y });
    }
  }
  return out;
}

/** Drop repeated and collinear points. */
export function simplifyPts(pts: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const prev = out[out.length - 2];
    if (prev && last) {
      const cross = (last.x - prev.x) * (p.y - last.y) - (last.y - prev.y) * (p.x - last.x);
      const dot = (last.x - prev.x) * (p.x - last.x) + (last.y - prev.y) * (p.y - last.y);
      if (Math.abs(cross) < 0.01 && dot >= 0) {
        out[out.length - 1] = { x: p.x, y: p.y };
        continue;
      }
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** The shortest route between two places given their ways out (lengths only: the planner). */
export function routeLength(nav: LifeNav, from: readonly Attach[], to: readonly Attach[]): number {
  let best = Infinity;
  for (const a of from) {
    for (const b of to) {
      const lower = a.len + b.len + Math.abs(a.portal.x - b.portal.x) + Math.abs(a.portal.y - b.portal.y);
      if (lower >= best) continue;
      const d = a.len + laneRoute(nav, a.portal, b.portal).d + b.len;
      if (d < best) best = d;
    }
  }
  return best;
}

/** The full route (centre legs + offset lanes), as a polyline. */
export function route(nav: LifeNav, from: readonly Attach[], to: readonly Attach[]): Route | null {
  let best: { a: Attach; b: Attach; via: number[]; d: number } | null = null;
  for (const a of from) {
    for (const b of to) {
      const lr = laneRoute(nav, a.portal, b.portal);
      const d = a.len + lr.d + b.len;
      if (!best || d < best.d) best = { a, b, via: lr.via, d };
    }
  }
  if (!best || best.d === Infinity) return null;
  const { a, b, via } = best;
  const middle = simplifyPts([{ x: a.portal.x, y: a.portal.y }, ...via.map((i) => nav.nodes[i]!), { x: b.portal.x, y: b.portal.y }]);
  const lanes = offsetLanes(middle.length >= 2 ? middle : [middle[0]!, middle[0]!]);
  const endLeg = b.path.slice().reverse();
  // Merge into the lane along the leg when that stays clear; otherwise step onto the centre line first.
  const head = a.path.slice(0, -1);
  const beforeA = head[head.length - 1];
  if (beforeA && !clearSegment(nav.grid, beforeA, lanes[0]!, [{ x: a.path[0]!.x, y: a.path[0]!.y, r: 6 }])) head.push({ x: a.portal.x, y: a.portal.y });
  const tail = endLeg.slice(1);
  const afterB = tail[0];
  const lastLane = lanes[lanes.length - 1]!;
  const endPlace = endLeg[endLeg.length - 1]!;
  if (afterB && !clearSegment(nav.grid, lastLane, afterB, [{ x: endPlace.x, y: endPlace.y, r: 6 }])) tail.unshift({ x: b.portal.x, y: b.portal.y });
  const pts = simplifyPts([...head, ...lanes, ...tail]);
  return { pts, len: pathLen(pts) };
}

/**
 * Round a route's corners without cutting into furniture: each corner tries radius 4, then smaller ones, keeping the
 * first whose arc stays clear (the first and last legs are exempt near their ends: a chair, a sofa, a booth).
 */
export function roundRoute(nav: LifeNav, pts: readonly Point[], exempt: readonly Exempt[] = []): Point[] {
  if (pts.length < 3) return pts.slice();
  const out: Point[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    let arc: Point[] = [b];
    for (const r of [CORNER_R, 2.5, 1.2]) {
      const cand = roundCorners([a, b, c], r).slice(1, -1);
      let ok = true;
      for (let k = 1; k < cand.length && ok; k++) ok = clearSegment(nav.grid, cand[k - 1]!, cand[k]!, exempt);
      if (ok || !clearSegment(nav.grid, a, b, exempt)) {
        // A corner inside an exempt leg (or already blocked) keeps the largest radius.
        arc = cand;
        break;
      }
    }
    out.push(...arc);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** A direct route when both ends see each other (short hops inside a spot). */
export function directRoute(nav: LifeNav, a: Point, b: Point, exempt: readonly Exempt[] = []): Route | null {
  if (!clearSegment(nav.grid, a, b, exempt)) return null;
  const pts = [a, b];
  return { pts, len: pathLen(pts) };
}

// ── the profile: rounded corners and a trapezoid speed profile ───────────────────
export interface PathProfile {
  xs: Float64Array;
  ys: Float64Array;
  cum: Float64Array;
  len: number;
  /** Cruise speed (u/s), the ramps (s) and the duration (s). */
  v: number;
  ta: number;
  td: number;
  dur: number;
  /** A stop profile: decelerates from v to 0 over `dur`. */
  stop?: boolean;
}

export const CORNER_R = 4;

/** Round every corner with a quadratic arc of radius ≤ CORNER_R and sample the result. */
export function roundCorners(pts: readonly Point[], r = CORNER_R): Point[] {
  if (pts.length < 3) return pts.slice();
  const out: Point[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const d = Math.min(r, l1 / 2, l2 / 2);
    if (d < 0.05) {
      out.push(b);
      continue;
    }
    const p1 = { x: b.x - ((b.x - a.x) / l1) * d, y: b.y - ((b.y - a.y) / l1) * d };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * d, y: b.y + ((c.y - b.y) / l2) * d };
    const n = Math.max(3, Math.ceil(d * 1.5));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const m = 1 - t;
      out.push({ x: m * m * p1.x + 2 * m * t * b.x + t * t * p2.x, y: m * m * p1.y + 2 * m * t * b.y + t * t * p2.y });
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** The walk time (s) for a length at a cruise speed, as the profile will walk it. */
export function walkSeconds(len: number, speed: number): number {
  if (len <= 0.01) return 0;
  let v = speed;
  if (len / v > MAX_WALK_S) v = Math.min(MAX_WALK_SPEED, len / MAX_WALK_S);
  const ramps = (ACCEL_S + DECEL_S) / 2;
  if (len < v * ramps) return ACCEL_S + DECEL_S;
  return len / v + ramps;
}

export function makeProfile(pts: readonly Point[], speed: number, round = true): PathProfile {
  const sm = round ? roundCorners(pts) : pts.slice();
  const n = sm.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = sm[i]!.x;
    ys[i] = sm[i]!.y;
    if (i) cum[i] = cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!);
  }
  const len = n ? cum[n - 1]! : 0;
  let v = speed;
  if (len / v > MAX_WALK_S) v = Math.min(MAX_WALK_SPEED, len / MAX_WALK_S);
  let ta = ACCEL_S;
  let td = DECEL_S;
  if (len < v * (ta + td) / 2) v = (2 * len) / (ta + td);
  const dur = len <= 0.01 ? 0 : len / Math.max(0.001, v) + (ta + td) / 2;
  if (len <= 0.01) {
    ta = 0;
    td = 0;
  }
  return { xs, ys, cum, len, v, ta, td, dur };
}

/** A profile that decelerates from `v0` to a stop along the given (short) path. */
export function stopProfile(pts: readonly Point[], v0: number, maxS = 0.5): PathProfile {
  const base = makeProfile(pts, Math.max(1, v0), false);
  const dur = Math.min(maxS, base.len > 0 ? (2 * base.len) / Math.max(1, v0) : 0);
  return { ...base, v: v0, ta: 0, td: dur, dur, stop: true };
}

/** Distance along the path after t seconds. */
export function distanceAt(p: PathProfile, t: number): number {
  if (t <= 0) return 0;
  if (t >= p.dur) return p.len;
  if (p.stop) {
    const a = p.v / Math.max(1e-6, p.dur);
    return Math.min(p.len, p.v * t - 0.5 * a * t * t);
  }
  if (t < p.ta) return (0.5 * p.v * t * t) / p.ta;
  if (t < p.dur - p.td) return (p.v * p.ta) / 2 + p.v * (t - p.ta);
  const r = p.dur - t;
  return p.len - (0.5 * p.v * r * r) / p.td;
}

/** Speed (u/s) after t seconds. */
export function speedAt(p: PathProfile, t: number): number {
  if (t <= 0 || t >= p.dur) return 0;
  if (p.stop) return p.v * (1 - t / p.dur);
  if (t < p.ta) return (p.v * t) / p.ta;
  if (t < p.dur - p.td) return p.v;
  return (p.v * (p.dur - t)) / p.td;
}

/** The point and the direction of travel at distance s. */
export function pointAtDistance(p: PathProfile, s: number): { x: number; y: number; dx: number; dy: number } {
  const n = p.cum.length;
  if (n === 0) return { x: 0, y: 0, dx: 0, dy: 0 };
  if (n === 1 || s <= 0) {
    const dx = n > 1 ? p.xs[1]! - p.xs[0]! : 0;
    const dy = n > 1 ? p.ys[1]! - p.ys[0]! : 0;
    return { x: p.xs[0]!, y: p.ys[0]!, dx, dy };
  }
  if (s >= p.len) return { x: p.xs[n - 1]!, y: p.ys[n - 1]!, dx: p.xs[n - 1]! - p.xs[n - 2]!, dy: p.ys[n - 1]! - p.ys[n - 2]! };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const seg = p.cum[hi]! - p.cum[lo]!;
  const t = seg > 0 ? (s - p.cum[lo]!) / seg : 0;
  const dx = p.xs[hi]! - p.xs[lo]!;
  const dy = p.ys[hi]! - p.ys[lo]!;
  return { x: p.xs[lo]! + dx * t, y: p.ys[lo]! + dy * t, dx, dy };
}

/** The remaining path from distance s (for stops and re-routes). */
export function subPath(p: PathProfile, s0: number, s1 = p.len): Point[] {
  const out: Point[] = [];
  const a = pointAtDistance(p, s0);
  out.push({ x: a.x, y: a.y });
  for (let i = 0; i < p.cum.length; i++) if (p.cum[i]! > s0 && p.cum[i]! < s1) out.push({ x: p.xs[i]!, y: p.ys[i]! });
  const b = pointAtDistance(p, s1);
  out.push({ x: b.x, y: b.y });
  return out;
}

export const facingOf = (dx: number, dy: number): Facing => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n');
