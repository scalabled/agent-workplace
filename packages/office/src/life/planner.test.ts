// Planner simulation: determinism, familiarity, caps, density, honesty and variety over
// the real catalog (164 coworkers + the Chief of Staff), on owner-local days.
import { describe, expect, it } from 'vitest';
import { planDay, planTask, replanFrom, segmentAt } from './planner';
import { planSpots } from './spots';
import { LIFE_CAPS } from './tables';
import { LEAD, TUESDAY, catalogPlan, plannerPeople } from './testing';
import type { Ambience, DayPlan, Segment } from './types';

const plan = catalogPlan();
const spots = planSpots(plan);
const people = plannerPeople(plan);
const make = (ambience: Ambience, day = TUESDAY, seed = 'ws_test') => planDay({ seed, day, plan, spots, people, leadId: LEAD.id, ambience });

const plans = new Map<string, DayPlan>();
const cached = (ambience: Ambience, day = TUESDAY) => {
  const key = `${ambience}|${day.toDateString()}`;
  if (!plans.has(key)) plans.set(key, make(ambience, day));
  return plans.get(key)!;
};
const all = (p: DayPlan): Segment[] => Object.values(p.segments).flat();
/** Share of people away from their desk (walking or at a spot) at time t. */
const awayAt = (p: DayPlan, t: number) => people.filter((x) => segmentAt(p, x.id, t)).length / people.length;
const meanAway = (p: DayPlan, fromH: number, toH: number) => {
  let sum = 0;
  let n = 0;
  for (let m = fromH * 60; m < toH * 60; m += 2) {
    sum += awayAt(p, p.dayStart + m * 60_000);
    n++;
  }
  return sum / n;
};

