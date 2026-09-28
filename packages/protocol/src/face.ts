/**
 * Face contracts shared by packages/avatar (renders), packages/audio (samples what plays) and the
 * worker (stores landmarks). The one coupling between audio and a face is `MouthSampler.sample(now)`.
 */

export type VisemeId = 'REST' | 'CLOSED' | 'OPEN_SMALL' | 'OPEN_MED' | 'OPEN_WIDE' | 'ROUND' | 'WIDE' | 'TEETH' | 'TONGUE';

/** PG viseme parameter space, in image-height units (personagram-ai face-lipsync.js VISEMES). */
export interface VisemeParams {
  openY: number;
  stretchX: number;
  jawDrop: number;
  cornerPull: number;
  round: number;
}

/**
 * The one viseme shape table (PG face-lipsync.js VISEMES), shared by packages/audio (which samples what plays)
 * and packages/avatar (which draws it), so tuning never drifts between two copies. Image-height units; the
 * magnitudes stay modest (realism over cartoon: the cavity renderer re-scales them against mouth height).
 */
export const VISEME_PARAMS: Readonly<Record<VisemeId, Readonly<VisemeParams>>> = Object.freeze({
  REST: Object.freeze({ openY: 0, stretchX: 0, jawDrop: 0, cornerPull: 0, round: 0 }),
  CLOSED: Object.freeze({ openY: -0.008, stretchX: 0.015, jawDrop: 0, cornerPull: 0, round: 0 }),
  OPEN_SMALL: Object.freeze({ openY: 0.018, stretchX: 0, jawDrop: 0.004, cornerPull: 0, round: 0 }),
  OPEN_MED: Object.freeze({ openY: 0.032, stretchX: 0.008, jawDrop: 0.008, cornerPull: 0, round: 0 }),
  OPEN_WIDE: Object.freeze({ openY: 0.048, stretchX: 0.012, jawDrop: 0.014, cornerPull: 0.12, round: 0 }),
  ROUND: Object.freeze({ openY: 0.022, stretchX: -0.025, jawDrop: 0.006, cornerPull: 0, round: 1 }),
  WIDE: Object.freeze({ openY: 0.014, stretchX: 0.03, jawDrop: 0.003, cornerPull: 0.4, round: 0 }),
  TEETH: Object.freeze({ openY: 0.008, stretchX: 0.008, jawDrop: 0.002, cornerPull: 0.08, round: 0 }),
  TONGUE: Object.freeze({ openY: 0.022, stretchX: 0, jawDrop: 0.006, cornerPull: 0, round: 0 }),
});

/** One frame of mouth state. The normalised fields are always present; `params` is the rich form. */
export interface MouthSample {
  /** 0 closed … 1 fully open. */
  openness: number;
  /** 0 neutral … 1 stretched wide. */
  width: number;
  /** 0 neutral … 1 puckered. */
  round: number;
  /** 0 … 1 loudness envelope of what is actually playing. */
  energy: number;
  voiced?: boolean;
  /** True once the utterance has finished; the face may return to rest. */
  done?: boolean;
  /** False while playback is muted/ducked (barge-in): the mouth rests. */
  heard?: boolean;
  params?: VisemeParams;
  shape?: VisemeId;
  /** Where the shape came from: alignment | timed-deltas | deltas | spectrum | energy | text. */
  source?: string;
}

export interface MouthSampler {
  sample(now: number): MouthSample;
}

export const REST_SAMPLE: Readonly<MouthSample> = Object.freeze({ openness: 0, width: 0, round: 0, energy: 0, voiced: false, done: true, heard: true });

/** A sampler that always rests (no audio, reduced data, tests). */
export const restSampler: MouthSampler = { sample: () => REST_SAMPLE };

// ── landmarks ───────────────────────────────────────────────────────────────────
// Ported from personagram-ai/src/shared/landmarks.ts (normalizeLandmarks), typed.

