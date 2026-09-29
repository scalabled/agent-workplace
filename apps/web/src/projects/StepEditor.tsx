// Edit one step of a plan, or add one (biz-bot parity: workflow-editor.js step inspector): title, brief, done when,
// owners (the first leads; co-owners help and review), reviewers, and the steps it waits for. Only while the plan is
// waiting for approval or the project is paused; an edited step starts over.
import type { ProjectStep, StepEdit, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { useState } from 'preact/hooks';
import { addStep, editStep, projectBusy, projectError, removeStep } from './actions';

export function StepEditor({ project, step, onDone }: { project: TeamProjectSnapshot; step?: ProjectStep; onDone: () => void }) {
  const lead = project.team.find((m) => m.role === 'lead')?.personaId ?? project.team[0]!.personaId;
  const [title, setTitle] = useState(step?.title ?? '');
  const [brief, setBrief] = useState(step?.brief ?? '');
  const [acceptance, setAcceptance] = useState(step?.acceptance ?? '');
  const [owners, setOwners] = useState<string[]>(step ? [step.ownerId, ...(step.coOwnerIds ?? [])] : [lead]);
  const [reviewers, setReviewers] = useState<string[]>(step?.reviewerIds ?? []);
  const [deps, setDeps] = useState<string[]>(step?.dependsOn ?? []);
  const busy = projectBusy.value[project.projectId] === 'edit';
  const error = projectError.value[project.projectId];
  const toggle = (list: string[], id: string, set: (v: string[]) => void, max: number) => set(list.includes(id) ? list.filter((x) => x !== id) : list.length < max ? [...list, id] : list);
  const save = async (e: Event) => {
    e.preventDefault();
    const edit: StepEdit = { title, brief, acceptance, ownerIds: owners, reviewerIds: reviewers.filter((r) => !owners.includes(r)), dependsOn: deps };
    const ok = step ? await editStep(project.projectId, step.id, edit) : await addStep(project.projectId, edit);
    if (ok) onDone();
  };
  const others = project.steps.filter((s) => s.id !== step?.id);
  return (
    <form class="step-editor" onSubmit={save} aria-label={step ? `Edit “${step.title}”` : 'Add a step'}>
      <label class="field">
        <span class="field-label">Title</span>
        <input class="field-input" value={title} maxLength={100} required onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field">
        <span class="field-label">Brief</span>
        <textarea class="field-input" rows={4} value={brief} maxLength={12000} required onInput={(e) => setBrief((e.target as HTMLTextAreaElement).value)} />
      </label>
      <label class="field">
        <span class="field-label">Done when</span>
        <textarea class="field-input" rows={2} value={acceptance} maxLength={2000} onInput={(e) => setAcceptance((e.target as HTMLTextAreaElement).value)} />
      </label>
      <fieldset class="field">
        <legend class="field-label">Owners (the first leads; up to three)</legend>
        <div class="chip-picks">
          {project.team.map((m) => (
            <label key={m.personaId} class="chip-pick" data-on={owners.includes(m.personaId) || undefined}>
              <input type="checkbox" checked={owners.includes(m.personaId)} onChange={() => toggle(owners, m.personaId, setOwners, 3)} />
              {m.name.split(' ')[0]}
              {owners[0] === m.personaId && <span class="chip-note"> · leads</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset class="field">
        <legend class="field-label">Reviewers (up to two, not owners)</legend>
        <div class="chip-picks">
          {project.team
            .filter((m) => !owners.includes(m.personaId))
            .map((m) => (
              <label key={m.personaId} class="chip-pick" data-on={reviewers.includes(m.personaId) || undefined}>
                <input type="checkbox" checked={reviewers.includes(m.personaId)} onChange={() => toggle(reviewers, m.personaId, setReviewers, 2)} />
                {m.name.split(' ')[0]}
              </label>
            ))}
        </div>
      </fieldset>
      {others.length > 0 && (
        <fieldset class="field">
          <legend class="field-label">Waits for</legend>
          <div class="chip-picks">
            {others.map((s) => (
              <label key={s.id} class="chip-pick" data-on={deps.includes(s.id) || undefined}>
                <input type="checkbox" checked={deps.includes(s.id)} onChange={() => toggle(deps, s.id, setDeps, 12)} />
                {s.title}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="step-editor-actions">
        <button type="submit" class="button-primary" disabled={busy || !owners.length}>
          {busy ? 'Saving…' : step ? 'Save step' : 'Add step'}
        </button>
        <button type="button" class="button-quiet" onClick={onDone}>
          Cancel
        </button>
        {step && (
          <button type="button" class="button-quiet button-danger" disabled={busy} onClick={async () => (await removeStep(project.projectId, step.id)) && onDone()}>
            Remove step
          </button>
        )}
      </div>
    </form>
  );
}
