// Office rooms and joined huddles (Office Phase 2 §4.2): POST /api/rooms/:roomId/say and /cancel on an in-process
// WorkspaceDO with scripted providers. Floor control, frames, the Chief's wrap-up, barge-in, the leave note, limits,
// honesty, isolation from Talk and quick chats, restart recovery and the voice claim.
import { createMockProvider, createRegistry, type ChatProvider, type ChatRequest, type ModelEvent } from '@headcount/models';
import { CHIEF_ID, type Frame } from '@headcount/protocol';
import { ROOM_TURNS_PER_MIN, newMeetingId } from '@headcount/protocol/ext/rooms';
import { afterEach, describe, expect, it } from 'vitest';
import { exprSetup, isTalk, type ExprSetup } from '../../test/expr-kit';
import type { Env } from '../env';
import { deskHistory } from '../desk/desk';
import { defaultRuntime, runtime } from '../workspace/runtime';
import { historyFromFrames } from '../workspace/talk';
import { FIGURE_LINE } from './guard';
import { ROOM_NO_PROVIDER_MESSAGE, ROOM_RATE_MESSAGE, defaultRoomTiming, roomTiming } from './room-turn';

afterEach(() => {
  Object.assign(runtime, defaultRuntime);
  Object.assign(roomTiming, defaultRoomTiming);
});

const KEMAR = 'cw_senior-copywriter';
const NINA = 'cw_tech-lead';
const IMOGEN = 'cw_contracts-analyst';
const BRUNO = 'cw_privacy-specialist';
const TABLE = [KEMAR, NINA, IMOGEN, BRUNO];

const isRoom = (req: ChatRequest) => typeof req.system === 'string' && req.system.includes('- You are in ');
const isQuickChat = (req: ChatRequest) => typeof req.system === 'string' && req.system.includes('quick chat in passing');
/** The responder's name from its system prompt ("You are Andre Campbell (he/him)…", "You are Ben, the owner's Chief…"). */
const who = (req: ChatRequest) => /## Who you are\nYou are (.+?) \(/.exec(String(req.system))?.[1] ?? /You are ([A-Z][\w]+), the owner's Chief of Staff/.exec(String(req.system))?.[1] ?? '?';
const lastUser = (req: ChatRequest) => String(req.messages.at(-1)?.content ?? '');

type Step = ModelEvent | (() => Promise<void>);
const text = (...deltas: string[]): Step[] => [...deltas.map((d) => ({ type: 'text', delta: d }) as ModelEvent), { type: 'done', finish: 'stop' } as ModelEvent];

/** A Mock chat whose room replies are scripted per request (steps may await a gate mid-stream). */
function useRoomChat(script: (req: ChatRequest) => Step[] | null) {
  const requests: ChatRequest[] = [];
  const mock = createMockProvider().chat;
  const chat: ChatProvider = {
    id: 'mock',
    kind: 'mock',
    family: 'mock',
    defaultModel: () => 'mock-1',
    async *chat(req) {
      requests.push(req);
      const steps = script(req);
      if (!steps) {
        yield* mock.chat(req);
        return;
      }
      for (const s of steps) {
        if (typeof s === 'function') await s();
        else yield s;
      }
    },
  };
  runtime.registry = (env: Env) => createRegistry(env, { providers: { mock: () => ({ ...createMockProvider(), chat }) } });
  return { requests, rooms: () => requests.filter(isRoom) };
}

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { opened, open };
};

const say = (s: ExprSetup, body: Record<string, unknown>, roomId = 'skyline') => s.api('POST', `/api/rooms/${encodeURIComponent(roomId)}/say`, body);
const cancel = (s: ExprSetup, body: Record<string, unknown>, roomId = 'skyline') => s.api('POST', `/api/rooms/${encodeURIComponent(roomId)}/cancel`, body);
const roomMessages = async (s: ExprSetup) => (await s.ofType('talk.message')).filter((f) => f.data.surface === 'room');

