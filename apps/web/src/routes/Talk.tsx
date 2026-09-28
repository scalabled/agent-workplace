// Talk: the Chief of Staff console (EXPERIENCE §3.1). The face is the status; the thread streams;
// the composer sends, holds to talk and toggles voice. Background jobs sit in the Activity rows above
// the composer, and the conversation never waits on them (D2).
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { renameLine } from '@headcount/catalog';
import { CHIEF_ID, type JobSnapshot } from '@headcount/protocol';
import { chiefName, currentLead } from '../chief';
import { catalog, loadCatalog } from '../catalog';
import { Face, leadSubject } from '../components/Face';
import { Icon } from '../components/Icon';
import { Deliverable, JobRow } from '../components/JobRow';
import { Markdown } from '../components/Markdown';
import { useHoldToTalk } from '../components/useHoldToTalk';
import { ago, now } from '../lib/time';
import { navigate, paths } from '../router';
import { activeJobs, can, chiefPresence, connection, dismissThreadItem, jobList, jobs, onboarded, settings, thread, type ThreadItem } from '../store';
import { retryOwnerMessage, sendOwnerMessage, setVoiceOn } from '../talk/actions';
import { draft, focusComposer, greetOnArrival, prefillComposer } from '../talk/draft';
import { notice } from '../ui/notice';
import { bargeIn, chiefIsSpeaking, chiefSpeaker } from '../voice/chief-voice';
import { armAudio, audioSupport } from '../voice/engine';
import { cancelPtt, endPtt, ptt, pttMode, startPtt } from '../voice/ptt';
import './talk.css';

/** The first starter always shows delegation, the heart of Talk (D2): hand it off, keep talking. */
const DELEGATE_STARTER = 'Look into three packaging suppliers near me';
const DEFAULT_STARTERS = [DELEGATE_STARTER, 'What can you take off my plate this week?', 'How do you like to work?'];
/** Finished rows sweep after 2 minutes; failures stay until dismissed (EXPERIENCE §2.2). */
const SWEEP_MS = 2 * 60_000;
/** A mic press shorter than this latches the mic open until the next tap. */
const LATCH_MS = 300;

export function Talk() {
  useEffect(() => void loadCatalog(), []);
  const s = settings.value;

  // First run lands here only after a lead is chosen.
  useEffect(() => {
    if (s && !s.leadId) navigate(paths.onboarding, { replace: true });
  }, [s?.leadId, !!s]);

  const lead = currentLead.value;
  const name = chiefName.value;
  const dock = useRef<HTMLDivElement>(null);
  /** Is the owner following the newest message (scrolled to the bottom)? Shared by the thread and the dock. */
  const stick = useRef(true);
  // A renamed Chief of Staff introduces themself by the owner's name, never the catalog one.
  const greeting = lead ? renameLine(lead.communication.greeting, lead, s?.chiefName) : '';

  // The push-to-talk caption floats just above the dock, whatever its height (activity rows come and go). When
  // the dock grows (a row opens to steer, a job starts) and the owner is following along, keep the newest
  // messages above it instead of letting the dock cover them.
  useEffect(() => {
    const el = dock.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => {
      root.style.setProperty('--dock-height', `${Math.round(el.offsetHeight)}px`);
      if (stick.current) scrollToEnd();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--dock-height');
    };
  }, [!!lead, onboarded.value]);

  // Greet once after onboarding, aloud when voice is on (the Choose click armed audio).
  useEffect(() => {
    if (!lead || !greetOnArrival.value) return;
    greetOnArrival.value = false;
    if (settings.value?.voiceOn) chiefSpeaker.say(greeting, 'greeting');
  }, [lead?.id]);

  if (!s || !onboarded.value || !lead)
    return (
      <section class="talk" aria-busy="true">
        <p class="page-lede">Opening Talk…</p>
      </section>
    );

  return (
    <section class="talk" aria-labelledby="talk-title">
      <TalkHead />
      <Thread greeting={greeting} name={name} stick={stick} />
      <div class="talk-dock" ref={dock}>
        <Activity />
        <Composer name={name} />
      </div>
    </section>
  );
}

