// Additive media types (owner: media). Core request/response shapes stay in ../api.ts.
import type { PortraitGenerateResponse, PutLandmarksRequest } from '../api';

/** Largest recording POST /api/speech/stt accepts (same as STT_MAX_BYTES and the route bodyCap; the handler re-checks). */
export const STT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Largest generated portrait the worker stores (PNG, JPEG or WebP). */
export const PORTRAIT_MAX_BYTES = 5_000_000;

/** Default for PORTRAIT_DAILY_LIMIT: provider calls per UTC day, so a runaway loop cannot burn credits. */
export const PORTRAIT_DAILY_LIMIT_DEFAULT = 200;

/**
 * Response headers on GET /api/portraits/:personaId.
 * - `status` (on 404 only): `none` (never generated), `generating` (a job is running), `failed` (the last job failed).
 * - `version` (on 200 and on GET …/landmarks): changes whenever a new image replaces the old one.
 */
export const PORTRAIT_HEADERS = {
  status: 'X-Portrait-Status',
  version: 'X-Portrait-Version',
} as const;

export type PortraitJobState = 'none' | 'generating' | 'failed';

/**
 * POST /api/portraits/:personaId/generate query flags:
 * `?force=1` regenerates even when a portrait exists (and clears its landmarks);
 * `?wait=1` generates inside the request and answers 200 when the image is stored (used by
 * scripts/portraits-generate.mjs); otherwise the job runs in the background and the answer is 202.
 */
export interface PortraitGenerateResult extends PortraitGenerateResponse {
  /** True when this request produced a new image (wait mode). */
  created?: boolean;
  /** Generations left today under PORTRAIT_DAILY_LIMIT, when this request used one. */
  remainingToday?: number;
}

/**
 * PUT …/landmarks may name the portrait version the landmarks were measured on (from the
 * X-Portrait-Version header). A mismatch answers 409, so geometry from a replaced image is never stored.
 */
export interface PutLandmarksRequestWithVersion extends PutLandmarksRequest {
  portraitVersion?: string;
}
