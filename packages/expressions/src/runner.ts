// The client reflex runner (§1.3, §1.4, §2.3, §8): turns owner speech, owner turns, conversation progress,
// hovers, stage changes and server frames into timed micro-utterances on the injected ports. Ports only:
// no DOM, no timers of its own (deps.schedule), no network waits on the reflex path (§2.6).
import { contentionFor } from './actor';
import { reactionFor } from './affect';
import { topicsFor } from './catalog';
import { budgetClassFor, createTimingGate, reflexProbability } from './gate';
import { seededRng } from './hash';
import { clamp, num } from './internal';
import { ownerDayKey, recordUtterance, selectLine } from './select';
import type {
  AgentIndex, AttentionView, AudioBus, ChannelPlan, ClipAvailability, ConversationEvent, ExpressionFrame, FaceCue, GateInput,
  GroundingState, IntentDef, OwnerSpeechEvent, OwnerTurnEvent, PreparedClip, ReflexPlayHandle, ReflexRunner, ReflexRunnerDeps,
  ReflexSayData, ReflexSettings, ReflexTelemetry, SelectRequest, SideTalkLineData, SlotValues, Utterance,
} from './types';
import { FLOOR_INTENTS as FLOOR_INTENT_LIST, REACTION_INTENTS } from './vocab';
import type { Ambience, IntentId, Surface } from './vocab';

interface Trigger {
  cause: string;
  turnId?: string;
  surface?: Surface;
  exchange?: 'voice' | 'text' | 'none';
  ownerAtStage?: boolean;
  listening?: boolean;
  stateOverride?: (s: GroundingState) => GroundingState;
  bubbleOnly?: boolean;
  instantOnly?: boolean;
  bus?: AudioBus;
  replyable?: boolean;
  /** No face cue when this attempt is skipped (a later fallback will cue it). */
  quietFace?: boolean;
  /** Re-checked right before the reflex starts; false drops it. */
  guard?: () => boolean;
  maxDurationMs?: number;
  /** Cap the line by the agent's p50 first-chunk latency so the reflex never delays the real answer (E6). */
  coverLatency?: boolean;
  /**
   * The owner started this (a hover dwell on the Floor): quiet hours do not mute it (§9.2), but it is not voiced
   * during them either (a bubble and the face).
   */
  ownerInitiated?: boolean;
  /** No decoded clip for a voiced line: show it as a bubble instead of skipping (a filler still covers the wait). */
  bubbleFallback?: boolean;
  /** The gate allows only the face (no audio yet, voice off): show the line as a caption instead (a hello on open). */
  captionFallback?: boolean;
}

interface Item {
  id: number;
  agentId: string;
  intent: IntentId;
  turnId?: string;
  u: Utterance;
  plan: ChannelPlan;
  def: IntentDef;
  index: AgentIndex | null;
  dayKey: string;
  bus: AudioBus;
  replyable: boolean;
  triggeredAt: number;
  expiresAt: number;
  guard?: () => boolean;
  /** A server frame's own clip, instead of the manifest lookup. */
  clipKey?: string;
  /** A server frame's render request, when it has no pre-voiced clip. */
  renderReq?: { lineId: string; fills: SlotValues } | null;
  /** Its caption is already on screen (shown at the glance while the voice renders, §9.4). */
  captioned?: boolean;
}

interface Active { item: Item; handle: ReflexPlayHandle }

interface Turn {
  turnId: string;
  agentId: string;
  at: number;
  mode: 'voice' | 'text';
  cues: OwnerTurnEvent['cues'];
  firstTokenAt: number | null;
  firstChunkAt: number | null;
  done: boolean;
  reacted: boolean;
  fillerAt: number | null;
  holdingDone: boolean;
  silent: boolean;
  onlySympathy: boolean;
  /** An acknowledgement fired for this turn (the filler then waits for `ack_covers_filler_until_ms`). */
  acked: boolean;
  /** Only humour, no question or request: the laugh or smile is the reflex, never a thinking filler. */
  humourOnly: boolean;
  /** This agent's topics the owner's text mentions (E19). */
  topics: readonly string[];
}

/** After distress: no laughs, quips or celebrations for `distress_lock_ms` (30 min, §1.4.4, H4, E11). */
const AFTER_DISTRESS_BLOCKED = new Set<IntentId>(['laugh', 'quip', 'celebrate']);
/** How a reaction the gate kept to the face reads in the caption line (a typed joke gets "(smiles)", L6). */
const FACE_ONLY_CAPTION: Readonly<Partial<Record<IntentId, string>>> = {
  laugh: '(smiles)',
  delight: '(beams)',
  surprise: '(looks surprised)',
  concern: '(looks concerned)',
  sympathy: '(softens)',
  encouragement: '(nods)',
  apology: '(winces)',
};

/** A turn that is only humour: no question, request, steer or news the owner wants answered (E4). */
export function humourOnly(c: OwnerTurnEvent['cues']): boolean {
  return c.humor >= 0.6 && !c.question && c.request < 0.6 && c.stopOrSteer < 0.6 && c.badNews < 0.3 && c.goodNews < 0.6 && !c.distress;
}
const OWNER_THREAD_KINDS = new Set(['talk', 'desk', 'sidethread']);

