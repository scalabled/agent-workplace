// The office's own name at the top of the app, the switcher between offices (people signed in with Google), and the
// Admin page for someone who is not an owner: they cannot change settings, but they can switch or start an office.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth, canCreateOrg, currentOrg, myOrgs, role } from '../auth/session';
import { Admin } from '../routes/Admin';
import { OfficeSwitcher } from './OfficeSwitcher';

let host: HTMLElement;
let calls: { url: string; method: string }[] = [];
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ORGS = [
  { orgId: 'local', name: 'Amethyst & Co', role: 'owner', home: true },
  { orgId: 'org_aaaaaaaaaaaa', name: 'The Pottery Barn Loft', role: 'contributor' },
];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET' });
      if (url === '/api/orgs') return json({ orgs: ORGS, current: 'local', canCreate: true });
      if (url.endsWith('/switch')) return json({ error: { code: 'forbidden', message: 'You are no longer in that office.' } }, 403);
      return json({});
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  auth.value = { status: 'signed-in', email: 'sam@example.com', name: 'Sam' };
  currentOrg.value = { orgId: 'local', name: 'Amethyst & Co' };
  myOrgs.value = null;
  canCreateOrg.value = true;
  role.value = 'owner';
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  auth.value = { status: 'checking' };
  currentOrg.value = null;
  myOrgs.value = null;
  role.value = 'owner';
});

describe('the office at the top of the app', () => {
  it('shows the office’s own name; on this computer (sign-in off) there is nothing to switch', async () => {
    auth.value = { status: 'open' };
    await act(() => render(<OfficeSwitcher />, host));
    expect(host.querySelector('.nav-brand-name')?.textContent).toBe('Amethyst & Co');
    expect(host.querySelector('button')).toBeNull();
  });

  it('signed in: lists your offices, marks this one, switches to another, and offers to start one', async () => {
    await act(() => render(<OfficeSwitcher />, host));
    const button = host.querySelector<HTMLButtonElement>('.nav-brand-button')!;
    expect(button.getAttribute('aria-label')).toBe('Amethyst & Co: switch office');
    await act(() => button.click());
    await flush();
    const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(items.map((b) => b.querySelector('.office-menu-name')?.textContent)).toEqual(['Amethyst & Co', 'The Pottery Barn Loft']);
    expect(items[0]!.getAttribute('aria-checked')).toBe('true');
    expect(items[0]!.disabled).toBe(true);
    expect(host.textContent).toContain('Start another office');
    expect(host.textContent).toContain('Rename this office');
    await act(() => items[1]!.click());
    await flush();
    expect(calls.some((c) => c.url === '/api/orgs/org_aaaaaaaaaaaa/switch' && c.method === 'POST')).toBe(true);
    expect(host.querySelector('.form-error')?.textContent).toBe('You are no longer in that office.');
  });
});

describe('Admin for someone who is not an owner', () => {
  it('says only owners change settings, and still lets them switch or start an office', async () => {
    role.value = 'contributor';
    await act(() => render(<Admin />, host));
    await flush();
    expect(host.textContent).toContain('Only owners can change the office’s settings');
    expect(host.querySelector('#org-rename')).toBeNull();
    expect(host.textContent).toContain('Your other offices');
    expect(host.textContent).toContain('The Pottery Barn Loft');
    expect(host.querySelector('#org-new')).not.toBeNull();
  });
});
