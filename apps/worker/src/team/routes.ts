// Your team (ext/team.ts): who is on it, their first jobs, and the weekly tidy of the company's second brain.
import { isSection } from '../memory/handbook';
import type { TeamResponse, TeamStartResponse } from '@headcount/protocol/ext/team';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { workspaceStub } from '../lib/stubs';

const isPersonaId = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,80}$/.test(s);

export const handleGetTeam: RouteHandler = async (_req, { env }) => json<TeamResponse>((await workspaceStub(env).teamView()) as unknown as TeamResponse);

export const handlePutTeam: RouteHandler = async (req, { env }) => {
  const b = await readJson<{ members?: unknown }>(req);
  if (!b || !Array.isArray(b.members) || !b.members.every(isPersonaId)) throw new HttpError('bad_request', 'Send {members: [personaId, …]}.');
  const r = (await workspaceStub(env).teamPut(b.members)) as unknown as TeamResponse | { error: string };
  if ('error' in r) throw new HttpError('bad_request', r.error);
  return json<TeamResponse>(r);
};

export const handleStartTeamTask: RouteHandler = async (_req, { env, params }) => {
  if (!isPersonaId(params.personaId)) throw new HttpError('not_found', 'No such coworker.');
  const r = (await workspaceStub(env).teamStart(params.personaId)) as unknown as TeamStartResponse | { error: string; code: 'not_found' | 'rate_limited' | 'conflict' };
  if ('error' in r) throw new HttpError(r.code, r.error);
  return json<TeamStartResponse>(r, { status: 202 });
};

export const handlePutSecondBrain: RouteHandler = async (req, { env }) => {
  const b = await readJson<{ on?: unknown }>(req);
  if (typeof b?.on !== 'boolean') throw new HttpError('bad_request', 'Send {on: true or false}.');
  return json<TeamResponse>((await workspaceStub(env).secondBrainSet(b.on)) as unknown as TeamResponse);
};

export const handleApplyHandbookSuggestion: RouteHandler = async (req, { env }) => {
  const b = await readJson<{ section?: unknown; suggestion?: unknown }>(req);
  if (!b || !isSection(b.section) || typeof b.suggestion !== 'string' || !b.suggestion.trim() || b.suggestion.length > 4000) throw new HttpError('bad_request', 'Send {section, suggestion}.');
  return json<TeamResponse>((await workspaceStub(env).secondBrainApply(b.section, b.suggestion.trim())) as unknown as TeamResponse);
};
