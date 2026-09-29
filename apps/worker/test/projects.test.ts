import { ids, parseFrame, type Frame, type FrameType } from '@headcount/protocol';
import { describe, expect, it } from 'vitest';
import type { ProjectDO } from '../src/jobs/project-do';
import { handle } from '../src/index';
import { assignVoices, forecastOf, forecastSentence, readySteps, recipesOf, scoreRecipe, shortlist, staffingNote, stepsFrom, teamFrom, titleFromGoal } from '../src/projects/staffing';
import { notesBlock } from '../src/projects/team-work';
import { buildDeskSystemPrompt, isDirection, noteTargetOf } from '../src/desk/desk';
import { sentenceHit } from '../src/rooms/guard';
import type { WorkspaceDO } from '../src/workspace/workspace-do';
import type { Env } from '../src/env';
import { fullIndex } from '@headcount/catalog/full';
import { MOCK_SOURCE } from '@headcount/models';
import { createTestEnv } from './fake-cloud';

async function setup(overrides: Partial<Env> = {}) {
  const t = await createTestEnv(overrides);
  const ws = t.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
  const project = t.namespaces.PROJECT.getByName('p:everyday:local') as ProjectDO;
  const live: Frame[] = [];
  t.namespaces.WORKSPACE.state('ws:local').getWebSockets = () => [{ send: (m: string) => void live.push(parseFrame(m)!) } as unknown as WebSocket];
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await handle(new Request(`http://localhost${path}`, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }), t.env, t.ctx);
    return { status: res.status, body: (await res.json()) as any };
  };
  /** Talk, let the turn finish, then one tick (a staffed project's lead drafts the plan on the next tick). */
  const talk = async (text: string) => {
    const r = await api('POST', '/api/talk', { text, opId: ids.op() });
    await t.ctx.drain();
    await project.alarm();
    await t.ctx.drain();
    return r;
  };
  const ofType = async <T extends FrameType>(type: T) => (await ws.frames(0, 5000)).filter((f): f is Extract<Frame, { type: T }> => f.type === type);
  /** Tick until no team project is running (or `max` ticks). */
  const runProjects = async (max = 30) => {
    for (let i = 0; i < max; i++) {
      await project.alarm();
      await t.ctx.drain();
      if (!(await project.listProjects()).projects.some((p) => p.status === 'running')) return i + 1;
    }
    return max;
  };
  await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
  return { t, ws, project, api, talk, ofType, runProjects, live };
}

