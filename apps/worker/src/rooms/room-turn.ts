// One room turn (docs/dev/OFFICE-PHASE2.md §4.2.4): the planned responders answer the owner's message one after the
// other at machine speed (the client paces playback), each a fast-tier, tool-free reply of at most two short sentences
// through the reply guard, or a catalog reflex line for a phatic message. Frames carry `surface: 'room'`, the room and
// the meeting; `room.turn` tells clients who is next. A newer owner message or a cancel closes the turn at once.
import { callBudget, runTurn, type TurnResult } from '@headcount/agent-loop';
import { chiefDisplayName } from '@headcount/catalog';
import { fullIndex } from '@headcount/catalog/full';
import type { AffectCues } from '@headcount/expressions';
import { MissingProviderError, type Registry } from '@headcount/models';
import {
  CHIEF_ID,
  ids,
  ownerFirstNameOf,
  type AgentId,
  type MessageId,
  type OpId,
  type TalkFinish,
  type TurnId,
  type UsageSummary,
  type WorkspaceSettings,
} from '@headcount/protocol';
import type { ExprCause, ExprIntentId } from '@headcount/protocol/ext/expressions';
import { ROOM_REPLY_MAX_TOKENS, type FloorMode, type RoomId, type RoomTurnData } from '@headcount/protocol/ext/rooms';
import { unstaffedLine } from '../desk/desk';
import type { Feed } from '../workspace/feed';
import type { Ledger } from '../workspace/ledger';
import { logError } from '../workspace/runtime';
import { CHIEF_ROOM_WORK_LINE, FIGURE_LINES, ReplyGuard, ownerFigures } from './guard';
import { buildRoomSystemPrompt, ownerLinesOf, projectionName, roomMember, roomProjection, type RoomMember } from './prompt';

/** One responder's reply as it streams. */
export interface RoomReplyState {
  agentId: AgentId;
  replyId: MessageId;
  text: string;
  closed: boolean;
}

/** The room turn the WorkspaceDO runs (at most one per workspace). */
export interface RoomTurnState {
  roomId: RoomId;
  meetingId: string;
  turnId: TurnId;
  opId: OpId;
  gen: number;
  mode: FloorMode;
  /** Planned responders in order (a planned Chief wrap-up last). */
  order: AgentId[];
  chiefWrap: boolean;
  /** Everyone present (the scene's truth at the owner's message). */
  participants: AgentId[];
  label: string | null;
  via: 'text' | 'voice';
  cues: AffectCues;
  ownerSeq: number;
  /** Responders not yet finished. */
  remaining: AgentId[];
  current: RoomReplyState | null;
  /** Replies with text from responders other than a wrap-up. */
  spoke: number;
  /** The turn is over (done, cancelled or stopped at a limit): nothing more is emitted. */
  closed: boolean;
  controller: AbortController;
}

export function newRoomTurn(p: Omit<RoomTurnState, 'remaining' | 'current' | 'spoke' | 'closed' | 'controller'>): RoomTurnState {
  return { ...p, remaining: [...p.order], current: null, spoke: 0, closed: false, controller: new AbortController() };
}

/** What a room turn needs from the WorkspaceDO. */
export interface RoomHost {
  feed: Feed;
  ledger: Ledger;
  registry(): Registry;
  settings(): Promise<WorkspaceSettings>;
  /** False once a newer room turn took over. */
  isCurrent(gen: number): boolean;
  /** One reply's worth of ROOM_TURNS_PER_MIN; false when used up. */
  takeRate(): boolean;
  /** One reply's worth of CHAT_DAILY_LIMIT; the refusal sentence when used up. */
  takeChat(): { allowed: true } | { allowed: false; message: string };
  /** A catalog reflex reply to a phatic message, in this agent's voice (no model call), or null. */
  phatic(agentId: AgentId, turnId: TurnId, via: 'text' | 'voice', cues: AffectCues): Promise<{ text: string; intent: ExprIntentId; lineId: string } | null>;
  /** The look-up face cue while a responder thinks (Phase 2 has no voiced room fillers). */
  thinking(agentId: AgentId): void;
  /** Mood from the owner's words for a responder (as quick chat does). */
  ownerMood(agentId: AgentId, cues: AffectCues, cause: ExprCause): void;
  /** Record who is generating now (restart recovery closes their reply). */
  markCurrent(turn: RoomTurnState): void;
  streamId: ExprCause['streamId'];
}

