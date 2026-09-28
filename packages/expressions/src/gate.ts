// Gates and budgets (§1.4, §3.2, §9): whether a reflex may play now, on which channels, after which delay.
// The gate is agent-agnostic; per-agent firing rates live in `reflexProbability` (archetype, laugh
// readiness, mood), which hosts roll before asking the gate.
import { clamp, num } from './internal';
import type {
  AgentIndex, AmbienceProfile, BudgetClass, ChannelPlan, ChatterBudget, CompiledCatalog, FaceCue, GateInput, GateVerdict,
  IntentDef, Rng, TimingGate,
} from './types';
import { FLOOR_INTENTS, REACTION_INTENTS } from './vocab';
import type { Ambience, AmbienceLevel, IntentId, Mood } from './vocab';

const TEN_MIN = 10 * 60_000;
const HOUR = 60 * 60_000;

/**
 * Token bucket for on-surface micro-talk (§9.2): `chatter_per_min` refill, `chatter_burst` capacity, plus a
 * rolling 10-minute window of voiced ambient milliseconds. Owner-directed (exempt) reflexes never spend it.
 */
export function createChatterBudget(profiles: Readonly<Record<Ambience, AmbienceProfile>>, ambience: Ambience): ChatterBudget {
  let amb: Ambience = ambience;
  let tokens = num(profiles[amb]?.chatter_burst, 0);
  let at: number | null = null;
  const voiced: { at: number; ms: number }[] = [];

  const refill = (now: number) => {
    const p = profiles[amb];
    if (at === null) {
      at = now;
      return;
    }
    const dt = Math.max(0, now - at);
    tokens = Math.min(num(p?.chatter_burst, 0), tokens + (dt * num(p?.chatter_per_min, 0)) / 60_000);
    at = Math.max(at, now);
  };
  const voicedWindow = (now: number) => {
    while (voiced.length && now - voiced[0]!.at >= TEN_MIN) voiced.shift();
    return voiced.reduce((a, v) => a + v.ms, 0);
  };

  return {
    get ambience() {
      return amb;
    },
    setAmbience(a: Ambience): void {
      amb = a;
      tokens = Math.min(tokens, num(profiles[a]?.chatter_burst, 0));
    },
    canSpend(klass: BudgetClass, now: number, voicedMs?: number): boolean {
      if (klass === 'exempt') return true;
      refill(now);
      if (tokens < 1) return false;
      if (voicedMs && voicedMs > 0) {
        const cap = num(profiles[amb]?.ambient_voice_s_per_10min, 0) * 1000;
        if (voicedWindow(now) + voicedMs > cap) return false;
      }
      return true;
    },
    spend(klass: BudgetClass, now: number, voicedMs?: number): void {
      if (klass === 'exempt') return;
      refill(now);
      tokens = Math.max(0, tokens - 1);
      if (voicedMs && voicedMs > 0) voiced.push({ at: now, ms: voicedMs });
    },
    state(now: number) {
      refill(now);
      return { tokens, voicedMsWindow: voicedWindow(now) };
    },
  };
}

const LEVEL_RANK: Readonly<Record<AmbienceLevel, number>> = { off: 0, face: 1, bubble: 2, full: 3 };
const minLevel = (a: AmbienceLevel, b: AmbienceLevel): AmbienceLevel => (LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b);
const VOICE_BUSY_OK = new Set<IntentId>(['juggling', 'yield_floor']);
const PRESENCE_LOOKUP = new Set<IntentId>(['passing_by', 'micro_status', 'quip', 'blocked', 'unblocked', 'oops', 'celebrate', 'greeting']);

/** Budget class for this moment: chatter intents are exempt when the owner is at this agent's stage (§3.1). */
export function budgetClassFor(def: IntentDef, input: Pick<GateInput, 'ownerAtStage' | 'surface'>): BudgetClass {
  if (def.budget === 'exempt') return 'exempt';
  return input.ownerAtStage && (input.surface === 'talk' || input.surface === 'desk') ? 'exempt' : 'chatter';
}

/** The intent's face cue; under reduced motion gestures are omitted and only a static expression remains. */
export function faceCueFor(def: IntentDef, reducedMotion: boolean): FaceCue | null {
  const f = def.channels.face;
  if (reducedMotion) return f.expression ? { gesture: 'none', expression: f.expression, holdMs: f.hold_ms } : null;
  if (f.gesture === 'none' && !f.expression) return null;
  return { gesture: f.gesture, ...(f.expression ? { expression: f.expression } : {}), holdMs: f.hold_ms };
}

/** A greeting or sign-off that answers an owner turn is a reply: Ambience never suppresses it (§3.3). */
const isReply = (def: IntentDef, input: GateInput): boolean =>
  (def.id === 'greeting' || def.id === 'sign_off') && input.exchange !== 'none' && (input.surface === 'talk' || input.surface === 'desk');

