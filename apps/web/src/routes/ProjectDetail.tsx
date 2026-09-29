// One team project: what it is for, who is on it (faces show what each is doing now), the plan (as a graph and as
// steps, each with its work, reviews and sources), and the deliverable in its kind. The lead drafts the plan, then it
// waits for the owner's OK; raised hands for this project show here as in the Inbox. The owner edits the plan while
// it waits or is paused, steers without stopping anyone (a note reaches the next step), and can open every model
// call the team made (the run inspector).
import { PROJECT_NOTE_MAX, type DeliverableKind, type ProjectNote, type ProjectStep, type TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { useEffect, useState } from 'preact/hooks';
import { loadCatalog } from '../catalog';
import { chiefName } from '../chief';
import { DecisionCard } from '../components/DecisionCard';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { Markdown } from '../components/Markdown';
import { Sources } from '../components/Sources';
import { MemberFace, PROJECT_STATUS_WORDS, STEP_STATUS_WORDS, progressOf, projectGlyph, stepGlyph } from '../components/ProjectCard';
import { cancelProject, editPlan, loadProject, noteProject, pauseProject, projectBusy, projectError, resumeProject } from '../projects/actions';
import { DeliverableView } from '../projects/DeliverableView';
import { PlanGraph } from '../projects/PlanGraph';
import { RunInspector } from '../projects/RunInspector';
import { StepEditor } from '../projects/StepEditor';
import { TeamChannel } from '../projects/TeamChannel';
import { Meetings } from '../projects/Meetings';
import { navigate, paths } from '../router';
import { decisionList, presenceFor, teamProjects } from '../store';
import './pages.css';

function roleWord(role: string): string {
  return { lead: 'Lead', co_owner: 'Co-owner', reviewer: 'Reviewer', sceptic: 'Sceptic', specialist: 'Specialist', facilitator: 'Facilitator' }[role] ?? role;
}

const KIND_WORD: Record<DeliverableKind, string> = { document: 'A document', web: 'A web page', code: 'A code file' };
const nf = new Intl.NumberFormat('en-US');

/** How long a finished step took ("took 2 min"), from its own timestamps. */
function took(step: ProjectStep): string | null {
  if (!step.startedAt || !step.finishedAt) return null;
  const s = Math.max(0, (Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000);
  if (!Number.isFinite(s)) return null;
  return s < 60 ? `took ${Math.max(1, Math.round(s))} s` : `took ${Math.round(s / 60)} min`;
}

const editable = (p: TeamProjectSnapshot) => p.status === 'proposed' || p.status === 'paused';

function StepCard({ step, project, index, onInspect }: { step: ProjectStep; project: TeamProjectSnapshot; index: number; onInspect: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const first = (id: string) => project.team.find((m) => m.personaId === id)?.name.split(' ')[0] ?? id;
  const owner = project.team.find((m) => m.personaId === (step.byId ?? step.ownerId));
  const coOwners = (step.coOwnerIds ?? []).map(first);
  const reviewers = step.reviewerIds.map(first);
  const after = step.dependsOn.map((d) => project.steps.find((s) => s.id === d)?.title).filter(Boolean);
  const reviews = step.reviews ?? (step.verdict ? [step.verdict] : []);
  const canOpen = !!step.output || reviews.length > 0 || !!step.error;
  const canEdit = editable(project) && step.status !== 'done';
  return (
    <li class="step" id={`step-${step.id}`} data-status={step.status}>
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
                {coOwners.length > 0 && <span class="step-co"> with {coOwners.join(', ')}</span>}
              </span>
            )}
            {reviewers.length > 0 && <span class="step-reviewer">reviewed by {reviewers.join(', ')}</span>}
            {after.length > 0 && step.status === 'waiting' && <span class="step-after">after {after.join(', ')}</span>}
            {step.status === 'done' && took(step) && <span class="step-took tabular">{took(step)}</span>}
            {step.sources?.length ? <span class="step-sources tabular">{step.sources.length === 1 ? '1 source' : `${step.sources.length} sources`}</span> : null}
          </p>
        </div>
        <span class="step-status">{STEP_STATUS_WORDS[step.status]}</span>
        {canEdit && !editing && (
          <button type="button" class="icon-button" aria-label={`Edit ${step.title}`} onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} />
          </button>
        )}
        {canOpen && (
          <button type="button" class="icon-button" aria-expanded={open} aria-label={open ? `Hide ${step.title}` : `Show ${step.title}`} onClick={() => setOpen(!open)}>
            <Icon name="chevronDown" size={18} class={open ? 'icon-flip' : undefined} />
          </button>
        )}
      </div>
      {step.question && step.status === 'asking' && (
        <p class="step-question">
          <strong>{owner?.name.split(' ')[0] ?? 'The lead'} asks:</strong> {step.question.text}
        </p>
      )}
      {editing && (
        <div class="step-body">
          <StepEditor project={project} step={step} onDone={() => setEditing(false)} />
        </div>
      )}
      {open && !editing && (
        <div class="step-body">
          {step.error && <p class="step-note">{step.error}</p>}
          {step.output && <Markdown text={step.output} />}
          <Sources sources={step.sources} max={5} />
          {reviews.length > 0 && (
            <ul class="step-reviews">
              {reviews.map((v) => (
                <li key={v.reviewerId} class="step-verdict" data-approved={v.approved || undefined}>
                  <strong>
                    {first(v.reviewerId)} {v.approved ? 'approved' : 'asked for changes'}:
                  </strong>{' '}
                  {v.notes}
                </li>
              ))}
              {step.revised && <li class="step-note">Revised after review.</li>}
            </ul>
          )}
          <button type="button" class="button-quiet button-small" onClick={onInspect}>
            <Icon name="code" size={16} /> Model calls for this step
          </button>
        </div>
      )}
    </li>
  );
}

