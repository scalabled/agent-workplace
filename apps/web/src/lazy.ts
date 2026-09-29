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
