// biz-bot parity, stage 4 (Mock provider): the team channel, the kickoff, consultations between teammates, hand-offs,
// specialists brought in, the owner writing to the team, and discussions on demand.
import { ids, parseFrame, type Frame, type FrameType } from '@headcount/protocol';
import type { ChannelEntry, ChannelResponse, Decision, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import type { RunsResponse } from '@headcount/protocol/ext/agents';
import { fullIndex } from '@headcount/catalog/full';
import { describe, expect, it } from 'vitest';
import type { ProjectDO } from '../src/jobs/project-do';
import { handle } from '../src/index';
import { mentionsIn } from '../src/projects/channel';
import { collabTools, type CollabHost } from '../src/projects/collab';
import type { TeamProjects } from '../src/projects/team-host';
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
  const ofType = async <T extends FrameType>(type: T) => (await ws.frames(0, 5000)).filter((f): f is Extract<Frame, { type: T }> => f.type === type);
  const staff = async () => {
    await api('POST', '/api/talk', { text: 'Put together a team to launch our spring menu with a small campaign', opId: ids.op() });
    await t.ctx.drain();
    await tick();
    return (await ofType('project.proposed')).at(-1)!.data as { project: TeamProjectSnapshot; decision: Decision };
  };
  const channel = async (projectId: string) => ((await api('GET', `/api/projects/${projectId}/channel`)).body as ChannelResponse).entries;
  const settle = async (projectId: string, max = 30) => {
    for (let i = 0; i < max; i++) {
      const p = (await project.getProject(projectId))!;
      if (p.status !== 'running') return p;
      await tick();
    }
    return (await project.getProject(projectId))!;
  };
  await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
  return { t, ws, project, api, tick, ofType, staff, channel, settle, team: (project as unknown as { team: TeamProjects }).team };
}

describe('mentions and the collaboration tools (pure)', () => {
  const team = [
    { personaId: 'ann', name: 'Ann Lee', title: 'Lead', role: 'lead' as const, why: '' },
    { personaId: 'sam', name: 'Sam Bo', title: 'Spec', role: 'specialist' as const, why: '' },
  ];

  it('reads @names, full names and @everyone', () => {
    expect(mentionsIn('@ann and @SamBo, a quick one', team)).toEqual({ ids: ['ann', 'sam'], everyone: false });
    expect(mentionsIn('@everyone please look', team)).toEqual({ ids: [], everyone: true });
    expect(mentionsIn('no one', team)).toEqual({ ids: [], everyone: false });
  });

  it('offers asking (not past depth two), hand-offs, and specialists to the lead only; guards every call', async () => {
    const calls: string[] = [];
    const host: CollabHost = {
      team: () => team,
      consult: async (from, to, q, d) => (calls.push(`ask ${from}>${to} d${d}: ${q}`), 'Use the local supplier.'),
      handoff: (from, to, m) => void calls.push(`handoff ${from}>${to}: ${m}`),
      findSpecialists: () => [{ personaId: 'pat', name: 'Pat Q', title: 'Pricing', oneLiner: 'Prices' }],
      addSpecialist: () => ({ ok: true, name: 'Pat Q' }),
    };
    const ctx = { callId: 'c', step: 1, signal: new AbortController().signal };
    const lead = collabTools(host, 'ann', { depth: 0, lead: true });
    expect(lead.tools.map((t) => t.spec.name)).toEqual(['ask_coworker', 'message_coworker', 'find_specialists', 'add_specialist']);
    const ask = lead.tools[0]!;
    expect(await ask.execute({ to: 'sam', question: 'Which supplier?' }, ctx)).toMatchObject({ ok: true });
    expect(calls[0]).toBe('ask ann>sam d1: Which supplier?');
    expect(await ask.execute({ to: 'ann', question: 'Me?' }, ctx)).toMatchObject({ ok: false });
    await ask.execute({ to: 'sam', question: 'Two?' }, ctx);
    await ask.execute({ to: 'sam', question: 'Three?' }, ctx);
    expect(await ask.execute({ to: 'sam', question: 'Four?' }, ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/decide and carry on/) });
    await lead.tools[1]!.execute({ to: 'sam', message: 'Prices went up.' }, ctx);
    expect(calls.at(-1)).toBe('handoff ann>sam: Prices went up.');
    const deep = collabTools(host, 'sam', { depth: 2, lead: false });
    expect(deep.tools.map((t) => t.spec.name)).toEqual(['message_coworker']);
    expect(collabTools(host, 'sam', { depth: 1, lead: false }).tools.map((t) => t.spec.name)).toEqual(['ask_coworker', 'message_coworker']);
  });
});