function TalkHead() {
  const lead = currentLead.value!;
  const name = chiefName.value;
  const shown = chiefPresence.value;
  const running = activeJobs.value.length;
  const voiceOn = settings.value?.voiceOn ?? false;
  const canSpeak = can('tts') || audioSupport().speechSynthesis;
  const words = shown.state === 'idle' ? 'Available' : shown.label;
  const canHold = pttMode() !== null;
  const listening = ptt.value.phase === 'starting' || ptt.value.phase === 'listening';
  // The face is the bubble here: tap stops them speaking, hold to talk.
  const handlers = useHoldToTalk({ canHold, onTap: () => (chiefIsSpeaking() ? bargeIn() : focusComposer.value++) });
  return (
    <header class="talk-head">
      <button
        type="button"
        class="talk-face-button"
        data-state={shown.state}
        data-listening={listening || undefined}
        aria-label={`${name}, ${words}.${shown.state === 'speaking' ? ' Tap to stop.' : ''}${canHold ? ' Hold to speak.' : ''}`}
        {...handlers}
      >
        <Face subject={leadSubject(lead, name)} tier="hero" state={shown.state} sampler={chiefSpeaker.mouth} class="talk-face" decorative />
      </button>
      <div class="talk-id">
        <h1 id="talk-title">{name}</h1>
        <p class="talk-state" data-state={shown.state}>
          <span class="state-glyph" data-state={shown.state} aria-hidden="true" />
          <span>
            Chief of Staff · {words}
            {running > 0 && ` · ${running === 1 ? '1 job' : `${running} jobs`} running`}
          </span>
        </p>
      </div>
      {canSpeak && (
        <button
          type="button"
          class="icon-button talk-voice"
          aria-pressed={voiceOn}
          aria-label={voiceOn ? 'Voice on: replies are spoken' : 'Voice off: replies are text only'}
          title={voiceOn ? 'Voice on' : 'Voice off'}
          onClick={() => {
            armAudio();
            void setVoiceOn(!voiceOn);
          }}
        >
          <Icon name={voiceOn ? 'voiceOn' : 'voiceOff'} />
        </button>
      )}
    </header>
  );
}

function scrollToEnd() {
  const el = document.scrollingElement ?? document.documentElement;
  el.scrollTop = el.scrollHeight;
}

