// Model-facing text follows the writing standard, and models mirror their instructions: no prompt, prompt block or
// tool description the worker writes may contain an em dash. Catalog content (personas, leads, skills) is the
// catalog's own; the prompts here are built from catalog records that contain none, so any em dash found is ours.
import type { AgentTool } from '@headcount/agent-loop';
import { catalogFull, fullIndex } from '@headcount/catalog/full';
import type { Registry } from '@headcount/models';
import { CHIEF_ID, coworkerAgentId } from '@headcount/protocol';
import type { StaffingContext, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { describe, expect, it } from 'vitest';
import { JUDGE_SYSTEM } from '../automations/judge';
import { DOCUMENT_PROMPT, appPrompt } from '../canvas/builder';
import { buildDeskSystemPrompt, staffingStatus } from '../desk/desk';
import { deskTools, instructionsTool, type DeskActions } from '../desk/desk-tools';
import { workSystemPrompt } from '../jobs/work-loop';
import { DISTILL_SYSTEM } from '../memory/distill';
import { TIDY_SYSTEM } from '../memory/tidy';
import { DISCUSSION_DIRECTIVE, PLAN_SYSTEM } from '../projects/team-work';
import { INTAKE_SYSTEM } from '../rooms/intake';
import { buildRoomSystemPrompt, roomMember, workBlock } from '../rooms/prompt';
import { EXTERNAL_RULE } from '../tools/external';
import { researchTools } from '../tools/research';
import { SourceCollector } from '../tools/web-search';
import { buildChiefSystemPrompt, honestyPolicyText, teamStateBlock } from '../workspace/chief-prompt';
import { mediaTools, stepImageTool } from '../workspace/media-tools';
import { teamTools } from '../workspace/team-tools';
import { TurnLog, createChiefTools, type ProjectApi } from '../workspace/chief-tools';
import { memoryTools } from '../memory/chief-tools';
import { collabTools } from '../projects/collab';
import { sendEmailTool } from '../trust/email-tool';
import type { JobSnapshot, TurnId } from '@headcount/protocol';
import type { Decision } from '@headcount/protocol/ext/projects';
import { coworkerSections, joinSections } from './prompt';
import { skillsIndex, useSkillTool, personaSkills } from './skills';
import { CHAT_VOICE, SPOKEN_STYLE, WRITING_SHORT, WRITING_STANDARD } from './writing';

const EM_DASH = '—';
const clean = (v: unknown) => !JSON.stringify(v).includes(EM_DASH);

/** Every string in a tool's spec (description and parameter descriptions), mock hints excluded. */
function specText(tools: readonly (AgentTool<any> | null)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tools) if (t) out[t.spec.name] = JSON.stringify({ description: t.spec.description, parameters: t.spec.parameters });
  return out;
}

const withDash = (texts: Record<string, string>) => Object.entries(texts).filter(([, t]) => t.includes(EM_DASH)).map(([k]) => k);

// Catalog records free of em dashes, so the built prompts test only the worker's own text.
const lead = catalogFull.leads.find(clean)!;
const persona = fullIndex.catalog.personas.find((p) => clean(p) && p.skills.primary.every((id) => clean(fullIndex.catalog.skills.find((s) => s.id === id))))!;
const policy = honestyPolicyText(catalogFull.honestyPolicy);
const honesty = policy && clean(policy) ? policy : undefined;

