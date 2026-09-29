// The vector asset library (OFFICE-PLAN §1.5). Every asset is drawn for the 3/4 camera: its top face plus its south
// face, flat shapes with two or three tonal steps and a hairline top highlight. No outlines, no filters, no masks:
// shadows and glows are shapes. Coordinates are projected u; each function documents its local origin.
import { K_Y as KY, K_Z as KZ } from '../projection';
import { mulberry32, rngFor } from '../rng';
import type { District, Facing } from '../types';

export const n = (v: number): string => String(Math.round(v * 100) / 100);
export const rect = (cls: string, x: number, y: number, w: number, h: number, extra = ''): string =>
  `<rect class="${cls}" x="${n(x)}" y="${n(y)}" width="${n(Math.max(0, w))}" height="${n(Math.max(0, h))}"${extra}/>`;
export const rrect = (cls: string, x: number, y: number, w: number, h: number, r: number, extra = ''): string =>
  rect(cls, x, y, w, h, ` rx="${n(Math.min(r, w / 2, h / 2))}"${extra}`);
export const ell = (cls: string, cx: number, cy: number, rx: number, ry: number, extra = ''): string =>
  `<ellipse class="${cls}" cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}"${extra}/>`;
export const path = (cls: string, d: string, extra = ''): string => `<path class="${cls}" d="${d}"${extra}/>`;
export const line = (cls: string, x1: number, y1: number, x2: number, y2: number): string =>
  `<path class="${cls}" d="M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}"/>`;
const op = (v: number) => ` opacity="${v}"`;
/** A 0.25 u hairline highlight along a top edge (chair backs, desk tops). */
const hairTop = (x: number, y: number, w: number): string => `<path class="hair" d="M${n(x)} ${n(y + 0.12)}h${n(w)}" style="stroke-width:.25"/>`;
const Y = (y: number, z = 0) => y * KY - z * KZ;

/** A box: its top face and south face. Local plan coords (x, y) at heights z0..z1. */
function box(x: number, y: number, w: number, d: number, z0: number, z1: number, top: string, front: string, r = 0): string {
  return (r ? rrect(top, x, Y(y, z1), w, d * KY, r) : rect(top, x, Y(y, z1), w, d * KY)) + rect(front, x, Y(y + d, z1), w, (z1 - z0) * KZ);
}

const NOTES = ['n1', 'n2', 'n3', 'n4'];

// ── floors ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The concrete floor with faint panel joints. Origin: plate NW corner. */
export function floorPlate(w: number, h: number): string {
  let s = rect('fl', 0, 0, w, h * KY);
  let joints = '';
  for (let x = 56; x < w; x += 56) joints += `M${n(x)} 0V${n(h * KY)}`;
  for (let y = 40; y < h; y += 40) joints += `M0 ${n(y * KY)}H${n(w)}`;
  s += path('ln', joints);
  return s;
}

export function carpet(x: number, y: number, w: number, d: number, district: District): string {
  return rect(`ca-${district}`, x, Y(y), w, d * KY) + rect('ce', x + 0.8, Y(y + 0.8), w - 1.6, (d - 1.6) * KY);
}

export function rug(x: number, y: number, w: number, d: number, variant: number): string {
  const c = `r${variant % 5}`;
  let s = rect('shs', x + 0.4, Y(y + 0.6), w, d * KY) + rect(c, x, Y(y), w, d * KY) + rect('rl', x + 1.4, Y(y + 1.4), w - 2.8, (d - 2.8) * KY);
  const kind = variant % 3;
  if (kind === 0) {
    let d2 = '';
    for (let i = 1; i < 4; i++) d2 += `M${n(x + 3)} ${n(Y(y + (d * i) / 4))}H${n(x + w - 3)}`;
    s += path('rl', d2);
  } else if (kind === 1) {
    s += rect('rl', x + 3.4, Y(y + 3.4), w - 6.8, (d - 6.8) * KY);
  } else {
    let d2 = '';
    const cx = x + w / 2;
    const cy = y + d / 2;
    d2 += `M${n(cx)} ${n(Y(y + 3))}L${n(x + w - 4)} ${n(Y(cy))}L${n(cx)} ${n(Y(y + d - 3))}L${n(x + 4)} ${n(Y(cy))}Z`;
    s += path('rl', d2);
  }
  return s;
}

export function roomFloor(x: number, y: number, w: number, d: number): string {
  let lines = '';
  for (let yy = y + 2.2; yy < y + d; yy += 2.2) lines += `M${n(x)} ${n(Y(yy))}H${n(x + w)}`;
  return rect('ok', x, Y(y), w, d * KY) + path('okl', lines);
}

export function cafeFloor(x: number, y: number, w: number, d: number): string {
  let lines = '';
  for (let xx = x + 6; xx < x + w; xx += 6) lines += `M${n(xx)} ${n(Y(y))}V${n(Y(y + d))}`;
  for (let yy = y + 6; yy < y + d; yy += 6) lines += `M${n(x)} ${n(Y(yy))}H${n(x + w)}`;
  return rect('cf', x, Y(y), w, d * KY) + path('tl', lines);
}

export function mat(x: number, y: number, w: number, d: number): string {
  return rrect('mt', x, Y(y), w, d * KY, 0.6) + rect('rl', x + 1, Y(y + 1), w - 2, (d - 2) * KY);
}

// ── desks and chairs ─────────────────────────────────────────────────────────────────────────────────────────

export const DESK = { w: 15.4, d: 8, z: 7.3 };

/** A bench desk: walnut top on steel legs, monitor, keyboard and a clutter variant. Origin: desk NW at floor. */
export function desk(facing: Facing, clutter: number): string {
  const { w: W, d: D, z: Z } = DESK;
  const top = Y(0, Z);
  let s = rect('sh', 0.3, Y(0.6), W - 0.6, D * KY, op(0.55));
  s += rect('md', 0.5, Y(D, Z) + 0.3, 0.55, Z * KZ - 0.3) + rect('md', W - 1.05, Y(D, Z) + 0.3, 0.55, Z * KZ - 0.3);
  s += rect('md', 0.9, Y(D * 0.5, 3.2), W - 1.8, 0.25, op(0.7));
  s += rect('w', 0, top, W, D * KY) + rect('wh', 0, top, W, 0.2) + rect('wd', 0, Y(D, Z), W, 0.4) + hairTop(0, top, W);
  const monN = facing === 'n';
  const kbY = monN ? 5.2 : 1.6;
  s += rrect('mh', W / 2 - 3, Y(kbY, Z), 6, 1.1 * KY, 0.2, op(0.5)) + rrect('mh', W / 2 + 3.8, Y(kbY + 0.1, Z), 0.8, 0.9 * KY, 0.3, op(0.45));
  if (monN) {
    const my = 1.1;
    s += ell('md', W / 2, Y(my + 0.5, Z), 1.3, 0.5) + rect('md', W / 2 - 0.22, Y(my, 12.2) + 2, 0.44, Y(my + 0.5, Z) - Y(my, 12.2) - 2);
    s += rrect('m', W / 2 - 3.35, Y(my, 12.4), 6.7, 4 * KZ, 0.25) + rect('sc', W / 2 - 3.05, Y(my, 12.4) + 0.25, 6.1, 4 * KZ - 0.55);
    s += rect('hair', W / 2 - 3.05, Y(my, 12.4) + 0.25, 6.1, 0.01);
  } else {
    const my = D - 1.2;
    s += ell('md', W / 2, Y(my - 0.4, Z), 1.3, 0.5) + rect('md', W / 2 - 0.3, Y(my, 11) , 0.6, Y(my - 0.4, Z) - Y(my, 11));
    s += rrect('md', W / 2 - 3.2, Y(my, 12.3), 6.4, 3.9 * KZ, 0.4) + rrect('m', W / 2 - 1.4, Y(my, 11.6), 2.8, 1.2, 0.3, op(0.7)) + rect('mh', W / 2 - 3, Y(my, 12.3), 6, 0.14, op(0.7));
  }
  const cx = clutter % 2 ? 2.4 : W - 2.4;
  const cy = monN ? 3.4 : 4.8;
  switch (clutter) {
    case 1: // mug
      s += rect('poh', cx - 0.5, Y(cy, Z + 1) , 1, 1 * KZ + 0.1) + ell('poh', cx, Y(cy, Z + 1), 0.5, 0.36) + ell('so', cx, Y(cy, Z + 1), 0.36, 0.25) + rect('poh', cx + 0.45, Y(cy, Z + 0.8), 0.35, 0.35);
      break;
    case 2: // notebook
      s += `<g transform="rotate(${cx > W / 2 ? -8 : 7} ${n(cx)} ${n(Y(cy, Z))})">${rrect(NOTES[(clutter + Math.round(cx)) % 4]!, cx - 1.4, Y(cy - 1, Z), 2.8, 2 * KY, 0.15)}${rect('pa', cx - 1.2, Y(cy - 0.8, Z), 0.2, 1.6 * KY, op(0.6))}</g>`;
      break;
    case 3: // succulent
      s += rect('po', cx - 0.6, Y(cy, Z + 1.1), 1.2, 1.1 * KZ) + ell('po', cx, Y(cy, Z), 0.6, 0.35) + ell('so', cx, Y(cy, Z + 1.1), 0.55, 0.3);
      s += ell('ph', cx - 0.35, Y(cy, Z + 1.6), 0.4, 0.28) + ell('p', cx + 0.3, Y(cy, Z + 1.5), 0.42, 0.3) + ell('ph', cx, Y(cy - 0.2, Z + 2), 0.35, 0.3);
      break;
    case 4: // papers
      s += `<g transform="rotate(-6 ${n(cx)} ${n(Y(cy, Z))})">${rect('pa', cx - 1.2, Y(cy - 1.2, Z), 2.4, 3 * KY, op(0.55))}${rect('pa', cx - 1, Y(cy - 1.4, Z + 0.1), 2.4, 3 * KY, op(0.7))}</g>`;
      break;
    default:
      break;
  }
  return s;
}

