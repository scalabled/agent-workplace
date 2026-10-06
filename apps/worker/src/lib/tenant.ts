// Tenancy: every organization is a workspace, and the code below a request (routes, Durable Objects, D1, R2) reads
// its workspace id from env.WORKSPACE_ID. A request runs with the signed-in person's organization in that slot; a
// Durable Object reads its organization from its own name (ws:<id>, p:everyday:<id>, run:expr-prevoice:<id>) and keeps
// it, so an alarm that fires without a name still knows whose it is. The deployment's own WORKSPACE_ID stays known as
// HOME_WORKSPACE_ID: the home organization, whose owners are named in OWNER_EMAILS.
import { DEFAULT_WORKSPACE_ID } from '@headcount/protocol';
import type { Env } from '../env';

/** The deployment's own workspace (the home organization). */
export function homeWorkspace(env: Pick<Env, 'WORKSPACE_ID' | 'HOME_WORKSPACE_ID'>): string {
  return env.HOME_WORKSPACE_ID || env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID;
}

/** The same environment, working for another organization. */
export function withTenant<E extends Pick<Env, 'WORKSPACE_ID' | 'HOME_WORKSPACE_ID'>>(env: E, ws: string): E {
  const home = homeWorkspace(env);
  if (ws === (env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID) && env.HOME_WORKSPACE_ID) return env;
  return { ...env, WORKSPACE_ID: ws, HOME_WORKSPACE_ID: home };
}

const TENANT_SCHEMA = 'CREATE TABLE IF NOT EXISTS hc_tenant (k TEXT PRIMARY KEY, v TEXT NOT NULL)';

/**
 * The organization a Durable Object belongs to: from its name when the caller used idFromName (always, in this code),
 * else what it kept the first time, else the deployment's own workspace (an object from before organizations).
 */
export function tenantOf(ctx: DurableObjectState, env: Pick<Env, 'WORKSPACE_ID'>, prefix: string): string {
  const name = (ctx.id as DurableObjectId & { name?: string }).name;
  const sql = ctx.storage.sql;
  sql.exec(TENANT_SCHEMA);
  const kept = sql.exec<{ v: string }>(`SELECT v FROM hc_tenant WHERE k = 'ws'`).toArray()[0]?.v;
  const named = name && name.startsWith(prefix) ? name.slice(prefix.length) : null;
  const ws = named || kept || env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID;
  if (ws !== kept) sql.exec(`INSERT OR REPLACE INTO hc_tenant (k, v) VALUES ('ws', ?)`, ws);
  return ws;
}
