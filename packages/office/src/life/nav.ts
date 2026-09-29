// Life navigation (OFFICE-LIFE §2.6, §2.7): an obstacle grid built from the plan's furniture, a lane graph of the
// office's aisles (the boulevard, the lower aisle, the vertical aisles, a window lane and a south lane), and A* on the
// grid for the short legs in and out of a desk or a spot. Pure and cached per plan (not part of OfficePlan.hash).
import { CELL_H, COL_PITCH, ROW_Y } from '../plan/geometry';
import type { OfficePlan } from '../plan/types';
import type { Point } from '../types';

/** A walker's radius for clearance (u). */
export const BODY_R = 2;
/** Keep-right offset on the wide corridors (u); the vertical aisles are narrower. */
export const LANE_OFFSET = 5;
export const AISLE_OFFSET = 4.5;

/** The window lane (between the north planters and the north benches' chairs). */
export const WIN_Y = 12;
export const BLV_Y = ROW_Y[0] + CELL_H + 12; // 106
export const AIS_Y = ROW_Y[1] + CELL_H + 9; // 207
/** The south lane, just south of the bottom row (clear of the reception furniture). */
export const STH_Y = ROW_Y[2] + CELL_H + 4; // 300
export const H_LINES = [WIN_Y, BLV_Y, AIS_Y, STH_Y] as const;

export interface Grid {
  w: number;
  h: number;
  /** 1 = blocked (already inflated by BODY_R). */
  cells: Uint8Array;
}

export interface LaneLine {
  axis: 'h' | 'v';
  /** y for horizontal lines, x for vertical ones. */
  at: number;
  from: number;
  to: number;
  offset: number;
  /** Node indices along the line, sorted by coordinate. */
  nodes: number[];
}

export interface Portal {
  line: LaneLine;
  x: number;
  y: number;
}

/** A way in or out of a place: the leg from the place to a portal on a lane. */
export interface Attach {
  portal: Portal;
  /** From the place to the portal (the first point is the place). */
  path: Point[];
  len: number;
}

export interface LifeNav {
  grid: Grid;
  lines: LaneLine[];
  nodes: Point[];
  /** All-pairs shortest distances and next hops. */
  dist: Float64Array;
  next: Int32Array;
  vx: number[];
  plan: OfficePlan;
  seatAttach: Map<string, Attach[]>;
  slotAttach: Map<string, Attach[]>;
}

// ── obstacles ────────────────────────────────────────────────────────────────────
/** Radii (u) of point props; sized props block their footprint. */
const POINT_R: Record<string, number> = {
  'plant-monstera': 3.6,
  'plant-snake': 2.3,
  'plant-fiddle': 3.1,
  'plant-pothos': 2.8,
  'water-cooler': 1.8,
  stool: 1.7,
  'side-table': 1.8,
  'floor-lamp': 1.6,
  chair: 2.8,
  'high-table': 3.2,
  bin: 1.3,
  display: 2,
};
/** Point props with a rectangular footprint: half extents. */
const POINT_RECT: Record<string, [number, number]> = {
  armchair: [3.6, 3.5],
  whiteboard: [7.2, 1],
  'door-plate': [3.3, 0.8],
  column: [1.7, 1.7],
};
const SKIP = new Set(['pendant', 'desk-lamp']);

