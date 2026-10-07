// The app's front door when sign-in is on: nothing of the app (socket, audio, catalog) loads until the person is
// signed in and in an organization. Someone new starts their own office here first. Locally (sign-in off) it renders
// the app straight away.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { auth, checkAuth, createOrg, signInHref, signOut, type SignInReason } from './session';
import './auth.css';
import { BRAND } from '@headcount/protocol';
import { ORG_NAME_MAX } from '@headcount/protocol/ext/orgs';

const REASON_TEXT: Record<SignInReason, string> = {
  denied: 'That Google account cannot start an office here right now, and nobody has invited it yet. Ask an owner to add you on their People page.',
  failed: 'Google sign-in did not finish. Please try again.',
  expired: 'Your session ended. Sign in again to pick up where you left off.',
  unconfigured: 'Sign-in is not set up on this server yet (the Google client secret is missing).',
};

function GoogleMark() {
  return (
    <svg class="signin-g" viewBox="0 0 18 18" aria-hidden="true" width="18" height="18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.94v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.96 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.05l3.02-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .94 4.95l3.02 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export function SignIn({ reason }: { reason: SignInReason | null }) {
  return (
    <main class="signin" aria-labelledby="signin-title">
      <div class="signin-card">
        <a class="signin-brand" href="/">
          <span class="signin-dot" aria-hidden="true" /> {BRAND.name}
        </a>
        <h1 id="signin-title">Sign in to your office</h1>
        <p class="signin-lede">Your Chief of Staff and your team are waiting. New here? The same button starts your own office.</p>
        {reason && (
          <p class="signin-note" role="alert">
            {REASON_TEXT[reason]}
          </p>
        )}
        <a class="signin-google" href={signInHref()}>
          <GoogleMark />
          Continue with Google
        </a>
        <p class="signin-fine">Your office is yours alone: your team, files and memory are never shared with another one. Everyone in it but you (and anyone you invite) is an AI coworker.</p>
      </div>
    </main>
  );
}

/** Signed in, with no organization yet: name your office (a business, a team, a project), or wait for an invitation. */
export function StartOrg({ name, email, canCreate }: { name: string; email: string; canCreate: boolean }) {
  const [org, setOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = name.split(' ')[0] || 'there';
  const start = async (e: Event) => {
    e.preventDefault();
    if (org.trim().length < 2 || busy) return;
    setBusy(true);
    setError(await createOrg(org.trim()));
    setBusy(false);
  };
  return (
    <main class="signin" aria-labelledby="startorg-title">
      <div class="signin-card">
        <a class="signin-brand" href="/">
          <span class="signin-dot" aria-hidden="true" /> {BRAND.name}
        </a>
        <h1 id="startorg-title">Welcome, {first}</h1>
        {canCreate ? (
          <form class="startorg" onSubmit={start}>
            <p class="signin-lede">Start your office. Next you choose your Chief of Staff, then hire your first coworkers.</p>
            <label class="startorg-label" for="org-name">
              What is it for?
            </label>
            <input id="org-name" class="startorg-input" placeholder="Your business, team or project" maxLength={ORG_NAME_MAX} value={org} onInput={(e) => setOrg((e.target as HTMLInputElement).value)} autoFocus />
            {error && (
              <p class="signin-note" role="alert">
                {error}
              </p>
            )}
            <button type="submit" class="signin-google startorg-go" disabled={busy || org.trim().length < 2}>
              {busy ? 'Opening your office…' : 'Start my office'}
            </button>
          </form>
        ) : (
          <p class="signin-note" role="status">
            {BRAND.name} is invite-only right now. Ask someone to invite <strong>{email}</strong>: they add it on their People page, and you will find their office here.
          </p>
        )}
        <p class="signin-fine">
          Signed in as {email}.{' '}
          <button type="button" class="link-button" onClick={() => void signOut()}>
            Sign out
          </button>
        </p>
      </div>
    </main>
  );
}

export function AuthGate({ children }: { children: ComponentChildren }) {
  const state = auth.value;
  useEffect(() => {
    if (state.status === 'checking') void checkAuth();
  }, []);
  if (state.status === 'checking') return <div class="boot" aria-busy="true" />;
  if (state.status === 'signed-out') return <SignIn reason={state.reason} />;
  if (state.status === 'needs-org') return <StartOrg name={state.name} email={state.email} canCreate={state.canCreate} />;
  return <>{children}</>;
}
