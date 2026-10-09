import { useEffect, useLayoutEffect } from 'preact/hooks';
import { api } from './api/client';
import { connectFeed, type Feed } from './api/ws';
import { loadCatalog } from './catalog';
import { Announcer } from './components/Announcer';
import { ChiefBubble } from './components/ChiefBubble';
import { NowPlaying } from './meetings/NowPlaying';
import { Nav } from './components/Nav';
import { closePalette, openPalette, Palette, paletteOpen } from './components/Palette';
import { PttCaption } from './components/PttCaption';
import { clientId } from './lib/client-id';
import { startClock } from './lib/time';
import { startLiving } from './living';
import { linkTarget, navigate, paths, route } from './router';
import { CoworkerProfile } from './routes/CoworkerProfile';
import { Floor } from './routes/Floor';
import { Inbox } from './routes/Inbox';
import { Onboarding } from './routes/Onboarding';
import { Projects } from './routes/Projects';
import { ProjectDetail } from './routes/ProjectDetail';
import { SkillPage, Skills } from './routes/Skills';
import { Connectors } from './routes/Connectors';
import { Automations } from './routes/Automations';
import { Canvas, CanvasItem } from './routes/Canvas';
import { Handbook } from './routes/Handbook';
import { Admin } from './routes/Admin';
import { Team } from './routes/Team';
import { Hire } from './routes/Hire';
import { MeetingRoom, Meetings } from './routes/Meetings';
import { Files } from './routes/Files';
import { Now } from './routes/Now';
import { OfficeDialogs } from './admin/OfficeDialogs';
import { BRAND } from '@headcount/protocol';
import { actualRole, auth, currentOrg, loadOrgs, role, viewAs } from './auth/session';
import { revealLinked } from './links/links';
import { Toast } from './links/Toast';
import './routes/admin.css';
import { Memory } from './routes/Memory';
import { ChiefPrompt } from './routes/ChiefPrompt';
import { Talk } from './routes/Talk';
import * as store from './store';
import { acceptSettings, applyFrame, capabilities, clearServerPresence, connection, lastSeq, mergeJobs, mergeProjects, onboarded, settings, teamIds, trustStop } from './store';
import { draft } from './talk/draft';
import { startUnread } from './ui/unread';
import { bargeIn, chiefIsSpeaking, chiefSpeaker, startChiefVoice } from './voice/chief-voice';
import { startVoiceFront } from './voice/front';
import { armAudio, audio } from './voice/engine';
import { startVoiceHandoff } from './voice/handoff';
import { mayVoice, voiceOwner } from './voice/owner';
import { cancelPtt, endPtt, ptt, pttMode, pttPressTarget, startPtt, type PttTarget } from './voice/ptt';
import { startSideVoice } from './voice/side-voice';
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
  // Team projects and the Inbox's raised hands (Inc 1).
  void api
    .listProjects()
    .then((r) => mergeProjects(r))
    .catch(() => undefined);
  // Who is on the team (the office shows them; hiring updates it).
  void api
    .getTeam()
    .then((t) => (teamIds.value = t.members.map((m) => m.personaId)))
    .catch(() => undefined);
  // Everyone stop (Inc 6): whether it is on, however long ago it was turned on.
  void api
    .getTrust()
    .then((t) => (trustStop.value = t.stopped))
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
    const stopFront = startVoiceFront();
    const stopSideVoices = startSideVoice();
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
      clientId,
    });
    // One voice per workspace: only the tab with the voice speaks; a real gesture here takes it (voice/owner.ts).
    const stopHandoff = startVoiceHandoff((op) => feed?.send(op));
    // The living workforce loads once the app is idle; its socket ops ride this feed.
    const stopLiving = startLiving((op) => feed?.send(op));
    // The first gesture anywhere arms audio, so later announcements can be heard (X4: never before a gesture).
    const arm = () => armAudio();
    window.addEventListener('pointerdown', arm, { once: true, capture: true });
    window.addEventListener('keydown', arm, { once: true, capture: true });
    // Dev builds only: e2e reads the store, the Chief of Staff's mouth (lip sync) and the audio engine (what is
    // sounding, the owner's voice activity) through this hook.
    if (import.meta.env.DEV) {
      const w = window as unknown as { __headcount?: Record<string, unknown> };
      w.__headcount = { ...(w.__headcount ?? {}), store, applyFrame, chiefSpeaker, audio, voice: { clientId, owner: () => voiceOwner.peek(), here: mayVoice } };
    }
    return () => {
      stopHandoff();
      stopLiving();
      feed?.close();
      stopVoice();
      stopFront();
      stopSideVoices();
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

/**
 * Another empty field whose placeholder offers "hold Space to talk" (`data-ptt-hold`: the office room's dock): a held
 * Space talks to the push-to-talk target, a quick tap types a space.
 */
export function isEmptyPttField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.hasAttribute('data-ptt-hold') && target.value === '';
}