describe('staffing (pure)', () => {
  const recipes = recipesOf(fullIndex.catalog);

  it('has recipes with teams and plans in the catalog bundle', () => {
    expect(recipes.length).toBeGreaterThan(20);
    expect(recipes.every((r) => r.composition.length >= 2 && r.plan_skeleton.length >= 2)).toBe(true);
  });

  it('ranks a launch recipe first for a launch goal', () => {
    const top = shortlist('Plan the launch of our new product line next month', recipes, 5);
    expect(top[0] && scoreRecipe('launch new product', top[0])).toBeGreaterThan(0);
    expect(top.some((r) => /launch/i.test(r.name))).toBe(true);
  });

  it('builds a named team with one sceptic, a plan whose owners are on the team, and a one-sentence note', () => {
    const recipe = shortlist('launch campaign for our spring menu', recipes, 1)[0]!;
    const team = teamFrom(recipe, (id) => fullIndex.persona(id));
    expect(team.length).toBeGreaterThanOrEqual(2);
    const members = new Set(team.map((m) => m.personaId));
    const steps = stepsFrom(recipe, team, 'launch campaign for our spring menu');
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.length).toBeLessThanOrEqual(8);
    for (const s of steps) {
      expect(members.has(s.ownerId)).toBe(true);
      for (const r of s.reviewerIds) {
        expect(members.has(r)).toBe(true);
        expect(r).not.toBe(s.ownerId);
      }
      expect(s.brief).toContain('spring menu');
    }
    expect(readySteps(steps).length).toBeGreaterThan(0);
    expect(staffingNote(team, recipe.name)).toMatch(/leads/);
  });

  it('forecasts rounds from the dependency chain and two-at-a-time, with calls and minutes', () => {
    const s = (id: string, dependsOn: string[] = [], reviewed = true) => ({ id, dependsOn, reviewerIds: reviewed ? ['r'] : [] });
    // a → b → c is a chain of 3; d runs beside it.
    const f = forecastOf([s('a'), s('b', ['a']), s('c', ['b']), s('d', [], false)]);
    expect(f.rounds).toBe(3);
    expect(f.modelCalls).toEqual({ min: 4 + 3 + 1, max: 4 + 6 + 1 });
    expect(f.minutes.min).toBeLessThan(f.minutes.max);
    // Five independent steps, two at a time: 3 rounds.
    expect(forecastOf(['a', 'b', 'c', 'd', 'e'].map((id) => s(id))).rounds).toBe(3);
    expect(forecastSentence(f)).toMatch(/^About \d+ to \d+ minutes once you approve \(3 rounds of work, 8 to 11 model calls\)\.$/);
  });

  it('gives every member a voice unique within the team and never the lead’s (matching, then presentation)', () => {
    const lead = fullIndex.lead('lead-steady-operator')!;
    const v = (voice: string, alternates: string[] = []) => ({ voice, alternates });
    const p = (id: string, pronouns: 'she/her' | 'he/him' | 'they/them', openai: ReturnType<typeof v>, xai: ReturnType<typeof v>) => ({ persona: { id, pronouns, voice: { openai, xai, speed: 1 } } });
    // b's own voice clashes with a's, and a has a free alternate: whoever has one moves, earlier members keep theirs.
    const out = assignVoices(
      [p('a', 'she/her', v('nova', ['shimmer']), v('ara', ['luna'])), p('b', 'she/her', v('nova'), v('ara', ['iris'])), p('c', 'he/him', v(lead.voice.openai_tts, ['onyx']), v(lead.voice.xai_tts, ['rex', 'orion']))],
      lead,
      fullIndex.catalog.voices,
    );
    expect(out.get('a')).toEqual({ openai: 'shimmer', xai: 'ara' });
    expect(out.get('b')).toEqual({ openai: 'nova', xai: 'iris' });
    expect(out.get('c')!.openai).not.toBe(lead.voice.openai_tts);
    expect(out.get('c')!.xai).not.toBe(lead.voice.xai_tts);
    // No matching over their own voices: a free voice of the same presentation.
    const tight = assignVoices([p('x', 'he/him', v('onyx'), v('rex')), p('y', 'he/him', v('onyx'), v('rex'))], undefined, fullIndex.catalog.voices);
    expect(tight.get('x')!.openai).not.toBe(tight.get('y')!.openai);
    expect(fullIndex.catalog.voices!.openai[tight.get('y')!.openai]).toBe('masculine');

    // Every catalog team under every lead: distinct on the provider it plays through, never the lead's voice.
    for (const l of fullIndex.catalog.leads) {
      for (const recipe of recipes) {
        const team = teamFrom(recipe, (id) => fullIndex.persona(id), { lead: l, table: fullIndex.catalog.voices });
        const prefer = team[0]!.voice!.prefer;
        for (const provider of prefer ? [prefer] : (['openai', 'xai'] as const)) {
          const ids = team.map((m) => m.voice![provider]);
          expect(new Set(ids).size, `${l.id} ${recipe.id} ${provider}`).toBe(ids.length);
          expect(ids).not.toContain(provider === 'openai' ? l.voice.openai_tts : l.voice.xai_tts);
        }
      }
    }
  });

  it('titles a goal without the preamble', () => {
    expect(titleFromGoal('Can you launch our spring menu with a small campaign? Budget is tight.')).toBe('Launch our spring menu with a small campaign');
    expect(titleFromGoal('Put together a team to launch our spring menu with a small campaign')).toBe('Launch our spring menu with a small campaign');
    expect(titleFromGoal('Assemble a team for a marketing plan for our bakery')).toBe('A marketing plan for our bakery');
  });
});

