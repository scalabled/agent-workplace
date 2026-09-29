// planOffice: a pure, deterministic floor plan from the catalog (OFFICE-PLAN §3). The same people, groups, lead and
// rooms always give byte-identical JSON (`hash`). Seeds come from FNV-1a of ids, never Math.random or time.
import { hashHex, rngFor } from '../rng';
import type { District, Facing, OfficeGroup, OfficePerson, OfficeRoomSpec, Rect } from '../types';
import { DISTRICT_ORDER, districtFor } from './districts';
import {
  BASE_COLS,
  BENCH_Y,
  CELL_H,
  CELL_W,
  DESK_D,
  DESK_PITCH,
  DESK_W,
  HEAD_W,
  PLATE_H,
  ROWS,
  ROW_Y,
  colX,
  plateWidth,
} from './geometry';
import { buildNav } from './nav';
import { buildProps } from './props';
import type { OfficePlan, OfficeSeat, PlanAmenity, PlanCell, PlanRoom, PlanZone, RoomSeat } from './types';
import { buildWalkGraph } from './walk';

export const DEFAULT_ROOMS: readonly OfficeRoomSpec[] = [
  { id: 'skyline', name: 'Skyline room', seats: 10, view: 'skyline' },
  { id: 'garden', name: 'Garden room', seats: 8, view: 'garden' },
];

const SENIORITY_RANK: Record<string, number> = { principal: 0, lead: 1, senior: 2, specialist: 3 };
const MAX_PER_CELL = 16;

/** Order groups: projects first (input order), then the known departments in DISTRICT_ORDER, then the rest. */
function orderGroups<T extends { id: string; kind?: string }>(groups: readonly T[]): T[] {
  const rank = (id: string) => {
    const i = DISTRICT_ORDER.indexOf(id);
    return i === -1 ? DISTRICT_ORDER.length : i;
  };
  const rest = groups
    .filter((g) => g.kind !== 'project')
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g.id) - rank(b.g.id) || a.i - b.i)
    .map((x) => x.g);
  return [...groups.filter((g) => g.kind === 'project'), ...rest];
}

/** Base template roles (row, col) in the 8-column template. */
const BASE_ROLES: Record<string, Pick<PlanCell, 'role' | 'amenity'> & { room?: 'skyline' | 'garden' }> = {
  'r0c0': { role: 'room', room: 'skyline' },
  'r0c7': { role: 'chief' },
  'r1c3': { role: 'amenity', amenity: 'cafe' },
  'r1c4': { role: 'amenity', amenity: 'lounge' },
  'r2c3': { role: 'room', room: 'garden' },
  'r2c4': { role: 'amenity', amenity: 'library' },
};

/** Serpentine fill order starting beside the Chief's office: row 0 east→west, row 1 west→east, row 2 east→west. */
const BASE_FILL: [number, number][] = [
  [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1],
  [1, 0], [1, 1], [1, 2], [1, 5], [1, 6], [1, 7],
  [2, 7], [2, 6], [2, 5], [2, 2], [2, 1], [2, 0],
];

export interface PlanInput {
  people: OfficePerson[];
  groups: OfficeGroup[];
  leadId: string;
  rooms?: readonly OfficeRoomSpec[];
}

interface Member {
  person: OfficePerson;
  index: number;
}

