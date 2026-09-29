// createOfficeLife (OFFICE-LIFE §6.1): the runtime of the office's autonomous life. It plans the day (planner.ts),
// resolves real state over the plan (overrides.ts), moves people through the scene port, choreographs huddles and
// their small talk (choreo.ts, the host's `lines` provider), and keeps everything inside the Ambience caps and
// budgets. It never writes presence (O1) and runs no timers while the office is off-screen (O8).
import type { OfficePlan } from '../plan/types';
import type { Facing, Point, PresenceBadge, PresenceState } from '../types';
import { centroid, exchangeLength, facingToward, leanToward, MIN_LEFT_MS, SETTLE_MS, TALK_TOKEN_U, timeTurns } from './choreo';
import type { TimedTurn } from './choreo';
import type { SliderStats } from './knobs';
import { scoreMoments } from './moments';
import type { MomentCandidate } from './moments';
import type { Claim } from './overrides';
import { resolveClaim } from './overrides';
import { planDay, planTask, replanFrom, segmentAt } from './planner';
import type { PlanTask } from './planner';
import { rngFor } from '../rng';
import { planSpots } from './spots';
import { ACTIVITY_PLACES } from './activity';
import { BRISK, EXCHANGE_GAP_MS, HABITUATED_GAP_MS, HABITUATION_AFTER_MS, LIFE_CAPS, PHONE_WALKERS, SPOT_LABEL, SPOT_PHRASE, STROLL, STROLL_MAX, STROLL_MIN, dayKeyOf, isNightMinute, localMinute } from './tables';
import { lifeKnobs } from './knobs';
import { K_Y } from '../projection';
import type {
  Ambience,
  DayPlan,
  HoldWhy,
  HuddleInfo,
  HuddleLineEvent,
  HuddleLineRequest,
  HuddleScript,
  LifeCaps,
  LifeScenePort,
  LifeSummary,
  Moment,
  MoveHandle,
  OfficeLifePerson,
  OfficeLifeState,
  OfficeSpot,
  PlaceInfo,
  PlaceRef,
  PlannedHuddle,
  PlannerPerson,
  Segment,
  WorkActivity,
} from './types';

export interface OfficeLifeCallbacks {
  onHuddleStart?(h: HuddleInfo): void;
  /** Captions log; voice when e.listening (the host decides). */
  onHuddleLine?(h: HuddleInfo, e: HuddleLineEvent): void;
  onHuddleEnd?(h: HuddleInfo, info: { reason: 'dispersed' | 'override' | 'owner_left' | 'replanned' | 'suspended' }): void;
  onArrive?(personId: string, place: PlaceInfo): void;
  onDepart?(personId: string, from: PlaceInfo, to: PlaceInfo): void;
  onCameraSuggest?(m: Moment): void;
  /** The owner pressed Join. */
  onJoinHuddle?(h: HuddleInfo): void;
  onLeaveHuddle?(h: HuddleInfo): void;
  /** The huddle listened to (null: nobody). `reason: 'quiet'`: it had nothing more to say, so Listening ended. */
  onListenIn?(h: HuddleInfo | null, info?: { reason: 'quiet' }): void;
  /**
   * The owner pressed "Open in a room" on a joined huddle's card. Called before the huddle is left (so the host can
   * mark the move and skip its sign-off and leave note), then the owner walks into a room with the same people.
   */
  onHuddleToRoom?(h: HuddleInfo): void;
  /**
   * The first plan is placed: everyone is where the plan has them and the view is framed. The office is ready to be
   * seen (a host may keep it veiled until then). Called once.
   */
  onOpened?(): void;
  /** The standalone fallback composer only. */
  onTalkToHuddle?(h: HuddleInfo, text: string): void;
  /** ≤ 1 per 5 s. */
  onSummary?(s: LifeSummary): void;
  onPauseChange?(paused: boolean): void;
}

export interface LifeTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface OfficeLifeOptions extends OfficeLifeCallbacks {
  people: OfficeLifePerson[];
  /** The workspace id: the same floor on every device. */
  seed: string;
  /** Default scene.getPlan(). */
  plan?: OfficePlan;
  /** The owner-local clock; default () => new Date(). */
  now?: () => Date;
  /** Tests (fake clock). */
  timers?: LifeTimers;
  ambience?: Ambience;
  /** true / false, or null to follow prefers-reduced-motion. */
  reducedMotion?: boolean | null;
  /** Small talk; omitted → silent huddles. */
  lines?: (req: HuddleLineRequest) => HuddleScript | null;
  /** JS weekday numbers; default [1, 2, 3, 4, 5]. */
  workDays?: readonly number[];
  caps?: Partial<LifeCaps>;
  paused?: boolean;
  /** Default true: IntersectionObserver + visibilitychange suspension. */
  observe?: boolean;
  /** The Chief of Staff (default: whoever sits at the Chief's desk). */
  leadId?: string;
  sliderStats?: SliderStats;
  /** Phones keep fewer walkers. Default: the scene is narrower than 640 px. */
  phone?: boolean;
  /** Pull a departure forward when the office opens and nothing moves in view (default true). */
  nudge?: boolean;
  /**
   * 'idle' plans the day (and replans) in idle slices, so opening the office or changing the Ambience never blocks a
   * frame (people stay at their desks for the few hundred ms the first plan takes); 'sync' plans at once (tests).
   * Default: 'idle' where the window has requestIdleCallback, else 'sync'.
   */
  planIn?: 'idle' | 'sync';
  /** Frame the liveliest neighbourhood at L1 when the office opens on its default camera (default true). */
  frameOpening?: boolean;
}

export interface OfficeLife {
  readonly running: boolean;
  pause(): void;
  resume(): void;
  setAmbience(a: Ambience): void;
  setReducedMotion(v: boolean | null): void;
  /** Call after scene.setPeople. */
  setPeople(people: OfficeLifePerson[]): void;
  setActivity(personId: string, activity: WorkActivity | null): void;
  /** Returns unpin. */
  pin(personId: string, where: 'here' | 'desk' | 'booth' | PlaceRef, reason: 'owner' | 'call' | 'host'): () => void;
  /** Inc 1 real visits: the giver walks to the receiver's desk. */
  visit(fromId: string, toId: string, opts: { cause: string; maxWalkMs?: number }): boolean;
  listenIn(huddleId: string | null): void;
  join(huddleId: string): void;
  leave(): void;
  /** The owner said something to the joined huddle (keeps it open; the host answers with reply()). */
  talk(text: string): void;
  /**
   * Someone in the joined huddle answers the owner: a bubble over them and a line in the huddle's chat. `update`: the
   * same reply grew (its later sentences arrived): their latest line and bubble show the fuller text, no new line.
   */
  reply(personId: string, text: string, opts?: { update?: boolean }): void;
  whereIs(personId: string): PlaceInfo;
  huddles(): readonly HuddleInfo[];
  moments(): readonly Moment[];
  plan(): DayPlan | null;
  getState(): OfficeLifeState;
  /** Tests and hosts: run the director now (it also runs on its own timer). */
  tick(): void;
  destroy(): void;
}

interface Rt {
  id: string;
  /** Where they are or are heading. */
  target: PlaceRef;
  arrived: boolean;
  move: MoveHandle | null;
  moveSeq: number;
  moveKind: 'ambient' | 'real' | 'none';
  moveVisible: boolean;
  since: number;
  /** The ambient segment being executed (huddle membership). */
  seg: Segment | null;
  holds: Set<HoldWhy>;
  holdUntil: number;
  pins: Map<number, { where: 'here' | 'desk' | 'booth' | PlaceRef; reason: 'owner' | 'call' | 'host' }>;
  presence: PresenceState;
  badges: readonly PresenceBadge[];
  speaking: boolean;
  room: string | null;
  activity: WorkActivity | null;
  workSince: number | null;
  workPlace: 'desk' | PlaceRef;
  workPlaceAt: number;
  wrapUntil: number;
  deferredUntil: number;
  /** A local segment (opening nudge, real visits) that takes precedence over the plan. */
  local: Segment | null;
  speed: number;
  /** The camera follows this person: hover and focus do not hold them (they keep walking, the camera keeps up). */
  followed: boolean;
  /** When the current raised hand started (a moment is shown once per raised hand). */
  handSince: number | null;
}

interface Exchange {
  index: number;
  script: HuddleScript | null;
  turns: TimedTurn[];
  startedAt: number;
  endsAt: number;
  timers: unknown[];
  visible: boolean;
  /** Bubbles (L1+), or the plan-zoom murmur (the glyph pulses, the words go to the card and the pill). */
  mode: 'bubble' | 'glyph';
}

interface HuddleRt {
  plan: PlannedHuddle;
  spot: OfficeSpot;
  present: Set<string>;
  gatheredAt: number | null;
  startedNotified: boolean;
  exchange: Exchange | null;
  exchanges: number;
  lastExchangeEnd: number;
  lines: { personId: string; text: string; nonverbal?: boolean }[];
  joined: boolean;
  topic: string | null;
  shown: boolean;
  nextFace: number;
  lastOwnerTalk: number;
  /** Since when the huddle has been on screen at L1+ (null: not now). A newly framed huddle talks within a second. */
  visibleSince: number | null;
  /** Gathered while the office opened (or resumed): it talks at once, with no settle beat. */
  opened: boolean;
  /** Exchange ids already played here (never the same exchange twice in one huddle). */
  used: string[];
  /** Whoever is saying a line right now (the L0 glyph pulses in their accent). */
  speaker: string | null;
}

