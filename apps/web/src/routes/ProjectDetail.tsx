// One team project (Inc 1): what it is for, who is on it (faces show what each is doing now), the reviewed plan with
// each step's work, and the deliverable. A proposed plan waits for the owner's OK here and in the Inbox. While it is
// under way the owner steers without stopping anyone: a note reaches the next step, Pause lets steps under way finish.
import { PROJECT_NOTE_MAX, type ProjectNote, type ProjectStep, type TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { useEffect, useState } from 'preact/hooks';
import { loadCatalog } from '../catalog';
import { chiefName } from '../chief';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { Markdown } from '../components/Markdown';
import { Sources } from '../components/Sources';
import { MemberFace, PROJECT_STATUS_WORDS, STEP_STATUS_WORDS, progressOf, projectGlyph, stepGlyph } from '../components/ProjectCard';
import { approveProject, cancelProject, loadProject, noteProject, pauseProject, projectBusy, projectError, resumeProject } from '../projects/actions';
import { navigate, paths } from '../router';
import { presenceFor, teamProjects } from '../store';
import './pages.css';

function roleWord(role: string): string {
  return { lead: 'Lead', co_owner: 'Co-owner', reviewer: 'Reviewer', sceptic: 'Sceptic', specialist: 'Specialist', facilitator: 'Facilitator' }[role] ?? role;
}

/** How long a finished step took ("took 2 min"), from its own timestamps. */
function took(step: ProjectStep): string | null {
  if (!step.startedAt || !step.finishedAt) return null;
  const s = Math.max(0, (Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000);
  if (!Number.isFinite(s)) return null;
  return s < 60 ? `took ${Math.max(1, Math.round(s))} s` : `took ${Math.round(s / 60)} min`;
}

function StepCard({ step, project, index }: { step: ProjectStep; project: TeamProjectSnapshot; index: number }) {
  const [open, setOpen] = useState(false);
  const owner = project.team.find((m) => m.personaId === step.ownerId);
  const reviewer = project.team.find((m) => m.personaId === step.reviewerIds[0]);
  const after = step.dependsOn.map((d) => project.steps.find((s) => s.id === d)?.title).filter(Boolean);
  const canOpen = !!step.output;
  return (
    <li class="step" data-status={step.status}>
      <div class="step-head">
        <span class="step-num tabular" aria-hidden="true">
          {index + 1}
        </span>
        <span class="job-glyph" data-status={stepGlyph(step.status)} aria-hidden="true" />
        <div class="step-main">
          <p class="step-title">{step.title}</p>
          <p class="step-meta">
            {owner && (
              <span class="step-who">
                <MemberFace member={owner} live />
                {owner.name.split(' ')[0]}
              </span>
            )}
            {reviewer && <span class="step-reviewer">reviewed by {reviewer.name.split(' ')[0]}</span>}
            {after.length > 0 && step.status === 'waiting' && <span class="step-after">after {after.join(', ')}</span>}
            {step.status === 'done' && took(step) && <span class="step-took tabular">{took(step)}</span>}
            {step.sources?.length ? <span class="step-sources tabular">{step.sources.length === 1 ? '1 source' : `${step.sources.length} sources`}</span> : null}
          </p>
        </div>
        <span class="step-status">{STEP_STATUS_WORDS[step.status]}</span>
        {canOpen && (
          <button type="button" class="icon-button" aria-expanded={open} aria-label={open ? `Hide ${step.title}` : `Show ${step.title}`} onClick={() => setOpen(!open)}>
            <Icon name="chevronDown" size={18} class={open ? 'icon-flip' : undefined} />
          </button>
        )}
      </div>
      {open && step.output && (
        <div class="step-body">
          <Markdown text={step.output} />
          <Sources sources={step.sources} max={5} />
          {step.verdict && (
            <p class="step-verdict" data-approved={step.verdict.approved || undefined}>
              <strong>{project.team.find((m) => m.personaId === step.verdict!.reviewerId)?.name.split(' ')[0] ?? 'Reviewer'}:</strong> {step.verdict.notes}
              {step.revised && ' (revised)'}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

const VIA_WORDS: Record<ProjectNote['via'], string> = { page: 'here', chief: 'to your Chief of Staff', desk: 'at their desk' };

/** "Tell the team": direction that reaches the next step, and what became of each note. */
function TeamNotes({ project }: { project: TeamProjectSnapshot }) {
  const [text, setText] = useState('');
  const open = project.status === 'proposed' || project.status === 'running' || project.status === 'paused';
  const notes = project.notes ?? [];
  if (!open && !notes.length) return null;
  const busy = projectBusy.value[project.projectId] === 'note';
  const send = async (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    if (await noteProject(project.projectId, t)) setText('');
  };
  const first = (id?: string) => (id ? project.team.find((m) => m.personaId === id)?.name.split(' ')[0] : undefined);
  return (
    <section class="panel team-notes" aria-labelledby="notes-title">
      <h2 id="notes-title" class="panel-title">
        Direction
      </h2>
      {notes.length > 0 && (
        <ul class="note-list">
          {notes.map((n) => {
            const step = n.appliedStepId ? project.steps.find((s) => s.id === n.appliedStepId) : undefined;
            return (
              <li key={n.noteId} class="note" data-status={n.status}>
                <p class="note-text">{n.text}</p>
                <p class="note-meta">
                  {first(n.toId) ? `To ${first(n.toId)}` : 'To the team'}, {VIA_WORDS[n.via]} ·{' '}
                  {n.status === 'applied' ? (step ? `picked up in “${step.title}”` : 'picked up') : 'waiting for the next step'}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <form class="note-form" onSubmit={send}>
          <label class="visually-hidden" for="note-text">
            Tell the team
          </label>
          <textarea
            id="note-text"
            class="note-input"
            rows={2}
            maxLength={PROJECT_NOTE_MAX}
            placeholder="Tell the team: “focus on Instagram”, “the budget is $500”…"
            value={text}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) void send(e);
            }}
          />
          <button type="submit" class="button-primary" disabled={!text.trim() || busy}>
            {busy ? 'Sending…' : 'Send'}
          </button>
          <p class="page-fine note-fine">It reaches the next step that starts. Nothing already under way is thrown away.</p>
        </form>
      )}
    </section>
  );
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  useEffect(() => {
    void loadCatalog();
    void loadProject(projectId);
  }, [projectId]);
  // Reload the full outputs when the project finishes (frames carry them clipped).
  const project = teamProjects.value[projectId];
  const finished = project?.status === 'done';
  useEffect(() => {
    if (finished) void loadProject(projectId);
  }, [finished, projectId]);

  if (!project)
    return (
      <section class="page project-page">
        <p class="page-lede">
          <Link href={paths.projects}>Projects</Link>
        </p>
        <div class="panel empty">
          <p class="empty-title">Loading the project…</p>
        </div>
      </section>
    );

  const busy = projectBusy.value[projectId];
  const error = projectError.value[projectId];
  const { done, total, pct } = progressOf(project);
  const name = chiefName.value;
  return (
    <section class="page project-page" aria-labelledby="project-title">
      <header class="page-head">
        <p class="page-crumb">
          <Link href={paths.projects}>Projects</Link>
        </p>
        <h1 id="project-title">{project.title}</h1>
        <p class="project-status-line">
          <span class="job-glyph" data-status={projectGlyph(project.status)} aria-hidden="true" />
          {PROJECT_STATUS_WORDS[project.status]}
          {project.status !== 'proposed' && (
            <span class="tabular">
              {' '}
              · {done} of {total} steps
            </span>
          )}
        </p>
        <p class="page-lede">{project.goal}</p>
      </header>

      {project.status === 'proposed' && (
        <section class="panel decision" aria-label="Your decision">
          <p class="decision-hand" aria-hidden="true">
            ✋
          </p>
          <div class="decision-body">
            <p class="decision-title">{name} staffed this and drafted the plan. Start it?</p>
            <p class="decision-text">{project.staffingNote}</p>
            {project.forecast && (
              <p class="decision-text project-forecast">
                About {project.forecast.minutes.min} to {project.forecast.minutes.max} minutes once you approve: {project.forecast.rounds} round{project.forecast.rounds === 1 ? '' : 's'} of work,{' '}
                {project.forecast.modelCalls.min} to {project.forecast.modelCalls.max} model calls.
              </p>
            )}
          </div>
          <div class="decision-actions">
            <button type="button" class="button-primary" disabled={!!busy} onClick={() => void approveProject(projectId)}>
              {busy === 'approve' ? 'Starting…' : 'Approve and start'}
            </button>
            <button type="button" class="button-quiet" disabled={!!busy} onClick={() => void cancelProject(projectId)}>
              Not now
            </button>
          </div>
        </section>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      {(project.status === 'running' || project.status === 'paused') && (
        <div class="project-running" data-paused={project.status === 'paused' || undefined}>
          <span class="job-progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${Math.max(4, pct)}%` }} />
          </span>
          {project.status === 'running' ? (
            <button type="button" class="button-quiet" disabled={!!busy} onClick={() => void pauseProject(projectId)}>
              {busy === 'pause' ? 'Pausing…' : 'Pause'}
            </button>
          ) : (
            <button type="button" class="button-primary" disabled={!!busy} onClick={() => void resumeProject(projectId)}>
              {busy === 'resume' ? 'Resuming…' : 'Resume'}
            </button>
          )}
          <button type="button" class="button-quiet" disabled={!!busy} onClick={() => void cancelProject(projectId)}>
            {busy === 'cancel' ? 'Stopping…' : 'Stop project'}
          </button>
        </div>
      )}
      {project.status === 'paused' && <p class="page-fine">Paused: anyone mid-step finishes, then the team waits for you.</p>}

      {project.status === 'done' && project.deliverable && (
        <section class="panel deliverable-panel" aria-labelledby="deliverable-title">
          <header class="project-deliverable-head">
            <h2 id="deliverable-title">The deliverable</h2>
            <button type="button" class="button-quiet" onClick={() => void navigator.clipboard?.writeText(project.deliverable ?? '')}>
              Copy
            </button>
          </header>
          <Markdown text={project.deliverable} />
        </section>
      )}
      {project.status === 'failed' && project.error && (
        <p class="panel project-failed" role="alert">
          {project.error}
        </p>
      )}

      <TeamNotes project={project} />

      <section class="panel" aria-labelledby="team-title">
        <h2 id="team-title" class="panel-title">
          The team
        </h2>
        <ul class="team-list">
          {project.team.map((m) => {
            const shown = presenceFor(`cw_${m.personaId}`);
            return (
              <li key={m.personaId}>
                <button type="button" class="team-member" onClick={() => navigate(paths.coworker(m.personaId))}>
                  <MemberFace member={m} tier="tile" live />
                  <span class="team-member-text">
                    <span class="team-member-name">
                      {m.name} <span class="team-member-role">{roleWord(m.role)}</span>
                    </span>
                    <span class="team-member-title">{shown.state !== 'idle' ? shown.label : m.title}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section class="panel" aria-labelledby="plan-title">
        <h2 id="plan-title" class="panel-title">
          The plan
        </h2>
        <ol class="step-list">
          {project.steps.map((s, i) => (
            <StepCard key={s.id} step={s} project={project} index={i} />
          ))}
        </ol>
      </section>
    </section>
  );
}
