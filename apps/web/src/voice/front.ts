// The voice front on the owner's tab (Inc 2): the Chief of Staff's realtime acknowledgement of a spoken turn
// ("Sure, let me look at the suppliers"), played in their voice as it streams, before their answer (one queue per
// speaker in the audio engine keeps the order). A turn whose brain answered first sends `cancelled` and nothing plays.
// Barge-in stops it with the rest of the Chief's voice. Only the tab that has the voice plays it.
import { CHIEF_ID } from '@headcount/protocol';
import { onFrame, settings } from '../store';
import { audio } from './engine';
import { claimUnsettled, mayVoice } from './owner';

/** PCM16 little-endian mono → a WAV file the engine can decode. */
export function pcm16ToWav(pcm: Uint8Array, rate: number): ArrayBuffer {
  const out = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(out);
  const str = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + pcm.byteLength, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, pcm.byteLength, true);
  new Uint8Array(out, 44).set(pcm);
  return out;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

interface Playing {
  turnId: string;
  push(chunk: ArrayBuffer): void;
  end(): void;
  stop(): void;
}

let current: Playing | null = null;
/** Acknowledgements still sounding (streamed in full, or not). */
const sounding = new Set<Playing>();

function open(turnId: string): Playing {
  const queue: ArrayBuffer[] = [];
  let ended = false;
  let wake: (() => void) | null = null;
  const chunks: AsyncIterable<{ audio: ArrayBuffer; mime: string }> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (!queue.length && !ended) await new Promise<void>((r) => (wake = r));
        const next = queue.shift();
        if (next) yield { audio: next, mime: 'audio/wav' };
        else if (ended) return;
      }
    },
  };
  const handle = audio().speak({ speakerId: CHIEF_ID, chunks });
  const nudge = () => {
    wake?.();
    wake = null;
  };
  const p: Playing = {
    turnId,
    push(chunk) {
      queue.push(chunk);
      nudge();
    },
    end() {
      ended = true;
      nudge();
    },
    stop() {
      ended = true;
      queue.length = 0;
      nudge();
      handle.stop();
    },
  };
  sounding.add(p);
  void handle.done.then(() => sounding.delete(p));
  return p;
}

/** An acknowledgement is playing (or about to) here. */
export function frontPlaying(): boolean {
  return sounding.size > 0;
}

/** Barge-in, or the voice moved away: the acknowledgement stops now. */
export function stopVoiceFront(): void {
  for (const p of [...sounding]) p.stop();
  sounding.clear();
  current = null;
}

/** Play the voice front's acknowledgements while voice is on here. Returns the unsubscribe. */
export function startVoiceFront(): () => void {
  const off = onFrame((frame, { live }) => {
    if (frame.type !== 'talk.front' || !live) return;
    const d = frame.data;
    if (d.cancelled) {
      if (current?.turnId === d.turnId) stopVoiceFront();
      return;
    }
    if (!settings.value?.voiceOn || !mayVoice() || claimUnsettled()) return;
    if (current && current.turnId !== d.turnId) {
      current.end();
      current = null;
    }
    if (d.audio) {
      current ??= open(d.turnId);
      current.push(pcm16ToWav(fromBase64(d.audio), d.sampleRate ?? 24_000));
    }
    if (d.done && current?.turnId === d.turnId) {
      current.end();
      current = null;
    }
  });
  return () => {
    off();
    stopVoiceFront();
  };
}