describe('POST /api/rooms/:roomId/say', () => {
  it('plans the floor at 202 and streams up to three replies with surface room, the room and the meeting', async () => {
    const { rooms } = useRoomChat((req) => (isRoom(req) ? text(`${who(req)} here. `, 'I would start small.') : null));
    const s = await exprSetup();
    const meetingId = newMeetingId();
    const r = await say(s, { text: 'What do you all think?', opId: 'op_r1', meetingId, participants: TABLE, clientId: 'tab_room_owner' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ accepted: true, opId: 'op_r1', roomId: 'skyline', meetingId, mode: 'group', order: [KEMAR, NINA, IMOGEN] });
    expect(r.body.gen).toBeGreaterThan(0);
    await s.drain();

    const owner = (await s.ofType('talk.owner')).at(-1)!;
    expect(owner.data).toMatchObject({ turnId: r.body.turnId, messageId: r.body.messageId, text: 'What do you all think?', surface: 'room', roomId: 'skyline', meetingId });
    expect(owner.data.agentId).toBeUndefined();
    const msgs = await roomMessages(s);
    expect(msgs.map((m) => m.data.agentId)).toEqual([KEMAR, NINA, IMOGEN]);
    expect(msgs.map((m) => m.data.text)).toEqual(['Andre Campbell here. I would start small.', 'Nina Petrović here. I would start small.', 'Jane Ashby here. I would start small.']);
    expect(new Set(msgs.map((m) => m.data.messageId)).size).toBe(3);
    for (const m of msgs) expect(m.data).toMatchObject({ turnId: r.body.turnId, kind: 'reply', surface: 'room', roomId: 'skyline', meetingId });
    const done = (await s.ofType('talk.done')).filter((f) => f.data.surface === 'room');
    expect(done.map((d) => [d.data.agentId, d.data.finish, d.data.route])).toEqual([
      [KEMAR, 'stop', 'room'],
      [NINA, 'stop', 'room'],
      [IMOGEN, 'stop', 'room'],
    ]);
    for (const d of s.liveOf('talk.delta')) expect(d.data).toMatchObject({ surface: 'room', roomId: 'skyline', meetingId });
    // Floor control as it ran: who is next, then done.
    const turns = s.liveOf('room.turn').map((f) => f.data);
    expect(turns.map((t) => [t.state, t.next, t.order])).toEqual([
      ['running', KEMAR, [KEMAR, NINA, IMOGEN]],
      ['running', NINA, [NINA, IMOGEN]],
      ['running', IMOGEN, [IMOGEN]],
      ['done', null, []],
    ]);
    expect(turns.every((t) => t.turnId === r.body.turnId && t.meetingId === meetingId && t.gen === r.body.gen)).toBe(true);
    // Each responder thinks, then is available again; the Chief is untouched.
    expect(s.liveOf('presence').filter((p) => p.data.agentId === NINA).map((p) => p.data.state)).toEqual(['thinking', 'idle']);
    expect(s.liveOf('presence').filter((p) => p.data.agentId === CHIEF_ID)).toHaveLength(0);
    expect(s.liveOf('reflex.face').filter((f) => f.data.cue.gesture === 'look_up').map((f) => f.data.agentId)).toEqual([KEMAR, NINA, IMOGEN]);
    // Tool-free, short, in the persona's voice, and each sees the others' lines of this turn.
    const reqs = rooms();
    expect(reqs).toHaveLength(3);
    expect(reqs.every((q) => !(q.tools ?? []).length)).toBe(true);
    expect(reqs[0]!.system).toContain('You are in the Skyline room with the owner and Nina Petrović (Tech lead)');
    expect(reqs[0]!.system).toContain('Never state a figure');
    expect(lastUser(reqs[0]!)).toBe('What do you all think?');
    expect(lastUser(reqs[2]!)).toBe('What do you all think?\n\n[Andre (Copywriter)]: Andre Campbell here. I would start small.\n\n[Nina (Tech lead)]: Nina Petrović here. I would start small.');
    // The sending tab took the voice.
    expect(s.ws.voice.owner()).toBe('tab_room_owner');
  });

  it('is idempotent on opId', async () => {
    useRoomChat((req) => (isRoom(req) ? text('Fine.') : null));
    const s = await exprSetup();
    const meetingId = newMeetingId();
    const a = await say(s, { text: 'Andre, thoughts?', opId: 'op_same', meetingId, participants: TABLE });
    await s.drain();
    const b = await say(s, { text: 'Andre, thoughts?', opId: 'op_same', meetingId, participants: TABLE });
    expect(b.status).toBe(202);
    expect(b.body).toMatchObject({ turnId: a.body.turnId, messageId: a.body.messageId, duplicate: true });
    await s.drain();
    expect((await s.ofType('talk.owner')).filter((f) => f.data.surface === 'room')).toHaveLength(1);
    expect(await roomMessages(s)).toHaveLength(1);
  });

  it('adds the Chief’s wrap-up only after two others spoke', async () => {
    let silent = false;
    const { rooms } = useRoomChat((req) => {
      if (!isRoom(req)) return null;
      if (silent && who(req) === 'Nina Petrović') return text(); // an empty reply is skipped
      return text(who(req).includes('Ben') ? 'Two views, one next step: a small test.' : 'I would start small.');
    });
    const s = await exprSetup();
    const participants = [CHIEF_ID, KEMAR, NINA];
    const one = await say(s, { text: 'What do you all think?', opId: 'op_w1', meetingId: newMeetingId(), participants });
    expect(one.body.order).toEqual([KEMAR, NINA, CHIEF_ID]);
    await s.drain();
    expect((await roomMessages(s)).map((m) => m.data.agentId)).toEqual([KEMAR, NINA, CHIEF_ID]);
    const wrap = rooms().at(-1)!;
    expect(wrap.system).toContain('## Chairing');
    expect(wrap.system).toContain('in a room you advise');

    silent = true;
    const two = await say(s, { text: 'What do you all think?', opId: 'op_w2', meetingId: newMeetingId(), participants });
    await s.drain();
    const after = (await roomMessages(s)).filter((m) => m.data.turnId === two.body.turnId);
    expect(after.map((m) => m.data.agentId)).toEqual([KEMAR]);
    const done = (await s.ofType('talk.done')).filter((d) => d.data.turnId === two.body.turnId);
    expect(done.map((d) => [d.data.agentId, d.data.messageId === null, d.data.finish])).toEqual([
      [KEMAR, false, 'stop'],
      [NINA, true, 'error'],
    ]);
    expect(s.liveOf('room.turn').at(-1)!.data).toMatchObject({ state: 'done', order: [], turnId: two.body.turnId });
  });

  it('a second message mid-turn cuts the reply being written, drops the queue, and takes the floor', async () => {
    const held = gate();
    const { rooms } = useRoomChat((req) => {
      if (!isRoom(req)) return null;
      if (lastUser(req) === 'first question, everyone?') return [{ type: 'text', delta: 'First part. ' } as ModelEvent, () => held.opened, ...text('Never heard.')];
      return text('Second answer.');
    });
    const s = await exprSetup();
    const meetingId = newMeetingId();
    const a = await say(s, { text: 'first question, everyone?', opId: 'op_c1', meetingId, participants: TABLE });
    for (let i = 0; i < 500 && !s.liveOf('talk.delta').length; i++) await new Promise((r) => setTimeout(r, 0));
    const b = await say(s, { text: 'Actually, Jane: is the contract fine?', opId: 'op_c2', meetingId, participants: TABLE });
    held.open();
    await s.drain();

    expect(s.liveOf('room.turn').find((f) => f.data.state === 'cancelled')!.data).toMatchObject({ turnId: a.body.turnId, gen: a.body.gen, reason: 'owner', order: [], next: null });
    const frames = (await s.frames()).filter((f) => f.type !== 'workspace.updated');
    const seq = frames.map((f) => `${f.type}:${(f.data as { turnId?: string }).turnId === a.body.turnId ? 'a' : 'b'}`);
    expect(seq).toEqual(['talk.owner:a', 'talk.message:a', 'talk.done:a', 'talk.owner:b', 'talk.message:b', 'talk.done:b']);
    const cut = (await roomMessages(s)).find((m) => m.data.turnId === a.body.turnId)!;
    expect(cut.data).toMatchObject({ agentId: KEMAR, text: 'First part.' });
    expect((await s.ofType('talk.done')).find((d) => d.data.turnId === a.body.turnId)!.data).toMatchObject({ agentId: KEMAR, finish: 'cancelled', messageId: cut.data.messageId });
    // The queued responders of the first turn never ran; the new question went to Jane.
    expect(b.body).toMatchObject({ order: [IMOGEN], mode: 'mention' });
    expect(b.body.gen).toBeGreaterThan(a.body.gen);
    expect(rooms().map(who)).toEqual(['Andre Campbell', 'Jane Ashby']);
    expect((await roomMessages(s)).filter((m) => m.data.turnId === b.body.turnId).map((m) => m.data.text)).toEqual(['Second answer.']);
    expect(s.liveOf('talk.delta').map((d) => d.data.delta).join('')).not.toContain('Never heard');
  });

  it('answers a phatic message from the catalog in each voice, with no model call and no reflex frame', async () => {
    const { rooms } = useRoomChat(() => null);
    const s = await exprSetup();
    const r = await say(s, { text: 'hi everyone', opId: 'op_p1', meetingId: newMeetingId(), participants: TABLE });
    expect(r.body).toMatchObject({ mode: 'phatic', order: [KEMAR, NINA] });
    await s.drain();
    expect(rooms()).toHaveLength(0);
    const msgs = await roomMessages(s);
    expect(msgs.map((m) => [m.data.agentId, m.data.kind, m.data.intent])).toEqual([
      [KEMAR, 'reflex', 'greeting'],
      [NINA, 'reflex', 'greeting'],
    ]);
    expect(msgs.every((m) => m.data.text.trim().length > 0)).toBe(true);
    expect(s.liveOf('reflex.say')).toHaveLength(0);
  });

  it('rewrites an invented metric (the office demo line can never reach the room)', async () => {
    useRoomChat((req) => (isRoom(req) ? text('Then lead with the reorder rate: ', 'it went up nine points after the relaunch. ', 'Sell-through beats brand love.') : null));
    const s = await exprSetup();
    await say(s, { text: 'Andre, sell-through or brand love?', opId: 'op_h1', meetingId: newMeetingId(), participants: TABLE });
    await s.drain();
    const msg = (await roomMessages(s)).at(-1)!;
    expect(msg.data.text).toBe('Sell-through beats brand love.');
    expect(s.liveOf('talk.delta').map((d) => d.data.delta).join('')).not.toMatch(/nine|reorder/);
  });

  it('a reply cut by the token cap ends at its last whole sentence; a cut with no whole sentence is skipped', async () => {
    const cut = (...deltas: string[]): Step[] => [...deltas.map((d) => ({ type: 'text', delta: d }) as ModelEvent), { type: 'done', finish: 'length' } as ModelEvent];
    useRoomChat((req) => (isRoom(req) ? (who(req).startsWith('Andre') ? cut('Start with the buyer. ', 'I would start with the') : cut('I would lead with the')) : null));
    const s = await exprSetup();
    await say(s, { text: 'Andre and Nina, where would you start?', opId: 'op_cut', meetingId: newMeetingId(), participants: TABLE });
    await s.drain();
    const msgs = await roomMessages(s);
    expect(msgs.map((m) => String(m.data.text))).toEqual(['Start with the buyer.']);
    expect(s.liveOf('talk.delta').map((d) => d.data.delta).join('')).not.toMatch(/start with the$|lead with the/);
  });

  it("says the owner's own figure back, and gives two responders with nothing honest to say different lines", async () => {
    useRoomChat((req) =>
      isRoom(req) ? (lastUser(req).includes('higher now') ? text('It went up 12 points after the relaunch.') : text('Since the reorder rate went up nine points, lead with it. ', 'We could start with a small pilot.')) : null,
    );
    const s = await exprSetup();
    const meetingId = newMeetingId();
    await say(s, { text: 'Andre, our reorder rate went up nine points after the relaunch. Should we lead with it?', opId: 'op_h2', meetingId, participants: TABLE });
    await s.drain();
    expect((await roomMessages(s)).at(-1)!.data.text).toBe('Since the reorder rate went up nine points, lead with it. We could start with a small pilot.');
    await say(s, { text: 'What do you all think, is it higher now?', opId: 'op_h3', meetingId: newMeetingId(), participants: TABLE.slice(0, 2) });
    await s.drain();
    const lines = (await roomMessages(s)).slice(-2).map((m) => String(m.data.text));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(FIGURE_LINE);
    expect(lines[1]).not.toBe(lines[0]);
    expect(lines.join(' ')).not.toMatch(/12|went up/);
  });

  it('holds ROOM_TURNS_PER_MIN (at 202 and mid-turn) and CHAT_DAILY_LIMIT', async () => {
    useRoomChat((req) => (isRoom(req) ? text('Sure.') : null));
    const t0 = Date.parse('2026-09-29T10:00:05Z');
    runtime.now = () => t0;
    const s = await exprSetup();
    const meetingId = newMeetingId();
    for (let i = 0; i < ROOM_TURNS_PER_MIN - 1; i++) {
      expect((await say(s, { text: `Andre, point ${i}?`, opId: `op_l${i}`, meetingId, participants: TABLE })).status).toBe(202);
      await s.drain();
    }
    // One reply left this minute: a group question gets one answer, then stops at the limit.
    const group = await say(s, { text: 'What do you all think?', opId: 'op_lg', meetingId, participants: TABLE });
    expect(group.status).toBe(202);
    await s.drain();
    expect((await roomMessages(s)).filter((m) => m.data.turnId === group.body.turnId)).toHaveLength(1);
    expect(s.liveOf('room.turn').at(-1)!.data).toMatchObject({ state: 'done', reason: 'limit', order: [] });
    expect(s.liveOf('error').at(-1)!.data).toMatchObject({ code: 'rate_limited', message: ROOM_RATE_MESSAGE, turnId: group.body.turnId });
    const refused = await say(s, { text: 'Andre, one more?', opId: 'op_lx', meetingId, participants: TABLE });
    expect(refused).toMatchObject({ status: 429, body: { error: { code: 'rate_limited', message: ROOM_RATE_MESSAGE } } });
    // A new minute.
    runtime.now = () => t0 + 60_000;
    expect((await say(s, { text: 'Andre, and now?', opId: 'op_ly', meetingId, participants: TABLE })).status).toBe(202);
    await s.drain();

    const daily = await exprSetup({ CHAT_DAILY_LIMIT: '2' } as Partial<Env>);
    const m2 = newMeetingId();
    const first = await say(daily, { text: 'What do you all think?', opId: 'op_d1', meetingId: m2, participants: TABLE });
    await daily.drain();
    expect((await roomMessages(daily)).filter((m) => m.data.turnId === first.body.turnId)).toHaveLength(2);
    expect(daily.liveOf('error').at(-1)!.data.message).toContain('CHAT_DAILY_LIMIT');
    expect((await say(daily, { text: 'Andre?', opId: 'op_d2', meetingId: m2, participants: TABLE })).status).toBe(429);
    // A phatic message costs no model call, so it still gets its catalog replies.
    expect((await say(daily, { text: 'thanks everyone', opId: 'op_d3', meetingId: m2, participants: TABLE })).status).toBe(202);
    await daily.drain();
  });

  it('answers 503 with the missing keys when no chat provider is configured', async () => {
    runtime.registry = defaultRuntime.registry;
    const s = await exprSetup({ ENABLE_MOCK: 'false', DEFAULT_CHAT: 'auto' } as Partial<Env>);
    const r = await say(s, { text: 'What do you all think?', opId: 'op_n1', meetingId: newMeetingId(), participants: TABLE });
    expect(r.status).toBe(503);
    expect(r.body.error).toMatchObject({ code: 'not_configured', message: ROOM_NO_PROVIDER_MESSAGE });
    expect(r.body.error.missingKeys.length).toBeGreaterThan(0);
  });

  it('validates the room, the meeting, the participants, the label and the text', async () => {
    useRoomChat(() => null);
    const s = await exprSetup();
    const meetingId = newMeetingId();
    const ok = { text: 'hi', opId: 'op_v', meetingId, participants: [KEMAR] };
    expect((await say(s, ok, 'boardroom')).status).toBe(404);
    expect((await say(s, ok, 'huddle:ab')).status).toBe(404);
    expect((await say(s, { ...ok, meetingId: 'mtg_nope' })).status).toBe(400);
    expect((await say(s, { ...ok, opId: undefined })).status).toBe(400);
    expect((await say(s, { ...ok, text: '   ' })).status).toBe(400);
    expect((await say(s, { ...ok, text: 'x'.repeat(2001) })).status).toBe(413);
    expect((await say(s, { ...ok, participants: [] })).status).toBe(400);
    expect((await say(s, { ...ok, participants: ['cw_nobody-at-all'] })).status).toBe(400);
    expect((await say(s, { ...ok, participants: [KEMAR, KEMAR] })).status).toBe(400);
    expect((await say(s, { ...ok, participants: [...TABLE, 'cw_growth-lead'] }, 'huddle:abcd')).status).toBe(400);
    expect((await say(s, { ...ok, label: 'water <cooler>' }, 'huddle:abcd')).status).toBe(400);
    expect((await say(s, { ...ok, opId: 'op_v2', label: 'water cooler' }, 'huddle:abcd')).status).toBe(202);
    await s.drain();
    const fresh = await exprSetup({}, { lead: null });
    expect((await say(fresh, { ...ok, opId: 'op_v3', participants: [CHIEF_ID] })).body.error).toMatchObject({ code: 'bad_request', message: 'Choose a Chief of Staff first.' });
  });
});

