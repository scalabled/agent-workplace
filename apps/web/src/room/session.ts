// One meeting in an office room or a joined huddle (OFFICE-PHASE2 §4.4.1), shared by the conference stage and the
// huddle chat. The writer reads this meeting's frames from the owner feed (talk.* with `surface: 'room'`, this room and
// meeting; `room.turn`; errors of its turns); the player voices the lines in server order; the owner's words go to
// POST /api/rooms/:roomId/say, and a barge-in or leaving to /cancel (sent after the say it interrupts, so the server
// never runs a turn the owner already stopped). Frames of other meetings (other tabs included) are ignored, and so is
// replayed history, except this turn's persisted lines and ends replayed after the feed socket came back (what finished
// while it was down); a turn that says nothing more after a reconnect ends by itself.
import { CHIEF_ID, ids, type AgentId, type Frame } from '@headcount/protocol';
import { newMeetingId, ROOM_SAY_MAX_CHARS, roomKindOf, type FloorMode, type RoomCancelRequest, type RoomCancelResponse, type RoomId, type RoomSayAccepted, type RoomSayRequest } from '@headcount/protocol/ext/rooms';
import { api, ApiError } from '../api/client';
import { can, feedEpoch, onFrame, settings, type FrameInfo } from '../store';
import { chiefSpeaker } from '../voice/chief-voice';
import { claimUnsettled, mayVoice } from '../voice/owner';
import { setPttTarget } from '../voice/ptt';
import { sideSpeaker } from '../voice/side-voice';
import { RoomPlayer, type PlayerLine, type RoomSpeaker, type VoiceVerdict } from './player';

export type RoomEvent =
  | { type: 'owner'; text: string; via: 'text' | 'voice' }
  | { type: 'order'; order: string[]; mode: FloorMode }
  /** Planned responders not yet started; shrinks. */
  | { type: 'queue'; queue: string[] }
  /** Streamed text. */
  | { type: 'line'; agentId: string; messageId: string; text: string; final: boolean }
  | { type: 'start'; agentId: string; messageId: string; text: string; voiced: boolean; notVoicedTag: boolean }
  | { type: 'end'; agentId: string; messageId: string }
  /** Everything said, turn over. */
  | { type: 'idle' }
  /** One sentence with its fix. */
  | { type: 'error'; message: string };

export interface RoomSessionOptions {
  roomId: RoomId;
  /** Read at every say (the scene is the source of truth). */
  participants: () => readonly string[];
  /** Huddles: the place ("water cooler"). */
  label?: string;
  onEvent(e: RoomEvent): void;
  /**
   * Push-to-talk goes to this meeting while it is open (`label`: "the Skyline room", "Kate and Pax"); close() restores
   * the previous target. Leave it out when the host sets its own target (the joined huddle does).
   */
  ptt?: { label: string };
}

export interface RoomTranscriptLine {
  agentId: string | 'owner';
  text: string;
  at: number;
  /** Played (or shown for its reading time). Lines cut by a barge-in before their turn stay here, not heard. */
  heard: boolean;
}

export interface RoomSession {
  readonly roomId: RoomId;
  readonly meetingId: string;
  /** Hushes first; POST say; errors → 'error'. */
  say(text: string, via: 'text' | 'voice'): Promise<void>;
  /** Barge-in: stop audio now, drop the queue, POST cancel. */
  hush(): void;
  /** Stop, POST cancel {leave}; idempotent. `participants`: who was there (the scene may have cleared them already). */
  close(opts?: { leave?: boolean; participants?: readonly string[] }): Promise<void>;
  /** The transcript: the owner's lines and every responder line, heard or not. */
  lines(): readonly RoomTranscriptLine[];
  /** Who was at the table at the last say (or the last non-empty read). */
  participants(): readonly string[];
}

export interface RoomSessionDeps {
  api: {
    roomSay(roomId: RoomId, body: Omit<RoomSayRequest, 'clientId'>): Promise<RoomSayAccepted>;
    roomCancel(roomId: RoomId, body: Omit<RoomCancelRequest, 'clientId'>): Promise<RoomCancelResponse>;
  };
  onFrame(cb: (frame: Frame, info: FrameInfo) => void): () => void;
  speakerOf(agentId: string): RoomSpeaker | null;
  voice(): VoiceVerdict;
  clipVoice(): VoiceVerdict;
  now(): number;
  schedule(fn: () => void, ms: number): () => void;
  opId(): string;
  meetingId(): string;
  setPttTarget: typeof setPttTarget;
  /** The feed socket came back (a new `ready`): `cb` runs once per reconnect. Returns the unsubscribe. */
  onReconnect(cb: () => void): () => void;
}

