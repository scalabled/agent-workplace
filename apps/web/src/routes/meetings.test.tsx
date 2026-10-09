// Meetings: call one with people from your team (the first chairs, the Chief moderates) and land in its room; the room
// shows the table, who has the floor, the lines as said, and once it is over what they agreed (to make a project of).
import type { ChannelEntry, MeetingResponse, MeetingSummary } from '@headcount/protocol/ext/projects';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slimIndex } from '@headcount/catalog/slim';
import { role } from '../auth/session';
import { catalog } from '../catalog';
import { navigate, path, paths } from '../router';
import { applyFrame, liveMeetings, meetingsById, settings, teamIds } from '../store';
import { draft } from '../talk/draft';
import { MeetingRoom, Meetings } from './Meetings';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let host: HTMLElement;
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text));

const live: MeetingSummary = {
  meetingId: 'mtg_01j000000000000000000000aa',
  projectId: 'prj_01j000000000000000000000aa',
  kind: 'meeting',
  question: 'Should we launch a crystal subscription box?',
  title: 'Should we launch a crystal subscription box?',
  standalone: true,
  chairId: 'market-research-analyst',
  people: ['market-research-analyst', 'bookkeeper'],
  status: 'live',
  rounds: 1,
  startedAt: '2026-10-06T20:00:00.000Z',
  lines: 1,
  speakerId: 'market-research-analyst',
};
const team = [
  { personaId: 'market-research-analyst', name: 'Mateo Rivera', title: 'Market Research Analyst', role: 'lead' as const, why: '' },
  { personaId: 'bookkeeper', name: 'Trisha Bookkeeper', title: 'Bookkeeper', role: 'specialist' as const, why: '' },
];
const entry = (seq: number, fromId: string, text: string, phase?: ChannelEntry['phase']): ChannelEntry => ({ seq, projectId: live.projectId, kind: fromId === 'owner' ? 'owner' : 'discussion', fromId, text, at: live.startedAt, meetingId: live.meetingId, ...(phase ? { phase } : {}) });
let room: MeetingResponse;

beforeEach(() => {
  calls = [];
  room = { meeting: live, team, entries: [entry(1, 'owner', "Let's meet about: Should we launch a crystal subscription box?"), entry(2, 'chief', 'We’re meeting about it. Mateo chairs.', 'moderator')] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
      calls.push(call);
      if (url === '/api/meetings' && call.method === 'GET') return json({ meetings: [] });
      if (url === '/api/meetings' && call.method === 'POST') return json({ meeting: live }, 202);
      if (url === `/api/meetings/${live.meetingId}`) return json(room);
      if (url === `/api/meetings/${live.meetingId}/work` && call.method === 'POST') return json({ project: { projectId: 'prj_01j000000000000000000000bb', title: 'Crystal box launch', goal: 'x', team, steps: [], status: 'planning', createdAt: live.startedAt, updatedAt: live.startedAt, staffingNote: '', recipeId: null, recipeName: null, startsNow: true } }, 202);
      return json({});
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  catalog.value = slimIndex;
  settings.value = { workspaceId: 'org_aaaaaaaaaaaa', leadId: 'lead-steady-operator', chiefName: 'Eddie', voiceOn: false, updatedAt: '' };
  role.value = 'owner';
  teamIds.value = ['bookkeeper', 'market-research-analyst', 'social-media-manager'];
  meetingsById.value = {};
  draft.value = '';
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('Meetings', () => {
  it('calls a meeting with people from the team (the first picked chairs) and opens its room', async () => {
    navigate(paths.meetings);
    await act(() => render(<Meetings />, host));
    await flush();
    expect(host.textContent).toContain('No one is meeting right now.');
    expect(host.textContent).toContain('EddieChief of StaffModerates');
    const topic = host.querySelector<HTMLTextAreaElement>('.call-meeting textarea')!;
    await act(() => {
      topic.value = 'Should we launch a crystal subscription box?';
      topic.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const chip = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button.seat-chip')].find((b) => b.textContent?.includes(name))!;
    await act(() => chip('Mateo').click());
    await act(() => chip('Trisha').click());
    // The first picked chairs: a tag beside their title, never in place of it.
    expect(chip('Mateo').textContent).toBe('MCMateoMarket research analystChairs');
    expect(chip('Trisha').textContent).toBe('TMTrishaBookkeeper');
    await act(() => button('Start the meeting')!.click());
    await flush();
    // By default the people get started on what they agree once it ends.
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ topic: 'Should we launch a crystal subscription box?', people: ['market-research-analyst', 'bookkeeper'], rounds: 1, followUp: true });
    expect(path.value).toBe(paths.meeting(live.meetingId));
    expect(liveMeetings.value.map((m) => m.meetingId)).toEqual([live.meetingId]);
  });

  it('the room: the table with the Chief moderating, who has the floor, the lines; when it ends, what they agreed', async () => {
    navigate(paths.meeting(live.meetingId));
    await act(() => render(<MeetingRoom meetingId={live.meetingId} />, host));
    await flush();
    expect(host.querySelector('h1')?.textContent).toBe('Should we launch a crystal subscription box?');
    expect(host.querySelector('.page-lede')?.textContent).toContain('Mateo has the floor.');
    expect([...host.querySelectorAll('.room-seat figcaption')].map((f) => f.textContent)).toEqual(['EddieChief of StaffModerates', 'MateoMarket research analystChairs', 'TrishaBookkeeper']);
    expect(host.querySelector('.room-seat[data-speaking]')?.textContent).toContain('Mateo');
    expect(host.querySelectorAll('.room-line')).toHaveLength(3); // two lines and "Mateo is speaking…"
    expect(host.querySelector('.meeting-floor')).not.toBeNull();
    // It ends (a frame): the outcome shows, and Start the work starts it with the people at the table.
    room = { ...room, meeting: { ...live, status: 'done', speakerId: undefined, summary: 'Launch a 3-month box at $39; Trisha checks margins first.' } as MeetingSummary };
    await act(() => void applyFrame({ type: 'meeting.updated', streamId: 'ws:local', seq: 9, ts: live.startedAt, data: { meeting: room.meeting } } as never));
    await flush();
    expect(host.textContent).toContain('What they agreed');
    expect(host.querySelector('.meeting-floor')).toBeNull();
    await act(() => button('Start the work')!.click());
    await flush();
    expect(calls.some((c) => c.method === 'POST' && c.url === `/api/meetings/${live.meetingId}/work`)).toBe(true);
    expect(path.value).toBe(paths.project('prj_01j000000000000000000000bb'));
  });
});
