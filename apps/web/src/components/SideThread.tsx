// The quick side-thread (LIVING-WORKFORCE §8.2): chat with a coworker in place, from their Floor bubble (compact:
// the latest exchange and a one-line field) or on their profile (the whole chat). Replies stream in from the
// store's `sideThreads` and are voiced in the coworker's own voice. On the Chief of Staff's card it sends a normal
// Talk message (one conversation) and shows the reply to it.
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { speakable } from '@headcount/audio';
import { CHIEF_ID, ids, personaIdFromAgentId, type OpId } from '@headcount/protocol';
import { sideThreads, thread, type ThreadItem } from '../store';
import { retryOwnerMessage, sendDeskMessage, sendOwnerMessage } from '../talk/actions';
import { Icon } from './Icon';
import { CopyLink } from '../links/CopyLink';
import { paths } from '../router';

/** A line's own link, on the coworker's profile (the Chief's lines live in Talk). */
const lineId = (m: ThreadItem) => (m.messageId.startsWith('msg_') ? m.messageId : undefined);

function LineLink({ agentId, item }: { agentId: string; item: ThreadItem }) {
  const at = lineId(item);
  if (!at || item.streaming) return null;
  const page = agentId === CHIEF_ID ? paths.talk : paths.coworker(personaIdFromAgentId(agentId) ?? '');
  return <CopyLink page={page} at={at} label="Copy link to this message" what="Link to this message" class="msg-link" />;
}

/** After this many exchanges in a bubble, it offers the profile (or Talk) to keep going (§8.2). */
export const EXCHANGES_BEFORE_DESK = 3;

/** Owner messages sent from a bubble, per agent (this session): the bubble shows their replies. */
const bubbleOps = signal<Record<string, OpId[]>>({});

function noteOp(agentId: string, opId: OpId): void {
  const cur = bubbleOps.peek()[agentId] ?? [];
  bubbleOps.value = { ...bubbleOps.peek(), [agentId]: [...cur.slice(-19), opId] };
}

/** Everything said with this agent in place: their side-thread, or (the Chief) the Talk turns sent from the Floor. */
export function sideItems(agentId: string, onlyBubble = false): ThreadItem[] {
  const ops = new Set(bubbleOps.value[agentId] ?? []);
  const source = agentId === CHIEF_ID ? thread.value : (sideThreads.value[agentId] ?? []);
  if (!onlyBubble && agentId !== CHIEF_ID) return source;
  const owners = source.filter((m) => m.from === 'owner' && !!m.opId && ops.has(m.opId));
  const turns = new Set<string>(owners.flatMap((m) => (m.turnId ? [m.turnId] : [])));
  return source.filter((m) => owners.includes(m) || (m.from === agentId && !!m.turnId && turns.has(m.turnId) && m.kind !== 'announcement'));
}

/** The replies to one owner message, joined (usually one message; a reflex reply is one too). */
function repliesTo(items: ThreadItem[], owner: ThreadItem, agentId: string): { text: string; streaming: boolean } {
  const replies = owner.turnId ? items.filter((m) => m.from === agentId && m.turnId === owner.turnId) : [];
  return { text: replies.map((m) => m.text).join(' ').trim(), streaming: replies.some((m) => m.streaming) };
}

export interface SideThreadProps {
  agentId: string;
  /** First name, for the field and the hand-off line. */
  first: string;
  /** Bubble: the latest exchange and a one-line field. Profile: the whole chat. */
  compact?: boolean;
  autoFocus?: boolean;
  /** Esc in the field. */
  onClose?(): void;
  /** Enter on an empty field, and the "keep talking" link: open their profile (or Talk). */
  onOpenDesk?(): void;
  /** Where "keep talking" goes, in words. */
  deskLabel?: string;
}