export function planOffice(input: PlanInput): OfficePlan {
  const rooms = (input.rooms ?? DEFAULT_ROOMS).slice(0, 2);
  const seen = new Set<string>();
  const people = input.people.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const lead = people.find((p) => p.id === input.leadId) ?? null;

  // Groups: the given ones in district order, then any group id only people mention (input order, district run).
  const groupIds = new Set(input.groups.map((g) => g.id));
  const extraGroups: OfficeGroup[] = [];
  for (const p of people) {
    if (p.id === input.leadId || groupIds.has(p.groupId)) continue;
    groupIds.add(p.groupId);
    extraGroups.push({ id: p.groupId, name: p.groupId });
  }
  const groups = [...orderGroups(input.groups), ...extraGroups];
  const members = new Map<string, Member[]>();
  people.forEach((person, index) => {
    if (person.id === input.leadId) return;
    const list = members.get(person.groupId) ?? [];
    list.push({ person, index });
    members.set(person.groupId, list);
  });
  const staffed = groups.filter((g) => (members.get(g.id)?.length ?? 0) > 0);

  // Cells needed; grow the template by two columns (six cells) on the west per step.
  const needed = staffed.reduce((n, g) => n + Math.ceil(members.get(g.id)!.length / MAX_PER_CELL), 0);
  const steps = Math.max(0, Math.ceil((needed - BASE_FILL.length) / 6));
  const cols = BASE_COLS + steps * 2;
  const shift = steps * 2;

  const cells: PlanCell[] = [];
  const cellAt = new Map<string, PlanCell>();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < cols; col++) {
      const base = BASE_ROLES[`r${row}c${col - shift}`];
      const cell: PlanCell = {
        id: `r${row}c${col}`,
        row,
        col,
        x: colX(col),
        y: ROW_Y[row],
        w: CELL_W,
        h: CELL_H,
        role: base?.role ?? 'pod',
        ...(base?.amenity ? { amenity: base.amenity } : {}),
      };
      cells.push(cell);
      cellAt.set(`${row},${col}`, cell);
    }
  }
  const fill: PlanCell[] = BASE_FILL.map(([r, c]) => cellAt.get(`${r},${c + shift}`)!);
  for (let s = 0; s < steps; s++) {
    for (let row = 0; row < ROWS; row++) for (let c = 1; c >= 0; c--) fill.push(cellAt.get(`${row},${(steps - 1 - s) * 2 + c}`)!);
  }

  // Assign groups to cells.
  const free = new Set(fill.map((c) => c.id));
  const zones: PlanZone[] = [];
  const seats: OfficeSeat[] = [];
  const takeNext = (prev: PlanCell | null): PlanCell | null => {
    if (prev) {
      for (const dc of [-1, 1]) {
        const adj = cellAt.get(`${prev.row},${prev.col + dc}`);
        if (adj && free.has(adj.id)) return adj;
      }
    }
    return fill.find((c) => free.has(c.id)) ?? null;
  };

  staffed.forEach((group, order) => {
    const list = members.get(group.id)!.slice().sort((a, b) => (SENIORITY_RANK[a.person.seniority ?? 'specialist'] ?? 3) - (SENIORITY_RANK[b.person.seniority ?? 'specialist'] ?? 3) || a.index - b.index);
    const m = Math.ceil(list.length / MAX_PER_CELL);
    const zoneCells: PlanCell[] = [];
    let prev: PlanCell | null = null;
    for (let i = 0; i < m; i++) {
      const cell = takeNext(prev);
      if (!cell) break;
      free.delete(cell.id);
      zoneCells.push(cell);
      prev = cell;
    }
    const zoneId = `z:${group.id}`;
    const district: District = districtFor(group.id, group.district);
    const zoneSeats: OfficeSeat[] = [];
    const per = Math.ceil(list.length / zoneCells.length);
    zoneCells.forEach((cell, ci) => {
      const chunk = list.slice(ci * per, ci * per + per);
      zoneSeats.push(...benchSeats(cell, ci, zoneId, chunk.map((x) => x.person.id)));
    });
    seats.push(...zoneSeats);
    const xs = zoneCells.map((c) => c.x);
    const ys = zoneCells.map((c) => c.y);
    const rect: Rect = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...zoneCells.map((c) => c.x + c.w)) - Math.min(...xs),
      h: Math.max(...zoneCells.map((c) => c.y + c.h)) - Math.min(...ys),
    };
    const head = zoneCells[0]!;
    zones.push({
      id: zoneId,
      groupId: group.id,
      name: group.name,
      district,
      cellIds: zoneCells.map((c) => c.id),
      rect,
      plate: { x: head.x + HEAD_W / 2, y: head.y + 40 },
      seatIds: zoneSeats.map((s) => s.id),
      headcount: list.length,
      order,
    });
  });

  // The Chief of Staff's corner office (NE).
  const chiefCell = cells.find((c) => c.role === 'chief')!;
  const ox = chiefCell.x;
  const chiefSeat: OfficeSeat | null = lead
    ? {
        id: 'seat:chief',
        personId: lead.id,
        zoneId: 'z:chief',
        kind: 'chief',
        x: ox + 44,
        y: 30,
        facing: 's',
        desk: { x: ox + 26, y: 35, w: 36, h: 10 },
        badge: { x: ox + 44, y: 30, z: 7.5 },
        monitor: { x: ox + 44, y: 36.5 },
        lamp: { x: ox + 57, y: 37 },
      }
    : null;
  if (chiefSeat) seats.push(chiefSeat);

  // Conference rooms.
  const planRooms: PlanRoom[] = [];
  const roomCells = cells.filter((c) => c.role === 'room');
  const skylineCell = roomCells.find((c) => c.row === 0)!;
  const gardenCell = roomCells.find((c) => c.row === 2)!;
  const used = new Set<string>();
  for (const spec of rooms) {
    const cell = spec.view === 'garden' && !used.has(gardenCell.id) ? gardenCell : !used.has(skylineCell.id) ? skylineCell : gardenCell;
    if (used.has(cell.id)) continue;
    used.add(cell.id);
    cell.roomId = spec.id;
    planRooms.push(roomLayout(spec, cell));
  }
  // A room cell no spec claimed stays a quiet pod-less room shell: mark it as an amenity-free room without id.

  const amenities: PlanAmenity[] = [];
  for (const c of cells) {
    if (c.role === 'amenity' && c.amenity) amenities.push({ id: c.amenity, rect: { x: c.x, y: c.y, w: c.w, h: c.h } });
  }
  amenities.push({ id: 'chief', rect: { x: chiefCell.x, y: 0, w: chiefCell.w, h: chiefCell.y + chiefCell.h } });
  const width = plateWidth(cols);
  amenities.push({ id: 'reception', rect: { x: width / 2 - 90, y: ROW_Y[2] + CELL_H, w: 180, h: PLATE_H - ROW_Y[2] - CELL_H } });

  const seatOf: Record<string, string> = {};
  for (const s of seats) if (s.personId) seatOf[s.personId] = s.id;

  const partial = {
    version: 1 as const,
    bounds: { w: width, h: PLATE_H },
    cols,
    cells,
    zones,
    seats,
    rooms: planRooms,
    amenities,
    chiefSeatId: chiefSeat?.id ?? null,
    seatOf,
  };
  const props = buildProps({ ...partial, shift });
  const walk = buildWalkGraph(partial);
  const nav = buildNav(partial);
  const plan: Omit<OfficePlan, 'hash'> = { ...partial, props, walk, nav };
  return { ...plan, hash: hashHex(JSON.stringify(plan)) };
}

