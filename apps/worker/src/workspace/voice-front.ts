// The voice front (ARCHITECTURE §8.2, Inc 2): when the owner speaks to the Chief of Staff, a realtime voice model says
// a short acknowledgement in the Chief's own voice ("Sure, let me look at the suppliers") while the brain works on the
// substance. The model is held here, server-side (the key never reaches the browser): one socket per spoken turn,
// text in (the owner's words), audio out (PCM16 24 kHz), told to acknowledge in under eight words and never to answer.
// Protocol as exercised against xAI in personagram-ai (conversation.ts realtimeTurn): session.update →
// session.updated → conversation.item.create → response.create → response.(output_)audio.delta … response.done.
// Mock (keyless, VOICE_FRONT=mock with MOCK_MEDIA): a short quiet clip with a fixed line, so the path can be tested.
import type { Env } from '../env';
import { mockMediaEnabled } from '../media/speech';

export const FRONT_SAMPLE_RATE = 24_000;
export const DEFAULT_REALTIME_MODEL = 'grok-voice-think-fast-2.0';
/** The whole acknowledgement, socket to last audio. */
export const FRONT_DEADLINE_MS = 5000;
/** Waiting for session.updated after session.created (some servers skip it). */
const SESSION_GRACE_MS = 1500;

export type FrontProvider = 'xai' | 'mock';

/** xAI when its key is set (VOICE_FRONT=off turns it off); the mock only when asked for (VOICE_FRONT=mock with mock media). */
export function voiceFrontOf(env: Pick<Env, 'VOICE_FRONT' | 'XAI_API_KEY' | 'MOCK_MEDIA' | 'ENABLE_MOCK'>): FrontProvider | null {
  const want = (env.VOICE_FRONT ?? '').toLowerCase();
  if (want === 'off') return null;
  if (want === 'mock') return mockMediaEnabled(env as Env) ? 'mock' : null;
  return env.XAI_API_KEY ? 'xai' : null;
}

export type FrontPart = { audio: string } | { text: string };

export interface AckRequest {
  /** What the owner said. */
  said: string;
  /** The Chief's name and manner, for the instructions. */
  chiefName: string;
  style?: string;
  /** The lead's realtime voice id (catalog `voice.xai_realtime`). */
  voice: string;
  signal: AbortSignal;
}

/** A WebSocket as the front needs it (Workers' fetch-upgrade socket, or a test double). */
export interface FrontSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', cb: (e: { data: unknown }) => void): void;
  addEventListener(type: 'close' | 'error', cb: () => void): void;
}

export type FrontConnect = (url: string, headers: Record<string, string>, signal: AbortSignal) => Promise<FrontSocket>;

/** Workers: an outbound WebSocket is a fetch with Upgrade; the socket is on the response. */
export const workersConnect: FrontConnect = async (url, headers, signal) => {
  const res = await fetch(url, { headers: { ...headers, Upgrade: 'websocket' }, signal });
  const ws = (res as Response & { webSocket?: WebSocket & { accept(): void } }).webSocket;
  if (!ws) throw new Error(`The realtime voice did not open (HTTP ${res.status}).`);
  ws.accept();
  return ws as unknown as FrontSocket;
};

export function ackInstructions(r: Pick<AckRequest, 'chiefName' | 'style'>): string {
  return [
    `You are ${r.chiefName}, the owner's Chief of Staff, speaking out loud.`,
    'The owner has just said something to you. Acknowledge it in under eight words, naturally, so they know you heard what they asked (for example: "Sure, let me look at the supplier options.").',
    'Do not answer it, give facts, numbers or opinions, or promise a time: someone else is working out the answer and will speak next.',
    r.style ? `Your manner: ${r.style}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The acknowledgement as it streams: audio pieces (base64 PCM16) and its words. Ends at response.done. */
export async function* realtimeAck(env: Env, req: AckRequest, connect: FrontConnect = workersConnect): AsyncGenerator<FrontPart> {
  const provider = voiceFrontOf(env);
  if (!provider) return;
  if (provider === 'mock') {
    yield* mockAck(req.signal);
    return;
  }
  const model = env.REALTIME_VOICE_MODEL || DEFAULT_REALTIME_MODEL;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), FRONT_DEADLINE_MS);
  const onAbort = () => deadline.abort();
  req.signal.addEventListener('abort', onAbort, { once: true });
  const queue: (FrontPart | { end: true } | { error: string })[] = [];
  let wake: (() => void) | null = null;
  const push = (x: (typeof queue)[number]) => {
    queue.push(x);
    wake?.();
    wake = null;
  };
  let ws: FrontSocket | null = null;
  try {
    ws = await connect(`https://api.x.ai/v1/realtime?model=${encodeURIComponent(model)}`, { Authorization: `Bearer ${env.XAI_API_KEY}` }, deadline.signal);
    const socket = ws;
    let asked = false;
    const ask = () => {
      if (asked) return;
      asked = true;
      socket.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: req.said.slice(0, 2000) }] } }));
      socket.send(JSON.stringify({ type: 'response.create', response: { modalities: ['text', 'audio'] } }));
    };
    let grace: ReturnType<typeof setTimeout> | null = null;
    socket.addEventListener('message', (e) => {
      let m: { type?: string; delta?: unknown; error?: { message?: string } };
      try {
        m = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer));
      } catch {
        return;
      }
      if (m.type === 'session.created') grace ??= setTimeout(ask, SESSION_GRACE_MS);
      else if (m.type === 'session.updated') {
        if (grace) clearTimeout(grace);
        ask();
      } else if ((m.type === 'response.output_audio.delta' || m.type === 'response.audio.delta') && typeof m.delta === 'string') push({ audio: m.delta });
      else if ((m.type === 'response.output_audio_transcript.delta' || m.type === 'response.audio_transcript.delta') && typeof m.delta === 'string') push({ text: m.delta });
      else if (m.type === 'response.done') push({ end: true });
      else if (m.type === 'error') push({ error: String(m.error?.message ?? 'realtime error').slice(0, 200) });
    });
    socket.addEventListener('close', () => push({ end: true }));
    socket.addEventListener('error', () => push({ error: 'The realtime voice connection failed.' }));
    socket.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          voice: req.voice,
          instructions: ackInstructions(req),
          turn_detection: null,
          audio: { input: { format: { type: 'audio/pcm', rate: FRONT_SAMPLE_RATE } }, output: { format: { type: 'audio/pcm', rate: FRONT_SAMPLE_RATE } } },
        },
      }),
    );
    deadline.signal.addEventListener('abort', () => push({ end: true }), { once: true });
    for (;;) {
      while (!queue.length) await new Promise<void>((r) => (wake = r));
      const next = queue.shift()!;
      if ('end' in next) return;
      if ('error' in next) throw new Error(next.error);
      yield next;
    }
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener('abort', onAbort);
    try {
      ws?.close(1000, 'done');
    } catch {
      /* closed */
    }
  }
}

/** Keyless: a quarter-second of near-silence in two pieces and a fixed line. */
async function* mockAck(signal: AbortSignal): AsyncGenerator<FrontPart> {
  const samples = FRONT_SAMPLE_RATE / 8;
  const pcm = new Uint8Array(samples * 2);
  for (let i = 0; i < samples; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 220 * i) / FRONT_SAMPLE_RATE) * 60);
    pcm[i * 2] = v & 0xff;
    pcm[i * 2 + 1] = (v >> 8) & 0xff;
  }
  const b64 = btoa(String.fromCharCode(...pcm));
  yield { text: 'One moment.' };
  for (let k = 0; k < 2; k++) {
    if (signal.aborted) return;
    yield { audio: b64 };
  }
}
