// Ported from personagram-ai/src/web/avatar/face-lipsync.js (FaceLipSync) — Canvas2D mouth-warp
// renderer for a photoreal portrait. Headcount changes: no per-instance rAF loop (the shared
// scheduler calls render()), no audio/driver ownership (the pose carries smoothed mouth params),
// head pose (yaw/pitch/lean/breath) folded into PG's single per-frame transform, and a view
// transform so the working-resolution frame can be drawn cover-fit into any canvas.
//
// Tier 1: full lip-contour landmarks → strip warp + cavity + teeth + tongue + blink + brows.
// Tier 2: mouth-centre-only landmarks → strip warp with assumed lip thickness.
// Tier 3: no landmarks → still image (head motion only).
//
// The lips genuinely PART: strips are clipped at their DESTINATION (clipping to the source row
// discarded every strip displaced by more than the strip height, so the mouth never opened), rows
// diverge from the mouth line with anatomically weighted gains (the jaw does most of the opening),
// the displacement tapers to zero at the corners GEOMETRICALLY via a per-segment shear, and the
// cavity is built from the SAME displacement so it fills exactly the gap. Every layer shares one
// per-frame transform, so head sway never streaks the warp. The source is drawn ONCE into an
// offscreen canvas; no frame calls getImageData/putImageData.
import type { FaceLandmarks, Point, VisemeParams } from '@headcount/protocol';
import type { FacePose } from './motion';
import { REST_PARAMS } from './visemes';

/** Anything drawable with a size (HTMLImageElement, ImageBitmap, canvas; tests pass plain objects). */
export type PortraitSourceImage = CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number };

export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export interface PortraitRendererOptions {
  /** Cap on the working canvas' largest side (landmarks are normalised). Default 1024. */
  maxSide?: number;
  /** Left/right gain asymmetry, 0.94–1.06 (kills uncanny mirror symmetry). Default 1. */
  asym?: number;
  /** Offscreen canvas factory (tests inject a fake). Default: document.createElement('canvas'). */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  /**
   * A still (token) renderer: no offscreen working copy and no warp — the source is drawn
   * directly, scaled. Saves a canvas per face on walls of tokens.
   */
  still?: boolean;
}

type Ctx = CanvasRenderingContext2D;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Trace a polyline as a smooth curve through the midpoint of every segment with the vertices as
 * control points. Lips and teeth are curves; the raw landmark polygon showed facets and steps.
 */
