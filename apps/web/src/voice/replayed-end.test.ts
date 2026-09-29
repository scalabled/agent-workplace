// A reply whose end this tab never hears live: the feed socket dropped mid-answer and the reply finished meanwhile
// (its talk.message and talk.done come back replayed), the worker restarted mid-answer (the recovered talk.done names
// no message), or voice was turned off while it streamed. The utterance ends where it is (the sentences already cut
// still play, nothing new is said) instead of holding the speaker's audio queue open, so later lines are voiced.
import { CHIEF_ID, type Frame } from '@headcount/protocol';
import type { VoiceOwnerData } from '@headcount/protocol/ext/voice-owner';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientId } from '../lib/client-id';
import { navigate, paths } from '../router';
import { applyFrame, lastSeq, replayThrough, settings } from '../store';
import { createFakeAudio, type FakeAudio, type SpokenRecord } from '../test/fake-audio';
import { chiefSpeaker, startChiefVoice } from './chief-voice';
import { setAudioEngine } from './engine';
import { applyServerVoice, resetVoiceOwner } from './owner';
import { sideSpeaker, startSideVoice, stopSideVoices } from './side-voice';

const AVA = 'cw_ava';
const OTHER = 'cOTHERTAB0000000';
const said = (id: string | null, extra: Partial<VoiceOwnerData> = {}): VoiceOwnerData => ({ clientId: id, reason: 'claim', at: Date.now(), ...extra });

let engine: FakeAudio;
let seq = 0;
let stops: (() => void)[] = [];

/** A frame as the feed delivers it: persisted talk frames carry the next seq, deltas ride after the last one. */
const frame = (type: Frame['type'], data: unknown): Frame => ({ v: 1, streamId: 'ws:local', ...(type.startsWith('talk.') && type !== 'talk.delta' ? { seq: ++seq } : { after: seq }), ts: new Date().toISOString(), type, data }) as Frame;

/** The socket came back: the next `n` persisted frames are history (applied `live: false`). */
const reconnect = (n: number) => {
  replayThrough.value = seq + n;
};

/**
 * The socket came back for real: a `ready` frame (the next `n` persisted frames are history). Deltas are never
 * replayed: what streamed while it was down is gone.
 */
const ready = (n = 0, voice?: VoiceOwnerData) => {
  const ts = new Date().toISOString();
  applyFrame({ v: 1, streamId: 'ws:local', ts, type: 'ready', data: { workspaceId: 'local', streamId: 'ws:local', lastSeq: seq + n, replayFrom: 0, serverTime: ts, ...(voice ? { voice } : {}) } } as Frame);
};

/** Has this utterance's stream ended (the engine got the end of its chunks), without waiting forever? */
async function ended(r: SpokenRecord): Promise<boolean> {
  const out = await Promise.race([r.done.then(() => true), new Promise<false>((res) => setTimeout(() => res(false), 30))]);
  return out;
}

const textOf = (r: SpokenRecord) => r.chunks.map((c) => (c as { text?: string }).text).join(' ');

beforeEach(() => {
  resetVoiceOwner();
  navigate(paths.talk);
  engine = createFakeAudio({ speechSynthesis: true });
  setAudioEngine(engine);
  settings.value = { workspaceId: 'local', leadId: 'lead-warm-mentor', chiefName: null, voiceOn: true, ambience: 'lively', updatedAt: 'x' };
  seq = 0;
  lastSeq.value = 0;
  replayThrough.value = 0;
  chiefSpeaker.stop();
  stops = [startChiefVoice(), startSideVoice()];
});
afterEach(() => {
  for (const s of stops) s();
  chiefSpeaker.stop();
  stopSideVoices();
  setAudioEngine(null);
  resetVoiceOwner();
});

