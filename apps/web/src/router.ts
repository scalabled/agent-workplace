// Minimal signal router over the History API. Paths follow EXPERIENCE §2.4 (ids, never names).
// "/" is the public landing page; the app lives under "/app". Pre-landing app paths ("/talk", "/welcome", …)
// redirect to their "/app" equivalents, so old links and bookmarks keep working.
import { computed, signal } from '@preact/signals';

export type RouteName = 'landing' | 'releases' | 'home' | 'onboarding' | 'talk' | 'floor' | 'coworker' | 'projects' | 'project' | 'inbox' | 'skills' | 'skill' | 'chief' | 'connectors' | 'automations' | 'canvas' | 'canvasItem' | 'memory' | 'handbook' | 'admin' | 'team' | 'hire' | 'meetings' | 'meeting' | 'files' | 'notFound';

export interface CurrentRoute {
  name: RouteName;
  params: Record<string, string>;
  path: string;
}

export const APP_BASE = '/app';

const PATTERNS: [RouteName, RegExp, string[]][] = [
  ['landing', /^\/$/, []],
  ['releases', /^\/releases\/?$/, []],
  ['home', /^\/app\/?$/, []],
  ['onboarding', /^\/app\/welcome\/?$/, []],
  ['talk', /^\/app\/talk\/?$/, []],
  ['floor', /^\/app\/floor\/?$/, []],
  ['coworker', /^\/app\/desk\/([^/]+)\/profile\/?$/, ['personaId']],
  ['projects', /^\/app\/projects\/?$/, []],
  ['project', /^\/app\/projects\/(prj_[a-z0-9]+)\/?$/, ['projectId']],
  ['inbox', /^\/app\/inbox\/?$/, []],
  ['skills', /^\/app\/skills\/?$/, []],
  ['skill', /^\/app\/skills\/([a-z0-9][a-z0-9-]*)\/?$/, ['skillId']],
  ['chief', /^\/app\/chief\/?$/, []],
  ['connectors', /^\/app\/connectors\/?$/, []],
  ['automations', /^\/app\/automations\/?$/, []],
  ['canvas', /^\/app\/canvas\/?$/, []],
  ['canvasItem', /^\/app\/canvas\/(cnv_[a-f0-9]+)\/?$/, ['canvasId']],
  ['memory', /^\/app\/memory\/?$/, []],
  ['handbook', /^\/app\/handbook\/?$/, []],
  ['admin', /^\/app\/admin(?:\/([a-z]+))?\/?$/, ['section']],
  ['team', /^\/app\/team\/?$/, []],
  ['hire', /^\/app\/team\/hire\/?$/, []],
  ['meetings', /^\/app\/meetings\/?$/, []],
  ['meeting', /^\/app\/meetings\/(mtg_[a-z0-9]+)\/?$/, ['meetingId']],
  ['files', /^\/app\/files\/?$/, []],
];

const LEGACY = [/^\/(welcome|talk|floor|projects|inbox)\/?$/, /^\/desk\/[^/]+\/profile\/?$/];

/** The "/app" path for a pre-landing app path, or null when `path` is not one. */
export function legacyRedirect(path: string): string | null {
  return LEGACY.some((re) => re.test(path)) ? `${APP_BASE}${path}` : null;
}

export function matchPath(path: string): CurrentRoute {
  for (const [name, re, keys] of PATTERNS) {
    const m = re.exec(path);
    if (m) return { name, path, params: Object.fromEntries(keys.flatMap((k, i) => (m[i + 1] === undefined ? [] : [[k, decodeURIComponent(m[i + 1]!)]]))) };
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
/** The query string (`?at=…&tab=…`): every place and item has a link, and the query carries where on the page. */
export const search = signal(typeof location !== 'undefined' ? location.search : '');
/** The item a link points at on this page (`?at=<anchor id>`), or null. */
export const linkTarget = computed(() => new URLSearchParams(search.value).get('at'));
/** One query parameter of the current address. */
export const queryParam = (name: string): string | null => new URLSearchParams(search.value).get(name);

/** A page's link to one item on it: `/app/memory?at=mem_…`. */
export function linkTo(page: string, at?: string | null, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(extra);
  if (at) q.set('at', at);
  const qs = q.toString();
  return qs ? `${page}?${qs}` : page;
}

/** Change the query on this page (a tab, a filter) without a new page. */
export function setQuery(params: Record<string, string | null>, opts: { replace?: boolean } = { replace: true }): void {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === '') q.delete(k);
    else q.set(k, v);
  }
  const qs = q.toString();
  const next = `${location.pathname}${qs ? `?${qs}` : ''}`;
  if (opts.replace) history.replaceState(history.state, '', next);
  else history.pushState(null, '', next);
  search.value = location.search;
}

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
  const [targetPath] = target.split(/[?#]/);
  if (target === path.value + search.value) return;
  // Same page, another item on it (`?at=`): no new page, no jump to the top; the deep link scrolls to it.
  const samePage = targetPath === path.value;
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
    if (!samePage)
      try {
        window.scrollTo(0, 0);
      } catch {
        /* no window scrolling (tests) */
      }
  }
  navKind = opts.replace ? 'replace' : 'push';
  search.value = location.search;
  path.value = location.pathname;
}

export const paths = {
  landing: '/',
  releases: '/releases',
  app: APP_BASE,
  talk: `${APP_BASE}/talk`,
  floor: `${APP_BASE}/floor`,
  projects: `${APP_BASE}/projects`,
  project: (projectId: string) => `${APP_BASE}/projects/${encodeURIComponent(projectId)}`,
  inbox: `${APP_BASE}/inbox`,
  onboarding: `${APP_BASE}/welcome`,
  coworker: (personaId: string) => `${APP_BASE}/desk/${encodeURIComponent(personaId)}/profile`,
  skills: `${APP_BASE}/skills`,
  skill: (skillId: string) => `${APP_BASE}/skills/${encodeURIComponent(skillId)}`,
  chief: `${APP_BASE}/chief`,
  connectors: `${APP_BASE}/connectors`,
  automations: `${APP_BASE}/automations`,
  canvas: `${APP_BASE}/canvas`,
  canvasItem: (canvasId: string) => `${APP_BASE}/canvas/${encodeURIComponent(canvasId)}`,
  memory: `${APP_BASE}/memory`,
  handbook: `${APP_BASE}/handbook`,
  team: `${APP_BASE}/team`,
  hire: `${APP_BASE}/team/hire`,
  meetings: `${APP_BASE}/meetings`,
  meeting: (meetingId: string) => `${APP_BASE}/meetings/${encodeURIComponent(meetingId)}`,
  files: `${APP_BASE}/files`,
  admin: (section?: string) => `${APP_BASE}/admin${section ? `/${section}` : ''}`,
} as const;

if (typeof window !== 'undefined')
  window.addEventListener('popstate', () => {
    navKind = 'pop';
    search.value = location.search;
    path.value = canonicalize();
  });
