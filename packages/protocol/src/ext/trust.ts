// Inc 6 · trust and real actions (PRODUCT §9, ARCHITECTURE §6.6–6.9): the autonomy dial per kind of action, grants the
// owner gives when approving, real actions (an email) that happen exactly once with a receipt, the audit trail with
// Undo, and Everyone stop holding what has not gone out yet.

import { BRAND } from '../brand';
/** Kinds of action an agent can take, from harmless to consequential. */
export type ActionClass = 'research' | 'workspace' | 'app_write' | 'external_send' | 'publish' | 'spend' | 'identity';

/**
 * How much a kind of action needs the owner (PRODUCT §9.2). ask: they check with you before starting · propose: they
 * prepare it and wait for your OK · act_report: they do it and it shows in Talk and the audit log (with Undo where
 * possible) · act_quiet: they do it; it is only in the audit log.
 */
export type Autonomy = 'ask' | 'propose' | 'act_report' | 'act_quiet';

/**
 * How far an approval reaches (PRODUCT §9.3). once: this action · task: the rest of this piece of work (one project
 * step, or one conversation turn) · project: the rest of this project · day: the next 24 hours. Standing grants come
 * later (they must name their bounds).
 */
export type GrantKind = 'once' | 'task' | 'project' | 'day';

export interface ActionClassInfo {
  id: ActionClass;
  label: string;
  /** What falls under it, in plain words. */
  hint: string;
  default: Autonomy;
  /** The levels an owner may choose (the ceiling; never beyond it). Empty: not adjustable. */
  allowed: Autonomy[];
  /** The grants an approval may give (fixing the old card that offered kinds the capability refused). */
  grants: GrantKind[];
  /** Nothing uses it yet: shown as a note, with no control. */
  unavailable?: string;
  /** Not adjustable, and why. */
  fixed?: string;
}

export const ACTION_CLASSES: readonly ActionClassInfo[] = [
  {
    id: 'external_send',
    label: 'Sending email',
    hint: 'Emails to customers, suppliers or anyone outside the business.',
    default: 'ask',
    allowed: ['ask', 'propose'],
    grants: ['once', 'task', 'project', 'day'],
  },
  {
    id: 'app_write',
    label: 'Changes in connected apps',
    hint: 'Writing to a connected app: a CRM note, a task, a page. Reading never needs you.',
    default: 'propose',
    allowed: ['ask', 'propose', 'act_report'],
    grants: ['once'],
  },
  {
    id: 'workspace',
    label: `Changes inside ${BRAND.name}`,
    hint: 'The Handbook and what they remember. Every change is in the audit log with Undo.',
    default: 'act_report',
    allowed: ['propose', 'act_report'],
    grants: ['once'],
  },
  {
    id: 'research',
    label: 'Research and drafts',
    hint: 'Searching, reading pages, analysis and drafts. Nothing leaves the office.',
    default: 'act_report',
    allowed: [],
    grants: [],
    fixed: 'They just do it: nothing leaves the office.',
  },
  {
    id: 'identity',
    label: 'People and access',
    hint: 'Inviting people, changing roles, sign-in.',
    default: 'ask',
    allowed: [],
    grants: [],
    fixed: 'Only an owner can do this, on the Admin page. Agents cannot.',
  },
  {
    id: 'publish',
    label: 'Publishing',
    hint: 'Posting to social media or a website.',
    default: 'propose',
    allowed: [],
    grants: [],
    unavailable: 'No coworker can publish yet.',
  },
  {
    id: 'spend',
    label: 'Spending money',
    hint: 'Orders, refunds, ads.',
    default: 'ask',
    allowed: [],
    grants: [],
    unavailable: 'No coworker can spend money.',
  },
];

export const AUTONOMY_WORDS: Record<Autonomy, { label: string; line: string }> = {
  ask: { label: 'Ask first', line: 'They check with you before they start.' },
  propose: { label: 'Propose', line: 'They prepare it and wait for your OK.' },
  act_report: { label: 'Act and tell me', line: 'They do it and tell you, with Undo where possible.' },
  act_quiet: { label: 'Act quietly', line: 'They do it; it is only in the audit log.' },
};

export const GRANT_WORDS: Record<GrantKind, string> = {
  once: 'Just this once',
  task: 'For the rest of this task',
  project: 'For the rest of this project',
  day: 'For the next 24 hours',
};

export function classInfo(id: ActionClass): ActionClassInfo {
  return ACTION_CLASSES.find((c) => c.id === id)!;
}

export type AutonomyPolicy = Record<ActionClass, Autonomy>;

export function defaultPolicy(): AutonomyPolicy {
  return Object.fromEntries(ACTION_CLASSES.map((c) => [c.id, c.default])) as AutonomyPolicy;
}

/** Does this level hold the action for the owner's OK? */
export function needsOk(level: Autonomy): boolean {
  return level === 'ask' || level === 'propose';
}

