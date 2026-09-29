// Route handlers for connectors (parity stage 5). Everything runs in the WorkspaceDO, where the keys are sealed; a key
// arrives once in a request body and never comes back in a response.
import { CONNECTOR_APPROVALS, CONNECTOR_NAME_MAX, CONNECTOR_TOKEN_MAX, type ConnectorCreate, type ConnectorPatch, type ConnectorResponse, type ConnectorsResponse, type ConnectorView } from '@headcount/protocol/ext/connectors';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { workspaceStub } from '../lib/stubs';

const isConnectorId = (id: string | undefined): id is string => !!id && /^cn_[a-f0-9]{16}$/.test(id);
const isGrantId = (id: string | undefined): id is string => !!id && /^cg_[a-f0-9]{16}$/.test(id);

type Op = { connector: ConnectorView } | { error: string; code: 'bad_request' | 'not_found' | 'conflict' | 'unavailable' };

const answer = (r: Op, status = 200) => {
  if ('error' in r) throw new HttpError(r.code === 'unavailable' ? 'not_configured' : r.code, r.error);
  return json<ConnectorResponse>({ connector: r.connector }, { status });
};

function str(v: unknown, what: string, max: number): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new HttpError('bad_request', `${what} must be text.`);
  if (v.length > max) throw new HttpError('bad_request', `${what} is too long.`);
  return v;
}

function bool(v: unknown, what: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new HttpError('bad_request', `${what} is true or false.`);
  return v;
}

function approvalOf(v: unknown): ConnectorCreate['approval'] {
  if (v === undefined) return undefined;
  if (!CONNECTOR_APPROVALS.includes(v as never)) throw new HttpError('bad_request', 'Approval is ask, writes or never.');
  return v as ConnectorCreate['approval'];
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError('bad_request', 'Send the connector as a JSON object.');
  return b;
}

/** GET /api/connectors → what is connected (keys never included), the catalog, and whether keys can be stored. */
export const handleListConnectors: RouteHandler = async (_req, { env }) => json<ConnectorsResponse>((await workspaceStub(env).connectorsView()) as unknown as ConnectorsResponse);

/** POST /api/connectors → connect a catalog entry or a custom https server, then test it. */
export const handleAddConnector: RouteHandler = async (req, { env }) => {
  const b = await body(req);
  const create: ConnectorCreate = {};
  const catalogId = str(b.catalogId, 'The catalog id', 60);
  if (catalogId !== undefined) create.catalogId = catalogId;
  const name = str(b.name, 'The name', CONNECTOR_NAME_MAX);
  if (name !== undefined) create.name = name;
  const url = str(b.url, 'The URL', 2000);
  if (url !== undefined) create.url = url;
  const token = str(b.token, 'The key', CONNECTOR_TOKEN_MAX);
  if (token) create.token = token;
  const approval = approvalOf(b.approval);
  if (approval) create.approval = approval;
  const everyone = bool(b.everyone, 'Everyone');
  if (everyone !== undefined) create.everyone = everyone;
  const chief = bool(b.chief, 'Chief');
  if (chief !== undefined) create.chief = chief;
  if (!create.catalogId && !create.url) throw new HttpError('bad_request', 'Choose a connector from the catalog or give a server URL.');
  return answer((await workspaceStub(env).addConnector(create)) as unknown as Op, 201);
};

/** PUT /api/connectors/:id → rename, replace or remove the key, approval, who may use it. */
export const handlePatchConnector: RouteHandler = async (req, { env, params }) => {
  if (!isConnectorId(params.id)) throw new HttpError('not_found', 'No such connector.');
  const b = await body(req);
  const patch: ConnectorPatch = {};
  const name = str(b.name, 'The name', CONNECTOR_NAME_MAX);
  if (name !== undefined) patch.name = name;
  if (b.token === null) patch.token = null;
  else {
    const token = str(b.token, 'The key', CONNECTOR_TOKEN_MAX);
    if (token !== undefined) patch.token = token;
  }
  const approval = approvalOf(b.approval);
  if (approval) patch.approval = approval;
  const everyone = bool(b.everyone, 'Everyone');
  if (everyone !== undefined) patch.everyone = everyone;
  const chief = bool(b.chief, 'Chief');
  if (chief !== undefined) patch.chief = chief;
  return answer((await workspaceStub(env).patchConnector(params.id, patch)) as unknown as Op);
};

/** DELETE /api/connectors/:id → disconnect (the key and the grants go with it). */
export const handleRemoveConnector: RouteHandler = async (_req, { env, params }) => {
  if (!isConnectorId(params.id)) throw new HttpError('not_found', 'No such connector.');
  const r = (await workspaceStub(env).removeConnector(params.id)) as { removed: boolean };
  if (!r.removed) throw new HttpError('not_found', 'No such connector.');
  return json({ removed: true });
};

/** POST /api/connectors/:id/test → connect afresh and list its tools. */
export const handleTestConnector: RouteHandler = async (_req, { env, params }) => {
  if (!isConnectorId(params.id)) throw new HttpError('not_found', 'No such connector.');
  return answer((await workspaceStub(env).testConnector(params.id)) as unknown as Op);
};

/** DELETE /api/connectors/:id/grants/:grantId → withdraw a standing OK. */
export const handleRevokeConnectorGrant: RouteHandler = async (_req, { env, params }) => {
  if (!isConnectorId(params.id) || !isGrantId(params.grantId)) throw new HttpError('not_found', 'No such grant.');
  return answer((await workspaceStub(env).revokeConnectorGrant(params.id, params.grantId)) as unknown as Op);
};
