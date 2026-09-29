// Admin routes (owner only, ext/admin.ts): every setting, people and their roles, token usage and prices.
import { CHIEF_ID } from '@headcount/protocol';
import { CONFIG_OPTIONS, ROLES, type ConfigPut, type LimitUse, type Member, type MemberPut, type MembersResponse, type ModelPrice, type Role } from '@headcount/protocol/ext/admin';
import { fullIndex } from '@headcount/catalog/full';
import { authMode, clearRoleCache, clearSessionCache, ownerEmails } from '../auth/auth';
import type { Env } from '../env';
import { exprLimit } from '../expr/config';
import { HttpError, json, readJson, type RouteContext, type RouteHandler } from '../lib/http';
import { dailyLimit, LIMITS, type LimitKind } from '../lib/limits';
import { projectStub, workspaceStub } from '../lib/stubs';
import { utcDay } from '../media/usage';
import { listPrices, savePrices, usageReport } from '../usage/store';
import { ConfigError, configView, saveConfig } from './config';

const wsOf = (env: Env) => env.WORKSPACE_ID || 'local';
const who = (rc: RouteContext) => rc.identity?.email || 'owner';
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export const handleAdminConfig: RouteHandler = async (_req, rc) => json(await configView(rc.env));

export const handlePutAdminConfig: RouteHandler = async (req, rc) => {
  const b = await readJson<ConfigPut>(req);
  if (!b || typeof b.values !== 'object' || b.values === null || Array.isArray(b.values)) throw new HttpError('bad_request', 'Send {values: {KEY: value or null}}.');
  const values: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(b.values)) {
    if (v !== null && typeof v !== 'string') throw new HttpError('bad_request', `${k}: send text, or null to reset it.`);
    values[k] = v;
  }
  try {
    await saveConfig(rc.env, values, who(rc));
  } catch (err) {
    if (err instanceof ConfigError) throw new HttpError('bad_request', err.message);
    throw err;
  }
  return json(await configView(rc.env));
};

type MemberRow = { email: string; name: string; role: string; added_at: string; added_by: string; last_seen_at: string | null };

async function members(env: Env): Promise<Member[]> {
  const owners = ownerEmails(env);
  const rows = (await env.DB.prepare('SELECT email, name, role, added_at, added_by, last_seen_at FROM members WHERE ws_id = ? ORDER BY added_at, rowid').bind(wsOf(env)).all<MemberRow>()).results ?? [];
  const byEmail = new Map(rows.map((r) => [r.email, r]));
  const list: Member[] = [...owners].map((email) => {
    const r = byEmail.get(email);
    return { email, role: 'owner', source: 'deployment', ...(r?.name ? { name: r.name } : {}), ...(r?.last_seen_at ? { lastSeenAt: r.last_seen_at } : {}) };
  });
  for (const r of rows)
    if (!owners.has(r.email))
      list.push({ email: r.email, role: r.role as Role, source: 'invited', addedAt: r.added_at, ...(r.name ? { name: r.name } : {}), ...(r.added_by ? { addedBy: r.added_by } : {}), ...(r.last_seen_at ? { lastSeenAt: r.last_seen_at } : {}) });
  return list;
}

export const handleListMembers: RouteHandler = async (_req, rc) => json<MembersResponse>({ members: await members(rc.env), signIn: authMode(rc.env, rc.url) === 'google' });

