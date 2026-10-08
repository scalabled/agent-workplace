// A mic button (Talk's composer, a room's dock): hold to talk and let go to send, or tap to open the mic and tap again
// to send. A tap is what most people do on a phone, and the first press there is often spent on the browser's
// microphone prompt, which interrupts the touch: an interrupted press keeps the mic open (tap again to send) instead
// of throwing the recording away. Space or Enter on the focused button works the same way.
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { armAudio } from '../voice/engine';
import { endPtt, ptt, pttLatched, startPtt } from '../voice/ptt';

/** A press shorter than this is a tap: the mic stays open until the next one. */
export const LATCH_MS = 300;

type Handlers = Pick<JSX.HTMLAttributes<HTMLButtonElement>, 'onPointerDown' | 'onPointerUp' | 'onPointerCancel' | 'onContextMenu' | 'onClick' | 'onKeyDown' | 'onKeyUp'>;

export function useMicButton(): Handlers {
  const pressedAt = useRef(0);
  const swallowUp = useRef(false);
  const phase = ptt.value.phase;
  useEffect(() => {
    if (phase === 'idle') pttLatched.value = false;
  }, [phase]);

  const down = () => {
    if (pttLatched.peek()) {
      // The second tap sends.
      pttLatched.value = false;
      swallowUp.current = true;
      endPtt();
      return;
    }
    pressedAt.current = Date.now();
    armAudio();
    startPtt();
  };
  const up = (interrupted = false) => {
    if (swallowUp.current) {
      swallowUp.current = false;
      return;
    }
    if (ptt.peek().phase === 'idle') return;
    if (interrupted || Date.now() - pressedAt.current < LATCH_MS) {
      pttLatched.value = true;
      return;
    }
    endPtt();
  };

  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
      down();
    },
    onPointerUp: () => up(),
    // The microphone prompt (or the system) took the touch: keep listening; the next tap sends.
    onPointerCancel: () => up(true),
    onContextMenu: (e) => e.preventDefault(),
    onKeyDown: (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        down();
      }
    },
    onKeyUp: (e) => {
      if (e.key === ' ' || e.key === 'Enter') up();
    },
    onClick: (e) => e.preventDefault(),
  };
}
