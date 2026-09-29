// Public shapes of the reflex engine (docs/LIVING-WORKFORCE.md §11.2). Implementations live in the
// module named in each section; this file only declares.
import type { Alignment, PresenceState, StreamId, VoiceRef } from '@headcount/protocol';
import type {
  Ambience, AmbienceLevel, ArchetypeId, FaceGesture, IntentFamily, IntentId, Mailbox, Mood, MoodEventKind,
  PaletteState, PrevoiceTier, Seniority, SliderKey, Sliders, SlotId, Surface, TeamRole, TtsProvider, UnblockedBy,
} from './vocab';

// ── catalog file shapes (catalog/schema/expression-pack.schema.json) ────────────
export interface MoodFit { valence: number; energy: number; spread?: number }
export interface LineDef {
  id: string; text: string; nonverbal?: boolean;
  tags?: { xai?: string; openai?: { instructions?: string; say?: string } };
  slots?: SlotId[]; mood?: MoodFit; weight?: number; context?: string[]; max_per_day?: number; note?: string;
  /** Cap per agent over the last 7 owner-local days (E1). Quips and catchphrases default to max(2, max_per_day). */
  max_per_week?: number;
  /** Phrase family (E21): a tic spread over several lines ("copy", "kia-ora"); capped per day per agent as a family. */
  family?: string;
  /** An idle line that asks the owner for work (E25); at most one per `solicit_gap_ms` across the Floor. */
  solicits?: boolean;
  /** BCP-47 language of non-English words in the line (E17): capped, glossed, voiced only with a pronunciation channel. */
  lang?: string;
  /** English gloss of the non-English words, shown with the caption (E17). */
  gloss?: string;
}
export interface CatchphraseDef extends LineDef { intents: IntentId[] }
export interface LaughStyle {
  kind: 'chuckle' | 'warm_laugh' | 'belly_laugh' | 'giggle' | 'snort' | 'breathy' | 'dry_huff' | 'silent_smile';
  intensity: number; readiness: number; caption: string; xai?: string; openai?: { say: string; instructions?: string };
}
export type ArchetypeBlend = Partial<Record<ArchetypeId, number>>;
export interface ArchetypePack { kind: 'archetype_pack'; id: ArchetypeId; version: number; intents: Partial<Record<IntentId, LineDef[]>> }
export interface SignaturePack {
  persona_id: string; archetypes: ArchetypeBlend; laugh_style: LaughStyle;
  lines: Partial<Record<IntentId, LineDef[]>>; catchphrases: CatchphraseDef[]; never_says: string[];
  intent_weights?: Partial<Record<IntentId, number>>; disabled_intents?: IntentId[]; voice_notes?: string; version?: number;
  /** Topic id → owner-text keywords (E19). A match on the owner's turn sets the context `topic:<id>`. */
  topics?: Record<string, string[]>;
  /** Per-day cap per phrase family (E21); families without an entry use `defaults.family_max_per_day`. */
  family_max_per_day?: Record<string, number>;
}
export interface SignatureFile { kind: 'signature_file'; group: string; version: number; packs: SignaturePack[] }
export interface IntentDef {
  id: IntentId; family: IntentFamily; summary: string;
  audience: 'owner' | 'coworker' | 'owner_or_room'; budget: 'exempt' | 'chatter'; latency: 'reflex' | 'quick' | 'relaxed';
  triggers: { on: string; when: string; context?: string[] }[];
  timing: {
    delay_ms: [number, number]; ttl_ms: number; min_gap_ms?: number; agent_cooldown_ms?: number; global_gap_ms?: number;
    max_per_turn?: number; max_per_hour?: number; probability?: number; not_before_ms?: number;
  };
  channels: {
    voice: 'owner_audio' | 'stage' | 'listening' | 'never'; bubble: 'never' | 'text_mode' | 'floor' | 'always';
    face: { gesture: FaceGesture; expression?: PaletteState; hold_ms: number }; caption: 'line' | 'reaction' | 'none';
  };
  gain_db?: number; max_chars: number; max_ms: number; slots: SlotId[]; requires: string[];
  ambience: Record<Ambience, AmbienceLevel>; prevoice: PrevoiceTier; priority: number;
  quota: { archetype: number; signature: number }; honesty: string[]; examples: string[];
  /** A longer budget for lines that require one of these contexts (E6), e.g. `{ steer_queued: 2400 }`. */
  max_ms_by_context?: Record<string, number>;
  /** Prior multiplier for signature lines in this intent (E3); `defaults.signature_source_weight` otherwise. */
  signature_weight?: number;
  /** Contexts that, when they hold, restrict the pool to lines requiring them (E5), on top of `defaults.context_first`. */
  context_first?: string[];
}
export interface AmbienceProfile {
  summary: string; chatter_per_min: number; chatter_burst: number; ambient_voice_s_per_10min: number; max_visible_bubbles: number;
  passing_by: { agent_cooldown_ms: number; global_gap_ms: number; voice: boolean };
  sidetalk: { enabled: boolean; voice: 'never' | 'listen_in' | 'floor_audio'; pod_gap_ms: number; agent_gap_ms: number; max_chain: number };
  quip: { probability: number; max_per_hour: number }; backchannel_factor: number; laugh_intensity_cap: number;
}
export type AffectLexicon = Readonly<Record<string, readonly string[]>>;
export interface IntentsFile {
  kind: 'intents'; version: number; about: string;
  defaults: Readonly<Record<string, number | string | boolean | readonly unknown[]>>;
  trigger_events: Record<string, { source: 'client' | 'server' | 'either'; description: string; increment?: string }>;
  ambience: Record<Ambience, AmbienceProfile>;
  slots: Record<SlotId, { source: string; max_chars: number; prevoice: 'fixed' | 'finite' | 'team' | 'runtime'; domain?: string[]; description: string }>;
  contexts: Record<string, string>; affect_lexicon: AffectLexicon; intents: IntentDef[];
}
export interface ArchetypeDef {
  id: ArchetypeId; name: string; summary: string; sounds_like: string;
  mapping: {
    sliders: Partial<Record<SliderKey, number>>; traits: Record<string, number>;
    roles?: Partial<Record<TeamRole, number>>; seniority?: Partial<Record<Seniority, number>>;
  };
  mood_bias: Mood; intent_weights: Partial<Record<IntentId, number>>;
  delivery: {
    pace: 'slow' | 'measured' | 'brisk' | 'quick'; tag_budget: number; preferred_tags: string[]; avoid_tags: string[];
    openai_instructions: string; backchannel: string; filler: string; avoid: string[];
  };
  laugh: LaughStyle; exemplars: Partial<Record<IntentId, LineDef[]>>;
}
export interface ArchetypesFile {
  kind: 'archetypes'; version: number; about: string;
  normalization: { method: 'zscore_over_catalog'; clip: number; computed_over: string; mean: Sliders; std: Sliders };
  blend_rule: { top_k: number; temperature: number; min_weight: number; trait_bonus_cap: number; trait_match: 'exact_lowercase'; precedence: string[] };
  archetypes: ArchetypeDef[]; lead_blends: Record<string, ArchetypeBlend>;
}

