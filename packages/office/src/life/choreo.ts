// Huddle choreography (OFFICE-LIFE §3.2): reading times, turn timing, facing and leans. Pure.
import type { Facing, Point } from '../types';
import type { HuddleScript, HuddleScriptLine } from './types';

/** Bubble reading time: clamp(1,800 + 55 ms × chars, 2,200, 6,000). */
export const readingMs = (text: string): number => Math.max(2200, Math.min(6000, 1800 + 55 * text.length));
export const LAUGH_MS: [number, number] = [1200, 1600];
export const FACE_MS = 900;
/** Quiet time after the group gathers, before anyone speaks. */
export const SETTLE_MS: [number, number] = [1200, 2500];
/** The pause between turns when a line has no pause of its own. */
export const PAUSE_MS: [number, number] = [600, 1200];
/** A second exchange waits this long after the first ends. */
export const SECOND_EXCHANGE_GAP_MS = 20_000;
/** An exchange needs this much huddle time left. */
export const MIN_LEFT_MS = 12_000;
/** Huddles closer than this share one talk token (no overlapping bubbles). */
export const TALK_TOKEN_U = 80;
/** Face-badge lean toward the speaker (deg). */
export const LEAN_DEG = 6;

export interface TimedTurn {
  line: HuddleScriptLine;
  index: number;
  /** Offset from the exchange start (ms). */
  at: number;
  /** How long the bubble or beat shows (ms). */
  ttl: number;
}

/**
 * Sequential, non-overlapping turns: each turn starts no earlier than its script time and never before the previous
 * bubble has been read, plus a pause. One bubble per huddle at a time.
 */
export function timeTurns(script: HuddleScript, rand: () => number): TimedTurn[] {
  const out: TimedTurn[] = [];
  let free = 0;
  script.lines.forEach((line, index) => {
    const ttl = line.kind === 'line' ? readingMs(line.text) : line.kind === 'laugh' ? LAUGH_MS[0] + rand() * (LAUGH_MS[1] - LAUGH_MS[0]) : FACE_MS;
    const pause = index === 0 ? 0 : PAUSE_MS[0] + rand() * (PAUSE_MS[1] - PAUSE_MS[0]);
    const at = Math.max(line.atMs, free + pause);
    out.push({ line, index, at, ttl });
    free = at + ttl;
  });
  return out;
}

export const exchangeLength = (turns: readonly TimedTurn[]): number => (turns.length ? turns[turns.length - 1]!.at + turns[turns.length - 1]!.ttl : 0);

export function centroid(points: readonly Point[]): Point {
  if (!points.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

export const facingToward = (from: Point, to: Point): Facing => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n';
};

/** Lean (deg, + = toward screen right) of a listener toward the speaker. */
export const leanToward = (from: Point, to: Point): number => {
  const dx = to.x - from.x;
  if (Math.abs(dx) < 0.5) return 0;
  return dx > 0 ? LEAN_DEG : -LEAN_DEG;
};
