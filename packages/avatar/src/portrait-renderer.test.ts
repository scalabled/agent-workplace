// Ported from personagram-ai/tests/renderer.test.ts (node:test → vitest), adapted to the
// loop-free PortraitRenderer (render(ctx, pose) instead of an owned rAF loop and _drawFrame hooks).
import type { FaceLandmarks } from '@headcount/protocol';
import { describe, expect, it } from 'vitest';
import { STILL_POSE, type FacePose } from './motion';
import { LID_PROBES, PortraitRenderer, lidColor } from './portrait-renderer';
import { asCtx, FakeCanvas, FakeContext, paths, rgba, stopsOf, type Op } from './test-utils/fake-canvas';
import { VISEMES } from './visemes';

function landmarks(): FaceLandmarks {
  return {
    face: { x: 0.15, y: 0.08, width: 0.7, height: 0.82, centerX: 0.5, centerY: 0.49 },
    mouth: { x: 0.5, y: 0.62 },
    mouthWidth: 0.2,
    mouthHeight: 0.045,
    eyeSpan: 0.28,
    mouthCornerLeft: { x: 0.4, y: 0.62 },
    mouthCornerRight: { x: 0.6, y: 0.62 },
    leftEye: { x: 0.36, y: 0.38 },
    rightEye: { x: 0.64, y: 0.38 },
    leftEyeWidth: 0.1,
    rightEyeWidth: 0.1,
    chin: { x: 0.5, y: 0.88 },
    lipUpperOuter: [{ x: 0.4, y: 0.62 }, { x: 0.45, y: 0.6 }, { x: 0.5, y: 0.615 }, { x: 0.55, y: 0.6 }, { x: 0.6, y: 0.62 }],
    lipUpperInner: [{ x: 0.41, y: 0.62 }, { x: 0.46, y: 0.612 }, { x: 0.5, y: 0.62 }, { x: 0.54, y: 0.612 }, { x: 0.59, y: 0.62 }],
    lipLowerOuter: [{ x: 0.4, y: 0.62 }, { x: 0.45, y: 0.642 }, { x: 0.5, y: 0.648 }, { x: 0.55, y: 0.642 }, { x: 0.6, y: 0.62 }],
    lipLowerInner: [{ x: 0.41, y: 0.62 }, { x: 0.46, y: 0.635 }, { x: 0.5, y: 0.64 }, { x: 0.54, y: 0.635 }, { x: 0.59, y: 0.62 }],
    jawContour: [{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.88 }, { x: 0.8, y: 0.5 }],
    leftUpperEyelid: [{ x: 0.31, y: 0.38 }, { x: 0.36, y: 0.36 }, { x: 0.41, y: 0.38 }],
    rightUpperEyelid: [{ x: 0.59, y: 0.38 }, { x: 0.64, y: 0.36 }, { x: 0.69, y: 0.38 }],
    leftLowerEyelid: [{ x: 0.31, y: 0.38 }, { x: 0.36, y: 0.4 }, { x: 0.41, y: 0.38 }],
    rightLowerEyelid: [{ x: 0.59, y: 0.38 }, { x: 0.64, y: 0.4 }, { x: 0.69, y: 0.38 }],
    browLeft: [{ x: 0.3, y: 0.3 }, { x: 0.36, y: 0.285 }, { x: 0.42, y: 0.3 }],
    browRight: [{ x: 0.58, y: 0.3 }, { x: 0.64, y: 0.285 }, { x: 0.7, y: 0.3 }],
  };
}

const sourceImage = (width = 1200, height = 900) => ({ width, height, naturalWidth: width, naturalHeight: height }) as unknown as HTMLImageElement;

function makeRenderer(options: { width?: number; height?: number; marks?: Partial<FaceLandmarks> | null; maxSide?: number } = {}) {
  const ctx = new FakeContext();
  const lm = options.marks === null ? null : { ...landmarks(), ...options.marks };
  const renderer = new PortraitRenderer(sourceImage(options.width, options.height), lm, {
    asym: 1.04,
    maxSide: options.maxSide,
    createCanvas: () => new FakeCanvas() as unknown as HTMLCanvasElement,
  });
  return { ctx, renderer };
}

const pose = (mouth = VISEMES.REST, extra: Partial<FacePose> = {}): FacePose => ({ ...STILL_POSE, mouth, ...extra });

