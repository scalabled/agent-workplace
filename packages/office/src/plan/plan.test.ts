import { describe, expect, it } from 'vitest';
import slim from '../../../catalog/generated/slim.js';
import { project, unproject } from '../projection';
import type { OfficeGroup, OfficePerson } from '../types';
import { K_Y, K_Z } from '../projection';
import { DESK_Z } from './geometry';
import { hitTest, projectRect } from './hit';
import { DEFAULT_ROOMS, planOffice } from './plan';
import { pathLength, walkPath } from './walk';

const LEAD = slim.leads[0]!;
const people: OfficePerson[] = [
  { id: LEAD.id, name: LEAD.name, title: 'Chief of Staff', groupId: 'chief', accent: LEAD.avatar.accent_color },
  ...slim.personas.map((p) => ({ id: p.id, name: p.name, title: p.title, groupId: p.department, accent: p.avatar.accent_color, seniority: p.seniority })),
];
const groups: OfficeGroup[] = slim.departments.map((d) => ({ id: d.id, name: d.name, kind: 'department' as const }));
const input = { people, groups, leadId: LEAD.id };

describe('planOffice', () => {
  const plan = planOffice(input);

  it('is deterministic: the same input gives byte-identical output', () => {
    const again = planOffice({ people: people.map((p) => ({ ...p })), groups: groups.map((g) => ({ ...g })), leadId: LEAD.id });
    expect(again.hash).toBe(plan.hash);
    expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
  });

  it('seats every coworker and the Chief of Staff exactly once', () => {
    const seated = plan.seats.filter((s) => s.personId).map((s) => s.personId);
    expect(seated).toHaveLength(slim.personas.length + 1);
    expect(new Set(seated).size).toBe(seated.length);
    expect(plan.zones).toHaveLength(18);
    expect(plan.bounds).toEqual({ w: 880, h: 330 });
  });

  it('puts the Chief of Staff in the corner office (NE), facing the viewer', () => {
    const chief = plan.seats.find((s) => s.personId === LEAD.id)!;
    expect(chief.kind).toBe('chief');
    expect(chief.facing).toBe('s');
    const cell = plan.cells.find((c) => c.role === 'chief')!;
    expect(cell.row).toBe(0);
    expect(cell.col).toBe(7);
    expect(chief.x).toBeGreaterThan(cell.x);
    expect(chief.x).toBeLessThan(cell.x + cell.w);
  });

  it('fills neighbourhoods in the serpentine district order next to the Chief', () => {
    const at = (groupId: string) => plan.cells.find((c) => c.id === plan.zones.find((z) => z.groupId === groupId)!.cellIds[0])!;
    expect([at('strategy-leadership').row, at('strategy-leadership').col]).toEqual([0, 6]);
    expect([at('core-crew').row, at('core-crew').col]).toEqual([0, 5]);
    expect([at('research-insights').row, at('research-insights').col]).toEqual([1, 0]);
    expect([at('industry-specialists').row, at('industry-specialists').col]).toEqual([2, 0]);
    expect(plan.cells.find((c) => c.amenity === 'cafe')).toMatchObject({ row: 1, col: 3 });
  });

  it('never overlaps two desks', () => {
    const desks = plan.seats.filter((s) => s.kind === 'desk').map((s) => s.desk);
    for (let i = 0; i < desks.length; i++) {
      for (let j = i + 1; j < desks.length; j++) {
        const a = desks[i]!;
        const b = desks[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it('keeps every seat inside its neighbourhood and the plate', () => {
    for (const z of plan.zones) {
      for (const id of z.seatIds) {
        const s = plan.seats.find((x) => x.id === id)!;
        expect(s.x).toBeGreaterThan(z.rect.x);
        expect(s.x).toBeLessThan(z.rect.x + z.rect.w);
        expect(s.y).toBeGreaterThan(z.rect.y);
        expect(s.y).toBeLessThan(z.rect.y + z.rect.h);
      }
    }
  });

  it('appends unknown groups and spans groups larger than 16 across two adjacent cells', () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ id: `big-${i}`, name: `Big ${i}`, title: 'Analyst', groupId: 'task-force', accent: '#336699' }));
    const p = planOffice({ people: [...people, ...big], groups, leadId: LEAD.id });
    const zone = p.zones.find((z) => z.groupId === 'task-force')!;
    expect(zone).toBeDefined();
    expect(zone.district).toBe('run');
    expect(zone.cellIds).toHaveLength(2);
    const [a, b] = zone.cellIds.map((id) => p.cells.find((c) => c.id === id)!);
    expect(a!.row).toBe(b!.row);
    expect(Math.abs(a!.col - b!.col)).toBe(1);
    expect(p.seats.filter((s) => s.zoneId === zone.id && s.personId)).toHaveLength(20);
    // 18 + 2 cells > 18 pod cells: the template grew two columns on the west.
    expect(p.cols).toBe(10);
    expect(p.bounds.w).toBe(10 * 112 - 16);
  });

  it('moves no one outside a group when one person joins it', () => {
    const extra: OfficePerson = { id: 'new-hire', name: 'New Hire', title: 'Designer', groupId: 'design-creative', accent: '#aa5500', seniority: 'specialist' };
    const p = planOffice({ people: [...people, extra], groups, leadId: LEAD.id });
    const before = new Map(plan.seats.filter((s) => s.personId).map((s) => [s.personId, s]));
    for (const s of p.seats) {
      if (!s.personId || s.zoneId === 'z:design-creative') continue;
      const old = before.get(s.personId)!;
      expect([s.id, s.x, s.y]).toEqual([old.id, old.x, old.y]);
    }
  });

  it('builds both default rooms with enough chairs', () => {
    expect(plan.rooms.map((r) => r.id)).toEqual(DEFAULT_ROOMS.map((r) => r.id));
    const sky = plan.rooms.find((r) => r.id === 'skyline')!;
    expect(sky.seats).toHaveLength(10);
    expect(sky.capacity).toBe(9);
    expect(plan.rooms.find((r) => r.id === 'garden')!.capacity).toBe(7);
  });

  it('navigates every occupied seat, and arrows move along the bench', () => {
    const occupied = plan.seats.filter((s) => s.personId);
    for (const s of occupied) expect(plan.nav[s.id]).toBeDefined();
    // Reachability from the Chief over arrows + zone jumps.
    const seen = new Set<string>([plan.chiefSeatId!]);
    const queue = [plan.chiefSeatId!];
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of Object.values(plan.nav[id]!)) if (next && !seen.has(next)) (seen.add(next), queue.push(next));
    }
    expect(seen.size).toBe(occupied.length);
    const bench = occupied.filter((s) => s.id.startsWith('seat:z:engineering:0:n:')).sort((a, b) => a.x - b.x);
    expect(plan.nav[bench[0]!.id]!.right).toBe(bench[1]!.id);
    expect(plan.nav[bench[1]!.id]!.left).toBe(bench[0]!.id);
  });

  it('walks from a desk to a room chair along the aisles', () => {
    const seat = plan.seats.find((s) => s.personId && s.zoneId === 'z:finance-accounting')!;
    const room = plan.rooms.find((r) => r.id === 'skyline')!;
    const path = walkPath(plan.walk, plan, seat, room, room.seats[0]!);
    expect(path[0]).toEqual({ x: seat.x, y: seat.y });
    expect(path[path.length - 1]).toEqual({ x: room.seats[0]!.x, y: room.seats[0]!.y });
    expect(pathLength(path)).toBeGreaterThan(Math.hypot(seat.x - room.seats[0]!.x, seat.y - room.seats[0]!.y));
    // Axis-aligned legs outside the room.
    for (let i = 1; i < path.length - 3; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true);
    }
  });
});

