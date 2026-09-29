// One voice per workspace (docs/dev/INC05.md "Voice ownership"). Every open /app tab gets every frame, but only the
// voice owner voices answers, reflexes and clips; the others keep captions, text and faces. The WorkspaceDO decides
// (`ready.data.voice`, `voice.owner`); this tab claims the voice on a real gesture (`voice.claim`) and with every owner
// action (talk, steer, desk reply carry its client id). Tabs of the same browser hand over at once on a
// BroadcastChannel, so a hand-off never double-speaks during the round trip; another device goes quiet only when the
// server's word reaches it, so until the claim is echoed the claiming tab leaves lines that start meanwhile to it.
import { computed, signal } from '@preact/signals';
import { isClaimId, isClientId, type VoiceClaimOp, type VoiceOwnerData } from '@headcount/protocol/ext/voice-owner';
import { clientId } from '../lib/client-id';
import { route } from '../router';

/** A claim not echoed by the server within this long gives way to what the server last said. */
export const CLAIM_SETTLE_MS = 4000;
export const VOICE_CHANNEL = 'hc-voice';

/**
 * Who speaks now, as this tab believes: a client id, null (nobody), or undefined (the server has not said, or does not
 * know voice ownership: every tab speaks, as before).
 */
export const voiceOwner = signal<string | null | undefined>(undefined);
/** This tab may voice (the owner, or ownership unknown). */
export const voiceHere = computed(() => {
  const o = voiceOwner.value;
  return o === undefined || o === clientId();
});
/** This tab voices now: the owner, and never on the landing page. */
export const voiceActive = computed(() => voiceHere.value && route.value.name !== 'landing');
/** The voice is in another tab (or nowhere): this one shows "Speaking on another tab · Play here". */
export const voiceElsewhere = computed(() => voiceOwner.value !== undefined && voiceOwner.value !== clientId());

/** Can this tab voice right now? (Answers, reflexes, clips, the greeting.) */
export function mayVoice(): boolean {
  return voiceActive.peek();
}

interface Pending {
  claimId: string;
  clientId: string;
  until: number;
  /**
   * This tab's claim only: nobody else can still be voicing (nobody had the voice, the server already names this tab,
   * or the tab that had it is in this browser and went quiet at once). Until then another device may be.
   */
  settled?: boolean;
}

/** What the server last said (undefined: nothing yet, or a server without voice ownership). */
let server: VoiceOwnerData | undefined;
/** A claim (this tab's, or another tab's in this browser) the server has not echoed yet: it wins meanwhile. */
let pending: Pending | null = null;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let send: ((op: VoiceClaimOp) => void) | null = null;
let unsent: VoiceClaimOp | null = null;
let channel: Pick<BroadcastChannel, 'postMessage' | 'close'> | null = null;

/** `claim`: a tab of this browser took the voice. `yield`: the tab that had it went quiet for that claim. */
type ChannelMessage = { t: 'claim'; clientId: string; claimId: string } | { t: 'yield'; claimId: string };

type UnvoicedListener = (afterSeq: number) => void;
const unvoicedListeners = new Set<UnvoicedListener>();

function recompute(): void {
  voiceOwner.value = pending ? pending.clientId : server ? server.clientId : undefined;
}

function hold(p: Pending): void {
  pending = p;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    if (pending !== p) return;
    pending = null;
    recompute();
  }, Math.max(0, p.until - Date.now()));
  recompute();
}

