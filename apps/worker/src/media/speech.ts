import { SPEECH_HEADERS, TTS_MAX_CHARS, type SttResponse, type TtsJsonResponse } from '@headcount/protocol';
import { STT_UPLOAD_MAX_BYTES } from '@headcount/protocol/ext/media';
import type { Env } from '../env';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { takeDaily } from '../lib/limits';
import { withFailover } from './failover';
import { toBase64 } from './image';
import { chooseVoice, voiceHeader } from './voice';

// Speech routes (owned by media). Provider choice is the registry's (TTS xai → openai, STT openai → xai); keys never
// leave the worker. Keyless, both answer 503 not_configured naming OPENAI_API_KEY / XAI_API_KEY, and the browser
// falls back to speechSynthesis / SpeechRecognition. Mock speech (silent WAV with even alignment, a fixed
// transcript) is opt-in with MOCK_MEDIA=true, for tests and demos of the provider path without keys.

/** Mock TTS/STT only when MOCK_MEDIA=true (and ENABLE_MOCK): keyless callers get a clear "add a key" answer. */
export function mockMediaEnabled(env: Env): boolean {
  return env.MOCK_MEDIA === 'true' && env.ENABLE_MOCK === 'true';
}

const SPEAKER_ID = /^[A-Za-z0-9_:.-]{1,120}$/;

/** POST /api/speech/tts {text, voiceRef, speakerId, format?, response?} → audio bytes, or TtsJsonResponse with response:"json". */
export const handleTts: RouteHandler = async (req, rc) => {
  const body = await readJson<unknown>(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('bad_request', 'Send {text, voiceRef, speakerId} as JSON.');
  const b = body as Record<string, unknown>;
  if (typeof b.text !== 'string' || !b.text.trim()) throw new HttpError('bad_request', 'There is no text to speak.');
  if (b.text.length > TTS_MAX_CHARS) throw new HttpError('payload_too_large', `Speak at most ${TTS_MAX_CHARS} characters per request.`);
  if (typeof b.speakerId !== 'string' || !SPEAKER_ID.test(b.speakerId)) throw new HttpError('bad_request', 'Include the speakerId of the agent who is speaking.');
  if (b.format !== undefined && b.format !== 'mp3' && b.format !== 'wav') throw new HttpError('bad_request', 'Use format "mp3" or "wav".');
  if (b.response !== undefined && b.response !== 'audio' && b.response !== 'json') throw new HttpError('bad_request', 'Use response "audio" or "json".');
  const format = b.format as 'mp3' | 'wav' | undefined;
  const asJson = b.response === 'json';
  const text = b.text.trim();
  const { voice, prefer } = chooseVoice(b.voiceRef, b.speakerId);

  // TTS_DAILY_LIMIT: counted before the call, given back when no provider answered.
  const refund = await takeDaily(rc.env, 'tts');
  let result;
  try {
    result = await withFailover(
      rc.registry(),
      'tts',
      { prefer, allowMock: mockMediaEnabled(rc.env) },
      (r) => r.provider.tts({ text, voice, ...(format ? { format } : {}), withAlignment: asJson, signal: req.signal }),
      req.signal,
    );
  } catch (err) {
    await refund();
    throw err;
  }
  const { value: out, resolved } = result;
  const provider = out.provider ?? resolved.providerId;
  const voiceLabel = voiceHeader(out.voice);

  if (asJson) return json<TtsJsonResponse>({ mime: out.mime, audioBase64: toBase64(out.audio), alignment: out.alignment ?? null, provider, voice: voiceLabel });
  return new Response(out.audio, {
    headers: {
      'content-type': out.mime,
      'content-length': String(out.audio.byteLength),
      'cache-control': 'no-store',
      [SPEECH_HEADERS.provider]: provider,
      [SPEECH_HEADERS.voice]: voiceLabel,
    },
  });
};

/** Content types a recording may arrive as (MediaRecorder: webm/ogg/mp4; uploads: wav/mpeg/…). */
function recordingMime(header: string | null): string {
  const base = (header ?? '').split(';')[0]!.trim().toLowerCase();
  if (base === 'video/webm') return 'audio/webm'; // some browsers label audio-only webm as video
  if (!/^audio\/[a-z0-9.+-]+$/.test(base)) throw new HttpError('unsupported_media_type', 'Send the recording as audio (for example audio/webm or audio/wav).');
  return base;
}

/** POST /api/speech/stt (raw audio body, ≤10 MB; optional ?language=en) → SttResponse. */
export const handleStt: RouteHandler = async (req, rc) => {
  const mime = recordingMime(req.headers.get('content-type'));
  const tooLarge = () => new HttpError('payload_too_large', `Keep recordings under ${STT_UPLOAD_MAX_BYTES / (1024 * 1024)} MB.`);
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > STT_UPLOAD_MAX_BYTES) throw tooLarge();
  const audio = await req.arrayBuffer();
  if (audio.byteLength > STT_UPLOAD_MAX_BYTES) throw tooLarge();
  if (audio.byteLength === 0) throw new HttpError('bad_request', 'The recording is empty. Hold to talk, then let go.');
  const langParam = rc.url.searchParams.get('language');
  const language = langParam && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(langParam) ? langParam : undefined;

  // STT_DAILY_LIMIT: counted before the call, given back when no provider answered.
  const refund = await takeDaily(rc.env, 'stt');
  let result;
  try {
    result = await withFailover(
      rc.registry(),
      'stt',
      { allowMock: mockMediaEnabled(rc.env) },
      (r) => r.provider.stt({ audio, mime, ...(language ? { language } : {}), signal: req.signal }),
      req.signal,
    );
  } catch (err) {
    await refund();
    throw err;
  }
  const { value: out, resolved } = result;
  const lang = out.language ?? language;
  return json<SttResponse>({ text: out.text.trim(), provider: out.provider ?? resolved.providerId, ...(lang ? { language: lang } : {}) });
};
