// Who is signed in (Google sign-in, apps/worker/src/auth/auth.ts), their organization and their role in it. The app
// itself only loads once this says they may be here: signed in as a member of an organization, or sign-in is off
// (local dev on localhost, where you are the owner). Signed in without an organization yet: they start one.
// The role shapes what the app offers (readers read; contributors work with the team; owners also configure); the
// worker enforces it on every call either way.
import { computed, signal } from '@preact/signals';
import { atLeast, type Me, type Role } from '@headcount/protocol/ext/admin';
import type { OrgView, OrgsResponse } from '@headcount/protocol/ext/orgs';

export type SignInReason = 'denied' | 'failed' | 'expired' | 'unconfigured';

export type AuthState =
  | { status: 'checking' }
  | { status: 'open' } // sign-in off (loopback dev)
  | { status: 'signed-in'; email: string; name: string }
  | { status: 'needs-org'; email: string; name: string; canCreate: boolean }
  | { status: 'signed-out'; reason: SignInReason | null };

/** The organization this session works in (its name shows in the app). */
export const currentOrg = signal<{ orgId: string; name: string } | null>(null);
/** May start another organization. */
export const canCreateOrg = signal(false);
/** Every office this person belongs to (signed in with Google), loaded when first needed (the switcher, ⌘K). */
export const myOrgs = signal<OrgView[] | null>(null);
export async function loadOrgs(fetcher: typeof fetch = fetch): Promise<void> {
  if (auth.value.status !== 'signed-in') return;
  try {
    const res = await fetcher('/api/orgs', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const r = (await res.json()) as OrgsResponse;
    myOrgs.value = r.orgs;
    canCreateOrg.value = r.canCreate;
  } catch {
    /* the switcher shows only this office */
  }
}
/** One of the deployment's owners (sees the platform page; makes the shared portraits). */
export const isPlatform = signal(false);

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
      currentOrg.value = me.org ?? null;
      canCreateOrg.value = !!me.canCreateOrg;
      isPlatform.value = me.mode === 'off' || !!me.platform;
      if (me.mode === 'off') next = { status: 'open' };
      else if (me.signedIn && me.needsOrg) next = { status: 'needs-org', email: me.email ?? '', name: me.name ?? '', canCreate: !!me.canCreateOrg };
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

/** Start an organization (you become its owner); the app then opens in it, at its first-day setup. */
export async function createOrg(name: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const res = await fetcher('/api/orgs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  if (!res.ok) return ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? 'That did not work. Try again.';
  location.assign('/app/welcome');
  return null;
}

/** Work in another organization you belong to: the app reloads in it. */
export async function switchOrg(orgId: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const res = await fetcher(`/api/orgs/${encodeURIComponent(orgId)}/switch`, { method: 'POST' });
  if (!res.ok) return ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? 'That did not work. Try again.';
  location.assign('/app');
  return null;
}

