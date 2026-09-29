// Walks along the aisles (OFFICE-PLAN §3.5, §4.5): a small graph of corridor × aisle intersections, shortest paths
// by Dijkstra. People leave their desk through the nearest corridor or the gap between benches, follow the aisles and
// enter a room through its door.
import type { Point } from '../types';
import { CORRIDORS, COL_PITCH, ROW_Y } from './geometry';
import type { OfficeSeat, PlanRoom, WalkGraph } from './types';

interface WalkInput {
  bounds: { w: number; h: number };
  cols: number;
}

const CORRIDOR_Y = [CORRIDORS.north, CORRIDORS.boulevard, CORRIDORS.aisle, CORRIDORS.reception];

/** Vertical aisle centre lines (between columns) plus the two plate edges. */
function aisleXs(cols: number, width: number): number[] {
  const xs = [4];
  for (let c = 1; c < cols; c++) xs.push(c * COL_PITCH - 8);
  xs.push(width - 4);
  return xs;
}

export function buildWalkGraph(plan: WalkInput): WalkGraph {
  const xs = aisleXs(plan.cols, plan.bounds.w);
  const nodes: WalkGraph['nodes'] = [];
  const edges: WalkGraph['edges'] = [];
  const id = (xi: number, yi: number) => `a${xi}:${yi}`;
  CORRIDOR_Y.forEach((y, yi) => xs.forEach((x, xi) => nodes.push({ id: id(xi, yi), x, y })));
  CORRIDOR_Y.forEach((_, yi) => {
    for (let xi = 0; xi < xs.length - 1; xi++) edges.push([id(xi, yi), id(xi + 1, yi)]);
  });
  // Vertical aisles run the full depth; the plate edges only along the window clearance and reception.
  xs.forEach((_, xi) => {
    const edge = xi === 0 || xi === xs.length - 1;
    for (let yi = 0; yi < CORRIDOR_Y.length - 1; yi++) if (!edge) edges.push([id(xi, yi), id(xi, yi + 1)]);
  });
  return { nodes, edges };
}

/** The corridor or in-cell gap line a seat leaves by, and the cell's two side aisles. */
function exitOf(seat: Pick<OfficeSeat, 'x' | 'y' | 'id' | 'kind'>, cols: number, width: number): { y: number; sides: number[] } {
  const xs = aisleXs(cols, width);
  const row = seat.y < ROW_Y[1] ? 0 : seat.y < ROW_Y[2] ? 1 : 2;
  const top = ROW_Y[row];
  const within = seat.y - top;
  let y: number;
  if (within < 18) y = CORRIDOR_Y[row]!;
  else if (within > 62) y = CORRIDOR_Y[row + 1]!;
  else y = top + 40;
  const left = [...xs].reverse().find((x) => x < seat.x) ?? xs[0]!;
  const right = xs.find((x) => x > seat.x) ?? xs[xs.length - 1]!;
  if (seat.kind === 'chief') return { y: CORRIDOR_Y[1]!, sides: [left] };
  return { y, sides: [left, right] };
}