// ── compile and index (catalog.ts) ──────────────────────────────────────────────
export interface ExpressionCatalogInput {
  intents: IntentsFile; archetypes: ArchetypesFile; packs: readonly ArchetypePack[]; signatures: readonly SignatureFile[];
  sliderStats?: { mean: Sliders; std: Sliders };
}
export interface CompiledLine {
  id: string; packId: string; intent: IntentId; source: 'signature' | 'archetype' | 'catchphrase'; archetype: ArchetypeId | null;
  text: string; xai: string; openai: { say: string; instructions: string | null }; nonverbal: boolean;
  slots: readonly SlotId[]; mood: MoodFit | null; weight: number; require: readonly string[]; forbid: readonly string[];
  maxPerDay: number | null; textHash: number; opener: string; estMs: number; intensity: 'low' | 'mid' | 'high';
  /** Weekly cap (E1); null = uncapped. */
  maxPerWeek: number | null;
  family: string | null; solicits: boolean; lang: string | null; gloss: string | null;
}
export interface CompiledCatalog {
  readonly version: string;
  readonly intents: ReadonlyMap<IntentId, IntentDef>;
  readonly ambience: Readonly<Record<Ambience, AmbienceProfile>>;
  readonly defaults: IntentsFile['defaults'];
  readonly archetypes: ReadonlyMap<ArchetypeId, ArchetypeDef>;
  readonly archetypesFile: ArchetypesFile;
  readonly lexicon: AffectLexicon;
  linesFor(packId: string, intent: IntentId): readonly CompiledLine[];
  signature(personaId: string): SignaturePack | null;
}

