// Your team (ext/team.ts): meet the people who work with you — your Chief of Staff and the everyday coworkers the
// office starts with. Hear each one, say hello at their desk, and give them their first job with one click. One of them
// keeps the company's second brain (memory and Handbook) tidy every week.
import { coworkerAgentId, CHIEF_ID } from '@headcount/protocol';
import { firstName, personaVoiceRef, type PersonaSlim } from '@headcount/catalog';
import type { TeamMemberView, TeamResponse } from '@headcount/protocol/ext/team';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { isOwner, mayContribute } from '../auth/session';
import { catalog, loadCatalog } from '../catalog';
import { chiefName, currentLead } from '../chief';
import { Face, leadSubject, personaSubject } from '../components/Face';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { useSampleSpeaker, VoiceSample } from '../components/VoiceSample';
import { accentFor } from '../lib/accent';
import { CopyLink, PageTitle } from '../links/CopyLink';
import { showToast } from '../links/links';
import { linkTo, navigate, paths } from '../router';
import { localPresence, teamIds } from '../store';
import './pages.css';
import './team.css';

const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const when = (at?: string) => (at ? new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '');

export function Team() {
  useEffect(() => void loadCatalog(), []);
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .getTeam()
      .then(setTeam)
      .catch((err) => setError(errorOf(err, 'Could not load your team. Reload the page to try again.')));
  }, []);
  const c = catalog.value;
  const lead = currentLead.value;
  const name = chiefName.value;
  const remove = async (personaId: string) => {
    if (!team) return;
    try {
      const t = await api.letGo(personaId);
      setTeam(t);
      teamIds.value = t.members.map((m) => m.personaId);
    } catch (err) {
      setError(errorOf(err, 'That did not go through. Try again.'));
    }
  };
  return (
    <section class="page team-page" aria-labelledby="team-title">
      <header class="page-head">
        <PageTitle id="team-title">Your team</PageTitle>
        <p class="page-lede">The people you hired. Hear them, say hello at their desk, or give them their first job: each one has something ready to start.</p>
        <div class="team-head-actions">
          {isOwner.value && (
            <Link href={paths.hire} class="button-primary button-small team-hire">
              <Icon name="plus" size={16} /> Hire someone
            </Link>
          )}
          {(teamIds.value?.length ?? 0) > 0 && mayContribute.value && (
            <Link href={paths.meetings} class="button-quiet button-small">
              <Icon name="meetings" size={16} /> Call a meeting
            </Link>
          )}
        </div>
      </header>
      {lead && (
        <article class="panel team-chief" id="chief" style={{ '--accent': accentFor(lead.avatar.accent_color) }} aria-labelledby="team-chief-name">
          <Face subject={leadSubject(lead, name)} tier="tile" agentId={CHIEF_ID} decorative />
          <div class="team-card-text">
            <h2 id="team-chief-name" class="team-name">
              {name}
            </h2>
            <p class="team-title">
              Chief of Staff · {lead.archetype}
            </p>
            <p class="team-why">{lead.tagline} Runs the team for you: tell {name} what you need and it gets to the right person.</p>
            <div class="team-actions">
              <Link href={paths.talk} class="button-quiet button-small">
                <Icon name="talk" size={14} /> Talk with {name}
              </Link>
              {mayContribute.value && (
                <button
                  type="button"
                  class="button-primary button-small"
                  onClick={async () => {
                    try {
                      await api.startInterview();
                      navigate(paths.talk);
                    } catch (err) {
                      showToast(errorOf(err, 'That did not start. Try again.'));
                    }
                  }}
                >
                  First job: write your Handbook together
                </button>
              )}
            </div>
          </div>
        </article>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {(!team || !c) && !error && <p class="page-fine">Loading…</p>}
      {team && team.members.length === 0 && (
        <p class="panel team-empty" role="status">
          Nobody hired yet: it’s you and {name}. {name} suggests people for your business, each with a first job ready.{' '}
          {isOwner.value && (
            <Link href={`${paths.hire}?first=1`} class="button-primary button-small">
              Hire your first coworkers
            </Link>
          )}
        </p>
      )}
      {team && c && team.members.length > 0 && (
        <ul class="team-grid">
          {team.members.map((m) => {
            const p = c.persona(m.personaId);
            return p ? <MemberCard key={m.personaId} member={m} persona={p} team={team} onTeam={setTeam} onRemove={() => void remove(m.personaId)} /> : null;
          })}
        </ul>
      )}
      {team && (
        <p class="page-fine team-more">
          <Link href={paths.floor}>Everyone in the directory</Link> can be brought into a project for a while; hire the ones you work with most.
        </p>
      )}
    </section>
  );
}

function MemberCard({ member: m, persona: p, team, onTeam, onRemove }: { member: TeamMemberView; persona: PersonaSlim; team: TeamResponse; onTeam: (t: TeamResponse) => void; onRemove: () => void }) {
  const first = firstName(p.name);
  const agentId = coworkerAgentId(p.id);
  const speaker = useSampleSpeaker(agentId, personaVoiceRef(p));
  const speaking = Boolean(localPresence.value[speaker.speakerId]?.speaking);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  // The × that opened the question is gone: focus moves to the safe answer.
  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);
  const [started, setStarted] = useState(m.started ?? null);
  const steward = m.firstTask.kind === 'second-brain';
  const sb = team.secondBrain;
  const start = async () => {
    setBusy(true);
    try {
      const r = await api.startTeamTask(p.id);
      showToast(r.say, 5000);
      setStarted({ at: new Date().toISOString(), ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.projectId ? { projectId: r.projectId } : {}) });
      if (steward) onTeam(await api.getTeam());
    } catch (err) {
      showToast(errorOf(err, 'That did not start. Try again.'), 5000);
    } finally {
      setBusy(false);
    }
  };
  const startedLink = started?.projectId ? paths.project(started.projectId) : started?.jobId ? linkTo(paths.projects, started.jobId) : null;
  return (
    <li class="panel team-card" id={p.id} style={{ '--accent': accentFor(p.avatar.accent_color) }}>
      <Face subject={personaSubject(p)} tier="tile" state={speaking ? 'speaking' : 'idle'} sampler={speaker.mouth} agentId={agentId} decorative lazy />
      <div class="team-card-text">
        <div class="page-title-row">
          <h2 class="team-name">
            <Link href={paths.coworker(p.id)}>{p.name}</Link>
          </h2>
          <CopyLink page={paths.team} at={p.id} label={`Copy link to ${first}`} what={`Link to ${first}`} />
        </div>
        <p class="team-title">{p.title}</p>
        <p class="team-why">{m.why}</p>
        <div class="team-task">
          <span class="team-task-label">{steward ? 'Every week' : 'First job'}</span>
          <strong>{m.firstTask.title}</strong>
          {steward && (
            <span class="connector-meta">
              {sb.on ? (sb.last ? `Last tidied ${when(sb.last.at)}. ${sb.last.summary}` : `First tidy ${sb.nextAt ? when(sb.nextAt) : 'soon'}.`) : 'Paused.'}{' '}
              {sb.last && <Link href={linkTo(paths.memory, 'second-brain')}>See the report</Link>}
            </span>
          )}
        </div>
        <div class="team-actions">
          <VoiceSample speaker={speaker} text={p.intro_line} name={first} />
          <Link href={paths.coworker(p.id)} class="button-quiet button-small">
            <Icon name="talk" size={14} /> Say hello
          </Link>
          {!steward && started && startedLink ? (
            <Link href={startedLink} class="button-quiet button-small">
              Started · see it <Icon name="chevronRight" size={14} />
            </Link>
          ) : (
            mayContribute.value && (
              <button type="button" class="button-primary button-small" disabled={busy} onClick={() => void start()}>
                {busy ? 'Starting…' : steward ? 'Tidy now' : 'Start'}
              </button>
            )
          )}
          {steward && isOwner.value && (
            <label class="grant-label team-toggle">
              <input type="checkbox" checked={sb.on} onChange={async (e) => onTeam(await api.putSecondBrain(e.currentTarget.checked))} />
              <span class="grant-name">Weekly</span>
            </label>
          )}
          {isOwner.value && !confirming && (
            <button type="button" class="icon-button icon-button-sm team-remove" aria-label={`Let ${first} go`} title={`Let ${first} go`} onClick={() => setConfirming(true)}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        {confirming && (
          <div class="team-confirm" role="group" aria-label={`Let ${first} go?`}>
            <p class="page-fine">
              {first} leaves your team and stays in the directory. You can hire {first} again later.
            </p>
            <div class="team-actions">
              <button type="button" class="button-quiet button-small button-danger" onClick={onRemove}>
                Let {first} go
              </button>
              <button type="button" class="button-quiet button-small" ref={keep} onClick={() => setConfirming(false)}>
                Keep {first}
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
