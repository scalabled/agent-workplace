// Push-to-talk to the Chief of Staff: hold the bubble, the header face, the mic button or Space;
// release to send. Provider STT when configured, else the browser's speech recognition (keyless).
// Starting to talk is a barge-in: the Chief of Staff stops speaking at once. The recording lifecycle
// (permission, too-short presses, dictation) is the audio package's createPushToTalk.
import { signal } from '@preact/signals';
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
  await sendOwnerMessage(text, 'voice', { at });
}

function ptc(): PushToTalk {
  controller ??= createPushToTalk(audio(), {
    mode: 'hold',
    dictation: () => pttMode() === 'dictation',
    lang: typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US',
    onState: (s) => {
      const listening = s === 'starting' || s === 'recording';
      setLocalPresence(CHIEF_ID, 'listening', listening);
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

/** Start listening (from a gesture: pointerdown past the hold threshold, Space keydown). */
export function startPtt(): void {
  if (ptt.value.phase !== 'idle') return;
  if (!pttMode()) {
    showNotice('This browser cannot listen. Type your message instead.', 'error');
    return;
  }
  bargeIn();
  armAudio();
  ptc().press();
}

/** Release: stop listening and send what was heard. */
export function endPtt(): void {
  if (controller && ptt.value.phase === 'listening') {
    releasedAt = Date.now();
    livingCue(CHIEF_ID, { gesture: 'look_up', expression: 'thinking', holdMs: TRANSCRIBING_CUE_MS });
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
}