describe('team projects (ProjectDO, Mock provider)', () => {
  it('talk → staffed + proposed (raised hand) → approve → reviewed steps in parallel → deliverable → announced', async () => {
    const s = await setup();
    const r = await s.talk('Put together a team to launch our spring menu with a small campaign');
    expect(r.status).toBe(202);

    const proposed = await s.ofType('project.proposed');
    expect(proposed).toHaveLength(1);
    const { project, decision } = proposed[0]!.data;
    expect(project.status).toBe('proposed');
    expect(project.team.filter((m) => m.role === 'sceptic').length).toBeLessThanOrEqual(1);
    expect(decision).toMatchObject({ kind: 'plan_approval', status: 'open', projectId: project.projectId });

    // The Inbox lists it; the Chief said so.
    const list = await s.api('GET', '/api/projects');
    expect(list.body.decisions.map((d: { decisionId: string }) => d.decisionId)).toContain(decision.decisionId);
    const reply = (await s.ofType('talk.message')).at(-1)!;
    expect(reply.data.text).toMatch(/Inbox/);
    expect(reply.data.projectId).toBe(project.projectId);
    expect((await s.ofType('talk.done')).at(-1)!.data.route).toBe('project');

    // Nothing runs before approval.
    await s.project.alarm();
    await s.t.ctx.drain();
    expect((await s.project.getProject(project.projectId))!.steps.every((st) => st.status === 'waiting')).toBe(true);

    const approved = await s.api('POST', `/api/projects/${project.projectId}/approve`);
    expect(approved.status).toBe(202);
    expect(approved.body.project.status).toBe('running');
    expect((await s.ofType('decision.resolved')).at(-1)!.data.decision.status).toBe('approved');

    await s.runProjects();
    const done = (await s.project.getProject(project.projectId))!;
    expect(done.status).toBe('done');
    expect(done.steps.every((st) => st.status === 'done' && !!st.output)).toBe(true);
    expect(done.steps.some((st) => st.verdict?.approved)).toBe(true);
    expect(done.deliverable).toMatch(/placeholder deliverable/i);
    expect(done.summary).toBeTruthy();

    // Parallel: some tick moved two steps at once when two were ready.
    const updates = await s.ofType('project.updated');
    const maxWorking = Math.max(...updates.map((u) => u.data.project.steps.filter((st) => st.status === 'working' || st.status === 'reviewing' || st.status === 'revising').length));
    if (readySteps(project.steps).length >= 2) expect(maxWorking).toBeGreaterThanOrEqual(2);

    // Halfway, the Chief of Staff says so once (the interruption budget allows it), linked to the project.
    if (project.steps.length >= 3) {
      const halfway = (await s.ofType('talk.message')).filter((m) => m.data.projectId === project.projectId && /^Halfway on/.test(m.data.text));
      expect(halfway).toHaveLength(1);
      expect(halfway[0]!.data.kind).toBe('announcement');
    }

    // The Chief of Staff announces the result.
    const announcement = (await s.ofType('talk.message')).find((m) => m.data.kind === 'announcement' && m.data.projectId === project.projectId && !/^Halfway on/.test(m.data.text));
    expect(announcement?.data.text).toMatch(/is done/);
  });

  it('past the interruption budget the halfway update is a quiet line (never voiced, never unread)', async () => {
    const s = await setup({ INTERRUPTION_BUDGET: '0' });
    await s.talk('Put together a team to launch our spring menu with a small campaign');
    const { project } = (await s.ofType('project.proposed'))[0]!.data;
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    await s.runProjects();
    const halfway = (await s.ofType('talk.message')).filter((m) => /^Halfway on/.test(m.data.text));
    expect(halfway.map((m) => m.data.kind)).toEqual(project.steps.length >= 3 ? ['note'] : []);
  });

  it('approves by voice: "go ahead" after a proposal calls approve_team_project', async () => {
    const s = await setup();
    await s.talk('Assemble a team for a marketing plan for our bakery');
    const { project } = (await s.ofType('project.proposed'))[0]!.data;
    await s.talk('Yes, go ahead');
    expect((await s.project.getProject(project.projectId))!.status).toBe('running');
  });

  it('declining the plan cancels the project and closes the hand; a running project stops and discards late work', async () => {
    const s = await setup();
    await s.talk('Put together a team to launch a loyalty program');
    const { project } = (await s.ofType('project.proposed'))[0]!.data;
    const declined = await s.api('POST', `/api/projects/${project.projectId}/cancel`);
    expect(declined.body.project.status).toBe('cancelled');
    expect((await s.ofType('decision.resolved')).at(-1)!.data.decision.status).toBe('declined');
    expect((await s.api('GET', '/api/projects')).body.decisions).toHaveLength(0);
    // A cancelled project cannot be approved.
    expect((await s.api('POST', `/api/projects/${project.projectId}/approve`)).status).toBe(409);
  });

  it('caps projects in flight and per day', async () => {
    const s = await setup({ MAX_ACTIVE_PROJECTS: '1' });
    const first = await s.project.proposeProject({ goal: 'Launch our summer menu campaign', chiefName: 'Eddie' });
    expect('project' in first).toBe(true);
    const second = await s.project.proposeProject({ goal: 'Plan a hiring push for two baristas', chiefName: 'Eddie' });
    expect(second).toMatchObject({ accepted: false, code: 'conflict' });
    const s2 = await setup({ PROJECT_DAILY_LIMIT: '0' });
    expect(await s2.project.proposeProject({ goal: 'Launch our summer menu campaign', chiefName: 'Eddie' })).toMatchObject({ accepted: false, code: 'rate_limited' });
  });

  it('keeps a question about a launch a question (Mock): only an ask to run one staffs a team', async () => {
    const s = await setup();
    await s.talk('Tell me about the plan for the candle launch in a few sentences');
    expect(await s.ofType('project.proposed')).toHaveLength(0);
    expect((await s.ofType('talk.done')).at(-1)!.data.route).toBe('answer');
    await s.talk('Plan the launch of our candle line');
    expect(await s.ofType('project.proposed')).toHaveLength(1);
  });

  it('"Everyone stop" halts running jobs and team projects (HTTP and by voice); a waiting plan stays', async () => {
    const s = await setup();
    await s.talk('Put together a team to launch our spring menu with a small campaign');
    const { project } = (await s.ofType('project.proposed'))[0]!.data;
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    await s.talk('Look into coffee suppliers in Portland for me');
    await s.talk('Assemble a team for a marketing plan for our bakery');
    const waiting = (await s.ofType('project.proposed'))[1]!.data.project;
    const r = await s.api('POST', '/api/stop-all');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ stoppedJobs: 1, stoppedProjects: 1 });
    expect((await s.project.getProject(project.projectId))!.status).toBe('cancelled');
    expect((await s.project.getProject(waiting.projectId))!.status).toBe('proposed');
    expect((await s.project.listJobs()).every((j) => j.status !== 'running' && j.status !== 'queued')).toBe(true);
    await s.runProjects();
    expect((await s.project.getProject(project.projectId))!.status).toBe('cancelled');

    // By voice: the Chief's stop_all_work.
    await s.api('POST', `/api/projects/${waiting.projectId}/approve`);
    await s.talk('Everyone stop');
    expect((await s.ofType('talk.done')).at(-1)!.data.route).toBe('cancel');
    expect((await s.ofType('talk.message')).at(-1)!.data.text).toMatch(/Everyone has stopped: 1 team project/);
    expect((await s.project.getProject(waiting.projectId))!.status).toBe('cancelled');
  });

  it('is idempotent by opId', async () => {
    const s = await setup();
    const a = await s.project.proposeProject({ goal: 'Launch our summer menu campaign', chiefName: 'Eddie', opId: 'op-1' });
    const b = await s.project.proposeProject({ goal: 'Launch our summer menu campaign', chiefName: 'Eddie', opId: 'op-1' });
    expect('project' in a && 'project' in b && a.project.projectId === b.project.projectId).toBe(true);
  });
});

