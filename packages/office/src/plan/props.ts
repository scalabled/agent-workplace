// Furniture and things: where every desk, chair, plant, shelf, counter and wall goes.
// Variants are seeded per cell and seat, so the office looks lived-in but is identical on every load.
import { rngFor } from '../rng';
import type { District, Facing } from '../types';
import { BENCH_Y, CELL_H, CELL_W, COL_PITCH, DESK_PITCH, GLASS_Z, HEAD_W, PLATE_H, ROW_Y } from './geometry';
import type { OfficeSeat, PlanCell, PlanProp, PlanRoom, PlanZone } from './types';

interface PropsInput {
  bounds: { w: number; h: number };
  cols: number;
  cells: PlanCell[];
  zones: PlanZone[];
  seats: OfficeSeat[];
  rooms: PlanRoom[];
  shift: number;
}

type P = Omit<PlanProp, 'sortY' | 'layer'> & { layer?: PlanProp['layer']; sortY?: number };

export function buildProps(plan: PropsInput): PlanProp[] {
  const out: PlanProp[] = [];
  const add = (p: P) => {
    const sized = p.w !== undefined && p.d !== undefined;
    out.push({ layer: 'furniture', sortY: p.sortY ?? (sized ? p.y + p.d! : p.y), ...p } as PlanProp);
  };
  const floor = (p: P) => add({ ...p, layer: 'floor' });

  const seatsByZone = new Map<string, OfficeSeat[]>();
  for (const s of plan.seats) (seatsByZone.get(s.zoneId) ?? seatsByZone.set(s.zoneId, []).get(s.zoneId)!).push(s);

  // ── neighbourhoods ──
  for (const zone of plan.zones) {
    const zseats = seatsByZone.get(zone.id) ?? [];
    zone.cellIds.forEach((cellId, ci) => {
      const cell = plan.cells.find((c) => c.id === cellId)!;
      const rand = rngFor(`cell:${cellId}:${zone.groupId}`);
      const cellSeats = zseats.filter((s) => s.id.split(':')[3] === String(ci * 2) || s.id.split(':')[3] === String(ci * 2 + 1));
      const k = Math.max(1, ...cellSeats.map((s) => Number(s.id.split(':').pop()) + 1));
      floor({ symbol: 'carpet', x: cell.x + 1, y: cell.y + 1, w: CELL_W - 2, d: CELL_H - 2, district: zone.district as District, variant: ci });
      // Head: whiteboard or low shelf (alternating by fill order), the door plate stand and a tall plant.
      const headX = cell.x + HEAD_W / 2;
      if ((zone.order + ci) % 2 === 0) add({ symbol: 'whiteboard', x: headX, y: cell.y + 12, variant: Math.floor(rand() * 1e6) });
      else add({ symbol: 'shelf-low', x: cell.x + 3, y: cell.y + 8, w: 12, d: 4, h: 8, variant: Math.floor(rand() * 1e6) });
      if (ci === 0) add({ symbol: 'door-plate', x: headX, y: cell.y + 40.5 });
      add({ symbol: rand() < 0.5 ? 'plant-monstera' : 'plant-fiddle', x: headX, y: cell.y + 66, variant: Math.floor(rand() * 1e6) });
      // Benches.
      const xs = cell.x + HEAD_W;
      for (const b of [0, 1] as const) {
        const top = cell.y + BENCH_Y[b];
        add({ symbol: 'bench-screen', x: xs, y: top + 17, w: k * DESK_PITCH, d: 1, h: 11.5, sortY: top + 17.6 });
      }
      for (const s of cellSeats) {
        const sr = rngFor(s.id);
        const clutter = Math.floor(sr() * 5);
        add({ symbol: 'desk', x: s.desk.x, y: s.desk.y, w: s.desk.w, d: s.desk.h, facing: s.facing, variant: clutter, seatId: s.id });
        add({ symbol: 'desk-lamp', x: s.lamp.x, y: s.lamp.y, seatId: s.id, facing: s.facing, sortY: s.facing === 's' ? s.desk.y + s.desk.h - 0.1 : s.desk.y + 0.2 });
        const occupied = !!s.personId;
        const pull = occupied ? 0.8 : -1.6;
        const cy = s.facing === 's' ? s.y - pull : s.y + pull;
        add({ symbol: 'chair', x: s.x, y: cy, facing: s.facing, turn: occupied ? Math.round((sr() * 8 - 4) * 10) / 10 : 0, variant: occupied ? 0 : 1, seatId: s.id, sortY: cy + 2 });
      }
      // Commons (the east remainder).
      const cx0 = xs + k * DESK_PITCH;
      const rest = cell.x + CELL_W - cx0;
      if (rest >= 30) {
        const mx = cx0 + rest / 2;
        floor({ symbol: 'rug', x: cx0 + 3, y: cell.y + 44, w: rest - 6, d: 30, variant: Math.floor(rand() * 3) });
        add({ symbol: 'armchair', x: mx - 7, y: cell.y + 66, facing: 'n', variant: 0 });
        add({ symbol: 'armchair', x: mx + 7, y: cell.y + 66, facing: 'n', variant: 1 });
        add({ symbol: 'side-table', x: mx, y: cell.y + 57 });
        add({ symbol: 'floor-lamp', x: cx0 + rest - 6, y: cell.y + 50 });
        add({ symbol: 'plant-snake', x: cx0 + 6, y: cell.y + 12, variant: Math.floor(rand() * 1e6) });
        add({ symbol: 'shelf-low', x: mx - 6, y: cell.y + 20, w: 14, d: 4, h: 8, variant: Math.floor(rand() * 1e6) });
      } else if (rest >= 12) {
        const mx = cx0 + rest / 2;
        add({ symbol: 'shelf-low', x: mx - 5, y: cell.y + 36, w: 10, d: 4, h: 8, variant: Math.floor(rand() * 1e6) });
        add({ symbol: 'plant-snake', x: mx, y: cell.y + 14, variant: Math.floor(rand() * 1e6) });
        add({ symbol: 'plant-snake', x: mx, y: cell.y + 70, variant: Math.floor(rand() * 1e6) });
      } else if (rest >= 5) {
        add({ symbol: 'plant-snake', x: cx0 + rest / 2, y: cell.y + 40, variant: Math.floor(rand() * 1e6) });
      }
    });
  }

  // Empty pod cells (more cells than groups): a quiet commons.
  const usedCells = new Set(plan.zones.flatMap((z) => z.cellIds));
  for (const cell of plan.cells) {
    if (cell.role !== 'pod' || usedCells.has(cell.id)) continue;
    floor({ symbol: 'rug', x: cell.x + 20, y: cell.y + 18, w: 56, d: 44, variant: 1 });
    add({ symbol: 'sofa', x: cell.x + 30, y: cell.y + 20, w: 36, d: 9, h: 7.5, facing: 's' });
    add({ symbol: 'coffee-table', x: cell.x + 38, y: cell.y + 38, w: 20, d: 8 });
    add({ symbol: 'plant-monstera', x: cell.x + 12, y: cell.y + 66, variant: 7 });
  }

  // ── rooms ──
  for (const room of plan.rooms) roomProps(room, add, floor);

  // ── amenities ──
  for (const cell of plan.cells) {
    if (cell.amenity === 'cafe') cafeProps(cell, add, floor);
    if (cell.amenity === 'lounge') loungeProps(cell, add, floor);
    if (cell.amenity === 'library') libraryProps(cell, add, floor);
    if (cell.role === 'chief') chiefProps(cell, add, floor);
  }

  // ── reception (south strip) ──
  const midX = plan.bounds.w / 2;
  const ry = ROW_Y[2] + CELL_H;
  floor({ symbol: 'mat', x: midX - 16, y: PLATE_H - 9, w: 32, d: 8 });
  add({ symbol: 'reception-desk', x: midX - 26, y: ry + 8, w: 52, d: 9, h: 11 });
  add({ symbol: 'plant-fiddle', x: midX - 44, y: ry + 22, variant: 3 });
  add({ symbol: 'plant-fiddle', x: midX + 44, y: ry + 22, variant: 11 });
  add({ symbol: 'bench', x: midX - 150, y: ry + 20, w: 40, d: 6, h: 4.5 });
  add({ symbol: 'bench', x: midX + 110, y: ry + 20, w: 40, d: 6, h: 4.5 });
  add({ symbol: 'plant-snake', x: midX - 160, y: ry + 12, variant: 5 });
  add({ symbol: 'plant-snake', x: midX + 160, y: ry + 12, variant: 9 });

  // ── structure: columns at aisle intersections, planters along the windows ──
  for (let c = 1; c < plan.cols; c++) {
    const x = c * COL_PITCH - AISLE_HALF;
    add({ symbol: 'column', x, y: ROW_Y[0] + CELL_H + 12 });
    add({ symbol: 'column', x, y: ROW_Y[1] + CELL_H + 9 });
  }
  for (let c = 0; c < plan.cols; c++) {
    const cell = plan.cells.find((x) => x.row === 0 && x.col === c)!;
    if (cell.role !== 'pod') continue;
    const r = rngFor(`window:${c}`);
    add({ symbol: r() < 0.5 ? 'plant-snake' : 'plant-pothos', x: cell.x + 10 + r() * 76, y: 6, variant: Math.floor(r() * 1e6) });
  }
  return out.sort((a, b) => (a.layer === b.layer ? a.sortY - b.sortY : a.layer === 'floor' ? -1 : 1));
}

