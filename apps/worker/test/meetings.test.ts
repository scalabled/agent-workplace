// Inc 2: meetings as real turns (Mock provider). The Chief of Staff moderates; the floor arbiter gives the owner the
// floor first (the addressed coworker answers), then raised hands (@mentions), then the speaking order; a whisper
// reaches only its addressee; a review meeting takes the work so far as its question; meetings are listed and read back.
import { ids, parseFrame } from '@headcount/protocol';
import type { ChannelEntry, Decision, MeetingResponse, MeetingSummary, MeetingsResponse, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import type { RunsResponse } from '@headcount/protocol/ext/agents';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import type { ProjectDO } from '../src/jobs/project-do';
import type { WorkspaceDO } from '../src/workspace/workspace-do';
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
  const staff = async () => {
    await api('POST', '/api/talk', { text: 'Put together a team to launch our spring menu with a small campaign', opId: ids.op() });
    await t.ctx.drain();
    await tick();
    return (await ws.frames(0, 5000)).filter((f) => f.type === 'project.proposed').at(-1)!.data as { project: TeamProjectSnapshot; decision: Decision };
  };
  await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
  return { t, ws, project, api, tick, staff };
}

const first = (m: { name: string }) => m.name.split(' ')[0]!;

describe('meetings', () => {
  it('the owner takes the floor before the first turn; the one they address answers first; a whisper reaches only its addressee', async () => {
    const s = await setup({ KICKOFF: 'off' });
    const { project } = await s.staff();
    const lead = project.team.find((m) => m.role === 'lead')!;
    const [asked, told] = project.team.filter((m) => m.personaId !== lead.personaId);
    const opened = await s.api('POST', `/api/projects/${project.projectId}/discuss`, { question: 'Instagram or local press first?', rounds: 1 });
    expect(opened.status).toBe(202);
    const meetingId = opened.body.meetingId as string;
    expect(meetingId).toMatch(/^mtg_/);
    const base = `/api/projects/${project.projectId}/meetings/${meetingId}`;
    expect((await s.api('POST', `${base}/say`, { text: `@${first(asked!)} what would it cost us?` })).status).toBe(202);
    expect((await s.api('POST', `${base}/say`, { text: 'Keep your part under five hundred dollars.', toId: told!.personaId, whisper: true })).status).toBe(202);
    expect((await s.api('POST', `${base}/say`, { text: 'psst', whisper: true })).status).toBe(400);
    await s.tick();

    const m = (await s.api('GET', base)).body as MeetingResponse;
    expect(m.meeting).toMatchObject({ kind: 'discussion', status: 'done', chairId: lead.personaId, question: 'Instagram or local press first?' });
    const said = m.entries.filter((e: ChannelEntry) => e.kind === 'discussion');
    // The Chief opens, the owner's question is answered first, then the chair frames … and the Chief closes.
    expect(said.map((e) => [e.fromId === 'chief' ? 'chief' : e.fromId === lead.personaId ? 'chair' : e.fromId === asked!.personaId ? 'asked' : 'member', e.phase])).toEqual([
      ['chief', 'moderator'],
      ['asked', 'reply'],
      ['chair', 'framing'],
      ...project.team.filter((x) => x.personaId !== lead.personaId).map((x) => [x.personaId === asked!.personaId ? 'asked' : 'member', 'opening']),
      ['chair', 'synthesis'],
      ['chief', 'moderator'],
    ]);
    expect(m.entries.some((e) => e.kind === 'whisper' && e.toId === told!.personaId)).toBe(true);
    // Only the addressee heard the whisper (their prompt has it; nobody else's does).
    const runs = ((await s.api('GET', `/api/projects/${project.projectId}/runs`)).body as RunsResponse).runs.filter((r) => r.phase === 'discussion');
    const heard = runs.filter((r) => r.prompt.includes('Keep your part under five hundred dollars.')).map((r) => r.personaId);
    expect(new Set(heard)).toEqual(new Set([told!.personaId]));
    expect(runs.find((r) => r.personaId === asked!.personaId)!.prompt).toContain(`The owner said to you: “@${first(asked!)} what would it cost us?”`);
    // Each hears the meeting from their own seat.
    expect(runs.filter((r) => r.personaId === lead.personaId).at(-1)!.prompt).toMatch(/You \(framing\):/);

    const list = (await s.api('GET', `/api/projects/${project.projectId}/meetings`)).body as MeetingsResponse;
    expect(list.meetings).toEqual([expect.objectContaining({ meetingId, status: 'done', lines: said.length + 2 })]);
    expect((await s.api('POST', `${base}/say`, { text: 'One more thing' })).status).toBe(409);
  });

  it('a raised hand: a teammate @mentioned in a turn speaks next, a few times at most', async () => {
    const s = await setup({ KICKOFF: 'off' });
    const { project } = await s.staff();
    const lead = project.team.find((m) => m.role === 'lead')!;
    const named = project.team.find((m) => m.personaId !== lead.personaId)!;
    // The Mock echoes the prompt's start, so every turn "mentions" them.
    await s.api('POST', `/api/projects/${project.projectId}/discuss`, { question: `@${first(named)}, should we price it higher?`, rounds: 1 });
    await s.tick();
    const [m] = ((await s.api('GET', `/api/projects/${project.projectId}/meetings`)).body as MeetingsResponse).meetings;
    const said = ((await s.api('GET', `/api/projects/${project.projectId}/meetings/${m!.meetingId}`)).body as MeetingResponse).entries.filter((e) => e.kind === 'discussion' && e.phase !== 'moderator');
    expect(said[0]).toMatchObject({ fromId: lead.personaId, phase: 'framing' });
    expect(said[1]).toMatchObject({ fromId: named.personaId, phase: 'reply' });
    const hands = said.filter((e) => e.phase === 'reply');
    expect(hands.length).toBeGreaterThanOrEqual(1);
    expect(hands.length).toBeLessThanOrEqual(3);
    expect(said.at(-1)!.phase).toBe('synthesis');
  });

  it('a review meeting takes the work so far as its question; the kickoff is a meeting too', async () => {
    const s = await setup();
    const { project } = await s.staff();
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    await s.tick();
    const r = await s.api('POST', `/api/projects/${project.projectId}/discuss`, { kind: 'review', rounds: 1 });
    expect(r.status).toBe(202);
    await s.tick(3);
    const list = ((await s.api('GET', `/api/projects/${project.projectId}/meetings`)).body as MeetingsResponse).meetings;
    expect(list.map((m) => m.kind).sort()).toEqual(['kickoff', 'review']);
    const review = list.find((m) => m.kind === 'review')!;
    expect(review.question).toMatch(/^Review of the work so far on “/);
    expect(review.status).toBe('done');
    const after = (await s.project.getProject(project.projectId))!;
    expect(after.notes!.some((n) => /^Review outcome/.test(n.text))).toBe(true);
  });

  it('stopping the project stops a meeting that has not finished', async () => {
    const s = await setup({ KICKOFF: 'off' });
    const { project } = await s.staff();
    const opened = await s.api('POST', `/api/projects/${project.projectId}/discuss`, { question: 'Instagram or local press first?' });
    await s.api('POST', `/api/projects/${project.projectId}/cancel`);
    const m = ((await s.api('GET', `/api/projects/${project.projectId}/meetings/${opened.body.meetingId}`)).body as MeetingResponse).meeting;
    expect(m.status).toBe('stopped');
  });
});

