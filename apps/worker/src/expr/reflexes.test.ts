// Server reflexes, mood, attention and viewer state in the WorkspaceDO (§4 A6–A9).
// Keyless (browser voice) unless a test says otherwise: browser lines are always instant, so reflex-grade picks work.
import type { ChatRequest, ModelEvent } from '@headcount/models';
import { CHIEF_ID, type Frame } from '@headcount/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exprSetup, gate, isTalk, sleep, useProviders, viewerOp } from '../../test/expr-kit';
import { FakeWebSocket } from '../../test/fake-cloud';
import { defaultRuntime, runtime } from '../workspace/runtime';
import { WorkspaceDO } from '../workspace/workspace-do';
import { chiefProfile, indexFor } from './catalog';
import { defaultExprTiming, exprTiming } from './config';
import { artifactOf, ownerMoodEvents, phaticIntent, turnOfOpId } from './host';
import { ownerClock, parseRecentOp, parseViewerOp } from './viewer';

afterEach(() => {
  Object.assign(runtime, defaultRuntime);
  Object.assign(exprTiming, defaultExprTiming);
  vi.useRealTimers();
});

const lastUser = (req: ChatRequest) => {
  const m = req.messages.at(-1)?.content;
  return typeof m === 'string' ? m : '';
};
const isWorkStep = (req: ChatRequest) => typeof req.messages[0]?.content === 'string' && req.messages[0].content.startsWith('Work on step');
const says = (frames: Frame[], intent?: string) => frames.filter((f): f is Extract<Frame, { type: 'reflex.say' }> => f.type === 'reflex.say' && (!intent || f.data.intent === intent));

