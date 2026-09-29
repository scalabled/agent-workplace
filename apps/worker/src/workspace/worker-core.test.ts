// Worker-core integration tests (Mock provider, in-process DOs over real SQLite via test/fake-cloud).
import { CHAT_CATALOG, createMockProvider, createRegistry, normalizeTier, type ChatProvider, type ChatRequest, type ModelEvent } from '@headcount/models';
import { CHIEF_ID, ids, parseFrame, type Frame, type FrameType, type JobSnapshot } from '@headcount/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../test/fake-cloud';
import type { Env } from '../env';
import { handle } from '../index';
import type { ProjectDO } from '../jobs/project-do';
import { announceConfig } from './announce';
import { defaultRuntime, runtime } from './runtime';
import { WorkspaceDO, defaultTalkTiming, talkTiming } from './workspace-do';

const ANNOUNCE_TIMEOUT = announceConfig.timeoutMs;
afterEach(() => {
  Object.assign(runtime, defaultRuntime);
  announceConfig.timeoutMs = ANNOUNCE_TIMEOUT;
});

const isAnnouncement = (req: ChatRequest) => typeof req.messages[0]?.content === 'string' && req.messages[0].content.startsWith('<job_result>');

/**
 * A cloud provider (as Anthropic, keyed) that behaves like Mock for talk and jobs and answers the announcement
 * request with `voice(req)` (after `delayMs`). Returns the recorded announcement requests.
 */
function useCloudVoice(voice: (req: ChatRequest) => ModelEvent[], delayMs = 0) {
  const asked: ChatRequest[] = [];
  const mock = createMockProvider().chat;
  const chat: ChatProvider = {
    id: 'anthropic',
    kind: 'cloud',
    family: 'claude',
    defaultModel: (tier) => CHAT_CATALOG.anthropic.defaults[normalizeTier(tier)],
    async *chat(req) {
      if (!isAnnouncement(req)) return yield* mock.chat(req);
      asked.push(req);
      if (delayMs) await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delayMs);
        req.signal?.addEventListener('abort', () => (clearTimeout(t), resolve()));
      });
      if (req.signal?.aborted) return yield { type: 'done', finish: 'cancelled' };
      for (const e of voice(req)) yield e;
    },
  };
  runtime.registry = (env: Env) => createRegistry(env, { providers: { anthropic: () => ({ chat }) } });
  return asked;
}
const CLOUD_ENV = { ANTHROPIC_API_KEY: 'sk-ant-test-key', DEFAULT_CHAT: 'anthropic' } as Partial<Env>;

/** Wrap the Mock chat provider: record every request and optionally hold one (to prove talk never waits on work). */
function useProvider(
  opts: {
    before?: (req: ChatRequest) => Promise<void> | void;
    events?: (req: ChatRequest) => ModelEvent[] | null;
    stream?: (req: ChatRequest) => AsyncIterable<ModelEvent> | null;
  } = {},
) {
  const requests: ChatRequest[] = [];
  const mock = createMockProvider().chat;
  const chat: ChatProvider = {
    id: 'mock',
    kind: 'mock',
    family: 'mock',
    defaultModel: () => 'mock-1',
    async *chat(req) {
      // Memory upkeep after a turn (distilling it) is not the conversation under test.
      if (req.system?.startsWith('You keep the memory')) return yield* mock.chat(req);
      requests.push(req);
      await opts.before?.(req);
      const custom = opts.stream?.(req);
      if (custom) return yield* custom;
      const scripted = opts.events?.(req);
      if (scripted) {
        for (const e of scripted) yield e;
        return;
      }
      yield* mock.chat(req);
    },
  };
  runtime.registry = (env: Env) => createRegistry(env, { providers: { mock: () => ({ chat }) } });
  return requests;
}

const isWorkStep = (req: ChatRequest) => typeof req.messages[0]?.content === 'string' && req.messages[0].content.startsWith('Work on step');

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { opened, open };
}

async function setup(overrides: Partial<Env> = {}) {
  const t: TestEnv = await createTestEnv(overrides);
  const ws = t.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
  const project = t.namespaces.PROJECT.getByName('p:everyday:local') as ProjectDO;
  const live: Frame[] = [];
  const socket = { send: (m: string) => void live.push(parseFrame(m)!) };
  t.namespaces.WORKSPACE.state('ws:local').getWebSockets = () => [socket as unknown as WebSocket];

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await handle(new Request(`http://localhost${path}`, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }), t.env, t.ctx);
    return { status: res.status, body: (await res.json()) as any };
  };
  /** POST /api/talk, then let the Chief of Staff's turn finish. */
  const talk = async (text: string, opId: string = ids.op()) => {
    const r = await api('POST', '/api/talk', { text, opId });
    await t.ctx.drain();
    return r;
  };
  const frames = () => ws.frames(0, 5000);
  const ofType = async <T extends FrameType>(type: T): Promise<Extract<Frame, { type: T }>[]> => (await frames()).filter((f): f is Extract<Frame, { type: T }> => f.type === type);
  const lastOf = async <T extends FrameType>(type: T) => (await ofType(type)).at(-1)!;
  const jobs = () => project.listJobs();
  const job = async () => (await jobs())[0]!;
  /** Tick the Everyday project until nothing runs (or `max` ticks). */
  const runJobs = async (max = 20) => {
    for (let i = 0; i < max; i++) {
      await project.alarm();
      await t.ctx.drain();
      if (!(await jobs()).some((j) => j.status === 'running')) return i + 1;
    }
    return max;
  };
  await api('PUT', '/api/workspace', { leadId: 'lead-warm-mentor', chiefName: 'Rosa' });
  return { t, ws, project, live, api, talk, frames, ofType, lastOf, jobs, job, runJobs };
}

