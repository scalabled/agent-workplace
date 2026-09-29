import { describe, expect, it } from 'vitest';
import { fromScreen, toScreen } from '../projection';
import type { Rect } from '../types';
import {
  MAX_ZOOM,
  cameraBounds,
  clampCamera,
  fitCamera,
  followPoint,
  frameRect,
  inertiaDuration,
  flightCamera,
  inertiaOffset,
  lerpCamera,
  minZoomFor,
  outOfBounds,
  rubberBand,
  velocityOf,
  zoomAround,
} from './camera';

const box: Rect = { x: -8, y: -21.1, w: 896, h: 313.7 };
const desktop = { w: 1440, h: 900 };
const phone = { w: 375, h: 812 };

describe('fitCamera', () => {
  it('shows the whole plate on a laptop, low in the view with the skyline above', () => {
    const cam = fitCamera(box, desktop);
    const tl = toScreen({ x: box.x, y: box.y }, cam, desktop.w, desktop.h);
    const br = toScreen({ x: box.x + box.w, y: box.y + box.h }, cam, desktop.w, desktop.h);
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(desktop.w);
    expect(br.y).toBeLessThanOrEqual(desktop.h);
    // The plate takes the lower part; at least a third of the view above it is sky.
    expect(tl.y).toBeGreaterThan(desktop.h / 3);
    expect(cam.zoom).toBeCloseTo(minZoomFor(box, desktop), 5);
  });

  it('keeps a legible zoom on a phone instead of a thin strip', () => {
    const cam = fitCamera(box, phone);
    expect(cam.zoom).toBeGreaterThan(minZoomFor(box, phone) * 2);
    expect(cam.x).toBeCloseTo(box.x + box.w / 2);
  });
});

describe('camera bounds', () => {
  it('keeps at least 30 % of the plate in view on each axis', () => {
    for (const zoom of [1.5, 3, 6, MAX_ZOOM]) {
      const b = cameraBounds(box, desktop, zoom);
      const hw = desktop.w / 2 / zoom;
      const visible = (cx: number) => Math.max(0, Math.min(cx + hw, box.x + box.w) - Math.max(cx - hw, box.x));
      const need = 0.3 * Math.min(box.w, hw * 2) - 1e-6;
      expect(visible(b.minX)).toBeGreaterThanOrEqual(need);
      expect(visible(b.maxX)).toBeGreaterThanOrEqual(need);
      expect(visible(b.minX - 5)).toBeLessThan(need);
    }
  });

  it('clamps a camera outside the bounds and reports it', () => {
    const far = { x: 5000, y: -5000, zoom: 3 };
    expect(outOfBounds(far, box, desktop)).toBe(true);
    const c = clampCamera(far, box, desktop);
    expect(outOfBounds(c, box, desktop)).toBe(false);
    const b = cameraBounds(box, desktop, 3);
    expect(c.x).toBeCloseTo(b.maxX);
    expect(c.y).toBeCloseTo(b.minY);
  });

  it('rubber-bands beyond the bounds with resistance', () => {
    const b = cameraBounds(box, desktop, 3);
    const raw = { x: b.maxX + 100, y: 100, zoom: 3 };
    const r = rubberBand(raw, box, desktop);
    expect(r.x).toBeCloseTo(b.maxX + 35);
    const inside = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, zoom: 3 };
    expect(rubberBand(inside, box, desktop)).toEqual(inside);
  });
});

describe('zoomAround', () => {
  it('keeps the plate point under the pointer fixed', () => {
    const cam = { x: 400, y: 120, zoom: 2 };
    const at = { x: 300, y: 610 };
    const before = fromScreen(at, cam, desktop.w, desktop.h);
    const next = zoomAround(cam, 5.5, at, desktop);
    const after = fromScreen(at, next, desktop.w, desktop.h);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(next.zoom).toBe(5.5);
  });
});

describe('inertia', () => {
  it('measures velocity over the last 100 ms of samples', () => {
    const v = velocityOf(
      [
        { x: 0, y: 0, t: 0 },
        { x: 500, y: 0, t: 100 },
        { x: 520, y: 10, t: 200 },
        { x: 560, y: 30, t: 240 },
      ],
      250,
    );
    expect(v.x).toBeCloseTo(1, 5);
    expect(v.y).toBeCloseTo(0.5, 5);
  });

  it('decays with τ = 325 ms and stops below 0.01 px/ms', () => {
    const v = { x: 2, y: 0 };
    const total = inertiaOffset(v, 1e6).x;
    expect(total).toBeCloseTo(650, 3);
    expect(inertiaOffset(v, 325).x).toBeCloseTo(650 * (1 - Math.exp(-1)), 3);
    const d = inertiaDuration(v);
    expect(2 * Math.exp(-d / 325)).toBeCloseTo(0.01, 6);
    expect(inertiaDuration({ x: 0.005, y: 0 })).toBe(0);
  });
});

describe('flights and framing', () => {
  it('interpolates zoom in log space', () => {
    const mid = lerpCamera({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 50, zoom: 4 }, 0.5);
    expect(mid).toEqual({ x: 50, y: 25, zoom: 2 });
  });

  it('flies with log-linear zoom and the destination moving on a straight screen line', () => {
    const a = { x: 448, y: 120, zoom: 1.51 };
    const b = { x: 520, y: 150, zoom: 3.52 };
    const start = toScreen({ x: b.x, y: b.y }, a, desktop.w, desktop.h);
    const centre = { x: desktop.w / 2, y: desktop.h / 2 };
    for (const e of [0.1, 0.25, 0.45, 0.5, 0.78, 0.9]) {
      const c = flightCamera(a, b, e);
      expect(Math.log(c.zoom)).toBeCloseTo(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * e, 6);
      const s = toScreen({ x: b.x, y: b.y }, c, desktop.w, desktop.h);
      expect(s.x).toBeCloseTo(start.x + (centre.x - start.x) * e, 4);
      expect(s.y).toBeCloseTo(start.y + (centre.y - start.y) * e, 4);
    }
    expect(flightCamera(a, b, 0)).toEqual(a);
    expect(flightCamera(a, b, 1)).toEqual(b);
    // A pure pan stays linear.
    const pan = flightCamera({ x: 0, y: 0, zoom: 2 }, { x: 100, y: 40, zoom: 2 }, 0.25);
    expect(pan.x).toBeCloseTo(25);
    expect(pan.y).toBeCloseTo(10);
  });

  it('frames a rect and follows a point with the smallest pan', () => {
    const cam = frameRect({ x: 100, y: 100, w: 96, h: 66 }, desktop, { margin: 0.1, maxZoom: 5.6 });
    expect(cam.zoom).toBe(5.6);
    expect(cam.x).toBe(148);
    const c = { x: 400, y: 100, zoom: 4 };
    expect(followPoint(c, { x: 401, y: 101 }, desktop)).toEqual(c);
    const moved = followPoint(c, { x: 600, y: 100 }, desktop);
    const s = toScreen({ x: 600, y: 100 }, moved, desktop.w, desktop.h);
    expect(s.x).toBeCloseTo(desktop.w * 0.85);
  });
});
