// Anti-repetition memory (§5.3, E1): per agent, a list of recent lines across intents (newest first, for openers
// and the cross-agent text window), a ring per intent (so a morning's quips and greetings survive an hour of
// acknowledgements) and per-day use counts for the last seven owner-local days (daily and weekly caps, weekly
// wear-out). Serialisable so the WorkspaceDO and the client can share it (`expr.recent`).
import type { RecencyMemory, RecencySnapshot, RecentEntry } from './types';
import type { IntentId } from './vocab';

const WEEK_DAYS = 7;

/** Whole days from `a` to `b` (YYYY-MM-DD); NaN for malformed keys. */
function dayDiff(a: string, b: string): number {
  const pa = Date.parse(`${a}T00:00:00Z`);
  const pb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((pb - pa) / 86_400_000);
}

const byNewest = (a: RecentEntry, b: RecentEntry) => b.at - a.at;

export function createRecencyMemory(opts?: { capacity?: number; intentCapacity?: number; snapshot?: RecencySnapshot }): RecencyMemory {
  const capacity = Math.max(1, Math.floor(opts?.capacity ?? 40));
  const intentCapacity = Math.max(1, Math.floor(opts?.intentCapacity ?? 32));
  const agents = new Map<string, RecentEntry[]>();
  const rings = new Map<string, Map<IntentId, RecentEntry[]>>();
  /** agent → day → line → uses (days within the last seven of `day`). */
  const weekly = new Map<string, Map<string, Map<string, number>>>();
  let day = '';

  const prune = () => {
    if (!day) return;
    for (const days of weekly.values()) {
      for (const d of [...days.keys()]) {
        const diff = dayDiff(d, day);
        if (!(diff >= 0 && diff < WEEK_DAYS)) days.delete(d);
      }
    }
  };
  const rollDay = (dayKey: string) => {
    if (!dayKey || dayKey === day) return;
    if (!day || dayKey > day) {
      day = dayKey;
      prune();
    }
  };
  const inWindow = (d: string) => {
    if (!day) return true;
    const diff = dayDiff(d, day);
    return diff >= 0 && diff < WEEK_DAYS;
  };
  const bump = (agentId: string, dayKey: string, lineId: string, n: number, mode: 'add' | 'max') => {
    if (!dayKey || !inWindow(dayKey)) return;
    const days = weekly.get(agentId) ?? new Map<string, Map<string, number>>();
    const counts = days.get(dayKey) ?? new Map<string, number>();
    counts.set(lineId, mode === 'add' ? (counts.get(lineId) ?? 0) + n : Math.max(counts.get(lineId) ?? 0, n));
    days.set(dayKey, counts);
    weekly.set(agentId, days);
  };
  const pushRing = (agentId: string, e: RecentEntry) => {
    const byIntent = rings.get(agentId) ?? new Map<IntentId, RecentEntry[]>();
    const list = byIntent.get(e.intent) ?? [];
    if (!list.some((x) => x.lineId === e.lineId && x.at === e.at)) list.push({ ...e });
    list.sort(byNewest);
    if (list.length > intentCapacity) list.length = intentCapacity;
    byIntent.set(e.intent, list);
    rings.set(agentId, byIntent);
  };
  const pushRecent = (agentId: string, e: RecentEntry) => {
    const list = agents.get(agentId) ?? [];
    if (!list.some((x) => x.lineId === e.lineId && x.at === e.at)) list.push({ ...e });
    list.sort(byNewest);
    if (list.length > capacity) list.length = capacity;
    agents.set(agentId, list);
  };

  const mem: RecencyMemory = {
    recent(agentId: string): readonly RecentEntry[] {
      return agents.get(agentId) ?? [];
    },
    recentFor(agentId: string, intent: IntentId): readonly RecentEntry[] {
      return rings.get(agentId)?.get(intent) ?? [];
    },
    record(agentId: string, entry: RecentEntry, dayKey: string): void {
      pushRecent(agentId, entry);
      pushRing(agentId, entry);
      rollDay(dayKey);
      bump(agentId, dayKey, entry.lineId, 1, 'add');
    },
    usesToday(agentId: string, lineId: string, dayKey: string): number {
      return weekly.get(agentId)?.get(dayKey)?.get(lineId) ?? 0;
    },
    usesWeek(agentId: string, lineId: string, dayKey: string): number {
      const days = weekly.get(agentId);
      if (!days) return 0;
      let n = 0;
      for (const [d, counts] of days) {
        const diff = dayDiff(d, dayKey);
        if (diff >= 0 && diff < WEEK_DAYS) n += counts.get(lineId) ?? 0;
      }
      return n;
    },
    recentText(textHash: number, now: number, windowMs: number): boolean {
      for (const list of agents.values()) {
        for (const e of list) {
          if (now - e.at > windowMs) break; // newest first
          if (e.textHash === textHash && e.at <= now) return true;
        }
      }
      return false;
    },
    merge(snapshot: RecencySnapshot): void {
      if (!snapshot || (snapshot.v !== 1 && snapshot.v !== 2)) return;
      for (const [agentId, entries] of Object.entries(snapshot.agents ?? {})) {
        for (const e of entries ?? []) {
          pushRecent(agentId, e);
          if (snapshot.v === 1 || !snapshot.intents) pushRing(agentId, e);
        }
      }
      for (const [agentId, byIntent] of Object.entries(snapshot.intents ?? {})) {
        for (const entries of Object.values(byIntent ?? {})) for (const e of entries ?? []) pushRing(agentId, e);
      }
      rollDay(snapshot.day);
      for (const [agentId, days] of Object.entries(snapshot.weekly ?? {})) {
        for (const [d, counts] of Object.entries(days ?? {})) for (const [lineId, n] of Object.entries(counts ?? {})) bump(agentId, d, lineId, n, 'max');
      }
      if (snapshot.day) {
        for (const [agentId, counts] of Object.entries(snapshot.daily ?? {})) {
          for (const [lineId, n] of Object.entries(counts ?? {})) bump(agentId, snapshot.day, lineId, n, 'max');
        }
      }
    },
    snapshot(): RecencySnapshot {
      const a: Record<string, RecentEntry[]> = {};
      for (const [k, v] of agents) a[k] = v.map((e) => ({ ...e }));
      const intents: Record<string, Partial<Record<IntentId, RecentEntry[]>>> = {};
      for (const [k, byIntent] of rings) {
        const o: Partial<Record<IntentId, RecentEntry[]>> = {};
        for (const [intent, list] of byIntent) o[intent] = list.map((e) => ({ ...e }));
        intents[k] = o;
      }
      const w: Record<string, Record<string, Record<string, number>>> = {};
      const d: Record<string, Record<string, number>> = {};
      for (const [k, days] of weekly) {
        w[k] = {};
        for (const [dk, counts] of days) w[k][dk] = Object.fromEntries(counts);
        const today = days.get(day);
        if (today) d[k] = Object.fromEntries(today);
      }
      return { v: 2, day, agents: a, daily: d, intents, weekly: w };
    },
  };
  if (opts?.snapshot) mem.merge(opts.snapshot);
  return mem;
}
