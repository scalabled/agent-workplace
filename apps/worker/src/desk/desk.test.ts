// Floor quick-chat with a catalog coworker (INC05-PLAN §4 A11): frames with the coworker's agentId and surface 'floor',
// kept out of the Chief's history, idempotent on opId, an honesty guard on work claims, phatic replies in their voice.
import { fullIndex } from '@headcount/catalog/full';
import type { ModelEvent } from '@headcount/models';
import { CHIEF_ID, type Frame } from '@headcount/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { exprSetup, isDesk, isTalk, useProviders } from '../../test/expr-kit';
import { defaultRuntime, runtime } from '../workspace/runtime';
import { historyFromFrames } from '../workspace/talk';
import { HonestyGuard, buildDeskSystemPrompt, claimsWork, deskHistory, unstaffedLine } from './desk';

afterEach(() => Object.assign(runtime, defaultRuntime));

const text = (deltas: string[]): ModelEvent[] => [...deltas.map((d) => ({ type: 'text', delta: d }) as ModelEvent), { type: 'done', finish: 'stop' } as ModelEvent];

describe('POST /api/desk/:personaId/say', () => {
  it('streams a reply with the coworker’s agentId and surface floor, idempotent on opId', async () => {
    const { requests } = useProviders({ chat: { events: (req) => (isDesk(req) ? text(['I design the systems ', 'the rest of us build on. ', 'Happy to talk shop.']) : null) } });
    const s = await exprSetup();
    const r = await s.api('POST', '/api/desk/tech-lead/say', { text: 'what do you do?', opId: 'op_desk_1' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ accepted: true, opId: 'op_desk_1', agentId: 'cw_tech-lead' });
    await s.drain();
    const owner = (await s.ofType('talk.owner')).at(-1)!;
    expect(owner.data).toMatchObject({ turnId: r.body.turnId, messageId: r.body.messageId, text: 'what do you do?', agentId: 'cw_tech-lead', surface: 'floor' });
    const msg = (await s.ofType('talk.message')).at(-1)!;
    expect(msg.data).toMatchObject({ turnId: r.body.turnId, agentId: 'cw_tech-lead', kind: 'reply', surface: 'floor', text: 'I design the systems the rest of us build on. Happy to talk shop.' });
    expect((await s.ofType('talk.done')).at(-1)!.data).toMatchObject({ turnId: r.body.turnId, agentId: 'cw_tech-lead', surface: 'floor', route: 'answer', finish: 'stop' });
    const deltas = s.liveOf('talk.delta');
    expect(deltas.every((d) => d.data.surface === 'floor' && d.data.agentId === 'cw_tech-lead')).toBe(true);
    // Whole sentences only: the guard releases complete sentences, the rest at the end.
    expect(deltas.map((d) => d.data.delta)).toEqual(['I design the systems the rest of us build on. ', 'Happy to talk shop.']);
    expect(s.liveOf('presence').filter((p) => p.data.agentId === 'cw_tech-lead').map((p) => p.data.state)).toEqual(['thinking', 'idle']);
    const desk = requests.filter(isDesk);
    expect(desk).toHaveLength(1);
    // Their desk tools: remember, ask a colleague, propose a project, start research (never a bare refusal).
    expect((desk[0]!.tools ?? []).map((t) => t.name)).toEqual(['remember_this', 'ask_colleague', 'propose_project', 'start_research']);
    expect(desk[0]!.system).toContain('You are not on a team project right now');
    expect(desk[0]!.system).toContain('Helpful first: never answer with only a refusal');
    expect(desk[0]!.system).toContain(fullIndex.persona('tech-lead')!.name);

    const again = await s.api('POST', '/api/desk/tech-lead/say', { text: 'what do you do?', opId: 'op_desk_1' });
    expect(again.body).toMatchObject({ turnId: r.body.turnId, duplicate: true });
    await s.drain();
    expect((await s.ofType('talk.owner')).filter((f) => f.data.agentId === 'cw_tech-lead')).toHaveLength(1);
  });

  it('keeps quick-chats out of the Chief of Staff’s conversation', async () => {
    const { requests } = useProviders({ chat: { events: (req) => (isDesk(req) ? text(['Distributed systems, mostly.']) : null) } });
    const s = await exprSetup();
    await s.api('POST', '/api/desk/tech-lead/say', { text: 'tell me about your weekend project', opId: 'op_d2' });
    await s.drain();
    await s.talk('What should I focus on today?');
    const chief = requests.filter(isTalk).at(-1)!;
    const seen = JSON.stringify(chief.messages);
    expect(seen).not.toContain('weekend project');
    expect(seen).not.toContain('Distributed systems');
    expect(historyFromFrames(await s.frames()).map((m) => m.content).join(' ')).not.toContain('weekend project');
    // The desk sees its own thread with this coworker, and nothing of the Chief's.
    await s.api('POST', '/api/desk/tech-lead/say', { text: 'and at work?', opId: 'op_d3' });
    await s.drain();
    const desk = requests.filter(isDesk).at(-1)!;
    expect(desk.messages.map((m) => m.content)).toEqual(['tell me about your weekend project', 'Distributed systems, mostly.', 'and at work?']);
  });

  it('replaces a sentence that claims or promises work (coworkers are not staffed)', async () => {
    useProviders({ chat: { events: (req) => (isDesk(req) ? text(["I'm working on ", 'the budget review right now. ', 'Happy to help later. ', "I'll draft it tonight."]) : null) } });
    const s = await exprSetup(undefined, { chiefName: 'Rosa' });
    await s.api('POST', '/api/desk/tech-lead/say', { text: 'can you help with the budget?', opId: 'op_d4' });
    await s.drain();
    const msg = (await s.ofType('talk.message')).at(-1)!;
    expect(msg.data.text).toBe('I can start that as research or propose it as a project — say which, or Rosa can fit it in. Happy to help later.');
    const streamed = s.liveOf('talk.delta').map((d) => d.data.delta).join('');
    expect(streamed).not.toMatch(/working on|draft it/);
  });

  it('answers a phatic thanks in the coworker’s own voice without a model call', async () => {
    const { requests } = useProviders();
    const s = await exprSetup();
    await s.view({ surface: 'floor', stageAgentId: null, floorVisible: true });
    const r = await s.api('POST', '/api/desk/tech-lead/say', { text: 'thanks!', opId: 'op_d5' });
    await s.drain();
    expect(requests.filter(isDesk)).toHaveLength(0);
    const msg = (await s.ofType('talk.message')).at(-1)!;
    expect(msg.data).toMatchObject({ turnId: r.body.turnId, agentId: 'cw_tech-lead', kind: 'reflex', intent: 'gratitude_reply', surface: 'floor' });
    expect((await s.ofType('talk.done')).at(-1)!.data).toMatchObject({ agentId: 'cw_tech-lead', surface: 'floor', route: 'reflex' });
    const say = s.liveOf('reflex.say').at(-1)!;
    expect(say.data).toMatchObject({ agentId: 'cw_tech-lead', turnId: r.body.turnId, caption: msg.data.text });
    // It never touched the Chief of Staff.
    expect(s.liveOf('presence').filter((p) => p.data.agentId === CHIEF_ID)).toHaveLength(0);
  });

  it('cuts a reply still streaming when the owner writes to the same coworker again', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    useProviders({
      chat: {
        before: async (req) => {
          if (isDesk(req) && JSON.stringify(req.messages).includes('first question')) await held;
        },
        events: (req) => (isDesk(req) ? text(['A short answer.']) : null),
      },
    });
    const s = await exprSetup();
    const a = await s.api('POST', '/api/desk/tech-lead/say', { text: 'first question', opId: 'op_a' });
    await new Promise((r) => setTimeout(r, 0));
    const b = await s.api('POST', '/api/desk/tech-lead/say', { text: 'second question', opId: 'op_b' });
    release();
    await s.drain();
    const done = (await s.ofType('talk.done')).filter((f) => f.data.agentId === 'cw_tech-lead').map((f) => [f.data.turnId, f.data.finish]);
    expect(done).toEqual([
      [a.body.turnId, 'cancelled'],
      [b.body.turnId, 'stop'],
    ]);
  });

  it('validates the request and holds the per-minute limit', async () => {
    useProviders({ chat: { events: (req) => (isDesk(req) ? text(['Sure.']) : null) } });
    const s = await exprSetup();
    expect((await s.api('POST', '/api/desk/nobody-at-all/say', { text: 'hi', opId: 'op_x' })).status).toBe(404);
    expect((await s.api('POST', '/api/desk/tech-lead/say', { text: 'x'.repeat(2001), opId: 'op_y' })).status).toBe(413);
    expect((await s.api('POST', '/api/desk/tech-lead/say', { text: 'hello there' })).status).toBe(400);
    expect((await s.api('POST', '/api/desk/tech-lead/say', { text: '   ', opId: 'op_z' })).status).toBe(400);
    for (let i = 0; i < 12; i++) expect((await s.api('POST', '/api/desk/tech-lead/say', { text: `question ${i}?`, opId: `op_n${i}` })).status).toBe(202);
    const limited = await s.api('POST', '/api/desk/tech-lead/say', { text: 'one more?', opId: 'op_n12' });
    expect(limited).toMatchObject({ status: 429, body: { error: { code: 'rate_limited' } } });
    await s.drain();
  });

  it('closes a quick-chat that was cut by a restart', async () => {
    useProviders();
    const s = await exprSetup();
    s.state.storage.sql.exec(`INSERT INTO meta (key, value) VALUES ('active_desk:cw_tech-lead', ?)`, JSON.stringify({ turnId: 'turn_lost', opId: 'op_lost', agentId: 'cw_tech-lead' }));
    s.state.storage.sql.exec(`INSERT INTO presence_claims (agent_id, source, state, label, cause_seq, project_id, at) VALUES ('cw_tech-lead', 'desk', 'thinking', 'Thinking', 1, NULL, 0)`);
    const { WorkspaceDO } = await import('../workspace/workspace-do');
    const revived = new WorkspaceDO(s.state as unknown as DurableObjectState, s.t.env);
    const done = (await revived.frames(0)).filter((f): f is Extract<Frame, { type: 'talk.done' }> => f.type === 'talk.done');
    expect(done.map((f) => f.data)).toEqual([{ turnId: 'turn_lost', messageId: null, finish: 'error', agentId: 'cw_tech-lead', surface: 'floor' }]);
    expect(s.state.storage.sql.exec(`SELECT COUNT(*) AS n FROM presence_claims WHERE source = 'desk'`).toArray()[0]!.n).toBe(0);
  });
});

