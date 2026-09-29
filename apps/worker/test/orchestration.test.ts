// biz-bot parity, stages 2 and 3 (Mock provider): the lead's plan, owner plan edits, clusters and escalations, a
// lead's question to the owner, typed deliverables with QA, the token budget, the run inspector, and the owner's view
// and control of each coworker (instructions, skills, tools, model) and of skills.
import { ids, parseFrame, type Frame, type FrameType } from '@headcount/protocol';
import type { AgentView, ModelsResponse, PromptView, RunsResponse, SkillDetail, SkillsResponse } from '@headcount/protocol/ext/agents';
import type { Decision, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { fullIndex } from '@headcount/catalog/full';
import { describe, expect, it } from 'vitest';
import type { ProjectDO } from '../src/jobs/project-do';
import { handle } from '../src/index';
import { breakCycles, normalizePlan, stepEditError, wouldCycle } from '../src/projects/staffing';
import { pickQaReviewer } from '../src/projects/team-host';
import { unfence } from '../src/projects/team-work';
import type { WorkspaceDO } from '../src/workspace/workspace-do';
import type { Env } from '../src/env';
import { createTestEnv } from './fake-cloud';

async function setup(overrides: Partial<Env> = {}) {
  const t = await createTestEnv(overrides);
  const ws = t.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
  const project = t.namespaces.PROJECT.getByName('p:everyday:local') as ProjectDO;
  t.namespaces.WORKSPACE.state('ws:local').getWebSockets = () => [{ send: (m: string) => void parseFrame(m) } as unknown as WebSocket];
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await handle(new Request(`http://localhost${path}`, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }), t.env, t.ctx);
    return { status: res.status, body: (await res.json()) as any };
  };
  const tick = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      await project.alarm();
      await t.ctx.drain();
    }
  };
  const talk = async (text: string) => {
    const r = await api('POST', '/api/talk', { text, opId: ids.op() });
    await t.ctx.drain();
    await tick();
    return r;
  };
  const ofType = async <T extends FrameType>(type: T) => (await ws.frames(0, 5000)).filter((f): f is Extract<Frame, { type: T }> => f.type === type);
  /** Tick until the project stops moving (or `max` ticks). */
  const settle = async (projectId: string, max = 30) => {
    for (let i = 0; i < max; i++) {
      const p = (await project.getProject(projectId))!;
      if (p.status !== 'running' && p.status !== 'planning') return p;
      const before = JSON.stringify(p.steps.map((s) => s.status));
      await tick();
      const after = (await project.getProject(projectId))!;
      if (after.status === 'running' && JSON.stringify(after.steps.map((s) => s.status)) === before && after.steps.some((s) => s.status === 'asking' || s.status === 'needs_review')) return after;
    }
    return (await project.getProject(projectId))!;
  };
  const staff = async (text = 'Put together a team to launch our spring menu with a small campaign') => {
    await talk(text);
    const proposed = (await ofType('project.proposed')).at(-1)!.data;
    return proposed as { project: TeamProjectSnapshot; decision: Decision };
  };
  await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
  return { t, ws, project, api, tick, talk, ofType, settle, staff };
}

