// Who is signed in (Google sign-in, apps/worker/src/auth/auth.ts), and their role. The app itself only loads once this
// says they may be here: signed in as a member, or sign-in is off (local dev on localhost, where you are the owner).
// The role shapes what the app offers (readers read; contributors work with the team; owners also configure); the
// worker enforces it on every call either way.
import { computed, signal } from '@preact/signals';
import { atLeast, type Me, type Role } from '@headcount/protocol/ext/admin';

export type SignInReason = 'denied' | 'failed' | 'expired' | 'unconfigured';

export type AuthState =
  | { status: 'checking' }
  | { status: 'open' } // sign-in off (loopback dev)
  | { status: 'signed-in'; email: string; name: string }
  | { status: 'signed-out'; reason: SignInReason | null };

export const auth = signal<AuthState>({ status: 'checking' });

/** The role in effect (after "view as"); the owner until told otherwise (local mode). */
export const role = signal<Role>('owner');
/** Their own role while they preview a lower one ("view as"). */
export const actualRole = signal<Role | null>(null);
export const mayContribute = computed(() => atLeast(role.value, 'contributor'));
export const isOwner = computed(() => role.value === 'owner');

function applyRole(r: Role, actual?: Role): void {
  role.value = r;
  actualRole.value = actual ?? null;
  if (typeof document !== 'undefined') document.documentElement.dataset.role = r;
}

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

type MeResponse = Me;

/** Ask the worker. A worker without /api/auth (older build) or an unreachable one counts as open: the API still gates. */
export async function checkAuth(fetcher: typeof fetch = fetch): Promise<AuthState> {
  const reason = takeSignInReason();
  let next: AuthState;
  try {
    const res = await fetcher('/api/auth/me', { headers: { accept: 'application/json' } });
    if (res.status === 404) next = { status: 'open' };
    else {
      const me = (await res.json()) as MeResponse;
      applyRole(me.role ?? 'owner', me.actualRole);
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

/** Preview the app as a lower role (null: back to your own). Reloads, so everything is drawn for that role. */
export async function viewAs(r: 'contributor' | 'reader' | null, fetcher: typeof fetch = fetch): Promise<void> {
  await fetcher('/api/auth/view-as', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: r }) });
  location.reload();
}

export async function signOut(fetcher: typeof fetch = fetch): Promise<void> {
  try {
    await fetcher('/api/auth/logout', { method: 'POST' });
  } finally {
    location.assign('/');
  }
}
