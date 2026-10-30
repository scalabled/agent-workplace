// Small talk in the office: the huddle engine over the bundle's packs, silent until the living
// runtime is ready, `avoid` from the exchanges already played, recency recorded only once a line was seen.
import bundle from '@headcount/expressions/bundle';
import { fixtureCatalog, PROFILES } from '@headcount/expressions/testing';
import type { AgentExpressionProfile } from '@headcount/expressions';
import type { HuddleLineRequest } from '@headcount/office';
import { CHIEF_ID } from '@headcount/protocol';
import type { ExprAgentProfile } from '@headcount/protocol/ext/expressions';
import { describe, expect, it, vi } from 'vitest';
import type { LivingRuntime } from '../living/types';
import { createHuddleLines, HUDDLE_RECENCY_KEY, WARM_TRIES, type HuddlePersonInfo } from './huddles';

const catalog = fixtureCatalog();
const profiles: Record<string, AgentExpressionProfile> = {
  'cw_red-team-sceptic': PROFILES.ruth,
  'cw_data-analyst': PROFILES.camila,
  'cw_tech-lead': PROFILES.jelena,
};

function runtime(): LivingRuntime {
  return {
    catalog,
    huddles: bundle.huddles ?? null,
    moodOf: () => null,
    provider: () => 'mock',
    profileOf: () => null,
    ensureAgent: async () => false,
  } as unknown as LivingRuntime;
}

const person = (id: string): HuddlePersonInfo | null => {
  const p = profiles[id];
  if (!p) return null;
  return { firstName: p.firstName, groupId: id === 'cw_tech-lead' ? 'engineering' : 'data', isChief: false, teamRoles: [], pairsWellWith: [], tensionWith: [], profile: p as unknown as ExprAgentProfile };
};

const req = (over: Partial<HuddleLineRequest> = {}): HuddleLineRequest => ({
  huddleId: 'hd:2026-09-29:cooler:cafe:635',
  spot: { id: 'cooler:cafe', kind: 'water_cooler' },
  participants: ['cw_red-team-sceptic', 'cw_data-analyst', 'cw_tech-lead'],
  exchangeIndex: 0,
  maxLines: 4,
  seed: 'hd:2026-09-29:cooler:cafe:635|0|0',
  at: new Date(2026, 8, 29, 10, 35),
  ambience: 'lively',
  listening: false,
  contexts: [],
  previous: [],
  ...over,
});

function rig(living: LivingRuntime | null = runtime()) {
  let rt = living;
  const store = new Map<string, string>();
  const storage = { getItem: vi.fn((k: string) => store.get(k) ?? null), setItem: vi.fn((k: string, v: string) => void store.set(k, v)) };
  const timers: (() => void)[] = [];
  const lines = createHuddleLines({
    living: () => rt,
    person,
    chiefName: () => 'Eddie',
    grounding: () => null,
    storage,
    schedule: (fn) => {
      timers.push(fn);
      return () => undefined;
    },
    idle: (fn) => {
      fn();
      return () => undefined;
    },
  });
  return { lines, storage, store, timers, setRuntime: (x: LivingRuntime | null) => (rt = x) };
}

describe('the office small-talk provider', () => {
  it('is silent until the living runtime is ready, then compiles and picks from the bundle', () => {
    const r = rig(null);
    expect(r.lines.lines(req())).toBeNull();
    r.lines.warm();
    expect(r.lines.ready()).toBe(false);
    r.setRuntime(runtime());
    const script = r.lines.lines(req());
    expect(r.lines.ready()).toBe(true);
    expect(script).not.toBeNull();
    expect(script!.lines.length).toBeGreaterThan(0);
    for (const l of script!.lines) expect(req().participants).toContain(l.personId);
    expect(r.lines.pickOf(script!.exchangeId)?.exchangeId).toBe(script!.exchangeId);
    r.lines.destroy();
  });

  it('stops looking for a runtime that never starts (no timer left running), and still compiles on the first line later', () => {
    const r = rig(null);
    r.lines.warm();
    let runs = 0;
    while (r.timers.length && runs < 1000) {
      r.timers.shift()!();
      runs++;
    }
    expect(runs).toBe(WARM_TRIES - 1);
    expect(r.timers).toHaveLength(0);
    r.setRuntime(runtime());
    expect(r.lines.lines(req())).not.toBeNull();
    r.lines.destroy();
  });

  it('never repeats an exchange already played in this huddle (avoid from previous)', () => {
    const r = rig();
    const first = r.lines.lines(req())!;
    const second = r.lines.lines(req({ previous: [first.exchangeId] }))!;
    expect(second).not.toBeNull();
    expect(second.exchangeId).not.toBe(first.exchangeId);
    r.lines.destroy();
  });

  it('needs two people it knows; the Chief is cast with the rest', () => {
    const r = rig();
    expect(r.lines.lines(req({ participants: ['cw_tech-lead', 'cw_nobody'] }))).toBeNull();
    const withChief = createHuddleLines({
      living: runtime,
      person: (id) => (id === CHIEF_ID ? { ...person('cw_tech-lead')!, firstName: 'Eddie', isChief: true, profile: PROFILES.chief as unknown as ExprAgentProfile } : person(id)),
      chiefName: () => 'Eddie',
      grounding: () => null,
    });
    expect(withChief.lines(req({ participants: [CHIEF_ID, 'cw_data-analyst'] }))).not.toBeNull();
    r.lines.destroy();
    withChief.destroy();
  });

  it('records recency only when a line of the pick was seen, once, and saves it debounced', () => {
    const r = rig();
    const s = r.lines.lines(req())!;
    expect(r.storage.setItem).not.toHaveBeenCalled();
    expect(r.timers).toHaveLength(0);
    r.lines.shown(s.exchangeId, new Date(2026, 8, 29, 10, 36).getTime());
    r.lines.shown(s.exchangeId, new Date(2026, 8, 29, 10, 36).getTime());
    expect(r.timers).toHaveLength(1);
    r.timers[0]!();
    const saved = JSON.parse(r.store.get(HUDDLE_RECENCY_KEY)!) as { uses: Record<string, unknown[]> };
    expect(Object.keys(saved.uses)).toEqual([s.exchangeId]);
    expect(saved.uses[s.exchangeId]).toHaveLength(1);
    // A new provider (a reload) starts from the saved recency.
    const again = rig();
    again.store.set(HUDDLE_RECENCY_KEY, r.store.get(HUDDLE_RECENCY_KEY)!);
    r.lines.shown('never-picked', Date.now());
    expect(r.timers).toHaveLength(1);
    r.lines.destroy();
    again.lines.destroy();
  });
});
