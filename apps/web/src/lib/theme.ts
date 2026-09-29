// Theme: dark by default everywhere (OWNER-DIRECTIVES D3). Light is a choice made in the app (⌘K → "Use light
// theme"), and "Match system" is an explicit opt-in; the OS preference is no longer the default. The choice is a
// per-browser convenience (localStorage). The public landing page is always dark (`forceTheme`).
// <html data-theme> is always set explicitly, so CSS and the face renderer agree on the palette.
import { signal } from '@preact/signals';

export type ThemeChoice = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
const KEY = 'headcount.theme';

/** Stored choice; anything unknown (or nothing) is the default, dark. */
export function parseChoice(v: string | null | undefined): ThemeChoice {
  return v === 'light' || v === 'system' ? v : 'dark';
}

function read(): ThemeChoice {
  try {
    return parseChoice(localStorage.getItem(KEY));
  } catch {
    return 'dark';
  }
}

export const theme = signal<ThemeChoice>(typeof localStorage !== 'undefined' ? read() : 'dark');
/** The palette on screen right now (forced or chosen); components that derive colours read it. */
export const resolvedTheme = signal<ResolvedTheme>('dark');
let forced: ResolvedTheme | null = null;
let systemQuery: MediaQueryList | null = null;

function osPrefersLight(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(choice: ThemeChoice, prefersLight = osPrefersLight()): ResolvedTheme {
  if (choice === 'system') return prefersLight ? 'light' : 'dark';
  return choice;
}

function apply(): void {
  if (typeof document === 'undefined') return;
  const resolved = forced ?? resolveTheme(theme.value);
  resolvedTheme.value = resolved;
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0A0B0D' : '#F7F5F0');
}

function watchSystem(on: boolean): void {
  if (typeof matchMedia !== 'function') return;
  systemQuery ??= matchMedia('(prefers-color-scheme: light)');
  systemQuery.removeEventListener?.('change', apply);
  if (on) systemQuery.addEventListener?.('change', apply);
}

export function setTheme(choice: ThemeChoice): void {
  theme.value = choice;
  watchSystem(choice === 'system');
  apply();
  try {
    if (choice === 'dark') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* storage blocked: the choice lasts for this page */
  }
}

/** Pin a theme regardless of the owner's choice (the landing page is always dark); null releases it. */
export function forceTheme(value: ResolvedTheme | null): void {
  forced = value;
  apply();
}

/** The theme a route pins: the public landing page is always dark; the app follows the owner's choice. */
export function forcedThemeFor(routeName: string): ResolvedTheme | null {
  return routeName === 'landing' ? 'dark' : null;
}

/**
 * Apply the stored choice (index.html already did before first paint; this keeps them in step). Pass the
 * route's pinned theme so the first render never flips the landing to the owner's light choice and back.
 */
export function initTheme(pinned: ResolvedTheme | null = null): void {
  forced = pinned;
  watchSystem(theme.value === 'system');
  apply();
}
