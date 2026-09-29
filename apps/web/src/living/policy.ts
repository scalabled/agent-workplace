// Small pure decisions of the living layer, kept apart so they are easy to test.

// ── sending while the Chief of Staff speaks (LIVING-WORKFORCE §2.3, INC05-PLAN §8.4) ──
/**
 * - `none`: nothing is sounding.
 * - `boundary`: stop at the end of the sentence now playing (a stop or steer cue, or more than 8 s left); the rest
 *   of the reply stays on screen.
 * - `finish`: at most 2.5 s left: finish, then the new answer.
 * - `juggle`: 2.5–8 s left: finish; the runner says "hold that thought" at the next sentence boundary and comes
 *   back with "all yours" before the new answer.
 */
export type SendWhileSpeaking = 'none' | 'finish' | 'juggle' | 'boundary';

export const FINISH_WITHIN_MS = 2500;
export const JUGGLE_WITHIN_MS = 8000;
export const STOP_CUE = 0.6;

export function sendWhileSpeaking(i: { speaking: boolean; remainingMs: number | null; stopOrSteer: number; finishWithinMs?: number; juggleWithinMs?: number }): SendWhileSpeaking {
  if (!i.speaking) return 'none';
  if (i.stopOrSteer >= STOP_CUE) return 'boundary';
  const left = i.remainingMs ?? 0;
  if (left <= (i.finishWithinMs ?? FINISH_WITHIN_MS)) return 'finish';
  if (left <= (i.juggleWithinMs ?? JUGGLE_WITHIN_MS)) return 'juggle';
  return 'boundary';
}

// ── passing by a desk on the Floor (§8.1) ──
export const DWELL_MS = 600;
export const DWELL_MAX_SPEED_PX_PER_MS = 0.3;
export const KEYBOARD_DWELL_MS = 900;

export interface DwellOptions {
  onDwell(via: 'pointer' | 'keyboard'): void;
  schedule(fn: () => void, ms: number): () => void;
  now(): number;
  dwellMs?: number;
  keyboardMs?: number;
  maxSpeed?: number;
}

export interface DwellTracker {
  enter(x: number, y: number): void;
  /** Pointer moved: a fast pass restarts the dwell (a real pause, not a pass-through). */
  move(x: number, y: number): void;
  leave(): void;
  focus(): void;
  blur(): void;
  dispose(): void;
}

/** The pointer rests ≥ 600 ms below 0.3 px/ms, or keyboard focus stays 900 ms: one dwell per visit. */
export function createDwell(o: DwellOptions): DwellTracker {
  const dwellMs = o.dwellMs ?? DWELL_MS;
  const keyboardMs = o.keyboardMs ?? KEYBOARD_DWELL_MS;
  const maxSpeed = o.maxSpeed ?? DWELL_MAX_SPEED_PX_PER_MS;
  let pointer: (() => void) | null = null;
  let keyboard: (() => void) | null = null;
  let last: { x: number; y: number; t: number } | null = null;
  let firedPointer = false;
  let firedKeyboard = false;

  const armPointer = () => {
    pointer?.();
    pointer = o.schedule(() => {
      pointer = null;
      if (firedPointer) return;
      firedPointer = true;
      o.onDwell('pointer');
    }, dwellMs);
  };

  return {
    enter(x, y) {
      last = { x, y, t: o.now() };
      firedPointer = false;
      armPointer();
    },
    move(x, y) {
      const t = o.now();
      if (!last) {
        last = { x, y, t };
        if (!firedPointer) armPointer();
        return;
      }
      const dt = t - last.t;
      const dist = Math.hypot(x - last.x, y - last.y);
      last = { x, y, t };
      if (firedPointer || dist === 0) return;
      if (dt <= 0 || dist / dt >= maxSpeed) armPointer();
    },
    leave() {
      pointer?.();
      pointer = null;
      last = null;
      firedPointer = false;
    },
    focus() {
      keyboard?.();
      firedKeyboard = false;
      keyboard = o.schedule(() => {
        keyboard = null;
        if (firedKeyboard) return;
        firedKeyboard = true;
        o.onDwell('keyboard');
      }, keyboardMs);
    },
    blur() {
      keyboard?.();
      keyboard = null;
      firedKeyboard = false;
    },
    dispose() {
      pointer?.();
      keyboard?.();
      pointer = keyboard = null;
    },
  };
}