describe('POST /api/rooms/:roomId/cancel', () => {
  it('cancels the running turn (push-to-talk), and cancelling nothing is a no-op', async () => {
    const held = gate();
    useRoomChat((req) => (isRoom(req) ? [() => held.opened, ...text('Late.')] : null));
    const s = await exprSetup();
    const meetingId = newMeetingId();
    expect((await cancel(s, { opId: 'op_x0', meetingId })).body).toEqual({ cancelled: false, noteId: null });
    const a = await say(s, { text: 'What do you all think?', opId: 'op_x1', meetingId, participants: TABLE });
    for (let i = 0; i < 500 && !s.liveOf('presence').some((p) => p.data.agentId === KEMAR); i++) await new Promise((r) => setTimeout(r, 0));
    const c = await cancel(s, { opId: 'op_x2', meetingId, clientId: 'tab_barge_in' });
    expect(c).toMatchObject({ status: 200, body: { cancelled: true, noteId: null } });
    held.open();
    await s.drain();
    expect(s.liveOf('room.turn').at(-1)!.data).toMatchObject({ state: 'cancelled', reason: 'owner', turnId: a.body.turnId });
    expect(await roomMessages(s)).toHaveLength(0);
    expect((await s.ofType('talk.done')).filter((d) => d.data.turnId === a.body.turnId).map((d) => d.data.finish)).toEqual(['cancelled']);
    expect(s.liveOf('presence').filter((p) => p.data.agentId === KEMAR).map((p) => p.data.state)).toEqual(['thinking', 'idle']);
    expect(s.ws.voice.owner()).toBe('tab_barge_in');
    // Idempotent on opId.
    expect((await cancel(s, { opId: 'op_x2', meetingId })).body).toEqual({ cancelled: true, noteId: null });
  });

  it('posts exactly one note in Talk when the owner leaves a meeting they spoke in, and none otherwise', async () => {
    useRoomChat((req) => (isRoom(req) ? text('I would start small.') : null));
    const s = await exprSetup();
    const meetingId = newMeetingId();
    await say(s, { text: 'What do you all think?', opId: 'op_n1', meetingId, participants: TABLE });
    await s.drain();
    const left = await cancel(s, { opId: 'op_n2', meetingId, leave: true, participants: TABLE });
    expect(left.body.cancelled).toBe(false);
    expect(left.body.noteId).toMatch(/^msg_/);
    const notes = () => s.ofType('talk.message').then((m) => m.filter((f) => f.data.kind === 'note'));
    expect((await notes()).map((n) => n.data)).toEqual([
      { turnId: null, messageId: left.body.noteId, agentId: CHIEF_ID, text: 'Skyline room with Andre, Nina and 2 others · 1 min', kind: 'note', roomId: 'skyline', meetingId },
    ]);
    // Again (another tab, a retry): still one note.
    expect((await cancel(s, { opId: 'op_n3', meetingId, leave: true })).body.noteId).toBe(left.body.noteId);
    expect((await cancel(s, { opId: 'op_n2', meetingId, leave: true })).body).toEqual(left.body);
    expect(await notes()).toHaveLength(1);

    // A huddle the owner joined but said nothing in: no note.
    const quiet = newMeetingId();
    expect((await cancel(s, { opId: 'op_n4', meetingId: quiet, leave: true, label: 'water cooler' }, 'huddle:k2p9')).body).toEqual({ cancelled: false, noteId: null });
    // A huddle with a place: "Water cooler with …".
    const huddle = newMeetingId();
    await say(s, { text: 'Andre, what are you two on about?', opId: 'op_n5', meetingId: huddle, participants: [KEMAR, NINA], label: 'water cooler' }, 'huddle:k2p9');
    await s.drain();
    await cancel(s, { opId: 'op_n6', meetingId: huddle, leave: true, participants: [KEMAR, NINA], label: 'water cooler' }, 'huddle:k2p9');
    expect((await notes()).map((n) => n.data.text)).toEqual(['Skyline room with Andre, Nina and 2 others · 1 min', 'Water cooler with Andre and Nina · 1 min']);
  });
});