const AISLE_HALF = 8;

type Add = (p: P) => void;

function roomProps(room: PlanRoom, add: Add, floor: Add): void {
  const r = room.rect;
  const t = room.table;
  floor({ symbol: 'room-floor', x: r.x, y: r.y, w: r.w, d: r.h, roomId: room.id });
  floor({ symbol: 'rug', x: t.x - 12, y: t.y - 12, w: t.w + 24, d: t.h + 24, variant: room.view === 'garden' ? 4 : 3 });
  const chairs = (facing: Facing) => room.seats.filter((s) => s.facing === facing);
  for (const s of chairs('s')) add({ symbol: 'chair', x: s.x, y: s.y - 0.6, facing: 's', variant: 1, sortY: s.y + 2, seatId: s.id });
  for (const s of [...chairs('e'), ...chairs('w')]) add({ symbol: 'chair', x: s.x, y: s.y, facing: s.facing, variant: 1, sortY: s.y + 2, seatId: s.id });
  add({ symbol: 'conf-table', x: t.x, y: t.y, w: t.w, d: t.h, h: 7.4, roomId: room.id });
  for (const s of chairs('n')) add({ symbol: 'chair', x: s.x, y: s.y + 0.6, facing: 'n', variant: 1, sortY: s.y + 2, seatId: s.id });
  const pend = room.view === 'garden' ? 2 : 2;
  for (let i = 0; i < pend; i++) add({ symbol: 'pendant', x: t.x + (t.w * (i + 1)) / (pend + 1), y: t.y + t.h / 2, sortY: t.y + t.h + 20, roomId: room.id });
  if (room.view === 'skyline') {
    // Corner room: exterior glass N and W; glass partitions E and S with the door on S.
    add({ symbol: 'plant-fiddle', x: r.x + 9, y: r.y + 10, variant: 21 });
    add({ symbol: 'display', x: r.x + r.w - 5, y: t.y + t.h / 2, facing: 'w' });
    add({ symbol: 'whiteboard', x: r.x + 12, y: r.y + r.h - 12, variant: 314 });
    add({ symbol: 'plant-snake', x: r.x + r.w - 8, y: r.y + r.h - 8, variant: 17 });
    glassWalls(room, add, [
      { x: r.x + r.w - 0.6, y: r.y + 3, w: 1.2, d: r.h - 3 },
      { x: r.x, y: r.y + r.h - 0.6, w: room.door.x - 7 - r.x, d: 1.2 },
      { x: room.door.x + 7, y: r.y + r.h - 0.6, w: r.x + r.w - room.door.x - 7, d: 1.2 },
    ]);
  } else {
    // Garden room: a plant wall on the north (its face toward the viewer), glass E, S and W, door on N.
    add({ symbol: 'plant-wall', x: r.x + 1, y: r.y + 0.5, w: room.door.x - 8 - r.x, d: 3, h: 24 });
    add({ symbol: 'plant-monstera', x: r.x + 10, y: r.y + r.h - 10, variant: 41 });
    add({ symbol: 'plant-fiddle', x: r.x + r.w - 9, y: r.y + r.h - 12, variant: 43 });
    add({ symbol: 'credenza', x: r.x + r.w - 7, y: r.y + 14, w: 5, d: 26, h: 7 });
    glassWalls(room, add, [
      { x: room.door.x + 8, y: r.y - 0.6, w: r.x + r.w - room.door.x - 8, d: 1.2 },
      { x: r.x - 0.6, y: r.y, w: 1.2, d: r.h },
      { x: r.x + r.w - 0.6, y: r.y, w: 1.2, d: r.h },
      { x: r.x, y: r.y + r.h - 0.6, w: r.w, d: 1.2 },
    ]);
  }
}