/** A reply that takes longer than this is cut (its sentences so far stand). */
export const roomTiming = { replyDeadlineMs: 15_000 };
export const defaultRoomTiming = { ...roomTiming };

export const ROOM_RATE_MESSAGE = 'That is a lot of room talk right now. Wait a minute and ask again.';
export const ROOM_NO_PROVIDER_MESSAGE = 'Add a provider key or start Ollama to talk to the room.';

const where = (t: Pick<RoomTurnState, 'roomId' | 'meetingId'>) => ({ surface: 'room' as const, roomId: t.roomId, meetingId: t.meetingId });

/** Broadcast `room.turn` (ephemeral). */
export function emitRoomTurn(feed: Feed, t: RoomTurnState, state: RoomTurnData['state'], next: AgentId | null, reason?: RoomTurnData['reason']): void {
  const data: RoomTurnData = { roomId: t.roomId, meetingId: t.meetingId, turnId: t.turnId, gen: t.gen, order: state === 'running' ? [...t.remaining] : [], next, state, ...(reason ? { reason } : {}) };
  feed.emit({ type: 'room.turn', data });
}

/** Persist one responder's reply (if any) and its `talk.done`, exactly once. */
export function closeRoomReply(
  feed: Feed,
  t: RoomTurnState,
  r: RoomReplyState,
  finish: TalkFinish,
  extra: { usage?: UsageSummary; reflex?: { intent: ExprIntentId; lineId: string } } = {},
): void {
  if (r.closed) return;
  r.closed = true;
  const said = r.text.trim();
  const { turnId, opId } = t;
  if (said) {
    feed.append({
      type: 'talk.message',
      data: { turnId, messageId: r.replyId, agentId: r.agentId, text: said, kind: extra.reflex ? 'reflex' : 'reply', ...(extra.reflex ? { intent: extra.reflex.intent, lineId: extra.reflex.lineId } : {}), ...where(t) },
      actor: r.agentId,
      opId,
    });
  }
  feed.append({
    type: 'talk.done',
    data: { turnId, messageId: said ? r.replyId : null, agentId: r.agentId, finish: said ? finish : finish === 'cancelled' ? 'cancelled' : 'error', route: extra.reflex ? 'reflex' : 'room', ...where(t), ...(extra.usage ? { usage: extra.usage } : {}) },
    actor: r.agentId,
    opId,
  });
}

/**
 * Close a running room turn now (a newer owner message, push-to-talk, or the owner left): the reply being written is
 * persisted as far as it got with `talk.done {finish: 'cancelled'}`, the queue is dropped, and `room.turn` says why.
 * Returns false when the turn was already over.
 */
export function cancelRoomTurn(feed: Feed, t: RoomTurnState, reason: 'owner' | 'left'): boolean {
  if (t.closed) return false;
  t.closed = true;
  t.controller.abort();
  const cur = t.current;
  if (cur && !cur.closed) {
    closeRoomReply(feed, t, cur, 'cancelled');
    feed.claim(cur.agentId, 'room', null);
  }
  t.remaining = [];
  emitRoomTurn(feed, t, 'cancelled', null, reason);
  return true;
}

/** A signal that aborts with `parent` or after `ms` (`timedOut` says which). */
function deadlineSignal(ms: number, parent: AbortSignal): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const c = new AbortController();
  let timedOut = false;
  const onAbort = () => c.abort();
  if (parent.aborted) c.abort();
  else parent.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    c.abort();
  }, ms);
  (timer as unknown as { unref?: () => void }).unref?.();
  return { signal: c.signal, timedOut: () => timedOut, dispose: () => (clearTimeout(timer), parent.removeEventListener('abort', onAbort)) };
}

