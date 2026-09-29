import { beforeEach, describe, expect, it } from 'vitest';
import { auth, checkAuth, noteUnauthenticated, signInHref, takeSignInReason } from './session';

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

beforeEach(() => {
  auth.value = { status: 'checking' };
  history.replaceState(null, '', '/app');
});

describe('auth session', () => {
  it('is open when sign-in is off (local dev)', async () => {
    expect(await checkAuth(reply(200, { mode: 'off', signedIn: true }))).toEqual({ status: 'open' });
  });

  it('is signed in with the owner email', async () => {
    expect(await checkAuth(reply(200, { mode: 'google', signedIn: true, email: 'o@example.com', name: 'O' }))).toEqual({ status: 'signed-in', email: 'o@example.com', name: 'O' });
  });

  it('is signed out, carrying and removing the ?signin reason from the address bar', async () => {
    history.replaceState(null, '', '/app?signin=denied&x=1');
    const state = await checkAuth(reply(200, { mode: 'google', signedIn: false }));
    expect(state).toEqual({ status: 'signed-out', reason: 'denied' });
    expect(location.search).toBe('?x=1');
  });

  it('maps an unknown reason to failed, and no reason to null', () => {
    history.replaceState(null, '', '/app?signin=weird');
    expect(takeSignInReason()).toBe('failed');
    expect(takeSignInReason()).toBeNull();
  });

  it('treats an older worker without /api/auth as open', async () => {
    expect(await checkAuth(reply(404, {}))).toEqual({ status: 'open' });
  });

  it('a 401 mid-session sends the owner to sign in again', () => {
    auth.value = { status: 'signed-in', email: 'o@example.com', name: '' };
    noteUnauthenticated();
    expect(auth.value).toEqual({ status: 'signed-out', reason: 'expired' });
  });

  it('only ever returns into the app after sign-in', () => {
    expect(signInHref('/app/floor?view=office')).toBe('/api/auth/google?return=%2Fapp%2Ffloor%3Fview%3Doffice');
    expect(signInHref('/pricing')).toBe('/api/auth/google?return=%2Fapp');
  });
});
