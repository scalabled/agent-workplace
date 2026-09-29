// Grounding (LIVING-WORKFORCE §3.4, H1): the live state a reflex line may speak from. Every value comes from the
// store (jobs, the thread, side-threads) or the clock; anything unknown stays null, so a line that needs it is
// never picked. The owner's first name comes from the optional `ownerName` setting (Office Phase 2), else null.
import type { GroundingState } from '@headcount/expressions';
import { CHIEF_ID, type JobSnapshot } from '@headcount/protocol';
import type { ThreadItem } from '../store';

/** Owner-local quiet hours until the interruption-budget settings exist (INC05-PLAN §9): see ./quiet. */
export { isQuietHours, QUIET_FROM_HOUR, QUIET_UNTIL_HOUR } from './quiet';
/** Away this long before Talk opens with a hello (§3.4 greeting). */
export const RETURNING_AFTER_MS = 3 * 60 * 60_000;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function clockOf(now: number): GroundingState['now'] {
  const d = new Date(now);
  return { epochMs: now, localHour: d.getHours(), weekday: d.getDay() };
}

/** First meeting, back after a break, first visit today: from the owner's own messages to this agent. */
function historyOf(ownerMessages: readonly ThreadItem[], now: number): Pick<GroundingState['history'], 'firstMeeting' | 'returning' | 'newDay'> {
  const times = ownerMessages.map((m) => Date.parse(m.ts)).filter((t) => Number.isFinite(t) && t <= now);
  if (!times.length) return { firstMeeting: ownerMessages.length === 0, returning: false, newDay: false };
  const last = Math.max(...times);
  return { firstMeeting: false, returning: now - last >= RETURNING_AFTER_MS, newDay: dayKey(new Date(last)) !== dayKey(new Date(now)) };
}

const accepted = (m: ThreadItem) => m.from === 'owner' && m.status === undefined;
const running = (j: JobSnapshot) => j.status === 'running' || j.status === 'queued';

/** The job the Chief of Staff is on right now: the most recently moved running one. */
export function currentJob(jobs: readonly JobSnapshot[]): JobSnapshot | null {
  const live = jobs.filter((j) => running(j) && j.agentId === CHIEF_ID);
  const order = (j: JobSnapshot) => (j.status === 'running' ? 1 : 0);
  return [...live].sort((a, b) => order(b) - order(a) || (b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0))[0] ?? null;
}

export interface ChiefGroundingInput {
  now: number;
  chiefName: string;
  jobs: readonly JobSnapshot[];
  /** The Talk thread (owner and Chief messages). */
  thread: readonly ThreadItem[];
  quietHours: boolean;
  /** Onboarding's greeting was spoken in this session: no second hello (§3.4). */
  greetedThisSession: boolean;
  /** The owner's first name (settings.ownerName), when set. */
  ownerFirstName?: string | null;
}

/**
 * The Chief of Staff: `working` while a job runs (line content only; the face keeps its D2 "available" state), the
 * running sentence as the activity, and progress as done = step − 1 of `of`.
 */
export function chiefGrounding(i: ChiefGroundingInput): GroundingState {
  const job = currentJob(i.jobs);
  // Never a first meeting: Talk always opens with the lead's own introduction, so a second "Hi, I'm …" is out (as on
  // the server). Back after a break and a new day still count.
  const history = i.greetedThisSession ? { firstMeeting: false, returning: false, newDay: false } : { ...historyOf(i.thread.filter(accepted), i.now), firstMeeting: false };
  const today = dayKey(new Date(i.now));
  const wins = i.jobs.filter((j) => j.agentId === CHIEF_ID && j.status === 'done' && j.finishedAt).map((j) => Date.parse(j.finishedAt!)).filter((t) => Number.isFinite(t) && t <= i.now);
  const work: GroundingState['work'] | undefined = job
    ? { ...(job.label ? { stepLabel: job.label } : {}), ...(job.step >= 1 ? { done: job.step - 1 } : {}), total: job.of }
    : undefined;
  return {
    now: clockOf(i.now),
    owner: { firstName: i.ownerFirstName ?? null },
    chiefName: i.chiefName || null,
    self: { agentId: CHIEF_ID, firstName: i.chiefName, presence: job ? 'working' : 'idle', blocked: false, staffed: true, activity: job?.label || null, role: 'chief' },
    ...(work ? { work } : {}),
    history: {
      ...history,
      lastWinAt: wins.length ? Math.max(...wins) : null,
      lastUnblockedAt: null,
      winsToday: wins.filter((t) => dayKey(new Date(t)) === today).length,
      distressThisSession: false,
    },
    exchange: { mode: 'none', interrupted: false, steerQueued: false, ownerFarewell: false, ownerGreeting: false, ownError: false },
    quietHours: i.quietHours,
  };
}

export interface CoworkerGroundingInput {
  now: number;
  agentId: string;
  firstName: string;
  chiefName: string;
  /** This coworker's Floor quick-chat. */
  sideThread: readonly ThreadItem[];
  quietHours: boolean;
  /** The owner's first name (settings.ownerName), when set. */
  ownerFirstName?: string | null;
}

/** A Directory coworker in Inc 0.5: on no team, no work, idle. Their lines never claim or promise work (H2). */
export function coworkerGrounding(i: CoworkerGroundingInput): GroundingState {
  return {
    now: clockOf(i.now),
    owner: { firstName: i.ownerFirstName ?? null },
    chiefName: i.chiefName || null,
    self: { agentId: i.agentId, firstName: i.firstName, presence: 'idle', blocked: false, staffed: false, activity: null, role: null },
    history: {
      ...historyOf(i.sideThread.filter(accepted), i.now),
      lastWinAt: null,
      lastUnblockedAt: null,
      winsToday: 0,
      distressThisSession: false,
    },
    exchange: { mode: 'none', interrupted: false, steerQueued: false, ownerFarewell: false, ownerGreeting: false, ownError: false },
    quietHours: i.quietHours,
  };
}
