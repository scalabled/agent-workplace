// How the owner passes by a desk on the Floor (LIVING-WORKFORCE §8.1): the pointer resting on a card 600 ms (below
// 0.3 px/ms), keyboard focus for 900 ms (a bubble, never voice), or a tap on the face on touch (no navigation for
// that tap). The card's face wakes (token → tile) while hovered so the look-up shows.
import { signal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { livingHover } from './index';
import { createDwell } from './policy';

export interface DeskHandlers {
  /** On the card's container (the card and its bubble). */
  slot: Pick<JSX.HTMLAttributes<HTMLElement>, 'onPointerEnter' | 'onPointerMove' | 'onPointerLeave' | 'onPointerDown' | 'onClickCapture'>;
  /** On the focusable card link. */
  card: Pick<JSX.HTMLAttributes<HTMLElement>, 'onFocus' | 'onBlur'>;
  hovered: boolean;
  /** Keyboard focus is on the card. */
  focused: boolean;
}

/** The desk the owner is at on the Floor (hovered or keyboard-focused): R replies to its bubble. */
export const activeDesk = signal<string | null>(null);

const schedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function useDesk(agentId: string): DeskHandlers {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const touchTap = useRef(false);
  const tracker = useMemo(() => createDwell({ onDwell: (via) => livingHover(agentId, 'dwell', via), schedule, now: clock }), [agentId]);
  useEffect(
    () => () => {
      tracker.dispose();
      livingHover(agentId, 'leave', 'pointer');
      if (activeDesk.peek() === agentId) activeDesk.value = null;
    },
    [tracker],
  );
  useEffect(() => {
    if (hovered || focused) activeDesk.value = agentId;
    else if (activeDesk.peek() === agentId) activeDesk.value = null;
  }, [hovered, focused, agentId]);

  const mouse = (e: PointerEvent) => e.pointerType !== 'touch';
  return {
    hovered,
    focused,
    slot: {
      onPointerEnter: (e) => {
        if (!mouse(e)) return;
        setHovered(true);
        livingHover(agentId, 'enter', 'pointer');
        tracker.enter(e.clientX, e.clientY);
      },
      onPointerMove: (e) => {
        if (mouse(e)) tracker.move(e.clientX, e.clientY);
      },
      onPointerLeave: (e) => {
        if (!mouse(e)) return;
        setHovered(false);
        tracker.leave();
        livingHover(agentId, 'leave', 'pointer');
      },
      onPointerDown: (e) => {
        touchTap.current = e.pointerType === 'touch' && e.target instanceof Element && !!e.target.closest('.face');
      },
      onClickCapture: (e) => {
        if (!touchTap.current) return;
        // A tap on a face on touch is a hello, not a navigation (there is no hover on touch).
        touchTap.current = false;
        e.preventDefault();
        e.stopPropagation();
        livingHover(agentId, 'enter', 'touch');
        livingHover(agentId, 'dwell', 'touch');
      },
    },
    card: {
      onFocus: (e) => {
        let visible = true;
        try {
          visible = (e.currentTarget as Element).matches(':focus-visible');
        } catch {
          /* older engines: treat focus as keyboard focus */
        }
        if (!visible) return;
        setFocused(true);
        tracker.focus();
      },
      onBlur: () => {
        setFocused(false);
        tracker.blur();
      },
    },
  };
}