export function buildGrid(plan: OfficePlan, bodyR = BODY_R): Grid {
  const w = Math.ceil(plan.bounds.w);
  const h = Math.ceil(plan.bounds.h);
  const cells = new Uint8Array(w * h);
  const rect = (x0: number, y0: number, x1: number, y1: number, pad = bodyR) => {
    // A cell is blocked when its centre lies inside the inflated footprint.
    const a = Math.max(0, Math.ceil(x0 - pad - 0.5));
    const b = Math.min(w - 1, Math.floor(x1 + pad - 0.5));
    const c = Math.max(0, Math.ceil(y0 - pad - 0.5));
    const d = Math.min(h - 1, Math.floor(y1 + pad - 0.5));
    for (let y = c; y <= d; y++) cells.fill(1, y * w + a, y * w + b + 1);
  };
  const circle = (cx: number, cy: number, r: number) => {
    const R = r + bodyR;
    const a = Math.max(0, Math.floor(cx - R));
    const b = Math.min(w - 1, Math.ceil(cx + R));
    const c = Math.max(0, Math.floor(cy - R));
    const d = Math.min(h - 1, Math.ceil(cy + R));
    for (let y = c; y <= d; y++) {
      for (let x = a; x <= b; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= R * R) cells[y * w + x] = 1;
      }
    }
  };
  // The glass façade, the plate edges and the conference rooms (ambient life never enters a room).
  rect(0, 0, w, 1.2, 0);
  rect(0, 0, 1, h, 0);
  rect(w - 1, 0, w, h, 0);
  rect(0, h - 1, w, h, 0);
  for (const r of plan.rooms) rect(r.rect.x, r.rect.y, r.rect.x + r.rect.w, r.rect.y + r.rect.h, 1);
  for (const p of plan.props) {
    if (p.layer !== 'furniture' || SKIP.has(p.symbol)) continue;
    if (p.w !== undefined && p.d !== undefined) {
      rect(p.x, p.y, p.x + p.w, p.y + p.d);
      continue;
    }
    const rr = POINT_RECT[p.symbol];
    if (rr) {
      rect(p.x - rr[0], p.y - rr[1], p.x + rr[0], p.y + rr[1]);
      continue;
    }
    circle(p.x, p.y, POINT_R[p.symbol] ?? 2);
  }
  return { w, h, cells };
}

export interface Exempt {
  x: number;
  y: number;
  r: number;
}

export function blockedAt(g: Grid, x: number, y: number, exempt: readonly Exempt[] = []): boolean {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= g.w || iy >= g.h) return true;
  if (!g.cells[iy * g.w + ix]) return false;
  for (const e of exempt) if ((x - e.x) ** 2 + (y - e.y) ** 2 <= e.r * e.r) return false;
  return true;
}

