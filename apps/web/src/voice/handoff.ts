// One voice per workspace, in this tab: claim the voice on a real gesture in /app or when the owner comes back to this
// tab, send claims on the feed, hear the other tabs of this browser, and go quiet at once when another tab takes the
// voice (voice/owner.ts has the rules). Only a page on screen with focus claims: an agent driving a hidden embedded
// browser (its input is trusted and focuses the page, but the page reports hidden) never moves the voice.
import { effect } from '@preact/signals';
import type { VoiceClaimOp } from '@headcount/protocol/ext/voice-owner';
import { clientId } from '../lib/client-id';
import { chiefSpeaker } from './chief-voice';
import { audio } from './engine';
import { claimPending, claimVoice, setVoiceSend, startVoiceChannel, voiceActive, voiceOwner } from './owner';
import { stopSideVoices } from './side-voice';

/** Keys that are never an interaction by themselves (a modifier pressed to switch windows must not take the voice). */
const MODIFIERS = new Set(['Alt', 'AltGraph', 'CapsLock', 'Control', 'Fn', 'FnLock', 'Hyper', 'Meta', 'NumLock', 'OS', 'ScrollLock', 'Shift', 'Super', 'Symbol', 'SymbolLock']);

/** The owner is using this page: it is on screen and has focus. */
export function pageInUse(): boolean {
  try {
    return document.visibilityState === 'visible' && document.hasFocus();
  } catch {
    return false;
  }
}

/** A real gesture in /app claims the voice for this tab (when another tab or nobody has it). */
export function claimOnGesture(e: Event): void {
  if (!e.isTrusted) return;
  if (e instanceof KeyboardEvent && MODIFIERS.has(e.key)) return;
  if (!pageInUse()) return;
  takeVoice();
}

/** Take the voice unless this tab has it (or its claim is on the way). */
export function takeVoice(): void {
  if (voiceOwner.peek() === clientId() || claimPending()) return;
  claimVoice();
}

/** Everything this tab is saying stops now (another tab has the voice). */
export function silenceHere(): void {
  chiefSpeaker.stop();
  stopSideVoices();
  try {
    audio().stopAll();
  } catch {
    /* no audio here */
  }
}

/** Wire voice ownership for the app's lifetime. `send` delivers socket ops on the current feed. Returns the stop. */
export function startVoiceHandoff(send: (op: VoiceClaimOp) => void): () => void {
  setVoiceSend(send);
  const stopChannel = startVoiceChannel();
  let had = voiceActive.peek();
  const stopEffect = effect(() => {
    const here = voiceActive.value;
    if (had && !here) silenceHere();
    had = here;
  });
  window.addEventListener('pointerdown', claimOnGesture, { capture: true, passive: true });
  window.addEventListener('keydown', claimOnGesture, { capture: true });
  // Coming back to this tab (its browser tab or window was switched to, after it had been hidden or had lost focus)
  // takes the voice, so the tab the owner looks at is the one that speaks. A tab that only opens never takes it.
  let away = false;
  const onAway = (e: Event) => {
    if (e.type === 'blur' && e.target instanceof Node) return; // an element's blur, not the window's
    if (e.type === 'visibilitychange' && document.visibilityState !== 'hidden') return onBack(e);
    away = true;
  };
  const onBack = (e: Event) => {
    if (!away || !e.isTrusted || !pageInUse()) return;
    away = false;
    takeVoice();
  };
  window.addEventListener('blur', onAway);
  window.addEventListener('focus', onBack);
  document.addEventListener('visibilitychange', onAway);
  return () => {
    window.removeEventListener('pointerdown', claimOnGesture, { capture: true });
    window.removeEventListener('keydown', claimOnGesture, { capture: true });
    window.removeEventListener('blur', onAway);
    window.removeEventListener('focus', onBack);
    document.removeEventListener('visibilitychange', onAway);
    stopEffect();
    stopChannel();
    setVoiceSend(null);
  };
}