describe('phatic closure (A9)', () => {
  it('answers "thanks" from the catalog: no model call, a reflex reply, a reflex.say, and no chat count', async () => {
    const { requests } = useProviders();
    const s = await exprSetup({ CHAT_DAILY_LIMIT: '1' });
    await s.view();
    const r = await s.talk('thanks', 'voice');
    if (!r.accepted) throw new Error(r.message);
    expect(requests.filter(isTalk)).toHaveLength(0);
    const types = (await s.frames()).map((f) => f.type);
    expect(types.slice(-3)).toEqual(['talk.owner', 'talk.message', 'talk.done']);
    const msg = (await s.ofType('talk.message')).at(-1)!;
    expect(msg.data).toMatchObject({ turnId: r.turnId, agentId: CHIEF_ID, kind: 'reflex', intent: 'gratitude_reply' });
    expect(msg.data.lineId).toMatch(/gratitude_reply/);
    expect(msg.data.text.trim().length).toBeGreaterThan(0);
    expect((await s.ofType('talk.done')).at(-1)!.data).toMatchObject({ turnId: r.turnId, messageId: msg.data.messageId, finish: 'stop', route: 'reflex' });

    const live = s.live();
    const say = says(live, 'gratitude_reply')[0]!;
    expect(say.data).toMatchObject({ agentId: CHIEF_ID, turnId: r.turnId, caption: msg.data.text, audience: 'owner' });
    expect(say.data.clip === null && say.data.render !== null).toBe(true); // browser voice: nothing pre-rendered
    expect(live.findIndex((f) => f.type === 'talk.message')).toBeLessThan(live.indexOf(say));
    expect(s.liveOf('presence').map((p) => p.data.state)).toEqual(['thinking', 'idle']);

    // The phatic turn used no chat count: one real question still fits under CHAT_DAILY_LIMIT=1.
    expect((await s.talk('What should I focus on today?')).accepted).toBe(true);
    expect((await s.talk('And after that?')).accepted).toBe(false);
  });

  it('asks the model when "thanks" comes with a question or a request', async () => {
    const { requests } = useProviders();
    const s = await exprSetup();
    await s.talk('thanks, can you check the budget numbers for me?');
    expect(requests.filter(isTalk)).toHaveLength(1);
    expect((await s.ofType('talk.message')).at(-1)!.data.kind).toBe('reply');
    await s.talk('thanks. what should we do next?');
    expect(requests.filter(isTalk)).toHaveLength(2);
  });

  it('says goodbye to "bye" and hello to "hi", and answers a second hello inside its cooldown like any answer', async () => {
    useProviders();
    const s = await exprSetup();
    await s.view();
    await s.talk('bye for now');
    expect((await s.ofType('talk.message')).at(-1)!.data).toMatchObject({ kind: 'reflex', intent: 'sign_off' });
    await s.talk('hi');
    expect((await s.ofType('talk.message')).at(-1)!.data).toMatchObject({ kind: 'reflex', intent: 'greeting' });
    // A second hello inside the greeting's 3-hour cooldown: the reply still lands, voiced like any answer (voice on).
    await s.talk('hello');
    const again = (await s.ofType('talk.message')).at(-1)!;
    expect(again.data).toMatchObject({ kind: 'reflex', intent: 'greeting' });
    expect(says(s.live(), 'greeting').at(-1)!.data.channels.voice).toBe(true);
  });

  it('answers the owner\'s first "hi" without a second introduction (Talk already opens with the lead\'s own)', async () => {
    useProviders();
    const s = await exprSetup();
    await s.view();
    const index = indexFor(chiefProfile({ leadId: 'lead-warm-mentor', chiefName: null })!);
    // Seeded picks: several first hellos (none of them after an owner turn to a real answer) never introduce again.
    for (const hello of ['hi', 'hello', 'hey there', 'hi!', 'hello there', 'hey']) {
      await s.talk(hello);
      const msg = (await s.ofType('talk.message')).at(-1)!;
      expect(msg.data).toMatchObject({ kind: 'reflex', intent: 'greeting' });
      const line = [...index.candidates('greeting')].find((w) => w.line.id === msg.data.lineId)!.line;
      expect(line.require, msg.data.text).not.toContain('first_meeting');
    }
  });

  it('voices a typed "thanks" like any other answer when voice is on, and not when it is off', async () => {
    useProviders();
    const s = await exprSetup({ MOCK_MEDIA: 'true' });
    await s.view({ voiceOn: true });
    await s.ws.updateSettings({ voiceOn: true });
    await s.talk('thanks', 'text');
    expect(says(s.live(), 'gratitude_reply').at(-1)!.data.channels.voice).toBe(true);
    await s.ws.updateSettings({ voiceOn: false });
    await s.view({ voiceOn: false }); // the tab tells the server (the viewer op follows the setting)
    await s.talk('bye for now', 'text');
    expect(says(s.live(), 'sign_off').at(-1)!.data.channels.voice).toBe(false);
  });

  it('picks the reply from the strongest cue', () => {
    const c = { farewell: 0, gratitude: 0, praise: 0, greeting: 0 };
    expect(phaticIntent({ ...c, gratitude: 0.9 })).toBe('gratitude_reply');
    expect(phaticIntent({ ...c, praise: 0.8 })).toBe('gratitude_reply');
    expect(phaticIntent({ ...c, greeting: 0.7 })).toBe('greeting');
    expect(phaticIntent({ ...c, gratitude: 0.8, farewell: 0.8 })).toBe('sign_off');
  });
});