const FLOOR = new Set<IntentId>(FLOOR_INTENTS);
/** A Floor line in the chatter class: one Floor gap spaces all of them and the bubbles on screen are counted (E8). */
const isFloorChatter = (def: IntentDef, input: GateInput, klass: BudgetClass): boolean => FLOOR.has(def.id) && input.surface === 'floor' && klass === 'chatter';

export function createTimingGate(catalog: CompiledCatalog, budget: ChatterBudget): TimingGate {
  const lastAgentIntent = new Map<string, number>();
  const lastIntent = new Map<IntentId, number>();
  const turnCounts = new Map<string, Map<string, number>>();
  const hourLog = new Map<string, number[]>();
  const maxReactions = Math.max(0, num(catalog.defaults.max_reactions_per_turn, 1));
  let lastFloorAt: number | null = null;
  let bubbles: number[] = []; // end times of Floor bubbles on screen

  const deny = (reason: string, faceOnly: FaceCue | null): GateVerdict => ({ allow: false, reason, faceOnly });
  const visibleBubbles = (now: number) => {
    bubbles = bubbles.filter((until) => until > now);
    return bubbles.length;
  };

  const timingViolation = (def: IntentDef, input: GateInput, profile: AmbienceProfile, klass: BudgetClass): string | null => {
    const key = `${input.agentId}|${def.id}`;
    const now = input.now;
    const last = lastAgentIntent.get(key);
    const minGap = def.timing.min_gap_ms;
    if (minGap && last !== undefined && now - last < minGap) return 'min_gap';
    let cooldown = def.timing.agent_cooldown_ms;
    let globalGap = def.timing.global_gap_ms;
    if (def.id === 'passing_by') {
      cooldown = profile.passing_by.agent_cooldown_ms || cooldown;
      globalGap = profile.passing_by.global_gap_ms || globalGap;
    }
    if (cooldown && last !== undefined && now - last < cooldown) return 'cooldown';
    const gl = lastIntent.get(def.id);
    if (globalGap && gl !== undefined && now - gl < globalGap) return 'global_gap';
    // One Floor gap for every Floor intent (E8): a pointer sweep across a pod gets one line, not one per desk.
    const floorGap = profile.passing_by.global_gap_ms;
    if (isFloorChatter(def, input, klass) && floorGap && lastFloorAt !== null && now - lastFloorAt < floorGap) return 'floor_gap';
    if (input.turnId) {
      const counts = turnCounts.get(input.turnId);
      const maxTurn = def.timing.max_per_turn;
      if (maxTurn && (counts?.get(key) ?? 0) >= maxTurn) return 'per_turn';
      if (REACTION_INTENTS.includes(def.id) && (counts?.get(`${input.agentId}|reaction`) ?? 0) >= maxReactions) return 'reaction_per_turn';
    }
    const maxHour = def.id === 'quip' ? profile.quip.max_per_hour : def.timing.max_per_hour;
    if (maxHour !== undefined) {
      const log = (hourLog.get(key) ?? []).filter((t) => now - t < HOUR);
      hourLog.set(key, log);
      if (log.length >= maxHour) return 'per_hour';
    }
    return null;
  };

  const voicePolicy = (def: IntentDef, input: GateInput, profile: AmbienceProfile): boolean => {
    if (!input.audioArmed || !input.voiceOn) return false;
    switch (def.channels.voice) {
      case 'never':
        return false;
      case 'owner_audio':
        return input.surface === 'floor' ? profile.passing_by.voice : input.exchange === 'voice';
      case 'stage':
        return input.ownerAtStage;
      case 'listening':
        if (def.family === 'sidetalk') {
          if (profile.sidetalk.voice === 'floor_audio') return input.listening || input.surface === 'floor';
          if (profile.sidetalk.voice === 'listen_in') return input.listening;
          return false;
        }
        return input.listening;
      default:
        return false;
    }
  };

  const bubblePolicy = (def: IntentDef, input: GateInput, profile: AmbienceProfile, klass: BudgetClass): boolean => {
    switch (def.channels.bubble) {
      case 'never':
        return false;
      case 'text_mode':
        return input.exchange === 'text';
      case 'floor':
        // Chatter bubbles are counted against max_visible_bubbles (E8); owner-initiated ones are always shown.
        return input.surface === 'floor' && (klass === 'exempt' || visibleBubbles(input.now) < profile.max_visible_bubbles);
      case 'always':
        return true;
      default:
        return false;
    }
  };

  return {
    check(input: GateInput, rng: Rng): GateVerdict {
      const def = catalog.intents.get(input.intent);
      if (!def) return deny('unknown_intent', null);
      if (input.stopped) return deny('stopped', null);
      if (input.approvalInProgress) return deny('approval', null); // no reflex may colour a consent (H9)
      const cue = faceCueFor(def, input.reducedMotion);
      const profile = catalog.ambience[input.ambience];
      if (!profile) return deny('unknown_ambience', null);
      const klass = budgetClassFor(def, input);

      let level = def.ambience[input.ambience];
      if (input.quietHours && klass === 'chatter') level = minLevel(level, def.ambience.quiet);
      if (isReply(def, input)) level = 'full';
      if (level === 'off') return deny('ambience', null);
      if (level === 'face') return deny('ambience', cue);

      if (input.ownerSpeaking) return deny('owner_speaking', def.id === 'backchannel' ? cue : null); // L5
      if (!input.pageVisible && klass === 'chatter') return deny('hidden', null);
      if (input.agentVoiceBusy && !VOICE_BUSY_OK.has(def.id)) return deny('voice_busy', cue);

      const why = timingViolation(def, input, profile, klass);
      if (why) return deny(why, PRESENCE_LOOKUP.has(def.id) ? cue : null);

      let voice = voicePolicy(def, input, profile);
      const bubble = bubblePolicy(def, input, profile, klass);
      // On the Floor the bubble is the line: with max_visible_bubbles already on screen, only the face looks up (E8).
      if (!bubble && def.channels.bubble === 'floor' && isFloorChatter(def, input, klass)) return deny('bubbles', cue);
      if (level === 'bubble') voice = false;
      if (input.foregroundAudio && klass === 'chatter') voice = false; // ambient voices are dropped under a conversation

      if (klass === 'chatter') {
        if (!budget.canSpend('chatter', input.now)) return deny('budget', cue);
        if (voice && !budget.canSpend('chatter', input.now, def.max_ms)) voice = false;
      }
      if (!voice && !bubble) return deny('face_only', cue);

      const [lo, hi] = def.timing.delay_ms;
      const delayMs = Math.round(lo + rng.next() * Math.max(0, hi - lo));
      const plan: ChannelPlan = {
        voice,
        bubble,
        caption: voice ? def.channels.caption : 'none',
        face: cue,
        gainDb: num(def.gain_db, 0),
        priority: def.priority,
        ttlMs: def.timing.ttl_ms,
        delayMs,
      };
      return { allow: true, plan };
    },

    commit(input: GateInput, spentMs: number, bubbleUntil?: number): void {
      const def = catalog.intents.get(input.intent);
      if (!def) return;
      const key = `${input.agentId}|${def.id}`;
      lastAgentIntent.set(key, input.now);
      lastIntent.set(def.id, input.now);
      const floorChatter = isFloorChatter(def, input, budgetClassFor(def, input));
      if (floorChatter) lastFloorAt = input.now;
      if (bubbleUntil !== undefined && bubbleUntil > input.now && input.surface === 'floor') bubbles.push(bubbleUntil);
      if (input.turnId) {
        const counts = turnCounts.get(input.turnId) ?? new Map<string, number>();
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (REACTION_INTENTS.includes(def.id)) counts.set(`${input.agentId}|reaction`, (counts.get(`${input.agentId}|reaction`) ?? 0) + 1);
        turnCounts.set(input.turnId, counts);
      }
      const log = (hourLog.get(key) ?? []).filter((t) => input.now - t < HOUR);
      log.push(input.now);
      hourLog.set(key, log);
      const klass = budgetClassFor(def, input);
      if (klass === 'chatter') budget.spend('chatter', input.now, spentMs > 0 ? spentMs : undefined);
    },

    noteBubble(until: number): void {
      bubbles.push(until);
    },

    resetTurn(turnId: string): void {
      turnCounts.delete(turnId);
    },
  };
}