describe('the honesty guard', () => {
  it('releases whole sentences and rewrites work claims once', () => {
    const g = new HonestyGuard(unstaffedLine('Rosa'));
    expect(g.push('Nice to meet you')).toBe('');
    expect(g.push('. I have been ')).toBe('Nice to meet you. ');
    expect(g.push('looking into your CRM already. The pricing is 3.5 times')).toBe('I can start that as research or propose it as a project — say which, or Rosa can fit it in. ');
    expect(g.push(' higher.')).toBe('');
    expect(g.flush()).toBe('The pricing is 3.5 times higher.');
    expect(g.rewrites).toBe(1);
    const twice = new HonestyGuard('X.');
    expect(twice.push("I've booked it. We'll send the draft. Fine? ")).toBe('X. Fine? ');
    expect(twice.rewrites).toBe(2);
  });

  it('catches claims and promises of work, and leaves plain talk alone', () => {
    for (const s of ["I'm researching vendors", 'We shipped it yesterday', "I'll send the invoice", 'I will look into it', "I'll draft it tonight", 'Let me dig into that', "We'll put together a plan"]) expect(claimsWork(s), s).toBe(true);
    for (const s of ['I like distributed systems.', 'Rosa can bring me onto a project.', 'That sounds like a fun problem.', "I'll be honest, I love this stuff.", 'I started out as a physicist.'.replace('started', 'began')]) expect(claimsWork(s), s).toBe(false);
  });

  it('builds the persona prompt and a history of this coworker only', () => {
    const p = fullIndex.persona('tech-lead')!;
    const prompt = buildDeskSystemPrompt(p, 'Rosa');
    expect(prompt).toContain(`You are ${p.name}`);
    expect(prompt).toContain('Rosa is the owner');
    expect(prompt).toContain('two or three short sentences');
    expect(prompt).toContain('no exclamation marks');
    const f = (type: 'talk.owner' | 'talk.message', agentId: string, text: string, surface?: 'floor'): Frame =>
      ({ v: 1, streamId: 'ws:local', seq: 1, ts: '', type, data: type === 'talk.owner' ? { turnId: 'turn_1', messageId: 'msg_1', text, via: 'text', agentId, ...(surface ? { surface } : {}) } : { turnId: 'turn_1', messageId: 'msg_2', agentId, text, kind: 'reply', ...(surface ? { surface } : {}) } }) as Frame;
    const h = deskHistory([f('talk.owner', CHIEF_ID, 'chief q'), f('talk.owner', 'cw_tech-lead', 'hi', 'floor'), f('talk.message', 'cw_tech-lead', 'hello', 'floor'), f('talk.owner', 'cw_other', 'x', 'floor')], 'cw_tech-lead');
    expect(h).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });
});
