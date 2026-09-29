// biz-bot parity in the UI: raised hands of every kind, plan editing and the plan graph, typed deliverables, the run
// inspector, a coworker's settings and exact prompts, the skills library, and the Chief's prompt.
import { slimIndex } from '@headcount/catalog/slim';
import type { AgentView, PromptView, RunTrace, SkillDetail } from '@headcount/protocol/ext/agents';
import type { ChannelEntry, Decision, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../catalog';
import { DecisionCard } from '../components/DecisionCard';
import { path } from '../router';
import { applyFrame, openDecisions, presenceFor, projectChannels, settings, teamProjects, upsertProject } from '../store';
import { createFakeAudio } from '../test/fake-audio';
import { setAudioEngine } from '../voice/engine';
import { ChiefPrompt } from './ChiefPrompt';
import { CoworkerProfile } from './CoworkerProfile';
import { ProjectDetail } from './ProjectDetail';
import { SkillPage, Skills } from './Skills';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => json({});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let host: HTMLElement;
const mount = (vnode: preact.ComponentChild) => act(() => render(vnode, host));
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click());
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const typeInto = (el: Element | null | undefined, value: string) =>
  act(() => {
    const input = el as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

const [a, b, c] = slimIndex.catalog.personas;
const team = [
  { personaId: a!.id, name: a!.name, title: a!.title, role: 'lead' as const, why: '' },
  { personaId: b!.id, name: b!.name, title: b!.title, role: 'specialist' as const, why: '' },
  { personaId: c!.id, name: c!.name, title: c!.title, role: 'sceptic' as const, why: '' },
];
const step = (id: string, over: Partial<TeamProjectSnapshot['steps'][number]> = {}): TeamProjectSnapshot['steps'][number] => ({ id, title: `Step ${id}`, brief: 'b', acceptance: 'a', ownerId: a!.id, reviewerIds: [c!.id], dependsOn: [], status: 'waiting', ...over });
const proj = (over: Partial<TeamProjectSnapshot> = {}): TeamProjectSnapshot => ({
  projectId: 'prj_abcdefgh',
  title: 'Spring menu launch',
  goal: 'Launch our spring menu',
  recipeId: 'r',
  recipeName: 'Launch',
  staffingNote: 'Ann leads.',
  team,
  steps: [step('s1', { title: 'Size the audience' }), step('s2', { title: 'Write the offer', ownerId: b!.id, dependsOn: ['s1'] })],
  status: 'proposed',
  decisionId: 'dec_1',
  createdAt: '2026-09-29T10:00:00Z',
  updatedAt: '2026-09-29T10:00:00Z',
  ...over,
});
const hand = (over: Partial<Decision>): Decision => ({ decisionId: 'dec_2', kind: 'input', projectId: 'prj_abcdefgh', title: 'Ann asks: Which supplier?', body: 'Two options.', status: 'open', createdAt: '2026-09-29T10:00:00Z', ...over });

beforeAll(() => setAudioEngine(createFakeAudio()));
beforeEach(() => {
  calls = [];
  respond = () => json({});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
      calls.push(call);
      return respond(call);
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  catalog.value = slimIndex;
  settings.value = { workspaceId: 'local', leadId: slimIndex.catalog.leads[0]!.id, chiefName: 'Eddie', voiceOn: false, updatedAt: '' };
  teamProjects.value = {};
  openDecisions.value = {};
  projectChannels.value = {};
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('raised hands of every kind', () => {
  it('a question: answer in words, or go with their recommendation', async () => {
    upsertProject(proj({ status: 'running' }));
    openDecisions.value = { dec_2: hand({ fromId: a!.id }) };
    respond = (call) => (call.url === '/api/decisions/dec_2' ? json({ accepted: true, project: proj({ status: 'running', updatedAt: '2026-09-29T10:05:00Z' }) }, 202) : json({}));
    await mount(<DecisionCard decision={openDecisions.value.dec_2!} />);
    expect(host.querySelector('.decision-kind')?.textContent).toContain('A question');
    expect(button('Send answer')?.disabled).toBe(true);
    await typeInto(host.querySelector('textarea'), 'The local one');
    await click(button('Send answer'));
    await flush();
    expect(calls.find((x) => x.url === '/api/decisions/dec_2')).toMatchObject({ method: 'POST', body: { action: 'answer', text: 'The local one' } });
    expect(openDecisions.value.dec_2).toBeUndefined();
  });

  it('review issues: accept as it is, or send direction; the budget: raise it', async () => {
    openDecisions.value = { r: hand({ decisionId: 'dec_3', kind: 'review', title: 'Accept the remaining review issues?' }) };
    respond = () => json({ accepted: true, project: proj({ status: 'running', updatedAt: '2026-09-29T10:05:00Z' }) }, 202);
    await mount(<DecisionCard decision={openDecisions.value.r!} />);
    await click(button('Accept as it is'));
    await flush();
    expect(calls.at(-1)).toMatchObject({ url: '/api/decisions/dec_3', body: { action: 'approve' } });
    render(null, host);
    await mount(<DecisionCard decision={hand({ decisionId: 'dec_4', kind: 'budget', title: 'Used its token budget' })} />);
    expect(button('Keep it paused')).toBeTruthy();
    await click(button('Raise it and continue'));
    await flush();
    expect(calls.at(-1)).toMatchObject({ url: '/api/decisions/dec_4', body: { action: 'approve' } });
  });
});

describe('the project page', () => {
  it('draws the plan as a graph and edits a step while the plan waits', async () => {
    const p = proj();
    upsertProject(p);
    respond = (call) => (call.method === 'PUT' ? json({ accepted: true, project: proj({ updatedAt: '2026-09-29T10:02:00Z', steps: [step('s1', { title: 'Size the regulars' }), p.steps[1]!] }) }, 202) : call.method === 'GET' ? json(p) : json({}));
    await mount(<ProjectDetail projectId="prj_abcdefgh" />);
    await flush();
    expect(host.querySelectorAll('.plan-node:not(.plan-final)')).toHaveLength(2);
    expect(host.querySelectorAll('.plan-edge')).toHaveLength(2); // s1 → s2, s2 → the deliverable
    expect(host.querySelector('.plan-graph')?.getAttribute('aria-label')).toContain('1. Size the audience');
    await click(host.querySelector('[aria-label="Edit Size the audience"]'));
    await typeInto(host.querySelector('.step-editor input'), 'Size the regulars');
    await click(button('Save step'));
    await flush();
    expect(calls.find((x) => x.method === 'PUT')).toMatchObject({ url: '/api/projects/prj_abcdefgh/steps/s1', body: { title: 'Size the regulars', ownerIds: [a!.id] } });
    expect(host.querySelector('.step-title')?.textContent).toBe('Size the regulars');
    expect(button('Add a step')).toBeTruthy();
  });

  it('shows a web deliverable in a sandboxed frame with its source, and opens every model call', async () => {
    const run: RunTrace = {
      runId: 'run_1',
      projectId: 'prj_abcdefgh',
      stepId: 's1',
      phase: 'work',
      personaId: a!.id,
      provider: 'mock',
      model: 'mock-1',
      system: `You are ${a!.name}.`,
      prompt: 'Do your step of the project now.',
      calls: [{ name: 'submit_work', args: '{"markdown":"x"}', result: 'Submitted.', ok: true }],
      text: '',
      sources: [{ url: 'https://example.org/a', title: 'A source' }],
      usage: { input: 1200, output: 300, usd: null },
      steps: 1,
      finish: 'stop',
      startedAt: '2026-09-29T10:00:00Z',
      ms: 2400,
    };
    const done = proj({ status: 'done', deliverableKind: 'web', deliverable: '<!doctype html><h1>Hi</h1>', qa: { approved: true, notes: 'Works offline.', reviewerId: c!.id }, usage: { input: 1200, output: 300, usd: null, calls: 1, budgetTokens: 1_500_000 }, steps: [step('s1', { status: 'done', output: 'x' })] });
    upsertProject(done);
    respond = (call) => (call.url.startsWith('/api/projects/prj_abcdefgh/runs') ? json({ runs: [run] }) : call.method === 'GET' ? json(done) : json({}));
    await mount(<ProjectDetail projectId="prj_abcdefgh" />);
    await flush();
    const frame = host.querySelector('iframe.deliverable-frame')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Hi</h1>');
    await click(button('View source'));
    expect(host.querySelector('.deliverable-code')?.textContent).toContain('<h1>Hi</h1>');
    expect(host.querySelector('.deliverable-qa')?.textContent).toContain('Works offline.');
    expect(host.querySelector('.project-usage')?.textContent).toContain('1,500 tokens · 1 call');
    await click(host.querySelector('.project-usage'));
    await flush();
    const sheet = document.querySelector('[role="dialog"]')!;
    expect(sheet.textContent).toContain('1 call · 1,500 tokens');
    expect(sheet.querySelector('.run-phase')?.textContent).toBe('Work');
    expect(sheet.querySelector('.run-meta')?.textContent).toContain('mock · mock-1 · 1,200 in / 300 out');
    expect(sheet.textContent).toContain(`You are ${a!.name}.`);
    expect(sheet.querySelector('.run-call-name')?.textContent).toBe('submit_work');
    await act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('a coworker’s settings and prompts', () => {
  const view = (over: Partial<AgentView> = {}): AgentView => ({
    personaId: a!.id,
    name: a!.name,
    title: a!.title,
    catalogInstructions: 'Catalog way.',
    instructions: 'Catalog way.',
    edited: false,
    config: {},
    history: [],
    skills: [{ id: 'sk1', name: 'Pricing', icon: '💲', category: 'finance', one_liner: 'Prices', description: '', when: 'pricing comes up', instructions: '1. Price it.', quality_checks: ['Margins shown'], tools: [], outputs: [], version: 1, edited: false, level: 'primary', enabled: true }],
    grants: [
      { id: 'web_search', label: 'Search the web', description: 'Looks things up.', granted: true, available: true },
      { id: 'fetch_page', label: 'Read web pages', description: 'Reads pages.', granted: true, available: true },
      { id: 'ask_coworker', label: 'Consult teammates', description: 'Asks.', granted: true, available: true },
    ],
    model: { policy: { tier: 'balanced', providerPreference: ['anthropic'], reasoning: null }, choice: {}, resolved: { provider: 'mock', model: 'mock-1' } },
    prompts: [
      { surface: 'work', label: 'Project work', when: 'When they work.', sections: [{ id: 'identity', title: 'Who they are', origin: 'persona', text: 'You are Ann.' }, { id: 'instructions', title: 'How they work', origin: 'persona', text: 'How you work: Catalog way.' }], text: 'You are Ann.\nHow you work: Catalog way.', tools: [{ name: 'submit_work', description: 'Submit.', kind: 'function', parameters: { type: 'object' } }] },
      { surface: 'desk', label: 'Quick chat', when: 'Desk.', sections: [{ id: 's0', title: 'Who you are', origin: 'persona', text: '## Who you are' }], text: '## Who you are', tools: [] },
    ],
    ...over,
  });

  it('How they work: edit the instructions, switch a tool and a skill off', async () => {
    respond = (call) => {
      if (call.url.startsWith('/api/models')) return json({ providers: [{ id: 'mock', label: 'Mock', configured: true, models: [] }] });
      if (call.method === 'PUT') {
        const body = call.body as { instructions?: string };
        return json(view({ instructions: body.instructions ?? 'Catalog way.', edited: !!body.instructions, config: body as AgentView['config'] }));
      }
      return json(view());
    };
    await mount(<CoworkerProfile personaId={a!.id} />);
    await click(button('How they work'));
    await flush();
    const box = host.querySelector<HTMLTextAreaElement>('#instr')!;
    expect(box.value).toBe('Catalog way.');
    await typeInto(box, 'Lead with the answer.');
    await click(button('Save instructions'));
    await flush();
    expect(calls.find((x) => x.method === 'PUT')).toMatchObject({ url: `/api/agents/${a!.id}`, body: { instructions: 'Lead with the answer.' } });
    expect(host.textContent).toContain('Instructions saved.');
    const web = [...host.querySelectorAll<HTMLInputElement>('.grant input')][0]!;
    await act(() => {
      web.checked = false;
      web.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(calls.filter((x) => x.method === 'PUT').at(-1)!.body).toEqual({ tools: { web_search: false } });
    const skill = host.querySelector<HTMLInputElement>('[aria-label="Pricing: on"]')!;
    await act(() => {
      skill.checked = false;
      skill.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(calls.filter((x) => x.method === 'PUT').at(-1)!.body).toEqual({ skillsOff: ['sk1'] });
  });

  it('Prompt: the exact prompt per surface, labelled by origin, with the tools', async () => {
    respond = () => json(view());
    await mount(<CoworkerProfile personaId={a!.id} />);
    await click(button('Prompt'));
    await flush();
    expect([...host.querySelectorAll('.prompt-section-title')].map((n) => n.textContent)).toEqual(['Who they are', 'How they work']);
    expect(host.querySelector('.prompt-origin')?.textContent).toBe('Catalog');
    expect(host.querySelector('.tool-item code')?.textContent).toBe('submit_work');
    await click(button('Quick chat'));
    expect(host.querySelector('.prompt-text')?.textContent).toBe('## Who you are');
  });
});

describe('skills and the Chief’s prompt', () => {
  it('lists skills by category, and edits one as a new version', async () => {
    const detail: SkillDetail = { id: 'sk1', name: 'Pricing', icon: '💲', category: 'finance', one_liner: 'Prices', description: '', when: 'pricing comes up', instructions: '1. Price it.', quality_checks: [], tools: [], outputs: [], version: 1, edited: false, history: [], catalogInstructions: '1. Price it.' };
    respond = (call) =>
      call.url === '/api/skills'
        ? json({ skills: [{ id: 'sk1', name: 'Pricing', icon: '💲', category: 'finance', one_liner: 'Prices', version: 1, edited: false, usedBy: 3 }] })
        : call.method === 'PUT'
          ? json({ ...detail, instructions: '1. Price it well.', version: 2, edited: true, history: [{ version: 1, instructions: '1. Price it.', at: '2026-09-29T10:00:00Z' }] })
          : json(detail);
    await mount(<Skills />);
    await flush();
    expect(host.querySelector('.skill-card-meta')?.textContent).toContain('3 coworkers');
    await click(host.querySelector('.skill-card'));
    expect(path.value).toBe('/app/skills/sk1');
    render(null, host);
    await mount(<SkillPage skillId="sk1" />);
    await flush();
    await click(button('Edit'));
    await typeInto(host.querySelector('#skill-text'), '1. Price it well.');
    await click(button('Save as v2'));
    await flush();
    expect(calls.find((x) => x.method === 'PUT')).toMatchObject({ url: '/api/skills/sk1', body: { instructions: '1. Price it well.' } });
    expect(host.textContent).toContain('v2 · edited in this workspace');
    expect(button('Bring back v1')).toBeTruthy();
  });

  it('shows the Chief’s live prompt and tools', async () => {
    const chief: PromptView = { surface: 'chief', label: 'Talk', when: 'Every reply.', sections: [{ id: 's0', title: 'Platform rules (these override everything below)', origin: 'platform', text: '## Platform rules' }], text: '## Platform rules', tools: [{ name: 'start_team_project', description: 'Staff a team.', kind: 'function' }] };
    respond = () => json(chief);
    await mount(<ChiefPrompt />);
    await flush();
    expect(host.querySelector('h1')?.textContent).toBe('How Eddie works');
    expect(host.querySelector('.prompt-section-title')?.textContent).toMatch(/^Platform rules/);
    expect(host.querySelector('.tool-item code')?.textContent).toBe('start_team_project');
  });
});

describe('the team channel', () => {
  const entry = (seq: number, over: Partial<ChannelEntry>): ChannelEntry => ({ seq, projectId: 'prj_abcdefgh', kind: 'work', fromId: a!.id, text: `line ${seq}`, at: '2026-09-29T10:00:00Z', ...over });

  it('shows who said what to whom, live, with a who-talked-to-whom graph; a pending question shows on the face', async () => {
    const p = proj({ status: 'running' });
    upsertProject(p);
    const first = a!.name.split(' ')[0]!;
    respond = (call) => (call.url === '/api/projects/prj_abcdefgh/channel' ? json({ entries: [entry(1, { text: 'Drafted the audience sizing.' }), entry(2, { kind: 'ask', toId: b!.id, text: 'What price point?' })] }) : call.method === 'GET' ? json(p) : json({}));
    await mount(<ProjectDetail projectId="prj_abcdefgh" />);
    await flush();
    const lines = [...host.querySelectorAll('.channel-entry')];
    expect(lines).toHaveLength(2);
    expect(lines[1]!.querySelector('.channel-to')?.textContent).toContain(b!.name.split(' ')[0]);
    expect(lines[1]!.querySelector('.channel-kind')?.textContent).toBe('Asks');
    expect(host.querySelector('.talk-graph svg')?.getAttribute('aria-label')).toContain(`${first} and ${b!.name.split(' ')[0]}: 1`);
    expect(presenceFor(`cw_${b!.id}`).label).toBe(`Answering ${first}`);
    // the answer arrives as a frame: the line appears and the face stops "answering"
    await act(() => void applyFrame({ v: 1, seq: 90, type: 'project.channel', at: '2026-09-29T10:01:00Z', data: { entry: entry(3, { kind: 'answer', fromId: b!.id, toId: a!.id, replyTo: 2, text: 'Keep it under twelve.' }) } } as never));
    expect(host.querySelectorAll('.channel-entry')).toHaveLength(3);
    expect(presenceFor(`cw_${b!.id}`).label).not.toBe(`Answering ${first}`);
  });

  it('the owner writes to the team, and starts a discussion', async () => {
    const p = proj({ status: 'running' });
    upsertProject(p);
    const posted = entry(5, { kind: 'owner', fromId: 'owner', toId: b!.id, text: `@${b!.name.split(' ')[0]} keep it short` });
    respond = (call) =>
      call.url === '/api/projects/prj_abcdefgh/channel'
        ? call.method === 'POST'
          ? json({ accepted: true, entry: posted }, 202)
          : json({ entries: [] })
        : call.url === '/api/projects/prj_abcdefgh/discuss'
          ? json({ accepted: true, project: proj({ status: 'running', updatedAt: '2026-09-29T10:03:00Z', discussion: { question: 'Instagram first?', speakerId: a!.id, round: 1, rounds: 2 } }) }, 202)
          : call.method === 'GET'
            ? json(p)
            : json({});
    await mount(<ProjectDetail projectId="prj_abcdefgh" />);
    await flush();
    expect(host.querySelector('.team-channel .page-fine')?.textContent).toContain('Nothing said yet');
    await typeInto(host.querySelector('#channel-text'), posted.text);
    await click(host.querySelector('.channel-form button[type="submit"]'));
    await flush();
    expect(calls.find((x) => x.method === 'POST' && x.url.endsWith('/channel'))).toMatchObject({ body: { text: posted.text } });
    expect(host.querySelector('.channel-entry[data-owner] .channel-who')?.textContent).toBe('You');
    await click(button('Start a discussion'));
    await typeInto(host.querySelector('.channel-discuss input'), 'Instagram first?');
    await click(button('Start'));
    await flush();
    expect(calls.find((x) => x.url.endsWith('/discuss'))).toMatchObject({ method: 'POST', body: { question: 'Instagram first?', rounds: 2 } });
    expect(host.querySelector('.channel-live')?.textContent).toContain('round 1 of 2');
    expect(button('Start a discussion')).toBeUndefined();
    expect(presenceFor(`cw_${a!.id}`).label).toBe('In the discussion: Instagram first?');
  });
});
