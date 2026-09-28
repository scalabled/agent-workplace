import type { AgentTool, ToolOutcome } from '@headcount/agent-loop';
import type { JobSnapshot, SteerJobAccepted, CancelJobAccepted, TurnId } from '@headcount/protocol';
import { jobProgressPercent, type TalkRoute } from '@headcount/protocol/ext/worker-core';
import { clipText, isActive, statusSentence, titleFromRequest } from '../jobs/job-view';
import type { JobRefusal, StartJobRequest } from '../jobs/project-do';

/** The Everyday ProjectDO as the Chief of Staff's tools see it (RPC). */
export interface ProjectApi {
  startJob(req: StartJobRequest): Promise<JobSnapshot | JobRefusal>;
  listJobs(): Promise<JobSnapshot[]>;
  steerJob(jobId: string, text: string, opId?: string): Promise<SteerJobAccepted | JobRefusal>;
  cancelJob(jobId: string, reason?: string, by?: 'owner' | 'chief'): Promise<CancelJobAccepted | JobRefusal>;
}

/** What the tools did this turn: drives talk.done.route, talk.message.kind/jobId and the no-text fallback. */
export class TurnLog {
  readonly routes = new Set<TalkRoute>();
  readonly jobIds: string[] = [];
  readonly says: string[] = [];

  note(route: TalkRoute, say: string, jobId?: string): void {
    this.routes.add(route);
    if (jobId && !this.jobIds.includes(jobId)) this.jobIds.push(jobId);
    if (say) this.says.push(say);
  }

  /** delegate > steer > cancel > status > answer. */
  route(): TalkRoute {
    for (const r of ['delegate', 'steer', 'cancel', 'status'] as const) if (this.routes.has(r)) return r;
    return 'answer';
  }

  /** The single job this turn was about, if exactly one. */
  jobId(): string | undefined {
    return this.jobIds.length === 1 ? this.jobIds[0] : undefined;
  }
}

export interface ChiefToolDeps {
  project: ProjectApi;
  turnId: TurnId;
  /** Jobs as read at turn start (mock hints pick the newest active job). */
  jobs: JobSnapshot[];
  log: TurnLog;
  leadId: string | null;
  chiefName: string | null;
}

// Mock triggers (regex sources, case-insensitive) so the keyless Mock provider exercises every route.
const TRIGGERS = {
  cancel: [String.raw`\b(cancel|stop|abort|scrap|kill|halt)\b.{0,40}\b(job|research|task|work|that|it|this|everything)\b`, String.raw`^\s*(never ?mind|forget (it|that))\b`],
  steer: [String.raw`^\s*(also|and also|oh,? and|plus|additionally|one more thing)\b`, String.raw`\balso (check|look|include|add|cover|consider|compare|find)\b`, String.raw`\b(focus on|instead of|prioriti[sz]e)\b`],
  status: [
    String.raw`\bhow'?s (it|that|this|the \w+) going\b`,
    String.raw`\bhow is (it|that|this|the \w+) going\b`,
    String.raw`\bhow far\b`,
    String.raw`\b(status|progress)\b`,
    String.raw`\bany (news|update)`,
    String.raw`\bwhere are (we|you) (at|on|with)\b`,
    String.raw`\b(done|finished) yet\b`,
    String.raw`\bwhat have you found\b`,
  ],
  start: [String.raw`\b(look into|research|dig into|investigate|find out|look up|figure out|check out|compare|explore|put together|draft|prepare)\b`],
};

