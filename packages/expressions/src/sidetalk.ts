// Side-talk (§8.3): brief coworker-to-coworker banter derived only from real events (H3). The ProjectDO
// proposes a thread of 1–3 lines; the WorkspaceDO gates it (Ambience, viewers, budget) and broadcasts.
import { seededRng } from './hash';
import { num } from './internal';
import { lineOf, selectLine } from './select';
import { sanitizeGist } from './state';
import type { GroundingState, SideTalkContext, SideTalkEvent, SideTalkLinePlan, SideTalkProposal } from './types';
import type { IntentId } from './vocab';

interface Step { speaker: string; to: string; intent: IntentId; replyTo?: IntentId; opener: boolean }

/** Which lines an event can produce, in order (opener first). Events without the evidence produce nothing. */
function stepsFor(ev: SideTalkEvent): Step[] | null {
  const { from, to } = ev;
  if (!from || !to || from === to) return null;
  switch (ev.kind) {
    case 'handoff':
      return [
        { speaker: from, to, intent: 'handoff_give', opener: true },
        { speaker: to, to: from, intent: 'handoff_take', replyTo: 'handoff_give', opener: false },
      ];
    case 'ask':
      return [{ speaker: from, to, intent: 'ask_coworker', opener: true }];
    case 'ask.answered':
      return [
        { speaker: from, to, intent: 'answer_coworker', opener: true },
        { speaker: to, to: from, intent: 'sidetalk_reply', replyTo: 'answer_coworker', opener: false },
      ];
    case 'job.done':
      if (!ev.artifact) return null; // only with an artifact on the cause event (H2)
      return [
        { speaker: from, to, intent: 'share_result', opener: true },
        { speaker: to, to: from, intent: 'sidetalk_reply', replyTo: 'share_result', opener: false },
      ];
    case 'verdict': {
      if (!ev.verdict) return null;
      const intent: IntentId = ev.verdict === 'approve' ? 'review_approve' : 'review_changes';
      return [
        { speaker: from, to, intent, opener: true },
        { speaker: to, to: from, intent: 'sidetalk_reply', replyTo: intent, opener: false },
      ];
    }
    case 'project.done':
      return [
        { speaker: from, to, intent: 'celebrate', opener: true },
        { speaker: to, to: from, intent: 'sidetalk_reply', replyTo: 'celebrate', opener: false },
        { speaker: from, to, intent: 'sidetalk_reply', replyTo: 'celebrate', opener: false },
      ];
    default:
      return null;
  }
}

/** Events whose own note becomes the bubble's gist (the opener's words come from the pack). */
const GIST_EVENTS = new Set<SideTalkEvent['kind']>(['handoff', 'ask', 'ask.answered', 'job.done']);

function groundFor(base: GroundingState, other: GroundingState | null, step: Step, ev: SideTalkEvent, gist: string | null): GroundingState {
  const work = { ...(base.work ?? {}) };
  if (ev.artifact) work.artifact = ev.artifact;
  else delete work.artifact; // artifacts come from the cause event only
  const state: GroundingState = {
    ...base,
    owner: { firstName: null }, // side-talk never names the owner (H4)
    work,
    replyTo: step.replyTo,
  };
  if (other) state.counterpart = { agentId: step.to, firstName: other.self.firstName };
  else delete state.counterpart;
  if (ev.kind === 'verdict' && ev.verdict) state.review = { verdict: ev.verdict, findingCount: num(ev.findingCount, 0) };
  if (step.opener && gist) state.gist = gist;
  else delete state.gist;
  if (!step.replyTo) delete state.replyTo;
  return state;
}

/**
 * Propose a side-talk thread for a real event, or null. Checks visibility (team only), the Ambience's
 * side-talk switch, the pod gap and the opener's per-agent gap; replies stop the chain when their speaker
 * is inside its own gap or has nothing grounded to say. Seeded by the event's `stream:seq`, so replay
 * regenerates the same thread.
 */