/** The desk lamp (the lamp motif), unlit. Origin: its base on the floor plan point (the desk top is at z 7.3). */
export function deskLamp(facing: Facing): string {
  const t = Y(0, DESK.z);
  const dir = facing === 'n' ? 1 : -1;
  const ax = -0.9;
  const ay = t - 3.4;
  const hx = 0.9;
  const hy = t - 4.9 + dir * 0.2;
  let s = ell('md', 0, t, 0.85, 0.45) + ell('m', 0, t - 0.12, 0.6, 0.3);
  s += `<path class="leg" d="M0 ${n(t - 0.1)}L${n(ax)} ${n(ay)}L${n(hx)} ${n(hy)}"/>`;
  s += ell('md', ax, ay, 0.22, 0.22);
  s += `<path class="m" d="M${n(hx - 0.9)} ${n(hy - 0.2)}L${n(hx + 0.6)} ${n(hy - 0.6)}L${n(hx + 1.4)} ${n(hy + 0.9)}L${n(hx - 0.5)} ${n(hy + 1.2)}Z"/>`;
  s += ell('mh', hx + 0.45, hy + 1.05, 0.95, 0.3, op(0.8));
  return s;
}

/** An ergonomic chair: 5-star base, seat, mesh back. Origin: chair centre at floor. variant 2 = executive leather. */
export function chair(facing: Facing, variant: number): string {
  const exec = variant === 2;
  const seatZ = 4.6;
  const b0 = 5.4;
  const b1 = exec ? 12.2 : 10.6;
  const seat = exec ? 'le' : 'fb';
  const seatHi = exec ? 'leh' : 'fbh';
  const back = exec ? 'le' : 'me';
  let s = ell('sh', 0, 0.3, 3.3, 2.2, op(0.7));
  let legs = '';
  let casters = '';
  for (let i = 0; i < 5; i++) {
    const a = ((i * 72 + 18) * Math.PI) / 180;
    const ex = Math.cos(a) * 2.7;
    const ey = Math.sin(a) * 2.7 * KY - 0.25;
    legs += `M0 -0.35L${n(ex)} ${n(ey)}`;
    casters += ell('md', ex, ey + 0.12, 0.33, 0.26);
  }
  s += path('leg', legs) + casters + rect('md', -0.28, Y(0, seatZ) + 0.3, 0.56, seatZ * KZ - 0.6);
  const seatTop = rrect(seat, -2.5, Y(-2.4, seatZ), 5, 4.8 * KY, 1.2) + rrect(seatHi, -2, Y(-2, seatZ) + 0.1, 4, 3.4 * KY, 1, op(0.45)) + rrect('fbd', -2.4, Y(2.4, seatZ) - 0.25, 4.8, 0.6, 0.3);
  const armsNS = rrect('md', -2.95, Y(-1.3, 7), 0.5, 2.6 * KY, 0.2) + rrect('md', 2.45, Y(-1.3, 7), 0.5, 2.6 * KY, 0.2) + rect('md', -2.8, Y(0, 7) + 1, 0.2, 7 * KZ - 4.6 * KZ - 1) + rect('md', 2.6, Y(0, 7) + 1, 0.2, 7 * KZ - 4.6 * KZ - 1);
  if (facing === 's') {
    const by = -2.7;
    s += rect('md', -0.3, Y(by, b0) - 0.2, 0.6, (b0 - seatZ) * KZ + 0.6);
    s += rrect('md', -2.45, Y(by, b1) - 0.15, 4.9, (b1 - b0) * KZ + 0.3, 1.1) + rrect(back, -2.2, Y(by, b1), 4.4, (b1 - b0) * KZ, 1) + hairTop(-1.6, Y(by, b1), 3.2);
    s += rect(seatHi, -1.8, Y(by, b1) + 0.5, 3.6, 0.18, op(0.5)) + rect(seatHi, -1.8, Y(by, (b0 + b1) / 2), 3.6, 0.14, op(0.35));
    s += seatTop + armsNS;
  } else if (facing === 'n') {
    const by = 2.7;
    s += seatTop + armsNS;
    s += rect('md', -0.3, Y(by, b0), 0.6, (b0 - seatZ) * KZ + 0.4);
    // The back seen from behind: a mesh panel in a darker frame (≥ 1.6:1 against every carpet in the dark theme).
    s += rrect('fbd', -2.45, Y(by, b1), 4.9, (b1 - b0) * KZ, 1.1) + rrect(exec ? 'leh' : back, -2.2, Y(by, b1) + 0.25, 4.4, (b1 - b0) * KZ - 0.6, 0.9);
    s += rect(exec ? 'leh' : 'mh', -1.9, Y(by, b1) + 0.05, 3.8, 0.16, op(0.55)) + hairTop(-1.7, Y(by, b1), 3.4);
  } else {
    const sx = facing === 'e' ? -2.75 : 2.05;
    const armsEW = rrect('md', -1.3, Y(-2.7, 7), 2.6, 0.45, 0.2) + rrect('md', -1.3, Y(2.5, 7), 2.6, 0.45, 0.2);
    s += seatTop + armsEW;
    s += rrect(exec ? 'le' : back, sx, Y(-2.3, b1), 0.7, 4.6 * KY + (b1 - b0) * KZ, 0.35) + rect(exec ? 'leh' : 'fbh', sx + 0.15, Y(-2.3, b1) + 0.2, 0.4, 4.6 * KY + (b1 - b0) * KZ - 0.6, op(0.35)) + hairTop(sx + 0.1, Y(-2.3, b1), 0.5);
  }
  return s;
}

export function benchScreen(w: number): string {
  const top = 11.5;
  let s = rect('ftd', 0, Y(0, top), w, 1 * KY) + rect('ft', 0, Y(1, top), w, (top - DESK.z) * KZ) + rect('fth', 0, Y(0, top), w, 0.28);
  let seams = '';
  for (let x = 16; x < w - 1; x += 16) seams += `M${n(x)} ${n(Y(1, top))}V${n(Y(1, DESK.z))}`;
  s += path('hair', seams);
  return s;
}

// ── plants ───────────────────────────────────────────────────────────────────────────────────────────────────

