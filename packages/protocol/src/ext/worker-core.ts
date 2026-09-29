// Additive protocol helpers from worker-core (WorkspaceDO / Everyday ProjectDO). Import as
// `@headcount/protocol/ext/worker-core`. Nothing here changes a core contract.
import type { JobSnapshot } from '../api';

/**
 * Progress of a job in percent, from its 1-based checkpoint `step` (the one in progress) and total `of`:
 * checkpoints before `step` are complete. Done jobs are 100; unplanned jobs (`of` null) are 0.
 */
export function jobProgressPercent(job: Pick<JobSnapshot, 'status' | 'step' | 'of'>): number {
  if (job.status === 'done') return 100;
  if (!job.of || job.of <= 0) return 0;
  return Math.max(0, Math.min(99, Math.round(((job.step - 1) / job.of) * 100)));
}

/**
 * What a Chief of Staff turn did; carried in `talk.done.route` (ARCHITECTURE §5.2, Inc 0 subset).
 * `reflex` (Inc 0.5): a phatic turn ("thanks", "bye") answered from the expression catalog without a model call.
 */
export type TalkRoute = 'answer' | 'delegate' | 'status' | 'steer' | 'cancel' | 'reflex' | 'project';

/** The Chief of Staff's tools in Inc 0 (names are stable; the web may show them as chips). */
export const CHIEF_TOOL_NAMES = ['start_background_job', 'job_status', 'steer_job', 'cancel_job', 'start_team_project', 'approve_team_project', 'team_project_status', 'cancel_team_project', 'steer_team_project', 'pause_team_project', 'stop_all_work'] as const;
export type ChiefToolName = (typeof CHIEF_TOOL_NAMES)[number];

/**
 * Socket paging: after `ready`, the server replays at most WS_REPLAY_LIMIT frames. When the last replayed
 * seq is still below `ready.lastSeq`, the client sends `{op: 'resume', since: <last applied seq>}` for the
 * next page. When `ready.lastSeq` is below the client's cursor, the server state was reset: the client
 * drops local state and reconnects with since=0. Returns what the client should do after `ready` + replay.
 */
export function feedCatchUp(readyLastSeq: number, clientLastSeq: number): 'live' | 'resume' | 'reset' {
  if (readyLastSeq < clientLastSeq) return 'reset';
  return clientLastSeq < readyLastSeq ? 'resume' : 'live';
}
