// Test support for office life (not exported from the package): the real catalog as planner people, a fake clock
// with fake timers, and a fake scene port that records what the director asks for.
import full from '../../../catalog/generated/full.js';
import { planOffice } from '../plan/plan';
import type { OfficePlan } from '../plan/types';
import type { OfficeGroup, OfficePerson, Point } from '../types';
import { planSpots } from './spots';
import type { Cue, HoldWhy, LifeHooks, LifeScenePort, LifeSummary, Moment, MoveHandle, MoveOptions, OfficeLifePerson, OfficeSpot, PlaceRef, PlannerPerson, ShowHuddleArgs } from './types';

interface CatalogPersona {
  id: string;
  name: string;
  title: string;
  department: string;
  seniority?: OfficePerson['seniority'];
  personality: { sliders: Record<string, number>; traits: string[] };
  team_roles?: string[];
  pairs_well_with?: string[];
  productive_tension_with?: { persona_id: string }[];
  avatar: { accent_color: string };
}
const cat = full as unknown as { personas: CatalogPersona[]; leads: CatalogPersona[]; departments: { id: string; name: string }[] };

export const LEAD = cat.leads.find((l) => l.id === 'lead-steady-operator') ?? cat.leads[0]!;

export const officePeople: OfficePerson[] = [
  { id: LEAD.id, name: LEAD.name, title: 'Chief of Staff', groupId: 'chief', accent: LEAD.avatar.accent_color, seniority: 'principal' },
  ...cat.personas.map((p) => ({ id: p.id, name: p.name, title: p.title, groupId: p.department, accent: p.avatar.accent_color, seniority: p.seniority })),
];
export const officeGroups: OfficeGroup[] = cat.departments.map((d) => ({ id: d.id, name: d.name, kind: 'department' as const }));

export const lifePeople: OfficeLifePerson[] = [
  { id: LEAD.id, sliders: LEAD.personality.sliders, traits: LEAD.personality.traits },
  ...cat.personas.map((p) => ({
    id: p.id,
    sliders: p.personality.sliders,
    traits: p.personality.traits,
    teamRoles: p.team_roles ?? [],
    pairsWellWith: p.pairs_well_with ?? [],
    tensionWith: (p.productive_tension_with ?? []).map((t) => t.persona_id),
  })),
];

let planCache: OfficePlan | null = null;
export function catalogPlan(): OfficePlan {
  planCache ??= planOffice({ people: officePeople, groups: officeGroups, leadId: LEAD.id });
  return planCache;
}

export function plannerPeople(plan = catalogPlan()): PlannerPerson[] {
  const byId = new Map(officePeople.map((p) => [p.id, p]));
  return lifePeople.filter((p) => plan.seatOf[p.id]).map((p) => ({ ...p, groupId: byId.get(p.id)!.groupId, seniority: byId.get(p.id)!.seniority }));
}

/** A Tuesday. */
export const TUESDAY = new Date(2026, 8, 29);

// ── a fake clock ─────────────────────────────────────────────────────────────────
export interface FakeClock {
  now(): Date;
  ms(): number;
  timers: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
  /** Run timers up to now + ms (flushing promise callbacks between them). */
  advance(ms: number): Promise<void>;
  pending(): number;
}

export function fakeClock(start: number): FakeClock {
  let now = start;
  let seq = 0;
  const queue = new Map<number, { at: number; fn: () => void }>();
  const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  return {
    now: () => new Date(now),
    ms: () => now,
    timers: {
      set(fn, ms) {
        const id = ++seq;
        queue.set(id, { at: now + Math.max(0, ms), fn });
        return id;
      },
      clear(h) {
        queue.delete(h as number);
      },
    },
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        let nextId = -1;
        let nextAt = Infinity;
        for (const [id, t] of queue) {
          if (t.at < nextAt || (t.at === nextAt && id < nextId)) {
            nextAt = t.at;
            nextId = id;
          }
        }
        if (nextId < 0 || nextAt > end) break;
        const t = queue.get(nextId)!;
        queue.delete(nextId);
        now = Math.max(now, t.at);
        t.fn();
        await flush();
      }
      now = end;
      await flush();
    },
    pending: () => queue.size,
  };
}

// ── a fake scene port ────────────────────────────────────────────────────────────
export interface MoveCall {
  id: string;
  to: PlaceRef;
  opts: MoveOptions;
  at: number;
}

export interface FakeScene extends LifeScenePort {
  moves: MoveCall[];
  cancels: { id: string; at: number }[];
  says: { id: string; text: string; huddleId: string; ttlMs: number; at: number; nonverbal?: boolean }[];
  cues: { id: string; gesture: Cue; at: number }[];
  shown: Map<string, ShowHuddleArgs>;
  hidden: string[];
  summaries: (LifeSummary | null)[];
  offered: (Moment | null)[];
  hooks: LifeHooks | null;
  /** Where each person is (plan u) and what they are doing. */
  pos: Map<string, { place: PlaceRef; x: number; y: number; walking: boolean }>;
  /** 0 off-screen … 3 L2 (default: everyone at L1). */
  vis: (id: string) => 0 | 1 | 2 | 3;
  visAt: (p: Point) => 0 | 1 | 2 | 3;
  setPresenceCalls: number;
  /** Simulate an owner hold (hover). */
  hold(id: string, held: boolean, why?: HoldWhy): void;
  /** trimBubbles calls (ids, max ms) and opening frames asked for. */
  trims: { ids: string[]; maxMs: number }[];
  frames: Point[];
  /** Every showHuddle call's speaker (the glyph pulse). */
  speakers: (string | null | undefined)[];
  /** Owner-facing bubbles shown (showBubble). */
  bubbles: { personId: string; text: string }[];
}