function pot(r: number, h: number, tall = false): string {
  const t = Y(0, h);
  let s = ell('sh', 0.3, 0.4, r * 1.35, r * KY * 1.15, op(0.8));
  if (tall) s += path('po', `M${n(-r)} ${n(t)}L${n(-r * 0.82)} 0A${n(r * 0.82)} ${n(r * 0.82 * KY)} 0 0 0 ${n(r * 0.82)} 0L${n(r)} ${n(t)}Z`);
  else s += rect('po', -r, t, 2 * r, h * KZ) + ell('po', 0, 0, r, r * KY);
  s += rect('poh', -r * 0.62, t, r * 0.34, h * KZ * 0.95, op(0.55));
  s += ell('poh', 0, t, r, r * KY) + ell('so', 0, t, r * 0.84, r * KY * 0.84);
  return s;
}

function leaf(cls: string, cx: number, cy: number, len: number, wid: number, angle: number, split: boolean): string {
  const a = (angle * 180) / Math.PI;
  const d = `M${n(-len / 2)} 0C${n(-len / 4)} ${n(-wid)} ${n(len / 3)} ${n(-wid * 0.95)} ${n(len / 2)} 0C${n(len / 3)} ${n(wid * 0.95)} ${n(-len / 4)} ${n(wid)} ${n(-len / 2)} 0Z`;
  let s = `<g transform="translate(${n(cx)} ${n(cy)}) rotate(${n(a)})">${path(cls, d)}`;
  s += `<path class="vein" d="M${n(-len / 2)} 0L${n(len / 2 - 0.2)} 0"/>`;
  if (split) s += `<path class="vein" d="M${n(-len * 0.1)} ${n(-wid * 0.2)}L${n(len * 0.02)} ${n(-wid * 0.8)}M${n(len * 0.15)} ${n(wid * 0.15)}L${n(len * 0.25)} ${n(wid * 0.75)}M${n(-len * 0.28)} ${n(wid * 0.2)}L${n(-len * 0.18)} ${n(wid * 0.8)}"/>`;
  return `${s}</g>`;
}

/** Monstera in a large pot. Origin: pot centre at floor. */
export function plantMonstera(variant: number): string {
  const rand = mulberry32(variant * 7919 + 13);
  const r = 3.1;
  const h = 5;
  let s = pot(r, h);
  const leaves: { x: number; y: number; z: number; a: number; len: number }[] = [];
  const count = 9;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.5;
    const dist = 1.8 + rand() * 2.6;
    leaves.push({ x: Math.cos(a) * dist, y: Math.sin(a) * dist, z: h + 3 + rand() * 7, a, len: 3.6 + rand() * 1.4 });
  }
  leaves.sort((p, q) => Y(p.y, p.z) - Y(q.y, q.z));
  let stems = '';
  for (const l of leaves) stems += `M0 ${n(Y(0, h + 0.5))}Q${n(l.x * 0.4)} ${n(Y(l.y * 0.4, l.z + 1.5))} ${n(l.x * 0.8)} ${n(Y(l.y * 0.8, l.z))}`;
  s += `<path class="vein" d="${stems}"/>`;
  leaves.forEach((l, i) => {
    const px = l.x;
    const py = Y(l.y, l.z);
    const ang = Math.atan2(l.y * KY - 1.6, l.x);
    s += leaf(i % 3 === 0 ? 'ph' : i % 3 === 1 ? 'p' : 'pd', px, py, l.len, l.len * 0.42, ang, true);
  });
  return s;
}

/** Snake plant: upright blades. */
export function plantSnake(variant: number): string {
  const rand = mulberry32(variant * 104729 + 7);
  const r = 2.1;
  const h = 4;
  let s = pot(r, h, true);
  const blades = 7;
  const base = Y(0, h);
  const list = Array.from({ length: blades }, (_, i) => ({ bx: -1.4 + (i / (blades - 1)) * 2.8 + (rand() - 0.5) * 0.4, hz: 7 + rand() * 7, lean: (rand() - 0.5) * 1.6, depth: rand() }));
  list.sort((a, b) => a.depth - b.depth);
  for (const b of list) {
    const tipY = base - b.hz * KZ;
    const tipX = b.bx + b.lean;
    const d = `M${n(b.bx - 0.45)} ${n(base)}Q${n(b.bx - 0.5 + b.lean * 0.4)} ${n(base - b.hz * KZ * 0.55)} ${n(tipX)} ${n(tipY)}Q${n(b.bx + 0.6 + b.lean * 0.4)} ${n(base - b.hz * KZ * 0.5)} ${n(b.bx + 0.45)} ${n(base)}Z`;
    s += path(b.depth > 0.5 ? 'p' : 'pd', d) + `<path class="vein" d="M${n(b.bx)} ${n(base)}Q${n(b.bx + b.lean * 0.4)} ${n(base - b.hz * KZ * 0.5)} ${n(tipX)} ${n(tipY + 0.4)}" style="stroke:var(--o-plant-y);opacity:.55"/>`;
  }
  return s;
}

/** Fiddle-leaf fig: a slim tree with round leaves. */
export function plantFiddle(variant: number): string {
  const rand = mulberry32(variant * 15485863 + 3);
  const r = 2.9;
  const h = 5.5;
  let s = pot(r, h, true);
  const top = h + 20 + rand() * 3;
  const bend = (rand() - 0.5) * 1.6;
  s += `<path class="stem" d="M0 ${n(Y(0, h))}Q${n(bend)} ${n(Y(0, (h + top) / 2))} ${n(bend * 0.6)} ${n(Y(0, top))}"/>`;
  const leaves: { x: number; y: number; z: number; a: number; s: number }[] = [];
  for (let i = 0; i < 15; i++) {
    const z = h + 9 + (i / 14) * (top - h - 9) + (rand() - 0.5) * 1.5;
    const a = rand() * Math.PI * 2;
    const dist = 0.6 + rand() * (2.6 - (i / 14) * 1.2);
    leaves.push({ x: Math.cos(a) * dist + bend * 0.5, y: Math.sin(a) * dist, z, a, s: 1.5 + rand() * 0.6 });
  }
  leaves.sort((p, q) => Y(p.y, p.z) - Y(q.y, q.z));
  leaves.forEach((l, i) => {
    const px = l.x;
    const py = Y(l.y, l.z);
    s += leaf(i % 3 === 0 ? 'pd' : i % 3 === 1 ? 'p' : 'ph', px, py, l.s * 1.9, l.s * 0.85, Math.atan2(l.y * KY - 1, l.x) + (rand() - 0.5), false);
  });
  return s;
}

/** Pothos: a mound of heart leaves with trailing vines. */
export function plantPothos(variant: number): string {
  const rand = mulberry32(variant * 31337 + 11);
  const r = 2.4;
  const h = 3.4;
  let s = pot(r, h);
  const t = Y(0, h);
  let vines = '';
  const tips: [number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const x0 = -1.6 + i * 1.6 + (rand() - 0.5);
    const drop = 2 + rand() * 3;
    vines += `M${n(x0)} ${n(t + 0.4)}Q${n(x0 + (rand() - 0.5) * 2)} ${n(t + drop * 0.6)} ${n(x0 + (rand() - 0.5) * 1.5)} ${n(t + drop)}`;
    for (let k = 1; k <= 3; k++) tips.push([x0 + (rand() - 0.5) * 1.2, t + (drop * k) / 3]);
  }
  s += `<path class="vein" d="${vines}" style="stroke:var(--o-plant)"/>`;
  for (const [x, y] of tips) s += ell(rand() < 0.5 ? 'p' : 'ph', x, y, 0.6, 0.45);
  for (let i = 0; i < 11; i++) {
    const a = rand() * Math.PI * 2;
    const dist = rand() * 2.2;
    s += leaf(i % 2 ? 'p' : 'ph', Math.cos(a) * dist, t - 0.8 - rand() * 1.6 + Math.sin(a) * dist * KY, 1.8, 0.9, a, false);
  }
  return s;
}

// ── boards, shelves and things ───────────────────────────────────────────────────────────────────────────────

