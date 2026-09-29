// Who is signed in (Google sign-in, apps/worker/src/auth/auth.ts). The app itself only loads once this says the
// owner may be here: signed in, or sign-in is off (local dev on localhost).
import { signal } from '@preact/signals';

export type SignInReason = 'denied' | 'failed' | 'expired' | 'unconfigured';

export type AuthState =
  | { status: 'checking' }
  | { status: 'open' } // sign-in off (loopback dev)
  | { status: 'signed-in'; email: string; name: string }
  | { status: 'signed-out'; reason: SignInReason | null };

export const auth = signal<AuthState>({ status: 'checking' });

const REASONS: readonly SignInReason[] = ['denied', 'failed', 'expired', 'unconfigured'];

/** Read and remove ?signin=<reason> (set by the worker after a failed sign-in) from the address bar. */
export function takeSignInReason(): SignInReason | null {
  const url = new URL(location.href);
  const raw = url.searchParams.get('signin');
  if (raw === null) return null;
  url.searchParams.delete('signin');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  return (REASONS as readonly string[]).includes(raw) ? (raw as SignInReason) : 'failed';
}

interface MeResponse {
  mode: 'google' | 'off';
  signedIn: boolean;
  email?: string;
  name?: string;
}

/** Ask the worker. A worker without /api/auth (older build) or an unreachable one counts as open: the API still gates. */
export async function checkAuth(fetcher: typeof fetch = fetch): Promise<AuthState> {
  const reason = takeSignInReason();
  let next: AuthState;
  try {
    const res = await fetcher('/api/auth/me', { headers: { accept: 'application/json' } });
    if (res.status === 404) next = { status: 'open' };
    else {
      const me = (await res.json()) as MeResponse;
      if (me.mode === 'off') next = { status: 'open' };
      else if (me.signedIn) next = { status: 'signed-in', email: me.email ?? '', name: me.name ?? '' };
      else next = { status: 'signed-out', reason };
    }
  } catch {
    next = { status: 'open' };
  }
  auth.value = next;
  return next;
}

/** Any API answer of 401 "unauthenticated" (an expired session) sends the owner back to the sign-in screen. */
export function noteUnauthenticated(): void {
  if (auth.value.status !== 'signed-out') auth.value = { status: 'signed-out', reason: 'expired' };
}

export function signInHref(returnTo = location.pathname + location.search): string {
  return `/api/auth/google?return=${encodeURIComponent(returnTo.startsWith('/app') ? returnTo : '/app')}`;
}

export async function signOut(fetcher: typeof fetch = fetch): Promise<void> {
  try {
    await fetcher('/api/auth/logout', { method: 'POST' });
  } finally {
    location.assign('/');
  }
}
