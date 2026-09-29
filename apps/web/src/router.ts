// Minimal signal router over the History API. Paths follow EXPERIENCE §2.4 (ids, never names).
// "/" is the public landing page; the app lives under "/app". Pre-landing app paths ("/talk", "/welcome", …)
// redirect to their "/app" equivalents, so old links and bookmarks keep working.
import { computed, signal } from '@preact/signals';

export type RouteName = 'landing' | 'home' | 'onboarding' | 'talk' | 'floor' | 'coworker' | 'projects' | 'inbox' | 'notFound';

export interface CurrentRoute {
  name: RouteName;
  params: Record<string, string>;
  path: string;
}

export const APP_BASE = '/app';

const PATTERNS: [RouteName, RegExp, string[]][] = [
  ['landing', /^\/$/, []],
  ['home', /^\/app\/?$/, []],
  ['onboarding', /^\/app\/welcome\/?$/, []],
  ['talk', /^\/app\/talk\/?$/, []],
  ['floor', /^\/app\/floor\/?$/, []],
  ['coworker', /^\/app\/desk\/([^/]+)\/profile\/?$/, ['personaId']],
  ['projects', /^\/app\/projects\/?$/, []],
  ['inbox', /^\/app\/inbox\/?$/, []],
];

const LEGACY = [/^\/(welcome|talk|floor|projects|inbox)\/?$/, /^\/desk\/[^/]+\/profile\/?$/];

/** The "/app" path for a pre-landing app path, or null when `path` is not one. */
export function legacyRedirect(path: string): string | null {
  return LEGACY.some((re) => re.test(path)) ? `${APP_BASE}${path}` : null;
}

export function matchPath(path: string): CurrentRoute {
  for (const [name, re, keys] of PATTERNS) {
    const m = re.exec(path);
    if (m) return { name, path, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)])) };
  }
  return { name: 'notFound', path, params: {} };
}

/** Replace a legacy address in the location bar (keeps the query and hash); returns the current path. */
function canonicalize(): string {
  const next = legacyRedirect(location.pathname);
  if (next) history.replaceState(history.state, '', `${next}${location.search}${location.hash}`);
  return location.pathname;
}

export const path = signal(typeof location !== 'undefined' ? canonicalize() : '/');
export const route = computed(() => matchPath(path.value));

/** How the current page was reached: the first load, an in-app navigation, or Back/Forward. */
export type NavKind = 'init' | 'push' | 'replace' | 'pop';
let navKind: NavKind = 'init';
export const lastNav = (): NavKind => navKind;

/** The scroll position saved on this history entry when the owner navigated away from it (null: none). */
export function savedScroll(): number | null {
  const y = (typeof history !== 'undefined' ? (history.state as { scrollY?: unknown } | null) : null)?.scrollY;
  return typeof y === 'number' && Number.isFinite(y) ? y : null;
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = legacyRedirect(to) ?? to;
  if (target === path.value) return;
  if (opts.replace) history.replaceState(null, '', target);
  else {
    // Remember where the owner was on the page they leave, so Back returns them there.
    try {
      history.replaceState({ ...((history.state as object | null) ?? {}), scrollY: window.scrollY }, '');
    } catch {
      /* state not writable: Back starts at the top */
    }
    history.pushState(null, '', target);
    // A new page starts at the top (the Floor never opens mid-directory at Talk's scroll position); Talk then follows
    // its thread to the end itself. Back and Forward restore the saved position instead (main.tsx).
    try {
      window.scrollTo(0, 0);
    } catch {
      /* no window scrolling (tests) */
    }
  }
  navKind = opts.replace ? 'replace' : 'push';
  path.value = location.pathname;
}

export const paths = {
  landing: '/',
  app: APP_BASE,
  talk: `${APP_BASE}/talk`,
  floor: `${APP_BASE}/floor`,
  projects: `${APP_BASE}/projects`,
  inbox: `${APP_BASE}/inbox`,
  onboarding: `${APP_BASE}/welcome`,
  coworker: (personaId: string) => `${APP_BASE}/desk/${encodeURIComponent(personaId)}/profile`,
} as const;

if (typeof window !== 'undefined')
  window.addEventListener('popstate', () => {
    navKind = 'pop';
    path.value = canonicalize();
  });