/** Is the straight segment clear? Walks every grid cell the segment touches (a cell inside an exempt disc is free). */
export function clearSegment(g: Grid, a: Point, b: Point, exempt: readonly Exempt[] = []): boolean {
  const cellFree = (ix: number, iy: number) => {
    if (ix < 0 || iy < 0 || ix >= g.w || iy >= g.h) return false;
    if (!g.cells[iy * g.w + ix]) return true;
    const cx = ix + 0.5;
    const cy = iy + 0.5;
    for (const e of exempt) if ((cx - e.x) ** 2 + (cy - e.y) ** 2 <= e.r * e.r) return true;
    return false;
  };
  let ix = Math.floor(a.x);
  let iy = Math.floor(a.y);
  const ex = Math.floor(b.x);
  const ey = Math.floor(b.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tx = dx !== 0 ? (dx > 0 ? ix + 1 - a.x : a.x - ix) * tdx : Infinity;
  let ty = dy !== 0 ? (dy > 0 ? iy + 1 - a.y : a.y - iy) * tdy : Infinity;
  if (!cellFree(ix, iy)) return false;
  let guard = 0;
  while ((ix !== ex || iy !== ey) && guard++ < 4096) {
    if (Math.abs(tx - ty) < 1e-9) {
      // Exactly through a corner: both neighbours count (no squeezing between two blocked cells).
      if (!cellFree(ix + sx, iy) || !cellFree(ix, iy + sy)) return false;
      ix += sx;
      iy += sy;
      tx += tdx;
      ty += tdy;
    } else if (tx < ty) {
      ix += sx;
      tx += tdx;
    } else {
      iy += sy;
      ty += tdy;
    }
    if (tx > 1 + tdx && ty > 1 + tdy) break;
    if (!cellFree(ix, iy)) return false;
  }
  return true;
}

// ── A* on the grid ───────────────────────────────────────────────────────────────
/** 8-connected A* between two points, limited to a window around them; the result is string-pulled. */
export function astar(g: Grid, from: Point, to: Point, exempt: readonly Exempt[] = [], pad = 48): Point[] | null {
  const x0 = Math.max(0, Math.floor(Math.min(from.x, to.x) - pad));
  const y0 = Math.max(0, Math.floor(Math.min(from.y, to.y) - pad));
  const x1 = Math.min(g.w - 1, Math.ceil(Math.max(from.x, to.x) + pad));
  const y1 = Math.min(g.h - 1, Math.ceil(Math.max(from.y, to.y) + pad));
  const W = x1 - x0 + 1;
  const H = y1 - y0 + 1;
  const free = (x: number, y: number) => !blockedAt(g, x + 0.5, y + 0.5, exempt);
  const sx = Math.floor(from.x) - x0;
  const sy = Math.floor(from.y) - y0;
  const tx = Math.floor(to.x) - x0;
  const ty = Math.floor(to.y) - y0;
  if (sx < 0 || sy < 0 || sx >= W || sy >= H || tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
  const N = W * H;
  const gScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  // A binary heap of (f, cell) pairs; stale entries are skipped via `closed`.
  const hi: number[] = [];
  const hf: number[] = [];
  const push = (i: number, fv: number) => {
    let k = hi.length;
    hi.push(i);
    hf.push(fv);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p]! <= fv) break;
      hi[k] = hi[p]!;
      hf[k] = hf[p]!;
      k = p;
    }
    hi[k] = i;
    hf[k] = fv;
  };
  const pop = (): number => {
    const top = hi[0]!;
    const li = hi.pop()!;
    const lf = hf.pop()!;
    const n = hi.length;
    if (n) {
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = -1;
        let mf = lf;
        if (l < n && hf[l]! < mf) {
          m = l;
          mf = hf[l]!;
        }
        if (r < n && hf[r]! < mf) {
          m = r;
          mf = hf[r]!;
        }
        if (m < 0) break;
        hi[k] = hi[m]!;
        hf[k] = hf[m]!;
        k = m;
      }
      hi[k] = li;
      hf[k] = lf;
    }
    return top;
  };
  const hfn = (x: number, y: number) => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const s = sy * W + sx;
  const t = ty * W + tx;
  gScore[s] = 0;
  push(s, hfn(sx, sy));
  const DIRS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  let found = false;
  while (hi.length) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === t) {
      found = true;
      break;
    }
    closed[cur] = 1;
    const cx = cur % W;
    const cy = (cur / W) | 0;
    for (const [dx, dy, c] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      if (ni !== t && !free(nx + x0, ny + y0)) continue;
      // No corner cutting.
      if (dx && dy && (!free(cx + dx + x0, cy + y0) || !free(cx + x0, cy + dy + y0))) continue;
      const gs = gScore[cur]! + c;
      if (gs < gScore[ni]!) {
        gScore[ni] = gs;
        came[ni] = cur;
        push(ni, gs + hfn(nx, ny));
      }
    }
  }
  if (!found) return null;
  const cellsPath: Point[] = [];
  for (let i = t; i !== -1; i = came[i]!) cellsPath.push({ x: (i % W) + x0 + 0.5, y: ((i / W) | 0) + y0 + 0.5 });
  cellsPath.reverse();
  cellsPath[0] = { ...from };
  cellsPath[cellsPath.length - 1] = { ...to };
  return stringPull(g, cellsPath, exempt);
}

/** Greedy line-of-sight smoothing. */
export function stringPull(g: Grid, pts: Point[], exempt: readonly Exempt[] = []): Point[] {
  if (pts.length <= 2) return pts;
  const out: Point[] = [pts[0]!];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearSegment(g, pts[i]!, pts[j]!, exempt)) j--;
    out.push(pts[j]!);
    i = j;
  }
  return out;
}

