// The conference stage composition (OFFICE-PLAN §2.4): a pinhole view from the owner's seat at the near end of the
// table, looking along it toward the far glass. Pure: seat and tent-card positions, perspective scale and tilt, in
// stage pixels. Seats are spaced evenly on screen (evenly in 1/Z), far seats smaller (0.62) than near ones (0.96).
// The table is sized to the party (the scene passes max(5, people + 1) seats), so a small meeting fills the frame.

export interface StagePoint {
  x: number;
  y: number;
}

export interface StageSeatPos {
  /** Fill order index (far head first, then alternating left and right from the far end). */
  slot: number;
  side: 'head' | 'left' | 'right';
  /** Face centre. */
  x: number;
  y: number;
  /** Face diameter in px. */
  size: number;
  /** 0 = farthest, 1 = nearest. */
  depth: number;
  /** Degrees of rotateY toward the table centre. */
  tilt: number;
  /** Tent card anchor (centre of its top edge): just under its owner's chin, toward the table centre; and its scale. */
  card: StagePoint & { scale: number };
  /** Where the table plane meets this seat (screen y of the seat's depth at table height). */
  tableY: number;
  /** The screen x of the table's long edge at this seat's depth (the side the seat is on; the far edge centre for the head). */
  edgeX: number;
  /** Where this person's glass and notebook sit on the table. */
  place: StagePoint & { scale: number };
  /** A pushed-in chair's backrest base, just outside the table edge. */
  chair: StagePoint;
}

export interface StageGeom {
  w: number;
  h: number;
  table: { farY: number; nearY: number; farHalf: number; nearHalf: number; cx: number };
  seats: StageSeatPos[];
  you: StagePoint;
  /** The pendant pool's resting centre on the table. */
  pool: StagePoint;
  base: number;
  /** Eye level (the horizon line) and where the far glass meets the floor. */
  horizonY: number;
  wallFloorY: number;
  narrow: boolean;
  /** Projection constants: screen = (cx + k·X/Z, horizonY + kE·(1 − H)/Z), H = height above the table in eye units. */
  k: number;
  kE: number;
  /** Seat depths (Z) by slot, for drawing chairs in perspective. */
  depthOf: number[];
}

const ZN = 1.4;
const ZF = 6.5;
const TABLE_HALF = 0.95;
/** How far a seated person's face centre sits outside the table edge (table units). */
const SEAT_OUT = 0.16;