export function traceSmooth(ctx: Ctx, pts: Point[], move: boolean): void {
  if (!pts.length) return;
  if (move) ctx.moveTo(pts[0]!.x, pts[0]!.y);
  else ctx.lineTo(pts[0]!.x, pts[0]!.y);
  if (pts.length < 3) {
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const next = pts[i + 1]!;
    ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  const last = pts[pts.length - 1]!;
  ctx.quadraticCurveTo(last.x, last.y, last.x, last.y);
}

const STRIP = 2; // warp strip height, px
export const DEFAULT_MAX_SIDE = 1024;
/** Each lip may travel at most this fraction of the face height from the mouth line. */
const MAX_LIP_TRAVEL = 0.06;
/** Row displacements below this (px) are not drawn: a closed mouth stays the untouched photo. */
const MIN_DISPLACEMENT_PX = 0.5;
/**
 * Horizontal taper of the lip displacement vs |x − mouth centre| / half mouth width: full across
 * the central 45 %, then piecewise-linear to zero just past the corners. Strips and cavity share it.
 */
const TAPER_BREAKS: readonly (readonly [number, number])[] = [
  [0.45, 1],
  [0.65, 0.75],
  [0.85, 0.25],
  [1.05, 0],
];
const DEFAULT_LID = 'rgb(180,140,120)';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Segment {
  x0: number;
  x1: number;
  t0: number;
  t1: number;
  gain: number;
}
interface Travel {
  up: number;
  downJaw: number;
  downOpen: number;
}

export interface FrameExtras {
  blink?: number;
  brow?: number;
  tongue?: boolean;
}

let createdCount = 0;

export class PortraitRenderer {
  /** Instances constructed (leak diagnostics). */
  static created(): number {
    return createdCount;
  }

  readonly tier: 1 | 2 | 3;
  readonly w: number;
  readonly h: number;
  /** Frames drawn (diagnostics). */
  frames = 0;
  destroyed = false;

  private readonly landmarks: FaceLandmarks | null;
  private direct: PortraitSourceImage | null = null;
  private offscreen: HTMLCanvasElement | null = null;
  private offCtx: Ctx | null = null;
  private readonly asym: number;

  private upperLipPx = 2;
  private lowerLipPx = 2;
  private warpRegion: Rect | null = null;
  private segments: Segment[] = [];
  private lipUpperInnerPx: Point[] = [];
  private lipLowerInnerPx: Point[] = [];
  private leftLidColor = DEFAULT_LID;
  private rightLidColor = DEFAULT_LID;
  private mouthCenterPx: Point = { x: 0, y: 0 };
  private mouthWidthPx = 0;
  private mouthHeightPx = 0;
  private faceWidthPx = 0;
  private faceHeightPx = 0;
  private leftEyePx: Point | null = null;
  private rightEyePx: Point | null = null;
  private leftEyeWidthPx = 0;
  private rightEyeWidthPx = 0;
  private browLeftPx: Point[] | null = null;
  private browRightPx: Point[] | null = null;

  constructor(source: PortraitSourceImage, landmarks: FaceLandmarks | null, options: PortraitRendererOptions = {}) {
    this.landmarks = landmarks;
    this.asym = clamp(options.asym ?? 1, 0.94, 1.06);
    const nw = source.naturalWidth || source.width;
    const nh = source.naturalHeight || source.height;
    const maxSide = options.maxSide ?? DEFAULT_MAX_SIDE;
    const scale = Math.min(1, maxSide / Math.max(1, nw, nh));
    this.w = Math.max(1, Math.round(nw * scale));
    this.h = Math.max(1, Math.round(nh * scale));

    if (options.still) {
      this.direct = source;
    } else {
      const make = options.createCanvas ?? ((w: number, h: number) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      });
      this.offscreen = make(this.w, this.h);
      this.offscreen.width = this.w;
      this.offscreen.height = this.h;
      this.offCtx = (this.offscreen.getContext('2d') as Ctx | null) ?? null;
      this.offCtx?.drawImage(source, 0, 0, this.w, this.h);
    }

    let tier: 1 | 2 | 3 = landmarks?.lipUpperOuter ? 1 : landmarks?.mouth ? 2 : 3;
    if (!this.offCtx) tier = 3;
    this.tier = tier;
    if (tier === 1) this.computePolygonGeometry();
    else if (tier === 2) this.computeWarpRegion();
    if (this.warpRegion) this.segments = this.taperSegments();
    createdCount++;
  }

  // ── geometry ───────────────────────────────────────────────────────────────

  private computePolygonGeometry() {
    const lm = this.landmarks!;
    const { w, h } = this;
    const px = (pt: Point): Point => ({ x: pt.x * w, y: pt.y * h });
    const upperOuter = lm.lipUpperOuter!.map(px);
    const lowerOuter = (lm.lipLowerOuter ?? []).map(px);
    this.lipUpperInnerPx = (lm.lipUpperInner ?? []).map(px);
    this.lipLowerInnerPx = (lm.lipLowerInner ?? []).map(px);
    this.browLeftPx = lm.browLeft?.map(px) ?? null;
    this.browRightPx = lm.browRight?.map(px) ?? null;
    this.mouthCenterPx = px(lm.mouth ?? { x: 0.5, y: 0.62 });
    this.mouthWidthPx = lm.mouthWidth * w;
    this.mouthHeightPx = lm.mouthHeight * h;
    this.faceWidthPx = lm.face.width * w;
    this.faceHeightPx = lm.face.height * h;
    if (lm.leftEye) this.leftEyePx = px(lm.leftEye);
    if (lm.rightEye) this.rightEyePx = px(lm.rightEye);
    this.leftEyeWidthPx = (lm.leftEyeWidth || 0) * w;
    this.rightEyeWidthPx = (lm.rightEyeWidth || 0) * w;
    // Sampled ONCE here, not on every blink frame (getImageData per frame was a stall), and in a
    // single readback for both eyes (repeated readbacks make browsers de-accelerate the canvas).
    [this.leftLidColor, this.rightLidColor] = this.sampleSkin([
      this.leftEyePx ? { x: this.leftEyePx.x, y: this.leftEyePx.y - this.leftEyeWidthPx * 0.8 } : null,
      this.rightEyePx ? { x: this.rightEyePx.x, y: this.rightEyePx.y - this.rightEyeWidthPx * 0.8 } : null,
    ]);

    const allX = [...upperOuter, ...lowerOuter].map((p) => p.x);
    const mxMin = Math.min(...allX);
    const mxMax = Math.max(...allX);
    const myMin = Math.min(...upperOuter.map((p) => p.y));
    const myMax = lowerOuter.length ? Math.max(...lowerOuter.map((p) => p.y)) : this.mouthCenterPx.y + 2;
    const padX = (mxMax - mxMin) * 0.4;
    const padY = (myMax - myMin) * 1.5;
    // Bound the lower edge by the chin so a big jawDrop never warps the neck.
    let regionH = myMax - myMin + padY * 2;
    if (lm.chin) regionH = Math.min(regionH, Math.max(1, lm.chin.y * h - (myMin - padY)));
    this.warpRegion = { x: mxMin - padX, y: myMin - padY, w: mxMax - mxMin + padX * 2, h: regionH };
    this.upperLipPx = Math.max(2, this.mouthCenterPx.y - myMin);
    this.lowerLipPx = Math.max(2, myMax - this.mouthCenterPx.y);
  }

  private computeWarpRegion() {
    const lm = this.landmarks!;
    const { w, h } = this;
    this.mouthCenterPx = { x: lm.mouth!.x * w, y: lm.mouth!.y * h };
    this.mouthWidthPx = lm.mouthWidth * w;
    this.mouthHeightPx = lm.mouthHeight * h;
    this.faceWidthPx = lm.face.width * w;
    this.faceHeightPx = lm.face.height * h;
    const jawY = (lm.face.y + lm.face.height) * h;
    const margin = this.faceWidthPx * 0.15;
    this.warpRegion = {
      x: this.mouthCenterPx.x - this.faceWidthPx * 0.35,
      y: this.mouthCenterPx.y - this.mouthHeightPx * 3,
      w: this.faceWidthPx * 0.7,
      h: jawY - this.mouthCenterPx.y + this.mouthHeightPx * 3 + margin,
    };
    // No contours: assume lips about 2 % of the face height thick.
    this.upperLipPx = Math.max(2, this.faceHeightPx * 0.02);
    this.lowerLipPx = Math.max(2, this.faceHeightPx * 0.025);
  }

  /** Skin colour at each point (one getImageData over their bounding box). */
  private sampleSkin(points: (Point | null)[]): string[] {
    const inside = points.map((p) => (p ? { x: Math.round(p.x), y: Math.round(p.y) } : null)).map((p) => (p && p.x >= 0 && p.x < this.w && p.y >= 0 && p.y < this.h ? p : null));
    const valid = inside.filter((p): p is Point => !!p);
    if (!this.offCtx || !valid.length) return points.map(() => DEFAULT_LID);
    const x0 = Math.min(...valid.map((p) => p.x));
    const y0 = Math.min(...valid.map((p) => p.y));
    const w = Math.max(...valid.map((p) => p.x)) - x0 + 1;
    const h = Math.max(...valid.map((p) => p.y)) - y0 + 1;
    try {
      const data = this.offCtx.getImageData(x0, y0, w, h).data;
      return inside.map((p) => {
        if (!p) return DEFAULT_LID;
        const i = ((p.y - y0) * w + (p.x - x0)) * 4;
        return data.length >= i + 3 ? `rgb(${data[i]},${data[i + 1]},${data[i + 2]})` : DEFAULT_LID;
      });
    } catch {
      return points.map(() => DEFAULT_LID); // tainted canvas (cross-origin portrait)
    }
  }

  /** The mouth warp region in canvas pixels, integer-aligned and clipped (null for tier 3). */
  mouthRegion(): Rect | null {
    if (!this.warpRegion) return null;
    const wr = this.warpRegion;
    const x = clamp(Math.round(wr.x), 0, this.w);
    const y = clamp(Math.round(wr.y), 0, this.h);
    return { x, y, w: clamp(Math.round(wr.w), 0, this.w - x), h: clamp(Math.round(wr.h), 0, this.h - y) };
  }

  /** The inner-lip band (mouth width × maximum lip travel above and below the mouth line). */
  lipBox(): Rect | null {
    if (!this.warpRegion) return null;
    const travel = this.faceHeightPx * MAX_LIP_TRAVEL;
    const x = clamp(Math.round(this.mouthCenterPx.x - this.mouthWidthPx * 0.5), 0, this.w);
    const y = clamp(Math.round(this.mouthCenterPx.y - travel), 0, this.h);
    return { x, y, w: clamp(Math.round(this.mouthWidthPx), 0, this.w - x), h: clamp(Math.round(travel * 2), 0, this.h - y) };
  }

  /** Column segments of a warp row (both sides of the mouth centre) carrying the taper at their ends. */
  private taperSegments(): Segment[] {
    const region = this.mouthRegion();
    if (!region || region.w <= 0) return [];
    const mc = this.mouthCenterPx;
    const half = Math.max(1, this.mouthWidthPx * 0.5);
    const breaks: (readonly [number, number])[] = [[0, 1], ...TAPER_BREAKS];
    const out: Segment[] = [];
    for (const side of [-1, 1]) {
      const gain = side < 0 ? this.asym : 2 - this.asym;
      for (let i = 0; i + 1 < breaks.length; i++) {
        const [dA, tA] = breaks[i]!;
        const [dB, tB] = breaks[i + 1]!;
        let xA = mc.x + side * dA * half;
        let xB = mc.x + side * dB * half;
        let t0 = tA;
        let t1 = tB;
        if (side < 0) {
          [xA, xB] = [xB, xA];
          [t0, t1] = [tB, tA];
        }
        const x0 = Math.max(region.x, xA);
        const x1 = Math.min(region.x + region.w, xB);
        if (x1 - x0 < 0.5) continue;
        const span = xB - xA || 1;
        const tt0 = t0 + ((x0 - xA) / span) * (t1 - t0);
        const tt1 = t0 + ((x1 - xA) / span) * (t1 - t0);
        out.push({ x0, x1, t0: tt0, t1: tt1, gain });
      }
    }
    return out;
  }

  /** Horizontal taper of the warp at column x (a lens, not a box). */
  private xTaper(x: number): number {
    const half = Math.max(1, this.mouthWidthPx * 0.5);
    const d = Math.abs(x - this.mouthCenterPx.x) / half;
    let prevD = 0;
    let prevT = 1;
    for (const [bd, bt] of TAPER_BREAKS) {
      if (d <= bd) return prevT + ((d - prevD) / (bd - prevD)) * (bt - prevT);
      prevD = bd;
      prevT = bt;
    }
    return 0;
  }

  /** Lip travel at the mouth line (px). The jaw does most of the opening; strips and cavity share it. */
  private lipTravel(openY: number, jawDrop: number): Travel {
    const h = this.h;
    const upperGain = this.tier === 1 ? 0.3 : 0.22;
    const lowerJawGain = this.tier === 1 ? 0.55 : 0.65;
    const lowerOpenGain = this.tier === 1 ? 0.25 : 0.35;
    const cap = this.faceHeightPx * MAX_LIP_TRAVEL;
    return {
      up: clamp(openY * h * upperGain, -cap, cap),
      downJaw: clamp(jawDrop * h * lowerJawGain, -cap, cap),
      downOpen: clamp(openY * h * lowerOpenGain, -cap, cap),
    };
  }

  /**
   * Signed vertical displacement (px, negative = up) of the row at `y`, before taper/asymmetry.
   * Each lip moves RIGIDLY over its own thickness; the skin beyond stretches linearly to zero at
   * the region edge, inside the region-height falloff.
   */
  private rowDisplacement(y: number, travel: Travel): number {
    const region = this.mouthRegion();
    const wr = this.warpRegion;
    if (!region || !wr) return 0;
    const mc = this.mouthCenterPx;
    const relY = (y - mc.y) / (wr.h * 0.5);
    const falloff = Math.max(0, 1 - relY * relY);
    if (falloff <= 0) return 0;
    if (y > mc.y) {
      const dist = y - mc.y;
      const span = Math.max(1, region.y + region.h - mc.y - this.lowerLipPx);
      const weight = dist <= this.lowerLipPx ? 1 : Math.max(0, 1 - (dist - this.lowerLipPx) / span);
      return (travel.downJaw + travel.downOpen) * weight * falloff;
    }
    const dist = mc.y - y;
    const span = Math.max(1, mc.y - region.y - this.upperLipPx);
    const weight = dist <= this.upperLipPx ? 1 : Math.max(0, 1 - (dist - this.upperLipPx) / span);
    return -travel.up * weight * falloff;
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  /**
   * Draw one frame of `pose` onto `ctx`. `view` maps working pixels into the target canvas
   * (cover fit); omit it to draw 1:1 at the working resolution.
   */
  render(ctx: Ctx, pose: FacePose, view?: ViewTransform): void {
    if (this.destroyed) return;
    ctx.save();
    if (view && (view.scale !== 1 || view.x !== 0 || view.y !== 0)) ctx.transform(view.scale, 0, 0, view.scale, view.x, view.y);
    this.applyHeadMotion(ctx, pose);
    this.drawFrame(ctx, pose.mouth, { blink: pose.blink, brow: pose.brow, tongue: pose.tongue });
    ctx.restore();
  }

  /**
   * PG's single per-frame transform: sway, plus Headcount's head pose. The 2 % overscan hides the
   * edges the motion would expose. A still pose leaves the photo untouched (no transform at all).
   */
  private applyHeadMotion(ctx: Ctx, pose: FacePose) {
    const moving =
      Math.abs(pose.swayX) + Math.abs(pose.swayY) + Math.abs(pose.swayRot) + Math.abs(pose.yaw) + Math.abs(pose.pitch) + Math.abs(pose.lean) + Math.abs(pose.breath) >
      1e-4;
    if (!moving) return;
    const { w, h } = this;
    const dx = pose.swayX * w + pose.yaw * w * 0.01;
    const dy = pose.swayY * h - pose.pitch * h * 0.006 + pose.breath * h * 0.0012 + pose.lean * h * 0.003;
    const rot = pose.swayRot + pose.yaw * 0.012;
    const s = 1.02 + pose.lean * 0.018;
    ctx.translate(w / 2 + dx, h / 2 + dy);
    ctx.rotate(rot);
    ctx.scale(s * (1 - Math.abs(pose.yaw) * 0.012), s * (1 + pose.pitch * 0.004));
    ctx.translate(-w / 2, -h / 2);
  }

  /** The untransformed frame: base photo, then (tiers 1–2) warp, cavity, brows and blink. */
  drawFrame(ctx: Ctx, viseme: VisemeParams = REST_PARAMS, extras: FrameExtras = {}): void {
    const { w, h } = this;
    const source = this.offscreen ?? this.direct;
    if (source) ctx.drawImage(source, 0, 0, w, h);
    this.frames++;
    if (this.tier === 3) return;
    const { openY, stretchX, jawDrop, cornerPull = 0, round = 0 } = viseme;
    const isMoving = Math.abs(openY) > 0.001 || Math.abs(jawDrop) > 0.001 || Math.abs(stretchX) > 0.001 || cornerPull > 0.02 || round > 0.02;
    if (isMoving) this.drawWarp(ctx, openY, stretchX, jawDrop, cornerPull, round);
    if (this.tier === 1 && isMoving) this.drawMouthCavity(ctx, openY, stretchX, jawDrop, round, !!extras.tongue);
    if (this.tier === 1 && (extras.brow ?? 0) > 0.02) this.drawBrows(ctx, extras.brow!);
    if (this.tier === 1 && (extras.blink ?? 0) > 0) this.drawBlink(ctx, extras.blink!);
  }

  /**
   * Strip warp: thin horizontal strips redrawn displaced AWAY from the mouth line, each row as
   * column segments whose displacement runs linearly between taper values (a shear).
   */
  private drawWarp(ctx: Ctx, openY: number, stretchX: number, jawDrop: number, cornerPull: number, round: number) {
    const region = this.mouthRegion();
    const source = this.offscreen;
    if (!source || !region || region.w <= 0 || region.h <= 0 || !this.segments.length) return;
    const h = this.h;
    const mc = this.mouthCenterPx;
    const wr = this.warpRegion!;
    const travel = this.lipTravel(openY, jawDrop);
    const roundNarrow = round * 0.06; // rounding narrows the mouth: fold into the horizontal scale

    ctx.save();
    ctx.beginPath();
    ctx.rect(region.x, region.y, region.w, region.h);
    ctx.clip();
    for (let sy = 0; sy < region.h; sy += STRIP) {
      const absY = region.y + sy;
      const stripH = Math.min(STRIP, region.h - sy);
      const rowCenterY = absY + stripH / 2;
      const distFromMouth = (rowCenterY - mc.y) / (region.h * 0.5);
      if (Math.abs(distFromMouth) >= 1) continue;
      const cornerLift = cornerPull * h * 0.006 * Math.max(0, 1 - Math.abs(distFromMouth) * 1.6);
      const relY = (rowCenterY - mc.y) / (wr.h * 0.5);
      const falloff = Math.max(0, 1 - relY * relY);
      if (falloff <= 0) continue;
      const offsetYBase = this.rowDisplacement(rowCenterY, travel) - cornerLift;
      const scaleXBase = 1 + (stretchX - roundNarrow) * falloff * 0.3;
      if (Math.abs(offsetYBase) < MIN_DISPLACEMENT_PX && Math.abs(scaleXBase - 1) < 0.002) continue;
      for (const seg of this.segments) {
        const d0 = offsetYBase * seg.gain * seg.t0;
        const d1 = offsetYBase * seg.gain * seg.t1;
        const scaleX = 1 + (scaleXBase - 1) * seg.gain * ((seg.t0 + seg.t1) / 2);
        if (Math.abs(d0) < MIN_DISPLACEMENT_PX && Math.abs(d1) < MIN_DISPLACEMENT_PX && Math.abs(scaleX - 1) < 0.002) continue;
        const width = seg.x1 - seg.x0;
        const shear = (d1 - d0) / width;
        ctx.save();
        ctx.beginPath();
        // Clip at the DESTINATION (clipping to the source row kept the mouth visually shut).
        ctx.rect(seg.x0, absY + Math.min(d0, d1) - 2, width, stripH + Math.abs(d1 - d0) + 5);
        ctx.clip();
        // (x, y) → (x, y + d0 + shear·(x − x0)): displacement runs linearly across the segment.
        ctx.transform(1, shear, 0, 1, 0, d0 - shear * seg.x0);
        ctx.translate(mc.x, 0);
        ctx.scale(scaleX, 1);
        ctx.translate(-mc.x, 0);
        // One extra source pixel on every side so neighbours overlap instead of leaving seams.
        ctx.drawImage(source, seg.x0 - 1, absY, width + 2, stripH + 1, seg.x0 - 1, absY, width + 2, stripH + 1);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  /**
   * The mouth cavity between the DISPLACED inner lip contours (tier 1): near-opaque dark gradient,
   * occlusion shade, upper-teeth arch, lower teeth on big jaw drops, tongue tint.
   */
  private drawMouthCavity(ctx: Ctx, openY: number, stretchX: number, jawDrop: number, round: number, tongue: boolean) {
    if (!this.lipUpperInnerPx.length || !this.lipLowerInnerPx.length) return;
    const travel = this.lipTravel(openY, jawDrop);
    const up = travel.up;
    const down = travel.downJaw + travel.downOpen;
    const gap = up + down;
    if (gap < 1.5) return; // a hairline gap reads as a blotch, not a mouth

    const { w, h } = this;
    const mc = this.mouthCenterPx;
    const mouthH = Math.max(this.mouthHeightPx || 0, this.faceHeightPx * 0.02, h * 0.012);
    const roundPull = round * 0.14;
    const xStretch = stretchX * w * 0.12;
    const OVERLAP = 1.5; // a hair into the displaced lips so no sliver of the closed mouth shows

    const transformPt = (pt: Point, isUpper: boolean): Point => {
      const taper = this.xTaper(pt.x);
      const shift = this.rowDisplacement(isUpper ? Math.min(pt.y, mc.y - 0.01) : Math.max(pt.y, mc.y + 0.01), travel) * taper;
      const towardCenter = (mc.x - pt.x) * roundPull * taper;
      return {
        x: pt.x + xStretch * taper * (pt.x < mc.x ? -1 : 1) + towardCenter,
        y: pt.y + shift + (isUpper ? -OVERLAP : OVERLAP) * taper,
      };
    };
    const upperInner = this.lipUpperInnerPx.map((p) => transformPt(p, true));
    const lowerInner = this.lipLowerInnerPx.map((p) => transformPt(p, false));

    // Guard against inverted/exploded contours (bad landmarks → giant black blob).
    const allY = [...upperInner, ...lowerInner].map((p) => p.y);
    const allX = [...upperInner, ...lowerInner].map((p) => p.x);
    const cavH = Math.max(...allY) - Math.min(...allY);
    const cavW = Math.max(...allX) - Math.min(...allX);
    const maxCavH = Math.max(mouthH * 2.4, this.faceHeightPx * (MAX_LIP_TRAVEL * 2 + 0.03));
    const maxCavW = Math.max(this.mouthWidthPx * 1.15, this.faceWidthPx * 0.42);
    if (cavH > maxCavH || cavW > maxCavW || cavH < 1) return;

    ctx.save();
    ctx.beginPath();
    traceSmooth(ctx, upperInner, true);
    traceSmooth(ctx, [...lowerInner].reverse(), false);
    ctx.closePath();
    // The back of the mouth is the darkest thing in the frame: near-opaque through the middle,
    // easing at the very bottom where light bounces off the lower lip.
    const grad = ctx.createLinearGradient(mc.x, Math.min(...allY), mc.x, Math.max(...allY));
    grad.addColorStop(0, 'rgba(30, 15, 19, 0.93)');
    grad.addColorStop(0.45, 'rgba(11, 4, 8, 0.985)');
    grad.addColorStop(0.82, 'rgba(8, 3, 6, 0.99)');
    grad.addColorStop(1, 'rgba(24, 11, 15, 0.94)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Soft occlusion just inside the upper lip: stops the opening reading as a flat cut-out.
    if (gap > 2) {
      const shade = ctx.createLinearGradient(mc.x, mc.y - up, mc.x, mc.y - up + gap * 0.3);
      shade.addColorStop(0, 'rgba(10, 4, 8, 0.6)');
      shade.addColorStop(1, 'rgba(10, 4, 8, 0)');
      ctx.fillStyle = shade;
      ctx.fill();
    }

    if (gap > 4) {
      ctx.clip();
      // Only the crowns of the upper front teeth, well under half the opening (dentures otherwise).
      const teethHeight = Math.max(1.5, Math.min(gap * 0.28, this.mouthWidthPx * 0.065));
      const mxL = Math.min(...upperInner.map((p) => p.x));
      const mxR = Math.max(...upperInner.map((p) => p.x));
      const mw = Math.max(1, mxR - mxL);
      // Six front teeth, stopping well short of the corners (corners are shadow, not enamel).
      const teethL = mxL + mw * 0.14;
      const teethR = mxR - mw * 0.14;
      const archNorm = (x: number) => clamp((x - teethL) / Math.max(1, teethR - teethL), 0, 1);
      // Teeth hang from the lip: smooth the contour (kills the wobble that reads as crooked), then
      // offset it by an arching depth, so no head tilt can turn the band into a wedge.
      const smooth = upperInner.map((p, i, a) => {
        const prev = a[Math.max(0, i - 1)]!;
        const next = a[Math.min(a.length - 1, i + 1)]!;
        return { x: p.x, y: (prev.y + p.y * 2 + next.y) / 4 };
      });
      const deepest = mc.y + down - gap * 0.58; // at least 55 % of the opening stays dark
      const depthAt = (x: number) => teethHeight * Math.pow(Math.sin(archNorm(x) * Math.PI), 0.6);
      const biteAt = (x: number) => {
        let lip = smooth[0]!.y;
        for (let j = 0; j < smooth.length - 1; j++) {
          const a = smooth[j]!;
          const b = smooth[j + 1]!;
          if ((a.x <= x && b.x >= x) || (b.x <= x && a.x >= x)) {
            const t = (x - a.x) / (b.x - a.x || 1);
            lip = a.y + (b.y - a.y) * t;
            break;
          }
        }
        return Math.min(lip + depthAt(x), deepest);
      };
      const topPts = upperInner;
      const bottomPts = upperInner.map((p, i) => ({ x: p.x, y: Math.max(p.y, Math.min(smooth[i]!.y + depthAt(p.x), deepest)) }));
      const visible = bottomPts.some((p, i) => p.y - topPts[i]!.y > 0.8);

      if (visible) {
        ctx.beginPath();
        traceSmooth(ctx, topPts, true);
        traceSmooth(ctx, [...bottomPts].reverse(), false);
        ctx.closePath();
        // Opaque dark base first: the translucent cavity let skin through and greyed the enamel.
        ctx.fillStyle = 'rgba(18, 8, 12, 0.88)';
        ctx.fill();
        const bandTop = Math.min(...topPts.map((p) => p.y));
        const bandBottom = Math.max(...bottomPts.map((p) => p.y));
        // Warm ivory, not grey: shadowed at the gum, peaking two thirds down, easing at the edge.
        const teethGrad = ctx.createLinearGradient(mc.x, bandTop, mc.x, Math.max(bandTop + 1, bandBottom));
        teethGrad.addColorStop(0, 'rgba(74, 58, 58, 0.55)');
        teethGrad.addColorStop(0.3, 'rgba(184, 170, 152, 0.5)');
        teethGrad.addColorStop(0.65, 'rgba(224, 212, 192, 0.58)');
        teethGrad.addColorStop(1, 'rgba(180, 167, 150, 0.44)');
        ctx.fillStyle = teethGrad;
        ctx.fill();
        // Wash the ends back into the dark (otherwise one flat sheet spanning the opening).
        const fade = ctx.createLinearGradient(teethL, 0, teethR, 0);
        fade.addColorStop(0, 'rgba(10, 4, 7, 0.92)');
        fade.addColorStop(0.16, 'rgba(10, 4, 7, 0.4)');
        fade.addColorStop(0.36, 'rgba(10, 4, 7, 0)');
        fade.addColorStop(0.64, 'rgba(10, 4, 7, 0)');
        fade.addColorStop(0.84, 'rgba(10, 4, 7, 0.4)');
        fade.addColorStop(1, 'rgba(10, 4, 7, 0.92)');
        ctx.fillStyle = fade;
        ctx.fill();
        // A whisper of shadow below the biting edge: teeth sit inside the opening, not on it.
        const seat = Math.max(1, teethHeight * 0.45);
        ctx.beginPath();
        traceSmooth(ctx, bottomPts, true);
        traceSmooth(ctx, [...bottomPts].reverse().map((p) => ({ x: p.x, y: p.y + seat })), false);
        ctx.closePath();
        const seatY = Math.max(...bottomPts.map((p) => p.y));
        const seatGrad = ctx.createLinearGradient(mc.x, seatY - seat, mc.x, seatY + seat);
        seatGrad.addColorStop(0, 'rgba(6, 2, 4, 0.5)');
        seatGrad.addColorStop(1, 'rgba(6, 2, 4, 0)');
        ctx.fillStyle = seatGrad;
        ctx.fill();
      }
      // Lower teeth on big jaw drops: dimmer (in shadow), a near-straight edge.
      if (down > 10 && gap > 20) {
        const lowerTeethH = teethHeight * 0.4;
        const lowerHigh = Math.min(...lowerInner.map((p) => p.y));
        const lowerBiteY = Math.max(lowerHigh - lowerTeethH, mc.y - up + Math.max(1, gap * 0.15));
        const lowTop = lowerInner.map((p) => ({
          x: p.x,
          y: Math.min(p.y - lowerTeethH * 0.3, lowerBiteY - lowerTeethH * 0.1 * Math.sin(archNorm(p.x) * Math.PI)),
        }));
        ctx.beginPath();
        traceSmooth(ctx, lowTop, true);
        traceSmooth(ctx, [...lowerInner].reverse(), false);
        ctx.closePath();
        const lowGrad = ctx.createLinearGradient(mc.x, Math.min(...lowTop.map((p) => p.y)), mc.x, Math.max(...lowerInner.map((p) => p.y)));
        lowGrad.addColorStop(0, 'rgba(140, 128, 114, 0)');
        lowGrad.addColorStop(1, 'rgba(170, 157, 140, 0.22)');
        ctx.fillStyle = lowGrad;
        ctx.fill();
      }
      // TONGUE: a soft warm ellipse low in the cavity.
      if (tongue && gap > 10) {
        ctx.beginPath();
        ctx.ellipse(mc.x, mc.y + down * 0.35, mw * 0.22, Math.max(2, gap * 0.22), 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(148, 70, 74, 0.55)';
        ctx.fill();
      }
      // Tooth separators between the six front teeth, from under the lip to short of the edge.
      ctx.strokeStyle = 'rgba(78, 60, 54, 0.2)';
      ctx.lineWidth = Math.max(0.4, this.faceWidthPx * 0.0014);
      const lipYAt = (x: number) => {
        for (let j = 0; j < topPts.length - 1; j++) {
          const a = topPts[j]!;
          const b = topPts[j + 1]!;
          if ((a.x <= x && b.x >= x) || (b.x <= x && a.x >= x)) {
            const t = (x - a.x) / (b.x - a.x || 1);
            return a.y + (b.y - a.y) * t;
          }
        }
        return mc.y - up;
      };
      const numGaps = 6;
      for (let i = 1; visible && i < numGaps; i++) {
        const x = teethL + ((teethR - teethL) * i) / numGaps;
        const topY = lipYAt(x);
        const bottomY = biteAt(x) - Math.max(0.5, teethHeight * 0.3);
        if (bottomY <= topY + 1.5) continue;
        ctx.beginPath();
        ctx.moveTo(x, topY + 1);
        ctx.lineTo(x, bottomY);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Eyebrow raise: shift a small brow strip upward (tier 1, needs brow landmarks). */
  private drawBrows(ctx: Ctx, amount: number) {
    const source = this.offscreen;
    if (!source || !this.browLeftPx?.length || !this.browRightPx?.length) return;
    const lift = this.h * 0.012 * amount;
    for (const brow of [this.browLeftPx, this.browRightPx]) {
      const xs = brow.map((p) => p.x);
      const ys = brow.map((p) => p.y);
      const x = Math.min(...xs) - 4;
      const y = Math.min(...ys) - this.h * 0.02;
      const bw = Math.max(...xs) - Math.min(...xs) + 8;
      const bh = Math.max(...ys) - Math.min(...ys) + this.h * 0.035;
      if (bw <= 0 || bh <= 0) continue;
      ctx.drawImage(source, x, y, bw, bh, x, y - lift, bw, bh);
    }
  }

  /** Blink: a lid-coloured ellipse sweeping the eye (lid colour sampled once, at build). */
  private drawBlink(ctx: Ctx, blinkAmt: number) {
    if (!this.leftEyePx || !this.rightEyePx) return;
    for (const { center, eyeW, color } of [
      { center: this.leftEyePx, eyeW: this.leftEyeWidthPx, color: this.leftLidColor },
      { center: this.rightEyePx, eyeW: this.rightEyeWidthPx, color: this.rightLidColor },
    ]) {
      if (!eyeW) continue;
      ctx.save();
      ctx.fillStyle = color;
      const halfW = eyeW * 0.8;
      const topY = center.y - eyeW * 0.35;
      const bottomY = center.y + eyeW * 0.15;
      const lidY = topY + (bottomY - topY) * blinkAmt;
      ctx.beginPath();
      ctx.ellipse(center.x, lidY, halfW, eyeW * 0.35 * blinkAmt, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /** Geometry/lifecycle diagnostics for harnesses and QA. */
  stats() {
    return {
      tier: this.tier,
      width: this.w,
      height: this.h,
      frames: this.frames,
      destroyed: this.destroyed,
      mouthRegion: this.mouthRegion(),
      lipBox: this.lipBox(),
    };
  }

  /** Release the offscreen copy. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.offscreen) {
      this.offscreen.width = 0;
      this.offscreen.height = 0;
    }
    this.offscreen = null;
    this.offCtx = null;
    this.direct = null;
  }
}
