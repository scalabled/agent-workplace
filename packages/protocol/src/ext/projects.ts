// Inc 1 "Hire a team in a sentence": team projects staffed from catalog recipes, a reviewed plan the owner approves
// in the Inbox (a raised hand), parallel steps with review and one revision, and a written deliverable.

/**
 * planning: staffed, the lead is drafting the plan · proposed: waiting for the owner's approval · running · paused
 * (no new work starts; a step already under way finishes) · needs_review: the deliverable's check left issues the
 * owner decides on · done · partial: finished with some steps failed or skipped (never "done") · failed ·
 * cancelled (owner or Everyone stop).
 */
export type TeamProjectStatus = 'planning' | 'proposed' | 'running' | 'paused' | 'needs_review' | 'done' | 'partial' | 'failed' | 'cancelled';

/**
 * waiting (not started, or its inputs are not done) · working · reviewing · revising · asking (the lead asked the
 * owner a question; only this step waits) · needs_review (reviewers still want changes after the revision: the owner
 * decides) · done · failed · skipped (an input step failed).
 */
export type ProjectStepStatus = 'waiting' | 'working' | 'reviewing' | 'revising' | 'asking' | 'needs_review' | 'done' | 'failed' | 'skipped';

/** What the team delivers: a Markdown document, one self-contained HTML page or app, or one code file. */
export type DeliverableKind = 'document' | 'web' | 'code';

export type TeamRole = 'lead' | 'co_owner' | 'reviewer' | 'sceptic' | 'specialist' | 'facilitator';

export interface TeamMember {
  personaId: string;
  name: string;
  title: string;
  role: TeamRole;
  /** One sentence: why this person is on the team (from the recipe). */
  why: string;
  /**
   * Their TTS voice for this project, unique within the team and never the lead's (formation voice_assignment), so a
   * team meeting can always tell who is speaking. Resolved once at staffing.
   */
  voice?: {
    openai: string;
    xai: string;
    /**
     * Play the team through this provider: set when only it keeps everyone distinct (a team with more members of one
     * presentation than the other provider has voices, FORMATION §Voices rule 5).
     */
    prefer?: 'openai' | 'xai';
  };
}

export interface StepVerdict {
  approved: boolean;
  /** The reviewer's notes (a sentence or three). */
  notes: string;
  reviewerId: string;
}

