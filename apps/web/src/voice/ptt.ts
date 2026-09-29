// Push-to-talk to the Chief of Staff: hold the bubble, the header face, the mic button or Space;
// release to send. Provider STT when configured, else the browser's speech recognition (keyless).
// Starting to talk is a barge-in: the Chief of Staff stops speaking at once. The recording lifecycle
// (permission, too-short presses, dictation) is the audio package's createPushToTalk.
// While an office room or a joined huddle is open, push-to-talk goes there instead (the target, OFFICE-PHASE2 §4.3):
// pressing hushes the room, the result is sent to it, and the Chief's face does not show listening.
import { computed, signal, type ReadonlySignal } from '@preact/signals';
import { createPushToTalk, type PushToTalk, type PushToTalkResult } from '@headcount/audio';
import { CHIEF_ID } from '@headcount/protocol';
import { api } from '../api/client';
import { livingCue } from '../living';
import { can, setLocalPresence } from '../store';
import { errorSentence, sendOwnerMessage } from '../talk/actions';
import { showNotice } from '../ui/notice';
import { bargeIn } from './chief-voice';
import { armAudio, audio, audioSupport } from './engine';

export type PttPhase = 'idle' | 'starting' | 'listening' | 'transcribing';

export interface PttState {
  phase: PttPhase;
  /** Live transcript while dictating (browser recognition only). */
  partial: string;
  /** 0–1 mic level while recording (provider STT path). */
  level: number;
}

export const ptt = signal<PttState>({ phase: 'idle', partial: '', level: 0 });

/** Where push-to-talk goes: the Chief of Staff (Talk), or an office room or joined huddle while one is open. */
export type PttTarget =
  | { kind: 'chief' }
  | {
      kind: 'room';
      roomId: string;
      /** Who hears it, for captions and labels: "the Skyline room", "Kate and Pax". */
      label: string;
      /** Barge-in: hush the room (≤ 300 ms, X5). */
      onStart(): void;
      /** The words heard; `at` is when the owner let go. */
      send(text: string, at: number): Promise<void>;
    };

const CHIEF_TARGET: PttTarget = { kind: 'chief' };
/** Targets set by open rooms and huddles, newest last; the Chief when none is open. */
const targets = signal<readonly PttTarget[]>([]);
/** Where push-to-talk goes now (the newest open room or huddle, else the Chief). */
export const pttTarget: ReadonlySignal<PttTarget> = computed(() => targets.value[targets.value.length - 1] ?? CHIEF_TARGET);
/** The target of the current (or last) press: its result goes there even if the target changes mid-hold. */
const pressed = signal<PttTarget | null>(null);
export const pttPressTarget: ReadonlySignal<PttTarget | null> = pressed;

/**
 * Set while a room or joined huddle is open: push-to-talk goes there. Returns the restore function (back to whatever
 * was the target before, in the end the Chief). Restores may come in any order.
 */
export function setPttTarget(t: PttTarget): () => void {
  targets.value = [...targets.peek().filter((x) => x !== t), t];
  return () => {
    if (targets.peek().includes(t)) targets.value = targets.peek().filter((x) => x !== t);
  };
}

/** How push-to-talk would capture right now, or null when nothing can (then its controls are hidden). */
export function pttMode(): 'stt' | 'dictation' | null {
  const s = audioSupport();
  if (can('stt') && s.mic) return 'stt';
  if (s.speechRecognition) return 'dictation';
  return null;
}

let controller: PushToTalk | null = null;
let poll: ReturnType<typeof setInterval> | undefined;
/** When the owner let go (the living layer times the turn from here, not from the end of STT). */
let releasedAt: number | null = null;
/** The face looks up and thinks while speech is transcribed. */
const TRANSCRIBING_CUE_MS = 1500;

function set(patch: Partial<PttState>) {
  ptt.value = { ...ptt.value, ...patch };
}

async function onResult(result: PushToTalkResult): Promise<void> {
  const target = pressed.peek() ?? pttTarget.peek();
  let text = '';
  if (result.kind === 'text') text = result.text;
  else {
    set({ phase: 'transcribing', level: 0 });
    try {
      text = (await api.stt(result.blob)).text;
    } catch (err) {
      set({ phase: 'idle' });
      showNotice(`${errorSentence(err)} Or type it instead.`, 'error');
      return;
    }
    set({ phase: 'idle' });
  }
  if (!text.trim()) {
    showNotice('I did not catch that. Hold to talk, release to send.');
    return;
  }
  const at = releasedAt ?? Date.now();
  releasedAt = null;
  if (target.kind === 'room') {
    try {
      await target.send(text, at);
    } catch (err) {
      showNotice(errorSentence(err), 'error');
    }
    return;
  }
  await sendOwnerMessage(text, 'voice', { at });
}

function ptc(): PushToTalk {
  controller ??= createPushToTalk(audio(), {
    mode: 'hold',
    dictation: () => pttMode() === 'dictation',
    lang: typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US',
    onState: (s) => {
      const listening = s === 'starting' || s === 'recording';
      // The Chief's face listens only when the words go to the Chief (a room's people are not the Chief).
      setLocalPresence(CHIEF_ID, 'listening', listening && pressed.peek()?.kind !== 'room');
      clearInterval(poll);
      if (s === 'recording') poll = setInterval(() => set({ level: controller?.level() ?? 0 }), 100);
      // 'idle' comes before onResult; a recording then shows 'transcribing' while STT runs.
      if (s === 'idle') set({ phase: 'idle', partial: '', level: 0 });
      else set({ phase: s === 'starting' ? 'starting' : s === 'recording' ? 'listening' : 'transcribing', ...(s === 'starting' ? { partial: '' } : {}) });
    },
    onPartial: (partial) => set({ partial }),
    onResult: (r) => void onResult(r),
    onError: (e) => {
      showNotice(e.message, 'error');
      controller?.cancel(); // the mic is not listening: do not keep saying so
    },
    onTooShort: () => showNotice('Hold to talk, release to send.'),
  });
  return controller;
}

/**
 * Start listening (from a gesture: pointerdown past the hold threshold, Space keydown). Talking is a barge-in on the
 * target: the Chief stops at once, or the room hushes. `target` pins where this press goes (default: pttTarget).
 */
export function startPtt(opts: { target?: PttTarget } = {}): void {
  if (ptt.value.phase !== 'idle') return;
  if (!pttMode()) {
    showNotice('This browser cannot listen. Type your message instead.', 'error');
    return;
  }
  const target = opts.target ?? pttTarget.peek();
  pressed.value = target;
  if (target.kind === 'room') {
    try {
      target.onStart();
    } catch (err) {
      console.error('room barge-in failed', err);
    }
  } else bargeIn();
  armAudio();
  ptc().press();
}

/** Release: stop listening and send what was heard. */
export function endPtt(): void {
  if (controller && ptt.value.phase === 'listening') {
    releasedAt = Date.now();
    if (pressed.peek()?.kind !== 'room') livingCue(CHIEF_ID, { gesture: 'look_up', expression: 'thinking', holdMs: TRANSCRIBING_CUE_MS });
  }
  controller?.release();
}

/** Esc, or leaving mid-hold: discard without sending. */
export function cancelPtt(): void {
  controller?.cancel();
}

/** Tests: drop the controller so the next press builds a fresh one. */
export function resetPtt(): void {
  controller?.destroy();
  controller = null;
  clearInterval(poll);
  ptt.value = { phase: 'idle', partial: '', level: 0 };
  pressed.value = null;
  targets.value = [];
}