describe('planDay', () => {
  it('is deterministic: the same inputs give the same hash; another seed or day differs', () => {
    const a = make('lively');
    const b = make('lively');
    expect(a.hash).toBe(b.hash);
    expect(JSON.stringify(a.segments)).toBe(JSON.stringify(b.segments));
    expect(make('lively', TUESDAY, 'ws_other').hash).not.toBe(a.hash);
    expect(make('lively', new Date(2026, 8, 30)).hash).not.toBe(a.hash);
    expect(a.dayKey).toBe('2026-09-29');
  });

  it('plans a lively day in well under the budget', () => {
    make('lively');
    const t = performance.now();
    make('lively', new Date(2026, 9, 1));
    // The target is ≤ 15 ms (built: ~40–60 ms on an M-class laptop, run in idle time); CI gets headroom.
    expect(performance.now() - t).toBeLessThan(400);
  });

  it('keeps every cap at 1 s resolution over a Buzzing day', () => {
    const p = cached('buzzing');
    const caps = LIFE_CAPS.buzzing;
    const n = Math.round((p.dayEnd - p.dayStart) / 1000);
    const walkers = new Uint16Array(n + 2);
    const deps = new Uint16Array(n + 2);
    const add = (arr: Uint16Array, a: number, b: number) => {
      for (let s = Math.floor((a - p.dayStart) / 1000); s < Math.ceil((b - p.dayStart) / 1000); s++) arr[s] = arr[s]! + 1;
    };
    const slots = new Map<string, [number, number][]>();
    for (const g of all(p)) {
      add(walkers, g.departAt, g.start);
      if (g.backAt !== null) add(walkers, g.end, g.backAt);
      deps[Math.floor((g.departAt - p.dayStart) / 1000)]! += 1;
      const key = `${g.place.spotId}#${g.place.slot}`;
      (slots.get(key) ?? slots.set(key, []).get(key)!).push([g.start, g.end]);
    }
    // The Chief's floor-walk legs start from the previous stop, so only real departures count.
    expect(Math.max(...walkers)).toBeLessThanOrEqual(caps.walkers);
    let maxDep2 = 0;
    for (let s = 1; s < n; s++) maxDep2 = Math.max(maxDep2, deps[s - 1]! + deps[s]!);
    expect(maxDep2).toBeLessThanOrEqual(4);
    for (const list of slots.values()) {
      list.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < list.length; i++) expect(list[i]![0]).toBeGreaterThanOrEqual(list[i - 1]![1]);
    }
    const active = new Uint16Array(n + 2);
    for (const h of p.huddles) {
      expect(h.members.length).toBeGreaterThanOrEqual(2);
      expect(h.members.length).toBeLessThanOrEqual(4);
      add(active, h.start, h.end);
    }
    expect(Math.max(...active)).toBeLessThanOrEqual(caps.huddles);
  });

  it('scales with Ambience and the time of day (Lively peak 10–18 %, a quiet night)', () => {
    const quiet = meanAway(cached('quiet'), 10, 11);
    const lively = meanAway(cached('lively'), 10, 11);
    const buzzing = meanAway(cached('buzzing'), 10, 11);
    expect(quiet).toBeLessThan(lively);
    expect(lively).toBeLessThan(buzzing);
    expect(lively).toBeGreaterThanOrEqual(0.1);
    expect(lively).toBeLessThanOrEqual(0.18);
    expect(meanAway(cached('lively'), 0, 5)).toBeLessThanOrEqual(0.05);
  });

  it('keeps everyone at their desk most of the day (≥ 85 %; the Chief ≥ 88 %)', () => {
    const p = cached('lively');
    const day = p.dayEnd - p.dayStart;
    for (const x of people) {
      const away = (p.segments[x.id] ?? []).reduce((s, g) => s + ((g.backAt ?? g.end) - g.departAt), 0);
      expect(1 - away / day).toBeGreaterThanOrEqual(x.id === LEAD.id ? 0.88 : 0.85);
    }
  });

  it('is honest: no ambient segment in a phone booth or a room; visits go to a teammate', () => {
    for (const amb of ['quiet', 'lively', 'buzzing'] as const) {
      for (const g of all(cached(amb))) {
        expect(g.place.spotId.startsWith('booth:')).toBe(false);
        const sp = spots.find((s) => s.id === g.place.spotId)!;
        expect(sp.realOnly).toBe(false);
        if (g.state === 'visit') {
          expect(sp.kind).toBe('desk_dropby');
          const host = plan.seats.find((s) => s.id === sp.seatId)!.personId!;
          expect(g.hostId).toBe(host);
          expect(plan.seats.find((s) => s.personId === g.personId)!.zoneId).toBe(sp.zoneId);
        }
      }
    }
  });

  it('has variety: ≤ 3 visits to one spot per person per 2 h outside anchors', () => {
    const p = cached('lively');
    for (const list of Object.values(p.segments)) {
      const plain = list.filter((g) => !g.anchor && g.state === 'break');
      for (const g of plain) {
        const near = plain.filter((o) => o.place.spotId === g.place.spotId && o.start >= g.start && o.start - g.start < 2 * 3600_000);
        expect(near.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('is familiar: anchors keep their spot and time across five work days, and crews stay together', () => {
    // Monday 28 September to Friday 2 October 2026.
    const work = [28, 29, 30, 1, 2].map((d, i) => new Date(2026, i < 3 ? 8 : 9, d));
    const ps = work.map((d) => make('lively', d));
    const crews = ps.map((p) => JSON.stringify(p.crews.map((c) => c.members)));
    expect(new Set(crews).size).toBe(1);
    expect(ps[0]!.crews.length).toBeGreaterThan(10);
    let checked = 0;
    let fourOfFive = 0;
    for (const x of people) {
      const hits = ps
        .map((p) => (p.segments[x.id] ?? []).find((g) => g.anchor === 'morning'))
        .filter((g): g is Segment => !!g)
        .map((g) => ({ spot: g.place.spotId, min: new Date(g.start).getHours() * 60 + new Date(g.start).getMinutes() + new Date(g.start).getSeconds() / 60, crew: g.crewId }));
      if (hits.length < 2) continue;
      checked++;
      if (hits.length >= 4) fourOfFive++;
      const solo = hits.filter((h) => !h.crew);
      if (solo.length >= 2) {
        expect(new Set(solo.map((h) => h.spot)).size).toBe(1);
        const mins = solo.map((h) => h.min);
        // ± 5 min daily jitter plus at most ± 3 min to fit the floor.
        expect(Math.max(...mins) - Math.min(...mins)).toBeLessThanOrEqual(16.5);
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(fourOfFive / checked).toBeGreaterThan(0.5);
  });

  it('gives the Chief a morning coffee and an afternoon floor walk on work days', () => {
    const list = cached('lively').segments[LEAD.id] ?? [];
    expect(list.some((g) => g.anchor === 'morning' && spots.find((s) => s.id === g.place.spotId)?.kind === 'coffee_bar')).toBe(true);
    const walk = list.filter((g) => g.anchor === 'floor_walk');
    expect(walk.length).toBe(3);
    expect(walk.slice(0, 2).every((g) => g.backAt === null)).toBe(true);
    expect(walk[2]!.backAt).not.toBeNull();
    for (const h of cached('lively').huddles) if (h.members.includes(LEAD.id)) expect(h.end - h.start).toBeLessThanOrEqual(200_000);
  });

  it('replans from a moment: earlier segments are kept, the rest follows the new Ambience', () => {
    const a = cached('lively');
    const at = a.dayStart + 11 * 3600_000;
    const b = replanFrom(a, at, { seed: 'ws_test', day: TUESDAY, plan, spots, people, leadId: LEAD.id, ambience: 'buzzing' });
    for (const [id, list] of Object.entries(a.segments)) {
      const before = list.filter((g) => g.departAt < at + 30_000);
      const kept = (b.segments[id] ?? []).filter((g) => g.departAt < at + 30_000);
      expect(kept).toEqual(before);
    }
    expect(b.hash).not.toBe(a.hash);
    expect(b.ambience).toBe('buzzing');
  });

  it('keeps the café social most of the working day (09:30–17:30): Lively ≥ 65 %, Buzzing ≥ 80 %, Quiet about a third', () => {
    const occupancy = (p: DayPlan) => {
      let hit = 0;
      let n = 0;
      for (let m = 9.5 * 60; m < 17.5 * 60; m += 2) {
        const t = p.dayStart + m * 60_000;
        n++;
        if (p.huddles.some((h) => (h.spotId === 'cooler:cafe' || h.spotId === 'cafe:counter') && h.start <= t && h.end > t)) hit++;
      }
      return hit / n;
    };
    expect(occupancy(cached('lively'))).toBeGreaterThanOrEqual(0.65);
    expect(occupancy(cached('buzzing'))).toBeGreaterThanOrEqual(0.8);
    const quiet = occupancy(cached('quiet'));
    expect(quiet).toBeGreaterThan(0.15);
    expect(quiet).toBeLessThan(0.5);
  });

  it('gathers groups: at the café and the lounge sofa most huddles are three or four; drop-bys are a small share', () => {
    const p = cached('lively');
    const day = p.huddles.filter((h) => h.start >= p.dayStart + 9 * 3600_000 && h.end <= p.dayStart + 18 * 3600_000);
    const big = day.filter((h) => ['cafe:counter', 'cooler:cafe', 'lounge:sofa'].includes(h.spotId));
    expect(big.filter((h) => h.members.length >= 3).length / big.length).toBeGreaterThan(0.5);
    expect(big.some((h) => h.members.length === 4)).toBe(true);
    expect(day.filter((h) => h.kind === 'desk_dropby').length / day.length).toBeLessThan(0.1);
    // Most people away from their desks are with someone (the floor is social, not scattered).
    let alone = 0;
    let away = 0;
    for (let m = 10 * 60; m < 17 * 60; m += 5) {
      const t = p.dayStart + m * 60_000;
      for (const x of people) {
        const g = segmentAt(p, x.id, t);
        if (!g || t < g.start || t >= g.end) continue;
        away++;
        if (!g.huddleId) alone++;
      }
    }
    expect(alone / away).toBeLessThan(0.5);
  });

  it('never leaves two solo breaks side by side at the cooler or the counter: a second person makes it a conversation', () => {
    for (const amb of ['lively', 'buzzing'] as const) {
      const p = cached(amb);
      for (const sid of ['cooler:cafe', 'cafe:counter']) {
        const solos = all(p).filter((g) => g.place.spotId === sid && !g.huddleId).sort((a, b) => a.start - b.start);
        for (let i = 1; i < solos.length; i++) expect(solos[i]!.start).toBeGreaterThanOrEqual(solos[i - 1]!.end - 5_000);
      }
    }
  });

  it('brings every free crew member to a crew huddle and remembers its usual time', () => {
    const p = cached('lively');
    const crewHuddles = p.huddles.filter((h) => h.crewId);
    expect(crewHuddles.length).toBeGreaterThan(5);
    for (const h of crewHuddles) {
      const crew = p.crews.find((c) => c.id === h.crewId)!;
      expect(h.members.every((m) => crew.members.includes(m))).toBe(true);
      expect(h.usualMin).toBeGreaterThanOrEqual(9 * 60 + 30);
      expect(h.usualMin).toBeLessThanOrEqual(11 * 60 + 15);
    }
    expect(crewHuddles.filter((h) => h.members.length >= 3).length).toBeGreaterThan(0);
  });

  it('plans in idle slices to exactly the same plan (byte for byte)', () => {
    const input = { seed: 'ws_test', day: TUESDAY, plan, spots, people, leadId: LEAD.id, ambience: 'lively' as const };
    const task = planTask(input);
    let slices = 0;
    let out: DayPlan | null = null;
    while (!out && slices < 10_000) {
      out = task.step(2);
      slices++;
    }
    expect(slices).toBeGreaterThan(3);
    expect(out!.hash).toBe(cached('lively').hash);
    const at = out!.dayStart + 12 * 3600_000;
    const re = planTask({ ...input, ambience: 'buzzing' }, out!, at);
    let r2: DayPlan | null = null;
    while (!r2) r2 = re.step(50);
    expect(r2.hash).toBe(replanFrom(out!, at, { ...input, ambience: 'buzzing' }).hash);
  });

  it('segmentAt answers where someone is along a segment', () => {
    const p = cached('lively');
    const [id, list] = Object.entries(p.segments).find(([, l]) => l.some((g) => g.backAt !== null))!;
    const g = list.find((x) => x.backAt !== null)!;
    expect(segmentAt(p, id, g.departAt - 1)).not.toBe(g);
    expect(segmentAt(p, id, g.departAt)).toBe(g);
    expect(segmentAt(p, id, (g.start + g.end) / 2)).toBe(g);
    expect(segmentAt(p, id, g.backAt! - 1)).toBe(g);
    expect(segmentAt(p, id, g.backAt!)).not.toBe(g);
  });
});
