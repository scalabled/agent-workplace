// Settings changed on the admin page (ext/admin.ts CONFIG_OPTIONS), layered over the deployment's environment. The
// values live in D1 (`settings_kv`, keys sealed with the connector secret) and are read into a per-isolate cache;
// `configured(env)` wraps an Env so every existing `env.X` read sees them — the worker, every Durable Object, the
// model registry — with no call site changing. A change applies here at once and everywhere else within seconds.
// Only editable keys can be overridden: sign-in, allowed origins, the secrets and the workspace id never can.
import { CONFIG_OPTIONS, EDITABLE_KEYS, type ConfigOption, type ConfigValue, PLATFORM_KEYS } from '@headcount/protocol/ext/admin';
import { homeWorkspace } from '../lib/tenant';
import { connectorSecret, openToken, sealToken } from '../connectors/secret';
import type { Env } from '../env';

/** How long a cached copy is used before it is read again (other isolates pick up a change within this). */
const TTL_MS = 5_000;
const RAW = Symbol('raw-env');

interface Entry {
  value: string;
  updatedAt: string;
  updatedBy: string;
}

interface Cache {
  values: Map<string, Entry>;
  at: number;
  loading: Promise<void> | null;
}

const caches = new Map<string, Cache>();
const wsOf = (env: Pick<Env, 'WORKSPACE_ID'>) => env.WORKSPACE_ID || 'local';
const cacheOf = (ws: string): Cache => {
  let c = caches.get(ws);
  if (!c) caches.set(ws, (c = { values: new Map(), at: 0, loading: null }));
  return c;
};
const aad = (key: string) => `config:${key}`;

type Row = { key: string; value: string; sealed: number; updated_at: string; updated_by: string };

/** Read the admin page's settings (cached for a few seconds unless forced). */
export async function loadConfig(env: Env, force = false): Promise<void> {
  const raw = rawEnv(env);
  const c = cacheOf(wsOf(raw));
  if (!force && Date.now() - c.at < TTL_MS) return;
  if (c.loading && !force) return c.loading;
  const work = (async () => {
    try {
      const rows = (await raw.DB.prepare('SELECT key, value, sealed, updated_at, updated_by FROM settings_kv WHERE ws_id = ?').bind(wsOf(raw)).all<Row>()).results ?? [];
      const secret = connectorSecret(raw);
      const next = new Map<string, Entry>();
      const locked = lockedKeys(raw);
      for (const r of rows) {
        if (!EDITABLE_KEYS.has(r.key) || locked.has(r.key)) continue;
        const value = r.sealed ? (secret ? await openToken(secret, aad(r.key), r.value) : null) : r.value;
        if (value !== null) next.set(r.key, { value, updatedAt: r.updated_at, updatedBy: r.updated_by });
      }
      c.values = next;
      c.at = Date.now();
    } catch {
      // No table yet (an unmigrated database) or D1 unavailable: the deployment's values stand.
      c.at = Date.now();
    } finally {
      c.loading = null;
    }
  })();
  c.loading = work;
  return work;
}

/** The environment as deployed, without the admin page's settings. */
export function rawEnv<E extends Env>(env: E): E {
  return ((env as unknown as Record<symbol, E>)[RAW] ?? env) as E;
}

