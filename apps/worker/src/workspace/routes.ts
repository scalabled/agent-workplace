import { fullIndex } from '@headcount/catalog/full';
import { TALK_MAX_CHARS, type TalkAccepted, type TalkRequest, type UpdateWorkspaceRequest, type WorkspaceResponse } from '@headcount/protocol';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { workspaceStub } from '../lib/stubs';

// Route handlers for the workspace area (owned by worker-core). Signatures are fixed by the router.

export const CHIEF_NAME_MAX = 40;
const OP_ID_MAX = 128;

export const handleGetWorkspace: RouteHandler = async (_req, { env }) => json<WorkspaceResponse>(await workspaceStub(env).getSettings());

export const handlePutWorkspace: RouteHandler = async (req, { env }) => {
  const body = await readJson<UpdateWorkspaceRequest>(req);
  if (!body || typeof body !== 'object') throw new HttpError('bad_request', 'Send the settings as a JSON object.');
  const patch: UpdateWorkspaceRequest = {};
  if ('leadId' in body) {
    if (body.leadId !== null && typeof body.leadId !== 'string') throw new HttpError('bad_request', 'leadId must be a lead id or null.');
    if (typeof body.leadId === 'string' && !fullIndex.lead(body.leadId)) throw new HttpError('bad_request', `There is no Chief of Staff called ${body.leadId}. Pick one from the gallery.`);
    patch.leadId = body.leadId;
  }
  if ('chiefName' in body) {
    if (body.chiefName !== null && typeof body.chiefName !== 'string') throw new HttpError('bad_request', 'chiefName must be text or null.');
    const name = typeof body.chiefName === 'string' ? body.chiefName.replace(/\s+/g, ' ').trim().slice(0, CHIEF_NAME_MAX) : '';
    patch.chiefName = name || null;
  }
  if ('voiceOn' in body) {
    if (typeof body.voiceOn !== 'boolean') throw new HttpError('bad_request', 'voiceOn must be true or false.');
    patch.voiceOn = body.voiceOn;
  }
  return json<WorkspaceResponse>(await workspaceStub(env).updateSettings(patch));
};

/** GET /api/ws?since=<seq> → WorkspaceDO socket (ready → replay → presence → live). */
export const handleWs: RouteHandler = async (req, { env }) => {
  if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new HttpError('bad_request', 'Open /api/ws as a WebSocket.', { status: 426 });
  return workspaceStub(env).fetch(req);
};

/** POST /api/talk → 202 at once; the Chief of Staff's reply streams as talk.* frames on the socket. */
export const handleTalk: RouteHandler = async (req, { env }) => {
  const body = await readJson<TalkRequest>(req);
  if (!body || typeof body !== 'object') throw new HttpError('bad_request', 'Send the message as a JSON object.');
  if (typeof body.text !== 'string' || !body.text.trim()) throw new HttpError('bad_request', 'Say something first: text is empty.');
  if (body.text.length > TALK_MAX_CHARS) throw new HttpError('payload_too_large', `Keep messages under ${TALK_MAX_CHARS} characters.`);
  if (typeof body.opId !== 'string' || !body.opId || body.opId.length > OP_ID_MAX) throw new HttpError('bad_request', 'Include an opId so retries are safe.');
  const talk: TalkRequest = { text: body.text.trim(), opId: body.opId, via: body.via === 'voice' ? 'voice' : 'text' };
  const r = await workspaceStub(env).talk(talk);
  if (!r.accepted) throw new HttpError(r.code, r.message, { opId: body.opId });
  return json<TalkAccepted>(r, { status: 202 });
};
