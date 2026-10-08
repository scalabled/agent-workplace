// Now: what is going on in the office at a glance, so the owner never has to piece it together. What needs them, the
// meetings going on, the work under way (each project's steps in progress and who is on them, and background jobs),
// what everyone is doing this minute, and what finished lately. Everything links to where it lives; "Ask for an
// update" puts the question to the Chief of Staff in Talk.
import { CHIEF_ID, coworkerAgentId } from '@headcount/protocol';
import type { JobSnapshot } from '@headcount/protocol';
import type { TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { useEffect } from 'preact/hooks';
import { api } from '../api/client';
import { catalog, loadCatalog } from '../catalog';
import { chiefName, currentLead } from '../chief';
import { Face, leadSubject, personaSubject } from '../components/Face';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { PROJECT_STATUS_WORDS, progressOf } from '../components/ProjectCard';
import { PageTitle } from '../links/CopyLink';
import { ago, now } from '../lib/time';
import { linkTo, navigate, paths } from '../router';
import { decisionList, fileList, jobList, liveMeetings, presenceFor, projectList, teamIds, upsertFiles, upsertMeetings } from '../store';
import { prefillComposer } from '../talk/draft';
import './now.css';

/** Projects under way (they show as work in progress). */
const ACTIVE: readonly TeamProjectSnapshot['status'][] = ['planning', 'proposed', 'running', 'paused', 'needs_review'];
/** "Done lately" reaches back this far. */
const LATELY_MS = 24 * 60 * 60_000;

const firstOf = (name: string | undefined) => (name ?? '').split(' ')[0] ?? '';
const nameOf = (personaId: string) => firstOf(catalog.value?.persona(personaId)?.name) || personaId;

/** "Nina and Andre at work on 2 projects · 1 meeting · 2 things need you" (or the quiet line). */
export function nowSummary(i: { working: number; projects: number; jobs: number; meetings: number; needs: number }, chief: string): string {
  const parts: string[] = [];
  if (i.working) parts.push(`${i.working} ${i.working === 1 ? 'person' : 'people'} at work${i.projects ? ` on ${i.projects} ${i.projects === 1 ? 'project' : 'projects'}` : ''}`);
  else if (i.projects) parts.push(`${i.projects} ${i.projects === 1 ? 'project' : 'projects'} under way`);
  if (i.jobs) parts.push(`${i.jobs} background ${i.jobs === 1 ? 'job' : 'jobs'}`);
  if (i.meetings) parts.push(`${i.meetings} ${i.meetings === 1 ? 'meeting' : 'meetings'} going on`);
  if (i.needs) parts.push(`${i.needs} ${i.needs === 1 ? 'thing needs' : 'things need'} you`);
  return parts.length ? `${parts.join(' · ')}.` : `All quiet right now. Ask ${chief} for something, call a meeting, or bring people into a room.`;
}

/** Live work for the summary (also Talk's "at work" line). */
export function workCounts() {
  const projects = projectList.value.filter((p) => ACTIVE.includes(p.status));
  const jobs = jobList.value.filter((j) => j.status === 'queued' || j.status === 'running');
  const team = teamIds.value ?? [];
  const busy = new Set<string>();
  for (const id of [...team, ...projects.flatMap((p) => p.team.map((m) => m.personaId))]) {
    const s = presenceFor(coworkerAgentId(id)).state;
    if (s !== 'idle') busy.add(id);
  }
  return { projects, jobs, working: busy.size, meetings: liveMeetings.value.length, needs: decisionList.value.length };
}

export function Now() {
  useEffect(() => {
    void loadCatalog();
    // Meetings and files load where they live; this page needs them too.
    api
      .listMeetings()
      .then((r) => upsertMeetings(r.meetings))
      .catch(() => undefined);
    api
      .listFiles()
      .then((r) => upsertFiles(r.files))
      .catch(() => undefined);
  }, []);
  const chief = chiefName.value;
  const c = workCounts();
  const askUpdate = () => {
    prefillComposer('What is everyone working on right now, and what is next?');
    navigate(paths.talk);
  };
  return (
    <section class="page now-page" aria-labelledby="now-title">
      <header class="page-head">
        <PageTitle id="now-title">What’s going on</PageTitle>
        <p class="page-lede" role="status">
          {nowSummary({ working: c.working, projects: c.projects.length, jobs: c.jobs.length, meetings: c.meetings, needs: c.needs }, chief)}
        </p>
        <div class="admin-row">
          <button type="button" class="button-quiet" onClick={askUpdate}>
            <Icon name="talk" size={16} /> Ask {chief} for an update
          </button>
        </div>
      </header>
      <NeedsYou />
      <MeetingsNow />
      <WorkUnderWay projects={c.projects} jobs={c.jobs} />
      <TheTeam />
      <DoneLately />
    </section>
  );
}

function NeedsYou() {
  const open = decisionList.value;
  if (!open.length) return null;
  return (
    <section class="now-section" aria-labelledby="now-needs">
      <h2 id="now-needs" class="admin-card-title">
        Needs you
      </h2>
      <ul class="now-list">
        {open.slice(0, 6).map((d) => (
          <li key={d.decisionId} class="now-row" data-tone="hand">
            <span class="state-glyph" data-state="raised_hand" aria-hidden="true" />
            <span class="now-row-text">
              <Link href={linkTo(paths.inbox, d.decisionId)}>{d.title}</Link>
              {d.fromId && <span class="now-fine"> · from {nameOf(d.fromId)}</span>}
            </span>
          </li>
        ))}
      </ul>
      <Link href={paths.inbox} class="now-more">
        {open.length > 6 ? `All ${open.length} in your Inbox` : 'Open your Inbox'}
      </Link>
    </section>
  );
}

function MeetingsNow() {
  const live = liveMeetings.value;
  if (!live.length) return null;
  return (
    <section class="now-section" aria-labelledby="now-meetings">
      <h2 id="now-meetings" class="admin-card-title">
        Meetings going on
      </h2>
      <ul class="now-list">
        {live.map((m) => (
          <li key={m.meetingId} class="now-row">
            <Icon name="meetings" size={16} />
            <span class="now-row-text">
              <Link href={paths.meeting(m.meetingId)}>{m.title ?? m.question}</Link>
              <span class="now-fine">
                {' '}
                · {(m.people ?? [m.chairId]).map(nameOf).join(', ')}
                {m.speakerId ? ` · ${nameOf(m.speakerId)} has the floor` : ''}
              </span>
            </span>
            <Link href={paths.meeting(m.meetingId)} class="button-quiet button-small">
              Join
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The steps moving now in a project, as "who: what". */
function moving(p: TeamProjectSnapshot): { id: string; who: string; what: string }[] {
  const out: { id: string; who: string; what: string }[] = [];
  if (p.status === 'planning') {
    const lead = p.team.find((m) => m.role === 'lead') ?? p.team[0];
    if (lead) out.push({ id: 'plan', who: firstOf(lead.name), what: p.startsNow ? 'Drafting the plan; work starts as soon as it is ready' : 'Drafting the plan' });
    return out;
  }
  if (p.discussion) out.push({ id: 'meeting', who: nameOf(p.discussion.speakerId), what: p.kickoff === 'pending' ? 'Speaking in the kickoff' : `In a discussion: ${p.discussion.question}` });
  for (const s of p.steps) {
    const lead = s.byId ?? s.ownerId;
    if (s.status === 'working') out.push({ id: s.id, who: nameOf(lead), what: s.title });
    else if (s.status === 'revising') out.push({ id: s.id, who: nameOf(lead), what: `Revising: ${s.title}` });
    else if (s.status === 'reviewing') out.push({ id: s.id, who: s.reviewerIds.map(nameOf).join(' and ') || nameOf(lead), what: `Reviewing: ${s.title}` });
    else if (s.status === 'asking') out.push({ id: s.id, who: nameOf(lead), what: `Has a question for you: ${s.question?.text ?? s.title}` });
  }
  return out;
}

function WorkUnderWay({ projects, jobs }: { projects: TeamProjectSnapshot[]; jobs: JobSnapshot[] }) {
  void now.value;
  return (
    <section class="now-section" aria-labelledby="now-work">
      <h2 id="now-work" class="admin-card-title">
        Work under way
      </h2>
      {!projects.length && !jobs.length && <p class="page-fine">Nothing is under way. Ask for something in Talk, at anyone’s desk, or in a room, and it starts here.</p>}
      <ul class="now-cards">
        {projects.map((p) => {
          const { done, total, pct } = progressOf(p);
          const lead = p.team.find((m) => m.role === 'lead') ?? p.team[0];
          const steps = moving(p);
          return (
            <li key={p.projectId} class="now-card panel">
              <div class="now-card-head">
                <Link href={paths.project(p.projectId)} class="now-card-title">
                  {p.title}
                </Link>
                <span class="connector-tag" data-status={p.status}>
                  {PROJECT_STATUS_WORDS[p.status]}
                </span>
              </div>
              <p class="now-fine">
                {lead ? `${firstOf(lead.name)} leads` : ''}
                {p.team.length > 1 ? `, with ${p.team.filter((m) => m !== lead).map((m) => firstOf(m.name)).join(', ')}` : ''}
                {total ? ` · ${done} of ${total} steps done` : ''} · started {ago(p.createdAt)}
              </p>
              {total > 0 && (
                <div class="now-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${p.title}: ${pct}% done`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              )}
              {steps.length > 0 && (
                <ul class="now-steps">
                  {steps.map((s) => (
                    <li key={s.id}>
                      <b>{s.who}</b> {s.what}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {jobs.map((j) => (
          <li key={j.jobId} class="now-card panel">
            <div class="now-card-head">
              <Link href={linkTo(paths.projects, j.jobId)} class="now-card-title">
                {j.title}
              </Link>
              <span class="connector-tag">{j.status === 'queued' ? 'Up next' : 'Working'}</span>
            </div>
            <p class="now-fine">
              A background job {chiefName.value} is keeping track of · started {ago(j.startedAt)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TheTeam() {
  const c = catalog.value;
  const lead = currentLead.value;
  const chief = chiefName.value;
  const team = (teamIds.value ?? []).map((id) => c?.persona(id)).filter((p): p is NonNullable<typeof p> => !!p);
  const chiefShown = presenceFor(CHIEF_ID);
  return (
    <section class="now-section" aria-labelledby="now-team">
      <h2 id="now-team" class="admin-card-title">
        Who’s doing what
      </h2>
      <ul class="now-people">
        {lead && (
          <li>
            <Link href={paths.talk} class="now-person">
              <Face subject={leadSubject(lead, chief)} tier="token" state={chiefShown.state} agentId={CHIEF_ID} decorative lazy />
              <span class="now-person-text">
                <b>{chief}</b>
                <span class="now-fine" data-state={chiefShown.state}>
                  {chiefShown.state === 'idle' ? 'Chief of Staff · available' : `Chief of Staff · ${chiefShown.label}`}
                </span>
              </span>
            </Link>
          </li>
        )}
        {team.map((p) => {
          const shown = presenceFor(coworkerAgentId(p.id));
          return (
            <li key={p.id}>
              <Link href={paths.coworker(p.id)} class="now-person">
                <Face subject={personaSubject(p)} tier="token" state={shown.state} agentId={coworkerAgentId(p.id)} decorative lazy />
                <span class="now-person-text">
                  <b>{firstOf(p.name)}</b>
                  <span class="now-fine" data-state={shown.state}>
                    {shown.state === 'idle' ? `${p.title} · free to take something on` : shown.label}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {!team.length && (
        <p class="page-fine">
          No one on your team yet. <Link href={paths.hire}>Hire your team</Link>.
        </p>
      )}
    </section>
  );
}

function DoneLately() {
  const t = now.value;
  const recent = (at: string | undefined) => !!at && t - Date.parse(at) < LATELY_MS;
  const projects = projectList.value.filter((p) => ['done', 'partial', 'failed'].includes(p.status) && recent(p.finishedAt));
  const jobs = jobList.value.filter((j) => ['done', 'failed'].includes(j.status) && recent(j.finishedAt));
  const files = fileList.value.filter((f) => f.status === 'ready' && recent(f.createdAt)).slice(0, 6);
  if (!projects.length && !jobs.length && !files.length) return null;
  return (
    <section class="now-section" aria-labelledby="now-done">
      <h2 id="now-done" class="admin-card-title">
        Done lately
      </h2>
      <ul class="now-list">
        {projects.map((p) => (
          <li key={p.projectId} class="now-row">
            <Icon name={p.status === 'failed' ? 'close' : 'check'} size={16} />
            <span class="now-row-text">
              <Link href={paths.project(p.projectId)}>{p.title}</Link>
              <span class="now-fine">
                {' '}
                · {PROJECT_STATUS_WORDS[p.status].toLowerCase()} {ago(p.finishedAt!)}
              </span>
            </span>
          </li>
        ))}
        {jobs.map((j) => (
          <li key={j.jobId} class="now-row">
            <Icon name={j.status === 'failed' ? 'close' : 'check'} size={16} />
            <span class="now-row-text">
              <Link href={linkTo(paths.projects, j.jobId)}>{j.title}</Link>
              <span class="now-fine"> · {j.status === 'failed' ? 'failed' : 'done'} {ago(j.finishedAt!)}</span>
            </span>
          </li>
        ))}
        {files.map((f) => (
          <li key={f.fileId} class="now-row">
            <Icon name="file" size={16} />
            <span class="now-row-text">
              <Link href={paths.files}>{f.title}</Link>
              <span class="now-fine"> · {f.kind} made {ago(f.createdAt)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
