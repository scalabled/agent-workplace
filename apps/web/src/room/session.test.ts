// The room session (OFFICE-PHASE2 §4.4.1): the writer, the voicer ‖ player, barge-in and leaving, against a fake api,
// fake speakers and a fake clock.
import type { Frame, FrameType } from '@headcount/protocol';
import type { RoomCancelRequest, RoomSayAccepted, RoomSayRequest } from '@headcount/protocol/ext/rooms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { clientId } from '../lib/client-id';
import { navigate, paths } from '../router';
import { capabilities, settings, type FrameInfo } from '../store';
import { applyServerVoice, claimVoice, resetVoiceOwner } from '../voice/owner';
import type { SpeakerObserver } from '../voice/speaker';
import { LOOKAHEAD_LINES, readingMs, REFLEX_GRACE_MS, SPEAKER_GAP_MS, START_STALL_MS, type RoomSpeaker, type VoiceVerdict } from './player';
import { openRoomSession, RECONNECT_SETTLE_MS, roomClipVoice, roomVoice, type RoomEvent, type RoomSession, type RoomSessionDeps } from './session';

const MEETING = 'mtg_01j00000000000000000000000';
const OTHER_MEETING = 'mtg_01j00000000000000000000099';
const JUNO = 'cw_juno';
const WALT = 'cw_walt';
const LENA = 'cw_lena';
const CHIEF = 'cw_chief';

/** A speaker as the engine would drive it: a line's audio starts when its gate opens, and ends when the test says. */
class FakeSpeaker implements RoomSpeaker {
  fed: string[] = [];
  text = new Map<string, string>();
  completed = new Set<string>();
  ended = new Set<string>();
  stops = 0;
  sounding: string | null = null;
  private gate: Promise<void> | null = null;
  private gates = new Map<string, Promise<void>>();
  private observers = new Set<SpeakerObserver>();
  private stopped = new Set<string>();

  constructor(readonly id: string) {}

  holdNext(release: Promise<void>): void {
    this.gate = release;
  }
  delta(messageId: string, text: string): void {
    if (this.stopped.has(messageId)) return;
    if (!this.text.has(messageId)) this.open(messageId);
    this.text.set(messageId, (this.text.get(messageId) ?? '') + text);
  }
  complete(messageId: string, finalText?: string): void {
    if (this.stopped.has(messageId)) return;
    if (!this.text.has(messageId)) this.open(messageId);
    if (finalText !== undefined) this.text.set(messageId, finalText);
    this.completed.add(messageId);
  }
  endHere(messageId: string): void {
    this.completed.add(messageId);
  }
  stop(): void {
    this.stops++;
    for (const id of this.fed) {
      if (this.ended.has(id)) continue;
      this.stopped.add(id);
      this.finish(id, 'stopped');
    }
  }
  observe(o: SpeakerObserver): () => void {
    this.observers.add(o);
    return () => this.observers.delete(o);
  }
  /** The engine finished playing this line. */
  play(messageId: string): void {
    this.finish(messageId, 'completed');
  }
  private open(messageId: string): void {
    this.fed.push(messageId);
    const gate = this.gate ?? Promise.resolve();
    this.gate = null;
    this.gates.set(messageId, gate);
    void gate.then(() => {
      if (this.stopped.has(messageId) || this.ended.has(messageId)) return;
      this.sounding = messageId;
      for (const o of this.observers) o.started?.(messageId);
    });
  }
  private finish(messageId: string, status: 'completed' | 'stopped'): void {
    if (this.ended.has(messageId)) return;
    this.ended.add(messageId);
    if (this.sounding === messageId) this.sounding = null;
    for (const o of this.observers) o.ended?.(messageId, status);
  }
}

interface Harness {
  session: RoomSession;
  events: RoomEvent[];
  speakers: Map<string, FakeSpeaker>;
  says: RoomSayRequest[];
  cancels: RoomCancelRequest[];
  /** Resolve the pending say with this 202. */
  accept(order: string[], turnId?: string, mode?: RoomSayAccepted['mode']): Promise<void>;
  reject(err: unknown): Promise<void>;
  frame(type: FrameType, data: unknown, opts?: { live?: boolean; opId?: string }): void;
  voice: VoiceVerdict;
  ptt: { restored: number; set: number };
  /** The feed socket came back (a new `ready`). */
  reconnect(): void;
}

