// Places: where people take breaks and huddle, derived from the plan's cells and props. Pure;
// not part of OfficePlan.hash. Every slot has a clear `front` point that the routes reach.
import { COL_PITCH, CELL_W, ROW_Y } from '../plan/geometry';
import type { OfficePlan, OfficeSeat, PlanCell } from '../plan/types';
import type { Facing, Point } from '../types';
import { BLV_Y, blockedAt, clearSegment, lifeNav } from './nav';
import { seatAttach } from './route';
import { SPOT_LABEL } from './tables';
import type { OfficeSpot, SpotKind, SpotSlot } from './types';

const TOD: Record<SpotKind, { night: number; dusk: number }> = {
  coffee_bar: { night: 0.6, dusk: 1 },
  water_cooler: { night: 0.8, dusk: 1.3 },
  lounge: { night: 1.2, dusk: 1 },
  library: { night: 1.2, dusk: 1 },
  window: { night: 2.2, dusk: 1.5 },
  hallway: { night: 0.5, dusk: 1 },
  desk_dropby: { night: 0.7, dusk: 1 },
  phone_booth: { night: 1, dusk: 1 },
};

const cache = new WeakMap<OfficePlan, OfficeSpot[]>();

export function planSpots(plan: OfficePlan): OfficeSpot[] {
  const hit = cache.get(plan);
  if (hit) return hit;
  const out: OfficeSpot[] = [];
  const spot = (id: string, kind: SpotKind, cell: Pick<PlanCell, 'x' | 'y' | 'col'>, center: Point, slots: SpotSlot[], extra: Partial<OfficeSpot> = {}) => {
    const abs = (p: Point) => ({ x: cell.x + p.x, y: cell.y + p.y });
    out.push({
      id,
      kind,
      label: SPOT_LABEL[kind],
      center: abs(center),
      slots: slots.map((s) => ({ ...s, ...abs(s), front: abs(s.front) })),
      solo: kind !== 'hallway' && kind !== 'desk_dropby',
      realOnly: kind === 'phone_booth',
      huddle: 0,
      col: cell.col,
      tod: TOD[kind],
      ...extra,
    });
  };
  const stand = (x: number, y: number, facing: Facing): SpotSlot => ({ x, y, facing, posture: 'stand', front: { x, y } });
  const sit = (x: number, y: number, facing: Facing, fx: number, fy: number): SpotSlot => ({ x, y, facing, posture: 'sit', front: { x: fx, y: fy } });

  for (const cell of plan.cells) {
    if (cell.amenity === 'cafe') {
      // The counter takes a group of four (slots 15 u apart: faces and name plates never touch at L1).
      spot('cafe:counter', 'coffee_bar', cell, { x: 40, y: 10 }, [stand(18, 16, 'n'), stand(33, 17.5, 'n'), stand(48, 16, 'n'), stand(63, 17.5, 'n')], { huddle: 4 });
      // Two stools of the four, ≥ 16 u apart: neighbouring stools (9.4 u) would run the name plates together.
      spot('cafe:island', 'coffee_bar', cell, { x: 44, y: 36 }, [30, 48.8].map((x) => sit(x, 47, 'n', x, 52.5)), { huddle: 2 });
      spot('cafe:high', 'coffee_bar', cell, { x: 78, y: 64 }, [sit(71, 68, 'e', 71, 73.5), sit(85, 68, 'w', 85, 73.5)], { huddle: 2 });
      spot('cooler:cafe', 'water_cooler', cell, { x: 86, y: 30 }, [stand(74, 22, 'e'), stand(74, 40, 'e'), stand(90, 46, 'n'), stand(90, 14.5, 's')], { huddle: 4 });
    } else if (cell.amenity === 'lounge') {
      // The sofa and a standing place at its east end: a group of four fits.
      spot('lounge:sofa', 'lounge', cell, { x: 48, y: 40 }, [sit(34, 27.5, 's', 34, 37), sit(48, 27.5, 's', 48, 37), sit(62, 27.5, 's', 62, 37), stand(78, 38, 'w')], { huddle: 4 });
      spot('lounge:chairs', 'lounge', cell, { x: 48, y: 46 }, [sit(32, 64, 'n', 32, 56.5), sit(64, 64, 'n', 64, 56.5)], { huddle: 2 });
    } else if (cell.amenity === 'library') {
      spot('library:read', 'library', cell, { x: 72, y: 46 }, [sit(72, 36, 's', 72, 44)], { huddle: 0 });
      spot('library:shelves', 'library', cell, { x: 33, y: 16 }, [stand(24, 22.5, 'n'), stand(42, 22.5, 'n')], { huddle: 2 });
      spot('cooler:library', 'water_cooler', cell, { x: 6, y: 36 }, [stand(13, 27, 'w'), stand(15, 45, 'w')], { huddle: 2 });
      for (let i = 0; i < 4; i++) {
        const x = 4 + i * 23 + 9.5;
        spot(`booth:${i}`, 'phone_booth', cell, { x, y: 60 }, [sit(x, 64, 'n', x, 75.5)], { huddle: 0 });
      }
    }
  }

  // Reception: the two benches in the south strip (people sit facing the floor).
  for (const b of plan.props.filter((p) => p.symbol === 'bench' && p.w && p.w >= 30)) {
    const cell = { x: b.x, y: b.y, col: Math.floor(b.x / COL_PITCH) };
    const w = b.w!;
    spot(`reception:${b.x < plan.bounds.w / 2 ? 'w' : 'e'}`, 'lounge', cell, { x: w / 2, y: -14 }, [sit(w * 0.25, 3, 'n', w * 0.25, -4.5), sit(w * 0.75, 3, 'n', w * 0.75, -4.5)], { huddle: 2, label: 'Reception' });
  }

  // Neighbourhood nooks: the two armchairs in a neighbourhood's commons (the team's own corner).
  for (const zone of plan.zones) {
    zone.cellIds.forEach((cid, ci) => {
      const cell = plan.cells.find((c) => c.id === cid)!;
      const chairs = plan.props.filter((p) => p.symbol === 'armchair' && p.x > cell.x && p.x < cell.x + cell.w && p.y > cell.y && p.y < cell.y + cell.h);
      if (chairs.length !== 2) return;
      const [a, b] = chairs.sort((m, n) => m.x - n.x) as [typeof chairs[0], typeof chairs[0]];
      const mx = (a.x + b.x) / 2;
      const rel = (x: number, y: number) => ({ x: x - cell.x, y: y - cell.y });
      const ca = rel(a.x, a.y);
      const cb = rel(b.x, b.y);
      spot(`nook:${zone.id}:${ci}`, 'lounge', cell, rel(mx, a.y - 9), [sit(ca.x, ca.y, 'n', ca.x, ca.y - 7.5), sit(cb.x, cb.y, 'n', cb.x, cb.y - 7.5)], {
        huddle: 2,
        zoneId: zone.id,
        label: 'Team corner',
      });
    });
  }

  // Windows: two stand points per north-row neighbourhood, away from the planter.
  for (const cell of plan.cells) {
    if (cell.row !== 0 || cell.role !== 'pod') continue;
    const plant = plan.props.find((p) => p.y === 6 && p.x >= cell.x && p.x <= cell.x + CELL_W);
    const cands = [30, 48, 66];
    let cx = 48;
    let best = -1;
    for (const c of cands) {
      const d = plant ? Math.abs(cell.x + c - plant.x) : 50 - Math.abs(c - 48);
      if (d > best) {
        best = d;
        cx = c;
      }
    }
    spot(`window:c${cell.col}`, 'window', { x: cell.x, y: 0, col: cell.col }, { x: cx, y: 0 }, [stand(cx - 7.5, 5, 'n'), stand(cx + 7.5, 5, 'n')], { huddle: 2 });
  }

  // Hallways: a stop-and-chat pair on the boulevard's north edge beside each column.
  for (let c = 1; c < plan.cols; c++) {
    const vx = c * COL_PITCH - 8;
    const y = BLV_Y - 9;
    spot(`hall:b${c}`, 'hallway', { x: 0, y: 0, col: c }, { x: vx + 9, y }, [stand(vx + 1, y, 'e'), stand(vx + 16, y, 'w')], { huddle: 2 });
  }

  // Desk drop-bys: beside a teammate's chair, on their way out.
  const nav = lifeNav(plan);
  for (const seat of plan.seats) {
    if (!seat.personId || seat.kind !== 'desk') continue;
    const v = dropBySlot(nav, plan, seat);
    if (!v) continue;
    out.push({
      id: `desk:${seat.id}`,
      kind: 'desk_dropby',
      label: SPOT_LABEL.desk_dropby,
      center: { x: seat.x, y: seat.y },
      slots: [v],
      solo: false,
      realOnly: false,
      huddle: 2,
      seatId: seat.id,
      zoneId: seat.zoneId,
      col: Math.floor((seat.x + 8) / COL_PITCH),
      tod: TOD.desk_dropby,
    });
  }

  // Drop anything whose slot is not clear (defensive: a template change must never put people in furniture).
  const clean = out.filter((s) => s.slots.every((sl) => !blockedAt(nav.grid, sl.front.x, sl.front.y)));
  cache.set(plan, clean);
  return clean;
}

