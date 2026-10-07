// Talk: the Chief of Staff console (EXPERIENCE §3.1). The face is the status; the thread streams;
// the composer sends, holds to talk and toggles voice. Background jobs sit in the Activity rows above
// the composer, and the conversation never waits on them (D2).
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { renameLine } from '@headcount/catalog';
import { CHIEF_ID, type JobSnapshot } from '@headcount/protocol';
import type { Recalled } from '@headcount/protocol/ext/memory';
import { chiefName, currentLead } from '../chief';
import { catalog, loadCatalog } from '../catalog';
import { DecisionCard } from '../components/DecisionCard';
import { Face, leadSubject } from '../components/Face';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { Sources } from '../components/Sources';
import { Deliverable, JobRow } from '../components/JobRow';
import { Markdown } from '../components/Markdown';
import { useHoldToTalk } from '../components/useHoldToTalk';
import { VoiceElsewhere } from '../components/VoiceElsewhere';
import { ago, now } from '../lib/time';
import { bubbles, liveCaptions } from '../living/captions';
import { linkTarget, linkTo, navigate, paths } from '../router';
import { activeJobs, can, canvases, chiefPresence, connection, decisionList, dismissThreadItem, jobList, jobs, liveMeetings, onboarded, settings, teamIds, teamProjects, thread, trustStop, type ThreadItem } from '../store';
import { retryOwnerMessage, sendOwnerMessage, setVoiceOn } from '../talk/actions';
import { draft, focusComposer, greetedThisSession, greetOnArrival, prefillComposer } from '../talk/draft';
import { notice, showNotice } from '../ui/notice';
import { isOwner, mayContribute } from '../auth/session';
import { FILE_ACCEPT } from '../memory/upload';
import { api } from '../api/client';
import { canSnapScreen, canUseCamera, snapScreen } from '../lib/capture';
import { attachFiles, draftFiles, removeDraftFile, takeAttachments } from '../talk/attachments';
import { CameraSheet } from '../talk/CameraSheet';
import { CopyLink, PageTitle } from '../links/CopyLink';
import { bargeIn, chiefIsSpeaking, chiefSpeaker } from '../voice/chief-voice';
import { armAudio, audioSupport } from '../voice/engine';
import { mayVoice } from '../voice/owner';
import { cancelPtt, endPtt, ptt, pttMode, startPtt } from '../voice/ptt';
import { liveVoice, startLiveVoice, stopLiveVoice } from '../voice/live';
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
  const [dropping, setDropping] = useState(false);
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
    greetedThisSession.value = true; // no second hello from the living layer this session
    if (settings.value?.voiceOn && mayVoice()) chiefSpeaker.say(greeting, 'greeting');
  }, [lead?.id]);

  if (!s || !onboarded.value || !lead)
    return (
      <section class="talk" aria-busy="true">
        <p class="page-lede">Opening Talk…</p>
      </section>
    );

  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  return (
    <section
      class="talk"
      aria-labelledby="talk-title"
      data-drop={dropping || undefined}
      onDragOver={(e) => {
        if (!hasFiles(e) || !mayContribute.value) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        void attachFiles([...(e.dataTransfer?.files ?? [])]);
      }}
    >
      {dropping && (
        <p class="talk-drop" aria-hidden="true">
          <Icon name="attach" size={20} /> Drop to show {name}
        </p>
      )}
      <TalkHead />
      <Thread greeting={greeting} name={name} stick={stick} />
      <div class="talk-dock" ref={dock}>
        <LiveMeetings />
        <ChiefAsks />
        <Activity />
        {mayContribute.value ? (
          <Composer name={name} />
        ) : (
          <p class="composer-readonly" role="note">
            You can read along. To talk with {name}, ask an owner to make you a contributor.
          </p>
        )}
      </div>
    </section>
  );
}

/** Meetings going on now (the Chief moderates each): one line each, with who has the floor and a way in. */
function LiveMeetings() {
  const live = liveMeetings.value;
  if (!live.length) return null;
  const nameOf = (id?: string) => (id ? (catalog.value?.persona(id)?.name.split(' ')[0] ?? '') : '');
  return (
    <div class="talk-meetings" aria-label="Meetings now">
      {live.slice(0, 2).map((m) => (
        <p key={m.meetingId} class="talk-meeting" role="status">
          <Icon name="meetings" size={16} />
          <span class="talk-meeting-text">
            Meeting now: <strong>{m.standalone ? (m.title ?? m.question) : m.kind === 'discussion' ? m.question : (m.title ?? m.question)}</strong>
            {m.speakerId ? ` · ${nameOf(m.speakerId)} has the floor` : ''}
          </span>
          <Link href={paths.meeting(m.meetingId)} class="button-quiet button-small">
            Join
          </Link>
        </p>
      ))}
    </div>
  );
}