/** After a reconnect, a turn that sends nothing more for this long is over (its `room.turn` word may be lost). */
export const RECONNECT_SETTLE_MS = 6000;

/** Synthesised room lines: voice on, this tab has the voice (its claim settled), and provider TTS (keyless: captions). */
export function roomVoice(): VoiceVerdict {
  const voiceOn = settings.value?.voiceOn ?? false;
  const tts = can('tts');
  return { voiced: voiceOn && tts && mayVoice() && !claimUnsettled(), notVoicedTag: !voiceOn || !tts };
}

/** Lines the living runtime voices from their pre-voiced clip. */
export function roomClipVoice(): VoiceVerdict {
  const voiceOn = settings.value?.voiceOn ?? false;
  return { voiced: voiceOn && mayVoice() && !claimUnsettled(), notVoicedTag: !voiceOn || !can('tts') };
}

const defaultDeps = (): RoomSessionDeps => ({
  api,
  onFrame,
  speakerOf: (agentId) => (agentId === CHIEF_ID ? chiefSpeaker : sideSpeaker(agentId)),
  voice: roomVoice,
  clipVoice: roomClipVoice,
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  opId: () => ids.op(),
  meetingId: () => newMeetingId(),
  setPttTarget,
  onReconnect: (cb) => {
    let epoch = feedEpoch.peek();
    return feedEpoch.subscribe((e) => {
      if (e === epoch) return;
      epoch = e;
      cb();
    });
  },
});

/** One sentence with its fix for a failed say (EXPERIENCE §10.8). */
export function roomErrorSentence(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'not_configured') return 'Add a provider key or start Ollama to talk to the room.';
    if (err.message) return err.message;
  }
  return 'Could not reach them. Try again.';
}

type RoomTalkData = { surface?: string; roomId?: string; meetingId?: string };