/**
 * Where a visitor stands by a seated teammate: at the end of the host's desk on the aisle side, a desk pitch out
 * (16 u: the two faces and name plates never touch at L1), on a side with no seated neighbour, and never on the
 * neighbourhood's floor sign; else a little further out into the aisle. Only seats whose way out is a straight leg
 * to an aisle (the outer rows of a bench) get a drop-by spot.
 */
function dropBySlot(nav: ReturnType<typeof lifeNav>, plan: OfficePlan, seat: OfficeSeat): SpotSlot | null {
  const exits = seatAttach(nav, plan, seat);
  const leg = exits[0]?.path;
  if (!leg || leg.length !== 2) return null;
  const a = leg[0]!;
  const b = leg[1]!;
  if (Math.abs(b.x - a.x) > 0.01) return null;
  const uy = Math.sign(b.y - a.y);
  const neighbours = plan.seats.filter((o) => o.personId && o.id !== seat.id && Math.abs(o.y - seat.y) < 12 && Math.abs(o.x - seat.x) < 40);
  // The zone's floor sign sits under its first cell, in the aisle (scene buildLabels): keep visitors off it.
  const zone = plan.zones.find((z) => z.id === seat.zoneId);
  const first = zone ? plan.cells.find((c) => c.id === zone.cellIds[0]) : undefined;
  const onSign = (p: Point) => !!first && p.x > first.x - 4 && p.x < first.x + 52 && p.y > first.y + first.h - 6 && p.y < first.y + first.h + 12;
  const sides = [-1, 1].sort((l, r) => neighbours.filter((o) => Math.sign(o.x - seat.x) === l).length - neighbours.filter((o) => Math.sign(o.x - seat.x) === r).length);
  for (const [dx, dy] of [[16, 3], [16, 6], [17, 9]] as const) {
    for (const side of sides) {
      const p = { x: a.x + side * dx, y: a.y + uy * dy };
      if (blockedAt(nav.grid, p.x, p.y) || onSign(p)) continue;
      if (neighbours.some((o) => Math.abs(o.x - p.x) < 14 && Math.abs(o.y - p.y) < 10)) continue;
      // Reachable from the aisle side along a clear path.
      const out = { x: p.x, y: a.y + uy * Math.max(dy, 9) };
      if (blockedAt(nav.grid, out.x, out.y) || !clearSegment(nav.grid, p, out)) continue;
      const facing: Facing = side > 0 ? 'w' : 'e';
      return { x: p.x, y: p.y, facing, posture: 'stand', front: p };
    }
  }
  return null;
}

/** The row a plan y belongs to. */
export const rowOf = (y: number): number => (y < ROW_Y[1] ? 0 : y < ROW_Y[2] ? 1 : 2);