/** Seats for one neighbourhood cell: two benches, desks on both sides, dealt round-robin west to east. */
function benchSeats(cell: PlanCell, cellIndex: number, zoneId: string, ids: string[]): OfficeSeat[] {
  const k = Math.max(1, Math.ceil(ids.length / 4));
  const xs = cell.x + HEAD_W;
  const out: OfficeSeat[] = [];
  const sides: [number, 'n' | 's'][] = [[0, 'n'], [0, 's'], [1, 'n'], [1, 's']];
  const grid: (string | null)[][] = sides.map(() => new Array<string | null>(k).fill(null));
  ids.forEach((id, i) => {
    grid[i % 4]![Math.floor(i / 4)] = id;
  });
  sides.forEach(([b, side], si) => {
    const top = cell.y + BENCH_Y[b];
    for (let col = 0; col < k; col++) {
      const personId = grid[si]![col] ?? null;
      const cx = xs + col * DESK_PITCH + DESK_PITCH / 2;
      const facing: Facing = side === 'n' ? 's' : 'n';
      const deskY = side === 'n' ? top + 9 : top + 18;
      const chairY = side === 'n' ? top + 4.5 : top + 30.5;
      const rand = rngFor(`${zoneId}:${cellIndex}:${b}:${side}:${col}`);
      const lampDx = rand() < 0.5 ? -5.2 : 5.2;
      out.push({
        id: `seat:${zoneId}:${cellIndex * 2 + b}:${side}:${col}`,
        personId,
        zoneId,
        kind: 'desk',
        x: cx,
        y: chairY,
        facing,
        desk: { x: cx - DESK_W / 2, y: deskY, w: DESK_W, h: DESK_D },
        badge: { x: cx, y: chairY, z: facing === 's' ? 7 : 5.5 },
        monitor: { x: cx, y: side === 'n' ? deskY + DESK_D - 1.4 : deskY + 1.4 },
        lamp: { x: cx + lampDx, y: side === 'n' ? deskY + DESK_D - 1.6 : deskY + 1.6 },
      });
    }
  });
  return out;
}

/** A glass conference room: the table along x, chairs on both long sides and at both ends. */
function roomLayout(spec: OfficeRoomSpec, cell: PlanCell): PlanRoom {
  const corner = cell.row === 0;
  const rect: Rect = corner ? { x: cell.x, y: 0, w: cell.w, h: cell.y + cell.h } : { x: cell.x, y: cell.y, w: cell.w, h: cell.h };
  const perSide = Math.max(1, Math.floor((Math.max(4, spec.seats) - 2) / 2));
  const pitch = 12;
  const tw = perSide * pitch + 4;
  const td = spec.seats >= 10 ? 14 : 13;
  const cx = rect.x + rect.w / 2 + (corner ? 2 : 0);
  const cy = corner ? rect.y + rect.h / 2 + 6 : rect.y + rect.h / 2 + 4;
  const table: Rect = { x: cx - tw / 2, y: cy - td / 2, w: tw, h: td };
  const seats: RoomSeat[] = [];
  // Far end first is the stage's order; here seats are listed north side (W→E), south side, then the two ends.
  for (let i = 0; i < perSide; i++) seats.push({ id: `${spec.id}:n${i}`, x: table.x + 2 + pitch / 2 + i * pitch, y: table.y - 4.5, facing: 's' });
  for (let i = 0; i < perSide; i++) seats.push({ id: `${spec.id}:s${i}`, x: table.x + 2 + pitch / 2 + i * pitch, y: table.y + td + 4.5, facing: 'n' });
  seats.push({ id: `${spec.id}:w`, x: table.x - 5, y: cy, facing: 'e' });
  seats.push({ id: `${spec.id}:e`, x: table.x + tw + 5, y: cy, facing: 'w' });
  const door = corner ? { x: rect.x + rect.w - 22, y: rect.y + rect.h } : { x: rect.x + rect.w - 16, y: rect.y };
  return { id: spec.id, name: spec.name, view: spec.view, cellId: cell.id, rect, door, table, seats, capacity: Math.max(0, Math.min(spec.seats, seats.length + 1) - 1) };
}