function glassWalls(room: PlanRoom, add: Add, parts: { x: number; y: number; w: number; d: number }[]): void {
  for (const g of parts) add({ symbol: 'glass', x: g.x, y: g.y, w: g.w, d: g.d, h: GLASS_Z, roomId: room.id, sortY: g.y + g.d });
}

function cafeProps(cell: PlanCell, add: Add, floor: Add): void {
  const x = cell.x;
  const y = cell.y;
  floor({ symbol: 'cafe-floor', x: x + 1, y: y + 1, w: CELL_W - 2, d: CELL_H - 2 });
  add({ symbol: 'coffee-counter', x: x + 4, y: y + 2, w: 64, d: 8, h: 9.4 });
  add({ symbol: 'fridge', x: x + 69, y: y + 2, w: 10, d: 8, h: 19 });
  add({ symbol: 'tall-cabinet', x: x + 80, y: y + 2, w: 12, d: 8, h: 19 });
  add({ symbol: 'island', x: x + 24, y: y + 30, w: 40, d: 12, h: 10 });
  for (let i = 0; i < 4; i++) add({ symbol: 'stool', x: x + 30 + i * 9.4, y: y + 47 });
  for (let i = 0; i < 3; i++) add({ symbol: 'pendant', x: x + 32 + i * 12, y: y + 36, sortY: y + 60 });
  add({ symbol: 'water-cooler', x: x + 88, y: y + 30 });
  add({ symbol: 'high-table', x: x + 78, y: y + 64 });
  add({ symbol: 'stool', x: x + 71, y: y + 68 });
  add({ symbol: 'stool', x: x + 85, y: y + 68 });
  add({ symbol: 'plant-monstera', x: x + 9, y: y + 66, variant: 5 });
  add({ symbol: 'plant-snake', x: x + 9, y: y + 22, variant: 13 });
}

