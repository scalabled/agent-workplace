// What the owner sees about a coworker (biz-bot parity and beyond: biz-bot shows only the editable pieces; here the
// exact system prompt each surface assembles is shown too, in labelled sections, with the tools that surface offers).
// Built from the same functions that build the real prompts, so the view cannot drift from what is sent.
import type { AgentTool } from '@headcount/agent-loop';
import type { Persona } from '@headcount/catalog';
import { fullIndex } from '@headcount/catalog/full';
import type { Registry } from '@headcount/models';
import { chiefDisplayName } from '@headcount/catalog';
import { coworkerAgentId, ownerFirstNameOf, type WorkspaceSettings } from '@headcount/protocol';
import type { AgentView, GrantView, InstructionVersion, PromptSection, PromptView, ToolView } from '@headcount/protocol/ext/agents';
import type { ConnectorView } from '@headcount/protocol/ext/connectors';
import type { StaffingContext } from '@headcount/protocol/ext/projects';
import { buildDeskSystemPrompt } from '../desk/desk';
import { buildRoomSystemPrompt, roomMember } from '../rooms/prompt';
import { researchTools } from '../tools/research';
import { SourceCollector } from '../tools/web-search';
import { agentOf, resolveAgentModel, type Agent } from './agent';
import { coworkerSections, joinSections } from './prompt';
import { connectorTools } from '../connectors/tools';
import { useSkillTool } from './skills';
import type { AgentSetup } from './store';

