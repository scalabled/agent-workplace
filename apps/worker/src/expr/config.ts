// Limits and timings of the living-workforce layer in the worker (docs/dev/INC05-PLAN.md §3.4, §3.5).
import type { Env } from '../env';

/** Env-backed limits (all optional; defaults here). */
export const EXPR_LIMITS = {
  /** Clip renders per UTC day (runtime + pre-voice), counted in D1 media_usage kind `expr_clip`. Mock is free. */
  clipDaily: { env: 'EXPR_CLIP_DAILY_LIMIT', fallback: 600 },
  /** Runtime renders (POST /api/expr/render) per minute, counted in the WorkspaceDO. */
  renderPerMin: { env: 'EXPR_RENDER_PER_MIN', fallback: 30 },
  /** Default clips per pre-voice run. */
  prevoiceMaxClips: { env: 'EXPR_PREVOICE_MAX_CLIPS', fallback: 300 },
} as const;

/** Hard ceiling of one pre-voice run, whatever EXPR_PREVOICE_MAX_CLIPS says. */
export const PREVOICE_CEILING = 600;
/** Floor quick-chat messages per minute per workspace. */
export const DESK_PER_MIN = 12;
/** The D1 media_usage kind for clip renders. */
export const EXPR_CLIP_USAGE_KIND = 'expr_clip';

type LimitName = keyof typeof EXPR_LIMITS;

export function exprLimit(env: Env, name: LimitName): number {
  const def = EXPR_LIMITS[name];
  const raw = (env as unknown as Record<string, string | undefined>)[def.env];
  const n = Number(raw);
  const value = raw !== undefined && raw !== '' && Number.isInteger(n) && n >= 0 ? n : def.fallback;
  return name === 'prevoiceMaxClips' ? Math.min(PREVOICE_CEILING, value) : value;
}

/**
 * Server reflex timings (INC05-PLAN §3.4). Mutable so tests can shorten them; production uses these values.
 * - `fillerVoiceMs` / `fillerTextMs`: the thinking-filler safety net fires when no text delta arrived this long
 *   after the server turn started (voice / text exchange). In text the client's own "one sec" adapts to the model's
 *   usual first-token time (never before 2.5 s); the server's net comes later, so a common 2.8 s answer never gets
 *   a bubble that flashes for a quarter of a second.
 * - `microStatusTtlMs`: a coalesced progress line older than this is dropped, never played late.
 * - `microStatusAfterTurnMs`: a progress line waits for the active turn to end, plus this.
 * - `microStatusCooldownMs`: at most one progress line per agent in this window.
 * - `moodCoalesceMs`: at most one small mood update per agent in this window.
 * - `recencySaveMs`: the workspace recency memory is saved at most this often.
 */
export const exprTiming = {
  fillerVoiceMs: 1200,
  fillerTextMs: 4000,
  microStatusTtlMs: 20_000,
  microStatusAfterTurnMs: 400,
  microStatusCooldownMs: 120_000,
  moodCoalesceMs: 10_000,
  recencySaveMs: 5_000,
};

export const defaultExprTiming = { ...exprTiming };
