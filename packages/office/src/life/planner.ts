// The day plan: one deterministic plan for the floor from the seed, the owner-local day, the
// people, their personality and the Ambience. Pure: the same inputs give the same plan, byte for byte (O9).
//
// Order: knobs, preferences and crews → the Chief's rituals → crew huddles (everyone in the crew who is free) →
// personal anchors → the social spots' rhythm (the café cooler and counter hold a group most of the working day) →
// ad-hoc huddles (a Poisson process per 5 minutes) → visits and breaks (a renewal process per person: a break is often
// social, joining someone already at a spot or gathering a few people, else a solo break). Every proposal must fit the
// people's day (desk-dwell floors), a free spot, the huddle cap, the walker cap and the departure stagger; otherwise it
// shifts by up to ± 3 minutes, else drops.
//
// The work is a generator that yields often, so a host can run it in idle slices (`planTask`) and never block a
// frame; `planDay` and `replanFrom` run it to the end.
import { fnv1a, rngFor } from '../rng';
import type { OfficePlan, OfficeSeat } from '../plan/types';
import { affinity, formCrews } from './crews';
import type { CrewInput } from './crews';
import type { LifeKnobs, SliderStats } from './knobs';
import { DEFAULT_SLIDER_STATS, blendPref, lifeKnobs, prefColumn } from './knobs';
import { lifeNav } from './nav';
import { routeLength, seatAttach, slotAttach, walkSeconds } from './route';
import { AMBIENCE_K, LIFE_CAPS, STROLL, STROLL_MAX, STROLL_MIN, atLocal, dayBounds, dayKeyOf, isNightMinute, todDensity, todSpotFactor } from './tables';
import type { Ambience, AnchorKind, DayPlan, LifeCaps, OfficeSpot, PlannedHuddle, PlannerPerson, Segment } from './types';

export interface PlanDayInput {
  seed: string;
  /** The owner-local calendar day. */
  day: Date;
  plan: OfficePlan;
  spots: readonly OfficeSpot[];
  people: readonly PlannerPerson[];
  leadId: string;
  ambience: Ambience;
  /** JS weekday numbers; default Monday–Friday. */
  workDays?: readonly number[];
  sliderStats?: SliderStats;
  caps?: Partial<LifeCaps>;
}

/** A plan computed in slices (idle time): `step` works for about `budgetMs` and returns the plan once it is done. */
export interface PlanTask {
  step(budgetMs: number): DayPlan | null;
  readonly done: boolean;
}

/** Minimum time at the desk between two breaks (s). */
const DESK_FLOOR = 180;
const SHIFTS = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180, -180];
const AD_HOC_LAMBDA = 0.9;
/** Walk limits (s) for huddle partners: social spots draw from further away. */
const PARTNER_WALK_S = 12;
const SOCIAL_WALK_S = 20;
const SOCIAL_KINDS: ReadonlySet<string> = new Set(['coffee_bar', 'water_cooler', 'lounge']);
/** Big social spots take four people outside anchors (Lively). */
const BIG_SOCIAL: ReadonlySet<string> = new Set(['cafe:counter', 'cooler:cafe', 'lounge:sofa']);
/** One solo break at a time here: a second person makes it a conversation, not two strangers side by side. */
const ONE_SOLO: ReadonlySet<string> = new Set(['cafe:counter', 'cooler:cafe', 'cooler:library']);
/** The café's social rhythm: a new group roughly this long (s, at density 1) after the last one leaves. */
const FILL_SPOTS = ['cooler:cafe', 'cafe:counter'] as const;
const FILL_GAP_S = 150;
/** Two breaks at one spot that overlap this long (s) become a conversation. */
const JOIN_OVERLAP_S = 30;

interface PInfo {
  p: PlannerPerson;
  id: string;
  knobs: LifeKnobs;
  seat: OfficeSeat;
  zoneId: string;
  district: string;
  col: number;
  speed: number;
  lead: boolean;
  /** Base preference weights (time independent) for eligible spots. */
  base: Map<string, number>;
  signature: OfficeSpot | null;
}

interface Proposal {
  spot: OfficeSpot;
  members: string[];
  arrive: number;
  dwell: number;
  state: Segment['state'];
  anchor?: AnchorKind;
  crewId?: string;
  hostId?: string;
  usualMin?: number;
  rand: () => number;
  shifts?: readonly number[];
  /** Keep the proposal with whoever of the members is free (the first member always comes). */
  flexible?: boolean;
}

export function planDay(input: PlanDayInput): DayPlan {
  return runAll(planSteps(input, null, 0));
}

/**
 * Re-plan the rest of the day from `at + 30 s` (a change of Ambience or people): segments that already started (or
 * start within 30 s) are kept as they are; everything later is planned again.
 */
export function replanFrom(prev: DayPlan, at: number, input: PlanDayInput): DayPlan {
  return runAll(planSteps(input, prev, at + 30_000));
}

/**
 * The same plan as `planDay` / `replanFrom` (byte for byte), computed in slices: call `step(ms)` from idle callbacks
 * until it returns the plan. A replan keeps everything that departs before `at + 30 s`, so applying it any time
 * before then is seamless.
 */
export function planTask(input: PlanDayInput, prev: DayPlan | null = null, at = 0): PlanTask {
  const it = planSteps(input, prev, prev ? at + 30_000 : 0);
  let result: DayPlan | null = null;
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return {
    get done() {
      return result !== null;
    },
    step(budgetMs) {
      if (result) return result;
      const t0 = clock();
      for (;;) {
        const r = it.next();
        if (r.done) {
          result = r.value;
          return result;
        }
        if (clock() - t0 >= budgetMs) return null;
      }
    },
  };
}

function runAll(it: Generator<void, DayPlan>): DayPlan {
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** The ambient segment a person is in at `t` (walking there, there, or walking back), or null (at the desk). */
export function segmentAt(plan: DayPlan, personId: string, t: number): Segment | null {
  const list = plan.segments[personId];
  if (!list?.length) return null;
  let lo = 0;
  let hi = list.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.departAt <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx < 0) return null;
  const s = list[idx]!;
  const until = s.backAt ?? list[idx + 1]?.departAt ?? s.end;
  return t < until ? s : null;
}

