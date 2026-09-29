// Inc 1 team projects in the UI: the Inbox's raised hand (approve, decline, see the plan), the Projects list and the
// project page (team, plan with reviewed work, deliverable).
import { slimIndex } from '@headcount/catalog/slim';
import type { Decision, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../catalog';
import { navigate, path, paths } from '../router';
import { CHIEF_ID } from '@headcount/protocol';
import { openDecisions, raisedHands, settings, teamProjects, thread, upsertProject } from '../store';
import { createFakeAudio } from '../test/fake-audio';
import { setAudioEngine } from '../voice/engine';
import { Inbox } from './Inbox';
import { ProjectDetail } from './ProjectDetail';
import { Projects } from './Projects';
import { Talk } from './Talk';

type Call = { url: string; method: string };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => json({});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let host: HTMLElement;
const mount = (vnode: preact.ComponentChild) => act(() => render(vnode, host));
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click());
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

const [a, b, c] = slimIndex.catalog.personas;
const team = [
  { personaId: a!.id, name: a!.name, title: a!.title, role: 'lead' as const, why: 'Runs launches' },
  { personaId: b!.id, name: b!.name, title: b!.title, role: 'specialist' as const, why: 'Numbers' },
  { personaId: c!.id, name: c!.name, title: c!.title, role: 'sceptic' as const, why: 'Keeps us honest' },
];
const step = (id: string, over: Partial<TeamProjectSnapshot['steps'][number]> = {}): TeamProjectSnapshot['steps'][number] => ({
  id,
  title: `Step ${id}`,
  brief: 'b',
  acceptance: 'a',
  ownerId: a!.id,
  reviewerIds: [c!.id],
  dependsOn: [],
  status: 'waiting',
  ...over,
});
const proj = (over: Partial<TeamProjectSnapshot> = {}): TeamProjectSnapshot => ({
  projectId: 'prj_abcdefgh',
  title: 'Spring menu launch',
  goal: 'Launch our spring menu with a small campaign',
  recipeId: 'r',
  recipeName: 'Launch',
  staffingNote: `${a!.name} leads, with ${b!.name}.`,
  team,
  steps: [step('s1', { title: 'Size the audience' }), step('s2', { title: 'Write the offer', ownerId: b!.id, dependsOn: ['s1'] })],
  status: 'proposed',
  decisionId: 'dec_1',
  createdAt: '2026-09-29T10:00:00Z',
  updatedAt: '2026-09-29T10:00:00Z',
  ...over,
});
const decision: Decision = { decisionId: 'dec_1', kind: 'plan_approval', projectId: 'prj_abcdefgh', title: 'Start the spring menu launch?', body: 'Three people, two steps.', status: 'open', createdAt: '2026-09-29T10:00:00Z' };

beforeAll(() => setAudioEngine(createFakeAudio()));

