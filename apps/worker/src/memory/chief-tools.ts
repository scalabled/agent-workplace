// The Chief of Staff's memory tools (Inc 4): remember something the owner asks to be remembered, write a Handbook
// section (during the interview, or when the owner states a standing rule, a client, a preference), and start or finish
// the Handbook interview.
import type { AgentTool, ToolOutcome } from '@headcount/agent-loop';
import { HANDBOOK_SECTIONS, MEMORY_KINDS, type HandbookSection, type HandbookSectionId, type MemoryItem, type MemoryKind } from '@headcount/protocol/ext/memory';
import { isSection } from './handbook';

export interface MemoryToolHost {
  interviewing(): boolean;
  missing(): readonly { id: HandbookSectionId; title: string; ask: string }[];
  remember(text: string, kind: MemoryKind): MemoryItem;
  /** The section as written, or a proposal waiting for the owner's OK (Inc 6: their setting for changes is "Propose"). */
  updateHandbook(section: HandbookSectionId, content: string, mode: 'replace' | 'append'): HandbookSection | { proposed: string; title: string } | Promise<HandbookSection | { proposed: string; title: string }>;
  setInterview(on: boolean): void;
}

const ok = (payload: Record<string, unknown>, summary: string): ToolOutcome => ({ ok: true, content: JSON.stringify(payload), summary });
const fail = (error: string): ToolOutcome => ({ ok: false, error: JSON.stringify({ error, say: error }) });
const sayOf = (out: string) => {
  try {
    return String((JSON.parse(out) as { say?: unknown }).say ?? 'Done.');
  } catch {
    return out;
  }
};
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function memoryTools(host: MemoryToolHost): AgentTool<any>[] {
  const interviewing = host.interviewing();
  const next = () => host.missing()[0];

  const interview: AgentTool<{ action?: unknown }> = {
    spec: {
      name: 'handbook_interview',
      description:
        "Start or finish the Handbook interview. Start it when the owner asks you to learn about the business, or agrees to it; then ask about one missing section at a time and write each up with update_handbook. Finish it when every section is covered or the owner wants to stop. Returns the next topic to ask about.",
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['start', 'finish'] } }, required: ['action'], additionalProperties: false },
      mock: {
        triggers: [String.raw`\binterview me\b`, String.raw`\b(write|start|do) (my|our|the) handbook\b`, String.raw`\b(stop|finish|end) the interview\b`],
        args: (text) => ({ action: /\b(stop|finish|end)\b/i.test(text) ? 'finish' : 'start' }),
        reply: sayOf,
      },
    },
    async execute(args) {
      if (str(args.action) === 'finish') {
        host.setInterview(false);
        const left = host.missing().length;
        return ok({ interviewing: false, say: left ? `We can pick the Handbook up any time; ${left} ${left === 1 ? 'section is' : 'sections are'} still empty. It's on the Handbook page.` : `That's the Handbook written. It's on the Handbook page, and the team works from it.` }, 'Finished the interview');
      }
      host.setInterview(true);
      const n = next();
      return ok({ interviewing: true, ask: n ? `${n.title}: ${n.ask}` : null, say: n ? `Let's write your Handbook, one topic at a time. First, ${n.ask}?` : 'Your Handbook already covers everything; tell me what to change.' }, 'Started the Handbook interview');
    },
  };

  const updateHandbook: AgentTool<{ section?: unknown; content?: unknown; mode?: unknown }> = {
    spec: {
      name: 'update_handbook',
      description:
        "Write a section of the owner's Handbook, the description of the business every coworker works from. Use it during the interview, after each answer, or when the owner states something that belongs there (a standing rule, a key client, how the business sounds). When the owner's setting is \"Propose\", the change waits for their OK in the Inbox. Fails for an unknown section or empty content.",
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', enum: HANDBOOK_SECTIONS.map((s) => s.id) },
          content: { type: 'string', description: 'A clean, organized write-up in the owner’s words. Short Markdown bullets are fine.' },
          mode: { type: 'string', enum: ['replace', 'append'], description: 'append adds to the section; replace (the default) rewrites it.' },
        },
        required: ['section', 'content'],
        additionalProperties: false,
      },
      // Mock: in an interview, every answer goes to the next missing section.
      ...(interviewing ? { mock: { triggers: ['[\\s\\S]'], args: (text: string) => ({ section: next()?.id ?? 'business', content: text, mode: 'replace' }), reply: sayOf } } : {}),
    },
    async execute(args) {
      const section = str(args.section);
      const content = str(args.content);
      if (!isSection(section)) return fail(`Use one of the sections: ${HANDBOOK_SECTIONS.map((s) => s.id).join(', ')}.`);
      if (!content) return fail('Write what the section should say.');
      const written = await host.updateHandbook(section, content, str(args.mode) === 'append' ? 'append' : 'replace');
      if ('proposed' in written) return ok({ proposed: written.proposed, say: `I've proposed an update to “${written.title}” in your Handbook; it's waiting for your OK in the Inbox.` }, `Proposed a change to “${written.title}”`);
      const s = written;
      const n = host.interviewing() ? next() : undefined;
      const say = host.interviewing() ? (n ? `That's “${s.title}” written. Next, ${n.ask}?` : `That's everything: your Handbook is written. The team works from it from now on.`) : `Added to “${s.title}” in your Handbook.`;
      if (host.interviewing() && !n) host.setInterview(false);
      return ok({ section: s.id, next: n ? `${n.title}: ${n.ask}` : null, say }, `Wrote “${s.title}”`);
    },
  };

  const remember: AgentTool<{ text?: unknown; kind?: unknown }> = {
    spec: {
      name: 'remember_this',
      description: "Save something durable the owner told you or asked you to remember: a fact, a preference, a decision, a person or client, a standing rule. Refuses anything that looks like a password, key or card number.",
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'One self-contained sentence that names who and what.' }, kind: { type: 'string', enum: MEMORY_KINDS.filter((k) => k !== 'excerpt') } },
        required: ['text'],
        additionalProperties: false,
      },
      mock: {
        triggers: [String.raw`^\s*(please )?remember (that )?`],
        args: (text) => ({ text: text.replace(/^\s*(please )?remember (that )?/i, '').trim(), kind: /\b(always|never|every)\b/i.test(text) ? 'rule' : 'fact' }),
        reply: sayOf,
      },
    },
    async execute(args) {
      const text = str(args.text);
      if (text.length < 4) return fail('Say what to remember.');
      if (/\b(password|api[ -]?key|secret|token)\b|\b\d{12,19}\b/i.test(text)) return fail('That looks like a secret; I don’t keep those.');
      const kind = MEMORY_KINDS.includes(str(args.kind) as MemoryKind) && str(args.kind) !== 'excerpt' ? (str(args.kind) as MemoryKind) : 'fact';
      const m = host.remember(text, kind);
      return ok({ memoryId: m.memoryId, say: `I'll remember that.` }, 'Remembered');
    },
  };

  return interviewing ? [interview, updateHandbook, remember] : [interview, remember, updateHandbook];
}
