// Route handlers for agent configuration and transparency (parity stage 2). The WorkspaceDO keeps the owner's overrides;
// the model list is read from the model catalog and the providers the worker has keys for.
import { fullIndex } from '@headcount/catalog/full';
import { CHAT_CATALOG, PROVIDERS, OLLAMA_DEFAULTS } from '@headcount/models';
import type { AgentConfigPatch, AgentView, ModelsResponse, PromptView, SkillDetail, SkillPatch, SkillsResponse } from '@headcount/protocol/ext/agents';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { workspaceStub } from '../lib/stubs';

const isPersonaId = (id: string | undefined): id is string => !!id && /^[a-z0-9][a-z0-9-]{0,80}$/.test(id) && !!fullIndex.persona(id);
const isSkillId = (id: string | undefined): id is string => !!id && /^[a-z0-9][a-z0-9-]{0,80}$/.test(id);

/** GET /api/agents/:personaId → how they work, their skills, tools, model and assembled prompts. */
export const handleGetAgent: RouteHandler = async (_req, { env, params }) => {
  if (!isPersonaId(params.personaId)) throw new HttpError('not_found', 'There is no such coworker.');
  const view = (await workspaceStub(env).agentView(params.personaId)) as unknown as AgentView | null;
  if (!view) throw new HttpError('not_found', 'There is no such coworker.');
  return json<AgentView>(view);
};

/** PUT /api/agents/:personaId → the owner's change (instructions, skills, tools, model); the new view. */
export const handlePutAgent: RouteHandler = async (req, { env, params }) => {
  if (!isPersonaId(params.personaId)) throw new HttpError('not_found', 'There is no such coworker.');
  const body = await readJson<AgentConfigPatch>(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('bad_request', 'Send the change as a JSON object.');
  const r = (await workspaceStub(env).patchAgent(params.personaId, body)) as unknown as { view: AgentView } | { error: string };
  if ('error' in r) throw new HttpError('bad_request', r.error);
  return json<AgentView>(r.view);
};

/** POST /api/agents/:personaId/reset → back to the catalog. */
export const handleResetAgent: RouteHandler = async (_req, { env, params }) => {
  if (!isPersonaId(params.personaId)) throw new HttpError('not_found', 'There is no such coworker.');
  const view = (await workspaceStub(env).resetAgent(params.personaId)) as unknown as AgentView | null;
  if (!view) throw new HttpError('not_found', 'There is no such coworker.');
  return json<AgentView>(view);
};

export const handleListSkills: RouteHandler = async (_req, { env }) => json<SkillsResponse>((await workspaceStub(env).skillList()) as unknown as SkillsResponse);

export const handleGetSkill: RouteHandler = async (_req, { env, params }) => {
  if (!isSkillId(params.id)) throw new HttpError('not_found', 'There is no such skill.');
  const skill = (await workspaceStub(env).skillDetail(params.id)) as unknown as SkillDetail | null;
  if (!skill) throw new HttpError('not_found', 'There is no such skill.');
  return json<SkillDetail>(skill);
};

/** PUT /api/skills/:id → a new workspace version of the skill's instructions. */
export const handlePutSkill: RouteHandler = async (req, { env, params }) => {
  if (!isSkillId(params.id)) throw new HttpError('not_found', 'There is no such skill.');
  const body = await readJson<SkillPatch>(req);
  if (!body || typeof body.instructions !== 'string') throw new HttpError('bad_request', 'Send the new instructions.');
  const r = (await workspaceStub(env).editSkill(params.id, { instructions: body.instructions, ...(typeof body.note === 'string' ? { note: body.note } : {}) })) as unknown as { skill: SkillDetail } | { error: string };
  if ('error' in r) throw new HttpError('bad_request', r.error);
  return json<SkillDetail>(r.skill);
};

export const handleRollbackSkill: RouteHandler = async (req, { env, params }) => {
  if (!isSkillId(params.id)) throw new HttpError('not_found', 'There is no such skill.');
  const body = await readJson<{ version?: unknown }>(req);
  const version = Number(body?.version);
  if (!Number.isInteger(version) || version < 1) throw new HttpError('bad_request', 'Say which version to roll back to.');
  const r = (await workspaceStub(env).rollbackSkill(params.id, version)) as unknown as { skill: SkillDetail } | { error: string };
  if ('error' in r) throw new HttpError('bad_request', r.error);
  return json<SkillDetail>(r.skill);
};

/** GET /api/chief/prompt → the Chief of Staff's prompt as the next turn would send it. */
export const handleChiefPrompt: RouteHandler = async (_req, { env }) => json<PromptView>((await workspaceStub(env).chiefPromptView()) as unknown as PromptView);

/** GET /api/models → providers, whether each is configured, and their chat models (for a coworker's model choice). */
export const handleListModels: RouteHandler = async (_req, { env }) => {
  const providers: ModelsResponse['providers'] = PROVIDERS.filter((d) => d.modalities.includes('chat')).map((d) => {
    const entry = (CHAT_CATALOG as Record<string, { models: { id: string; latencyClass: string }[] } | undefined>)[d.id];
    const models = entry ? entry.models.map((m) => ({ id: m.id, latencyClass: m.latencyClass })) : d.id === 'ollama' ? [{ id: OLLAMA_DEFAULTS.chat, latencyClass: 'fast' }] : [];
    return { id: d.id, label: d.label, configured: d.configured(env), models };
  });
  return json<ModelsResponse>({ providers });
};
