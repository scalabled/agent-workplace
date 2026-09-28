// Push-to-talk capture: getUserMedia → MediaRecorder (webm/opus where supported) → one Blob for
// POST /api/speech/stt, with a cheap AnalyserNode level meter on the shared AudioContext.
// Constraints and the "readable sentence" error style follow personagram-ai/src/web/voice/webrtc.ts
// and transports.ts ("Microphone access was denied. You can still use text, …").

import { MicError, type MicSession } from './types';

type RecorderCtor = {
  new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
  isTypeSupported?(type: string): boolean;
};

/** Preferred containers, best first: Opus in WebM (Chrome, Firefox, Edge), Ogg, then MP4/AAC (Safari). */
export const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac'] as const;

export function pickRecordingType(Recorder: RecorderCtor): string | undefined {
  const check = Recorder.isTypeSupported?.bind(Recorder);
  if (!check) return undefined;
  for (const t of RECORDING_TYPES) {
    try {
      if (check(t)) return t;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** 'audio/webm;codecs=opus' → 'audio/webm'. */
export function baseMime(type: string | undefined | null, fallback = 'audio/webm'): string {
  const t = (type ?? '').split(';')[0]!.trim().toLowerCase();
  return t.startsWith('audio/') ? t : t === 'video/webm' ? 'audio/webm' : fallback;
}

export const MIC_MESSAGES: Record<MicError['code'], string> = {
  denied: 'Microphone access is blocked. Allow it in your browser’s site settings, then try again.',
  'no-device': 'No microphone was found. Connect one, then try again.',
  busy: 'Another app is using the microphone. Close it, then try again.',
  insecure: 'The microphone needs a secure page. Open the app over https or on localhost.',
  unsupported: 'This browser can’t record audio. Type instead, or use a current Chrome, Edge, Firefox or Safari.',
  network: 'Browser dictation needs a network connection. Check it, then try again.',
  failed: 'The microphone didn’t start. Try again, or type instead.',
};

export function micError(code: MicError['code']): MicError {
  return new MicError(code, MIC_MESSAGES[code]);
}

/** getUserMedia / MediaRecorder failure → one readable sentence. */
export function toMicError(err: unknown): MicError {
  if (err instanceof MicError) return err;
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return micError('denied');
    case 'SecurityError':
      return micError('insecure');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return micError('no-device');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return micError('busy');
    case 'NotSupportedError':
    case 'TypeError':
      return micError('unsupported');
    default:
      return micError('failed');
  }
}

/** Web Speech recognizer error codes → readable sentence (null = not an error worth showing). */
export function recognitionError(code: string): MicError | null {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return micError('denied');
    case 'audio-capture':
      return micError('no-device');
    case 'network':
      return micError('network');
    case 'language-not-supported':
      return micError('unsupported');
    case 'no-speech':
    case 'aborted':
      return null;
    default:
      return micError('failed');
  }
}

export interface LevelMeter {
  level(): number;
  close(): void;
}

/** RMS of the mic on a dB scale: −60 dBFS → 0, −15 dBFS → 1, fast attack, ~150 ms release. */
export function createLevelMeter(ctx: AudioContext, stream: MediaStream): LevelMeter | null {
  let source: MediaStreamAudioSourceNode;
  let analyser: AnalyserNode;
  let sink: GainNode;
  try {
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    sink = ctx.createGain();
    sink.gain.value = 0; // keeps the tap pulled in every browser without echoing the mic
    source.connect(analyser);
    analyser.connect(sink);
    sink.connect(ctx.destination);
  } catch {
    return null;
  }
  const buf = new Float32Array(analyser.fftSize);
  let smoothed = 0;
  return {
    level() {
      try {
        analyser.getFloatTimeDomainData(buf);
      } catch {
        return 0;
      }
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
      const rms = Math.sqrt(sum / buf.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -100;
      const raw = Math.max(0, Math.min(1, (db + 60) / 45));
      smoothed = raw > smoothed ? raw : smoothed * 0.85 + raw * 0.15;
      return smoothed;
    },
    close() {
      for (const n of [source, analyser, sink]) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export interface OpenRecorderOptions {
  mediaDevices: Pick<MediaDevices, 'getUserMedia'> | null | undefined;
  Recorder: RecorderCtor | null | undefined;
  secureContext?: boolean;
  /** Returns the shared context (created/resumed) for the level meter, or null. */
  context: () => AudioContext | null;
  now: () => number;
  /** Called exactly once when the mic is released (stop, cancel, failure, track ended + stop). */
  onRelease: () => void;
}

/** Asks for the mic and starts recording. Throws MicError with a readable message. */
export async function openRecorder(o: OpenRecorderOptions): Promise<MicSession> {
  if (!o.mediaDevices?.getUserMedia) throw micError(o.secureContext === false ? 'insecure' : 'unsupported');
  if (!o.Recorder) throw micError('unsupported');
  let stream: MediaStream;
  try {
    stream = await o.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    throw toMicError(err);
  }
  const tracksOff = () => {
    for (const t of stream.getTracks()) {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    }
  };
  const wanted = pickRecordingType(o.Recorder);
  let rec: MediaRecorder;
  try {
    rec = wanted ? new o.Recorder(stream, { mimeType: wanted, audioBitsPerSecond: 48_000 }) : new o.Recorder(stream);
  } catch {
    try {
      rec = new o.Recorder(stream);
    } catch (err) {
      tracksOff();
      throw toMicError(err);
    }
  }
  const ctx = o.context();
  const meter = ctx ? createLevelMeter(ctx, stream) : null;
  const parts: Blob[] = [];
  const startedAt = o.now();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    meter?.close();
    tracksOff();
    o.onRelease();
  };
  const mime = () => baseMime(rec.mimeType || wanted);
  let stopped: Promise<Blob> | null = null;
  let stopResolve: ((b: Blob) => void) | null = null;
  const finalize = () => {
    release();
    stopResolve?.(new Blob(parts, { type: mime() }));
    stopResolve = null;
  };
  rec.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size > 0) parts.push(e.data);
  };
  rec.onstop = () => finalize();
  rec.onerror = () => finalize();
  try {
    rec.start(250);
  } catch (err) {
    release();
    throw toMicError(err);
  }
  return {
    get mime() {
      return mime();
    },
    level: () => (released ? 0 : (meter?.level() ?? 0)),
    elapsedMs: () => o.now() - startedAt,
    stop() {
      if (stopped) return stopped;
      stopped = new Promise<Blob>((resolve) => {
        stopResolve = resolve;
        if (rec.state === 'inactive') finalize();
        else {
          try {
            rec.stop();
          } catch {
            finalize();
          }
        }
      });
      return stopped;
    },
    cancel() {
      rec.ondataavailable = null;
      rec.onstop = null;
      rec.onerror = null;
      try {
        if (rec.state !== 'inactive') rec.stop();
      } catch {
        /* ignore */
      }
      parts.length = 0;
      release();
      stopResolve?.(new Blob([], { type: mime() }));
      stopResolve = null;
    },
  };
}