let seq = 0;
let harnesses: Harness[] = [];

function harness(opts: { participants?: string[]; roomId?: RoomSayAccepted['roomId'] } = {}): Harness {
  const events: RoomEvent[] = [];
  const speakers = new Map<string, FakeSpeaker>();
  const says: RoomSayRequest[] = [];
  const cancels: RoomCancelRequest[] = [];
  const listeners = new Set<(f: Frame, i: FrameInfo) => void>();
  const reconnects = new Set<() => void>();
  /** Says waiting for their 202, oldest first. */
  const pending: { resolve(a: RoomSayAccepted): void; reject(e: unknown): void; body: RoomSayRequest }[] = [];
  let ops = 0;
  const roomId = opts.roomId ?? 'skyline';
  const h: Harness = {
    events,
    speakers,
    says,
    cancels,
    voice: { voiced: true, notVoicedTag: false },
    ptt: { restored: 0, set: 0 },
    async accept(order, turnId = 'turn_1', mode = 'group') {
      const p = pending.shift()!;
      p.resolve({ accepted: true, opId: p.body.opId, roomId, meetingId: MEETING, turnId, messageId: `msg_owner_${turnId}`, order, mode, gen: 1 } as RoomSayAccepted);
      await flush();
    },
    async reject(err) {
      const p = pending.shift()!;
      p.reject(err);
      await flush();
    },
    frame(type, data, o = {}) {
      const f = { v: 1, streamId: 'ws:local', ts: new Date().toISOString(), type, data, ...(o.opId ? { opId: o.opId } : {}), seq: ++seq } as unknown as Frame;
      for (const cb of listeners) cb(f, { live: o.live ?? true });
    },
    session: null as unknown as RoomSession,
    reconnect() {
      for (const cb of reconnects) cb();
    },
  };
  const deps: Partial<RoomSessionDeps> = {
    api: {
      roomSay: (_room, body) =>
        new Promise<RoomSayAccepted>((resolve, reject) => {
          says.push(body as RoomSayRequest);
          pending.push({ resolve, reject, body: body as RoomSayRequest });
        }),
      roomCancel: async (_room, body) => {
        cancels.push(body as RoomCancelRequest);
        return { cancelled: true, noteId: null };
      },
    },
    onFrame: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    speakerOf: (id) => {
      let s = speakers.get(id);
      if (!s) speakers.set(id, (s = new FakeSpeaker(id)));
      return s;
    },
    voice: () => h.voice,
    clipVoice: () => h.voice,
    now: () => Date.now(),
    schedule: (fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
    opId: () => `op_${++ops}`,
    meetingId: () => MEETING,
    setPttTarget: () => {
      h.ptt.set++;
      return () => h.ptt.restored++;
    },
    onReconnect: (cb) => {
      reconnects.add(cb);
      return () => reconnects.delete(cb);
    },
  };
  h.session = openRoomSession({ roomId, participants: () => opts.participants ?? [JUNO, WALT, LENA], onEvent: (e) => events.push(e), ptt: { label: 'the Skyline room' } }, deps);
  harnesses.push(h);
  return h;
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const room = { surface: 'room', roomId: 'skyline', meetingId: MEETING };
const delta = (h: Harness, agentId: string, messageId: string, text: string, turnId = 'turn_1') => h.frame('talk.delta', { turnId, messageId, agentId, delta: text, ...room });
const message = (h: Harness, agentId: string, messageId: string, text: string, turnId = 'turn_1', kind = 'reply') => h.frame('talk.message', { turnId, messageId, agentId, text, kind, ...room });
const done = (h: Harness, agentId: string, messageId: string | null, turnId = 'turn_1', finish = 'stop') => h.frame('talk.done', { turnId, messageId, agentId, finish, route: 'room', ...room });
const turn = (h: Harness, order: string[], state: 'running' | 'done' | 'cancelled' = 'running', turnId = 'turn_1') =>
  h.frame('room.turn', { roomId: 'skyline', meetingId: MEETING, turnId, gen: 1, order, next: order[0] ?? null, state });
/** A whole reply: its sentence, the persisted message and the end. */
const reply = (h: Harness, agentId: string, messageId: string, text: string, turnId = 'turn_1') => {
  delta(h, agentId, messageId, text, turnId);
  message(h, agentId, messageId, text, turnId);
  done(h, agentId, messageId, turnId);
};
const ofType = <T extends RoomEvent['type']>(h: Harness, type: T) => h.events.filter((e): e is Extract<RoomEvent, { type: T }> => e.type === type);
const starts = (h: Harness) => ofType(h, 'start').map((e) => e.agentId);
const lastQueue = (h: Harness) => ofType(h, 'queue').at(-1)?.queue;

/** Say something and let the 202 and the owner echo land. */
async function sayAndAccept(h: Harness, text: string, order: string[], turnId = 'turn_1') {
  const p = h.session.say(text, 'text');
  h.frame('talk.owner', { turnId, messageId: `msg_owner_${turnId}`, text, via: 'text', ...room }, { opId: h.says.at(-1)!.opId });
  await h.accept(order, turnId);
  await p;
}

beforeEach(() => {
  vi.useFakeTimers();
  harnesses = [];
});
afterEach(async () => {
  for (const h of harnesses) await h.session.close();
  vi.useRealTimers();
});

describe('room session: floor and playback', () => {
  it('the 202 order becomes the floor queue, which shrinks as each responder starts', async () => {
    const h = harness();
    await sayAndAccept(h, 'What do you all think?', [JUNO, WALT, LENA]);
    expect(h.says[0]).toMatchObject({ text: 'What do you all think?', meetingId: MEETING, participants: [JUNO, WALT, LENA], via: 'text' });
    expect(ofType(h, 'owner')).toEqual([{ type: 'owner', text: 'What do you all think?', via: 'text' }]);
    expect(ofType(h, 'order')[0]).toMatchObject({ order: [JUNO, WALT, LENA], mode: 'group' });
    expect(lastQueue(h)).toEqual([JUNO, WALT, LENA]);
    reply(h, JUNO, 'msg_j', 'Lead with sell-through.');
    await flush();
    expect(starts(h)).toEqual([JUNO]);
    expect(lastQueue(h)).toEqual([WALT, LENA]);
  });

  it('plays lines strictly in server order, one at a time, with at most two lines of TTS ahead', async () => {
    const h = harness({ participants: [JUNO, WALT, LENA, CHIEF] });
    await sayAndAccept(h, 'Thoughts?', [JUNO, WALT, LENA, CHIEF]);
    // The server writes all four at machine speed.
    reply(h, JUNO, 'msg_1', 'One idea.');
    reply(h, WALT, 'msg_2', 'Another.');
    reply(h, LENA, 'msg_3', 'A third.');
    reply(h, CHIEF, 'msg_4', 'So: pilot it.');
    turn(h, [], 'done');
    await flush();
    const fed = () => [...h.speakers.values()].flatMap((s) => s.fed);
    // Playing line 0; lines 1 and 2 are loading behind their gates; line 3 waits.
    expect(fed().sort()).toEqual(['msg_1', 'msg_2', 'msg_3']);
    expect(LOOKAHEAD_LINES).toBe(2);
    expect(starts(h)).toEqual([JUNO]);
    expect(h.speakers.get(WALT)!.sounding).toBeNull(); // gated: never overlaps Juno
    h.speakers.get(JUNO)!.play('msg_1');
    await flush();
    expect(fed()).toContain('msg_4'); // the window moved
    expect(starts(h)).toEqual([JUNO]); // the gap between speakers
    await vi.advanceTimersByTimeAsync(SPEAKER_GAP_MS);
    expect(starts(h)).toEqual([JUNO, WALT]);
    expect(h.speakers.get(LENA)!.sounding).toBeNull();
    h.speakers.get(WALT)!.play('msg_2');
    await vi.advanceTimersByTimeAsync(SPEAKER_GAP_MS);
    h.speakers.get(LENA)!.play('msg_3');
    await vi.advanceTimersByTimeAsync(SPEAKER_GAP_MS);
    expect(starts(h)).toEqual([JUNO, WALT, LENA, CHIEF]);
    expect(ofType(h, 'idle')).toHaveLength(0);
    h.speakers.get(CHIEF)!.play('msg_4');
    await flush();
    expect(ofType(h, 'idle')).toHaveLength(1);
    expect(h.session.lines().map((l) => [l.agentId, l.heard])).toEqual([
      ['owner', true],
      [JUNO, true],
      [WALT, true],
      [LENA, true],
      [CHIEF, true],
    ]);
  });

  it('a streaming line updates its caption; the voiced start carries no tag', async () => {
    const h = harness();
    await sayAndAccept(h, 'Hope, what do you think?', [JUNO]);
    delta(h, JUNO, 'msg_1', 'I would test it. ');
    await flush();
    expect(ofType(h, 'start')[0]).toMatchObject({ agentId: JUNO, voiced: true, notVoicedTag: false });
    delta(h, JUNO, 'msg_1', 'Small group first.');
    expect(ofType(h, 'line').at(-1)).toMatchObject({ messageId: 'msg_1', text: 'I would test it. Small group first.', final: false });
    expect(h.speakers.get(JUNO)!.text.get('msg_1')).toBe('I would test it. Small group first.');
  });

  it('a second say hushes the room: speakers stop, the queue empties, and the new order replaces it', async () => {
    const h = harness();
    await sayAndAccept(h, 'What do you all think?', [JUNO, WALT, LENA]);
    reply(h, JUNO, 'msg_1', 'One idea.');
    reply(h, WALT, 'msg_2', 'Another.');
    await flush();
    expect(starts(h)).toEqual([JUNO]);
    const p = h.session.say('Actually, just Lena.', 'text');
    expect(h.speakers.get(JUNO)!.stops).toBe(1);
    expect(h.speakers.get(WALT)!.stops).toBe(1);
    expect(lastQueue(h)).toEqual([]);
    // No cancel for a new say: the server cancels the running turn itself when it accepts the new one.
    expect(h.cancels).toEqual([]);
    // Late frames of the old turn never play.
    reply(h, LENA, 'msg_3', 'Late line.');
    h.frame('talk.owner', { turnId: 'turn_2', messageId: 'msg_o2', text: 'Actually, just Lena.', via: 'text', ...room }, { opId: h.says[1]!.opId });
    await h.accept([LENA], 'turn_2', 'mention');
    await p;
    expect(lastQueue(h)).toEqual([LENA]);
    reply(h, LENA, 'msg_4', 'Here is my take.', 'turn_2');
    await flush();
    expect(starts(h)).toEqual([JUNO, LENA]);
    expect(ofType(h, 'start').at(-1)!.messageId).toBe('msg_4');
    // Walt's line was generated but never played: it stays in the transcript, not heard.
    expect(h.session.lines().find((l) => l.agentId === WALT)).toMatchObject({ text: 'Another.', heard: false });
  });

  it('hush stops every room speaker at once and posts cancel', async () => {
    const h = harness();
    await sayAndAccept(h, 'Thoughts?', [JUNO, WALT]);
    reply(h, JUNO, 'msg_1', 'One idea.');
    turn(h, [WALT]);
    await flush();
    h.session.hush();
    expect(h.speakers.get(JUNO)!.stops).toBe(1);
    expect(lastQueue(h)).toEqual([]);
    expect(ofType(h, 'end').map((e) => e.messageId)).toEqual(['msg_1']);
    // The cut line's caption clears like a finished turn's.
    expect(ofType(h, 'idle')).toHaveLength(1);
    await flush();
    expect(h.cancels).toHaveLength(1);
    expect(h.cancels[0]).toMatchObject({ meetingId: MEETING });
    expect(h.cancels[0]!.leave).toBeUndefined();
    // Walt's reply, still arriving, is not played.
    reply(h, WALT, 'msg_2', 'Late.');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts(h)).toEqual([JUNO]);
  });

  it('a barge-in or a leave while the say is still on its way reaches the server after it; a newer say drops the cancel', async () => {
    const h = harness();
    const p = h.session.say('Thoughts?', 'text');
    h.session.hush();
    await flush();
    // Not before the say: the server would find no turn to cancel and then run the whole turn.
    expect(h.cancels).toEqual([]);
    await h.accept([JUNO], 'turn_1');
    await p;
    await flush();
    expect(h.cancels).toHaveLength(1);
    // Hush while a say is pending, then say again at once: the new say takes over, so no cancel follows the first.
    const p2 = h.session.say('One more?', 'text');
    h.session.hush();
    const p3 = h.session.say('Actually, Lena?', 'text');
    await h.accept([JUNO], 'turn_2');
    await p2;
    await flush();
    expect(h.cancels).toHaveLength(1);
    await h.accept([LENA], 'turn_3');
    await p3;
    await flush();
    expect(h.cancels).toHaveLength(1);
    const p4 = h.session.say('Last one.', 'text');
    // Leaving with a say in flight: the leave (and its note) comes after it.
    const closing = h.session.close({ leave: true });
    await flush();
    expect(h.cancels).toHaveLength(1);
    await h.accept([LENA], 'turn_4');
    await p4;
    await closing;
    expect(h.cancels).toHaveLength(2);
    expect(h.cancels[1]).toMatchObject({ leave: true });
  });

  it('after the feed socket comes back, replayed lines finish the turn; a turn that says nothing more ends by itself', async () => {
    h0: {
      const h = harness({ participants: [JUNO, WALT] });
      await sayAndAccept(h, 'Thoughts?', [JUNO, WALT]);
      turn(h, [JUNO, WALT]);
      h.voice = { voiced: false, notVoicedTag: true };
      delta(h, JUNO, 'msg_1', 'One idea. ');
      await flush();
      expect(starts(h)).toEqual([JUNO]);
      // The socket drops: the rest of Juno's line and Walt's whole reply are saved meanwhile, then replayed.
      h.reconnect();
      h.frame('talk.message', { turnId: 'turn_1', messageId: 'msg_1', agentId: JUNO, text: 'One idea. Keep it small.', kind: 'reply', ...room }, { live: false });
      h.frame('talk.done', { turnId: 'turn_1', messageId: 'msg_1', agentId: JUNO, finish: 'stop', route: 'room', ...room }, { live: false });
      h.frame('talk.message', { turnId: 'turn_1', messageId: 'msg_2', agentId: WALT, text: 'Agreed.', kind: 'reply', ...room }, { live: false });
      h.frame('talk.done', { turnId: 'turn_1', messageId: 'msg_2', agentId: WALT, finish: 'stop', route: 'room', ...room }, { live: false });
      await vi.advanceTimersByTimeAsync(readingMs('One idea. Keep it small.') + SPEAKER_GAP_MS + readingMs('Agreed.') + 50);
      expect(starts(h)).toEqual([JUNO, WALT]);
      expect(ofType(h, 'idle')).toHaveLength(1);
      break h0;
    }
    // The turn ended while the socket was down with a line still streaming here: it ends where it is, and the room is idle.
    const h = harness({ participants: [JUNO, WALT] });
    await sayAndAccept(h, 'Thoughts?', [JUNO, WALT]);
    turn(h, [JUNO, WALT]);
    h.voice = { voiced: false, notVoicedTag: true };
    delta(h, JUNO, 'msg_1', 'One idea. ');
    await flush();
    h.reconnect();
    await vi.advanceTimersByTimeAsync(RECONNECT_SETTLE_MS + readingMs('One idea. ') + 50);
    expect(ofType(h, 'end').map((e) => e.messageId)).toEqual(['msg_1']);
    expect(ofType(h, 'idle')).toHaveLength(1);
    expect(lastQueue(h)).toEqual([]);
  });

  it('close posts cancel {leave: true} once, with who was there, stops and restores push-to-talk', async () => {
    const h = harness();
    expect(h.ptt.set).toBe(1);
    await sayAndAccept(h, 'Hi all', [JUNO]);
    reply(h, JUNO, 'msg_1', 'Morning.');
    await flush();
    const a = h.session.close({ leave: true });
    const b = h.session.close({ leave: true });
    await Promise.all([a, b]);
    expect(h.cancels).toHaveLength(1);
    expect(h.cancels[0]).toMatchObject({ leave: true, meetingId: MEETING, participants: [JUNO, WALT, LENA] });
    expect(h.speakers.get(JUNO)!.stops).toBe(1);
    expect(h.ptt.restored).toBe(1);
    const before = h.events.length;
    reply(h, WALT, 'msg_2', 'After you left.');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.events.length).toBe(before);
  });

  it('ignores other meetings, other rooms and replayed history', async () => {
    const h = harness();
    await sayAndAccept(h, 'Thoughts?', [JUNO]);
    h.frame('talk.delta', { turnId: 'turn_1', messageId: 'msg_x', agentId: JUNO, delta: 'Other tab.', surface: 'room', roomId: 'skyline', meetingId: OTHER_MEETING });
    h.frame('talk.delta', { turnId: 'turn_1', messageId: 'msg_y', agentId: JUNO, delta: 'Other room.', surface: 'room', roomId: 'garden', meetingId: MEETING });
    h.frame('talk.delta', { turnId: 'turn_1', messageId: 'msg_z', agentId: JUNO, delta: 'A quick chat.', surface: 'floor' });
    h.frame('talk.delta', { turnId: 'turn_1', messageId: 'msg_r', agentId: JUNO, delta: 'Replayed.', ...room }, { live: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ofType(h, 'start')).toEqual([]);
    expect(ofType(h, 'line')).toEqual([]);
    expect([...h.speakers.values()].flatMap((s) => s.fed)).toEqual([]);
  });

  it('a failed say is one error sentence; not configured names the fix', async () => {
    const h = harness();
    const p = h.session.say('Thoughts?', 'text');
    await h.reject(new ApiError(503, 'not_configured', 'No chat provider.', ['ANTHROPIC_API_KEY']));
    await p;
    expect(ofType(h, 'error')).toEqual([{ type: 'error', message: 'Add a provider key or start Ollama to talk to the room.' }]);
    const q = h.session.say('Again?', 'text');
    await h.reject(new ApiError(429, 'rate_limited', 'That is a lot of room talk right now. Wait a minute and ask again.'));
    await q;
    expect(ofType(h, 'error').at(-1)!.message).toBe('That is a lot of room talk right now. Wait a minute and ask again.');
    const r = h.session.say('Again?', 'text');
    await h.reject(new TypeError('fetch failed'));
    await r;
    expect(ofType(h, 'error').at(-1)!.message).toBe('Could not reach them. Try again.');
  });

  it('an error frame of this turn reaches the dock', async () => {
    const h = harness();
    await sayAndAccept(h, 'Thoughts?', [JUNO, WALT]);
    h.frame('error', { code: 'rate_limited', message: 'That is a lot of room talk right now. Wait a minute and ask again.', turnId: 'turn_1' });
    h.frame('error', { code: 'internal', message: 'Something else.', turnId: 'turn_other' });
    expect(ofType(h, 'error').map((e) => e.message)).toEqual(['That is a lot of room talk right now. Wait a minute and ask again.']);
  });

  it('nobody at the table: nothing is sent', async () => {
    const h = harness({ participants: [] });
    await h.session.say('Hello?', 'text');
    expect(h.says).toEqual([]);
    expect(ofType(h, 'error')[0]!.message).toBe('Invite someone to the table first.');
  });

  it('a skipped responder (failed reply) and a dropped wrap-up leave the queue', async () => {
    const h = harness();
    await sayAndAccept(h, 'Thoughts?', [JUNO, WALT, CHIEF]);
    done(h, JUNO, null, 'turn_1', 'error');
    turn(h, [WALT, CHIEF]);
    expect(lastQueue(h)).toEqual([WALT, CHIEF]);
    reply(h, WALT, 'msg_2', 'Only me then.');
    turn(h, [], 'done');
    await flush();
    expect(lastQueue(h)).toEqual([]);
    h.speakers.get(WALT)!.play('msg_2');
    await flush();
    expect(ofType(h, 'idle')).toHaveLength(1);
  });
});

describe('room session: who may voice', () => {
  it('a tab without the voice feeds no speaker: captions with no tag, paced for reading', async () => {
    const h = harness();
    h.voice = { voiced: false, notVoicedTag: false };
    await sayAndAccept(h, 'Thoughts?', [JUNO, WALT]);
    reply(h, JUNO, 'msg_1', 'Lead with sell-through, not brand love.');
    reply(h, WALT, 'msg_2', 'Agreed.');
    turn(h, [], 'done');
    await flush();
    expect([...h.speakers.values()].flatMap((s) => s.fed)).toEqual([]);
    expect(ofType(h, 'start')[0]).toMatchObject({ agentId: JUNO, voiced: false, notVoicedTag: false });
    await vi.advanceTimersByTimeAsync(readingMs('Lead with sell-through, not brand love.') - 1);
    expect(starts(h)).toEqual([JUNO]);
    await vi.advanceTimersByTimeAsync(1 + SPEAKER_GAP_MS);
    expect(starts(h)).toEqual([JUNO, WALT]);
    await vi.advanceTimersByTimeAsync(readingMs('Agreed.'));
    expect(ofType(h, 'idle')).toHaveLength(1);
  });

  it('keyless or voice off: NOT VOICED and reading-time pacing', async () => {
    const h = harness();
    h.voice = { voiced: false, notVoicedTag: true };
    await sayAndAccept(h, 'Thoughts?', [JUNO]);
    reply(h, JUNO, 'msg_1', 'Short.');
    await flush();
    expect(ofType(h, 'start')[0]).toMatchObject({ voiced: false, notVoicedTag: true });
    expect(readingMs('Short.')).toBe(2200);
    expect(readingMs('x'.repeat(500))).toBe(6000);
    await vi.advanceTimersByTimeAsync(2199);
    expect(ofType(h, 'end')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(ofType(h, 'end')).toHaveLength(1);
  });

  it('the voice moves away between look-ahead and start: that line is silenced and shown as text', async () => {
    const h = harness();
    await sayAndAccept(h, 'Thoughts?', [JUNO, WALT]);
    reply(h, JUNO, 'msg_1', 'One.');
    reply(h, WALT, 'msg_2', 'Two.');
    await flush();
    expect(h.speakers.get(WALT)!.fed).toEqual(['msg_2']);
    h.voice = { voiced: false, notVoicedTag: false }; // another tab took the voice (claim unsettled, or moved)
    h.speakers.get(JUNO)!.play('msg_1');
    await vi.advanceTimersByTimeAsync(SPEAKER_GAP_MS);
    expect(ofType(h, 'start')[1]).toMatchObject({ agentId: WALT, voiced: false, notVoicedTag: false });
    expect(h.speakers.get(WALT)!.stops).toBe(1);
    expect(h.speakers.get(WALT)!.sounding).toBeNull();
  });

  it('a line stopped by losing the voice before it sounded is shown as text, and the room goes on', async () => {
    const h = harness();
    await sayAndAccept(h, 'Thoughts?', [JUNO, WALT]);
    reply(h, JUNO, 'msg_1', 'One.');
    await flush();
    // silenceHere: every speaker stops.
    h.speakers.get(JUNO)!.stop();
    reply(h, WALT, 'msg_2', 'Two.');
    await flush();
    h.voice = { voiced: false, notVoicedTag: false };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts(h)).toEqual([JUNO, WALT]);
  });

  it('a voiced line that never starts sounding falls back to text', async () => {
    const h = harness();
    await sayAndAccept(h, 'Thoughts?', [JUNO]);
    // No gate release reaches the engine: simulate by stubbing the speaker to never report a start.
    const sp = new FakeSpeaker(JUNO);
    sp.observe = () => () => undefined;
    h.speakers.set(JUNO, sp);
    reply(h, JUNO, 'msg_1', 'One.');
    await flush();
    expect(ofType(h, 'start')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(START_STALL_MS);
    expect(ofType(h, 'start')[0]).toMatchObject({ voiced: false });
    expect(sp.stops).toBe(1);
  });

  it('a catalog reply with its own clip (reflex.say) is not synthesised a second time', async () => {
    const h = harness();
    await sayAndAccept(h, 'hi everyone', [JUNO, WALT]);
    message(h, JUNO, 'msg_1', 'Morning.', 'turn_1', 'reflex');
    h.frame('reflex.say', { agentId: JUNO, turnId: 'turn_1', audience: 'room', clip: { key: 'k', url: 'u', durationMs: 700, alignmentUrl: null }, caption: 'Morning.' });
    message(h, WALT, 'msg_2', 'Hey.', 'turn_1', 'reflex');
    await vi.advanceTimersByTimeAsync(REFLEX_GRACE_MS);
    expect(h.speakers.get(JUNO)?.fed ?? []).toEqual([]);
    expect(ofType(h, 'start')[0]).toMatchObject({ agentId: JUNO, voiced: true, notVoicedTag: false });
    // Walt's reply came with no clip: voiced here.
    await vi.advanceTimersByTimeAsync(readingMs('Morning.') + SPEAKER_GAP_MS);
    expect(h.speakers.get(WALT)!.fed).toEqual(['msg_2']);
  });
});

describe('room voice verdict (one voice per workspace)', () => {
  const caps = (tts: boolean) =>
    ({ providers: [], defaultChat: null, modalities: { chat: { available: true, provider: 'mock', missingKeys: [] }, tts: { available: tts, provider: tts ? 'openai' : null, missingKeys: [] }, stt: { available: false, provider: null, missingKeys: [] }, image: { available: false, provider: null, missingKeys: [] } } }) as never;

  beforeEach(() => {
    vi.useRealTimers();
    resetVoiceOwner();
    navigate(paths.floor);
    settings.value = { workspaceId: 'local', leadId: 'lead-warm-mentor', chiefName: null, voiceOn: true, updatedAt: 'x' };
    capabilities.value = caps(true);
  });
  afterEach(() => {
    resetVoiceOwner();
    capabilities.value = null;
  });

  it('voiced only with voice on, provider TTS and the voice in this tab', () => {
    expect(roomVoice()).toEqual({ voiced: true, notVoicedTag: false });
    applyServerVoice({ clientId: 'cOTHERTAB0000000', reason: 'claim', at: Date.now() });
    // Another tab has the voice: captions here, with no NOT VOICED tag.
    expect(roomVoice()).toEqual({ voiced: false, notVoicedTag: false });
    applyServerVoice({ clientId: clientId(), reason: 'claim', at: Date.now() });
    expect(roomVoice().voiced).toBe(true);
  });

  it('a claim still on its way (another device may be voicing) keeps this tab to text', () => {
    applyServerVoice({ clientId: 'cOTHERTAB0000000', reason: 'claim', at: Date.now() });
    claimVoice();
    expect(roomVoice()).toEqual({ voiced: false, notVoicedTag: false });
    expect(roomClipVoice().voiced).toBe(false);
  });

  it('keyless or voice off: NOT VOICED (no browser voice in rooms)', () => {
    capabilities.value = caps(false);
    expect(roomVoice()).toEqual({ voiced: false, notVoicedTag: true });
    capabilities.value = caps(true);
    settings.value = { ...settings.value!, voiceOn: false };
    expect(roomVoice()).toEqual({ voiced: false, notVoicedTag: true });
  });
});