export interface ProjectStep {
  id: string;
  title: string;
  brief: string;
  acceptance: string;
  /** The lead (the first owner). */
  ownerId: string;
  /** Co-owners: they help, review the lead's work, and take over a failed attempt. */
  coOwnerIds?: string[];
  reviewerIds: string[];
  dependsOn: string[];
  status: ProjectStepStatus;
  /** Who did the work when it was not the lead (a co-owner took over). */
  byId?: string;
  /** The latest round's verdicts (every reviewer's). */
  reviews?: StepVerdict[];
  attempts?: number;
  /** The lead's open question to the owner (status asking). */
  question?: { text: string; detail?: string };
  /** Markdown; clipped in frames (see OUTPUT_FRAME_MAX), full through GET /api/projects/:id. */
  output?: string;
  verdict?: StepVerdict;
  revised?: boolean;
  /** Pages the owner's team searched or read for this step (their evidence). */
  sources?: { url: string; title?: string }[];
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

/**
 * Direction from the owner after the plan was made ("focus on Instagram"): to the whole team (no `toId`) or to one
 * member (a quick chat at their desk). It reaches the work at the next step that starts (`queued` → `applied`), and
 * every later step of the addressee sees it; steps already under way are not interrupted.
 */
export interface ProjectNote {
  noteId: string;
  text: string;
  /** The member it was said to (persona id); absent: the whole team. */
  toId?: string;
  /** Where the owner said it: the project page, to the Chief of Staff, or at a coworker's desk. */
  via: 'page' | 'chief' | 'desk';
  status: 'queued' | 'applied';
  at: string;
  appliedAt?: string;
  /** The step that first picked it up. */
  appliedStepId?: string;
}

/**
 * A rough forecast for the plan card, from its shape (no prices: model rates come in Inc 5): rounds of work given the
 * dependencies and two steps at a time, model calls (work and review per step, a revision when asked, the
 * deliverable) and minutes on a reasoning model.
 */
export interface ProjectForecast {
  rounds: number;
  modelCalls: { min: number; max: number };
  minutes: { min: number; max: number };
}

export interface TeamProjectSnapshot {
  projectId: string;
  title: string;
  goal: string;
  /** The catalog recipe the team and plan came from (null: formed without a recipe). */
  recipeId: string | null;
  recipeName: string | null;
  /** The Chief of Staff's one-sentence staffing explanation. */
  staffingNote: string;
  team: TeamMember[];
  steps: ProjectStep[];
  status: TeamProjectStatus;
  /** The open plan-approval decision while proposed. */
  decisionId: string | null;
  forecast?: ProjectForecast;
  deliverableKind?: DeliverableKind;
  /** Who assembles the deliverable. */
  finisherId?: string;
  /** Code deliverables: the file name. */
  deliverableFilename?: string;
  /** The deliverable's check (QA) by a reviewer. */
  qa?: { approved: boolean; notes: string; reviewerId: string };
  /** Tokens (and dollars when every call was priced) spent so far, and the budget. */
  usage?: { input: number; output: number; usd: number | null; calls: number; budgetTokens: number };
  /** The owner's direction since the plan was made, oldest first. */
  notes?: ProjectNote[];
  /** Markdown deliverable when done (clipped in frames). */
  deliverable?: string;
  summary?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

/**
 * A raised hand in the Inbox. plan_approval: start the plan? · input: a lead's question (answer in words) · review:
 * reviewers still want changes (accept, or give direction) · deliverable: the check left issues (accept, or give
 * direction) · budget: the token budget is spent (raise it and continue?).
 */
export type DecisionKind = 'plan_approval' | 'input' | 'review' | 'deliverable' | 'budget';

export interface Decision {
  decisionId: string;
  kind: DecisionKind;
  projectId: string;
  /** The step it is about (input, review). */
  stepId?: string;
  /** Who is asking (persona id), when a coworker asks. */
  fromId?: string;
  title: string;
  /** What the owner is deciding, in one or two sentences. */
  body: string;
  status: 'open' | 'approved' | 'declined' | 'answered';
  /** The owner's words (an answer, or direction). */
  answer?: string;
  createdAt: string;
  resolvedAt?: string;
}

/** POST /api/decisions/:id — approve, decline, or answer in words (input, or direction for review/deliverable). */
export interface DecisionAnswer {
  action: 'approve' | 'decline' | 'answer';
  text?: string;
}
export const DECISION_ANSWER_MAX = 4000;

/** Owner edits of the plan (while proposed or paused). */
export interface StepEdit {
  title?: string;
  brief?: string;
  acceptance?: string;
  /** Owners, lead first (1–3). */
  ownerIds?: string[];
  reviewerIds?: string[];
  dependsOn?: string[];
}
export interface PlanEdit {
  deliverableKind?: DeliverableKind;
  finisherId?: string;
}

/** Frame payloads (frames.ts). Outputs and the deliverable are clipped to this many characters in frames. */
export const OUTPUT_FRAME_MAX = 1200;

export interface ProjectFrameData {
  project: TeamProjectSnapshot;
}
export interface DecisionFrameData {
  decision: Decision;
}

export interface ProjectsResponse {
  projects: TeamProjectSnapshot[];
  decisions: Decision[];
}
export type ProjectResponse = TeamProjectSnapshot;
export interface ProjectActionAccepted {
  accepted: true;
  project: TeamProjectSnapshot;
}
/** POST /api/projects/:id/note: direction for the team (or one member) that reaches the next step. */
export const PROJECT_NOTE_MAX = 1000;
export interface ProjectNoteRequest {
  text: string;
  toId?: string;
  opId?: string;
}

/**
 * A staffed coworker's part in their active projects (the desk quick chat reads it, so they can talk about their
 * live work truthfully).
 */
export interface StaffingContext {
  projectId: string;
  title: string;
  status: TeamProjectStatus;
  role: TeamRole;
  /** Steps they own and review, in plan order. */
  mine: { stepId: string; title: string; status: ProjectStepStatus; reviewing: boolean }[];
  stepsDone: number;
  stepsTotal: number;
  /** Their latest own output (clipped), reference for the chat. */
  latest?: string;
}

/** POST /api/stop-all ("Everyone stop"): every running job and team project halted; plans waiting for an OK stay. */
export interface StopAllResponse {
  stoppedJobs: number;
  stoppedProjects: number;
}