export function openRoomSession(o: RoomSessionOptions, overrides: Partial<RoomSessionDeps> = {}): RoomSession {
  const deps: RoomSessionDeps = { ...defaultDeps(), ...overrides };
  const roomId = o.roomId;
  const meetingId = deps.meetingId();
  const huddle = roomKindOf(roomId) === 'huddle';

  let closed = false;
  let closing: Promise<void> | null = null;
  /** The say whose turn plays now, and that turn once known (its talk.owner echo, or the 202). */
  let currentOp: string | null = null;
  let currentTurn: string | null = null;
  /** Turns superseded here (a new say, a barge-in): their late frames are never played. */
  const dead = new Set<string>();
  let planned: string[] = [];
  /** Responders the server has not finished (room.turn), or null before it said. */
  let serverLeft: string[] | null = null;
  let serverOver = true;
  /** Agents with a line (or a finished reply) in this turn. */
  const turnAgents = new Set<string>();
  const doneAgents = new Set<string>();
  let lastQueue = '';
  let lastParticipants: readonly string[] = [];
  /** The say in flight (settled either way): a cancel waits for it, so it never reaches the server first. */
  let inflight: Promise<void> = Promise.resolve();
  /** Counts says: a cancel chained behind one say is dropped when a newer say took over (the server cancels then). */
  let sayGen = 0;
  let cancelSettle: (() => void) | null = null;
  const transcript: (RoomTranscriptLine & { messageId?: string })[] = [];
  const byMessage = new Map<string, RoomTranscriptLine & { messageId?: string }>();

  const emit = (e: RoomEvent) => {
    if (closed) return;
    try {
      o.onEvent(e);
    } catch (err) {
      console.error('room event failed', err);
    }
  };

  const noteLine = (l: PlayerLine) => {
    let t = byMessage.get(l.messageId);
    if (!t) {
      t = { agentId: l.agentId, text: l.text, at: deps.now(), heard: l.heard, messageId: l.messageId };
      transcript.push(t);
      byMessage.set(l.messageId, t);
    }
    t.text = l.text;
    t.heard = t.heard || l.heard;
  };

  const emitQueue = (force = false) => {
    const waiting = player.waiting();
    const rest = (serverLeft ?? planned).filter((a) => !turnAgents.has(a) && !doneAgents.has(a) && !waiting.includes(a));
    const queue = [...waiting, ...rest];
    const key = queue.join(',');
    if (!force && key === lastQueue) return;
    lastQueue = key;
    emit({ type: 'queue', queue });
  };

  const player = new RoomPlayer(
    { speakerOf: deps.speakerOf, voice: deps.voice, clipVoice: deps.clipVoice, now: deps.now, schedule: deps.schedule },
    {
      onStart: (l, voiced, notVoicedTag) => {
        noteLine(l);
        emit({ type: 'start', agentId: l.agentId, messageId: l.messageId, text: l.text, voiced, notVoicedTag });
        emitQueue();
      },
      onText: (l) => {
        noteLine(l);
        emit({ type: 'line', agentId: l.agentId, messageId: l.messageId, text: l.text, final: l.final });
      },
      onEnd: (l) => emit({ type: 'end', agentId: l.agentId, messageId: l.messageId }),
      onIdle: () => emit({ type: 'idle' }),
      onChange: () => emitQueue(),
    },
  );

  const mine = (d: RoomTalkData) => d.surface === 'room' && d.roomId === roomId && d.meetingId === meetingId;

  /** Is this the turn that plays now? A turn first seen while a say waits for its echo becomes it. */
  const isCurrent = (turnId: string): boolean => {
    if (turnId === currentTurn) return true;
    if (currentTurn === null && currentOp !== null && !dead.has(turnId)) {
      currentTurn = turnId;
      return true;
    }
    return false;
  };

  /** Without a `room.turn` word (an older server, a lost frame), the turn is over once every planned responder is done. */
  const checkOver = () => {
    if (serverOver || serverLeft !== null || !planned.length || !planned.every((a) => doneAgents.has(a))) return;
    serverOver = true;
    player.turnOver();
  };

  /** After a reconnect: end the turn if nothing more of it arrives (lines still streaming end where they are). */
  const settleLater = () => {
    cancelSettle?.();
    cancelSettle = deps.schedule(() => {
      cancelSettle = null;
      if (closed || serverOver) return;
      player.failOpen();
      serverOver = true;
      serverLeft = [];
      player.turnOver();
      emitQueue(true);
    }, RECONNECT_SETTLE_MS);
  };
  /** A frame of the current turn arrived: a pending reconnect settle waits again. */
  const touched = () => {
    if (cancelSettle) settleLater();
  };

  const onFeed = (f: Frame, info: FrameInfo) => {
    if (closed) return;
    if (!info.live) {
      // Replayed after the socket came back: this turn's persisted lines and ends still land (their deltas are lost).
      if (f.type !== 'talk.message' && f.type !== 'talk.done') return;
      if (!mine(f.data) || !f.data.turnId || f.data.turnId !== currentTurn) return;
    }
    switch (f.type) {
      case 'talk.owner':
        if (!mine(f.data)) return;
        if (!f.opId) isCurrent(f.data.turnId);
        else if (f.opId === currentOp) currentTurn = f.data.turnId;
        else if (f.data.turnId !== currentTurn) dead.add(f.data.turnId);
        return;
      case 'talk.delta':
        if (!mine(f.data) || !isCurrent(f.data.turnId)) return;
        touched();
        turnAgents.add(f.data.agentId);
        player.append(f.data.agentId, f.data.messageId, f.data.delta);
        return;
      case 'talk.message':
        if (!mine(f.data) || !f.data.turnId || !isCurrent(f.data.turnId)) return;
        if (f.data.kind !== 'reply' && f.data.kind !== 'reflex' && f.data.kind !== 'status') return;
        touched();
        turnAgents.add(f.data.agentId);
        player.finish(f.data.agentId, f.data.messageId, f.data.text, { reflex: f.data.kind === 'reflex' });
        return;
      case 'talk.done': {
        if (!mine(f.data) || !isCurrent(f.data.turnId) || !f.data.agentId) return;
        const agentId = f.data.agentId;
        touched();
        doneAgents.add(agentId);
        if (!f.data.messageId || f.data.finish === 'error' || f.data.finish === 'cancelled') player.fail(agentId, f.data.messageId);
        emitQueue();
        checkOver();
        return;
      }
      case 'room.turn': {
        const d = f.data;
        if (d.roomId !== roomId || d.meetingId !== meetingId || !isCurrent(d.turnId)) return;
        touched();
        serverLeft = [...d.order];
        if (d.state !== 'running') {
          serverLeft = [];
          serverOver = true;
          player.turnOver();
        }
        emitQueue();
        return;
      }
      case 'reflex.say': {
        const d = f.data;
        if (!d.turnId || d.turnId !== currentTurn || d.audience !== 'room') return;
        player.clip(d.agentId, d.clip?.durationMs ?? null);
        return;
      }
      case 'error': {
        const d = f.data;
        if ((d.turnId && d.turnId === currentTurn) || (d.opId && d.opId === currentOp)) emit({ type: 'error', message: d.message });
        return;
      }
      default:
        return;
    }
  };
  const unsubscribe = deps.onFrame(onFeed);
  // The feed socket came back: `room.turn` words and deltas sent meanwhile are lost. The planned order decides again
  // when the turn is over (from the replayed ends), and a turn that says nothing more ends by itself.
  const unReconnect = deps.onReconnect(() => {
    if (closed || serverOver) return;
    serverLeft = null;
    settleLater();
  });

  /** Stop what plays here and forget the turn (a new say, a barge-in, leaving). */
  const hushLocal = () => {
    if (currentTurn) dead.add(currentTurn);
    currentTurn = null;
    currentOp = null;
    planned = [];
    serverLeft = null;
    cancelSettle?.();
    cancelSettle = null;
    turnAgents.clear();
    doneAgents.clear();
    player.hush();
    lastQueue = '';
    emitQueue(true);
  };

  const readParticipants = (): string[] => {
    let list: readonly string[] = [];
    try {
      list = o.participants();
    } catch {
      list = [];
    }
    if (list.length) lastParticipants = [...list];
    return [...list];
  };

  const session: RoomSession = {
    roomId,
    meetingId,
    async say(text, via) {
      const t = text.trim();
      if (closed || !t) return;
      if (t.length > ROOM_SAY_MAX_CHARS) {
        emit({ type: 'error', message: `Keep messages under ${ROOM_SAY_MAX_CHARS.toLocaleString()} characters.` });
        return;
      }
      const participants = readParticipants();
      if (!participants.length) {
        emit({ type: 'error', message: huddle ? 'Everyone has gone back to their desks.' : 'Invite someone to the table first.' });
        return;
      }
      // A new say is a barge-in: the room stops now and the new question takes the floor (the server cancels the
      // running turn itself when it accepts this one).
      hushLocal();
      const opId = deps.opId();
      currentOp = opId;
      serverOver = false;
      player.beginTurn();
      transcript.push({ agentId: 'owner', text: t, at: deps.now(), heard: true });
      emit({ type: 'owner', text: t, via });
      sayGen++;
      let accepted: RoomSayAccepted;
      try {
        const req = deps.api.roomSay(roomId, { text: t, opId, meetingId, participants: participants as AgentId[], via, ...(o.label ? { label: o.label } : {}) });
        inflight = req.then(
          () => undefined,
          () => undefined,
        );
        accepted = await req;
      } catch (err) {
        if (currentOp !== opId || closed) return;
        currentOp = null;
        serverOver = true;
        player.turnOver();
        emit({ type: 'error', message: roomErrorSentence(err) });
        return;
      }
      if (currentOp !== opId || closed) {
        // A newer say (or a barge-in) came first: this turn never plays.
        dead.add(accepted.turnId);
        if (currentTurn === accepted.turnId) currentTurn = null;
        return;
      }
      if (currentTurn && currentTurn !== accepted.turnId) dead.add(currentTurn);
      currentTurn = accepted.turnId;
      planned = [...accepted.order];
      emit({ type: 'order', order: [...accepted.order], mode: accepted.mode });
      emitQueue(true);
      checkOver();
    },
    hush() {
      if (closed) return;
      const running = !serverOver && (currentOp !== null || currentTurn !== null);
      hushLocal();
      serverOver = true;
      if (running) {
        // After the say it interrupts has reached the server; dropped if a newer say takes over meanwhile.
        const gen = sayGen;
        const opId = deps.opId();
        void inflight.then(() => (gen === sayGen ? deps.api.roomCancel(roomId, { opId, meetingId }) : undefined)).catch(() => undefined);
      }
    },
    close(opts = {}) {
      if (closing) return closing;
      const leave = opts.leave ?? true;
      const participants = opts.participants?.length ? [...opts.participants] : [...lastParticipants];
      hushLocal();
      closed = true;
      unsubscribe();
      unReconnect();
      player.destroy();
      restorePtt?.();
      restorePtt = null;
      const body: Omit<RoomCancelRequest, 'clientId'> = {
        opId: deps.opId(),
        meetingId,
        leave,
        ...(participants.length ? { participants: participants as AgentId[] } : {}),
        ...(o.label ? { label: o.label } : {}),
      };
      // After a say still on its way, so the leave (and its note) sees the owner's last line.
      closing = inflight.then(() => deps.api.roomCancel(roomId, body)).then(
        () => undefined,
        () => undefined,
      );
      return closing;
    },
    lines: () => transcript.map(({ agentId, text, at, heard }) => ({ agentId, text, at, heard })),
    participants: () => lastParticipants,
  };

  let restorePtt: (() => void) | null = o.ptt
    ? deps.setPttTarget({
        kind: 'room',
        roomId,
        label: o.ptt.label,
        onStart: () => session.hush(),
        send: (text) => session.say(text, 'voice'),
      })
    : null;
  readParticipants();
  return session;
}
