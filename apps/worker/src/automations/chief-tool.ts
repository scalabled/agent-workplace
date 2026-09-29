// The Chief of Staff sets up an automation when the owner asks for recurring or watched work (biz-bot system-tools.js
// create_automation, which is guarded the same way): it exists only once the owner confirms on the card.
import type { AgentTool } from '@headcount/agent-loop';
import { PAGE_CONDITIONS, type AutomationSpec, type PageCondition } from '@headcount/protocol/ext/automations';

export type ProposeOutcome = { status: 'approved' | 'declined' | 'pending'; describe: string } | { error: string };

export interface AutomationProposer {
  propose(spec: Partial<AutomationSpec>): Promise<ProposeOutcome>;
}

type Args = { name?: unknown; kind?: unknown; everyMinutes?: unknown; dailyAt?: unknown; pageUrl?: unknown; condition?: unknown; value?: unknown; extract?: unknown; goal?: unknown; action?: unknown; tellMe?: unknown };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function automationTool(p: AutomationProposer): AgentTool<Args> {
  return {
    spec: {
      name: 'set_up_automation',
      description:
        'Set up work that starts by itself, when the owner asks for it ("every Monday morning…", "tell me when this page changes"): a background job or a team project on a schedule (UTC) or when a public page changes. The owner confirms on a card before it exists. Only when the owner asked for recurring or watched work.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short name, e.g. "Monday competitor prices"' },
          kind: { type: 'string', enum: ['schedule', 'page'] },
          everyMinutes: { type: 'number', description: 'schedule: interval in minutes (at least 15)' },
          dailyAt: { type: 'string', description: 'schedule: HH:MM in UTC, instead of an interval' },
          pageUrl: { type: 'string', description: 'page: the public https page to watch' },
          condition: { type: 'string', enum: [...PAGE_CONDITIONS], description: 'page: changed (default), contains, not_contains, below, above' },
          value: { type: 'string', description: 'page: the text or number the condition compares with' },
          extract: { type: 'string', description: 'page: optional regular expression; its first group is the value watched' },
          goal: { type: 'string', description: 'What each run should do, with every constraint the owner gave' },
          action: { type: 'string', enum: ['job', 'project'], description: 'job: one background job (default); project: a team project' },
          tellMe: { type: 'string', enum: ['on', 'quiet', 'off'], description: 'Tell the owner after every run (on), only when it matters (quiet, default), or never (off)' },
        },
        required: ['name', 'kind', 'goal'],
        additionalProperties: false,
      },
      mock: {
        triggers: [String.raw`^\s*(every|each) (day|morning|evening|week|weekday|monday|tuesday|wednesday|thursday|friday|hour)\b`],
        args: (text) => ({ name: text.replace(/^\s*(every|each) \w+,?\s*/i, '').slice(0, 40) || 'Daily check', kind: 'schedule', dailyAt: '09:00', goal: text, action: 'job', tellMe: 'quiet' }),
        reply: (out) => {
          try {
            return String((JSON.parse(out) as { say?: string }).say ?? 'Done.');
          } catch {
            return out;
          }
        },
      },
    },
    async execute(args) {
      const kind = str(args.kind) === 'page' ? 'page' : 'schedule';
      const condition = (PAGE_CONDITIONS as readonly string[]).includes(str(args.condition)) ? (str(args.condition) as PageCondition) : 'changed';
      const spec: Partial<AutomationSpec> = {
        name: str(args.name),
        kind,
        action: { type: str(args.action) === 'project' ? 'project' : 'job', goal: str(args.goal) },
        gate: str(args.tellMe) === 'on' ? 'on' : str(args.tellMe) === 'off' ? 'off' : 'quiet',
        ...(kind === 'schedule'
          ? { schedule: str(args.dailyAt) ? { dailyAt: str(args.dailyAt) } : { everyMinutes: Number(args.everyMinutes) || 60 } }
          : { page: { url: str(args.pageUrl), condition, ...(str(args.value) ? { value: str(args.value) } : {}), ...(str(args.extract) ? { extract: str(args.extract) } : {}) } }),
      };
      const r = await p.propose(spec);
      if ('error' in r) return { ok: false, error: r.error };
      const say =
        r.status === 'approved'
          ? `Set up: ${r.describe}. It's on your Automations page, where you can pause or change it.`
          : r.status === 'declined'
            ? 'Not set up, as you said.'
            : `It's waiting for your OK on the card: ${r.describe}.`;
      return { ok: true, content: JSON.stringify({ status: r.status, describe: r.describe, say }), summary: r.status === 'approved' ? `Set up “${spec.name}”` : `Proposed “${spec.name}”` };
    },
  };
}
