import { callBudget, runTurn, type TurnResult } from '@headcount/agent-loop';
import { fullIndex, catalogFull } from '@headcount/catalog/full';
import { REACT_HINT_MAX_CHARS, humourOnly, maybeReactHintPrefix, parseReactHint, type AffectCues } from '@headcount/expressions';
import { MissingProviderError, type ChatMessage, type ReasoningEffort, type Registry } from '@headcount/models';
import { CHIEF_ID, ids, ownerFirstNameOf, type AgentId, type Frame, type JobId, type JobSnapshot, type MessageId, type OpId, type TalkFinish, type TurnId, type UsageSummary, type WorkspaceSettings } from '@headcount/protocol';
import type { ExprIntentId, ReactHint, TalkSurface } from '@headcount/protocol/ext/expressions';
import { buildChiefSystemPrompt, honestyPolicyText } from './chief-prompt';
import { hostsSearch } from '../tools/web-search';
import type { ConnectorAsk } from '@headcount/protocol/ext/connectors';
import type { ConnectorCallRequest, ConnectorCallResult, ConnectorKit } from '../connectors/store';
import { connectorTools } from '../connectors/tools';
import { automationTool, type ProposeOutcome } from '../automations/chief-tool';
import type { AutomationSpec } from '@headcount/protocol/ext/automations';
import { TurnLog, createChiefTools, type ProjectApi } from './chief-tools';
import type { Decision, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import type { Feed } from './feed';
import type { Ledger } from './ledger';
import { logError } from './runtime';

/** Recent conversation the Chief of Staff sees (ARCHITECTURE §4.3 layer 7: recent turns, ~6k tokens). */
export const HISTORY_MESSAGES = 40;
export const HISTORY_CHARS = 24_000;
/** Conversation turns are short; the talk loop is the fast tier (D2). */
export const TALK_MAX_STEPS = 4;
/** Visible output per call; reasoning models get room to think on top (`callBudget`), so a reply is never all thinking. */
export const TALK_MAX_TOKENS = 900;
/** Replies are short and must start fast (D2): think briefly. */
export const TALK_EFFORT: ReasoningEffort = 'low';

/** Where a turn's reflexes hook in (Inc 0.5, src/expr/host.ts): the filler safety net and acknowledgements. */
export interface TurnReflexHooks {
  /** The model turn started (arms the thinking-filler safety net unless the owner's cues rule it out). */
  started(turnId: TurnId, via: 'voice' | 'text', cues?: AffectCues): void;
  /** A server reflex (a filler, an acknowledgement) was already sent for this turn. */
  spoke?(turnId: TurnId): boolean;
  /** The first text delta was streamed (the filler is no longer needed). */
  firstText(turnId: TurnId): void;
  /** `start_background_job` succeeded in this turn. */
  delegated(turnId: TurnId, jobId: string): void;
  /** The turn is over (persisted or cut). */
  ended(turnId: TurnId): void;
}

export interface TalkHost {
  feed: Feed;
  ledger: Ledger;
  registry(): Registry;
  project(): ProjectApi;
  settings(): Promise<WorkspaceSettings>;
  /** False once a newer owner message has taken over (then this turn must not reset presence). */
  isCurrent(turnId: TurnId): boolean;
  now(): number;
  /** Reflex hooks (optional: tests and older hosts run without them). */
  reflexes?: TurnReflexHooks;
  /** False when the owner turned web tools off (WEB_TOOLS=off). */
  webTools?: boolean;
  /** The Chief sets up automations the owner asks for; each waits on a card for the owner's OK (stage 3b). */
  automations?: { propose(spec: Partial<AutomationSpec>, signal: AbortSignal): Promise<ProposeOutcome> };
  /** The connectors the Chief may use, their calls, and the wait for the owner's OK (Stage 5). */
  connectors?: {
    kits(): ConnectorKit[];
    call(req: ConnectorCallRequest): Promise<ConnectorCallResult>;
    wait(ask: ConnectorAsk, signal: AbortSignal): Promise<'approved' | 'declined' | 'pending'>;
  };
}

export interface TurnSpec {
  turnId: TurnId;
  /** Seq of the owner's talk.owner frame (presence cause). */
  ownerSeq: number;
  opId: OpId;
  signal: AbortSignal;
  /** How the owner sent it (the filler safety net waits 1.2 s in voice, 2.5 s in text). */
  via?: 'voice' | 'text';
  /** The owner's words as the reflex layer read them: what the office already said aloud before this reply. */
  cues?: AffectCues;
}

/** An offer of more work at the end of a reply ("Want me to…?"). */
const OFFER_RE = /\b(want me to|should i|shall i|would you like me to|do you want me to|i can also)\b[^.?!]*\?/i;

/**
 * What the reflex layer already said aloud for this turn, as a note for the model (so it never laughs or
 * acknowledges a second time), plus conversation-shape reminders drawn from the owner's cues and recent replies.
 */
export function turnNoteFor(cues: AffectCues | undefined, recentReplies: readonly string[]): string {
  const notes: string[] = [];
  if (cues?.sincereAi) notes.push('The owner is sincerely asking what you are: say plainly, first, that you are an AI.');
  else if (cues?.distress) notes.push('The owner shared something hard. Answer with care first, briefly: no jokes, no cheerfulness, and no offer of work unless they ask.');
  else if (cues && humourOnly(cues)) notes.push('The owner is joking, and the office already laughed or smiled aloud for you. Answer the joke in one short, light line: no laugh or "Ha" of your own, no steering back to work, no offer.');
  else if (cues && (cues.request >= 0.6 || cues.stopOrSteer >= 0.6)) notes.push('A short acknowledgement ("got it") already played aloud for you: start straight with the substance, never with "On it", "Got it" or "Sure".');
  if (recentReplies.slice(-2).some((r) => OFFER_RE.test(r))) notes.push('You offered more work in one of your last two replies: do not offer again in this one.');
  const first = recentReplies.slice(-1)[0]?.trim().match(/^[\p{L}']+/u)?.[0];
  if (first) notes.push(`Your last reply began with "${first}": begin this one differently.`);
  return notes.length ? `## This turn\n${notes.map((n) => `- ${n}`).join('\n')}` : '';
}

/** Openers a reflex already covered: a laugh, an exclamation, an acknowledgement ("Ha,", "Ooh,", "On it —"). */
const COVERED_OPENER = /^\s*(?:(?:ha(?:ha|h)?|heh|hah|ooh+|oh|on it|got it|sure|okay|ok|alright|copy|noted|will do|understood)(?:\s*[—–]\s*|\s+-\s+|[,.!:]+\s+))+/i;
/** How much of a reply's head to hold before deciding (a few words; only when a reflex covered the turn). */
const OPENER_HOLD_CHARS = 24;

/**
 * Removes a leading laugh or acknowledgement when a reflex already said one aloud for this turn (the model's
 * "Ha, …" after the office's "Ha! You're funny."). The rest starts with a capital; a reply that is only the opener
 * is kept as it is.
 */
export class CoveredOpenerFilter {
  private head = '';
  private done = false;

  constructor(private readonly covered: () => boolean) {}

  push(delta: string): string {
    if (this.done) return delta;
    this.head += delta;
    if (this.head.length < OPENER_HOLD_CHARS && !/[.!?]\s+\S/.test(this.head.slice(1))) {
      if (!this.covered()) return this.release(false);
      return '';
    }
    return this.release(this.covered());
  }

  flush(): string {
    return this.done ? '' : this.release(this.covered());
  }

  private release(strip: boolean): string {
    this.done = true;
    const head = this.head;
    this.head = '';
    if (!strip) return head;
    const m = COVERED_OPENER.exec(head);
    if (!m) return head;
    const rest = head.slice(m[0].length);
    if (!/\p{L}/u.test(rest)) return head;
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
}

/** True for a talk.* surface that belongs to the Talk transcript: none, or 'talk' (not a Floor quick-chat or a room). */
export function isTalkSurface(surface: string | undefined): boolean {
  return surface === undefined || surface === 'talk';
}

/**
 * A frame of the Chief of Staff's own conversation: not a Floor quick-chat, not an office room or huddle, not an office
 * note (a meeting line would read as the Chief's own words), not another agent's message.
 */
export function isChiefConversation(f: Frame): boolean {
  if (f.type === 'talk.owner') return isTalkSurface(f.data.surface) && (f.data.agentId === undefined || f.data.agentId === CHIEF_ID);
  if (f.type === 'talk.message') return isTalkSurface(f.data.surface) && f.data.kind !== 'note' && f.data.agentId === CHIEF_ID;
  return false;
}

/**
 * Owner and Chief of Staff messages from the ledger → a provider transcript (starts with user, roles
 * alternate). A reply is placed right after the owner message of its own turn, so the transcript always
 * ends with what the owner said last even if a reply was persisted late. Announcements (no turn) keep
 * ledger order. Floor quick-chats with coworkers (`surface: 'floor'`), office rooms and huddles (`surface: 'room'`),
 * office notes and other agents' messages are not the Chief's conversation and are left out.
 */
export function historyFromFrames(frames: Frame[], maxChars = HISTORY_CHARS): ChatMessage[] {
  const raw: { role: 'user' | 'assistant'; content: string; turnId: string | null }[] = [];
  for (const f of frames) {
    if (!isChiefConversation(f)) continue;
    if (f.type === 'talk.owner') raw.push({ role: 'user', content: f.data.text, turnId: f.data.turnId });
    else if (f.type === 'talk.message' && f.data.text.trim()) {
      const entry = { role: 'assistant' as const, content: f.data.text, turnId: f.data.turnId };
      const owner = f.data.turnId ? raw.findIndex((m) => m.role === 'user' && m.turnId === f.data.turnId) : -1;
      if (owner < 0) raw.push(entry);
      else {
        let at = owner + 1;
        while (at < raw.length && raw[at]!.role === 'assistant' && raw[at]!.turnId === f.data.turnId) at++;
        raw.splice(at, 0, entry);
      }
    }
  }
  let budget = maxChars;
  let start = raw.length;
  while (start > 0 && budget - raw[start - 1]!.content.length >= 0) budget -= raw[--start]!.content.length;
  if (start === raw.length && raw.length) start = raw.length - 1; // always keep the newest message
  const merged: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of raw.slice(start)) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else merged.push({ role: m.role, content: m.content });
  }
  while (merged.length && merged[0]!.role !== 'user') merged.shift();
  return merged;
}

function talkFinish(r: TurnResult, text: string): TalkFinish {
  switch (r.finish) {
    case 'cancelled':
      return 'cancelled';
    case 'error':
      return 'error';
    case 'length':
      return 'length';
    case 'incomplete':
      return text ? 'stop' : 'error';
    default:
      return 'stop';
  }
}

/**
 * A turn's mutable state, shared with the WorkspaceDO so a newer owner message can close the turn at
 * once (its partial reply and `talk.done` land before the new `talk.owner`, keeping turns contiguous).
 */
export interface TurnState {
  turnId: TurnId;
  opId: OpId;
  replyId: MessageId;
  /** Text streamed so far (what the owner has seen). */
  text: string;
  log: TurnLog;
  /** Set once message/done are persisted; later output of this turn is dropped. */
  closed: boolean;
  /** Sources the Chief's web search cited this turn. */
  sources?: { url: string; title?: string }[];
}

export function newTurnState(turnId: TurnId, opId: OpId): TurnState {
  return { turnId, opId, replyId: ids.message(), text: '', log: new TurnLog(), closed: false };
}

/** Persist the turn's reply (if any) and its `talk.done`, exactly once. */
export function closeTurn(feed: Feed, state: TurnState, finish: TalkFinish, usage?: UsageSummary): void {
  if (state.closed) return;
  state.closed = true;
  const route = state.log.route();
  const jobId = state.log.jobId() as JobId | undefined;
  const projectId = state.log.projectId();
  const said = state.text.trim();
  const { turnId, opId, replyId } = state;
  if (said) {
    feed.append({
      type: 'talk.message',
      data: { turnId, messageId: replyId, agentId: CHIEF_ID, text: said, kind: route === 'status' ? 'status' : 'reply', ...(jobId ? { jobId } : {}), ...(projectId ? { projectId } : {}), ...(state.sources?.length ? { sources: state.sources } : {}) },
      actor: CHIEF_ID,
      opId,
    });
  }
  feed.append({ type: 'talk.done', data: { turnId, messageId: said ? replyId : null, finish, route, ...(usage ? { usage } : {}) }, actor: CHIEF_ID, opId });
}

/**
 * Close a phatic turn answered by a reflex (no model call): the line as `talk.message {kind:'reflex'}` and
 * `talk.done {route:'reflex'}`, persisted in one transaction and then broadcast. Returns false when the turn was
 * already closed (a newer message cut it).
 */
export function closeReflexTurn(
  feed: Feed,
  ledger: Ledger,
  state: Pick<TurnState, 'turnId' | 'opId' | 'replyId' | 'text' | 'closed'>,
  reply: { agentId: AgentId; text: string; intent: ExprIntentId; lineId: string; surface?: TalkSurface },
): boolean {
  if (state.closed) return false;
  state.closed = true;
  state.text = reply.text;
  const { turnId, opId, replyId } = state;
  const where = reply.surface === 'floor' ? { surface: 'floor' as const } : {};
  const chief = reply.agentId === CHIEF_ID;
  const frames = ledger.tx(() => [
    ledger.append({
      type: 'talk.message',
      data: { turnId, messageId: replyId, agentId: reply.agentId, text: reply.text, kind: 'reflex', intent: reply.intent, lineId: reply.lineId, ...where },
      actor: reply.agentId,
      opId,
    }),
    ledger.append({
      type: 'talk.done',
      data: { turnId, messageId: replyId, finish: 'stop', route: 'reflex', ...(chief ? {} : { agentId: reply.agentId }), ...where },
      actor: reply.agentId,
      opId,
    }),
  ]);
  for (const f of frames) feed.broadcast(f);
  return true;
}

/**
 * Streams a reply's head through the `⟦react:…⟧` parser (A10): the leading token, if any, is removed and its hint
 * rides on the first non-empty delta. The token never reaches a delta, the persisted message, the history or TTS.
 */
export class ReactHintSplitter {
  private head = '';
  private done = false;
  private hint: ReactHint | null = null;

  /** Text to stream now (possibly '') and the hint to attach when this is the first non-empty delta. */
  push(delta: string): { text: string; hint: ReactHint | null } {
    if (this.done) return this.take(delta);
    this.head += delta;
    if (maybeReactHintPrefix(this.head) && this.head.length <= REACT_HINT_MAX_CHARS) return { text: '', hint: null };
    return this.release();
  }

  /** End of stream: whatever is still buffered (a lone partial token is plain text). */
  flush(): { text: string; hint: ReactHint | null } {
    return this.done ? { text: '', hint: null } : this.release();
  }

  private release(): { text: string; hint: ReactHint | null } {
    const { hint, rest } = parseReactHint(this.head);
    this.done = true;
    this.head = '';
    this.hint = hint;
    return this.take(rest);
  }

  private take(text: string): { text: string; hint: ReactHint | null } {
    if (!text) return { text: '', hint: null };
    const hint = this.hint;
    this.hint = null;
    return { text, hint };
  }
}

/**
 * One Chief of Staff turn (the conversation loop). Streams `talk.delta`, persists one `talk.message`
 * and one `talk.done`. It reads live work state and calls quick ProjectDO RPCs through its tools, but
 * never waits for background work.
 */
export async function runChiefTurn(host: TalkHost, spec: TurnSpec, state: TurnState): Promise<void> {
  const { feed } = host;
  const { turnId, opId, signal } = spec;
  const { log } = state;
  feed.claim(CHIEF_ID, 'talk', { state: 'thinking', label: 'Thinking', causeSeq: spec.ownerSeq });
  host.reflexes?.started(turnId, spec.via === 'voice' ? 'voice' : 'text', spec.cues);

  let newStep = false;
  let finish: TalkFinish = 'stop';
  let usage: UsageSummary | undefined;
  const heads = new ReactHintSplitter();
  // The office already laughed or acknowledged for this turn (the cues say a reflex was due, or the server sent one):
  // the model's own "Ha," or "On it —" would be a second one.
  const c = spec.cues;
  const cueCovered = !!c && !c.sincereAi && !c.distress && (humourOnly(c) || c.request >= 0.6 || c.stopOrSteer >= 0.6);
  const openers = new CoveredOpenerFilter(() => cueCovered || !!host.reflexes?.spoke?.(turnId));
  let hintHeld: ReactHint | null = null;
  let firstDelta = true;
  const stream = (raw: string) => emit(heads.push(raw));
  const emit = ({ text: raw, hint }: { text: string; hint: ReactHint | null }) => {
    hintHeld ??= hint;
    const text = state.text || !firstDelta ? raw : openers.push(raw);
    if (!text) return;
    hint = hintHeld;
    hintHeld = null;
    const delta = newStep && state.text.trim() ? `\n\n${text}` : text;
    newStep = false;
    state.text += delta;
    if (firstDelta) host.reflexes?.firstText(turnId);
    firstDelta = false;
    feed.emit({ type: 'talk.delta', data: { turnId, messageId: state.replyId, agentId: CHIEF_ID, delta, ...(hint ? { hint } : {}) } });
  };

  try {
    const settings = await host.settings();
    const lead = settings.leadId ? fullIndex.lead(settings.leadId) : undefined;
    let jobs: JobSnapshot[] | null = null;
    let projects: TeamProjectSnapshot[] | null = null;
    let decisions: Decision[] = [];
    try {
      [jobs, projects, decisions] = await Promise.all([host.project().listJobs(), host.project().activeProjects(), host.project().openDecisions().catch(() => [])]);
    } catch (err) {
      logError('talk.jobs', err);
    }
    let resolved;
    try {
      resolved = host.registry().resolve('chat', { tier: 'fast', needs: ['tools'] });
    } catch (err) {
      if (err instanceof MissingProviderError) {
        feed.emit({ type: 'error', data: { code: 'not_configured', message: err.message, missingKeys: err.missingKeys, turnId, opId } });
        finish = 'error';
        return;
      }
      throw err;
    }
    // Floor quick-chats and office rooms share the ledger: read more rows so the Chief still sees its own recent turns.
    const messages = historyFromFrames(host.ledger.recent(['talk.owner', 'talk.message'], HISTORY_MESSAGES * 6).filter(isChiefConversation).slice(-HISTORY_MESSAGES));
    const turnNote = turnNoteFor(spec.cues, messages.filter((m) => m.role === 'assistant').map((m) => (typeof m.content === 'string' ? m.content : '')));
    // Quick lookups: the Chief searches natively when its provider hosts web search (research goes to jobs/teams).
    const webSearch = host.webTools !== false && hostsSearch(resolved.provider);
    const conn = host.connectors;
    const connectors = conn ? connectorTools(conn.kits(), conn, { subject: 'chief', mode: () => ({ kind: 'wait', wait: (ask) => conn.wait(ask, signal) }) }) : { tools: [], describe: '' };
    const system = buildChiefSystemPrompt({ lead, chiefName: settings.chiefName, voiceOn: settings.voiceOn, jobs, projects, honestyPolicy: honestyPolicyText(catalogFull.honestyPolicy), now: new Date(host.now()), turnNote, ownerFirst: ownerFirstNameOf(settings), webSearch, decisions, connectors: connectors.describe, automations: !!host.automations });
    const tools = createChiefTools({
      project: host.project(),
      turnId,
      jobs: jobs ?? [],
      projects: projects ?? [],
      decisions,
      log,
      leadId: settings.leadId,
      chiefName: settings.chiefName,
      onDelegated: (jobId) => host.reflexes?.delegated(turnId, jobId),
    });
    tools.push(...connectors.tools);
    const auto = host.automations;
    if (auto) tools.push(automationTool({ propose: (spec) => auto.propose(spec, signal) }));

    const result = await runTurn({
      provider: resolved.provider,
      model: resolved.model,
      system,
      messages,
      tools,
      ...(webSearch ? { hostedTools: [{ type: 'web_search' as const }] } : {}),
      signal,
      maxSteps: TALK_MAX_STEPS,
      ...callBudget(resolved.provider, resolved.model, TALK_MAX_TOKENS, TALK_EFFORT),
      onEvent: (e) => {
        if (state.closed) return;
        if (e.type === 'step') newStep = true;
        else if (e.type === 'text' && e.delta) stream(e.delta);
      },
    });
    if (!state.closed) {
      emit(heads.flush());
      if (firstDelta) {
        const rest = openers.flush();
        if (rest) emit({ text: rest, hint: null });
      }
    }
    usage = { provider: resolved.providerId, input: result.usage.input, output: result.usage.output, usd: result.usage.usd };
    state.sources = result.citations.slice(0, 12);
    finish = talkFinish(result, state.text);
    // A model that acted but said nothing still owes the owner a sentence: use what the tools reported.
    if (!state.text.trim() && finish === 'stop' && log.says.length) state.text = log.says.join(' ');
    if (result.finish === 'error' && !state.closed) {
      logError('talk.turn', result.error?.message ?? 'model error');
      feed.emit({ type: 'error', data: { code: 'provider_error', message: 'I could not reach the model just now. Try again in a moment.', turnId, opId } });
    }
  } catch (err) {
    logError('talk.turn', err);
    finish = signal.aborted ? 'cancelled' : 'error';
    if (!signal.aborted) feed.emit({ type: 'error', data: { code: 'internal', message: 'Something went wrong on my side. Try again.', turnId, opId } });
  } finally {
    closeTurn(feed, state, finish, usage);
    if (host.isCurrent(turnId)) feed.claim(CHIEF_ID, 'talk', null);
    host.reflexes?.ended(turnId);
  }
}