function loungeProps(cell: PlanCell, add: Add, floor: Add): void {
  const x = cell.x;
  const y = cell.y;
  add({ symbol: 'feature-wall', x: x + 8, y: y + 0.5, w: 80, d: 2, h: 22 });
  floor({ symbol: 'rug', x: x + 14, y: y + 20, w: 68, d: 50, variant: 2 });
  add({ symbol: 'sofa', x: x + 26, y: y + 22, w: 44, d: 10, h: 7.5, facing: 's' });
  add({ symbol: 'coffee-table', x: x + 36, y: y + 42, w: 24, d: 9 });
  add({ symbol: 'armchair', x: x + 32, y: y + 64, facing: 'n', variant: 2 });
  add({ symbol: 'armchair', x: x + 64, y: y + 64, facing: 'n', variant: 3 });
  add({ symbol: 'floor-lamp', x: x + 78, y: y + 26 });
  add({ symbol: 'side-table', x: x + 20, y: y + 28 });
  add({ symbol: 'plant-monstera', x: x + 88, y: y + 70, variant: 23 });
  add({ symbol: 'plant-fiddle', x: x + 7, y: y + 12, variant: 29 });
  add({ symbol: 'pendant', x: x + 48, y: y + 46, sortY: y + 70 });
}

function libraryProps(cell: PlanCell, add: Add, floor: Add): void {
  const x = cell.x;
  const y = cell.y;
  floor({ symbol: 'rug', x: x + 60, y: y + 26, w: 28, d: 24, variant: 1 });
  add({ symbol: 'shelf-tall', x: x + 12, y: y + 10, w: 44, d: 4, h: 18, variant: 101, facing: 'n' });
  add({ symbol: 'shelf-tall', x: x + 12, y: y + 14, w: 44, d: 4, h: 18, variant: 103, facing: 's' });
  add({ symbol: 'armchair', x: x + 72, y: y + 36, facing: 's', variant: 4 });
  add({ symbol: 'floor-lamp', x: x + 82, y: y + 30 });
  add({ symbol: 'side-table', x: x + 63, y: y + 38 });
  add({ symbol: 'printer', x: x + 76, y: y + 4, w: 12, d: 7, h: 9 });
  add({ symbol: 'bin', x: x + 70, y: y + 8 });
  add({ symbol: 'water-cooler', x: x + 6, y: y + 36 });
  for (let i = 0; i < 4; i++) add({ symbol: 'phone-booth', x: x + 4 + i * 23, y: y + 58, w: 19, d: 14, h: 21, variant: i });
  add({ symbol: 'plant-pothos', x: x + 60, y: y + 14, variant: 3 });
}

