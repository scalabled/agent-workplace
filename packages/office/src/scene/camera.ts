// Camera maths (OFFICE-PLAN §4.1), pure and DOM-free: fit, bounds with rubber-banding, zoom around a point, inertia
// and flights. The camera is {x, y} in projected plate u at the viewport centre and `zoom` in screen px per u.
import { fromScreen } from '../projection';
import type { Camera, Point, Rect } from '../types';

export interface Viewport {
  w: number;
  h: number;
}

/** Zoom limits: from "fit" (the whole plate) to 9 px/u. */
export const MAX_ZOOM = 9;
/** Share of the plate that must stay in view on each axis. */
export const MIN_VISIBLE = 0.3;
/** Rubber-band resistance beyond the bounds. */
export const RUBBER = 0.35;
/** Inertia decay (ms) and stop speed (px/ms). */
export const INERTIA_TAU = 325;
export const INERTIA_STOP = 0.01;

/** The zoom at which the whole plate fits (6 % margin), leaving the upper part of the view for the skyline. */
export function minZoomFor(box: Rect, vp: Viewport): number {
  const byW = (vp.w * 0.94) / box.w;
  const byH = (vp.h * 0.62) / box.h;
  return Math.max(0.05, Math.min(byW, byH));
}

/**
 * The "fit" camera, the hero shot: the plate across the lower part of the view with the city above it. On narrow
 * screens the plate would be a thin strip, so fit keeps at least a legible zoom and centres the floor instead.
 */
export function fitCamera(box: Rect, vp: Viewport): Camera {
  const min = minZoomFor(box, vp);
  const byH = (vp.h * 0.5) / box.h;
  const zoom = Math.max(min, Math.min(byH, 1.4));
  const x = box.x + box.w / 2;
  const plateH = box.h * zoom;
  // Plate bottom 3.5 % above the viewport bottom, or centred low when it is short.
  const bottom = plateH < vp.h * 0.62 ? vp.h * 0.965 : vp.h / 2 + plateH / 2;
  const y = box.y + box.h - (bottom - vp.h / 2) / zoom;
  return { x, y, zoom };
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Allowed camera centres so that at least 30 % of the plate stays in view (plus sky headroom above). */
export function cameraBounds(box: Rect, vp: Viewport, zoom: number): Bounds {
  const hw = vp.w / 2 / zoom;
  const hh = vp.h / 2 / zoom;
  const axis = (lo: number, size: number, half: number, headroom = 0) => {
    const vis = MIN_VISIBLE * Math.min(size, half * 2);
    const a = lo + vis - half - headroom;
    const b = lo + size - vis + half;
    return a <= b ? [a, b] : [(a + b) / 2, (a + b) / 2];
  };
  const [minX, maxX] = axis(box.x, box.w, hw);
  // Headroom: the camera may rise until the plate's north edge sits at 70 % of the view (to look at the city).
  const [minY, maxY] = axis(box.y, box.h, hh, hh * 0.25);
  return { minX: minX!, maxX: maxX!, minY: minY!, maxY: maxY! };
}

export function clampZoom(zoom: number, minZoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(minZoom, zoom));
}

/** Hard clamp into the bounds. */
export function clampCamera(cam: Camera, box: Rect, vp: Viewport): Camera {
  const b = cameraBounds(box, vp, cam.zoom);
  return { x: Math.min(b.maxX, Math.max(b.minX, cam.x)), y: Math.min(b.maxY, Math.max(b.minY, cam.y)), zoom: cam.zoom };
}

/** Rubber-band a raw (dragged) position: movement beyond the bounds is resisted. */
export function rubberBand(cam: Camera, box: Rect, vp: Viewport): Camera {
  const b = cameraBounds(box, vp, cam.zoom);
  const band = (v: number, lo: number, hi: number) => (v < lo ? lo - (lo - v) * RUBBER : v > hi ? hi + (v - hi) * RUBBER : v);
  return { x: band(cam.x, b.minX, b.maxX), y: band(cam.y, b.minY, b.maxY), zoom: cam.zoom };
}

