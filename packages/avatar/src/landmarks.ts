// Ported from personagram-ai/src/web/avatar/face-landmarks.js — MediaPipe FaceLandmarker in the
// browser, once per portrait (ARCHITECTURE §9.2). The JS module comes from the pinned npm package
// (@mediapipe/tasks-vision 0.10.35, a lazy chunk); the WASM fileset and the model are fetched on
// first use from URLs that are CONFIG, so the web can vendor them (serve /vendor/mediapipe/…)
// instead of the CDN defaults. The singleton init is shared by concurrent callers and cleared on
// failure so a later call can retry; GPU falls back to CPU.
//
// Headcount changes: the mesh → geometry mapping is a pure function (tested without MediaPipe),
// coordinates are clamped to [0, 1] (a face touching the frame edge produced −0.001 and failed
// validation), and the result is validated with the shared normalizeLandmarks.
import { normalizeLandmarks, type FaceLandmarks, type Point } from '@headcount/protocol';

export interface LandmarkerConfig {
  /** Base URL of the tasks-vision WASM fileset (the package's `wasm/` directory). */
  wasmBaseUrl: string;
  /** URL of face_landmarker.task. */
  modelAssetPath: string;
  /** Preferred delegate; GPU falls back to CPU when it cannot start. */
  delegate: 'GPU' | 'CPU';
}

/** Version-pinned defaults (`@latest` can break landmark capture silently on a CDN bump). */
export const DEFAULT_LANDMARKER_CONFIG: Readonly<LandmarkerConfig> = Object.freeze({
  wasmBaseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
  modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  delegate: 'GPU',
});

/** The detector surface we use (MediaPipe FaceLandmarker, or a fake in tests). */
export interface FaceMeshDetector {
  detect(image: TexImageSource): { faceLandmarks?: { x: number; y: number }[][] };
  close?(): void;
}

export type DetectorFactory = (config: LandmarkerConfig) => Promise<FaceMeshDetector>;

export class LandmarkerUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'LandmarkerUnavailableError';
  }
}

let config: LandmarkerConfig = { ...DEFAULT_LANDMARKER_CONFIG };
let factory: DetectorFactory = mediapipeFactory;
let detector: FaceMeshDetector | null = null;
let initPromise: Promise<FaceMeshDetector> | null = null;

async function mediapipeFactory(cfg: LandmarkerConfig): Promise<FaceMeshDetector> {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(cfg.wasmBaseUrl);
  const create = (delegate: 'GPU' | 'CPU') =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: cfg.modelAssetPath, delegate },
      runningMode: 'IMAGE',
      numFaces: 1,
    });
  try {
    return await create(cfg.delegate);
  } catch (err) {
    if (cfg.delegate === 'CPU') throw err;
    return await create('CPU');
  }
}

/**
 * Point the landmarker at vendored assets (or swap the detector in tests). Resets the singleton
 * when anything changes.
 */
export function configureLandmarks(next: Partial<LandmarkerConfig> & { factory?: DetectorFactory }): void {
  const { factory: nextFactory, ...rest } = next;
  const merged = { ...config, ...rest };
  const changed = JSON.stringify(merged) !== JSON.stringify(config) || (nextFactory && nextFactory !== factory);
  config = merged;
  if (nextFactory) factory = nextFactory;
  if (changed) {
    detector?.close?.();
    detector = null;
    initPromise = null;
  }
}

export function landmarkerConfig(): Readonly<LandmarkerConfig> {
  return config;
}

async function ensureDetector(): Promise<FaceMeshDetector> {
  if (detector) return detector;
  if (!initPromise) {
    const pending = factory(config);
    initPromise = pending;
    pending.then(
      (d) => {
        if (initPromise === pending) detector = d;
      },
      () => {
        if (initPromise === pending) initPromise = null; // allow a retry on the next call
      },
    );
  }
  try {
    return await initPromise;
  } catch (err) {
    throw new LandmarkerUnavailableError('Face mapping could not load. The portrait stays still.', err);
  }
}

/** Warm the landmarker (e.g. while a portrait downloads). Safe to call repeatedly. */
export function preloadLandmarker(): Promise<void> {
  return ensureDetector().then(
    () => undefined,
    () => undefined,
  );
}

export function isLandmarkerReady(): boolean {
  return detector !== null;
}

