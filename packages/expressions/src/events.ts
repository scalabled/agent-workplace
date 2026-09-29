// Server-side event reflexes (§2.5): the WorkspaceDO turns work events (progress, wins, blockers, retries,
// steers) into mood events and, when a viewer is at that agent's stage, a gated and grounded `reflex.say`.
// Also the host's phatic replies (§3.3). Pure: the host supplies the gate, recency and manifest it owns.
import { reflexSayData } from './frames';
import { budgetClassFor, reflexProbability } from './gate';
import { seededRng } from './hash';
import { ownerDayKey, recordUtterance, selectLine } from './select';
import type {
  AffectCues, AgentIndex, CauseRef, ChannelPlan, ClipAvailability, ClipManifest, CompiledCatalog, FaceCue, GateInput, GroundingState, RecencyMemory,
  ReflexSayData, TimingGate, Utterance,
} from './types';
import type { Ambience, IntentId, Mood, MoodEventKind, Surface, TtsProvider } from './vocab';

export type WorkEventKind =
  | 'job.progress' | 'job.steered' | 'job.done' | 'job.failed' | 'step.retry' | 'step.blocked' | 'step.unblocked'
  | 'deliverable.accepted' | 'deliverable.accepted_edited' | 'decision.approved' | 'decision.declined' | 'project.done' | 'verdict';

const DIRECT_MOOD = new Set<string>([
  'job.done', 'job.failed', 'step.retry', 'step.blocked', 'step.unblocked', 'deliverable.accepted', 'deliverable.accepted_edited',
  'decision.approved', 'decision.declined', 'project.done',
]);

/** The mood event a work event means for the agent it concerns (verdicts count for the author), or null. */
export function moodEventFor(kind: WorkEventKind, verdict?: 'approve' | 'changes' | 'block'): MoodEventKind | null {
  if (kind === 'verdict') return verdict ? (`verdict.${verdict}` as MoodEventKind) : null;
  return DIRECT_MOOD.has(kind) ? (kind as MoodEventKind) : null;
}

/** The event reflex a work event may produce at the owner's stage (§3.2 work and presence intents), or null. */
export function reflexIntentFor(kind: WorkEventKind): IntentId | null {
  switch (kind) {
    case 'job.progress':
    case 'job.steered':
      return 'micro_status';
    case 'step.retry':
      return 'oops';
    case 'step.blocked':
      return 'blocked';
    case 'step.unblocked':
      return 'unblocked';
    case 'deliverable.accepted':
    case 'deliverable.accepted_edited':
    case 'decision.approved':
    case 'project.done':
      return 'celebrate';
    default:
      return null;
  }
}

/** What the WorkspaceDO knows about a member's view (socket op `viewer`, §2.5). */
export interface ViewerState {
  surface: Surface; stageAgentId: string | null; floorVisible: boolean; visibleProjectIds: readonly string[];
  listeningProjectIds: readonly string[]; audioArmed: boolean; voiceOn: boolean; pageVisible?: boolean;
}

export interface ServerReflexArgs {
  catalog: CompiledCatalog;
  gate: TimingGate;
  recency: RecencyMemory;
  index: AgentIndex;
  state: GroundingState;
  mood: Mood;
  intent: IntentId;
  ambience: Ambience;
  provider: TtsProvider;
  viewer: ViewerState;
  now: number;
  cause?: CauseRef;
  turnId?: string;
  /** Voice or text for owner-turn replies (phatic, deferral); 'none' for event reflexes. */
  exchange?: 'voice' | 'text' | 'none';
  manifest?: ClipManifest | null;
  quietHours?: boolean;
  approvalInProgress?: boolean;
  stopped?: boolean;
  audience?: ReflexSayData['audience'];
  /** The owner turn's sniffed cues (phatic replies, deferral): lines can require owner_praise, owner_tone:* … (E4). */
  cues?: AffectCues;
  /** This agent's topics the owner's text mentions (E19, `topicsFor`). */
  topics?: readonly string[];
  /**
   * Reflex-grade picks (acknowledge, thinking filler): only lines whose clip is already rendered, so the voice can start
   * at once (Inc 0.5, INC05-PLAN §3.8). Availability comes from `clips`, else from `manifest`; with neither, only Mock
   * and browser voices count as instant.
   */
  instantOnly?: boolean;
  /** Which clips exist (and their durations); forwarded to `selectLine`. Defaults to the manifest when `instantOnly` is set. */
  clips?: ClipAvailability;
}

