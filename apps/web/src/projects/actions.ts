// Owner actions on team projects (Inc 1): approve a plan (the raised hand), decline it, stop a running project, and
// load a project's full outputs. Each updates the store at once from the answer; the feed then confirms.
import type { DecisionAnswer, PlanEdit, StepEdit, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { signal } from '@preact/signals';
import { api, ApiError } from '../api/client';
import { openDecisions, upsertProject } from '../store';

/** projectId → the action in flight (buttons show it and do not double-send). */
export const projectBusy = signal<Record<string, ProjectAction | undefined>>({});
/** projectId → the last error sentence, cleared by the next action. */
export const projectError = signal<Record<string, string | undefined>>({});

function set<T>(sig: { value: Record<string, T | undefined> }, id: string, v: T | undefined) {
  sig.value = { ...sig.value, [id]: v };
}

type ProjectAction = 'approve' | 'cancel' | 'pause' | 'resume' | 'note' | 'edit';

async function act(id: string, kind: ProjectAction, call: () => Promise<{ project: TeamProjectSnapshot }>): Promise<boolean> {
  if (projectBusy.value[id]) return false;
  let ok = false;
  set(projectBusy, id, kind);
  set(projectError, id, undefined);
  try {
    const r = await call();
    upsertProject(r.project);
    ok = true;
    // The server resolved the hand with the answer; lower it now rather than waiting for the feed.
    if (r.project.status !== 'proposed') openDecisions.value = Object.fromEntries(Object.entries(openDecisions.value).filter(([, d]) => d.projectId !== id));
  } catch (err) {
    set(projectError, id, err instanceof ApiError ? err.message : 'That did not go through. Try again.');
  } finally {
    set(projectBusy, id, undefined);
  }
  return ok;
}

export const approveProject = (id: string) => act(id, 'approve', () => api.approveProject(id));
export const cancelProject = (id: string) => act(id, 'cancel', () => api.cancelProject(id));
export const pauseProject = (id: string) => act(id, 'pause', () => api.pauseProject(id));
export const resumeProject = (id: string) => act(id, 'resume', () => api.resumeProject(id));
/** Direction for the team; resolves true once the server queued it. */
export const noteProject = (id: string, text: string, toId?: string) => act(id, 'note', () => api.noteProject(id, text, toId));

/** Full step outputs and the deliverable (frames carry them clipped). */
export async function loadProject(id: string): Promise<void> {
  try {
    upsertProject(await api.getProject(id));
  } catch {
    /* the feed still has the clipped copy */
  }
}

/** "Everyone stop" in flight, and its last outcome sentence. */
export const stopAllBusy = signal(false);
export const stopAllResult = signal<string | null>(null);

export async function stopAllWork(): Promise<void> {
  if (stopAllBusy.value) return;
  stopAllBusy.value = true;
  stopAllResult.value = null;
  try {
    const r = await api.stopAll();
    const n = r.stoppedJobs + r.stoppedProjects;
    stopAllResult.value = n === 0 ? 'Nothing was running.' : n === 1 ? 'Stopped the one thing that was running.' : `Stopped all ${n} things that were running.`;
  } catch (err) {
    stopAllResult.value = err instanceof ApiError ? err.message : 'That did not go through. Try again.';
  } finally {
    stopAllBusy.value = false;
  }
}

/** decisionId → an answer in flight; the last error sentence per decision. */
export const decisionBusy = signal<Record<string, boolean>>({});
export const decisionError = signal<Record<string, string | undefined>>({});

/** Answer a raised hand (approve, decline, or words). True when the server took it. */
export async function answerDecision(decisionId: string, a: DecisionAnswer): Promise<boolean> {
  if (decisionBusy.value[decisionId]) return false;
  decisionBusy.value = { ...decisionBusy.value, [decisionId]: true };
  decisionError.value = { ...decisionError.value, [decisionId]: undefined };
  try {
    const r = await api.answerDecision(decisionId, a);
    if (r.project) upsertProject(r.project);
    const { [decisionId]: _gone, ...rest } = openDecisions.value;
    openDecisions.value = rest;
    return true;
  } catch (err) {
    decisionError.value = { ...decisionError.value, [decisionId]: err instanceof ApiError ? err.message : 'That did not go through. Try again.' };
    return false;
  } finally {
    decisionBusy.value = { ...decisionBusy.value, [decisionId]: false };
  }
}

/** Plan edits (while proposed or paused): each answers with the project, errors land on the project. */
export const editStep = (id: string, stepId: string, e: StepEdit) => act(id, 'edit', () => api.editStep(id, stepId, e));
export const addStep = (id: string, e: StepEdit) => act(id, 'edit', () => api.addStep(id, e));
export const removeStep = (id: string, stepId: string) => act(id, 'edit', () => api.removeStep(id, stepId));
export const editPlan = (id: string, e: PlanEdit) => act(id, 'edit', () => api.editPlan(id, e));