export function SideThread({ agentId, first, compact = false, autoFocus = false, onClose, onOpenDesk, deskLabel }: SideThreadProps) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const items = sideItems(agentId, compact);
  const owners = items.filter((m) => m.from === 'owner');
  const exchanges = owners.filter((m) => m.status !== 'failed').length;
  const last = owners[owners.length - 1];

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  const send = () => {
    const t = text.trim();
    if (!t) {
      onOpenDesk?.();
      return;
    }
    setText('');
    const opId = ids.op();
    noteOp(agentId, opId);
    if (agentId === CHIEF_ID) void sendOwnerMessage(t, 'text', { opId });
    else {
      const personaId = personaIdFromAgentId(agentId);
      if (personaId) void sendDeskMessage(personaId, t, { opId });
    }
  };

  const field = (
    <form
      class="side-form needs-contributor"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label class="visually-hidden" for={`side-${agentId}`}>
        {compact ? `Reply to ${first}` : `Message ${first}`}
      </label>
      <input
        id={`side-${agentId}`}
        ref={input}
        class="side-input"
        data-testid="bubble-input"
        type="text"
        autoComplete="off"
        maxLength={2000}
        value={text}
        placeholder={compact ? `Reply to ${first}` : `Message ${first}`}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation(); // Esc closes the bubble, it does not leave the page
            onClose?.();
          }
        }}
      />
      <button type="submit" class="side-send" aria-label={`Send to ${first}`} disabled={!text.trim()}>
        <Icon name="send" size={16} />
      </button>
    </form>
  );

  if (compact) {
    const answer = last ? repliesTo(items, last, agentId) : null;
    return (
      <div class="side-thread" data-compact>
        {last && (
          <p class="side-you">
            <span class="side-who">You</span> {last.text}
          </p>
        )}
        {last?.status === 'failed' && (
          <p class="side-error" role="alert">
            {last.error ?? 'Not sent.'}{' '}
            <button type="button" class="link-button" onClick={() => (agentId === CHIEF_ID ? void retryOwnerMessage(last) : retrySide(agentId, last))}>
              Retry
            </button>
          </p>
        )}
        {last && last.status !== 'failed' && (
          <p class="side-answer" data-testid="bubble-answer" data-streaming={answer?.streaming || !answer?.text || undefined}>
            {answer?.text ? speakable(answer.text) : <span class="side-typing" aria-label={`${first} is replying`} />}
          </p>
        )}
        {exchanges >= EXCHANGES_BEFORE_DESK && onOpenDesk && (
          <button type="button" class="link-button side-more" onClick={onOpenDesk}>
            {deskLabel ?? `Keep talking on ${first}'s profile`}
          </button>
        )}
        {field}
      </div>
    );
  }

  return (
    <section class="side-thread" aria-label={`Quick chat with ${first}`}>
      {items.length > 0 && (
        <ol class="side-log">
          {items.map((m) =>
            m.from === 'owner' ? (
              <li key={m.messageId} id={lineId(m)} class="side-line" data-from="owner" data-status={m.status}>
                <LineLink agentId={agentId} item={m} />
                <span class="side-who">You</span> {m.text}
                {m.status === 'failed' && (
                  <span class="side-error" role="alert">
                    {' '}
                    {m.error ?? 'Not sent.'}{' '}
                    <button type="button" class="link-button" onClick={() => retrySide(agentId, m)}>
                      Retry
                    </button>
                  </span>
                )}
              </li>
            ) : (
              <li key={m.messageId} id={lineId(m)} class="side-line" data-from="agent" data-kind={m.kind} data-streaming={m.streaming || undefined}>
                <LineLink agentId={agentId} item={m} />
                <span class="side-who">{first}</span> {m.text ? speakable(m.text) : '…'}
                {m.interrupted && <span class="msg-note"> Interrupted</span>}
              </li>
            ),
          )}
        </ol>
      )}
      {field}
    </section>
  );
}

/** Retry a failed quick-chat message with its opId (the worker treats it as the same message). */
function retrySide(agentId: string, item: ThreadItem): void {
  const personaId = personaIdFromAgentId(agentId);
  if (!personaId || !item.opId) return;
  void sendDeskMessage(personaId, item.text, { opId: item.opId });
}
