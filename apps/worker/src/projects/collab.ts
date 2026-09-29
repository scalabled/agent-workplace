// How teammates talk to each other mid-work (biz-bot parity: tools.js ask_bot / message_bot / add_project_agent):
// - ask_coworker: ask a teammate and wait for the answer (nested at most two deep, like ask_bot's depth limit);
// - message_coworker: hand something to a teammate without waiting (it reaches their next step, like message_bot);
// - find_specialists / add_specialist: the project lead brings a catalog specialist onto the team (at most four).
// Everything lands in the team channel, so the owner sees who talked to whom.
import type { AgentTool } from '@headcount/agent-loop';
import type { TeamMember } from '@headcount/protocol/ext/projects';

/** ask_bot's limit: a consultation can itself consult once more, no deeper. */
export const MAX_CONSULT_DEPTH = 2;
/** Consultations one piece of work may make. */
export const MAX_ASKS_PER_TURN = 3;
export const MAX_ADDED_SPECIALISTS = 4;
export const MAX_TEAM = 12;

export interface CollabHost {
  team(): readonly TeamMember[];
  /** Run the teammate's answer (channel, trace, presence); resolves to their words. */
  consult(fromId: string, toId: string, question: string, depth: number): Promise<string>;
  /** Queue a hand-off to a teammate's next step (and say so in the channel). */
  handoff(fromId: string, toId: string, message: string): void;
  findSpecialists(need: string): { personaId: string; name: string; title: string; oneLiner: string }[];
  addSpecialist(byId: string, personaId: string, why: string): { ok: true; name: string } | { ok: false; error: string };
}

const ok = (payload: unknown, summary: string) => ({ ok: true as const, content: JSON.stringify(payload), summary });
const fail = (error: string) => ({ ok: false as const, error });
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function collabTools(host: CollabHost, selfId: string, opts: { depth: number; lead: boolean }): { tools: AgentTool<any>[]; describe: string } {
  const tools: AgentTool<any>[] = [];
  const others = () => host.team().filter((m) => m.personaId !== selfId);
  const who = (id: string) => others().find((m) => m.personaId === id);
  if (!others().length) return { tools, describe: '' };
  const roster = others()
    .map((m) => `${m.personaId} (${m.name}, ${m.title})`)
    .join('; ');
  let asks = 0;

  if (opts.depth < MAX_CONSULT_DEPTH) {
    tools.push({
      spec: {
        name: 'ask_coworker',
        description: `Ask a teammate a question and wait for their answer (they see the team channel, not your draft). Make it self-contained. Teammates: ${roster}.`,
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', enum: others().map((m) => m.personaId), description: 'The teammate’s id' },
            question: { type: 'string', description: 'The question, self-contained, with the context they need' },
          },
          required: ['to', 'question'],
          additionalProperties: false,
        },
        mock: { triggers: [String.raw`\(ask a teammate\)`], args: () => ({ to: others()[0]!.personaId, question: 'What should I keep in mind for this step?' }), reply: (out) => `Noted what my teammate said: ${out.slice(0, 120)}` },
      },
      async execute(args: { to?: unknown; question?: unknown }) {
        const to = str(args.to);
        const question = str(args.question).slice(0, 2000);
        if (!who(to)) return fail(`Ask one of: ${roster}.`);
        if (!question) return fail('Ask a specific question.');
        if (++asks > MAX_ASKS_PER_TURN) return fail(`You have asked ${MAX_ASKS_PER_TURN} questions in this piece of work; decide and carry on.`);
        try {
          const answer = await host.consult(selfId, to, question, opts.depth + 1);
          return ok({ from: who(to)!.name, answer }, `Asked ${who(to)!.name.split(' ')[0]}`);
        } catch (err) {
          return fail(`${who(to)!.name.split(' ')[0]} could not answer (${err instanceof Error ? err.message : 'error'}); decide and carry on.`);
        }
      },
    });
  }

  tools.push({
    spec: {
      name: 'message_coworker',
      description: 'Hand something to a teammate without waiting: it reaches their next piece of work on this project. Use it for a finding, a warning or a request they should act on.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', enum: others().map((m) => m.personaId) },
          message: { type: 'string', description: 'What they should know or do' },
        },
        required: ['to', 'message'],
        additionalProperties: false,
      },
    },
    async execute(args: { to?: unknown; message?: unknown }) {
      const to = str(args.to);
      const message = str(args.message).slice(0, 1000);
      if (!who(to)) return fail(`Message one of: ${roster}.`);
      if (!message) return fail('Say what they should know.');
      host.handoff(selfId, to, message);
      return ok({ queued: true, to: who(to)!.name }, `Handed to ${who(to)!.name.split(' ')[0]}`);
    },
  });

  if (opts.lead && opts.depth === 0) {
    tools.push({
      spec: {
        name: 'find_specialists',
        description: 'Find coworkers in the office (not yet on the team) with a discipline the project is missing.',
        parameters: { type: 'object', properties: { need: { type: 'string', description: 'The discipline or skill missing, in a few words' } }, required: ['need'], additionalProperties: false },
      },
      async execute(args: { need?: unknown }) {
        const need = str(args.need);
        if (!need) return fail('Say what discipline is missing.');
        return ok({ candidates: host.findSpecialists(need) }, `Looked for ${need.slice(0, 40)}`);
      },
    });
    tools.push({
      spec: {
        name: 'add_specialist',
        description: `Bring a specialist from find_specialists onto the team (at most ${MAX_ADDED_SPECIALISTS}; the team stays under ${MAX_TEAM + 1}). Then ask_coworker can reach them. The owner sees it in the channel.`,
        parameters: {
          type: 'object',
          properties: { personaId: { type: 'string' }, why: { type: 'string', description: 'One sentence: what they bring' } },
          required: ['personaId', 'why'],
          additionalProperties: false,
        },
      },
      async execute(args: { personaId?: unknown; why?: unknown }) {
        const r = host.addSpecialist(selfId, str(args.personaId), str(args.why).slice(0, 300));
        return r.ok ? ok({ added: r.name, next: 'Use ask_coworker with their id.' }, `Brought in ${r.name}`) : fail(r.error);
      },
    });
  }

  const describe = [
    opts.depth < MAX_CONSULT_DEPTH ? 'You can ask a teammate a question and wait for the answer (ask_coworker)' : '',
    'hand them something for their next step (message_coworker)',
    opts.lead && opts.depth === 0 ? 'bring in a specialist the team lacks (find_specialists, add_specialist)' : '',
  ]
    .filter(Boolean)
    .join(', ');
  return { tools, describe: `${describe}. Keep consultations few and specific; never delegate your whole task.` };
}