/**
 * A dense inner-lip contour on a slightly tilted head — 11 points sloping upward to the right, as
 * a real MediaPipe trace of a portrait looks. A bite line drawn flat across it is a wedge.
 */
function tiltedLips(): Partial<FaceLandmarks> {
  const point = (t: number, sag: number) => ({ x: 0.4 + t * 0.2, y: 0.63 - t * 0.014 - Math.sin(t * Math.PI) * sag });
  const span = Array.from({ length: 11 }, (_, i) => i / 10);
  return {
    lipUpperInner: span.map((t) => point(t, 0.008)),
    lipUpperOuter: span.map((t) => point(t, 0.016)),
    lipLowerInner: span.map((t) => point(t, -0.01)),
    lipLowerOuter: span.map((t) => point(t, -0.022)),
  };
}

describe('PortraitRenderer (PG FaceLipSync port)', () => {
  it('opens lips with destination clipping and asymmetric strip geometry', () => {
    const { ctx, renderer } = makeRenderer();
    renderer.drawFrame(asCtx(ctx), VISEMES.OPEN_WIDE);
    const strips = ctx.ops.filter((op) => op.kind === 'drawImage' && op.args.length >= 8 && op.args[3]! <= 3);
    expect(strips.length, 'OPEN_WIDE should redraw multiple thin source strips').toBeGreaterThan(4);
    // Displacement is a transform and the clip is at the destination, so source y == dest y.
    expect(strips.some((op) => op.args[1] === op.args[5])).toBe(true);
    const destinationClips = ctx.ops.filter((op) => op.kind === 'rect' && op.args[2]! > 2 && op.args[3]! > 2);
    expect(destinationClips.length).toBeGreaterThan(1);
    expect(ctx.ops.filter((op) => op.kind === 'transform').length, 'sheared strip transforms').toBeGreaterThan(2);
    // Left and right gains differ (asym 1.04): the first sheared rows are not mirror images.
    const shears = ctx.ops.filter((op) => op.kind === 'transform').map((op) => Math.abs(op.args[1]!));
    expect(new Set(shears.map((s) => s.toFixed(4))).size).toBeGreaterThan(1);
  });

  it('an open mouth is a dark cavity with a subtle arch of upper teeth', () => {
    const { ctx, renderer } = makeRenderer();
    renderer.drawFrame(asCtx(ctx), VISEMES.OPEN_WIDE);
    const all = paths(ctx.ops);
    const cavity = all.find((p) => (stopsOf(p.fills[0])?.length ?? 0) >= 4 && p.fills.every((f) => stopsOf(f)));
    expect(cavity, 'the parted lips should enclose a cavity path').toBeTruthy();
    const openingTop = Math.min(...cavity!.points.map((p) => p.y));
    const openingBottom = Math.max(...cavity!.points.map((p) => p.y));
    const opening = openingBottom - openingTop;
    expect(opening).toBeGreaterThan(6);

    const depth = stopsOf(cavity!.fills[0])!.map(([offset, color]) => ({ offset, ...rgba(color) }));
    for (const stop of depth) {
      expect(stop.lum, `cavity stop ${stop.offset} should be dark`).toBeLessThan(40);
      expect(stop.alpha, `cavity stop ${stop.offset} should be opaque`).toBeGreaterThan(0.85);
    }
    const deepest = depth.reduce((a, b) => (a.lum < b.lum ? a : b));
    expect(deepest.lum).toBeLessThan(20);
    expect(deepest.alpha).toBeGreaterThan(0.9);
    expect(deepest.offset > 0.2 && deepest.offset < 0.95, 'darkest through the middle').toBe(true);

    const band = all.find((p) => typeof p.fills[0] === 'string' && stopsOf(p.fills[1]));
    expect(band, 'the teeth band should be backed by a solid dark fill').toBeTruthy();
    const base = rgba(band!.fills[0] as string);
    expect(base.lum < 25 && base.alpha > 0.8).toBe(true);

    const pts = band!.points;
    const top = pts.slice(0, pts.length / 2);
    const bottom = pts.slice(pts.length / 2).reverse();
    expect(top.length).toBe(bottom.length);
    const thickness = top.map((p, i) => bottom[i]!.y - p.y);
    const thickest = Math.max(...thickness);
    expect(thickest).toBeGreaterThan(0.8);
    expect(thickest, 'teeth stay under a third of the opening').toBeLessThan(opening * 0.32);
    const biteLow = Math.max(...bottom.map((p) => p.y));
    expect(openingBottom - biteLow, 'most of the opening stays dark below the teeth').toBeGreaterThan(opening * 0.45);

    const xs = top.map((p) => p.x);
    const leftMost = xs.indexOf(Math.min(...xs));
    const rightMost = xs.indexOf(Math.max(...xs));
    expect(thickness[leftMost]!).toBeLessThan(0.5);
    expect(thickness[rightMost]!).toBeLessThan(0.5);
    const middle = thickness[Math.floor(thickness.length / 2)]!;
    expect(middle > thickness[leftMost]! && middle > thickness[rightMost]!, 'the arch peaks centrally').toBe(true);

    const fade = band!.fills
      .map(stopsOf)
      .find((stops) => stops && stops.length >= 4 && rgba(stops[0]![1]).alpha > 0.5 && rgba(stops.at(-1)![1]).alpha > 0.5 && rgba(stops[Math.floor(stops.length / 2)]![1]).alpha === 0);
    expect(fade, 'the band fades out toward both corners').toBeTruthy();
  });

  it('on a tilted face the biting edge follows the lip instead of cutting a wedge', () => {
    const { ctx, renderer } = makeRenderer({ marks: tiltedLips() });
    renderer.drawFrame(asCtx(ctx), VISEMES.OPEN_WIDE);
    const band = paths(ctx.ops).find((p) => typeof p.fills[0] === 'string' && stopsOf(p.fills[1]));
    expect(band).toBeTruthy();
    const pts = band!.points;
    const top = pts.slice(0, pts.length / 2);
    const bottom = pts.slice(pts.length / 2).reverse();
    const thickness = top.map((p, i) => bottom[i]!.y - p.y);
    expect(top.length).toBeGreaterThanOrEqual(9);
    const mid = Math.floor(thickness.length / 2);
    const leftHalf = Math.max(...thickness.slice(0, mid));
    const rightHalf = Math.max(...thickness.slice(mid));
    expect(Math.min(leftHalf, rightHalf)).toBeGreaterThan(Math.max(leftHalf, rightHalf) * 0.6);
    const lipDrop = top[0]!.y - top.at(-1)!.y;
    const edgeDrop = bottom[0]!.y - bottom.at(-1)!.y;
    expect(Math.abs(lipDrop)).toBeGreaterThan(2);
    expect(Math.abs(edgeDrop - lipDrop)).toBeLessThan(Math.abs(lipDrop) * 0.75);
    expect(thickness[0]! < 0.5 && thickness.at(-1)! < 0.5).toBe(true);
    const peak = Math.max(...thickness);
    expect(thickness[Math.round(thickness.length * 0.15)]!).toBeLessThan(peak * 0.8);
    expect(thickness[mid]!).toBeGreaterThan(peak * 0.8);
  });

  it('rest pose has no jaw seam or idle mouth warp', () => {
    const { ctx, renderer } = makeRenderer();
    renderer.render(asCtx(ctx), STILL_POSE);
    expect(ctx.count('drawImage'), 'a still rest frame paints only the untouched portrait').toBe(1);
    expect(ctx.count('transform') + ctx.count('rotate'), 'a still pose applies no head motion').toBe(0);
    ctx.reset();
    // Idle life (sway, breathing) moves the whole frame but never warps the mouth.
    renderer.render(asCtx(ctx), pose(VISEMES.REST, { swayX: 0.0005, swayY: -0.0003, swayRot: 0.001, breath: 0.6 }));
    expect(ctx.count('drawImage')).toBe(1);
    expect(ctx.count('rotate')).toBe(1);
  });

  it('draws blink lids and brow lifts only on tier-1 faces', () => {
    const { ctx, renderer } = makeRenderer();
    renderer.render(asCtx(ctx), pose(VISEMES.REST, { blink: 0.8, brow: 0.6 }));
    expect(ctx.count('ellipse'), 'one lid per eye').toBe(2);
    expect(ctx.count('drawImage'), 'base + one strip per brow').toBe(3);
    const still = makeRenderer({ marks: null });
    still.renderer.render(asCtx(still.ctx), pose(VISEMES.OPEN_WIDE, { blink: 0.8, brow: 0.6 }));
    expect(still.renderer.tier).toBe(3);
    expect(still.ctx.count('drawImage'), 'no landmarks → still photo only').toBe(1);
  });

  it('takes the lid colour from skin, not from a fringe or a glasses frame over one probe', () => {
    const skin: [number, number, number] = [196, 150, 122];
    const hair: [number, number, number] = [12, 10, 9];
    expect(LID_PROBES).toHaveLength(5);
    // Dark bangs over both brow-bone probes: the median is still skin (a lone high probe drew black lids).
    expect(lidColor([hair, hair, skin, [190, 146, 118], [201, 155, 126]])).toBe('rgb(190,146,118)');
    // Platinum bangs are no better a lid than black ones.
    expect(lidColor([[240, 236, 226], [236, 232, 220], skin, skin, skin])).toBe('rgb(196,150,122)');
    expect(lidColor([null, null, null, null, null]), 'nothing readable (tainted canvas) → the default lid').toBe('rgb(180,140,120)');
  });

  it('samples both lid colours in a single readback', () => {
    const off = new FakeCanvas();
    new PortraitRenderer(sourceImage(), landmarks(), { createCanvas: () => off as unknown as HTMLCanvasElement });
    expect(off.ctx.count('getImageData')).toBe(1);
    expect(off.ctx.count('drawImage'), 'the source is drawn once, offscreen').toBe(1);
  });

  it('a still (token) renderer keeps no working copy and never warps', () => {
    let made = 0;
    const ctx = new FakeContext();
    const r = new PortraitRenderer(sourceImage(), landmarks(), { still: true, maxSide: 256, createCanvas: () => (made++, new FakeCanvas() as unknown as HTMLCanvasElement) });
    expect(made).toBe(0);
    expect(r.tier).toBe(3);
    r.render(asCtx(ctx), pose(VISEMES.OPEN_WIDE));
    expect(ctx.count('drawImage')).toBe(1);
    expect(ctx.ops.find((o) => o.kind === 'drawImage')!.args).toEqual([0, 0, 256, 192]);
  });

  it('tier 2 (mouth centre only) warps without a cavity', () => {
    const { lipUpperOuter: _a, lipUpperInner: _b, lipLowerOuter: _c, lipLowerInner: _d, ...rest } = landmarks();
    const ctx = new FakeContext();
    const renderer = new PortraitRenderer(sourceImage(), rest as FaceLandmarks, { createCanvas: () => new FakeCanvas() as unknown as HTMLCanvasElement });
    expect(renderer.tier).toBe(2);
    renderer.drawFrame(asCtx(ctx), VISEMES.OPEN_WIDE);
    expect(ctx.count('drawImage')).toBeGreaterThan(4);
    expect(ctx.ops.some((o: Op) => o.kind === 'gradient')).toBe(false);
  });

  it('caps working resolution at 1024 on the largest side (and per tier)', () => {
    const { renderer } = makeRenderer({ width: 4000, height: 3000 });
    const stats = renderer.stats();
    expect(stats.width).toBe(1024);
    expect(stats.height).toBe(768);
    const tile = makeRenderer({ width: 4000, height: 3000, maxSide: 384 });
    expect(tile.renderer.stats().width).toBe(384);
    renderer.destroy();
    expect(renderer.stats().destroyed).toBe(true);
    renderer.destroy(); // idempotent
  });

  it('owns no animation loop: rendering never schedules frames', () => {
    const calls: unknown[] = [];
    const g = globalThis as { requestAnimationFrame?: unknown };
    const prev = g.requestAnimationFrame;
    g.requestAnimationFrame = (cb: unknown) => calls.push(cb);
    try {
      const { ctx, renderer } = makeRenderer();
      renderer.render(asCtx(ctx), pose(VISEMES.OPEN_MED));
      renderer.render(asCtx(ctx), STILL_POSE);
      expect(calls).toHaveLength(0);
      expect(renderer.frames).toBe(2);
    } finally {
      g.requestAnimationFrame = prev;
    }
  });

  it('applies a cover-fit view transform before drawing', () => {
    const { ctx, renderer } = makeRenderer();
    renderer.render(asCtx(ctx), STILL_POSE, { scale: 0.5, x: -10, y: 4 });
    expect(ctx.ops.find((o) => o.kind === 'transform')?.args).toEqual([0.5, 0, 0, 0.5, -10, 4]);
  });
});
