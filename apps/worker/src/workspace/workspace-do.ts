import { DurableObject } from 'cloudflare:workers';
import {
  CHIEF_ID,
  DEFAULT_WORKSPACE_ID,
  OWNER_ACTOR,
  ids,
  isPersisted,
  workspaceStream,
  type ClientSocketMessage,
  type Frame,
  type FrameInput,
  type JobId,
  type StreamId,
  type TalkAccepted,
  type TalkRequest,
  type TurnId,
  type UpdateWorkspaceRequest,
  type WorkspaceSettings,
} from '@headcount/protocol';
import type { Env } from '../env';
import { DailyCounter, dailyLimit, limitMessage } from '../lib/limits';
import type { MirrorBatch } from '../jobs/project-do';
import { clipText } from '../jobs/job-view';
import { projectStub } from '../lib/stubs';
import type { ProjectApi } from './chief-tools';
import { Feed, PresenceBoard, type FeedSocket } from './feed';
import { Ledger } from './ledger';
import { rollupEvents, upsertWorkspace } from './rollup';
import { logError, runtime } from './runtime';
import { closeTurn, newTurnState, runChiefTurn, type TurnState } from './talk';

/** Idempotency records for owner commands (ARCHITECTURE §3.4: 24 h). */
const OP_TTL_MS = 24 * 60 * 60 * 1000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ops (op_id TEXT PRIMARY KEY, result TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mirrored (src_stream TEXT NOT NULL, src_seq INTEGER NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (src_stream, src_seq))`,
  `CREATE TABLE IF NOT EXISTS jobs_seen (job_id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

/** A talk command the WorkspaceDO refused (RPC-safe: returned, not thrown). */
export interface TalkRefusal {
  accepted: false;
  code: 'rate_limited';
  message: string;
}

interface ActiveTurn {
  turnId: TurnId;
  controller: AbortController;
  state: TurnState;
  done: Promise<void>;
}

/**
 * WorkspaceDO — the tenant (ARCHITECTURE §2.2). In Inc 0 it also hosts:
 * - owner settings (leadId, chiefName, voiceOn);
 * - the owner feed: the `ws:<ws>` ledger in DO SQLite (gap-free seq), hibernating sockets with `?since`
 *   replay, and presence for the Chief of Staff (merged claims: thinking from talk; background jobs keep the
 *   Chief of Staff available, and the web shows them as a count, never as a busy state — D2);
 * - the Chief of Staff's conversation loop: POST /api/talk is accepted at once (202) and the reply
 *   streams as talk.* frames; a newer owner message cuts a reply still streaming (barge-in) and the
 *   next turn sees everything said so far;
 * - the mirror of the Everyday ProjectDO's job frames (re-sequenced, cause = source stream + seq), plus
 *   the proactive announcement when a job finishes, fails or is stopped from the UI.
 */
export class WorkspaceDO extends DurableObject<Env> {
  private readonly ledger: Ledger;
  private readonly presence: PresenceBoard;
  readonly feed: Feed;
  private turn: ActiveTurn | null = null;
  private rollupPending = false;
  private readonly usage: DailyCounter;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const stmt of SCHEMA) ctx.storage.sql.exec(stmt);
    this.ledger = new Ledger(ctx.storage, workspaceStream(this.workspaceId), runtime.now);
    this.presence = new PresenceBoard(ctx.storage);
    this.feed = new Feed(this.workspaceId, this.ledger, this.presence, () => this.ctx.getWebSockets() as unknown as FeedSocket[], runtime.now);
    this.usage = new DailyCounter(ctx.storage);
    this.recoverInterruptedTurn();
  }

  private get workspaceId(): string {
    return this.env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID;
  }

  // ── sockets (hibernation API) ───────────────────────────────────────────────────

  /** WebSocket upgrade for GET /api/ws?since=<seq>. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 426 });
    const raw = new URL(request.url).searchParams.get('since');
    const since = raw && /^\d+$/.test(raw) ? Number(raw) : 0;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, ['feed']);
    this.feed.open(server, since);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let msg: ClientSocketMessage | null = null;
    try {
      msg = JSON.parse(message) as ClientSocketMessage;
    } catch {
      return;
    }
    if (msg?.op === 'ping') ws.send(JSON.stringify({ op: 'pong', t: msg.t }));
    else if (msg?.op === 'resume' && typeof msg.since === 'number' && msg.since >= 0) this.feed.replay(ws, Math.floor(msg.since));
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  override async webSocketError(): Promise<void> {
    /* the client reconnects with its cursor */
  }

  // ── settings ────────────────────────────────────────────────────────────────────

  async getSettings(): Promise<WorkspaceSettings> {
    const stored = await this.ctx.storage.get<WorkspaceSettings>('settings');
    return stored ?? { workspaceId: this.workspaceId, leadId: null, chiefName: null, voiceOn: true, updatedAt: new Date(0).toISOString() };
  }

  /** Apply a settings patch, persist it, and tell every tab (workspace.updated). */
  async updateSettings(patch: UpdateWorkspaceRequest): Promise<WorkspaceSettings> {
    const current = await this.getSettings();
    const next: WorkspaceSettings = { ...current, workspaceId: this.workspaceId, updatedAt: new Date(runtime.now()).toISOString() };
    if (patch.leadId !== undefined) next.leadId = patch.leadId;
    if (patch.chiefName !== undefined) next.chiefName = patch.chiefName;
    if (patch.voiceOn !== undefined) next.voiceOn = patch.voiceOn;
    await this.ctx.storage.put('settings', next);
    this.feed.append({ type: 'workspace.updated', data: { settings: next }, actor: OWNER_ACTOR });
    this.scheduleRollup(next);
    return next;
  }

  // ── talk ────────────────────────────────────────────────────────────────────────

  /**
   * Accept an owner message (202 path): echo it as `talk.owner`, then run the Chief of Staff's turn in
   * the background. Idempotent on opId. A newer message aborts a reply still streaming; the new turn
   * sees everything said so far.
   */
  async talk(req: TalkRequest): Promise<TalkAccepted | TalkRefusal> {
    const prior = this.ctx.storage.sql.exec<{ result: string }>('SELECT result FROM ops WHERE op_id = ?', req.opId).toArray()[0];
    if (prior) return { ...(JSON.parse(prior.result) as TalkAccepted), duplicate: true };
    // CHAT_DAILY_LIMIT: every new owner message costs a model turn. Counted synchronously with the command.
    const limit = dailyLimit(this.env, 'chat');
    if (!this.usage.take('chat', limit, runtime.now()).allowed) return { accepted: false, code: 'rate_limited', message: limitMessage('chat', limit) };

    const turnId = ids.turn();
    const messageId = ids.message();
    const accepted: TalkAccepted = { accepted: true, opId: req.opId, turnId, messageId };
    const now = runtime.now();
    // Barge-in: a reply still streaming is cut here. Its partial text and talk.done land before the new
    // owner message, so each turn stays contiguous in the ledger (and in a replayed thread).
    const previous = this.turn;
    if (previous) {
      previous.controller.abort();
      closeTurn(this.feed, previous.state, 'cancelled');
    }
    const owner = this.ledger.tx(() => {
      const f = this.ledger.append({ type: 'talk.owner', data: { turnId, messageId, text: req.text, via: req.via === 'voice' ? 'voice' : 'text' }, opId: req.opId, actor: OWNER_ACTOR });
      this.ctx.storage.sql.exec('INSERT INTO ops (op_id, result, at) VALUES (?, ?, ?)', req.opId, JSON.stringify(accepted), now);
      this.ctx.storage.sql.exec(`INSERT INTO meta (key, value) VALUES ('active_turn', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify({ turnId, opId: req.opId }));
      return f;
    });
    this.feed.broadcast(owner);
    this.scheduleRollup();
    this.ctx.storage.sql.exec('DELETE FROM ops WHERE at < ?', now - OP_TTL_MS);

    const controller = new AbortController();
    const state = newTurnState(turnId, req.opId);
    const done = (async () => {
      if (previous) await previous.done; // let the cut turn wind down (tools in flight) before the next model call
      await runChiefTurn(this.talkHost(), { turnId, ownerSeq: owner.seq!, opId: req.opId, signal: controller.signal }, state);
    })()
      .catch((err) => logError('talk', err))
      .finally(() => {
        if (this.turn?.turnId === turnId) {
          this.turn = null;
          this.ctx.storage.sql.exec(`DELETE FROM meta WHERE key = 'active_turn'`);
        }
        this.scheduleRollup();
      });
    this.turn = { turnId, controller, state, done };
    this.ctx.waitUntil(done);
    return accepted;
  }

  /** Persisted frames after `since` (debugging, tests, and a future `GET /api/streams/:id?since`). */
  async frames(since = 0, limit = 500): Promise<Frame[]> {
    return this.ledger.since(since, limit);
  }

  // ── mirror from ProjectDO ─────────────────────────────────────────────────────────

  /**
   * Mirror a project's persisted frames into the owner feed. Each source (stream, seq) lands once, in
   * order, with a new seq and `cause = {source, seq}`. Finished and failed jobs get a proactive
   * announcement from the Chief of Staff. The presence claim updates the merged face state.
   */
  async ingest(batch: MirrorBatch): Promise<{ applied: number }> {
    let applied = 0;
    let lastSeq: number | null = null;
    for (const f of batch.frames) {
      if (typeof f.seq !== 'number' || !isPersisted(f.type)) continue;
      // The mirrored frame, its dedupe row and the announcement it causes commit together: a retry after a
      // crash is deduplicated, so an announcement written later could be lost for good.
      const written = this.ledger.tx(() => {
        const seen = this.ctx.storage.sql.exec('SELECT seq FROM mirrored WHERE src_stream = ? AND src_seq = ?', batch.source, f.seq).toArray()[0];
        if (seen) return null;
        const m = this.ledger.append(
          { type: f.type, data: f.data, ...(f.actor ? { actor: f.actor } : {}), ...(f.opId ? { opId: f.opId } : {}), cause: { streamId: batch.source, seq: f.seq! } } as Parameters<Ledger['append']>[0],
          { ts: f.ts },
        );
        this.ctx.storage.sql.exec('INSERT INTO mirrored (src_stream, src_seq, seq) VALUES (?, ?, ?)', batch.source, f.seq, m.seq);
        if (f.type === 'job.started') this.ctx.storage.sql.exec('INSERT OR REPLACE INTO jobs_seen (job_id, title) VALUES (?, ?)', f.data.job.jobId, f.data.job.title);
        const input = this.announcement(m as Frame);
        return { mirrored: m, announcement: input ? this.ledger.append(input) : null };
      });
      if (!written) continue;
      applied++;
      this.feed.broadcast(written.mirrored);
      lastSeq = written.mirrored.seq!;
      if (written.announcement) {
        this.feed.broadcast(written.announcement);
        lastSeq = written.announcement.seq!;
      }
    }
    if (batch.presence) {
      const claim = batch.presence.claim;
      this.feed.claim(batch.presence.agentId, batch.source, claim ? { ...claim, causeSeq: lastSeq ?? claim.causeSeq } : null);
    }
    if (applied) this.scheduleRollup();
    return { applied };
  }

  /**
   * The Chief of Staff tells the owner when a job ends (talk.message kind 'announcement'): finished, failed,
   * or stopped from the UI (a stop the Chief of Staff made on the owner's word was already said in the turn).
   */
  private announcement(frame: Frame): FrameInput<'talk.message'> | null {
    let text: string;
    let jobId: JobId;
    if (frame.type === 'job.done') {
      jobId = frame.data.jobId;
      text = `“${this.jobTitle(jobId)}” is done. ${clipText(frame.data.summary, 400)} The full write-up is in Projects.`;
    } else if (frame.type === 'job.failed') {
      jobId = frame.data.jobId;
      text = `I could not finish “${this.jobTitle(jobId)}”. ${frame.data.message}`;
    } else if (frame.type === 'job.cancelled' && frame.data.by === 'owner') {
      jobId = frame.data.jobId;
      text = `Stopped “${this.jobTitle(jobId)}”. Nothing more will run on it; say the word if you want it started again.`;
    } else return null;
    return {
      type: 'talk.message',
      data: { turnId: null, messageId: ids.message(), agentId: CHIEF_ID, text: text.replace(/\s+/g, ' ').trim(), kind: 'announcement', jobId },
      actor: CHIEF_ID,
      cause: { streamId: frame.streamId as StreamId, seq: frame.seq! },
    };
  }

  private jobTitle(jobId: string): string {
    return this.ctx.storage.sql.exec<{ title: string }>('SELECT title FROM jobs_seen WHERE job_id = ?', jobId).toArray()[0]?.title ?? 'The job';
  }

  // ── internals ───────────────────────────────────────────────────────────────────

  private project(): ProjectApi {
    const stub = projectStub(this.env);
    return {
      startJob: (req) => stub.startJob(req) as unknown as ReturnType<ProjectApi['startJob']>,
      listJobs: () => stub.listJobs() as unknown as ReturnType<ProjectApi['listJobs']>,
      steerJob: (jobId, text, opId) => stub.steerJob(jobId, text, opId) as unknown as ReturnType<ProjectApi['steerJob']>,
      cancelJob: (jobId, reason, by) => stub.cancelJob(jobId, reason, by) as unknown as ReturnType<ProjectApi['cancelJob']>,
    };
  }

  private talkHost() {
    return {
      feed: this.feed,
      ledger: this.ledger,
      registry: () => runtime.registry(this.env),
      project: () => this.project(),
      settings: () => this.getSettings(),
      isCurrent: (turnId: TurnId) => this.turn?.turnId === turnId,
      now: () => runtime.now(),
    };
  }

  /**
   * A turn that was running when the object last died never finished: close it so the thread is consistent.
   * A fresh object runs no turn, so any 'talk' presence claim (Thinking) is stale too and is cleared, even
   * without an active_turn row: the face is the status UI and must not stay on Thinking.
   */
  private recoverInterruptedTurn(): void {
    this.presence.claim(CHIEF_ID, 'talk', null, runtime.now());
    const row = this.ctx.storage.sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'active_turn'`).toArray()[0];
    if (!row) return;
    try {
      const { turnId, opId } = JSON.parse(row.value) as { turnId: TurnId; opId?: string };
      this.ledger.append({ type: 'talk.done', data: { turnId, messageId: null, finish: 'error' }, actor: CHIEF_ID, ...(opId ? { opId } : {}) });
    } catch (err) {
      logError('workspace.recover', err);
    }
    this.ctx.storage.sql.exec(`DELETE FROM meta WHERE key = 'active_turn'`);
  }

  /** Copy new ledger rows (and settings) to D1 in the background; retried on the next append after a failure. */
  private scheduleRollup(settings?: WorkspaceSettings): void {
    const db = this.env.DB;
    if (!db) return;
    if (settings) this.ctx.waitUntil(upsertWorkspace(db, settings).catch((err) => logError('workspace.rollup', err)));
    if (this.rollupPending) return;
    this.rollupPending = true;
    this.ctx.waitUntil(
      (async () => {
        try {
          for (let page = 0; page < 20; page++) {
            const frames = this.ledger.unrolled(200);
            if (!frames.length) break;
            await rollupEvents(db, this.workspaceId, frames);
            this.ledger.markRolled(frames[frames.length - 1]!.seq!);
          }
        } catch (err) {
          logError('workspace.rollup', err);
        } finally {
          this.rollupPending = false;
        }
      })(),
    );
  }
}
