// Inc 0.5 wire types of the living-workforce layer (docs/LIVING-WORKFORCE.md §10.4, docs/dev/INC05-PLAN.md §3).
// Structural mirrors of @headcount/expressions (protocol cannot depend on it); a worker conformance test keeps them equal.
import type { AgentId, MessageId, OpId, StreamId, TurnId } from '../ids';
import type { Alignment, VoiceRef } from '../voice';

// ── vocabulary ──────────────────────────────────────────────────────────────────
export type Ambience = 'quiet' | 'lively' | 'buzzing';
export const AMBIENCES: readonly Ambience[] = ['quiet', 'lively', 'buzzing'];
export const DEFAULT_AMBIENCE: Ambience = 'lively';
export const isAmbience = (v: unknown): v is Ambience => v === 'quiet' || v === 'lively' || v === 'buzzing';
/** Settings written before Inc 0.5 carry no ambience: that means Lively. */
export const ambienceOf = (s: { ambience?: Ambience | undefined } | null | undefined): Ambience => s?.ambience ?? DEFAULT_AMBIENCE;

export type ExprIntentId =
  | 'backchannel' | 'acknowledge' | 'thinking_filler' | 'holding_filler' | 'deferral'
  | 'laugh' | 'surprise' | 'delight' | 'concern' | 'sympathy' | 'encouragement'
  | 'gratitude_reply' | 'apology' | 'yield_floor' | 'juggling' | 'back_with_you'
  | 'greeting' | 'passing_by' | 'micro_status' | 'quip' | 'sign_off'
  | 'handoff_give' | 'handoff_take' | 'ask_coworker' | 'answer_coworker' | 'share_result'
  | 'review_approve' | 'review_changes' | 'sidetalk_reply'
  | 'celebrate' | 'blocked' | 'unblocked' | 'oops';
export type ExprSlotId =
  | 'owner_name' | 'chief_name' | 'self_name' | 'coworker' | 'project' | 'client' | 'step_label' | 'artifact'
  | 'done' | 'total' | 'eta' | 'other_thread' | 'blocker' | 'finding_count' | 'weekday' | 'part_of_day' | 'gist';
export type ExprSlotValues = Partial<Record<ExprSlotId, string>>;
export type ExprTtsProvider = 'xai' | 'openai' | 'browser' | 'mock';
export type FaceGesture =
  | 'none' | 'nod' | 'double_nod' | 'look_up' | 'brow_flash' | 'head_tilt' | 'smile' | 'wince' | 'exhale' | 'glance' | 'still';
export type PaletteState = 'resting' | 'thinking' | 'delighted' | 'concerned';
export type ReactHint = 'laugh' | 'surprise' | 'delight' | 'concern' | 'sympathy' | 'encouragement' | 'apology' | 'none';
export type MoodEventKind =
  | 'deliverable.accepted' | 'deliverable.accepted_edited' | 'verdict.approve' | 'verdict.changes' | 'verdict.block'
  | 'job.done' | 'step.retry' | 'job.failed' | 'step.blocked' | 'step.unblocked' | 'decision.approved' | 'decision.declined'
  | 'project.done' | 'teammate.win' | 'owner.thanks' | 'owner.praise' | 'owner.frustrated' | 'owner.distress'
  | 'hired' | 'everyone.stop' | 'work.hour';
export type ExprSurface = 'talk' | 'desk' | 'floor' | 'room' | 'elsewhere';
/** Where a talk.* frame belongs: the Talk transcript (absent = 'talk') or a Floor side-thread. */
export type TalkSurface = 'talk' | 'floor';
export type AttentionKind = 'talk' | 'desk' | 'sidethread' | 'meeting' | 'ask' | 'work';
export type ExprSliderKey = 'warmth' | 'directness' | 'formality' | 'humor' | 'risk_appetite' | 'detail' | 'pace';
export type ExprTeamRole = 'lead' | 'co_owner' | 'reviewer' | 'sceptic' | 'facilitator' | 'specialist';
export type ExprSeniority = 'specialist' | 'senior' | 'lead' | 'principal';