// ── the lane graph ───────────────────────────────────────────────────────────────
export function buildLanes(plan: OfficePlan): Pick<LifeNav, 'lines' | 'nodes' | 'dist' | 'next' | 'vx'> {
  const w = plan.bounds.w;
  const cols = plan.cols;
  const vx: number[] = [];
  for (let c = 1; c < cols; c++) vx.push(c * COL_PITCH - 8);
  const nodes: Point[] = [];
  const nodeAt = new Map<string, number>();
  const node = (x: number, y: number) => {
    const k = `${x.toFixed(2)},${y.toFixed(2)}`;
    let i = nodeAt.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodes.push({ x, y });
      nodeAt.set(k, i);
    }
    return i;
  };
  const lines: LaneLine[] = [];
  const hLine = (y: number, from: number, to: number, offset: number) => {
    const xs = [from, ...vx.filter((x) => x > from + 0.01 && x < to - 0.01), to];
    lines.push({ axis: 'h', at: y, from, to, offset, nodes: xs.map((x) => node(x, y)) });
  };
  // The window lane runs over the north row's neighbourhoods (never through the Skyline room or the Chief's office).
  const row0 = plan.cells.filter((c) => c.row === 0).sort((a, b) => a.col - b.col);
  let run: [number, number] | null = null;
  for (const cell of row0) {
    const from = cell.col === 0 ? 4 : cell.col * COL_PITCH - 8;
    const to = cell.col === cols - 1 ? w - 4 : (cell.col + 1) * COL_PITCH - 8;
    if (cell.role === 'pod') {
      if (run && Math.abs(run[1] - from) < 0.01) run[1] = to;
      else {
        if (run) hLine(WIN_Y, run[0], run[1], 0);
        run = [from, to];
      }
    } else if (run) {
      hLine(WIN_Y, run[0], run[1], 0);
      run = null;
    }
  }
  if (run) hLine(WIN_Y, run[0], run[1], 0);
  hLine(BLV_Y, 4, w - 4, LANE_OFFSET);
  hLine(AIS_Y, 4, w - 4, LANE_OFFSET);
  hLine(STH_Y, 4, w - 4, 0);
  for (const x of vx) {
    const ys = [...H_LINES].filter((y) => y !== WIN_Y || nodeAt.has(`${x.toFixed(2)},${WIN_Y.toFixed(2)}`));
    lines.push({ axis: 'v', at: x, from: ys[0]!, to: ys[ys.length - 1]!, offset: AISLE_OFFSET, nodes: ys.map((y) => node(x, y)) });
  }
  const n = nodes.length;
  const dist = new Float64Array(n * n).fill(Infinity);
  const next = new Int32Array(n * n).fill(-1);
  for (let i = 0; i < n; i++) {
    dist[i * n + i] = 0;
    next[i * n + i] = i;
  }
  for (const l of lines) {
    for (let k = 1; k < l.nodes.length; k++) {
      const a = l.nodes[k - 1]!;
      const b = l.nodes[k]!;
      const d = Math.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.y - nodes[b]!.y);
      if (d < dist[a * n + b]!) {
        dist[a * n + b] = d;
        dist[b * n + a] = d;
        next[a * n + b] = b;
        next[b * n + a] = a;
      }
    }
  }
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const dik = dist[i * n + k]!;
      if (dik === Infinity) continue;
      for (let j = 0; j < n; j++) {
        const d = dik + dist[k * n + j]!;
        if (d < dist[i * n + j]!) {
          dist[i * n + j] = d;
          next[i * n + j] = next[i * n + k]!;
        }
      }
    }
  }
  return { lines, nodes, dist, next, vx };
}

const cache = new WeakMap<OfficePlan, LifeNav>();

/** The navigation data for a plan (cached). */
export function lifeNav(plan: OfficePlan): LifeNav {
  let nav = cache.get(plan);
  if (!nav) {
    nav = { plan, grid: buildGrid(plan), ...buildLanes(plan), seatAttach: new Map(), slotAttach: new Map() };
    cache.set(plan, nav);
  }
  return nav;
}

/** The horizontal lane (or window-lane piece) at y covering x. */
export function hLineAt(nav: LifeNav, y: number, x: number): LaneLine | null {
  return nav.lines.find((l) => l.axis === 'h' && Math.abs(l.at - y) < 0.01 && x >= l.from - 0.01 && x <= l.to + 0.01) ?? null;
}
export function vLineAt(nav: LifeNav, x: number, y: number): LaneLine | null {
  return nav.lines.find((l) => l.axis === 'v' && Math.abs(l.at - x) < 0.01 && y >= l.from - 0.01 && y <= l.to + 0.01) ?? null;
}

