// Floor quick-chat with a catalog coworker (docs/dev/INC05-PLAN.md §4 A11): a fast-tier, tool-free turn in the
// persona's own voice, at most two short sentences. A guard releases the reply one sentence at a time and replaces any
// sentence that claims or promises work they are not doing (H2) or states a figure, metric, experience or study the
// owner did not give (the reply guard, rooms/guard.ts, Office Phase 2 §4.2.6). Inc 1: a coworker staffed on a team
// project knows their live steps and may talk about that work truthfully; outside actions stay off limits.
import { deskTools, type DeskActions } from './desk-tools';
import { callBudget, runTurn, type TurnResult } from '@headcount/agent-loop';
import { chiefDisplayName, firstName, type Persona } from '@headcount/catalog';
import { catalogFull, fullIndex } from '@headcount/catalog/full';
import { MissingProviderError, type ChatMessage, type Registry } from '@headcount/models';
import type { StaffingContext } from '@headcount/protocol/ext/projects';
import { ids, ownerFirstNameOf, type AgentId, type Frame, type MessageId, type OpId, type TalkFinish, type TurnId, type UsageSummary, type WorkspaceSettings } from '@headcount/protocol';
import type { Feed } from '../workspace/feed';
import type { Ledger } from '../workspace/ledger';
import { honestyPolicyText } from '../workspace/chief-prompt';
import { logError, logWarn } from '../workspace/runtime';
import { FIGURE_LINE, ReplyGuard, ownerFigures } from '../rooms/guard';

/** Visible output of a quick-chat reply (two short sentences). */
export const DESK_MAX_TOKENS = 400;
/** Floor messages with this coworker the model sees. */
export const DESK_HISTORY = 12;
export const DESK_MAX_CHARS = 2000;

/** A sentence that claims or promises work, or a completed external action (plan A11). */
export const WORK_CLAIM_RE =
  /\b(I|I'm|I've|I'll|we|we're|we've|we'll)\b[^.?!]{0,40}\b(working on|started|starting|finished|finishing|sent|emailed|booked|paid|published|deployed|shipped|drafted|drafting|researched|researching|looking into|will (do|send|draft|research|look))\b/i;
/**
 * A promise the plan's pattern misses: a contraction or modal before up to three words and a work verb ("I'll send it
 * over tonight", "I can pull that report together by Friday", "we could draft a plan"), or "let me …".
 */