function* planSteps(input: PlanDayInput, prev: DayPlan | null, fromMs: number): Generator<void, DayPlan> {
  const { plan, seed, leadId } = input;
  const ambience = input.ambience;
  const caps: LifeCaps = { ...LIFE_CAPS[ambience], ...input.caps };
  const dayKey = dayKeyOf(input.day);
  const { start: dayStart, end: dayEnd } = dayBounds(input.day);
  const daySec = Math.round((dayEnd - dayStart) / 1000);
  const minFrom = prev ? Math.max(0, (fromMs - dayStart) / 1000) : 0;
  const workDays = input.workDays ?? [1, 2, 3, 4, 5];
  const workDay = workDays.includes(input.day.getDay());
  const dayFactor = workDay ? 1 : 0.7;
  const k = AMBIENCE_K[ambience];
  const nav = lifeNav(plan);
  const stats = input.sliderStats ?? DEFAULT_SLIDER_STATS;
  yield;

  // ── density per 15 minutes (owner-local, DST-safe) ──
  const buckets = Math.ceil(daySec / 900);
  const bucketMin: number[] = [];
  const density: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const d = new Date(dayStart + b * 900_000);
    const m = d.getHours() * 60 + d.getMinutes();
    bucketMin.push(m);
    density.push(todDensity(m) * dayFactor * k);
  }
  const minuteAt = (sec: number) => {
    const b = Math.max(0, Math.min(buckets - 1, Math.floor(sec / 900)));
    return bucketMin[b]! + (sec - b * 900) / 60;
  };
  const densityAt = (sec: number) => density[Math.max(0, Math.min(buckets - 1, Math.floor(sec / 900)))]!;
  const secOfLocal = (minute: number) => (atLocal(input.day, minute) - dayStart) / 1000;

  // ── people ──
  const seatById = new Map(plan.seats.map((s) => [s.id, s]));
  const zoneById = new Map(plan.zones.map((z) => [z.id, z]));
  const spots = input.spots.filter((s) => !s.realOnly);
  const spotById = new Map(spots.map((s) => [s.id, s]));
  const infos: PInfo[] = [];
  for (const p of [...input.people].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const seatId = plan.seatOf[p.id];
    const seat = seatId ? seatById.get(seatId) : undefined;
    if (!seat) continue;
    const knobs = lifeKnobs(p, stats);
    const zone = zoneById.get(seat.zoneId);
    infos.push({
      p,
      id: p.id,
      knobs,
      seat,
      zoneId: seat.zoneId,
      district: zone?.district ?? 'lead',
      col: Math.floor((seat.x + 8) / 112),
      speed: Math.max(STROLL_MIN, Math.min(STROLL_MAX, STROLL * (0.85 + 0.3 * knobs.r))),
      lead: p.id === leadId,
      base: new Map(),
      signature: null,
    });
  }
  const info = new Map(infos.map((i) => [i.id, i]));
  const idxOf = new Map(infos.map((i, n) => [i.id, n]));
  const NP = infos.length;
  /** Last time two people huddled together (s), and their affinity (cached; both symmetric, by index). */
  const lastTogether = new Float64Array(NP * NP).fill(-Infinity);
  const affCache = new Float32Array(NP * NP).fill(NaN);

  // Walk lengths: a lazily filled table per person, indexed by spot slot.
  const spotIdx = new Map<string, number>();
  const slotBase: number[] = [];
  let totalSlots = 0;
  spots.forEach((sp, i) => {
    spotIdx.set(sp.id, i);
    slotBase.push(totalSlots);
    totalSlots += sp.slots.length;
  });
  const lenTable = new Map<string, Float64Array>();
  const walkLen = (pi: PInfo, spot: OfficeSpot, slot: number) => {
    let tab = lenTable.get(pi.id);
    if (!tab) {
      tab = new Float64Array(totalSlots).fill(NaN);
      lenTable.set(pi.id, tab);
    }
    const k2 = slotBase[spotIdx.get(spot.id)!]! + slot;
    let v = tab[k2]!;
    if (Number.isNaN(v)) {
      v = routeLength(nav, seatAttach(nav, plan, pi.seat), slotAttach(nav, spot, slot));
      tab[k2] = v;
    }
    return v;
  };
  const walkSec = (pi: PInfo, spot: OfficeSpot, slot: number) => walkSeconds(walkLen(pi, spot, slot), pi.speed);

  let n0 = 0;
  for (const pi of infos) {
    for (const sp of spots) {
      if (sp.kind === 'desk_dropby') continue;
      if (sp.zoneId && sp.kind === 'lounge' && sp.zoneId !== pi.zoneId) continue;
      if (sp.kind === 'window' && Math.abs(sp.col - pi.col) > 1) continue;
      const len = walkLen(pi, sp, 0);
      if (!Number.isFinite(len)) continue;
      const reach = sp.kind === 'coffee_bar' || sp.kind === 'water_cooler' ? 600 : 400;
      pi.base.set(sp.id, blendPref(pi.knobs.blend, prefColumn(sp)) * Math.exp(-len / reach));
    }
    // The signature spot: the top coffee bar or water cooler (a window or the library for the reserved).
    const rand = rngFor(`sig|${pi.id}`);
    const kinds = pi.knobs.s < 0.35 ? ['window', 'library'] : ['coffee_bar', 'water_cooler'];
    let best: OfficeSpot | null = null;
    let bw = -1;
    for (const sp of spots) {
      if (!kinds.includes(sp.kind) || !sp.solo) continue;
      const w = (pi.base.get(sp.id) ?? 0) * (0.9 + 0.2 * rand());
      if (w > bw) {
        bw = w;
        best = sp;
      }
    }
    pi.signature = best;
    if (++n0 % 4 === 0) yield;
  }
  yield;

  // ── bookkeeping ──
  const N = daySec + 4;
  const walkers = new Uint8Array(N);
  const deps = new Uint8Array(N);
  const active = new Uint8Array(N);
  const busy = new Map<string, [number, number][]>();
  const segs = new Map<string, Segment[]>();
  const huddles: PlannedHuddle[] = [];
  /** Groups planned in this pass, by spot, sorted by start: someone may walk up and join (a third or fourth). */
  const groupAt = new Map<string, PlannedHuddle[]>();
  const addGroup = (h: PlannedHuddle) => {
    let list = groupAt.get(h.spotId);
    if (!list) groupAt.set(h.spotId, (list = []));
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (list[m]!.start < h.start) lo = m + 1;
      else hi = m;
    }
    list.splice(lo, 0, h);
  };
  /** Solo breaks planned in this pass, by spot, sorted by arrival: a later break at the same spot may join one. */
  const soloAt = new Map<string, Segment[]>();
  const addSolo = (sid: string, seg: Segment) => {
    let list = soloAt.get(sid);
    if (!list) soloAt.set(sid, (list = []));
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (list[m]!.start < seg.start) lo = m + 1;
      else hi = m;
    }
    list.splice(lo, 0, seg);
  };
  /** Per person: spot id → arrival times (variety: ≤ 3 visits to one spot per 2 h outside anchors). */
  const recentSpot = new Map<string, Map<string, number[]>>();
  const recentCount = (pid: string, sid: string, t: number) => {
    const list = recentSpot.get(pid)?.get(sid);
    if (!list) return 0;
    let n = 0;
    for (let i = list.length - 1; i >= 0 && t - list[i]! < 7200; i--) if (list[i]! <= t) n++;
    return n;
  };

  // A person's busy intervals, kept sorted and non-overlapping (binary search).
  const addBusy = (pid: string, a: number, b: number) => {
    let list = busy.get(pid);
    if (!list) busy.set(pid, (list = []));
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (list[m]![0] < a) lo = m + 1;
      else hi = m;
    }
    list.splice(lo, 0, [a, b]);
  };
  /** The latest end among intervals within `floor` of [a, b], or −1 when the person is free. */
  const blockingEnd = (pid: string, a: number, b: number, floor = DESK_FLOOR): number => {
    const list = busy.get(pid);
    if (!list?.length) return -1;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (list[m]![0] - floor < b) lo = m + 1;
      else hi = m;
    }
    let end = -1;
    for (let i = lo - 1; i >= 0; i--) {
      const [x, y] = list[i]!;
      if (y + floor <= a) break;
      if (a < y + floor && b > x - floor && y > end) end = y;
    }
    return end;
  };
  const isFree = (pid: string, a: number, b: number, floor = DESK_FLOOR) => blockingEnd(pid, a, b, floor) < 0;
  let lastBack = 0;
  // Occupancy: per slot (who stands or sits where) and per spot for groups. A group takes the whole spot; two solo
  // breaks may share a spot of three or more slots, never side by side (and never at the cooler or the counter).
  // Sorted, non-overlapping interval lists per key (binary search).
  const slotOcc = new Map<string, number[]>();
  const groupOcc = new Map<string, number[]>();
  const anyIn = (list: number[] | undefined, a: number, b: number) => {
    if (!list?.length) return false;
    // list = [a0, b0, a1, b1, …]; the last interval starting before b + 5 must end before a − 5.
    let lo = 0;
    let hi = list.length / 2;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (list[2 * m]! < b + 5) lo = m + 1;
      else hi = m;
    }
    return lo > 0 && list[2 * (lo - 1) + 1]! > a - 5;
  };
  const markIn = (m: Map<string, number[]>, key: string, a: number, b: number) => {
    let list = m.get(key);
    if (!list) m.set(key, (list = []));
    let lo = 0;
    let hi = list.length / 2;
    while (lo < hi) {
      const k2 = (lo + hi) >> 1;
      if (list[2 * k2]! < a) lo = k2 + 1;
      else hi = k2;
    }
    list.splice(2 * lo, 0, a, b);
  };
  const slotKeys = new Map<string, string[]>();
  const keysOf = (sp: OfficeSpot) => {
    let k2 = slotKeys.get(sp.id);
    if (!k2) slotKeys.set(sp.id, (k2 = sp.slots.map((_, i) => `${sp.id}#${i}`)));
    return k2;
  };
  const spotFree = (sp: OfficeSpot, a: number, b: number) => {
    if (anyIn(groupOcc.get(sp.id), a, b)) return false;
    const keys = keysOf(sp);
    for (let i = 0; i < keys.length; i++) if (anyIn(slotOcc.get(keys[i]!), a, b)) return false;
    return true;
  };
  /** Physical distance between two slots of a spot (u). */
  const slotDist = (sp: OfficeSpot, i: number, j: number) => Math.hypot(sp.slots[i]!.x - sp.slots[j]!.x, sp.slots[i]!.y - sp.slots[j]!.y);
  const soloSlot = (sp: OfficeSpot, a: number, b: number): number => {
    if (anyIn(groupOcc.get(sp.id), a, b)) return -1;
    const used: number[] = [];
    const free: number[] = [];
    const keys = keysOf(sp);
    for (let i = 0; i < keys.length; i++) (anyIn(slotOcc.get(keys[i]!), a, b) ? used : free).push(i);
    if (!used.length) return 0;
    // Two solo breaks may share a spot: never side by side (≥ 20 u apart), never at the cooler or the counter.
    if (used.length >= 2 || ONE_SOLO.has(sp.id) || sp.slots.length < (ambience === 'buzzing' ? 2 : 3)) return -1;
    let best = -1;
    let bd = 20;
    for (const f of free) {
      const d = Math.min(...used.map((u) => slotDist(sp, u, f)));
      if (d > bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  };
  const occupy = (sp: OfficeSpot, slots: readonly number[], a: number, b: number, group: boolean) => {
    const keys = keysOf(sp);
    for (const i of slots) markIn(slotOcc, keys[i]!, a, b);
    if (group) markIn(groupOcc, sp.id, a, b);
  };
  const maxIn = (arr: Uint8Array, a: number, b: number) => {
    let m = 0;
    for (let s = Math.max(0, Math.floor(a)); s < Math.min(N, Math.ceil(b)); s++) if (arr[s]! > m) m = arr[s]!;
    return m;
  };
  const addIn = (arr: Uint8Array, a: number, b: number, d: number) => {
    for (let s = Math.max(0, Math.floor(a)); s < Math.min(N, Math.ceil(b)); s++) arr[s] = arr[s]! + d;
  };
  /** The night floor stays calm (§2.5 "Character"): at most one huddle at a time at Lively, two at Buzzing. */
  const nightCap = ambience === 'buzzing' ? 2 : 1;
  const huddleCapAt = (a: number, b: number) => (isNightMinute(minuteAt(a)) || isNightMinute(minuteAt(b)) ? Math.min(nightCap, caps.huddles) : caps.huddles);
  const depOk = (t: number) => {
    const s = Math.max(1, Math.min(N - 2, Math.floor(t)));
    return deps[s - 1]! + deps[s]! < 4 && deps[s]! + deps[s + 1]! < 4;
  };
  const ms0 = (sec: number) => Math.round(dayStart + sec * 1000);
  const huddleIdOf = (sp: OfficeSpot, first: number) => `hd:${dayKey}:${sp.id}:${Math.round((dayStart + first * 1000) / 60_000) % 1440}`;
  const noteTogether = (members: readonly string[], first: number) => {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = idxOf.get(members[i]!);
        const b = idxOf.get(members[j]!);
        if (a === undefined || b === undefined) continue;
        if (first > lastTogether[a * NP + b]!) lastTogether[a * NP + b] = lastTogether[b * NP + a] = first;
      }
    }
  };
  const noteSpot = (pid: string, sid: string, at: number) => {
    let per = recentSpot.get(pid);
    if (!per) recentSpot.set(pid, (per = new Map()));
    const rs = per.get(sid) ?? [];
    rs.push(at);
    rs.sort((a, b) => a - b);
    per.set(sid, rs);
  };
  /** Walkers and departures for a set of walks: tentatively add, roll back on failure. */
  const reserveWalks = (walks: readonly (readonly [number, number])[]): boolean => {
    const added: (readonly [number, number])[] = [];
    for (const [a, b] of walks) {
      if (maxIn(walkers, a, b) >= caps.walkers || !depOk(a)) {
        for (const [x, y] of added) {
          addIn(walkers, x, y, -1);
          deps[Math.floor(x)] = deps[Math.floor(x)]! - 1;
        }
        return false;
      }
      addIn(walkers, a, b, 1);
      deps[Math.floor(a)] = deps[Math.floor(a)]! + 1;
      added.push([a, b]);
    }
    return true;
  };

  /** Try to place a proposal (with shifts); returns the committed arrival or null. */
  const place = (pr: Proposal): number | null => {
    const all = pr.members.map((id) => info.get(id)!);
    if (all.some((m) => !m)) return null;
    // Staggered arrivals and departures (seeded), the initiator first in and usually last out.
    const arriveAll = all.map((_, i) => (i === 0 ? 0 : 2 + pr.rand() * 8));
    const leaveAll = all.map(() => 1 + pr.rand() * 2);
    for (const shift of pr.shifts ?? SHIFTS) {
      const arrive = pr.arrive + shift;
      const end = arrive + pr.dwell;
      // Whoever is free comes (flexible proposals keep the first member and need two people).
      let keep = all.map((_, i) => i);
      if (pr.flexible && all.length > 2) {
        keep = keep.filter((i) => i === 0 || isFree(all[i]!.id, arrive - 25, end + 25));
        if (keep.length < 2) continue;
      }
      const ms = keep.map((i) => all[i]!);
      const n = ms.length;
      const grouped = n > 1 || pr.state === 'visit';
      const arriveOff = keep.map((i) => arriveAll[i]!);
      const leaveOff = keep.map((i, j) => (j === 0 ? (n - 1) * 2.5 + 1 : (j - 1) * leaveAll[i]!));
      let slots = ms.map((_, i) => i);
      if (!grouped) {
        const slot = soloSlot(pr.spot, arrive - 5, end + 5);
        if (slot < 0) continue;
        slots = [slot];
      } else if (!spotFree(pr.spot, arrive - 5, end + 5 + (n - 1) * 3)) continue;
      const walk = ms.map((m, i) => walkSec(m, pr.spot, slots[i]!));
      if (walk.some((w) => !Number.isFinite(w))) return null;
      const t = ms.map((_, i) => {
        const arr = arrive + arriveOff[i]!;
        const lv = end + leaveOff[i]!;
        return { depart: arr - walk[i]!, arrive: arr, leave: lv, back: lv + walk[i]! };
      });
      if (t.some((x) => x.depart < Math.max(0, minFrom) || x.back > daySec - 1)) continue;
      if (!ms.every((m, i) => isFree(m.id, t[i]!.depart, t[i]!.back))) continue;
      if (pr.hostId && !isFree(pr.hostId, t[0]!.arrive, t[0]!.leave, 30)) continue;
      const first = Math.min(...t.map((x) => x.arrive));
      const last = Math.max(...t.map((x) => x.leave));
      if (grouped && !spotFree(pr.spot, first, last)) continue;
      if (grouped && maxIn(active, first, last) >= huddleCapAt(first, last)) continue;
      if (!reserveWalks(t.flatMap((x) => [[x.depart, x.arrive], [x.leave, x.back]] as const))) continue;
      // Commit.
      occupy(pr.spot, slots, first, last, grouped);
      if (grouped) addIn(active, first, last, 1);
      const huddleId = grouped ? huddleIdOf(pr.spot, first) : undefined;
      ms.forEach((m, i) => {
        const x = t[i]!;
        addBusy(m.id, x.depart, x.back);
        if (i === 0) lastBack = x.back;
        const seg: Segment = {
          personId: m.id,
          state: pr.state === 'visit' ? 'visit' : n > 1 ? 'huddle' : 'break',
          place: { kind: 'spot', spotId: pr.spot.id, slot: slots[i]! },
          departAt: ms0(x.depart),
          start: ms0(x.arrive),
          end: ms0(x.leave),
          backAt: ms0(x.back),
          ...(huddleId ? { huddleId } : {}),
          ...(pr.anchor ? { anchor: pr.anchor } : {}),
          ...(pr.crewId ? { crewId: pr.crewId } : {}),
          ...(pr.hostId ? { hostId: pr.hostId } : {}),
        };
        (segs.get(m.id) ?? segs.set(m.id, []).get(m.id)!).push(seg);
        if (!grouped && !pr.spot.id.startsWith('desk:')) addSolo(pr.spot.id, seg);
        noteSpot(m.id, pr.spot.id, x.arrive);
      });
      if (pr.hostId) addBusy(pr.hostId, t[0]!.arrive, t[0]!.leave);
      if (huddleId) {
        const members = pr.hostId ? [...ms.map((m) => m.id), pr.hostId] : ms.map((m) => m.id);
        const planned: PlannedHuddle = {
          id: huddleId,
          spotId: pr.spot.id,
          kind: pr.spot.kind,
          members,
          start: ms0(first),
          end: ms0(last),
          ...(pr.crewId ? { crewId: pr.crewId } : {}),
          ...(pr.anchor ? { anchor: pr.anchor } : {}),
          ...(pr.usualMin !== undefined ? { usualMin: pr.usualMin } : {}),
          ...(pr.hostId ? { hostId: pr.hostId } : {}),
        };
        huddles.push(planned);
        if (!pr.hostId && !pr.crewId) addGroup(planned);
        noteTogether(members, first);
      }
      return first;
    }
    return null;
  };

  // ── kept segments (replans) ──
  if (prev) {
    for (const [pid, list] of Object.entries(prev.segments)) {
      if (!info.has(pid)) continue;
      for (const s of list) {
        if (s.departAt >= fromMs) continue;
        const d = (s.departAt - dayStart) / 1000;
        const a = (s.start - dayStart) / 1000;
        const l = (s.end - dayStart) / 1000;
        const b = ((s.backAt ?? s.end) - dayStart) / 1000;
        addBusy(pid, d, b);
        (segs.get(pid) ?? segs.set(pid, []).get(pid)!).push({ ...s });
        addIn(walkers, d, a, 1);
        addIn(walkers, l, b, 1);
        const ksp = spotById.get(s.place.spotId);
        if (ksp) occupy(ksp, [s.place.slot], a, l, !!s.huddleId);
        if (s.hostId) addBusy(s.hostId, a, l);
      }
    }
    const keptIds = new Set<string>();
    for (const list of segs.values()) for (const s of list) if (s.huddleId) keptIds.add(s.huddleId);
    for (const h of prev.huddles) {
      if (!keptIds.has(h.id)) continue;
      // A kept huddle keeps only the members whose segments were kept.
      const members = h.members.filter((m) => m === h.hostId || (segs.get(m) ?? []).some((s) => s.huddleId === h.id));
      huddles.push({ ...h, members });
      addIn(active, (h.start - dayStart) / 1000, (h.end - dayStart) / 1000, 1);
    }
  }
  yield;

  // ── crews ──
  const crewInputs: CrewInput[] = infos.map((pi) => ({ person: pi.p, knobs: pi.knobs, district: pi.district, signature: pi.signature?.id ?? null }));
  const crewList = formCrews(crewInputs, leadId);
  const crewInputById = new Map(crewInputs.map((c) => [c.person.id, c]));
  const affinityOf = (a: PInfo, b: PInfo): number => {
    const k2 = idxOf.get(a.id)! * NP + idxOf.get(b.id)!;
    let v = affCache[k2]!;
    if (Number.isNaN(v)) affCache[k2] = v = affinity(crewInputById.get(a.id)!, crewInputById.get(b.id)!);
    return v;
  };
  yield;

  // ── anchors ──
  interface AnchorDef {
    kind: AnchorKind;
    from: number;
    to: number;
    chance: (pi: PInfo) => number;
    dwell: [number, number];
    spot: (pi: PInfo) => OfficeSpot | null;
  }
  const bestOf = (pi: PInfo, pred: (s: OfficeSpot) => boolean): OfficeSpot | null => {
    let best: OfficeSpot | null = null;
    let bw = 0;
    for (const sp of spots) {
      if (!sp.solo || !pred(sp)) continue;
      const w = pi.base.get(sp.id) ?? 0;
      if (w > bw) {
        bw = w;
        best = sp;
      }
    }
    return best;
  };
  const ANCHORS: AnchorDef[] = [
    { kind: 'morning', from: 9 * 60 + 30, to: 11 * 60 + 15, chance: (pi) => 0.55 + 0.3 * pi.knobs.s, dwell: [3, 6], spot: (pi) => pi.signature },
    { kind: 'midday', from: 12 * 60, to: 14 * 60, chance: () => 0.5, dwell: [3, 5], spot: (pi) => bestOf(pi, (s) => s.kind === 'lounge') },
    { kind: 'afternoon', from: 15 * 60, to: 17 * 60, chance: (pi) => 0.2 + 0.5 * pi.knobs.r, dwell: [2, 4], spot: (pi) => bestOf(pi, (s) => s.kind === 'water_cooler' || s.kind === 'window') },
    { kind: 'evening', from: 18 * 60 + 30, to: 21 * 60, chance: () => 0.3, dwell: [3, 5], spot: (pi) => bestOf(pi, (s) => s.kind === 'window') },
    { kind: 'night', from: 22 * 60, to: 25 * 60, chance: (pi) => 0.25 * pi.knobs.c, dwell: [3, 6], spot: (pi) => bestOf(pi, (s) => s.kind === 'window') },
  ];
  const anchorTime = (pi: PInfo, a: AnchorDef): { at: number; dwell: number; usual: number } | null => {
    // Stable per person (the habit), jittered ± 5 min per day, and skipped one day in five.
    const stable = rngFor(`anchor|${pi.id}|${a.kind}`);
    if (stable() >= a.chance(pi)) return null;
    const dwellMin = a.dwell[0] + (a.dwell[1] - a.dwell[0]) * stable();
    const offset = stable();
    const daily = rngFor(`${seed}|${pi.id}|${dayKey}|${a.kind}`);
    if (daily() < 0.2) return null;
    const usual = a.from + offset * (a.to - a.from - dwellMin);
    let minute = usual + (daily() * 10 - 5);
    if (minute >= 24 * 60) minute -= 24 * 60;
    return { at: secOfLocal(minute), dwell: dwellMin * 60 * (0.9 + 0.2 * daily()), usual: usual % (24 * 60) };
  };

  // The Chief of Staff: a morning coffee-bar anchor and an afternoon floor walk (three stops, then back).
  const chief = info.get(leadId);
  if (chief) {
    const stable = rngFor(`anchor|${chief.id}|chief`);
    const daily = rngFor(`${seed}|${chief.id}|${dayKey}|chief`);
    // The Chief's rituals come first: a morning coffee (the favourite counter, else another) …
    const coffees = spots.filter((s) => s.kind === 'coffee_bar' && s.solo && chief.base.has(s.id)).sort((a, b) => chief.base.get(b.id)! - chief.base.get(a.id)!);
    const mMin = 9 * 60 + 40 + stable() * 70 + (daily() * 10 - 5);
    const mDwell = (3 + 2 * stable()) * 60;
    if (secOfLocal(mMin) >= minFrom) for (const coffee of coffees) if (place({ spot: coffee, members: [chief.id], arrive: secOfLocal(mMin), dwell: mDwell, state: 'break', anchor: 'morning', rand: daily }) !== null) break;
    const halls = spots.filter((s) => s.kind === 'hallway').sort((a, b) => Math.abs(a.center.x - chief.seat.x) - Math.abs(b.center.x - chief.seat.x));
    if (halls.length >= 3 && daily() >= (workDay ? 0 : 0.5)) {
      const pickIdx = [0, 1, 2, 3, 4].filter((i) => i < halls.length).sort((a, b) => rngFor(`${seed}|walk|${dayKey}|${a}`)() - rngFor(`${seed}|walk|${dayKey}|${b}`)());
      const stops = pickIdx.slice(0, 3).sort((a, b) => halls[b]!.center.x - halls[a]!.center.x).map((i) => halls[i]!);
      const fMin = 15 * 60 + stable() * 100 + (daily() * 10 - 5);
      floorWalk(chief, stops, secOfLocal(fMin), [15, 15, 60 + daily() * 60]);
    }
  }

  // Crew huddles first (four work days in five), at the most sociable member's morning anchor, with every member
  // of the crew who is free (the familiar group you learn to expect).
  const crews: DayPlan['crews'] = [];
  const crewMorning = new Set<string>();
  for (const c of crewList) {
    const members = c.members.slice().sort((a, b) => info.get(b)!.knobs.s - info.get(a)!.knobs.s || (a < b ? -1 : 1));
    const leader = info.get(members[0]!)!;
    const cap = Math.min(caps.maxAnchorHuddle, members.length);
    let spot = leader.signature && leader.signature.huddle >= cap ? leader.signature : null;
    if (!spot) spot = bestOf(leader, (s) => (s.kind === 'coffee_bar' || s.kind === 'water_cooler') && s.huddle >= cap && s.slots.length >= cap);
    if (!spot) continue;
    crews.push({ id: c.id, members: members.slice(), spotId: spot.id });
    if (!workDay) continue;
    const r = rngFor(`${seed}|crew|${c.id}|${dayKey}`);
    if (r() >= 0.8) continue;
    const stable = rngFor(`anchor|${leader.id}|morning`);
    stable();
    const dwellMin = 3 + 3 * stable();
    const offset = stable();
    const usual = 9 * 60 + 30 + offset * (105 - dwellMin);
    const minute = usual + (r() * 10 - 5);
    const at = secOfLocal(minute);
    const party = members.slice(0, cap);
    if (at < minFrom) continue;
    const placed = place({ spot, members: party, arrive: at, dwell: dwellMin * 60, state: 'huddle', anchor: 'morning', crewId: c.id, usualMin: usual, flexible: true, rand: rngFor(`${seed}|crewplace|${c.id}|${dayKey}`) });
    if (placed !== null) for (const m of party) if ((segs.get(m) ?? []).some((g) => g.crewId === c.id)) crewMorning.add(m);
  }
  yield;

  // Personal anchors.
  let n1 = 0;
  for (const pi of infos) {
    if (pi.lead) continue;
    for (const a of ANCHORS) {
      if (a.kind === 'morning' && crewMorning.has(pi.id)) continue;
      const t = anchorTime(pi, a);
      const spot = a.spot(pi);
      if (!t || !spot || t.at < minFrom) continue;
      place({ spot, members: [pi.id], arrive: t.at, dwell: t.dwell, state: 'break', anchor: a.kind, rand: rngFor(`${seed}|${pi.id}|${dayKey}|${a.kind}|p`) });
    }
    if (++n1 % 8 === 0) yield;
  }
  yield;

  function floorWalk(pi: PInfo, stops: OfficeSpot[], at: number, dwells: number[]): void {
    if (at < minFrom) return;
    for (const shift of SHIFTS) {
      const t0 = at + shift;
      const legs: { spot: OfficeSpot; depart: number; arrive: number; leave: number }[] = [];
      let t = t0;
      let prevAttach = seatAttach(nav, plan, pi.seat);
      for (let i = 0; i < stops.length; i++) {
        const sp = stops[i]!;
        const w = walkSeconds(routeLength(nav, prevAttach, slotAttach(nav, sp, 0)), pi.speed);
        legs.push({ spot: sp, depart: t, arrive: t + w, leave: t + w + dwells[i]! });
        t = t + w + dwells[i]!;
        prevAttach = slotAttach(nav, sp, 0);
      }
      const back = t + walkSec(pi, stops[stops.length - 1]!, 0);
      if (back > daySec - 1 || !isFree(pi.id, t0, back)) continue;
      if (legs.some((l) => !spotFree(l.spot, l.arrive, l.leave))) continue;
      if (maxIn(walkers, t0, back) >= caps.walkers) continue;
      addIn(walkers, t0, back, 1);
      addBusy(pi.id, t0, back);
      legs.forEach((l, i) => {
        occupy(l.spot, [0], l.arrive, l.leave, true);
        (segs.get(pi.id) ?? segs.set(pi.id, []).get(pi.id)!).push({
          personId: pi.id,
          state: 'break',
          place: { kind: 'spot', spotId: l.spot.id, slot: 0 },
          departAt: ms0(l.depart),
          start: ms0(l.arrive),
          end: ms0(l.leave),
          backAt: i === legs.length - 1 ? ms0(back) : null,
          anchor: 'floor_walk',
        });
      });
      return;
    }
  }

  // ── group size, partners and a huddle proposal (shared by the café rhythm, ad-hoc huddles and social breaks) ──
  const sizeFor = (r: number, spot: OfficeSpot, isAnchor: boolean): number => {
    if (ambience === 'quiet') return 2;
    const max = isAnchor || BIG_SOCIAL.has(spot.id) ? caps.maxAnchorHuddle : caps.maxHuddle;
    const n = r < 0.42 ? 2 : r < 0.76 ? 3 : 4;
    return Math.min(n, max, spot.huddle, spot.slots.length);
  };
  /** People near a spot (by walk), sorted by id: the pool its partners come from. */
  const nearCache = new Map<string, PInfo[]>();
  const nearOf = (spot: OfficeSpot) => {
    let list = nearCache.get(spot.id);
    if (!list) {
      const limit = SOCIAL_KINDS.has(spot.kind) ? SOCIAL_WALK_S : PARTNER_WALK_S;
      list = infos.filter((c) => !c.lead && walkSec(c, spot, 0) <= limit);
      nearCache.set(spot.id, list);
    }
    return list;
  };
  const poisson = (lambda: number, r: () => number) => {
    const L = Math.exp(-lambda);
    let p = 1;
    let n = 0;
    do {
      n++;
      p *= r();
    } while (p > L && n < 12);
    return n - 1;
  };
  /** Gather `size` people at a spot around T: the initiator, then partners by affinity and variety. */
  const gather = (initiator: PInfo, spot: OfficeSpot, T: number, size: number, rand: () => number): string[] => {
    const members = [initiator.id];
    const pool0 = nearOf(spot);
    // Up to 30 free candidates from a seeded start in the pool (cheap and varied).
    const pool: PInfo[] = [];
    const off = Math.floor(rand() * Math.max(1, pool0.length));
    for (let i = 0; i < pool0.length && pool.length < 30; i++) {
      const c = pool0[(off + i) % pool0.length]!;
      if (c.id !== initiator.id && isFree(c.id, T - 60, T + 300)) pool.push(c);
    }
    const ia = idxOf.get(initiator.id)!;
    const weights = pool.map((c) => {
      const ib = idxOf.get(c.id)!;
      const recent = T - lastTogether[ia * NP + ib]! < 7200;
      return (0.15 + affinityOf(initiator, c)) * (recent ? 0.3 : 1) * (0.4 + c.knobs.s);
    });
    for (let k2 = 1; k2 < size; k2++) {
      let total = 0;
      for (const w of weights) total += w;
      if (total <= 0) break;
      let r = rand() * total;
      let i = 0;
      for (; i < pool.length - 1; i++) {
        r -= weights[i]!;
        if (r <= 0) break;
      }
      members.push(pool[i]!.id);
      weights[i] = 0;
    }
    return members;
  };

  // ── the social spots' rhythm: a group at the café cooler and the counter most of the working day ──
  const social = rngFor(`${seed}|${dayKey}|social|${ambience}`);
  const fillGap = FILL_GAP_S * (ambience === 'quiet' ? 2.4 : 1);
  for (const sid of ambience === 'quiet' ? FILL_SPOTS.slice(0, 1) : FILL_SPOTS) {
    const spot = spotById.get(sid);
    if (!spot) continue;
    let t = Math.max(minFrom, secOfLocal(7 * 60 + 30));
    const stop = Math.min(daySec - 900, secOfLocal(22 * 60));
    let guard = 0;
    while (t < stop && guard++ < 600) {
      const D = densityAt(t);
      t += -Math.log(1 - social() * 0.999) * (fillGap / Math.max(0.1, D));
      if (t >= stop) break;
      const minute = minuteAt(t);
      const cands = nearOf(spot).filter((pi) => isFree(pi.id, t - 60, t + 300));
      const initiator = weighted(cands, (pi) => pi.knobs.s * (pi.base.get(spot.id) ?? 0.2) * todSpotFactor(spot.kind, minute), social);
      if (!initiator) {
        t += 60;
        continue;
      }
      const size = Math.max(2, sizeFor(social(), spot, false));
      const members = gather(initiator, spot, t, size, social);
      if (members.length < 2) {
        t += 60;
        continue;
      }
      const dwell = 110 + social() * 130;
      const at = place({ spot, members, arrive: t, dwell, state: 'huddle', flexible: true, rand: social, shifts: [0, 30, 60, 90, 120] });
      if (at !== null) t = at + dwell;
      else t += 45;
      if (guard % 3 === 0) yield;
    }
  }
  yield;

  // ── ad-hoc huddles ──
  const adhoc = rngFor(`${seed}|${dayKey}|adhoc|${ambience}`);
  for (let b = 0; b * 300 < daySec; b++) {
    const t0 = b * 300;
    const n = poisson(AD_HOC_LAMBDA * densityAt(t0), adhoc);
    for (let h = 0; h < n; h++) {
      const T = t0 + adhoc() * 300;
      const minute = minuteAt(T);
      // The initiator: sociable and free around T (up to 40 free people from a seeded start: cheap and fair).
      const cands: PInfo[] = [];
      const off = Math.floor(adhoc() * infos.length);
      for (let i = 0; i < infos.length && cands.length < 40; i++) {
        const pi = infos[(off + i) % infos.length]!;
        if (isFree(pi.id, T - 60, T + 300)) cands.push(pi);
      }
      if (cands.length < 2) continue;
      const initiator = weighted(cands, (pi) => pi.knobs.s * pi.knobs.s, adhoc);
      if (!initiator) continue;
      // A drop-by is an ad-hoc choice only for the most sociable (s ≥ 0.6): visits come from the renewal below.
      if (!initiator.lead && initiator.knobs.s >= 0.6 && adhoc() < 0.08) {
        visit(initiator, T, adhoc);
        continue;
      }
      const draw = adhoc();
      const want = sizeFor(draw, { id: '', huddle: 4, slots: [0, 0, 0, 0] } as unknown as OfficeSpot, false);
      // A group of three or more picks a spot that holds it.
      const hudSpots = spots.filter((s) => s.huddle >= Math.max(2, Math.min(3, want)) && s.kind !== 'desk_dropby' && initiator.base.has(s.id));
      const spot = weighted(hudSpots, (s) => initiator.base.get(s.id)! * todSpotFactor(s.kind, minute) * (s.kind === 'hallway' ? 0.8 : 1), adhoc);
      if (!spot) continue;
      const size = Math.min(sizeFor(draw, spot, false), spot.huddle, spot.slots.length);
      const members = gather(initiator, spot, T, size, adhoc);
      if (members.length < 2) continue;
      const hasLead = members.includes(leadId);
      const dwell = Math.min(hasLead ? 180 : 240, 90 + adhoc() * 150);
      place({ spot, members, arrive: T, dwell, state: 'huddle', flexible: true, rand: adhoc });
    }
    if (b % 3 === 0) yield;
  }
  yield;

  /** A visit to an idle teammate at their desk (a drop-by). */
  function visit(pi: PInfo, t: number, rand: () => number): number | null {
    const mates = infos.filter((o) => o.zoneId === pi.zoneId && o.id !== pi.id && !o.lead && isFree(o.id, t - 30, t + 150, 30));
    const host = weighted(mates, (o) => 0.2 + affinityOf(pi, o), rand);
    const drop = host ? spotById.get(`desk:${host.seat.id}`) : undefined;
    if (!host || !drop) return null;
    return place({ spot: drop, members: [pi.id], arrive: t, dwell: 45 + rand() * 75, state: 'visit', hostId: host.id, rand, shifts: [0, 30, -30, 60] });
  }

  /**
   * Join someone already taking a break at a spot: the two breaks overlap ≥ 30 s, so they become a conversation
   * (the joiner stands next to them). Returns the committed arrival or null.
   */
  const join = (pi: PInfo, t: number, rand: () => number, only?: OfficeSpot): number | null => {
    if (!only) {
      const grown = joinGroup(pi, t, rand);
      if (grown !== null) return grown;
    }
    const options: { seg: Segment; spot: OfficeSpot; w: number }[] = [];
    const fromMs0 = ms0(t - 420);
    const toMs0 = ms0(t + 240);
    for (const [sid, list] of soloAt) {
      if (only && sid !== only.id) continue;
      const spot = spotById.get(sid);
      const w0 = pi.base.get(sid);
      if (!spot || !w0 || spot.huddle < 2) continue;
      // Breaks that started at most seven minutes before t and start before t + 4 min (binary search on arrival).
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (list[m]!.start < fromMs0) lo = m + 1;
        else hi = m;
      }
      for (let i = lo; i < list.length && list[i]!.start <= toMs0; i++) {
        const seg = list[i]!;
        if (seg.huddleId || seg.personId === pi.id || seg.personId === leadId || seg.anchor === 'floor_walk') continue;
        const s = (seg.start - dayStart) / 1000;
        const e = (seg.end - dayStart) / 1000;
        if (e - Math.max(t, s + 10) < JOIN_OVERLAP_S + 15) continue;
        options.push({ seg, spot, w: w0 });
      }
    }
    const pickd = weighted(options, (o) => o.w, rand);
    return pickd ? joinSeg(pi, t, pickd.seg, pickd.spot, rand) : null;
  };
  /** Join one solo break: the two become a pair huddle for their overlap (the joiner stands next to them). */
  const joinSeg = (pi: PInfo, t: number, seg: Segment, spot: OfficeSpot, rand: () => number): number | null => {
    const qs = (seg.start - dayStart) / 1000;
    const qe = (seg.end - dayStart) / 1000;
    const arrive = Math.max(t, qs + 12);
    const dwell = (80 + rand() * 120) * (0.8 + 0.4 * (1 - pi.knobs.r));
    const end = arrive + dwell;
    const hEnd = Math.min(qe, end);
    if (hEnd - arrive < JOIN_OVERLAP_S) return null;
    // The free slot nearest the person already there.
    const keys = keysOf(spot);
    const slots = spot.slots.map((_, i) => i).filter((i) => i !== seg.place.slot && !anyIn(slotOcc.get(keys[i]!), arrive - 5, end + 5)).sort((a, b) => slotDist(spot, a, seg.place.slot) - slotDist(spot, b, seg.place.slot));
    const slot = slots[0];
    if (slot === undefined || slotDist(spot, slot, seg.place.slot) > 24) return null;
    if (anyIn(groupOcc.get(spot.id), arrive, hEnd)) return null;
    if (maxIn(active, arrive, hEnd) >= huddleCapAt(arrive, hEnd)) return null;
    const w = walkSec(pi, spot, slot);
    if (!Number.isFinite(w) || w > SOCIAL_WALK_S) return null;
    const x = { depart: arrive - w, arrive, leave: end, back: end + w };
    if (x.depart < minFrom || x.back > daySec - 1 || !isFree(pi.id, x.depart, x.back)) return null;
    if (!reserveWalks([[x.depart, x.arrive], [x.leave, x.back]])) return null;
    occupy(spot, [slot], arrive, end, false);
    markIn(groupOcc, spot.id, arrive, hEnd);
    addIn(active, arrive, hEnd, 1);
    addBusy(pi.id, x.depart, x.back);
    lastBack = x.back;
    const huddleId = huddleIdOf(spot, arrive);
    seg.state = 'huddle';
    seg.huddleId = huddleId;
    const mine: Segment = { personId: pi.id, state: 'huddle', place: { kind: 'spot', spotId: spot.id, slot }, departAt: ms0(x.depart), start: ms0(arrive), end: ms0(end), backAt: ms0(x.back), huddleId };
    (segs.get(pi.id) ?? segs.set(pi.id, []).get(pi.id)!).push(mine);
    noteSpot(pi.id, spot.id, arrive);
    const pair: PlannedHuddle = { id: huddleId, spotId: spot.id, kind: spot.kind, members: [seg.personId, pi.id], start: ms0(arrive), end: ms0(hEnd) };
    huddles.push(pair);
    addGroup(pair);
    noteTogether([seg.personId, pi.id], arrive);
    return arrive;
  };

  /** Walk up to a group that is already talking (it grows to three or four, within the spot's size). */
  const joinGroup = (pi: PInfo, t: number, rand: () => number): number | null => {
    if (ambience === 'quiet') return null;
    const options: { h: PlannedHuddle; spot: OfficeSpot; w: number }[] = [];
    const fromMs0 = ms0(t - 300);
    const toMs0 = ms0(t + 180);
    for (const [sid, list] of groupAt) {
      const spot = spotById.get(sid);
      const w0 = pi.base.get(sid);
      if (!spot || !w0) continue;
      const cap = Math.min(spot.huddle, spot.slots.length, BIG_SOCIAL.has(sid) ? caps.maxAnchorHuddle : caps.maxHuddle);
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (list[m]!.start < fromMs0) lo = m + 1;
        else hi = m;
      }
      for (let i = lo; i < list.length && list[i]!.start <= toMs0; i++) {
        const h = list[i]!;
        if (h.members.length >= cap || h.members.includes(pi.id) || h.members.includes(leadId)) continue;
        // Each group has its own size (seeded): half stay a pair, some grow to three, a few to four.
        const d = fnv1a(`grow|${h.id}`) % 20;
        if (h.members.length >= Math.min(cap, d < 10 ? 2 : d < 16 ? 3 : 4)) continue;
        if ((h.end - dayStart) / 1000 - Math.max(t, (h.start - dayStart) / 1000 + 20) < 60) continue;
        options.push({ h, spot, w: w0 * (SOCIAL_KINDS.has(spot.kind) ? 1.5 : 1) });
      }
    }
    const pickd = weighted(options, (o) => o.w, rand);
    if (!pickd) return null;
    const { h, spot } = pickd;
    const hs = (h.start - dayStart) / 1000;
    const he = (h.end - dayStart) / 1000;
    const arrive = Math.max(t, hs + 20);
    const end = Math.min(he - 4, arrive + (80 + rand() * 120));
    if (end - arrive < 45) return null;
    const keys = keysOf(spot);
    const taken = new Set(h.members.map((m) => (segs.get(m) ?? []).find((g) => g.huddleId === h.id)?.place.slot ?? -1));
    const slot = spot.slots.map((_, i) => i).find((i) => !taken.has(i) && !anyIn(slotOcc.get(keys[i]!), arrive - 5, end + 5));
    if (slot === undefined) return null;
    const w = walkSec(pi, spot, slot);
    if (!Number.isFinite(w) || w > SOCIAL_WALK_S) return null;
    const x = { depart: arrive - w, arrive, leave: end, back: end + w };
    if (x.depart < minFrom || x.back > daySec - 1 || !isFree(pi.id, x.depart, x.back)) return null;
    if (!reserveWalks([[x.depart, x.arrive], [x.leave, x.back]])) return null;
    occupy(spot, [slot], arrive, end, false);
    addBusy(pi.id, x.depart, x.back);
    lastBack = x.back;
    (segs.get(pi.id) ?? segs.set(pi.id, []).get(pi.id)!).push({ personId: pi.id, state: 'huddle', place: { kind: 'spot', spotId: spot.id, slot }, departAt: ms0(x.depart), start: ms0(arrive), end: ms0(end), backAt: ms0(x.back), huddleId: h.id });
    noteSpot(pi.id, spot.id, arrive);
    noteTogether([...h.members, pi.id], arrive);
    h.members.push(pi.id);
    return arrive;
  };

  // ── visits and breaks: a renewal process per person ──
  let n2 = 0;
  for (const pi of infos) {
    const rand = rngFor(`${seed}|${pi.id}|${dayKey}|renew|${ambience}`);
    const soloOpts = spots.filter((s) => s.solo && pi.base.has(s.id));
    const soloBase = soloOpts.map((s) => pi.base.get(s.id)!);
    const hudOpts = spots.filter((s) => s.huddle >= 2 && s.kind !== 'desk_dropby' && pi.base.has(s.id));
    const socialShare = pi.lead ? 0.15 : Math.min(0.85, 0.35 + 0.45 * pi.knobs.s) * (ambience === 'quiet' ? 0.6 : 1);
    const socialAt = (minute: number) => socialShare * (isNightMinute(minute) ? 0.4 : 1);
    const dwellFor = (t: number) => {
      const base = pi.lead ? 30 + 30 * rand() : 10 + 20 * rand();
      return (base * 60 * (pi.lead ? 1 : 1.25 - 0.5 * pi.knobs.r)) / Math.max(0.08, densityAt(t));
    };
    let t = rand() * dwellFor(0) * 0.6;
    let guard = 0;
    while (t < daySec - 600 && guard++ < 400) {
      const blockEnd = blockingEnd(pi.id, t, t + 30);
      if (blockEnd >= 0) {
        t = blockEnd + DESK_FLOOR + dwellFor(t) * 0.5;
        continue;
      }
      if (t < minFrom) {
        t += dwellFor(t);
        continue;
      }
      const minute = minuteAt(t);
      let placed: number | null = null;
      // A visit to an idle teammate (sociable people drop by more).
      if (!pi.lead && rand() < 0.05 * pi.knobs.s) placed = visit(pi, t, rand);
      // A social break: join someone already at a spot, else gather a few people.
      if (placed === null && rand() < socialAt(minute)) {
        placed = pi.lead ? null : join(pi, t, rand);
        if (placed === null && !pi.lead) {
          const spot = weighted(hudOpts, (s) => pi.base.get(s.id)! * todSpotFactor(s.kind, minute) * (recentCount(pi.id, s.id, t) >= 3 ? 0 : 1), rand);
          if (spot) {
            const size = Math.max(2, sizeFor(rand(), spot, false));
            const members = gather(pi, spot, t, size, rand);
            if (members.length >= 2) placed = place({ spot, members, arrive: t, dwell: 100 + rand() * 140, state: 'huddle', flexible: true, rand, shifts: [0, 30, -30, 60, 90] });
          }
        }
      }
      if (placed === null) {
        // Pick by preference, then take the first pick that is free (up to six tries).
        const ws = soloOpts.map((s, i) => {
          const recent = recentCount(pi.id, s.id, t);
          return soloBase[i]! * todSpotFactor(s.kind, minute) * (recent >= 3 ? 0 : recent ? 0.5 : 1);
        });
        let spot: OfficeSpot | null = null;
        for (let tries = 0; tries < (ambience === 'buzzing' ? 12 : 6) && !spot; tries++) {
          let total = 0;
          for (const w of ws) total += w;
          if (total <= 0) break;
          let r = rand() * total;
          let k2 = 0;
          for (; k2 < ws.length - 1; k2++) {
            r -= ws[k2]!;
            if (r <= 0) break;
          }
          const pick = soloOpts[k2]!;
          // Someone is already on a break there: make it a conversation rather than two strangers apart.
          if (!pi.lead && pick.huddle >= 2) {
            placed = join(pi, t, rand, pick);
            if (placed !== null) break;
          }
          if (soloSlot(pick, t - 30, t + 240) >= 0) spot = pick;
          else ws[k2] = 0;
        }
        if (spot && placed === null) {
          const dur = (90 + rand() * 180) * (0.8 + 0.4 * (1 - pi.knobs.r));
          placed = place({ spot, members: [pi.id], arrive: t, dwell: pi.lead ? Math.min(dur, 180) : dur, state: 'break', rand });
        }
      }
      if (placed !== null) t = lastBack + dwellFor(t);
      else t += 300 + rand() * 300;
    }
    if (++n2 % 2 === 0) yield;
  }

  // ── output ──
  const segments: Record<string, Segment[]> = {};
  for (const pi of infos) {
    const list = (segs.get(pi.id) ?? []).sort((a, b) => a.departAt - b.departAt);
    if (list.length) segments[pi.id] = list;
  }
  huddles.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  const body = { version: 1 as const, dayKey, seed, ambience, dayStart, dayEnd, segments, huddles, crews };
  return { ...body, hash: hashPlan(body) };
}