describe('talk (conversation loop)', () => {
  it('accepts with 202 at once and streams the reply as talk frames', async () => {
    const s = await setup();
    const r = await s.api('POST', '/api/talk', { text: 'Good morning, how are you?', opId: 'op_1' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ accepted: true, opId: 'op_1' });
    expect(r.body.turnId).toMatch(/^turn_/);
    // The owner's message is on the feed before the reply exists.
    expect((await s.frames()).map((f) => f.type)).toEqual(['workspace.updated', 'talk.owner']);
    await s.t.ctx.drain();

    const types = (await s.frames()).map((f) => f.type);
    expect(types).toEqual(['workspace.updated', 'talk.owner', 'talk.message', 'talk.done']);
    const owner = await s.lastOf('talk.owner');
    expect(owner).toMatchObject({ opId: 'op_1', actor: 'owner', data: { turnId: r.body.turnId, messageId: r.body.messageId, text: 'Good morning, how are you?', via: 'text' } });
    const msg = await s.lastOf('talk.message');
    expect(msg.data).toMatchObject({ turnId: r.body.turnId, agentId: CHIEF_ID, kind: 'reply' });
    expect(msg.data.text).toContain('Good morning, how are you?');
    const done = await s.lastOf('talk.done');
    expect(done.data).toMatchObject({ turnId: r.body.turnId, messageId: msg.data.messageId, finish: 'stop', route: 'answer', usage: { provider: 'mock' } });

    // Deltas streamed on the socket add up to the message; presence went thinking → idle.
    const deltas = s.live.filter((f): f is Extract<Frame, { type: 'talk.delta' }> => f.type === 'talk.delta');
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((d) => d.data.delta).join('')).toBe(msg.data.text);
    expect(deltas.every((d) => d.seq === undefined && typeof d.after === 'number')).toBe(true);
    const presence = s.live.filter((f): f is Extract<Frame, { type: 'presence' }> => f.type === 'presence').map((f) => f.data.state);
    expect(presence).toEqual(['thinking', 'idle']);
  });

  it('is idempotent on opId', async () => {
    const s = await setup();
    const a = await s.talk('hello', 'op_same');
    const b = await s.talk('hello', 'op_same');
    expect(b.status).toBe(202);
    expect(b.body).toMatchObject({ turnId: a.body.turnId, messageId: a.body.messageId, duplicate: true });
    expect(await s.ofType('talk.owner')).toHaveLength(1);
    expect(await s.ofType('talk.done')).toHaveLength(1);
  });

  it('builds the system prompt from the lead, the chosen name and live work state', async () => {
    const s = await setup();
    const requests = useProvider();
    await s.talk('Can you look into office chairs under $500 for me?');
    await s.talk('What else is on today?');
    const system = requests.at(-1)!.system!;
    expect(system).toContain('You are Rosa');
    expect(system).toContain('James Owusu');
    expect(system).toContain('Profitable on paper');
    expect(system).toContain('LIVE WORK STATE');
    expect(system).toContain('“Office chairs under $500” — running, planning; now: Making a plan for “Office chairs under $500”');
  });

  it('lets a newer owner message spoken over a reply pre-empt it while it is still streaming (barge-in)', async () => {
    const s = await setup();
    // The first reply streams a few words, then stalls until the second message arrives.
    const hold = gate();
    const requests = useProvider({
      stream: (req) =>
        req.messages.at(-1)?.content === 'tell me a long story'
          ? (async function* () {
              yield { type: 'text', delta: 'Once upon a time' } as ModelEvent;
              await hold.opened;
              yield { type: 'done', finish: req.signal?.aborted ? 'cancelled' : 'stop' } as ModelEvent;
            })()
          : null,
    });
    const a = await s.api('POST', '/api/talk', { text: 'tell me a long story', opId: 'op_a' });
    await new Promise((r) => setTimeout(r, 0));
    const b = await s.api('POST', '/api/talk', { text: 'look into standing desks', opId: 'op_b', via: 'voice' });
    hold.open();
    await s.t.ctx.drain();
    const done = (await s.ofType('talk.done')).map((f) => f.data);
    expect(done.map((d) => [d.turnId, d.finish])).toEqual([
      [a.body.turnId, 'cancelled'],
      [b.body.turnId, 'stop'],
    ]);
    // The cut reply keeps what was shown and closes before the newer owner message: turns stay contiguous.
    const ledger = (await s.frames()).slice(1);
    expect(ledger.slice(0, 4).map((f) => [f.type, (f.data as { turnId?: string }).turnId])).toEqual([
      ['talk.owner', a.body.turnId],
      ['talk.message', a.body.turnId],
      ['talk.done', a.body.turnId],
      ['talk.owner', b.body.turnId],
    ]);
    expect((ledger[1]!.data as { text: string }).text).toBe('Once upon a time');
    // The second turn's transcript ends with what the owner said last.
    expect(requests[1]!.messages).toEqual([
      { role: 'user', content: 'tell me a long story' },
      { role: 'assistant', content: 'Once upon a time' },
      { role: 'user', content: 'look into standing desks' },
    ]);
    expect((await s.job()).title).toBe('Standing desks');
    const reply = await s.lastOf('talk.message');
    expect(reply.data.turnId).toBe(b.body.turnId);
  });

  it('lets a reply still streaming finish writing when the owner types a follow-up (the rest stays on screen)', async () => {
    const s = await setup();
    const hold = gate();
    const requests = useProvider({
      stream: (req) =>
        req.messages.at(-1)?.content === 'tell me a long story'
          ? (async function* () {
              yield { type: 'text', delta: 'Once upon a time' } as ModelEvent;
              await hold.opened;
              yield { type: 'text', delta: ', there was a candle shop.' } as ModelEvent;
              yield { type: 'done', finish: req.signal?.aborted ? 'cancelled' : 'stop' } as ModelEvent;
            })()
          : null,
    });
    const a = await s.api('POST', '/api/talk', { text: 'tell me a long story', opId: 'op_a' });
    await new Promise((r) => setTimeout(r, 0));
    const b = await s.api('POST', '/api/talk', { text: 'Oh wait, also, what about a candle subscription box?', opId: 'op_b' });
    await new Promise((r) => setTimeout(r, 10));
    expect(requests).toHaveLength(1); // the next answer waits for the first to finish writing
    hold.open();
    await s.t.ctx.drain();
    const done = (await s.ofType('talk.done')).map((f) => [f.data.turnId, f.data.finish]);
    expect(done).toEqual([
      [a.body.turnId, 'stop'],
      [b.body.turnId, 'stop'],
    ]);
    const first = (await s.ofType('talk.message')).find((m) => m.data.turnId === a.body.turnId)!;
    expect(first.data.text).toBe('Once upon a time, there was a candle shop.');
    // The follow-up's model call sees the whole first answer.
    expect(requests[1]!.messages.at(-2)).toEqual({ role: 'assistant', content: 'Once upon a time, there was a candle shop.' });
  });

  it('cuts a reply that is still writing after PREVIOUS_FINISH_MAX_MS when the owner typed a follow-up', async () => {
    const s = await setup();
    const hold = gate();
    useProvider({
      stream: (req) =>
        req.messages.at(-1)?.content === 'tell me a long story'
          ? (async function* () {
              yield { type: 'text', delta: 'Once upon a time' } as ModelEvent;
              await Promise.race([hold.opened, new Promise((r) => req.signal?.addEventListener('abort', r))]);
              yield { type: 'done', finish: req.signal?.aborted ? 'cancelled' : 'stop' } as ModelEvent;
            })()
          : null,
    });
    expect(defaultTalkTiming.previousFinishMaxMs).toBeLessThanOrEqual(8000);
    talkTiming.previousFinishMaxMs = 30;
    try {
      const a = await s.api('POST', '/api/talk', { text: 'tell me a long story', opId: 'op_a' });
      await new Promise((r) => setTimeout(r, 0));
      const b = await s.api('POST', '/api/talk', { text: 'and a second thing', opId: 'op_b' });
      await new Promise((r) => setTimeout(r, 80));
      await s.t.ctx.drain();
      const done = (await s.ofType('talk.done')).map((f) => [f.data.turnId, f.data.finish]);
      expect(done).toEqual([
        [a.body.turnId, 'cancelled'],
        [b.body.turnId, 'stop'],
      ]);
      expect((await s.ofType('talk.message')).find((m) => m.data.turnId === a.body.turnId)!.data.text).toBe('Once upon a time');
    } finally {
      Object.assign(talkTiming, defaultTalkTiming);
      hold.open();
    }
  });

  it('names the missing keys when no chat provider is configured', async () => {
    const s = await setup({ ENABLE_MOCK: 'false', DEFAULT_CHAT: 'auto' });
    await s.talk('What should I focus on today?');
    const err = s.live.find((f): f is Extract<Frame, { type: 'error' }> => f.type === 'error');
    expect(err?.data.code).toBe('not_configured');
    expect(err?.data.missingKeys?.length).toBeGreaterThan(0);
    expect((await s.lastOf('talk.done')).data.finish).toBe('error');
  });

  it('closes a turn that was interrupted by a restart', async () => {
    const s = await setup();
    const state = s.t.namespaces.WORKSPACE.state('ws:local');
    state.storage.sql.exec(`INSERT INTO meta (key, value) VALUES ('active_turn', ?)`, JSON.stringify({ turnId: 'turn_lost', opId: 'op_lost' }));
    const revived = new WorkspaceDO(state as unknown as DurableObjectState, s.t.env);
    const done = (await revived.frames(0)).filter((f) => f.type === 'talk.done');
    expect(done.map((f) => f.data)).toEqual([{ turnId: 'turn_lost', messageId: null, finish: 'error' }]);
  });

  it('clears a stale Thinking claim after a restart, even with no active turn row', async () => {
    const s = await setup();
    const state = s.t.namespaces.WORKSPACE.state('ws:local');
    state.storage.sql.exec(`INSERT INTO presence_claims (agent_id, source, state, label, cause_seq, project_id, at) VALUES (?, 'talk', 'thinking', 'Thinking', 1, NULL, 0)`, CHIEF_ID);
    const revived = new WorkspaceDO(state as unknown as DurableObjectState, s.t.env);
    const got: Frame[] = [];
    revived.feed.open({ send: (m) => void got.push(parseFrame(m)!) }, 0);
    expect(got.filter((f) => f.type === 'presence').map((f) => (f.data as { state: string }).state)).toEqual(['idle']);
  });

  it('answers 429 naming CHAT_DAILY_LIMIT when today\'s turns are used up', async () => {
    const s = await setup({ CHAT_DAILY_LIMIT: '1' });
    expect((await s.talk('What should I focus on today?')).status).toBe(202);
    const second = await s.talk('And after that?');
    expect(second.status).toBe(429);
    expect(second.body.error).toMatchObject({ code: 'rate_limited', message: expect.stringContaining('CHAT_DAILY_LIMIT') });
    expect(await s.ofType('talk.owner')).toHaveLength(1);
  });
});