export interface PersonalityInput {
  sliders: Sliders; traits: readonly string[]; roles?: readonly TeamRole[]; seniority?: Seniority; leadId?: string;
}
export interface AgentExpressionProfile {
  agentId: string; personaId: string; firstName: string; personality: PersonalityInput; voice: VoiceRef; teamRole?: TeamRole | 'chief';
}

export interface WeightedLine { line: CompiledLine; prior: number }
export interface AgentIndex {
  readonly agentId: string; readonly personaId: string; readonly catalogVersion: string;
  readonly blend: ArchetypeBlend; readonly laugh: LaughStyle; readonly baseline: Mood; readonly reactivity: number;
  readonly neverSays: readonly string[]; readonly voice: VoiceRef;
  candidates(intent: IntentId): readonly WeightedLine[];
  intentWeight(intent: IntentId): number; // 0 = disabled
}

// ── grounding (state.ts) ────────────────────────────────────────────────────────
export interface CauseRef { streamId: StreamId; seq: number }
export interface GroundingState {
  /**
   * `workDays` (E14): the workspace's working weekdays (JS numbering, 0 = Sunday); default Monday–Friday.
   * It drives `workweek:first_day`, `workweek:last_day`, `weekend` and `works_weekends`.
   */
  now: { epochMs: number; localHour: number; weekday: number; workDays?: readonly number[] };
  owner: { firstName: string | null };
  chiefName: string | null;
  self: {
    agentId: string; firstName: string; presence: PresenceState; blocked: boolean; staffed: boolean;
    activity: string | null; role: TeamRole | 'chief' | null;
  };
  counterpart?: { agentId: string; firstName: string };
  project?: { id: string; shortName: string | null; client: string | null };
  work?: { stepLabel?: string; done?: number; total?: number | null; artifact?: string; blocker?: string };
  attention?: { otherThread?: string; etaMs?: number | null };
  review?: { verdict: 'approve' | 'changes' | 'block'; findingCount: number };
  gist?: string;
  history: {
    firstMeeting: boolean; returning: boolean; newDay: boolean; lastWinAt: number | null; lastUnblockedAt: number | null;
    winsToday: number; distressThisSession: boolean;
    /** Who caused the last `step.unblocked` (E18): only `owner` lets a line thank the owner. */
    lastUnblockedBy?: UnblockedBy | null;
    /** Ledger events the owner has not seen since their last visit (E24); > 0 sets `has_updates`. */
    unseenUpdates?: number;
  };
  exchange: {
    mode: 'voice' | 'text' | 'none'; interrupted: boolean; steerQueued: boolean;
    ownerFarewell: boolean; ownerGreeting: boolean; ownError: boolean;
    /** The sniffer's cues for the owner turn this reflex answers (E4): owner_question, owner_praise, owner_tone:*, … */
    cues?: AffectCues;
    /** Topics of this agent's that the owner's turn mentions (E19): `topic:<id>`. */
    topics?: readonly string[];
  };
  replyTo?: IntentId;
  quietHours: boolean;
}
export type SlotValues = Partial<Record<SlotId, string>>;

// ── recency and randomness (recency.ts, hash.ts) ────────────────────────────────
export interface RecentEntry { lineId: string; intent: IntentId; textHash: number; opener: string; at: number }
/**
 * v1: one list per agent plus today's counts. v2 (E1) adds a ring per agent × intent (`intents`) and per-day use
 * counts for the last 7 owner-local days (`weekly`: agent → day → line → uses). `merge` accepts both.
 */
export interface RecencySnapshot {
  v: 1 | 2; day: string; agents: Record<string, RecentEntry[]>; daily: Record<string, Record<string, number>>;
  intents?: Record<string, Partial<Record<IntentId, RecentEntry[]>>>;
  weekly?: Record<string, Record<string, Record<string, number>>>;
}
export interface RecencyMemory {
  /** The agent's most recent lines across intents, newest first (openers, text windows). */
  recent(agentId: string): readonly RecentEntry[];
  /** The agent's most recent lines of one intent, newest first (E1: survives hours of other talk). */
  recentFor(agentId: string, intent: IntentId): readonly RecentEntry[];
  record(agentId: string, entry: RecentEntry, dayKey: string): void;
  usesToday(agentId: string, lineId: string, dayKey: string): number;
  /** Uses of a line over the 7 owner-local days ending `dayKey` (E1). */
  usesWeek(agentId: string, lineId: string, dayKey: string): number;
  recentText(textHash: number, now: number, windowMs: number): boolean;
  merge(snapshot: RecencySnapshot): void;
  snapshot(): RecencySnapshot;
}
export interface Rng { next(): number }

