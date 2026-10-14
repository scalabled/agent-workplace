// Meetings: where the team talks things through, with the Chief of Staff moderating every one. Call a meeting (a topic
// and people from your team, or a project's own team), see who is meeting now, and read or replay any meeting. A meeting
// opens in its room: the table, who has the floor, every line as it is said, Listen in, and the floor for the owner.
// When one called on its own ends, the people at the table get started on what they agreed (unless the owner said
// not to), and the Chief brings the outcome to Talk; otherwise the room's Start the work does it in one tap.
import { firstName, type PersonaSlim } from '@headcount/catalog';
import { CHIEF_ID, coworkerAgentId } from '@headcount/protocol';
import type { ChannelEntry, MeetingResponse, MeetingSummary, TeamMember } from '@headcount/protocol/ext/projects';
import { MEETING_PEOPLE_MAX, MEETING_TOPIC_MAX } from '@headcount/protocol/ext/projects';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { mayContribute } from '../auth/session';
import { catalog, loadCatalog } from '../catalog';
import { chiefName, currentLead } from '../chief';
import { Face, leadSubject, personaSubject } from '../components/Face';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { CopyLink, PageTitle } from '../links/CopyLink';
import { listen, nowPlaying, stopListening } from '../meetings/listen';
import { KIND, TakeTheFloor } from '../projects/Meetings';
import { navigate, paths, queryParam } from '../router';
import { liveMeetings, meetingsById, projectChannels, projectList, teamIds, upsertMeetings, upsertProject } from '../store';
import { accentFor } from '../lib/accent';
import { takeVoice } from '../voice/handoff';
import './pages.css';
import './meetings.css';
import { Markdown } from '../components/Markdown';
import { plainText } from '../lib/markdown';

const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
/** The face's own light (its accent) on whatever holds it. */
const tint = (p: { avatar: { accent_color: string } } | undefined) => (p ? { '--accent': accentFor(p.avatar.accent_color) } : undefined);
const when = (at: string) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const MEETABLE = ['proposed', 'running', 'paused', 'needs_review'];

export function Meetings() {
  useEffect(() => void loadCatalog(), []);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .listMeetings()
      .then((r) => upsertMeetings(r.meetings))
      .catch((err) => setError(errorOf(err, 'Meetings could not be loaded. Reload the page to try again.')));
  }, []);
  const all = Object.values(meetingsById.value).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const live = liveMeetings.value;
  const earlier = all.filter((m) => m.status !== 'live').slice(0, 40);
  const chief = chiefName.value;
  return (
    <section class="page meetings-page" aria-labelledby="meetings-page-title">
      <header class="page-head">
        <PageTitle id="meetings-page-title">Meetings</PageTitle>
        <p class="page-lede">Bring people together to talk something through. {chief} moderates every meeting and brings you the outcome. Listen in, take the floor, or read it later.</p>
      </header>
      {mayContribute.value && <CallMeeting />}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <section class="meetings-section" aria-labelledby="live-title">
        <h2 id="live-title" class="admin-card-title">
          Live now
        </h2>
        {live.length ? (
          <ul class="meeting-cards">
            {live.map((m) => (
              <MeetingCard key={m.meetingId} meeting={m} />
            ))}
          </ul>
        ) : (
          <p class="page-fine">No one is meeting right now.</p>
        )}
      </section>
      <section class="meetings-section" aria-labelledby="earlier-title">
        <h2 id="earlier-title" class="admin-card-title">
          Earlier
        </h2>
        {earlier.length ? (
          <ul class="meeting-rows">
            {earlier.map((m) => (
              <MeetingRowLink key={m.meetingId} meeting={m} />
            ))}
          </ul>
        ) : (
          <p class="page-fine">Meetings you hold, and every project's kickoffs and reviews, are kept here.</p>
        )}
      </section>
    </section>
  );
}