describe('the team channel and meetings (ProjectDO, Mock provider)', () => {
  it('holds a kickoff before the first step; its agreement reaches the steps; the channel records the work', async () => {
    const s = await setup();
    const { project } = await s.staff();
    expect(project.team.length).toBeGreaterThanOrEqual(3);
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    await s.tick();
    const afterKickoff = (await s.project.getProject(project.projectId))!;
    expect(afterKickoff.kickoff).toBe('done');
    const lines = await s.channel(project.projectId);
    const talk = lines.filter((e) => e.kind === 'discussion');
    // The Chief of Staff opens and closes the meeting; the lead chairs.
    expect(talk.map((e) => e.phase)).toEqual(['moderator', 'framing', ...Array(project.team.length - 1).fill('opening'), 'synthesis', 'moderator']);
    expect(talk[0]!.fromId).toBe('chief');
    expect(talk[1]!.fromId).toBe(project.team.find((m) => m.role === 'lead')!.personaId);
    expect(new Set(talk.map((e) => e.meetingId)).size).toBe(1);
    expect(afterKickoff.notes!.at(-1)).toMatchObject({ via: 'channel', status: 'queued', text: expect.stringMatching(/^Kickoff agreement/) });
    const done = await s.settle(project.projectId);
    expect(done.status).toBe('done');
    const all = await s.channel(project.projectId);
    expect(all[0]).toMatchObject({ kind: 'decision', fromId: 'owner', text: expect.stringMatching(/approved the plan/) });
    expect(all.filter((e) => e.kind === 'work').length).toBeGreaterThanOrEqual(done.steps.length);
    expect(all.some((e) => e.kind === 'review' && /^Approved/.test(e.text))).toBe(true);
    // Agents read the channel: a later work prompt carries it.
    const runs = ((await s.api('GET', `/api/projects/${project.projectId}/runs`)).body as RunsResponse).runs;
    expect(runs.filter((r) => r.phase === 'work').at(-1)!.prompt).toContain('<team_channel>');
    // The live frames carried each line.
    expect((await s.ofType('project.channel')).length).toBe(all.length);
  });

  it('a lead consults a teammate mid-step: the question and answer are in the channel and the inspector', async () => {
    const s = await setup({ KICKOFF: 'off' });
    const { project } = await s.staff();
    const step = project.steps.find((x) => !x.dependsOn.length)!;
    await s.api('PUT', `/api/projects/${project.projectId}/steps/${step.id}`, { brief: `${step.brief} (ask a teammate)` });
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    await s.settle(project.projectId);
    const lines = await s.channel(project.projectId);
    const ask = lines.find((e) => e.kind === 'ask' && e.stepId === step.id)!;
    expect(ask).toMatchObject({ fromId: step.ownerId, text: 'What should I keep in mind for this step?' });
    expect(lines.find((e) => e.kind === 'answer' && e.replyTo === ask.seq)).toMatchObject({ fromId: ask.toId, toId: step.ownerId });
    const runs = ((await s.api('GET', `/api/projects/${project.projectId}/runs?stepId=${step.id}`)).body as RunsResponse).runs;
    expect(runs.find((r) => r.phase === 'ask')).toMatchObject({ personaId: ask.toId });
    expect(runs.find((r) => r.phase === 'work')!.calls.map((c) => c.name)).toContain('ask_coworker');
  });

  it('the owner writes to the team: those named answer at once, and it reaches their next step', async () => {
    const s = await setup({ KICKOFF: 'off' });
    const { project } = await s.staff();
    const sam = project.team.find((m) => m.role !== 'lead')!;
    const first = sam.name.split(' ')[0];
    const r = await s.api('POST', `/api/projects/${project.projectId}/channel`, { text: `@${first} keep the prices under $12, please` });
    expect(r.status).toBe(202);
    expect(r.body.entry).toMatchObject({ kind: 'owner', fromId: 'owner', toId: sam.personaId });
    await s.t.ctx.drain();
    const lines = await s.channel(project.projectId);
    expect(lines.find((e) => e.kind === 'answer' && e.replyTo === r.body.entry.seq)).toMatchObject({ fromId: sam.personaId, toId: 'owner' });
    expect((await s.project.getProject(project.projectId))!.notes!.at(-1)).toMatchObject({ toId: sam.personaId, via: 'channel' });
    // Nobody named: the lead answers.
    const r2 = await s.api('POST', `/api/projects/${project.projectId}/channel`, { text: 'How are we doing?' });
    await s.t.ctx.drain();
    const lead = project.team.find((m) => m.role === 'lead')!;
    expect((await s.channel(project.projectId)).find((e) => e.kind === 'answer' && e.replyTo === r2.body.entry.seq)!.fromId).toBe(lead.personaId);
    expect((await s.api('POST', `/api/projects/${project.projectId}/channel`, { text: '  ' })).status).toBe(400);
  });

  it('a discussion on demand while the plan waits: framing, openings, a debate round, the chair’s summary', async () => {
    const s = await setup();
    const { project } = await s.staff();
    const r = await s.api('POST', `/api/projects/${project.projectId}/discuss`, { question: 'Instagram or local press first?', rounds: 2 });
    expect(r.status).toBe(202);
    expect((await s.api('POST', `/api/projects/${project.projectId}/discuss`, { question: 'Again?' })).status).toBe(409);
    await s.tick();
    const turns = (await s.channel(project.projectId)).filter((e: ChannelEntry) => e.kind === 'discussion' && e.phase !== 'moderator');
    const n = project.team.length;
    expect(turns).toHaveLength(1 + (n - 1) + (n - 1) + 1);
    expect(turns.filter((e) => e.phase === 'debate').every((e) => e.round === 2)).toBe(true);
    const after = (await s.project.getProject(project.projectId))!;
    expect(after.status).toBe('proposed');
    expect(after.discussion).toBeUndefined();
    expect(after.notes!.at(-1)!.text).toMatch(/^Discussion outcome/);
  });

  it('the lead can bring in a specialist from the office (at most four)', async () => {
    const s = await setup({ KICKOFF: 'off' });
    const { project } = await s.staff();
    const found = s.team.findSpecialists(project.projectId, 'pricing margins');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => !project.team.some((m) => m.personaId === f.personaId))).toBe(true);
    const lead = project.team.find((m) => m.role === 'lead')!.personaId;
    expect(s.team.addSpecialist(project.projectId, lead, found[0]!.personaId, 'Prices the menu.')).toMatchObject({ ok: true });
    const p = (await s.project.getProject(project.projectId))!;
    expect(p.team.at(-1)).toMatchObject({ personaId: found[0]!.personaId, role: 'specialist', why: 'Prices the menu.' });
    expect(s.team.addSpecialist(project.projectId, lead, found[0]!.personaId, 'Again')).toMatchObject({ ok: false });
    expect((await s.channel(project.projectId)).at(-1)!.text).toMatch(/^Brought in/);
    const others = fullIndex.catalog.personas.filter((x) => !p.team.some((m) => m.personaId === x.id)).slice(0, 4);
    for (const o of others.slice(0, 3)) s.team.addSpecialist(project.projectId, lead, o.id, '');
    expect(s.team.addSpecialist(project.projectId, lead, others[3]!.id, '')).toMatchObject({ ok: false, error: expect.stringMatching(/already brought in 4/) });
  });
});
