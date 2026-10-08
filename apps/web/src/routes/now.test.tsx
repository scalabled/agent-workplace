// Now: what is going on at a glance. The summary line, what needs the owner, the work under way with who is on which
// step, and everyone's status (free to take something on, or what they are doing).
import type { Decision, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slimIndex } from '@headcount/catalog/slim';
import { catalog } from '../catalog';
import { navigate, path, paths } from '../router';
import { meetingsById, openDecisions, settings, teamIds, teamProjects } from '../store';
import { draft } from '../talk/draft';
import { Now, nowSummary } from './Now';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
let host: HTMLElement;
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const at = new Date().toISOString();
const project: TeamProjectSnapshot = {
  projectId: 'prj_01j000000000000000000000aa',
  title: 'Crystal box launch',
  goal: 'Launch a crystal subscription box',
  recipeId: null,
  recipeName: null,
  staffingNote: 'Mateo leads, with Trisha.',
  team: [
    { personaId: 'market-research-analyst', name: 'Mateo Rivera', title: 'Market Research Analyst', role: 'lead', why: '' },
    { personaId: 'bookkeeper', name: 'Trisha Bookkeeper', title: 'Bookkeeper', role: 'specialist', why: '' },
  ],
  steps: [
    { id: 's1', title: 'Size the market', brief: '', acceptance: '', ownerId: 'market-research-analyst', reviewerIds: ['bookkeeper'], dependsOn: [], status: 'working' },
    { id: 's2', title: 'Price the box', brief: '', acceptance: '', ownerId: 'bookkeeper', reviewerIds: [], dependsOn: ['s1'], status: 'waiting' },
  ],
  status: 'running',
  createdAt: at,
  updatedAt: at,
  startsNow: true,
} as unknown as TeamProjectSnapshot;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url === '/api/meetings' ? json({ meetings: [] }) : url === '/api/files' ? json({ files: [], can: {} }) : json({}))),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  catalog.value = slimIndex;
  settings.value = { workspaceId: 'org_aaaaaaaaaaaa', leadId: 'lead-steady-operator', chiefName: 'Eddie', voiceOn: false, updatedAt: '' };
  teamIds.value = ['market-research-analyst', 'bookkeeper', 'social-media-manager'];
  meetingsById.value = {};
  teamProjects.value = { [project.projectId]: project };
  openDecisions.value = { dec_1: { decisionId: 'dec_1', kind: 'input', projectId: project.projectId, fromId: 'bookkeeper', title: 'What margin should the box keep?', body: '', status: 'open', createdAt: at } as Decision };
  draft.value = '';
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  teamProjects.value = {};
  openDecisions.value = {};
});

describe('Now', () => {
  it('says what is going on in one line, or that it is quiet', () => {
    expect(nowSummary({ working: 2, projects: 1, jobs: 0, meetings: 1, needs: 2 }, 'Eddie')).toBe('2 people at work on 1 project · 1 meeting going on · 2 things need you.');
    expect(nowSummary({ working: 0, projects: 0, jobs: 0, meetings: 0, needs: 0 }, 'Eddie')).toMatch(/^All quiet right now\. Ask Eddie/);
  });

  it('shows what needs you, the work under way with who is on which step, and everyone’s status', async () => {
    navigate(paths.now);
    await act(() => render(<Now />, host));
    await flush();
    expect(host.querySelector('h1')?.textContent).toContain('What’s going on');
    expect(host.textContent).toContain('What margin should the box keep?');
    expect(host.textContent).toContain('from Trisha');
    const card = host.querySelector('.now-card')!;
    expect(card.textContent).toContain('Crystal box launch');
    expect(card.textContent).toContain('Mateo leads, with Trisha');
    expect(card.textContent).toContain('0 of 2 steps done');
    expect(card.querySelector('.now-steps')?.textContent).toBe('Mateo Size the market');
    // Someone not on any work is free to take something on.
    const people = [...host.querySelectorAll('.now-person')].map((p) => p.textContent ?? '');
    expect(people.some((p) => p.includes('free to take something on'))).toBe(true);
    // Ask for an update: the question goes to the Chief in Talk.
    await act(() => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Ask Eddie for an update'))!.click());
    expect(draft.value).toContain('What is everyone working on');
    expect(path.value).toBe(paths.talk);
  });
});
