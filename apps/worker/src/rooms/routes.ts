// POST /api/rooms/:roomId/say and /cancel: the owner talks to a conference room or
// a joined huddle. 202 at once; up to three responders answer in turn as talk.* frames with `surface: 'room'` on the
// workspace socket, and `room.turn` says who is next. Cancel is the barge-in and the leave (with one note in Talk).
import { fullIndex } from '@headcount/catalog/full';
import { CHIEF_ID, personaIdFromAgentId, type AgentId } from '@headcount/protocol';
import { isClientId } from '@headcount/protocol/ext/voice-owner';
import {
  MEETING_ID_RE,
  ROOM_LABEL_RE,
  ROOM_LIMITS,
  ROOM_SAY_MAX_CHARS,
  isRoomId,
  roomKindOf,
  type RoomCancelRequest,
  type RoomCancelResponse,
  type RoomId,
  type RoomSayAccepted,
  type RoomSayRequest,
} from '@headcount/protocol/ext/rooms';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { workspaceStub } from '../lib/stubs';

const OP_ID_MAX = 128;

function roomIdParam(raw: string | undefined): RoomId {
  const id = raw ?? '';
  if (!isRoomId(id)) throw new HttpError('not_found', `There is no room called ${id.slice(0, 40)}.`);
  return id;
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('bad_request', 'Send the message as a JSON object.');
  return body as Record<string, unknown>;
}

/** A participant is the Chief or a catalog coworker (the Chief's lead is checked by the WorkspaceDO). */
export function isParticipantId(v: unknown): v is AgentId {
  if (v === CHIEF_ID) return true;
  const personaId = typeof v === 'string' ? personaIdFromAgentId(v) : null;
  return !!personaId && !!fullIndex.persona(personaId);
}

function labelOf(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !ROOM_LABEL_RE.test(v)) throw new HttpError('bad_request', 'label must be a short place name in letters, such as "water cooler".');
  return v;
}

export const handleRoomSay: RouteHandler = async (req, rc) => {
  const roomId = roomIdParam(rc.params.roomId);
  const body = objectBody(await readJson<unknown>(req));
  if (typeof body.text !== 'string' || !body.text.trim()) throw new HttpError('bad_request', 'Say something first: text is empty.');
  if (body.text.length > ROOM_SAY_MAX_CHARS) throw new HttpError('payload_too_large', `Keep room messages under ${ROOM_SAY_MAX_CHARS} characters.`);
  if (typeof body.opId !== 'string' || !body.opId || body.opId.length > OP_ID_MAX) throw new HttpError('bad_request', 'Include an opId so retries are safe.');
  if (typeof body.meetingId !== 'string' || !MEETING_ID_RE.test(body.meetingId)) throw new HttpError('bad_request', 'Include the meetingId of this meeting (mtg_ and a lowercase ULID).');
  const max = ROOM_LIMITS[roomKindOf(roomId)].participants;
  const participants = body.participants;
  if (!Array.isArray(participants) || participants.length < 1 || participants.length > max) {
    throw new HttpError('bad_request', `Invite 1 to ${max} people before talking to the room.`);
  }
  if (new Set(participants).size !== participants.length || !participants.every(isParticipantId)) {
    throw new HttpError('bad_request', 'participants must list each person once, as cw_chief or cw_<personaId> of a coworker.');
  }
  const label = labelOf(body.label);
  const say: RoomSayRequest = {
    text: body.text.trim(),
    opId: body.opId,
    meetingId: body.meetingId,
    participants: participants as AgentId[],
    via: body.via === 'voice' ? 'voice' : 'text',
    ...(isClientId(body.clientId) ? { clientId: body.clientId } : {}),
    ...(label ? { label } : {}),
  };
  const r = await workspaceStub(rc.env).roomSay(roomId, say);
  if (!r.accepted) throw new HttpError(r.code, r.message, { opId: say.opId, ...(r.missingKeys?.length ? { missingKeys: r.missingKeys } : {}) });
  return json<RoomSayAccepted>(r, { status: 202 });
};

export const handleRoomCancel: RouteHandler = async (req, rc) => {
  const roomId = roomIdParam(rc.params.roomId);
  const body = objectBody(await readJson<unknown>(req));
  if (typeof body.opId !== 'string' || !body.opId || body.opId.length > OP_ID_MAX) throw new HttpError('bad_request', 'Include an opId so retries are safe.');
  if (typeof body.meetingId !== 'string' || !MEETING_ID_RE.test(body.meetingId)) throw new HttpError('bad_request', 'Include the meetingId of this meeting (mtg_ and a lowercase ULID).');
  if (body.leave !== undefined && typeof body.leave !== 'boolean') throw new HttpError('bad_request', 'leave must be true or false.');
  const max = ROOM_LIMITS[roomKindOf(roomId)].participants;
  // Who was present at the leave only names the note: unknown ids are dropped rather than refused.
  const participants = Array.isArray(body.participants) ? [...new Set(body.participants.filter(isParticipantId))].slice(0, max) : undefined;
  const label = labelOf(body.label);
  const cancel: RoomCancelRequest = {
    opId: body.opId,
    meetingId: body.meetingId,
    ...(body.leave ? { leave: true } : {}),
    ...(participants ? { participants } : {}),
    ...(label ? { label } : {}),
    ...(isClientId(body.clientId) ? { clientId: body.clientId } : {}),
  };
  const r = await workspaceStub(rc.env).roomCancel(roomId, cancel);
  return json<RoomCancelResponse>(r);
};