describe('background jobs (work loop)', () => {
  it('delegates: "look into X" starts a job and the turn ends before any work runs', async () => {
    const s = await setup();
    await s.talk('Can you look into office chairs under $500 for me?');
    const done = await s.lastOf('talk.done');
    expect(done.data.route).toBe('delegate');
    const reply = await s.lastOf('talk.message');
    expect(reply.data.text).toContain('I started “Office chairs under $500”');
    const job = await s.job();
    expect(job).toMatchObject({ title: 'Office chairs under $500', status: 'running', step: 1, of: null, agentId: CHIEF_ID });
    expect(reply.data.jobId).toBe(job.jobId);
    // Mirrored into the owner feed with its cause, before the reply.
    const started = await s.lastOf('job.started');
    expect(started.cause).toEqual({ streamId: 'p:everyday:local', seq: 1 });
    expect(started.seq!).toBeLessThan(reply.seq!);
    // The work is scheduled, not done inline; the Chief of Staff stays available while it runs (D2).
    expect(s.t.namespaces.PROJECT.state('p:everyday:local').storage.alarmAt).not.toBeNull();
    const presence = s.live.filter((f): f is Extract<Frame, { type: 'presence' }> => f.type === 'presence').map((f) => f.data.state);
    expect(presence).not.toContain('working');
    expect(presence.at(-1)).toBe('idle');
  });

  it('keeps replying while a work step is in flight, and answers status from live state', async () => {
    const s = await setup();
    const hold = gate();
    let held = false;
    useProvider({ before: async (req) => (isWorkStep(req) ? ((held = true), hold.opened) : undefined) });
    await s.talk('look into standing desks');
    await s.project.alarm(); // plan
    const planned = await s.job();
    expect(planned).toMatchObject({ step: 2, of: 5 });

    let tickDone = false;
    const tick = s.project.alarm().then(() => (tickDone = true)); // the first work step blocks on the gate
    await new Promise((r) => setTimeout(r, 0));
    expect(held).toBe(true);

    const deltasBefore = s.live.filter((f) => f.type === 'talk.delta').length;
    await s.talk("What's the capital of France?");
    expect(tickDone).toBe(false);
    expect(s.live.filter((f) => f.type === 'talk.delta').length).toBeGreaterThan(deltasBefore);
    expect((await s.lastOf('talk.done')).data).toMatchObject({ finish: 'stop', route: 'answer' });

    await s.talk("How's it going?");
    expect(tickDone).toBe(false);
    const status = await s.lastOf('talk.message');
    expect(status.data.kind).toBe('status');
    expect(status.data.jobId).toBe(planned.jobId);
    expect(status.data.text).toContain('step 2 of 5 (20%)');
    expect(status.data.text).toContain(planned.label.toLowerCase());
    expect((await s.lastOf('talk.done')).data.route).toBe('status');
    // Asking did not pause, re-run or advance the job.
    expect(await s.job()).toMatchObject({ status: 'running', step: 2, label: planned.label });

    hold.open();
    await tick;
    expect(await s.job()).toMatchObject({ step: 3, of: 5 });
  });

  it('steers at the next checkpoint: queued, then applied, then worked on', async () => {
    const s = await setup();
    const requests = useProvider();
    await s.talk('look into office chairs under $500');
    await s.project.alarm(); // plan → step 2 of 5
    await s.talk('also check the warranty terms');
    expect((await s.lastOf('talk.done')).data.route).toBe('steer');
    expect((await s.lastOf('talk.message')).data.text).toContain('next checkpoint');
    const queued = await s.lastOf('job.steered');
    expect(queued.data).toMatchObject({ status: 'queued', text: 'also check the warranty terms' });
    expect((await s.job()).steers).toMatchObject([{ status: 'queued' }]);

    await s.project.alarm(); // checkpoint: apply, add a follow-up step, then run step 1
    await s.t.ctx.drain();
    const steered = (await s.ofType('job.steered')).map((f) => f.data.status);
    expect(steered).toEqual(['queued', 'applied']);
    const job = await s.job();
    expect(job.of).toBe(6);
    expect(job.steers).toMatchObject([{ status: 'applied', text: 'also check the warranty terms' }]);
    const stepPrompt = requests.filter(isWorkStep).at(-1)!.messages[0]!.content as string;
    expect(stepPrompt).toContain('Owner steering (highest priority):\n- also check the warranty terms');
    expect(stepPrompt).toContain('Looking into your note: “also check the warranty terms”');

    await s.runJobs();
    const done = await s.job();
    expect(done.status).toBe('done');
    expect(done.result).toContain('also check the warranty terms');
    expect((await s.ofType('job.progress')).map((f) => f.data.label)).toContain('Looking into your note: “also check the warranty terms”');
  });

  it('applies steering between tool calls inside a running step', async () => {
    const s = await setup();
    let jobId = '';
    let steeredOnce = false;
    const requests = useProvider({
      before: async (req) => {
        if (isWorkStep(req) && req.messages.length === 1 && !steeredOnce) {
          steeredOnce = true;
          await s.project.steerJob(jobId, 'focus on mesh backs');
        }
      },
    });
    await s.talk('look into office chairs');
    jobId = (await s.job()).jobId;
    await s.project.alarm(); // plan
    await s.project.alarm(); // step 1: the steer arrives mid-step
    await s.t.ctx.drain();
    const second = requests.filter(isWorkStep)[1]!;
    expect(second.messages.at(-1)).toEqual({ role: 'user', content: "Owner's steering (apply it from now on; it overrides the brief): focus on mesh backs" });
    const job = await s.job();
    expect(job.steers).toMatchObject([{ status: 'applied', text: 'focus on mesh backs' }]);
    expect(job.of).toBe(5); // handled inside the step, no follow-up step
    expect(job.partial).toContain('focus on mesh backs');
  });

  it('cancels: the job stops, a late result is discarded, the alarm is cleared', async () => {
    const s = await setup();
    const hold = gate();
    useProvider({ before: (req) => (isWorkStep(req) ? hold.opened : undefined) });
    await s.talk('look into office chairs');
    await s.project.alarm(); // plan
    const tick = s.project.alarm(); // step 1 in flight
    await new Promise((r) => setTimeout(r, 0));
    const r = await s.api('POST', `/api/jobs/${(await s.job()).jobId}/cancel`);
    expect(r.status).toBe(202);
    hold.open();
    await tick;
    await s.t.ctx.drain();
    const job = await s.job();
    expect(job.status).toBe('cancelled');
    expect(job.step).toBe(2);
    const progressAfterCancel = (await s.frames()).slice((await s.frames()).findIndex((f) => f.type === 'job.cancelled'));
    expect(progressAfterCancel.filter((f) => f.type === 'job.progress')).toEqual([]);
    await s.project.alarm();
    expect(await s.job()).toMatchObject({ status: 'cancelled', step: 2 });
    expect(s.t.namespaces.PROJECT.state('p:everyday:local').storage.alarmAt).toBeNull();
    const presence = s.live.filter((f): f is Extract<Frame, { type: 'presence' }> => f.type === 'presence').at(-1)!;
    expect(presence.data.state).toBe('idle');
  });

  it('cancels through the Chief of Staff', async () => {
    const s = await setup();
    await s.talk('look into office chairs');
    await s.talk('please stop that research');
    expect((await s.lastOf('talk.done')).data.route).toBe('cancel');
    expect((await s.lastOf('job.cancelled')).data.by).toBe('chief');
    expect((await s.job()).status).toBe('cancelled');
    // The Chief of Staff already said so in the turn: no second line.
    expect((await s.ofType('talk.message')).filter((f) => f.data.kind === 'announcement')).toEqual([]);
  });

  it('acknowledges a Stop pressed in the UI in the thread', async () => {
    const s = await setup();
    await s.talk('look into office chairs');
    const id = (await s.job()).jobId;
    expect((await s.api('POST', `/api/jobs/${id}/cancel`)).status).toBe(202);
    await s.t.ctx.drain();
    const cancelled = await s.lastOf('job.cancelled');
    expect(cancelled.data.by).toBe('owner');
    const ack = await s.lastOf('talk.message');
    expect(ack.data).toMatchObject({ kind: 'announcement', jobId: id, agentId: CHIEF_ID });
    expect(ack.data.text).toContain('Stopped “Office chairs”');
    expect(ack.cause).toEqual({ streamId: 'ws:local', seq: cancelled.seq });
  });

  it('folds steering sent during the write-up into the deliverable instead of dropping it', async () => {
    const s = await setup();
    const hold = gate();
    let inSynthesis = false;
    const isSynthesis = (req: ChatRequest) => typeof req.messages[0]?.content === 'string' && req.messages[0].content.startsWith('Write the deliverable');
    useProvider({ before: (req) => (isSynthesis(req) && !inSynthesis ? ((inSynthesis = true), hold.opened) : undefined) });
    await s.talk('look into office chairs');
    const id = (await s.job()).jobId;
    for (let i = 0; i < 4; i++) await s.project.alarm(); // plan + 3 steps
    const tick = s.project.alarm(); // the write-up is in flight
    await new Promise((r) => setTimeout(r, 0));
    expect(inSynthesis).toBe(true);
    const steer = await s.api('POST', `/api/jobs/${id}/steer`, { text: 'also check the warranty terms' });
    expect(steer.status).toBe(202);
    hold.open();
    await tick;
    await s.t.ctx.drain();
    // Applied at the write-up's checkpoint; the job writes the deliverable again with it.
    let job = await s.job();
    expect(job.status).toBe('running');
    expect(job.steers).toMatchObject([{ status: 'applied', text: 'also check the warranty terms' }]);
    expect(job.label).toBe('Adding your note to the write-up');
    await s.runJobs();
    job = await s.job();
    expect(job.status).toBe('done');
    expect(job.steers.every((st) => st.status === 'applied')).toBe(true);
    expect(job.result).toContain('also check the warranty terms');
  });

  it('refuses a job past MAX_ACTIVE_JOBS and says so honestly', async () => {
    const s = await setup({ MAX_ACTIVE_JOBS: '1' });
    await s.talk('look into office chairs');
    await s.talk('research coffee roasters in Portland');
    expect(await s.jobs()).toHaveLength(1);
    const reply = await s.lastOf('talk.message');
    expect(reply.data.text).toContain('already running');
    expect(reply.data.text).not.toContain('I started');
  });

  it('refuses jobs past JOB_DAILY_LIMIT', async () => {
    const s = await setup({ JOB_DAILY_LIMIT: '1' });
    await s.talk('look into office chairs');
    await s.api('POST', `/api/jobs/${(await s.job()).jobId}/cancel`);
    const r = await s.project.startJob({ title: 'Coffee roasters', brief: 'research coffee roasters' });
    expect(r).toMatchObject({ accepted: false, code: 'rate_limited', message: expect.stringContaining('JOB_DAILY_LIMIT') });
  });

  it('mirrors a quick job\'s frames without waiting for a slow one in the same tick', async () => {
    const s = await setup();
    const hold = gate();
    useProvider({ before: (req) => (typeof req.messages[0]?.content === 'string' && req.messages[0].content.startsWith('Plan this job') && req.messages[0].content.includes('slow thing') ? hold.opened : undefined) });
    await s.talk('look into the slow thing');
    await s.talk('look into office chairs');
    const tick = s.project.alarm(); // both plans run; the slow one blocks
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    const progress = await s.ofType('job.progress');
    const quick = (await s.jobs()).find((j) => j.title === 'Office chairs')!;
    expect(progress.map((f) => f.data.jobId)).toContain(quick.jobId);
    hold.open();
    await tick;
  });

  it('finishes with a Markdown deliverable and a proactive announcement', async () => {
    const s = await setup();
    await s.talk('look into office chairs under $500');
    const ticks = await s.runJobs();
    expect(ticks).toBe(5); // plan + 3 steps + synthesis
    const job = await s.job();
    expect(job).toMatchObject({ status: 'done', step: 5, of: 5 });
    expect(job.result).toMatch(/^# Office chairs under \$500/);
    const done = await s.lastOf('job.done');
    expect(done.data).toMatchObject({ jobId: job.jobId, finishedText: 'Finished “Office chairs under $500”' });
    const announcement = await s.lastOf('talk.message');
    expect(announcement.data).toMatchObject({ kind: 'announcement', jobId: job.jobId, turnId: null, agentId: CHIEF_ID });
    expect(announcement.data.text).toContain('“Office chairs under $500” is done.');
    expect(announcement.cause).toEqual({ streamId: 'ws:local', seq: done.seq });
    // Progress was sentence-rate with a running label and percent inputs.
    const progress = (await s.ofType('job.progress')).map((f) => [f.data.step, f.data.of]);
    expect(progress).toEqual([
      [2, 5],
      [2, 5], // a finding recorded mid-step
      [3, 5],
      [3, 5],
      [4, 5],
      [4, 5],
      [5, 5],
    ]);
    // Rolled up to D1: both streams and the job row.
    const d1Job = await s.t.d1.prepare('SELECT status, summary FROM jobs WHERE id = ?').bind(job.jobId).first<{ status: string; summary: string }>();
    expect(d1Job?.status).toBe('done');
    const streams = await s.t.d1.prepare('SELECT stream, COUNT(*) AS n FROM ledger_events GROUP BY stream ORDER BY stream').all<{ stream: string; n: number }>();
    expect(streams.results.map((r) => r.stream)).toEqual(['p:everyday:local', 'ws:local']);
    // The face is idle again.
    const presence = s.live.filter((f): f is Extract<Frame, { type: 'presence' }> => f.type === 'presence').at(-1)!;
    expect(presence.data.state).toBe('idle');
  });

  it('retries a failing step with backoff, then fails and says so', async () => {
    const s = await setup();
    let clock = Date.parse('2026-09-28T10:00:00Z');
    runtime.now = () => clock;
    useProvider({ events: (req) => (isWorkStep(req) ? [{ type: 'error', message: 'upstream 503', retryable: true }] : null) });
    await s.talk('look into office chairs');
    await s.project.alarm(); // plan
    for (let i = 0; i < 3; i++) {
      clock += 10_000;
      await s.project.alarm();
      await s.t.ctx.drain();
    }
    const job = await s.job();
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('provider_error');
    expect((await s.lastOf('job.failed')).data).toMatchObject({ jobId: job.jobId, retryable: true });
    const announcement = await s.lastOf('talk.message');
    expect(announcement.data.kind).toBe('announcement');
    expect(announcement.data.text).toBe('I could not finish “Office chairs”. The model kept failing, so I stopped retrying. Try again in a minute, or check the provider key.');
    expect(announcement.data.text.match(/I could not finish/g)).toHaveLength(1);
  });

  it("announces a finished job in the lead's voice from the fast model", async () => {
    const s = await setup(CLOUD_ENV);
    const asked = useCloudVoice(() => [{ type: 'text', delta: 'Rosa here: office chairs are sorted, and there is a clear pick. The full write-up is in Projects.' }, { type: 'done', finish: 'stop' }]);
    await s.talk('look into office chairs under $500');
    await s.runJobs();
    const done = await s.lastOf('job.done');
    const announcement = await s.lastOf('talk.message');
    expect(announcement.data).toMatchObject({ kind: 'announcement', jobId: done.data.jobId, turnId: null, agentId: CHIEF_ID, text: 'Rosa here: office chairs are sorted, and there is a clear pick. The full write-up is in Projects.' });
    expect(announcement.cause).toEqual({ streamId: 'ws:local', seq: done.seq });
    // One call, on the fast tier, grounded in the job's own result, in the chosen lead's voice.
    expect(asked).toHaveLength(1);
    expect(asked[0]!.model).toBe('claude-sonnet-5');
    expect(asked[0]!.system).toContain('You are Rosa');
    expect(asked[0]!.messages[0]!.content).toContain(`Answer (summary of the write-up): ${done.data.summary}`);
    // Posted exactly once; nothing pending is left behind.
    expect((await s.ofType('talk.message')).filter((f) => f.data.kind === 'announcement')).toHaveLength(1);
    expect(s.t.namespaces.WORKSPACE.state('ws:local').storage.sql.exec('SELECT * FROM pending_announcements').toArray()).toEqual([]);
  });

  it('falls back to the templated announcement when the fast model is too slow', async () => {
    announceConfig.timeoutMs = 30;
    const s = await setup(CLOUD_ENV);
    const asked = useCloudVoice(() => [{ type: 'text', delta: 'Too late.' }, { type: 'done', finish: 'stop' }], 5_000);
    await s.talk('look into office chairs under $500');
    await s.runJobs();
    expect(asked).toHaveLength(1);
    const announcement = await s.lastOf('talk.message');
    expect(announcement.data.kind).toBe('announcement');
    expect(announcement.data.text).toMatch(/^“Office chairs under \$500” is done\. .+ The full write-up is in Projects\.$/);
  });

  it('posts the template for an announcement whose voice was still being written when the object restarted', async () => {
    const s = await setup(CLOUD_ENV);
    const state = s.t.namespaces.WORKSPACE.state('ws:local');
    const frame = { type: 'talk.message', data: { turnId: null, messageId: 'msg_stranded', agentId: CHIEF_ID, text: '“Office chairs” is done. Buy the Aeron. The full write-up is in Projects.', kind: 'announcement', jobId: 'job_1' }, actor: CHIEF_ID, cause: { streamId: 'ws:local', seq: 1 } };
    state.storage.sql.exec('INSERT INTO pending_announcements (cause_seq, facts, frame, at) VALUES (1, ?, ?, 0)', JSON.stringify({ kind: 'done', title: 'Office chairs', summary: 'Buy the Aeron.' }), JSON.stringify(frame));
    const revived = new WorkspaceDO(state as unknown as DurableObjectState, s.t.env);
    const posted = (await revived.frames(0)).filter((f) => f.type === 'talk.message');
    expect(posted.map((f) => f.data)).toEqual([frame.data]);
    expect(state.storage.sql.exec('SELECT * FROM pending_announcements').toArray()).toEqual([]);
  });

  it('runs two jobs side by side', async () => {
    const s = await setup();
    await s.talk('look into office chairs');
    await s.talk('research coffee roasters in Portland');
    expect((await s.jobs()).filter((j) => j.status === 'running')).toHaveLength(2);
    await s.runJobs();
    expect((await s.jobs()).map((j: JobSnapshot) => j.status)).toEqual(['done', 'done']);
    expect(await s.ofType('talk.message').then((m) => m.filter((f) => f.data.kind === 'announcement'))).toHaveLength(2);
  });
});

describe('owner feed', () => {
  it('replays missed persisted events in order after ?since, then presence', async () => {
    const s = await setup();
    await s.talk('look into office chairs');
    await s.project.alarm();
    await s.t.ctx.drain();
    const all = await s.frames();
    expect(all.map((f) => f.seq)).toEqual(all.map((_, i) => i + 1)); // gap-free
    const since = 3;
    const got: Frame[] = [];
    s.ws.feed.open({ send: (m) => void got.push(parseFrame(m)!) }, since);
    expect(got[0]).toMatchObject({ type: 'ready', data: { lastSeq: all.length, replayFrom: since } });
    const replayed = got.filter((f) => f.seq !== undefined);
    expect(replayed.map((f) => f.seq)).toEqual(all.filter((f) => f.seq! > since).map((f) => f.seq));
    expect(replayed).toEqual(all.slice(since));
    expect(got.at(-1)).toMatchObject({ type: 'presence', data: { agentId: CHIEF_ID, state: 'idle' } });
  });

  it('mirrors each project frame once even when a batch is re-sent', async () => {
    const s = await setup();
    await s.talk('look into office chairs');
    const before = (await s.frames()).length;
    expect(s.t.namespaces.PROJECT.state('p:everyday:local').storage.sql.exec('SELECT seq FROM events').toArray()).toHaveLength(1);
    const started = await s.lastOf('job.started');
    const again = await s.ws.ingest({ source: 'p:everyday:local', frames: [{ ...started, streamId: 'p:everyday:local', seq: 1, cause: undefined } as unknown as Frame] });
    expect(again.applied).toBe(0);
    expect((await s.frames()).length).toBe(before);
  });
});

describe('routes', () => {
  it('steers and cancels over HTTP with typed errors', async () => {
    const s = await setup();
    expect((await s.api('POST', '/api/jobs/job_nope/steer', { text: 'x' })).status).toBe(404);
    expect((await s.api('POST', '/api/jobs/nope/cancel')).status).toBe(404);
    await s.talk('look into office chairs');
    const id = (await s.job()).jobId;
    expect((await s.api('POST', `/api/jobs/${id}/steer`, { text: '  ' })).status).toBe(400);
    const steer = await s.api('POST', `/api/jobs/${id}/steer`, { text: 'also check delivery', opId: 'op_s' });
    expect(steer).toMatchObject({ status: 202, body: { accepted: true, jobId: id } });
    expect(steer.body.steerId).toMatch(/^steer_/);
    const dup = await s.api('POST', `/api/jobs/${id}/steer`, { text: 'also check delivery', opId: 'op_s' });
    expect(dup.body.steerId).toBe(steer.body.steerId);
    expect((await s.api('POST', `/api/jobs/${id}/cancel`)).status).toBe(202);
    expect((await s.api('POST', `/api/jobs/${id}/cancel`)).status).toBe(202); // idempotent
    const late = await s.api('POST', `/api/jobs/${id}/steer`, { text: 'more' });
    expect(late).toMatchObject({ status: 409, body: { error: { code: 'conflict' } } });
  });

  it('validates workspace settings and tells other tabs', async () => {
    const s = await setup();
    expect((await s.api('PUT', '/api/workspace', { leadId: 'lead-nobody' })).status).toBe(400);
    expect((await s.api('PUT', '/api/workspace', { voiceOn: 'yes' })).status).toBe(400);
    const ok = await s.api('PUT', '/api/workspace', { voiceOn: false, chiefName: '   ' });
    expect(ok.body).toMatchObject({ leadId: 'lead-warm-mentor', chiefName: null, voiceOn: false });
    const updates = (await s.ofType('workspace.updated')).map((f) => f.data.settings.voiceOn);
    expect(updates).toEqual([true, false]);
    const row = await s.t.d1.prepare('SELECT lead_id, voice_on FROM workspaces WHERE id = ?').bind('local').first<{ lead_id: string; voice_on: number }>();
    expect(row).toEqual({ lead_id: 'lead-warm-mentor', voice_on: 0 });
  });

  it('rejects talk without an opId', async () => {
    const s = await setup();
    expect((await s.api('POST', '/api/talk', { text: 'hi' })).status).toBe(400);
  });
});