describe('server reflexes for the Chief (A9)', () => {
  it('plays the thinking-filler safety net when the model is slow, and none once text streams', async () => {
    exprTiming.fillerVoiceMs = 40;
    exprTiming.fillerTextMs = 40;
    const hold = gate();
    useProviders({ chat: { before: async (req) => (isTalk(req) && lastUser(req) === 'think about our pricing' ? hold.opened : undefined) } });
    const s = await exprSetup();
    await s.view();
    const slow = await s.ws.talk({ text: 'think about our pricing', opId: 'op_slow', via: 'voice' });
    if (!slow.accepted) throw new Error(slow.message);
    await sleep(120);
    const fillers = says(s.live(), 'thinking_filler');
    expect(fillers).toHaveLength(1);
    expect(fillers[0]!.data).toMatchObject({ turnId: slow.turnId, agentId: CHIEF_ID, channels: { voice: true } });
    hold.open();
    await s.drain();

    const fast = await s.talk('What should I focus on today?', 'voice');
    await sleep(120);
    expect(says(s.live(), 'thinking_filler').filter((f) => fast.accepted && f.data.turnId === fast.turnId)).toHaveLength(0);
    expect(says(s.live(), 'thinking_filler')).toHaveLength(1);
  });

  it('acknowledges a delegation once, in the turn', async () => {
    useProviders();
    const s = await exprSetup();
    await s.view();
    const r = await s.talk('Look into three packaging suppliers', 'voice');
    if (!r.accepted) throw new Error(r.message);
    const acks = says(s.live(), 'acknowledge');
    expect(acks).toHaveLength(1);
    expect(acks[0]!.data).toMatchObject({ turnId: r.turnId, audience: 'owner' });
    // The acknowledgement lands before the reply is persisted.
    const live = s.live();
    expect(live.indexOf(acks[0]!)).toBeLessThan(live.findIndex((f) => f.type === 'talk.message'));
  });

  it('acknowledges a steer queued by a tool in its turn, then says it landed at the checkpoint', async () => {
    exprTiming.microStatusAfterTurnMs = 5;
    useProviders();
    const s = await exprSetup();
    await s.view();
    await s.talk('Look into three packaging suppliers', 'voice');
    const steer = await s.talk('also check delivery times', 'voice');
    if (!steer.accepted) throw new Error(steer.message);
    const steered = s.liveOf('job.steered');
    expect(steered.map((f) => f.data.status)).toEqual(['queued']);
    expect(steered[0]!.opId?.startsWith(`${steer.turnId}:`)).toBe(true);
    const acks = says(s.live(), 'acknowledge');
    expect(acks.map((f) => f.data.turnId)).toHaveLength(2);
    expect(acks[1]!.data.turnId).toBe(steer.turnId);
    await s.project.alarm(); // the checkpoint applies the steer (and plans)
    await sleep(30);
    expect(s.liveOf('job.steered').map((f) => f.data.status)).toEqual(['queued', 'applied']);
    expect(says(s.live(), 'micro_status')).toHaveLength(1);
  });

  it('nods at a steer sent from the job’s row (no turn): a face, no voice', async () => {
    useProviders();
    const s = await exprSetup();
    await s.view();
    await s.talk('Look into three packaging suppliers', 'voice');
    const job = (await s.project.listJobs())[0]!;
    const r = await s.api('POST', `/api/jobs/${job.jobId}/steer`, { text: 'focus on recycled materials', opId: 'op_row_steer' });
    expect(r.status).toBe(202);
    await s.drain();
    expect(says(s.live(), 'acknowledge')).toHaveLength(1); // only the delegation's
    expect(s.liveOf('reflex.face').map((f) => f.data.cue.gesture)).toContain('nod');
  });

  it('holds a progress line until the turn ends, plays it once, then cools down', async () => {
    exprTiming.microStatusAfterTurnMs = 5;
    const hold = gate();
    useProviders({ chat: { before: async (req) => (isTalk(req) && lastUser(req) === 'what else is new?' ? hold.opened : undefined) } });
    const s = await exprSetup();
    await s.view();
    await s.talk('Look into three packaging suppliers');
    const busy = await s.ws.talk({ text: 'what else is new?', opId: 'op_busy', via: 'text' });
    expect(busy.accepted).toBe(true);
    await s.project.alarm(); // plan → job.progress (step 2 of n) mirrored while the turn is still going
    await sleep(30);
    expect(s.liveOf('job.progress').length).toBeGreaterThan(0);
    expect(says(s.live(), 'micro_status')).toHaveLength(0);
    hold.open();
    await s.drain();
    await sleep(30);
    const lines = says(s.live(), 'micro_status');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.data.cause?.streamId).toBe('ws:local');
    expect(lines[0]!.data.turnId).toBeUndefined();
    // The next checkpoint inside the 2-minute cooldown stays quiet.
    await s.project.alarm();
    await s.drain();
    await sleep(30);
    expect(says(s.live(), 'micro_status')).toHaveLength(1);
  });

  it('holds a progress line while the Chief’s voice is still sounding in a tab', async () => {
    exprTiming.microStatusAfterTurnMs = 5;
    useProviders();
    const s = await exprSetup();
    await s.talk('Look into three packaging suppliers');
    await s.view({ voice: { agentId: CHIEF_ID, untilMs: Date.now() + 80 } });
    await s.project.alarm();
    await sleep(30);
    expect(says(s.live(), 'micro_status')).toHaveLength(0);
    await sleep(120);
    expect(says(s.live(), 'micro_status')).toHaveLength(1);
  });

  it('plays no event line without a viewer at the Chief’s stage (mood still moves)', async () => {
    useProviders();
    const s = await exprSetup();
    await s.view({ surface: 'floor', stageAgentId: null, floorVisible: true });
    await s.talk('Look into three packaging suppliers');
    await s.runJobs();
    await sleep(20);
    expect(says(s.live(), 'micro_status')).toHaveLength(0);
    expect(says(s.live(), 'celebrate')).toHaveLength(0);
    expect(s.liveOf('mood.changed').map((f) => f.data.reason)).toContain('job.done');
  });

  it('celebrates a finished job right before its announcement, with the job as the artifact', async () => {
    useProviders();
    const s = await exprSetup();
    await s.view();
    await s.talk('Look into three packaging suppliers');
    await s.runJobs();
    const live = s.live();
    const cheer = says(live, 'celebrate');
    expect(cheer).toHaveLength(1);
    const announcement = live.findIndex((f) => f.type === 'talk.message' && f.data.kind === 'announcement');
    expect(announcement).toBeGreaterThan(-1);
    expect(live.indexOf(cheer[0]!)).toBeLessThan(announcement);
    expect(live.findIndex((f) => f.type === 'job.done')).toBeLessThan(live.indexOf(cheer[0]!));
    expect(cheer[0]!.data.cause).toBeTruthy();
    expect(cheer[0]!.data.caption).not.toMatch(/\{|\}/);
    const mood = s.liveOf('mood.changed').at(-1)!;
    expect(mood.data).toMatchObject({ agentId: CHIEF_ID, reason: 'job.done' });
  });

  it('says oops on a retried step and winces when the job fails', async () => {
    useProviders({ chat: { events: (req) => (isWorkStep(req) ? ([{ type: 'error', message: 'upstream 503', retryable: true }] as ModelEvent[]) : null) } });
    const s = await exprSetup();
    let clock = Date.now();
    runtime.now = () => clock;
    await s.view();
    await s.talk('Look into three packaging suppliers');
    await s.project.alarm(); // plan
    for (let i = 0; i < 3; i++) {
      clock += 10_000;
      await s.project.alarm();
      await s.drain();
    }
    const oops = says(s.live(), 'oops');
    expect(oops).toHaveLength(1); // two retries, one line: the agent cooldown holds the second
    // The second retry is face-only (a wince, no voice); the failure winces with a concerned face for longer.
    const winces = s.liveOf('reflex.face').filter((f) => f.data.cue.gesture === 'wince');
    expect(winces.map((f) => f.data.cue.expression ?? null)).toEqual([null, 'concerned']);
    const face = winces.filter((f) => f.data.cue.expression === 'concerned');
    expect(face[0]!.data.cue).toMatchObject({ holdMs: 2000 });
    const reasons = s.liveOf('mood.changed').map((f) => f.data.reason);
    expect(reasons).toContain('job.failed');
    const live = s.live();
    const failed = live.findIndex((f) => f.type === 'job.failed');
    const wince = live.findIndex((f) => f.type === 'reflex.face' && f.data.cue.expression === 'concerned');
    expect(wince).toBeGreaterThan(failed);
  });

  it('glances at the work when the owner writes while a job runs', async () => {
    useProviders();
    const s = await exprSetup();
    await s.talk('Look into three packaging suppliers');
    expect(s.liveOf('reflex.face')).toHaveLength(0);
    await s.talk('What should I focus on today?');
    const glance = s.liveOf('reflex.face');
    expect(glance.map((f) => f.data.cue)).toEqual([{ gesture: 'glance', holdMs: 800 }]);
  });
});