// ── selection, filling, delivery (select.ts, delivery.ts) ───────────────────────
export interface FaceCue { gesture: FaceGesture; expression?: PaletteState; weight?: number; holdMs: number }
export interface ClipAvailability {
  has(clipKey: string): boolean; durationMs(clipKey: string): number | null;
  /** True when a human checked the clip's pronunciation (E17: non-English words on providers without a pronunciation channel). */
  pronunciationChecked?(clipKey: string): boolean;
}
export interface SelectRequest {
  intent: IntentId; state: GroundingState; mood: Mood; ambience: Ambience; provider: TtsProvider;
  seed: string; now: number; channel: 'voice' | 'text';
  instantOnly?: boolean;
  clips?: ClipAvailability;
  clipKeyOf?: (lineId: string, fillKey: string) => string | undefined;
  /** Dynamic cap (E6), e.g. the agent's p50 first-chunk latency minus time already elapsed. Context budgets override it. */
  maxDurationMs?: number;
  laughIntensityCap?: number;
  /** Texts to avoid (E7 pod dedupe): excluded when an alternative exists. */
  avoidTextHashes?: ReadonlySet<number>;
  /** Skip lines that ask the owner for work (E25 Floor-wide cap). */
  excludeSoliciting?: boolean;
}
export type SkipReason = 'disabled' | 'no_candidates' | 'ungrounded' | 'context' | 'never_says' | 'not_instant' | 'too_long' | 'exhausted';
export interface Utterance {
  agentId: string; intent: IntentId; lineId: string; source: CompiledLine['source'];
  caption: string; fills: SlotValues; fillKey: string; nonverbal: boolean;
  speak: { xai: string; openai: { input: string; instructions: string } | null; browser: string | null };
  estMs: number; face: FaceCue; seed: string;
  split?: { prefix: Utterance; tailText: string };
  /** English gloss of non-English words (E17), shown beside the caption, never spoken. */
  gloss?: string;
  /** The line asks the owner for work (E25). */
  solicits?: boolean;
}
export type SelectResult =
  | { ok: true; utterance: Utterance; considered: number }
  | { ok: false; reason: SkipReason; considered: number };

export interface TtsDelivery {
  provider: TtsProvider; model: string | null; voiceId: string | null; speed: number; lang: string; input: string; instructions: string | null;
}

// ── mood and face (mood.ts) ─────────────────────────────────────────────────────
export interface MoodEvent { kind: MoodEventKind; at: number; cause?: CauseRef; scale?: number }
export interface MoodState {
  agentId: string; baseline: Mood; reactivity: number; value: Mood; at: number;
  lastCause: CauseRef | null; lastKind: MoodEventKind | null;
}
export interface ExpressionBias {
  expression: PaletteState; weight: number; cornerPull: number; brow: number; pitchDeg: number; blinkScale: number; swayScale: number;
}

// ── owner affect (affect.ts) ────────────────────────────────────────────────────
export interface AffectCues {
  request: number; question: boolean; humor: number; gratitude: number; praise: number; farewell: number; greeting: number;
  goodNews: number; badNews: number; frustration: number; distress: boolean; correction: number; doubt: number;
  stopOrSteer: number; sincereAi: boolean; phatic: boolean; words: number;
  /** The owner doubts themselves out loud ("am I crazy", "is this a dumb question"), E4 `owner_self_doubt`. */
  selfDoubt: number;
}
export type ReactHint = 'laugh' | 'surprise' | 'delight' | 'concern' | 'sympathy' | 'encouragement' | 'apology' | 'none';