const NARROW_W = 640;
const HOLD_GRACE_MS = 3000;
const BUBBLE_GRACE_MS = 20_000;
const WORK_HYSTERESIS_MS = 1500;
const WORKPLACE_STICKY_MS = 180_000;
const HUSH_U = 200;
const LISTEN_MAX_MS = 120_000;
/**
 * Listening is the owner asking to hear them: a listened huddle talks within a breath of Listen (and again 4–8 s after
 * each exchange), at Quiet too, outside the floor's line budget, with a few exchanges more than the Ambience allows.
 * When it has nothing more to say, Listening ends with "They've gone quiet" (onListenIn(null, {reason: 'quiet'})).
 */
const LISTEN_GAP_MS: readonly [number, number] = [4000, 8000];
const LISTEN_EXTRA_EXCHANGES = 2;
const JOIN_IDLE_MS = 90_000;
const SUMMARY_MS = 5000;
/** A newly framed quiet huddle starts talking this long after the view settles. */
const FRAMED_BEAT_MS = 600;
/** At plan zoom, one huddle murmurs at a time, a new murmur at most this often floor-wide. */
const MURMUR_GAP_MS = 30_000;

const placeEq = (a: PlaceRef, b: PlaceRef): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'desk') return true;
  if (a.kind === 'spot' && b.kind === 'spot') return a.spotId === b.spotId && a.slot === b.slot;
  if (a.kind === 'room' && b.kind === 'room') return a.roomId === b.roomId && a.seat === b.seat;
  if (a.kind === 'point' && b.kind === 'point') return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
  return false;
};