const VIA_WORDS: Record<ProjectNote['via'], string> = { page: 'here', chief: 'to your Chief of Staff', desk: 'at their desk', channel: 'in the channel', teammate: 'from a teammate' };

/** "Tell the team": direction that reaches the next step, and what became of each note. */
function TeamNotes({ project }: { project: TeamProjectSnapshot }) {
  const [text, setText] = useState('');
  const open = ['planning', 'proposed', 'running', 'paused', 'needs_review'].includes(project.status);
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
                  {first(n.toId) ? `To ${first(n.toId)}` : 'To the team'}, {VIA_WORDS[n.via]} · {n.status === 'applied' ? (step ? `picked up in “${step.title}”` : 'picked up') : 'waiting for the next step'}
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

/** What the team delivers and who finishes it (editable while the plan waits or the project is paused). */
function PlanSettings({ project }: { project: TeamProjectSnapshot }) {
  const kind = project.deliverableKind ?? 'document';
  const finisher = project.finisherId ?? project.team.find((m) => m.role === 'lead')?.personaId ?? '';
  if (!editable(project))
    return (
      <p class="plan-settings-line">
        {KIND_WORD[kind]}, assembled by {project.team.find((m) => m.personaId === finisher)?.name.split(' ')[0] ?? 'the lead'} and checked by a reviewer.
      </p>
    );
  return (
    <div class="plan-settings">
      <label class="field field-inline">
        <span class="field-label">Deliverable</span>
        <select class="field-input" value={kind} onChange={(e) => void editPlan(project.projectId, { deliverableKind: (e.target as HTMLSelectElement).value as DeliverableKind })}>
          <option value="document">A document</option>
          <option value="web">A web page or small app</option>
          <option value="code">A code file</option>
        </select>
      </label>
      <label class="field field-inline">
        <span class="field-label">Assembled by</span>
        <select class="field-input" value={finisher} onChange={(e) => void editPlan(project.projectId, { finisherId: (e.target as HTMLSelectElement).value })}>
          {project.team
            .filter((m) => m.role !== 'sceptic')
            .map((m) => (
              <option key={m.personaId} value={m.personaId}>
                {m.name}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  const [inspect, setInspect] = useState<{ stepId: string | null; title: string } | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    void loadCatalog();
    void loadProject(projectId);
  }, [projectId]);
  // Reload the full outputs when the project finishes (frames carry them clipped).
  const project = teamProjects.value[projectId];
  const finished = project?.status === 'done' || project?.status === 'partial' || project?.status === 'needs_review';
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
  const hands = decisionList.value.filter((d) => d.projectId === projectId);
  const lead = project.team.find((m) => m.role === 'lead') ?? project.team[0];
  const qaName = project.qa ? project.team.find((m) => m.personaId === project.qa!.reviewerId)?.name.split(' ')[0] : undefined;
  const usage = project.usage;
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
          {project.status !== 'proposed' && project.status !== 'planning' && (
            <span class="tabular">
              {' '}
              · {done} of {total} steps
            </span>
          )}
          {usage && usage.calls > 0 && (
            <button type="button" class="link-button tabular project-usage" onClick={() => setInspect({ stepId: null, title: 'Every model call' })}>
              {nf.format(usage.input + usage.output)} tokens · {usage.calls} call{usage.calls === 1 ? '' : 's'}
              {usage.usd !== null && usage.usd > 0 ? ` · $${usage.usd.toFixed(2)}` : ''}
            </button>
          )}
        </p>
        <p class="page-lede">{project.goal}</p>
        {project.automation && (
          <p class="page-fine">
            Started by the automation “{project.automation.name}”. <Link href={paths.automations}>Automations</Link>
          </p>
        )}
      </header>

      {project.status === 'planning' && (
        <p class="panel project-planning" role="status">
          {lead?.name.split(' ')[0] ?? 'The lead'} is drafting the plan from the {project.recipeName ? `“${project.recipeName}” playbook` : 'playbook'}. It will be here and in your Inbox in a moment.
        </p>
      )}

      {hands.map((d) => (
        <DecisionCard key={d.decisionId} decision={d} showProject={false} />
      ))}
      {project.status === 'proposed' && !hands.length && (
        <p class="page-fine">
          {name} staffed this and drafted the plan. {project.staffingNote}
        </p>
      )}
      {project.status === 'proposed' && project.forecast && (
        <p class="decision-text project-forecast">
          About {project.forecast.minutes.min} to {project.forecast.minutes.max} minutes once you approve: {project.forecast.rounds} round{project.forecast.rounds === 1 ? '' : 's'} of work, {project.forecast.modelCalls.min} to{' '}
          {project.forecast.modelCalls.max} model calls.
        </p>
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
      {project.status === 'paused' && <p class="page-fine">Paused: anyone mid-step finishes, then the team waits for you. You can edit the plan now.</p>}

      {(project.status === 'done' || project.status === 'partial' || project.status === 'needs_review') && project.deliverable && <DeliverableView project={project} {...(qaName ? { reviewerName: qaName } : {})} />}
      {project.status === 'partial' && <p class="page-fine">Some steps did not finish; the deliverable says which.</p>}
      {project.status === 'failed' && project.error && (
        <p class="panel project-failed" role="alert">
          {project.error}
        </p>
      )}

      <Meetings project={project} />

      <TeamChannel project={project} />

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
        <header class="plan-head">
          <h2 id="plan-title" class="panel-title">
            The plan
          </h2>
          {project.status !== 'planning' && (
            <button type="button" class="button-quiet button-small" onClick={() => setInspect({ stepId: null, title: 'Every model call' })}>
              <Icon name="code" size={16} /> Model calls
            </button>
          )}
        </header>
        <PlanSettings project={project} />
        <PlanGraph project={project} onSelect={(id) => document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
        <ol class="step-list">
          {project.steps.map((s, i) => (
            <StepCard key={s.id} step={s} project={project} index={i} onInspect={() => setInspect({ stepId: s.id, title: s.title })} />
          ))}
        </ol>
        {editable(project) &&
          (adding ? (
            <div class="step-add">
              <StepEditor project={project} onDone={() => setAdding(false)} />
            </div>
          ) : (
            <button type="button" class="button-quiet step-add-button" onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} /> Add a step
            </button>
          ))}
      </section>
      {inspect && <RunInspector projectId={projectId} stepId={inspect.stepId} title={inspect.title} onClose={() => setInspect(null)} />}
    </section>
  );
}