export interface ExprMood { valence: number; energy: number }
export interface ExprCause { streamId: StreamId; seq: number }
export interface FaceCue { gesture: FaceGesture; expression?: PaletteState; weight?: number; holdMs: number }
export interface ExpressionBias {
  expression: PaletteState; weight: number; cornerPull: number; brow: number; pitchDeg: number; blinkScale: number; swayScale: number;
}

// ── ephemeral frame data (agentId/turnId stay `string`, as in @headcount/expressions) ──
export interface ReflexSayData {
  agentId: string; intent: ExprIntentId; lineId: string; fillKey: string; caption: string;
  gloss?: string;
  clip: { key: string; url: string; durationMs: number; alignmentUrl: string | null } | null;
  render: { lineId: string; fills: ExprSlotValues } | null;
  channels: { voice: boolean; bubble: boolean; caption: 'line' | 'reaction' | 'none' };
  face: FaceCue; gainDb: number; priority: number; ttlMs: number;
  audience: 'owner' | 'floor' | 'room'; threadId?: string; turnId?: string; gen?: number; cause?: ExprCause;
}
export interface ReflexFaceData { agentId: string; cue: FaceCue; cause?: ExprCause }
export interface SideTalkLineData {
  threadId: string; index: number; projectId: string; agentId: string; toAgentId: string; intent: ExprIntentId; lineId: string;
  text: string; opener: string; gist: string | null;
  clip: { key: string; url: string; durationMs: number } | null;
  voice: 'never' | 'listen_in' | 'floor_audio'; atMs: number; expiresAt: string; replyable: boolean; cause: ExprCause;
}
export interface MoodChangedData {
  agentId: string; valence: number; energy: number; at: number; baseline: ExprMood; bias: ExpressionBias;
  reason: MoodEventKind; cause?: ExprCause;
}
export interface AttentionChangedData {
  agentId: string;
  focus: { threadId: string; kind: AttentionKind; label: string } | null;
  background: { threadId: string; kind: AttentionKind; label: string }[];
  voiceBusyUntil: string | null; floorHeld: boolean;
}

// ── agent profile and clip manifest ─────────────────────────────────────────────
/** Mirror of AgentExpressionProfile. The worker is the single source; the web builds its AgentIndex from it. */
export interface ExprAgentProfile {
  agentId: string; personaId: string; firstName: string;
  personality: { sliders: Record<ExprSliderKey, number>; traits: readonly string[]; roles?: readonly ExprTeamRole[]; seniority?: ExprSeniority; leadId?: string };
  voice: VoiceRef; teamRole?: ExprTeamRole | 'chief';
}
/** Mirror of ClipManifest: rendered clips only. Key: `${lineId}|${fillKey}`. */
export interface ExprClipManifest {
  agentId: string; catalogVersion: string; provider: ExprTtsProvider; voiceKey: string;
  clips: Record<string, { clipKey: string; durationMs: number; scope: 'shared' | 'workspace'; pronunciationChecked?: boolean }>;
}

// ── HTTP ────────────────────────────────────────────────────────────────────────
/** GET /api/expr/catalog. `input` is an ExpressionCatalogInput: pass it to compileCatalog(). */
export interface ExprCatalogBundle { kind: 'expression_bundle'; version: string; input: unknown }

export type ExprPrevoiceTier = 'p0' | 'p1' | 'p2';
export interface ExprPrevoiceStatus {
  runId: string; state: 'queued' | 'running' | 'done' | 'failed' | 'stopped_budget';
  provider: ExprTtsProvider; tiers: ExprPrevoiceTier[]; agentIds: string[];
  planned: number; cached: number; rendered: number; failed: number;
  startedAt: string; finishedAt?: string; error?: string;
}