/**
 * The page already handled this Esc or Space (the office scene leaves a room or a huddle, the stage's dock clears its
 * field, a control held to talk): the global shortcut stays out of it.
 */
export function handledByPage(e: KeyboardEvent): boolean {
  return e.defaultPrevented && (e.key === 'Escape' || e.key === ' ');
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
    let composerPending: HTMLTextAreaElement | HTMLInputElement | null = null;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (paletteOpen.value) closePalette();
        else openPalette();
        return;
      }
      if (paletteOpen.value) return;
      if (handledByPage(e)) return;
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
        if ((isEmptyComposer(e.target) || isEmptyPttField(e.target)) && !e.isComposing) {
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
        if (box.id === 'composer') draft.value = `${box.value} `;
        else {
          box.value = `${box.value} `;
          box.dispatchEvent(new Event('input', { bubbles: true }));
        }
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
    case 'now':
      return <Now />;
    case 'floor':
      return <Floor />;
    case 'coworker':
      return <CoworkerProfile personaId={r.params.personaId!} />;
    case 'projects':
      return <Projects />;
    case 'project':
      return <ProjectDetail projectId={r.params.projectId!} />;
    case 'skills':
      return <Skills />;
    case 'connectors':
      return <Connectors />;
    case 'automations':
      return <Automations />;
    case 'canvas':
      return <Canvas />;
    case 'canvasItem':
      return <CanvasItem canvasId={r.params.canvasId!} />;
    case 'memory':
      return <Memory />;
    case 'handbook':
      return <Handbook />;
    case 'admin':
      return <Admin section={r.params.section} />;
    case 'team':
      return <Team />;
    case 'hire':
      return <Hire />;
    case 'meetings':
      return <Meetings />;
    case 'meeting':
      return <MeetingRoom meetingId={r.params.meetingId!} />;
    case 'files':
      return <Files />;
    case 'skill':
      return <SkillPage skillId={r.params.skillId!} />;
    case 'chief':
      return <ChiefPrompt />;
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

/** A press aimed at a conference room (its dock shows the live transcript); a joined huddle has no dock. */
function conferencePress(t: PttTarget | null): boolean {
  return t?.kind === 'room' && !t.roomId.startsWith('huddle:');
}

export function App() {
  useBoot();
  useGlobalKeys();
  // A link to an item (`?at=`): take the reader to it once the page has it.
  useEffect(() => revealLinked(), [route.value.path, linkTarget.value]);
  // The browser tab carries the office's own name; the offices this person belongs to load for the switcher and ⌘K.
  const office = currentOrg.value?.name ?? BRAND.name;
  useEffect(() => void (document.title = office), [office]);
  useEffect(() => void loadOrgs(), [auth.value.status]);
  const name = route.value.name;
  const bare = name === 'onboarding';
  return (
    <div class="shell" data-bare={bare || undefined} data-route={name}>
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      {actualRole.value && (
        <p class="viewas-bar" role="status">
          You are previewing the office as a {role.value}.{' '}
          <button type="button" class="link-button" onClick={() => void viewAs(null)}>
            Back to {actualRole.value}
          </button>
        </p>
      )}
      {!bare && <Nav />}
      <main class="main" id="main" tabIndex={-1}>
        <Screen />
      </main>
      {!bare && <ChiefBubble />}
      {!bare && <NowPlaying />}
      {/* The conference dock shows its own listening line; everything else (Talk, a joined huddle) shows this one. */}
      {!conferencePress(pttPressTarget.value) && <PttCaption />}
      <Announcer />
      <Toast />
      <Palette />
      <OfficeDialogs />
    </div>
  );
}