/** Mobile whiteboard facing south, with sticky notes and marker strokes (no legible text). Origin: base centre. */
export function whiteboard(variant: number): string {
  const rand = mulberry32(variant + 99);
  const z0 = 7;
  const z1 = 18.5;
  const hw = 6.6;
  let s = ell('sh', 0, 0.3, 7.6, 1.2, op(0.7));
  s += rect('md', -hw - 0.8, -0.35, 2.2, 0.5) + rect('md', hw - 1.4, -0.35, 2.2, 0.5);
  s += rect('m', -hw - 0.1, Y(0, z1 + 0.3), 0.45, (z1 + 0.3) * KZ) + rect('m', hw - 0.35, Y(0, z1 + 0.3), 0.45, (z1 + 0.3) * KZ);
  s += rect('mh', -hw, Y(0, z1), hw * 2, (z1 - z0) * KZ) + rect('bd', -hw + 0.25, Y(0, z1) + 0.25, hw * 2 - 0.5, (z1 - z0) * KZ - 0.5);
  s += rect('bdl', -hw + 0.25, Y(0, z0) - 0.9, hw * 2 - 0.5, 0.65, op(0.5)) + rect('m', -3.5, Y(0, z0) - 0.1, 7, 0.35);
  const count = 5 + Math.floor(rand() * 5);
  const top = Y(0, z1) + 0.8;
  const bottom = Y(0, z0) - 1.9;
  for (let i = 0; i < count; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = -hw + 0.9 + col * 1.25 + (rand() - 0.5) * 0.3 + (rand() < 0.3 ? 7 : 0);
    const y = top + row * 1.25 + (rand() - 0.5) * 0.25;
    if (y > bottom) continue;
    s += `<rect class="${NOTES[Math.floor(rand() * 4)]}" x="${n(x)}" y="${n(y)}" width="0.95" height="0.95" transform="rotate(${n((rand() - 0.5) * 10)} ${n(x + 0.47)} ${n(y + 0.47)})"/>`;
  }
  const strokes = 2 + Math.floor(rand() * 3);
  let d = '';
  for (let i = 0; i < strokes; i++) {
    const sx = -1 + rand() * 5;
    const sy = top + 0.4 + i * 1.3;
    if (sy > bottom) break;
    d += `M${n(sx)} ${n(sy)}`;
    for (let k = 1; k <= 5; k++) d += `L${n(sx + k * 0.8)} ${n(sy + (rand() - 0.5) * 0.6)}`;
  }
  d += `M${n(-hw + 1)} ${n(bottom + 0.2)}C${n(-2)} ${n(bottom - 1.2)} ${n(1)} ${n(bottom + 0.6)} ${n(3.5)} ${n(bottom - 0.4)}`;
  s += `<path class="ink" d="${d}"/>`;
  return s;
}

function spines(x: number, zBottom: number, zTop: number, w: number, yPlan: number, rand: () => number): string {
  // Books in runs of two to five: one tone and height per run with hairline gaps, so a full shelf stays a few nodes.
  let s = '';
  let seps = '';
  let cx = x + 0.4;
  const classes = ['n1', 'n2', 'n3', 'n4', 'mh', 'pa', 'wh', 'fbh'];
  while (cx < x + w - 0.8) {
    if (rand() < 0.14) {
      cx += 0.8 + rand() * 1.4;
      continue;
    }
    const count = 2 + Math.floor(rand() * 4);
    const bw = Math.min(x + w - 0.4 - cx, count * (0.38 + rand() * 0.22));
    if (bw < 0.4) break;
    const bh = (zTop - zBottom) * (0.62 + rand() * 0.3);
    const top = Y(yPlan, zBottom + bh);
    s += rect(classes[Math.floor(rand() * classes.length)]!, cx, top, bw, bh * KZ, op(Math.round((0.55 + rand() * 0.3) * 100) / 100));
    for (let k = 1; k < count; k++) seps += `M${n(cx + (k * bw) / count)} ${n(top)}v${n(bh * KZ)}`;
    cx += bw + 0.08;
  }
  return s + (seps ? `<path d="${seps}" style="fill:none;stroke:rgba(0,0,0,.35);stroke-width:.08"/>` : '');
}

/** Low bookshelf. Origin: NW at floor. */
export function shelfLow(w: number, d: number, h: number, variant: number): string {
  const rand = mulberry32(variant + 5);
  let s = rect('sh', 0.3, Y(0.8), w, d * KY, op(0.6));
  s += box(0, 0, w, d, 0, h, 'wh', 'wd');
  s += rect('md', 0.3, Y(d, h) + 0.3, w - 0.6, (h - 0.8) * KZ - 0.3, op(0.85));
  s += spines(0.4, 0.8, h / 2 - 0.3, w - 0.8, d, rand) + rect('wd', 0.3, Y(d, h / 2), w - 0.6, 0.3) + spines(0.4, h / 2 + 0.2, h - 0.6, w - 0.8, d, rand);
  s += rect('hair', 0, Y(0, h), w, 0.01);
  if (rand() < 0.7) {
    const px = 1.5 + rand() * (w - 3);
    s += `<g transform="translate(${n(px)} ${n(Y(d / 2, h))}) scale(.62)">${plantPothos(variant)}</g>`;
  }
  return s;
}

/** Tall bookshelf: four shelves of books when facing south, a plain back when facing north. */
export function shelfTall(w: number, d: number, h: number, variant: number, facing: Facing): string {
  const rand = mulberry32(variant + 17);
  let s = rect('sh', 0.3, Y(0.8), w + 0.4, d * KY + 0.6, op(0.6));
  s += box(0, 0, w, d, 0, h, 'wh', facing === 's' ? 'wd' : 'w');
  if (facing === 's') {
    const rows = 4;
    s += rect('md', 0.4, Y(d, h) + 0.3, w - 0.8, h * KZ - 0.6, op(0.9));
    for (let i = 0; i < rows; i++) {
      const zb = 0.6 + (i * (h - 1)) / rows;
      const zt = zb + (h - 1) / rows - 0.4;
      s += spines(0.4, zb, zt, w - 0.8, d, rand) + rect('wd', 0.3, Y(d, zb) - 0.05, w - 0.6, 0.3);
    }
  }
  s += rect('hair', 0, Y(0, h), w, 0.01);
  return s;
}

export function printer(w: number, d: number, h: number): string {
  let s = rect('sh', 0.4, Y(0.8), w, d * KY, op(0.6));
  s += box(0, 0, w, d, 0, h, 'mh', 'm', 0.4);
  s += rect('md', 1, Y(1.4, h), w - 2, 2.2 * KY) + rect('pa', 1.6, Y(1.6, h + 0.1), w - 3.2, 1.6 * KY, op(0.8));
  s += rect('md', 0.8, Y(d, h) + 1.1, w - 1.6, 0.18) + rect('md', 0.8, Y(d, h) + 2.3, w - 1.6, 0.18) + rect('md', 0.8, Y(d, h) + 3.5, w - 1.6, 0.18);
  s += rrect('sc', w - 3.4, Y(d - 2.2, h), 2.4, 1.1, 0.2) + rect('hair', 0, Y(0, h), w, 0.01);
  return s;
}

export function bin(): string {
  return ell('sh', 0.2, 0.3, 1.8, 1.2, op(0.7)) + rect('m', -1.3, Y(0, 5), 2.6, 5 * KZ) + ell('m', 0, 0, 1.3, 0.9) + ell('mh', 0, Y(0, 5), 1.3, 0.9) + ell('md', 0, Y(0, 5), 1.05, 0.7);
}

