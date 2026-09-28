import { PROTOCOL_VERSION, WS_REPLAY_LIMIT, type Frame, type FrameEnvelope, type FrameInput, type FrameType, type StreamId } from '@headcount/protocol';

/** The part of `DurableObjectStorage` the ledger needs (the SQLite API is synchronous). */
export type SqlHost = Pick<DurableObjectStorage, 'sql' | 'transactionSync'>;

type EventRow = {
  seq: number;
  ts: string;
  type: string;
  actor: string | null;
  op_id: string | null;
  cause_stream: string | null;
  cause_seq: number | null;
  data: string;
};

/** Hot window kept in DO SQLite per stream (ARCHITECTURE §2.4); older rows go once rolled up to D1. */
export const HOT_WINDOW_EVENTS = 50_000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
     seq          INTEGER PRIMARY KEY,
     ts           TEXT NOT NULL,
     type         TEXT NOT NULL,
     actor        TEXT,
     op_id        TEXT,
     cause_stream TEXT,
     cause_seq    INTEGER,
     data         TEXT NOT NULL,
     rolled       INTEGER NOT NULL DEFAULT 0,
     forwarded    INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS events_type ON events (type, seq)`,
  `CREATE INDEX IF NOT EXISTS events_rolled ON events (rolled, seq)`,
  `CREATE INDEX IF NOT EXISTS events_forwarded ON events (forwarded, seq)`,
];

/**
 * Append-only event ledger for one stream in a Durable Object's SQLite (ARCHITECTURE §2.3, §3).
 * `seq` is gap-free: it is assigned as MAX(seq)+1 in the same synchronous block as the insert, so
 * the write and the number commit together (or not at all). Every row also carries two outbox flags:
 * `rolled` (copied to D1 `ledger_events`) and `forwarded` (mirrored to another stream, used by ProjectDO).
 */
export class Ledger {
  constructor(
    private readonly storage: SqlHost,
    readonly streamId: StreamId,
    private readonly clock: () => number = () => Date.now(),
  ) {
    for (const stmt of SCHEMA) storage.sql.exec(stmt);
  }

  /** Run `fn` as one storage transaction (rolls back on throw). Do not nest. */
  tx<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }

  lastSeq(): number {
    const row = this.storage.sql.exec<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM events').toArray()[0];
    return Number(row?.seq ?? 0);
  }

  /** Persist one frame and return it with its seq. `ts` defaults to now (mirrors keep the source time). */
  append<T extends FrameType>(input: FrameInput<T>, opts: { ts?: string } = {}): FrameEnvelope<T> {
    const seq = this.lastSeq() + 1;
    const ts = opts.ts ?? new Date(this.clock()).toISOString();
    this.storage.sql.exec(
      'INSERT INTO events (seq, ts, type, actor, op_id, cause_stream, cause_seq, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      seq,
      ts,
      input.type,
      input.actor ?? null,
      input.opId ?? null,
      input.cause?.streamId ?? null,
      input.cause?.seq ?? null,
      JSON.stringify(input.data),
    );
    if (seq % 1000 === 0) this.prune();
    return this.toFrame<T>({ seq, ts, type: input.type, actor: input.actor ?? null, op_id: input.opId ?? null, cause_stream: input.cause?.streamId ?? null, cause_seq: input.cause?.seq ?? null, data: JSON.stringify(input.data) });
  }

  /** Persisted frames with seq > since, oldest first (replay). */
  since(since: number, limit: number = WS_REPLAY_LIMIT): Frame[] {
    return this.storage.sql
      .exec<EventRow>('SELECT seq, ts, type, actor, op_id, cause_stream, cause_seq, data FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?', Math.max(0, Math.floor(since)), Math.max(1, Math.floor(limit)))
      .toArray()
      .map((r) => this.toFrame(r) as Frame);
  }

  /** The newest `limit` frames of the given types, returned oldest first. */
  recent(types: FrameType[], limit: number): Frame[] {
    if (!types.length) return [];
    const marks = types.map(() => '?').join(', ');
    return this.storage.sql
      .exec<EventRow>(`SELECT seq, ts, type, actor, op_id, cause_stream, cause_seq, data FROM events WHERE type IN (${marks}) ORDER BY seq DESC LIMIT ?`, ...types, limit)
      .toArray()
      .reverse()
      .map((r) => this.toFrame(r) as Frame);
  }

  get(seq: number): Frame | null {
    const row = this.storage.sql.exec<EventRow>('SELECT seq, ts, type, actor, op_id, cause_stream, cause_seq, data FROM events WHERE seq = ?', seq).toArray()[0];
    return row ? (this.toFrame(row) as Frame) : null;
  }

  // ── outboxes ──────────────────────────────────────────────────────────────────
  unrolled(limit = 200): Frame[] {
    return this.outbox('rolled', limit);
  }

  markRolled(upToSeq: number): void {
    this.storage.sql.exec('UPDATE events SET rolled = 1 WHERE rolled = 0 AND seq <= ?', upToSeq);
  }

  unforwarded(limit = 100): Frame[] {
    return this.outbox('forwarded', limit);
  }

  markForwarded(upToSeq: number): void {
    this.storage.sql.exec('UPDATE events SET forwarded = 1 WHERE forwarded = 0 AND seq <= ?', upToSeq);
  }

  /** Drop rolled-up rows outside the hot window (the newest rows always stay, so seq never restarts). */
  prune(keep: number = HOT_WINDOW_EVENTS): void {
    this.storage.sql.exec('DELETE FROM events WHERE rolled = 1 AND seq <= ?', this.lastSeq() - keep);
  }

  private outbox(column: 'rolled' | 'forwarded', limit: number): Frame[] {
    return this.storage.sql
      .exec<EventRow>(`SELECT seq, ts, type, actor, op_id, cause_stream, cause_seq, data FROM events WHERE ${column} = 0 ORDER BY seq ASC LIMIT ?`, limit)
      .toArray()
      .map((r) => this.toFrame(r) as Frame);
  }

  private toFrame<T extends FrameType>(r: EventRow): FrameEnvelope<T> {
    const frame: FrameEnvelope<T> = { v: PROTOCOL_VERSION, streamId: this.streamId, seq: Number(r.seq), ts: r.ts, type: r.type as T, data: JSON.parse(r.data) };
    if (r.op_id !== null) frame.opId = r.op_id;
    if (r.actor !== null) frame.actor = r.actor as FrameEnvelope['actor'];
    if (r.cause_stream !== null && r.cause_seq !== null) frame.cause = { streamId: r.cause_stream as StreamId, seq: Number(r.cause_seq) };
    return frame;
  }
}
