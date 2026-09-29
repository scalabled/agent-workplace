// Live voice (Inc 2): talk to the Chief of Staff hands-free. The mic stays open; the owner speaks when they like, and
// a pause ends their turn (voice activity, not a held key). Their words are transcribed and sent, and the mic listens
// again at once, so speaking over the Chief's answer interrupts it (barge-in), as in a real conversation. Playback is
// not ducked while the mic is open (echo cancellation keeps the Chief's own voice out). This is the cascade front
// (STT → the Chief → TTS, with the reflex layer's pre-voiced acknowledgements); a realtime front can take its place.
import type { AudioEngine, MicSession, OwnerVadEvent } from '@headcount/audio';
import { CHIEF_ID } from '@headcount/protocol';
import { signal } from '@preact/signals';
import { api, ApiError } from '../api/client';
import { setLocalPresence } from '../store';
import { errorSentence, sendOwnerMessage } from '../talk/actions';
import { showNotice } from '../ui/notice';
import { bargeIn, chiefIsSpeaking } from './chief-voice';
import { audio } from './engine';
import { takeVoice } from './handoff';

/** Quiet after speech that ends the owner's turn (the engine reports a pause after 350 ms of it; realtime providers use 450–500 ms). */
export const END_OF_TURN_MS = 650;
export const VAD_PAUSE_REPORTED_MS = 350;
/** Shorter than this is a cough or a click, not a turn. */
export const MIN_UTTERANCE_MS = 450;
/** A turn is cut here (the recording is sent as it is). */
export const MAX_UTTERANCE_MS = 45_000;
/** The owner's voice must hold this long over the Chief before it interrupts (not a breath or an echo). */
export const BARGE_IN_MS = 250;

export type LivePhase = 'off' | 'starting' | 'listening' | 'hearing' | 'sending';

export interface LiveVoiceState {
  phase: LivePhase;
  /** Turns sent in this live session. */
  turns: number;
}

export const liveVoice = signal<LiveVoiceState>({ phase: 'off', turns: 0 });

export interface LiveDeps {
  engine: Pick<AudioEngine, 'startPushToTalk' | 'onOwnerVad'>;
  transcribe(blob: Blob): Promise<string>;
  send(text: string, at: number): Promise<void>;
  /** Someone is speaking here now (the owner's voice interrupts them). */
  speaking(): boolean;
  bargeIn(): void;
  schedule(fn: () => void, ms: number): () => void;
  now(): number;
  onState(s: LiveVoiceState): void;
  onError(err: unknown): void;
}

export interface LiveVoice {
  start(): Promise<void>;
  stop(): void;
  readonly on: boolean;
}

export function createLiveVoice(deps: LiveDeps): LiveVoice {
  let on = false;
  let session: MicSession | null = null;
  let offVad: (() => void) | null = null;
  let heardAt: number | null = null;
  /** When the voice last went quiet (the start of the pause that may end the turn). */
  let quietAt: number | null = null;
  let endTimer: (() => void) | null = null;
  let maxTimer: (() => void) | null = null;
  let bargeTimer: (() => void) | null = null;
  let opening = 0;
  let sending = 0;
  let turns = 0;
  let phase: LivePhase = 'off';

  const set = (p: LivePhase) => {
    phase = p;
    deps.onState({ phase: sending > 0 && p === 'listening' ? 'sending' : p, turns });
  };
  const clear = () => {
    endTimer?.();
    maxTimer?.();
    bargeTimer?.();
    endTimer = maxTimer = bargeTimer = null;
  };

  async function open(): Promise<void> {
    if (!on) return;
    const my = ++opening;
    try {
      const s = await deps.engine.startPushToTalk({ duck: false });
      if (!on || my !== opening) {
        s.cancel();
        return;
      }
      session = s;
      heardAt = null;
      set('listening');
    } catch (err) {
      if (my !== opening) return;
      on = false;
      offVad?.();
      offVad = null;
      set('off');
      deps.onError(err);
    }
  }

  function onVad(e: OwnerVadEvent): void {
    if (!on || !session) return;
    if (e.kind === 'start' || e.kind === 'resume') {
      endTimer?.();
      endTimer = null;
      quietAt = null;
      if (heardAt === null) {
        heardAt = deps.now();
        maxTimer = deps.schedule(() => void finish(), MAX_UTTERANCE_MS);
      }
      set('hearing');
      // Speaking over the Chief interrupts them, once the voice holds (not a breath, not an echo).
      if (deps.speaking() && !bargeTimer)
        bargeTimer = deps.schedule(() => {
          bargeTimer = null;
          if (on && heardAt !== null && deps.speaking()) deps.bargeIn();
        }, BARGE_IN_MS);
    } else if (e.kind === 'pause' && heardAt !== null) {
      quietAt = deps.now() - (e.pauseMs ?? VAD_PAUSE_REPORTED_MS);
      bargeTimer?.();
      bargeTimer = null;
      endTimer?.();
      endTimer = deps.schedule(() => void finish(), Math.max(0, END_OF_TURN_MS - VAD_PAUSE_REPORTED_MS));
    }
  }

  /** The owner's turn is over: send it, and listen again at once. */
  async function finish(): Promise<void> {
    const s = session;
    if (!s || heardAt === null) return;
    const spoke = (quietAt ?? deps.now()) - heardAt;
    session = null;
    heardAt = null;
    quietAt = null;
    clear();
    if (spoke < MIN_UTTERANCE_MS) {
      s.cancel();
      void open();
      return;
    }
    const at = deps.now();
    const blob = await s.stop();
    sending++;
    void open();
    try {
      const text = (await deps.transcribe(blob)).trim();
      if (text && on) {
        turns++;
        await deps.send(text, at);
      }
    } catch (err) {
      deps.onError(err);
    } finally {
      sending--;
      if (on) set(phase === 'hearing' ? 'hearing' : 'listening');
    }
  }

  return {
    get on() {
      return on;
    },
    async start() {
      if (on) return;
      on = true;
      turns = 0;
      set('starting');
      offVad = deps.engine.onOwnerVad(onVad);
      await open();
    },
    stop() {
      if (!on) return;
      on = false;
      opening++;
      clear();
      offVad?.();
      offVad = null;
      session?.cancel();
      session = null;
      heardAt = null;
      set('off');
    },
  };
}

// ── the app's live voice ─────────────────────────────────────────────────────────

let live: LiveVoice | null = null;

function app(): LiveVoice {
  live ??= createLiveVoice({
    engine: audio(),
    transcribe: async (blob) => (await api.stt(blob)).text,
    send: (text, at) => sendOwnerMessage(text, 'voice', { at }).then(() => undefined),
    speaking: () => chiefIsSpeaking(),
    bargeIn,
    schedule: (fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
    now: () => Date.now(),
    onState: (s) => {
      liveVoice.value = s;
      setLocalPresence(CHIEF_ID, 'listening', s.phase === 'hearing');
    },
    onError: (err) => showNotice(err instanceof ApiError ? errorSentence(err) : err instanceof Error && err.message ? err.message : 'Live voice stopped. Try again.', 'error'),
  });
  return live;
}

export function startLiveVoice(): void {
  takeVoice();
  void app().start();
}

export function stopLiveVoice(): void {
  live?.stop();
}
