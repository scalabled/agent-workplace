// One voice per workspace, in the tab: who may speak, claims and their echoes, the same-browser hand-off, the client
// id of a tab, and the voices gated on it (a tab without the voice keeps text and captions, never sound).
import { CHIEF_ID, type Frame } from '@headcount/protocol';
import type { VoiceClaimOp, VoiceOwnerData } from '@headcount/protocol/ext/voice-owner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_ID_KEY, CLIENT_LIVE_KEY, clientId, resetClientId } from '../lib/client-id';
import { navigate, paths } from '../router';
import { applyFrame, lastSeq, replayThrough, settings } from '../store';
import { createFakeAudio, type FakeAudio } from '../test/fake-audio';
import { chiefSpeaker, startChiefVoice, UNVOICED_MAX_AGE_MS } from './chief-voice';
import { setAudioEngine } from './engine';
import { claimOnGesture, startVoiceHandoff } from './handoff';
import { applyServerVoice, CLAIM_SETTLE_MS, claimUnsettled, claimVoice, mayVoice, resetVoiceOwner, setVoiceSend, startVoiceChannel, voiceElsewhere, voiceHere, voiceOwner } from './owner';

const OTHER = 'cOTHERTAB0000000';
const said = (clientId: string | null, extra: Partial<VoiceOwnerData> = {}): VoiceOwnerData => ({ clientId, reason: 'claim', at: Date.now(), ...extra });
/** An event as the browser dispatches it (isTrusted). */
const trusted = <E extends Event>(e: E): E => Object.defineProperty(e, 'isTrusted', { value: true });

/** The page as the browser reports it: on screen or not, focused or not. */
function pageState(visibility: DocumentVisibilityState, focused: boolean): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  document.hasFocus = () => focused;
}

/** A BroadcastChannel stand-in: every channel on one bus hears the others (never itself), like the real one. */
function bus() {
  const members = new Set<{ fire(data: unknown): void }>();
  return (_name: string) => {
    const listeners = new Set<(e: Event) => void>();
    const me = {
      fire: (data: unknown) => {
        for (const l of listeners) l({ data } as unknown as Event);
      },
    };
    members.add(me);
    return {
      postMessage: (data: unknown) => {
        for (const m of members) if (m !== me) m.fire(structuredClone(data));
      },
      close: () => members.delete(me),
      addEventListener: (_t: string, l: (e: Event) => void) => listeners.add(l),
      removeEventListener: (_t: string, l: (e: Event) => void) => listeners.delete(l),
    } as unknown as BroadcastChannel;
  };
}

beforeEach(() => {
  resetVoiceOwner();
  navigate(paths.talk);
  pageState('visible', true);
});
afterEach(() => {
  vi.useRealTimers();
  resetVoiceOwner();
});

