// Routing: every spot is reachable from every desk, no path crosses furniture or glass,
// lanes keep right, corners are rounded and the speed profile has no jumps.
import { describe, expect, it } from 'vitest';
import { AIS_Y, BLV_Y, blockedAt, buildGrid, lifeNav } from './nav';
import { distanceAt, makeProfile, pointAtDistance, roundRoute, route, seatAttach, slotAttach, speedAt, stopProfile, walkSeconds } from './route';
import { planSpots } from './spots';
import { MAX_WALK_SPEED } from './tables';
import { catalogPlan } from './testing';

const plan = catalogPlan();
const nav = lifeNav(plan);
const spots = planSpots(plan);
const seats = plan.seats.filter((s) => s.personId);

describe('life routes', () => {
  it('derives the places from the plan: the café, coolers, lounge, library, nooks, windows, hallways and drop-bys', () => {
    const kinds = new Set(spots.map((s) => s.kind));
    for (const k of ['coffee_bar', 'water_cooler', 'lounge', 'library', 'phone_booth', 'window', 'hallway', 'desk_dropby'] as const) expect(kinds.has(k)).toBe(true);
    expect(spots.filter((s) => s.kind === 'phone_booth').every((s) => s.realOnly)).toBe(true);
    // Drop-bys stand at the end of the host's desk on the aisle side, a desk pitch out (≥ 16 u: faces and name plates
    // never touch), clear of every other seated colleague, and never on a neighbourhood's floor sign.
    const drops = spots.filter((s) => s.kind === 'desk_dropby');
    expect(drops.length).toBeGreaterThan(40);
    for (const d of drops) {
      const v = d.slots[0]!;
      expect(Math.abs(v.x - d.center.x)).toBeGreaterThanOrEqual(15.9);
      expect(Math.abs(v.y - d.center.y)).toBeLessThanOrEqual(9.1);
      for (const o of seats) if (o.id !== d.seatId) expect(Math.abs(o.x - v.x) >= 14 || Math.abs(o.y - v.y) >= 10).toBe(true);
      for (const z of plan.zones) {
        const c = plan.cells.find((x) => x.id === z.cellIds[0])!;
        expect(v.x > c.x - 4 && v.x < c.x + 52 && v.y > c.y + c.h - 6 && v.y < c.y + c.h + 12).toBe(false);
      }
    }
    // Every slot's front is clear, and slots of one spot never stand on top of each other (faces never overlap).
    for (const sp of spots) {
      for (const sl of sp.slots) expect(blockedAt(nav.grid, sl.front.x, sl.front.y)).toBe(false);
      for (let i = 0; i < sp.slots.length; i++) for (let j = i + 1; j < sp.slots.length; j++) expect(Math.hypot(sp.slots[i]!.x - sp.slots[j]!.x, sp.slots[i]!.y - sp.slots[j]!.y)).toBeGreaterThanOrEqual(9);
      // Everyone a huddle can hold stands at least ~14 u from the others (≈ 50 px at L1: name plates never touch).
      const n = Math.min(sp.huddle, sp.slots.length);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(Math.hypot(sp.slots[i]!.x - sp.slots[j]!.x, sp.slots[i]!.y - sp.slots[j]!.y)).toBeGreaterThanOrEqual(13.9);
    }
  });

  it('reaches every spot slot from every desk without crossing furniture, walls or glass (1.5 u clearance)', () => {
    const strict = buildGrid(plan, 1.5);
    let routes = 0;
    const bad: string[] = [];
    for (const s of seats) {
      const from = seatAttach(nav, plan, s);
      expect(from.length).toBeGreaterThan(0);
      for (const sp of spots) {
        if (sp.kind === 'desk_dropby' && sp.zoneId !== s.zoneId) continue;
        sp.slots.forEach((sl, i) => {
          const r = route(nav, from, slotAttach(nav, sp, i));
          routes++;
          if (!r) return void bad.push(`${s.id} → ${sp.id}#${i}: no route`);
          const leg = Math.hypot(sl.x - sl.front.x, sl.y - sl.front.y) + 1.5;
          const ex = [
            { x: s.x, y: s.y, r: 6 },
            { x: sl.x, y: sl.y, r: leg },
          ];
          const p = makeProfile(roundRoute(nav, r.pts, ex), 42, false);
          for (let d = 0; d <= p.len; d += 0.35) {
            const q = pointAtDistance(p, d);
            if (Math.hypot(q.x - s.x, q.y - s.y) < 6 || Math.hypot(q.x - sl.x, q.y - sl.y) < leg) continue;
            if (blockedAt(strict, q.x, q.y)) {
              bad.push(`${s.id} → ${sp.id}#${i} at ${q.x.toFixed(1)},${q.y.toFixed(1)}`);
              break;
            }
          }
        });
      }
    }
    expect(routes).toBeGreaterThan(14_000);
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('keeps right on the boulevard and the lower aisle (opposite walkers never overlap)', () => {
    const a = seats.find((s) => s.y > 118 && s.y < 140 && s.x < 200)!;
    const b = seats.find((s) => s.y > 118 && s.y < 140 && s.x > 650)!;
    const east = route(nav, seatAttach(nav, plan, a), seatAttach(nav, plan, b))!.pts;
    const west = route(nav, seatAttach(nav, plan, b), seatAttach(nav, plan, a))!.pts;
    const onBlv = (pts: { x: number; y: number }[]) => pts.filter((p) => Math.abs(p.y - BLV_Y) < 6 || Math.abs(p.y - AIS_Y) < 6).map((p) => p.y);
    const ye = onBlv(east);
    const yw = onBlv(west);
    expect(ye.length).toBeGreaterThan(0);
    expect(yw.length).toBeGreaterThan(0);
    // Heading east the walker keeps to the south side of the corridor, heading west to the north side.
    const corridor = Math.abs(ye[0]! - BLV_Y) < 6 ? BLV_Y : AIS_Y;
    expect(ye.every((y) => y >= corridor)).toBe(true);
    expect(yw.every((y) => y <= corridor)).toBe(true);
  });

  it('rounds corners: no sharp turn along a walk', () => {
    const s = seats[40]!;
    const cooler = spots.find((x) => x.id === 'cooler:cafe')!;
    const r = route(nav, seatAttach(nav, plan, s), slotAttach(nav, cooler, 0))!;
    const pts = roundRoute(nav, r.pts, [{ x: s.x, y: s.y, r: 6 }]);
    const p = makeProfile(pts, 42, false);
    let maxTurn = 0;
    for (let d = 3; d < p.len - 3; d += 1) {
      const a = pointAtDistance(p, d - 1);
      const b = pointAtDistance(p, d);
      const c = pointAtDistance(p, d + 1);
      const t1 = Math.atan2(b.y - a.y, b.x - a.x);
      const t2 = Math.atan2(c.y - b.y, c.x - b.x);
      let dt = Math.abs(t2 - t1);
      if (dt > Math.PI) dt = 2 * Math.PI - dt;
      maxTurn = Math.max(maxTurn, dt);
    }
    // A 90° corner spread over a radius-4 arc turns ≤ ~20° per unit walked (plus the odd short A* leg).
    expect(maxTurn).toBeLessThan((50 * Math.PI) / 180);
  });

  it('walks a trapezoid speed profile: eased start and stop, never above 70 u/s, fits long walks in ~16 s', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
    ];
    const p = makeProfile(pts, 42, false);
    expect(p.dur).toBeCloseTo(300 / 42 + 0.45, 3);
    expect(speedAt(p, 0.01)).toBeLessThan(5);
    expect(speedAt(p, p.dur / 2)).toBeCloseTo(42, 5);
    expect(speedAt(p, p.dur - 0.01)).toBeLessThan(5);
    // Continuous distance, monotonic, ends at the length.
    let last = 0;
    for (let t = 0; t <= p.dur; t += 0.01) {
      const d = distanceAt(p, t);
      expect(d).toBeGreaterThanOrEqual(last - 1e-9);
      expect(d - last).toBeLessThan(0.8);
      last = d;
    }
    expect(distanceAt(p, p.dur)).toBeCloseTo(300, 6);
    const long = makeProfile([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 42, false);
    expect(long.v).toBeLessThanOrEqual(MAX_WALK_SPEED);
    expect(long.dur).toBeLessThan(16.6);
    expect(walkSeconds(300, 42)).toBeCloseTo(p.dur, 6);
  });

  it('eases to a stop within 0.5 s', () => {
    const p = stopProfile([{ x: 0, y: 0 }, { x: 10, y: 0 }], 42);
    expect(p.dur).toBeLessThanOrEqual(0.5);
    expect(speedAt(p, 0.001)).toBeGreaterThan(40);
    expect(distanceAt(p, p.dur)).toBeLessThanOrEqual(10.0001);
  });
});