export function sofa(w: number, d: number, h: number, facing: Facing): string {
  const seatZ = 4.2;
  const backD = 2.6;
  let s = rect('sh', 0.4, Y(0.8), w, d * KY + 0.6, op(0.7));
  const cushions = (y0: number, dd: number) => {
    let c = '';
    const cw = (w - 4) / 3;
    for (let i = 0; i < 3; i++) c += rrect('fth', 2 + i * cw + 0.15, Y(y0, seatZ + 0.9), cw - 0.3, dd * KY, 0.7) + rect('ft', 2 + i * cw + 0.15, Y(y0 + dd, seatZ + 0.9), cw - 0.3, 0.9 * KZ + 0.2);
    return c;
  };
  if (facing === 's') {
    s += box(0, 0, w, backD, 0, h, 'fth', 'ft', 0.8);
    s += box(0, backD, w, d - backD, 0, seatZ, 'ft', 'ftd', 0.5);
    s += cushions(backD, d - backD - 0.4);
    s += box(0, 0, 2, d, 0, 6, 'fth', 'ftd', 0.7) + box(w - 2, 0, 2, d, 0, 6, 'fth', 'ftd', 0.7);
  } else {
    s += box(0, 0, w, d - backD, 0, seatZ, 'ft', 'ftd', 0.5);
    s += cushions(0.4, d - backD - 0.6);
    s += box(0, 0, 2, d, 0, 6, 'fth', 'ftd', 0.7) + box(w - 2, 0, 2, d, 0, 6, 'fth', 'ftd', 0.7);
    s += box(0, d - backD, w, backD, 0, h, 'fth', 'ftd', 0.8);
  }
  return s;
}

/** A lounge armchair. Origin: centre at floor. */
export function armchair(facing: Facing, variant: number): string {
  const cls = ['ft', 'fb', 'le', 'ft', 'le'][variant % 5]!;
  const hi = cls === 'le' ? 'leh' : cls === 'fb' ? 'fbh' : 'fth';
  const lo = cls === 'le' ? 'le' : cls === 'fb' ? 'fbd' : 'ftd';
  const W = 7.2;
  const D = 7;
  const x = -W / 2;
  const y = -D / 2;
  let s = ell('sh', 0.3, 0.6, 4.6, 3.2, op(0.7));
  const back = (by: number) => box(x, by, W, 2, 0, 8, hi, lo, 0.8);
  if (facing === 's') s += back(y);
  s += box(x, y + (facing === 's' ? 1.6 : 0), W, D - 1.6, 0, 4, cls, lo, 0.6) + rrect(hi, x + 1.4, Y(y + (facing === 's' ? 2.2 : 0.6), 4.6), W - 2.8, (D - 3.2) * KY, 0.8, op(0.8));
  s += box(x, y, 1.4, D, 0, 6, hi, lo, 0.6) + box(x + W - 1.4, y, 1.4, D, 0, 6, hi, lo, 0.6);
  if (facing === 'n') s += back(y + D - 2);
  return s;
}

export function coffeeTable(w: number, d: number): string {
  const z = 3.8;
  let s = rect('sh', 0.3, Y(0.5), w, d * KY, op(0.6));
  s += rect('md', 0.6, Y(d, z), 0.4, z * KZ) + rect('md', w - 1, Y(d, z), 0.4, z * KZ);
  s += box(0, 0, w, d, z - 0.5, z, 'w', 'wd', 0.6) + rect('wh', 0.4, Y(0, z), w - 0.8, 0.16);
  s += `<g transform="rotate(-5 ${n(w * 0.3)} ${n(Y(d / 2, z))})">${rect('n2', w * 0.3 - 1.6, Y(d / 2 - 1.1, z + 0.1), 3.2, 2.2 * KY)}${rect('pa', w * 0.3 - 1.4, Y(d / 2 - 1.3, z + 0.2), 3.2, 2.2 * KY, op(0.7))}</g>`;
  s += ell('poh', w * 0.72, Y(d / 2, z + 0.7), 0.9, 0.55) + rect('poh', w * 0.72 - 0.9, Y(d / 2, z + 0.7), 1.8, 0.4) + ell('p', w * 0.72, Y(d / 2, z + 1.4), 0.7, 0.5);
  return s;
}

export function sideTable(): string {
  const z = 5.2;
  return ell('sh', 0.2, 0.3, 1.9, 1.3, op(0.6)) + rect('md', -0.2, Y(0, z), 0.4, z * KZ) + ell('md', 0, 0, 1.2, 0.6) + ell('wd', 0, Y(0, z) + 0.3, 1.8, 1.25) + ell('w', 0, Y(0, z), 1.8, 1.25) + ell('poh', 0.4, Y(0, z + 0.6), 0.45, 0.32) + rect('poh', -0.05, Y(0, z + 0.6), 0.9, 0.4);
}

/** Floor lamp (off; the office has four light sources only). */
export function floorLamp(): string {
  const z = 15;
  let s = ell('sh', 0, 0.2, 1.6, 1, op(0.6)) + ell('md', 0, 0, 1.2, 0.7) + rect('m', -0.13, Y(0, z), 0.26, z * KZ);
  s += path('m', `M${n(-1.6)} ${n(Y(0, z - 1.4))}L${n(-1.1)} ${n(Y(0, z + 1.2))}L${n(1.1)} ${n(Y(0, z + 1.2))}L${n(1.6)} ${n(Y(0, z - 1.4))}Z`) + ell('mh', 0, Y(0, z + 1.2), 1.1, 0.5, op(0.5));
  return s;
}

/** A pendant light's shade from above; its ambient pool is drawn by the light layer. Origin: plan point at floor. */
export function pendant(): string {
  const z = 23;
  const cy = Y(0, z);
  return `<path class="cord" d="M0 ${n(cy - 1.2)}V${n(Y(0, 34))}"/>` + ell('md', 0, cy + 0.3, 2.4, 1.3) + ell('m', 0, cy, 2.3, 1.2) + ell('mh', -0.5, cy - 0.3, 1.1, 0.45, op(0.5));
}

/** The lounge's feature wall: two framed artworks and the wall clock (hands move once a minute). Origin: NW at floor. */
export function featureWall(w: number, d: number, h: number): string {
  let s = box(0, 0, w, d, 0, h, 'wt', 'wf');
  s += rect('hair', 0, Y(0, h), w, 0.01) + rect('sh', 0, Y(d), w, 1.4, op(0.5));
  const face = Y(d, h);
  const art = (x: number, fw: number, fh: number, z: number, i: number) =>
    rect('md', x - 0.3, Y(d, z + fh) - 0.3, fw + 0.6, fh * KZ + 0.6) + `<g class="hc-o-art" data-art="${i}">${artVector(x, Y(d, z + fh), fw, fh * KZ, i)}</g>`;
  s += art(6, 22, 11, 7, 0) + art(w - 30, 16, 11, 7, 1);
  const cx = w / 2 + 6;
  const cy = face + (h - 12.5) * KZ;
  s += `<g class="hc-o-clock" transform="translate(${n(cx)} ${n(cy)})">${ell('md', 0, 0, 3.1, 3.1)}${ell('bd', 0, 0, 2.75, 2.75)}`;
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    s += line('ink', Math.sin(a) * 2.2, -Math.cos(a) * 2.2, Math.sin(a) * 2.5, -Math.cos(a) * 2.5);
  }
  s += `<path class="hc-o-clock-h" d="M0 0V-1.5" style="stroke:var(--o-metal-lo);stroke-width:.32;stroke-linecap:round"/><path class="hc-o-clock-m" d="M0 0V-2.3" style="stroke:var(--o-metal-lo);stroke-width:.2;stroke-linecap:round"/>${ell('md', 0, 0, 0.25, 0.25)}</g>`;
  return s;
}

/** An abstract composition from the brand spectrum at low saturation (no text, no figures). */
export function artVector(x: number, y: number, w: number, h: number, i: number): string {
  const rand = mulberry32(i * 911 + 5);
  const palettes = [
    ['#3a2f2a', '#b0785a', '#6a7f8f', '#d8c7a8'],
    ['#2a2e36', '#7b6aa8', '#c98f6b', '#9fb5a5'],
    ['#2f2a2e', '#5e8a86', '#c7a05e', '#b27373'],
  ];
  const p = palettes[i % palettes.length]!;
  let s = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${p[0]}"/>`;
  s += `<circle cx="${n(x + w * (0.3 + rand() * 0.3))}" cy="${n(y + h * 0.45)}" r="${n(h * 0.3)}" fill="${p[1]}" opacity=".85"/>`;
  s += `<rect x="${n(x + w * 0.55)}" y="${n(y + h * 0.2)}" width="${n(w * 0.3)}" height="${n(h * 0.62)}" fill="${p[2]}" opacity=".7"/>`;
  s += `<path d="M${n(x)} ${n(y + h * 0.8)}Q${n(x + w * 0.5)} ${n(y + h * 0.55)} ${n(x + w)} ${n(y + h * 0.85)}V${n(y + h)}H${n(x)}Z" fill="${p[3]}" opacity=".55"/>`;
  return s;
}

