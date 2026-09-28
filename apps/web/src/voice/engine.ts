// The one AudioEngine for the app (one AudioContext, created on the first gesture).
// Its speaking changes drive the local `speaking` face state: mouths move only when audio plays here.
import { createAudioEngine, type AudioEngine, type AudioSupport } from '@headcount/audio';
import { setLocalPresence } from '../store';

let engine: AudioEngine | null = null;
let unsubscribe: (() => void) | null = null;

function wire(e: AudioEngine): AudioEngine {
  unsubscribe?.();
  unsubscribe = e.onSpeakingChange((speakerId, speaking) => setLocalPresence(speakerId, 'speaking', speaking));
  return e;
}

export function audio(): AudioEngine {
  engine ??= wire(createAudioEngine());
  return engine;
}

/** Tests: swap in a fake engine (null → a fresh real one on next use). */
export function setAudioEngine(e: AudioEngine | null): void {
  unsubscribe?.();
  unsubscribe = null;
  engine = e ? wire(e) : null;
}

/** Create/resume the AudioContext. Call from inside a user gesture; never throws. */
export function armAudio(): void {
  try {
    void audio()
      .arm()
      .catch(() => undefined);
  } catch {
    /* no audio in this environment */
  }
}

const NO_SUPPORT: AudioSupport = { webAudio: false, mic: false, speechSynthesis: false, speechRecognition: false };

export function audioSupport(): AudioSupport {
  try {
    return audio().support();
  } catch {
    return NO_SUPPORT;
  }
}
