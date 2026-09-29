// What a coworker can do from their desk (a quick chat), so a request is never just turned away: start research (a
// background job the Chief of Staff tracks), propose a team project (the owner approves the plan), ask a colleague who
// knows, and remember what the owner tells them. Outside actions (send, book, pay, publish) stay the owner's.
import type { AgentTool, ToolOutcome } from '@headcount/agent-loop';
import type { MemoryKind } from '@headcount/protocol/ext/memory';

export type Done<T> = ({ ok: true } & T) | { ok: false; message: string };

export interface DeskActions {
  startResearch(title: string, brief: string): Promise<Done<{ jobId: string; title: string }>>;
  proposeProject(goal: string, title?: string): Promise<Done<{ projectId: string; title: string }>>;
  /** A colleague by name or role ("Maya", "the bookkeeper"): their answer, or who could not be found. */
  askColleague(who: string, question: string, signal: AbortSignal): Promise<Done<{ name: string; personaId: string; answer: string }>>;
  remember(text: string, kind: MemoryKind): { memoryId: string };
}

const ok = (payload: Record<string, unknown>, summary: string): ToolOutcome => ({ ok: true, content: JSON.stringify(payload), summary });
const fail = (error: string, fix: string): ToolOutcome => ({ ok: false, error: JSON.stringify({ error, fix, say: error }) });
const sayOf = (out: string) => {
  try {
    return String((JSON.parse(out) as { say?: unknown }).say ?? 'Done.');
  } catch {
    return out;
  }
};
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const titleOf = (text: string) => {
  const t = text.replace(/^\s*(please|can you|could you|would you)\s+/i, '').replace(/[?.!]+$/, '').trim();
  return (t[0]?.toUpperCase() ?? '') + t.slice(1, 70);
};

/** Mock hints (keyless tests): which words start which tool. */
export const DESK_TRIGGERS = {
  research: [String.raw`\b(look into|research|find out|dig into|compare|check (out|on))\b`],
  project: [String.raw`\b(set up|start|propose|kick off|run) (a |the )?(team )?project\b`, String.raw`\bcan you (take|handle|run) (this|that|it) on\b`],
  ask: [String.raw`\bask (?!me\b|you\b|about\b|for\b|if\b|whether\b)(the \w+|our \w+|[a-z]+) (about|what|whether|if|how|why|for|to)\b`],
  remember: [String.raw`^\s*(please )?remember (that )?`],
};

/**
 * The desk tools. `onWork` runs when something real was started (so the reply may say so truthfully); `name` and
 * `chief` are for the lines said back.
 */