function dijkstra(graph: WalkGraph, extra: WalkGraph['edges'], extraNodes: WalkGraph['nodes'], from: string, to: string): string[] | null {
  const nodes = new Map([...graph.nodes, ...extraNodes].map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const [a, b] of [...graph.edges, ...extra]) {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([from]);
  while (open.size) {
    let cur = '';
    let best = Infinity;
    for (const n of open) {
      const d = dist.get(n)!;
      if (d < best || (d === best && n < cur)) {
        best = d;
        cur = n;
      }
    }
    open.delete(cur);
    if (cur === to) break;
    const a = nodes.get(cur)!;
    for (const nb of adj.get(cur) ?? []) {
      const b = nodes.get(nb)!;
      const d = best + Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (d < (dist.get(nb) ?? Infinity)) {
        dist.set(nb, d);
        prev.set(nb, cur);
        open.add(nb);
      }
    }
  }
  if (!dist.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
  return path.map((id) => id);
}

/** Connect a point on a corridor or gap line to the graph. */
function attach(graph: WalkGraph, pid: string, p: Point, sides: number[]): { nodes: WalkGraph['nodes']; edges: WalkGraph['edges'] } {
  const nodes: WalkGraph['nodes'] = [{ id: pid, ...p }];
  const edges: WalkGraph['edges'] = [];
  const onCorridor = CORRIDOR_Y.some((y) => Math.abs(y - p.y) < 0.01);
  for (const x of sides) {
    if (onCorridor) {
      const n = graph.nodes.find((g) => Math.abs(g.x - x) < 0.01 && Math.abs(g.y - p.y) < 0.01);
      if (n) edges.push([pid, n.id]);
    } else {
      // An in-cell gap: walk to the side aisle, then up or down it to the corridors.
      const sid = `${pid}:${x}`;
      nodes.push({ id: sid, x, y: p.y });
      edges.push([pid, sid]);
      const above = [...CORRIDOR_Y].reverse().find((y) => y < p.y);
      const below = CORRIDOR_Y.find((y) => y > p.y);
      for (const y of [above, below]) {
        const n = y === undefined ? undefined : graph.nodes.find((g) => Math.abs(g.x - x) < 0.01 && Math.abs(g.y - y) < 0.01);
        if (n) edges.push([sid, n.id]);
      }
    }
  }
  return { nodes, edges };
}

/**
 * The walk from a desk seat to a room seat (or back when `reverse`), as plan points: the chair, its exit, the aisle
 * route, the door and the room chair.
 */
export function walkPath(
  graph: WalkGraph,
  plan: WalkInput,
  seat: Pick<OfficeSeat, 'x' | 'y' | 'id' | 'kind'>,
  room: Pick<PlanRoom, 'door' | 'rect' | 'table'>,
  roomSeat: Point,
): Point[] {
  const exit = exitOf(seat, plan.cols, plan.bounds.w);
  const start = { x: seat.x, y: exit.y };
  const doorOutside = { x: room.door.x, y: room.door.y + (room.door.y <= room.rect.y + 0.01 ? -7 : 12) };
  const doorCorridor = CORRIDOR_Y.reduce((a, b) => (Math.abs(b - doorOutside.y) < Math.abs(a - doorOutside.y) ? b : a));
  const doorPoint = { x: room.door.x, y: doorCorridor };
  const xs = aisleXs(plan.cols, plan.bounds.w);
  const doorSides = [[...xs].reverse().find((x) => x <= room.door.x) ?? xs[0]!, xs.find((x) => x >= room.door.x) ?? xs[xs.length - 1]!];
  const a = attach(graph, 'S', start, exit.sides);
  const b = attach(graph, 'T', doorPoint, doorSides);
  const ids = dijkstra(graph, [...a.edges, ...b.edges], [...a.nodes, ...b.nodes], 'S', 'T');
  const all = new Map([...graph.nodes, ...a.nodes, ...b.nodes].map((n) => [n.id, n]));
  const route = ids ? ids.map((id) => ({ x: all.get(id)!.x, y: all.get(id)!.y })) : [start, doorPoint];
  // Inside the room: around the table's nearer end when the chair is on the far side from the door.
  const t = room.table;
  const inside: Point[] = [];
  const doorNorth = room.door.y <= t.y;
  const farSide = doorNorth ? roomSeat.y > t.y + t.h : roomSeat.y < t.y;
  const aisleY = doorNorth ? t.y - 5 : t.y + t.h + 5;
  inside.push({ x: room.door.x, y: aisleY });
  if (farSide) {
    const endX = Math.abs(roomSeat.x - (t.x - 6)) < Math.abs(roomSeat.x - (t.x + t.w + 6)) ? t.x - 6 : t.x + t.w + 6;
    inside.push({ x: endX, y: aisleY }, { x: endX, y: roomSeat.y });
  } else if (roomSeat.y > t.y && roomSeat.y < t.y + t.h) {
    inside.push({ x: roomSeat.x, y: aisleY });
  }
  const pts: Point[] = [{ x: seat.x, y: seat.y }, ...route, { x: room.door.x, y: room.door.y }, ...inside, { x: roomSeat.x, y: roomSeat.y }];
  return simplify(pts);
}

/** Drop repeated and collinear points. */
export function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const prev = out[out.length - 2];
    if (prev && last) {
      const cross = (last.x - prev.x) * (p.y - last.y) - (last.y - prev.y) * (p.x - last.x);
      if (Math.abs(cross) < 0.01 && (last.x - prev.x) * (p.x - last.x) + (last.y - prev.y) * (p.y - last.y) >= 0) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

export function pathLength(pts: Point[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return d;
}

/** The point at distance `d` along a path. */
export function pointAt(pts: Point[], d: number): Point {
  let rest = d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= len) {
      const t = len === 0 ? 1 : rest / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    rest -= len;
  }
  return pts[pts.length - 1] ?? { x: 0, y: 0 };
}

