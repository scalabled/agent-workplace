// Minimal signal router over the History API. Paths follow EXPERIENCE §2.4 (ids, never names).
import { computed, signal } from '@preact/signals';

export type RouteName = 'home' | 'onboarding' | 'talk' | 'floor' | 'coworker' | 'projects' | 'inbox' | 'notFound';

export interface CurrentRoute {
  name: RouteName;
  params: Record<string, string>;
  path: string;
}

const PATTERNS: [RouteName, RegExp, string[]][] = [
  ['home', /^\/$/, []],
  ['onboarding', /^\/welcome\/?$/, []],
  ['talk', /^\/talk\/?$/, []],
  ['floor', /^\/floor\/?$/, []],
  ['coworker', /^\/desk\/([^/]+)\/profile\/?$/, ['personaId']],
  ['projects', /^\/projects\/?$/, []],
  ['inbox', /^\/inbox\/?$/, []],
];

export function matchPath(path: string): CurrentRoute {
  for (const [name, re, keys] of PATTERNS) {
    const m = re.exec(path);
    if (m) return { name, path, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)])) };
  }
  return { name: 'notFound', path, params: {} };
}

export const path = signal(typeof location !== 'undefined' ? location.pathname : '/');
export const route = computed(() => matchPath(path.value));

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === path.value) return;
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  path.value = location.pathname;
}

export const paths = {
  talk: '/talk',
  floor: '/floor',
  projects: '/projects',
  inbox: '/inbox',
  onboarding: '/welcome',
  coworker: (personaId: string) => `/desk/${encodeURIComponent(personaId)}/profile`,
} as const;

if (typeof window !== 'undefined') window.addEventListener('popstate', () => (path.value = location.pathname));
