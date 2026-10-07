// The office's own name for the agents' instructions ("Amethyst & Co (the owner's AI office)"): read from D1 (orgs),
// cleaned (cleanOfficeName: only name characters, a length cap), cached per isolate for a minute. A rename forgets it.
import { BRAND } from '@headcount/protocol';
import { cleanOfficeName, officeLabel } from '@headcount/protocol/ext/orgs';
import type { Env } from '../env';

const TTL_MS = 60_000;
const cache = new Map<string, { name: string; at: number }>();

/** The office's name (or the product's), fetched when the cached one is older than a minute. */
export async function officeName(env: Pick<Env, 'DB' | 'WORKSPACE_ID'>): Promise<string> {
  const ws = env.WORKSPACE_ID || 'local';
  const hit = cache.get(ws);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.name;
  const row = await env.DB.prepare('SELECT name FROM orgs WHERE org_id = ?')
    .bind(ws)
    .first<string>('name')
    .catch(() => null);
  const name = cleanOfficeName(row) || BRAND.name;
  cache.set(ws, { name, at: Date.now() });
  return name;
}

/** The last known name without waiting (the product's until the first fetch). */
export function cachedOfficeName(env: Pick<Env, 'WORKSPACE_ID'>): string {
  return cache.get(env.WORKSPACE_ID || 'local')?.name ?? BRAND.name;
}

/** For the agents: the name with what it means, in brackets. */
export const officeLabelOf = (name: string): string => officeLabel(name, BRAND.name);

export function forgetOfficeName(ws: string): void {
  cache.delete(ws);
}