/** A fast, stable content hash of the plan (every segment, huddle and crew field). */
function hashPlan(body: Omit<DayPlan, 'hash'>): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  const ids = new Map<string, number>();
  const mixS = (v: string | undefined | null) => {
    if (v === undefined || v === null) return mixN(-1);
    let x = ids.get(v);
    if (x === undefined) ids.set(v, (x = fnv1a(v)));
    mixN(x);
  };
  const mixN = (v: number) => {
    const lo = v >>> 0;
    const hi = Math.floor(v / 4294967296) >>> 0;
    h1 = Math.imul(h1 ^ lo, 0x01000193) >>> 0;
    h1 = Math.imul(h1 ^ hi, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ lo, 0x5bd1e995) >>> 0;
    h2 = (h2 ^ (h2 >>> 13) ^ hi) >>> 0;
  };
  mixS(body.dayKey);
  mixS(body.seed);
  mixS(body.ambience);
  mixN(body.dayStart);
  for (const pid of Object.keys(body.segments).sort()) {
    mixS(pid);
    for (const g of body.segments[pid]!) {
      mixS(g.state);
      mixS(g.place.spotId);
      mixN(g.place.slot);
      mixN(g.departAt);
      mixN(g.start);
      mixN(g.end);
      mixN(g.backAt ?? -1);
      mixS(g.huddleId);
      mixS(g.anchor);
      mixS(g.crewId);
      mixS(g.hostId);
    }
  }
  for (const h of body.huddles) {
    mixS(h.id);
    mixN(h.start);
    mixN(h.end);
    mixN(h.usualMin ?? -1);
    for (const m of h.members) mixS(m);
  }
  for (const c of body.crews) {
    mixS(c.id);
    mixS(c.spotId);
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function weighted<T>(items: readonly T[], w: (t: T) => number, rand: () => number): T | null {
  let total = 0;
  const ws = items.map((i) => {
    const v = Math.max(0, w(i));
    total += v;
    return v;
  });
  if (total <= 0) return null;
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1] ?? null;
}
