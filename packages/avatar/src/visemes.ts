// The render side of lip sync: the shared viseme shape table and the mapping from any MouthSample to shape
// params (ported from personagram-ai/src/web/avatar/face-lipsync.js). Lip sync itself (spectral features,
// text and alignment timing, fusion) lives in packages/audio; faces only draw what its samplers report.
import { VISEME_PARAMS, type MouthSample, type VisemeId, type VisemeParams } from '@headcount/protocol';

export type { VisemeId, VisemeParams };

/** The shared viseme shape table (@headcount/protocol VISEME_PARAMS). */
export const VISEMES: Readonly<Record<VisemeId, Readonly<VisemeParams>>> = VISEME_PARAMS;

export const REST_PARAMS: Readonly<VisemeParams> = VISEMES.REST;

// ── params ↔ normalised MouthSample fields ─────────────────────────────────────

const OPEN_FULL = VISEMES.OPEN_WIDE.openY + VISEMES.OPEN_WIDE.jawDrop; // 0.062
const STRETCH_FULL = VISEMES.WIDE.stretchX; // 0.03
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Normalised openness/width/round from rich params (for consumers that only read the 0–1 fields). */
export function paramsToMouth(p: VisemeParams): Pick<MouthSample, 'openness' | 'width' | 'round'> {
  return {
    openness: clamp01((p.openY + p.jawDrop) / OPEN_FULL),
    width: clamp01(Math.max(0, p.stretchX) / STRETCH_FULL * 0.75 + p.cornerPull * 0.6),
    round: clamp01(p.round),
  };
}

/**
 * Rich params from a sample. Samplers that already carry `params` (the fusion driver) are used as
 * is; samplers that only give the normalised fields (a plain envelope, the browser-speech fallback)
 * are mapped into the same space, so every face renders any sampler.
 */
export function sampleToParams(s: MouthSample): VisemeParams {
  if (s.params) return s.params;
  const open = clamp01(Number(s.openness) || 0);
  const width = clamp01(Number(s.width) || 0);
  const round = clamp01(Number(s.round) || 0);
  return {
    openY: open * VISEMES.OPEN_WIDE.openY,
    stretchX: width * STRETCH_FULL - round * 0.025,
    jawDrop: open * VISEMES.OPEN_WIDE.jawDrop,
    cornerPull: width * 0.4 * (1 - open * 0.5),
    round,
  };
}