describe('the Chief of Staff', () => {
  it('a reply that finished while the feed was down ends where it is; the next line is voiced', async () => {
    applyFrame(frame('talk.delta', { turnId: 'turn_1', messageId: 'msg_1', agentId: CHIEF_ID, delta: 'The first part is done. And the sec' }));
    expect(engine.spoken).toHaveLength(1);
    reconnect(2);
    applyFrame(frame('talk.message', { turnId: 'turn_1', messageId: 'msg_1', agentId: CHIEF_ID, text: 'The first part is done. And the second part is too. Want the details?', kind: 'reply' }));
    applyFrame(frame('talk.done', { turnId: 'turn_1', messageId: 'msg_1', finish: 'stop', route: 'answer' }));
    expect(await ended(engine.spoken[0]!)).toBe(true);
    // Only what streamed live and was already a whole sentence: never the replayed text, never half a sentence.
    expect(textOf(engine.spoken[0]!)).toBe('The first part is done.');
    applyFrame(frame('talk.message', { turnId: null, messageId: 'msg_2', agentId: CHIEF_ID, text: 'The suppliers job is done.', kind: 'announcement' }));
    await engine.drain();
    expect(engine.spoken.map(textOf)).toEqual(['The first part is done.', 'The suppliers job is done.']);
    expect(chiefSpeaker.active).toBe(false);
  });

  it('a worker restart mid-answer: the recovered end (no message id) closes that turn’s reply', async () => {
    applyFrame(frame('talk.delta', { turnId: 'turn_2', messageId: 'msg_3', agentId: CHIEF_ID, delta: 'Let me pull the numbers. The March totals' }));
    reconnect(1);
    applyFrame(frame('talk.done', { turnId: 'turn_2', messageId: null, finish: 'error' }));
    expect(await ended(engine.spoken[0]!)).toBe(true);
    expect(textOf(engine.spoken[0]!)).toBe('Let me pull the numbers.');
    expect(chiefSpeaker.active).toBe(false);
  });

  it('a turn that ends with no message id, live, closes its reply too', async () => {
    applyFrame(frame('talk.delta', { turnId: 'turn_3', messageId: 'msg_4', agentId: CHIEF_ID, delta: '\n' }));
    applyFrame(frame('talk.done', { turnId: 'turn_3', messageId: null, finish: 'error' }));
    expect(await ended(engine.spoken[0]!)).toBe(true);
    expect(chiefSpeaker.active).toBe(false);
  });

  it('voice turned off mid-answer (another tab): the end still closes the stream, so voice back on speaks again', async () => {
    applyFrame(frame('talk.delta', { turnId: 'turn_4', messageId: 'msg_5', agentId: CHIEF_ID, delta: 'Here is the plan for today. First' }));
    settings.value = { ...settings.value!, voiceOn: false };
    applyFrame(frame('talk.delta', { turnId: 'turn_4', messageId: 'msg_5', agentId: CHIEF_ID, delta: ', the venues.' }));
    applyFrame(frame('talk.message', { turnId: 'turn_4', messageId: 'msg_5', agentId: CHIEF_ID, text: 'Here is the plan for today. First, the venues.', kind: 'reply' }));
    applyFrame(frame('talk.done', { turnId: 'turn_4', messageId: 'msg_5', finish: 'stop', route: 'answer' }));
    expect(await ended(engine.spoken[0]!)).toBe(true);
    expect(textOf(engine.spoken[0]!)).toBe('Here is the plan for today.');
    settings.value = { ...settings.value!, voiceOn: true };
    applyFrame(frame('talk.message', { turnId: null, messageId: 'msg_6', agentId: CHIEF_ID, text: 'The venues job is done.', kind: 'announcement' }));
    await engine.drain();
    expect(engine.spoken.map(textOf)).toEqual(['Here is the plan for today.', 'The venues job is done.']);
  });

  it('replayed history alone never speaks, and a replayed announcement is never caught up by a fallback', async () => {
    reconnect(4);
    applyFrame(frame('talk.message', { turnId: 'turn_5', messageId: 'msg_7', agentId: CHIEF_ID, text: 'An old answer.', kind: 'reply' }));
    applyFrame(frame('talk.done', { turnId: 'turn_5', messageId: 'msg_7', finish: 'stop', route: 'answer' }));
    applyFrame(frame('talk.done', { turnId: 'turn_6', messageId: null, finish: 'error' }));
    applyServerVoice(said(OTHER, { reason: 'talk' }));
    applyFrame(frame('talk.message', { turnId: null, messageId: 'msg_8', agentId: CHIEF_ID, text: 'An old announcement.', kind: 'announcement' }));
    applyServerVoice(said(clientId(), { reason: 'fallback', unvoicedAfter: 0 }));
    await engine.drain();
    expect(engine.spoken).toHaveLength(0);
  });

  it('the grace catch-up still voices the announcements kept silent here, after a replayed end', async () => {
    applyServerVoice(said(OTHER, { reason: 'talk' }));
    applyFrame(frame('talk.message', { turnId: null, messageId: 'msg_9', agentId: CHIEF_ID, text: 'The logo job is done.', kind: 'announcement' })); // seq 1: voiced there
    applyFrame(frame('talk.message', { turnId: null, messageId: 'msg_10', agentId: CHIEF_ID, text: 'Three venues for the offsite are done.', kind: 'announcement' })); // seq 2: nobody voiced it
    reconnect(1);
    applyFrame(frame('talk.done', { turnId: 'turn_7', messageId: null, finish: 'error' }));
    applyServerVoice(said(clientId(), { reason: 'fallback', unvoicedAfter: 1 }));
    await engine.drain();
    expect(engine.spoken.map(textOf)).toEqual(['Three venues for the offsite are done.']);
  });

  it('a live end still speaks the rest of the reply (unchanged)', async () => {
    applyFrame(frame('talk.delta', { turnId: 'turn_8', messageId: 'msg_11', agentId: CHIEF_ID, delta: 'The first part is done. And the sec' }));
    applyFrame(frame('talk.message', { turnId: 'turn_8', messageId: 'msg_11', agentId: CHIEF_ID, text: 'The first part is done. And the second part is too.', kind: 'reply' }));
    applyFrame(frame('talk.done', { turnId: 'turn_8', messageId: 'msg_11', finish: 'stop', route: 'answer' }));
    await engine.drain();
    expect(engine.spoken.map(textOf)).toEqual(['The first part is done. And the second part is too.']);
  });
});

