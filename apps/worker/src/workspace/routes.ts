import { fullIndex } from '@headcount/catalog/full';
import { OWNER_NAME_MAX_CHARS, TALK_MAX_CHARS, type TalkAccepted, type TalkRequest, type UpdateWorkspaceRequest, type WorkspaceResponse, TALK_ATTACHMENTS_MAX } from '@headcount/protocol';
import { isAmbience } from '@headcount/protocol/ext/expressions';
import { isClientId } from '@headcount/protocol/ext/voice-owner';
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
  if ('ambience' in body) {
    if (!isAmbience(body.ambience)) throw new HttpError('bad_request', 'ambience must be "quiet", "lively" or "buzzing".');
    patch.ambience = body.ambience;
  }
  if ('ownerName' in body) patch.ownerName = ownerNameOf(body.ownerName);
  return json<WorkspaceResponse>(await workspaceStub(env).updateSettings(patch));
};

/**
 * What the office calls the owner (Office Phase 2 §4.2.10): trimmed, whitespace collapsed, blank → null, at most
 * OWNER_NAME_MAX_CHARS characters, no control characters or markup-ish symbols.
 */
export function ownerNameOf(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== 'string') throw new HttpError('bad_request', 'ownerName must be text or null.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>{}[\]\\/@#]/.test(v)) throw new HttpError('bad_request', 'Use letters for your name.');
  const name = v.replace(/\s+/g, ' ').trim();
  if (name.length > OWNER_NAME_MAX_CHARS) throw new HttpError('bad_request', `Keep your name to ${OWNER_NAME_MAX_CHARS} characters or fewer.`);
  return name || null;
}

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
  if (body.attachments !== undefined && (!Array.isArray(body.attachments) || body.attachments.length > TALK_ATTACHMENTS_MAX || !body.attachments.every((a) => typeof a === 'string' && /^card_[a-f0-9]{16}$/.test(a))))
    throw new HttpError('bad_request', `Attach at most ${TALK_ATTACHMENTS_MAX} shared files.`);
  const talk: TalkRequest = { text: body.text.trim(), opId: body.opId, via: body.via === 'voice' ? 'voice' : 'text', ...(isClientId(body.clientId) ? { clientId: body.clientId } : {}), ...(body.attachments?.length ? { attachments: [...new Set(body.attachments)] } : {}) };
  const r = await workspaceStub(env).talk(talk);
  if (!r.accepted) throw new HttpError(r.code, r.message, { opId: body.opId });
  return json<TalkAccepted>(r, { status: 202 });
};
