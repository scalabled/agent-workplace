// Every face on screen that belongs to an agent, keyed by agent id, so a reflex cue or a mood bias reaches all
// of them (the Talk header, the Floor card, the bubble on other screens). `Face` registers its FaceView when it
// is given an `agentId`. A newly mounted face picks up the agent's current mood bias at once.
import type { ExpressionBias, FaceCue } from '@headcount/protocol/ext/expressions';

/** The two FaceView methods reflexes drive (§3.7). */
export interface CueableFace {
  cue(cue: FaceCue): void;
  setExpressionBias(bias: ExpressionBias | null): void;
}

const views = new Map<string, Set<CueableFace>>();
const biases = new Map<string, ExpressionBias>();
/** Until when each agent's reaction (a smile, a tilt, a wince) holds the face: a thinking look-up waits it out. */
const reactingUntil = new Map<string, number>();

const REACTION_GESTURES = new Set<FaceCue['gesture']>(['smile', 'head_tilt', 'wince']);
/** A reaction the owner should see: its own gesture, or a delighted or concerned expression. */
const isReaction = (c: FaceCue) => REACTION_GESTURES.has(c.gesture) || c.expression === 'delighted' || c.expression === 'concerned';
/** A "thinking" cue (the look-up on a new turn, a glance at the work) never covers a reaction still showing. */
const isThinking = (c: FaceCue) => c.gesture === 'look_up' || c.gesture === 'glance' || (c.gesture === 'none' && c.expression === 'thinking');

/** Face cues seen, newest last (tests and the dev hook). */
export const cueLog: { agentId: string; cue: FaceCue; at: number }[] = [];
const LOG_MAX = 200;

function each(agentId: string, fn: (v: CueableFace) => void): void {
  for (const v of views.get(agentId) ?? []) {
    try {
      fn(v);
    } catch (err) {
      console.warn('face cue failed', err);
    }
  }
}

export function registerFace(agentId: string, view: CueableFace): () => void {
  let set = views.get(agentId);
  if (!set) views.set(agentId, (set = new Set()));
  set.add(view);
  const bias = biases.get(agentId);
  if (bias) {
    try {
      view.setExpressionBias(bias);
    } catch {
      /* a face that cannot show a bias still shows everything else */
    }
  }
  return () => {
    set.delete(view);
    if (!set.size) views.delete(agentId);
  };
}

/** A reflex gesture on every face of this agent (the face port's cue). A reaction holds the face for its hold time. */
export function cueFace(agentId: string, cue: FaceCue): void {
  const now = Date.now();
  if (isThinking(cue) && (reactingUntil.get(agentId) ?? 0) > now) return;
  if (isReaction(cue)) reactingUntil.set(agentId, now + Math.max(0, cue.holdMs));
  cueLog.push({ agentId, cue, at: now });
  if (cueLog.length > LOG_MAX) cueLog.splice(0, cueLog.length - LOG_MAX);
  each(agentId, (v) => v.cue(cue));
}

/** The agent's mood on every face of theirs, now and on faces mounted later (the face port's bias). */
export function biasFace(agentId: string, bias: ExpressionBias | null): void {
  if (bias) biases.set(agentId, bias);
  else biases.delete(agentId);
  each(agentId, (v) => v.setExpressionBias(bias));
}

export function faceBias(agentId: string): ExpressionBias | null {
  return biases.get(agentId) ?? null;
}

export function faceCount(agentId: string): number {
  return views.get(agentId)?.size ?? 0;
}

/** Tests: forget every face and bias. */
export function resetFaces(): void {
  views.clear();
  biases.clear();
  reactingUntil.clear();
  cueLog.length = 0;
}
