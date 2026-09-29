// The app's front door when sign-in is on: nothing of the app (socket, audio, catalog) loads until the owner is
// signed in. Locally (sign-in off) it renders the app straight away.
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { auth, checkAuth, signInHref, type SignInReason } from './session';
import './auth.css';

const REASON_TEXT: Record<SignInReason, string> = {
  denied: 'That Google account is not on this office’s owner list. Try the account you set up Headcount with.',
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
          <span class="signin-dot" aria-hidden="true" /> Headcount
        </a>
        <h1 id="signin-title">Sign in to your office</h1>
        <p class="signin-lede">Your Chief of Staff and the team are waiting.</p>
        {reason && (
          <p class="signin-note" role="alert">
            {REASON_TEXT[reason]}
          </p>
        )}
        <a class="signin-google" href={signInHref()}>
          <GoogleMark />
          Continue with Google
        </a>
        <p class="signin-fine">Only the owner’s Google account can sign in. Everyone here is an AI coworker.</p>
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
  return <>{children}</>;
}
