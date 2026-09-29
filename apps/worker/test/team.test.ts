// Nothing is turned away: a coworker at their desk starts research, remembers, asks a colleague; the Chief of Staff
// asks a coworker or hands a request to their desk. Every answer is something done, not a refusal.
import { fullIndex } from '@headcount/catalog/full';
import { ids, parseFrame, type Frame } from '@headcount/protocol';
import type { MemoryItem } from '@headcount/protocol/ext/memory';
import { describe, expect, it } from 'vitest';
import { handle } from '../src/index';
import type { ProjectDO } from '../src/jobs/project-do';
import type { WorkspaceDO } from '../src/workspace/workspace-do';
import { createTestEnv } from './fake-cloud';

async function setup() {
  const t = await createTestEnv();
  const ws = t.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
  const project = t.namespaces.PROJECT.getByName('p:everyday:local') as ProjectDO;
  t.namespaces.WORKSPACE.state('ws:local').getWebSockets = () => [{ send: (m: string) => void parseFrame(m) } as unknown as WebSocket];
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await handle(new Request(`http://localhost${path}`, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }), t.env, t.ctx);
    return { status: res.status, body: (await res.json()) as any };
  };
  const frames = async () => ws.frames(0, 5000);
  const lastFrom = async (agentId: string) => (await frames()).filter((f): f is Extract<Frame, { type: 'talk.message' }> => f.type === 'talk.message' && f.data.agentId === agentId).at(-1)?.data;
  const desk = async (personaId: string, text: string) => {
    await api('POST', `/api/desk/${personaId}/say`, { text, opId: ids.op() });
    await t.ctx.drain();
    return lastFrom(`cw_${personaId}`);
  };
  const talk = async (text: string) => {
    await api('POST', '/api/talk', { text, opId: ids.op() });
    await t.ctx.drain();
    return lastFrom('cw_chief');
  };
  await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
  return { t, ws, project, api, frames, desk, talk };
}

describe('coworkers do the work from their desk', () => {
  it('research asked of a coworker starts, and they say so truthfully', async () => {
    const s = await setup();
    const reply = await s.desk('bookkeeper', 'Could you look into three bookkeeping apps for a small café?');
    expect(reply?.text).toMatch(/^I've started “.+”; Eddie will tell you when it's done/);
    const jobs = (await s.api('GET', '/api/jobs')).body.jobs as { title: string }[];
    expect(jobs.some((j) => /bookkeeping apps/i.test(j.title))).toBe(true);
  });

  it('what the owner tells a coworker is remembered for the whole team', async () => {
    const s = await setup();
    const reply = await s.desk('bookkeeper', 'Please remember that we always pay suppliers on the 5th.');
    expect(reply?.text).toBe('Noted; the team will remember that.');
    const all = (await s.api('GET', '/api/memory')).body.memories as MemoryItem[];
    const first = fullIndex.persona('bookkeeper')!.name.split(' ')[0];
    expect(all).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'we always pay suppliers on the 5th.', source: 'desk', sourceLabel: `Told ${first}` })]));
  });

  it('a coworker asks a colleague by role and passes the answer on', async () => {
    const s = await setup();
    const reply = await s.desk('tech-lead', 'Ask the bookkeeper about how we should track tips?');
    const bookkeeper = fullIndex.persona('bookkeeper')!;
    expect(reply?.text.startsWith(`${bookkeeper.name.split(' ')[0]} says:`)).toBe(true);
  });
});

describe('the Chief of Staff works with the team', () => {
  it('asks a coworker in their field and relays the answer', async () => {
    const s = await setup();
    const reply = await s.talk('Ask the bookkeeper about whether we should switch to monthly invoicing');
    expect(reply?.text.startsWith(`${fullIndex.persona('bookkeeper')!.name.split(' ')[0]} says:`)).toBe(true);
  });

  it('hands a request to the coworker whose job it is, with a link to their desk', async () => {
    const s = await setup();
    const reply = await s.talk('Pass this on to the bookkeeper: can we afford a second espresso machine?');
    const first = fullIndex.persona('bookkeeper')!.name.split(' ')[0];
    expect(reply?.text).toContain(`[${first}](/app/desk/bookkeeper/profile)`);
    // It landed on their desk, with the note, and they answered there.
    const owner = (await s.frames()).filter((f) => f.type === 'talk.owner' && f.data.agentId === 'cw_bookkeeper').at(-1)!;
    expect(owner.data).toMatchObject({ surface: 'floor' });
    expect((owner.data as { text: string }).text).toMatch(/^Eddie passed this on from Talk: /);
    expect((await s.frames()).some((f) => f.type === 'talk.message' && f.data.agentId === 'cw_bookkeeper')).toBe(true);
  });

  it('a name nobody has gets a way forward, not a dead end', async () => {
    const s = await setup();
    const reply = await s.talk('Ask Zebulon about the rota for next week');
    expect(reply?.text).toMatch(/No one on the team matches “Zebulon”|Zebulon/);
  });
});