describe('isolation and recovery', () => {
  it('keeps room lines and notes out of the Chief’s Talk history, desk history and quick-chat projections', async () => {
    const { requests } = useRoomChat((req) => {
      if (isRoom(req)) return text('Weekend projects are my favourite topic.');
      if (isQuickChat(req)) return text('At work, mostly architecture.');
      return null;
    });
    const s = await exprSetup();
    const meetingId = newMeetingId();
    await say(s, { text: 'Nina, tell me about your weekend project', opId: 'op_i1', meetingId, participants: TABLE });
    await s.drain();
    await cancel(s, { opId: 'op_i2', meetingId, leave: true, participants: TABLE });
    await s.talk('What should I focus on today?');
    const chief = requests.filter(isTalk).at(-1)!;
    const seen = JSON.stringify(chief.messages);
    expect(seen).not.toContain('weekend project');
    expect(seen).not.toContain('favourite topic');
    expect(seen).not.toContain('Skyline room');
    const frames: Frame[] = await s.frames();
    expect(historyFromFrames(frames).map((m) => m.content).join(' ')).not.toMatch(/weekend|Skyline/);
    expect(deskHistory(frames, NINA)).toEqual([]);
    await s.api('POST', '/api/desk/tech-lead/say', { text: 'and at work?', opId: 'op_i3' });
    await s.drain();
    expect(requests.filter(isQuickChat).at(-1)!.messages.map((m) => m.content)).toEqual(['and at work?']);
  });

  it('closes a room turn that was cut by a restart', async () => {
    useRoomChat(() => null);
    const s = await exprSetup();
    const meetingId = newMeetingId();
    s.state.storage.sql.exec(`INSERT INTO meta (key, value) VALUES ('active_room', ?)`, JSON.stringify({ turnId: 'turn_lost', opId: 'op_lost', roomId: 'skyline', meetingId, agentId: NINA }));
    s.state.storage.sql.exec(`INSERT INTO presence_claims (agent_id, source, state, label, cause_seq, project_id, at) VALUES (?, 'room', 'thinking', 'Thinking', 1, NULL, 0)`, NINA);
    const { WorkspaceDO } = await import('../workspace/workspace-do');
    const revived = new WorkspaceDO(s.state as unknown as DurableObjectState, s.t.env);
    const done = (await revived.frames(0)).filter((f): f is Extract<Frame, { type: 'talk.done' }> => f.type === 'talk.done');
    expect(done.map((f) => f.data)).toEqual([{ turnId: 'turn_lost', messageId: null, finish: 'error', agentId: NINA, surface: 'room', roomId: 'skyline', meetingId }]);
    expect(s.state.storage.sql.exec(`SELECT COUNT(*) AS n FROM presence_claims WHERE source = 'room'`).toArray()[0]!.n).toBe(0);
    expect(s.state.storage.sql.exec(`SELECT COUNT(*) AS n FROM meta WHERE key = 'active_room'`).toArray()[0]!.n).toBe(0);
  });
});

