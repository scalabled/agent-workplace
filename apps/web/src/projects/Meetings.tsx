// Meetings on the project page (Inc 2): the kickoff, reviews and discussions the team held, as real turns with the
// Chief of Staff moderating. The owner calls one (a question, or a review of the work so far), listens in (each line in
// the speaker's team voice), takes the floor (whoever they address answers next), whispers to one coworker (only they
// hear it), and reads or replays any meeting later.
import type { MeetingResponse, MeetingSummary, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { MEETING_SAY_MAX } from '@headcount/protocol/ext/projects';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { chiefName } from '../chief';
import { Icon } from '../components/Icon';
import { listen, nowPlaying, stopListening } from '../meetings/listen';
import { projectChannels, upsertProject } from '../store';
import { takeVoice } from '../voice/handoff';

const KIND: Record<MeetingSummary['kind'], string> = { kickoff: 'Kickoff', review: 'Review', discussion: 'Discussion' };
const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const when = (at: string) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Meetings({ project }: { project: TeamProjectSnapshot }) {
  const [list, setList] = useState<MeetingSummary[] | null>(null);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = project.projectId;
  // Meeting lines arrive in the channel: refresh the list when a meeting line lands or one starts or ends.
  const meetingLines = (projectChannels.value[id] ?? []).filter((e) => e.meetingId).length;
  const liveId = project.discussion?.meetingId ?? null;
  useEffect(() => {
    api
      .projectMeetings(id)
      .then((r) => setList(r.meetings))
      .catch(() => setList((l) => l ?? []));
  }, [id, meetingLines, liveId]);
  const canMeet = ['proposed', 'running', 'paused', 'needs_review'].includes(project.status) && !project.discussion && !(list ?? []).some((m) => m.status === 'live');
  const listenTo = (m: MeetingSummary, from: 'start' | 'live') => {
    setError(null);
    takeVoice();
    void listen(id, m.meetingId, { from, title: project.title }).catch((err) => setError(errorOf(err, 'That meeting could not be played.')));
  };
  return (
    <section class="panel meetings" aria-labelledby="meetings-title">
      <header class="plan-head">
        <h2 id="meetings-title" class="panel-title">
          Meetings
        </h2>
        {canMeet && !calling && (
          <button type="button" class="button-quiet button-small" onClick={() => setCalling(true)}>
            Call a meeting
          </button>
        )}
      </header>
      {calling && (
        <CallMeeting
          project={project}
          onDone={(m) => {
            setCalling(false);
            if (m) setList((l) => [m, ...(l ?? [])]);
          }}
        />
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {list && !list.length && !calling && <p class="page-fine">No meetings yet. Teams of three or more hold a kickoff before the first step; you can call one any time.</p>}
      <ul class="meeting-list">
        {(list ?? []).map((m) => (
          <MeetingRow key={m.meetingId} project={project} meeting={m} onListen={listenTo} />
        ))}
      </ul>
    </section>
  );
}

function CallMeeting({ project, onDone }: { project: TeamProjectSnapshot; onDone: (m: MeetingSummary | null) => void }) {
  const [kind, setKind] = useState<'discussion' | 'review'>('discussion');
  const [question, setQuestion] = useState('');
  const [rounds, setRounds] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.discuss(project.projectId, question.trim(), rounds, kind);
      upsertProject(r.project);
      const m = r.meetingId ? (await api.getMeeting(project.projectId, r.meetingId)).meeting : null;
      onDone(m);
    } catch (err) {
      setError(errorOf(err, 'That did not start. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="channel-discuss" onSubmit={start} aria-label="Call a meeting">
      <label class="field field-inline">
        <span class="field-label">Meeting</span>
        <select class="field-input" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as 'discussion' | 'review')}>
          <option value="discussion">Discuss a question</option>
          <option value="review">Review the work so far</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">{kind === 'review' ? 'Anything in particular? (optional)' : 'What should the team discuss?'}</span>
        <input class="field-input" value={question} maxLength={1000} placeholder={kind === 'review' ? 'The pricing section' : 'Instagram or local press first?'} onInput={(e) => setQuestion((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field field-inline">
        <span class="field-label">Rounds</span>
        <select class="field-input" value={rounds} onChange={(e) => setRounds(Number((e.target as HTMLSelectElement).value))}>
          <option value={1}>1 (openings)</option>
          <option value={2}>2 (with a debate)</option>
          <option value={3}>3</option>
        </select>
      </label>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="settings-actions">
        <button type="submit" class="button-primary" disabled={busy || (kind === 'discussion' && !question.trim())}>
          Start
        </button>
        <button type="button" class="button-quiet" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MeetingRow({ project, meeting: m, onListen }: { project: TeamProjectSnapshot; meeting: MeetingSummary; onListen: (m: MeetingSummary, from: 'start' | 'live') => void }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<MeetingResponse | null>(null);
  const playing = nowPlaying.value?.meetingId === m.meetingId;
  const live = m.status === 'live';
  const first = (id: string) => (id === 'owner' ? 'You' : id === 'chief' ? chiefName.value : (project.team.find((t) => t.personaId === id)?.name.split(' ')[0] ?? id));
  const lines = (projectChannels.value[project.projectId] ?? []).filter((e) => e.meetingId === m.meetingId).length;
  useEffect(() => {
    if (!open) return;
    api
      .getMeeting(project.projectId, m.meetingId)
      .then(setDetail)
      .catch(() => undefined);
  }, [open, m.meetingId, m.lines, lines]);
  const speaker = live && project.discussion?.meetingId === m.meetingId ? first(project.discussion.speakerId) : null;
  return (
    <li class="meeting" data-status={m.status}>
      <div class="meeting-head">
        <div class="meeting-main">
          <p class="meeting-title">
            <span class="connector-tag">{KIND[m.kind]}</span> {m.kind === 'review' ? 'The work so far' : m.question}
          </p>
          <p class="connector-meta">
            {live ? (speaker ? `Live now · ${speaker} has the floor` : 'Live now · about to start') : `${m.status === 'stopped' ? 'Stopped' : 'Held'} ${when(m.startedAt)} · ${m.lines} lines`}
          </p>
        </div>
        <div class="meeting-actions">
          {playing ? (
            <button type="button" class="button-quiet button-small" onClick={stopListening}>
              <Icon name="stop" size={14} /> Stop
            </button>
          ) : (
            <button type="button" class={live ? 'button-primary button-small' : 'button-quiet button-small'} onClick={() => onListen(m, live ? 'live' : 'start')}>
              <Icon name="headphones" size={14} /> {live ? 'Listen in' : 'Replay'}
            </button>
          )}
          <button type="button" class="icon-button" aria-expanded={open} aria-label={open ? 'Hide the transcript' : 'Read the transcript'} onClick={() => setOpen(!open)}>
            <Icon name="chevronDown" size={18} class={open ? 'icon-flip' : undefined} />
          </button>
        </div>
      </div>
      {live && <TakeTheFloor project={project} meetingId={m.meetingId} />}
      {open && (
        <ol class="meeting-transcript">
          {(detail?.entries ?? []).map((e) => (
            <li key={e.seq} data-kind={e.kind} data-phase={e.phase}>
              <strong>{first(e.fromId)}</strong>
              {e.kind === 'whisper' && <span class="connector-meta"> (whispered to {first(e.toId ?? '')})</span>}
              {e.kind === 'owner' && e.toId && <span class="connector-meta"> → {first(e.toId)}</span>}: {e.text}
            </li>
          ))}
          {detail && !detail.entries.length && <li class="page-fine">Nothing said yet.</li>}
        </ol>
      )}
      {!live && m.summary && !open && <p class="meeting-summary">{m.summary}</p>}
    </li>
  );
}

/** The owner in a live meeting: to the room (whoever they name, else the chair, answers next), or a whisper. */
function TakeTheFloor({ project, meetingId }: { project: TeamProjectSnapshot; meetingId: string }) {
  const [text, setText] = useState('');
  const [to, setTo] = useState('');
  const [whisper, setWhisper] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const send = async (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.meetingSay(project.projectId, meetingId, { text: t, ...(to ? { toId: to } : {}), ...(whisper && to ? { whisper: true } : {}) });
      setText('');
      const name = to ? project.team.find((m) => m.personaId === to)?.name.split(' ')[0] : null;
      setSent(whisper && name ? `Whispered to ${name}; only they hear it.` : name ? `${name} answers next.` : 'The chair answers next.');
    } catch (err) {
      setError(errorOf(err, 'That did not reach the meeting.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="meeting-floor" onSubmit={send} aria-label="Take the floor">
      <label class="visually-hidden" for={`floor-${meetingId}`}>
        Say something to the meeting
      </label>
      <input id={`floor-${meetingId}`} class="field-input" maxLength={MEETING_SAY_MAX} value={text} placeholder={whisper ? 'Whisper…' : 'Take the floor…'} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
      <label class="visually-hidden" for={`to-${meetingId}`}>
        To
      </label>
      <select id={`to-${meetingId}`} class="field-input meeting-to" value={to} onChange={(e) => setTo((e.target as HTMLSelectElement).value)}>
        <option value="">The room</option>
        {project.team.map((m) => (
          <option key={m.personaId} value={m.personaId}>
            {m.name.split(' ')[0]}
          </option>
        ))}
      </select>
      <label class="grant-label meeting-whisper">
        <input type="checkbox" checked={whisper} disabled={!to} onChange={(e) => setWhisper((e.target as HTMLInputElement).checked)} />
        <span class="grant-name">Whisper</span>
      </label>
      <button type="submit" class="button-primary button-small" disabled={busy || !text.trim()}>
        {whisper && to ? 'Whisper' : 'Say it'}
      </button>
      {sent && !error && <p class="page-fine meeting-sent">{sent}</p>}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