function memberEmail(rc: RouteContext): string {
  const email = (rc.params.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError('bad_request', 'Use their Google email address.');
  if (ownerEmails(rc.env).has(email)) throw new HttpError('conflict', 'That owner is named in the deployment (OWNER_EMAILS); their role changes with it.');
  if (rc.identity?.email && rc.identity.email === email) throw new HttpError('bad_request', 'You cannot change your own role. Ask another owner.');
  return email;
}

export const handlePutMember: RouteHandler = async (req, rc) => {
  const email = memberEmail(rc);
  const b = await readJson<MemberPut>(req);
  if (!b || !ROLES.includes(b.role)) throw new HttpError('bad_request', 'Choose a role: owner, contributor or reader.');
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
  await rc.env.DB.prepare(
    'INSERT INTO members (ws_id, email, name, role, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (ws_id, email) DO UPDATE SET role = excluded.role, name = CASE WHEN excluded.name = \'\' THEN members.name ELSE excluded.name END',
  )
    .bind(wsOf(rc.env), email, name, b.role, new Date().toISOString(), who(rc))
    .run();
  clearRoleCache();
  return json<MembersResponse>({ members: await members(rc.env), signIn: authMode(rc.env, rc.url) === 'google' });
};

export const handleRemoveMember: RouteHandler = async (_req, rc) => {
  const email = memberEmail(rc);
  const gone = await rc.env.DB.prepare('DELETE FROM members WHERE ws_id = ? AND email = ? RETURNING email').bind(wsOf(rc.env), email).first();
  if (!gone) throw new HttpError('not_found', 'They are not a member.');
  // Signed out everywhere at once.
  await rc.env.DB.prepare('DELETE FROM auth_sessions WHERE email = ?').bind(email).run();
  clearRoleCache();
  clearSessionCache();
  return json<MembersResponse>({ members: await members(rc.env), signIn: authMode(rc.env, rc.url) === 'google' });
};

const LABELS = new Map(CONFIG_OPTIONS.map((o) => [o.key, o.label]));

/** Today's use of every daily limit, wherever it is counted. */
async function limitsToday(env: Env): Promise<LimitUse[]> {
  const [ws, project, media] = await Promise.all([
    workspaceStub(env)
      .dailyCounts()
      .catch(() => ({}) as Record<string, number>),
    projectStub(env)
      .dailyCounts()
      .catch(() => ({}) as Record<string, number>),
    env.DB.prepare('SELECT kind, count FROM media_usage WHERE ws_id = ? AND day = ?')
      .bind(env.WORKSPACE_ID, utcDay())
      .all<{ kind: string; count: number }>()
      .then((r) => Object.fromEntries((r.results ?? []).map((x) => [x.kind, Number(x.count)])) as Record<string, number>)
      .catch(() => ({}) as Record<string, number>),
  ]);
  const counts: Record<string, number> = { ...media, ...project, ...ws };
  const out: LimitUse[] = (Object.keys(LIMITS) as LimitKind[]).map((k) => ({ key: LIMITS[k].env, label: LABELS.get(LIMITS[k].env) ?? LIMITS[k].what, used: Math.min(counts[k] ?? 0, dailyLimit(env, k)), limit: dailyLimit(env, k) }));
  const portrait = Number(env.PORTRAIT_DAILY_LIMIT);
  out.push({ key: 'PORTRAIT_DAILY_LIMIT', label: LABELS.get('PORTRAIT_DAILY_LIMIT')!, used: counts.portrait ?? 0, limit: env.PORTRAIT_DAILY_LIMIT && Number.isInteger(portrait) ? portrait : 200 });
  out.push({ key: 'EXPR_CLIP_DAILY_LIMIT', label: LABELS.get('EXPR_CLIP_DAILY_LIMIT')!, used: counts.expr_clip ?? 0, limit: exprLimit(env, 'clipDaily') });
  return out;
}

export const handleAdminUsage: RouteHandler = async (_req, rc) => {
  const raw = Number(rc.url.searchParams.get('days') ?? 7);
  const days = Number.isInteger(raw) && raw >= 1 && raw <= 90 ? raw : 7;
  const settings = await workspaceStub(rc.env)
    .getSettings()
    .catch(() => null);
  const chiefName = settings?.chiefName || (settings?.leadId ? fullIndex.lead(settings.leadId)?.name : undefined) || 'Chief of Staff';
  const names = (agentId: string) => (agentId === CHIEF_ID ? chiefName : agentId.startsWith('cw_') ? (fullIndex.persona(agentId.slice(3))?.name ?? agentId.slice(3)) : agentId);
  return json(await usageReport(rc.env, days, { names, limits: await limitsToday(rc.env) }));
};

export const handlePutPrices: RouteHandler = async (req, rc) => {
  const b = await readJson<{ prices?: unknown }>(req);
  if (!b || !Array.isArray(b.prices) || b.prices.length > 200) throw new HttpError('bad_request', 'Send {prices: [...]} (at most 200).');
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10_000;
  const prices: ModelPrice[] = b.prices.map((p: unknown) => {
    const x = p as Partial<ModelPrice>;
    const provider = typeof x.provider === 'string' ? x.provider.trim().slice(0, 60) : '';
    const model = typeof x.model === 'string' ? x.model.trim().slice(0, 120) : '';
    if (!provider || !model || !num(x.input) || !num(x.output) || (x.cached !== undefined && !num(x.cached))) throw new HttpError('bad_request', 'Each price needs a provider, a model (or *), and USD per million tokens in and out.');
    return { provider, model, input: x.input!, output: x.output!, ...(x.cached !== undefined ? { cached: x.cached } : {}) };
  });
  await savePrices(rc.env, prices);
  return json({ prices: await listPrices(rc.env) });
};