function finishOf(r: TurnResult, text: string): TalkFinish {
  if (r.finish === 'cancelled') return 'cancelled';
  if (r.finish === 'error') return text ? 'stop' : 'error';
  if (r.finish === 'length' || r.finish === 'incomplete') return text ? 'stop' : 'error';
  return 'stop';
}

/**
 * Run a room turn: for each planned responder while the turn is current, take the per-minute and daily allowances,
 * say who is next, answer (catalog reflex for a phatic message, else the model through the reply guard), persist the
 * reply and move on. A failed or empty reply is skipped. The Chief's wrap-up is said only after two others spoke.
 */
export async function runRoomTurn(host: RoomHost, t: RoomTurnState): Promise<void> {
  const { feed } = host;
  const alive = () => !t.closed && host.isCurrent(t.gen);
  const stop = (reason: 'limit' | 'error', error?: { code: 'rate_limited' | 'not_configured'; message: string; missingKeys?: string[] }) => {
    if (!alive()) return;
    t.closed = true;
    t.remaining = [];
    if (error) feed.emit({ type: 'error', data: { code: error.code, message: error.message, turnId: t.turnId, opId: t.opId, ...(error.missingKeys?.length ? { missingKeys: error.missingKeys } : {}) } });
    emitRoomTurn(feed, t, 'done', null, reason);
  };
  const settings = await host.settings();
  const members = new Map<string, RoomMember>();
  for (const id of t.participants) {
    const m = roomMember(id, settings);
    if (m) members.set(id, m);
  }
  const lead = settings.leadId ? fullIndex.lead(settings.leadId) : undefined;
  const chiefName = chiefDisplayName(lead, settings.chiefName);
  const ownerFirst = ownerFirstNameOf(settings);
  const nameOf = (agentId: string) => {
    const m = members.get(agentId) ?? roomMember(agentId, settings);
    return m ? projectionName(m) : 'A colleague';
  };
  const cause: ExprCause = { streamId: host.streamId, seq: t.ownerSeq };

  for (let k = 0; k < t.order.length; k++) {
    if (!alive()) return;
    const agentId = t.order[k]!;
    const wrapUp = t.chiefWrap && agentId === CHIEF_ID && k === t.order.length - 1;
    if (wrapUp && t.spoke < 2) break;
    t.remaining = t.order.slice(k);
    const member = members.get(agentId);
    if (!member) continue;
    if (!host.takeRate()) return stop('limit', { code: 'rate_limited', message: ROOM_RATE_MESSAGE });

    const reply: RoomReplyState = { agentId, replyId: ids.message(), text: '', closed: false };
    t.current = reply;
    host.markCurrent(t);
    emitRoomTurn(feed, t, 'running', agentId);
    feed.claim(agentId, 'room', { state: 'thinking', label: 'Thinking', causeSeq: t.ownerSeq });
    host.thinking(agentId);
    let answered = false;
    try {
      if (t.mode === 'phatic') {
        const r = await host.phatic(agentId, t.turnId, t.via, t.cues).catch((err) => {
          logError('room.phatic', err);
          return null;
        });
        if (!alive() || reply.closed) return;
        if (r) {
          reply.text = r.text;
          closeRoomReply(feed, t, reply, 'stop', { reflex: { intent: r.intent, lineId: r.lineId } });
          answered = true;
        }
      }
      if (!answered) {
        const chat = host.takeChat();
        if (!chat.allowed) {
          closeRoomReply(feed, t, reply, 'error');
          feed.claim(agentId, 'room', null);
          return stop('limit', { code: 'rate_limited', message: chat.message });
        }
        const outcome = await modelReply(host, t, reply, { member, members, wrapUp, chiefName, ownerFirst, nameOf, settings });
        if (outcome === 'no_provider') return;
      }
    } catch (err) {
      logError('room.turn', err);
      if (!reply.closed && alive()) closeRoomReply(feed, t, reply, 'error');
    }
    if (!alive()) return;
    feed.claim(agentId, 'room', null);
    if (reply.text.trim() && !wrapUp) t.spoke++;
    try {
      host.ownerMood(agentId, t.cues, cause);
    } catch (err) {
      logError('room.mood', err);
    }
  }
  if (!alive()) return;
  t.closed = true;
  t.current = null;
  t.remaining = [];
  emitRoomTurn(feed, t, 'done', null);
}