describe('steering a team project (notes, pause, desk chats)', () => {
  it('a note from the page waits for the next step, which picks it up; later steps of the addressee see it too', async () => {
    const s = await setup();
    await s.talk('Put together a team to launch our spring menu with a small campaign');
    const { project } = (await s.ofType('project.proposed'))[0]!.data;
    const lead = project.team.find((m) => m.role === 'lead') ?? project.team[0]!;
    const note = await s.api('POST', `/api/projects/${project.projectId}/note`, { text: 'Focus on Instagram; the budget is $500.', opId: 'op_note_1' });
    expect(note.status).toBe(202);
    expect(note.body.project.notes).toEqual([expect.objectContaining({ text: 'Focus on Instagram; the budget is $500.', via: 'page', status: 'queued' })]);
    // Idempotent; validated.
    expect((await s.api('POST', `/api/projects/${project.projectId}/note`, { text: 'Focus on Instagram; the budget is $500.', opId: 'op_note_1' })).body.project.notes).toHaveLength(1);
    expect((await s.api('POST', `/api/projects/${project.projectId}/note`, { text: '  ' })).status).toBe(400);
    expect((await s.api('POST', `/api/projects/${project.projectId}/note`, { text: 'hi', toId: 'not-on-team' })).status).toBe(400);
    await s.api('POST', `/api/projects/${project.projectId}/note`, { text: 'Keep the tone playful.', toId: lead.personaId });

    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    await s.runProjects();
    const done = (await s.project.getProject(project.projectId))!;
    expect(done.status).toBe('done');
    const [team, own] = done.notes!;
    expect(team).toMatchObject({ status: 'applied', appliedStepId: done.steps.find((st) => readySteps(project.steps).some((r) => r.id === st.id))!.id });
    expect(own!.status).toBe('applied');
    expect(done.steps.find((st) => st.id === own!.appliedStepId)!.ownerId).toBe(lead.personaId);
    // Finished projects take no more notes.
    expect((await s.api('POST', `/api/projects/${project.projectId}/note`, { text: 'One more thing' })).status).toBe(409);
  });

  it('notes reach prompts as the addressee sees them', () => {
    const brief = { title: 'T', goal: 'G', chiefName: 'Eddie', steps: [], team: [{ personaId: 'maya', name: 'Maya Cruz', title: 'x', role: 'lead' as const, why: '' }], notes: [{ text: 'Budget is $500.' }, { text: 'Playful tone.', toId: 'maya' }, { text: 'Use the blue logo.', toId: 'lee' }] };
    expect(notesBlock(brief, 'maya')).toContain('(to the team) Budget is $500.');
    expect(notesBlock(brief, 'maya')).toContain('(to Maya) Playful tone.');
    expect(notesBlock(brief, 'maya')).not.toContain('blue logo');
    expect(notesBlock(brief, '*')).toContain('blue logo');
    expect(notesBlock({ ...brief, notes: [] }, 'maya')).toBe('');
  });

  it('pause lets nothing new start; resume carries on; the Chief pauses and steers by voice', async () => {
    const s = await setup();
    await s.talk('Put together a team to launch our spring menu with a small campaign');
    const { project } = (await s.ofType('project.proposed'))[0]!.data;
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    expect((await s.api('POST', `/api/projects/${project.projectId}/pause`)).body.project.status).toBe('paused');
    await s.runProjects(5);
    expect((await s.project.getProject(project.projectId))!.steps.every((st) => st.status === 'waiting')).toBe(true);
    expect((await s.api('POST', `/api/projects/${project.projectId}/resume`)).body.project.status).toBe('running');
    expect((await s.api('POST', `/api/projects/${project.projectId}/resume`)).status).toBe(202);

    await s.talk('Pause the spring menu project for now');
    expect((await s.project.getProject(project.projectId))!.status).toBe('paused');
    expect((await s.ofType('talk.message')).at(-1)!.data).toMatchObject({ projectId: project.projectId });
    await s.talk('Also focus on Instagram rather than flyers');
    const noted = (await s.project.getProject(project.projectId))!;
    expect(noted.notes!.at(-1)).toMatchObject({ via: 'chief', status: 'queued', text: expect.stringContaining('Instagram') });
    await s.talk('Resume the spring menu project');
    expect((await s.project.getProject(project.projectId))!.status).toBe('running');
    await s.runProjects();
    expect((await s.project.getProject(project.projectId))!.notes!.at(-1)!.status).toBe('applied');
  });

  it('a quick chat with a staffed coworker knows their step, and their direction becomes a note for them', async () => {
    const s = await setup();
    await s.talk('Put together a team to launch our spring menu with a small campaign');
    const { project } = (await s.ofType('project.proposed'))[0]!.data;
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    const owner = project.steps[0]!.ownerId;
    const staffing = await s.project.staffingOf(owner);
    expect(staffing).toEqual([expect.objectContaining({ projectId: project.projectId, status: 'running', mine: expect.arrayContaining([expect.objectContaining({ title: project.steps[0]!.title, reviewing: false })]) })]);
    expect((await s.api('POST', `/api/desk/${owner}/say`, { text: "How's it going?", opId: 'op_q' })).status).toBe(202);
    await s.t.ctx.drain();
    expect((await s.project.getProject(project.projectId))!.notes ?? []).toHaveLength(0);
    await s.api('POST', `/api/desk/${owner}/say`, { text: 'Make sure the offer works for regulars too.', opId: 'op_dir' });
    await s.t.ctx.drain();
    expect((await s.project.getProject(project.projectId))!.notes).toEqual([expect.objectContaining({ toId: owner, via: 'desk', status: 'queued' })]);
    // Not on any project: no note, no staffing.
    expect(await s.project.staffingOf('nobody-here')).toEqual([]);
  });

  it('desk prompt, direction and guard rules for staffed coworkers (pure)', () => {
    const persona = fullIndex.catalog.personas[0]!;
    const staffing = [{ projectId: 'prj_x', title: 'Spring menu launch', status: 'running' as const, role: 'lead' as const, mine: [{ stepId: 's1', title: 'Size the audience', status: 'working' as const, reviewing: false }, { stepId: 's2', title: 'Price it', status: 'waiting' as const, reviewing: true }], stepsDone: 1, stepsTotal: 4 }];
    const prompt = buildDeskSystemPrompt(persona, 'Eddie', null, staffing);
    expect(prompt).toContain('“Spring menu launch” as lead: 1 of 4 steps done');
    expect(prompt).toContain('Your step: “Size the audience” (working on it now)');
    expect(prompt).toContain('You review: “Price it” (you review it later)');
    expect(prompt).not.toContain('You are not on a team project right now');
    expect(buildDeskSystemPrompt(persona, 'Eddie')).toContain('You are not on a team project right now');

    expect(isDirection("How's it going?")).toBe(false);
    expect(isDirection('Can you also cover pricing?')).toBe(true);
    expect(isDirection('Focus on Instagram')).toBe(true);
    expect(isDirection('ok')).toBe(false);
    expect(noteTargetOf(staffing)?.projectId).toBe('prj_x');
    expect(noteTargetOf([{ ...staffing[0]!, mine: [{ stepId: 's2', title: 'Price it', status: 'waiting', reviewing: true }] }])).toBeNull();

    // Staffed: true work talk passes; outside actions do not.
    expect(sentenceHit("I'm drafting the audience sizing now.", new Set(), { work: 'staffed' })).toBeNull();
    expect(sentenceHit("I'll send it to the printer tonight.", new Set(), { work: 'staffed' })).toBe('work');
    expect(sentenceHit('I emailed the supplier.', new Set(), { work: 'staffed' })).toBe('work');
    expect(sentenceHit("I'm drafting the audience sizing now.", new Set())).toBe('work');
  });
});