describe('projection', () => {
  it('foreshortens the floor by sin 55° and lifts heights by cos 55°', () => {
    expect(project(10, 100, 0)).toEqual({ x: 10, y: 100 * K_Y });
    expect(project(0, 0, 10).y).toBeCloseTo(-10 * K_Z);
    const p = project(33, 77, 4);
    const back = unproject(p.x, p.y, 4);
    expect(back.x).toBeCloseTo(33);
    expect(back.y).toBeCloseTo(77);
  });
});

describe('hitTest', () => {
  const plan = planOffice(input);
  it('finds a desk from a point on its projected top', () => {
    const seat = plan.seats.find((s) => s.personId && s.zoneId === 'z:engineering')!;
    const top = projectRect(seat.desk, DESK_Z);
    const hit = hitTest(plan, { x: top.x + top.w / 2, y: top.y + top.h / 2 });
    expect(hit).toEqual({ kind: 'seat', seatId: seat.id, personId: seat.personId });
  });
  it('finds rooms, amenities and neighbourhoods on the floor, and nothing outside the plate', () => {
    const sky = plan.rooms.find((r) => r.id === 'skyline')!;
    expect(hitTest(plan, project(sky.rect.x + 4, sky.rect.y + 4))).toEqual({ kind: 'room', roomId: 'skyline' });
    const cafe = plan.amenities.find((a) => a.id === 'cafe')!;
    expect(hitTest(plan, project(cafe.rect.x + 88, cafe.rect.y + 76))).toEqual({ kind: 'amenity', id: 'cafe' });
    const zone = plan.zones.find((z) => z.groupId === 'legal-compliance')!;
    expect(hitTest(plan, project(zone.rect.x + 2, zone.rect.y + 78))).toEqual({ kind: 'zone', zoneId: zone.id });
    expect(hitTest(plan, project(-50, -50))).toBeNull();
  });
});
