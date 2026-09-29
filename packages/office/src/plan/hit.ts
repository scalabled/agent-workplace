// Hit-testing the plate (OFFICE-PLAN §4.2): which seat, room, amenity or neighbourhood lies under a projected point.
// Desks and chairs are tested on their projected tops (a click on a desk top lands on that desk), then the floor.
import { K_Y, K_Z } from '../projection';
import type { Point, Rect } from '../types';
import { DESK_Z } from './geometry';
import type { OfficePlan } from './types';

export type Hit =
  | { kind: 'seat'; seatId: string; personId: string | null }
  | { kind: 'room'; roomId: string }
  | { kind: 'amenity'; id: string }
  | { kind: 'zone'; zoneId: string }
  | null;

/** A plan rect at height z, projected. */
export function projectRect(r: Rect, z = 0): Rect {
  return { x: r.x, y: r.y * K_Y - z * K_Z, w: r.w, h: r.h * K_Y };
}

const inside = (p: Point, r: Rect, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;

/** The chair's projected hit box (seat top at z≈4.6, backrest up to z≈10.5). */
export function chairBox(x: number, y: number): Rect {
  return { x: x - 3.4, y: (y - 3.2) * K_Y - 10.5 * K_Z, w: 6.8, h: 6.4 * K_Y + 10.5 * K_Z };
}

export function hitTest(plan: OfficePlan, projected: Point): Hit {
  // Seats: the nearest (southernmost first, since they draw on top) desk top or chair.
  const seats = [...plan.seats].sort((a, b) => b.y - a.y);
  for (const s of seats) {
    if (inside(projected, chairBox(s.x, s.y), 0.4) || inside(projected, projectRect(s.desk, DESK_Z), 0.2)) {
      return { kind: 'seat', seatId: s.id, personId: s.personId };
    }
  }
  const floor: Point = { x: projected.x, y: projected.y / K_Y };
  for (const r of plan.rooms) if (inside(floor, r.rect)) return { kind: 'room', roomId: r.id };
  for (const a of plan.amenities) if (inside(floor, a.rect)) return { kind: 'amenity', id: a.id };
  for (const z of plan.zones) if (inside(floor, z.rect)) return { kind: 'zone', zoneId: z.id };
  return null;
}