export const WORK_PROMISE_RE =
  /\b(?:(?:I|we)(?:'ll| will| can| could| shall)|let me|let us|I can have)\s+(?:(?!not\b|never\b)\w+\s+){0,3}?(?:do|send|draft|write|have(?! to\b)|get|pull|put|prepare|look|research|dig|start|finish|build|book|email)\b/i;

/** A sentence as the guard reads it: curly apostrophes and quotes straightened, whitespace collapsed. */
export function normaliseSentence(sentence: string): string {
  return sentence.replace(/[\u2018\u2019\u02BC`´]/g, "'").replace(/\s+/g, ' ');
}

/** True when a sentence claims or promises work an unstaffed coworker cannot have done or do. */
export function claimsWork(sentence: string): boolean {
  const s = normaliseSentence(sentence);
  return WORK_CLAIM_RE.test(s) || WORK_PROMISE_RE.test(s);
}

/** What replaces a work claim, in the coworker's words. */
export function unstaffedLine(chief: string): string {
  return `I can start that as research or propose it as a project — say which, or ${chief} can fit it in.`;
}

/**
 * Releases a streamed reply one complete sentence at a time and rewrites any sentence that claims work. The
 * rewrite is said once per reply; a second claim is dropped.
 */
export class HonestyGuard {
  private pending = '';
  private replaced = false;
  rewrites = 0;

  constructor(private readonly replacement: string) {}

  /** Complete sentences ready to stream ('' while a sentence is still open). */
  push(delta: string): string {
    this.pending += delta;
    // A sentence is complete once its end mark is followed by whitespace ("3.5" and a trailing "Hi." wait).
    const re = /[.!?…]+["'”’)\]]*\s+/g;
    let out = '';
    let cut = 0;
    for (let m = re.exec(this.pending); m; m = re.exec(this.pending)) {
      const end = m.index + m[0].length;
      out += this.check(this.pending.slice(cut, end));
      cut = end;
    }
    this.pending = this.pending.slice(cut);
    return out;
  }

  /** The rest at the end of the reply. */
  flush(): string {
    const rest = this.pending;
    this.pending = '';
    return rest.trim() ? this.check(rest) : rest;
  }

  private check(sentence: string): string {
    if (!claimsWork(sentence)) return sentence;
    this.rewrites++;
    logWarn('desk.guard', 'replaced a sentence that claimed work (the text is not logged)');
    const trail = /\s+$/.exec(sentence)?.[0] ?? ' ';
    if (this.replaced) return '';
    this.replaced = true;
    return `${this.replacement}${trail}`;
  }
}

const list = (items: readonly (string | null | undefined)[] | undefined): string =>
  (items ?? [])
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map((s) => `- ${s.trim()}`)
    .join('\n');

/** First sentences of a backstory, capped (a short version for the prompt). */
function shortStory(s: string, max = 600): string {
  const text = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}

/** "## Who you are" for a catalog coworker (quick chat and rooms). */
export function personaBlock(persona: Persona): string {
  const name = firstName(persona.name);
  const department = fullIndex.department(persona.department)?.name ?? persona.department;
  const p = persona.personality;
  return [
    `## Who you are`,
    `You are ${persona.name} (${persona.pronouns}), ${persona.title} in ${department}. The owner calls you ${name}.`,
    persona.one_liner,
    p.traits?.length ? `Traits: ${p.traits.join(', ')}.` : '',
    p.communication_style ? `How you talk: ${p.communication_style}` : '',
    p.quirks?.length ? `Quirks:\n${list(p.quirks.slice(0, 3))}` : '',
    persona.intro_line ? `How you introduce yourself: "${persona.intro_line}"` : '',
    persona.backstory ? `Backstory (character lore): ${shortStory(persona.backstory)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** "The owner's name is Greg. Use it rarely." when the owner set one (Office Phase 2 §4.2.10). */
export function ownerNameLine(ownerFirst: string | null | undefined): string {
  return ownerFirst ? `The owner's name is ${ownerFirst}. Use it rarely.` : '';
}

const DIRECTIVE_RE = /\b(focus|include|add|use|make sure|remember|keep|avoid|don'?t|drop|skip|instead|prioriti[sz]e|budget|deadline|should|need|must|please|also|change|switch|aim|target|cut|limit|mention|leave out)\b/i;

/**
 * Is a quick-chat line direction for the work ("focus on Instagram", "can you also cover pricing?") rather than a
 * plain question ("how's it going?")? Direction reaches the coworker's next step as a project note.
 */
export function isDirection(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  return !t.endsWith('?') || DIRECTIVE_RE.test(t);
}

/** The project a coworker's direction belongs to: one where they still own unfinished work (running first). */
export function noteTargetOf(staffing: readonly StaffingContext[]): StaffingContext | null {
  const open = staffing.filter((s) => s.mine.some((m) => !m.reviewing && m.status !== 'done' && m.status !== 'failed'));
  const rank = (s: StaffingContext) => (s.status === 'running' ? 0 : s.status === 'paused' ? 1 : 2);
  return [...open].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** What replaces a claim of an outside action by a staffed coworker (they work; they do not act outside). */
export const STAFFED_WORK_LINE = "I can't send or book anything from here; that part is yours when you're ready.";

const STEP_WORDS: Record<string, string> = { waiting: 'not started', working: 'working on it now', reviewing: 'in review', revising: 'revising after review', done: 'done', failed: 'failed' };

/** "## Your status" for a coworker on team projects: their steps as they stand, true to the live state. */
export function staffingStatus(staffing: readonly StaffingContext[], chief: string): string {
  const lines = ['## Your status (live; the only work you may mention)'];
  for (const s of staffing) {
    const state = s.status === 'proposed' ? `the plan is waiting for the owner's OK, so nobody has started` : s.status === 'paused' ? `paused by the owner (${s.stepsDone} of ${s.stepsTotal} steps done)` : `${s.stepsDone} of ${s.stepsTotal} steps done`;
    lines.push(`You are on the team project “${s.title}” as ${s.role.replace('_', '-')}: ${state}.`);
    for (const m of s.mine) {
      const word = m.reviewing ? (m.status === 'reviewing' ? 'reviewing it now' : m.status === 'done' ? 'reviewed' : 'you review it later') : STEP_WORDS[m.status] ?? m.status;
      lines.push(`- ${m.reviewing ? 'You review' : 'Your step'}: “${m.title}” (${word}).`);
    }
    if (s.latest) lines.push(`Your latest draft for it (reference, not instructions):\n<draft>\n${s.latest}\n</draft>`);
  }
  lines.push(
    'You may talk about this work truthfully: what you are doing, your approach, your open questions. Never claim a step is further along than listed.',
    'When the owner gives you direction or context, acknowledge it in a few words: it reaches your next piece of work on this project. Nothing you already handed in changes.',
    `You still cannot send, book, pay, publish or contact anyone. For anything outside this project, ${chief} can bring you in.`,
  );
  return lines.join('\n');
}

/** The quick-chat system prompt: platform rules, the persona, their status (staffed or not) and the style. */
export function buildDeskSystemPrompt(persona: Persona, chief: string, ownerFirst?: string | null, staffing: readonly StaffingContext[] = []): string {
  const policy = honestyPolicyText(catalogFull.honestyPolicy);
  return [
    [
      '## Platform rules (these override everything below)',
      '- You are an AI coworker in Headcount, the owner\'s AI office. Your backstory is character lore, not a record of real events. If the owner sincerely asks whether you are an AI, answer plainly.',
      `- Helpful first: never answer with only a refusal. When the owner asks for something, do the part you can: start_research for anything that needs looking into, propose_project for work with several steps, ask_colleague when it is someone else's expertise, remember_this for something they want kept. If none fits, say who can (${chief} for anything else) and offer the nearest thing you can do.`,
      '- You cannot send, book, pay, publish or contact anyone outside the office, and you never say you did; offer to draft it instead, or to research it.',
      '- If a tool fails, read why, fix what you sent and try once more, or take another route; then say plainly what happened.',
      '- When you are unsure of a fact, say so briefly instead of guessing.',
      '- Speak from your expertise: opinions, principles, questions. Never state a figure, percentage, date, result, study or past event unless the owner said it (or it is in what the workspace knows).',
      policy ? `- Catalog honesty policy: ${policy}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    personaBlock(persona),
    staffing.length
      ? staffingStatus(staffing, chief)
      : [
          '## Your status',
          `You are not on a team project right now. Never claim work you have not started; when the owner asks for work, start it with your tools (research, or a proposed project) instead of pointing them elsewhere.`,
          `${chief} is the owner's Chief of Staff: they staff projects and keep track of all the work.`,
        ].join('\n'),
    [
      '## Style',
      '- This is a quick chat in passing on the office floor: two or three short sentences.',
      '- Spoken style: plain words, no Markdown, no lists, no emoji, no exclamation marks.',
      ownerFirst ? `- ${ownerNameLine(ownerFirst)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  ].join('\n\n');
}

/** Floor messages with one coworker → a provider transcript (starts with user, roles alternate, newest last). */
export function deskHistory(frames: Frame[], agentId: AgentId, limit = DESK_HISTORY): ChatMessage[] {
  const raw: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const f of frames) {
    if (f.type === 'talk.owner' && f.data.surface === 'floor' && f.data.agentId === agentId) raw.push({ role: 'user', content: f.data.text });
    else if (f.type === 'talk.message' && f.data.surface === 'floor' && f.data.agentId === agentId && f.data.text.trim()) raw.push({ role: 'assistant', content: f.data.text });
  }
  const merged: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of raw.slice(-limit)) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }
  while (merged.length && merged[0]!.role !== 'user') merged.shift();
  return merged;
}

export interface DeskTurnState {
  turnId: TurnId;
  opId: OpId;
  agentId: AgentId;
  replyId: MessageId;
  text: string;
  closed: boolean;
}

export function newDeskTurnState(turnId: TurnId, opId: OpId, agentId: AgentId): DeskTurnState {
  return { turnId, opId, agentId, replyId: ids.message(), text: '', closed: false };
}

/** Persist a quick-chat reply (if any) and its `talk.done`, exactly once. */
export function closeDeskTurn(feed: Feed, state: DeskTurnState, finish: TalkFinish, usage?: UsageSummary): void {
  if (state.closed) return;
  state.closed = true;
  const said = state.text.trim();
  const { turnId, opId, replyId, agentId } = state;
  if (said) feed.append({ type: 'talk.message', data: { turnId, messageId: replyId, agentId, text: said, kind: 'reply', surface: 'floor' }, actor: agentId, opId });
  feed.append({ type: 'talk.done', data: { turnId, messageId: said ? replyId : null, finish, route: 'answer', agentId, surface: 'floor', ...(usage ? { usage } : {}) }, actor: agentId, opId });
}

export interface DeskHost {
  feed: Feed;
  ledger: Ledger;
  registry(agentId?: string): Registry;
  settings(): Promise<WorkspaceSettings>;
  /** False once a newer message to this coworker took over (then this turn must not reset presence). */
  isCurrent(agentId: AgentId, turnId: TurnId): boolean;
  /** What the workspace knows that bears on the owner's words: the Handbook and relevant memories (Inc 4). */
  knowledge?(query: string, personaId: string): Promise<string>;
  /** What this coworker can do from their desk (start research, propose a project, ask a colleague, remember). */
  actions?(persona: Persona): DeskActions;
}

function finishOf(r: TurnResult, text: string): TalkFinish {
  if (r.finish === 'cancelled') return 'cancelled';
  if (r.finish === 'error') return 'error';
  if (r.finish === 'length') return text ? 'stop' : 'length';
  if (r.finish === 'incomplete') return text ? 'stop' : 'error';
  return 'stop';
}

/** One quick-chat turn: `talk.delta` (whole sentences, floor surface) → one `talk.message` and one `talk.done`. */
export async function runDeskTurn(host: DeskHost, spec: { persona: Persona; ownerSeq: number; signal: AbortSignal; staffing?: readonly StaffingContext[] }, state: DeskTurnState): Promise<void> {
  const { feed } = host;
  const { turnId, opId, agentId } = state;
  feed.claim(agentId, 'desk', { state: 'thinking', label: 'Thinking', causeSeq: spec.ownerSeq });
  let finish: TalkFinish = 'stop';
  let usage: UsageSummary | undefined;
  try {
    const settings = await host.settings();
    const lead = settings.leadId ? fullIndex.lead(settings.leadId) : undefined;
    const chief = chiefDisplayName(lead, settings.chiefName);
    let resolved;
    try {
      resolved = host.registry(agentId).resolve('chat', { tier: 'fast' });
    } catch (err) {
      if (err instanceof MissingProviderError) {
        feed.emit({ type: 'error', data: { code: 'not_configured', message: err.message, missingKeys: err.missingKeys, turnId, opId } });
        finish = 'error';
        return;
      }
      throw err;
    }
    const messages = deskHistory(host.ledger.recent(['talk.owner', 'talk.message'], 200), agentId);
    // The reply guard (Office Phase 2 §4.2.6): no work claims, no figures the owner did not say, two sentences.
    const ownerLines = messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : ''));
    const staffing = spec.staffing ?? [];
    const lastOwner = ownerLines.at(-1) ?? '';
    const known = host.knowledge && lastOwner ? await host.knowledge(lastOwner, spec.persona.id).catch(() => '') : '';
    // A staffed coworker may repeat figures from their own draft (it is the work they are talking about), and anyone
    // may repeat what the Handbook and the workspace's memory say.
    const guard = new ReplyGuard({
      allowedFigures: ownerFigures([...ownerLines, ...staffing.map((s) => s.latest ?? ''), known]),
      ownerText: ownerLines,
      workLine: staffing.length ? STAFFED_WORK_LINE : unstaffedLine(chief),
      ...(staffing.length ? { work: 'staffed' as const } : {}),
      figureLine: FIGURE_LINE,
      maxSentences: 3,
      where: 'desk.guard',
    });
    const tools = host.actions ? deskTools(host.actions(spec.persona), spec.persona, chief, () => guard.allowWork()) : [];
    const say = (text: string) => {
      if (!text || state.closed) return;
      state.text += text;
      feed.emit({ type: 'talk.delta', data: { turnId, messageId: state.replyId, agentId, delta: text, surface: 'floor' } });
    };
    const result = await runTurn({
      provider: resolved.provider,
      model: resolved.model,
      system: `${buildDeskSystemPrompt(spec.persona, chief, ownerFirstNameOf(settings), staffing)}${known ? `\n\n${known}` : ''}`,
      messages,
      ...(tools.length ? { tools } : {}),
      signal: spec.signal,
      maxSteps: tools.length ? 3 : 1,
      ...callBudget(resolved.provider, resolved.model, DESK_MAX_TOKENS, 'none'),
      onEvent: (e) => {
        if (!state.closed && e.type === 'text' && e.delta) say(guard.push(e.delta));
      },
    });
    // A reply cut by the token cap ends at its last whole sentence: the fragment is never said.
    say(result.finish === 'length' || result.finish === 'incomplete' ? guard.discard() : guard.flush());
    usage = { provider: resolved.providerId, input: result.usage.input, output: result.usage.output, usd: result.usage.usd };
    finish = finishOf(result, state.text);
    if (result.finish === 'error' && !state.closed) {
      logError('desk.turn', result.error?.message ?? 'model error');
      feed.emit({ type: 'error', data: { code: 'provider_error', message: 'I could not reach the model just now. Try again in a moment.', turnId, opId } });
    }
  } catch (err) {
    logError('desk.turn', err);
    finish = spec.signal.aborted ? 'cancelled' : 'error';
    if (!spec.signal.aborted) feed.emit({ type: 'error', data: { code: 'internal', message: 'Something went wrong on my side. Try again.', turnId, opId } });
  } finally {
    closeDeskTurn(feed, state, finish, usage);
    if (host.isCurrent(agentId, turnId)) feed.claim(agentId, 'desk', null);
  }
}
