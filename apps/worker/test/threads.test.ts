// Side chats in documents: ask about a passage of a canvas document, a project's deliverable or the Handbook; the agent
// who wrote or keeps it answers in a thread pinned there, and changes the document when asked.
import { ids, parseFrame } from '@headcount/protocol';
import type { CanvasSnapshot } from '@headcount/protocol/ext/canvas';
import type { Decision, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import type { ThreadResponse, ThreadsResponse } from '@headcount/protocol/ext/threads';
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
  const tick = async (n = 3) => {
    for (let i = 0; i < n; i++) {
      await project.alarm();
      await t.ctx.drain();
    }
  };
  await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
  return { t, ws, project, api, tick };
}

describe('side chats in documents', () => {
  it('a canvas document: asked about a passage, answered by the Chief; a change asked for becomes a new version', async () => {
    const s = await setup();
    const c = (await s.api('POST', '/api/canvas', { brief: 'Write a one-page opening checklist for our café', kind: 'document', title: 'Opening checklist' })).body.canvas as CanvasSnapshot;
    await s.tick();
    const doc = `canvas:${c.canvasId}`;
    const started = await s.api('POST', '/api/threads', { doc, anchor: 'b-1', quote: 'Unlock the front door', text: 'Why does this come first?' });
    expect(started.status).toBe(201);
    let thread = (started.body as ThreadResponse).thread;
    expect(thread).toMatchObject({ doc, anchor: 'b-1', quote: 'Unlock the front door', agentId: 'cw_chief', agentName: 'Eddie', status: 'open' });
    expect(thread.messages.map((m) => [m.from, m.name])).toEqual([
      ['owner', 'You'],
      ['cw_chief', 'Eddie'],
    ]);
    expect(thread.messages[1]!.text.length).toBeGreaterThan(0);

    thread = ((await s.api('POST', `/api/threads/${thread.threadId}`, { text: 'Please rewrite it to mention the alarm code' })).body as ThreadResponse).thread;
    const last = thread.messages.at(-1)!;
    expect(last.action).toMatchObject({ kind: 'revised' });
    const revised = (await s.api('GET', `/api/canvas/${last.action!.canvasId}`)).body.canvas as CanvasSnapshot;
    expect(revised).toMatchObject({ basedOn: c.canvasId, status: 'queued' });
    expect(revised.brief).toContain('«Unlock the front door»');

    const list = (await s.api('GET', `/api/threads?doc=${encodeURIComponent(doc)}`)).body as ThreadsResponse;
    expect(list.threads.map((x) => x.threadId)).toEqual([thread.threadId]);
    expect(((await s.api('PUT', `/api/threads/${thread.threadId}`, { status: 'resolved' })).body as ThreadResponse).thread.status).toBe('resolved');
    expect((await s.api('GET', '/api/threads?doc=nope')).status).toBe(400);
    expect((await s.api('POST', '/api/threads', { doc: 'canvas:cnv_ffffffffffffffff', anchor: 'b-1', quote: 'x', text: 'Why?' })).status).toBe(404);
  });

  it('the Handbook: a section rewritten from a side chat', async () => {
    const s = await setup();
    await s.api('PUT', '/api/handbook/rules', { content: '- Never discount bread after 3pm.' });
    const r = (await s.api('POST', '/api/threads', { doc: 'handbook', anchor: 'hb-rules-b-1', quote: 'Never discount bread after 3pm.', text: 'Add that refunds over £50 need my OK' })).body as ThreadResponse;
    expect(r.thread.messages.at(-1)!.action).toEqual({ kind: 'handbook', section: 'rules' });
    const hb = (await s.api('GET', '/api/handbook')).body;
    const rules = hb.sections.find((x: { id: string }) => x.id === 'rules');
    expect(rules.content).toContain('Never discount bread after 3pm.');
    expect(rules.content).toContain('refunds over £50 need my OK');
  });

  it('a deliverable: the teammate who put it together answers', async () => {
    const s = await setup();
    await s.api('POST', '/api/talk', { text: 'Put together a team to launch our spring menu with a small campaign', opId: ids.op() });
    await s.t.ctx.drain();
    await s.tick(1);
    const { project } = (await s.ws.frames(0, 5000)).filter((f) => f.type === 'project.proposed').at(-1)!.data as { project: TeamProjectSnapshot; decision: Decision };
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    for (let i = 0; i < 30; i++) {
      const p = (await s.project.getProject(project.projectId))!;
      if (p.status !== 'running') break;
      await s.tick(1);
    }
    const done = (await s.project.getProject(project.projectId))!;
    expect(done.deliverable).toBeTruthy();
    const r = await s.api('POST', '/api/threads', { doc: `deliverable:${project.projectId}`, anchor: 'b-2', quote: done.deliverable!.split('\n').find((l) => l.trim().length > 20)!.slice(0, 80), text: 'Where does this number come from?' });
    expect(r.status).toBe(201);
    const t = (r.body as ThreadResponse).thread;
    const finisher = done.team.find((m) => m.personaId === done.finisherId) ?? done.team.find((m) => m.role === 'lead')!;
    expect(t.agentId).toBe(`cw_${finisher.personaId}`);
    expect(t.agentName).toBe(finisher.name);
    expect(t.messages).toHaveLength(2);
  });
});
