// Your team: the Chief of Staff first, then each coworker with their first job; one keeps the second brain tidy.
import type { TeamResponse } from '@headcount/protocol/ext/team';
import { STARTER_TEAM } from '@headcount/protocol/ext/team';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slimIndex } from '@headcount/catalog/slim';
import { role } from '../auth/session';
import { catalog } from '../catalog';
import { settings } from '../store';
import { Team } from './Team';

type Call = { url: string; method: string };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => json({});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let host: HTMLElement;
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const team = (over: Partial<TeamResponse['secondBrain']> = {}): TeamResponse => ({
  members: STARTER_TEAM.map((m) => ({ personaId: m.personaId, why: m.why, firstTask: m.firstTask, does: [] })),
  secondBrain: { on: true, steward: 'knowledge-librarian', nextAt: '2026-10-06T10:00:00Z', ...over },
});

beforeEach(() => {
  calls = [];
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
  settings.value = { workspaceId: 'local', leadId: 'lead-steady-operator', chiefName: null, voiceOn: false, updatedAt: '' };
  role.value = 'owner';
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('Your team', () => {
  it('meets the Chief and the team, and starts a first job', async () => {
    respond = (c) => (c.method === 'POST' ? json({ personaId: 'bookkeeper', kind: 'research', jobId: 'job_01abc', say: 'Started.' }, 202) : json(team()));
    await act(() => render(<Team />, host));
    await flush();
    const lead = slimIndex.lead('lead-steady-operator')!;
    expect(host.querySelector('#team-chief-name')?.textContent).toBe(lead.name.split(' ')[0]);
    expect(host.querySelector('.team-chief .team-title')?.textContent).toBe(`Chief of Staff · ${lead.archetype}`);
    const cards = [...host.querySelectorAll('.team-card')];
    expect(cards.map((c) => c.id)).toEqual(STARTER_TEAM.map((m) => m.personaId));
    const bookkeeper = host.querySelector('#bookkeeper')!;
    expect(bookkeeper.querySelector('.team-name')?.textContent).toBe(slimIndex.persona('bookkeeper')!.name);
    expect(bookkeeper.querySelector('.team-task strong')?.textContent).toBe('A simple monthly money check-in');
    const start = [...bookkeeper.querySelectorAll('button')].find((b) => b.textContent === 'Start')!;
    await act(async () => void start.click());
    await flush();
    expect(calls.find((c) => c.method === 'POST')!.url).toBe('/api/team/bookkeeper/start');
    expect(bookkeeper.querySelector('a[href="/app/projects?at=job_01abc"]')?.textContent).toContain('Started · see it');
    // The steward keeps the second brain tidy every week.
    const steward = host.querySelector('#knowledge-librarian')!;
    expect(steward.querySelector('.team-task-label')?.textContent).toBe('Every week');
    expect([...steward.querySelectorAll('button')].some((b) => b.textContent === 'Tidy now')).toBe(true);
  });

  it('asks before letting someone go, and Keep leaves them on the team', async () => {
    respond = (c) => (c.method === 'DELETE' ? json({ ...team(), members: team().members.filter((m) => m.personaId !== 'bookkeeper') }) : json(team()));
    await act(() => render(<Team />, host));
    await flush();
    const card = () => host.querySelector('#bookkeeper');
    const first = slimIndex.persona('bookkeeper')!.name.split(' ')[0]!;
    const buttons = () => [...card()!.querySelectorAll('button')];
    await act(() => buttons().find((b) => b.getAttribute('aria-label') === `Let ${first} go`)!.click());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(document.activeElement?.textContent).toBe(`Keep ${first}`);
    await act(() => buttons().find((b) => b.textContent === `Keep ${first}`)!.click());
    expect(buttons().some((b) => b.textContent === `Let ${first} go`)).toBe(false);
    await act(() => buttons().find((b) => b.getAttribute('aria-label') === `Let ${first} go`)!.click());
    await act(() => buttons().find((b) => b.textContent === `Let ${first} go`)!.click());
    await flush();
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/team/bookkeeper');
    expect(card()).toBeNull();
  });
});