export function createReflexRunner(deps: ReflexRunnerDeps): ReflexRunner {
  const catalog = deps.catalog;
  const d = catalog.defaults;
  const gate = createTimingGate(catalog, deps.budget);
  const D = {
    fillerDeadline: num(d.filler_deadline_ms, 700),
    fillerLatest: num(d.filler_latest_start_ms, 2200),
    ackCovers: num(d.ack_covers_filler_until_ms, 1800),
    holding: num(d.holding_deadline_ms, 3500),
    pause: (Array.isArray(d.backchannel_pause_ms) ? d.backchannel_pause_ms : [350, 1000]) as readonly number[],
    bcMinUtterance: num(d.backchannel_min_utterance_ms, 2500),
    boundaryWait: num(d.sentence_boundary_wait_max_ms, 4000),
    juggleMin: num(d.juggle_min_remaining_ms, 2500),
    juggleMax: num(d.juggle_preempt_over_ms, 8000),
    gapAfterOwn: num(d.gap_after_own_speech_ms, 400),
    bubbleBase: num(d.bubble_ttl_base_ms, 4000),
    bubblePerChar: num(d.bubble_ttl_per_char_ms, 60),
    bubbleMax: num(d.bubble_ttl_max_ms, 9000),
    runtimeTts: num(d.runtime_tts_timeout_ms, 1200),
    tailGrace: num(d.split_tail_grace_ms, 600),
    distressLock: num(d.distress_lock_ms, 30 * 60_000),
    chunkPrior: num(d.first_chunk_p50_prior_ms, 1400),
    reflexFloor: num(d.reflex_cover_min_ms, 900),
    signOffDefer: num(d.sign_off_defer_ms, 1500),
    solicitGap: num(d.solicit_gap_ms, 10 * 60_000),
    floorVoiceRecent: num(d.floor_voice_recent_interaction_ms, 120_000),
    habituation: num(d.floor_habituation_ms, 10 * 60_000),
  };
  /** A typed turn's "one sec" bubble: never before 2.5 s, later when the brain usually answers later (≤ 6 s). */
  const TEXT_FILLER_MS = 2500;
  const TEXT_FILLER_MAX_MS = 6000;
  const TEXT_FILLER_MARGIN_MS = 400;
  const HOLDING_GAP_MS = 800;
  const BACK_WITH_YOU_MIN_MS = 6000;
  const WASTED_FILLER_MS = 200;
  const HINT_WINDOW_MS = 1200;
  const CHUNK_SAMPLES = 20;
  const CHUNK_MIN_SAMPLES = 3;

  let overrides: Partial<ReflexSettings> = {};
  let stopped = false;
  let destroyed = false;
  let distressUntil = Number.NEGATIVE_INFINITY;
  let seq = 0;
  /** Owner Floor interactions (hover dwell, focus) and how long the Floor has been visible, for Buzzing (E9). */
  let lastFloorInteraction: number | null = null;
  let floorVisibleSince: number | null = null;
  /** Last idle line that asked the owner for work, Floor-wide (E25). */
  let lastSolicitAt: number | null = null;
  /** Recent first-chunk latencies per agent (E6). */
  const chunkLatency = new Map<string, number[]>();
  /** Recent first-token latencies of typed turns per agent: the text filler waits past the usual answer. */
  const tokenLatency = new Map<string, number[]>();
  let lastStageOpenAt = Number.NEGATIVE_INFINITY;
  /** Agents greeted on a stage open in this session (voiced, or shown when audio was not armed yet). */
  const greeted = new Set<string>();
  /** When the pointer last left each desk: a runtime-rendered hover voice that arrives after it stays unheard. */
  const hoverLeftAt = new Map<string, number>();
  /** When the last voiced reflex of each owner turn ended (a server filler never follows one within 1.8 s). */
  const turnVoiceEnd = new Map<string, number>();

  const pending = new Map<number, { item: Item; cancel: () => void }>();
  const timers = new Map<number, { cancel: () => void; agentId: string; turnId?: string }>();
  const active = new Map<number, Active>();
  let activeReflex: Active | null = null;
  let activeAmbient: Active | null = null;
  let queue: Item[] = [];
  const turns = new Map<string, Turn>();
  const currentTurn = new Map<string, string>();
  const speech = new Map<string, { startAt: number; speaking: boolean; lastInputAt: number }>();
  const replying = new Map<string, { turnId: string; remainingMs: number | null; at: number }>();
  const juggles = new Map<string, { at: number; turnId: string; waitingTurn: string | null }>();
  const turnLog = new Map<string, number[]>();
  const stageOpenAt = new Map<string, number>();
  const seenProgress = new Map<string, string>();
  const shownUnblock = new Map<string, number>();
  const played = new Set<string>();
  /** `${agentId}|${intent}|${turnId}` of reflexes a server frame already voiced (R1): the runner never repeats them. */
  const serverPlayed = new Set<string>();
  const threads = new Map<string, number>();
  const lastVoiceEnd = new Map<string, number>();

  const settings = (): ReflexSettings => ({ ...deps.settings(), ...overrides });
  const now = () => deps.clock();
  const tel = (e: ReflexTelemetry) => {
    try {
      deps.telemetry?.(e);
    } catch {
      /* telemetry never breaks a reflex */
    }
  };
  /** The owner turn a telemetry event belongs to (R3), when there is one. */
  const tid = (turnId: string | undefined): { turnId?: string } => (turnId ? { turnId } : {});

  const later = (ms: number, fn: () => void, meta: { agentId: string; turnId?: string }): number => {
    const id = ++seq;
    const cancel = deps.schedule(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, Math.max(0, ms));
    timers.set(id, { cancel, ...meta });
    return id;
  };
  const cancelTimers = (pred: (m: { agentId: string; turnId?: string }) => boolean) => {
    for (const [id, t] of timers) if (pred(t)) {
      t.cancel();
      timers.delete(id);
    }
  };
  const cancelPending = (pred: (it: Item) => boolean, reason: string) => {
    for (const [id, p] of pending) if (pred(p.item)) {
      p.cancel();
      pending.delete(id);
      tel({ kind: 'dropped', agentId: p.item.agentId, intent: p.item.intent, ...tid(p.item.turnId), lineId: p.item.u.lineId, reason });
    }
    queue = queue.filter((it) => {
      if (!pred(it)) return true;
      tel({ kind: 'dropped', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId, reason });
      return false;
    });
  };
  const stopActive = (pred: (it: Item) => boolean) => {
    for (const a of active.values()) if (pred(a.item)) a.handle.stop();
  };

  const face = (agentId: string, cue: FaceCue | null) => {
    if (!cue) return;
    const s = settings();
    if (s.reducedMotion) {
      if (!cue.expression) return;
      deps.face.cue(agentId, { gesture: 'none', expression: cue.expression, holdMs: cue.holdMs, ...(cue.weight !== undefined ? { weight: cue.weight } : {}) });
      return;
    }
    deps.face.cue(agentId, cue);
  };

  const ownerSpeaking = (agentId: string): boolean => deps.audio.ownerSpeaking() || !!speech.get(agentId)?.speaking;

  const stageFor = (agentId: string) => {
    const sf = deps.surface();
    return { sf, atStage: (sf.surface === 'talk' || sf.surface === 'desk') && sf.stageAgentId === agentId };
  };

  const bubbleTtl = (text: string) => Math.min(D.bubbleMax, D.bubbleBase + D.bubblePerChar * text.length);
  const distressed = () => now() < distressUntil;

  const median = (xs: readonly number[]): number => {
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  /** Rolling median of this agent's first-chunk latency (E6); the prior until three turns have been seen. */
  const p50FirstChunk = (agentId: string): number => {
    const xs = chunkLatency.get(agentId);
    return !xs || xs.length < CHUNK_MIN_SAMPLES ? D.chunkPrior : median(xs);
  };
  /**
   * When a typed turn's "one sec" bubble shows: 2.5 s, or the agent's usual first token + 400 ms when that is later
   * (≤ 6 s). An answer that usually lands at 2.8 s then never flashes a bubble for a quarter of a second.
   */
  const textFillerMs = (agentId: string): number => {
    const xs = tokenLatency.get(agentId);
    if (!xs || xs.length < CHUNK_MIN_SAMPLES) return TEXT_FILLER_MS;
    return clamp(median(xs) + TEXT_FILLER_MARGIN_MS, TEXT_FILLER_MS, TEXT_FILLER_MAX_MS);
  };

  /** Keep track of how long the Floor has been on screen (E9 habituation). */
  const trackFloor = (floorVisible: boolean) => {
    if (!floorVisible) floorVisibleSince = null;
    else floorVisibleSince ??= now();
  };
  /**
   * The Ambience Floor chatter runs at (E9): Buzzing falls back to Lively after `floor_habituation_ms` of passive
   * Floor viewing (no hover or focus), until the owner interacts with the Floor again.
   */
  const floorAmbience = (): Ambience => {
    const s = settings();
    if (s.ambience !== 'buzzing') return s.ambience;
    const sf = deps.surface();
    trackFloor(sf.floorVisible);
    if (!sf.floorVisible) return s.ambience;
    const since = Math.max(lastFloorInteraction ?? Number.NEGATIVE_INFINITY, floorVisibleSince ?? now());
    return now() - since > D.habituation ? 'lively' : 'buzzing';
  };
  const floorInteraction = () => {
    lastFloorInteraction = now();
    if (settings().ambience === 'buzzing' && deps.budget.ambience !== 'buzzing') deps.budget.setAmbience('buzzing');
  };

  // ── firing ────────────────────────────────────────────────────────────────────
  function fire(agentId: string, intent: IntentId, trig: Trigger): boolean {
    if (destroyed || stopped) return false;
    const s = settings();
    if (s.approvalInProgress) return false;
    if (trig.turnId && serverPlayed.has(`${agentId}|${intent}|${trig.turnId}`)) {
      tel({ kind: 'skipped', agentId, intent, reason: 'server_played', ...tid(trig.turnId) });
      return false; // R1: the server's frame for this turn played first
    }
    if (distressed() && AFTER_DISTRESS_BLOCKED.has(intent)) {
      tel({ kind: 'skipped', agentId, intent, reason: 'after_distress', ...tid(trig.turnId) });
      return false;
    }
    const def = catalog.intents.get(intent);
    const index = deps.index(agentId);
    const state0 = deps.state(agentId);
    if (!def || !index || !state0) {
      tel({ kind: 'skipped', agentId, intent, reason: 'no_agent', ...tid(trig.turnId) });
      return false;
    }
    const state = trig.stateOverride ? trig.stateOverride(state0) : state0;
    const t = now();
    const { sf, atStage } = stageFor(agentId);
    const turn = trig.turnId ? turns.get(trig.turnId) : undefined;
    const surface = trig.surface ?? sf.surface;
    const ownerAtStage = trig.ownerAtStage ?? atStage;
    // Floor chatter follows the habituated Ambience (E9); owner-directed reflexes follow the setting.
    let ambience = s.ambience;
    if (budgetClassFor(def, { ownerAtStage, surface }) === 'chatter') {
      ambience = floorAmbience();
      if (deps.budget.ambience !== ambience) deps.budget.setAmbience(ambience);
    }
    const input: GateInput = {
      agentId,
      intent,
      now: t,
      ambience,
      surface,
      ...(trig.turnId ? { turnId: trig.turnId } : {}),
      ownerSpeaking: ownerSpeaking(agentId),
      agentVoiceBusy: deps.audio.voiceBusy(agentId).busy,
      foregroundAudio: deps.audio.foregroundActive(),
      ownerAtStage,
      audioArmed: deps.audio.armed(),
      voiceOn: s.voiceOn,
      listening: trig.listening ?? false,
      exchange: trig.exchange ?? turn?.mode ?? 'none',
      // An owner-initiated exchange keeps its reflexes during quiet hours (§9.2); it is only not voiced (below).
      quietHours: !trig.ownerInitiated && (s.quietHours || state.quietHours),
      reducedMotion: s.reducedMotion,
      approvalInProgress: !!s.approvalInProgress,
      stopped,
      pageVisible: sf.pageVisible,
    };
    const rng = seededRng(`${agentId}|${intent}|${trig.cause}|gate`);
    const verdict = gate.check(input, rng);
    let captionOnly = false;
    if (!verdict.allow && trig.captionFallback && verdict.reason === 'face_only' && s.captions) captionOnly = true;
    else if (!verdict.allow) {
      if (!trig.quietFace) face(agentId, verdict.faceOnly);
      if (verdict.faceOnly) faceOnlyCaption(agentId, intent, trig, ownerAtStage);
      tel({ kind: 'skipped', agentId, intent, reason: verdict.reason, ...tid(trig.turnId) });
      return false;
    }
    const plan: ChannelPlan = verdict.allow
      ? { ...verdict.plan }
      : { voice: false, bubble: false, caption: 'line', face: verdict.faceOnly, gainDb: 0, priority: def.priority, ttlMs: def.timing.ttl_ms, delayMs: def.timing.delay_ms[0] };
    if (trig.ownerInitiated && (s.quietHours || state.quietHours)) {
      plan.voice = false; // quiet hours: the owner's own hover gets its bubble and the face, not a voice
      if (!plan.bubble) plan.caption = 'none';
    }
    if (plan.bubble && input.surface === 'floor') plan.caption = 'none'; // on the Floor the bubble is the caption (§9.4)
    if (trig.bubbleOnly) {
      plan.voice = false;
      plan.caption = 'none';
      if (!plan.bubble) {
        if (!trig.quietFace) face(agentId, plan.face);
        return false;
      }
    }
    const mood = deps.mood(agentId);
    const p = reflexProbability(catalog, index, intent, ambience, mood);
    if (p < 1 && rng.next() >= p) {
      if (!trig.quietFace && (intent === 'backchannel' || intent === 'laugh')) {
        face(agentId, plan.face);
        if (intent === 'laugh') faceOnlyCaption(agentId, intent, trig, ownerAtStage);
      }
      tel({ kind: 'skipped', agentId, intent, reason: 'probability', ...tid(trig.turnId) });
      return false;
    }
    const manifest = deps.clips.manifest(agentId);
    const clips: ClipAvailability = {
      has: (k) => !!deps.clips.get(k),
      durationMs: (k) => deps.clips.get(k)?.durationMs ?? null,
      pronunciationChecked: (k) => !!manifest && Object.values(manifest.clips).some((c) => c.clipKey === k && c.pronunciationChecked),
    };
    // A voiced ack or filler is capped by the agent's p50 first-chunk latency (E6), so a fast brain gets a short
    // reflex and its answer never queues behind a long one. Context budgets (a steer) still win in selection.
    let maxDurationMs = trig.maxDurationMs;
    if (trig.coverLatency && turn && plan.voice) {
      const cover = clamp(p50FirstChunk(agentId) - (t - turn.at + plan.delayMs), D.reflexFloor, def.max_ms);
      maxDurationMs = Math.min(maxDurationMs ?? Number.POSITIVE_INFINITY, cover);
    }
    const soliciting = lastSolicitAt !== null && t - lastSolicitAt < D.solicitGap;
    const req: SelectRequest = {
      intent,
      state,
      mood,
      ambience,
      provider: s.provider,
      seed: `${agentId}|${intent}|${trig.cause}`,
      now: t,
      channel: plan.voice ? 'voice' : 'text',
      instantOnly: plan.voice && (trig.instantOnly ?? def.latency === 'reflex'),
      clips,
      clipKeyOf: (lineId, fk) => manifest?.clips[`${lineId}|${fk}`]?.clipKey,
      ...(maxDurationMs !== undefined && Number.isFinite(maxDurationMs) ? { maxDurationMs } : {}),
      laughIntensityCap: num(catalog.ambience[ambience]?.laugh_intensity_cap, 1),
      ...(soliciting ? { excludeSoliciting: true } : {}),
    };
    let res = selectLine(index, req, deps.recency);
    if (!res.ok && res.reason === 'not_instant' && (plan.bubble || trig.bubbleFallback)) {
      // Nothing decoded: degrade to the bubble alone (§1.4.11: face → bubble → nothing).
      plan.voice = false;
      plan.bubble = true;
      plan.caption = 'none';
      res = selectLine(index, { ...req, channel: 'text', instantOnly: false }, deps.recency);
    }
    if (!res.ok) {
      if (!trig.quietFace) face(agentId, plan.face);
      tel({ kind: 'skipped', agentId, intent, reason: res.reason, ...tid(trig.turnId) });
      return false;
    }
    const u = res.utterance;
    face(agentId, plan.face ?? u.face); // faces answer within 100 ms; the voice follows after the delay
    gate.commit(input, plan.voice ? u.estMs : 0, plan.bubble && input.surface === 'floor' ? t + plan.delayMs + bubbleTtl(u.caption) : undefined);
    const item: Item = {
      id: ++seq,
      agentId,
      intent,
      ...(trig.turnId ? { turnId: trig.turnId } : {}),
      u,
      plan,
      def,
      index,
      dayKey: ownerDayKey(state),
      bus: trig.bus ?? 'reflex',
      replyable: trig.replyable ?? false,
      triggeredAt: t,
      expiresAt: t + plan.delayMs + plan.ttlMs,
      ...(trig.guard ? { guard: trig.guard } : {}),
    };
    const cancel = deps.schedule(() => {
      if (!pending.has(item.id)) return;
      pending.delete(item.id);
      if (!destroyed) start(item);
    }, plan.delayMs);
    pending.set(item.id, { item, cancel });
    return true;
  }

  function start(it: Item): void {
    if (stopped || destroyed) return;
    const t = now();
    const drop = (reason: string) => tel({ kind: 'dropped', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId, reason });
    if (settings().approvalInProgress) return drop('approval');
    if (t > it.expiresAt) return drop('ttl');
    if (it.guard && !it.guard()) return drop('guard');
    if (ownerSpeaking(it.agentId)) return drop('owner_speaking');
    if (it.plan.bubble) {
      deps.captions.show({
        agentId: it.agentId, text: it.u.caption, kind: 'bubble', ttlMs: bubbleTtl(it.u.caption), replyable: it.replyable, intent: it.intent,
        ...(it.u.gloss ? { gloss: it.u.gloss } : {}),
      });
    }
    if (it.u.solicits) lastSolicitAt = t;
    if (it.index) recordUtterance(deps.recency, it.index, it.u, t, it.dayKey);
    if (it.turnId) played.add(`${it.agentId}|${it.intent}|${it.turnId}`);
    if (it.plan.voice) voice(it);
    else {
      if (!it.plan.bubble) showCaption(it); // caption only (a hello before audio is armed)
      tel({ kind: 'played', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId, reason: it.plan.bubble ? 'bubble' : 'caption', latencyMs: t - it.triggeredAt });
    }
  }

  /** A reaction the gate kept to the face, at the owner's stage: say so in the caption line ("(smiles)", L6). */
  function faceOnlyCaption(agentId: string, intent: IntentId, trig: Trigger, ownerAtStage: boolean): void {
    const text = FACE_ONLY_CAPTION[intent];
    const s = settings();
    if (!text || !trig.turnId || !ownerAtStage || !s.captions || !s.captionReactions || trig.quietFace) return;
    deps.captions.show({ agentId, text, kind: 'reaction', ttlMs: 1800, replyable: false, intent });
  }

  function showCaption(it: Item, text = it.u.caption): void {
    const s = settings();
    if (it.plan.caption === 'none' || !s.captions) return;
    if (it.captioned && text === it.u.caption) return;
    it.captioned = true;
    const kind = it.plan.caption === 'reaction' ? 'reaction' : 'line';
    if (kind === 'reaction' && !s.captionReactions) return;
    deps.captions.show({ agentId: it.agentId, text, kind, ttlMs: Math.max(1500, it.u.estMs + 1000), replyable: false, intent: it.intent, ...(it.u.gloss ? { gloss: it.u.gloss } : {}) });
  }

  function voice(it: Item): void {
    if (it.bus === 'ambient') {
      if (activeAmbient || deps.audio.foregroundActive()) {
        tel({ kind: 'dropped', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId, reason: 'ambient_busy' });
        return; // ambient voices are dropped, never queued
      }
    } else if (activeReflex) {
      queue.push(it); // one reflex voice at a time; it waits for its TTL at most
      queue.sort((a, b) => a.plan.priority - b.plan.priority || a.triggeredAt - b.triggeredAt);
      return;
    }
    const s = settings();
    if (s.provider === 'browser') {
      const text = it.u.speak.browser;
      if (!text) return;
      const h = deps.audio.speakText(it.agentId, text, { gainDb: it.plan.gainDb, bus: it.bus, priority: it.plan.priority });
      if (!h) {
        showCaption(it);
        return;
      }
      track(it, h);
      void h.started.then((ok) => {
        if (ok) {
          showCaption(it);
          tel({ kind: 'played', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId, latencyMs: now() - it.triggeredAt });
        }
      });
      return;
    }
    const manifest = deps.clips.manifest(it.agentId);
    const target = it.u.split?.prefix ?? it.u;
    const key = it.clipKey ?? manifest?.clips[`${target.lineId}|${target.fillKey}`]?.clipKey;
    const clip = key ? deps.clips.get(key) : null;
    if (clip) {
      playClip(it, clip, !!it.u.split);
      return;
    }
    if (it.def.latency === 'reflex') {
      // Reflex-grade intents never wait on the network (§1.4.11): the face cue already played.
      tel({ kind: 'skipped', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId, reason: 'not_decoded' });
      return;
    }
    // The caption goes up with the glance; the voice follows if it renders in time (§9.4: captions never wait).
    showCaption(it);
    const deadline = now() + Math.min(it.plan.ttlMs, D.runtimeTts);
    const pending$: Promise<PreparedClip | null> = key
      ? deps.clips.load(key)
      : it.renderReq === null
        ? Promise.resolve(null)
        : deps.render({ agentId: it.agentId, lineId: it.renderReq?.lineId ?? target.lineId, fills: it.renderReq?.fills ?? target.fills, provider: s.provider });
    const split = !!it.u.split && target !== it.u;
    pending$.then(
      (c) => {
        if (stopped || destroyed) return;
        if (FLOOR_INTENTS.has(it.intent) && (hoverLeftAt.get(it.agentId) ?? Number.NEGATIVE_INFINITY) >= it.triggeredAt) {
          // The owner moved on before the voice rendered: the bubble stays, the voice is not played late.
          tel({ kind: 'dropped', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId, reason: 'hover_left' });
          return;
        }
        if (!c || now() > deadline || ownerSpeaking(it.agentId)) {
          showCaption(it);
          tel({ kind: 'dropped', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId, reason: c ? 'late_voice' : 'no_voice' });
          return;
        }
        if (it.bus === 'reflex' && activeReflex) return showCaption(it);
        playClip(it, c, split);
      },
      () => showCaption(it),
    );
  }

  function track(it: Item, h: ReflexPlayHandle): Active {
    const a: Active = { item: it, handle: h };
    active.set(it.id, a);
    if (it.bus === 'ambient') activeAmbient = a;
    else activeReflex = a;
    void h.done.then(
      () => finish(a),
      () => finish(a),
    );
    return a;
  }

  function finish(a: Active): void {
    active.delete(a.item.id);
    if (activeReflex === a) activeReflex = null;
    if (activeAmbient === a) activeAmbient = null;
    lastVoiceEnd.set(a.item.agentId, now());
    if (a.item.turnId) {
      turnVoiceEnd.set(a.item.turnId, now());
      if (turnVoiceEnd.size > REMEMBER_KEYS) turnVoiceEnd.delete(turnVoiceEnd.keys().next().value!);
    }
    pump();
  }

  function pump(): void {
    if (activeReflex || stopped || destroyed) return;
    const t = now();
    while (queue.length) {
      const next = queue.shift()!;
      if (t > next.expiresAt || ownerSpeaking(next.agentId)) {
        tel({ kind: 'dropped', agentId: next.agentId, intent: next.intent, ...tid(next.turnId), lineId: next.u.lineId, reason: 'ttl' });
        continue;
      }
      voice(next);
      return;
    }
  }

  function playClip(it: Item, clip: PreparedClip, withTail: boolean): void {
    const s = settings();
    let tailClip: PreparedClip | null = null;
    let tailSettled = false;
    const tail$ = withTail
      ? deps.render({ agentId: it.agentId, lineId: `${it.u.lineId}~tail`, fills: it.u.fills, provider: s.provider }).then(
          (c) => {
            tailClip = c;
            tailSettled = true;
            return c;
          },
          () => {
            tailSettled = true;
            return null;
          },
        )
      : null;
    const h = deps.audio.play({
      agentId: it.agentId,
      intent: it.intent,
      clip,
      bus: it.bus,
      gainDb: it.plan.gainDb,
      priority: it.plan.priority,
      ttlMs: it.plan.ttlMs,
      caption: it.u.caption,
      onStart: () => {
        showCaption(it);
        tel({ kind: 'played', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId, latencyMs: now() - it.triggeredAt });
      },
    });
    track(it, h);
    if (!tail$) return;
    void h.done.then((outcome) => {
      if (outcome !== 'completed' || stopped || destroyed) return;
      const graceEnd = now() + D.tailGrace;
      const playTail = (c: PreparedClip) => {
        if (stopped || destroyed || ownerSpeaking(it.agentId) || now() > graceEnd) {
          tel({ kind: 'late_tail', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId });
          return;
        }
        const th = deps.audio.play({ agentId: it.agentId, intent: it.intent, clip: c, bus: it.bus, gainDb: it.plan.gainDb, priority: it.plan.priority, ttlMs: D.tailGrace, caption: it.u.caption });
        track({ ...it, id: ++seq }, th);
      };
      if (tailSettled) {
        if (tailClip) playTail(tailClip);
        else tel({ kind: 'late_tail', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId, reason: 'no_tail' });
        return;
      }
      let done = false;
      const timer = later(D.tailGrace, () => {
        if (!done) {
          done = true;
          tel({ kind: 'late_tail', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId });
        }
      }, { agentId: it.agentId });
      void tail$.then((c) => {
        if (done) return;
        done = true;
        timers.get(timer)?.cancel();
        timers.delete(timer);
        if (c) playTail(c);
      });
    });
  }

  // ── conversation turns ───────────────────────────────────────────────────────
  /**
   * A trigger for a reflex that answers an owner turn. The turn's sniffed cues and topics ride into the state, so
   * lines can require what the owner actually said (E4 `owner_question`, `owner_tone:*`; E19 `topic:*`).
   */
  const turnTrigger = (turn: Turn, extra?: Partial<Trigger>): Trigger => {
    const inner = extra?.stateOverride;
    return {
      cause: turn.turnId,
      turnId: turn.turnId,
      exchange: turn.mode,
      instantOnly: true,
      ...extra,
      stateOverride: (s0) => {
        const s = inner ? inner(s0) : s0;
        // Within the distress lock (§1.4.4) upbeat lines are out: they forbid `after_distress`.
        const history = distressed() && !s.history.distressThisSession ? { ...s.history, distressThisSession: true } : s.history;
        return { ...s, history, exchange: { ...s.exchange, cues: turn.cues, ...(turn.topics.length ? { topics: turn.topics } : {}) } };
      },
    };
  };

  function fillerCheck(turnId: string): void {
    const turn = turns.get(turnId);
    if (!turn || turn.done || turn.silent || turn.onlySympathy || turn.humourOnly || turn.firstTokenAt !== null || turn.fillerAt !== null) return;
    if (settings().frontAcks) return;
    const elapsed = now() - turn.at;
    if (turn.mode === 'voice' && elapsed > D.fillerLatest) return; // a late filler sounds robotic
    if (fire(turn.agentId, 'thinking_filler', turnTrigger(turn, { coverLatency: true, bubbleFallback: turn.mode === 'text', guard: () => turn.firstTokenAt === null && !turn.done }))) turn.fillerAt = now();
  }

  function holdingCheck(turnId: string): void {
    const turn = turns.get(turnId);
    if (!turn || turn.done || turn.silent || turn.onlySympathy || turn.holdingDone || turn.firstChunkAt !== null || turn.mode !== 'voice') return;
    const end = lastVoiceEnd.get(turn.agentId);
    const busy = deps.audio.voiceBusy(turn.agentId).busy;
    if (busy || (end !== undefined && now() - end < HOLDING_GAP_MS)) {
      later(HOLDING_GAP_MS, () => holdingCheck(turnId), { agentId: turn.agentId, turnId });
      return;
    }
    turn.holdingDone = true;
    // Nothing decoded to say it: a "still thinking" bubble is better than more dead air (§1.4.11).
    fire(turn.agentId, 'holding_filler', turnTrigger(turn, { bubbleFallback: true, guard: () => turn.firstChunkAt === null && !turn.done }));
  }

  function whenVoiceFree(agentId: string, maxWaitMs: number, fn: () => void, turnId?: string): void {
    const startAt = now();
    const tick = () => {
      if (!deps.audio.voiceBusy(agentId).busy) return fn();
      if (now() - startAt >= maxWaitMs) return;
      later(100, tick, { agentId, ...(turnId ? { turnId } : {}) });
    };
    tick();
  }

  function ownerTurn(e: OwnerTurnEvent): void {
    if (destroyed) return;
    const { agentId, turnId, cues } = e;
    const t = now();
    const sp = speech.get(agentId);
    speech.set(agentId, { startAt: sp?.startAt ?? t, speaking: false, lastInputAt: t });
    const log = (turnLog.get(agentId) ?? []).filter((x) => t - x < 10 * 60_000);
    log.push(t);
    turnLog.set(agentId, log);

    const prevId = currentTurn.get(agentId);
    if (prevId && prevId !== turnId) {
      cancelPending((it) => it.turnId === prevId && it.intent !== 'juggling', 'superseded');
      cancelTimers((m) => m.turnId === prevId);
    }
    const index = deps.index(agentId);
    const turn: Turn = {
      turnId, agentId, at: e.at, mode: e.mode, cues, firstTokenAt: null, firstChunkAt: null, done: false, reacted: false,
      fillerAt: null, holdingDone: false, silent: cues.sincereAi, onlySympathy: cues.distress, acked: false, humourOnly: humourOnly(cues),
      topics: index ? topicsFor(index, e.text) : [],
    };
    turns.set(turnId, turn);
    currentTurn.set(agentId, turnId);
    if (turns.size > REMEMBER_KEYS) turns.delete(turns.keys().next().value!);
    if (stopped || turn.silent) return; // a sincere "are you an AI?" gets no reflex at all (H6)
    if (cues.distress) distressUntil = t + D.distressLock;

    if (cues.phatic && !cues.distress) {
      // The host answers phatic turns itself (reflex.say); the face reacts at once.
      face(agentId, { gesture: cues.farewell > 0 && cues.gratitude === 0 ? 'nod' : 'smile', expression: 'delighted', holdMs: 1200 });
      return;
    }
    // A reaction's own face (a smile, a tilt) is the first thing the owner sees; the thinking look-up would cover it.
    const reaction = reactionFor(cues, null, d);
    const reacting = !!reaction && reaction !== 'acknowledge' && (!turn.onlySympathy || reaction === 'sympathy');
    const lookUp = () => face(agentId, { gesture: 'look_up', expression: 'thinking', holdMs: 1200 });
    if (!reacting) lookUp();

    // Owner message while this agent is still speaking a reply (§2.3).
    const rep = replying.get(agentId);
    const remaining = rep && rep.remainingMs !== null ? rep.remainingMs - (t - rep.at) : rep ? null : undefined;
    if (rep && rep.turnId !== turnId && deps.audio.voiceBusy(agentId).busy) {
      if (reacting) lookUp();
      const stop = cues.stopOrSteer >= 0.6;
      if (stop || (remaining !== undefined && remaining !== null && remaining > D.juggleMax)) {
        // The reply ends at its sentence boundary (§2.3): then a short "got it" before the new answer. A stop cue
        // gets the interrupted lines ("Okay, switching."); a long reply cut for a follow-up gets a plain one.
        whenVoiceFree(agentId, D.boundaryWait, () => {
          if (fire(agentId, 'acknowledge', turnTrigger(turn, {
            stateOverride: (s) => ({ ...s, exchange: { ...s.exchange, mode: turn.mode, interrupted: stop } }),
          }))) turn.acked = true;
        }, turnId);
        turn.reacted = true;
        scheduleCovers(turn, D.ackCovers);
        return;
      }
      if (remaining !== undefined && remaining !== null && remaining >= D.juggleMin && remaining <= D.juggleMax) {
        if (fire(agentId, 'juggling', turnTrigger(turn, {
          instantOnly: false,
          stateOverride: (s) => ({ ...s, attention: { etaMs: remaining } }),
        }))) juggles.set(agentId, { at: now(), turnId: rep.turnId, waitingTurn: turnId });
        turn.reacted = true;
        return;
      }
      // < 2.5 s left: finish, then answer. > 8 s: the host cuts at the sentence boundary. Either way no reflex over it.
      return;
    }

    // Contention with another thread that holds this agent's voice or floor (a meeting, an ask).
    const view = deps.attention(agentId);
    if (view) {
      const foreign: AttentionView = {
        ...view,
        focus: view.focus && !OWNER_THREAD_KINDS.has(view.focus.kind) ? view.focus : null,
        background: view.background.filter((x) => !OWNER_THREAD_KINDS.has(x.kind)),
      };
      const c = contentionFor(foreign, { mailbox: 'owner', threadId: `owner:${agentId}` }, t);
      if (c.kind !== 'none' && (c.etaMs === null || c.etaMs >= D.juggleMin)) {
        if (reacting) lookUp();
        if (fire(agentId, 'juggling', turnTrigger(turn, {
          instantOnly: false,
          stateOverride: (s) => ({ ...s, attention: { otherThread: c.otherThread, etaMs: c.etaMs !== null && c.etaMs <= D.juggleMax ? c.etaMs : null } }),
        }))) juggles.set(agentId, { at: now(), turnId: `thread:${c.otherThread}`, waitingTurn: turnId });
        turn.reacted = true;
        return;
      }
    }

    // Latency masking (§1.3).
    let covered = false;
    if (reacting) {
      covered = fire(agentId, reaction, turnTrigger(turn));
      turn.reacted = covered;
    }
    if (!covered && !turn.onlySympathy && !settings().frontAcks && (cues.request >= 0.6 || cues.stopOrSteer >= 0.6)) {
      covered = fire(agentId, 'acknowledge', turnTrigger(turn, {
        coverLatency: true,
        stateOverride: (s) => ({ ...s, exchange: { ...s.exchange, mode: turn.mode } }),
      }));
      turn.acked = covered;
    }
    scheduleCovers(turn, covered ? D.ackCovers : D.fillerDeadline);
  }

  function scheduleCovers(turn: Turn, fillerAt: number): void {
    if (turn.onlySympathy) return;
    const elapsed = now() - turn.at;
    if (turn.mode === 'voice') {
      later(fillerAt - elapsed, () => fillerCheck(turn.turnId), { agentId: turn.agentId, turnId: turn.turnId });
      later(D.holding - elapsed, () => holdingCheck(turn.turnId), { agentId: turn.agentId, turnId: turn.turnId });
    } else {
      later(textFillerMs(turn.agentId) - elapsed, () => fillerCheck(turn.turnId), { agentId: turn.agentId, turnId: turn.turnId });
    }
  }

  function backWithYou(agentId: string): void {
    const j = juggles.get(agentId);
    if (!j) return;
    const wait = BACK_WITH_YOU_MIN_MS - (now() - j.at);
    juggles.delete(agentId);
    if (wait > 0) return; // a quick finish needs no "I'm back"
    const waiting = j.waitingTurn ? turns.get(j.waitingTurn) : undefined;
    fire(agentId, 'back_with_you', {
      cause: `back:${j.turnId}`,
      ...(waiting ? { turnId: waiting.turnId, exchange: waiting.mode } : {}),
      instantOnly: true,
    });
  }

  function conversation(e: ConversationEvent): void {
    if (destroyed) return;
    if (e.kind === 'speaking') {
      replying.set(e.agentId, { turnId: e.turnId, remainingMs: e.remainingMs, at: now() });
      return;
    }
    const turn = turns.get(e.turnId);
    if (!turn) return;
    switch (e.kind) {
      case 'first_token': {
        turn.firstTokenAt = e.at;
        const tl = e.at - turn.at;
        if (turn.mode === 'text' && tl >= 0 && Number.isFinite(tl)) tokenLatency.set(turn.agentId, [...(tokenLatency.get(turn.agentId) ?? []), tl].slice(-CHUNK_SAMPLES));
        cancelPending((it) => it.turnId === turn.turnId && (it.intent === 'thinking_filler' || it.intent === 'holding_filler'), 'first_token');
        // A filler shown as a bubble (a text exchange) yields to the answer the moment it starts (§1.3).
        if (played.has(`${turn.agentId}|thinking_filler|${turn.turnId}`) || played.has(`${turn.agentId}|holding_filler|${turn.turnId}`)) deps.captions.clear(turn.agentId, 'bubble');
        if (e.hint && e.hint !== 'none' && !turn.reacted && !turn.silent && e.at - turn.at <= HINT_WINDOW_MS) {
          const r = reactionFor(turn.cues, e.hint, d);
          if (r && r !== 'acknowledge' && (!turn.onlySympathy || r === 'sympathy')) turn.reacted = fire(turn.agentId, r, turnTrigger(turn, { cause: `${turn.turnId}:hint` }));
        }
        return;
      }
      case 'first_chunk': {
        turn.firstChunkAt = e.at;
        const lat = e.at - turn.at;
        if (lat >= 0 && Number.isFinite(lat)) {
          const xs = [...(chunkLatency.get(turn.agentId) ?? []), lat].slice(-CHUNK_SAMPLES);
          chunkLatency.set(turn.agentId, xs);
        }
        if (turn.fillerAt !== null && e.at - turn.fillerAt < WASTED_FILLER_MS) tel({ kind: 'wasted_filler', agentId: turn.agentId, intent: 'thinking_filler', turnId: turn.turnId });
        // Brain audio queues behind a reflex already playing; anything not yet started is cancelled (§1.3).
        cancelPending((it) => it.turnId === turn.turnId, 'brain_audio');
        cancelTimers((m) => m.turnId === turn.turnId);
        return;
      }
      case 'done':
      case 'cancelled': {
        turn.done = true;
        cancelPending((it) => it.turnId === turn.turnId && it.intent !== 'juggling', e.kind);
        cancelTimers((m) => m.turnId === turn.turnId);
        gate.resetTurn(turn.turnId);
        for (const [agentId, r] of replying) {
          if (r.turnId !== turn.turnId) continue;
          replying.delete(agentId);
          lastVoiceEnd.set(agentId, now());
        }
        const j = juggles.get(turn.agentId);
        if (j && j.turnId === turn.turnId) backWithYou(turn.agentId);
        return;
      }
      case 'backgrounded': {
        cancelPending((it) => it.turnId === turn.turnId && it.intent !== 'deferral', 'backgrounded');
        cancelTimers((m) => m.turnId === turn.turnId);
        fire(turn.agentId, 'deferral', turnTrigger(turn, {
          instantOnly: false,
          stateOverride: (s) => ({ ...s, attention: { ...(s.attention ?? {}), etaMs: e.etaMs } }),
        }));
        return;
      }
    }
  }

  // ── owner speech (VAD) ───────────────────────────────────────────────────────
  function ownerSpeech(e: OwnerSpeechEvent): void {
    if (destroyed) return;
    const { agentId } = e;
    const sp = speech.get(agentId);
    switch (e.kind) {
      case 'start':
      case 'resume': {
        speech.set(agentId, { startAt: e.kind === 'start' || !sp ? e.at : sp.startAt, speaking: true, lastInputAt: now() });
        // Never over the owner (L5): cancel what is pending and fade what plays for this agent.
        const current = currentTurn.get(agentId);
        cancelPending((it) => it.agentId === agentId && (it.bus === 'reflex' || it.turnId === current), 'owner_resumed');
        stopActive((it) => it.agentId === agentId && it.bus === 'reflex');
        return;
      }
      case 'pause': {
        speech.set(agentId, { startAt: sp?.startAt ?? e.at, speaking: false, lastInputAt: now() });
        const pauseMs = num(e.pauseMs, 0);
        const [lo, hi] = [num(D.pause[0], 350), num(D.pause[1], 1000)];
        if (pauseMs < lo || pauseMs > hi || e.utteranceMs < D.bcMinUtterance) return;
        const speechTurn = `speech:${agentId}:${sp?.startAt ?? e.at}`;
        fire(agentId, 'backchannel', {
          cause: `${speechTurn}:${e.at}`,
          turnId: speechTurn,
          exchange: 'voice',
          instantOnly: true,
          guard: () => !speech.get(agentId)?.speaking,
        });
        return;
      }
      case 'end': {
        speech.set(agentId, { startAt: sp?.startAt ?? e.at, speaking: false, lastInputAt: now() });
        return;
      }
    }
  }

  // ── Floor and stage ──────────────────────────────────────────────────────────
  function hover(agentId: string, phase: 'enter' | 'dwell' | 'leave', via: 'pointer' | 'keyboard' | 'touch'): void {
    if (destroyed || stopped) return;
    if (phase === 'leave') {
      hoverLeftAt.set(agentId, now());
      cancelPending((it) => it.agentId === agentId && FLOOR_INTENTS.has(it.intent), 'hover_leave');
      return;
    }
    floorInteraction();
    if (phase === 'enter') {
      // Warm the Floor clips while the pointer settles, so the dwell line is decoded in time (§7.3).
      const m = deps.clips.manifest(agentId);
      const keys = m ? Object.entries(m.clips).filter(([k]) => FLOOR_INTENTS.has(k.split('|')[0]!.split('.')[1] as IntentId)).map(([, v]) => v.clipKey) : [];
      if (keys.length) deps.clips.prefetch(keys, 'p1');
      return;
    }
    const state = deps.state(agentId);
    if (!state) return;
    const t = now();
    const cause = `hover:${agentId}:${Math.floor(t / 60_000)}`;
    const base: Trigger = { cause, surface: 'floor', exchange: 'none', ownerAtStage: false, bubbleOnly: via === 'keyboard', replyable: true, instantOnly: false, ownerInitiated: true };
    const order: IntentId[] = [];
    const working = state.self.presence === 'working' || state.self.presence === 'thinking';
    if (state.self.blocked) order.push('blocked');
    else {
      const unblockedAt = state.history.lastUnblockedAt;
      if (unblockedAt !== null && t - unblockedAt <= 10 * 60_000 && shownUnblock.get(agentId) !== unblockedAt) order.push('unblocked');
      const w = state.work;
      const progressKey = working && typeof w?.done === 'number' ? `${w.done}/${w.total ?? '?'}/${w.stepLabel ?? ''}` : null;
      if (progressKey && seenProgress.get(agentId) !== progressKey) order.push('micro_status');
      if (working && state.self.activity && deps.mood(agentId).valence >= 0.2 && !distressed()) order.push('quip');
      order.push('passing_by');
    }
    for (let i = 0; i < order.length; i++) {
      const intent = order[i]!;
      const last = i === order.length - 1;
      if (fire(agentId, intent, { ...base, quietFace: !last })) {
        if (intent === 'unblocked' && state.history.lastUnblockedAt !== null) shownUnblock.set(agentId, state.history.lastUnblockedAt);
        break;
      }
    }
    const w = state.work;
    if (working && typeof w?.done === 'number') seenProgress.set(agentId, `${w.done}/${w.total ?? '?'}/${w.stepLabel ?? ''}`);
  }

  /** Two or more owner turns with this agent in the last 10 minutes: a real conversation worth a goodbye. */
  const hadConversation = (agentId: string, t: number) => (turnLog.get(agentId) ?? []).filter((x) => t - x < 10 * 60_000).length >= 2;

  // No sign-off after a quiet spell at an open stage: an owner reading or thinking has not left, and the Chief is
  // always reachable (D2). A goodbye follows only a real exit (leaving the app) or the owner's own farewell.

  function stage(agentId: string, phase: 'open' | 'close', reason: 'navigate' | 'leave' = 'navigate'): void {
    if (destroyed || stopped) return;
    const t = now();
    const { sf } = stageFor(agentId);
    const surface: Surface = sf.surface === 'talk' || sf.surface === 'desk' ? sf.surface : 'desk';
    if (phase === 'open') {
      lastStageOpenAt = t;
      stageOpenAt.set(agentId, t);
      cancelPending((it) => it.intent === 'sign_off', 'stage_opened');
      const st = deps.state(agentId);
      if (!st || !(st.history.newDay || st.history.returning || st.history.firstMeeting)) return;
      // One hello per session: a later Floor → Talk hop stays quiet, even if the first one was only shown.
      if (greeted.has(agentId)) return;
      const openedAt = t;
      if (fire(agentId, 'greeting', {
        cause: `stage:${agentId}:${Math.floor(t / 60_000)}`,
        surface,
        ownerAtStage: true,
        exchange: 'none',
        instantOnly: false,
        // Audio is not armed yet on a fresh page load: the hello shows as a caption instead of nothing.
        captionFallback: true,
        guard: () => (speech.get(agentId)?.lastInputAt ?? 0) < openedAt && stageOpenAt.get(agentId) === openedAt,
      })) greeted.add(agentId);
      return;
    }
    stageOpenAt.delete(agentId);
    cancelPending((it) => it.agentId === agentId && it.intent === 'greeting', 'stage_closed');
    // Talk ↔ Floor and other in-app moves never get a goodbye (E20); leaving the app does, deferred so a quick
    // return (another stage opened, or the owner speaking again) cancels it.
    if (reason !== 'leave' || !hadConversation(agentId, t)) return;
    const closedAt = t;
    later(D.signOffDefer, () => {
      if (lastStageOpenAt > closedAt || (speech.get(agentId)?.lastInputAt ?? 0) > closedAt) return;
      fire(agentId, 'sign_off', { cause: `stageclose:${agentId}:${Math.floor(closedAt / 60_000)}`, surface, ownerAtStage: true, exchange: 'none', instantOnly: false });
    }, { agentId });
  }

  function bargeIn(agentId: string): void {
    if (destroyed) return;
    cancelPending((it) => it.agentId === agentId, 'barge_in');
    stopActive((it) => it.agentId === agentId);
    face(agentId, { gesture: 'still', holdMs: 800 }); // yield_floor is face-only on a voice barge-in
  }

  // ── server frames ────────────────────────────────────────────────────────────
  function playServerSay(data: ReflexSayData): void {
    if (stopped || settings().approvalInProgress) return;
    if (distressed() && AFTER_DISTRESS_BLOCKED.has(data.intent)) return;
    const key = data.turnId ? `${data.agentId}|${data.intent}|${data.turnId}` : null;
    if (key && played.has(key)) return; // the runner already played this one locally
    const index = deps.index(data.agentId);
    const def = catalog.intents.get(data.intent);
    if (!def) return;
    const t = now();
    // R2: the server covered this turn: the runner's own filler, hold or reaction for it would be a second one.
    const covered = data.turnId ? turns.get(data.turnId) : undefined;
    if (covered && covered.agentId === data.agentId && data.audience === 'owner') {
      const skip = (reason: string) => tel({ kind: 'skipped', agentId: data.agentId, intent: data.intent, lineId: data.lineId, reason, ...tid(data.turnId) });
      // A sincere "are you an AI?" gets no reflex at all (H6); distress gets sympathy only (§1.4.4).
      if (covered.silent) return skip('silent_turn');
      if (covered.onlySympathy && data.intent !== 'sympathy') return skip('only_sympathy');
      if (data.intent === 'thinking_filler' || data.intent === 'holding_filler') {
        // The server's safety net never repeats what already covered the wait: an acknowledgement or a reaction, a
        // reflex of this turn still sounding or queued, or one that ended less than `ack_covers_filler_until_ms` ago.
        const end = turnVoiceEnd.get(covered.turnId);
        const busy = [...active.values()].some((a) => a.item.turnId === covered.turnId) || queue.some((it) => it.turnId === covered.turnId);
        if (covered.humourOnly) return skip('humour_only');
        if (data.intent === 'thinking_filler' && (covered.acked || covered.reacted || covered.fillerAt !== null)) return skip('covered');
        if (busy || (end !== undefined && t - end < D.ackCovers)) return skip('covered');
      }
    }
    if (key) {
      played.add(key);
      remember(serverPlayed, key);
    }
    if (covered && covered.agentId === data.agentId) {
      if (data.intent === 'thinking_filler') covered.fillerAt ??= t;
      else if (data.intent === 'holding_filler') covered.holdingDone = true;
      else if (data.intent === 'acknowledge') covered.acked = covered.reacted = true;
      else if (REACTIONS.has(data.intent)) covered.reacted = true;
      cancelPending((it) => it.turnId === covered.turnId && it.agentId === data.agentId && it.intent === data.intent, 'server_played');
    }
    face(data.agentId, data.face);
    const plan: ChannelPlan = { voice: data.channels.voice, bubble: data.channels.bubble, caption: data.channels.caption, face: data.face, gainDb: data.gainDb, priority: data.priority, ttlMs: data.ttlMs, delayMs: 0 };
    const u: Utterance = {
      agentId: data.agentId, intent: data.intent, lineId: data.lineId, source: 'archetype', caption: data.caption, fills: data.render?.fills ?? {},
      fillKey: data.fillKey, nonverbal: /^\(.+\)$/.test(data.caption), speak: { xai: '', openai: null, browser: /^\(.+\)$/.test(data.caption) ? null : data.caption },
      estMs: data.clip?.durationMs ?? 1500, face: data.face, seed: key ?? `${data.agentId}|${data.lineId}`,
      ...(data.gloss ? { gloss: data.gloss } : {}),
    };
    const it: Item = {
      id: ++seq, agentId: data.agentId, intent: data.intent, ...(data.turnId ? { turnId: data.turnId } : {}), u, plan, def,
      index, dayKey: '', bus: data.audience === 'owner' ? 'reflex' : 'ambient',
      replyable: data.audience === 'floor', triggeredAt: t, expiresAt: t + data.ttlMs,
    };
    const st = deps.state(data.agentId);
    if (index && st) recordUtterance(deps.recency, index, u, t, ownerDayKey(st));
    if (data.clip) it.clipKey = data.clip.key;
    else it.renderReq = data.render ?? null;
    if (plan.bubble) deps.captions.show({ agentId: it.agentId, text: u.caption, kind: 'bubble', ttlMs: bubbleTtl(u.caption), replyable: it.replyable, intent: it.intent, ...(u.gloss ? { gloss: u.gloss } : {}) });
    const s = settings();
    if (!(plan.voice && deps.audio.armed() && s.voiceOn)) return;
    const go = () => {
      if (stopped || destroyed || now() > it.expiresAt) return;
      if (ownerSpeaking(it.agentId)) return tel({ kind: 'dropped', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId, reason: 'owner_speaking' });
      voice(it); // same single-voice queue and clip rules as local reflexes
    };
    // Event reflexes wait for the agent's own line to end (+400 ms, §1.4.5); replies to the owner do not.
    if (data.audience === 'owner' && data.turnId) return go();
    whenVoiceFree(it.agentId, data.ttlMs, () => {
      const end = lastVoiceEnd.get(it.agentId);
      const gap = end === undefined ? 0 : D.gapAfterOwn - (now() - end);
      if (gap > 0) later(gap, go, { agentId: it.agentId });
      else go();
    });
  }

  function playSideTalk(data: SideTalkLineData): void {
    if (stopped) return;
    const s = settings();
    if (!catalog.ambience[s.ambience]?.sidetalk.enabled) return;
    const t = now();
    const expires = Date.parse(data.expiresAt);
    if (Number.isFinite(expires) && t > expires) return;
    let base = threads.get(data.threadId);
    if (base === undefined) {
      base = t - data.atMs;
      threads.set(data.threadId, base);
      later(Math.max(0, (Number.isFinite(expires) ? expires : t + 60_000) - t) + 1000, () => threads.delete(data.threadId), { agentId: data.agentId });
    }
    const at = base + data.atMs;
    later(at - t, () => {
      if (stopped || destroyed) return;
      const s2 = settings();
      const sf = deps.surface();
      deps.captions.show({
        agentId: data.agentId, text: data.text, kind: 'sidetalk', ttlMs: bubbleTtl(data.text), replyable: data.replyable,
        threadId: data.threadId, toAgentId: data.toAgentId, intent: data.intent,
      });
      gate.noteBubble(now() + bubbleTtl(data.text)); // side-talk bubbles count toward max_visible_bubbles (E8)
      const def = catalog.intents.get(data.intent);
      if (def) face(data.agentId, { gesture: def.channels.face.gesture, ...(def.channels.face.expression ? { expression: def.channels.face.expression } : {}), holdMs: def.channels.face.hold_ms });
      const listening = sf.listeningProjectIds.includes(data.projectId);
      // Buzzing voices side-talk on the Floor only for an owner who touched the Floor in the last two minutes and is
      // not habituated (E9); a listen-in always hears it.
      const engaged = lastFloorInteraction !== null && now() - lastFloorInteraction <= D.floorVoiceRecent && floorAmbience() === 'buzzing';
      const voiced = data.voice === 'listen_in' ? listening : data.voice === 'floor_audio' ? listening || (sf.floorVisible && sf.pageVisible && engaged) : false;
      if (!voiced || !deps.audio.armed() || !s2.voiceOn || deps.audio.foregroundActive() || activeAmbient || deps.audio.ownerSpeaking()) return;
      const clip = data.clip ? deps.clips.get(data.clip.key) : null;
      if (!clip || !def) return; // side-talk openers are pre-voiced (P2); otherwise the bubble carries it
      const index = deps.index(data.agentId);
      const u: Utterance = {
        agentId: data.agentId, intent: data.intent, lineId: data.lineId, source: 'archetype', caption: data.opener, fills: data.gist ? { gist: data.gist } : {},
        fillKey: '', nonverbal: false, speak: { xai: '', openai: null, browser: data.text }, estMs: data.clip?.durationMs ?? 1500, face: { gesture: def.channels.face.gesture, holdMs: def.channels.face.hold_ms }, seed: data.threadId,
      };
      const it: Item = {
        id: ++seq, agentId: data.agentId, intent: data.intent, u, def, index, dayKey: '', bus: 'ambient', replyable: data.replyable,
        plan: { voice: true, bubble: false, caption: 'none', face: null, gainDb: num(def.gain_db, -6), priority: def.priority, ttlMs: def.timing.ttl_ms, delayMs: 0 },
        triggeredAt: now(), expiresAt: now() + def.timing.ttl_ms,
      };
      const h = deps.audio.play({
        agentId: it.agentId, clip, bus: 'ambient', gainDb: it.plan.gainDb, priority: it.plan.priority, ttlMs: it.plan.ttlMs, caption: data.text,
        onStart: () => tel({ kind: 'played', agentId: it.agentId, intent: it.intent, ...tid(it.turnId), lineId: it.u.lineId, reason: 'sidetalk', latencyMs: now() - it.triggeredAt }),
      });
      track(it, h);
      if (!data.gist || data.opener === data.text) return;
      // The gist renders at runtime and plays only if ready by the end of the opener + grace (§7.5).
      const gist$ = deps.render({ agentId: data.agentId, lineId: `${data.lineId}~gist`, fills: { gist: data.gist }, provider: s2.provider });
      let gistClip: PreparedClip | null = null;
      void gist$.then((c) => (gistClip = c), () => null);
      void h.done.then((outcome) => {
        if (outcome !== 'completed') return;
        const end = now();
        const tryPlay = () => {
          if (!gistClip || stopped || now() - end > D.tailGrace || activeAmbient) return;
          track({ ...it, id: ++seq }, deps.audio.play({ agentId: it.agentId, clip: gistClip, bus: 'ambient', gainDb: it.plan.gainDb, priority: it.plan.priority, ttlMs: D.tailGrace, caption: data.text }));
        };
        if (gistClip) tryPlay();
        else void gist$.then(() => tryPlay());
      });
    }, { agentId: data.agentId });
  }

  function frame(f: ExpressionFrame): void {
    if (destroyed) return;
    switch (f.type) {
      case 'reflex.face':
        if (!stopped && !settings().approvalInProgress) face(f.data.agentId, f.data.cue);
        return;
      case 'mood.changed':
        deps.face.bias(f.data.agentId, f.data.bias);
        return;
      case 'attention.changed': {
        const j = juggles.get(f.data.agentId);
        if (j && j.turnId.startsWith('thread:')) {
          const stillBusy = f.data.voiceBusyUntil !== null && Date.parse(f.data.voiceBusyUntil) > now();
          const stillThere = [f.data.focus, ...f.data.background].some((x) => x && `thread:${x.label}` === j.turnId && (stillBusy || f.data.floorHeld));
          if (!stillThere) {
            const wait = BACK_WITH_YOU_MIN_MS - (now() - j.at);
            if (wait > 0) later(wait, () => backWithYou(f.data.agentId), { agentId: f.data.agentId });
            else backWithYou(f.data.agentId);
          }
        }
        return;
      }
      case 'reflex.say':
        playServerSay(f.data);
        return;
      case 'sidetalk.line':
        playSideTalk(f.data);
        return;
    }
  }

  // ── control ──────────────────────────────────────────────────────────────────
  function clearAll(): void {
    for (const p of pending.values()) p.cancel();
    pending.clear();
    for (const tm of timers.values()) tm.cancel();
    timers.clear();
    queue = [];
    for (const a of [...active.values()]) a.handle.stop();
    threads.clear();
  }

  return {
    ownerSpeech,
    ownerTurn,
    conversation,
    hover,
    stage,
    bargeIn,
    frame,
    setSettings(s: Partial<ReflexSettings>): void {
      const before = settings();
      overrides = { ...overrides, ...s };
      const after = settings();
      if (after.ambience !== before.ambience) deps.budget.setAmbience(after.ambience);
      if (!after.voiceOn && before.voiceOn) for (const a of active.values()) a.handle.stop();
      if (after.approvalInProgress && !before.approvalInProgress) {
        for (const p of pending.values()) p.cancel();
        pending.clear();
        queue = [];
        for (const a of active.values()) a.handle.stop();
      }
    },
    stopAll(reason: 'everyone_stop' | 'reset'): void {
      clearAll();
      if (reason === 'everyone_stop') {
        stopped = true; // resuming needs the screen: stopAll('reset')
        return;
      }
      stopped = false;
      turns.clear();
      currentTurn.clear();
      replying.clear();
      juggles.clear();
      speech.clear();
      turnVoiceEnd.clear();
    },
    destroy(): void {
      clearAll();
      destroyed = true;
    },
  };
}

const FLOOR_INTENTS = new Set<IntentId>(FLOOR_INTENT_LIST);
const REACTIONS = new Set<IntentId>(REACTION_INTENTS);
const REMEMBER_KEYS = 500;

/** Add to a bounded set (oldest out first), so a long session never grows it without end. */
function remember(set: Set<string>, key: string): void {
  set.add(key);
  if (set.size > REMEMBER_KEYS) set.delete(set.values().next().value!);
}