describe('your team', () => {
  it('starts with everyday roles, each with a first job; the Chief knows who is on it', async () => {
    const s = await setup();
    const team = (await s.api('GET', '/api/team')).body as import('@headcount/protocol/ext/team').TeamResponse;
    expect(team.members.map((m) => m.personaId)).toEqual(['knowledge-librarian', 'bookkeeper', 'social-media-manager', 'senior-copywriter', 'head-of-support', 'operations-director', 'account-executive', 'market-research-analyst']);
    expect(team.members[0]!.firstTask.kind).toBe('second-brain');
    expect(team.secondBrain).toMatchObject({ on: true, steward: 'knowledge-librarian' });
    expect(team.secondBrain.nextAt).toBeTruthy(); // the weekly tidy is scheduled
    const prompt = (await s.api('GET', '/api/chief/prompt')).body as { text: string };
    expect(prompt.text).toContain("## THE OWNER'S TEAM");
    expect(prompt.text).toContain(`${fullIndex.persona('bookkeeper')!.name}, Bookkeeper (/app/desk/bookkeeper/profile)`);
  });

  it('first jobs start as research or a proposed project, and are remembered as started', async () => {
    const s = await setup();
    const job = await s.api('POST', '/api/team/bookkeeper/start');
    expect(job.status).toBe(202);
    expect(job.body).toMatchObject({ personaId: 'bookkeeper', kind: 'research' });
    expect(job.body.jobId).toMatch(/^job_/);
    const proj = await s.api('POST', '/api/team/social-media-manager/start');
    expect(proj.body).toMatchObject({ kind: 'project' });
    expect(proj.body.say).toContain('in your Inbox for your OK');
    const team = (await s.api('GET', '/api/team')).body;
    expect(team.members.find((m: { personaId: string }) => m.personaId === 'bookkeeper').started.jobId).toBe(job.body.jobId);
    expect((await s.api('POST', '/api/team/tech-lead/start')).status).toBe(404); // not on the team
  });

  it('the second brain: duplicates merged, a report, one quiet line in Talk; weekly by alarm; can be turned off', async () => {
    const s = await setup();
    await s.api('POST', '/api/memory', { text: 'We close early on Sundays at 2pm.', kind: 'rule' });
    // A duplicate that slipped in (an older version kept both).
    s.t.namespaces.WORKSPACE.state('ws:local').storage.sql.exec(
      "INSERT INTO memories (memory_id, text, kind, scope, source, pinned, created_at, updated_at) VALUES ('mem_00000000000000aa', 'we close early on sundays at 2pm', 'rule', 'workspace', 'talk', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    );
    const r = await s.api('POST', '/api/team/knowledge-librarian/start');
    expect(r.body.kind).toBe('second-brain');
    expect(r.body.report).toMatchObject({ by: 'knowledge-librarian', merged: 1, checked: 1 });
    const kept = ((await s.api('GET', '/api/memory')).body.memories as { text: string; source: string }[]).filter((m) => /sundays/i.test(m.text));
    expect(kept).toEqual([expect.objectContaining({ text: 'We close early on Sundays at 2pm.', source: 'owner' })]);
    const note = (await s.frames()).filter((f) => f.type === 'talk.message' && f.data.kind === 'note').at(-1)!;
    expect((note.data as { text: string }).text).toMatch(/tidied the company's second brain: merged 1 duplicate\. \[See it in Memory\]\(\/app\/memory\?at=second-brain\)$/);
    // Applying a Handbook suggestion adds it to the section.
    await s.api('POST', '/api/team/second-brain/handbook', { section: 'rules', suggestion: '- We close at 2pm on Sundays.' });
    expect(((await s.api('GET', '/api/handbook')).body.sections as { id: string; content: string }[]).find((x) => x.id === 'rules')!.content).toContain('We close at 2pm on Sundays.');
    // Off: the alarm does nothing.
    expect(((await s.api('PUT', '/api/team/second-brain', { on: false })).body as { secondBrain: { on: boolean } }).secondBrain.on).toBe(false);
    const before = (await s.frames()).length;
    await s.ws.alarm();
    expect((await s.frames()).length).toBe(before);
  });

  it('the owner chooses who is on the team', async () => {
    const s = await setup();
    const r = (await s.api('PUT', '/api/team', { members: ['bookkeeper', 'tech-lead'] })).body;
    expect(r.members.map((m: { personaId: string }) => m.personaId)).toEqual(['bookkeeper', 'tech-lead']);
    expect(r.members[1].firstTask.title).toBe(`${fullIndex.persona('tech-lead')!.name.split(' ')[0]}'s first week`);
    expect((await s.api('PUT', '/api/team', { members: ['nobody-at-all'] })).status).toBe(400);
  });
});