// ── gates and budgets (gate.ts) ─────────────────────────────────────────────────
export type BudgetClass = 'exempt' | 'chatter';
export interface ChatterBudget {
  readonly ambience: Ambience;
  setAmbience(a: Ambience): void;
  canSpend(klass: BudgetClass, now: number, voicedMs?: number): boolean;
  spend(klass: BudgetClass, now: number, voicedMs?: number): void;
  state(now: number): { tokens: number; voicedMsWindow: number };
  /**
   * Additive (Office Phase 2): voiced ambient ms still allowed in the rolling 10-minute window at this Ambience, so a
   * host's own ambient audio (the office's listen-in) shares the window with passing-by lines.
   */
  voiceLeftMs?(now: number): number;
  /** Additive: count voiced ambient ms without spending a chatter token (the office's listen-in). */
  spendVoice?(now: number, ms: number): void;
}
export interface GateInput {
  agentId: string; intent: IntentId; now: number; ambience: Ambience; surface: Surface; turnId?: string;
  ownerSpeaking: boolean; agentVoiceBusy: boolean; foregroundAudio: boolean; ownerAtStage: boolean;
  audioArmed: boolean; voiceOn: boolean; listening: boolean; exchange: 'voice' | 'text' | 'none';
  quietHours: boolean; reducedMotion: boolean; approvalInProgress: boolean; stopped: boolean; pageVisible: boolean;
}
export interface ChannelPlan {
  voice: boolean; bubble: boolean; caption: 'line' | 'reaction' | 'none'; face: FaceCue | null;
  gainDb: number; priority: number; ttlMs: number; delayMs: number;
}
export type GateVerdict = { allow: true; plan: ChannelPlan } | { allow: false; reason: string; faceOnly: FaceCue | null };
export interface TimingGate {
  check(input: GateInput, rng: Rng): GateVerdict;
  /** `bubbleUntil`: when a Floor chatter bubble was shown, the time it disappears (E8 bubble count). */
  commit(input: GateInput, spentMs: number, bubbleUntil?: number): void;
  /** A Floor bubble shown outside `commit` (side-talk), so `max_visible_bubbles` counts it (E8). */
  noteBubble(until: number): void;
  resetTurn(turnId: string): void;
}

// ── actors and attention (actor.ts) ─────────────────────────────────────────────
export interface Envelope<T> { id: string; box: Mailbox; at: number; ttlMs?: number; coalesceKey?: string; payload: T }
export interface Mailboxes<T> {
  post(e: Envelope<T>): void;
  take(now: number): Envelope<T> | null;
  preempts(e: Envelope<T>, current: Mailbox): boolean;
  drop(pred: (e: Envelope<T>) => boolean): number;
  size(box?: Mailbox): number;
}
export interface AttentionThread {
  id: string; kind: 'talk' | 'desk' | 'sidethread' | 'meeting' | 'ask' | 'work'; mailbox: Mailbox; host: StreamId; label: string;
  voice: { speaking: boolean; untilMs: number | null }; floorHeld: boolean; interruptible: 'now' | 'sentence' | 'checkpoint'; since: number;
}
export interface AttentionView {
  agentId: string; focus: AttentionThread | null; background: readonly AttentionThread[]; voiceBusyUntil: number | null; at: number;
}
export type Contention = { kind: 'none' } | { kind: 'voice_busy' | 'floor_held'; etaMs: number | null; otherThread: string };

// ── side-talk (sidetalk.ts) ─────────────────────────────────────────────────────
export interface SideTalkEvent {
  kind: 'handoff' | 'ask' | 'ask.answered' | 'job.done' | 'verdict' | 'project.done';
  from: string; to: string; projectId: string; cause: CauseRef;
  gist?: string; artifact?: string; verdict?: 'approve' | 'changes' | 'block'; findingCount?: number;
  visibility: 'team' | 'owner_only' | 'private';
}
export interface SideTalkContext {
  catalog: CompiledCatalog; index(agentId: string): AgentIndex | null; state(agentId: string): GroundingState | null;
  mood(agentId: string): Mood; ambience: Ambience; recency: RecencyMemory; provider: TtsProvider; now: number;
  lastPodLineAt(projectId: string): number | null; lastAgentLineAt(agentId: string): number | null;
  /** The pod's agents (E7): their recent texts are avoided, so two teammates never tell the same joke. */
  podAgents?(projectId: string): readonly string[];
}
export interface SideTalkLinePlan {
  index: number; agentId: string; toAgentId: string; intent: IntentId; utterance: Utterance; gist: string | null; atMs: number;
}
export interface SideTalkProposal { threadId: string; projectId: string; cause: CauseRef; lines: readonly SideTalkLinePlan[]; expiresAt: number }