export function createOfficeLife(scene: LifeScenePort, options: OfficeLifeOptions): OfficeLife {
  const timers: LifeTimers = options.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const clock = () => (options.now ? options.now().getTime() : Date.now());
  const doc = scene.el.ownerDocument;
  const win = doc?.defaultView ?? null;

  let ambience: Ambience = options.ambience ?? 'lively';
  let rmSetting: boolean | null = options.reducedMotion ?? null;
  let paused = !!options.paused;
  let destroyed = false;
  let suspended = false;
  let hidden = false;
  let offscreen = false;
  let stageOpen = false;
  let lifePeople = options.people.slice();
  let officePlan: OfficePlan = options.plan ?? scene.getPlan();
  let spots: readonly OfficeSpot[] = scene.spots?.() ?? planSpots(officePlan);
  let spotById = new Map(spots.map((s) => [s.id, s]));
  let dayPlan: DayPlan | null = null;
  let mainTimer: unknown = null;
  let nextWake = Infinity;
  let listening: string | null = null;
  let listenSince = 0;
  let joined: string | null = null;
  /** The huddle whose card the owner has open: it may talk even at plan zoom (the card shows the lines). */
  let cardOpen: string | null = null;
  let lastSummary = 0;
  let summaryDirty = false;
  let lastViewChange = clock();
  let budget = { tokens: 0, at: clock(), minute: [] as number[] };
  const shownAt = new Map<string, number>();
  const huddleRts = new Map<string, HuddleRt>();
  const rts = new Map<string, Rt>();
  const firstHuddleToday = new Map<string, string>();
  let pinSeq = 1;
  let lastTop: string | null = null;
  const bootAt = clock();
  /** When the office opened (huddles gathered in the first seconds talk at once, with no settle beat). */
  let openedAt = bootAt;
  /** Until the first plan is placed (the floor renders first; the plan follows in idle time). */
  let opening = true;
  /** Floor-wide: the last exchange that started (habituation) and the last plan-zoom murmur. */
  let lastExchangeStart = -Infinity;
  let lastMurmur = -Infinity;
  /** Raised-hand moments the autopilot already showed (once per raised hand). */
  const handShown = new Set<string>();
  /** Small one-off timers (face turns, the post-leave release). Cleared when the office goes off-screen; essential ones run then. */
  const misc = new Map<unknown, { fn: () => void; essential: boolean }>();
  const later = (fn: () => void, ms: number, essential = false) => {
    const h: unknown = timers.set(() => {
      misc.delete(h);
      if (!destroyed) fn();
    }, ms);
    misc.set(h, { fn, essential });
    return h;
  };
  const flushMisc = () => {
    for (const [h, t] of [...misc]) {
      timers.clear(h);
      misc.delete(h);
      if (t.essential && !destroyed) t.fn();
    }
  };
  const reducedMotion = (): boolean => {
    if (rmSetting !== null) return rmSetting;
    try {
      return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  };
  const caps = (): LifeCaps => {
    const base = { ...LIFE_CAPS[ambience], ...options.caps };
    const phone = options.phone ?? (scene.el.clientWidth > 0 && scene.el.clientWidth < NARROW_W);
    if (phone) base.walkers = Math.min(base.walkers, PHONE_WALKERS[ambience]);
    return base;
  };
  budget.tokens = caps().burst;

  // ── people ─────────────────────────────────────────────────────────────────────
  const leadOf = (): string => options.leadId ?? officePlan.seats.find((s) => s.kind === 'chief')?.personId ?? '';
  const groupOf = (id: string): string => {
    const seatId = officePlan.seatOf[id];
    const seat = seatId ? officePlan.seats.find((s) => s.id === seatId) : undefined;
    return (seat && officePlan.zones.find((z) => z.id === seat.zoneId)?.groupId) ?? (seat?.kind === 'chief' ? 'chief' : 'unknown');
  };
  const plannerPeople = (): PlannerPerson[] => {
    const byId = new Map(lifePeople.map((p) => [p.id, p]));
    return Object.keys(officePlan.seatOf).map((id) => ({ ...(byId.get(id) ?? { id }), id, groupId: groupOf(id), seniority: (byId.get(id) as { seniority?: PlannerPerson['seniority'] } | undefined)?.seniority }));
  };
  const syncRts = () => {
    const people = plannerPeople();
    const keep = new Set(people.map((p) => p.id));
    for (const id of [...rts.keys()]) if (!keep.has(id)) rts.delete(id);
    for (const p of people) {
      const knobs = lifeKnobs(p, options.sliderStats);
      const speed = Math.max(STROLL_MIN, Math.min(STROLL_MAX, STROLL * (0.85 + 0.3 * knobs.r)));
      const r = rts.get(p.id);
      if (r) {
        r.speed = speed;
        continue;
      }
      rts.set(p.id, {
        id: p.id,
        target: { kind: 'desk' },
        arrived: true,
        move: null,
        moveSeq: 0,
        moveKind: 'none',
        moveVisible: false,
        since: clock(),
        seg: null,
        holds: new Set(),
        holdUntil: 0,
        pins: new Map(),
        presence: 'idle',
        badges: [],
        speaking: false,
        room: null,
        activity: null,
        workSince: null,
        workPlace: 'desk',
        workPlaceAt: 0,
        wrapUntil: 0,
        deferredUntil: 0,
        local: null,
        speed,
        followed: false,
        handSince: null,
      });
    }
  };
  syncRts();

  // ── planning ───────────────────────────────────────────────────────────────────
  const planInput = (day: Date) => ({
    seed: options.seed,
    day,
    plan: officePlan,
    spots,
    people: plannerPeople(),
    leadId: leadOf(),
    ambience,
    ...(options.workDays ? { workDays: options.workDays } : {}),
    ...(options.sliderStats ? { sliderStats: options.sliderStats } : {}),
    ...(options.caps ? { caps: options.caps } : {}),
  });
  // The first plan (and every replan) runs in idle slices by default: opening the office or changing the Ambience
  // never blocks a frame. A replan keeps everything that departs before now + 30 s, so it lands seamlessly.
  const idleMode = (options.planIn ?? (typeof (win as { requestIdleCallback?: unknown } | null)?.requestIdleCallback === 'function' ? 'idle' : 'sync')) === 'idle';
  let task: { t: PlanTask; key: string; cancel: (() => void) | null } | null = null;
  const applyPlan = (next: DayPlan) => {
    const newDay = !dayPlan || dayPlan.dayKey !== next.dayKey;
    dayPlan = next;
    if (newDay) firstHuddleToday.clear();
    // Planned huddles that no longer exist end now.
    for (const [id, h] of huddleRts) if (!next.huddles.some((x) => x.id === id)) endHuddle(h, 'replanned');
    if (opening && !suspended) placeOpening();
    schedule(0);
  };
  const runSlice = () => {
    if (!task || destroyed) return;
    task.cancel = null;
    if (suspended) return;
    const plan = task.t.step(8);
    if (plan) {
      task = null;
      applyPlan(plan);
    } else queueSlice();
  };
  const queueSlice = () => {
    if (!task || task.cancel || destroyed || suspended) return;
    const w = win as unknown as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void } | null;
    // Idle callbacks on the real clock; with the host's own timers (tests, an accelerated demo clock), 0 ms slices.
    if (w?.requestIdleCallback && !options.timers) {
      const h = w.requestIdleCallback(runSlice, { timeout: 250 });
      task.cancel = () => w.cancelIdleCallback?.(h);
    } else {
      const h = timers.set(runSlice, 0);
      task.cancel = () => timers.clear(h);
    }
  };
  const startTask = (now: number, replanning: boolean) => {
    task?.cancel?.();
    const day = new Date(now);
    const key = dayKeyOf(day);
    const t = replanning && dayPlan && dayPlan.dayKey === key ? planTask(planInput(day), dayPlan, now) : planTask(planInput(day));
    task = { t, key, cancel: null };
    queueSlice();
  };
  const ensurePlan = (now: number) => {
    const key = dayKeyOf(new Date(now));
    if (dayPlan && dayPlan.dayKey === key) return;
    if (!idleMode) {
      dayPlan = planDay(planInput(new Date(now)));
      firstHuddleToday.clear();
      return;
    }
    if (!task || task.key !== key) startTask(now, false);
  };
  const replan = () => {
    const now = clock();
    if (idleMode) {
      startTask(now, true);
      return;
    }
    if (!dayPlan || dayPlan.dayKey !== dayKeyOf(new Date(now))) {
      dayPlan = null;
      ensurePlan(now);
    } else dayPlan = replanFrom(dayPlan, now, planInput(new Date(now)));
    const current = dayPlan as DayPlan | null;
    for (const [id, h] of huddleRts) {
      if (!current?.huddles.some((x) => x.id === id)) endHuddle(h, 'replanned');
    }
    schedule(0);
  };

  // ── claims (§2.9) ──────────────────────────────────────────────────────────────
  const claimsOf = (r: Rt, now: number): Claim[] => {
    const out: Claim[] = [];
    if (r.holds.size || now < r.holdUntil) out.push({ kind: 'owner', where: 'here' });
    for (const p of r.pins.values()) out.push({ kind: p.reason === 'owner' ? 'owner' : p.reason === 'call' ? 'call' : 'host', where: p.where });
    if (r.room) out.push({ kind: 'room' });
    if (r.presence === 'raised_hand' || r.badges.includes('hand')) out.push({ kind: 'hand' });
    if (r.presence === 'working') {
      if (r.workSince !== null && now - r.workSince >= WORK_HYSTERESIS_MS) out.push({ kind: 'work', where: 'workplace' });
      else out.push({ kind: 'conversation', where: 'here' });
    } else if (now < r.wrapUntil) out.push({ kind: 'work', where: 'desk' });
    if (r.presence === 'thinking' || r.presence === 'listening' || r.presence === 'speaking' || r.speaking) out.push({ kind: 'conversation' });
    return out;
  };
  const occupiedBy = (spotId: string, slot: number, except: string): boolean => {
    for (const o of rts.values()) {
      if (o.id === except) continue;
      if (o.target.kind === 'spot' && o.target.spotId === spotId && o.target.slot === slot) return true;
    }
    return false;
  };
  const workplaceOf = (r: Rt, now: number): 'desk' | PlaceRef => {
    const kind = r.activity ? ACTIVITY_PLACES[r.activity] : undefined;
    let want: 'desk' | PlaceRef = 'desk';
    if (kind === 'library') {
      // The reading chair if it is free (or theirs), else a standing place at the shelves.
      for (const sid of ['library:read', 'library:shelves']) {
        const sp = spotById.get(sid);
        const i = sp ? sp.slots.findIndex((_, k) => !occupiedBy(sid, k, r.id)) : -1;
        if (sp && i >= 0) {
          want = { kind: 'spot', spotId: sid, slot: i };
          break;
        }
      }
    }
    const same = want === 'desk' ? r.workPlace === 'desk' : r.workPlace !== 'desk' && placeEq(r.workPlace, want);
    if (!same && now - r.workPlaceAt >= WORKPLACE_STICKY_MS) {
      r.workPlace = want;
      r.workPlaceAt = now;
    } else if (!same && r.workPlaceAt === 0) {
      r.workPlace = want;
      r.workPlaceAt = now;
    }
    return r.workPlace;
  };

  interface Desire {
    place: PlaceRef | 'here';
    kind: 'real' | 'ambient';
    pace: 'stroll' | 'brisk';
    seg: Segment | null;
  }
  const skipUnderRm = (s: Segment) => s.state === 'break' && !s.anchor && rngFor(`rm|${s.personId}|${s.departAt}`)() < 0.4;
  const desire = (r: Rt, now: number): Desire => {
    const c = resolveClaim(claimsOf(r, now));
    if (c) {
      if (c.where === 'here' || c.where === 'room') return { place: 'here', kind: 'real', pace: 'brisk', seg: null };
      if (c.where === 'desk') return { place: { kind: 'desk' }, kind: 'real', pace: 'brisk', seg: null };
      if (c.where === 'workplace') {
        const wp = workplaceOf(r, now);
        return { place: wp === 'desk' ? { kind: 'desk' } : wp, kind: 'real', pace: 'brisk', seg: null };
      }
      if (c.where === 'booth') {
        const booth = spots.find((s) => s.kind === 'phone_booth' && (!occupiedBy(s.id, 0, r.id) || (r.target.kind === 'spot' && r.target.spotId === s.id)));
        return booth ? { place: { kind: 'spot', spotId: booth.id, slot: 0 }, kind: 'real', pace: 'brisk', seg: null } : { place: 'here', kind: 'real', pace: 'brisk', seg: null };
      }
      return { place: c.where, kind: 'real', pace: 'brisk', seg: null };
    }
    if (paused || !dayPlan) return { place: 'here', kind: 'ambient', pace: 'stroll', seg: null };
    let seg = r.local && now < (r.local.backAt ?? r.local.end) ? r.local : segmentAt(dayPlan, r.id, now);
    if (r.local && now >= (r.local.backAt ?? r.local.end)) r.local = null;
    if (seg && reducedMotion() && skipUnderRm(seg)) seg = null;
    // A visit waits for an idle host; a huddle whose members are all elsewhere is not worth the walk.
    if (seg && seg.state === 'visit' && seg.hostId) {
      const host = rts.get(seg.hostId);
      if (host && (host.target.kind !== 'desk' || host.presence !== 'idle' || host.room)) seg = null;
    }
    if (seg && now < seg.end) return { place: seg.place, kind: 'ambient', pace: 'stroll', seg };
    return { place: { kind: 'desk' }, kind: 'ambient', pace: 'stroll', seg: null };
  };

  // ── moves ──────────────────────────────────────────────────────────────────────
  const ambientWalkers = () => {
    let n = 0;
    for (const r of rts.values()) if (r.moveKind === 'ambient' && !r.arrived) n++;
    return n;
  };
  const visibleFades = () => {
    let n = 0;
    for (const r of rts.values()) if (!r.arrived && r.moveVisible) n++;
    return n;
  };
  const labelOf = (place: PlaceRef): string => {
    if (place.kind === 'desk') return 'Desk';
    if (place.kind === 'room') return 'Room';
    if (place.kind === 'point') return 'Walking';
    const sp = spotById.get(place.spotId);
    if (!sp) return 'Away';
    if (sp.kind === 'desk_dropby' && sp.seatId) {
      const host = officePlan.seats.find((s) => s.id === sp.seatId)?.personId;
      const first = host ? (scene as { nameOf?(id: string): string }).nameOf?.(host)?.split(/\s+/)[0] : undefined;
      return first ? `At ${first}'s desk` : sp.label;
    }
    return sp.label;
  };
  const infoOf = (r: Rt): PlaceInfo => {
    const kind: PlaceInfo['kind'] = !r.arrived ? 'walking' : r.target.kind === 'desk' ? 'desk' : r.target.kind === 'room' ? 'room' : r.target.kind === 'point' ? 'walking' : (spotById.get(r.target.spotId)?.kind ?? 'desk');
    const state: PlaceInfo['state'] = !r.arrived
      ? 'walking'
      : r.room
        ? 'meeting'
        : r.presence === 'working'
          ? 'focus'
          : r.target.kind === 'desk'
            ? 'desk'
            : r.seg?.state === 'visit'
              ? 'visit'
              : r.seg?.huddleId && huddleRts.get(r.seg.huddleId)?.present.has(r.id)
                ? 'huddle'
                : r.pins.size || (r.holds.size && !r.followed)
                  ? 'held'
                  : 'break';
    return { place: r.target, kind, label: labelOf(r.target), state, since: r.since };
  };

  const issueMove = (r: Rt, to: PlaceRef, d: Desire, now: number, opts: { instant?: boolean; elapsedMs?: number; fade?: boolean } = {}) => {
    const from = infoOf(r);
    r.move?.cancel();
    const seq = ++r.moveSeq;
    const spot = to.kind === 'spot' ? spotById.get(to.spotId) : undefined;
    const vis = scene.visibility(r.id) > 0;
    const rm = reducedMotion();
    const pace = opts.instant || rm ? 'instant' : d.pace;
    const face: Facing | Point | undefined = spot ? spot.slots[(to as { slot: number }).slot]?.facing ?? spot.center : undefined;
    const handle = scene.moveTo(r.id, to, {
      pace,
      speed: d.pace === 'brisk' ? BRISK : r.speed,
      ...(face ? { face } : {}),
      ...(opts.elapsedMs ? { elapsedMs: opts.elapsedMs } : {}),
      ...(opts.fade === false ? { fade: false } : {}),
    } as Parameters<LifeScenePort['moveTo']>[2]);
    r.move = handle;
    r.target = to;
    r.arrived = false;
    r.moveKind = d.kind;
    r.moveVisible = vis && pace === 'instant' && opts.fade !== false;
    r.seg = d.seg;
    r.since = now;
    // Leaving a huddle.
    for (const h of huddleRts.values()) if (h.present.has(r.id) && !(to.kind === 'spot' && to.spotId === h.spot.id)) leaveHuddle(h, r.id);
    options.onDepart?.(r.id, from, infoOf(r));
    handle.done.then(
      (ok) => {
        if (destroyed || r.moveSeq !== seq) return;
        r.move = null;
        r.moveVisible = false;
        if (!ok) {
          // Stopped where they are (an owner hold): a point on the floor.
          const p = scene.placeOf(r.id);
          r.target = p.place.kind === 'point' ? p.place : { kind: 'point', x: p.x, y: p.y };
          r.arrived = true;
          r.moveKind = 'none';
          return;
        }
        r.arrived = true;
        r.moveKind = 'none';
        r.since = clock();
        options.onArrive?.(r.id, infoOf(r));
        arrive(r);
        schedule(0);
      },
      () => {},
    );
  };

  /** Resolve a slot collision at arrival time: the next free slot of the spot, else give up (desk). */
  const freeSlotFor = (r: Rt, want: PlaceRef): PlaceRef | null => {
    if (want.kind !== 'spot') return want;
    if (!occupiedBy(want.spotId, want.slot, r.id)) return want;
    const sp = spotById.get(want.spotId);
    if (!sp) return null;
    for (let i = 0; i < sp.slots.length; i++) if (!occupiedBy(sp.id, i, r.id)) return { kind: 'spot', spotId: sp.id, slot: i };
    return null;
  };

  const step = (r: Rt, now: number) => {
    const d = desire(r, now);
    if (d.place === 'here') {
      // An owner hold stops a walk in progress (eases to a stop within 0.5 s); other claims let it finish.
      const c = resolveClaim(claimsOf(r, now));
      if (c?.kind === 'owner' && r.move && !r.arrived) r.move.cancel();
      return;
    }
    if (placeEq(d.place, r.target)) {
      if (d.seg && r.seg !== d.seg) r.seg = d.seg;
      return;
    }
    let to: PlaceRef | null = d.place;
    if (d.kind === 'ambient') {
      if (now < r.deferredUntil) return;
      if (ambientWalkers() >= caps().walkers || (reducedMotion() && scene.visibility(r.id) > 0 && visibleFades() >= 2)) {
        r.deferredUntil = now + 1000;
        return;
      }
      to = freeSlotFor(r, d.place);
      if (!to) to = { kind: 'desk' };
      if (placeEq(to, r.target)) return;
    }
    issueMove(r, to, d, now);
  };

  // ── huddles ────────────────────────────────────────────────────────────────────
  const firstNameOf = (id: string): string => ((scene as { nameOf?(id: string): string }).nameOf?.(id) ?? id).split(/\s+/)[0] ?? id;
  /** "Water cooler", or for a desk drop-by "At Jasleen's desk" (the card adds "· Nayra visiting"). */
  const huddleLabel = (h: HuddleRt): string => (h.spot.kind === 'desk_dropby' && h.plan.hostId ? `At ${firstNameOf(h.plan.hostId)}'s desk` : h.spot.kind === 'desk_dropby' ? SPOT_LABEL.desk_dropby : h.spot.label);
  const huddleInfo = (h: HuddleRt): HuddleInfo => ({
    id: h.plan.id,
    spotId: h.spot.id,
    spot: h.spot.kind,
    label: huddleLabel(h),
    members: [...h.present],
    startedAt: h.gatheredAt ?? h.plan.start,
    endsAt: h.plan.end,
    joined: h.joined,
    listening: listening === h.plan.id,
    crew: !!h.plan.crewId,
    ...(h.plan.hostId ? { hostId: h.plan.hostId } : {}),
    ...(h.plan.usualMin !== undefined ? { usualMin: h.plan.usualMin } : {}),
  });
  const posOf = (id: string): Point => {
    const p = scene.placeOf(id);
    return { x: p.x, y: p.y };
  };
  const centerOf = (h: HuddleRt): Point => centroid([...h.present].map(posOf));
  const visOf = (h: HuddleRt): 0 | 1 | 2 | 3 => {
    const c = centerOf(h);
    if (scene.visibilityAt) return scene.visibilityAt(c);
    let v: 0 | 1 | 2 | 3 = 0;
    for (const id of h.present) v = Math.max(v, scene.visibility(id)) as 0 | 1 | 2 | 3;
    return v;
  };
  const showHuddle = (h: HuddleRt) => {
    if (h.present.size < 2) return;
    h.shown = true;
    scene.showHuddle({
      id: h.plan.id,
      members: [...h.present],
      center: centerOf(h),
      label: huddleInfo(h).label,
      talking: !!h.exchange,
      joined: h.joined,
      listening: listening === h.plan.id,
      lines: h.lines.slice(-6),
      speaker: h.speaker,
      ...(h.plan.hostId ? { hostId: h.plan.hostId } : {}),
      ...(h.plan.usualMin !== undefined ? { usualMin: h.plan.usualMin, where: SPOT_PHRASE[h.spot.kind] } : {}),
    });
  };
  const faceGroup = (h: HuddleRt) => {
    const c = centerOf(h);
    for (const id of h.present) {
      if (h.joined) scene.face(id, 'viewer');
      else scene.face(id, facingToward(posOf(id), c));
    }
  };

  const arrive = (r: Rt) => {
    const seg = r.seg;
    if (!seg || r.target.kind !== 'spot') return;
    const hid = seg.huddleId;
    if (!hid || !dayPlan) return;
    const planned = dayPlan.huddles.find((x) => x.id === hid);
    const spot = spotById.get(r.target.spotId);
    if (!planned || !spot) return;
    let h = huddleRts.get(hid);
    if (!h) {
      h = { plan: planned, spot, present: new Set(), gatheredAt: null, startedNotified: false, exchange: null, exchanges: 0, lastExchangeEnd: 0, lines: [], joined: false, topic: null, shown: false, nextFace: 0, lastOwnerTalk: 0, visibleSince: null, opened: clock() - openedAt < 3000, used: [], speaker: null };
      huddleRts.set(hid, h);
    }
    // A visit's host is present at their desk.
    if (seg.state === 'visit' && seg.hostId) {
      const host = rts.get(seg.hostId);
      if (host && host.target.kind === 'desk' && host.arrived) h.present.add(host.id);
    }
    // Anyone of this huddle already standing at the spot is present (someone who was on a solo break and was joined,
    // or a plan that changed while they stood there).
    for (const o of rts.values()) {
      if (o === r || h.present.has(o.id) || !o.arrived || o.target.kind !== 'spot' || o.target.spotId !== spot.id) continue;
      const os = o.seg ?? segmentAt(dayPlan, o.id, clock());
      if (os?.huddleId === hid) {
        o.seg = os;
        h.present.add(o.id);
      }
    }
    const newcomer = r.id;
    const others = [...h.present];
    h.present.add(newcomer);
    if (h.present.size >= 2) {
      const now = clock();
      if (h.gatheredAt === null) h.gatheredAt = now;
      // Whoever is already there looks up and smiles at the newcomer.
      for (const o of others) {
        scene.cue(o, 'look_up');
        scene.face(o, facingToward(posOf(o), posOf(newcomer)));
      }
      later(() => {
        if (!huddleRts.has(hid)) return;
        faceGroup(h!);
        for (const o of others) scene.cue(o, 'smile');
      }, 450);
      if (!h.startedNotified) {
        h.startedNotified = true;
        summaryDirty = true;
        options.onHuddleStart?.(huddleInfo(h));
      }
      showHuddle(h);
    }
  };

  const leaveHuddle = (h: HuddleRt, id: string) => {
    h.present.delete(id);
    if (h.gatheredAt === null) return;
    if (h.present.size < 2) {
      const r = rts.get(id);
      const why = r && resolveClaim(claimsOf(r, clock())) ? 'override' : 'dispersed';
      endHuddle(h, why);
    } else showHuddle(h);
  };

  const stopExchange = (h: HuddleRt) => {
    if (!h.exchange) return;
    for (const t of h.exchange.timers) timers.clear(t);
    for (const id of h.present) scene.unsay?.(id);
    h.lastExchangeEnd = clock();
    h.exchange = null;
    h.speaker = null;
  };

  const endHuddle = (h: HuddleRt, reason: 'dispersed' | 'override' | 'owner_left' | 'replanned' | 'suspended') => {
    if (!huddleRts.has(h.plan.id)) return;
    stopExchange(h);
    huddleRts.delete(h.plan.id);
    if (h.shown) scene.hideHuddle(h.plan.id);
    if (listening === h.plan.id) {
      listening = null;
      options.onListenIn?.(null);
    }
    if (joined === h.plan.id) joined = null;
    if (h.startedNotified) {
      summaryDirty = true;
      options.onHuddleEnd?.(huddleInfo(h), { reason });
    }
  };

  /** The small-talk budget (a token bucket plus a per-minute ceiling): is there room for n visible lines now? */
  const lineBudgetOk = (now: number, n = 1) => {
    const c = caps();
    const refill = ((now - budget.at) / 60_000) * c.linesPerMin;
    budget.tokens = Math.min(c.burst, budget.tokens + refill);
    budget.at = now;
    budget.minute = budget.minute.filter((t) => now - t < 60_000);
    return budget.tokens >= n && budget.minute.length + n <= c.linesPerMin;
  };
  /** Reserve an exchange's lines at its start, spread over its turn times (so concurrent huddles never overbook). */
  const reserveLines = (now: number, at: readonly number[]) => {
    budget.tokens = Math.max(0, budget.tokens - at.length);
    for (const t of at) budget.minute.push(now + t);
  };

  const talkingNear = (h: HuddleRt, radius: number): boolean => {
    const c = centerOf(h);
    for (const o of huddleRts.values()) {
      if (o === h || !o.exchange) continue;
      const d = Math.hypot(centerOf(o).x - c.x, centerOf(o).y - c.y);
      if (d < radius) return true;
    }
    return false;
  };
  const hushed = (h: HuddleRt): boolean => {
    const c = centerOf(h);
    for (const r of rts.values()) {
      if (!r.holds.has('bubble') && !r.holds.has('anchor')) continue;
      if (h.present.has(r.id)) return true;
      const p = posOf(r.id);
      if (Math.hypot(p.x - c.x, p.y - c.y) < HUSH_U) return true;
    }
    return false;
  };
  const visibleTalking = () => {
    let n = 0;
    for (const o of huddleRts.values()) if (o.exchange?.visible) n++;
    return n;
  };

  const contextsFor = (h: HuddleRt, now: number): string[] => {
    const out: string[] = [];
    if (h.plan.crewId) out.push('crew');
    const members = [...h.present];
    if (members.every((m) => !firstHuddleToday.has(m) || firstHuddleToday.get(m) === h.plan.id)) out.push('first_today');
    const groups = new Set(members.map(groupOf));
    out.push(groups.size === 1 ? 'same_department' : 'cross_department');
    if (isNightMinute(localMinute(now))) out.push('night');
    // "The café's all ours" is true only when nobody else is at the place (within 45 u of the spot).
    const c = h.spot.center;
    let others = 0;
    for (const o of rts.values()) {
      if (h.present.has(o.id) || o.target.kind === 'desk' || o.target.kind === 'room') continue;
      const p = posOf(o.id);
      if (Math.hypot(p.x - c.x, p.y - c.y) < 45) others++;
    }
    if (!others) out.push('spot_empty');
    return out;
  };

  /** Caps for talk now: after ten minutes of passive viewing Buzzing falls back to Lively (habituation). */
  const talkCaps = (now: number): LifeCaps => {
    const c = caps();
    if (ambience !== 'buzzing' || now - lastViewChange <= HABITUATION_AFTER_MS) return c;
    const l = LIFE_CAPS.lively;
    return { ...c, exchangesPerHuddle: l.exchangesPerHuddle, linesPerMin: l.linesPerMin, burst: l.burst, huddleBubbles: l.huddleBubbles };
  };
  const habituated = (now: number) => ambience === 'lively' && now - lastViewChange > HABITUATION_AFTER_MS;
  const murmuring = () => {
    for (const o of huddleRts.values()) if (o.exchange && o.exchange.mode === 'glyph') return true;
    return false;
  };
  const quietBeat = (h: HuddleRt, now: number, gesture: 'nod' | 'smile' | 'either') => {
    if (now < h.nextFace) return;
    const ids = [...h.present];
    const who = ids[Math.floor(rngFor(`${h.plan.id}|face|${Math.floor(now / 7000)}`)() * ids.length)]!;
    scene.cue(who, gesture === 'either' ? (rngFor(`${h.plan.id}|g|${now}`)() < 0.5 ? 'nod' : 'smile') : gesture);
    h.nextFace = now + 6500 + rngFor(`${h.plan.id}|fg|${now}`)() * 5000;
  };

  /**
   * The rhythm of a huddle's small talk: the first exchange as soon as the huddle is on screen (no settle beat for
   * one that was already there when the office opened; ≤ 1 s after the owner frames a quiet huddle), then another
   * 20–40 s after each one ends while someone watches, up to the Ambience's exchanges per huddle. At plan zoom one
   * huddle at a time murmurs: its glyph pulses in the speaker's accent and the words go to its card and the pill.
   * Off-screen huddles are silent and consume no content.
   */
  /** The listened huddle has nothing more to say: Listening ends, and the host says so. */
  const goneQuiet = () => {
    if (!listening) return;
    listening = null;
    options.onListenIn?.(null, { reason: 'quiet' });
    for (const x of huddleRts.values()) showHuddle(x);
  };

  const maybeTalk = (h: HuddleRt, now: number) => {
    if (paused || h.exchange || h.joined || h.present.size < 2 || h.gatheredAt === null) return;
    const seen = visOf(h);
    const vis = Math.max(seen, cardOpen === h.plan.id ? 2 : 0);
    if (vis >= 2) h.visibleSince ??= now;
    else h.visibleSince = null;
    const settle = h.opened ? 0 : SETTLE_MS[0] + rngFor(`${h.plan.id}|settle`)() * (SETTLE_MS[1] - SETTLE_MS[0]);
    if (now - h.gatheredAt < settle) return;
    const isListened = listening === h.plan.id;
    if (vis === 0 && !isListened) return;
    if ((ambience === 'quiet' && !isListened) || !options.lines) {
      quietBeat(h, now, 'either');
      return;
    }
    const murmur = vis === 1 && !isListened;
    if (murmur && (murmuring() || now - lastMurmur < (habituated(now) ? HABITUATED_GAP_MS : MURMUR_GAP_MS))) {
      quietBeat(h, now, 'nod');
      return;
    }
    const c = talkCaps(now);
    const maxEx = isListened ? Math.max(c.exchangesPerHuddle, LIFE_CAPS.lively.exchangesPerHuddle) + LISTEN_EXTRA_EXCHANGES : c.exchangesPerHuddle;
    if (h.exchanges >= maxEx) {
      if (isListened) goneQuiet();
      return;
    }
    if (h.exchanges > 0) {
      if (isListened) {
        // Listen right after an exchange: talk now (after a breath). Listening on: the next one 4–8 s later.
        const gap = LISTEN_GAP_MS[0] + rngFor(`${h.plan.id}|lgap|${h.exchanges}`)() * (LISTEN_GAP_MS[1] - LISTEN_GAP_MS[0]);
        if (h.lastExchangeEnd >= listenSince ? now - h.lastExchangeEnd < gap : now - listenSince < FRAMED_BEAT_MS) return;
      } else {
        // Watched since the last exchange: wait 20–40 s. Newly framed by the owner: talk now (after a breath).
        const watched = h.visibleSince !== null && h.lastExchangeEnd >= h.visibleSince;
        const gap = EXCHANGE_GAP_MS[0] + rngFor(`${h.plan.id}|gap|${h.exchanges}`)() * (EXCHANGE_GAP_MS[1] - EXCHANGE_GAP_MS[0]);
        if (watched || murmur) {
          if (now - h.lastExchangeEnd < gap) return;
        } else if (h.visibleSince === null || now - h.visibleSince < FRAMED_BEAT_MS || now - h.lastExchangeEnd < 4000) return;
      }
    } else if (!h.opened && !isListened && h.visibleSince !== null && now - h.visibleSince < FRAMED_BEAT_MS) return;
    if (h.plan.end - now < (h.exchanges > 0 ? (isListened ? 12_000 : 25_000) : MIN_LEFT_MS)) {
      if (isListened) goneQuiet();
      return;
    }
    if (talkingNear(h, TALK_TOKEN_U) || hushed(h)) return;
    if (!murmur && !isListened && visibleTalking() >= c.huddleBubbles) return;
    if (!murmur && !isListened && !lineBudgetOk(now, 2)) return;
    // Habituation (Lively): after ten minutes of passive viewing, about one new exchange every three minutes.
    if (!isListened && habituated(now) && now - lastExchangeStart < HABITUATED_GAP_MS * (0.85 + 0.3 * rngFor(`${h.plan.id}|hab|${h.exchanges}`)())) return;
    const req: HuddleLineRequest = {
      huddleId: h.plan.id,
      spot: { id: h.spot.id, kind: h.spot.kind },
      participants: [...h.present],
      exchangeIndex: h.exchanges,
      maxLines: c.maxLines,
      seed: `${h.plan.id}|${h.exchanges}|${h.used.length}`,
      at: new Date(now),
      // At Quiet the owner asked to hear this one: its small talk is picked as at Lively.
      ambience: isListened && ambience === 'quiet' ? 'lively' : ambience,
      listening: isListened,
      contexts: contextsFor(h, now),
      previous: h.used.slice(),
      hostId: h.plan.hostId ?? null,
    };
    let script: HuddleScript | null = null;
    try {
      script = options.lines(req);
    } catch (err) {
      console.warn('[office life] lines provider failed', err);
    }
    if (!script || !script.lines.length) {
      // Nothing fits this group right now: they stay quiet company (a nod), and may try again after a gap.
      h.exchanges++;
      h.lastExchangeEnd = now;
      quietBeat(h, now, 'nod');
      return;
    }
    // The whole exchange must fit the budget, or it waits (the same seed gives the same exchange later).
    const spoken = script.lines.filter((l) => l.kind === 'line' && l.personId && h.present.has(l.personId)).length;
    if (!murmur && !isListened && vis >= 2 && !lineBudgetOk(now, spoken)) return;
    h.exchanges++;
    h.used.push(script.exchangeId);
    for (const m of h.present) if (!firstHuddleToday.has(m)) firstHuddleToday.set(m, h.plan.id);
    h.topic = script.topic ?? null;
    lastExchangeStart = now;
    if (murmur) lastMurmur = now;
    runExchange(h, script, now, murmur ? 'glyph' : 'bubble');
  };

  const runExchange = (h: HuddleRt, script: HuddleScript, now: number, mode: 'bubble' | 'glyph') => {
    const turns = timeTurns(script, rngFor(`${h.plan.id}|turns|${h.exchanges}`));
    const visible = mode === 'bubble' && (visOf(h) >= 2 || cardOpen === h.plan.id);
    // Laughs are caption chips, outside the bubble budget; only spoken lines reserve it.
    if (visible) reserveLines(now, turns.filter((t) => t.line.kind === 'line').map((t) => t.at));
    const ex: Exchange = { index: h.exchanges - 1, script, turns, startedAt: now, endsAt: now + exchangeLength(turns), timers: [], visible, mode };
    h.exchange = ex;
    showHuddle(h);
    turns.forEach((turn) => {
      ex.timers.push(
        timers.set(() => {
          if (destroyed || h.exchange !== ex) return;
          const line = turn.line;
          const speaker = line.personId;
          if (!h.present.has(speaker)) return;
          const shown = (visOf(h) >= 2 || cardOpen === h.plan.id) && !suspended;
          const glyph = !shown && visOf(h) === 1 && !suspended;
          const isListened = listening === h.plan.id;
          // A murmur the owner zoomed into mid-way: never a reply bubble without its opener. It ends here, and the
          // framed huddle starts a fresh exchange after the framed beat (the murmur does not count against it).
          if (shown && ex.mode === 'glyph' && !isListened && turns.some((t) => t.index < turn.index && t.line.kind === 'line')) {
            stopExchange(h);
            h.exchanges = Math.max(0, h.exchanges - 1);
            h.lastExchangeEnd = Math.min(clock(), h.visibleSince ?? clock()) - 4000;
            const c = centerOf(h);
            for (const id of h.present) scene.face(id, facingToward(posOf(id), c), { lean: 0 });
            showHuddle(h);
            schedule(0);
            return;
          }
          if (shown && ex.mode === 'glyph') ex.mode = 'bubble';
          if (line.kind === 'line' || line.kind === 'laugh') {
            if (shown || isListened) scene.say(speaker, line.text, { huddleId: h.plan.id, ttlMs: line.kind === 'laugh' ? Math.min(1200, turn.ttl) : turn.ttl, nonverbal: line.kind === 'laugh' });
            if (line.text) {
              h.lines.push({ personId: speaker, text: line.text, ...(line.kind === 'laugh' ? { nonverbal: true } : {}) });
              if (h.lines.length > 8) h.lines.shift();
            }
            // Everyone else leans toward the speaker; a laugh makes them smile.
            const sp = posOf(speaker);
            for (const o of h.present) {
              if (o === speaker) continue;
              scene.face(o, facingToward(posOf(o), sp), { lean: leanToward(posOf(o), sp) });
              if (line.kind === 'laugh') scene.cue(o, 'smile');
            }
            if (line.kind === 'laugh') scene.cue(speaker, 'smile');
            // The glyph pulses in the speaker's accent while the line runs.
            if (line.kind === 'line') {
              h.speaker = speaker;
              ex.timers.push(
                timers.set(() => {
                  if (h.speaker !== speaker || h.exchange !== ex) return;
                  h.speaker = null;
                  showHuddle(h);
                }, Math.max(400, turn.ttl - 150)),
              );
            }
          } else if (line.face) {
            scene.cue(speaker, (['nod', 'look_up', 'smile', 'head_tilt', 'brow_flash'].includes(line.face) ? line.face : 'nod') as 'nod');
          }
          ex.visible = shown;
          options.onHuddleLine?.(huddleInfo(h), { exchangeId: script.exchangeId, index: turn.index, line, visible: shown, ...(glyph ? { glyph: true } : {}), listening: isListened });
          showHuddle(h);
        }, Math.max(0, turn.at)),
      );
    });
    ex.timers.push(
      timers.set(() => {
        if (destroyed || h.exchange !== ex) return;
        h.exchange = null;
        h.speaker = null;
        h.lastExchangeEnd = clock();
        // Settle back: faces to the group, no lean.
        const c = centerOf(h);
        for (const id of h.present) scene.face(id, facingToward(posOf(id), c), { lean: 0 });
        showHuddle(h);
        schedule(0);
      }, exchangeLength(turns) + 150),
    );
  };

  // ── the tick ───────────────────────────────────────────────────────────────────
  const schedule = (ms: number) => {
    if (destroyed || suspended) return;
    const now = clock();
    const at = now + Math.max(0, ms);
    if (mainTimer !== null && at >= nextWake - 5) return;
    if (mainTimer !== null) timers.clear(mainTimer);
    nextWake = at;
    mainTimer = timers.set(() => {
      mainTimer = null;
      nextWake = Infinity;
      tick();
    }, Math.max(0, ms));
  };

  const nextBoundary = (now: number): number => {
    let next = now + SUMMARY_MS;
    if (!dayPlan) return next;
    for (const r of rts.values()) {
      const list = dayPlan.segments[r.id];
      if (list) {
        // The first boundary after now among the next few segments.
        let lo = 0;
        let hi = list.length;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if ((list[m]!.backAt ?? list[m]!.end) <= now) lo = m + 1;
          else hi = m;
        }
        for (let i = lo; i < Math.min(list.length, lo + 2); i++) {
          const s = list[i]!;
          for (const t of [s.departAt, s.end, s.backAt ?? s.end]) if (t > now && t < next) next = t;
        }
      }
      if (r.local) for (const t of [r.local.departAt, r.local.end]) if (t > now && t < next) next = t;
      if (r.workSince !== null && r.workSince + WORK_HYSTERESIS_MS > now) next = Math.min(next, r.workSince + WORK_HYSTERESIS_MS);
      for (const t of [r.holdUntil, r.wrapUntil, r.deferredUntil]) if (t > now && t < next) next = t;
    }
    const c = caps();
    for (const h of huddleRts.values()) {
      // Poll while a gathered huddle may still start an exchange (or show a face beat in view).
      const canTalk = h.exchanges < c.exchangesPerHuddle || listening === h.plan.id || ambience === 'quiet' || !options.lines;
      if (h.gatheredAt !== null && !h.exchange && !h.joined && canTalk && !paused) next = Math.min(next, now + 1000);
      if (h.plan.end > now) next = Math.min(next, h.plan.end);
    }
    // The day rolls over at midnight.
    if (dayPlan.dayEnd > now) next = Math.min(next, dayPlan.dayEnd + 1);
    if (summaryDirty) next = Math.min(next, lastSummary + 1000);
    return next;
  };

  const tick = () => {
    if (destroyed || suspended) return;
    const now = clock();
    ensurePlan(now);
    for (const r of rts.values()) step(r, now);
    for (const h of [...huddleRts.values()]) {
      // A huddle that never gathered is forgotten after its time; a gathered one ends below two people.
      if (h.gatheredAt === null) {
        if (now > h.plan.end + 30_000 || h.present.size === 0) huddleRts.delete(h.plan.id);
        continue;
      }
      if (h.present.size < 2) {
        endHuddle(h, 'dispersed');
        continue;
      }
      if (h.joined && now - h.lastOwnerTalk > JOIN_IDLE_MS) {
        api.leave();
        continue;
      }
      maybeTalk(h, now);
      if (h.shown) showHuddle(h);
    }
    if (listening) {
      const h = huddleRts.get(listening);
      if (!h || now - listenSince > LISTEN_MAX_MS || visOf(h) === 0) api.listenIn(null);
    }
    summarize(now);
    schedule(Math.min(SUMMARY_MS, Math.max(250, nextBoundary(now) - now)));
  };

  // ── summary and moments ────────────────────────────────────────────────────────
  const momentCandidates = (now: number): MomentCandidate[] => {
    const out: MomentCandidate[] = [];
    const night = isNightMinute(localMinute(now));
    for (const h of huddleRts.values()) {
      if (h.present.size < 2) continue;
      const c = centerOf(h);
      const names = [...h.present];
      const kind: Moment['kind'] = h.topic === 'welcome' ? 'welcome' : h.topic === 'wins' ? 'win' : h.topic === 'debate' ? 'debate' : night && h.spot.kind === 'window' ? 'night_window' : 'huddle';
      const last = [...h.lines].reverse().find((l) => !l.nonverbal && l.personId !== '@owner');
      // Prefer a huddle mid-exchange, and hold it for its remaining turns.
      const mid = h.exchange && h.exchange.mode === 'bubble' ? h.exchange.endsAt - now : 0;
      out.push({
        id: `m:${h.plan.id}`,
        kind,
        at: { x: c.x, y: c.y * K_Y },
        zoom: 3.2,
        personIds: names,
        huddleId: h.plan.id,
        endsAt: h.plan.end,
        label: huddleLabel(h),
        where: SPOT_PHRASE[h.spot.kind],
        ...(last ? { line: { personId: last.personId, text: last.text } } : {}),
        ...(h.plan.usualMin !== undefined ? { usualMin: h.plan.usualMin } : {}),
        ...(mid > 0 ? { holdMs: mid + 1000, bonus: 20 } : {}),
      });
    }
    for (const r of rts.values()) {
      if (r.presence === 'raised_hand' || r.badges.includes('hand')) {
        const p = posOf(r.id);
        // Once per raised hand: shown for ≤ 10 s, then it steps aside until the state changes.
        const id = `m:hand:${r.id}:${r.handSince ?? 0}`;
        out.push({ id, kind: 'raised_hand', at: { x: p.x, y: p.y * K_Y }, zoom: 3.4, personIds: [r.id], endsAt: now + 60_000, label: 'Waiting on you', holdMs: 10_000, ...(handShown.has(id) ? { bonus: -200 } : {}) });
      }
      if (!r.arrived && r.moveKind === 'real' && r.target.kind === 'spot') {
        const p = posOf(r.id);
        out.push({ id: `m:work:${r.id}`, kind: 'work_move', at: { x: p.x, y: p.y * K_Y }, zoom: 3.2, personIds: [r.id], endsAt: now + 30_000, label: labelOf(r.target) });
      } else if (!r.arrived && r.moveKind === 'ambient' && r.target.kind === 'spot' && r.seg?.huddleId) {
        // Someone on their way to join people: follow them there.
        const p = posOf(r.id);
        out.push({ id: `m:walk:${r.id}:${r.since}`, kind: 'arrival', at: { x: p.x, y: p.y * K_Y }, zoom: 3.2, personIds: [r.id], endsAt: now + 20_000, label: `On the way · ${labelOf(r.target)}` });
      }
    }
    return out;
  };
  const currentMoments = (now: number): Moment[] => {
    const st = (scene.getState() as { camera?: { x: number; y: number } }).camera;
    return scoreMoments(momentCandidates(now), { center: st ? { x: st.x, y: st.y } : { x: 0, y: 0 }, now, shownAt });
  };
  const summarize = (now: number) => {
    // Nothing to count before the opening is placed (everyone is still at their desk for those few hundred ms).
    if (opening) return;
    // Every 5 s, and within a second when a huddle starts or ends (the pill never says "Quiet floor" over a crowd).
    if (now - lastSummary < (summaryDirty ? 1000 : SUMMARY_MS)) return;
    summaryDirty = false;
    lastSummary = now;
    let away = 0;
    let walking = 0;
    let atWindows = 0;
    for (const r of rts.values()) {
      if (!r.arrived) walking++;
      if (r.target.kind !== 'desk' && !r.room) away++;
      if (r.arrived && r.target.kind === 'spot' && spotById.get(r.target.spotId)?.kind === 'window') atWindows++;
    }
    const ms = currentMoments(now);
    const s: LifeSummary = {
      huddles: [...huddleRts.values()].filter((h) => h.present.size >= 2).length,
      away,
      walking,
      paused,
      night: isNightMinute(localMinute(now)),
      atWindows,
      top: ms[0] ?? null,
      moments: ms.slice(0, 5),
    };
    scene.setLifeSummary(s);
    options.onSummary?.(s);
    const top = ms[0];
    if (top && top.id !== lastTop) {
      lastTop = top.id;
      scene.offerMoment(top);
      options.onCameraSuggest?.(top);
    }
  };

  // ── opening: place everyone, then pull a nearby departure forward ─────────────
  const snapToPlan = (fade: boolean) => {
    const now = clock();
    ensurePlan(now);
    for (const r of rts.values()) {
      const d = desire(r, now);
      if (d.place === 'here') continue;
      const seg = d.seg;
      if (placeEq(d.place, r.target) && r.arrived) continue;
      if (seg && now < seg.start && d.kind === 'ambient' && !reducedMotion()) {
        // Walking there right now: resume mid-path.
        issueMove(r, d.place, d, now, { elapsedMs: now - seg.departAt });
        continue;
      }
      issueMove(r, d.place, d, now, { instant: true, fade });
    }
    // Arrivals for anyone already in place (huddles in progress continue silently).
  };

  /** The first ten seconds: if nobody is walking in view, pull the nearest departure in view forward to now. */
  const nudge = () => {
    if (options.nudge === false || !dayPlan || paused) return;
    const now = clock();
    for (const r of rts.values()) if (!r.arrived && scene.visibility(r.id) > 0) return;
    // The nearest departure within two minutes whose person is in view (a huddle first).
    let best: { seg: Segment; score: number } | null = null;
    for (const r of rts.values()) {
      if (scene.visibility(r.id) === 0 || resolveClaim(claimsOf(r, now))) continue;
      for (const s of dayPlan.segments[r.id] ?? []) {
        if (s.departAt <= now || s.departAt > now + 120_000) continue;
        const score = s.departAt - now - (s.huddleId ? 60_000 : 0);
        if (!best || score < best.score) best = { seg: s, score };
      }
    }
    if (!best) return;
    const shift = best.seg.departAt - now - 1200;
    const group = best.seg.huddleId ? Object.values(dayPlan.segments).flat().filter((s) => s.huddleId === best!.seg.huddleId) : [best.seg];
    for (const s of group) {
      const r = rts.get(s.personId);
      if (!r) continue;
      r.local = { ...s, departAt: s.departAt - shift, start: s.start - shift, end: s.end - shift, backAt: s.backAt === null ? null : s.backAt - shift };
    }
    // The huddle's own times move with it.
    if (best.seg.huddleId) {
      const h = dayPlan.huddles.find((x) => x.id === best!.seg.huddleId);
      if (h) {
        const copy = { ...h, start: h.start - shift, end: h.end - shift };
        dayPlan = { ...dayPlan, huddles: dayPlan.huddles.map((x) => (x.id === h.id ? copy : x)) };
      }
    }
  };

  /** Open on the liveliest neighbourhood (the scene keeps a restored or already-moved camera). */
  const frameLiveliest = () => {
    if (options.frameOpening === false || !scene.frameOpening || !dayPlan) return;
    const now = clock();
    // Phones prefer the café or the cooler to the north glass: a window huddle would open on a screen of sky.
    const phone = options.phone ?? (scene.el.clientWidth > 0 && scene.el.clientWidth < NARROW_W);
    const byCell = new Map<string, { w: number; x: number; y: number }>();
    for (const r of rts.values()) {
      const seg = segmentAt(dayPlan, r.id, now);
      if (!seg || now < seg.start - 15_000 || now >= seg.end) continue;
      const sp = spotById.get(seg.place.spotId);
      if (!sp) continue;
      const sl = sp.slots[seg.place.slot] ?? sp.center;
      const cell = officePlan.cells.find((c) => sl.x >= c.x - 8 && sl.x < c.x + c.w + 8 && sl.y >= c.y - 14 && sl.y < c.y + c.h + 14);
      const key = cell?.id ?? `${Math.floor(sl.x / 112)}:${Math.floor(sl.y / 100)}`;
      const w = (seg.huddleId ? 3 : 1) * (phone && sp.kind === 'window' ? 0.4 : 1);
      const b = byCell.get(key) ?? { w: 0, x: 0, y: 0 };
      b.w += w;
      b.x += sl.x * w;
      b.y += sl.y * w;
      byCell.set(key, b);
    }
    let best: { w: number; x: number; y: number } | null = null;
    for (const b of byCell.values()) if (!best || b.w > best.w) best = b;
    if (best && best.w >= 2) scene.frameOpening({ x: best.x / best.w, y: best.y / best.w });
    else {
      const cafe = spotById.get('cafe:counter');
      if (cafe) scene.frameOpening(cafe.center);
    }
  };

  /** The first plan is ready: everyone to their place now (walks in progress resume), frame the view, nudge. */
  const placeOpening = () => {
    opening = false;
    openedAt = clock();
    snapToPlan(openedAt - bootAt > 1500);
    frameLiveliest();
    nudge();
    // The pill counts the placed floor on the next tick, not up to 5 s later.
    lastSummary = 0;
    summaryDirty = true;
    if (!openedOnce) {
      openedOnce = true;
      try {
        options.onOpened?.();
      } catch (err) {
        console.warn('[office life] onOpened failed', err);
      }
    }
  };
  let openedOnce = false;

  /** "Open in a room": the people present go with the owner to a conference room (the Garden fits up to 7). */
  const toRoom = (id: string) => {
    const h = huddleRts.get(id);
    if (!h || !scene.enterRoom) return;
    const members = [...h.present];
    if (!members.length) return;
    options.onHuddleToRoom?.(huddleInfo(h));
    if (joined === id) api.leave();
    scene.enterRoom(members.length <= 7 ? 'garden' : 'skyline', members);
  };

  // ── suspension (§2.10) ─────────────────────────────────────────────────────────
  const setSuspended = () => {
    const next = hidden || offscreen || stageOpen;
    if (next === suspended) return;
    suspended = next;
    if (suspended) {
      if (mainTimer !== null) timers.clear(mainTimer);
      mainTimer = null;
      nextWake = Infinity;
      for (const h of huddleRts.values()) stopExchange(h);
      flushMisc();
    } else {
      if (opening) {
        if (dayPlan) placeOpening();
        else queueSlice();
      } else {
        openedAt = clock();
        snapToPlan(true);
        queueSlice();
      }
      schedule(0);
    }
  };
  let io: IntersectionObserver | null = null;
  const onVisibility = () => {
    hidden = doc?.visibilityState === 'hidden';
    setSuspended();
  };
  if (options.observe !== false) {
    try {
      const IO = (win as unknown as { IntersectionObserver?: typeof IntersectionObserver } | null)?.IntersectionObserver;
      if (IO) {
        io = new IO((entries) => {
          for (const e of entries) offscreen = !e.isIntersecting;
          setSuspended();
        });
        io.observe(scene.el);
      }
    } catch {
      io = null;
    }
    doc?.addEventListener?.('visibilitychange', onVisibility);
  }

  // ── the scene's hooks ──────────────────────────────────────────────────────────
  ensurePlan(clock());
  const detach = scene.attachLife({
    onHold(id, held, why) {
      const r = rts.get(id);
      if (!r) return;
      // Someone the camera follows keeps walking: pointing at them or focusing them is how they got followed.
      if (r.followed && (why === 'hover' || why === 'focus')) return;
      if (held) r.holds.add(why);
      else {
        r.holds.delete(why);
        // A followed person goes on as soon as their chat closes (no grace: the camera is with them).
        if (!r.followed) r.holdUntil = Math.max(r.holdUntil, clock() + (why === 'bubble' || why === 'anchor' ? BUBBLE_GRACE_MS : HOLD_GRACE_MS));
      }
      if (held) step(r, clock());
      // An owner-directed bubble hushes small talk nearby.
      if (held && (why === 'bubble' || why === 'anchor')) {
        const p = posOf(id);
        for (const h of huddleRts.values()) {
          const c = centerOf(h);
          if (h.present.has(id) || Math.hypot(c.x - p.x, c.y - p.y) < HUSH_U) stopExchange(h);
        }
      }
      schedule(held ? 0 : HOLD_GRACE_MS + 20);
    },
    onHuddleAction(id, action, text) {
      if (action === 'join') api.join(id);
      else if (action === 'leave') api.leave();
      else if (action === 'listen') api.listenIn(listening === id ? null : id);
      else if (action === 'talk' && text) api.talk(text);
      else if (action === 'room') toRoom(id);
      else if (action === 'open') {
        cardOpen = id;
        schedule(1500);
      } else if (action === 'close' && cardOpen === id) cardOpen = null;
    },
    onPauseToggle(p) {
      if (p) api.pause();
      else api.resume();
    },
    onViewChange(info) {
      const now = clock();
      if (info?.input !== false) lastViewChange = now;
      // Huddles that just came into view talk within a second (the tick after the framing beat starts them).
      for (const h of huddleRts.values()) {
        const vis = Math.max(visOf(h), cardOpen === h.plan.id ? 2 : 0);
        if (vis >= 2) h.visibleSince ??= now;
        else h.visibleSince = null;
      }
      schedule(FRAMED_BEAT_MS + 50);
    },
    onFollow(id) {
      for (const o of rts.values()) if (o.followed && o.id !== id) o.followed = false;
      const r = id ? rts.get(id) : undefined;
      if (r) {
        // Following someone lets them go on: their hover and focus holds end, and a stopped walk resumes.
        r.followed = true;
        r.holds.delete('hover');
        r.holds.delete('focus');
        if (!r.holds.size) r.holdUntil = 0;
        step(r, clock());
      }
      schedule(0);
    },
    onMomentShown(m) {
      const now = clock();
      shownAt.set(m.id, now);
      if (m.kind === 'raised_hand') handShown.add(m.id);
      lastSummary = 0;
      schedule(0);
    },
    onPresence(id, state, badges, speaking) {
      const r = rts.get(id);
      if (!r) return;
      const now = clock();
      const wasWorking = r.presence === 'working';
      const hand = state === 'raised_hand' || badges.includes('hand');
      if (hand && r.handSince === null) r.handSince = now;
      else if (!hand) r.handSince = null;
      r.presence = state;
      r.badges = badges.slice();
      r.speaking = speaking;
      if (state === 'working' && !wasWorking) r.workSince = now;
      if (state !== 'working' && wasWorking) {
        r.workSince = null;
        r.wrapUntil = now + 60_000 + rngFor(`wrap|${id}|${Math.floor(now / 1000)}`)() * 60_000;
      }
      step(r, now);
      schedule(state === 'working' ? WORK_HYSTERESIS_MS + 20 : 0);
    },
    onRoom(id, roomId) {
      const r = rts.get(id);
      if (!r) return;
      r.room = roomId;
      r.move?.cancel();
      r.move = null;
      r.arrived = true;
      r.moveKind = 'none';
      r.target = roomId ? { kind: 'room', roomId, seat: 0 } : { kind: 'desk' };
      for (const h of huddleRts.values()) if (h.present.has(id)) leaveHuddle(h, id);
      schedule(roomId ? 0 : 1800);
    },
    onReplan() {
      officePlan = scene.getPlan();
      spots = scene.spots?.() ?? planSpots(officePlan);
      spotById = new Map(spots.map((s) => [s.id, s]));
      syncRts();
      for (const r of rts.values()) {
        // Everyone's desk may have moved: the scene walked them there (FLIP); life resolves places again.
        if (r.target.kind === 'spot' && !spotById.has(r.target.spotId)) {
          r.target = { kind: 'desk' };
          r.arrived = true;
        }
      }
      replan();
    },
    onStage(open) {
      stageOpen = open;
      setSuspended();
    },
  });

  // ── API ────────────────────────────────────────────────────────────────────────
  const api: OfficeLife = {
    get running() {
      return !destroyed && !suspended && !paused;
    },
    pause() {
      if (paused) return;
      paused = true;
      for (const h of huddleRts.values()) stopExchange(h);
      options.onPauseChange?.(true);
      lastSummary = 0;
      summarize(clock());
    },
    resume() {
      if (!paused) return;
      paused = false;
      options.onPauseChange?.(false);
      lastSummary = 0;
      schedule(0);
    },
    setAmbience(a) {
      if (a === ambience) return;
      ambience = a;
      budget.tokens = Math.min(budget.tokens, caps().burst);
      if (dayPlan) replan();
    },
    setReducedMotion(v) {
      rmSetting = v;
      schedule(0);
    },
    setPeople(people) {
      lifePeople = people.slice();
      officePlan = scene.getPlan();
      spots = scene.spots?.() ?? planSpots(officePlan);
      spotById = new Map(spots.map((s) => [s.id, s]));
      syncRts();
      replan();
    },
    setActivity(id, activity) {
      const r = rts.get(id);
      if (!r || r.activity === activity) return;
      r.activity = activity;
      schedule(0);
    },
    pin(id, where, reason) {
      const r = rts.get(id);
      if (!r) return () => {};
      const token = pinSeq++;
      r.pins.set(token, { where, reason });
      step(r, clock());
      schedule(0);
      return () => {
        if (!r.pins.delete(token)) return;
        schedule(0);
      };
    },
    visit(fromId, toId, opts) {
      const a = rts.get(fromId);
      const b = rts.get(toId);
      const now = clock();
      if (!a || !b || resolveClaim(claimsOf(a, now)) || b.target.kind !== 'desk' || b.room) return false;
      const seatId = officePlan.seatOf[toId];
      const drop = seatId ? spotById.get(`desk:${seatId}`) : undefined;
      if (!drop) return false;
      const p = scene.placeOf(fromId);
      const q = drop.slots[0]!;
      const est = (Math.abs(p.x - q.x) + Math.abs(p.y - q.y)) / a.speed;
      if (est * 1000 > (opts.maxWalkMs ?? 12_000)) return false;
      const start = now + est * 1000;
      a.local = { personId: fromId, state: 'visit', place: { kind: 'spot', spotId: drop.id, slot: 0 }, departAt: now, start, end: start + 45_000, backAt: start + 45_000 + est * 1000, hostId: toId, huddleId: `visit:${fromId}:${now}` };
      schedule(0);
      return true;
    },
    listenIn(id) {
      if (id === listening) return;
      const h = id ? huddleRts.get(id) : undefined;
      listening = h ? id : null;
      listenSince = clock();
      options.onListenIn?.(h ? huddleInfo(h) : null);
      for (const x of huddleRts.values()) showHuddle(x);
      schedule(0);
    },
    join(id) {
      const h = huddleRts.get(id);
      if (!h || h.present.size < 2) return;
      if (joined && joined !== id) api.leave();
      stopExchange(h);
      h.joined = true;
      h.lastOwnerTalk = clock();
      joined = id;
      for (const m of h.present) {
        const r = rts.get(m);
        if (r) r.pins.set(-1, { where: 'here', reason: 'owner' });
      }
      faceGroup(h);
      showHuddle(h);
      options.onJoinHuddle?.(huddleInfo(h));
      schedule(0);
    },
    leave() {
      const id = joined;
      if (!id) return;
      joined = null;
      const h = huddleRts.get(id);
      if (!h) return;
      h.joined = false;
      options.onLeaveHuddle?.(huddleInfo(h));
      const members = [...h.present];
      // The joined chat's replies leave with you (≤ 4 s), so they never cover someone you click next.
      scene.trimBubbles?.(members, 4000);
      showHuddle(h);
      later(
        () => {
          for (const m of members) {
            const r = rts.get(m);
            if (r) r.pins.delete(-1);
          }
          if (huddleRts.has(id)) faceGroup(h);
          schedule(0);
        },
        HOLD_GRACE_MS,
        true,
      );
    },
    talk(text) {
      const h = joined ? huddleRts.get(joined) : undefined;
      if (!h) return;
      h.lastOwnerTalk = clock();
      h.lines.push({ personId: '@owner', text });
      if (h.lines.length > 8) h.lines.shift();
      showHuddle(h);
      options.onTalkToHuddle?.(huddleInfo(h), text);
    },
    reply(personId, text, opts) {
      const h = [...huddleRts.values()].find((x) => x.present.has(personId) && x.joined);
      // In the joined huddle the card is the one transcript: the speaker nods as their line lands, and no truncated
      // copy floats over them. Anyone else (a sign-off after leaving) answers in a bubble.
      if (!h) {
        scene.showBubble?.(personId, text, { ttlMs: Math.min(9000, 3000 + 60 * text.length), passive: true });
        return;
      }
      if (!opts?.update) scene.cue(personId, 'nod');
      h.lastOwnerTalk = clock();
      const last = opts?.update ? [...h.lines].reverse().find((l) => l.personId === personId && !l.nonverbal) : undefined;
      if (last) last.text = text;
      else {
        h.lines.push({ personId, text });
        if (h.lines.length > 8) h.lines.shift();
      }
      showHuddle(h);
    },
    whereIs(id) {
      const r = rts.get(id);
      if (!r) return { place: { kind: 'desk' }, kind: 'desk', label: 'Desk', state: 'desk', since: 0 };
      return infoOf(r);
    },
    huddles() {
      return [...huddleRts.values()].filter((h) => h.present.size >= 2).map(huddleInfo);
    },
    moments() {
      return currentMoments(clock());
    },
    plan() {
      return dayPlan;
    },
    getState() {
      let walkers = 0;
      for (const r of rts.values()) if (!r.arrived) walkers++;
      return {
        planHash: dayPlan?.hash ?? null,
        dayKey: dayPlan?.dayKey ?? null,
        ambience,
        suspended,
        paused,
        reducedMotion: reducedMotion(),
        walkers,
        huddles: [...huddleRts.values()].filter((h) => h.present.size >= 2).length,
        bubbles: visibleTalking(),
        caps: caps(),
        budget: { tokens: Math.round(budget.tokens * 100) / 100, linesThisMinute: budget.minute.length },
        listening,
        joined,
      };
    },
    tick() {
      tick();
    },
    destroy() {
      if (destroyed) return;
      for (const h of [...huddleRts.values()]) endHuddle(h, 'suspended');
      destroyed = true;
      task?.cancel?.();
      task = null;
      if (mainTimer !== null) timers.clear(mainTimer);
      for (const h of misc.keys()) timers.clear(h);
      misc.clear();
      io?.disconnect();
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      for (const r of rts.values()) r.move?.cancel();
      scene.setLifeSummary(null);
      scene.offerMoment(null);
      detach();
    },
  };

  // ── boot: the floor is already drawn; the plan follows (at once, or in idle slices) ─────────────────────────
  hidden = doc?.visibilityState === 'hidden';
  if (hidden) suspended = true;
  ensurePlan(clock());
  if (!hidden && dayPlan && opening) placeOpening();
  schedule(0);
  return api;
}

export { SPOT_LABEL };
