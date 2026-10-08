// The work side of a room (office rooms and joined huddles): before anyone answers the owner, one fast call decides
// whether the owner's latest line asks for work. If it does, the work starts at once with the people in the room (a
// team project they staff, the person asked leading), so nobody in a room ever says "I'm not on a project" or "the
// Chief can bring me in". Direction for work someone here is already doing reaches their project as a note.
import { callBudget, runTurn, type AgentTool } from '@headcount/agent-loop';
import type { ChatProvider } from '@headcount/models';
import { clipText } from '../jobs/job-view';

/** Someone at the table the work can go to (the Chief is never staffed: they delegate). */
export interface IntakePerson {
  personaId: string;
  firstName: string;
  title: string;
  /** Team projects they are on now (the only targets for direction). */
  projects: { projectId: string; title: string }[];
}

export interface IntakeInput {
  ownerText: string;
  /** The meeting so far, oldest first, as plain lines ("You: …", "Juno (Copy lead): …"). */
  lines: readonly string[];
  people: readonly IntakePerson[];
  chiefPresent: boolean;
  chiefName: string;
}

export type IntakeDecision =
  | { action: 'start'; goal: string; title: string; people: string[] }
  | { action: 'direct'; projectId: string; text: string; toId?: string }
  | { action: 'none' };

const WORK_VERB = String.raw`(draft|write|make|put together|plan|create|prepare|build|design|set up|start|do|take on|handle|look into|research|find|get|come up with|work on|pull together|run|sort out|figure out|mock up|sketch)`;
/**
 * The owner's line asks for something to be made or done ("can you draft…", "please…", "let's get started", "I need a
 * …", a bare "Write the…"). Mock's rule; a plain question ("where would you start?") is not a request.
 */
