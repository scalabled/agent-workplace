// Inc 2, the voice front: a spoken turn gets a short spoken acknowledgement from a realtime voice model (xAI, held
// server-side) while the brain works. The protocol against a fake socket, failures, the provider choice, and the talk
// turn in mock mode (frames to the owner's tab; nothing for a typed turn).
import { ids, parseFrame, type Frame } from '@headcount/protocol';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { ackInstructions, realtimeAck, voiceFrontOf, type FrontConnect, type FrontSocket } from '../src/workspace/voice-front';
import type { WorkspaceDO } from '../src/workspace/workspace-do';
import { createTestEnv } from './fake-cloud';

function fakeRealtime(script: (send: (m: object) => void, got: Record<string, unknown>) => void) {
  const sent: Record<string, unknown>[] = [];
  let url = '';
  let headers: Record<string, string> = {};
  let closed = false;
  const listeners: Record<string, ((e: { data: unknown }) => void)[]> = { message: [], close: [], error: [] };
  const socket: FrontSocket = {
    send(data) {
      const m = JSON.parse(data) as Record<string, unknown>;
      sent.push(m);
      script((out) => queueMicrotask(() => listeners.message!.forEach((cb) => cb({ data: JSON.stringify(out) }))), m);
    },
    close() {
      closed = true;
    },
    addEventListener(type: string, cb: (e: { data: unknown }) => void) {
      listeners[type]!.push(cb);
    },
  } as FrontSocket;
  const connect: FrontConnect = async (u, h) => {
    url = u;
    headers = h;
    return socket;
  };
  return { connect, sent, url: () => url, headers: () => headers, closed: () => closed };
}

const env = (vars: Partial<Env> = {}) => ({ XAI_API_KEY: 'xai-test-key', ...vars }) as Env;
const req = (signal = new AbortController().signal) => ({ said: 'Can you find me a new coffee supplier?', chiefName: 'Rosa', voice: 'eve', style: 'Warm, brisk.', signal });

describe('the voice front', () => {
  it('opens a realtime turn: session, the owner’s words, a response; streams audio and words until done', async () => {
    const f = fakeRealtime((send, m) => {
      if (m.type === 'session.update') send({ type: 'session.updated' });
      if (m.type === 'response.create') {
        send({ type: 'response.output_audio_transcript.delta', delta: 'Sure, ' });
        send({ type: 'response.output_audio.delta', delta: 'AAAA' });
        send({ type: 'response.audio.delta', delta: 'BBBB' });
        send({ type: 'response.audio_transcript.delta', delta: 'on it.' });
        send({ type: 'response.done' });
      }
    });
    const parts = [];
    for await (const p of realtimeAck(env(), req(), f.connect)) parts.push(p);
    expect(parts).toEqual([{ text: 'Sure, ' }, { audio: 'AAAA' }, { audio: 'BBBB' }, { text: 'on it.' }]);
    expect(f.url()).toBe('https://api.x.ai/v1/realtime?model=grok-voice-think-fast-2.0');
    expect(f.headers()).toEqual({ Authorization: 'Bearer xai-test-key' });
    expect(f.sent.map((m) => m.type)).toEqual(['session.update', 'conversation.item.create', 'response.create']);
    expect(f.sent[0]).toMatchObject({ session: { voice: 'eve', turn_detection: null, audio: { output: { format: { type: 'audio/pcm', rate: 24000 } } } } });
    expect((f.sent[0] as { session: { instructions: string } }).session.instructions).toBe(ackInstructions({ chiefName: 'Rosa', style: 'Warm, brisk.' }));
    expect(f.sent[1]).toEqual({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Can you find me a new coffee supplier?' }] } });
    expect(f.closed()).toBe(true);
  });

  it('says so when the provider reports an error; stops when the turn is superseded', async () => {
    const bad = fakeRealtime((send, m) => {
      if (m.type === 'session.update') send({ type: 'error', error: { message: 'bad voice' } });
    });
    await expect(async () => {
      for await (const _ of realtimeAck(env(), req(), bad.connect)) void _;
    }).rejects.toThrow('bad voice');
    const ac = new AbortController();
    const slow = fakeRealtime((send, m) => {
      if (m.type === 'session.update') send({ type: 'session.updated' });
      if (m.type === 'response.create') send({ type: 'response.output_audio.delta', delta: 'AAAA' });
    });
    const parts = [];
    for await (const p of realtimeAck(env(), req(ac.signal), slow.connect)) {
      parts.push(p);
      ac.abort();
    }
    expect(parts).toEqual([{ audio: 'AAAA' }]);
    expect(slow.closed()).toBe(true);
  });

  it('is xAI with a key, mock with mock media, and can be switched off', () => {
    expect(voiceFrontOf(env())).toBe('xai');
    expect(voiceFrontOf(env({ VOICE_FRONT: 'off' }))).toBeNull();
    expect(voiceFrontOf({} as Env)).toBeNull();
    expect(voiceFrontOf({ MOCK_MEDIA: 'true', ENABLE_MOCK: 'true' } as Env)).toBeNull();
    expect(voiceFrontOf({ MOCK_MEDIA: 'true', ENABLE_MOCK: 'true', VOICE_FRONT: 'mock' } as Env)).toBe('mock');
  });

  it('a spoken turn gets the acknowledgement as frames to the owner’s tab; a typed one does not', async () => {
    const t = await createTestEnv({ MOCK_MEDIA: 'true', VOICE_FRONT: 'mock', MOCK_DELAY_MS: '40' });
    const ws = t.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
    const seen: Frame[] = [];
    t.namespaces.WORKSPACE.state('ws:local').getWebSockets = () => [{ send: (m: string) => void seen.push(parseFrame(m) as Frame) } as unknown as WebSocket];
    const api = (method: string, path: string, body?: unknown) => handle(new Request(`http://localhost${path}`, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }), t.env, t.ctx);
    await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Rosa', voiceOn: true });
    const caps = (await (await api('GET', '/api/capabilities')).json()) as { voiceFront: unknown };
    expect(caps.voiceFront).toEqual({ available: true, provider: 'mock' });

    await api('POST', '/api/talk', { text: 'Can you find me a new coffee supplier?', opId: ids.op(), via: 'voice' });
    await t.ctx.drain();
    const front = seen.filter((f): f is Extract<Frame, { type: 'talk.front' }> => f.type === 'talk.front');
    expect(front.length).toBeGreaterThan(0);
    expect(front.map((f) => f.data.seq)).toEqual(front.map((_, i) => i));
    // The brain is slower than the acknowledgement here (the Mock is paced), so it plays.
    expect(front.some((f) => f.data.cancelled)).toBe(false);
    expect(front.filter((f) => f.data.audio).length).toBe(2);
    expect(front.at(-1)!.data).toMatchObject({ done: true, text: 'One moment.' });
    const turnId = front[0]!.data.turnId;
    expect((await ws.frames(0, 500)).some((f) => f.type === 'talk.done' && f.data.turnId === turnId)).toBe(true);

    seen.length = 0;
    await api('POST', '/api/talk', { text: 'Thanks, that is all for now.', opId: ids.op(), via: 'text' });
    await t.ctx.drain();
    expect(seen.some((f) => f.type === 'talk.front')).toBe(false);
  });
});