describe('the plan (pure)', () => {
  const team = [
    { personaId: 'lead-a', name: 'Ann Lee', title: 'Lead', role: 'lead' as const, why: '' },
    { personaId: 'sam-b', name: 'Sam Bo', title: 'Spec', role: 'specialist' as const, why: '' },
    { personaId: 'sk-c', name: 'Kit Cho', title: 'Sceptic', role: 'sceptic' as const, why: '' },
  ];

  it('normalises the planner’s output: members only, ids unique, deps remapped, cycles broken, never the sceptic finishing', () => {
    const plan = normalizePlan(
      {
        deliverable: { kind: 'web', title: 'Launch page' },
        finisher: 'sk-c',
        tasks: [
          { id: 'a b', title: 'Research', brief: 'Look into it.', acceptance: 'Done.', owners: ['ghost', 'sam-b'], reviewers: ['sam-b', 'sk-c', 'lead-a'], dependsOn: ['c'] },
          { id: 'b', title: 'Draft', brief: 'Write it.', acceptance: 'Done.', owners: [], reviewers: [], dependsOn: ['a b', 'b'] },
          { id: 'c', title: 'Check', brief: 'Check it.', acceptance: 'Done.', owners: ['lead-a'], reviewers: [], dependsOn: ['b'] },
          { id: 'x', title: '', brief: 'No title.', owners: ['lead-a'] },
        ],
      },
      team,
      'Launch the spring menu',
    )!;
    expect(plan.kind).toBe('web');
    expect(plan.finisherId).toBe('lead-a');
    expect(plan.steps.map((s) => s.id)).toEqual(['ab', 'b', 'c']);
    const [a, b, c] = plan.steps;
    expect(a!.ownerId).toBe('sam-b');
    expect(a!.reviewerIds).toEqual(['sk-c', 'lead-a']);
    expect(b!.ownerId).toBe('sam-b'); // round-robin for a task without owners (index 1)
    // ab → c → b → ab is a cycle: walking from the first task, the edge that closes it (b → ab) is dropped.
    expect(a!.dependsOn).toEqual(['c']);
    expect(c!.dependsOn).toEqual(['b']);
    expect(b!.dependsOn).toEqual([]);
    expect(a!.brief).toContain('Launch the spring menu');
    expect(normalizePlan({ tasks: [{ id: 't', title: 'Only', brief: 'One.' }] }, team, 'g')).toBeNull();
  });

  it('checks edits: team members only, reviewers never owners, no cycles', () => {
    const steps = breakCycles([
      { id: 'a', title: 'A', brief: 'b', acceptance: 'c', ownerId: 'lead-a', reviewerIds: [], dependsOn: [], status: 'waiting' },
      { id: 'b', title: 'B', brief: 'b', acceptance: 'c', ownerId: 'sam-b', reviewerIds: [], dependsOn: ['a'], status: 'waiting' },
    ]);
    expect(wouldCycle(steps, 'a', ['b'])).toBe(true);
    expect(stepEditError({ dependsOn: ['b'] }, { steps, team, stepId: 'a' })).toMatch(/cycle/);
    expect(stepEditError({ ownerIds: ['ghost'] }, { steps, team, stepId: 'a' })).toMatch(/on the team/);
    expect(stepEditError({ reviewerIds: ['lead-a'] }, { steps, team, stepId: 'a' })).toMatch(/cannot also own/);
    expect(stepEditError({ ownerIds: [] }, { steps, team, stepId: 'a' })).toMatch(/one to three/);
    expect(stepEditError({ title: 'Better title', reviewerIds: ['sk-c'] }, { steps, team, stepId: 'a' })).toBeNull();
    expect(pickQaReviewer({ steps: [{ ...steps[0]!, reviewerIds: ['sk-c'] }, { ...steps[1]!, reviewerIds: ['sk-c', 'lead-a'] }], team }, 'lead-a')).toBe('sk-c');
    expect(unfence('```html\n<p>hi</p>\n```')).toBe('<p>hi</p>');
  });
});