/** Call a meeting: what to settle, and who sits at the table (your team, or a project's team). */
function CallMeeting() {
  const c = catalog.value;
  const team = (teamIds.value ?? []).map((id) => c?.persona(id)).filter((p): p is PersonaSlim => !!p);
  const projects = projectList.value.filter((p) => MEETABLE.includes(p.status));
  const preset = queryParam('project');
  const [topic, setTopic] = useState('');
  const [picked, setPicked] = useState<string[]>(() => (queryParam('with') ?? '').split(',').filter(Boolean));
  const [projectId, setProjectId] = useState(preset && projects.some((p) => p.projectId === preset) ? preset : '');
  const [kind, setKind] = useState<'discussion' | 'review'>('discussion');
  const [rounds, setRounds] = useState(1);
  const [followUp, setFollowUp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = projects.find((p) => p.projectId === projectId);
  const chief = chiefName.value;
  const lead = currentLead.value;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MEETING_PEOPLE_MAX ? p : [...p, id]));
  const ready = project ? kind === 'review' || topic.trim().length >= 3 : topic.trim().length >= 3 && picked.length > 0;
  const start = async (e: Event) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.callMeeting(project ? { topic: topic.trim(), projectId: project.projectId, kind, rounds } : { topic: topic.trim(), people: picked, rounds, followUp });
      upsertMeetings([r.meeting]);
      navigate(paths.meeting(r.meeting.meetingId));
    } catch (err) {
      setError(errorOf(err, 'The meeting did not start. Try again.'));
      setBusy(false);
    }
  };
  return (
    <form class="panel call-meeting" onSubmit={start} aria-labelledby="call-title">
      <h2 id="call-title" class="admin-card-title">
        Call a meeting
      </h2>
      <label class="field">
        <span class="field-label">{project && kind === 'review' ? 'Anything in particular? (optional)' : 'What should they talk through?'}</span>
        <textarea
          class="note-input"
          rows={3}
          maxLength={MEETING_TOPIC_MAX}
          value={topic}
          placeholder={project && kind === 'review' ? 'The pricing section' : 'For example: Should we launch a monthly crystal box, and at what price?'}
          onInput={(e) => setTopic((e.target as HTMLTextAreaElement).value)}
        />
      </label>
      {projects.length > 0 && (
        <div class="call-meeting-row">
          <label class="field field-inline">
            <span class="field-label">About</span>
            <select class="field-input" value={projectId} onChange={(e) => setProjectId((e.target as HTMLSelectElement).value)}>
              <option value="">Anything (pick who comes)</option>
              {projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  The project “{p.title}”
                </option>
              ))}
            </select>
          </label>
          {project && (
            <label class="field field-inline">
              <span class="field-label">Kind</span>
              <select class="field-input" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as 'discussion' | 'review')}>
                <option value="discussion">Discuss a question</option>
                <option value="review">Review the work so far</option>
              </select>
            </label>
          )}
        </div>
      )}
      <fieldset class="call-meeting-people">
        <legend class="field-label">{project ? `At the table: the project's team` : 'Who comes? The first person you pick chairs the meeting.'}</legend>
        <ul class="seat-chips">
          {lead && (
            <li class="seat-chip" data-on style={tint(lead)}>
              <Face subject={leadSubject(lead, chief)} tier="token" agentId={CHIEF_ID} decorative lazy />
              <span>{chief}</span>
              <span class="seat-role">Chief of Staff</span>
              <span class="seat-badge">Moderates</span>
            </li>
          )}
          {project
            ? project.team.map((m) => <TeamSeat key={m.personaId} member={m} />)
            : team.map((p) => {
                const at = picked.indexOf(p.id);
                return (
                  <li key={p.id}>
                    <button type="button" class="seat-chip" data-on={at >= 0 || undefined} aria-pressed={at >= 0} style={tint(p)} onClick={() => toggle(p.id)}>
                      <Face subject={personaSubject(p)} tier="token" agentId={coworkerAgentId(p.id)} decorative lazy />
                      <span>{firstName(p.name)}</span>
                      <span class="seat-role">{p.title}</span>
                      {at === 0 && <span class="seat-badge">Chairs</span>}
                    </button>
                  </li>
                );
              })}
        </ul>
        {!project && !team.length && (
          <p class="page-fine">
            No one on your team yet. <Link href={paths.hire}>Hire your team</Link>, then meet.
          </p>
        )}
      </fieldset>
      <div class="admin-row">
        <label class="field field-inline">
          <span class="field-label">Length</span>
          <select class="field-input" value={rounds} onChange={(e) => setRounds(Number((e.target as HTMLSelectElement).value))}>
            <option value={1}>Quick: each says their piece</option>
            <option value={2}>Longer: with a debate</option>
          </select>
        </label>
        <button type="submit" class="button-primary" disabled={!ready || busy} aria-describedby={ready ? undefined : 'call-needs'}>
          <Icon name="meetings" size={16} /> {busy ? 'Starting…' : 'Start the meeting'}
        </button>
      </div>
      {!ready && (
        <p class="field-hint" id="call-needs">
          {project ? 'Write what they should talk through.' : topic.trim().length >= 3 ? 'Pick at least one person.' : picked.length ? 'Write what they should talk through.' : 'Write what they should talk through, and pick who comes.'}
        </p>
      )}
      {!project && (
        <label class="grant-label call-meeting-follow">
          <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.currentTarget.checked)} />
          <span class="grant-name">When it ends, the chair leads the work they agree on</span>
        </label>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function TeamSeat({ member: m }: { member: TeamMember }) {
  const p = catalog.value?.persona(m.personaId);
  return (
    <li class="seat-chip" data-on style={tint(p)}>
      {p && <Face subject={personaSubject(p)} tier="token" agentId={coworkerAgentId(p.id)} decorative lazy />}
      <span>{firstName(m.name)}</span>
      <span class="seat-role">{m.title}</span>
      {m.role === 'lead' && <span class="seat-badge">Chairs</span>}
    </li>
  );
}