/** Is the camera outside its bounds (needs a spring back)? */
export function outOfBounds(cam: Camera, box: Rect, vp: Viewport): boolean {
  const c = clampCamera(cam, box, vp);
  return Math.abs(c.x - cam.x) > 1e-3 || Math.abs(c.y - cam.y) > 1e-3;
}

/** Zoom to `zoom` keeping the plate point under `at` (screen px) fixed. */
export function zoomAround(cam: Camera, zoom: number, at: Point, vp: Viewport): Camera {
  const p = fromScreen(at, cam, vp.w, vp.h);
  return { x: p.x - (at.x - vp.w / 2) / zoom, y: p.y - (at.y - vp.h / 2) / zoom, zoom };
}

/** Pan by a screen delta (px). */
export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return { x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom, zoom: cam.zoom };
}

/** Velocity (px/ms) from the pointer samples of the last 100 ms. */
export function velocityOf(samples: readonly { x: number; y: number; t: number }[], now: number): Point {
  const recent = samples.filter((s) => now - s.t <= 100);
  if (recent.length < 2) return { x: 0, y: 0 };
  const a = recent[0]!;
  const b = recent[recent.length - 1]!;
  const dt = Math.max(1, b.t - a.t);
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
}

/** Screen distance travelled by inertia after `t` ms from velocity v (px/ms): v·τ·(1 − e^(−t/τ)). */
export function inertiaOffset(v: Point, t: number): Point {
  const k = INERTIA_TAU * (1 - Math.exp(-t / INERTIA_TAU));
  return { x: v.x * k, y: v.y * k };
}

/** How long inertia runs before the speed drops below the stop threshold. */
export function inertiaDuration(v: Point): number {
  const s = Math.hypot(v.x, v.y);
  if (s <= INERTIA_STOP) return 0;
  return INERTIA_TAU * Math.log(s / INERTIA_STOP);
}

export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Interpolate two cameras (zoom in log space, so flights feel even). */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  const za = Math.log(a.zoom);
  const zb = Math.log(b.zoom);
  const zoom = Math.exp(za + (zb - za) * t);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, zoom };
}

/**
 * A flight from `a` to `b` at eased progress `e` (0–1). Zoom moves in log space, and the destination point (b's
 * centre) travels a straight line on screen from where it starts to the view centre; the pan is solved from the
 * eased zoom so the target never lurches as the zoom accelerates.
 */
export function flightCamera(a: Camera, b: Camera, e: number): Camera {
  if (e <= 0) return { ...a };
  if (e >= 1) return { ...b };
  const za = Math.log(a.zoom);
  const zb = Math.log(b.zoom);
  const zoom = Math.exp(za + (zb - za) * e);
  // The target's screen offset from the view centre: (b − a)·a.zoom at the start, 0 at the end.
  const sx = (b.x - a.x) * a.zoom * (1 - e);
  const sy = (b.y - a.y) * a.zoom * (1 - e);
  return { x: b.x - sx / zoom, y: b.y - sy / zoom, zoom };
}

/** A camera that frames a projected rect with a margin (for rooms, neighbourhoods and seats). */
export function frameRect(r: Rect, vp: Viewport, opts: { margin?: number; maxZoom?: number; minZoom?: number } = {}): Camera {
  const m = opts.margin ?? 0.12;
  const zoom = Math.min(opts.maxZoom ?? MAX_ZOOM, Math.max(opts.minZoom ?? 0.05, Math.min((vp.w * (1 - 2 * m)) / r.w, (vp.h * (1 - 2 * m)) / r.h)));
  return { x: r.x + r.w / 2, y: r.y + r.h / 2, zoom };
}

/** The smallest pan that keeps a projected point inside a 15 % inset of the view. */
export function followPoint(cam: Camera, p: Point, vp: Viewport, inset = 0.15): Camera {
  const hw = vp.w / 2 / cam.zoom;
  const hh = vp.h / 2 / cam.zoom;
  const ix = hw * (1 - 2 * inset);
  const iy = hh * (1 - 2 * inset);
  let { x, y } = cam;
  if (p.x < x - ix) x = p.x + ix;
  else if (p.x > x + ix) x = p.x - ix;
  if (p.y < y - iy) y = p.y + iy;
  else if (p.y > y + iy) y = p.y - iy;
  return { x, y, zoom: cam.zoom };
}