function chiefProps(cell: PlanCell, add: Add, floor: Add): void {
  const x = cell.x;
  floor({ symbol: 'room-floor', x, y: 0, w: CELL_W, d: cell.y + CELL_H, roomId: 'chief' });
  floor({ symbol: 'rug', x: x + 8, y: 58, w: 50, d: 32, variant: 0 });
  add({ symbol: 'credenza', x: x + 22, y: 6, w: 46, d: 5, h: 7 });
  add({ symbol: 'plant-fiddle', x: x + 84, y: 10, variant: 31 });
  add({ symbol: 'chair', x: x + 44, y: 29.2, facing: 's', variant: 2, seatId: 'seat:chief', sortY: 31 });
  add({ symbol: 'exec-desk', x: x + 26, y: 35, w: 36, d: 10, h: 7.4 });
  add({ symbol: 'desk-lamp', x: x + 57, y: 37, seatId: 'seat:chief', facing: 's', sortY: 44.9 });
  add({ symbol: 'chair', x: x + 36, y: 52, facing: 'n', variant: 1, sortY: 54 });
  add({ symbol: 'chair', x: x + 52, y: 52, facing: 'n', variant: 1, sortY: 54 });
  add({ symbol: 'sofa', x: x + 12, y: 80, w: 36, d: 9, h: 7.5, facing: 'n' });
  add({ symbol: 'coffee-table', x: x + 20, y: 66, w: 20, d: 8 });
  add({ symbol: 'floor-lamp', x: x + 6, y: 70 });
  add({ symbol: 'shelf-tall', x: x + 72, y: 50, w: 20, d: 4, h: 16, variant: 7, facing: 's' });
  add({ symbol: 'plant-monstera', x: x + 86, y: 84, variant: 37 });
  // Glass partitions W and S (door on S, west side).
  add({ symbol: 'glass', x: x - 0.6, y: 3, w: 1.2, d: cell.y + CELL_H - 3, h: GLASS_Z, roomId: 'chief' });
  add({ symbol: 'glass', x: x + 20, y: cell.y + CELL_H - 0.6, w: CELL_W - 20, d: 1.2, h: GLASS_Z, roomId: 'chief' });
}