/** The Chief's own asks waiting for the owner's OK: connector calls and automations (the turn waits on the card; the Inbox has it too). */
function ChiefAsks() {
  // The Chief's own asks, and a coworker's email or change from their desk (Inc 6): none belongs to a project.
  const asks = decisionList.value.filter((d) => (d.kind === 'connector' || d.kind === 'automation' || d.kind === 'effect' || d.kind === 'change') && !d.projectId);
  const stop = trustStop.value;
  if (!asks.length && !stop) return null;
  return (
    <div class="talk-asks" aria-label="Waiting for your OK">
      {stop && (
        <p class="everyone-stop-on" role="status">
          Everyone stop is on: emails are held until an owner resumes. {isOwner.value && <Link href={paths.admin('autonomy')}>Resume</Link>}
        </p>
      )}
      {asks.map((d) => (
        <DecisionCard key={d.decisionId} decision={d} showProject={false} />
      ))}
    </div>
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
        data-jobs={running || undefined}
        aria-label={`${name}, ${words}${running > 0 ? `, ${running === 1 ? '1 job' : `${running} jobs`} running` : ''}.${shown.state === 'speaking' ? ' Tap to stop.' : ''}${canHold ? ' Hold to speak.' : ''}`}
        {...handlers}
      >
        <Face subject={leadSubject(lead, name)} tier="hero" state={shown.state} sampler={chiefSpeaker.mouth} class="talk-face" agentId={CHIEF_ID} decorative />
      </button>
      <FaceBubble />
      <div class="talk-id">
        <PageTitle id="talk-title">{name}</PageTitle>
        <p class="talk-state" data-state={shown.state}>
          <span class="state-glyph" data-state={shown.state} aria-hidden="true" />
          <span>
            Chief of Staff · {words}
            {running > 0 && ` · ${running === 1 ? '1 job' : `${running} jobs`} running`}
          </span>
        </p>
        <LiveCaption name={name} />
      </div>
      <VoiceElsewhere />
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

/**
 * The live caption line (LIVING-WORKFORCE §9.4, L6): every voiced micro-utterance, in a lighter "reaction" style
 * ("Joy: mm-hm"). Never aria-live: micro-talk is not announced (EXPERIENCE §9.2).
 */
function LiveCaption({ name }: { name: string }) {
  const c = liveCaptions.value[CHIEF_ID];
  if (!c) return null;
  return (
    <p class="live-caption" data-testid="live-caption" data-kind={c.kind} key={c.id}>
      <span class="live-caption-who">{name}:</span> {c.text}
      {c.gloss && <span class="live-caption-gloss"> ({c.gloss})</span>}
    </p>
  );
}

/**
 * A small bubble under the face: text-mode fillers ("one sec…") and anything else said in a bubble here, except
 * words the transcript already shows (a reflex reply such as "Anytime." is a message too).
 */
function FaceBubble() {
  const b = bubbles.value[CHIEF_ID];
  if (!b?.text) return null;
  if (thread.value.slice(-3).some((m) => m.from === CHIEF_ID && m.text.trim() === b.text)) return null;
  return (
    <p class="talk-face-bubble" data-testid="face-bubble" data-agent-id={CHIEF_ID} key={b.id}>
      {b.text}
    </p>
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
  // A link to one message: stay with it instead of following the conversation to the end.
  useLayoutEffect(() => {
    if (linkTarget.value) stick.current = false;
  }, [linkTarget.value]);
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
          <Message key={m.messageId} item={m} name={name} grouped={m.kind !== 'announcement' && (i > 0 ? sameSpeaker(items[i - 1]!, m) && items[i - 1]!.kind !== 'announcement' && items[i - 1]!.kind !== 'note' : m.from === CHIEF_ID)} />
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
      {items.every((m) => m.kind === 'note') && teamIds.value !== null && (
        <Link href={teamIds.value.length ? paths.team : `${paths.hire}?first=1`} class="panel talk-meet-team">
          <Icon name="floor" size={18} />
          <span>
            <strong>{teamIds.value.length ? 'Meet your team' : 'Hire your first coworkers'}</strong>
            <span class="page-fine">
              {teamIds.value.length
                ? ` ${teamIds.value.length === 1 ? 'One person' : `${teamIds.value.length} people`} ready to help, each with a first job you can start in one click.`
                : ` ${name} suggests people for your business: a bookkeeper, someone for your socials, whoever you need.`}
            </span>
          </span>
          <Icon name="chevronRight" size={16} />
        </Link>
      )}
      {items.every((m) => m.kind === 'note') && (
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

/** A server message's own link (pending and error lines have none). */
const anchorOf = (item: ThreadItem) => (item.messageId.startsWith('msg_') ? item.messageId : undefined);

function MessageLink({ item }: { item: ThreadItem }) {
  const at = anchorOf(item);
  return at && !item.streaming ? <CopyLink page={paths.talk} at={at} label="Copy link to this message" what="Link to this message" class="msg-link" /> : null;
}

/** What the owner showed with a message: pictures as thumbnails, files by name; each opens on the Memory page. */
function Shown({ files }: { files: NonNullable<ThreadItem['attachments']> }) {
  return (
    <ul class="msg-shown" aria-label="Shared with this message">
      {files.map((f) => (
        <li key={f.cardId}>
          <Link href={linkTo(paths.memory, f.cardId)} class={f.kind === 'image' ? 'msg-shown-image' : 'msg-shown-file'} title={`${f.name} (on the Memory page)`}>
            {f.kind === 'image' ? <img src={api.cardFileUrl(f.cardId)} alt={f.name} loading="lazy" /> : <Icon name="file" size={16} />}
            {f.kind !== 'image' && <span>{f.name}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Message({ item, name, grouped }: { item: ThreadItem; name: string; grouped: boolean }) {
  if (item.from === 'owner') {
    return (
      <li class="msg msg-owner" id={anchorOf(item)} data-status={item.status}>
        <MessageLink item={item} />
        <span class="visually-hidden">You{item.via === 'voice' ? ' (spoken)' : ''}: </span>
        <p class="msg-body">{item.text}</p>
        {item.attachments?.length ? <Shown files={item.attachments} /> : null}
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
          {item.missingKeys?.length ? (
            <span class="msg-keys">
              {' '}
              An owner can add a key for {item.missingKeys.join(' or ')} in <Link href={paths.admin('keys')}>Admin → Provider keys</Link>.
            </span>
          ) : null}
        </p>
        <button type="button" class="icon-button icon-button-sm" aria-label="Dismiss" onClick={() => dismissThreadItem(item.messageId)}>
          <Icon name="close" size={16} />
        </button>
      </li>
    );
  }
  if (item.kind === 'note') return <NoteLine item={item} />;
  const job = item.jobId ? jobs.value[item.jobId] : undefined;
  // An announcement is its own message (they started it): always named and timed, never folded into a reply.
  const announcement = item.kind === 'announcement';
  void now.value; // keep "2 min ago" moving
  return (
    <li class="msg msg-chief" id={anchorOf(item)} data-kind={item.kind} data-streaming={item.streaming || undefined}>
      <MessageLink item={item} />
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
      {item.sources && !item.streaming && <Sources sources={item.sources} />}
      {item.recalled && !item.streaming && <RecallChips items={item.recalled} />}
      {item.projectId && !item.streaming && <ProjectLink projectId={item.projectId} />}
      {item.canvasId && !item.streaming && <CanvasLink canvasId={item.canvasId} />}
    </li>
  );
}

/** What the Chief remembered for this reply (Inc 4): each chip is a memory, kept on the Memory page. */
function RecallChips({ items }: { items: Recalled[] }) {
  return (
    <div class="msg-recalled">
      <span class="msg-recalled-label">
        <Icon name="memory" size={14} /> Remembered
      </span>
      <ul aria-label="Remembered for this reply">
        {items.map((r) => (
          <li key={r.memoryId}>
            <Link class="recall-chip" href={paths.memory} title={r.sourceLabel ? `${r.text} (${r.sourceLabel})` : r.text}>
              {r.text.length > 64 ? `${r.text.slice(0, 62).trimEnd()}…` : r.text}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A canvas the Chief is building: how it is going, and the way to it. */
function CanvasLink({ canvasId }: { canvasId: string }) {
  const c = canvases.value[canvasId];
  const words = !c ? 'Open it on the canvas' : c.status === 'ready' ? `Open “${c.title}”` : c.status === 'failed' ? 'See what went wrong' : c.previewLines ? 'Play the first version' : c.kind === 'app' ? 'Watch it being built' : 'Watch it being written';
  return (
    <Link class="msg-project msg-canvas" href={paths.canvasItem(canvasId)}>
      {words}
      <Icon name="chevronRight" size={14} />
    </Link>
  );
}

/** A Chief message about a team project links to it: the plan while it waits, the deliverable once it is done. */
function ProjectLink({ projectId }: { projectId: string }) {
  const p = teamProjects.value[projectId];
  const words = !p ? 'Open the project' : p.status === 'proposed' ? 'See the team and plan' : p.status === 'done' ? 'Read the deliverable' : 'Open the project';
  return (
    <Link class="msg-project" href={paths.project(projectId)}>
      {words}
      {p && <span class="visually-hidden">: {p.title}</span>}
      <Icon name="chevronRight" size={14} />
    </Link>
  );
}

/**
 * A meeting happened in the office ("Skyline room with Juno, Walt and Lena · 4 min"): one quiet, centred line with a
 * small room glyph. No face, no actions; never voiced, never unread (X2: every side conversation returns as one line).
 */
function NoteLine({ item }: { item: ThreadItem }) {
  const huddle = item.roomId?.startsWith('huddle:') ?? false;
  const email = item.messageId.startsWith('effect:');
  return (
    <li class="msg msg-note" data-kind="note" data-email={email || undefined}>
      <svg class="msg-note-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        {email ? (
          <>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </>
        ) : huddle ? (
          <>
            <circle cx="8" cy="8" r="3" />
            <circle cx="16" cy="8" r="3" />
            <path d="M3 19a5 5 0 0 1 10 0M11 19a5 5 0 0 1 10 0" />
          </>
        ) : (
          <>
            <circle cx="8" cy="6.5" r="1.6" />
            <circle cx="12" cy="6.5" r="1.6" />
            <circle cx="16" cy="6.5" r="1.6" />
            <path d="M4 11h16M6 11v7M18 11v7" />
          </>
        )}
      </svg>
      <span class="visually-hidden">{email ? 'Email: ' : 'In the office: '}</span>
      <Markdown text={item.text} class="msg-body" />
      {item.projectId && <ProjectLink projectId={item.projectId} />}
      {item.receiptId && (
        <Link href={linkTo(paths.admin('audit'), item.receiptId)} class="msg-note-link" title="The receipt, in the audit log">
          Receipt {item.receiptId}
        </Link>
      )}
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
  const files = useRef<HTMLInputElement>(null);
  const text = draft.value;
  const phase = ptt.value.phase;
  const mode = pttMode();
  const live = liveVoice.value;
  // Hands-free talk is a Talk thing: leaving Talk closes the mic.
  useEffect(() => () => stopLiveVoice(), []);
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

  const shown = draftFiles.value;
  const [menu, setMenu] = useState(false);
  const [camera, setCamera] = useState(false);
  const attachButton = useRef<HTMLButtonElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const screen = canSnapScreen();
  const cam = canUseCamera();

  const send = async () => {
    const typed = draft.value.trim();
    if (!typed && !shown.length) return input.current?.focus();
    const attachments = takeAttachments();
    if (!attachments) return showNotice('Still reading what you added. One moment.', 'info', 3000);
    armAudio();
    draft.value = '';
    // a failed send stays in the thread with Retry: text is never lost
    await sendOwnerMessage(typed || 'Take a look at this.', 'text', attachments.length ? { attachments } : {});
  };
  const closeMenu = (refocus = true) => {
    setMenu(false);
    if (refocus) attachButton.current?.focus();
  };
  const snap = async () => {
    closeMenu(false);
    const file = await snapScreen();
    if (file) void attachFiles([file]);
    input.current?.focus();
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
      {live.phase !== 'off' && (
        <p class="composer-live-status" role="status" data-phase={live.phase}>
          {live.phase === 'starting' ? 'Opening the mic…' : live.phase === 'hearing' ? 'Listening to you…' : live.phase === 'sending' ? `Sent to ${name}. Speak any time to add or interrupt.` : `Hands-free: speak any time; a pause sends it.`}{' '}
          <button type="button" class="link-button" onClick={stopLiveVoice}>
            End
          </button>
        </p>
      )}
      {shown.length > 0 && <DraftTray name={name} />}
      {camera && <CameraSheet onTake={(f) => void attachFiles([f])} onClose={() => setCamera(false)} />}
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
            // Typing no longer stops their voice (X5 amended, LIVING-WORKFORCE §2.3): sending decides.
            draft.value = e.currentTarget.value;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <span class="composer-attach-wrap">
          <button
            type="button"
            ref={attachButton}
            class="icon-button composer-attach"
            aria-label={`Show ${name} a file or picture`}
            aria-haspopup={screen || cam ? 'menu' : undefined}
            aria-expanded={screen || cam ? menu : undefined}
            title="Add a file, a photo or a snapshot of your screen"
            onClick={() => (screen || cam ? setMenu(!menu) : files.current?.click())}
          >
            <Icon name="attach" />
          </button>
          {menu && <AttachMenu screen={screen} camera={cam} onClose={closeMenu} onFile={() => (closeMenu(false), files.current?.click())} onScreen={() => void snap()} onCamera={() => (closeMenu(false), coarsePointer() ? photoInput.current?.click() : setCamera(true))} />}
        </span>
        <input
          ref={files}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          class="visually-hidden composer-file-input"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const el = e.currentTarget;
            void attachFiles([...(el.files ?? [])]);
            el.value = '';
          }}
        />
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          capture="environment"
          class="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const el = e.currentTarget;
            void attachFiles([...(el.files ?? [])]);
            el.value = '';
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
        {mode === 'stt' && (
          <button
            type="button"
            class="icon-button composer-live"
            data-active={live.phase !== 'off' || undefined}
            aria-pressed={live.phase !== 'off'}
            aria-label={live.phase === 'off' ? 'Talk hands-free' : 'End hands-free talk'}
            title={live.phase === 'off' ? 'Talk hands-free: speak any time, a pause sends' : 'End hands-free talk'}
            onClick={() => {
              armAudio();
              if (live.phase === 'off') startLiveVoice();
              else stopLiveVoice();
            }}
          >
            <Icon name="headphones" />
          </button>
        )}
        <button type="submit" class="composer-send" aria-label={`Send to ${name}`}>
          <Icon name="send" />
        </button>
      </div>
    </form>
  );
}

/** Add to the message: a file or photo, a snapshot of a screen, a photo from the camera. */
function AttachMenu({ screen, camera, onClose, onFile, onScreen, onCamera }: { screen: boolean; camera: boolean; onClose: (refocus?: boolean) => void; onFile: () => void; onScreen: () => void; onCamera: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    const away = (e: PointerEvent) => {
      if (!menu.current?.parentElement?.contains(e.target as Node)) onClose(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, []);
  const onKey = (e: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === 'Tab') onClose(false);
  };
  return (
    <div class="attach-menu" role="menu" aria-label="Add to your message" ref={menu} onKeyDown={onKey}>
      <button type="button" role="menuitem" onClick={onFile}>
        <Icon name="file" size={18} /> A file or photo
      </button>
      {screen && (
        <button type="button" role="menuitem" onClick={onScreen}>
          <Icon name="screen" size={18} /> A snapshot of your screen
        </button>
      )}
      {camera && (
        <button type="button" role="menuitem" onClick={onCamera}>
          <Icon name="camera" size={18} /> Take a photo
        </button>
      )}
    </div>
  );
}

/** What goes with the next message: pictures as thumbnails, files by name, each removable; “Reading…” until read. */
function DraftTray({ name }: { name: string }) {
  return (
    <ul class="composer-files" aria-label={`Going to ${name} with your message`}>
      {draftFiles.value.map((f) => (
        <li key={f.key} class="composer-file" data-ready={f.card ? true : undefined} data-image={f.image || undefined}>
          {f.image && (f.preview || f.card) ? <img src={f.preview ?? api.cardFileUrl(f.card!.cardId)} alt="" /> : <Icon name="file" size={16} />}
          <span class="composer-file-name">{f.name}</span>
          {!f.card && <span class="composer-file-state">Reading…</span>}
          <button type="button" class="icon-button icon-button-sm" aria-label={`Remove ${f.name}`} onClick={() => removeDraftFile(f.key)}>
            <Icon name="close" size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Touch devices have no Space bar to hold. */
function coarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

