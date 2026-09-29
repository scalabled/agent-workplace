import { callBudget, runTurn, type TurnResult } from '@headcount/agent-loop';
import { fullIndex, catalogFull } from '@headcount/catalog/full';
import { MissingProviderError, type ChatMessage, type ReasoningEffort, type Registry } from '@headcount/models';
import { CHIEF_ID, ids, type Frame, type JobId, type JobSnapshot, type MessageId, type OpId, type TalkFinish, type TurnId, type UsageSummary, type WorkspaceSettings } from '@headcount/protocol';
import { buildChiefSystemPrompt, honestyPolicyText } from './chief-prompt';
import { TurnLog, createChiefTools, type ProjectApi } from './chief-tools';
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

export interface TalkHost {
  feed: Feed;
  ledger: Ledger;
  registry(): Registry;
  project(): ProjectApi;
  settings(): Promise<WorkspaceSettings>;
  /** False once a newer owner message has taken over (then this turn must not reset presence). */
  isCurrent(turnId: TurnId): boolean;
  now(): number;
}

export interface TurnSpec {
  turnId: TurnId;
  /** Seq of the owner's talk.owner frame (presence cause). */
  ownerSeq: number;
  opId: OpId;
  signal: AbortSignal;
}

/**
 * Owner and Chief of Staff messages from the ledger → a provider transcript (starts with user, roles
 * alternate). A reply is placed right after the owner message of its own turn, so the transcript always
 * ends with what the owner said last even if a reply was persisted late. Announcements (no turn) keep
 * ledger order.
 */
export function historyFromFrames(frames: Frame[], maxChars = HISTORY_CHARS): ChatMessage[] {
  const raw: { role: 'user' | 'assistant'; content: string; turnId: string | null }[] = [];
  for (const f of frames) {
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
  const said = state.text.trim();
  const { turnId, opId, replyId } = state;
  if (said) {
    feed.append({
      type: 'talk.message',
      data: { turnId, messageId: replyId, agentId: CHIEF_ID, text: said, kind: route === 'status' ? 'status' : 'reply', ...(jobId ? { jobId } : {}) },
      actor: CHIEF_ID,
      opId,
    });
  }
  feed.append({ type: 'talk.done', data: { turnId, messageId: said ? replyId : null, finish, route, ...(usage ? { usage } : {}) }, actor: CHIEF_ID, opId });
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

  let newStep = false;
  let finish: TalkFinish = 'stop';
  let usage: UsageSummary | undefined;

  try {
    const settings = await host.settings();
    const lead = settings.leadId ? fullIndex.lead(settings.leadId) : undefined;
    let jobs: JobSnapshot[] | null = null;
    try {
      jobs = await host.project().listJobs();
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
    const system = buildChiefSystemPrompt({ lead, chiefName: settings.chiefName, voiceOn: settings.voiceOn, jobs, honestyPolicy: honestyPolicyText(catalogFull.honestyPolicy), now: new Date(host.now()) });
    const messages = historyFromFrames(host.ledger.recent(['talk.owner', 'talk.message'], HISTORY_MESSAGES));
    const tools = createChiefTools({ project: host.project(), turnId, jobs: jobs ?? [], log, leadId: settings.leadId, chiefName: settings.chiefName });

    const result = await runTurn({
      provider: resolved.provider,
      model: resolved.model,
      system,
      messages,
      tools,
      signal,
      maxSteps: TALK_MAX_STEPS,
      ...callBudget(resolved.provider, resolved.model, TALK_MAX_TOKENS, TALK_EFFORT),
      onEvent: (e) => {
        if (state.closed) return;
        if (e.type === 'step') newStep = true;
        else if (e.type === 'text' && e.delta) {
          const delta = newStep && state.text.trim() ? `\n\n${e.delta}` : e.delta;
          newStep = false;
          state.text += delta;
          feed.emit({ type: 'talk.delta', data: { turnId, messageId: state.replyId, agentId: CHIEF_ID, delta } });
        }
      },
    });
    usage = { provider: resolved.providerId, input: result.usage.input, output: result.usage.output, usd: result.usage.usd };
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
  }
}