// ── pre-voicing (prevoice.ts) ───────────────────────────────────────────────────
export interface CommonFills {
  owner_name?: string; chief_name?: string; self_name: string; coworkers?: readonly string[]; projects?: readonly string[];
}
export interface PrevoiceItem {
  lineId: string; intent: IntentId; tier: Exclude<PrevoiceTier, 'runtime'>; fills: SlotValues; fillKey: string;
  delivery: TtsDelivery; clipKey: string; scope: 'shared' | 'workspace';
}
export interface ClipManifest {
  agentId: string; catalogVersion: string; provider: TtsProvider; voiceKey: string;
  // key: `${lineId}|${fillKey}`; `pronunciationChecked` (E17) marks a clip whose non-English words passed a human check.
  clips: Record<string, { clipKey: string; durationMs: number; scope: 'shared' | 'workspace'; pronunciationChecked?: boolean }>;
}

// ── protocol frame data (ephemeral; frames.ts) ──────────────────────────────────
export interface ReflexSayData {
  agentId: string; intent: IntentId; lineId: string; fillKey: string; caption: string;
  /** English gloss for non-English words in the caption (E17). */
  gloss?: string;
  clip: { key: string; url: string; durationMs: number; alignmentUrl: string | null } | null;
  render: { lineId: string; fills: SlotValues } | null;
  channels: { voice: boolean; bubble: boolean; caption: 'line' | 'reaction' | 'none' };
  face: FaceCue; gainDb: number; priority: number; ttlMs: number;
  audience: 'owner' | 'floor' | 'room'; threadId?: string; turnId?: string; gen?: number; cause?: CauseRef;
}
export interface ReflexFaceData { agentId: string; cue: FaceCue; cause?: CauseRef }
export interface SideTalkLineData {
  threadId: string; index: number; projectId: string; agentId: string; toAgentId: string; intent: IntentId; lineId: string;
  text: string; opener: string; gist: string | null;
  clip: { key: string; url: string; durationMs: number } | null;
  voice: 'never' | 'listen_in' | 'floor_audio'; atMs: number; expiresAt: string; replyable: boolean; cause: CauseRef;
}
export interface MoodChangedData {
  agentId: string; valence: number; energy: number; at: number; baseline: Mood; bias: ExpressionBias;
  reason: MoodEventKind; cause?: CauseRef;
}
export interface AttentionChangedData {
  agentId: string;
  focus: { threadId: string; kind: AttentionThread['kind']; label: string } | null;
  background: { threadId: string; kind: AttentionThread['kind']; label: string }[];
  voiceBusyUntil: string | null; floorHeld: boolean;
}
export type ExpressionFrame =
  | { type: 'reflex.say'; data: ReflexSayData }
  | { type: 'reflex.face'; data: ReflexFaceData }
  | { type: 'sidetalk.line'; data: SideTalkLineData }
  | { type: 'mood.changed'; data: MoodChangedData }
  | { type: 'attention.changed'; data: AttentionChangedData };