describe('voice owner', () => {
  it('speaks as before when the server says nothing about the voice (older worker)', () => {
    expect(voiceOwner.value).toBeUndefined();
    expect(voiceHere.value).toBe(true);
    expect(voiceElsewhere.value).toBe(false);
    applyServerVoice(undefined);
    expect(mayVoice()).toBe(true);
  });

  it('follows the server: this tab, another tab, nobody; never on the landing page', () => {
    applyServerVoice(said(clientId()));
    expect(mayVoice()).toBe(true);
    applyServerVoice(said(OTHER));
    expect(mayVoice()).toBe(false);
    expect(voiceElsewhere.value).toBe(true);
    applyServerVoice(said(null));
    expect(mayVoice()).toBe(false);
    applyServerVoice(said(clientId()));
    navigate('/');
    expect(mayVoice()).toBe(false);
  });

  it('a claim holds until its echo: older news from the server never flips it back', () => {
    const sent: VoiceClaimOp[] = [];
    setVoiceSend((op) => sent.push(op));
    applyServerVoice(said(OTHER));
    claimVoice();
    expect(sent).toHaveLength(1);
    expect(mayVoice()).toBe(true);
    applyServerVoice(said(OTHER, { reason: 'talk' })); // sent before our claim landed
    expect(mayVoice()).toBe(true);
    applyServerVoice(said(clientId(), { claimId: sent[0]!.claimId }));
    expect(mayVoice()).toBe(true);
    applyServerVoice(said(OTHER, { reason: 'claim', claimId: 'theirs' })); // a later claim elsewhere wins
    expect(mayVoice()).toBe(false);
  });

  it('a claim the server never echoes gives way to its last word after a few seconds', () => {
    vi.useFakeTimers();
    applyServerVoice(said(OTHER));
    claimVoice();
    expect(mayVoice()).toBe(true);
    vi.advanceTimersByTime(CLAIM_SETTLE_MS + 10);
    expect(voiceOwner.value).toBe(OTHER);
  });

  it('a claim made before the feed is wired is sent as soon as it is', () => {
    claimVoice();
    const sent: VoiceClaimOp[] = [];
    setVoiceSend((op) => sent.push(op));
    expect(sent.map((o) => o.op)).toEqual(['voice.claim']);
  });

  it('only a real, non-modifier gesture takes the voice, and only when another tab has it', () => {
    const sent: VoiceClaimOp[] = [];
    setVoiceSend((op) => sent.push(op));
    applyServerVoice(said(OTHER));
    claimOnGesture(new KeyboardEvent('keydown', { key: 'a' })); // synthetic: ignored
    claimOnGesture(trusted(new KeyboardEvent('keydown', { key: 'Meta' }))); // switching windows: ignored
    expect(sent).toHaveLength(0);
    claimOnGesture(trusted(new KeyboardEvent('keydown', { key: 'Enter' })));
    expect(sent).toHaveLength(1);
    claimOnGesture(trusted(new MouseEvent('pointerdown'))); // already ours (pending): no second claim
    expect(sent).toHaveLength(1);
  });

  it('a gesture in a page that is not on screen with focus never takes the voice (an agent driving a hidden embedded browser)', () => {
    const sent: VoiceClaimOp[] = [];
    setVoiceSend((op) => sent.push(op));
    applyServerVoice(said(OTHER));
    // Automated input in a hidden in-app browser is trusted and focuses the page, but the page reports hidden.
    pageState('hidden', true);
    claimOnGesture(trusted(new MouseEvent('pointerdown')));
    claimOnGesture(trusted(new KeyboardEvent('keydown', { key: 'a' })));
    pageState('visible', false);
    claimOnGesture(trusted(new MouseEvent('pointerdown')));
    expect(sent).toHaveLength(0);
    pageState('visible', true);
    claimOnGesture(trusted(new MouseEvent('pointerdown')));
    expect(sent).toHaveLength(1);
  });

  it('coming back to this tab takes the voice; a tab that only opens (or an agent focusing a hidden page) does not', () => {
    const sent: VoiceClaimOp[] = [];
    const stop = startVoiceHandoff((op) => sent.push(op));
    applyServerVoice(said(OTHER));
    window.dispatchEvent(trusted(new Event('focus'))); // focused since it opened: no claim
    expect(sent).toHaveLength(0);
    // Switched away (another browser tab), then back while an agent focused it hidden: still no claim.
    pageState('hidden', false);
    document.dispatchEvent(trusted(new Event('visibilitychange')));
    pageState('hidden', true);
    window.dispatchEvent(trusted(new Event('focus')));
    expect(sent).toHaveLength(0);
    // The owner switches back to this tab: it is on screen with focus.
    pageState('visible', true);
    document.dispatchEvent(trusted(new Event('visibilitychange')));
    expect(sent).toHaveLength(1);
    applyServerVoice(said(clientId(), { claimId: sent[0]!.claimId }));
    // Another tab takes it; this window loses focus and gets it back (another window was in front).
    applyServerVoice(said(OTHER, { reason: 'claim', claimId: 'theirs' }));
    window.dispatchEvent(trusted(new Event('blur')));
    window.dispatchEvent(new Event('focus')); // synthetic: ignored
    expect(sent).toHaveLength(1);
    window.dispatchEvent(trusted(new Event('focus')));
    expect(sent).toHaveLength(2);
    stop();
  });

  it('a claim from another device settles on its echo or a talk sent from here; a tab of this browser that had the voice settles it at once', async () => {
    const sent: VoiceClaimOp[] = [];
    setVoiceSend((op) => sent.push(op));
    applyServerVoice(said(OTHER)); // another device speaks
    claimVoice();
    expect(mayVoice()).toBe(true);
    expect(claimUnsettled()).toBe(true); // that device goes quiet only when the server's word reaches it
    applyServerVoice(said(OTHER, { reason: 'talk' }));
    expect(claimUnsettled()).toBe(true);
    applyServerVoice(said(clientId(), { reason: 'talk' })); // a talk sent from here landed before the claim
    expect(claimUnsettled()).toBe(false);
    resetVoiceOwner();
    // Nobody had the voice: nobody can be voicing.
    applyServerVoice(said(null));
    claimVoice();
    expect(claimUnsettled()).toBe(false);
    resetVoiceOwner();
    // The tab that had it is in this browser: it yields on the channel at once.
    const make = bus();
    const stop1 = startVoiceChannel(make);
    applyServerVoice(said(clientId()));
    vi.resetModules();
    sessionStorage.clear();
    const tab2 = await import('./owner');
    const stop2 = tab2.startVoiceChannel(make);
    tab2.applyServerVoice(said(clientId()));
    tab2.claimVoice();
    expect(mayVoice()).toBe(false);
    expect(tab2.claimUnsettled()).toBe(false);
    stop2();
    stop1();
  });

  it('tabs of one browser hand over at once, before the server answers', async () => {
    const make = bus();
    // Tab 1 is this module instance; tab 2 is a fresh copy of the modules (its own id, the same browser channel).
    const stop1 = startVoiceChannel(make);
    applyServerVoice(said(clientId()));
    vi.resetModules();
    sessionStorage.clear(); // a new tab starts with its own session storage
    const tab2 = await import('./owner');
    const id2 = (await import('../lib/client-id')).clientId();
    const stop2 = tab2.startVoiceChannel(make);
    tab2.applyServerVoice(said(clientId()));
    expect(tab2.mayVoice()).toBe(false);
    tab2.claimVoice();
    expect(tab2.mayVoice()).toBe(true);
    expect(voiceOwner.value).toBe(id2); // tab 1 heard it on the channel: quiet now
    expect(mayVoice()).toBe(false);
    stop2();
    stop1();
  });
});