export function stageGeometry(w: number, h: number, capacity: number, opts: { top?: number; bottom?: number } = {}): StageGeom {
  const narrow = w < 900;
  const top = opts.top ?? 64;
  const bottom = opts.bottom ?? 170;
  const cx = w / 2;
  // Camera constants from the full-length table: its far end at 36 % of the free height, 9 % of the width wide.
  const fullFarY = top + (h - top - bottom) * (narrow ? 0.3 : 0.36);
  const nearY = h + 60;
  const kE = (nearY - fullFarY) / (1 / ZN - 1 / ZF);
  const cy = fullFarY - kE / ZF;
  const fullFarHalf = Math.min(w * (narrow ? 0.2 : 0.09), 150);
  const k = (fullFarHalf * ZF) / TABLE_HALF;
  const nearHalf = (k * TABLE_HALF) / ZN;
  const base = Math.max(56, Math.min(132, w / 8.5, (h - top - bottom) / 3.4));
  const perSide = Math.max(1, Math.floor((capacity - 1) / 2));
  // A point on the table plane at lateral offset X and depth Z.
  const project = (X: number, Z: number): StagePoint => ({ x: cx + (k * X) / Z, y: cy + kE / Z });
  // The camera is framed for the full room (four pairs from the near seats to the far end). A smaller party sits
  // from the near end at a roomier pitch, and the table ends just behind its farthest pair, so a meeting of five
  // fills the frame around a short table instead of lining a runway.
  const invFull = 1 / (ZF - 0.9);
  const nearLimitY = h - bottom + 10;
  const invNear = Math.max(invFull + 0.05, Math.min(1 / 2.1, (nearLimitY - cy) / kE));
  const span = invNear - invFull;
  const pitch = perSide >= 4 ? span / (perSide - 1) : span * ([0, 0.5, 0.4, 1 / 3][perSide] ?? 0.5);
  const inv = (i: number) => invNear - (perSide - 1 - i) * pitch;
  const invEnd = inv(0) - (span / 3) * 0.25;
  const zEnd = 1 / invEnd;
  const scaleAt = (iz: number) => 0.62 + 0.34 * Math.min(1, Math.max(0, (iz - invFull) / Math.max(1e-6, span)));
  const farY = cy + kE * invEnd;
  const farHalf = k * TABLE_HALF * invEnd;
  const seats: StageSeatPos[] = [];
  const depthOf: number[] = [];
  const headZ = zEnd + 0.35;
  depthOf.push(headZ);
  const head = project(0, headZ);
  const headScale = 1 / headZ < invFull ? 0.58 : scaleAt(1 / headZ);
  const headSize = base * headScale;
  const headY = head.y - headSize * 0.62;
  seats.push({
    slot: 0,
    side: 'head',
    x: head.x,
    y: headY,
    size: headSize,
    depth: Math.max(0, (headScale - 0.62) / 0.34),
    tilt: 0,
    card: { x: head.x, y: headY + headSize * 0.6 + 2, scale: headScale },
    place: { ...project(0, zEnd - 0.4 * (zEnd / ZF)), scale: headScale },
    chair: project(0, zEnd + 0.12),
    tableY: farY,
    edgeX: cx,
  });
  let slot = 1;
  for (let i = 0; i < perSide; i++) {
    const iz = inv(i);
    const Z = 1 / iz;
    const s = scaleAt(iz);
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? -1 : 1;
      const p = project(sign * (TABLE_HALF + SEAT_OUT), Z);
      const pl = project(sign * (TABLE_HALF - 0.5), Z);
      const ch = project(sign * (TABLE_HALF + 0.14), Z);
      const edge = project(sign * TABLE_HALF, Z);
      const size = base * s;
      const y = p.y - size * 0.66;
      depthOf.push(Z);
      // The tent card stands just under its owner's chin (clear of the speaking lift), a quarter of a face toward
      // the table centre.
      const card = { x: p.x - sign * 0.25 * size, y: y + size * 0.6 + 2, scale: s };
      seats.push({ slot: slot++, side, x: p.x, y, size, depth: (s - 0.62) / 0.34, tilt: side === 'left' ? 10 : -10, card, place: { ...pl, scale: s }, chair: ch, tableY: p.y, edgeX: edge.x });
    }
  }
  const you = project(0, ZN + 0.3);
  const pool = project(0, 1 / ((inv(0) + invNear) / 2));
  const wallFloorY = cy + (1.75 * kE) / (ZF + 0.9);
  return { w, h, table: { farY, nearY, farHalf, nearHalf, cx }, seats, you, pool, base, horizonY: cy, wallFloorY, narrow, k, kE, depthOf };
}

/** An empty chair pushed in at a slot, drawn in perspective: its backrest seen from the side (or from behind at the head). */
export function emptyChairPath(g: StageGeom, slot: number): string {
  return emptyChair(g, slot).d;
}

/** The pushed-in chair's outline and, separately, its top edge (for a faint highlight). */
export function emptyChair(g: StageGeom, slot: number): { d: string; top: string } {
  const seat = g.seats[slot];
  const Z = g.depthOf[slot];
  if (!seat || Z === undefined) return { d: '', top: '' };
  const P = (X: number, H: number, z: number) => [g.table.cx + (g.k * X) / z, g.horizonY + (g.kE * (1 - H)) / z] as const;
  const f = (v: number) => v.toFixed(1);
  if (seat.side === 'head') {
    const [x0, y0] = P(-0.34, -0.25, Z + 0.1);
    const [x1, y1] = P(0.34, 0.5, Z + 0.1);
    const r = (x1 - x0) * 0.3;
    return {
      d: `M${f(x0)} ${f(y0)}V${f(y1 + r)}Q${f(x0)} ${f(y1)} ${f(x0 + r)} ${f(y1)}H${f(x1 - r)}Q${f(x1)} ${f(y1)} ${f(x1)} ${f(y1 + r)}V${f(y0)}Z`,
      top: `M${f(x0)} ${f(y1 + r)}Q${f(x0)} ${f(y1)} ${f(x0 + r)} ${f(y1)}H${f(x1 - r)}Q${f(x1)} ${f(y1)} ${f(x1)} ${f(y1 + r)}`,
    };
  }
  const sign = seat.side === 'left' ? -1 : 1;
  const X = sign * (TABLE_HALF + 0.16);
  const a = P(X, -0.3, Z - 0.2);
  const b = P(X, 0.26, Z - 0.17);
  const c = P(X, 0.26, Z + 0.17);
  const d = P(X, -0.3, Z + 0.2);
  const mx = (b[0] + c[0]) / 2;
  const my = Math.min(b[1], c[1]) - Math.abs(b[1] - c[1]) * 0.35 - 3;
  return {
    d: `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}Q${f(mx)} ${f(my)} ${f(c[0])} ${f(c[1])}L${f(d[0])} ${f(d[1])}Z`,
    top: `M${f(b[0])} ${f(b[1])}Q${f(mx)} ${f(my)} ${f(c[0])} ${f(c[1])}`,
  };
}

