// Office Phase 2 wire types: conference rooms and huddle group chats on the rooms
// endpoint, the office's personality roster, and listen-in huddle renders. Owned by B (WORKER-ROOMS).
import { ulid, type AgentId, type MessageId, type OpId, type TurnId } from '../ids';
import type { ExprAgentProfile, ExprTtsProvider } from './expressions';

export type ConferenceRoomId = 'skyline' | 'garden';
export type HuddleRoomId = `huddle:${string}`;
export type RoomId = ConferenceRoomId | HuddleRoomId;
export type RoomKind = 'skyline' | 'garden' | 'huddle';

export const ROOM_ID_RE = /^(?:skyline|garden|huddle:[a-z0-9]{4,16})$/;
export const MEETING_ID_RE = /^mtg_[0-9a-z]{26}$/;

export function isRoomId(v: unknown): v is RoomId {
  return typeof v === 'string' && ROOM_ID_RE.test(v);
}

export function isMeetingId(v: unknown): v is string {
  return typeof v === 'string' && MEETING_ID_RE.test(v);
}

export function roomKindOf(id: RoomId): RoomKind {
  return id === 'skyline' || id === 'garden' ? id : 'huddle';
}

/** FNV-1a, 32-bit, over UTF-16 code units. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 'huddle:' + FNV-1a 32-bit of the life huddle id ('hd:<day>:<spot>:<minute>') in base 36: stable, short, no colons. */
export function huddleRoomId(huddleId: string): HuddleRoomId {
  // Base 36 of a 32-bit value is 1–7 characters; pad to the id pattern's minimum of 4.
  return `huddle:${fnv1a32(huddleId).toString(36).padStart(4, '0')}`;
}

/** Client-made, one per meeting (entering a room or joining a huddle): 'mtg_' + a lowercase ULID. */
export function newMeetingId(now?: number): string {
  return `mtg_${ulid(now).toLowerCase()}`;
}

/** Participants exclude the owner. */
export const ROOM_LIMITS: Readonly<Record<RoomKind, { participants: number; responders: number; chiefWrap: boolean }>> = {
  skyline: { participants: 9, responders: 3, chiefWrap: true },
  garden: { participants: 7, responders: 3, chiefWrap: true },
  huddle: { participants: 4, responders: 2, chiefWrap: false },
};
export const ROOM_SAY_MAX_CHARS = 2000;
/** Responder replies per workspace per minute. */
export const ROOM_TURNS_PER_MIN = 12;
/** Meeting lines each responder sees. */
export const ROOM_PROJECTION_LINES = 12;
/** At most two short sentences. */
export const ROOM_REPLY_MAX_TOKENS = 160;
/** A huddle's place, e.g. "water cooler". */
export const ROOM_LABEL_RE = /^[\p{L} '’-]{1,40}$/u;

export type FloorMode = 'mention' | 'group' | 'relevance' | 'phatic';

/** POST /api/rooms/:roomId/say. 202 RoomSayAccepted; replies stream as talk.* frames with `surface: 'room'`. */
export interface RoomSayRequest {
  text: string;
  opId: OpId;
  meetingId: string;
  /** Who is at the table / in the huddle now (the scene's truth), in seat order from the owner's left. */
  participants: AgentId[];
  via?: 'text' | 'voice';
  /** The sending tab becomes the voice owner (CONTRACTS §8). */
  clientId?: string;
  /** Huddles: the place, for prompts and the leave note. */
  label?: string;
}

export interface RoomSayAccepted {
  accepted: true;
  opId: OpId;
  roomId: RoomId;
  meetingId: string;
  /** One room turn per owner message. */
  turnId: TurnId;
  /** The owner's message. */
  messageId: MessageId;
  /** Planned responders in speaking order (a planned Chief wrap-up is last). */
  order: AgentId[];
  mode: FloorMode;
  gen: number;
  duplicate?: boolean;
}

export interface RoomRefusal {
  accepted: false;
  code: 'bad_request' | 'not_found' | 'rate_limited' | 'not_configured';
  message: string;
  missingKeys?: string[];
}

/** POST /api/rooms/:roomId/cancel. Idempotent on opId. */
export interface RoomCancelRequest {
  opId: OpId;
  meetingId: string;
  /** The owner left: cancel, and post the note if they said anything. */
  leave?: boolean;
  participants?: AgentId[];
  label?: string;
  clientId?: string;
}

export interface RoomCancelResponse {
  cancelled: boolean;
  noteId: MessageId | null;
}

/** Ephemeral frame `room.turn`: floor control as the server runs it. Never persisted, never replayed. */
export interface RoomTurnData {
  roomId: RoomId;
  meetingId: string;
  turnId: TurnId;
  gen: number;
  /** Responders not yet finished, in order. */
  order: AgentId[];
  /** Generating now. */
  next: AgentId | null;
  state: 'running' | 'done' | 'cancelled';
  reason?: 'owner' | 'left' | 'limit' | 'error';
}

/** GET /api/office/people: personality for office life and the huddle engine. */
export interface OfficePersonDto {
  /** 'cw_chief' or 'cw_<personaId>'. */
  agentId: AgentId;
  /** Department id; 'chief' for the Chief. */
  groupId: string;
  isChief: boolean;
  teamRoles: string[];
  /** Catalog persona ids mapped to agent ids. */
  pairsWellWith: AgentId[];
  tensionWith: AgentId[];
  /** Archetype → weight: the signature pack's `archetypes`, or `lead_blends[leadId]`. */
  blend?: Record<string, number>;
  /** As GET /api/expr/agents/:id builds it (sliders, traits, voice, …). */
  profile: ExprAgentProfile;
}

export interface OfficePeopleResponse {
  version: string;
  people: OfficePersonDto[];
}

/** POST /api/expr/huddle/render: one small-talk turn in the speaker's voice (listen-in). Response: ExprClipRef. */
export interface ExprHuddleRenderRequest {
  exchangeId: string;
  index: number;
  agentId: AgentId;
  fills: Record<string, string>;
  provider: ExprTtsProvider;
}