describe('a socket that comes back while a reply still streams', () => {
  // The deltas sent while it was down are lost for good: a later delta would be joined to what streamed before with a
  // hole in the middle ("And the secWant the details?"). The reply ends where it is; the rest shows as text only.
  it('the Chief’s reply ends where it is; later deltas and its live end are never joined to it', async () => {
    applyFrame(frame('talk.delta', { turnId: 'turn_r1', messageId: 'msg_r1', agentId: CHIEF_ID, delta: 'The first part is done. And the sec' }));
    ready();
    applyFrame(frame('talk.delta', { turnId: 'turn_r1', messageId: 'msg_r1', agentId: CHIEF_ID, delta: ' Want the details?' }));
    applyFrame(frame('talk.message', { turnId: 'turn_r1', messageId: 'msg_r1', agentId: CHIEF_ID, text: 'The first part is done. And the second part is too. Want the details?', kind: 'reply' }));
    applyFrame(frame('talk.done', { turnId: 'turn_r1', messageId: 'msg_r1', finish: 'stop', route: 'answer' }));
    expect(await ended(engine.spoken[0]!)).toBe(true);
    expect(textOf(engine.spoken[0]!)).toBe('The first part is done.');
    applyFrame(frame('talk.message', { turnId: null, messageId: 'msg_r2', agentId: CHIEF_ID, text: 'The suppliers job is done.', kind: 'announcement' }));
    await engine.drain();
    expect(engine.spoken.map(textOf)).toEqual(['The first part is done.', 'The suppliers job is done.']);
    expect(chiefSpeaker.active).toBe(false);
  });

  it('a reply that starts after the reconnect is voiced in full', async () => {
    applyFrame(frame('talk.delta', { turnId: 'turn_r3', messageId: 'msg_r3', agentId: CHIEF_ID, delta: 'Sure. Let me' }));
    ready();
    applyFrame(frame('talk.done', { turnId: 'turn_r3', messageId: 'msg_r3', finish: 'stop', route: 'answer' }));
    applyFrame(frame('talk.delta', { turnId: 'turn_r4', messageId: 'msg_r4', agentId: CHIEF_ID, delta: 'Here are three names. ' }));
    applyFrame(frame('talk.delta', { turnId: 'turn_r4', messageId: 'msg_r4', agentId: CHIEF_ID, delta: 'Ember and Oak.' }));
    applyFrame(frame('talk.message', { turnId: 'turn_r4', messageId: 'msg_r4', agentId: CHIEF_ID, text: 'Here are three names. Ember and Oak.', kind: 'reply' }));
    applyFrame(frame('talk.done', { turnId: 'turn_r4', messageId: 'msg_r4', finish: 'stop', route: 'answer' }));
    await engine.drain();
    expect(engine.spoken.map(textOf)).toEqual(['Sure.', 'Here are three names. Ember and Oak.']);
  });

  it('a reconnect with nothing streaming changes nothing: a greeting still plays, the grace catch-up still voices once', async () => {
    chiefSpeaker.say('Morning, Rosa.');
    applyServerVoice(said(OTHER, { reason: 'talk' }));
    applyFrame(frame('talk.message', { turnId: null, messageId: 'msg_r5', agentId: CHIEF_ID, text: 'The logo job is done.', kind: 'announcement' })); // seq 1: voiced there
    applyFrame(frame('talk.message', { turnId: null, messageId: 'msg_r6', agentId: CHIEF_ID, text: 'Three venues for the offsite are done.', kind: 'announcement' })); // seq 2: nobody voiced it
    ready(0, said(clientId(), { reason: 'fallback', unvoicedAfter: 1 }));
    await engine.drain();
    expect(engine.spoken.map(textOf)).toEqual(['Morning, Rosa.', 'Three venues for the offsite are done.']);
  });

  it('a quick-chat reply on the Floor ends where it is too', async () => {
    applyFrame(frame('talk.delta', { turnId: 'turn_rf1', messageId: 'msg_rf1', agentId: AVA, delta: 'I checked the venues. Two of th', surface: 'floor' }));
    ready();
    applyFrame(frame('talk.delta', { turnId: 'turn_rf1', messageId: 'msg_rf1', agentId: AVA, delta: ' Lisbon is cheaper.', surface: 'floor' }));
    applyFrame(frame('talk.message', { turnId: 'turn_rf1', messageId: 'msg_rf1', agentId: AVA, text: 'I checked the venues. Two of them are free. Lisbon is cheaper.', kind: 'reply', surface: 'floor' }));
    applyFrame(frame('talk.done', { turnId: 'turn_rf1', messageId: 'msg_rf1', agentId: AVA, surface: 'floor', finish: 'stop', route: 'answer' }));
    expect(await ended(engine.spoken[0]!)).toBe(true);
    await engine.drain();
    expect(engine.spoken.map(textOf)).toEqual(['I checked the venues.']);
    expect(sideSpeaker(AVA)!.active).toBe(false);
  });
});

