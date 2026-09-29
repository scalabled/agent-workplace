// Automations (biz-bot parity, stage 3b: worker/src/runtime/triggers.js): work that starts by itself — on a schedule,
// or when a public page changes — as a background job or a team project. What the owner hears afterwards is gated:
// after every run, only when it matters, or never (the history is on the Automations page either way).

export type AutomationKind = 'schedule' | 'page';
export type PageCondition = 'changed' | 'contains' | 'not_contains' | 'below' | 'above';
export const PAGE_CONDITIONS: readonly PageCondition[] = ['changed', 'contains', 'not_contains', 'below', 'above'];
/** A background job (one piece of research or drafting), or a team project planned from the goal. */
export type AutomationAction = 'job' | 'project';
/** When the Chief of Staff tells the owner: after every run, only when it matters, never. */
export type AutomationGate = 'on' | 'quiet' | 'off';

/** biz-bot MIN_AUTOMATION_MINUTES: nothing runs or checks more often. */
export const MIN_AUTOMATION_MINUTES = 15;
export const MAX_AUTOMATIONS = 20;
export const AUTOMATION_GOAL_MAX = 4000;

export interface AutomationSpec {
  name: string;
  kind: AutomationKind;
  /** schedule: every N minutes (≥ 15), or daily at HH:MM (UTC). */
  schedule?: { everyMinutes?: number; dailyAt?: string };
  /**
   * page: a public https page, an optional regular expression whose first group is the value to watch, the condition,
   * its value (text or a number), and how often to look (minutes, ≥ 15; default 60).
   */
  page?: { url: string; extract?: string; condition: PageCondition; value?: string; everyMinutes?: number };
  action: {
    type: AutomationAction;
    /** What each run should do (the trigger's context is added). */
    goal: string;
    /** Team projects: start the plan without waiting for the owner's OK (default true). */
    autoStart?: boolean;
  };
  gate: AutomationGate;
  enabled?: boolean;
}

export interface AutomationRun {
  runId: string;
  runKind: AutomationAction;
  firedAt: string;
  /** Why it ran ("Scheduled run", "The page changed: 42 (was 40)"). */
  context: string;
  /** started · done · partial · failed · cancelled · refused (it could not start) */
  status: string;
  finishedAt?: string;
  /** The owner was told (the gate let it through). */
  notified?: boolean;
  why?: string;
}

export interface AutomationView extends AutomationSpec {
  automationId: string;
  enabled: boolean;
  createdBy: 'owner' | 'chief';
  createdAt: string;
  updatedAt: string;
  /** One line: "Every day at 09:00 UTC → a background job". */
  describe: string;
  nextAt?: string;
  lastCheckedAt?: string;
  lastFiredAt?: string;
  /** Page watchers: the value last seen (or a fingerprint of the page). */
  lastValue?: string;
  lastResult?: string;
  lastError?: string;
  runs: number;
  history: AutomationRun[];
}

export interface AutomationsResponse {
  automations: AutomationView[];
}

export interface AutomationResponse {
  automation: AutomationView;
}

/** PUT /api/automations/:id: any part of the spec. */
export type AutomationPatch = Partial<AutomationSpec>;

/** Frame data: an automation started a run. Persisted. */
export interface AutomationFiredData {
  automationId: string;
  name: string;
  runId: string;
  runKind: AutomationAction;
  context: string;
}

/** Frame data: an automation's run ended; `notify` says whether the gate lets the Chief tell the owner. Persisted. */
export interface AutomationResultData {
  automationId: string;
  name: string;
  runId: string;
  runKind: AutomationAction;
  status: string;
  notify: boolean;
  why: string;
  /** What the Chief says when it tells the owner. */
  text: string;
}
