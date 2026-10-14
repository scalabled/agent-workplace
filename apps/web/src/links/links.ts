// Link-first: every place and item in the office has an address people can share with a teammate or paste to an
// agent. `copyLink` puts the full address on the clipboard and says so; `revealLinked` takes the reader to the item a
// link points at (`?at=<anchor>`): it waits for the page to load it, opens it if it is folded away, scrolls it into
// view and highlights it for a moment.
import { signal } from '@preact/signals';
import { linkTarget, route } from '../router';

/** One short line at the bottom of the screen ("Link copied"). */
export const toast = signal<{ id: number; text: string } | null>(null);
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, ms = 2600): void {
  const id = ++seq;
  toast.value = { id, text };
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (toast.value?.id === id) toast.value = null;
  }, ms);
}

/** The full address of an in-app path (`/app/…?at=…`). */
export function absolute(href: string): string {
  return new URL(href, location.origin).href;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or no permission: the classic way.
    try {
      const t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Copy the link to a place or an item; `what` names it in the confirmation ("Link to this message copied"). */
export async function copyLink(href: string, what = 'Link'): Promise<void> {
  const url = absolute(href);
  showToast((await writeClipboard(url)) ? `${what} copied` : `Copy this link: ${url}`, 4000);
}

/** The current page's own link (its path and query, without an item). */
export function pageHref(): string {
  const q = new URLSearchParams(location.search);
  q.delete('at');
  const qs = q.toString();
  return `${location.pathname}${qs ? `?${qs}` : ''}`;
}

/** How long to wait for the linked item to appear (a project loading, Talk replaying its history). */
const REVEAL_WAIT_MS = 12_000;
const HIGHLIGHT_MS = 4_000;
let revealRun = 0;

/**
 * Go to the item the address points at. Components that fold items away open them when `linkTarget` names them; this
 * opens any enclosing <details>, scrolls, and highlights. Says so if the item is gone.
 */
export function revealLinked(): void {
  const at = linkTarget.value;
  if (!at || typeof document === 'undefined') return;
  const run = ++revealRun;
  const page = route.value.path;
  const started = Date.now();
  const tick = () => {
    if (run !== revealRun || route.value.path !== page || linkTarget.value !== at) return;
    const el = document.getElementById(at);
    if (!el) {
      // A document in a frame (the canvas) takes the reader to the spot itself.
      if (document.querySelector('[data-link-host]')) return;
      if (Date.now() - started < REVEAL_WAIT_MS) setTimeout(tick, 120);
      else showToast('That item is gone. Someone may have removed it.', 4000);
      return;
    }
    for (let p: HTMLElement | null = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
    if (el instanceof HTMLDetailsElement) el.open = true;
    // Let anything that just opened lay out, then bring it to the middle of the screen.
    requestAnimationFrame(() => {
      try {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        el.scrollIntoView();
      }
      el.setAttribute('data-linked', '');
      setTimeout(() => el.removeAttribute('data-linked'), HIGHLIGHT_MS);
    });
  };
  tick();
}
