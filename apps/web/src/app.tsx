import { useEffect, useLayoutEffect } from 'preact/hooks';
import { api } from './api/client';
import { connectFeed, type Feed } from './api/ws';
import { loadCatalog } from './catalog';
import { Announcer } from './components/Announcer';
import { ChiefBubble } from './components/ChiefBubble';
import { Nav } from './components/Nav';
import { closePalette, openPalette, Palette, paletteOpen } from './components/Palette';
import { PttCaption } from './components/PttCaption';
import { startClock } from './lib/time';
import { navigate, paths, route } from './router';
import { CoworkerProfile } from './routes/CoworkerProfile';
import { Floor } from './routes/Floor';
import { Inbox } from './routes/Inbox';
import { Onboarding } from './routes/Onboarding';
import { Projects } from './routes/Projects';
import { Talk } from './routes/Talk';
import * as store from './store';
import { acceptSettings, applyFrame, capabilities, clearServerPresence, connection, lastSeq, mergeJobs, onboarded, settings } from './store';
import { draft } from './talk/draft';
import { startUnread } from './ui/unread';
import { bargeIn, chiefIsSpeaking, chiefSpeaker, startChiefVoice } from './voice/chief-voice';
import { armAudio } from './voice/engine';
import { cancelPtt, endPtt, ptt, pttMode, startPtt } from './voice/ptt';
import './styles/components.css';

async function loadSettings(attempt = 0): Promise<void> {
  try {
    acceptSettings(await api.getWorkspace());
  } catch {
    // The worker can start a moment after the page (pnpm dev): keep trying quietly.
    setTimeout(() => void loadSettings(attempt + 1), Math.min(8000, 500 * 2 ** attempt));
  }
}

/** Live job snapshots from the Everyday project: fills in anything the feed replay no longer carries. */
function refreshJobs() {
  void api
    .listJobs()
    .then((r) => mergeJobs(r.jobs))
    .catch(() => undefined);
}

function refreshCapabilities() {
  void api
    .capabilities()
    .then((c) => (capabilities.value = c))
    .catch(() => undefined);
}

/** Boot: settings, capabilities, catalog, owner feed, spoken replies. */
function useBoot() {
  useEffect(() => {
    void loadSettings();
    refreshCapabilities();
    void loadCatalog();
    const stopVoice = startChiefVoice();
    const stopClock = startClock();
    const stopUnread = startUnread();
    let feed: Feed | null = null;
    let openedBefore = false;
    feed = connectFeed({
      onFrame: (f) => {
        if (applyFrame(f) === 'resync') feed?.reconnect();
      },
      onStatus: (s) => {
        connection.value = s;
        if (s === 'closed') clearServerPresence();
        if (s !== 'open') return;
        refreshJobs();
        // Back online after a drop: keys or settings may have changed meanwhile (the worker restarted).
        if (openedBefore) {
          refreshCapabilities();
          void loadSettings();
        }
        openedBefore = true;
      },
      since: () => lastSeq.value,
    });
    // The first gesture anywhere arms audio, so later announcements can be heard (X4: never before a gesture).
    const arm = () => armAudio();
    window.addEventListener('pointerdown', arm, { once: true, capture: true });
    window.addEventListener('keydown', arm, { once: true, capture: true });
    // Dev builds only: e2e reads the store and the Chief of Staff's mouth (lip sync) through this hook.
    if (import.meta.env.DEV) (window as unknown as { __headcount?: unknown }).__headcount = { store, applyFrame, chiefSpeaker };
    return () => {
      feed?.close();
      stopVoice();
      stopClock();
      stopUnread();
      window.removeEventListener('pointerdown', arm, { capture: true });
      window.removeEventListener('keydown', arm, { capture: true });
    };
  }, []);
}

const TEXT_ENTRY = 'input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [contenteditable=""], [contenteditable="true"]';
const CONTROL = 'button, [role="button"], a[href], summary, [role="option"], input';

/** Held this long in the empty composer, Space talks; a quicker tap types a space as usual. */
export const COMPOSER_HOLD_MS = 250;

