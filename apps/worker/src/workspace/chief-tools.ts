import type { AgentTool, ToolOutcome } from '@headcount/agent-loop';
import type { JobSnapshot, SteerJobAccepted, CancelJobAccepted, TurnId } from '@headcount/protocol';
import { jobProgressPercent, type TalkRoute } from '@headcount/protocol/ext/worker-core';
import { clipText, isActive, statusSentence, titleFromRequest } from '../jobs/job-view';
import type { JobRefusal, StartJobRequest } from '../jobs/project-do';
import type { Decision, DecisionAnswer, ProjectNote, StopAllResponse, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import type { ProjectRefusal, ProposeRequest } from '../projects/team-host';

/** The Everyday ProjectDO as the Chief of Staff's tools see it (RPC). */
export interface ProjectApi {
  startJob(req: StartJobRequest): Promise<JobSnapshot | JobRefusal>;
  listJobs(): Promise<JobSnapshot[]>;
  steerJob(jobId: string, text: string, opId?: string): Promise<SteerJobAccepted | JobRefusal>;
  cancelJob(jobId: string, reason?: string, by?: 'owner' | 'chief'): Promise<CancelJobAccepted | JobRefusal>;
  // Inc 1 team projects.
  proposeProject(req: ProposeRequest): Promise<{ project: TeamProjectSnapshot; decision: Decision | null } | ProjectRefusal>;
  approveProject(projectId: string): Promise<{ accepted: true; project: TeamProjectSnapshot } | ProjectRefusal>;
  cancelProject(projectId: string, reason?: string): Promise<{ accepted: true; project: TeamProjectSnapshot } | ProjectRefusal>;
  activeProjects(): Promise<TeamProjectSnapshot[]>;
  stopAll(by?: 'owner' | 'chief'): Promise<StopAllResponse>;
  openDecisions(): Promise<Decision[]>;
  discuss(projectId: string, question: string, rounds?: number, kind?: 'discussion' | 'review'): Promise<{ accepted: true; project: TeamProjectSnapshot; meetingId?: string } | ProjectRefusal>;
  answerDecision(decisionId: string, a: DecisionAnswer): Promise<{ accepted: true; decision: Decision; project: TeamProjectSnapshot } | ProjectRefusal>;
  noteProject(projectId: string, req: { text: string; toId?: string; via: ProjectNote['via']; opId?: string }): Promise<{ accepted: true; project: TeamProjectSnapshot; note: ProjectNote } | ProjectRefusal>;
  pauseProject(projectId: string): Promise<{ accepted: true; project: TeamProjectSnapshot } | ProjectRefusal>;
  resumeProject(projectId: string): Promise<{ accepted: true; project: TeamProjectSnapshot } | ProjectRefusal>;
}

/** What the tools did this turn: drives talk.done.route, talk.message.kind/jobId and the no-text fallback. */
export class TurnLog {
  readonly routes = new Set<TalkRoute>();
  readonly jobIds: string[] = [];
  readonly projectIds: string[] = [];
  readonly says: string[] = [];

  note(route: TalkRoute, say: string, jobId?: string): void {
    this.routes.add(route);
    if (jobId && !this.jobIds.includes(jobId)) this.jobIds.push(jobId);
    if (say) this.says.push(say);
  }

  /** project > delegate > steer > cancel > status > answer. */
  route(): TalkRoute {
    for (const r of ['project', 'delegate', 'steer', 'cancel', 'status'] as const) if (this.routes.has(r)) return r;
    return 'answer';
  }

  /** The single job this turn was about, if exactly one. */
  jobId(): string | undefined {
    return this.jobIds.length === 1 ? this.jobIds[0] : undefined;
  }

  /** A team project this turn staffed, started, stopped or reported on (Inc 1: Talk links the reply to it). */
  aboutProject(projectId: string): void {
    if (!this.projectIds.includes(projectId)) this.projectIds.push(projectId);
  }

  /** The single team project this turn was about, if exactly one. */
  projectId(): string | undefined {
    return this.projectIds.length === 1 ? this.projectIds[0] : undefined;
  }
}

export interface ChiefToolDeps {
  project: ProjectApi;
  turnId: TurnId;
  /** Jobs as read at turn start (mock hints pick the newest active job). */
  jobs: JobSnapshot[];
  /** Proposed and running team projects at turn start (Inc 1). */
  projects?: TeamProjectSnapshot[];
  /** Open raised hands at turn start (a lead's question the owner may answer in Talk). */
  decisions?: Decision[];
  log: TurnLog;
  leadId: string | null;
  chiefName: string | null;
  /** Called once a job really started (Inc 0.5: the office plays an acknowledgement for the turn). */
  onDelegated?: (jobId: string) => void;
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
  project: [
    String.raw`\b(staff|assemble|spin up|put together|hire|pull together|get) (a |me a |the )?(team|crew|squad)\b`,
    String.raw`\b(team|crew) (to|for|on)\b`,
    // A bare topic word is not an ask ("tell me about the launch"): only an imperative to run one staffs a team.
    String.raw`^\s*(please |can you |could you )?(plan|run|organi[sz]e|build|create|make|handle|work on|kick off)\b.{0,40}\b(launch|campaign|go-to-market|rebrand|hiring plan|business plan|marketing plan|pitch deck)\b`,
  ],
  pause: [String.raw`\b(pause|hold off on|put .{0,30}\bon hold)\b`, String.raw`\b(resume|unpause|pick .{0,30}\bback up|carry on with)\b`],
  stopAll: [String.raw`^\s*(everyone|everybody|all of you|team|folks)[,!.]?\s+stop\b`, String.raw`\bstop (all|everything|all (the )?work)\b`, String.raw`^\s*(halt|freeze) everything\b`],
  approve: [String.raw`^\s*(yes|yep|yeah|sure|ok(ay)?|go ahead|go for it|approved?|do it|start it|ship it|let'?s (go|do it)|sounds good)\b`],
};

function compactProject(p: TeamProjectSnapshot): Record<string, unknown> {
  const done = p.steps.filter((s) => s.status === 'done').length;
  const now = p.steps.filter((s) => s.status === 'working' || s.status === 'reviewing' || s.status === 'revising');
  return {
    projectId: p.projectId,
    title: p.title,
    status: p.status,
    team: p.team.map((m) => `${m.name} (${m.role.replace('_', '-')})`),
    stepsDone: `${done} of ${p.steps.length}`,
    now: now.map((s) => `${s.title}: ${s.status}`),
    ...(p.summary ? { summary: p.summary } : {}),
    ...(p.error ? { error: p.error } : {}),
  };
}

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
      try {
        deps.onDelegated?.(job.jobId);
      } catch {
        /* a reflex must never break the tool */
      }
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

  // ── Inc 1 team projects ─────────────────────────────────────────────────────────
  const projects = deps.projects ?? [];
  const proposed = projects.filter((p) => p.status === 'proposed');
  const newestProject = projects[projects.length - 1];

  const startProject: AgentTool<{ goal?: unknown; title?: unknown }> = {
    spec: {
      name: 'start_team_project',
      description:
        'Staff a team of specialist coworkers for a multi-step outcome that needs several disciplines (a launch, a campaign, a proposal, a hiring pack, a plan). A playbook picks the team (a lead, reviewers and a sceptic) and a plan of reviewed steps; the plan goes to the owner as a raised hand in the Inbox and starts only once they approve. For a quick lookup or a single draft use start_background_job instead.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: "The outcome the team should deliver, in the owner's words, with every constraint they gave." },
          title: { type: 'string', description: 'A short project title, 3 to 7 words.' },
        },
        required: ['goal'],
        additionalProperties: false,
      },
      mock: { triggers: TRIGGERS.project, args: (text) => ({ goal: text, title: '' }), reply: sayOf },
    },
    async execute(args, ctx) {
      const goal = str(args.goal);
      if (!goal) return fail('Say what the team should deliver.');
      const r = await project.proposeProject({ goal, title: str(args.title) || undefined, opId: `${deps.turnId}:${ctx.callId}`, chiefName: deps.chiefName ?? 'your Chief of Staff', leadId: deps.leadId });
      if ('accepted' in r) return fail(r.message);
      const p = r.project;
      const leadName = (p.team.find((m) => m.role === 'lead') ?? p.team[0])?.name.split(' ')[0] ?? 'The lead';
      const say =
        p.status === 'planning'
          ? `I've staffed it. ${p.staffingNote} ${leadName} is drafting the plan now; it will be in your Inbox in a moment. Approve it there, or just tell me to go ahead.`
          : `I've staffed it. ${p.staffingNote} The plan has ${p.steps.length} steps, each reviewed before it counts. It's waiting in your Inbox: approve it there, or just tell me to go ahead.`;
      log.note('project', say);
      log.aboutProject(p.projectId);
      return ok({ projectId: p.projectId, title: p.title, status: p.status, team: p.team.map((m) => `${m.name}, ${m.title} (${m.role})`), steps: p.steps.map((s) => s.title), say }, `Staffed “${p.title}”`);
    },
  };

  const approveProject: AgentTool<{ projectId?: unknown }> = {
    spec: {
      name: 'approve_team_project',
      description: "Approve a proposed team project's plan so the team starts working. Use ONLY when the owner's latest message clearly approves it (\"go ahead\", \"approved\", \"yes, start it\"). Never approve on your own initiative.",
      parameters: { type: 'object', properties: { projectId: { type: 'string', description: 'Id of the proposed project (from LIVE TEAM PROJECTS).' } }, required: ['projectId'], additionalProperties: false },
      mock: { triggers: TRIGGERS.approve, args: () => ({ projectId: proposed[proposed.length - 1]?.projectId ?? '' }), reply: sayOf },
    },
    async execute(args) {
      const id = str(args.projectId) || (proposed.length === 1 ? proposed[0]!.projectId : '');
      if (!id) return fail(proposed.length ? `Several plans are waiting; say which: ${proposed.map((p) => `“${p.title}”`).join(', ')}.` : 'No plan is waiting for approval.');
      const r = await project.approveProject(id);
      if ('accepted' in r && !r.accepted) return fail(r.message);
      const p = (r as { project: TeamProjectSnapshot }).project;
      const say = `Approved. The team is starting on “${p.title}” now; I'll tell you when it's done, and you can drop by anyone's desk meanwhile.`;
      log.note('project', say);
      log.aboutProject(p.projectId);
      return ok({ projectId: p.projectId, status: p.status, say }, `Approved “${p.title}”`);
    },
  };

  const projectStatus: AgentTool<Record<string, never>> = {
    spec: {
      name: 'team_project_status',
      description: 'Read the live state of team projects: who is on them, which steps are done, what is being worked on or reviewed now. Instant.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      mock: { triggers: [String.raw`\b(team|project)\b.{0,30}\b(status|going|progress|update)\b`], args: () => ({}), reply: sayOf },
    },
    async execute() {
      const list = await project.activeProjects();
      const say = list.length
        ? list.map((p) => { const c = compactProject(p); return `“${p.title}”: ${p.status}, ${c.stepsDone} steps done${(c.now as string[]).length ? ` (now: ${(c.now as string[]).join('; ')})` : ''}.`; }).join(' ')
        : 'No team project is running right now.';
      log.note('status', say);
      if (list.length === 1) log.aboutProject(list[0]!.projectId);
      return ok({ projects: list.map(compactProject), say }, 'Checked the team projects');
    },
  };

  const cancelProject: AgentTool<{ projectId?: unknown }> = {
    spec: {
      name: 'cancel_team_project',
      description: 'Stop a team project (or decline a proposed plan). Use only when the owner asks to stop, cancel or not do it.',
      parameters: { type: 'object', properties: { projectId: { type: 'string', description: 'Id of the project.' } }, required: ['projectId'], additionalProperties: false },
      mock: { triggers: [String.raw`\b(cancel|stop|scrap|drop)\b.{0,20}\b(project|team|plan)\b`], args: () => ({ projectId: newestProject?.projectId ?? '' }), reply: sayOf },
    },
    async execute(args) {
      const id = str(args.projectId) || (projects.length === 1 ? projects[0]!.projectId : '');
      if (!id) return fail('Say which project to stop.');
      const r = await project.cancelProject(id, 'The owner asked the Chief of Staff to stop it.');
      if ('accepted' in r && !r.accepted) return fail(r.message);
      const p = (r as { project: TeamProjectSnapshot }).project;
      const say = `Stopped “${p.title}”. The team has put it down.`;
      log.note('cancel', say);
      log.aboutProject(p.projectId);
      return ok({ projectId: p.projectId, status: p.status, say }, `Stopped “${p.title}”`);
    },
  };

  const underWay = projects.filter((p) => p.status === 'running' || p.status === 'paused');
  /** The project the owner means: the given id, else the only one under way. */
  const pickProject = (id: string): TeamProjectSnapshot | { refused: string } => {
    const exact = projects.find((p) => p.projectId === id);
    if (exact) return exact;
    if (underWay.length === 1) return underWay[0]!;
    if (!underWay.length) return { refused: 'No team project is running right now.' };
    return { refused: `Several team projects are under way; say which: ${underWay.map((p) => `${p.projectId} “${p.title}”`).join(', ')}.` };
  };

  const steerProject: AgentTool<{ projectId?: unknown; instruction?: unknown; toPersonaId?: unknown }> = {
    spec: {
      name: 'steer_team_project',
      description:
        "Give a running team project direction or context from the owner (\"focus on Instagram\", \"the budget is now $2k\"). It reaches the next step that starts; steps already under way finish as they are and nobody stops. Pass toPersonaId to direct it at one member only.",
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Id of the project (from LIVE TEAM PROJECTS).' },
          instruction: { type: 'string', description: "The owner's direction, in their words." },
          toPersonaId: { type: 'string', description: 'Optional: the persona id of the one member it is for.' },
        },
        required: ['projectId', 'instruction'],
        additionalProperties: false,
      },
      mock: { triggers: TRIGGERS.steer, args: (text) => ({ projectId: underWay[underWay.length - 1]?.projectId ?? '', instruction: text }), reply: sayOf },
    },
    async execute(args, ctx) {
      const instruction = str(args.instruction);
      if (!instruction) return fail('Say what the team should change.');
      const target = pickProject(str(args.projectId));
      if ('refused' in target) return fail(target.refused);
      const toId = str(args.toPersonaId);
      const r = await project.noteProject(target.projectId, { text: instruction, via: 'chief', opId: `${deps.turnId}:${ctx.callId}`, ...(toId ? { toId } : {}) });
      if (!r.accepted) return fail(r.message);
      const to = toId ? target.team.find((m) => m.personaId === toId)?.name.split(' ')[0] : null;
      const say = `Passed on to ${to ?? 'the team'}. It shapes the next step of “${target.title}”; nothing already under way is thrown away.`;
      log.note('steer', say);
      log.aboutProject(target.projectId);
      return ok({ projectId: target.projectId, noteId: r.note.noteId, status: 'queued', say }, `Steered “${target.title}”`);
    },
  };

  const pauseProject: AgentTool<{ projectId?: unknown; action?: unknown }> = {
    spec: {
      name: 'pause_team_project',
      description: 'Pause a running team project (steps under way finish, nothing new starts) or resume a paused one. Use when the owner asks to pause, hold, resume or carry on.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Id of the project.' },
          action: { type: 'string', enum: ['pause', 'resume'] },
        },
        required: ['projectId', 'action'],
        additionalProperties: false,
      },
      mock: { triggers: TRIGGERS.pause, args: (text) => ({ projectId: underWay[underWay.length - 1]?.projectId ?? '', action: /\b(resume|unpause|back up|carry on)\b/i.test(text) ? 'resume' : 'pause' }), reply: sayOf },
    },
    async execute(args) {
      const target = pickProject(str(args.projectId));
      if ('refused' in target) return fail(target.refused);
      const resume = str(args.action) === 'resume';
      const r = resume ? await project.resumeProject(target.projectId) : await project.pauseProject(target.projectId);
      if (!r.accepted) return fail(r.message);
      const say = resume ? `“${target.title}” is back on; the team picks up where they left off.` : `“${target.title}” is paused. Anyone mid-step finishes, then the team waits for you.`;
      log.note('status', say);
      log.aboutProject(target.projectId);
      return ok({ projectId: target.projectId, status: r.project.status, say }, resume ? `Resumed “${target.title}”` : `Paused “${target.title}”`);
    },
  };

  const questions = (deps.decisions ?? []).filter((d) => d.kind === 'input' || d.kind === 'review' || d.kind === 'deliverable');
  const answerHand: AgentTool<{ decisionId?: unknown; answer?: unknown; accept?: unknown }> = {
    spec: {
      name: 'answer_team_question',
      description:
        "Relay the owner's answer to a team member's open question (or their direction on review issues) from OPEN QUESTIONS. Use only when the owner's latest message clearly answers it. accept=true accepts review issues as they are.",
      parameters: {
        type: 'object',
        properties: {
          decisionId: { type: 'string', description: 'Id from OPEN QUESTIONS' },
          answer: { type: 'string', description: "The owner's answer or direction, in their words" },
          accept: { type: 'boolean', description: 'Accept the remaining review issues as they are (review and deliverable hands only)' },
        },
        required: ['decisionId'],
        additionalProperties: false,
      },
      mock: { triggers: [String.raw`^\s*(answer|tell (them|the team)|my answer)\b`], args: (text) => ({ decisionId: questions[0]?.decisionId ?? '', answer: text }), reply: sayOf },
    },
    async execute(args) {
      const id = str(args.decisionId) || (questions.length === 1 ? questions[0]!.decisionId : '');
      const d = questions.find((q) => q.decisionId === id);
      if (!d) return fail(questions.length ? `Say which question: ${questions.map((q) => `${q.decisionId} “${q.title}”`).join(', ')}.` : 'No team member is waiting on the owner.');
      const answer = str(args.answer);
      const accept = args.accept === true;
      if (!accept && !answer) return fail('Say what to tell them.');
      const r = await project.answerDecision(d.decisionId, accept ? { action: 'approve' } : { action: 'answer', text: answer });
      if (!r.accepted) return fail(r.message);
      const say = accept ? 'Done: they will take it as it is.' : 'Passed on. They pick it up right away.';
      log.note('steer', say);
      log.aboutProject(d.projectId);
      return ok({ decisionId: d.decisionId, status: r.decision.status, say }, `Answered “${clipText(d.title, 60)}”`);
    },
  };

  const discussable = projects.filter((p) => ['proposed', 'running', 'paused', 'needs_review'].includes(p.status));
  const teamDiscussion: AgentTool<{ projectId?: unknown; question?: unknown; kind?: unknown }> = {
    spec: {
      name: 'team_discussion',
      description:
        'Call a project team meeting the owner asked for: a discussion of their question, or a review of the work so far (you open it, the lead chairs, each member speaks, the lead sums up and the summary guides their next steps). It starts in a minute or two; the owner can listen in and take the floor from the project page.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          question: { type: 'string', description: "The question, in the owner's words (a review may leave it empty)" },
          kind: { type: 'string', enum: ['discussion', 'review'], description: 'review: the team reviews the work so far' },
        },
        required: ['projectId'],
        additionalProperties: false,
      },
      mock: { triggers: [String.raw`\b(discuss|debate|talk (it|this) (over|through))\b`], args: (text) => ({ projectId: discussable[discussable.length - 1]?.projectId ?? '', question: text }), reply: sayOf },
    },
    async execute(args) {
      const id = str(args.projectId) || (discussable.length === 1 ? discussable[0]!.projectId : '');
      const p = discussable.find((x) => x.projectId === id);
      if (!p) return fail(discussable.length ? `Say which project: ${discussable.map((x) => `${x.projectId} “${x.title}”`).join(', ')}.` : 'No team project is under way.');
      const question = str(args.question);
      const review = str(args.kind) === 'review';
      if (!question && !review) return fail('Say what they should discuss.');
      const r = await project.discuss(p.projectId, question, undefined, review ? 'review' : 'discussion');
      if (!r.accepted) return fail(r.message);
      const say = review
        ? `The “${p.title}” team is meeting to review the work so far. You can listen in from the project page.`
        : `I've put it to the “${p.title}” team. They'll meet on it shortly (you can listen in from the project page), and the outcome guides their next steps.`;
      log.note('steer', say);
      log.aboutProject(p.projectId);
      return ok({ projectId: p.projectId, say }, `Put a question to “${p.title}”`);
    },
  };

  const stopAll: AgentTool<Record<string, never>> = {
    spec: {
      name: 'stop_all_work',
      description: 'Everyone stop: halt every running background job and team project at once. Use only when the owner asks for all work to stop ("everyone stop", "stop everything"). Plans waiting for approval stay in the Inbox.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      mock: { triggers: TRIGGERS.stopAll, args: () => ({}), reply: sayOf },
    },
    async execute() {
      const r = await project.stopAll('chief');
      const parts = [r.stoppedProjects ? `${r.stoppedProjects} team project${r.stoppedProjects === 1 ? '' : 's'}` : '', r.stoppedJobs ? `${r.stoppedJobs} background job${r.stoppedJobs === 1 ? '' : 's'}` : ''].filter(Boolean);
      const say = parts.length ? `Everyone has stopped: ${parts.join(' and ')} put down. Nothing else will run until you ask.` : 'Nothing was running, so there was nothing to stop.';
      log.note('cancel', say);
      return ok({ ...r, say }, 'Stopped all work');
    },
  };

  // Steering and cancelling are offered only while something runs (fewer, clearer choices for the model). Mock takes
  // the first tool whose trigger matches: project-specific tools come before the generic job tools.
  const running = !!newestActive || underWay.length > 0;
  const projectTools: AgentTool<any>[] = [
    ...(questions.length ? [answerHand] : []),
    ...(running ? [stopAll] : []),
    ...(discussable.length ? [teamDiscussion] : []),
    ...(underWay.length ? [pauseProject, steerProject] : []),
    ...(projects.length ? [cancelProject, projectStatus] : []),
    ...(proposed.length ? [approveProject] : []),
    startProject,
  ];
  return newestActive ? [...projectTools, cancelJob, steerJob, jobStatus, startJob] : [...projectTools, jobStatus, startJob];
}