describe('orchestration (ProjectDO, Mock provider)', () => {
  it('staffing plans on the next tick: planning, then the raised hand; approval waits for the plan', async () => {
    const s = await setup();
    const r = await s.api('POST', '/api/talk', { text: 'Put together a team to launch our spring menu with a small campaign', opId: ids.op() });
    await s.t.ctx.drain();
    expect(r.status).toBe(202);
    const planning = (await s.project.listProjects()).projects[0]!;
    expect(planning.status).toBe('planning');
    expect((await s.ofType('talk.message')).at(-1)!.data.text).toMatch(/drafting the plan/);
    expect((await s.api('POST', `/api/projects/${planning.projectId}/approve`)).status).toBe(409);
    await s.tick();
    const proposed = (await s.project.getProject(planning.projectId))!;
    expect(proposed.status).toBe('proposed');
    expect(proposed.deliverableKind).toBe('document');
    expect(proposed.finisherId).toBe(proposed.team.find((m) => m.role === 'lead')!.personaId);
    // The planner's call is in the inspector.
    const runs = (await s.api('GET', `/api/projects/${planning.projectId}/runs`)).body as RunsResponse;
    expect(runs.runs.map((x) => x.phase)).toEqual(['plan']);
    expect(runs.runs[0]!.calls.map((c) => c.name)).toContain('submit_plan');
  });

  it('the owner edits the plan while it waits: change, add, remove, choose the deliverable; running refuses edits', async () => {
    const s = await setup();
    const { project } = await s.staff();
    const [first, second] = project.steps;
    const other = project.team.find((m) => m.personaId !== first!.ownerId)!;
    const edit = await s.api('PUT', `/api/projects/${project.projectId}/steps/${first!.id}`, { title: 'Size the regulars', ownerIds: [first!.ownerId, other.personaId] });
    expect(edit.status).toBe(202);
    expect(edit.body.project.steps[0]).toMatchObject({ title: 'Size the regulars', coOwnerIds: [other.personaId] });
    expect((await s.api('PUT', `/api/projects/${project.projectId}/steps/${first!.id}`, { dependsOn: [second!.id] })).status).toBe(second!.dependsOn.includes(first!.id) ? 400 : 202);
    const added = await s.api('POST', `/api/projects/${project.projectId}/steps`, { title: 'Price check', brief: 'Compare three suppliers.', dependsOn: [first!.id] });
    expect(added.body.project.steps.at(-1)).toMatchObject({ title: 'Price check', dependsOn: [first!.id] });
    const removed = await s.api('DELETE', `/api/projects/${project.projectId}/steps/${added.body.project.steps.at(-1).id}`);
    expect(removed.body.project.steps).toHaveLength(project.steps.length);
    expect((await s.api('PUT', `/api/projects/${project.projectId}/plan`, { deliverableKind: 'web' })).body.project.deliverableKind).toBe('web');
    expect((await s.api('PUT', `/api/projects/${project.projectId}/plan`, { finisherId: 'nobody' })).status).toBe(400);
    // The hand's text follows the plan.
    expect((await s.api('GET', '/api/projects')).body.decisions[0].body).toMatch(/steps, each reviewed/);
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    expect((await s.api('POST', `/api/projects/${project.projectId}/steps`, { title: 'Late', brief: 'Too late.' })).status).toBe(409);

    // A web deliverable, checked by a reviewer.
    const done = await s.settle(project.projectId);
    expect(done.status).toBe('done');
    expect(done.deliverable).toMatch(/^<!doctype html>/);
    expect(done.qa).toMatchObject({ approved: true });
    // Co-owners review the lead's work: the edited step had two reviews (the co-owner's and the reviewer's).
    expect(done.steps[0]!.reviews!.map((v) => v.reviewerId)).toContain(other.personaId);
  });

  it('a lead asks the owner a question; only that step waits; the answer (Inbox or Talk) lets it finish', async () => {
    const s = await setup();
    const { project } = await s.staff();
    const target = project.steps.find((st) => !st.dependsOn.length)!;
    await s.api('PUT', `/api/projects/${project.projectId}/steps/${target.id}`, { brief: `${target.brief} (needs the owner)` });
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    const waiting = await s.settle(project.projectId);
    expect(waiting.steps.find((st) => st.id === target.id)).toMatchObject({ status: 'asking', question: { text: 'Which option should we go with?' } });
    const hand = (await s.ofType('decision.opened')).at(-1)!.data.decision;
    expect(hand).toMatchObject({ kind: 'input', stepId: target.id, status: 'open' });
    // The Chief says so (within the interruption budget).
    expect((await s.ofType('talk.message')).some((m) => m.data.projectId === project.projectId && /asks: Which option/.test(m.data.text))).toBe(true);
    // The owner answers in Talk: the Chief relays it.
    await s.talk('Answer: go with the first option, keep it simple');
    expect((await s.ofType('decision.resolved')).at(-1)!.data.decision).toMatchObject({ decisionId: hand.decisionId, status: 'answered' });
    const done = await s.settle(project.projectId);
    expect(done.status).toBe('done');
    const runs = (await s.api('GET', `/api/projects/${project.projectId}/runs?stepId=${target.id}`)).body as RunsResponse;
    expect(runs.runs.filter((r) => r.phase === 'work').at(-1)!.prompt).toContain('go with the first option');
  });

  it('reviewers who still want changes after the revision escalate; the owner accepts, or gives direction', async () => {
    const s = await setup();
    const { project } = await s.staff();
    const target = project.steps.find((st) => !st.dependsOn.length)!;
    await s.api('PUT', `/api/projects/${project.projectId}/steps/${target.id}`, { acceptance: 'It reads well (needs changes)' });
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    const stuck = await s.settle(project.projectId);
    const st = stuck.steps.find((x) => x.id === target.id)!;
    expect(st.status).toBe('needs_review');
    expect(st.revised).toBe(true);
    const hand = (await s.api('GET', '/api/projects')).body.decisions.find((d: Decision) => d.kind === 'review');
    expect(hand.title).toMatch(/Accept the remaining review issues/);
    // Direction: a fresh revision, reviewed again (Mock still wants changes → back to the owner).
    await s.api('POST', `/api/decisions/${hand.decisionId}`, { action: 'answer', text: 'Shorter, and lead with price.' });
    const again = await s.settle(project.projectId);
    expect(again.steps.find((x) => x.id === target.id)!.status).toBe('needs_review');
    const runs = (await s.api('GET', `/api/projects/${project.projectId}/runs?stepId=${target.id}`)).body as RunsResponse;
    expect(runs.runs.filter((r) => r.phase === 'revise').at(-1)!.prompt).toContain('Shorter, and lead with price.');
    const hand2 = (await s.api('GET', '/api/projects')).body.decisions.find((d: Decision) => d.kind === 'review');
    await s.api('POST', `/api/decisions/${hand2.decisionId}`, { action: 'approve' });
    const done = await s.settle(project.projectId);
    expect(done.steps.find((x) => x.id === target.id)!.status).toBe('done');
    expect(done.status).toBe('done');
  });

  it('the token budget pauses the project with a hand; raising it carries on', async () => {
    const s = await setup({ PROJECT_TOKEN_BUDGET: '50' });
    const { project } = await s.staff();
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    await s.tick(3);
    const paused = (await s.project.getProject(project.projectId))!;
    expect(paused.status).toBe('paused');
    expect(paused.usage!.input + paused.usage!.output).toBeGreaterThanOrEqual(50);
    const hand = (await s.api('GET', '/api/projects')).body.decisions.find((d: Decision) => d.kind === 'budget');
    expect(hand.body).toMatch(/Raise it by 50/);
    expect((await s.api('POST', `/api/projects/${project.projectId}/resume`)).status).toBe(409);
    await s.api('POST', `/api/decisions/${hand.decisionId}`, { action: 'approve' });
    expect((await s.project.getProject(project.projectId))!.status).toBe('running');
    expect((await s.project.getProject(project.projectId))!.usage!.budgetTokens).toBe(100);
  });

  it('the run inspector keeps every call: prompts, tool calls, model, tokens', async () => {
    const s = await setup();
    const { project } = await s.staff();
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    const done = await s.settle(project.projectId);
    const runs = (await s.api('GET', `/api/projects/${project.projectId}/runs`)).body as RunsResponse;
    const phases = new Set(runs.runs.map((r) => r.phase));
    expect([...phases].sort()).toEqual(['deliverable', 'plan', 'qa', 'review', 'work']);
    const work = runs.runs.find((r) => r.phase === 'work')!;
    const owner = fullIndex.persona(work.personaId)!;
    expect(work.system).toContain(`You are ${owner.name}`);
    expect(work.system).toContain('How you work:');
    expect(work.prompt).toMatch(/^Do your step/);
    expect(work.calls.map((c) => c.name)).toContain('submit_work');
    expect(work).toMatchObject({ provider: 'mock', finish: 'stop' });
    expect(work.usage.input).toBeGreaterThan(0);
    expect(done.usage!.calls).toBe(runs.runs.length);
  });
});