/**
 * Probability that an intent fires for this agent now (§3.2, §6.5), for intents with a `timing.probability`:
 * backchannel p × Ambience factor × archetype rate × (1 + 0.3e); laugh p × laugh readiness × (1 + 0.5v) ×
 * rate; quip Ambience probability × rate. Other intents: 1 unless the agent has the intent disabled.
 * Ceilings (E10): a laugh at most `laugh_probability_max` (0.65; below it the face smiles instead), a
 * backchannel at most `backchannel_probability_max` (0.6). Laughing at nearly every joke reads as sycophantic.
 */
export function reflexProbability(catalog: CompiledCatalog, index: AgentIndex, intent: IntentId, ambience: Ambience, mood: Mood): number {
  const def = catalog.intents.get(intent);
  const rate = index.intentWeight(intent);
  if (!def || !(rate > 0)) return 0;
  const profile = catalog.ambience[ambience];
  if (intent === 'quip') return clamp(num(profile?.quip.probability, 0) * rate, 0, 1);
  const base = def.timing.probability;
  if (base === undefined) return 1;
  let p = base * rate;
  if (intent === 'backchannel') {
    p *= num(profile?.backchannel_factor, 1) * (1 + 0.3 * clamp(mood.energy, -1, 1));
    p = Math.min(p, num(catalog.defaults.backchannel_probability_max, 0.6));
  }
  if (intent === 'laugh') {
    p *= clamp(index.laugh.readiness, 0, 1) * (1 + 0.5 * clamp(mood.valence, -1, 1));
    p = Math.min(p, num(catalog.defaults.laugh_probability_max, 0.65));
  }
  return clamp(p, 0, 1);
}