describe('a coworker on the Floor', () => {
  it('a quick-chat reply that finished while the feed was down ends where it is; the next reply is voiced', async () => {
    applyFrame(frame('talk.delta', { turnId: 'turn_f1', messageId: 'msg_f1', agentId: AVA, delta: 'I checked the venues. Two of th', surface: 'floor' }));
    reconnect(2);
    applyFrame(frame('talk.message', { turnId: 'turn_f1', messageId: 'msg_f1', agentId: AVA, text: 'I checked the venues. Two of them are free.', kind: 'reply', surface: 'floor' }));
    applyFrame(frame('talk.done', { turnId: 'turn_f1', messageId: 'msg_f1', agentId: AVA, surface: 'floor', finish: 'stop', route: 'answer' }));
    expect(await ended(engine.spoken[0]!)).toBe(true);
    expect(textOf(engine.spoken[0]!)).toBe('I checked the venues.');
    applyFrame(frame('talk.message', { turnId: 'turn_f2', messageId: 'msg_f2', agentId: AVA, text: 'Lisbon is the cheaper one.', kind: 'reply', surface: 'floor' }));
    await engine.drain();
    expect(engine.spoken.map(textOf)).toEqual(['I checked the venues.', 'Lisbon is the cheaper one.']);
    expect(sideSpeaker(AVA)!.active).toBe(false);
  });

  it('a worker restart mid-reply: the recovered end (no message id) closes it', async () => {
    applyFrame(frame('talk.delta', { turnId: 'turn_f3', messageId: 'msg_f3', agentId: AVA, delta: 'Sure thing. The', surface: 'floor' }));
    reconnect(1);
    applyFrame(frame('talk.done', { turnId: 'turn_f3', messageId: null, agentId: AVA, surface: 'floor', finish: 'error' }));
    expect(await ended(engine.spoken[0]!)).toBe(true);
    expect(sideSpeaker(AVA)!.active).toBe(false);
  });
});