describe('the owner’s name', () => {
  it('validates PUT /api/workspace {ownerName} and reaches room and quick-chat prompts', async () => {
    const { rooms, requests } = useRoomChat((req) => (isRoom(req) || isQuickChat(req) ? text('Hello.') : null));
    const s = await exprSetup();
    expect((await s.api('PUT', '/api/workspace', { ownerName: 'x'.repeat(41) })).status).toBe(400);
    expect((await s.api('PUT', '/api/workspace', { ownerName: 'Greg <script>' })).body.error.message).toBe('Use letters for your name.');
    expect((await s.api('PUT', '/api/workspace', { ownerName: 'greg@example.com' })).status).toBe(400);
    expect((await s.api('PUT', '/api/workspace', { ownerName: 42 })).status).toBe(400);
    expect((await s.api('PUT', '/api/workspace', { ownerName: '   ' })).body.ownerName).toBeNull();
    const put = await s.api('PUT', '/api/workspace', { ownerName: '  Greg   van Dyke ' });
    expect(put).toMatchObject({ status: 200, body: { ownerName: 'Greg van Dyke' } });
    expect((await s.api('GET', '/api/workspace')).body.ownerName).toBe('Greg van Dyke');
    expect((await s.ofType('workspace.updated')).at(-1)!.data.settings.ownerName).toBe('Greg van Dyke');
    await say(s, { text: 'Andre, thoughts?', opId: 'op_o1', meetingId: newMeetingId(), participants: TABLE });
    await s.drain();
    expect(rooms().at(-1)!.system).toContain('You are in the Skyline room with the owner, Greg, and Nina Petrović');
    expect(rooms().at(-1)!.system).toContain("The owner's name is Greg. Use it rarely.");
    await s.api('POST', '/api/desk/tech-lead/say', { text: 'hello there, how is it going?', opId: 'op_o2' });
    await s.drain();
    expect(requests.filter(isQuickChat).at(-1)!.system).toContain("The owner's name is Greg. Use it rarely.");
    await s.talk('What should I focus on today?');
    expect(requests.filter(isTalk).at(-1)!.system).toContain("The owner's name is Greg. Use it rarely.");
    expect((await s.api('PUT', '/api/workspace', { ownerName: null })).body.ownerName).toBeNull();
  });
});