describe('model-facing text has no em dashes', () => {
  it('has catalog records without em dashes to build from', () => {
    expect(lead).toBeTruthy();
    expect(persona).toBeTruthy();
  });

  it('in the exported prompt constants', () => {
    const constants: Record<string, string> = {
      WRITING_STANDARD,
      WRITING_SHORT,
      CHAT_VOICE,
      SPOKEN_STYLE,
      PLAN_SYSTEM,
      DOCUMENT_PROMPT,
      EXTERNAL_RULE,
      DISTILL_SYSTEM,
      TIDY_SYSTEM,
      INTAKE_SYSTEM,
      JUDGE_SYSTEM,
      appSketch: appPrompt('sketch'),
      appFull: appPrompt('full'),
      ...Object.fromEntries(Object.entries(DISCUSSION_DIRECTIVE).map(([k, v]) => [`DISCUSSION_DIRECTIVE.${k}`, v])),
    };
    expect(withDash(constants)).toEqual([]);
  });

  it('in the built system prompts', () => {
    const now = new Date('2026-10-13T10:00:00Z');
    const staffing: StaffingContext[] = [
      { projectId: 'prj_a', title: 'Spring menu', status: 'running', role: 'lead', mine: [{ stepId: 's1', title: 'Size the audience', status: 'working', reviewing: false }], stepsDone: 1, stepsTotal: 3, latest: 'A draft.' },
    ];
    const project = {
      projectId: 'prj_a',
      title: 'Spring menu',
      status: 'running',
      team: [{ personaId: persona.id, name: persona.name, title: persona.title, role: 'lead' }],
      steps: [{ id: 's1', title: 'Size the audience', status: 'working', ownerId: persona.id, reviewerIds: [] }],
      notes: [{ status: 'queued' }],
    } as unknown as TeamProjectSnapshot;
    const self = roomMember(coworkerAgentId(persona.id), { leadId: lead.id, chiefName: null })!;
    const chief = roomMember(CHIEF_ID, { leadId: lead.id, chiefName: 'Rosa' })!;
    const base = { persona, instructions: 'Lead with the answer.', edited: false, skills: personaSkills(persona, undefined, new Map()), research: 'You can search the web.' };
    const prompts: Record<string, string> = {
      chiefVoice: buildChiefSystemPrompt({ lead, chiefName: 'Rosa', voiceOn: true, jobs: [], projects: [project], honestyPolicy: honesty, webSearch: true, connectors: 'You can use Calendar.', automations: true, handbook: '', recalled: [], interview: [{ id: 'basics', title: 'Basics', ask: 'what you sell' }], team: [], now, ownerFirst: 'Greg', workspaceLevel: 'propose' }),
      chiefText: buildChiefSystemPrompt({
        lead,
        chiefName: null,
        voiceOn: false,
        jobs: [],
        projects: null,
        team: [{ personaId: persona.id, name: persona.name, title: persona.title }],
        handbook: 'We sell bread.',
        interview: [],
        email: { test: true, level: 'ask', recent: [{ status: 'failed', note: 'bounced', email: { subject: 'Hi', to: ['a@example.com'] } } as never] },
        now,
      }),
      chiefNeutral: buildChiefSystemPrompt({ lead: undefined, chiefName: null, voiceOn: false, jobs: [], now }),
      teamState: teamStateBlock([project, { ...project, status: 'proposed' }, { ...project, status: 'planning' }, { ...project, status: 'needs_review' }] as TeamProjectSnapshot[]),
      desk: buildDeskSystemPrompt(persona, 'Rosa', 'Greg', [], 'Amethyst & Co'),
      deskStaffed: buildDeskSystemPrompt(persona, 'Rosa', null, staffing),
      staffing: staffingStatus([...staffing, { ...staffing[0]!, status: 'proposed' }, { ...staffing[0]!, status: 'paused' }]),
      room: buildRoomSystemPrompt({ roomId: 'skyline', self, others: [chief], ownerFirst: 'Greg', chiefName: 'Rosa', staffing, work: { kind: 'failed', message: 'No model is set up.' } }),
      roomChief: buildRoomSystemPrompt({ roomId: 'garden', self: chief, others: [self], ownerFirst: null, chiefName: 'Rosa', wrapUp: true, work: { kind: 'directed', projectId: 'prj_a', title: 'Spring menu' } }),
      roomStarted: workBlock({ kind: 'started', projectId: 'prj_a', title: 'Spring menu', leadId: self.agentId, team: [{ agentId: self.agentId, firstName: self.firstName }] }, self),
      work: joinSections(coworkerSections({ ...base, project: { title: 'Spring menu', team: project.team, chiefName: 'Rosa' }, collaborate: 'You can ask teammates.' }, 'work')),
      review: joinSections(coworkerSections(base, 'review')),
      job: workSystemPrompt({ chiefName: 'Rosa', lead }, 'You can search the web.'),
      skills: skillsIndex(base.skills),
    };
    expect(withDash(prompts)).toEqual([]);
  });

  it('in the tool descriptions', () => {
    const actions = {
      startResearch: async () => ({ ok: false, message: '' }),
      startProject: async () => ({ ok: false, message: '' }),
      askColleague: async () => ({ ok: false, message: '' }),
      remember: () => ({ memoryId: 'm' }),
      proposeInstructions: async () => ({ ok: false, message: '' }),
    } as unknown as DeskActions;
    const noop = async () => ({ ok: false as const, message: '' });
    const kit = researchTools({ provider: { hosted: {} } as never, registry: {} as Registry, grants: { webSearch: true, fetchPage: true }, sources: new SourceCollector(), take: () => ({ allowed: true }) });
    const tools = specText([
      ...deskTools(actions, persona, 'Rosa', () => undefined),
      instructionsTool(actions, persona, () => undefined),
      ...teamTools({ consult: noop, handTo: noop, hire: noop, roster: async () => [], meet: noop }),
      ...mediaTools({ image: noop, video: noop }),
      stepImageTool(noop),
      ...kit.tools,
      useSkillTool(personaSkills(persona, undefined, new Map())),
    ]);
    expect(Object.keys(tools).length).toBeGreaterThan(10);
    expect(withDash(tools)).toEqual([]);
    expect(kit.describe).not.toContain(EM_DASH);
  });

  it('in the Chief of Staff, memory, team-channel and email tool descriptions', () => {
    const job = { jobId: 'job_1', title: 'Chairs', status: 'running', step: 1, of: 3 } as unknown as JobSnapshot;
    const running = { projectId: 'prj_a', title: 'Spring menu', status: 'running', team: [], steps: [] } as unknown as TeamProjectSnapshot;
    const proposed = { ...running, projectId: 'prj_b', status: 'proposed' } as TeamProjectSnapshot;
    const decision = { decisionId: 'dec_1', kind: 'input', projectId: 'prj_a', title: 'Budget?', body: '', status: 'open' } as unknown as Decision;
    const chief = createChiefTools({ project: { createCanvas: async () => ({ accepted: false, message: '' }) } as unknown as ProjectApi, turnId: 'turn_1' as TurnId, jobs: [job], projects: [running, proposed], decisions: [decision], log: new TurnLog(), leadId: null, chiefName: 'Rosa' });
    expect(chief.map((t) => t.spec.name)).toEqual(expect.arrayContaining(['start_background_job', 'steer_job', 'cancel_job', 'start_team_project', 'approve_team_project', 'answer_team_question', 'team_discussion', 'create_canvas']));
    const team = [persona, fullIndex.catalog.personas.find((p) => p.id !== persona.id)!].map((p) => ({ personaId: p.id, name: p.name, title: p.title, role: 'lead', why: '' }));
    const collab = collabTools({ team: () => team as never, consult: async () => '', handoff: () => undefined, findSpecialists: () => [], addSpecialist: () => ({ ok: false, error: '' }) }, persona.id, { depth: 0, lead: true });
    const memory = [true, false].flatMap((on) => memoryTools({ interviewing: () => on, missing: () => [], remember: () => ({}) as never, updateHandbook: () => ({ proposed: '', title: '' }), setInterview: () => undefined }));
    const tools = specText([...chief, ...memory, ...collab.tools, sendEmailTool({ request: async () => ({}) as never }, { owner: 'Greg', test: true })]);
    expect(withDash(tools)).toEqual([]);
    expect(collab.describe).not.toContain(EM_DASH);
  });
});
