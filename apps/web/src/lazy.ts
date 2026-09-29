// The two lazy halves of the web app: the public landing page ("/") and the app ("/app/…").
import type { ComponentType } from 'preact';

export type Loader = () => Promise<ComponentType>;

export const loadLanding: Loader = () => import('./landing/Landing').then((m) => m.Landing);
export const loadApp: Loader = () => import('./app').then((m) => m.App);

let appPrefetch: Promise<unknown> | null = null;

/** Warm the app chunk when someone shows intent to walk in (hover, focus or touch on a CTA). */
export function prefetchApp(): void {
  appPrefetch ??= loadApp().catch(() => (appPrefetch = null));
}

/** The Office view on the Floor (OFFICE-PHASE2 §4.5.1): its own chunk, never loaded by Directory users. */
export const loadOffice = () => import('./office/OfficeView').then((m) => m.OfficeView);

let officePrefetch: Promise<unknown> | null = null;

/** Warm the office chunk (the Floor is about to show the Office). */
export function prefetchOffice(): Promise<unknown> {
  officePrefetch ??= loadOffice().catch((err: unknown) => {
    officePrefetch = null;
    throw err;
  });
  return officePrefetch;
}
