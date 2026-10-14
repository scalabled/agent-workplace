// The Chief of Staff's way to the rest of the team, so nothing is turned away for being someone else's job: ask a
// coworker (their expertise, answered at once and passed on), hand the owner's request to someone on the team (it lands
// on their desk, where they answer and can start the work themselves), or hire someone when the owner asks for a role
// nobody on the team has.
import type { AgentTool, ToolOutcome } from '@headcount/agent-loop';
import type { Done } from '../desk/desk-tools';

export interface TeamToolHost {
  consult(who: string, question: string, signal: AbortSignal): Promise<Done<{ name: string; personaId: string; answer: string }>>;
  handTo(who: string, message: string): Promise<Done<{ name: string; personaId: string }>>;
  /** Hire someone (by name or role) onto the team; the owner asked for it. */
  hire(who: string): Promise<Done<{ name: string; personaId: string; title: string }>>;
  /** The owner's team, for the Chief's prompt. */
  roster(): Promise<{ personaId: string; name: string; title: string }[]>;
  /** Call a meeting: people from the team (by name or role; none: those best placed for the topic), or a project's team. */
  meet?(topic: string, who: string[], projectId?: string): Promise<Done<{ meetingId: string; names: string[]; chair: string }>>;
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
  hire: [String.raw`\bhire (?:a |an |someone (?:for|to do|who does) |somebody (?:for|to do) )?([a-z][a-z -]{2,40})`],
  meet: [String.raw`\b(call|hold|set up|start|have|organi[sz]e) a (meeting|brainstorm|huddle)\b`, String.raw`\bget (the team|everyone|everybody) together\b`, String.raw`\bbrainstorm with (the team|everyone)\b`],
};
/** The name (or role) in a mock-triggered request: the group that holds it. */
const whoIn = (re: string, text: string, group: number) => new RegExp(re, 'i').exec(text)?.[group] ?? '';

export function teamTools(host: TeamToolHost): AgentTool<any>[] {
  const ask: AgentTool<{ who?: unknown; question?: unknown }> = {
    spec: {
      name: 'ask_coworker',
      description: 'Ask a coworker a quick question in their field, by name or role ("Maya", "the bookkeeper", "a lawyer"). Use it when the answer needs their expertise. Returns their answer and a link to their desk; pass the answer on to the owner. Fails when nobody matches; then try their role.',
      parameters: { type: 'object', properties: { who: { type: 'string', description: 'A name or a role.' }, question: { type: 'string', description: 'The question, with the context they need.' } }, required: ['who', 'question'], additionalProperties: false },
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
      description: "Hand the owner's request to the coworker whose job it is, by name or role. It lands on their desk with your note; they answer there and can start the work. Returns a link to their desk: tell the owner who has it, with the link. Fails when nobody matches; then try their role or handle it yourself.",
      parameters: { type: 'object', properties: { who: { type: 'string', description: 'A name or a role.' }, message: { type: 'string', description: "The request, in the owner's words, with any context they gave." } }, required: ['who', 'message'], additionalProperties: false },
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
  const hire: AgentTool<{ who?: unknown }> = {
    spec: {
      name: 'hire_coworker',
      description:
        'Hire a coworker onto the owner’s team, by name or role ("a bookkeeper", "Maya"). Use it only when the owner asks you to hire someone or agrees to your suggestion; when they need a role nobody has, suggest someone first. They join at once, with a welcome in Talk, and the owner can let them go later. Returns their name, title and desk link. Fails when nobody in the directory fits.',
      parameters: { type: 'object', properties: { who: { type: 'string', description: 'A name or a role.' } }, required: ['who'], additionalProperties: false },
      mock: { triggers: TEAM_TRIGGERS.hire, args: (text: string) => ({ who: whoIn(TEAM_TRIGGERS.hire[0]!, text, 1).replace(/\s+(to|for|who|and|please)\b.*$/i, '').trim() }), reply: sayOf },
    },
    async execute(args) {
      const who = str(args.who);
      if (who.length < 2) return fail('Say who to hire.', 'A role ("a bookkeeper") or a name from the directory.');
      const r = await host.hire(who);
      if (!r.ok) return fail(r.message, 'Try a plainer role, or suggest someone from the directory.');
      const first = r.name.split(' ')[0];
      return ok({ coworker: r.name, personaId: r.personaId, link: `/app/desk/${r.personaId}/profile`, say: `Done: ${r.name} has joined as your ${r.title.toLowerCase()}. [Meet ${first}](/app/desk/${r.personaId}/profile).` }, `Hired ${r.name}`);
    },
  };
  const meet: AgentTool<{ topic?: unknown; who?: unknown; project_id?: unknown }> = {
    spec: {
      name: 'call_meeting',
      description:
        'Call a meeting now: coworkers talk a question through in turns, with you moderating. Use it when the owner wants a meeting, a brainstorm, the team’s views or a decision talked through. Invite 2 to 4 people by name or role, or leave who empty to invite those best placed for the topic. The first person invited chairs and sums up, and you bring the outcome back here. For a project, pass project_id and its own team meets. The owner can listen in and take the floor. Returns the meeting link: give it to the owner. Fails when nobody on the team fits.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'The question to settle, in a sentence, with any context the owner gave.' },
          who: { type: 'array', items: { type: 'string' }, description: 'Names or roles from the team. The first one chairs.' },
          project_id: { type: 'string', description: 'The id (prj_…) of a project whose team should meet about it.' },
        },
        required: ['topic'],
        additionalProperties: false,
      },
      mock: { triggers: TEAM_TRIGGERS.meet, args: (text: string) => ({ topic: text.replace(/^.*?\b(about|on|to discuss)\s+/i, '').slice(0, 300) || text, who: [] }), reply: sayOf },
    },
    async execute(args) {
      const topic = str(args.topic);
      if (topic.length < 3) return fail('Say what the meeting is about.', 'Put the question to settle in a sentence.');
      if (!host.meet) return fail('Meetings are not available here.', 'Ask the coworkers one at a time instead.');
      const who = Array.isArray(args.who) ? args.who.map(str).filter(Boolean).slice(0, 6) : [];
      const projectId = str(args.project_id);
      const r = await host.meet(topic.slice(0, 1000), who, /^prj_[a-z0-9]+$/.test(projectId) ? projectId : undefined);
      if (!r.ok) return fail(r.message, 'Invite people from the team, or hire someone first.');
      const list = r.names.length > 1 ? `${r.names.slice(0, -1).join(', ')} and ${r.names[r.names.length - 1]}` : r.names[0];
      const link = `/app/meetings/${r.meetingId}`;
      return ok({ meetingId: r.meetingId, link, people: r.names, say: `I've called a meeting with ${list}; ${r.chair} chairs and I'll moderate. [Listen in](${link}) any time, or take the floor. I'll bring you the outcome here.` }, `Called a meeting with ${list}`);
    },
  };
  return [ask, hand, hire, meet];
}
