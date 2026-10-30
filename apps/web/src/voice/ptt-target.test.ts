// The push-to-talk target: while a room or a joined huddle is open, pressing hushes the room
// (not the Chief), the words go to the room, and the Chief's face does not show listening. Restoring goes back to the
// Chief; restores may come in any order.
import type { PushToTalkOptions, PushToTalkResult } from '@headcount/audio';
import { CHIEF_ID } from '@headcount/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let captured: PushToTalkOptions | null = null;
const presses: string[] = [];

vi.mock('@headcount/audio', async (importOriginal) => {
  const real = await importOriginal<typeof import('@headcount/audio')>();
  return {
    ...real,
    createPushToTalk: (_engine: unknown, opts: PushToTalkOptions) => {
      captured = opts;
      return {
        press: () => {
          presses.push('press');
          opts.onState?.('starting');
          opts.onState?.('recording');
        },
        release: () => {
          presses.push('release');
          opts.onState?.('idle');
        },
        cancel: () => opts.onState?.('idle'),
        destroy: () => undefined,
        level: () => 0,
        partial: () => '',
        state: 'idle',
        latched: false,
      };
    },
  };
});

const { createFakeAudio } = await import('../test/fake-audio');
const { setAudioEngine } = await import('./engine');
const { endPtt, pttPressTarget, pttTarget, resetPtt, setPttTarget, startPtt } = await import('./ptt');
const { chiefSpeaker } = await import('./chief-voice');
const { localPresence, settings } = await import('../store');

const result = async (r: PushToTalkResult) => {
  await captured!.onResult!(r);
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  resetPtt();
  captured = null;
  presses.length = 0;
  setAudioEngine(createFakeAudio({ speechRecognition: true, speechSynthesis: true }));
  settings.value = { workspaceId: 'local', leadId: 'lead-warm-mentor', chiefName: null, voiceOn: true, updatedAt: 'x' };
  localPresence.value = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'content-type': 'application/json' } })),
  );
});
afterEach(() => {
  resetPtt();
  setAudioEngine(null);
  vi.unstubAllGlobals();
});

describe('push-to-talk target', () => {
  it('is the Chief by default', () => {
    expect(pttTarget.value).toEqual({ kind: 'chief' });
  });

  it('a room target hushes the room on press, sends it the words, and leaves the Chief alone', async () => {
    const onStart = vi.fn();
    const send = vi.fn(async () => undefined);
    const bargeIn = vi.spyOn(chiefSpeaker, 'stop');
    const restore = setPttTarget({ kind: 'room', roomId: 'skyline', label: 'the Skyline room', onStart, send });
    expect(pttTarget.value.kind).toBe('room');
    startPtt();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(bargeIn).not.toHaveBeenCalled();
    expect(pttPressTarget.value?.kind).toBe('room');
    // The Chief's face does not listen for a room.
    expect(localPresence.value[CHIEF_ID]?.listening ?? false).toBe(false);
    endPtt();
    await result({ kind: 'text', text: 'What do you all think?' } as PushToTalkResult);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown[])[0]).toBe('What do you all think?');
    expect(typeof (send.mock.calls[0] as unknown[])[1]).toBe('number');
    // Nothing went to Talk.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    restore();
    expect(pttTarget.value).toEqual({ kind: 'chief' });
    bargeIn.mockRestore();
  });

  it('the Chief target barges in on the Chief, shows listening and sends to Talk', async () => {
    const stop = vi.spyOn(chiefSpeaker, 'stop');
    startPtt();
    expect(stop).toHaveBeenCalled();
    expect(localPresence.value[CHIEF_ID]?.listening).toBe(true);
    endPtt();
    expect(localPresence.value[CHIEF_ID]?.listening).toBe(false);
    await result({ kind: 'text', text: 'Hello there' } as PushToTalkResult);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/talk'))).toBe(true);
    stop.mockRestore();
  });

  it('the result goes where the press started, even if the target changed mid-hold', async () => {
    const send = vi.fn(async () => undefined);
    const restore = setPttTarget({ kind: 'room', roomId: 'garden', label: 'the Garden room', onStart: () => undefined, send });
    startPtt();
    restore(); // the owner left the room while holding
    endPtt();
    await result({ kind: 'text', text: 'Bye all' } as PushToTalkResult);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('nested targets restore in any order', () => {
    const a = { kind: 'room' as const, roomId: 'huddle:abcd', label: 'Kate and Pax', onStart: () => undefined, send: async () => undefined };
    const b = { kind: 'room' as const, roomId: 'skyline', label: 'the Skyline room', onStart: () => undefined, send: async () => undefined };
    const ra = setPttTarget(a);
    const rb = setPttTarget(b);
    expect(pttTarget.value).toBe(b);
    ra();
    expect(pttTarget.value).toBe(b);
    rb();
    expect(pttTarget.value).toEqual({ kind: 'chief' });
    const rc = setPttTarget(a);
    const rd = setPttTarget(b);
    rd();
    expect(pttTarget.value).toBe(a);
    rc();
    expect(pttTarget.value).toEqual({ kind: 'chief' });
  });
});
