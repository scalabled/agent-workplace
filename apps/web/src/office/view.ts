// Office | Directory: which view the Floor shows. Light on purpose (no office code): the Floor
// route reads it before the lazy office chunk loads, and Directory users never load that chunk at all.
//
// Resolution: `?view=office|directory` (then remembered) → the remembered choice (localStorage['hc.floor.view']) →
// the Office on a fine pointer at least 900 px wide, else the Directory (phones and coarse pointers). Before
// onboarding the Floor has no toggle and always shows the Directory (the Office needs a Chief of Staff).
import { signal } from '@preact/signals';

export type FloorView = 'office' | 'directory';

export const FLOOR_VIEW_KEY = 'hc.floor.view';
export const OFFICE_MEDIA = '(min-width: 900px) and (pointer: fine)';

const isView = (v: unknown): v is FloorView => v === 'office' || v === 'directory';

function stored(): FloorView | null {
  try {
    const v = localStorage.getItem(FLOOR_VIEW_KEY);
    return isView(v) ? v : null;
  } catch {
    return null;
  }
}

function remember(v: FloorView): void {
  try {
    localStorage.setItem(FLOOR_VIEW_KEY, v);
  } catch {
    /* storage blocked: the choice lasts for this page */
  }
}

/** The view this device opens on when nothing was chosen. */
export function defaultView(): FloorView {
  try {
    return typeof matchMedia === 'function' && matchMedia(OFFICE_MEDIA).matches ? 'office' : 'directory';
  } catch {
    return 'directory';
  }
}

/** `?view=` wins (and is remembered), then the remembered choice, then the device default. */
export function resolveView(search: string = typeof location === 'undefined' ? '' : location.search): FloorView {
  let param: string | null = null;
  try {
    param = new URLSearchParams(search).get('view');
  } catch {
    param = null;
  }
  if (isView(param)) {
    remember(param);
    return param;
  }
  return stored() ?? defaultView();
}

/** The Floor's view. `resolveFloorView()` refreshes it on every visit to the Floor (a link may carry `?view=`). */
export const floorView = signal<FloorView>(typeof window === 'undefined' ? 'directory' : resolveView());

export function resolveFloorView(): FloorView {
  const v = resolveView();
  if (floorView.peek() !== v) floorView.value = v;
  return v;
}

/**
 * The owner picked a view (the toggle, the office's skip link): remembered on this device. An address that carried
 * `?view=` follows the choice, so a reload shows what the owner picked, not what the link said.
 */
export function setFloorView(v: FloorView): void {
  remember(v);
  floorView.value = v;
  try {
    const next = editQuery(location.search, (k) => (k === 'view' ? v : undefined));
    if (next !== location.search) history.replaceState(history.state, '', `${location.pathname}${next}${location.hash}`);
  } catch {
    /* no history here */
  }
}

/**
 * Edit a query string, leaving every other parameter exactly as written: `edit(key)` returns a new value, null to drop
 * the parameter, or undefined to keep it.
 */
export function editQuery(search: string, edit: (key: string) => string | null | undefined): string {
  const parts = search.replace(/^\?/, '').split('&').filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const key = decodeURIComponent(part.split('=')[0] ?? '');
    const v = edit(key);
    if (v === null) continue;
    out.push(v === undefined ? part : `${part.split('=')[0]}=${encodeURIComponent(v)}`);
  }
  return out.length ? `?${out.join('&')}` : '';
}

/** Deep links the Office consumes once: `&room=skyline|garden`, `&focus=<personaId>`. */
export interface OfficeDeepLink {
  room: 'skyline' | 'garden' | null;
  focus: string | null;
}

export function readDeepLink(search: string = typeof location === 'undefined' ? '' : location.search): OfficeDeepLink {
  try {
    const q = new URLSearchParams(search);
    const room = q.get('room');
    const focus = q.get('focus');
    return { room: room === 'skyline' || room === 'garden' ? room : null, focus: focus && /^[a-z0-9-]{1,80}$/.test(focus) ? focus : null };
  } catch {
    return { room: null, focus: null };
  }
}

/** Drop `room` and `focus` from the address once used (`view` stays, so a reload keeps the Office). */
export function clearDeepLink(): void {
  try {
    const next = editQuery(location.search, (k) => (k === 'room' || k === 'focus' ? null : undefined));
    if (next !== location.search) history.replaceState(history.state, '', `${location.pathname}${next}${location.hash}`);
  } catch {
    /* no history here (tests) */
  }
}
