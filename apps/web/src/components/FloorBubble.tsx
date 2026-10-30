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
/** In the Office (anchored over a face) only the office's HUD row sits above it. */
const ANCHOR_CLEARANCE_PX = 72;
/** An anchored bubble keeps this far inside the office's edges. */
const ANCHOR_EDGE_PX = 8;
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
  /** The Office: a "Follow" button beside Reply (the camera keeps them in view). */
  onFollow?(): void;
  /** 'card' (the Directory, default): anchored to the card. 'anchor': over a face in the Office. */
  placement?: 'card' | 'anchor';
}

export function FloorBubble({ agentId, first, hovered, onOpenDesk, deskLabel, onFollow, placement = 'card' }: FloorBubbleProps) {
  const b = bubbles.value[agentId];
  const replying = replyingAgent.value === agentId;
  const box = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [below, setBelow] = useState(false);

  // Open below the card when there is no room above it (the top rows, under the sticky search bar; in the Office, the
  // HUD row at the top of the office).
  useLayoutEffect(() => {
    const el = box.current;
    const card = el?.parentElement;
    if (!el || !card) return;
    const anchored = placement === 'anchor';
    const office = anchored ? card.closest('.hc-office') : null;
    const top = office?.getBoundingClientRect().top ?? 0;
    const room = card.getBoundingClientRect().top - top;
    // A reply grows as the answer streams in: keep room for it from the start, so the bubble never jumps.
    const need = replying ? Math.max(el.offsetHeight, REPLY_HEIGHT_PX) : el.offsetHeight;
    setBelow(room < need + (anchored ? ANCHOR_CLEARANCE_PX : TOP_CLEARANCE_PX));
    if (!anchored || !office) return;
    // Over a face near the office's side edges: slide the bubble in (the tail stays on the face).
    el.style.removeProperty('--bx');
    const o = office.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const dx = r.left < o.left + ANCHOR_EDGE_PX ? o.left + ANCHOR_EDGE_PX - r.left : r.right > o.right - ANCHOR_EDGE_PX ? o.right - ANCHOR_EDGE_PX - r.right : 0;
    if (dx) el.style.setProperty('--bx', `${Math.round(dx)}px`);
  }, [!!b, replying, placement]);

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
  const replyButton = (
    <button type="button" class="floor-bubble-reply" data-testid="bubble-reply" aria-label={b.card ? `Chat with ${first}` : `Reply to ${first}`} onClick={() => openReply(agentId)}>
      <Icon name="reply" size={14} />
      <span>{b.card ? 'Chat' : 'Reply'}</span>
      <kbd aria-hidden="true">R</kbd>
    </button>
  );
  // In the Office the name plates hide at some zooms and on phones: every bubble says who is speaking.
  const anchored = placement === 'anchor';
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
      data-placement={placement === 'anchor' ? 'anchor' : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation(); // Esc closes the bubble; it does not leave the page
          closeReply({ dismiss: true });
          dismissBubble(agentId);
        }
      }}
    >
      {anchored && (
        <p class="floor-bubble-who" data-testid="bubble-who">
          {first}
        </p>
      )}
      {b.text && !echo && (
        <p class="floor-bubble-text" data-card={b.card || undefined}>
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
      ) : onFollow ? (
        <div class="floor-bubble-actions">
          {b.replyable && replyButton}
          <button type="button" class="floor-bubble-follow" data-testid="bubble-follow" aria-label={`Follow ${first}`} onClick={() => onFollow()}>
            Follow
          </button>
        </div>
      ) : (
        b.replyable && replyButton
      )}
    </div>
  );
}