/** The café back-bar: counter with espresso machine, grinder, sink and cups; open shelves above; toe-kick light. */
export function coffeeCounter(w: number, d: number, h: number): string {
  let s = rect('sh', 0, Y(d), w, 1.6, op(0.5));
  // Back panel with two open shelves (its south face shows).
  const ph = 20;
  s += box(0, 0, w, 0.8, 0, ph, 'wt', 'wd');
  for (const z of [13.5, 17.5]) {
    s += rect('wh', 1, Y(0.8, z), w - 2, 0.3) + rect('wd', 1, Y(0.8, z) + 0.3, w - 2, 0.25);
    for (let x = 2.5; x < w - 2; x += 1.8 + ((x * 7) % 3) * 0.3) s += rect(x % 5 < 2.5 ? 'poh' : 'pa', x, Y(0.8, z + 1.6), 1.1, 1.6 * KZ, op(0.8));
  }
  s += box(0, 0.8, w, d - 0.8, 0, h, 'st', 'w');
  s += rect('sth', 0, Y(0.8, h), w, 0.2);
  for (let x = 6; x < w; x += 8) s += rect('wd', x, Y(d, h) + 0.6, 0.12, h * KZ - 1.4);
  s += rect('md', 0.4, Y(d, 0.7), w - 0.8, 0.7 * KZ);
  // Espresso machine.
  const ex = 8;
  s += box(ex, 1.6, 7, 4.2, h, h + 4.8, 'cr', 'mh', 0.3) + rect('md', ex + 0.8, Y(5.8, h + 2.6), 5.4, 0.35);
  s += rect('md', ex + 1.8, Y(5.8, h + 2.2), 0.3, 1) + rect('md', ex + 4.6, Y(5.8, h + 2.2), 0.3, 1);
  s += rect('poh', ex + 1.4, Y(6.2, h + 1), 1, 1 * KZ + 0.2) + rect('poh', ex + 4.3, Y(6.2, h + 1), 1, 1 * KZ + 0.2);
  // Grinder.
  s += rect('md', 18, Y(4.5, h + 3), 2, 3 * KZ) + path('gh', `M17.6 ${n(Y(4.5, h + 5.2))}L20.4 ${n(Y(4.5, h + 5.2))}L19.6 ${n(Y(4.5, h + 3))}L18.4 ${n(Y(4.5, h + 3))}Z`) + ell('so', 19, Y(4.5, h + 5.2), 1.4, 0.5, op(0.8));
  // Sink and tap.
  s += rrect('md', 30, Y(2.4, h), 8, 4 * KY, 0.8) + rrect('m', 30.6, Y(2.8, h), 6.8, 3.2 * KY, 0.6) + `<path class="leg" d="M34 ${n(Y(1.6, h))}V${n(Y(1.6, h + 3.2))}Q34 ${n(Y(2.6, h + 4))} 34.8 ${n(Y(2.8, h + 3.6))}"/>`;
  // Cups, jars, a fruit bowl.
  for (let i = 0; i < 4; i++) s += rect('poh', 42 + i * 1.5, Y(3, h + 1.2), 1.1, 1.2 * KZ) + ell('poh', 42.55 + i * 1.5, Y(3, h + 1.2), 0.55, 0.3);
  s += ell('w', 52, Y(4, h + 0.9), 2.4, 1.2) + ell('n1', 51.2, Y(3.8, h + 1.5), 0.8, 0.6) + ell('n3', 52.8, Y(4, h + 1.4), 0.75, 0.6) + ell('p', 52, Y(3.6, h + 1.9), 0.7, 0.5);
  s += rect('hair', 0, Y(0.8, h), w, 0.01);
  return s;
}

export function fridge(w: number, d: number, h: number): string {
  return rect('sh', 0.3, Y(d), w, 1.4, op(0.5)) + box(0, 0, w, d, 0, h, 'mh', 'cr') + rect('m', 0, Y(d, h) + (h - 12) * KZ, w, 0.14) + rect('md', w - 1.6, Y(d, h) + 1.2, 0.35, 4) + rect('md', w - 1.6, Y(d, h) + (h - 10) * KZ, 0.35, 2.6) + rect('hair', 0, Y(0, h), w, 0.01);
}

export function tallCabinet(w: number, d: number, h: number): string {
  return rect('sh', 0.3, Y(d), w, 1.4, op(0.5)) + box(0, 0, w, d, 0, h, 'wh', 'w') + rect('wd', w / 2 - 0.06, Y(d, h) + 0.4, 0.12, h * KZ - 0.8) + rect('md', w / 2 - 0.9, Y(d, h) + h * KZ * 0.45, 0.25, 1.6) + rect('md', w / 2 + 0.65, Y(d, h) + h * KZ * 0.45, 0.25, 1.6) + rect('hair', 0, Y(0, h), w, 0.01);
}

export function island(w: number, d: number, h: number): string {
  let s = rect('sh', 0.4, Y(0.8), w, d * KY + 0.8, op(0.6));
  s += box(0, 0, w, d, 0, h, 'st', 'w', 0.3) + rect('sth', 0, Y(0, h), w, 0.2);
  for (let x = 4; x < w; x += 4) s += rect('wd', x, Y(d, h) + 0.5, 0.1, h * KZ - 1.1);
  s += rect('md', 0.4, Y(d, 0.7), w - 0.8, 0.7 * KZ);
  // Pastry dome and a vase.
  s += ell('mh', w * 0.3, Y(d / 2, h + 0.2), 2.4, 1.3) + path('gh', `M${n(w * 0.3 - 2.1)} ${n(Y(d / 2, h + 0.3))}A2.1 2.6 0 0 1 ${n(w * 0.3 + 2.1)} ${n(Y(d / 2, h + 0.3))}Z`) + ell('n1', w * 0.3, Y(d / 2, h + 0.9), 1.2, 0.5, op(0.8));
  s += rect('gh', w * 0.7 - 0.5, Y(d / 2, h + 3), 1, 3 * KZ) + ell('p', w * 0.7 - 0.5, Y(d / 2, h + 3.6), 0.8, 0.6) + ell('n3', w * 0.7 + 0.4, Y(d / 2, h + 4), 0.6, 0.5) + ell('n2', w * 0.7 - 0.9, Y(d / 2, h + 4.4), 0.5, 0.45);
  return s;
}

export function stool(): string {
  const z = 7.6;
  return ell('sh', 0.2, 0.3, 2, 1.3, op(0.6)) + `<path class="leg" d="M-1.1 0L-0.4 ${n(Y(0, z))}M1.1 0L0.4 ${n(Y(0, z))}M0 0.6L0 ${n(Y(0, z))}"/>` + ell('md', 0, Y(0, 2.6), 1.2, 0.5, ' style="fill:none;stroke:var(--o-metal-lo);stroke-width:.25"') + ell('ftd', 0, Y(0, z) + 0.4, 1.7, 1.15) + ell('ft', 0, Y(0, z), 1.7, 1.15) + ell('fth', -0.3, Y(0, z) - 0.15, 0.9, 0.5, op(0.5));
}

export function waterCooler(): string {
  let s = ell('sh', 0.3, 0.4, 2.4, 1.6, op(0.7));
  s += box(-1.6, -1.4, 3.2, 2.8, 0, 9, 'pa', 'bdl', 0.3);
  s += rect('md', -0.8, Y(1.4, 7.5), 1.6, 0.9) + rect('n2', -0.5, Y(1.4, 7.2), 0.3, 0.4) + rect('n3', 0.2, Y(1.4, 7.2), 0.3, 0.4);
  s += `<path d="M-1.3 ${n(Y(0, 9))}L-1.3 ${n(Y(0, 14.5))}Q0 ${n(Y(0, 16.5))} 1.3 ${n(Y(0, 14.5))}L1.3 ${n(Y(0, 9))}Z" style="fill:#7fb2e6;fill-opacity:.38"/>`;
  s += `<path d="M-0.8 ${n(Y(0, 9.4))}L-0.8 ${n(Y(0, 14))}" style="stroke:#cfe6ff;stroke-opacity:.35;stroke-width:.3"/>`;
  s += rect('md', 1.7, Y(0, 9.8), 0.7, 3 * KZ);
  return s;
}