export function proposeSideTalk(ev: SideTalkEvent, ctx: SideTalkContext): SideTalkProposal | null {
  if (ev.visibility !== 'team') return null; // whispers and owner-only events never surface (H3)
  const profile = ctx.catalog.ambience[ctx.ambience];
  if (!profile?.sidetalk.enabled) return null;
  const steps = stepsFor(ev);
  if (!steps?.length) return null;
  const lastPod = ctx.lastPodLineAt(ev.projectId);
  if (lastPod !== null && ctx.now - lastPod < profile.sidetalk.pod_gap_ms) return null;
  const agentGapOk = (agentId: string) => {
    const last = ctx.lastAgentLineAt(agentId);
    return last === null || ctx.now - last >= profile.sidetalk.agent_gap_ms;
  };
  if (!agentGapOk(steps[0]!.speaker)) return null;

  const cause = `${ev.cause.streamId}:${ev.cause.seq}`;
  const threadId = `st_${cause}`;
  const rng = seededRng(threadId);
  const gist = GIST_EVENTS.has(ev.kind) && ev.gist ? sanitizeGist(ev.gist) : null;
  const maxChain = Math.max(1, Math.floor(profile.sidetalk.max_chain));
  const lines: SideTalkLinePlan[] = [];
  // Pod dedupe (E7): what anyone on this pod said recently, and what this thread already said, is avoided, so two
  // teammates never tell the same joke back to back.
  const avoid = new Set<number>();
  const dedupeMs = num(ctx.catalog.defaults.sidetalk_text_dedupe_ms, 30 * 60_000);
  for (const a of ctx.podAgents?.(ev.projectId) ?? []) {
    for (const e of ctx.recency.recent(a)) {
      if (ctx.now - e.at > dedupeMs) break;
      avoid.add(e.textHash);
    }
  }
  let t = 0;
  for (let i = 0; i < Math.min(steps.length, maxChain); i++) {
    const step = steps[i]!;
    if (i > 0 && step.speaker !== steps[0]!.speaker && !agentGapOk(step.speaker)) break;
    const index = ctx.index(step.speaker);
    const base = ctx.state(step.speaker);
    if (!index || !base) {
      if (i === 0) return null;
      break;
    }
    const state = groundFor(base, ctx.state(step.to), step, ev, gist);
    const res = selectLine(index, {
      intent: step.intent,
      state,
      mood: ctx.mood(step.speaker),
      ambience: ctx.ambience,
      provider: ctx.provider,
      seed: `${step.speaker}|${step.intent}|${cause}`,
      now: ctx.now,
      channel: 'voice',
      ...(avoid.size ? { avoidTextHashes: avoid } : {}),
    }, ctx.recency);
    if (!res.ok) {
      if (i === 0) return null;
      break;
    }
    const picked = lineOf(index, res.utterance.lineId);
    if (picked) avoid.add(picked.textHash);
    const def = ctx.catalog.intents.get(step.intent)!;
    const [lo, hi] = def.timing.delay_ms;
    const delay = lo + rng.next() * Math.max(0, hi - lo);
    t = i === 0 ? delay : t + lines[i - 1]!.utterance.estMs + delay;
    lines.push({
      index: i,
      agentId: step.speaker,
      toAgentId: step.to,
      intent: step.intent,
      utterance: res.utterance,
      gist: step.opener ? gist : null,
      atMs: Math.round(t),
    });
  }
  if (!lines.length) return null;
  const last = lines[lines.length - 1]!;
  const ttl = num(ctx.catalog.intents.get(last.intent)?.timing.ttl_ms, 5000);
  return { threadId, projectId: ev.projectId, cause: ev.cause, lines, expiresAt: ctx.now + last.atMs + last.utterance.estMs + ttl };
}

/** The bubble text for a side-talk line: "{opener} {gist}" unless the line already carries the gist (§8.3). */
export function sideTalkText(line: SideTalkLinePlan): { text: string; opener: string } {
  const u = line.utterance;
  if (u.fills.gist !== undefined) return { text: u.caption, opener: u.split?.prefix.caption ?? u.caption };
  if (line.gist) {
    // "Pax, it's yours —" + "Competitor grid, …" reads as one sentence: lower-case a plain first word.
    const gist = /[—–,:]$/.test(u.caption) && /^[A-Z][a-z'’-]+(\s|$|,)/.test(line.gist) ? line.gist[0]!.toLowerCase() + line.gist.slice(1) : line.gist;
    return { text: `${u.caption} ${gist}`.replace(/\s{2,}/g, ' ').trim(), opener: u.caption };
  }
  return { text: u.caption, opener: u.caption };
}