beforeEach(() => {
  calls = [];
  respond = () => json({});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method ?? 'GET' };
      calls.push(call);
      return respond(call);
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  catalog.value = slimIndex;
  settings.value = { workspaceId: 'local', leadId: 'lead-steady-operator', chiefName: 'Eddie', voiceOn: true, updatedAt: '' };
  teamProjects.value = {};
  openDecisions.value = {};
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('Inbox: a plan waiting for the owner', () => {
  it('shows the raised hand with the team and plan; Approve starts it and lowers the hand at once', async () => {
    upsertProject(proj());
    openDecisions.value = { dec_1: decision };
    respond = (call) => (call.url.endsWith('/approve') ? json({ accepted: true, project: proj({ status: 'running', updatedAt: '2026-09-29T10:01:00Z' }) }, 202) : json({}));
    await mount(<Inbox />);
    expect(host.textContent).toContain('Start the spring menu launch?');
    expect(host.textContent).toContain('Size the audience');
    expect(host.querySelector('.team-strip')?.getAttribute('aria-label')).toContain(b!.name);
    expect(host.textContent).toContain('tell Eddie “go ahead”');
    await click(button('Approve and start'));
    await flush();
    expect(calls.some((x) => x.method === 'POST' && x.url === '/api/projects/prj_abcdefgh/approve')).toBe(true);
    expect(teamProjects.value.prj_abcdefgh?.status).toBe('running');
    expect(raisedHands.value).toBe(0);
    expect(host.textContent).toContain('Nothing needs you');
  });

  it('keeps the hand up with the server’s sentence when approval fails', async () => {
    upsertProject(proj());
    openDecisions.value = { dec_1: decision };
    respond = () => json({ error: { code: 'conflict', message: 'Two team projects are already running.' } }, 409);
    await mount(<Inbox />);
    await click(button('Approve and start'));
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Two team projects are already running.');
    expect(raisedHands.value).toBe(1);
  });

  it('Not now declines; See the plan opens the project page', async () => {
    upsertProject(proj());
    openDecisions.value = { dec_1: decision };
    respond = (call) => (call.url.endsWith('/cancel') ? json({ accepted: true, project: proj({ status: 'cancelled', updatedAt: '2026-09-29T10:01:00Z' }) }, 202) : json({}));
    await mount(<Inbox />);
    await click(button('See the plan'));
    expect(path.value).toBe('/app/projects/prj_abcdefgh');
    await click(button('Not now'));
    await flush();
    expect(calls.some((x) => x.url === '/api/projects/prj_abcdefgh/cancel')).toBe(true);
    expect(teamProjects.value.prj_abcdefgh?.status).toBe('cancelled');
    expect(raisedHands.value).toBe(0);
  });
});

describe('Projects: team projects', () => {
  it('offers to staff a team when there are none, and lists projects as cards', async () => {
    await mount(<Projects />);
    expect(host.textContent).toContain('Hire a team in a sentence');
    upsertProject(proj({ status: 'running', steps: [step('s1', { status: 'done', output: 'x' }), step('s2', { status: 'working' })] }));
    await flush();
    const card = host.querySelector('.project-card');
    expect(card?.textContent).toContain('Spring menu launch');
    expect(card?.textContent).toContain('1 of 2 steps');
    await click(card);
    expect(path.value).toBe('/app/projects/prj_abcdefgh');
  });
});

describe('Everyone stop', () => {
  it('shows only while work runs, asks once, then stops everything', async () => {
    await mount(<Projects />);
    expect(button('Everyone stop')).toBeUndefined();
    upsertProject(proj({ status: 'running' }));
    await flush();
    await click(button('Everyone stop'));
    expect(host.textContent).toContain('Stop the one thing running?');
    await click(button('Keep going'));
    expect(button('Everyone stop')).toBeTruthy();
    respond = (call) => (call.url === '/api/stop-all' ? json({ stoppedJobs: 0, stoppedProjects: 1 }) : json({}));
    await click(button('Everyone stop'));
    await click(button('Stop everything'));
    await flush();
    expect(calls.some((x) => x.method === 'POST' && x.url === '/api/stop-all')).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Stopped the one thing that was running.');
  });
});

describe('ProjectDetail', () => {
  it('shows who is doing what, the reviewed work, and the deliverable', async () => {
    const done = proj({
      status: 'done',
      updatedAt: '2026-09-29T11:00:00Z',
      finishedAt: '2026-09-29T11:00:00Z',
      steps: [
        step('s1', { title: 'Size the audience', status: 'done', output: 'About 2,000 regulars.', verdict: { reviewerId: c!.id, approved: true, notes: 'Sources are solid.' }, startedAt: '2026-09-29T10:00:00Z', finishedAt: '2026-09-29T10:02:10Z' }),
        step('s2', { title: 'Write the offer', ownerId: b!.id, status: 'done', output: 'Two-for-one Tuesdays.', revised: true }),
      ],
      deliverable: '# Spring menu launch\n\nThe plan.',
      summary: 'Ready to go.',
    });
    respond = (call) => (call.url === '/api/projects/prj_abcdefgh' ? json(done) : json({}));
    await mount(<ProjectDetail projectId="prj_abcdefgh" />);
    await flush();
    expect(host.querySelector('h1')?.textContent).toBe('Spring menu launch');
    expect(host.textContent).toContain('Finished');
    expect(host.textContent).toContain('2 of 2 steps');
    expect(host.querySelector('.deliverable-panel')?.textContent).toContain('The plan.');
    expect(host.querySelector('.step-took')?.textContent).toBe('took 2 min');
    expect([...host.querySelectorAll('.team-member-name')].map((n) => n.textContent)).toEqual(expect.arrayContaining([expect.stringContaining(a!.name), expect.stringContaining(b!.name)]));
    // Step work opens on demand, with the reviewer's verdict.
    expect(host.textContent).not.toContain('About 2,000 regulars.');
    await click(host.querySelector('[aria-label="Show Size the audience"]'));
    expect(host.textContent).toContain('About 2,000 regulars.');
    expect(host.querySelector('.step-verdict')?.textContent).toContain('Sources are solid.');
  });

  it('asks for the OK on a proposed plan, and offers Stop while running', async () => {
    const proposed = proj({ forecast: { rounds: 2, modelCalls: { min: 5, max: 7 }, minutes: { min: 3, max: 7 } } });
    upsertProject(proposed);
    respond = (call) => (call.url.endsWith('/approve') ? json({ accepted: true, project: proj({ status: 'running', updatedAt: '2026-09-29T10:01:00Z', steps: [step('s1', { status: 'working', title: 'Size the audience' })] }) }, 202) : call.method === 'GET' ? json(proposed) : json({}));
    await mount(<ProjectDetail projectId="prj_abcdefgh" />);
    await flush();
    expect(host.textContent).toContain('Eddie staffed this and drafted the plan');
    expect(host.querySelector('.project-forecast')?.textContent).toContain('About 3 to 7 minutes once you approve: 2 rounds of work, 5 to 7 model calls.');
    await click(button('Approve and start'));
    await flush();
    expect(button('Stop project')).toBeTruthy();
    expect(host.textContent).toContain('Working');
    expect(host.querySelector('.team-member-title')?.textContent).toBe('Size the audience');
  });
});

describe('ProjectDetail: steering a project under way', () => {
  it('pauses and resumes, and sends direction that shows until a step picks it up', async () => {
    const running = proj({ status: 'running', updatedAt: '2026-09-29T10:01:00Z', steps: [step('s1', { title: 'Size the audience', status: 'working' }), step('s2', { title: 'Write the offer', ownerId: b!.id, dependsOn: ['s1'] })] });
    upsertProject(running);
    const noted = { ...running, updatedAt: '2026-09-29T10:02:00Z', notes: [{ noteId: 'note_1', text: 'Focus on Instagram', via: 'page' as const, status: 'queued' as const, at: '2026-09-29T10:02:00Z' }] };
    respond = (call) =>
      call.url.endsWith('/pause')
        ? json({ accepted: true, project: { ...running, status: 'paused', updatedAt: '2026-09-29T10:03:00Z' } }, 202)
        : call.url.endsWith('/resume')
          ? json({ accepted: true, project: { ...running, status: 'running', updatedAt: '2026-09-29T10:04:00Z' } }, 202)
          : call.url.endsWith('/note')
            ? json({ accepted: true, project: noted }, 202)
            : call.method === 'GET'
              ? json(running)
              : json({});
    await mount(<ProjectDetail projectId="prj_abcdefgh" />);
    await flush();

    const box = host.querySelector<HTMLTextAreaElement>('.note-input')!;
    await act(() => {
      box.value = 'Focus on Instagram';
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Send'));
    await flush();
    expect(calls.some((x) => x.method === 'POST' && x.url === '/api/projects/prj_abcdefgh/note')).toBe(true);
    expect(host.querySelector('.note[data-status="queued"]')?.textContent).toContain('waiting for the next step');
    expect(host.querySelector<HTMLTextAreaElement>('.note-input')!.value).toBe('');

    // A step picked it up (the feed says so).
    upsertProject({ ...noted, updatedAt: '2026-09-29T10:02:30Z', notes: [{ ...noted.notes[0]!, status: 'applied', appliedStepId: 's2', appliedAt: '2026-09-29T10:02:30Z' }] });
    await flush();
    expect(host.querySelector('.note[data-status="applied"]')?.textContent).toContain('picked up in “Write the offer”');

    await click(button('Pause'));
    await flush();
    expect(host.textContent).toContain('Paused: anyone mid-step finishes');
    await click(button('Resume'));
    await flush();
    expect(button('Pause')).toBeTruthy();
  });
});

describe('Talk: the Chief’s project replies', () => {
  it('link to the project page, worded for where it stands', async () => {
    settings.value = { workspaceId: 'local', leadId: slimIndex.catalog.leads[0]!.id, chiefName: 'Eddie', voiceOn: false, updatedAt: 'x' };
    upsertProject(proj());
    thread.value = [{ messageId: 'msg_1', turnId: null, from: CHIEF_ID, text: 'I’ve staffed it.', streaming: false, kind: 'reply', projectId: 'prj_abcdefgh', ts: '2026-09-29T10:00:00Z' }];
    navigate(paths.talk);
    await mount(<Talk />);
    const link = host.querySelector<HTMLAnchorElement>('.msg-project');
    expect(link?.textContent).toContain('See the team and plan');
    expect(link?.getAttribute('href')).toBe('/app/projects/prj_abcdefgh');
    upsertProject(proj({ status: 'done', updatedAt: '2026-09-29T11:00:00Z' }));
    await flush();
    expect(host.querySelector('.msg-project')?.textContent).toContain('Read the deliverable');
    await click(host.querySelector('.msg-project'));
    expect(path.value).toBe('/app/projects/prj_abcdefgh');
    thread.value = [];
  });
});