describe('mood (A7)', () => {
  it('folds real events, persists them, coalesces small changes and snapshots on connect', async () => {
    // Mood reads the time of day: pin it to the afternoon (UTC) so the sizes of the changes do not depend on when the
    // suite runs. Time still moves (the coalescing window is real).
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T14:00:00Z'), shouldAdvanceTime: true });
    exprTiming.moodCoalesceMs = 60;
    useProviders();
    const s = await exprSetup();
    await s.talk('thanks');
    await sleep(5);
    const first = s.liveOf('mood.changed');
    expect(first).toHaveLength(1);
    expect(first[0]!.data).toMatchObject({ agentId: CHIEF_ID, reason: 'owner.thanks' });
    const index = indexFor(chiefProfile({ leadId: 'lead-warm-mentor', chiefName: null })!);
    expect(first[0]!.data.baseline).toEqual(index.baseline);
    expect(first[0]!.data.valence).toBeGreaterThan(index.baseline.valence);

    await s.talk('thank you so much');
    await sleep(5);
    expect(s.liveOf('mood.changed')).toHaveLength(1); // a small change inside the window waits
    await sleep(100);
    expect(s.liveOf('mood.changed')).toHaveLength(2); // … and lands once, coalesced

    const revived = new WorkspaceDO(s.state as unknown as DurableObjectState, s.t.env);
    const snap = revived.expr.connectFrames();
    expect(snap.map((f) => f.type)).toEqual(['mood.changed', 'attention.changed']);
    expect(snap[0]!.data).toMatchObject({ agentId: CHIEF_ID, reason: 'owner.thanks' });
  });

  it('maps owner words to mood events and never laughs off distress', () => {
    const base = { gratitude: 0, praise: 0, frustration: 0, distress: false } as Parameters<typeof ownerMoodEvents>[0];
    expect(ownerMoodEvents({ ...base, gratitude: 0.8, praise: 0.7 })).toEqual(['owner.thanks', 'owner.praise']);
    expect(ownerMoodEvents({ ...base, frustration: 0.6 })).toEqual(['owner.frustrated']);
    expect(ownerMoodEvents({ ...base, gratitude: 0.9, distress: true })).toEqual(['owner.distress']);
    expect(ownerMoodEvents({ ...base, gratitude: 0.5 })).toEqual([]);
  });
});

