// The Office on the Floor: a lazy chunk that Directory users never load. It mounts the office
// (./mount.ts) into one full-bleed element, lifts a short veil once life has placed everyone, renders the living
// layer's bubbles over faces (the same FloorBubble and quick chat as the Directory, anchored in the scene), shows
// one quiet first-run hint, and keeps one line for notices. Everything else is the scene's own.
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { CatalogIndex, CatalogSlim } from '@headcount/catalog';
import { CHIEF_ID, personaIdFromAgentId } from '@headcount/protocol';
import { chiefName } from '../chief';
import { FloorBubble, replyingAgent } from '../components/FloorBubble';
import { registerPaletteItems } from '../components/Palette';
import { bubbles } from '../living/captions';
import { navigate, paths } from '../router';
import { openRoomSession } from '../room/session';
import { bindStage } from '../room/stage';
import { notice } from '../ui/notice';
import { setPttTarget } from '../voice/ptt';
import { firstOf } from './people';
import { mountOffice, type OfficeMount } from './mount';
import './office.css';

export const HINT_KEY = 'hc.office.hint.v1';
export const HINT_MS = 8000;
export const HINT_TEXT = 'Rest on anyone to say hi · Click to chat · H for huddles';
/** A quick chat's field takes the focus once its person is on screen, if that happens within this long. */
export const FOCUS_REPLY_WITHIN_MS = 1500;

export interface OfficeViewProps {
  catalog: CatalogIndex<CatalogSlim>;
  /** The skip link, or the office failed: show the Directory. */
  onRequestDirectory(): void;
}

export function OfficeView({ catalog, onRequestDirectory }: OfficeViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [office, setOffice] = useState<OfficeMount | null>(null);
  const [shown, setShown] = useState(false);
  const request = useRef(onRequestDirectory);
  request.current = onRequestDirectory;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const m = mountOffice({
      host: el,
      catalog,
      onRequestDirectory: () => request.current(),
      onReady: () => setShown(true),
      bindStage,
      openSession: openRoomSession,
      setPttTarget,
      registerPaletteItems,
    });
    setOffice(m);
    if (m.ready.peek()) setShown(true);
    return () => {
      setOffice(null);
      m.destroy();
    };
  }, [catalog]);

  return (
    <div class="office-view" data-shown={shown || undefined} data-testid="office-view">
      <div class="office-host" ref={host} />
      {office && <OfficeBubbles office={office} />}
      {office && shown && <FirstRunHint />}
      {office && <OfficeNotice office={office} />}
    </div>
  );
}

/** The living layer's bubbles (passing-by lines, quick chats), anchored over faces in desk mode. */
function OfficeBubbles({ office }: { office: OfficeMount }) {
  const current = bubbles.value;
  const desks = office.mode.value === 'desks';
  const hovered = office.hovered.value;
  const anchors = useRef(new Map<string, { el: HTMLElement; release(): void }>());
  const ids = desks ? Object.keys(current).filter((id) => office.nameOf(id) !== id) : [];
  // Anchors follow the bubbles: made for new ones (the scene holds the person while one exists), released after.
  const want = new Set(ids);
  for (const id of want) if (!anchors.current.has(id)) anchors.current.set(id, office.scene.anchor(id));
  useEffect(() => {
    for (const [id, a] of anchors.current) {
      if (want.has(id)) continue;
      a.release();
      anchors.current.delete(id);
    }
  });
  useEffect(
    () => () => {
      for (const a of anchors.current.values()) a.release();
      anchors.current.clear();
    },
    [],
  );
  // A quick chat opened on someone the camera is still flying to (Enter right after an arrow key) renders its field
  // in an anchor that is hidden until they are on screen, and a hidden field cannot take focus: give it the focus as
  // soon as it shows, unless the owner has moved on to something else meanwhile.
  const replying = replyingAgent.value;
  useEffect(() => {
    if (!replying) return;
    const until = performance.now() + FOCUS_REPLY_WITHIN_MS;
    let raf = 0;
    const tick = () => {
      const a = anchors.current.get(replying);
      const input = a?.el.querySelector<HTMLInputElement>('[data-testid="bubble-input"]');
      const active = document.activeElement;
      if (input && active === input) return;
      const free = !active || active === document.body || (active instanceof HTMLElement && !!active.closest('.hc-o-seat, .hc-office') && !active.closest('input, textarea'));
      if (!free) return;
      if (input && a && getComputedStyle(a.el).visibility !== 'hidden') {
        input.focus({ preventScroll: true });
        if (document.activeElement === input) return;
      }
      if (performance.now() < until) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [replying]);
  return (
    <>
      {ids.map((id) => {
        const a = anchors.current.get(id);
        if (!a) return null;
        const chief = id === CHIEF_ID;
        const name = chief ? chiefName.value : office.nameOf(id);
        const first = firstOf(name);
        return createPortal(
          <FloorBubble
            key={id}
            agentId={id}
            first={first}
            hovered={hovered === id}
            placement="anchor"
            onFollow={() => office.scene.follow(id)}
            onOpenDesk={() => navigate(chief ? paths.talk : paths.coworker(personaIdFromAgentId(id) ?? ''))}
            {...(chief ? { deskLabel: `Keep talking with ${first} in Talk` } : {})}
          />,
          a.el,
        );
      })}
    </>
  );
}

function readHintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) !== null;
  } catch {
    return true;
  }
}

/** One quiet chip, once: the three gestures that matter. No tour, no modal. */
function FirstRunHint() {
  const [open, setOpen] = useState(() => {
    let fine = false;
    try {
      fine = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
    } catch {
      fine = false;
    }
    return fine && !readHintSeen();
  });
  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* storage blocked: it may show again next time */
    }
    const t = setTimeout(() => setOpen(false), HINT_MS);
    const dismiss = () => setOpen(false);
    window.addEventListener('pointerdown', dismiss, { capture: true, once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', dismiss, { capture: true });
    };
  }, [open]);
  if (!open) return null;
  return (
    <div class="office-hint" data-testid="office-hint">
      <span>{HINT_TEXT}</span>
      <button type="button" class="office-hint-close" aria-label="Close the tip" onClick={() => setOpen(false)}>
        ×
      </button>
    </div>
  );
}

/** Transient feedback in desk mode (a joined huddle that could not be reached, push-to-talk); the stage's dock shows its own. */
function OfficeNotice({ office }: { office: OfficeMount }) {
  const n = notice.value;
  if (!n || office.mode.value !== 'desks') return null;
  return (
    <p class="office-notice" data-tone={n.tone} role="status">
      {n.text}
    </p>
  );
}