const coordOn = (l: LaneLine, p: Point) => (l.axis === 'h' ? p.x : p.y);

/** The nodes either side of a portal along its line, with distances. */
export function portalEnds(nav: LifeNav, p: Portal): { node: number; d: number }[] {
  const c = coordOn(p.line, p);
  let lo = -1;
  let hi = -1;
  for (const i of p.line.nodes) {
    const nc = coordOn(p.line, nav.nodes[i]!);
    if (nc <= c + 1e-6) lo = i;
    if (nc >= c - 1e-6 && hi === -1) hi = i;
  }
  const out: { node: number; d: number }[] = [];
  if (lo >= 0) out.push({ node: lo, d: Math.abs(c - coordOn(p.line, nav.nodes[lo]!)) });
  if (hi >= 0 && hi !== lo) out.push({ node: hi, d: Math.abs(coordOn(p.line, nav.nodes[hi]!) - c) });
  return out;
}

/** Shortest lane distance between two portals, and the node sequence (empty when they share a line). */
export function laneRoute(nav: LifeNav, a: Portal, b: Portal): { d: number; via: number[] } {
  if (a.line === b.line) return { d: Math.abs(coordOn(a.line, a) - coordOn(a.line, b)), via: [] };
  const n = nav.nodes.length;
  let best = Infinity;
  let pair: [number, number] = [-1, -1];
  for (const ea of portalEnds(nav, a)) {
    for (const eb of portalEnds(nav, b)) {
      const d = ea.d + nav.dist[ea.node * n + eb.node]! + eb.d;
      if (d < best) {
        best = d;
        pair = [ea.node, eb.node];
      }
    }
  }
  if (pair[0] < 0 || best === Infinity) return { d: Infinity, via: [] };
  const via = [pair[0]];
  let cur = pair[0];
  while (cur !== pair[1]) {
    cur = nav.next[cur * n + pair[1]]!;
    if (cur < 0) return { d: Infinity, via: [] };
    via.push(cur);
  }
  return { d: best, via };
}

export const pathLen = (pts: readonly Point[]): number => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return d;
};

/** Candidate legs from a point to the lanes around it: straight projections first, A* when blocked. */
export function attachPoint(nav: LifeNav, p: Point, exempt: readonly Exempt[], targets?: Portal[]): Attach[] {
  const cands = targets ?? projections(nav, p);
  const out: Attach[] = [];
  // Straight legs first; A* only when no straight leg is clear (the lanes connect everything anyway).
  for (const portal of cands) {
    const to = { x: portal.x, y: portal.y };
    if (clearSegment(nav.grid, p, to, exempt)) out.push({ portal, path: [p, to], len: pathLen([p, to]) });
  }
  if (out.length) return out;
  for (const portal of cands) {
    const to = { x: portal.x, y: portal.y };
    const path = astar(nav.grid, p, to, exempt);
    if (path) out.push({ portal, path, len: pathLen(path) });
  }
  return out;
}

/** Projections of a point onto the nearest lanes above, below, left and right. */
export function projections(nav: LifeNav, p: Point): Portal[] {
  const out: Portal[] = [];
  const above = [...H_LINES].reverse().find((y) => y < p.y - 0.01 && hLineAt(nav, y, p.x));
  const below = H_LINES.find((y) => y > p.y + 0.01 && hLineAt(nav, y, p.x));
  if (above !== undefined) out.push({ line: hLineAt(nav, above, p.x)!, x: p.x, y: above });
  if (below !== undefined) out.push({ line: hLineAt(nav, below, p.x)!, x: p.x, y: below });
  const left = [...nav.vx].reverse().find((x) => x < p.x - 0.01 && vLineAt(nav, x, p.y));
  const right = nav.vx.find((x) => x > p.x + 0.01 && vLineAt(nav, x, p.y));
  if (left !== undefined) out.push({ line: vLineAt(nav, left, p.y)!, x: left, y: p.y });
  if (right !== undefined) out.push({ line: vLineAt(nav, right, p.y)!, x: right, y: p.y });
  return out;
}