describe('attention (A8)', () => {
  it('shows the Chief’s running job as a thread, then clears it when the job ends', async () => {
    useProviders();
    const s = await exprSetup();
    await s.talk('Look into three packaging suppliers');
    const during = s.liveOf('attention.changed');
    expect(during.some((f) => f.data.background.some((t) => t.kind === 'work' && t.label.includes('Three packaging suppliers')))).toBe(true);
    expect(during.at(-1)!.data.focus).toMatchObject({ kind: 'work', label: '“Three packaging suppliers”' });
    await s.project.alarm(); // the plan gives the job its steps
    expect(s.liveOf('attention.changed').at(-1)!.data.focus?.label).toMatch(/^“Three packaging suppliers” \(step 2 of \d\)$/);
    await s.runJobs();
    expect(s.liveOf('attention.changed').at(-1)!.data).toMatchObject({ focus: null, background: [] });
    const state = await s.api('GET', '/api/expr/agents/cw_chief');
    expect(state.body.attention).toMatchObject({ focus: null, background: [] });
  });
});

describe('viewer and recency socket ops (A6)', () => {
  it('keeps the viewer in the socket attachment across hibernation and ignores malformed ops', async () => {
    useProviders();
    const s = await exprSetup();
    await s.view({ tzOffsetMin: -120 });
    const revived = new WorkspaceDO(s.state as unknown as DurableObjectState, s.t.env);
    expect(revived.expr.stageViewer(CHIEF_ID)).toMatchObject({ surface: 'talk', tzOffsetMin: -120 });
    const other = new FakeWebSocket();
    await revived.webSocketMessage(other as unknown as WebSocket, JSON.stringify({ ...viewerOp(), surface: 'nowhere' }));
    expect(other.deserializeAttachment()).toBeNull();
    await revived.webSocketMessage(other as unknown as WebSocket, '{not json');
    await revived.webSocketMessage(other as unknown as WebSocket, JSON.stringify({ op: 'ping', t: 7 }));
    expect(other.messages()).toEqual([{ op: 'pong', t: 7 }]);
  });

  it('validates viewer and recency ops field by field', () => {
    expect(parseViewerOp(viewerOp())).toEqual(viewerOp());
    expect(parseViewerOp({ ...viewerOp(), audioArmed: 'yes' })).toBeNull();
    expect(parseViewerOp({ ...viewerOp(), stageAgentId: 'chief' })).toBeNull();
    expect(parseViewerOp({ ...viewerOp(), tzOffsetMin: 99999 })).toBeNull();
    expect(parseViewerOp({ ...viewerOp(), voice: { agentId: CHIEF_ID, untilMs: 'soon' } })).toBeNull();
    expect(parseViewerOp({ ...viewerOp(), visibleProjectIds: Array.from({ length: 40 }, (_, i) => `prj_${i}`) })?.visibleProjectIds).toHaveLength(12);
    expect(parseRecentOp({ op: 'expr.recent', agents: { cw_chief: ['a.b.01'] } })).toEqual({ op: 'expr.recent', agents: { cw_chief: ['a.b.01'] } });
    expect(parseRecentOp({ op: 'expr.recent', agents: { chief: ['x'] } })).toBeNull();
    expect(parseRecentOp({ op: 'expr.recent', agents: { cw_chief: 'x' } })).toBeNull();
    expect(ownerClock(Date.UTC(2026, 8, 28, 23, 30), 240)).toMatchObject({ localHour: 19, weekday: 1, dayKey: '2026-09-28' });
  });

  it('merges lines the client just played into the workspace recency, once, and persists them', async () => {
    useProviders();
    const s = await exprSetup();
    const index = indexFor(chiefProfile({ leadId: 'lead-warm-mentor', chiefName: null })!);
    const [a, b] = index.candidates('acknowledge').map((w) => w.line.id);
    const op = { op: 'expr.recent', agents: { cw_chief: [a, 'no.such.line', b] } };
    await s.ws.webSocketMessage(s.socket as unknown as WebSocket, JSON.stringify(op));
    await s.ws.webSocketMessage(s.socket as unknown as WebSocket, JSON.stringify(op));
    const recent = s.ws.expr.recencySnapshot().agents[CHIEF_ID]!.map((e) => e.lineId);
    expect(recent).toEqual([a, b]);
    s.ws.expr.saveRecency();
    const revived = new WorkspaceDO(s.state as unknown as DurableObjectState, s.t.env);
    expect(revived.expr.recencySnapshot().agents[CHIEF_ID]!.map((e) => e.lineId)).toEqual([a, b]);
  });
});

describe('helpers', () => {
  it('reads the turn of a tool steer and a job title as an artifact', () => {
    expect(turnOfOpId('turn_01abc:call_1')).toBe('turn_01abc');
    expect(turnOfOpId('op_123')).toBeNull();
    expect(turnOfOpId(undefined)).toBeNull();
    expect(artifactOf('Office chairs under $500.')).toBe('office chairs under $500');
    expect(artifactOf('“HubSpot migration”')).toBe('HubSpot migration');
    expect(artifactOf('  ')).toBeUndefined();
  });
});