// MediaPipe 468/478-point mesh indices (see face-landmarks.js):
// 33/133 left eye corners · 362/263 right eye corners · 1 nose tip · 168 nose bridge
// 13/14 inner lip centre top/bottom · 61/291 mouth corners · 10 forehead · 152 chin · 234/454 face sides
const LIP_UPPER_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
const LIP_UPPER_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LIP_LOWER_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
const LIP_LOWER_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
const JAW = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454];
const LEFT_UPPER_LID = [159, 160, 161, 163, 144, 145];
const RIGHT_UPPER_LID = [386, 387, 388, 390, 373, 374];
const LEFT_LOWER_LID = [33, 7, 163, 144, 145, 153, 154, 155, 133];
const RIGHT_LOWER_LID = [362, 382, 381, 380, 374, 373, 390, 249, 263];
const BROW_LEFT = [70, 63, 105, 66, 107];
const BROW_RIGHT = [336, 296, 334, 293, 300];
/** Highest index used; a mesh shorter than this is not a FaceLandmarker mesh. */
export const MESH_MIN_POINTS = 455;

const c01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Map a FaceLandmarker mesh (normalised image coordinates) to the stored face geometry, clamped to
 * [0, 1] and validated. Returns null when the mesh is incomplete or the geometry is invalid.
 */
export function landmarksFromMesh(mesh: readonly { x: number; y: number }[] | null | undefined): FaceLandmarks | null {
  if (!mesh || mesh.length < MESH_MIN_POINTS) return null;
  const pt = (i: number): Point => ({ x: c01(mesh[i]!.x), y: c01(mesh[i]!.y) });
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const leftEye = mid(pt(33), pt(133));
  const rightEye = mid(pt(362), pt(263));
  const mouthTop = pt(13);
  const mouthBottom = pt(14);
  const faceLeft = pt(234).x;
  const faceRight = pt(454).x;
  const faceTop = pt(10).y;
  const faceBottom = pt(152).y;
  const raw = {
    face: {
      x: faceLeft,
      y: faceTop,
      width: Math.abs(faceRight - faceLeft),
      height: Math.abs(faceBottom - faceTop),
      centerX: (faceLeft + faceRight) / 2,
      centerY: (faceTop + faceBottom) / 2,
    },
    leftEye,
    rightEye,
    nose: pt(1),
    noseBridge: pt(168),
    mouth: mid(mouthTop, mouthBottom),
    eyeSpan: Math.abs(rightEye.x - leftEye.x),
    leftEyeWidth: Math.abs(pt(133).x - pt(33).x),
    rightEyeWidth: Math.abs(pt(263).x - pt(362).x),
    mouthWidth: Math.abs(pt(291).x - pt(61).x),
    mouthHeight: Math.abs(mouthBottom.y - mouthTop.y),
    lipUpperOuter: LIP_UPPER_OUTER.map(pt),
    lipUpperInner: LIP_UPPER_INNER.map(pt),
    lipLowerOuter: LIP_LOWER_OUTER.map(pt),
    lipLowerInner: LIP_LOWER_INNER.map(pt),
    jawContour: JAW.map(pt),
    leftUpperEyelid: LEFT_UPPER_LID.map(pt),
    rightUpperEyelid: RIGHT_UPPER_LID.map(pt),
    leftLowerEyelid: LEFT_LOWER_LID.map(pt),
    rightLowerEyelid: RIGHT_LOWER_LID.map(pt),
    browLeft: BROW_LEFT.map(pt),
    browRight: BROW_RIGHT.map(pt),
    mouthCornerLeft: pt(61),
    mouthCornerRight: pt(291),
    chin: pt(152),
  };
  if (!(raw.face.width > 0.01 && raw.face.height > 0.01 && raw.mouthWidth > 0.001)) return null;
  try {
    return normalizeLandmarks(raw);
  } catch {
    return null;
  }
}

/**
 * Detect the face geometry of a decoded image, ready for PUT /api/portraits/:id/landmarks.
 * Resolves null when no face is found; rejects with LandmarkerUnavailableError when MediaPipe
 * cannot load (offline, blocked); the caller keeps the still portrait.
 */
export async function detectLandmarks(image: TexImageSource): Promise<FaceLandmarks | null> {
  const d = await ensureDetector();
  const result = d.detect(image);
  const mesh = result.faceLandmarks?.[0];
  return landmarksFromMesh(mesh);
}