export function deskTools(a: DeskActions, me: { name: string }, chief: string, onWork: () => void): AgentTool<any>[] {
  const research: AgentTool<{ title?: unknown; brief?: unknown }> = {
    spec: {
      name: 'start_research',
      description: `Start background research or a write-up for the owner (comparisons, suppliers, options, a first draft). It runs on its own, ${chief} keeps track of it, and the result appears in Talk and on the Projects page. Use it whenever the owner asks for something that needs looking into.`,
      parameters: { type: 'object', properties: { title: { type: 'string', description: '3 to 7 words.' }, brief: { type: 'string', description: 'What to find or write, with every detail the owner gave.' } }, required: ['brief'], additionalProperties: false },
      mock: { triggers: DESK_TRIGGERS.research, args: (text: string) => ({ title: titleOf(text), brief: text }), reply: sayOf },
    },
    async execute(args) {
      const brief = str(args.brief);
      if (brief.length < 8) return fail('The brief is too short to start.', 'Say what to find or write, with the owner’s details.');
      const r = await a.startResearch(str(args.title) || titleOf(brief), brief.slice(0, 4000));
      if (!r.ok) return fail(r.message, 'Tell the owner plainly, and offer to propose it as a project or ask again later.');
      onWork();
      return ok({ jobId: r.jobId, title: r.title, say: `I've started “${r.title}”; ${chief} will tell you when it's done, and you can follow it on the Projects page.` }, `Started “${r.title}”`);
    },
  };
  const project: AgentTool<{ goal?: unknown; title?: unknown }> = {
    spec: {
      name: 'propose_project',
      description: 'Propose a team project for work with several steps or disciplines (a launch, a campaign, a plan, a proposal). The right team is picked, a plan is drafted, and the owner approves it in the Inbox before anything starts.',
      parameters: { type: 'object', properties: { goal: { type: 'string', description: "The outcome, in the owner's words, with every constraint." }, title: { type: 'string' } }, required: ['goal'], additionalProperties: false },
      mock: { triggers: DESK_TRIGGERS.project, args: (text: string) => ({ goal: text }), reply: sayOf },
    },
    async execute(args) {
      const goal = str(args.goal);
      if (goal.length < 8) return fail('The goal is too short to plan.', 'Say what the team should deliver.');
      const r = await a.proposeProject(goal.slice(0, 4000), str(args.title) || undefined);
      if (!r.ok) return fail(r.message, 'Tell the owner plainly; offer research instead if it fits.');
      onWork();
      return ok({ projectId: r.projectId, title: r.title, say: `I've proposed “${r.title}” as a team project; the plan is in your Inbox for your OK.` }, `Proposed “${r.title}”`);
    },
  };
  const ask: AgentTool<{ who?: unknown; question?: unknown }> = {
    spec: {
      name: 'ask_colleague',
      description: 'Ask a colleague a quick question when it is their expertise, by name or by role ("Maya", "the bookkeeper", "a lawyer"). You get their answer to pass on.',
      parameters: { type: 'object', properties: { who: { type: 'string' }, question: { type: 'string' } }, required: ['who', 'question'], additionalProperties: false },
      mock: { triggers: DESK_TRIGGERS.ask, args: (text: string) => ({ who: new RegExp(DESK_TRIGGERS.ask[0]!, 'i').exec(text)?.[1] ?? '', question: text }), reply: sayOf },
    },
    async execute(args, ctx) {
      const who = str(args.who);
      const question = str(args.question);
      if (!who || question.length < 4) return fail('Say who to ask and what.', 'Name the colleague (or their role) and the question.');
      const r = await a.askColleague(who, question.slice(0, 1500), ctx.signal);
      if (!r.ok) return fail(r.message, 'Try their role instead of a name, or answer from your own expertise.');
      return ok({ colleague: r.name, answer: r.answer, say: `${r.name.split(' ')[0]} says: ${r.answer}` }, `Asked ${r.name}`);
    },
  };
  const remember: AgentTool<{ text?: unknown; kind?: unknown }> = {
    spec: {
      name: 'remember_this',
      description: 'Remember something durable the owner told you (a fact, preference, decision, rule, a client or person), as one self-contained sentence, so the whole team knows it. Never passwords or card numbers.',
      parameters: { type: 'object', properties: { text: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'preference', 'decision', 'person', 'client', 'rule'] } }, required: ['text'], additionalProperties: false },
      mock: { triggers: DESK_TRIGGERS.remember, args: (text: string) => ({ text: text.replace(/^\s*(please )?remember (that )?/i, '').trim(), kind: /\b(always|never)\b/i.test(text) ? 'rule' : 'fact' }), reply: sayOf },
    },
    async execute(args) {
      const text = str(args.text);
      if (text.length < 4) return fail('Nothing to remember.', 'Write it as one sentence.');
      if (/\b(password|api[ -]?key|secret|token)\b|\b\d{12,19}\b/i.test(text)) return fail('That looks like a secret; it is not kept.', 'Tell the owner secrets stay with them.');
      const kind = (['fact', 'preference', 'decision', 'person', 'client', 'rule'] as const).find((k) => k === args.kind) ?? 'fact';
      a.remember(text, kind);
      return ok({ say: `Noted; the team will remember that.` }, 'Remembered');
    },
  };
  void me;
  return [remember, ask, project, research];
}
