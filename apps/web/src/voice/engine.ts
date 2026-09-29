// The one AudioEngine for the app (one AudioContext, created on the first gesture).
// Its speaking changes drive the local `speaking` face state: mouths move only when audio plays here.
import { createAudioEngine, type AudioEngine, type AudioSupport } from '@headcount/audio';
import { hotKeep, hotTake } from '../lib/hot';
import { setLocalPresence } from '../store';

// One engine per page, also across hot updates (dev): a re-evaluated module takes the running engine over instead of
// opening a second AudioContext beside it.
const kept = hotKeep('audio-engine', hotTake<{ engine: AudioEngine | null; unsubscribe: (() => void) | null }>('audio-engine') ?? { engine: null, unsubscribe: null });
kept.unsubscribe?.();
kept.unsubscribe = null;
let engine: AudioEngine | null = kept.engine;
let unsubscribe: (() => void) | null = null;
if (engine) wire(engine);

function wire(e: AudioEngine): AudioEngine {
  unsubscribe?.();
  unsubscribe = e.onSpeakingChange((speakerId, speaking) => setLocalPresence(speakerId, 'speaking', speaking));
  kept.engine = e;
  kept.unsubscribe = unsubscribe;
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
  kept.engine = null;
  kept.unsubscribe = null;
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
