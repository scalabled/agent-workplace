// POST /api/desk/:personaId/say — a Floor quick-chat message to a catalog coworker.
// 202 at once; the reply streams on the workspace socket as talk.* frames with that agentId and `surface: 'floor'`.
import { fullIndex } from '@headcount/catalog/full';
import type { DeskSayAccepted, DeskSayRequest } from '@headcount/protocol/ext/expressions';
import { isClientId } from '@headcount/protocol/ext/voice-owner';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { workspaceStub } from '../lib/stubs';
import { DESK_MAX_CHARS } from './desk';

const OP_ID_MAX = 128;

export const handleDeskSay: RouteHandler = async (req, rc) => {
  const personaId = rc.params.personaId ?? '';
  const body = await readJson<Partial<DeskSayRequest>>(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('bad_request', 'Send the message as a JSON object.');
  if (typeof body.text !== 'string' || !body.text.trim()) throw new HttpError('bad_request', 'Say something first: text is empty.');
  if (body.text.length > DESK_MAX_CHARS) throw new HttpError('payload_too_large', `Keep quick chats under ${DESK_MAX_CHARS} characters, or open their desk.`);
  if (typeof body.opId !== 'string' || !body.opId || body.opId.length > OP_ID_MAX) throw new HttpError('bad_request', 'Include an opId so retries are safe.');
  if (!fullIndex.persona(personaId)) throw new HttpError('not_found', `There is no coworker called ${personaId}.`);
  const r = await workspaceStub(rc.env).deskSay(personaId, { text: body.text.trim(), opId: body.opId, via: body.via === 'voice' ? 'voice' : 'text', ...(isClientId(body.clientId) ? { clientId: body.clientId } : {}) });
  if (!r.accepted) throw new HttpError(r.code, r.message, { opId: body.opId });
  return json<DeskSayAccepted>(r, { status: 202 });
};