/** Clip availability from a manifest: a clip is available when any of its lines lists it. */
export function manifestClips(manifest: ClipManifest): ClipAvailability {
  const byKey = new Map<string, { durationMs: number; pronunciationChecked?: boolean }>();
  for (const entry of Object.values(manifest.clips)) byKey.set(entry.clipKey, entry);
  return {
    has: (key) => byKey.has(key),
    durationMs: (key) => byKey.get(key)?.durationMs ?? null,
    pronunciationChecked: (key) => !!byKey.get(key)?.pronunciationChecked,
  };
}

const EVENT_INTENTS = new Set<IntentId>(['micro_status', 'oops', 'blocked', 'unblocked', 'celebrate']);

/**
 * Plan one server-picked reflex: stage check (event reflexes only reach a viewer at that agent's stage),
 * gate, per-agent probability, grounded selection, commit, recency, and the `reflex.say` frame with the
 * pre-voiced clip when the manifest has one (else a render request). Seeded by agent | intent | cause.
 */
export function planServerReflex(a: ServerReflexArgs): { ok: true; frame: ReflexSayData; utterance: Utterance; plan: ChannelPlan } | { ok: false; reason: string; face: FaceCue | null } {
  const agentId = a.index.agentId;
  const atStage = (a.viewer.surface === 'talk' || a.viewer.surface === 'desk') && a.viewer.stageAgentId === agentId;
  if (EVENT_INTENTS.has(a.intent) && !atStage) return { ok: false, reason: 'no_viewer', face: null };
  const cause = a.turnId ?? (a.cause ? `${a.cause.streamId}:${a.cause.seq}` : `${a.now}`);
  const seed = `${agentId}|${a.intent}|${cause}`;
  const input: GateInput = {
    agentId, intent: a.intent, now: a.now, ambience: a.ambience, surface: a.viewer.surface, ...(a.turnId ? { turnId: a.turnId } : {}),
    ownerSpeaking: false, agentVoiceBusy: false, foregroundAudio: false, ownerAtStage: atStage, audioArmed: a.viewer.audioArmed,
    voiceOn: a.viewer.voiceOn, listening: false, exchange: a.exchange ?? 'none', quietHours: !!a.quietHours || a.state.quietHours,
    reducedMotion: false, approvalInProgress: !!a.approvalInProgress, stopped: !!a.stopped, pageVisible: a.viewer.pageVisible ?? true,
  };
  const rng = seededRng(`${seed}|gate`);
  const verdict = a.gate.check(input, rng);
  if (!verdict.allow) return { ok: false, reason: verdict.reason, face: verdict.faceOnly };
  const p = reflexProbability(a.catalog, a.index, a.intent, a.ambience, a.mood);
  if (p < 1 && rng.next() >= p) return { ok: false, reason: 'probability', face: verdict.plan.face };
  const clipKeyOf = (lineId: string, fk: string) => a.manifest?.clips[`${lineId}|${fk}`]?.clipKey;
  const state: GroundingState = a.cues || a.topics?.length
    ? { ...a.state, exchange: { ...a.state.exchange, ...(a.cues ? { cues: a.cues } : {}), ...(a.topics?.length ? { topics: a.topics } : {}) } }
    : a.state;
  const clips = a.clips ?? (a.instantOnly && a.manifest ? manifestClips(a.manifest) : undefined);
  const res = selectLine(a.index, {
    intent: a.intent, state, mood: a.mood, ambience: a.ambience, provider: a.provider, seed, now: a.now,
    channel: verdict.plan.voice ? 'voice' : 'text', clipKeyOf,
    ...(a.instantOnly ? { instantOnly: true } : {}),
    ...(clips ? { clips } : {}),
  }, a.recency);
  if (!res.ok) return { ok: false, reason: res.reason, face: verdict.plan.face };
  const u = res.utterance;
  a.gate.commit(input, verdict.plan.voice ? u.estMs : 0);
  recordUtterance(a.recency, a.index, u, a.now, ownerDayKey(a.state));
  const target = u.split?.prefix ?? u;
  const entry = u.split ? null : a.manifest?.clips[`${target.lineId}|${target.fillKey}`];
  const audience = a.audience ?? (budgetClassFor(a.catalog.intents.get(a.intent)!, input) === 'chatter' ? 'floor' : 'owner');
  const frame = reflexSayData(u, verdict.plan, {
    audience,
    clip: entry ? { key: entry.clipKey, durationMs: entry.durationMs } : null,
    ...(a.turnId ? { turnId: a.turnId } : {}),
    ...(a.cause ? { cause: a.cause } : {}),
  });
  return { ok: true, frame, utterance: u, plan: verdict.plan };
}
