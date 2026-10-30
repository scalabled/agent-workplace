// The passing-by dwell rule (LIVING-WORKFORCE §8.1): `enter` fires at once; `dwell` fires when the
// pointer has rested ≥ 600 ms below 0.3 px/ms on the same person (keyboard focus: held 900 ms). Camera motion counts
// as pointer motion, so nothing dwells during a pan or under inertia.
import type { HoverVia } from '../types';

export interface DwellOptions {
  onEnter(id: string, via: HoverVia): void;
  onDwell(id: string, via: HoverVia): void;
  onLeave(id: string, via: HoverVia): void;
  now?: () => number;
  dwellMs?: number;
  keyboardMs?: number;
  /** px/ms */
  maxSpeed?: number;
}

export interface Dwell {
  /** The pointer is at (x, y) over `id` (or over nobody). */
  pointer(id: string | null, x: number, y: number, via?: HoverVia): void;
  /** Keyboard focus moved to `id` (or left the seats). */
  keyboard(id: string | null): void;
  /** A touch tap: enter + dwell at once. */
  tap(id: string): void;
  /** The camera moved: restart the rest timer. */
  cameraMoved(): void;
  readonly current: string | null;
  clear(): void;
  destroy(): void;
}

export function createDwell(opts: DwellOptions): Dwell {
  const now = opts.now ?? (() => performance.now());
  const dwellMs = opts.dwellMs ?? 600;
  const keyboardMs = opts.keyboardMs ?? 900;
  const maxSpeed = opts.maxSpeed ?? 0.3;
  let current: string | null = null;
  let via: HoverVia = 'pointer';
  let dwelt = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: { x: number; y: number; t: number } | null = null;

  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const arm = (ms: number) => {
    stop();
    if (!current || dwelt) return;
    const id = current;
    timer = setTimeout(() => {
      timer = null;
      if (current === id && !dwelt) {
        dwelt = true;
        opts.onDwell(id, via);
      }
    }, ms);
  };
  const leave = () => {
    stop();
    if (current) opts.onLeave(current, via);
    current = null;
    dwelt = false;
  };
  const enter = (id: string, how: HoverVia) => {
    if (current === id) return false;
    leave();
    current = id;
    via = how;
    dwelt = false;
    opts.onEnter(id, how);
    return true;
  };

  return {
    pointer(id, x, y, how = 'pointer') {
      const t = now();
      const speed = last ? Math.hypot(x - last.x, y - last.y) / Math.max(1, t - last.t) : 0;
      last = { x, y, t };
      if (!id) {
        if (current && via !== 'keyboard') leave();
        return;
      }
      if (enter(id, how) || speed >= maxSpeed) arm(dwellMs);
    },
    keyboard(id) {
      if (!id) {
        if (current && via === 'keyboard') leave();
        return;
      }
      enter(id, 'keyboard');
      arm(keyboardMs);
    },
    tap(id) {
      enter(id, 'touch');
      if (!dwelt) {
        dwelt = true;
        opts.onDwell(id, 'touch');
      }
    },
    cameraMoved() {
      if (current && !dwelt && via !== 'keyboard') arm(dwellMs);
    },
    get current() {
      return current;
    },
    clear: leave,
    destroy() {
      stop();
      current = null;
    },
  };
}