/** The Talk composer while it is empty: there, a held Space is push-to-talk (its placeholder says so). */
export function isEmptyComposer(target: EventTarget | null): target is HTMLTextAreaElement {
  return target instanceof HTMLTextAreaElement && target.id === 'composer' && target.value === '';
}

/** Space is push-to-talk outside text fields, unless a control has keyboard focus (then Space activates it). */
export function spaceStartsPtt(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(TEXT_ENTRY)) return false;
  if (target.closest('[aria-modal="true"]')) return false;
  if (target.matches(CONTROL)) {
    try {
      return !target.matches(':focus-visible');
    } catch {
      return false;
    }
  }
  return true;
}

function useGlobalKeys() {
  // Layout effect: the shortcuts are live before the first paint (the app loads lazily, so a ⌘K pressed as the
  // first screen appears is not lost).
  useLayoutEffect(() => {
    let spaceHeld = false;
    // Space pressed in the empty composer: talk once it is held, type a space if it is let go quickly.
    let composerTimer: ReturnType<typeof setTimeout> | undefined;
    let composerPending: HTMLTextAreaElement | null = null;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (paletteOpen.value) closePalette();
        else openPalette();
        return;
      }
      if (paletteOpen.value) return;
      if (e.key === 'Escape') {
        if (document.querySelector('[aria-modal="true"]')) return; // the dialog closes itself
        if (ptt.value.phase !== 'idle') cancelPtt();
        else if (chiefIsSpeaking()) bargeIn();
        else if (route.value.name === 'coworker') navigate(paths.floor);
        return;
      }
      if (e.key === ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (spaceHeld || composerPending) {
          e.preventDefault(); // key repeat while holding
          return;
        }
        if (e.repeat || !onboarded.value || !pttMode()) return;
        if (isEmptyComposer(e.target) && !e.isComposing) {
          e.preventDefault();
          composerPending = e.target;
          composerTimer = setTimeout(() => {
            composerPending = null;
            spaceHeld = true;
            void startPtt();
          }, COMPOSER_HOLD_MS);
          return;
        }
        if (!spaceStartsPtt(e.target)) return;
        e.preventDefault();
        spaceHeld = true;
        void startPtt();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      if (composerPending) {
        // A quick tap: it was a space after all.
        clearTimeout(composerTimer);
        const box = composerPending;
        composerPending = null;
        e.preventDefault();
        draft.value = `${box.value} `;
        return;
      }
      if (spaceHeld) {
        e.preventDefault();
        spaceHeld = false;
        void endPtt();
      }
    };
    // Focus left the window mid-hold: the keyup will never come, so discard.
    const onBlur = () => {
      clearTimeout(composerTimer);
      composerPending = null;
      if (spaceHeld) {
        spaceHeld = false;
        cancelPtt();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      clearTimeout(composerTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}

function Home() {
  const s = settings.value;
  useEffect(() => {
    if (s) navigate(s.leadId ? paths.talk : paths.onboarding, { replace: true });
  }, [s?.leadId, !!s]);
  return null;
}

function Screen() {
  const r = route.value;
  switch (r.name) {
    case 'home':
      return <Home />;
    case 'onboarding':
      return <Onboarding />;
    case 'talk':
      return <Talk />;
    case 'floor':
      return <Floor />;
    case 'coworker':
      return <CoworkerProfile personaId={r.params.personaId!} />;
    case 'projects':
      return <Projects />;
    case 'inbox':
      return <Inbox />;
    default:
      return (
        <section class="page" aria-labelledby="nf-title">
          <h1 id="nf-title">Not found</h1>
          <p class="page-lede">There is nothing at this address. Use the places on the left, or press ⌘K.</p>
        </section>
      );
  }
}

export function App() {
  useBoot();
  useGlobalKeys();
  const name = route.value.name;
  const bare = name === 'onboarding';
  return (
    <div class="shell" data-bare={bare || undefined} data-route={name}>
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      {!bare && <Nav />}
      <main class="main" id="main" tabIndex={-1}>
        <Screen />
      </main>
      {!bare && <ChiefBubble />}
      <PttCaption />
      <Announcer />
      <Palette />
    </div>
  );
}
