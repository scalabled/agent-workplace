// Small talk in the office (OFFICE-PHASE2 §4.5.7): the huddle engine of @headcount/expressions over the bundle's
// huddle packs the living runtime already fetched (681 pre-authored, linted exchanges), wired as the office demo's
// `huddle-lines.ts`. Until the runtime is ready `lines()` answers null and huddles stay quiet company. The packs
// compile in idle time after life's first plan, or on the first line if that comes sooner (as in the demo), so the
// huddle on screen when the office opens talks at once. Grounded exchanges play only from real events (./grounding.ts).
// Recency persists per browser (localStorage['hc.expr.huddles.v1']): a pick is recorded when its first line is seen.
import {
  buildAgentIndex,
  compileHuddlesLenient,
  createHuddleRecency,
  huddleScriptOf,
  pickExchange,
  type AgentIndex,
  type CompiledHuddles,
  type HuddleEvent,
  type HuddleParticipant,
  type HuddlePick,
  type HuddleRecency,
  type HuddleRecencySnapshot,
  type HuddleSpot,
  type TeamRole,
} from '@headcount/expressions';
import type { HuddleLineRequest, HuddleScript } from '@headcount/office';
import type { ExprAgentProfile } from '@headcount/protocol/ext/expressions';
import { CHIEF_ID } from '@headcount/protocol';
import type { LivingRuntime } from '../living/types';

export const HUDDLE_RECENCY_KEY = 'hc.expr.huddles.v1';
export const RECENCY_SAVE_MS = 400;
/** A recency snapshot larger than this is not stored (OFFICE-PHASE2 §6: ≤ 32 KB). */
export const RECENCY_MAX_BYTES = 32 * 1024;
/** The warm-up looks for the living runtime this often, this many times (30 s), then stops. */
export const WARM_RETRY_MS = 500;
export const WARM_TRIES = 60;

/** What the provider knows about someone (the roster DTO and the scene's person). */
export interface HuddlePersonInfo {
  firstName: string;
  groupId: string;
  isChief: boolean;
  teamRoles: readonly string[];
  pairsWellWith: readonly string[];
  tensionWith: readonly string[];
  profile: ExprAgentProfile | null;
}

export interface HuddleLinesDeps {
  living(): LivingRuntime | null;
  person(agentId: string): HuddlePersonInfo | null;
  chiefName(): string | null;
  grounding(): { events: readonly HuddleEvent[] } | null;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  schedule?(fn: () => void, ms: number): () => void;
  /** Compile in idle time (tests pass a synchronous runner). */
  idle?(fn: () => void): () => void;
}

export interface HuddleLines {
  /** Office life's `lines` option. */
  lines(req: HuddleLineRequest): HuddleScript | null;
  /** A line of this exchange was seen (a bubble or the plan-zoom murmur): record the pick once. */
  shown(exchangeId: string, at: number): void;
  /** The pick behind a script this provider returned (listen-in renders its lines). */
  pickOf(exchangeId: string): HuddlePick | null;
  /** Start compiling in idle time (after life's first plan). */
  warm(): void;
  /** Compiled and ready. */
  ready(): boolean;
  /** Save recency now (pagehide, unmount). */
  flush(): void;
  destroy(): void;
}

const dayKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

const defaultIdle = (fn: () => void) => {
  if (typeof requestIdleCallback === 'function') {
    const h = requestIdleCallback(() => fn(), { timeout: 1500 });
    return () => cancelIdleCallback(h);
  }
  return defaultSchedule(fn, 50);
};