function Thread({ greeting, name, stick }: { greeting: string; name: string; stick: { current: boolean } }) {
  const items = thread.value;
  const thinking = chiefPresence.value.state === 'thinking' && !items.some((m) => m.streaming);
  const last = items[items.length - 1];
  const sample = catalog.value?.catalog.matchQuiz?.try_before_choosing?.sample_prompts ?? [];
  const starters = sample.length ? [DELEGATE_STARTER, ...sample.filter((p) => p !== DELEGATE_STARTER).slice(0, 2)] : DEFAULT_STARTERS;

  // Follow the conversation while the owner is at the bottom; leave them be when they scrolled up.
  useEffect(() => {
    const onScroll = () => {
      const el = document.scrollingElement ?? document.documentElement;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    if (stick.current) scrollToEnd();
  }, [items.length, last?.text, last?.status, thinking]);

  return (
    <div class="thread-wrap">
      <ol class="thread" aria-label={`Conversation with ${name}`}>
        <li class="msg msg-chief" data-first>
          <span class="msg-from">{name}</span>
          <p class="msg-body">{greeting}</p>
        </li>
        {items.map((m, i) => (
          <Message key={m.messageId} item={m} name={name} grouped={m.kind !== 'announcement' && (i > 0 ? sameSpeaker(items[i - 1]!, m) && items[i - 1]!.kind !== 'announcement' : m.from === CHIEF_ID)} />
        ))}
        {thinking && (
          <li class="msg msg-chief msg-typing">
            <span class="typing" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span class="visually-hidden">{name} is thinking</span>
          </li>
        )}
      </ol>
      {items.length === 0 && (
        <div class="starters" aria-label="Try">
          {starters.map((t) => (
            <button key={t} type="button" class="starter" onClick={() => prefillComposer(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {connection.value === 'closed' && (
        <p class="talk-offline" role="status">
          Reconnecting. Your messages are still here.
        </p>
      )}
    </div>
  );
}

const sameSpeaker = (a: ThreadItem, b: ThreadItem) => a.from === b.from && a.from !== 'system';

function Message({ item, name, grouped }: { item: ThreadItem; name: string; grouped: boolean }) {
  if (item.from === 'owner') {
    return (
      <li class="msg msg-owner" data-status={item.status}>
        <span class="visually-hidden">You{item.via === 'voice' ? ' (spoken)' : ''}: </span>
        <p class="msg-body">{item.text}</p>
        {item.via === 'voice' && !item.status && <Icon name="mic" size={14} class="msg-via" />}
        {item.status === 'pending' && <span class="msg-note">Sending…</span>}
        {item.status === 'failed' && (
          <span class="msg-note msg-failed" role="alert">
            {item.error ?? 'Not sent.'}{' '}
            <button type="button" class="link-button" onClick={() => void retryOwnerMessage(item)}>
              Retry
            </button>
          </span>
        )}
      </li>
    );
  }
  if (item.from === 'system') {
    return (
      <li class="msg msg-system" role="status">
        <span class="msg-sys-dot" aria-hidden="true" />
        <p>
          {item.text}
          {item.missingKeys?.length ? <span class="msg-keys"> Add {item.missingKeys.join(' or ')} in apps/worker/.dev.vars.</span> : null}
        </p>
        <button type="button" class="icon-button icon-button-sm" aria-label="Dismiss" onClick={() => dismissThreadItem(item.messageId)}>
          <Icon name="close" size={16} />
        </button>
      </li>
    );
  }
  const job = item.jobId ? jobs.value[item.jobId] : undefined;
  // An announcement is its own message (they started it): always named and timed, never folded into a reply.
  const announcement = item.kind === 'announcement';
  void now.value; // keep "2 min ago" moving
  return (
    <li class="msg msg-chief" data-kind={item.kind} data-streaming={item.streaming || undefined}>
      {!grouped && (
        <span class="msg-from">
          {name}
          {announcement && <span class="msg-time"> · {ago(item.ts)}</span>}
        </span>
      )}
      {grouped && <span class="visually-hidden">{name}: </span>}
      {item.text ? <Markdown text={item.text} class="msg-body" /> : <p class="msg-body msg-thinking">Thinking…</p>}
      {item.interrupted && <span class="msg-note">Interrupted</span>}
      {item.kind === 'announcement' && job?.status === 'done' && <Deliverable job={job} />}
    </li>
  );
}

/**
 * Activity rows: running jobs, failures until dismissed, and a just-finished job only until its outcome is in
 * the thread (the announcement carries the write-up, so a done job is never listed twice). Any finished row can
 * be dismissed; the sweep clears the rest after two minutes (EXPERIENCE §2.2).
 */
function Activity() {
  const t = now.value;
  const [dismissed, setDismissed] = useState<string[]>([]);
  const said = thread.value;
  const told = (j: JobSnapshot) => said.some((m) => m.from === CHIEF_ID && m.jobId === j.jobId && !!j.finishedAt && m.ts >= j.finishedAt);
  const rows = jobList.value.filter((j) => {
    if (j.status === 'queued' || j.status === 'running') return true;
    if (dismissed.includes(j.jobId)) return false;
    if (j.status === 'failed') return true;
    if (told(j)) return false;
    return j.finishedAt ? t - Date.parse(j.finishedAt) < SWEEP_MS : false;
  });
  if (!rows.length) return null;
  return (
    <section class="activity" aria-label="Activity">
      {rows.map((j) => {
        const finished = j.status !== 'queued' && j.status !== 'running';
        return (
          <div class="activity-row" key={j.jobId} data-finished={finished || undefined}>
            <JobRow job={j} inActivity />
            {finished && (
              <button type="button" class="icon-button icon-button-sm activity-dismiss" aria-label={`Dismiss ${j.title}`} onClick={() => setDismissed([...dismissed, j.jobId])}>
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Composer({ name }: { name: string }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const text = draft.value;
  const phase = ptt.value.phase;
  const mode = pttMode();
  const n = notice.value;
  const focusTick = focusComposer.value;

  useEffect(() => {
    if (focusTick) {
      input.current?.focus();
      const len = input.current?.value.length ?? 0;
      input.current?.setSelectionRange(len, len);
    }
  }, [focusTick]);

  // Grow with the text, up to about six lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  const send = async () => {
    const t = draft.value.trim();
    if (!t) return input.current?.focus();
    armAudio();
    draft.value = '';
    await sendOwnerMessage(t, 'text'); // a failed send stays in the thread with Retry: text is never lost
  };

  // The mic: hold to talk, or tap to open it and tap again to send (a tap is easier for many people).
  const latched = useRef(false);
  const pressedAt = useRef(0);
  const swallowUp = useRef(false);
  const micDown = (e: Event) => {
    e.preventDefault();
    if (latched.current) {
      latched.current = false;
      swallowUp.current = true;
      endPtt();
      return;
    }
    pressedAt.current = Date.now();
    armAudio();
    startPtt();
  };
  const micUp = () => {
    if (swallowUp.current) {
      swallowUp.current = false;
      return;
    }
    if (Date.now() - pressedAt.current < LATCH_MS && ptt.value.phase !== 'idle') {
      latched.current = true;
      return;
    }
    endPtt();
  };
  useEffect(() => {
    if (phase === 'idle') latched.current = false;
  }, [phase]);

  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {n && (
        <p class="composer-notice" data-tone={n.tone} role={n.tone === 'error' ? 'alert' : 'status'}>
          {n.text}
        </p>
      )}
      <div class="composer-box">
        <label class="visually-hidden" for="composer">
          Message {name}
        </label>
        <textarea
          id="composer"
          ref={input}
          rows={1}
          value={text}
          placeholder={mode && !coarsePointer() ? `Message ${name}, or hold Space to talk` : `Message ${name}`}
          autoComplete="off"
          onInput={(e) => {
            draft.value = e.currentTarget.value;
            // Typing while they talk is a barge-in (X5).
            if (chiefIsSpeaking()) bargeIn();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {mode && (
          <button
            type="button"
            class="icon-button composer-mic"
            data-active={phase !== 'idle' || undefined}
            aria-label={phase === 'listening' ? 'Listening. Release or tap to send' : 'Talk: hold, or tap to start and tap again to send'}
            title="Hold to talk, or tap to start and tap again to send"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* synthetic */
              }
              micDown(e);
            }}
            onPointerUp={micUp}
            onPointerCancel={() => cancelPtt()}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) micDown(e);
            }}
            onKeyUp={(e) => {
              if (e.key === ' ' || e.key === 'Enter') micUp();
            }}
            onClick={(e) => e.preventDefault()}
          >
            <Icon name="mic" />
          </button>
        )}
        <button type="submit" class="composer-send" aria-label={`Send to ${name}`}>
          <Icon name="send" />
        </button>
      </div>
    </form>
  );
}

/** Touch devices have no Space bar to hold. */
function coarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

