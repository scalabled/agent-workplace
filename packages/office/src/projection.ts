// The office camera: orthographic 3/4 top-down at 55° elevation, looking north, no rotation.
// A world point (x, y, z) in u (1 u = 10 cm; y grows south, z up) projects to (x, y·sin55° − z·cos55°).
import type { Camera, Point } from './types';

export const ELEVATION_DEG = 55;
/** Ground foreshortening (sin 55°). */
export const K_Y = 0.82;
/** Height lift (cos 55°). */
export const K_Z = 0.57;

/** World (plan) → projected plate coordinates. */
export function project(x: number, y: number, z = 0): Point {
  return { x, y: y * K_Y - z * K_Z };
}

/** Projected → world, on the plane at height z (default the floor). */
export function unproject(px: number, py: number, z = 0): Point {
  return { x: px, y: (py + z * K_Z) / K_Y };
}

/** Projected → screen px for a camera and viewport. */
export function toScreen(p: Point, cam: Camera, vw: number, vh: number): Point {
  return { x: (p.x - cam.x) * cam.zoom + vw / 2, y: (p.y - cam.y) * cam.zoom + vh / 2 };
}

/** Screen px → projected. */
export function fromScreen(s: Point, cam: Camera, vw: number, vh: number): Point {
  return { x: (s.x - vw / 2) / cam.zoom + cam.x, y: (s.y - vh / 2) / cam.zoom + cam.y };
}

/** Screen px → world floor point. */
export function screenToWorld(s: Point, cam: Camera, vw: number, vh: number, z = 0): Point {
  const p = fromScreen(s, cam, vw, vh);
  return unproject(p.x, p.y, z);
}

/** World → screen px. */
export function worldToScreen(x: number, y: number, z: number, cam: Camera, vw: number, vh: number): Point {
  return toScreen(project(x, y, z), cam, vw, vh);
}
