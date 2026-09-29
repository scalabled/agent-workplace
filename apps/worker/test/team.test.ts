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