function newClaimId(): string {
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The server's word (`ready.data.voice`, a `voice.owner` frame; `undefined` from a server without voice ownership).
 * While a claim waits for its echo, older news waits: the echo of that claim settles it.
 */
export function applyServerVoice(d: VoiceOwnerData | undefined): void {
  const had = voiceHere.peek();
  server = d && (d.clientId === null || isClientId(d.clientId)) ? d : undefined;
  if (pending && (d?.claimId === pending.claimId || Date.now() >= pending.until)) {
    pending = null;
    clearTimeout(settleTimer);
  }
  // The server names this tab (a talk sent from here landed first): whatever it sends from now on is this tab's to voice.
  if (pending && pending.clientId === clientId() && server?.clientId === pending.clientId) pending.settled = true;
  recompute();
  // The voice fell to this tab because the tab that had it went away: lines since then were voiced nowhere.
  if (!had && voiceHere.peek() && server?.reason === 'fallback' && server.clientId === clientId() && typeof server.unvoicedAfter === 'number') {
    for (const cb of unvoicedListeners) {
      try {
        cb(server.unvoicedAfter);
      } catch (err) {
        console.error('voice catch-up failed', err);
      }
    }
  }
}

/** Called when the voice falls to this tab after the tab that had it went away, with the feed seq after which nobody voiced. */
export function onUnvoiced(cb: UnvoicedListener): () => void {
  unvoicedListeners.add(cb);
  return () => unvoicedListeners.delete(cb);
}

/** Take the voice for this tab (a real gesture in /app, "Play here"). Other tabs of this browser go quiet at once. */
export function claimVoice(): void {
  const me = clientId();
  const claimId = newClaimId();
  const before = server?.clientId;
  hold({ claimId, clientId: me, until: Date.now() + CLAIM_SETTLE_MS, settled: before === undefined || before === null || before === me });
  try {
    channel?.postMessage({ t: 'claim', clientId: me, claimId } satisfies ChannelMessage);
  } catch {
    /* the channel is closed */
  }
  const op: VoiceClaimOp = { op: 'voice.claim', claimId };
  if (send) send(op);
  else unsent = op;
}

/** Is a claim of this tab still waiting for the server? */
export function claimPending(): boolean {
  return !!pending && pending.clientId === clientId();
}

/**
 * This tab claimed the voice and the tab that had it may still be voicing (another device: it goes quiet when the
 * server's word reaches it). A line that starts meanwhile is that tab's: this one keeps it silent.
 */
export function claimUnsettled(): boolean {
  return !!pending && pending.clientId === clientId() && !pending.settled;
}

/** Where claims go (the feed socket; queued there until it opens). A claim made before this is sent now. */
export function setVoiceSend(fn: ((op: VoiceClaimOp) => void) | null): void {
  send = fn;
  if (fn && unsent) {
    const op = unsent;
    unsent = null;
    fn(op);
  }
}

function onChannel(data: unknown): void {
  const m = data as { t?: unknown; clientId?: unknown; claimId?: unknown } | null;
  if (!m || !isClaimId(m.claimId)) return;
  if (m.t === 'yield') {
    // The tab of this browser that had the voice went quiet for this tab's claim: nobody else is voicing.
    if (pending && pending.claimId === m.claimId && pending.clientId === clientId()) pending.settled = true;
    return;
  }
  if (m.t !== 'claim' || !isClientId(m.clientId) || m.clientId === clientId()) return;
  const had = voiceOwner.peek() === clientId();
  // Another tab of this browser took the voice: quiet now, before the server's word arrives.
  hold({ claimId: m.claimId, clientId: m.clientId, until: Date.now() + CLAIM_SETTLE_MS });
  if (had) {
    try {
      channel?.postMessage({ t: 'yield', claimId: m.claimId } satisfies ChannelMessage);
    } catch {
      /* the channel is closed */
    }
  }
}

/** Listen to the other tabs of this browser. Returns the stop. */
export function startVoiceChannel(make: (name: string) => Pick<BroadcastChannel, 'postMessage' | 'close' | 'addEventListener' | 'removeEventListener'> | null = defaultChannel): () => void {
  const ch = make(VOICE_CHANNEL);
  if (!ch) return () => undefined;
  const onMessage = (e: Event) => onChannel((e as MessageEvent).data);
  ch.addEventListener('message', onMessage);
  channel = ch;
  return () => {
    ch.removeEventListener('message', onMessage);
    try {
      ch.close();
    } catch {
      /* closed */
    }
    if (channel === ch) channel = null;
  };
}

function defaultChannel(name: string): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null;
  } catch {
    return null;
  }
}

/** Tests: forget everything. */
export function resetVoiceOwner(): void {
  server = undefined;
  pending = null;
  clearTimeout(settleTimer);
  send = null;
  unsent = null;
  channel = null;
  voiceOwner.value = undefined;
}
