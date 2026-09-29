// Token usage at rest (D1 0004_admin.sql): a daily roll-up per surface, coworker, provider, model and capability, and
// the latest calls one by one. Writes are fire-and-forget (a call never waits on its meter); the report reads both
// and prices what the providers did not (the owner's prices per million tokens, set on the admin page).
import type { LimitUse, ModelPrice, UsageCall, UsageCapability, UsageDay, UsageResponse, UsageRow, UsageSurface } from '@headcount/protocol/ext/admin';
import { SURFACE_WORDS } from '@headcount/protocol/ext/admin';
import type { Env } from '../env';
import { utcDay } from '../media/usage';
import type { CallRecord, UsageSink } from './meter';

/** Calls kept one by one (older ones live on in the daily roll-up). */
const CALLS_KEPT = 3000;
const PRUNE_EVERY = 200;
let inserts = 0;
const pending = new Set<Promise<unknown>>();

const wsOf = (env: Pick<Env, 'WORKSPACE_ID'>) => env.WORKSPACE_ID || 'local';

/** A sink that writes each call to D1 (in the background; failures are dropped, never the call). */
export function d1Sink(env: Env): UsageSink {
  return (r: CallRecord) => {
    const ws = wsOf(env);
    const day = utcDay(new Date(r.at));
    const priced = r.usd !== null ? 1 : 0;
    const stmts = [
      env.DB.prepare(
        `INSERT INTO model_usage (ws_id, day, surface, agent_id, provider, model, capability, calls, errors, input, output, cached, usd, usd_calls, ms, first_ms, first_calls)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (ws_id, day, surface, agent_id, provider, model, capability) DO UPDATE SET
           calls = calls + 1, errors = errors + excluded.errors, input = input + excluded.input, output = output + excluded.output,
           cached = cached + excluded.cached, usd = usd + excluded.usd, usd_calls = usd_calls + excluded.usd_calls, ms = ms + excluded.ms,
           first_ms = first_ms + excluded.first_ms, first_calls = first_calls + excluded.first_calls`,
      ).bind(ws, day, r.surface, r.agentId, r.provider, r.model, r.capability, r.ok ? 0 : 1, r.input, r.output, r.cached, r.usd ?? 0, priced, r.ms, r.firstMs ?? 0, r.firstMs !== undefined ? 1 : 0),
      env.DB.prepare('INSERT INTO model_calls (ws_id, at, surface, agent_id, project_id, provider, model, capability, input, output, cached, usd, ms, first_ms, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
        ws,
        new Date(r.at).toISOString(),
        r.surface,
        r.agentId,
        r.projectId,
        r.provider,
        r.model,
        r.capability,
        r.input,
        r.output,
        r.cached,
        r.usd,
        r.ms,
        r.firstMs ?? null,
        r.ok ? 1 : 0,
        r.error ?? null,
      ),
    ];
    if (++inserts % PRUNE_EVERY === 0)
      stmts.push(env.DB.prepare('DELETE FROM model_calls WHERE ws_id = ? AND id <= (SELECT id FROM model_calls WHERE ws_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)').bind(ws, ws, CALLS_KEPT));
    const p = env.DB.batch(stmts)
      .catch(() => undefined)
      .finally(() => pending.delete(p));
    pending.add(p);
  };
}

/** Tests: wait for every meter write in flight. */
export async function flushUsage(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

type SumRow = {
  day: string;
  surface: string;
  agent_id: string;
  provider: string;
  model: string;
  capability: string;
  calls: number;
  errors: number;
  input: number;
  output: number;
  cached: number;
  usd: number;
  usd_calls: number;
  ms: number;
  first_ms: number;
  first_calls: number;
};

type PriceRow = { provider: string; model: string; input: number; output: number; cached: number | null };

/** What one roll-up row cost: as the provider reported it, else at the owner's price, else unknown. */
function costOf(r: SumRow, prices: Map<string, ModelPrice>): number | null {
  if (r.calls > 0 && r.usd_calls >= r.calls) return r.usd;
  const p = prices.get(`${r.provider}\u0000${r.model}`) ?? prices.get(`${r.provider}\u0000*`);
  if (p) return ((r.input - r.cached) * p.input + r.cached * (p.cached ?? p.input) + r.output * p.output) / 1e6 + (r.usd_calls > 0 ? r.usd : 0);
  return r.usd_calls > 0 ? r.usd : null;
}

interface Acc {
  calls: number;
  errors: number;
  input: number;
  output: number;
  cached: number;
  usd: number;
  pricedCalls: number;
  anyCost: boolean;
  ms: number;
  firstMs: number;
  firstCalls: number;
}

const empty = (): Acc => ({ calls: 0, errors: 0, input: 0, output: 0, cached: 0, usd: 0, pricedCalls: 0, anyCost: false, ms: 0, firstMs: 0, firstCalls: 0 });

function add(a: Acc, r: SumRow, cost: number | null): void {
  a.calls += r.calls;
  a.errors += r.errors;
  a.input += r.input;
  a.output += r.output;
  a.cached += r.cached;
  a.ms += r.ms;
  a.firstMs += r.first_ms;
  a.firstCalls += r.first_calls;
  if (cost !== null) {
    a.usd += cost;
    a.pricedCalls += r.calls;
    a.anyCost = true;
  }
}

const rowOf = (key: string, label: string, a: Acc): UsageRow => ({
  key,
  label,
  calls: a.calls,
  errors: a.errors,
  input: a.input,
  output: a.output,
  cached: a.cached,
  usd: a.anyCost ? Math.round(a.usd * 10_000) / 10_000 : null,
  priced: a.calls ? a.pricedCalls / a.calls : 0,
  avgMs: a.calls ? Math.round(a.ms / a.calls) : 0,
  avgFirstMs: a.firstCalls ? Math.round(a.firstMs / a.firstCalls) : 0,
});

export async function listPrices(env: Env): Promise<ModelPrice[]> {
  const rows = (await env.DB.prepare('SELECT provider, model, input, output, cached FROM model_prices WHERE ws_id = ? ORDER BY provider, model').bind(wsOf(env)).all<PriceRow>()).results ?? [];
  return rows.map((r) => ({ provider: r.provider, model: r.model, input: r.input, output: r.output, ...(r.cached !== null ? { cached: r.cached } : {}) }));
}

export async function savePrices(env: Env, prices: readonly ModelPrice[]): Promise<void> {
  const ws = wsOf(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM model_prices WHERE ws_id = ?').bind(ws),
    ...prices.map((p) => env.DB.prepare('INSERT INTO model_prices (ws_id, provider, model, input, output, cached) VALUES (?, ?, ?, ?, ?, ?)').bind(ws, p.provider, p.model, p.input, p.output, p.cached ?? null)),
  ]);
}

