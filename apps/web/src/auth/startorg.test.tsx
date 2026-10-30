// Signed in with Google but in no organization yet: start one (the app opens at its first-day setup), or, when sign-up
// is invite-only, see who to ask.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';
import { auth, checkAuth, currentOrg, isPlatform } from './session';

let host: HTMLElement;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('starting an organization', () => {
  it('asks a new person to name their office, then opens it at the first-day setup', async () => {
    const posts: unknown[] = [];
    const assign = vi.fn();
    vi.stubGlobal('location', { ...location, assign, href: 'http://localhost/app', pathname: '/app', search: '' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url === '/api/auth/me') return json({ mode: 'google', signedIn: true, email: 'dana@cafe.example', name: 'Dana Reyes', role: 'reader', needsOrg: true, canCreateOrg: true });
        if (url === '/api/orgs' && init.method === 'POST') {
          posts.push(JSON.parse(String(init.body)));
          return json({ org: { orgId: 'org_aaaaaaaaaaaa', name: 'Harbor Café', role: 'owner' } }, 201);
        }
        return json({});
      }),
    );
    await checkAuth();
    expect(auth.value).toMatchObject({ status: 'needs-org', canCreate: true });
    await act(() => render(<AuthGate>app</AuthGate>, host));
    expect(host.querySelector('h1')?.textContent).toBe('Welcome, Dana');
    expect(host.textContent).not.toContain('app');
    const input = host.querySelector<HTMLInputElement>('#org-name')!;
    await act(() => {
      input.value = 'Harbor Café';
      input.dispatchEvent(new Event('input'));
    });
    await act(() => void host.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true })));
    await flush();
    expect(posts).toEqual([{ name: 'Harbor Café' }]);
    expect(assign).toHaveBeenCalledWith('/app/welcome');
  });

  it('invite-only: says who to ask instead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'google', signedIn: true, email: 'ivy@example.com', name: 'Ivy', role: 'reader', needsOrg: true })));
    await checkAuth();
    await act(() => render(<AuthGate>app</AuthGate>, host));
    expect(host.textContent).toContain('Agent Workplace is invite-only right now');
    expect(host.querySelector('#org-name')).toBeNull();
  });

  it('a member: the app, with their organization and whether they run the platform', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'google', signedIn: true, email: 'sam@example.com', name: 'Sam', role: 'contributor', org: { orgId: 'org_bbbbbbbbbbbb', name: 'Studio' } })));
    await checkAuth();
    await act(() => render(<AuthGate>app</AuthGate>, host));
    expect(host.textContent).toBe('app');
    expect(currentOrg.value).toEqual({ orgId: 'org_bbbbbbbbbbbb', name: 'Studio' });
    expect(isPlatform.value).toBe(false);
  });
});