export function createHuddleLines(d: HuddleLinesDeps): HuddleLines {
  const schedule = d.schedule ?? defaultSchedule;
  const idle = d.idle ?? defaultIdle;
  let compiled: { catalogVersion: string; packsVersion: string; huddles: CompiledHuddles } | null = null;
  let cancelWarm: (() => void) | null = null;
  let destroyed = false;
  const indexes = new Map<string, { version: string; index: AgentIndex }>();
  const picks = new Map<string, HuddlePick>();
  /** Picks already recorded (a pick is recorded on its first line seen, once). */
  const recorded = new Set<string>();

  // ── recency ──
  let snapshot: HuddleRecencySnapshot | undefined;
  try {
    const raw = d.storage?.getItem(HUDDLE_RECENCY_KEY);
    snapshot = raw ? (JSON.parse(raw) as HuddleRecencySnapshot) : undefined;
  } catch {
    snapshot = undefined;
  }
  let recency: HuddleRecency;
  try {
    recency = createHuddleRecency(snapshot);
  } catch {
    recency = createHuddleRecency();
  }
  let cancelSave: (() => void) | null = null;
  const save = () => {
    cancelSave = null;
    try {
      const json = JSON.stringify(recency.snapshot());
      if (json.length <= RECENCY_MAX_BYTES) d.storage?.setItem(HUDDLE_RECENCY_KEY, json);
    } catch {
      /* storage blocked or full: recency lives for this page */
    }
  };

  const catalogVersionOf = (rt: LivingRuntime) => rt.catalog.version;

  /** Compile the packs against the runtime's catalog (once per catalog and huddle version). */
  const ensure = (): CompiledHuddles | null => {
    const rt = d.living();
    if (!rt?.huddles?.packs.length) return null;
    const cv = catalogVersionOf(rt);
    if (compiled && compiled.catalogVersion === cv && compiled.packsVersion === rt.huddles.version) return compiled.huddles;
    try {
      const r = compileHuddlesLenient(rt.huddles.packs as Parameters<typeof compileHuddlesLenient>[0], rt.catalog);
      compiled = { catalogVersion: cv, packsVersion: rt.huddles.version, huddles: r.huddles };
      indexes.clear();
      return r.huddles;
    } catch (err) {
      console.warn('office small talk unavailable:', err);
      return null;
    }
  };

  const indexOf = (rt: LivingRuntime, agentId: string, info: HuddlePersonInfo): AgentIndex | null => {
    const profile = info.profile ?? rt.profileOf(agentId);
    if (!profile) {
      // No roster profile (an older worker): load it through the runtime for the next exchange.
      void rt.ensureAgent(agentId).catch(() => false);
      return null;
    }
    const v = `${catalogVersionOf(rt)}|${profile.firstName}|${profile.personaId}`;
    const hit = indexes.get(agentId);
    if (hit?.version === v) return hit.index;
    try {
      const index = buildAgentIndex(rt.catalog, profile as Parameters<typeof buildAgentIndex>[1]);
      indexes.set(agentId, { version: v, index });
      return index;
    } catch {
      return null;
    }
  };

  const api: HuddleLines = {
    lines(req) {
      if (destroyed) return null;
      const rt = d.living();
      const h = ensure();
      if (!rt || !h) return null;
      const participants: HuddleParticipant[] = [];
      for (const id of req.participants) {
        const info = d.person(id);
        if (!info) continue;
        const index = indexOf(rt, id, info);
        if (!index) continue;
        participants.push({
          agentId: id,
          firstName: info.firstName,
          index,
          mood: rt.moodOf(id) ?? index.baseline,
          department: info.groupId,
          teamRoles: info.teamRoles as readonly TeamRole[],
          isChief: info.isChief,
          pairsWellWith: info.pairsWellWith,
          tensionWith: info.tensionWith,
          ...(req.hostId === id ? { atDesk: true } : {}),
        });
      }
      if (participants.length < 2) return null;
      const at = req.at;
      try {
        const pick = pickExchange(
          h,
          {
            huddleId: req.huddleId,
            spot: req.spot.kind as HuddleSpot,
            participants,
            now: { epochMs: at.getTime(), localHour: at.getHours(), weekday: at.getDay() },
            ambience: req.ambience,
            provider: rt.provider(CHIEF_ID) ?? 'browser',
            maxLines: req.maxLines,
            contexts: req.contexts,
            chiefName: d.chiefName(),
            grounding: d.grounding(),
            seed: req.seed,
            ...(req.previous?.length ? { avoid: new Set(req.previous) } : {}),
          },
          recency,
        );
        if (!pick) return null;
        picks.set(pick.exchangeId, pick);
        if (picks.size > 64) picks.delete(picks.keys().next().value!);
        return huddleScriptOf(pick);
      } catch (err) {
        console.warn('office small talk:', err);
        return null;
      }
    },
    shown(exchangeId, at) {
      const pick = picks.get(exchangeId);
      if (!pick || recorded.has(exchangeId)) return;
      recorded.add(exchangeId);
      if (recorded.size > 64) recorded.delete(recorded.values().next().value!);
      recency.record(pick, at, dayKeyOf(new Date(at)));
      cancelSave ??= schedule(save, RECENCY_SAVE_MS);
    },
    pickOf: (exchangeId) => picks.get(exchangeId) ?? null,
    warm() {
      if (destroyed || compiled || cancelWarm) return;
      let tries = 0;
      const step = () => {
        cancelWarm = null;
        if (destroyed || compiled) return;
        if (!d.living()) {
          // The runtime boots when the app is idle: look again in a moment, for a while (a runtime that never starts
          // leaves no timer behind; the first line asked for compiles then).
          if (++tries >= WARM_TRIES) return;
          cancelWarm = schedule(() => {
            cancelWarm = idle(step);
          }, WARM_RETRY_MS);
          return;
        }
        ensure();
      };
      cancelWarm = idle(step);
    },
    ready: () => !!compiled,
    flush() {
      if (cancelSave) {
        cancelSave();
        save();
      }
    },
    destroy() {
      if (destroyed) return;
      api.flush();
      destroyed = true;
      cancelWarm?.();
      cancelWarm = null;
      picks.clear();
      indexes.clear();
    },
  };
  return api;
}
