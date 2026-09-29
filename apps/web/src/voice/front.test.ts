// The voice front on the owner's tab: a spoken turn's acknowledgement plays in the Chief's voice as it streams
// (PCM wrapped as WAV), a cancelled one never plays, and barge-in stops it.
import { CHIEF_ID } from '@headcount/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { slimIndex } from '@headcount/catalog/slim';
import { navigate, paths } from '../router';
import { applyFrame, settings } from '../store';
import { createFakeAudio, type FakeAudio } from '../test/fake-audio';
import { bargeIn, chiefIsSpeaking } from './chief-voice';
import { setAudioEngine } from './engine';
import { pcm16ToWav, startVoiceFront } from './front';
import { resetVoiceOwner } from './owner';

const pcm = btoa(String.fromCharCode(...new Uint8Array(480)));
const front = (turnId: string, seq: number, data: Record<string, unknown>) => applyFrame({ v: 1, type: 'talk.front', at: '2026-09-29T10:00:00Z', data: { turnId, seq, ...data } } as never);

let fake: FakeAudio;
let stop: () => void;
beforeEach(() => {
  fake = createFakeAudio();
  setAudioEngine(fake);
  resetVoiceOwner();
  navigate(paths.talk);
  settings.value = { workspaceId: 'local', leadId: slimIndex.catalog.leads[0]!.id, chiefName: 'Rosa', voiceOn: true, updatedAt: '' };
  stop = startVoiceFront();
});
afterEach(() => stop());

describe('the voice front (web)', () => {
  it('wraps PCM16 as WAV', () => {
    const wav = new Uint8Array(pcm16ToWav(new Uint8Array(480), 24_000));
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(24_000);
    expect(wav.byteLength).toBe(44 + 480);
  });

  it('plays the acknowledgement as the Chief, as it streams, and barge-in stops it', async () => {
    front('turn_1', 0, { audio: pcm, sampleRate: 24_000 });
    front('turn_1', 1, { audio: pcm, sampleRate: 24_000 });
    expect(chiefIsSpeaking()).toBe(true);
    front('turn_1', 2, { done: true, text: 'One moment.' });
    await fake.drain();
    expect(fake.spoken).toHaveLength(1);
    expect(fake.spoken[0]!.speakerId).toBe(CHIEF_ID);
    expect(fake.spoken[0]!.chunks).toHaveLength(2);
    front('turn_2', 0, { audio: pcm, sampleRate: 24_000 });
    bargeIn();
    expect(fake.spoken[1]!.stopped).toBe(true);
  });

  it('a cancelled acknowledgement (the brain spoke first) never plays; voice off plays nothing', async () => {
    front('turn_3', 0, { cancelled: true });
    await fake.drain();
    expect(fake.spoken).toHaveLength(0);
    settings.value = { ...settings.value!, voiceOn: false };
    front('turn_4', 0, { audio: pcm, sampleRate: 24_000 });
    await fake.drain();
    expect(fake.spoken).toHaveLength(0);
  });
});