/** An owner's approval that reaches past one action. */
export interface Grant {
  grantId: string;
  actionClass: ActionClass;
  /** The tool it covers (e.g. 'email.send'). */
  tool: string;
  kind: GrantKind;
  /** Who may use it: an agent id, or '*' for anyone. */
  subject: string;
  /** kind 'task': the piece of work (a project step's run, or a conversation turn). */
  taskId?: string;
  /** kind 'task' or 'project': the project it belongs to. Never matches outside it. */
  projectId?: string;
  /** kind 'day'. */
  expiresAt?: string;
  createdAt: string;
  createdBy: string;
  uses: number;
  usedAt?: string;
  /** What it was given for, in words. */
  note?: string;
}

// ── email ─────────────────────────────────────────────────────────────────────────

export const EMAIL_RECIPIENTS_MAX = 10;
export const EMAIL_SUBJECT_MAX = 200;
export const EMAIL_BODY_MAX = 20_000;

export interface EmailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  /** Plain text. A disclosure line is added when it is sent. */
  text: string;
  replyTo?: string;
}

/** none: email is off · sink: a test mailbox inside Headcount (nothing leaves) · resend: real email through Resend. */
export type MailProvider = 'none' | 'sink' | 'resend';

export interface EmailStatus {
  provider: MailProvider;
  /** The sender, e.g. "Rosa at Harbor Café <office@harborcafe.com>". */
  from: string | null;
  /** Coworkers are offered email only when it can work. */
  ready: boolean;
  /** Why it is not ready, in words. */
  why?: string;
}

// ── effects and receipts ──────────────────────────────────────────────────────────

/**
 * awaiting: held for the owner's OK · pending: going out now (recorded before any I/O) · done: sent, with a receipt ·
 * declined: the owner said no · failed: the provider refused it (nothing went out) · unknown: it may or may not have
 * gone out (a crash, then no way to check); the owner decides · held: Everyone stop is on.
 */
export type EffectStatus = 'awaiting' | 'pending' | 'done' | 'declined' | 'failed' | 'unknown' | 'held';

/** Proof that an action happened (PRODUCT §9.6). Only a receipt lets anyone say "sent". */
export interface Receipt {
  receiptId: string;
  /** The effect key: the same intended action always has the same key. */
  key: string;
  action: string;
  /** Who it went to. */
  target: string;
  /** SHA-256 of what was sent. */
  payloadHash: string;
  /** "owner:<who>" for a one-off OK, "grant:<id>" for a grant. */
  approvedBy: string;
  at: string;
  provider: MailProvider;
  /** The provider's id for it. */
  providerId: string;
  /** How to undo it, or why it cannot be undone. */
  undo: string;
}

export interface EffectView {
  key: string;
  tool: 'email.send';
  actionClass: ActionClass;
  status: EffectStatus;
  /** Who asked for it (an agent id). */
  agentId: string;
  projectId?: string;
  stepId?: string;
  email: EmailMessage;
  decisionId?: string;
  receipt?: Receipt;
  /** Why it failed, or what is unknown. */
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** A decision asking to send (kind 'effect'): the emails waiting, and how far an approval may reach. */
export interface EffectAsk {
  keys: string[];
  emails: { key: string; to: string[]; cc?: string[]; subject: string; text: string }[];
  allowedGrants: GrantKind[];
  /** A crash left these uncertain: approving sends them again. */
  unknown?: boolean;
}

/** A decision asking to change something inside Headcount (kind 'change'): a coworker's instructions, a Handbook section. */
export interface ChangeAsk {
  change: 'instructions' | 'handbook';
  /** The coworker (instructions) or the Handbook section id. */
  target: string;
  targetLabel: string;
  before: string;
  after: string;
  why: string;
}

// ── Everyone stop ─────────────────────────────────────────────────────────────────

export interface StopState {
  at: string;
  by: string;
}

// ── the audit trail ───────────────────────────────────────────────────────────────

export type AuditKind = 'email' | 'decision' | 'grant' | 'change' | 'autonomy' | 'stop' | 'app' | 'undo';

export interface AuditEntry {
  auditId: string;
  at: string;
  /** Who did it: an agent id, "owner:<email>", or "system". */
  actor: string;
  kind: AuditKind;
  /** e.g. 'email.sent', 'grant.created', 'handbook.updated', 'autonomy.changed'. */
  action: string;
  summary: string;
  target?: string;
  /** Where it is in the app. */
  link?: string;
  receipt?: Receipt;
  /** Undo: possible (with what it does), done (when, by whom), or impossible (why). */
  undo?: { can: boolean; label: string; undoneAt?: string; undoneBy?: string };
}

export interface AuditResponse {
  entries: AuditEntry[];
  /** Pass as `before` for older entries. */
  next?: string;
}

export interface TrustResponse {
  policy: AutonomyPolicy;
  classes: readonly ActionClassInfo[];
  grants: Grant[];
  email: EmailStatus;
  stopped: StopState | null;
  /** Emails waiting, held or uncertain. */
  effects: EffectView[];
}

export interface PutAutonomyRequest {
  actionClass: ActionClass;
  level: Autonomy;
}

export interface TestMailbox {
  messages: { key: string; to: string[]; cc?: string[]; from: string; subject: string; text: string; at: string }[];
}

/** The frame an effect's change rides on (`effect.updated`). */
export interface EffectFrameData {
  effect: EffectView;
}

/** Everyone stop turned on or off (`trust.updated`). */
export interface TrustFrameData {
  stopped: StopState | null;
}