const ok = (payload: Record<string, unknown>, summary: string): ToolOutcome => ({ ok: true, content: JSON.stringify(payload), summary });
const fail = (error: string): ToolOutcome => ({ ok: false, error: JSON.stringify({ error, say: error }) });
const sayOf = (out: string): string => {
  try {
    const o = JSON.parse(out) as { say?: unknown; error?: unknown };
    return String(o.say ?? o.error ?? 'Done.');
  } catch {
    return out;
  }
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function compact(job: JobSnapshot): Record<string, unknown> {
  return {
    jobId: job.jobId,
    title: job.title,
    status: job.status,
    step: job.step,
    of: job.of,
    percent: jobProgressPercent(job),
    now: job.label,
    ...(job.partial ? { latestFinding: clipText(job.partial, 400) } : {}),
    pendingSteering: job.steers.filter((s) => s.status === 'queued').map((s) => s.text),
    appliedSteering: job.steers.filter((s) => s.status === 'applied').map((s) => s.text),
    ...(job.summary ? { summary: job.summary } : {}),
    ...(job.error ? { error: job.error.message } : {}),
  };
}

/** Pick the job the owner means: the given id if it is running, else the only running job. */
function pickActive(jobs: JobSnapshot[], jobId: string): JobSnapshot | { refused: string } {
  const active = jobs.filter(isActive);
  const exact = jobs.find((j) => j.jobId === jobId);
  if (exact) return isActive(exact) ? exact : { refused: `“${exact.title}” is not running any more (${exact.status}).` };
  if (active.length === 1) return active[0]!;
  if (!active.length) return { refused: 'No background job is running right now.' };
  return { refused: `Several jobs are running; say which one: ${active.map((j) => `${j.jobId} “${j.title}”`).join(', ')}.` };
}

/**
 * The Chief of Staff's Inc 0 tools (ARCHITECTURE §5.3 subset). Each returns at once: starting, steering
 * and cancelling are quick RPCs to the Everyday ProjectDO, and status is read from its live state.
 * Tool order matters for Mock (first matching trigger wins): cancel, steer, status, start.
 */
export function createChiefTools(deps: ChiefToolDeps): AgentTool<any>[] {
  const { project, log } = deps;
  const newestActive = deps.jobs.find(isActive);

  const startJob: AgentTool<{ title?: unknown; brief?: unknown }> = {
    spec: {
      name: 'start_background_job',
      description:
        'Start background work in the Everyday project: research, comparisons, drafts, anything that needs more than a quick answer. Returns at once; the work runs while you keep talking, and you will announce the result when it is done.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title, 2 to 6 words, e.g. "Office chairs under $500".' },
          brief: { type: 'string', description: "What to find out or produce, in the owner's words, with every constraint they gave." },
        },
        required: ['title', 'brief'],
        additionalProperties: false,
      },
      mock: { triggers: TRIGGERS.start, args: (text) => ({ title: titleFromRequest(text), brief: text }), reply: sayOf },
    },
    async execute(args, ctx) {
      const brief = str(args.brief);
      const title = str(args.title) || (brief ? titleFromRequest(brief) : '');
      if (!brief && !title) return fail('Give the job a title and a brief.');
      const job = await project.startJob({ title, brief: brief || title, opId: `${deps.turnId}:${ctx.callId}`, leadId: deps.leadId, chiefName: deps.chiefName });
      // Refused (too many running, or today's limit): say so honestly instead of promising work.
      if ('accepted' in job) return fail(job.message);
      const say = `On it. I started “${job.title}” in the background and will tell you when it is done. Keep talking to me meanwhile.`;
      log.note('delegate', say, job.jobId);
      return ok({ jobId: job.jobId, title: job.title, status: job.status, say }, `Started “${job.title}”`);
    },
  };

  const jobStatus: AgentTool<{ jobId?: unknown }> = {
    spec: {
      name: 'job_status',
      description: 'Read the live state of background jobs (step, percent, running sentence, latest finding, pending steering). Instant; never waits for the work.',
      parameters: { type: 'object', properties: { jobId: { type: 'string', description: 'A job id; omit for all recent jobs.' } }, additionalProperties: false },
      mock: { triggers: TRIGGERS.status, args: () => ({}), reply: sayOf },
    },
    async execute(args) {
      const jobs = await project.listJobs();
      const id = str(args.jobId);
      const picked = id ? jobs.filter((j) => j.jobId === id) : jobs.slice(0, 6);
      const say = statusSentence(id && picked.length ? picked : jobs);
      log.note('status', say, picked.length === 1 ? picked[0]!.jobId : picked.filter(isActive).length === 1 ? picked.find(isActive)!.jobId : undefined);
      return ok({ jobs: picked.map(compact), say }, 'Checked the work');
    },
  };

  const steerJob: AgentTool<{ jobId?: unknown; instruction?: unknown }> = {
    spec: {
      name: 'steer_job',
      description: "Redirect a running job: add something to check, change focus, add context. It is applied at the job's next checkpoint (between steps or tool calls); the job keeps running.",
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Id of the running job (from LIVE WORK STATE).' },
          instruction: { type: 'string', description: "The owner's steering, in their words." },
        },
        required: ['jobId', 'instruction'],
        additionalProperties: false,
      },
      mock: { triggers: TRIGGERS.steer, args: (text) => ({ jobId: newestActive?.jobId ?? '', instruction: text }), reply: sayOf },
    },
    async execute(args, ctx) {
      const instruction = str(args.instruction);
      if (!instruction) return fail('Say what the job should change.');
      const target = pickActive(await project.listJobs(), str(args.jobId));
      if ('refused' in target) return fail(target.refused);
      const r = await project.steerJob(target.jobId, instruction, `${deps.turnId}:${ctx.callId}`);
      if (!r.accepted) return fail(r.message);
      const say = `Got it. I will fold that into “${target.title}” at its next checkpoint.`;
      log.note('steer', say, target.jobId);
      return ok({ jobId: target.jobId, steerId: r.steerId, status: 'queued', say }, `Steered “${target.title}”`);
    },
  };

  const cancelJob: AgentTool<{ jobId?: unknown }> = {
    spec: {
      name: 'cancel_job',
      description: 'Stop a running job for good. Use only when the owner asks to stop or cancel it.',
      parameters: { type: 'object', properties: { jobId: { type: 'string', description: 'Id of the running job.' } }, required: ['jobId'], additionalProperties: false },
      mock: { triggers: TRIGGERS.cancel, args: () => ({ jobId: newestActive?.jobId ?? '' }), reply: sayOf },
    },
    async execute(args) {
      const target = pickActive(await project.listJobs(), str(args.jobId));
      if ('refused' in target) return fail(target.refused);
      const r = await project.cancelJob(target.jobId, 'The owner asked the Chief of Staff to stop it.', 'chief');
      if (!r.accepted) return fail(r.message);
      const say = `Stopped “${target.title}”. Nothing more will run on it.`;
      log.note('cancel', say, target.jobId);
      return ok({ jobId: target.jobId, status: 'cancelled', say }, `Stopped “${target.title}”`);
    },
  };

  // Steering and cancelling are offered only while something runs (fewer, clearer choices for the model).
  return newestActive ? [cancelJob, steerJob, jobStatus, startJob] : [jobStatus, startJob];
}
