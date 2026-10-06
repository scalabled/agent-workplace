// Hiring a new office's first coworkers: the Chief's suggestions as cards (what each will do, their first job), the
// recommended ones picked on a first visit, anyone else found by role, and hiring lands in Talk with the greeting.
import type { SuggestResponse } from '@headcount/protocol/ext/team';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slimIndex } from '@headcount/catalog/slim';
import { role } from '../auth/session';
import { catalog } from '../catalog';
import { navigate, path, paths } from '../router';
import { settings, teamIds } from '../store';
import { greetOnArrival } from '../talk/draft';
import { Hire } from './Hire';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let host: HTMLElement;
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text));

const suggestions: SuggestResponse = {
  about: 'An online crystal shop',
  candidates: [
    { personaId: 'ecommerce-manager', why: 'Runs your online store. Used to working with retail and online shops.', does: ['Funnel diagnosis and fix list'], firstTask: { kind: 'research', title: 'Store check-up', brief: 'x' }, recommended: true },
    { personaId: 'social-media-manager', why: 'Keeps your socials busy.', does: ['Social media plan'], firstTask: { kind: 'project', title: 'A month of posts', brief: 'x' }, recommended: true },
    { personaId: 'bookkeeper', why: 'Keeps the money side clear.', does: ['Bank reconciliation'], firstTask: { kind: 'research', title: 'Money check-in', brief: 'x' }, recommended: false },
  ],
};

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
      calls.push(call);
      if (url.startsWith('/api/team/suggest')) return json(suggestions);
      if (url === '/api/team/hire') return json({ hired: (call.body as { personaIds: string[] }).personaIds, team: { members: (call.body as { personaIds: string[] }).personaIds.map((personaId) => ({ personaId, why: '', does: [], firstTask: { kind: 'research', title: '', brief: '' } })), secondBrain: { on: true, steward: 'knowledge-librarian' } } }, 201);
      if (url === '/api/handbook') return json({ sections: [{ id: 'business', title: 'The business', content: '' }], interviewing: false, markdown: '' });
      return json({});
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  catalog.value = slimIndex;
  settings.value = { workspaceId: 'org_aaaaaaaaaaaa', leadId: 'lead-steady-operator', chiefName: 'Eddie', voiceOn: false, updatedAt: '' };
  role.value = 'owner';
  teamIds.value = [];
  greetOnArrival.value = false;
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('Hire', () => {
  it('first visit: the Chief’s picks are chosen; hiring them lands in Talk with the greeting', async () => {
    navigate(`${paths.hire}?first=1`);
    await act(() => render(<Hire />, host));
    await flush();
    expect(host.querySelector('h1')?.textContent).toBe('Hire your first coworkers');
    const cards = [...host.querySelectorAll('.hire-card')];
    expect(cards).toHaveLength(3);
    expect(cards[0]!.textContent).toContain('Eddie’s pick');
    expect(cards[0]!.textContent).toContain('First job: Store check-up');
    expect(cards.map((c) => c.hasAttribute('data-picked'))).toEqual([true, true, false]);
    // Add the bookkeeper, then hire all three.
    await act(() => cards[2]!.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());
    await act(() => button('Hire 3')!.click());
    await flush();
    expect(calls.find((c) => c.url === '/api/team/hire')?.body).toEqual({ personaIds: ['ecommerce-manager', 'social-media-manager', 'bookkeeper'] });
    expect(teamIds.value).toEqual(['ecommerce-manager', 'social-media-manager', 'bookkeeper']);
    expect(path.value).toBe(paths.talk);
    expect(greetOnArrival.value).toBe(true);
  });

  it('says what the business does to get suggestions (and starts the Handbook); finds anyone else by role', async () => {
    navigate(paths.hire);
    await act(() => render(<Hire />, host));
    await flush();
    expect([...host.querySelectorAll('.hire-card')].some((c) => c.hasAttribute('data-picked'))).toBe(false);
    const about = host.querySelector<HTMLTextAreaElement>('#hire-about')!;
    expect(about.value).toBe('An online crystal shop');
    await act(() => {
      about.value = 'An online crystal shop selling gemstones on Etsy';
      about.dispatchEvent(new Event('input'));
    });
    await act(() => void host.querySelector<HTMLFormElement>('.hire-about')!.dispatchEvent(new Event('submit', { cancelable: true })));
    await flush();
    expect(calls.some((c) => c.url === `/api/team/suggest?about=${encodeURIComponent('An online crystal shop selling gemstones on Etsy')}`)).toBe(true);
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/handbook/business')?.body).toEqual({ content: 'An online crystal shop selling gemstones on Etsy' });
    const search = host.querySelector<HTMLInputElement>('.hire-more input[type=search]')!;
    await act(() => {
      search.value = 'video';
      search.dispatchEvent(new Event('input'));
    });
    expect(host.querySelectorAll('.hire-row').length).toBeGreaterThan(0);
  });

  it('only owners hire', async () => {
    role.value = 'contributor';
    await act(() => render(<Hire />, host));
    expect(host.textContent).toContain('Only an owner can hire.');
  });
});
