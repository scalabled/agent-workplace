// One voice per workspace (owner report "I am hearing duplicate responses spoken out loud"): every open /app tab
// receives every frame, but only one client speaks at a time. Each tab has a stable client id (sessionStorage) that
// it sends on the feed socket (`/api/ws?client=`) and with owner actions (talk, steer, desk reply); the WorkspaceDO
// makes the client of the most recent owner interaction the voice owner and broadcasts `voice.owner`.

/** A browser tab's id: stable across reloads of that tab, unique across tabs. */
export const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** A claim's id (echoed in the `voice.owner` frame that settles it). */
export const CLAIM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isClientId(v: unknown): v is string {
  return typeof v === 'string' && CLIENT_ID_RE.test(v);
}

export function isClaimId(v: unknown): v is string {
  return typeof v === 'string' && CLAIM_ID_RE.test(v);
}

/**
 * Why the voice is where it is: an explicit claim (a real gesture in /app), an owner action over HTTP, a client
 * connecting while no connected client held the voice, or the owner's tab gone (the most recently active connected
 * client takes proactive speech).
 */
export type VoiceOwnerReason = 'claim' | 'talk' | 'steer' | 'desk' | 'room' | 'connect' | 'fallback';

/**
 * Who speaks now (`voice.owner`, ephemeral, and `ready.data.voice` on every connect). `clientId` null: no connected
 * client, nothing speaks. `claimId` echoes the socket claim that caused it, so the claiming tab knows its claim
 * landed (frames sent before it are older news).
 */
export interface VoiceOwnerData {
  clientId: string | null;
  reason: VoiceOwnerReason;
  claimId?: string;
  /**
   * A fallback only: the voice was with a tab that went away, so persisted lines after this feed seq reached no tab with
   * the voice. The new owner voices the proactive ones among them (job announcements) that it kept silent.
   */
  unvoicedAfter?: number;
  /** Epoch ms on the server. */
  at: number;
}

/** Client → server: this tab takes the voice (sent on a real user gesture in /app when it is not the owner). */
export interface VoiceClaimOp {
  op: 'voice.claim';
  claimId: string;
}