/** The usage report for the last `days` days (UTC), with today's use of each limit. */
export async function usageReport(env: Env, days: number, opts: { names: (agentId: string) => string; limits: LimitUse[]; now?: number }): Promise<UsageResponse> {
  const now = opts.now ?? Date.now();
  const since = utcDay(new Date(now - (days - 1) * 86_400_000));
  const ws = wsOf(env);
  const [sums, calls, prices] = await Promise.all([
    env.DB.prepare('SELECT * FROM model_usage WHERE ws_id = ? AND day >= ?').bind(ws, since).all<SumRow>(),
    env.DB.prepare('SELECT * FROM model_calls WHERE ws_id = ? AND at >= ? ORDER BY id DESC LIMIT 60').bind(ws, `${since}T00:00:00.000Z`).all<Record<string, unknown>>(),
    listPrices(env),
  ]);
  const priceMap = new Map(prices.map((p) => [`${p.provider}\u0000${p.model}`, p]));
  const total = empty();
  const byDay = new Map<string, Acc>();
  const bySurface = new Map<string, Acc>();
  const byAgent = new Map<string, Acc>();
  const byModel = new Map<string, Acc>();
  const bump = (m: Map<string, Acc>, k: string, r: SumRow, cost: number | null) => {
    let a = m.get(k);
    if (!a) m.set(k, (a = empty()));
    add(a, r, cost);
  };
  for (const r of sums.results ?? []) {
    const cost = costOf(r, priceMap);
    add(total, r, cost);
    bump(byDay, r.day, r, cost);
    bump(bySurface, r.surface, r, cost);
    if (r.agent_id) bump(byAgent, r.agent_id, r, cost);
    bump(byModel, `${r.provider}\u0000${r.model}\u0000${r.capability}`, r, cost);
  }
  const sorted = (m: Map<string, Acc>, label: (k: string) => string) =>
    [...m.entries()].map(([k, a]) => rowOf(k, label(k), a)).sort((a, b) => b.input + b.output - (a.input + a.output) || b.calls - a.calls);
  const dayList: UsageDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = utcDay(new Date(now - i * 86_400_000));
    const a = byDay.get(d) ?? empty();
    dayList.push({ day: d, calls: a.calls, input: a.input, output: a.output, usd: a.anyCost ? Math.round(a.usd * 10_000) / 10_000 : null });
  }
  const recent: UsageCall[] = (calls.results ?? []).map((c) => {
    const provider = String(c.provider);
    const model = String(c.model);
    const input = Number(c.input);
    const output = Number(c.output);
    const cached = Number(c.cached);
    const p = priceMap.get(`${provider}\u0000${model}`) ?? priceMap.get(`${provider}\u0000*`);
    const usd = c.usd !== null && c.usd !== undefined ? Number(c.usd) : p ? ((input - cached) * p.input + cached * (p.cached ?? p.input) + output * p.output) / 1e6 : null;
    const agentId = String(c.agent_id ?? '');
    return {
      at: String(c.at),
      surface: c.surface as UsageSurface,
      ...(agentId ? { agentId, agentName: opts.names(agentId) } : {}),
      ...(c.project_id ? { projectId: String(c.project_id) } : {}),
      provider,
      model,
      capability: c.capability as UsageCapability,
      input,
      output,
      cached,
      usd: usd === null ? null : Math.round(usd * 1_000_000) / 1_000_000,
      ms: Number(c.ms),
      ...(c.first_ms !== null && c.first_ms !== undefined ? { firstMs: Number(c.first_ms) } : {}),
      ok: Number(c.ok) === 1,
      ...(c.error ? { error: String(c.error) } : {}),
    };
  });
  return {
    days,
    since,
    total: rowOf('total', 'Everything', total),
    byDay: dayList,
    bySurface: sorted(bySurface, (k) => SURFACE_WORDS[k as UsageSurface] ?? k),
    byAgent: sorted(byAgent, opts.names),
    byModel: sorted(byModel, (k) => {
      const [provider, model, capability] = k.split('\u0000');
      return `${model || provider} · ${provider}${capability !== 'chat' ? ` (${capability})` : ''}`;
    }),
    recent,
    limits: opts.limits,
    prices,
  };
}