/** The faces at a meeting's table: the Chief, then the chair and the rest. */
function Faces({ people, speakerId }: { people: readonly string[]; speakerId?: string | undefined }) {
  const c = catalog.value;
  const lead = currentLead.value;
  return (
    <span class="meeting-faces">
      {lead && (
        <span class="meeting-face" style={tint(lead)}>
          <Face subject={leadSubject(lead, chiefName.value)} tier="token" agentId={CHIEF_ID} decorative lazy />
        </span>
      )}
      {people.slice(0, 6).map((id) => {
        const p = c?.persona(id);
        return p ? (
          <span key={id} class="meeting-face" data-speaking={speakerId === id || undefined} style={tint(p)}>
            <Face subject={personaSubject(p)} tier="token" agentId={coworkerAgentId(id)} decorative lazy />
          </span>
        ) : null;
      })}
    </span>
  );
}

const nameOf = (id: string | undefined) => (id ? (catalog.value?.persona(id)?.name.split(' ')[0] ?? id) : '');
const titleOf = (m: MeetingSummary) => (m.kind === 'review' ? `Review: ${m.title ?? 'the work so far'}` : m.kind === 'kickoff' ? `Kickoff: ${m.title ?? ''}` : m.standalone ? (m.title ?? m.question) : m.question);

function MeetingCard({ meeting: m }: { meeting: MeetingSummary }) {
  return (
    <li class="panel meeting-card" data-live>
      <div class="meeting-card-head">
        <span class="connector-tag meeting-live-tag">Live</span>
        <span class="connector-tag">{KIND[m.kind]}</span>
        {!m.standalone && m.title && <span class="page-fine">{m.title}</span>}
      </div>
      <p class="meeting-card-title">{titleOf(m)}</p>
      <div class="meeting-card-foot">
        <Faces people={m.people ?? [m.chairId]} speakerId={m.speakerId} />
        <span class="page-fine">{m.speakerId ? `${nameOf(m.speakerId)} has the floor` : 'About to start'}</span>
        <Link href={paths.meeting(m.meetingId)} class="button-primary button-small">
          <Icon name="headphones" size={14} /> Join
        </Link>
      </div>
    </li>
  );
}

function MeetingRowLink({ meeting: m }: { meeting: MeetingSummary }) {
  return (
    <li class="meeting-row-link">
      <Link href={paths.meeting(m.meetingId)} class="meeting-row-main">
        <span class="meeting-row-title">
          <span class="connector-tag">{KIND[m.kind]}</span> {titleOf(m)}
        </span>
        <span class="page-fine">
          {m.status === 'stopped' ? 'Stopped' : 'Held'} {when(m.startedAt)} · chaired by {nameOf(m.chairId)}
          {!m.standalone && m.title ? ` · ${m.title}` : ''}
        </span>
        {m.summary && <span class="meeting-row-summary">{plainText(m.summary)}</span>}
      </Link>
      <Faces people={m.people ?? [m.chairId]} />
    </li>
  );
}