export function fakeScene(clock: FakeClock, plan = catalogPlan()): FakeScene {
  const spots: OfficeSpot[] = planSpots(plan);
  const spotById = new Map(spots.map((s) => [s.id, s]));
  const seatById = new Map(plan.seats.map((s) => [s.id, s]));
  const el = document.createElement('div');
  const pointOf = (id: string, to: PlaceRef): Point => {
    if (to.kind === 'desk') {
      const seat = seatById.get(plan.seatOf[id] ?? '');
      return { x: seat?.x ?? 0, y: seat?.y ?? 0 };
    }
    if (to.kind === 'spot') {
      const sl = spotById.get(to.spotId)?.slots[to.slot];
      return { x: sl?.x ?? 0, y: sl?.y ?? 0 };
    }
    if (to.kind === 'point') return { x: to.x, y: to.y };
    return { x: 0, y: 0 };
  };
  const pending = new Map<string, { resolve: (ok: boolean) => void; timer: unknown }>();
  const s: FakeScene = {
    el,
    moves: [],
    cancels: [],
    says: [],
    cues: [],
    shown: new Map(),
    hidden: [],
    summaries: [],
    offered: [],
    hooks: null,
    pos: new Map(),
    vis: () => 2,
    visAt: () => 2,
    setPresenceCalls: 0,
    trims: [],
    frames: [],
    speakers: [],
    bubbles: [],
    showBubble(personId, text) {
      s.bubbles.push({ personId, text });
    },
    hold(id, held, why = 'hover') {
      s.hooks?.onHold(id, held, why);
    },
    trimBubbles(ids, maxMs) {
      s.trims.push({ ids: ids.slice(), maxMs });
    },
    frameOpening(p) {
      s.frames.push(p);
    },
    getPlan: () => plan,
    spots: () => spots,
    moveTo(id, to, opts = {}) {
      const at = clock.ms();
      s.moves.push({ id, to, opts, at });
      const prev = pending.get(id);
      if (prev) {
        clock.timers.clear(prev.timer);
        prev.resolve(false);
      }
      const from = s.placeOf(id);
      const dest = pointOf(id, to);
      const dist = Math.abs(dest.x - from.x) + Math.abs(dest.y - from.y);
      const dur = opts.pace === 'instant' ? 0 : Math.max(900, (dist / (opts.speed ?? 42)) * 1000) - (opts.elapsedMs ?? 0);
      s.pos.set(id, { place: to, x: from.x, y: from.y, walking: true });
      let resolve!: (ok: boolean) => void;
      const done = new Promise<boolean>((r) => (resolve = r));
      const timer = clock.timers.set(() => {
        pending.delete(id);
        s.pos.set(id, { place: to, x: dest.x, y: dest.y, walking: false });
        resolve(true);
      }, Math.max(0, dur));
      pending.set(id, { resolve, timer });
      const handle: MoveHandle = {
        durationMs: Math.max(0, dur),
        cancel() {
          const p = pending.get(id);
          if (!p) return;
          clock.timers.clear(p.timer);
          pending.delete(id);
          s.cancels.push({ id, at: clock.ms() });
          const cur = s.placeOf(id);
          s.pos.set(id, { place: { kind: 'point', x: cur.x, y: cur.y }, x: cur.x, y: cur.y, walking: false });
          resolve(false);
        },
        done,
      };
      return handle;
    },
    placeOf(id) {
      const p = s.pos.get(id);
      if (p) return p;
      const d = pointOf(id, { kind: 'desk' });
      return { place: { kind: 'desk' }, x: d.x, y: d.y, walking: false };
    },
    face() {},
    cue(id, gesture) {
      s.cues.push({ id, gesture, at: clock.ms() });
    },
    say(id, text, opts) {
      s.says.push({ id, text, huddleId: opts.huddleId, ttlMs: opts.ttlMs, at: clock.ms(), ...(opts.nonverbal ? { nonverbal: true } : {}) });
    },
    unsay() {},
    visibility: (id) => s.vis(id),
    visibilityAt: (p) => s.visAt(p),
    showHuddle(h) {
      s.shown.set(h.id, h);
      s.speakers.push(h.speaker);
    },
    hideHuddle(id) {
      s.shown.delete(id);
      s.hidden.push(id);
    },
    setLifeSummary(sum) {
      s.summaries.push(sum);
    },
    follow() {},
    setAutopilot() {},
    offerMoment(m) {
      s.offered.push(m);
    },
    attachLife(hooks) {
      s.hooks = hooks;
      return () => {
        s.hooks = null;
      };
    },
    getState: () => ({ mode: 'desks', hoveredId: null, focusedId: null, rooms: {}, camera: { x: 400, y: 120, zoom: 3.2 } }),
    nameOf: (id) => id,
  };
  return s;
}
