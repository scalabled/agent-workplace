// One voice per workspace (docs/dev/INC05.md "Voice ownership"): every open /app tab gets every frame, but only one
// client speaks. The WorkspaceDO makes the client of the most recent owner interaction (a talk send, push-to-talk, a
// steer, a desk reply, or an explicit `voice.claim` on a real gesture) the voice owner and broadcasts `voice.owner`.
// When the owner's tab goes away, proactive speech falls to the most recently active connected client after a short
// grace (a reload reconnects with the same client id and keeps the voice); with no connected client, nothing speaks.
// Who speaks is kept in SQL, so a wake from hibernation (the sockets survive, memory and timers do not) neither
// re-announces it nor hands it back to a tab that closed.
import { isClientId, type VoiceOwnerData, type VoiceOwnerReason } from '@headcount/protocol/ext/voice-owner';
import type { SocketAttachment } from '../expr/viewer';

/** A disconnected owner keeps the voice this long (a reload), then the most recently active connected client has it. */
export const VOICE_GRACE_MS = 5000;
/** Remembered clients (last interaction per client id), newest first. */
const MAX_CLIENTS = 200;
const CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS voice_clients (client_id TEXT PRIMARY KEY, active_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS voice_owner (id INTEGER PRIMARY KEY CHECK (id = 1), client_id TEXT NOT NULL, at INTEGER NOT NULL)`,
  // The client last told to the sockets (null: nobody). No row: never told (a workspace from before this table).
  `CREATE TABLE IF NOT EXISTS voice_published (id INTEGER PRIMARY KEY CHECK (id = 1), client_id TEXT)`,
];

/** The part of a hibernatable WebSocket this needs (tests pass FakeWebSocket). */
export interface VoiceSocket {
  deserializeAttachment?(): unknown;
  serializeAttachment?(value: unknown): void;
  readyState?: number;
}

export interface VoiceDeps {
  sql: SqlStorage;
  sockets(): VoiceSocket[];
  /** Tell every socket (an ephemeral `voice.owner` frame). */
  broadcast(data: VoiceOwnerData): void;
  now(): number;
  /** Run `fn` after `ms` (keeps the object awake until then). */
  later(fn: () => void, ms: number): void;
  /** The feed's last persisted seq: lines after it, while the voice is with a closed tab, are voiced nowhere. */
  head?(): number;
}

/** A client whose last socket went away: when, and the feed's last seq then. */
interface Lost {
  at: number;
  seq: number | null;
}

/** WebSocket.OPEN; a socket whose state is unknown (tests) counts as open. */
const OPEN = 1;

export function attachmentOf(ws: VoiceSocket): SocketAttachment {
  try {
    const a = ws.deserializeAttachment?.();
    return a && typeof a === 'object' ? (a as SocketAttachment) : {};
  } catch {
    return {};
  }
}

export class VoiceOwnership {
  /** The client last told to the sockets (null: nobody; undefined: never told). Kept in SQL (voice_published). */
  private published: string | null | undefined;
  /** Client id → when its last socket closed (the grace for a reload). */
  private readonly lost = new Map<string, Lost>();

  constructor(private readonly d: VoiceDeps) {
    for (const stmt of SCHEMA) d.sql.exec(stmt);
    const row = d.sql.exec<{ client_id: string | null }>('SELECT client_id FROM voice_published WHERE id = 1').toArray()[0];
    this.published = row ? (isClientId(row.client_id) ? row.client_id : null) : undefined;
    // A restarted object (a deploy, a dev reload) closed every socket: the tabs reconnect one by one, and the client that
    // spoke gets the same grace as a reload, so the first tab back does not take the voice for a moment. A wake from
    // hibernation keeps its sockets and gets no grace: a tab that closed long ago must not hold the voice again.
    if (d.sockets().length === 0) {
      const speaking = this.published === undefined ? this.owner() : this.published;
      if (speaking) this.lose(speaking);
    }
  }

  /** The client a socket belongs to (null: a client from before voice ownership, never a candidate). */
  clientOf(ws: VoiceSocket): string | null {
    const id = attachmentOf(ws).clientId;
    return isClientId(id) ? id : null;
  }

  /** Mark a new feed socket with its client (before `snapshot`, so it counts as connected). */
  attach(ws: VoiceSocket, clientId: string | null): void {
    if (!clientId) return;
    try {
      ws.serializeAttachment?.({ ...attachmentOf(ws), clientId, connectedAt: this.d.now() } satisfies SocketAttachment);
    } catch {
      /* the socket went away */
    }
    this.lost.delete(clientId);
  }

  /** Who speaks now, for the `ready` snapshot of a socket that just connected (never broadcast). */
  snapshot(reason: VoiceOwnerReason = 'connect'): VoiceOwnerData {
    return { clientId: this.effective(), reason, at: this.d.now() };
  }

  /**
   * Re-check who speaks (a grace timer may not have survived hibernation): called before proactive speech (a mirrored
   * job frame) and on socket messages, so the voice never stays with a tab that is gone.
   */
  refresh(): void {
    this.publish('fallback');
  }

  /** After a socket connected: tell the others if the voice moved (the only client, or the owner back). */
  connected(): void {
    this.publish('connect');
  }

  /** A socket closed: its client keeps the voice for VOICE_GRACE_MS, then the most recently active connected client has it. */
  closed(ws: VoiceSocket): void {
    const id = this.clientOf(ws);
    if (id && !this.open(ws).has(id)) this.lose(id);
    this.publish('fallback', undefined, ws);
  }

  /**
   * An owner interaction from `clientId`: it becomes the voice owner. A socket claim carries a `claimId` and is always
   * echoed (the claiming tab settles on it); an HTTP action is broadcast only when the voice moved.
   */
  claim(clientId: string, reason: VoiceOwnerReason, claimId?: string): void {
    if (!isClientId(clientId)) return;
    const now = this.d.now();
    this.d.sql.exec(
      `INSERT INTO voice_owner (id, client_id, at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET client_id = excluded.client_id, at = excluded.at`,
      clientId,
      now,
    );
    this.d.sql.exec(`INSERT INTO voice_clients (client_id, active_at) VALUES (?, ?) ON CONFLICT(client_id) DO UPDATE SET active_at = excluded.active_at`, clientId, now);
    this.prune(now);
    this.publish(reason, claimId);
  }

  /** The stored owner (the client of the most recent interaction), connected or not. */
  owner(): string | null {
    return this.d.sql.exec<{ client_id: string }>('SELECT client_id FROM voice_owner WHERE id = 1').toArray()[0]?.client_id ?? null;
  }

  /**
   * Who speaks now: the owner while connected (or within the grace after its last socket closed); else the client
   * that speaks already, while it is connected (a new tab never takes the voice by opening); else the most recently
   * active connected client (by its last interaction, then the longest connected); else nobody.
   */
  effective(closing?: VoiceSocket): string | null {
    const open = this.open(closing);
    const now = this.d.now();
    const present = (id: string | null | undefined): id is string => !!id && (open.has(id) || now - (this.lost.get(id)?.at ?? Number.NEGATIVE_INFINITY) < VOICE_GRACE_MS);
    const owner = this.owner();
    if (present(owner)) return owner;
    if (present(this.published)) return this.published;
    if (!open.size) return null;
    const active = new Map(
      this.d.sql
        .exec<{ client_id: string; active_at: number }>(`SELECT client_id, active_at FROM voice_clients`)
        .toArray()
        .map((r) => [r.client_id, Number(r.active_at)] as const),
    );
    return [...open.entries()].sort(([a, ca], [b, cb]) => (active.get(b) ?? 0) - (active.get(a) ?? 0) || ca - cb || (a < b ? -1 : 1))[0]![0];
  }

  /** Connected clients (open sockets with a client id) and when each first connected. */
  private open(closing?: VoiceSocket): Map<string, number> {
    const out = new Map<string, number>();
    for (const ws of this.d.sockets()) {
      if (ws === closing) continue;
      if (typeof ws.readyState === 'number' && ws.readyState !== OPEN) continue;
      const a = attachmentOf(ws);
      if (!isClientId(a.clientId)) continue;
      const at = typeof a.connectedAt === 'number' ? a.connectedAt : 0;
      out.set(a.clientId, Math.min(out.get(a.clientId) ?? Number.POSITIVE_INFINITY, at));
    }
    return out;
  }

  /** A client's last socket went away: the grace starts, and a re-check is due when it ends. */
  private lose(id: string): void {
    this.lost.set(id, { at: this.d.now(), seq: this.d.head?.() ?? null });
    this.d.later(() => this.publish('fallback'), VOICE_GRACE_MS + 50);
  }

  private publish(reason: VoiceOwnerReason, claimId?: string, closing?: VoiceSocket): void {
    const next = this.effective(closing);
    if (next === this.published && !claimId) return;
    const prev = this.published;
    this.published = next;
    this.d.sql.exec(`INSERT INTO voice_published (id, client_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET client_id = excluded.client_id`, next);
    // The voice falls to another tab because the one that had it went away: what came after that reached no tab with the
    // voice. The new owner may still voice the proactive lines among it (announcements).
    const gone = reason === 'fallback' && next && prev && prev !== next ? this.lost.get(prev) : undefined;
    this.d.broadcast({ clientId: next, reason, ...(claimId ? { claimId } : {}), ...(gone && gone.seq !== null ? { unvoicedAfter: gone.seq } : {}), at: this.d.now() });
  }

  private prune(now: number): void {
    this.d.sql.exec('DELETE FROM voice_clients WHERE active_at < ?', now - CLIENT_TTL_MS);
    this.d.sql.exec(`DELETE FROM voice_clients WHERE client_id NOT IN (SELECT client_id FROM voice_clients ORDER BY active_at DESC LIMIT ${MAX_CLIENTS})`);
  }
}