const PHASE: Record<string, string> = { framing: 'frames it', opening: 'opens', debate: 'debates', synthesis: 'sums up', reply: 'answers', moderator: 'moderating' };

/** One meeting's room: the table, who has the floor, the lines as they are said, Listen in, and the floor for the owner. */
export function MeetingRoom({ meetingId }: { meetingId: string }) {
  useEffect(() => void loadCatalog(), []);
  const [data, setData] = useState<MeetingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const known = meetingsById.value[meetingId];
  const projectId = data?.meeting.projectId ?? known?.projectId;
  const lines = projectId ? (projectChannels.value[projectId] ?? []).filter((e) => e.meetingId === meetingId).length : 0;
  useEffect(() => {
    api
      .findMeeting(meetingId)
      .then((r) => {
        setData(r);
        upsertMeetings([r.meeting]);
      })
      .catch((err) => setError(errorOf(err, 'That meeting could not be found.')));
  }, [meetingId, lines, known?.status, known?.speakerId]);
  if (error && !data)
    return (
      <section class="page" aria-labelledby="room-title">
        <PageTitle id="room-title">Meeting</PageTitle>
        <p class="form-error" role="alert">
          {error}
        </p>
        <Link href={paths.meetings}>All meetings</Link>
      </section>
    );
  if (!data)
    return (
      <section class="page" aria-busy="true">
        <p class="page-fine">Loading the meeting…</p>
      </section>
    );
  const m = { ...data.meeting, ...(known && known.meetingId === meetingId ? known : {}) };
  const live = m.status === 'live';
  const team = data.team;
  const chief = chiefName.value;
  const lead = currentLead.value;
  const first = (id: string) => (id === 'owner' ? 'You' : id === 'chief' ? chief : (team.find((t) => t.personaId === id)?.name.split(' ')[0] ?? id));
  const playing = nowPlaying.value?.meetingId === meetingId;
  const listenIn = () => {
    takeVoice();
    void listen(m.projectId, meetingId, { from: live ? 'live' : 'start', title: m.title ?? m.question }).catch((err) => setError(errorOf(err, 'That meeting could not be played.')));
  };
  const seats = [m.chairId, ...team.map((t) => t.personaId).filter((id) => id !== m.chairId)];
  const startWork = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const r = await api.meetingWork(meetingId);
      upsertProject(r.project);
      navigate(paths.project(r.project.projectId));
    } catch (err) {
      setError(errorOf(err, 'The work did not start. Try again.'));
      setStarting(false);
    }
  };
  return (
    <section class="page meeting-room" aria-labelledby="room-title">
      <header class="page-head">
        <Link href={paths.meetings} class="link-button link-button-hit room-back">
          <Icon name="chevronLeft" size={16} /> Meetings
        </Link>
        <div class="room-head">
          <span class="connector-tag">{KIND[m.kind]}</span>
          {live && <span class="connector-tag meeting-live-tag">Live</span>}
          {!m.standalone && (
            <Link href={paths.project(m.projectId)} class="page-fine">
              {m.title}
            </Link>
          )}
        </div>
        <PageTitle id="room-title">{titleOf(m)}</PageTitle>
        <p class="page-lede">
          {live ? (m.speakerId ? `${first(m.speakerId)} has the floor.` : 'About to start.') : `${m.status === 'stopped' ? 'Stopped' : 'Held'} ${when(m.startedAt)}.`} {first(m.chairId)} chairs; {chief} moderates.
        </p>
      </header>

      <div class="room-table" aria-label="At the table">
        {lead && (
          <figure class="room-seat room-seat-chief" style={tint(lead)}>
            <Face subject={leadSubject(lead, chief)} tier="tile" agentId={CHIEF_ID} label={`${chief}, Chief of Staff`} />
            <figcaption>
              {chief}
              <span class="seat-role">Chief of Staff</span>
              <span class="seat-badge">Moderates</span>
            </figcaption>
          </figure>
        )}
        {seats.map((id) => {
          const p = catalog.value?.persona(id);
          return p ? (
            <figure key={id} class="room-seat" data-speaking={(live && m.speakerId === id) || undefined} style={tint(p)}>
              <Face subject={personaSubject(p)} tier="tile" state={live && m.speakerId === id ? 'thinking' : 'idle'} agentId={coworkerAgentId(id)} label={`${p.name}, ${p.title}`} />
              <figcaption>
                {firstName(p.name)}
                <span class="seat-role">{p.title}</span>
                {id === m.chairId && <span class="seat-badge">Chairs</span>}
              </figcaption>
            </figure>
          ) : null;
        })}
      </div>

      <div class="room-actions">
        {playing ? (
          <button type="button" class="button-quiet" onClick={stopListening}>
            <Icon name="stop" size={16} /> Stop listening
          </button>
        ) : (
          <button type="button" class={live ? 'button-primary' : 'button-quiet'} onClick={listenIn}>
            <Icon name="headphones" size={16} /> {live ? 'Listen in' : 'Replay it'}
          </button>
        )}
        <CopyLink page={paths.meeting(meetingId)} label="Copy link to this meeting" what="Link to this meeting" />
      </div>

      {live && mayContribute.value && <TakeTheFloor projectId={m.projectId} team={team} meetingId={meetingId} />}

      {!live && m.summary && (
        <section class="panel room-outcome" aria-labelledby="outcome-title">
          <h2 id="outcome-title" class="admin-card-title">
            What they agreed
          </h2>
          <Markdown text={m.summary} class="room-summary" />
          {m.work && (
            <p class="room-work" role="status">
              <Icon name="projects" size={16} /> The team is on it: <Link href={paths.project(m.work.projectId)}>{m.work.title}</Link>
            </p>
          )}
          <div class="admin-row">
            {m.standalone && !m.work && mayContribute.value && (
              <button type="button" class="button-primary" onClick={() => void startWork()} disabled={starting}>
                <Icon name="projects" size={16} /> {starting ? 'Starting…' : 'Start the work'}
              </button>
            )}
            <Link href={paths.talk} class="button-quiet">
              Talk it over with {chief}
            </Link>
          </div>
          {error && (
            <p class="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}

      <section class="room-transcript" aria-labelledby="transcript-title">
        <h2 id="transcript-title" class="admin-card-title">
          {live ? 'As it happens' : 'Transcript'}
        </h2>
        <ol class="room-lines" aria-live={live ? 'polite' : undefined}>
          {data.entries.map((e) => (
            <RoomLine key={e.seq} entry={e} name={first(e.fromId)} to={e.toId ? first(e.toId) : null} />
          ))}
          {!data.entries.length && <li class="page-fine">Nothing said yet.</li>}
          {live && m.speakerId && <li class="room-line room-line-typing">{first(m.speakerId)} is speaking…</li>}
        </ol>
      </section>
    </section>
  );
}

function RoomLine({ entry: e, name, to }: { entry: ChannelEntry; name: string; to: string | null }) {
  const c = catalog.value;
  const lead = currentLead.value;
  const p = e.fromId !== 'chief' && e.fromId !== 'owner' ? c?.persona(e.fromId) : undefined;
  return (
    <li class="room-line" data-kind={e.kind} data-phase={e.phase} data-from={e.fromId === 'owner' ? 'owner' : undefined}>
      <span class="room-line-face" aria-hidden="true" style={tint(p ?? (e.fromId === 'chief' ? lead : undefined))}>
        {p ? <Face subject={personaSubject(p)} tier="token" agentId={coworkerAgentId(p.id)} decorative lazy /> : e.fromId === 'chief' && lead ? <Face subject={leadSubject(lead, name)} tier="token" agentId={CHIEF_ID} decorative lazy /> : <Icon name="user" size={18} />}
      </span>
      <div class="room-line-body">
        <p class="room-line-who">
          <strong>{name}</strong>
          {e.phase && PHASE[e.phase] && <span class="page-fine"> · {PHASE[e.phase]}</span>}
          {e.kind === 'whisper' && <span class="page-fine"> · whispered to {to}</span>}
          {e.kind === 'owner' && to && <span class="page-fine"> → {to}</span>}
        </p>
        <Markdown text={e.text} class="room-line-text" />
      </div>
    </li>
  );
}
