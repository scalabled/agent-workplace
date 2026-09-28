// Ephemeral protocol frames of the living-workforce layer (§10.4): builders that hosts use to emit
// `reflex.say`, `reflex.face`, `sidetalk.line`, `mood.changed` and `attention.changed`.
import type { PresenceState } from '@headcount/protocol';
import { expressionBias, moodAt } from './mood';
import { sideTalkText } from './sidetalk';
import type {
  AttentionChangedData, AttentionView, CauseRef, ChannelPlan, ExpressionBias, ExpressionFrame, FaceCue, MoodChangedData,
  MoodState, ReflexFaceData, ReflexSayData, SideTalkLineData, SideTalkLinePlan, SideTalkProposal, Utterance,
} from './types';

export const EXPRESSION_FRAME_TYPES = ['reflex.say', 'reflex.face', 'sidetalk.line', 'mood.changed', 'attention.changed'] as const;

/** Public URL of a clip (§11.3 `exprClip`). */
export const clipUrl = (key: string): string => `/api/expr/clips/${encodeURIComponent(key)}`;
/** Public URL of a clip's alignment (§11.3 `exprAlign`). */
export const clipAlignmentUrl = (key: string): string => `${clipUrl(key)}/align`;

export function isExpressionFrame(x: unknown): x is ExpressionFrame {
  const t = (x as { type?: unknown } | null)?.type;
  return typeof t === 'string' && (EXPRESSION_FRAME_TYPES as readonly string[]).includes(t) && typeof (x as { data?: unknown }).data === 'object';
}

/** `reflex.say` data for a server-picked utterance (phatic reply, deferral, event reflex). */
export function reflexSayData(
  u: Utterance, plan: ChannelPlan,
  opts: {
    audience: ReflexSayData['audience']; clip?: { key: string; durationMs: number; alignment?: boolean } | null;
    threadId?: string; turnId?: string; gen?: number; cause?: CauseRef;
  },
): ReflexSayData {
  const clip = opts.clip
    ? { key: opts.clip.key, url: clipUrl(opts.clip.key), durationMs: opts.clip.durationMs, alignmentUrl: opts.clip.alignment === false ? null : clipAlignmentUrl(opts.clip.key) }
    : null;
  return {
    agentId: u.agentId,
    intent: u.intent,
    lineId: u.lineId,
    fillKey: u.fillKey,
    caption: u.caption,
    ...(u.gloss ? { gloss: u.gloss } : {}),
    clip,
    render: clip ? null : { lineId: u.lineId, fills: { ...u.fills } },
    channels: { voice: plan.voice, bubble: plan.bubble, caption: plan.caption },
    face: plan.face ?? u.face,
    gainDb: plan.gainDb,
    priority: plan.priority,
    ttlMs: plan.ttlMs,
    audience: opts.audience,
    ...(opts.threadId ? { threadId: opts.threadId } : {}),
    ...(opts.turnId ? { turnId: opts.turnId } : {}),
    ...(opts.gen !== undefined ? { gen: opts.gen } : {}),
    ...(opts.cause ? { cause: opts.cause } : {}),
  };
}

export function reflexFaceData(agentId: string, cue: FaceCue, cause?: CauseRef): ReflexFaceData {
  return { agentId, cue: { ...cue }, ...(cause ? { cause } : {}) };
}

/** `sidetalk.line` data for one planned line of a proposal (§8.3). `expiresAt` is ISO. */
export function sideTalkLineData(
  proposal: SideTalkProposal, line: SideTalkLinePlan,
  opts: { voice: SideTalkLineData['voice']; clip?: { key: string; durationMs: number } | null; replyable?: boolean },
): SideTalkLineData {
  const { text, opener } = sideTalkText(line);
  return {
    threadId: proposal.threadId,
    index: line.index,
    projectId: proposal.projectId,
    agentId: line.agentId,
    toAgentId: line.toAgentId,
    intent: line.intent,
    lineId: line.utterance.lineId,
    text,
    opener,
    gist: line.gist,
    clip: opts.clip ? { key: opts.clip.key, url: clipUrl(opts.clip.key), durationMs: opts.clip.durationMs } : null,
    voice: opts.voice,
    atMs: line.atMs,
    expiresAt: new Date(proposal.expiresAt).toISOString(),
    replyable: opts.replyable ?? true,
    cause: proposal.cause,
  };
}

/** `mood.changed` data at `now` (decayed), with the face bias for the agent's presence. */
export function moodChangedData(s: MoodState, now: number, presence: PresenceState, opts?: { reducedMotion?: boolean; bias?: ExpressionBias }): MoodChangedData | null {
  if (!s.lastKind) return null;
  const m = moodAt(s, now);
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    agentId: s.agentId,
    valence: round(m.valence),
    energy: round(m.energy),
    at: now,
    baseline: { ...s.baseline },
    bias: opts?.bias ?? expressionBias(m, presence, { reducedMotion: opts?.reducedMotion ?? false }),
    reason: s.lastKind,
    ...(s.lastCause ? { cause: s.lastCause } : {}),
  };
}

/** `attention.changed` data for a merged view (§2.2). */
export function attentionChangedData(view: AttentionView): AttentionChangedData {
  const brief = (t: NonNullable<AttentionView['focus']>) => ({ threadId: t.id, kind: t.kind, label: t.label });
  return {
    agentId: view.agentId,
    focus: view.focus ? brief(view.focus) : null,
    background: view.background.map(brief),
    voiceBusyUntil: view.voiceBusyUntil === null ? null : new Date(view.voiceBusyUntil).toISOString(),
    floorHeld: [view.focus, ...view.background].some((t) => !!t?.floorHeld),
  };
}