describe('web research (biz-bot parity: search, read, cite)', () => {
  it('team steps keep their sources, and the deliverable ends with them', async () => {
    const s = await setup();
    await s.talk('Put together a team to launch our spring menu with a small campaign');
    const { project } = (await s.ofType('project.proposed'))[0]!.data;
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    await s.runProjects();
    const done = (await s.project.getProject(project.projectId))!;
    expect(done.steps.every((st) => st.sources?.[0]?.url === MOCK_SOURCE.url)).toBe(true);
    expect(done.deliverable).toContain('## Sources');
    expect(done.deliverable).toContain(MOCK_SOURCE.url);
  });

  it('a background job cites what it searched', async () => {
    const s = await setup();
    await s.talk('Look into coffee suppliers in Portland for me');
    for (let i = 0; i < 20; i++) {
      await s.project.alarm();
      await s.t.ctx.drain();
      if (!(await s.project.listJobs()).some((j) => j.status === 'running')) break;
    }
    const job = (await s.project.listJobs())[0]!;
    expect(job.status).toBe('done');
    expect(job.result).toContain('## Sources');
    expect(job.result).toContain(MOCK_SOURCE.url);
  });

  it('the Chief looks up a quick fact and shows the source under the reply', async () => {
    const s = await setup();
    await s.talk('Search the latest news on heat pumps');
    const reply = (await s.ofType('talk.message')).at(-1)!;
    expect(reply.data.sources).toEqual([MOCK_SOURCE]);
    await s.talk('Thanks, that helps a lot with my thinking here');
    expect((await s.ofType('talk.message')).at(-1)!.data.sources).toBeUndefined();
  });

  it('WEB_TOOLS=off: nobody searches or reads pages', async () => {
    const s = await setup({ WEB_TOOLS: 'off' });
    await s.talk('Put together a team to launch our spring menu with a small campaign');
    const { project } = (await s.ofType('project.proposed'))[0]!.data;
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    await s.runProjects();
    const done = (await s.project.getProject(project.projectId))!;
    expect(done.steps.every((st) => !st.sources)).toBe(true);
    expect(done.deliverable).not.toContain('## Sources');
    await s.talk('Search the latest news on heat pumps');
    expect((await s.ofType('talk.message')).at(-1)!.data.sources).toBeUndefined();
  });
});