/** The Env with the admin page's settings over it (refreshing in the background when stale). */
export function configured<E extends Env>(env: E): E {
  if ((env as unknown as Record<symbol, unknown>)[RAW]) return env;
  const ws = wsOf(env);
  const override = (key: string | symbol): Entry | undefined => {
    if (typeof key !== 'string' || !EDITABLE_KEYS.has(key)) return undefined;
    const c = cacheOf(ws);
    if (Date.now() - c.at >= TTL_MS && !c.loading) void loadConfig(env);
    return c.values.get(key);
  };
  return new Proxy(env, {
    get(target, key, receiver) {
      if (key === RAW) return target;
      const o = override(key);
      return o ? o.value : Reflect.get(target, key, receiver);
    },
    has(target, key) {
      return !!override(key) || Reflect.has(target, key);
    },
    ownKeys(target) {
      return [...new Set([...Reflect.ownKeys(target), ...cacheOf(ws).values.keys()])];
    },
    getOwnPropertyDescriptor(target, key) {
      const o = override(key);
      return o ? { value: o.value, writable: false, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
}

/** Keys this organization may not change: the platform's, for every organization but the home one. */
export function lockedKeys(env: Env): ReadonlySet<string> {
  const raw = rawEnv(env);
  return wsOf(raw) === homeWorkspace(raw) ? new Set() : PLATFORM_KEYS;
}

/** Every option with the value in effect and where it comes from (secrets never leave). */
export async function configView(env: Env): Promise<{ values: ConfigValue[]; canStoreKeys: boolean }> {
  const raw = rawEnv(env);
  await loadConfig(raw, true);
  const c = cacheOf(wsOf(raw));
  const locked = lockedKeys(raw);
  const values = CONFIG_OPTIONS.map((o): ConfigValue => {
    const admin = c.values.get(o.key);
    const deployed = (raw as unknown as Record<string, unknown>)[o.key];
    const dep = typeof deployed === 'string' && deployed !== '' ? deployed : null;
    const value = admin?.value ?? dep ?? o.fallback;
    const source = admin ? 'admin' : dep !== null ? 'deployment' : 'default';
    const meta = admin ? { updatedAt: admin.updatedAt, ...(admin.updatedBy ? { updatedBy: admin.updatedBy } : {}) } : {};
    const lock = locked.has(o.key) ? { locked: true } : {};
    return o.kind === 'secret' ? { key: o.key, value: '', source, set: !!(admin?.value || dep), ...meta, ...lock } : { key: o.key, value, source, ...meta, ...lock };
  });
  return { values, canStoreKeys: connectorSecret(raw) !== null };
}

export class ConfigError extends Error {}

/** Check one value against its option; returns the value to store. */
export function validate(o: ConfigOption, v: string): string {
  const value = v.trim();
  switch (o.kind) {
    case 'number': {
      const n = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(n)) throw new ConfigError(`${o.label}: use a whole number.`);
      if ((o.min !== undefined && n < o.min) || (o.max !== undefined && n > o.max)) throw new ConfigError(`${o.label}: use a number from ${o.min ?? 0} to ${o.max}.`);
      return String(n);
    }
    case 'switch':
      if (value !== (o.on ?? 'true') && value !== (o.off ?? '')) throw new ConfigError(`${o.label}: on or off.`);
      return value;
    case 'choice':
      if (!o.choices?.some((c) => c.value === value)) throw new ConfigError(`${o.label}: pick one of the choices.`);
      return value;
    case 'url':
      if (value && !/^https?:\/\/[^\s]+$/i.test(value)) throw new ConfigError(`${o.label}: use an address starting with http:// or https://.`);
      return value.replace(/\/+$/, '');
    case 'text':
      if (value.length > 200 || /[\u0000-\u001f]/.test(value)) throw new ConfigError(`${o.label}: keep it to one short line.`);
      return value;
    case 'secret':
      if (value.length < 8 || value.length > 512 || /\s/.test(value)) throw new ConfigError(`${o.label}: that does not look like a key.`);
      return value;
  }
}

/** Save changes from the admin page (null goes back to the deployment's value or the default). */
export async function saveConfig(env: Env, changes: Record<string, string | null>, by: string): Promise<void> {
  const raw = rawEnv(env);
  const ws = wsOf(raw);
  const byKey = new Map(CONFIG_OPTIONS.map((o) => [o.key, o]));
  const stmts: D1PreparedStatement[] = [];
  const at = new Date().toISOString();
  for (const [key, v] of Object.entries(changes)) {
    const o = byKey.get(key);
    if (!o || !EDITABLE_KEYS.has(key)) throw new ConfigError(`${o?.label ?? key} changes only with the deployment.`);
    if (lockedKeys(raw).has(key)) throw new ConfigError(`${o.label} is set by Headcount for every organization.`);
    if (v === null) {
      stmts.push(raw.DB.prepare('DELETE FROM settings_kv WHERE ws_id = ? AND key = ?').bind(ws, key));
      continue;
    }
    let value = validate(o, v);
    let sealed = 0;
    if (o.kind === 'secret') {
      const secret = connectorSecret(raw);
      if (!secret) throw new ConfigError('Keys can be saved here once the deployment has an encryption secret (CONNECTOR_SECRET).');
      value = await sealToken(secret, aad(key), value);
      sealed = 1;
    }
    stmts.push(
      raw.DB.prepare(
        'INSERT INTO settings_kv (ws_id, key, value, sealed, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (ws_id, key) DO UPDATE SET value = excluded.value, sealed = excluded.sealed, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
      ).bind(ws, key, value, sealed, at, by),
    );
  }
  if (stmts.length) await raw.DB.batch(stmts);
  await loadConfig(raw, true);
}

/** Tests: forget every cached copy. */
export function resetConfigCache(): void {
  caches.clear();
}