// ── client reflex runner (ports only; the web shell implements them; runner.ts) ─
export type AudioBus = 'conversation' | 'reflex' | 'ambient';
export interface PreparedClip { key: string; durationMs: number; alignment: Alignment | null; handle: unknown }
export interface ClipStore {
  get(key: string): PreparedClip | null;
  load(key: string): Promise<PreparedClip | null>;
  prefetch(keys: readonly string[], tier: Exclude<PrevoiceTier, 'runtime'>): void;
  manifest(agentId: string): ClipManifest | null;
}
export interface ReflexPlayRequest {
  agentId: string; clip: PreparedClip; bus: AudioBus; gainDb: number; priority: number; ttlMs: number; caption: string; onStart?(): void;
  /** Additive (Inc 0.5): the intent, so a host can let only a backchannel sound while the owner's mic is live (L5). */
  intent?: IntentId;
}
export interface ReflexPlayHandle {
  readonly started: Promise<boolean>; readonly done: Promise<'completed' | 'stopped' | 'dropped'>; stop(): void;
}
export interface ReflexAudioPort {
  armed(): boolean;
  ownerSpeaking(): boolean;
  voiceBusy(agentId: string): { busy: boolean; remainingMs: number | null; bus: AudioBus | null };
  foregroundActive(): boolean;
  play(req: ReflexPlayRequest): ReflexPlayHandle;
  speakText(agentId: string, text: string, opts: { gainDb: number; bus: AudioBus; priority: number }): ReflexPlayHandle | null;
}
export interface ReflexFacePort { cue(agentId: string, cue: FaceCue): void; bias(agentId: string, bias: ExpressionBias): void }
export interface ReflexCaptionPort {
  show(c: {
    agentId: string; text: string; kind: 'reaction' | 'line' | 'bubble' | 'sidetalk'; ttlMs: number; replyable: boolean;
    threadId?: string; toAgentId?: string;
    /** English gloss of non-English words (E17), shown beside the text. */
    gloss?: string;
    /** Additive (Inc 0.5): the intent, so a host can keep fillers out of what an agent "last said" (§9.4). */
    intent?: IntentId;
  }): void;
  clear(agentId: string, kind?: 'reaction' | 'line' | 'bubble' | 'sidetalk'): void;
}
export interface ReflexSettings {
  ambience: Ambience; voiceOn: boolean; captions: boolean; captionReactions: boolean; reducedMotion: boolean;
  quietHours: boolean; provider: TtsProvider; frontAcks: boolean;
  /**
   * Additive (not in the §11.2 declaration): true from a voice approval read-back until its confirmation
   * (ARCHITECTURE §8.8). The runner then plays nothing at all, not even a face cue (§1.4.7, H9).
   */
  approvalInProgress?: boolean;
}
export interface RenderRequest { agentId: string; lineId: string; fills: SlotValues; provider: TtsProvider }
export interface ReflexTelemetry {
  kind: 'played' | 'skipped' | 'dropped' | 'wasted_filler' | 'late_tail'; agentId: string; intent: IntentId;
  lineId?: string; reason?: string; latencyMs?: number;
  /** Additive (Inc 0.5): the owner turn the reflex belonged to, when it had one. */
  turnId?: string;
}
export interface ReflexRunnerDeps {
  catalog: CompiledCatalog;
  index(agentId: string): AgentIndex | null;
  state(agentId: string): GroundingState | null;
  mood(agentId: string): Mood;
  attention(agentId: string): AttentionView | null;
  settings(): ReflexSettings;
  surface(): { surface: Surface; stageAgentId: string | null; floorVisible: boolean; listeningProjectIds: readonly string[]; pageVisible: boolean };
  audio: ReflexAudioPort; face: ReflexFacePort; captions: ReflexCaptionPort; clips: ClipStore;
  recency: RecencyMemory; budget: ChatterBudget;
  render(req: RenderRequest): Promise<PreparedClip | null>;
  clock(): number;
  schedule(fn: () => void, ms: number): () => void;
  telemetry?(e: ReflexTelemetry): void;
}
export interface OwnerSpeechEvent { agentId: string; kind: 'start' | 'pause' | 'resume' | 'end'; at: number; pauseMs?: number; utteranceMs: number }
export interface OwnerTurnEvent { agentId: string; turnId: string; at: number; mode: 'voice' | 'text'; text: string; cues: AffectCues }
export type ConversationEvent =
  | { kind: 'first_token'; turnId: string; at: number; hint: ReactHint | null }
  | { kind: 'first_chunk'; turnId: string; at: number }
  | { kind: 'speaking'; turnId: string; agentId: string; remainingMs: number | null }
  /** `replayed`: the end came back as history after the feed reconnected: the turn closes, nothing is voiced for it. */
  | { kind: 'done' | 'cancelled'; turnId: string; at: number; replayed?: boolean }
  | { kind: 'backgrounded'; turnId: string; at: number; etaMs: number | null };
export interface ReflexRunner {
  ownerSpeech(e: OwnerSpeechEvent): void;
  ownerTurn(e: OwnerTurnEvent): void;
  conversation(e: ConversationEvent): void;
  hover(agentId: string, phase: 'enter' | 'dwell' | 'leave', via: 'pointer' | 'keyboard' | 'touch'): void;
  /**
   * Stage open or close. `reason` (E20) says why a stage closed: `navigate` (Talk ↔ Floor and other in-app moves:
   * never a sign-off) or `leave` (the owner leaves the app or ends the session: a deferred sign-off). Default `navigate`.
   */
  stage(agentId: string, phase: 'open' | 'close', reason?: 'navigate' | 'leave'): void;
  bargeIn(agentId: string): void;
  frame(f: ExpressionFrame): void;
  setSettings(s: Partial<ReflexSettings>): void;
  stopAll(reason: 'everyone_stop' | 'reset'): void;
  destroy(): void;
}

export type { Ambience, AmbienceLevel, ArchetypeId, FaceGesture, IntentFamily, IntentId, Mailbox, Mood, MoodEventKind, PaletteState, PrevoiceTier, Seniority, SliderKey, Sliders, SlotId, Surface, TeamRole, TtsProvider, UnblockedBy };
