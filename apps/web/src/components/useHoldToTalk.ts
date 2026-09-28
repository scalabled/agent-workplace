// Tap vs hold on a face/bubble: a quick tap runs `onTap`; holding past 250 ms is push-to-talk
// until release. Pointer capture keeps the hold alive if the finger drifts off the target. Keyboard users get
// the same gesture: a quick Space is a tap (the button's own click), holding Space talks.
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { armAudio } from '../voice/engine';
import { endPtt, startPtt } from '../voice/ptt';

const HOLD_MS = 250;

type Handlers = Pick<JSX.HTMLAttributes<HTMLButtonElement>, 'onPointerDown' | 'onPointerUp' | 'onPointerCancel' | 'onContextMenu' | 'onClick' | 'onKeyDown' | 'onKeyUp' | 'onBlur'>;

/** A hold ends with a click the browser may or may not send: forget the swallow after this long. */
const SWALLOW_MS = 400;

export function useHoldToTalk(opts: { canHold: boolean; onTap: () => void }): Handlers {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const holding = useRef(false);
  const suppressClick = useRef(false);

  const swallowTimer = useRef<ReturnType<typeof setTimeout>>();

  const release = () => {
    clearTimeout(timer.current);
    if (holding.current) {
      holding.current = false;
      suppressClick.current = true;
      clearTimeout(swallowTimer.current);
      swallowTimer.current = setTimeout(() => (suppressClick.current = false), SWALLOW_MS);
      void endPtt();
    }
  };

  const arm = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      holding.current = true;
      void startPtt();
    }, HOLD_MS);
  };

  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      armAudio();
      if (!opts.canHold) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
      arm();
    },
    onPointerUp: release,
    onPointerCancel: release,
    // Space held on the focused face or bubble talks; a quick press stays a tap (the native click follows).
    onKeyDown: (e) => {
      if (e.key !== ' ' || e.repeat || !opts.canHold) return;
      armAudio();
      arm();
    },
    onKeyUp: (e) => {
      if (e.key === ' ') release();
    },
    onBlur: release,
    onContextMenu: (e) => e.preventDefault(),
    onClick: (e) => {
      // A hold ends with a click event: it was push-to-talk, not a tap.
      if (suppressClick.current) {
        suppressClick.current = false;
        e.preventDefault();
        return;
      }
      armAudio();
      opts.onTap();
    },
  };
}