export const WORK_ASK_RE = new RegExp(
  [
    String.raw`\b(can|could|would|will) you (please )?${WORK_VERB}\b`,
    String.raw`^\s*(please |ok(ay)?,? |so,? |right,? )?${WORK_VERB}\b`,
    String.raw`\b(please|go ahead|do it|make it happen|get (started|going|on (it|this|that))|start (on|working)|i want you to|i need (you to|a|an|the|some)|we need (a|an|the|some|to))\b`,
    String.raw`\blet'?s (do|get|start|make|write|draft|build|put|plan|go|run|create|design)\b`,
  ].join('|'),
  'i',
);
/** A line that is direction rather than a request (Mock's rule for "direct"). */
const DIRECTION_RE = /\b(focus on|make sure|remember to|keep it|avoid|don'?t|instead|also (add|include|cover)|change|switch|prioriti[sz]e|tone|shorter|longer)\b/i;

const OWNER_MARK = "The owner's latest line: ";

/** Mock (keyless): start on a work ask, direct on a direction line to someone already on a project, else none. */
export function mockIntake(text: string, i: Pick<IntakeInput, 'people'>): Record<string, unknown> {
  const owner = text.split('\n').find((l) => l.startsWith(OWNER_MARK))?.slice(OWNER_MARK.length) ?? text;
  const named = i.people.filter((p) => new RegExp(`\\b${p.firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(owner)).map((p) => p.firstName);
  const staffed = i.people.find((p) => p.projects.length && (named.includes(p.firstName) || named.length === 0));
  if (staffed && DIRECTION_RE.test(owner) && !/\?\s*$/.test(owner.trim())) return { action: 'direct', project_id: staffed.projects[0]!.projectId, direction: owner, to: staffed.firstName };
  // "Where would you start?" asks for an opinion, not for work.
  const opinion = /\b(where|what|how|why|which|who|when|should)\b[^.!]*\?\s*$/i.test(owner);
  if (WORK_ASK_RE.test(owner) && !opinion) return { action: 'start', goal: owner, title: '', people: named };
  return { action: 'none' };
}

const SYSTEM = [
  "You keep a small business's AI office moving. The owner is in a meeting with coworkers. Decide what their latest line means for the work, then call room_decision once.",
  "- start: they ask for something to be made, written, planned, researched, designed, built or done — \"can you…\", \"please…\", \"let's…\", \"I need…\", \"go ahead\", \"do it\", or a yes to an offer someone in the room just made. Write the goal as a complete brief from the whole conversation, with every detail and preference the owner gave. Choose people: those the owner addressed or asked, else those whose expertise fits best; the lead first; only people listed as at the table.",
  '- direct: they give direction, a correction or a preference for a project someone at the table is already on (listed below). Pass it on in their words.',
  '- none: chat, greetings, questions, opinions, brainstorming or thinking aloud without asking for anything to be produced.',
  'When in doubt between start and none for a clear request, choose start: the owner should never have to ask twice.',
].join('\n');

/** The decision for one owner line (none on any failure: the room still answers). */
export async function roomIntake(deps: { provider: ChatProvider; model: string; signal: AbortSignal }, i: IntakeInput): Promise<IntakeDecision> {
  if (!i.people.length && !i.chiefPresent) return { action: 'none' };
  let picked: Record<string, unknown> | null = null;
  const firstNames = i.people.map((p) => p.firstName);
  const tool: AgentTool<Record<string, unknown>> = {
    spec: {
      name: 'room_decision',
      description: 'Say what the owner\'s latest line means for the work: start new work, direct work already under way, or none.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'direct', 'none'] },
          goal: { type: 'string', description: 'start: the full brief, from the whole conversation, in the owner\'s terms.' },
          title: { type: 'string', description: 'start: a short title, 3 to 7 words.' },
          people: { type: 'array', items: firstNames.length ? { type: 'string', enum: firstNames } : { type: 'string' }, description: 'start: first names of who does it, the lead first.' },
          project_id: { type: 'string', description: 'direct: the project id.' },
          direction: { type: 'string', description: 'direct: the direction, in the owner\'s words.' },
          to: { type: 'string', description: 'direct: the first name it is for, if one person.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      mock: { triggers: ['^Decide'], args: (text: string) => mockIntake(text, i), reply: () => 'Decided.' },
    },
    async execute(args) {
      picked = args;
      return { ok: true, content: 'Noted.', endTurn: true };
    },
  };
  const table = i.people.length
    ? i.people.map((p) => `- ${p.firstName}, ${p.title}${p.projects.length ? `; on: ${p.projects.map((x) => `“${x.title}” (${x.projectId})`).join(', ')}` : '; free'}`).join('\n')
    : '- (no coworkers, only the Chief of Staff)';
  const content = [
    'Decide what this means for the work.',
    '',
    `At the table: ${i.chiefPresent ? `${i.chiefName} (Chief of Staff), and ` : ''}these coworkers:`,
    table,
    '',
    'The meeting so far (oldest first):',
    i.lines.length ? i.lines.map((l) => clipText(l, 400)).join('\n') : '(nothing yet)',
    '',
    `${OWNER_MARK}${i.ownerText}`,
  ].join('\n');
  try {
    await runTurn({ provider: deps.provider, model: deps.model, signal: deps.signal, system: SYSTEM, messages: [{ role: 'user', content }], tools: [tool], toolChoice: { name: 'room_decision' }, maxSteps: 1, ...callBudget(deps.provider, deps.model, 700, 'none') });
  } catch {
    return { action: 'none' };
  }
  return decisionOf(picked, i);
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The tool's arguments, made safe: people kept to the table, a project kept to the ones listed. */
export function decisionOf(raw: Record<string, unknown> | null, i: Pick<IntakeInput, 'people' | 'ownerText'>): IntakeDecision {
  if (!raw) return { action: 'none' };
  const byName = (n: string) => i.people.find((p) => p.firstName.toLowerCase() === n.trim().toLowerCase());
  if (raw.action === 'start') {
    const goal = str(raw.goal) || i.ownerText.trim();
    if (goal.length < 8) return { action: 'none' };
    const people = [...new Set((Array.isArray(raw.people) ? raw.people : []).map((n) => (typeof n === 'string' ? byName(n)?.personaId : undefined)).filter((x): x is string => !!x))];
    return { action: 'start', goal: goal.slice(0, 4000), title: str(raw.title).slice(0, 80), people };
  }
  if (raw.action === 'direct') {
    const projectId = str(raw.project_id);
    const text = str(raw.direction) || i.ownerText.trim();
    const holder = i.people.find((p) => p.projects.some((x) => x.projectId === projectId));
    if (!holder || text.length < 4) return { action: 'none' };
    const to = str(raw.to) ? byName(str(raw.to)) : undefined;
    return { action: 'direct', projectId, text: text.slice(0, 2000), ...(to && to.projects.some((x) => x.projectId === projectId) ? { toId: to.personaId } : {}) };
  }
  return { action: 'none' };
}
