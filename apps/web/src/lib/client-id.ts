// This tab's client id (one voice per workspace, ext/voice-owner): stable across reloads of the tab (sessionStorage),
// different in every other tab. A duplicated tab or a window.open copies sessionStorage, so a marker that lives only
// while the page does tells a copy apart: a reload finds no marker (the page hid first) and keeps the id; a copy made
// while the page is open finds it and takes a new id.
import { CLIENT_ID_RE } from '@headcount/protocol/ext/voice-owner';
import { hotKeep, hotTake } from './hot';

export const CLIENT_ID_KEY = 'hc-client-id';
export const CLIENT_LIVE_KEY = 'hc-client-live';

// A hot update re-evaluates this module: the page keeps its id (its marker is set, so storage would say "a copy").
let id: string | null = hotTake<string>('clientId') ?? null;
if (id) hotKeep('clientId', id);

function fresh(): string {
  const bytes = new Uint8Array(12);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `c${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function session(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** This tab's client id (created on first use). */
export function clientId(): string {
  if (id) return id;
  const store = session();
  try {
    const saved = store?.getItem(CLIENT_ID_KEY);
    const copied = !!store?.getItem(CLIENT_LIVE_KEY);
    id = saved && CLIENT_ID_RE.test(saved) && !copied ? saved : fresh();
    store?.setItem(CLIENT_ID_KEY, id);
    store?.setItem(CLIENT_LIVE_KEY, '1');
  } catch {
    id ??= fresh();
  }
  if (typeof addEventListener === 'function') {
    addEventListener('pagehide', () => {
      try {
        store?.removeItem(CLIENT_LIVE_KEY);
      } catch {
        /* storage blocked */
      }
    });
    addEventListener('pageshow', (e) => {
      if (!(e as PageTransitionEvent).persisted) return;
      try {
        store?.setItem(CLIENT_LIVE_KEY, '1');
      } catch {
        /* storage blocked */
      }
    });
  }
  return hotKeep('clientId', id);
}

/** Tests: forget the id (the next call reads storage again). */
export function resetClientId(): void {
  id = null;
}