describe('client id', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetClientId();
  });

  it('is stable across a reload of the tab and new in a copy of it', () => {
    const first = clientId();
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(sessionStorage.getItem(CLIENT_LIVE_KEY)).toBe('1');
    // A reload: the page hid first (the marker went), then the same tab reads its id again.
    window.dispatchEvent(new Event('pagehide'));
    resetClientId();
    expect(clientId()).toBe(first);
    // A duplicated tab copies sessionStorage while the original is open (the marker is there): it takes a new id.
    resetClientId();
    expect(sessionStorage.getItem(CLIENT_ID_KEY)).toBe(first);
    expect(clientId()).not.toBe(first);
  });
});

describe('voices in a tab without the voice', () => {
  let engine: FakeAudio;
  let seq = 0;
  let stop: () => void;
  const live = (type: Frame['type'], data: unknown): Frame => ({ v: 1, streamId: 'ws:local', ...(type.startsWith('talk.') && type !== 'talk.delta' ? { seq: ++seq } : { after: seq }), ts: new Date().toISOString(), type, data }) as Frame;

  beforeEach(() => {
    engine = createFakeAudio({ speechSynthesis: true });
    setAudioEngine(engine);
    settings.value = { workspaceId: 'local', leadId: 'lead-warm-mentor', chiefName: null, voiceOn: true, ambience: 'lively', updatedAt: 'x' };
    seq = 0;
    lastSeq.value = 0;
    replayThrough.value = 0;
    chiefSpeaker.stop();
    stop = startChiefVoice();
  });
  afterEach(() => {
    stop();
    chiefSpeaker.stop();
    setAudioEngine(null);
  });

  const texts = () => engine.spoken.map((r) => r.chunks.map((c) => (c as { text?: string }).text).join(' '));

  it('keeps the answer silent here; a claim later starts with the next message, never mid-sentence', async () => {
    const sent: VoiceClaimOp[] = [];
    setVoiceSend((op) => sent.push(op));
    applyServerVoice(said(OTHER));
    applyFrame(live('talk.delta', { turnId: 'turn_1', messageId: 'msg_1', agentId: CHIEF_ID, delta: 'First half of the answer. ' }));
    claimVoice();
    applyFrame(live('talk.delta', { turnId: 'turn_1', messageId: 'msg_1', agentId: CHIEF_ID, delta: 'Second half.' }));
    applyFrame(live('talk.message', { turnId: 'turn_1', messageId: 'msg_1', agentId: CHIEF_ID, text: 'First half of the answer. Second half.', kind: 'reply' }));
    applyServerVoice(said(clientId(), { claimId: sent[0]!.claimId }));
    applyFrame(live('talk.message', { turnId: null, messageId: 'msg_2', agentId: CHIEF_ID, text: 'The suppliers job is done.', kind: 'announcement' }));
    await engine.drain();
    expect(texts()).toEqual(['The suppliers job is done.']);
  });

  it('a line that starts before a claim from another device is echoed stays with that device; the next one is voiced here', async () => {
    const sent: VoiceClaimOp[] = [];
    setVoiceSend((op) => sent.push(op));
    applyServerVoice(said(OTHER));
    claimVoice();
    // Sent by the server before it saw the claim: the other device voices it until the server's word reaches it.
    applyFrame(live('talk.message', { turnId: null, messageId: 'msg_5', agentId: CHIEF_ID, text: 'The venues job is done.', kind: 'announcement' }));
    applyServerVoice(said(clientId(), { claimId: sent[0]!.claimId }));
    applyFrame(live('talk.message', { turnId: null, messageId: 'msg_6', agentId: CHIEF_ID, text: 'The suppliers job is done.', kind: 'announcement' }));
    await engine.drain();
    expect(texts()).toEqual(['The suppliers job is done.']);
  });

  it('when the voice falls to this tab because the owner’s tab closed, the announcements nobody voiced meanwhile are voiced here once', async () => {
    applyServerVoice(said(OTHER, { reason: 'talk' }));
    applyFrame(live('talk.message', { turnId: null, messageId: 'msg_7', agentId: CHIEF_ID, text: 'The logo job is done.', kind: 'announcement' })); // seq 1: voiced there
    applyFrame(live('talk.message', { turnId: null, messageId: 'msg_8', agentId: CHIEF_ID, text: 'Three venues for the offsite are done.', kind: 'announcement' })); // seq 2: that tab had closed
    await engine.drain();
    expect(engine.spoken).toHaveLength(0);
    applyServerVoice(said(clientId(), { reason: 'fallback', unvoicedAfter: 1 }));
    await engine.drain();
    expect(texts()).toEqual(['Three venues for the offsite are done.']);
    // Once only: the same news again says nothing.
    applyServerVoice(said(OTHER, { reason: 'claim', claimId: 'theirs' }));
    applyServerVoice(said(clientId(), { reason: 'fallback', unvoicedAfter: 1 }));
    await engine.drain();
    expect(engine.spoken).toHaveLength(1);
  });

  it('never catches up on a move that is not a fallback, or on old news', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    applyServerVoice(said(OTHER, { reason: 'talk' }));
    applyFrame(live('talk.message', { turnId: null, messageId: 'msg_9', agentId: CHIEF_ID, text: 'The logo job is done.', kind: 'announcement' }));
    applyServerVoice(said(clientId(), { reason: 'connect', unvoicedAfter: 0 }));
    applyServerVoice(said(OTHER, { reason: 'claim', claimId: 'theirs' }));
    applyFrame(live('talk.message', { turnId: null, messageId: 'msg_10', agentId: CHIEF_ID, text: 'The venues job is done.', kind: 'announcement' }));
    vi.setSystemTime(Date.now() + UNVOICED_MAX_AGE_MS + 1000);
    applyServerVoice(said(clientId(), { reason: 'fallback', unvoicedAfter: 0 }));
    await engine.drain();
    expect(engine.spoken).toHaveLength(0);
  });

  it('an announcement is voiced once, in the tab with the voice only', async () => {
    applyServerVoice(said(OTHER));
    applyFrame(live('talk.message', { turnId: null, messageId: 'msg_3', agentId: CHIEF_ID, text: 'Done.', kind: 'announcement' }));
    await engine.drain();
    expect(engine.spoken).toHaveLength(0);
  });

  it('goes quiet at once when another tab takes the voice', async () => {
    const stopHandoff = startVoiceHandoff(() => undefined);
    applyServerVoice(said(clientId()));
    applyFrame(live('talk.delta', { turnId: 'turn_2', messageId: 'msg_4', agentId: CHIEF_ID, delta: 'A long answer that is still going. ' }));
    expect(engine.spoken).toHaveLength(1);
    applyServerVoice(said(OTHER));
    expect(engine.spoken[0]!.stopped).toBe(true);
    applyFrame(live('talk.delta', { turnId: 'turn_2', messageId: 'msg_4', agentId: CHIEF_ID, delta: 'More of it.' }));
    await engine.drain();
    expect(engine.spoken).toHaveLength(1);
    stopHandoff();
  });
});