describe('meetings called on their own', () => {
  it('people from the team meet about a topic: the first chairs, the Chief moderates, and brings the outcome to Talk', async () => {
    const s = await setup();
    const r = await s.api('POST', '/api/meetings', { topic: 'Should we raise prices on our gift boxes this spring?', people: ['market-research-analyst', 'bookkeeper', 'social-media-manager'], rounds: 1 });
    expect(r.status).toBe(202);
    const m0 = r.body.meeting as MeetingSummary;
    expect(m0).toMatchObject({ kind: 'meeting', status: 'live', standalone: true, chairId: 'market-research-analyst', people: ['market-research-analyst', 'bookkeeper', 'social-media-manager'] });
    expect(m0.title).toContain('gift boxes');
    // Live first in the office's list.
    expect(((await s.api('GET', '/api/meetings')).body as MeetingsResponse).meetings[0]).toMatchObject({ meetingId: m0.meetingId, status: 'live' });
    await s.tick();

    const m = (await s.api('GET', `/api/meetings/${m0.meetingId}`)).body as MeetingResponse;
    expect(m.meeting).toMatchObject({ status: 'done', standalone: true });
    expect(m.meeting.summary).toBeTruthy();
    const said = m.entries.filter((e: ChannelEntry) => e.kind === 'discussion').map((e) => [e.fromId, e.phase]);
    expect(said).toEqual([
      ['chief', 'moderator'],
      ['market-research-analyst', 'framing'],
      ['bookkeeper', 'opening'],
      ['social-media-manager', 'opening'],
      ['market-research-analyst', 'synthesis'],
      ['chief', 'moderator'],
    ]);
    expect(m.entries[0]).toMatchObject({ kind: 'owner', text: 'Let’s meet about: Should we raise prices on our gift boxes this spring?'.replace('’', "'") });
    // Not a project: never listed, never opened as one.
    expect(((await s.api('GET', '/api/projects')).body.projects as TeamProjectSnapshot[]).some((p) => p.projectId === m.meeting.projectId)).toBe(false);
    expect((await s.api('GET', `/api/projects/${m.meeting.projectId}`)).status).toBe(404);
    // The Chief brings the outcome back to Talk, with the link.
    const frames = await s.ws.frames(0, 5000);
    const note = frames.filter((f) => f.type === 'talk.message').map((f) => (f.data as { text: string }).text).find((t) => t.startsWith('The meeting on'));
    expect(note).toContain(`[Read the meeting](/app/meetings/${m0.meetingId})`);
    expect(frames.filter((f) => f.type === 'meeting.updated').at(-1)!.data).toMatchObject({ meeting: { meetingId: m0.meetingId, status: 'done' } });
  });

  it('only people on the team are invited; at most six; a topic is needed', async () => {
    const s = await setup();
    const out = await s.api('POST', '/api/meetings', { topic: 'Logo refresh', people: ['bookkeeper', 'brand-strategist'] });
    expect(out.status).toBe(400);
    expect(out.body.error.message).toMatch(/not on your team/);
    expect((await s.api('POST', '/api/meetings', { topic: 'Hi', people: ['bookkeeper'] })).status).toBe(400);
    expect((await s.api('POST', '/api/meetings', { topic: 'Logo refresh', people: [] })).status).toBe(400);
    expect((await s.api('POST', '/api/meetings', { topic: 'Logo refresh', people: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).status).toBe(400);
  });

  it('the Chief calls one from Talk with the people best placed, and Everyone stop ends it', async () => {
    const s = await setup();
    await s.api('POST', '/api/talk', { text: 'Call a meeting about our social media posts and the spring campaign budget', opId: ids.op() });
    await s.t.ctx.drain();
    const frames = await s.ws.frames(0, 5000);
    const reply = frames.filter((f) => f.type === 'talk.message' && (f.data as { kind: string }).kind === 'reply').map((f) => (f.data as { text: string }).text).join(' ');
    expect(reply).toMatch(/\/app\/meetings\/mtg_/);
    const live = ((await s.api('GET', '/api/meetings')).body as MeetingsResponse).meetings[0]!;
    expect(live).toMatchObject({ status: 'live', standalone: true });
    expect(live.people).toContain('social-media-manager');
    expect((await s.api('POST', '/api/stop-all')).status).toBe(200);
    expect(((await s.api('GET', '/api/meetings')).body as MeetingsResponse).meetings[0]).toMatchObject({ meetingId: live.meetingId, status: 'stopped' });
    await s.tick();
    expect(((await s.api('GET', `/api/meetings/${live.meetingId}`)).body as MeetingResponse).entries.filter((e) => e.kind === 'discussion')).toEqual([]);
  });
});