export function highTable(): string {
  const z = 10.5;
  return ell('sh', 0.2, 0.3, 2.6, 1.7, op(0.6)) + ell('md', 0, 0, 1.6, 0.9) + rect('md', -0.22, Y(0, z), 0.44, z * KZ) + ell('wd', 0, Y(0, z) + 0.35, 3.2, 2.2) + ell('w', 0, Y(0, z), 3.2, 2.2) + ell('wh', -0.8, Y(-0.6, z), 1.4, 0.7, op(0.35)) + ell('poh', 0.6, Y(0, z + 0.8), 0.5, 0.3) + rect('poh', 0.1, Y(0, z + 0.8), 1, 0.45);
}

/** Conference table: a long rounded walnut top on two pedestals, speakerphone puck in the centre. */
export function confTable(w: number, d: number, h: number): string {
  let s = rrect('sh', 0.6, Y(1), w, d * KY + 1, 2, op(0.7));
  s += rect('md', w * 0.22, Y(d * 0.5, h - 0.6), 2.4, (h - 0.6) * KZ) + rect('md', w * 0.78 - 2.4, Y(d * 0.5, h - 0.6), 2.4, (h - 0.6) * KZ);
  s += rrect('wd', 0, Y(0, h) + 0.45, w, d * KY, 3) + rrect('w', 0, Y(0, h), w, d * KY, 3) + rrect('wh', 1.2, Y(0, h), w - 2.4, 0.2, 0.1);
  s += rrect('wh', 2, Y(1.4, h), w - 4, (d - 2.8) * KY, 2.2, op(0.18));
  s += ell('md', w / 2, Y(d / 2, h + 0.3), 1.5, 0.9) + ell('m', w / 2, Y(d / 2, h + 0.5), 1.3, 0.75) + ell('sc', w / 2, Y(d / 2, h + 0.55), 0.5, 0.3);
  return s;
}

/** A glass partition: along x its south face shows; along y it is seen edge-on as a thin strip. Origin: NW at floor. */
export function glass(w: number, d: number, h: number): string {
  if (w >= d) {
    let s = rect('gl', 0, Y(d, h), w, h * KZ) + rect('ge', 0, Y(d, h), w, 0.2) + rect('mu', 0, Y(d) - 0.45, w, 0.45);
    let posts = '';
    for (let x = 0; x <= w + 0.01; x += Math.max(12, w / Math.max(1, Math.round(w / 24)))) posts += `M${n(Math.min(x, w - 0.1))} ${n(Y(d, h))}V${n(Y(d))}`;
    s += `<path d="${posts}" style="stroke:var(--o-glass-edge);stroke-width:.18;opacity:.7"/>`;
    s += path('gh', `M${n(w * 0.15)} ${n(Y(d))}L${n(w * 0.15 + 4)} ${n(Y(d, h))}L${n(w * 0.15 + 6)} ${n(Y(d, h))}L${n(w * 0.15 + 2)} ${n(Y(d))}Z`, op(0.6));
    return s;
  }
  return rect('gl', 0, Y(0, h), w, d * KY + h * KZ) + rect('ge', 0, Y(0, h), Math.max(0.25, w * 0.3), d * KY) + rect('mu', 0, Y(0) - 0.2, w, d * KY + 0.2, op(0.7));
}

/** A structural column, cut at the section height. Origin: centre at floor. */
export function column(): string {
  const s = 3.4;
  const h = 30;
  return rect('sh', -s / 2 + 0.4, Y(s / 2) - 0.2, s + 0.4, 1.6, op(0.6)) + box(-s / 2, -s / 2, s, s, 0, h, 'wt', 'wl') + rect('slh', -s / 2, Y(-s / 2, h), s, 0.14);
}

/** A phone booth: a felt shell with a glass front, so the stool, the little desk and the lamp show inside. Origin: NW at floor. */
export function phoneBooth(w: number, d: number, h: number, variant: number): string {
  let s = rect('sh', 0.4, Y(d) - 0.2, w, 1.6, op(0.6));
  // Roof (felt, seen from above) and the dark interior behind the glass.
  s += rect('ftd', 0, Y(0, h), w, d * KY) + rect('fth', 0, Y(0, h), w, 0.25);
  s += rect('md', 0, Y(d, h), w, h * KZ) + rect('ftd', 0.9, Y(d, h) + 0.9, w - 1.8, h * KZ - 1.3);
  const tint = ['ft', 'fth', 'ft', 'fth'][variant % 4]!;
  s += rect(tint, 0.9, Y(d, h) + 0.9, w - 1.8, 2.2, op(0.7));
  // Inside: a shelf desk, the stool and a small lamp.
  s += rrect('w', w / 2 - 3, Y(d - 2.6, 7.4), 6, 1.6 * KY, 0.3) + rect('wd', w / 2 - 3, Y(d - 2.6, 7.4) + 1.6 * KY - 0.1, 6, 0.35);
  s += ell('ft', w / 2 + 2.4, Y(d - 1.2, 4.6), 1.3, 0.8) + rect('md', w / 2 + 2.25, Y(d - 1.2, 4.6), 0.3, 4.6 * KZ - 0.5);
  s += rect('md', w / 2 - 2.2, Y(d - 2.4, 10.6), 0.22, 3.2 * KZ) + path('mh', `M${n(w / 2 - 3)} ${n(Y(d - 2.4, 10.6))}h1.8l-.35 1h-1.1Z`);
  // The glass front: faint tint, a lit edge and one reflection streak; aluminium frame and a door handle.
  s += rect('gl', 0.6, Y(d, h - 0.6), w - 1.2, (h - 1.2) * KZ, ' style="fill:rgba(180,205,255,.10)"') + rect('ge', 0.6, Y(d, h - 0.6), w - 1.2, 0.16);
  s += path('gh', `M${n(w * 0.62)} ${n(Y(d, 0.8))}L${n(w * 0.62 + 2.4)} ${n(Y(d, h - 0.8))}L${n(w * 0.62 + 3.4)} ${n(Y(d, h - 0.8))}L${n(w * 0.62 + 1)} ${n(Y(d, 0.8))}Z`, op(0.5));
  s += rect('mh', 0, Y(d, h), 0.6, h * KZ) + rect('mh', w - 0.6, Y(d, h), 0.6, h * KZ) + rect('mh', w - 2.2, Y(d, 11), 0.25, 2.2, op(0.9));
  return s;
}

export function execDesk(w: number, d: number, h: number): string {
  let s = rect('sh', 0.5, Y(1), w, d * KY + 1, op(0.6));
  s += box(0, 0, w, d, 0, h, 'w', 'wd', 0.4) + rect('wh', 0, Y(0, h), w, 0.22);
  s += box(w - 8, -8, 8, 8, 0, h, 'w', 'wd', 0.3);
  for (let x = 2; x < w - 1; x += 2) s += rect('w', x, Y(d, h) + 0.7, 0.12, h * KZ - 1.2, op(0.6));
  s += rrect('md', w / 2 - 4, Y(d * 0.62, 13.2), 8, 4.6 * KZ, 0.4) + rect('mh', w / 2 - 3.8, Y(d * 0.62, 13.2), 7.6, 0.14, op(0.6)) + rect('md', w / 2 - 0.3, Y(d * 0.62, 10.6), 0.6, (10.6 - h) * KZ) + ell('md', w / 2, Y(d * 0.5, h), 1.6, 0.6);
  s += rrect('mh', 4, Y(2, h + 0.2), 5, 3.2 * KY, 0.3, op(0.8)) + rrect('md', 4.3, Y(2.2, h + 0.3), 4.4, 2.6 * KY, 0.2);
  s += `<g transform="rotate(-8 ${n(w - 5)} ${n(Y(-4, h))})">${rect('n3', w - 6.6, Y(-5, h + 0.1), 3, 2.2 * KY)}</g>`;
  return s;
}