/** Split a "## Heading"-structured prompt into labelled sections (desk, room and Chief prompts). */
export function sectionsOf(text: string, origins: Record<string, PromptSection['origin']> = {}): PromptSection[] {
  const parts = text.split(/\n(?=## )/);
  return parts
    .filter((p) => p.trim())
    .map((p, i) => {
      const m = /^## (.+)\n?/.exec(p);
      const title = m ? m[1]!.trim() : i === 0 ? 'Opening' : `Part ${i + 1}`;
      const key = Object.keys(origins).find((k) => title.toLowerCase().startsWith(k.toLowerCase()));
      return { id: `s${i}`, title, text: p, origin: key ? origins[key]! : 'platform' };
    });
}

const toolViews = (tools: readonly AgentTool<any>[], hosted: readonly { type: string }[] = []): ToolView[] => [
  ...tools.map((t) => ({ name: t.spec.name, description: t.spec.description, parameters: t.spec.parameters, kind: 'function' as const })),
  ...hosted.map((h) => ({ name: h.type, description: h.type === 'web_search' ? 'Built-in web search run by the model provider; its sources come back with the answer.' : 'Built-in search of posts on X.', kind: 'hosted' as const })),
];

const SUBMIT_WORK: ToolView = { name: 'submit_work', description: 'Submit your finished work for this step.', kind: 'function', parameters: { type: 'object', properties: { markdown: { type: 'string' }, summary: { type: 'string' } }, required: ['markdown', 'summary'] } };
const SUBMIT_REVIEW: ToolView = { name: 'submit_review', description: 'Submit your verdict: approved, or the specific changes needed.', kind: 'function', parameters: { type: 'object', properties: { approved: { type: 'boolean' }, notes: { type: 'string' } }, required: ['approved', 'notes'] } };
const ASK_OWNER: ToolView = {
  name: 'request_owner_input',
  description: 'Pause this step for a decision, missing input or permission only the owner can give. Other steps continue.',
  kind: 'function',
  parameters: { type: 'object', properties: { question: { type: 'string' }, detail: { type: 'string' } }, required: ['question'] },
};

export interface ViewInput {
  persona: Persona;
  setup: AgentSetup;
  history: InstructionVersion[];
  settings: WorkspaceSettings;
  staffing: StaffingContext[];
  registry: Registry;
  webTools: boolean;
  /** The workspace's connectors (Stage 5): the owner grants them per coworker here. */
  connectors?: readonly ConnectorView[];
}

export function agentView(i: ViewInput): AgentView {
  const agent = agentOf(i.persona, i.setup);
  const config = agent.config;
  let resolved: { provider: string; model: string } | null = null;
  let providerHosted = {};
  try {
    const r = resolveAgentModel(i.registry, agent);
    resolved = { provider: r.providerId, model: r.model };
    providerHosted = r.provider.hosted ?? {};
  } catch {
    /* no provider: the model section says so */
  }
  const grants: GrantView[] = [
    { id: 'web_search', label: 'Search the web', description: 'Looks things up while working (the model’s own search when it has one).', granted: agent.granted('web_search'), available: i.webTools, ...(i.webTools ? {} : { note: 'Web tools are off for this workspace (WEB_TOOLS=off).' }) },
    { id: 'fetch_page', label: 'Read web pages', description: 'Opens a public page and reads its text (private addresses are refused).', granted: agent.granted('fetch_page'), available: i.webTools, ...(i.webTools ? {} : { note: 'Web tools are off for this workspace.' }) },
    { id: 'ask_coworker', label: 'Consult teammates', description: 'Asks a teammate on the project a question mid-step and waits for the answer.', granted: agent.granted('ask_coworker'), available: true },
  ];
  const kit = researchTools({
    provider: { hosted: providerHosted },
    registry: i.registry,
    grants: { webSearch: i.webTools && agent.granted('web_search'), fetchPage: i.webTools && agent.granted('fetch_page') },
    sources: new SourceCollector(),
    take: () => ({ allowed: true }),
  });
  const skill = useSkillTool(agent.skills);
  const chief = chiefDisplayName(i.settings.leadId ? fullIndex.lead(i.settings.leadId) : undefined, i.settings.chiefName);
  const staffed = i.staffing[0];
  const project = { title: staffed?.title ?? '(the project they are on)', team: [], chiefName: chief };
  // Connector tools as the work turn sees them (the view never calls them).
  const conn = connectorTools(i.setup.connectors?.[i.persona.id] ?? [], { call: async () => ({ status: 'error', message: 'Preview only.' }) }, { subject: i.persona.id, mode: () => ({ kind: 'note' }) });
  const workSections = coworkerSections({ persona: i.persona, instructions: agent.instructions, edited: agent.edited, skills: agent.skills, research: kit.describe, project, collaborate: ['If a decision, permission or input only the owner can give is missing, call request_owner_input (one specific question); continue with reasonable, stated assumptions for anything that does not block you.', conn.describe].filter(Boolean).join(' ') }, 'work');
  const reviewSections = coworkerSections({ persona: i.persona, instructions: agent.instructions, edited: agent.edited, skills: agent.skills, research: kit.describe, project }, 'review');
  const extras = [...kit.tools, ...(skill ? [skill] : [])];
  const desk = buildDeskSystemPrompt(i.persona, chief, ownerFirstNameOf(i.settings), i.staffing);
  const self = roomMember(coworkerAgentId(i.persona.id), i.settings);
  const room = self ? buildRoomSystemPrompt({ roomId: 'skyline', self, others: [], ownerFirst: ownerFirstNameOf(i.settings), chiefName: chief }) : '';
  const prompts: PromptView[] = [
    { surface: 'work', label: 'Project work', when: 'When they do a step of a team project (and when they revise it).', sections: workSections, text: joinSections(workSections), tools: [ASK_OWNER, SUBMIT_WORK, ...toolViews([...extras, ...conn.tools], kit.hosted)] },
    { surface: 'review', label: 'Reviewing', when: 'When they review a teammate’s step.', sections: reviewSections, text: joinSections(reviewSections), tools: [SUBMIT_REVIEW, ...toolViews(extras, kit.hosted)] },
    {
      surface: 'desk',
      label: 'Quick chat',
      when: 'When you chat with them at their desk or on the Floor.',
      sections: sectionsOf(desk, { 'Platform rules': 'platform', 'Who you are': 'persona', 'Your status': 'state', Style: 'platform' }),
      text: desk,
      tools: [],
    },
    ...(room ? [{ surface: 'room' as const, label: 'Meetings', when: 'When they speak in a conference room or a huddle you join.', sections: sectionsOf(room, { 'Platform rules': 'platform', 'Who you are': 'persona', 'Your status': 'state', Style: 'platform' }), text: room, tools: [] }] : []),
  ];
  return {
    personaId: i.persona.id,
    name: i.persona.name,
    title: i.persona.title,
    catalogInstructions: i.persona.instructions ?? '',
    instructions: agent.instructions,
    edited: agent.edited,
    config,
    history: i.history,
    skills: agent.skills,
    grants,
    model: {
      policy: { tier: i.persona.model_policy?.tier ?? 'balanced', providerPreference: i.persona.model_policy?.provider_preference ?? [], reasoning: (i.persona.model_policy?.reasoning_effort as string | undefined) ?? null },
      choice: config.model ?? {},
      resolved,
    },
    prompts,
    ...(i.connectors ? { connectors: i.connectors.map((c) => ({ connectorId: c.connectorId, name: c.name, tools: c.tools.length, status: c.status, everyone: c.everyone, granted: c.everyone || (config.connectors ?? []).includes(c.connectorId) })) } : {}),
  };
}

/** The Agent a view was built from (tests). */
export type { Agent };