/** GET /api/expr/agents/:agentId (cw_chief or cw_<personaId>). */
export interface ExprAgentResponse {
  agentId: string; personaId: string; catalogVersion: string;
  profile: ExprAgentProfile;
  /** Always false for catalog coworkers in Inc 0.5; true for cw_chief. */
  staffed: boolean;
  /** The renderer this agent's reflexes use right now (§3.5). */
  provider: ExprTtsProvider;
  voiceKey: string;
  manifest: ExprClipManifest;
  /** The latest pre-voice run that covered this agent, or null. */
  prevoice: ExprPrevoiceStatus | null;
  baseline: ExprMood; reactivity: number;
  /** null = no mood event yet (the face uses the baseline). */
  mood: MoodChangedData | null;
  attention: AttentionChangedData | null;
}

/** POST /api/expr/render. lineId: `<id>`, `<id>~prefix`, `<id>~tail` or `<id>~gist`. */
export interface ExprRenderRequest { agentId: string; lineId: string; fills: ExprSlotValues; provider: ExprTtsProvider }
export interface ExprClipRef {
  clipKey: string; url: string; alignmentUrl: string; durationMs: number; scope: 'shared' | 'workspace';
  /** True when the clip already existed (no TTS call, no budget used). */
  cached: boolean;
}
/** GET /api/expr/clips/:clipKey/align. `alignment` null → the mouth is text-timed over the clip. */
export interface ExprClipAlignment { clipKey: string; text: string; alignment: Alignment | null }

/** POST /api/expr/prevoice. Either plan server-side (agentIds + tiers) or pass a planPrevoice() plan as `items`. */
export interface ExprPrevoiceRequest {
  agentIds: string[];                       // 1–12
  tiers?: ExprPrevoiceTier[];               // default ['p0']
  perIntent?: number;                       // 1–24; default per tier (p0 6, p1 8, p2 4)
  allLinesFor?: ExprIntentId[];             // every line of these intents (LIVING-WORKFORCE §7.1)
  items?: { agentId: string; lineId: string; fills: ExprSlotValues }[];   // ≤ 400; each re-validated and re-keyed
  maxClips?: number;                        // this run's cap; default EXPR_PREVOICE_MAX_CLIPS (300)
  dryRun?: boolean;                         // plan and count only: no TTS, no budget
}
export interface ExprPrevoiceAccepted {
  accepted: true; runId: string | null; provider: ExprTtsProvider;
  planned: number; alreadyCached: number; toRender: number; estAudioMs: number; remainingToday: number;
  /** True when an equivalent run already completed (same agents, tiers, provider, voice and catalog version). */
  reused?: boolean; dryRun?: boolean;
}

/** POST /api/desk/:personaId/say: a Floor quick-chat message to a catalog coworker. */
export interface DeskSayRequest { text: string; opId: OpId; via?: 'text' | 'voice' }
export interface DeskSayAccepted { accepted: true; opId: OpId; agentId: AgentId; turnId: TurnId; messageId: MessageId; duplicate?: boolean }

// ── client → server socket ops (fire-and-forget) ────────────────────────────────
export interface ViewerOp {
  op: 'viewer';
  surface: ExprSurface;
  /** cw_chief on Talk, cw_<personaId> on a coworker's profile (their desk), else null. */
  stageAgentId: string | null;
  floorVisible: boolean;
  visibleProjectIds: string[];
  listeningProjectIds: string[];
  audioArmed: boolean;
  voiceOn: boolean;
  pageVisible: boolean;
  reducedMotion: boolean;
  quietHours: boolean;
  /** Date.prototype.getTimezoneOffset() of the owner's browser: server-side owner-local time (part of day, new day). */
  tzOffsetMin: number;
  /** An agent's voice that is audibly busy in this tab (conversation audio), until when (epoch ms). */
  voice: { agentId: string; untilMs: number } | null;
}
export interface ExprRecentOp { op: 'expr.recent'; agents: Record<string, string[]> }   // ≤ 32 line ids per agent
