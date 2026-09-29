// Route handlers for automations (parity stage 3b). They live in the ProjectDO beside the work they start.
import type { AutomationResponse, AutomationsResponse, AutomationSpec, AutomationView } from '@headcount/protocol/ext/automations';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { projectStub } from '../lib/stubs';

const isAutomationId = (id: string | undefined): id is string => !!id && /^aut_[a-f0-9]{16}$/.test(id);
type Op = { automation: AutomationView } | { error: string; code: 'bad_request' | 'not_found' | 'conflict' };

const answer = (r: Op, status = 200) => {
  if ('error' in r) throw new HttpError(r.code, r.error);
  return json<AutomationResponse>({ automation: r.automation }, { status });
};

async function specOf(req: Request): Promise<Partial<AutomationSpec>> {
  const b = await readJson<Partial<AutomationSpec>>(req);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError('bad_request', 'Send the automation as a JSON object.');
  for (const k of ['schedule', 'page', 'action'] as const) if (b[k] !== undefined && (typeof b[k] !== 'object' || b[k] === null || Array.isArray(b[k]))) throw new HttpError('bad_request', `${k} must be an object.`);
  if (b.enabled !== undefined && typeof b.enabled !== 'boolean') throw new HttpError('bad_request', 'enabled is true or false.');
  return b;
}

export const handleListAutomations: RouteHandler = async (_req, { env }) => json<AutomationsResponse>({ automations: (await projectStub(env).listAutomations()) as unknown as AutomationView[] });

export const handleAddAutomation: RouteHandler = async (req, { env }) => answer((await projectStub(env).addAutomation(await specOf(req))) as unknown as Op, 201);

export const handlePutAutomation: RouteHandler = async (req, { env, params }) => {
  if (!isAutomationId(params.id)) throw new HttpError('not_found', 'No such automation.');
  return answer((await projectStub(env).updateAutomation(params.id, await specOf(req))) as unknown as Op);
};

export const handleRemoveAutomation: RouteHandler = async (_req, { env, params }) => {
  if (!isAutomationId(params.id)) throw new HttpError('not_found', 'No such automation.');
  const r = (await projectStub(env).removeAutomation(params.id)) as { removed: boolean };
  if (!r.removed) throw new HttpError('not_found', 'No such automation.');
  return json({ removed: true });
};

export const handleRunAutomation: RouteHandler = async (_req, { env, params }) => {
  if (!isAutomationId(params.id)) throw new HttpError('not_found', 'No such automation.');
  return answer((await projectStub(env).runAutomation(params.id)) as unknown as Op, 202);
};
