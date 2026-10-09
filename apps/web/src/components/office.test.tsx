// The office's own name at the top of the app, the switcher between offices (people signed in with Google), and the
// Admin page for someone who is not an owner: they cannot change settings, but they can switch or start an office.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth, canCreateOrg, currentOrg, myOrgs, role } from '../auth/session';
import { officeDialog, OfficeDialogs } from '../admin/OfficeDialogs';
import { Admin } from '../routes/Admin';
import { OfficeSwitcher } from './OfficeSwitcher';

let host: HTMLElement;
let calls: { url: string; method: string; body?: unknown }[] = [];
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
      calls.push({ url, method: init.method ?? 'GET', ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) } : {}) });
      if (url === '/api/orgs' && init.method === 'POST') return json({ error: { code: 'conflict', message: 'You have started as many offices as you can.' } }, 409);
      if (url === '/api/orgs') return json({ orgs: ORGS, current: 'local', canCreate: true });
      if (url === '/api/org' && init.method === 'PUT') return json({ org: { orgId: 'local', name: JSON.parse(String(init.body)).name } });
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
  officeDialog.value = null;
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

describe('renaming and starting an office: a dialog where you are', () => {
  const type = (input: HTMLInputElement, value: string) =>
    act(() => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const submit = () => act(() => void document.querySelector('.dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

  it('Rename this office opens a dialog with the name; saving renames it and closes', async () => {
    await act(() => render(
      <>
        <OfficeSwitcher />
        <OfficeDialogs />
      </>,
      host,
    ));
    await act(() => host.querySelector<HTMLButtonElement>('.nav-brand-button')!.click());
    await act(() => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.includes('Rename'))!.click());
    expect(host.querySelector('[role="menu"]')).toBeNull();
    const dialog = document.querySelector('.dialog')!;
    expect(dialog.querySelector('#dialog-title')?.textContent).toBe('Rename this office');
    const input = dialog.querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('Amethyst & Co');
    await type(input, 'Amethyst & Co Crystals');
    await submit();
    await flush();
    expect(calls.find((c) => c.url === '/api/org')?.body).toEqual({ name: 'Amethyst & Co Crystals' });
    expect(currentOrg.value?.name).toBe('Amethyst & Co Crystals');
    expect(document.querySelector('.dialog')).toBeNull();
  });

  it('Start another office opens a dialog; a refusal shows under the field and it stays open', async () => {
    await act(() => render(
      <>
        <OfficeSwitcher />
        <OfficeDialogs />
      </>,
      host,
    ));
    await act(() => host.querySelector<HTMLButtonElement>('.nav-brand-button')!.click());
    await act(() => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.includes('Start another'))!.click());
    const dialog = document.querySelector('.dialog')!;
    expect(dialog.querySelector('#dialog-title')?.textContent).toBe('Start another office');
    const start = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Start the office')!;
    expect(start.disabled).toBe(true);
    await type(dialog.querySelector<HTMLInputElement>('input')!, 'Lune Bakery');
    expect(start.disabled).toBe(false);
    await submit();
    await flush();
    expect(calls.find((c) => c.url === '/api/orgs' && c.method === 'POST')?.body).toEqual({ name: 'Lune Bakery' });
    expect(document.querySelector('.dialog [role="alert"]')?.textContent).toBe('You have started as many offices as you can.');
  });
});

describe('Admin for someone who is not an owner', () => {
  it('says only owners change settings, and still lets them switch or start an office', async () => {
    role.value = 'contributor';
    await act(() => render(<Admin />, host));
    await flush();
    expect(host.textContent).toContain('Only owners can change the office’s settings');
    const org = host.querySelector('#organization')!;
    expect([...org.querySelectorAll('button')].some((b) => b.textContent === 'Rename')).toBe(false);
    expect(org.textContent).toContain('Your offices');
    expect(org.textContent).toContain('The Pottery Barn Loft');
    expect(org.textContent).toContain('You’re here');
    expect([...org.querySelectorAll('button')].some((b) => b.textContent?.includes('Start another office'))).toBe(true);
    expect(org.querySelector('input')).toBeNull();
  });
});