export function credenza(w: number, d: number, h: number): string {
  let s = rect('sh', 0.3, Y(d), w, 1.3, op(0.5));
  s += box(0, 0, w, d, 0, h, 'wh', 'w');
  if (w > d) {
    for (let x = w / 4; x < w - 1; x += w / 4) s += rect('wd', x, Y(d, h) + 0.4, 0.12, h * KZ - 0.8);
    s += rect('pa', 3, Y(1, h + 1.2), 4, 1.2 * KZ, op(0.7)) + rect('n4', 3.2, Y(1, h + 2.2), 3.6, 1 * KZ, op(0.8));
    s += `<g transform="translate(${n(w - 6)} ${n(Y(d / 2, h))}) scale(.7)">${plantSnake(Math.round(w))}</g>`;
    s += ell('mh', w / 2, Y(d / 2, h + 3), 1.1, 1.6, op(0.7));
  }
  return s + rect('hair', 0, Y(0, h), w, 0.01);
}

/** The Garden room's moss-and-fern wall, facing south. Origin: NW at floor. */
export function plantWall(w: number, d: number, h: number, seed: number): string {
  const rand = mulberry32(seed);
  let s = box(0, 0, w, d, 0, h, 'wt', 'pd');
  const face = Y(d, h);
  const fh = h * KZ;
  const leaves = Math.round(w * 1.3);
  for (let i = 0; i < leaves; i++) {
    const x = rand() * w;
    const y = face + 0.5 + rand() * (fh - 1.2);
    const c = rand();
    s += ell(c < 0.35 ? 'p' : c < 0.7 ? 'pd' : c < 0.93 ? 'ph' : 'py', x, y, 0.65 + rand() * 1.1, 0.45 + rand() * 0.6, ` transform="rotate(${Math.round(rand() * 180)} ${n(x)} ${n(y)})"`);
  }
  s += rect('md', 0, face - 0.2, w, 0.4) + rect('md', 0, Y(d) - 0.4, w, 0.4);
  return s;
}

export function receptionDesk(w: number, d: number, h: number): string {
  let s = rect('sh', 0.6, Y(d) - 0.2, w, 2, op(0.6));
  s += box(0, 0, w, d, 0, h, 'st', 'w', 0.6) + rect('sth', 0, Y(0, h), w, 0.25);
  for (let x = 1.6; x < w - 1; x += 1.6) s += rect('wd', x, Y(d, h) + 0.6, 0.18, h * KZ - 1);
  s += rect('md', 0.4, Y(d, 0.6), w - 0.8, 0.6 * KZ);
  s += rrect('md', w / 2 - 4, Y(1.4, h + 5), 8, 4.2 * KZ, 0.3) + rect('md', w / 2 - 0.25, Y(1.4, h + 1), 0.5, 1) + ell('p', w - 6, Y(d / 2, h + 2), 2, 1.3) + ell('ph', w - 6.4, Y(d / 2, h + 2.8), 1.2, 0.8);
  return s;
}

export function bench(w: number, d: number, h: number): string {
  return rect('sh', 0.3, Y(d) - 0.2, w, 1.2, op(0.5)) + rect('md', 1.5, Y(d, h), 0.4, h * KZ) + rect('md', w - 1.9, Y(d, h), 0.4, h * KZ) + box(0, 0, w, d, h - 1, h, 'w', 'wd', 0.3) + rect('wh', 0, Y(0, h), w, 0.14);
}

/** The door plate stand (the motif). Its words are HTML. Origin: base centre. */
export function doorPlate(): string {
  return ell('sh', 0, 0.3, 2.4, 0.9, op(0.6)) + rect('md', -1.8, -0.3, 3.6, 0.5) + rect('m', -0.15, Y(0, 9), 0.3, 9 * KZ) + rrect('mh', -3.3, Y(0, 12.2), 6.6, 3.3 * KZ, 0.3) + rrect('md', -3, Y(0, 12) , 6, 2.9 * KZ, 0.25);
}

/** A slim screen on a stand, seen edge-on (facing east or west). Origin: centre at floor. */
export function display(): string {
  return ell('sh', 0, 0.3, 1.8, 1.3, op(0.6)) + ell('md', 0, 0, 1.4, 0.9) + rect('m', -0.2, Y(0, 9), 0.4, 9 * KZ) + rect('md', -0.5, Y(-4.5, 17), 1, 9 * KY + 8 * KZ) + rect('mh', -0.5, Y(-4.5, 17), 0.3, 9 * KY + 8 * KZ, op(0.6));
}

// ── structure ────────────────────────────────────────────────────────────────────────────────────────────────

export const WINDOW_Z = 40;

/** The north façade: floor-to-ceiling glass with a transom, a sill and mullions every 12 u; the city shows through. Origin: plate NW. */
export function windowBand(w: number): string {
  const top = Y(0, WINDOW_Z);
  const hgt = WINDOW_Z * KZ;
  // A faint cool tint, stronger at the head of the glass, so the band reads as a pane and not an opening.
  let s =
    `<defs><linearGradient id="hc-o-wintint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(160,190,240)" stop-opacity=".07"/><stop offset="1" stop-color="rgb(160,190,240)" stop-opacity=".02"/></linearGradient></defs>` +
    `<rect x="0" y="${n(top)}" width="${n(w)}" height="${n(hgt)}" fill="url(#hc-o-wintint)"/>`;
  // Mullions: 0.8 u wide every 12 u, each with a 0.2 u highlight on its west edge (two paths, not 150 rects).
  let mull = '';
  let edge = '';
  for (let x = 0; x <= w + 0.01; x += 12) {
    const x0 = Math.min(Math.max(0, x - 0.4), w - 0.8);
    mull += `M${n(x0)} ${n(top)}h.8V0h-.8Z`;
    edge += `M${n(x0)} ${n(top)}h.2V0h-.2Z`;
  }
  s += path('mu', mull) + path('ge', edge, op(0.55));
  // Transom at the head (2.5 u), a hairline where it meets the glass, and a 1.2 u sill at the floor.
  s += rect('wt', 0, top - 2.5, w, 2.5) + rect('ge', 0, top - 2.5, w, 0.18, op(0.7)) + rect('mu', 0, top, w, 0.35);
  s += rect('mu', 0, -1.2, w, 1.2) + rect('ge', 0, -1.2, w, 0.14, op(0.6));
  // A few faint reflections.
  for (const fx of [0.12, 0.37, 0.61, 0.86]) {
    const x = w * fx;
    s += path('gh', `M${n(x)} -1.2L${n(x + 9)} ${n(top)}L${n(x + 12)} ${n(top)}L${n(x + 3)} -1.2Z`, op(0.22));
  }
  return s;
}

/** East and west façades: a 3 u glazing strip with 1 u mullion ticks every 12 u and a highlight on the inner edge. */
export function sideGlazing(w: number, h: number): string {
  let s = '';
  const top = Y(0, WINDOW_Z) - 2.5;
  const len = h * KY - top;
  for (const side of [-1, 1] as const) {
    const x = side < 0 ? -3 : w;
    const inner = side < 0 ? -0.2 : w;
    s += rect('mu', x, top, 3, len) + rect('gl', x, top, 3, len, ' style="fill:rgba(160,190,240,.10)"');
    let ticks = '';
    for (let y = 12; y < h; y += 12) ticks += `M${n(x)} ${n(Y(y) - 0.5)}h3v1h-3Z`;
    s += path('wt', ticks) + rect('ge', inner, top, 0.2, len) + rect('ge', side < 0 ? x : x + 2.85, top, 0.15, len, op(0.35));
  }
  return s;
}

/** The south edge in section: the slab with a hairline highlight and a soft fall-off below. */
export function slab(w: number, h: number): string {
  const y = h * KY;
  return `<rect x="-1.2" y="${n(y)}" width="${n(w + 2.4)}" height="18" fill="url(#hc-o-slabfade)"/>` + rect('sl', -1.2, y, w + 2.4, 4.2) + rect('slh', -1.2, y, w + 2.4, 0.3);
}

/** Seeded per-person/seat helper, shared with the plate. */
export const seedOf = (id: string): number => Math.floor(rngFor(id)() * 1e6);
