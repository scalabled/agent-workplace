// A line next to a face on the Floor (LIVING-WORKFORCE §8.1–8.2): at most two lines, anchored to the card, gone
// after its TTL (4 s + 60 ms a character, ≤ 9 s) unless its card is hovered or focus is inside it (then it stays,
// and 3 s after). Reply (click, or R) opens a one-line field in place; Esc closes; Enter on an empty field opens
// their profile. Never announced live: the Directory row carries the last line for screen readers.
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { bubbles, dismissBubble, holdBubble, openReplyBubble } from '../living/captions';
import { Icon } from './Icon';
import { SideThread, sideItems } from './SideThread';

/** Space kept free above a bubble (the sticky search bar and a margin). */
const TOP_CLEARANCE_PX = 120;
/** About the height of a bubble with an exchange in it (the line, you, the answer, the field). */
const REPLY_HEIGHT_PX = 200;

/** The agent whose bubble has its reply field open (one at a time). */
export const replyingAgent = signal<string | null>(null);

/** Open the reply field in an agent's bubble (the Reply button, or R on a hovered or focused card). */
export function openReply(agentId: string): void {
  if (replyingAgent.peek() === agentId) return;
  closeReply();
  openReplyBubble(agentId);
  replyingAgent.value = agentId;
}

/** Close the reply field; `dismiss` also takes the bubble away (Esc). */
export function closeReply(opts: { dismiss?: boolean } = {}): void {
  const agentId = replyingAgent.peek();
  if (!agentId) return;
  replyingAgent.value = null;
  if (opts.dismiss) dismissBubble(agentId);
}

export interface FloorBubbleProps {
  agentId: string;
  first: string;
  /** The card under the bubble is hovered (the bubble sits inside it). */
  hovered: boolean;
  /** Their profile (a coworker) or Talk (the Chief of Staff). */
  onOpenDesk(): void;
  deskLabel?: string;
}

export function FloorBubble({ agentId, first, hovered, onOpenDesk, deskLabel }: FloorBubbleProps) {
  const b = bubbles.value[agentId];
  const replying = replyingAgent.value === agentId;
  const box = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [below, setBelow] = useState(false);

  // Open below the card when there is no room above it (the top rows, under the sticky search bar).
  useLayoutEffect(() => {
    const el = box.current;
    const card = el?.parentElement;
    if (!el || !card) return;
    const room = card.getBoundingClientRect().top;
    // A reply grows as the answer streams in: keep room for it from the start, so the bubble never jumps.
    const need = replying ? Math.max(el.offsetHeight, REPLY_HEIGHT_PX) : el.offsetHeight;
    setBelow(room < need + TOP_CLEARANCE_PX);
  }, [!!b, replying]);

  // Focus inside the bubble (its Reply button, the field) holds it open like a hover.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const on = () => setFocused(true);
    const off = (e: FocusEvent) => setFocused(el.contains(e.relatedTarget as Node | null));
    el.addEventListener('focusin', on);
    el.addEventListener('focusout', off);
    return () => {
      el.removeEventListener('focusin', on);
      el.removeEventListener('focusout', off);
    };
  }, [!!b]);

  const held = hovered || focused;
  useEffect(() => {
    if (b) holdBubble(agentId, held);
  }, [held, !!b, agentId]);

  // A bubble that expires closes its field too.
  useEffect(() => {
    if (!b && replying) replyingAgent.value = null;
  }, [!!b, replying]);

  if (!b) return null;
  // A reply said in place is already the answer below: the line above keeps to what was said first, never a copy.
  const echo = replying && !!b.text && sideItems(agentId, true).slice(-3).some((m) => m.from === agentId && m.text.trim() === b.text);
  return (
    <div
      ref={box}
      class="floor-bubble"
      data-testid="floor-bubble"
      data-agent-id={agentId}
      data-kind={b.kind}
      data-replying={replying || undefined}
      data-below={below || undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation(); // Esc closes the bubble; it does not leave the page
          closeReply({ dismiss: true });
          dismissBubble(agentId);
        }
      }}
    >
      {b.text && !echo && (
        <p class="floor-bubble-text">
          {b.text}
          {b.gloss && <span class="floor-bubble-gloss"> ({b.gloss})</span>}
        </p>
      )}
      {replying ? (
        <SideThread
          agentId={agentId}
          first={first}
          compact
          autoFocus
          onClose={() => closeReply({ dismiss: true })}
          onOpenDesk={() => {
            closeReply();
            onOpenDesk();
          }}
          {...(deskLabel ? { deskLabel } : {})}
        />
      ) : (
        b.replyable && (
          <button type="button" class="floor-bubble-reply" data-testid="bubble-reply" aria-label={`Reply to ${first}`} onClick={() => openReply(agentId)}>
            <Icon name="reply" size={14} />
            <span>Reply</span>
            <kbd aria-hidden="true">R</kbd>
          </button>
        )
      )}
    </div>
  );
}