describe('the owner’s view and control of coworkers and skills', () => {
  it('shows how a coworker works: instructions, skills, grants, model and the exact prompts', async () => {
    const s = await setup();
    const persona = fullIndex.catalog.personas[0]!;
    const view = (await s.api('GET', `/api/agents/${persona.id}`)).body as AgentView;
    expect(view.instructions).toBe(persona.instructions);
    expect(view.edited).toBe(false);
    expect(view.skills.length).toBe(new Set([...persona.skills.primary, ...persona.skills.secondary]).size);
    expect(view.grants.map((g) => [g.id, g.granted])).toEqual([
      ['web_search', true],
      ['fetch_page', true],
      ['ask_coworker', true],
    ]);
    expect(view.model.resolved).toEqual({ provider: 'mock', model: expect.any(String) });
    expect(view.prompts.map((p) => p.surface)).toEqual(['work', 'review', 'desk', 'room']);
    const work = view.prompts[0]!;
    expect(work.sections.map((x) => x.id)).toEqual(expect.arrayContaining(['identity', 'instructions', 'skills', 'tools', 'rules']));
    expect(work.text).toContain(persona.instructions.slice(0, 40));
    expect(work.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['request_owner_input', 'submit_work', 'fetch_page', 'use_skill', 'web_search']));
    expect((await s.api('GET', '/api/agents/nobody-at-all')).status).toBe(404);
  });

  it('the owner’s instructions, skills, grants and model reach the work, and reset brings the catalog back', async () => {
    const s = await setup();
    const { project } = await s.staff();
    const lead = project.team.find((m) => m.role === 'lead')!;
    const persona = fullIndex.persona(lead.personaId)!;
    const skill = persona.skills.primary[0]!;
    const put = await s.api('PUT', `/api/agents/${lead.personaId}`, { instructions: 'Always open with the one-line answer. Use British spelling.', skillsOff: [skill], tools: { web_search: false }, model: { reasoning: 'high' } });
    expect(put.status).toBe(200);
    const view = put.body as AgentView;
    expect(view).toMatchObject({ edited: true, instructions: 'Always open with the one-line answer. Use British spelling.' });
    expect(view.skills.find((x) => x.id === skill)!.enabled).toBe(false);
    expect(view.grants.find((g) => g.id === 'web_search')!.granted).toBe(false);
    expect(view.config.model).toEqual({ reasoning: 'high' });
    expect(view.prompts[0]!.sections.find((x) => x.id === 'instructions')).toMatchObject({ origin: 'owner', title: 'How they work (your instructions)' });
    expect(view.prompts[0]!.tools.map((t) => t.name)).not.toContain('web_search');
    expect((await s.api('PUT', `/api/agents/${lead.personaId}`, { skillsOff: ['not-their-skill'] })).status).toBe(400);
    expect((await s.api('PUT', `/api/agents/${lead.personaId}`, { model: { provider: 'nope' } })).status).toBe(400);

    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    await s.settle(project.projectId);
    const runs = (await s.api('GET', `/api/projects/${project.projectId}/runs`)).body as RunsResponse;
    const leadWork = runs.runs.find((r) => r.phase === 'work' && r.personaId === lead.personaId);
    if (leadWork) {
      expect(leadWork.system).toContain('Always open with the one-line answer.');
      expect(leadWork.system).not.toContain(`- ${skill}`);
      expect(leadWork.sources).toEqual([]); // no web search for them now
    }
    const reset = (await s.api('POST', `/api/agents/${lead.personaId}/reset`)).body as AgentView;
    expect(reset).toMatchObject({ edited: false, instructions: persona.instructions });
    expect(reset.history[0]).toMatchObject({ instructions: 'Always open with the one-line answer. Use British spelling.', note: 'Reset to the catalog' });
  });

  it('skills: a library, a new version per edit, rollback', async () => {
    const s = await setup();
    const list = (await s.api('GET', '/api/skills')).body as SkillsResponse;
    expect(list.skills.length).toBe(fullIndex.catalog.skills.length);
    const id = list.skills.find((x) => x.usedBy > 0)!.id;
    const before = (await s.api('GET', `/api/skills/${id}`)).body as SkillDetail;
    expect(before.edited).toBe(false);
    const v2 = (await s.api('PUT', `/api/skills/${id}`, { instructions: '1. Ask one question. 2. Answer it.', note: 'Shorter' })).body as SkillDetail;
    expect(v2).toMatchObject({ edited: true, version: before.version + 1, instructions: '1. Ask one question. 2. Answer it.' });
    expect(v2.history[0]).toMatchObject({ version: before.version, note: 'Shorter' });
    const back = (await s.api('POST', `/api/skills/${id}/rollback`, { version: before.version })).body as SkillDetail;
    expect(back).toMatchObject({ version: before.version + 2, instructions: before.catalogInstructions });
    expect((await s.api('PUT', `/api/skills/${id}`, { instructions: '' })).status).toBe(400);
  });

  it('shows the Chief’s live prompt and tools, and the models the workspace can use', async () => {
    const s = await setup();
    const chief = (await s.api('GET', '/api/chief/prompt')).body as PromptView;
    expect(chief.surface).toBe('chief');
    expect(chief.sections[0]!.title).toMatch(/Platform rules/);
    expect(chief.text).toContain('Eddie');
    expect(chief.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['start_team_project', 'start_background_job']));
    const models = (await s.api('GET', '/api/models')).body as ModelsResponse;
    expect(models.providers.find((p) => p.id === 'mock')).toMatchObject({ configured: true });
    expect(models.providers.find((p) => p.id === 'anthropic')!.models.length).toBeGreaterThan(0);
  });
});