/** The table top outline (a trapezoid with softly rounded far corners) as an SVG path. */
export function tablePath(g: StageGeom): string {
  const { farY, nearY, farHalf, nearHalf, cx } = g.table;
  const r = Math.min(18, farHalf * 0.25);
  const f = (v: number) => v.toFixed(1);
  return `M${f(cx - farHalf + r)} ${f(farY)}H${f(cx + farHalf - r)}Q${f(cx + farHalf)} ${f(farY)} ${f(cx + farHalf + r * 0.3)} ${f(farY + r * 0.6)}L${f(cx + nearHalf)} ${f(nearY)}H${f(cx - nearHalf)}L${f(cx - farHalf - r * 0.3)} ${f(farY + r * 0.6)}Q${f(cx - farHalf)} ${f(farY)} ${f(cx - farHalf + r)} ${f(farY)}Z`;
}

/** The table's visible edge thickness along its long sides, as two SVG paths. */
export function tableEdges(g: StageGeom, thickness = 0.06): string[] {
  const { farY, nearY, farHalf, nearHalf, cx } = g.table;
  const f = (v: number) => v.toFixed(1);
  const t0 = farHalf * thickness * 1.6;
  const t1 = nearHalf * thickness * 1.6;
  return [-1, 1].map((s) => `M${f(cx + s * farHalf)} ${f(farY)}L${f(cx + s * nearHalf)} ${f(nearY)}L${f(cx + s * nearHalf)} ${f(nearY + t1)}L${f(cx + s * farHalf)} ${f(farY + t0)}Z`);
}

/** Tilt for a seat: toward the speaker when someone speaks, toward the owner when the owner speaks, else the table. */
export function tiltFor(seat: StageSeatPos, speaker: StageSeatPos | null, ownerSpeaking: boolean): number {
  if (ownerSpeaking) return seat.side === 'left' ? 6 : seat.side === 'right' ? -6 : 0;
  if (speaker && speaker !== seat) {
    const dx = speaker.x - seat.x;
    return Math.max(-10, Math.min(10, dx / 20));
  }
  return seat.tilt;
}

/**
 * Narrow screens (< 900 px): a stack instead of the long table. The speaker (or the first participant) is the hero
 * on top; everyone else is a row of tokens beneath (OFFICE-PLAN §2.4).
 */
export function narrowPositions(w: number, h: number, count: number, heroIndex: number, top = 60, bottom = 150): { x: number; y: number; size: number }[] {
  const out: { x: number; y: number; size: number }[] = [];
  const avail = h - top - bottom;
  const hero = Math.min(w * 0.46, avail * 0.42, 200);
  const heroY = top + avail * 0.3;
  const others = Math.max(0, count - 1);
  const perRow = Math.max(1, Math.min(5, Math.floor((w - 24) / 68)));
  const size = Math.min(58, (w - 32) / perRow - 12);
  let j = 0;
  for (let i = 0; i < count; i++) {
    if (i === heroIndex) {
      out.push({ x: w / 2, y: heroY, size: hero });
      continue;
    }
    const row = Math.floor(j / perRow);
    const inRow = Math.min(perRow, others - row * perRow);
    const col = j % perRow;
    const pitch = size + 14;
    const x0 = w / 2 - ((inRow - 1) * pitch) / 2;
    out.push({ x: x0 + col * pitch, y: heroY + hero / 2 + 46 + size / 2 + row * (size + 34), size });
    j++;
  }
  return out;
}
