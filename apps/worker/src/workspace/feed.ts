import {
  CHIEF_ID,
  PRESENCE_DWELL_MS,
  WS_REPLAY_LIMIT,
  makeFrame,
  mergePresence,
  type AgentId,
  type Frame,
  type FrameEnvelope,
  type FrameInput,
  type FrameType,
  type PresenceData,
  type PresenceState,
  type WorkspaceId,
} from '@headcount/protocol';
import type { Ledger, SqlHost } from './ledger';

/** The part of a WebSocket the feed uses (lets tests pass plain objects). */
export interface FeedSocket {
  send(message: string): void;
}

/** One source's claim about an agent's face state (ARCHITECTURE §3.5: sources claim, the WorkspaceDO merges). */
export interface PresenceClaim {
  state: PresenceState;
  label: string;
  causeSeq: number | null;
  projectId?: string;
}

type ClaimRow = { agent_id: string; source: string; state: string; label: string; cause_seq: number | null; project_id: string | null };

const IDLE_LABEL = 'Available';

/**
 * Presence claims per (agent, source), persisted in DO SQLite so a hibernated WorkspaceDO still sends the
 * right snapshot on connect. `talk` claims come from the Chief of Staff's turns (thinking), project
 * sources from ProjectDO (working). `speaking`/`listening` are client-local and never claimed here.
 */
export class PresenceBoard {
  private readonly last = new Map<string, string>();

  constructor(private readonly storage: SqlHost) {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS presence_claims (
      agent_id TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL, label TEXT NOT NULL,
      cause_seq INTEGER, project_id TEXT, at INTEGER NOT NULL, PRIMARY KEY (agent_id, source))`);
  }

  /** Set (or clear with null) one source's claim. Returns the merged presence when it changed, else null. */
  claim(agentId: AgentId, source: string, claim: PresenceClaim | null, now = Date.now()): PresenceData | null {
    if (!claim || claim.state === 'idle') this.storage.sql.exec('DELETE FROM presence_claims WHERE agent_id = ? AND source = ?', agentId, source);
    else
      this.storage.sql.exec(
        `INSERT INTO presence_claims (agent_id, source, state, label, cause_seq, project_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id, source) DO UPDATE SET state = excluded.state, label = excluded.label, cause_seq = excluded.cause_seq,
           project_id = excluded.project_id, at = excluded.at`,
        agentId,
        source,
        claim.state,
        claim.label,
        claim.causeSeq,
        claim.projectId ?? null,
        now,
      );
    const merged = this.merged(agentId);
    const key = JSON.stringify([merged.state, merged.label, merged.projectId ?? null]);
    if (this.last.get(agentId) === key) return null;
    this.last.set(agentId, key);
    return merged;
  }

  merged(agentId: AgentId): PresenceData {
    const rows = this.storage.sql
      .exec<ClaimRow>('SELECT agent_id, source, state, label, cause_seq, project_id FROM presence_claims WHERE agent_id = ? ORDER BY at DESC', agentId)
      .toArray();
    const best = mergePresence(rows.map((r) => ({ ...r, state: r.state as PresenceState })));
    if (!best) return { agentId, state: 'idle', label: IDLE_LABEL, causeSeq: null, dwellMs: PRESENCE_DWELL_MS.idle };
    const out: PresenceData = { agentId, state: best.state, label: best.label, causeSeq: best.cause_seq === null ? null : Number(best.cause_seq), dwellMs: PRESENCE_DWELL_MS[best.state] };
    if (best.project_id) out.projectId = best.project_id;
    return out;
  }

  /** Merged presence for every agent with a claim, plus the Chief of Staff (always present). */
  snapshot(): PresenceData[] {
    const agents = new Set<string>([CHIEF_ID, ...this.storage.sql.exec<{ agent_id: string }>('SELECT DISTINCT agent_id FROM presence_claims').toArray().map((r) => r.agent_id)]);
    return [...agents].map((a) => this.merged(a as AgentId));
  }
}

/**
 * The owner feed hub: one stream (`ws:<ws>`), hibernating sockets, `?since` replay (CONTRACTS §4.2).
 * On connect: `ready` → persisted frames with seq > since (oldest first, ≤ WS_REPLAY_LIMIT) → presence
 * snapshot → live. Everything here is synchronous, so no append can interleave with a replay.
 */
export class Feed {
  constructor(
    private readonly workspaceId: WorkspaceId,
    private readonly ledger: Ledger,
    private readonly presence: PresenceBoard,
    private readonly sockets: () => FeedSocket[],
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Greet a new socket and catch it up. Returns the last seq replayed (or `since` when nothing was missed). */
  open(ws: FeedSocket, since: number): number {
    const lastSeq = this.ledger.lastSeq();
    const from = Math.max(0, Math.floor(Number.isFinite(since) ? since : 0));
    send(ws, this.ephemeral({ type: 'ready', data: { workspaceId: this.workspaceId, streamId: this.ledger.streamId, lastSeq, replayFrom: from, serverTime: new Date(this.clock()).toISOString() } }));
    const last = this.replay(ws, from);
    for (const p of this.presence.snapshot()) send(ws, this.ephemeral({ type: 'presence', data: p }));
    return last;
  }

  /** Send persisted frames after `since` (one page). Used on connect and for `{op:'resume'}`. */
  replay(ws: FeedSocket, since: number, limit = WS_REPLAY_LIMIT): number {
    let last = since;
    for (const f of this.ledger.since(since, limit)) {
      send(ws, f);
      last = f.seq ?? last;
    }
    return last;
  }

  /** Persist a frame, broadcast it and return it. */
  append<T extends FrameType>(input: FrameInput<T>, opts: { ts?: string } = {}): FrameEnvelope<T> {
    const frame = this.ledger.append(input, opts);
    this.broadcast(frame);
    return frame;
  }

  /** Broadcast an ephemeral frame (delta, presence, error) stamped with the last persisted seq. */
  emit<T extends FrameType>(input: FrameInput<T>): FrameEnvelope<T> {
    const frame = this.ephemeral(input);
    this.broadcast(frame);
    return frame;
  }

  /** Send one ephemeral frame to one socket (connect snapshots after presence: mood, attention). */
  sendTo<T extends FrameType>(ws: FeedSocket, input: FrameInput<T>): void {
    send(ws, this.ephemeral(input));
  }

  /** Update a presence claim and broadcast the merged state when it changed. */
  claim(agentId: AgentId, source: string, claim: PresenceClaim | null): void {
    const merged = this.presence.claim(agentId, source, claim, this.clock());
    if (merged) this.emit({ type: 'presence', data: merged });
  }

  broadcast(frame: Frame | FrameEnvelope): void {
    const msg = JSON.stringify(frame);
    for (const ws of this.sockets()) {
      try {
        ws.send(msg);
      } catch {
        /* closing socket: the client reconnects with its cursor */
      }
    }
  }

  private ephemeral<T extends FrameType>(input: FrameInput<T>): FrameEnvelope<T> {
    return makeFrame(this.ledger.streamId, input, { after: this.ledger.lastSeq() }, new Date(this.clock()));
  }
}

function send(ws: FeedSocket, frame: Frame | FrameEnvelope): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    /* closed */
  }
}
