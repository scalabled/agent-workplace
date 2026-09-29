// The conference stage's dock (OFFICE-PHASE2 §4.4.3), rendered with Preact into scene.dock(): one field to message
// the room (Enter sends; hold Space in the empty field, or hold the mic, to talk; Esc on an empty field leaves — the
// scene handles that), the live words while push-to-talk listens, one line for errors, and a collapsed Transcript: the
// accessible, non-live record of every line of the meeting, lines cut before they played marked "not heard".
import { signal, type Signal } from '@preact/signals';
import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useHoldToTalk } from '../components/useHoldToTalk';
import { armAudio } from '../voice/engine';
import { ptt, pttMode, pttPressTarget } from '../voice/ptt';
import { notice } from '../ui/notice';
import type { RoomTranscriptLine } from './session';
import './room.css';

export interface DockModel {
  roomId: string;
  /** "Skyline room". */
  roomName: string;
  /** Who is at the table now (the scene's truth). */
  participants: Signal<readonly string[]>;
  /** The meeting's lines (refreshed on every room event). */
  lines: Signal<readonly RoomTranscriptLine[]>;
  /** One sentence with its fix, or null. */
  error: Signal<string | null>;
  /** Text to put in the field (Enter on a participant: "@Juno "), bumped to apply again. */
  mention: Signal<{ text: string; n: number } | null>;
  nameOf(agentId: string): string;
  send(text: string): void;
  invite(): void;
}

/** Room Enter on a participant: "@Juno ". */
export function mentionFor(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first ? `@${first} ` : '';
}

/** Touch devices have no Space bar to hold. */
function coarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export function RoomDock({ model }: { model: DockModel }) {
  const input = useRef<HTMLInputElement>(null);
  const people = model.participants.value;
  const err = model.error.value;
  const mention = model.mention.value;
  const mode = pttMode();
  const press = pttPressTarget.value;
  const here = press?.kind === 'room' && press.roomId === model.roomId;
  const { phase, partial } = ptt.value;
  const listening = here && phase !== 'idle';
  const pttNotice = here && phase === 'idle' ? notice.value : null;
  const holdHandlers = useHoldToTalk({ canHold: mode !== null, onTap: () => input.current?.focus() });

  useEffect(() => {
    if (!mention || !input.current) return;
    const el = input.current;
    el.value = mention.text + el.value.replace(/^@\S+\s*/, '');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [mention?.n]);

  const send = (e: Event) => {
    e.preventDefault();
    const el = input.current;
    const text = el?.value.trim() ?? '';
    if (!text || !el) return el?.focus();
    armAudio();
    el.value = '';
    model.error.value = null;
    model.send(text);
  };

  if (!people.length)
    return (
      <div class="room-dock" data-testid="room-dock" data-empty="">
        <button type="button" class="hc-o-btn hc-o-btn--primary room-dock__invite" onClick={() => model.invite()}>
          Invite people <kbd>I</kbd>
        </button>
      </div>
    );

  const placeholder = mode && !coarsePointer() ? 'Message the room, or hold Space to talk' : 'Message the room';
  const lines = model.lines.value;
  return (
    <div class="room-dock" data-testid="room-dock">
      {listening && (
        <p class="room-dock__live" data-testid="room-dock-live">
          <span class="room-dock__dot" aria-hidden="true" />
          {phase === 'transcribing' ? 'Sending…' : partial ? partial : `Listening. Release to send to the ${model.roomName}.`}
        </p>
      )}
      {!listening && (err || pttNotice) && (
        <p class="room-dock__notice" role="alert" data-testid="room-dock-error">
          {err ?? pttNotice?.text}
        </p>
      )}
      <form class="hc-o-compose room-dock__form" onSubmit={send}>
        <input
          ref={input}
          class="hc-o-input"
          type="text"
          data-ptt-hold=""
          placeholder={placeholder}
          aria-label={`Message the ${model.roomName}`}
          autoComplete="off"
          maxLength={2000}
          enterKeyHint="send"
        />
        {mode && (
          <button type="button" class="hc-o-btn room-dock__mic" data-active={listening || undefined} aria-label={listening ? 'Listening. Release to send' : 'Hold to talk to the room'} title="Hold to talk" {...holdHandlers}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
        <button type="submit" class="hc-o-btn hc-o-btn--primary">
          Send
        </button>
      </form>
      {lines.length > 0 && (
        <details class="room-dock__transcript">
          <summary>Transcript</summary>
          <ol aria-label={`Transcript of the ${model.roomName} meeting`}>
            {lines.map((l, i) => (
              <li key={i} data-heard={l.heard || undefined}>
                <b>{l.agentId === 'owner' ? 'You' : model.nameOf(l.agentId).split(/\s+/)[0]}:</b> {l.text}
                {!l.heard && <span class="room-dock__unheard"> (not heard)</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export interface MountedDock {
  unmount(): void;
}

/** Render the dock into the stage's dock element (scene.dock()); unmount leaves the element empty. */
export function mountRoomDock(el: HTMLElement, model: DockModel): MountedDock {
  render(<RoomDock model={model} />, el);
  return { unmount: () => render(null, el) };
}

/** A fresh model's signals. */
export function dockSignals(): Pick<DockModel, 'participants' | 'lines' | 'error' | 'mention'> {
  return { participants: signal<readonly string[]>([]), lines: signal<readonly RoomTranscriptLine[]>([]), error: signal<string | null>(null), mention: signal(null) };
}
