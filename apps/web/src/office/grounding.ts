// Grounded small talk (OFFICE-PHASE2 §4.5.8, D5 "anything that mentions real work must be grounded in a real event"):
// the only real events in Inc 0.7 are the Chief's finished jobs. Each becomes a team-visible `job.done` event spoken of
// as "the write-up" (never its title, summary or result: those are the owner's words), citing the job.done frame's seq.
// The article reads naturally in every template ("Congrats on the write-up", "The write-up is done"); the huddle engine
// drops it after a possessive ("Eddie's write-up").
// A job whose frame this page never saw has no seq and is skipped. No events → grounded exchanges never play.
import type { HuddleEvent } from '@headcount/expressions';
import { CHIEF_ID, type JobSnapshot } from '@headcount/protocol';
import type { DoneEvent } from '../living/events';

/** How small talk names a finished job (never its title). */
export const GROUNDED_ARTIFACT = 'the write-up';

/** A finished job is small-talk news for this long. */
export const GROUNDED_MAX_AGE_MS = 8 * 3_600_000;

export function groundingEvents(input: { jobs: Readonly<Record<string, JobSnapshot>>; seqs: ReadonlyMap<string, DoneEvent>; workspaceId: string | null | undefined; now: number }): HuddleEvent[] {
  if (!input.workspaceId) return [];
  const out: HuddleEvent[] = [];
  for (const j of Object.values(input.jobs)) {
    if (j.status !== 'done' || (j.agentId && j.agentId !== CHIEF_ID)) continue;
    const at = Date.parse(j.finishedAt ?? '');
    if (!Number.isFinite(at) || at > input.now + 60_000 || input.now - at > GROUNDED_MAX_AGE_MS) continue;
    const seen = input.seqs.get(j.jobId);
    if (!seen) continue;
    out.push({ kind: 'job.done', agentIds: [CHIEF_ID], at, visibility: 'team', cause: { streamId: `ws:${input.workspaceId}`, seq: seen.seq }, artifact: GROUNDED_ARTIFACT });
  }
  return out.sort((a, b) => b.at - a.at);
}