/** One model reply, streamed through the reply guard as whole sentences, then persisted. */
async function modelReply(
  host: RoomHost,
  t: RoomTurnState,
  reply: RoomReplyState,
  c: { member: RoomMember; members: Map<string, RoomMember>; wrapUp: boolean; chiefName: string; ownerFirst: string | null; nameOf: (id: string) => string; settings: WorkspaceSettings },
): Promise<'ok' | 'no_provider'> {
  const { feed } = host;
  let resolved;
  try {
    resolved = host.registry().resolve('chat', { tier: 'fast' });
  } catch (err) {
    if (err instanceof MissingProviderError) {
      closeRoomReply(feed, t, reply, 'error');
      feed.claim(reply.agentId, 'room', null);
      if (!t.closed && host.isCurrent(t.gen)) {
        t.closed = true;
        t.remaining = [];
        feed.emit({ type: 'error', data: { code: 'not_configured', message: ROOM_NO_PROVIDER_MESSAGE, missingKeys: err.missingKeys, turnId: t.turnId, opId: t.opId } });
        emitRoomTurn(feed, t, 'done', null, 'error');
      }
      return 'no_provider';
    }
    throw err;
  }
  const frames = host.ledger.recent(['talk.owner', 'talk.message'], 400);
  const others = t.participants.filter((id) => id !== reply.agentId).map((id) => c.members.get(id)).filter((m): m is RoomMember => !!m);
  const system = buildRoomSystemPrompt({ roomId: t.roomId, label: t.label, self: c.member, others, ownerFirst: c.ownerFirst, chiefName: c.chiefName, wrapUp: c.wrapUp });
  const messages = roomProjection(frames, t.meetingId, reply.agentId, c.nameOf);
  const ownerLines = ownerLinesOf(frames, t.meetingId);
  const guard = new ReplyGuard({
    allowedFigures: ownerFigures(ownerLines),
    ownerText: ownerLines,
    workLine: c.member.isChief ? CHIEF_ROOM_WORK_LINE : unstaffedLine(c.chiefName),
    // Two responders in one turn never say the same honest line.
    figureLine: FIGURE_LINES[Math.max(0, t.order.indexOf(reply.agentId)) % FIGURE_LINES.length]!,
    maxSentences: 2,
    // "We could start with a pilot" is group advice in a meeting; only "I'll…" is a promise.
    work: 'room',
    where: 'room.guard',
  });
  const say = (text: string) => {
    if (!text || reply.closed) return;
    reply.text += text;
    feed.emit({ type: 'talk.delta', data: { turnId: t.turnId, messageId: reply.replyId, agentId: reply.agentId, delta: text, ...where(t) } });
  };
  const deadline = deadlineSignal(roomTiming.replyDeadlineMs, t.controller.signal);
  let result: TurnResult;
  try {
    result = await runTurn({
      provider: resolved.provider,
      model: resolved.model,
      system,
      messages,
      signal: deadline.signal,
      maxSteps: 1,
      ...callBudget(resolved.provider, resolved.model, ROOM_REPLY_MAX_TOKENS, 'none'),
      onEvent: (e) => {
        if (!reply.closed && e.type === 'text' && e.delta) say(guard.push(e.delta));
      },
    });
  } finally {
    deadline.dispose();
  }
  if (reply.closed) return 'ok'; // cancelled: closed with its partial text
  // A reply cut by the deadline or the token cap ends at its last whole sentence: the fragment is never said.
  const cut = deadline.timedOut() || result.finish === 'length' || result.finish === 'incomplete';
  say(cut ? guard.discard() : guard.flush());
  const usage: UsageSummary = { provider: resolved.providerId, input: result.usage.input, output: result.usage.output, usd: result.usage.usd };
  let finish = finishOf(result, reply.text);
  if (finish === 'cancelled' && deadline.timedOut()) finish = reply.text.trim() ? 'stop' : 'error';
  if (result.finish === 'error') logError('room.reply', result.error?.message ?? 'model error');
  closeRoomReply(feed, t, reply, finish, { usage });
  return 'ok';
}
