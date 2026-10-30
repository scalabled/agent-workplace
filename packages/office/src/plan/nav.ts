// Keyboard navigation between occupied seats. Left and right follow the same bench side,
// then the nearest seat on that line; up and down cross to the facing seat, then the nearest seat (by x) in the next
// bench or row. prevZone / nextZone follow the fill order (the Chief sits before the first neighbourhood).
import type { NavEntry, OfficeSeat, PlanZone } from './types';

interface NavInput {
  seats: OfficeSeat[];
  zones: PlanZone[];
  chiefSeatId: string | null;
}

export function buildNav(plan: NavInput): Record<string, NavEntry> {
  const occupied = plan.seats.filter((s) => s.personId);
  const nav: Record<string, NavEntry> = {};
  const bySide = new Map<string, OfficeSeat[]>();
  for (const s of occupied) {
    if (s.kind !== 'desk') continue;
    const key = s.id.split(':').slice(0, -1).join(':');
    const list = bySide.get(key) ?? [];
    list.push(s);
    bySide.set(key, list);
  }
  for (const list of bySide.values()) list.sort((a, b) => a.x - b.x);

  const best = (from: OfficeSeat, ok: (s: OfficeSeat) => boolean, cost: (s: OfficeSeat) => number): string | undefined => {
    let id: string | undefined;
    let min = Infinity;
    for (const s of occupied) {
      if (s === from || !ok(s)) continue;
      const c = cost(s);
      if (c < min - 1e-9 || (Math.abs(c - min) < 1e-9 && id !== undefined && s.id < id)) {
        min = c;
        id = s.id;
      }
    }
    return id;
  };

  const zoneFirst = new Map<string, string>();
  for (const z of plan.zones) {
    const first = z.seatIds.map((id) => occupied.find((s) => s.id === id)).filter((s): s is OfficeSeat => !!s)[0];
    if (first) zoneFirst.set(z.id, first.id);
  }
  const zoneOrder = [...plan.zones].sort((a, b) => a.order - b.order).map((z) => z.id);
  const ring: string[] = [...(plan.chiefSeatId ? [plan.chiefSeatId] : []), ...zoneOrder.map((z) => zoneFirst.get(z)).filter((x): x is string => !!x)];

  for (const s of occupied) {
    const entry: NavEntry = {};
    const key = s.id.split(':').slice(0, -1).join(':');
    const line = s.kind === 'desk' ? bySide.get(key) ?? [] : [];
    const i = line.indexOf(s);
    entry.left = (i > 0 ? line[i - 1]?.id : undefined) ?? best(s, (o) => o.x < s.x - 0.5, (o) => s.x - o.x + 3 * Math.abs(o.y - s.y));
    entry.right = (i >= 0 && i < line.length - 1 ? line[i + 1]?.id : undefined) ?? best(s, (o) => o.x > s.x + 0.5, (o) => o.x - s.x + 3 * Math.abs(o.y - s.y));
    entry.up = best(s, (o) => o.y < s.y - 1, (o) => s.y - o.y + 0.6 * Math.abs(o.x - s.x));
    entry.down = best(s, (o) => o.y > s.y + 1, (o) => o.y - s.y + 0.6 * Math.abs(o.x - s.x));
    const zoneIndex = s.kind === 'chief' ? 0 : ring.indexOf(zoneFirst.get(s.zoneId) ?? '');
    if (ring.length > 1 && zoneIndex >= 0) {
      entry.prevZone = ring[(zoneIndex - 1 + ring.length) % ring.length];
      entry.nextZone = ring[(zoneIndex + 1) % ring.length];
    }
    for (const k of Object.keys(entry) as (keyof NavEntry)[]) if (entry[k] === undefined) delete entry[k];
    nav[s.id] = entry;
  }
  return nav;
}
