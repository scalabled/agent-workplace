import { normalizeLandmarks } from '@headcount/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { configureLandmarks, DEFAULT_LANDMARKER_CONFIG, detectLandmarks, isLandmarkerReady, landmarkerConfig, landmarksFromMesh, LandmarkerUnavailableError, MESH_MIN_POINTS, type FaceMeshDetector } from './landmarks';

/** A plausible 478-point mesh: everything at the face centre, key points placed like a portrait. */
function mesh(overrides: Record<number, { x: number; y: number }> = {}) {
  const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const set: Record<number, { x: number; y: number }> = {
    10: { x: 0.5, y: 0.2 }, // forehead
    152: { x: 0.5, y: 0.8 }, // chin
    234: { x: 0.28, y: 0.5 }, // face sides
    454: { x: 0.72, y: 0.5 },
    33: { x: 0.36, y: 0.42 },
    133: { x: 0.44, y: 0.42 },
    362: { x: 0.56, y: 0.42 },
    263: { x: 0.64, y: 0.42 },
    61: { x: 0.43, y: 0.66 },
    291: { x: 0.57, y: 0.66 },
    13: { x: 0.5, y: 0.655 },
    14: { x: 0.5, y: 0.665 },
    ...overrides,
  };
  for (const [i, p] of Object.entries(set)) pts[Number(i)] = p;
  return pts;
}

afterEach(() => configureLandmarks({ ...DEFAULT_LANDMARKER_CONFIG, factory: async () => ({ detect: () => ({ faceLandmarks: [] }) }) }));

describe('landmarksFromMesh', () => {
  it('maps a FaceLandmarker mesh to the stored geometry (PG shape) that validates', () => {
    const lm = landmarksFromMesh(mesh())!;
    expect(lm).not.toBeNull();
    expect(normalizeLandmarks(lm)).toEqual(lm);
    expect(lm.face).toMatchObject({ x: 0.28, y: 0.2 });
    expect(lm.face.width).toBeCloseTo(0.44);
    expect(lm.mouthWidth).toBeCloseTo(0.14);
    expect(lm.lipUpperOuter).toHaveLength(11);
    expect(lm.lipLowerInner).toHaveLength(11);
    expect(lm.jawContour).toHaveLength(21);
    expect(lm.browLeft).toHaveLength(5);
    expect(lm.leftEye).toEqual({ x: 0.4, y: 0.42 });
    expect(lm.chin).toEqual({ x: 0.5, y: 0.8 });
  });

  it('clamps points just outside the frame instead of failing validation', () => {
    const lm = landmarksFromMesh(mesh({ 152: { x: 0.5, y: 1.012 }, 234: { x: -0.004, y: 0.5 } }))!;
    expect(lm).not.toBeNull();
    expect(lm.face.x).toBe(0);
    expect(lm.chin!.y).toBe(1);
  });

  it('rejects incomplete or degenerate meshes', () => {
    expect(landmarksFromMesh(null)).toBeNull();
    expect(landmarksFromMesh(mesh().slice(0, MESH_MIN_POINTS - 1))).toBeNull();
    expect(landmarksFromMesh(Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 })))).toBeNull();
  });
});

describe('detectLandmarks', () => {
  it('uses the pinned MediaPipe version by default and accepts vendored URLs', () => {
    expect(DEFAULT_LANDMARKER_CONFIG.wasmBaseUrl).toContain('@mediapipe/tasks-vision@0.10.35');
    configureLandmarks({ wasmBaseUrl: '/vendor/mediapipe/wasm', modelAssetPath: '/vendor/mediapipe/face_landmarker.task' });
    expect(landmarkerConfig()).toMatchObject({ wasmBaseUrl: '/vendor/mediapipe/wasm', delegate: 'GPU' });
  });

  it('detects through a shared, lazily created detector', async () => {
    let created = 0;
    const detector: FaceMeshDetector = { detect: () => ({ faceLandmarks: [mesh()] }) };
    configureLandmarks({
      factory: async (cfg) => {
        created++;
        expect(cfg.modelAssetPath).toBe(DEFAULT_LANDMARKER_CONFIG.modelAssetPath);
        return detector;
      },
    });
    const image = {} as TexImageSource;
    const [a, b] = await Promise.all([detectLandmarks(image), detectLandmarks(image)]);
    expect(a?.mouthWidth).toBeCloseTo(0.14);
    expect(b).toEqual(a);
    expect(created, 'concurrent callers share one init').toBe(1);
    expect(isLandmarkerReady()).toBe(true);
  });

  it('resolves null when no face is found', async () => {
    configureLandmarks({ factory: async () => ({ detect: () => ({ faceLandmarks: [] }) }) });
    expect(await detectLandmarks({} as TexImageSource)).toBeNull();
  });

  it('names the failure when MediaPipe cannot load, and retries on the next call', async () => {
    let attempts = 0;
    configureLandmarks({
      factory: async () => {
        attempts++;
        if (attempts === 1) throw new Error('network down');
        return { detect: () => ({ faceLandmarks: [mesh()] }) };
      },
    });
    await expect(detectLandmarks({} as TexImageSource)).rejects.toBeInstanceOf(LandmarkerUnavailableError);
    await Promise.resolve();
    expect(await detectLandmarks({} as TexImageSource)).not.toBeNull();
    expect(attempts).toBe(2);
  });
});
