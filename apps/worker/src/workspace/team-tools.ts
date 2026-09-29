// The Chief of Staff's way to the rest of the team, so nothing is turned away for being someone else's job: ask a
// coworker (their expertise, answered at once and passed on) or hand the owner's request to them (it lands on their
// desk, where they answer and can start the work themselves).
import type { AgentTool, ToolOutcome } from '@headcount/agent-loop';
import type { Done } from '../desk/desk-tools';

export interface TeamToolHost {
  consult(who: string, question: string, signal: AbortSignal): Promise<Done<{ name: string; personaId: string; answer: string }>>;
  handTo(who: string, message: string): Promise<Done<{ name: string; personaId: string }>>;
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

export const TEAM_TRIGGERS = {
  ask: [String.raw`\bask (?!me\b|you\b|about\b|for\b|if\b|whether\b)(the \w+|our \w+|[a-z]+) (about|what|whether|if|how|why|for)\b`],
  hand: [String.raw`\b(pass|hand|send|forward) (this|it|that) (on |over )?to (the \w+|our \w+|[a-z]+)\b`, String.raw`\b(put me through|connect me) to (the \w+|our \w+|[a-z]+)\b`],
};
/** The name (or role) in a mock-triggered request: the group that holds it. */
const whoIn = (re: string, text: string, group: number) => new RegExp(re, 'i').exec(text)?.[group] ?? '';

export function teamTools(host: TeamToolHost): AgentTool<any>[] {
  const ask: AgentTool<{ who?: unknown; question?: unknown }> = {
    spec: {
      name: 'ask_coworker',
      description: 'Ask a coworker a quick question in their field (by name or role: "Maya", "the bookkeeper", "a lawyer") and pass their answer on to the owner. Use it when the answer needs their expertise.',
      parameters: { type: 'object', properties: { who: { type: 'string' }, question: { type: 'string' } }, required: ['who', 'question'], additionalProperties: false },
      mock: { triggers: TEAM_TRIGGERS.ask, args: (text: string) => ({ who: whoIn(TEAM_TRIGGERS.ask[0]!, text, 1), question: text }), reply: sayOf },
    },
    async execute(args, ctx) {
      const who = str(args.who);
      const question = str(args.question);
      if (!who || question.length < 4) return fail('Say who to ask and what.', 'Name the coworker (or their role) and the question.');
      const r = await host.consult(who, question.slice(0, 1500), ctx.signal);
      if (!r.ok) return fail(r.message, 'Try their role instead of a name, or answer yourself and say so.');
      return ok({ coworker: r.name, answer: r.answer, link: `/app/desk/${r.personaId}/profile`, say: `${r.name.split(' ')[0]} says: ${r.answer}` }, `Asked ${r.name}`);
    },
  };
  const hand: AgentTool<{ who?: unknown; message?: unknown }> = {
    spec: {
      name: 'hand_to_coworker',
      description: "Hand the owner's request to the coworker whose job it is (by name or role). It lands on their desk with your note; they answer there and can start the work. Tell the owner, with a link to their desk.",
      parameters: { type: 'object', properties: { who: { type: 'string' }, message: { type: 'string', description: "The request, in the owner's words, with any context they gave." } }, required: ['who', 'message'], additionalProperties: false },
      mock: { triggers: TEAM_TRIGGERS.hand, args: (text: string) => ({ who: whoIn(TEAM_TRIGGERS.hand[0]!, text, 4) || whoIn(TEAM_TRIGGERS.hand[1]!, text, 2), message: text }), reply: sayOf },
    },
    async execute(args) {
      const who = str(args.who);
      const message = str(args.message);
      if (!who || message.length < 4) return fail('Say who to hand it to and what.', 'Name the coworker (or their role) and the request.');
      const r = await host.handTo(who, message.slice(0, 2000));
      if (!r.ok) return fail(r.message, 'Try their role instead of a name, or handle it yourself.');
      const first = r.name.split(' ')[0];
      return ok({ coworker: r.name, link: `/app/desk/${r.personaId}/profile`, say: `I've passed it to [${first}](/app/desk/${r.personaId}/profile); ${first} is answering on their desk.` }, `Handed to ${r.name}`);
    },
  };
  return [ask, hand];
}