export interface Point {
  x: number;
  y: number;
}

/** Normalised (0–1) face geometry, detected once per portrait by MediaPipe FaceLandmarker in the browser. */
export interface FaceLandmarks {
  face: { x: number; y: number; width: number; height: number; centerX: number; centerY: number };
  leftEye?: Point;
  rightEye?: Point;
  nose?: Point;
  noseBridge?: Point;
  mouth?: Point;
  mouthCornerLeft?: Point;
  mouthCornerRight?: Point;
  chin?: Point;
  eyeSpan: number;
  leftEyeWidth: number;
  rightEyeWidth: number;
  mouthWidth: number;
  mouthHeight: number;
  lipUpperOuter?: Point[];
  lipUpperInner?: Point[];
  lipLowerOuter?: Point[];
  lipLowerInner?: Point[];
  jawContour?: Point[];
  leftUpperEyelid?: Point[];
  rightUpperEyelid?: Point[];
  leftLowerEyelid?: Point[];
  rightLowerEyelid?: Point[];
  browLeft?: Point[];
  browRight?: Point[];
}

export const LANDMARKS_MAX_BYTES = 100_000;

export class LandmarksError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'LandmarksError';
  }
}

const POINT_KEYS = ['leftEye', 'rightEye', 'nose', 'noseBridge', 'mouth', 'mouthCornerLeft', 'mouthCornerRight', 'chin'] as const;
const SCALAR_KEYS = ['eyeSpan', 'leftEyeWidth', 'rightEyeWidth', 'mouthWidth', 'mouthHeight'] as const;
const CONTOUR_KEYS = [
  'lipUpperOuter',
  'lipUpperInner',
  'lipLowerOuter',
  'lipLowerInner',
  'jawContour',
  'leftUpperEyelid',
  'rightUpperEyelid',
  'leftLowerEyelid',
  'rightLowerEyelid',
  'browLeft',
  'browRight',
] as const;

/**
 * Whitelists keys, requires numbers in [0,1] and contours of 3–30 points; if `lipUpperOuter` is present
 * all four lip contours plus the jaw are required. Returns null for null/undefined; throws LandmarksError.
 */
export function normalizeLandmarks(value: unknown): FaceLandmarks | null {
  if (value == null) return null;
  if (typeof value !== 'object') throw new LandmarksError('Invalid face geometry');
  const input = value as Record<string, unknown>;
  const num = (n: unknown): number => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) throw new LandmarksError('Invalid face geometry');
    return n;
  };
  const point = (p: unknown): Point => {
    if (!p || typeof p !== 'object') throw new LandmarksError('Invalid face geometry');
    const q = p as Record<string, unknown>;
    return { x: num(q.x), y: num(q.y) };
  };
  if (!input.face || !input.mouth || !input.leftEye || !input.rightEye) throw new LandmarksError('Incomplete face geometry');
  const face = input.face as Record<string, unknown>;
  const out: Record<string, unknown> = {
    face: { x: num(face.x), y: num(face.y), width: num(face.width), height: num(face.height), centerX: num(face.centerX), centerY: num(face.centerY) },
  };
  for (const key of POINT_KEYS) if (input[key]) out[key] = point(input[key]);
  for (const key of SCALAR_KEYS) out[key] = num(input[key]);
  for (const key of CONTOUR_KEYS) {
    const v = input[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length < 3 || v.length > 30) throw new LandmarksError('Invalid face contour');
    out[key] = v.map(point);
  }
  if (out.lipUpperOuter && ['lipUpperInner', 'lipLowerOuter', 'lipLowerInner', 'jawContour'].some((k) => !out[k])) {
    throw new LandmarksError('Incomplete face contours');
  }
  return out as unknown as FaceLandmarks;
}

/** LOD tiers (ARCHITECTURE §9.4): hero 1024 px animated, tile 256 px animated (≤3), token still. */
export type FaceTier = 'hero' | 'tile' | 'token';
