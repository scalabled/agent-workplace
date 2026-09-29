import { DurableObject } from 'cloudflare:workers';
import { fullIndex } from '@headcount/catalog/full';
import { sniffOwnerText, type AffectCues } from '@headcount/expressions';
import { MissingProviderError, type ChatProvider } from '@headcount/models';
import {
  CHIEF_ID,
  DEFAULT_WORKSPACE_ID,
  OWNER_ACTOR,
  coworkerAgentId,
  ids,
  isPersisted,
  workspaceStream,
  type AgentId,
  type ClientSocketMessage,
  type Frame,
  type FrameInput,
  type JobId,
  type MessageId,
  type OpId,
  type StreamId,
  type TalkAccepted,
  type TalkRequest,
  type TurnId,
  type UpdateWorkspaceRequest,
  type WorkspaceSettings,
} from '@headcount/protocol';
import { ambienceOf, type DeskSayAccepted, type DeskSayRequest, type ExprCause, type ExprTtsProvider, type TalkSurface } from '@headcount/protocol/ext/expressions';
import { isClaimId, isClientId, type VoiceOwnerData, type VoiceOwnerReason } from '@headcount/protocol/ext/voice-owner';
import {
  ROOM_TURNS_PER_MIN,
  roomKindOf,
  type RoomCancelRequest,
  type RoomCancelResponse,
  type RoomId,
  type RoomRefusal,
  type RoomSayAccepted,
  type RoomSayRequest,
} from '@headcount/protocol/ext/rooms';
import { closeDeskTurn, newDeskTurnState, runDeskTurn, type DeskHost, type DeskTurnState } from '../desk/desk';
import type { Env } from '../env';
import { exprLexicon } from '../expr/catalog';
import { DESK_PER_MIN } from '../expr/config';
import { ExprHost, type ExprAgentState, type ManifestRow } from '../expr/host';
import { parseRecentOp, parseViewerOp } from '../expr/viewer';
import { DailyCounter, dailyLimit, limitMessage } from '../lib/limits';
import type { MirrorBatch } from '../jobs/project-do';
import { projectStub } from '../lib/stubs';
import { mockMediaEnabled } from '../media/speech';
import { composeAnnouncement, templateAnnouncement, type AnnouncementFacts } from './announce';
import type { ProjectApi } from './chief-tools';
import { Feed, PresenceBoard, type FeedSocket } from './feed';
import { Ledger } from './ledger';
import { rollupEvents, upsertWorkspace } from './rollup';
import { logError, logWarn, runtime } from './runtime';
import { closeReflexTurn, closeTurn, newTurnState, runChiefTurn, type TurnState } from './talk';
import { VoiceOwnership } from './voice';
import { isPhatic, planFloor, type FloorCandidate } from '../rooms/floor';
import { existingNote, meetingNoteText, meetingStats } from '../rooms/meeting';
import { roomMember, type RoomMember } from '../rooms/prompt';
import { ROOM_NO_PROVIDER_MESSAGE, ROOM_RATE_MESSAGE, cancelRoomTurn, newRoomTurn, runRoomTurn, type RoomHost, type RoomTurnState } from '../rooms/room-turn';

/** Idempotency records for owner commands (ARCHITECTURE §3.4: 24 h). */
const OP_TTL_MS = 24 * 60 * 60 * 1000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ops (op_id TEXT PRIMARY KEY, result TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mirrored (src_stream TEXT NOT NULL, src_seq INTEGER NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (src_stream, src_seq))`,
  `CREATE TABLE IF NOT EXISTS jobs_seen (job_id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // An announcement being written in the lead's voice. Inserted in the same transaction as the mirrored frame
  // that causes it, so it is never lost: if the object dies while the model writes, the template is posted.
  `CREATE TABLE IF NOT EXISTS pending_announcements (cause_seq INTEGER PRIMARY KEY, facts TEXT NOT NULL, frame TEXT NOT NULL, at INTEGER NOT NULL)`,
];

/** The fast model that phrases announcements (a cloud model; local and Mock use the template). */
interface Announcer {
  provider: ChatProvider;
  model: string;
}

/** An announcement to post: what it may say, and the templated frame (its text is the fallback). */
interface AnnouncementPlan {
  facts: AnnouncementFacts;
  frame: FrameInput<'talk.message'>;
}

/** A talk command the WorkspaceDO refused (RPC-safe: returned, not thrown). */
export interface TalkRefusal {
  accepted: false;
  code: 'rate_limited';
  message: string;
}

/** A quick-chat the WorkspaceDO refused (RPC-safe). */
export interface DeskRefusal {
  accepted: false;
  code: 'rate_limited' | 'not_found';
  message: string;
}

interface ActiveTurn {
  turnId: TurnId;
  controller: AbortController;
  state: TurnState;
  done: Promise<void>;
  /** The turn's work is over (its reply persisted or cut). */
  settled: boolean;
}

/**
 * A typed follow-up lets the reply still being written finish (its voice stops at a sentence on the client; the text
 * stays whole on screen) before the next answer starts, but waits at most `previousFinishMaxMs` before cutting it.
 * Mutable so tests can shorten it.
 */
export const talkTiming = { previousFinishMaxMs: 6000 };
export const defaultTalkTiming = { ...talkTiming };
/**
 * A typed message that is only a stop ("stop", "wait, cancel that") cuts the reply still streaming at once
 * (LIVING-WORKFORCE §2.3). A longer message with a steer word ("Oh wait, also, what about …") is a follow-up.
 */
const STOP_CUE = 0.6;
const STOP_MAX_WORDS = 4;
const isHardStop = (c: AffectCues): boolean => c.stopOrSteer >= STOP_CUE && c.words <= STOP_MAX_WORDS;

interface ActiveDeskTurn {
  turnId: TurnId;
  controller: AbortController;
  state: DeskTurnState;
  done: Promise<void>;
}

/** Meeting lines a room turn reads from the ledger (floor rotation, projection, the leave note). */
const ROOM_LEDGER_WINDOW = 600;

let skillNames: Map<string, string> | null = null;
/** A catalog skill id → its name (floor relevance). */
function skillName(id: string): string {
  skillNames ??= new Map(fullIndex.catalog.skills.map((s) => [s.id, s.name]));
  return skillNames.get(id) ?? id.replace(/-/g, ' ');
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
 *   the proactive announcement when a job finishes, fails or is stopped from the UI;
 * - Floor quick chats (desk/) and, in Office Phase 2, office rooms and joined huddles (rooms/): one room turn at a
 *   time, responders in turn at machine speed, every reply through the reply guard, one note in Talk on leave.
 */
export class WorkspaceDO extends DurableObject<Env> {
  private readonly ledger: Ledger;
  private readonly presence: PresenceBoard;
  readonly feed: Feed;
  private turn: ActiveTurn | null = null;
  /** A previous reply still writing after a typed follow-up or a phatic "thanks" (it finishes; nothing cuts it). */
  private finishing: ActiveTurn | null = null;
  private readonly deskTurns = new Map<AgentId, ActiveDeskTurn>();
  /** The office room turn running now (at most one per workspace) and its promise (Office Phase 2). */
  private room: RoomTurnState | null = null;
  private roomDone: Promise<void> | null = null;
  private rollupPending = false;
  private readonly usage: DailyCounter;
  /** The living-workforce layer: viewers, recency, manifests, mood, attention and server reflexes (Inc 0.5). */
  readonly expr: ExprHost;
  /** One voice per workspace: which client (browser tab) speaks (workspace/voice.ts). */
  readonly voice: VoiceOwnership;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const stmt of SCHEMA) ctx.storage.sql.exec(stmt);
    this.ledger = new Ledger(ctx.storage, workspaceStream(this.workspaceId), runtime.now);
    this.presence = new PresenceBoard(ctx.storage);
    this.feed = new Feed(this.workspaceId, this.ledger, this.presence, () => this.ctx.getWebSockets() as unknown as FeedSocket[], runtime.now);
    this.usage = new DailyCounter(ctx.storage);
    this.voice = new VoiceOwnership({
      sql: ctx.storage.sql,
      sockets: () => this.ctx.getWebSockets(),
      broadcast: (data) => this.feed.emit({ type: 'voice.owner', data }),
      now: () => runtime.now(),
      later: (fn, ms) => {
        const t = setTimeout(() => {
          try {
            fn();
          } catch (err) {
            logError('voice', err);
          }
        }, ms);
        (t as unknown as { unref?: () => void }).unref?.();
      },
      head: () => this.ledger.lastSeq(),
    });
    this.expr = new ExprHost({
      sql: ctx.storage.sql,
      feed: this.feed,
      streamId: this.ledger.streamId,
      workspaceId: this.workspaceId,
      presence: (agentId) => this.presence.merged(agentId).state,
      sockets: () => this.ctx.getWebSockets(),
      settings: () => this.getSettings(),
      registry: () => runtime.registry(this.env),
      mockMedia: () => mockMediaEnabled(this.env),
      now: () => runtime.now(),
      jobTitle: (jobId) => this.ctx.storage.sql.exec<{ title: string }>('SELECT title FROM jobs_seen WHERE job_id = ?', jobId).toArray()[0]?.title ?? null,
      voiceOwner: () => this.voice.effective(),
    });
    this.recoverInterruptedTurn();
    this.postStrandedAnnouncements();
  }

  private get workspaceId(): string {
    return this.env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID;
  }

  // ── sockets (hibernation API) ───────────────────────────────────────────────────

  /** WebSocket upgrade for GET /api/ws?since=<seq>&client=<id>. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 426 });
    const params = new URL(request.url).searchParams;
    const raw = params.get('since');
    const since = raw && /^\d+$/.test(raw) ? Number(raw) : 0;
    const clientId = params.get('client');
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, ['feed']);
    this.openFeed(server, since, isClientId(clientId) ? clientId : null);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Greet an accepted feed socket: `ready` (with who speaks now) → replay → presence → moods and attention; then tell
   * the other tabs if the voice moved (the first tab, or the owner's tab back after a reload).
   */
  openFeed(ws: WebSocket, since: number, clientId: string | null): void {
    this.voice.attach(ws, clientId);
    this.feed.open(ws, since, { voice: this.voice.snapshot() });
    // After the presence snapshot: moods of agents with an event and the Chief's attention (never replayed).
    try {
      for (const f of this.expr.connectFrames()) this.feed.sendTo(ws, f);
    } catch (err) {
      logError('expr.connect', err);
    }
    this.voice.connected();
  }

  /** An owner action over HTTP from a tab (a steer): that tab becomes the voice owner. */
  async voiceClaim(clientId: string, reason: VoiceOwnerReason): Promise<void> {
    if (isClientId(clientId)) this.voice.claim(clientId, reason);
  }

  /** Who speaks now (tests, debugging). */
  async voiceOwner(): Promise<VoiceOwnerData> {
    return this.voice.snapshot();
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let msg: ClientSocketMessage | null = null;
    try {
      msg = JSON.parse(message) as ClientSocketMessage;
    } catch {
      return;
    }
    this.voice.refresh();
    if (msg?.op === 'ping') ws.send(JSON.stringify({ op: 'pong', t: msg.t }));
    else if (msg?.op === 'resume' && typeof msg.since === 'number' && msg.since >= 0) this.feed.replay(ws, Math.floor(msg.since));
    else if (msg?.op === 'voice.claim') {
      const clientId = this.voice.clientOf(ws);
      if (clientId && isClaimId(msg.claimId)) this.voice.claim(clientId, 'claim', msg.claimId);
    } else if (msg?.op === 'viewer') {
      const op = parseViewerOp(msg);
      if (op) this.expr.setViewer(ws, op);
    } else if (msg?.op === 'expr.recent') {
      const op = parseRecentOp(msg);
      if (op) await this.expr.mergeRecent(op).catch((err) => logError('expr.recent', err));
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
    this.voice.closed(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    // The client reconnects with its cursor; meanwhile its voice follows the owner rules.
    this.voice.closed(ws);
  }

  // ── settings ────────────────────────────────────────────────────────────────────

  /** The owner's settings; `ambience` is always filled (settings stored before Inc 0.5 mean Lively). */
  async getSettings(): Promise<WorkspaceSettings> {
    const stored = await this.ctx.storage.get<WorkspaceSettings>('settings');
    const s = stored ?? { workspaceId: this.workspaceId, leadId: null, chiefName: null, voiceOn: true, updatedAt: new Date(0).toISOString() };
    return { ...s, ambience: ambienceOf(s) };
  }

  /** Apply a settings patch, persist it, and tell every tab (workspace.updated). */
  async updateSettings(patch: UpdateWorkspaceRequest): Promise<WorkspaceSettings> {
    const current = await this.getSettings();
    const next: WorkspaceSettings = { ...current, workspaceId: this.workspaceId, updatedAt: new Date(runtime.now()).toISOString() };
    if (patch.leadId !== undefined) next.leadId = patch.leadId;
    if (patch.chiefName !== undefined) next.chiefName = patch.chiefName;
    if (patch.voiceOn !== undefined) next.voiceOn = patch.voiceOn;
    if (patch.ambience !== undefined) next.ambience = patch.ambience;
    if (patch.ownerName !== undefined) next.ownerName = patch.ownerName;
    // A new lead has its own baseline mood.
    if (next.leadId !== current.leadId) this.expr.resetMood(CHIEF_ID);
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
    // The sending tab speaks: its claim lands before any frame of this turn.
    if (isClientId(req.clientId)) this.voice.claim(req.clientId, 'talk');
    const prior = this.ctx.storage.sql.exec<{ result: string }>('SELECT result FROM ops WHERE op_id = ?', req.opId).toArray()[0];
    if (prior) return { ...(JSON.parse(prior.result) as TalkAccepted), duplicate: true };
    // The owner-affect sniff (under a millisecond, straight from the bundle's lexicon: nothing compiles here).
    const cues = sniffOwnerText(req.text, exprLexicon());
    const phatic = isPhatic(cues);
    // CHAT_DAILY_LIMIT: every new owner message costs a model turn. Counted synchronously with the command. A phatic
    // turn is answered from the catalog and costs nothing (it is counted only if it falls back to the model).
    const limit = dailyLimit(this.env, 'chat');
    if (!phatic && !this.usage.take('chat', limit, runtime.now()).allowed) return { accepted: false, code: 'rate_limited', message: limitMessage('chat', limit) };

    const turnId = ids.turn();
    const messageId = ids.message();
    const accepted: TalkAccepted = { accepted: true, opId: req.opId, turnId, messageId };
    const now = runtime.now();
    const via = req.via === 'voice' ? 'voice' : 'text';
    // Barge-in: a reply still streaming is cut here when the owner speaks over it or says stop. Its partial text and
    // talk.done land before the new owner message, so each turn stays contiguous in the ledger. A typed follow-up or a
    // phatic "thanks" never cuts it: that reply finishes writing (the client places it in its own turn).
    const previous = this.turn && !this.turn.settled ? this.turn : this.finishing && !this.finishing.settled ? this.finishing : null;
    const letFinish = !!previous && !previous.state.closed && (phatic || (via === 'text' && !isHardStop(cues)));
    if (previous && !letFinish) {
      previous.controller.abort();
      closeTurn(this.feed, previous.state, 'cancelled');
      this.expr.turnEnded(previous.turnId);
    }
    if (previous && letFinish) this.finishing = previous;
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
    const cause: ExprCause = { streamId: this.ledger.streamId, seq: owner.seq! };
    this.expr.ownerGlance(CHIEF_ID, cause);
    const waitForPrevious = async () => {
      if (!previous) return;
      if (!letFinish) return void (await previous.done); // let the cut turn wind down (tools in flight) first
      // The reply still writing finishes first (bounded): the next answer then sees it whole.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([previous.done, new Promise<void>((r) => (timer = setTimeout(r, talkTiming.previousFinishMaxMs)))]);
      if (timer) clearTimeout(timer);
      if (!previous.settled) {
        previous.controller.abort();
        closeTurn(this.feed, previous.state, 'cancelled');
        await previous.done;
      }
    };
    const done = (async () => {
      // A phatic reply answers at once from the catalog; a model turn waits for the previous one.
      if (!phatic) await waitForPrevious();
      if (phatic) {
        if (await this.phaticTurn({ agentId: CHIEF_ID, turnId, via, cues, ownerSeq: owner.seq!, state, source: 'talk' })) return;
        await waitForPrevious();
        // No grounded line fits: the model answers after all, and the turn is counted now.
        if (!this.usage.take('chat', limit, runtime.now()).allowed) {
          this.feed.emit({ type: 'error', data: { code: 'rate_limited', message: limitMessage('chat', limit), turnId, opId: req.opId } });
          closeTurn(this.feed, state, 'error');
          this.feed.claim(CHIEF_ID, 'talk', null);
          return;
        }
      }
      await runChiefTurn(this.talkHost(), { turnId, ownerSeq: owner.seq!, opId: req.opId, signal: controller.signal, via, cues }, state);
    })()
      .catch((err) => logError('talk', err))
      .finally(() => {
        turn.settled = true;
        if (this.turn?.turnId === turnId) {
          this.turn = null;
          this.ctx.storage.sql.exec(`DELETE FROM meta WHERE key = 'active_turn'`);
        }
        if (this.finishing?.turnId === turnId) this.finishing = null;
        this.scheduleRollup();
        // Mood from the owner's words, after the reply started (it may compile the catalog once per isolate).
        this.expr.ownerMood(CHIEF_ID, cues, cause).catch((err) => logError('expr.mood', err));
      });
    const turn: ActiveTurn = { turnId, controller, state, done, settled: false };
    this.turn = turn;
    this.ctx.waitUntil(done);
    return accepted;
  }

  /**
   * Answer a phatic owner turn from the catalog in the addressee's own voice (A9): thinking → the line persisted as
   * `talk.message {kind:'reflex'}` + `talk.done {route:'reflex'}` → `reflex.say` with its clip (or a render request).
   * False when no grounded line fits (the caller asks the model).
   */
  private async phaticTurn(p: {
    agentId: AgentId;
    turnId: TurnId;
    via: 'voice' | 'text';
    cues: AffectCues;
    ownerSeq: number;
    state: { turnId: TurnId; opId: OpId; replyId: MessageId; text: string; closed: boolean };
    source: 'talk' | 'desk';
  }): Promise<boolean> {
    const surface: TalkSurface | undefined = p.source === 'desk' ? 'floor' : undefined;
    const current = () => (p.source === 'talk' ? this.turn?.turnId === p.turnId : this.deskTurns.get(p.agentId)?.turnId === p.turnId);
    this.feed.claim(p.agentId, p.source, { state: 'thinking', label: 'Thinking', causeSeq: p.ownerSeq });
    let reply;
    try {
      reply = await this.expr.phaticReply({ agentId: p.agentId, turnId: p.turnId, via: p.via, cues: p.cues, history: { firstMeeting: this.firstMeeting(p.agentId, p.turnId) } });
    } catch (err) {
      logError('expr.phatic', err);
      return false;
    }
    if (!reply) return false;
    const closed = closeReflexTurn(this.feed, this.ledger, p.state, { agentId: p.agentId, text: reply.text, intent: reply.intent, lineId: reply.lineId, ...(surface ? { surface } : {}) });
    if (closed) this.expr.emitSay(reply.frame);
    // A reply still writing behind this "thanks" keeps the face on Thinking until it is done.
    const behind = p.source === 'talk' && this.finishing && !this.finishing.settled;
    if ((closed || current()) && !behind) this.feed.claim(p.agentId, p.source, null);
    this.scheduleRollup();
    return true;
  }

  /**
   * True when the owner never wrote to this coworker before this turn (first meeting). Never for the Chief of Staff:
   * Talk always opens with the lead's own introduction, so a "hi" is not answered with a second "Hi, I'm …".
   */
  private firstMeeting(agentId: AgentId, turnId: TurnId): boolean {
    if (agentId === CHIEF_ID) return false;
    return !this.ledger
      .recent(['talk.owner'], 400)
      .some((f) => f.type === 'talk.owner' && f.data.turnId !== turnId && f.data.surface === 'floor' && f.data.agentId === agentId);
  }

  /**
   * A Floor quick-chat message to a catalog coworker (A11): 202 path like talk(), idempotent on opId, ≤ 12 a minute.
   * The reply streams as talk.* frames with the coworker's agentId and `surface: 'floor'`; a newer message to the same
   * coworker cuts a reply still streaming, and nothing here touches the Chief of Staff's turn.
   */
  async deskSay(personaId: string, req: DeskSayRequest): Promise<DeskSayAccepted | DeskRefusal> {
    if (isClientId(req.clientId)) this.voice.claim(req.clientId, 'desk');
    const prior = this.ctx.storage.sql.exec<{ result: string }>('SELECT result FROM ops WHERE op_id = ?', req.opId).toArray()[0];
    if (prior) return { ...(JSON.parse(prior.result) as DeskSayAccepted), duplicate: true };
    const persona = fullIndex.persona(personaId);
    if (!persona) return { accepted: false, code: 'not_found', message: `There is no coworker called ${personaId}.` };
    if (!this.expr.takeRate('desk', DESK_PER_MIN)) {
      return { accepted: false, code: 'rate_limited', message: `That is a lot of quick chats: at most ${DESK_PER_MIN} a minute. Wait a moment and try again.` };
    }
    const cues = sniffOwnerText(req.text, exprLexicon());
    const phatic = isPhatic(cues);
    const limit = dailyLimit(this.env, 'chat');
    if (!phatic && !this.usage.take('chat', limit, runtime.now()).allowed) return { accepted: false, code: 'rate_limited', message: limitMessage('chat', limit) };

    const agentId = coworkerAgentId(persona.id);
    const turnId = ids.turn();
    const messageId = ids.message();
    const accepted: DeskSayAccepted = { accepted: true, opId: req.opId, agentId, turnId, messageId };
    const now = runtime.now();
    const via = req.via === 'voice' ? 'voice' : 'text';
    const previous = this.deskTurns.get(agentId);
    if (previous) {
      previous.controller.abort();
      closeDeskTurn(this.feed, previous.state, 'cancelled');
    }
    const owner = this.ledger.tx(() => {
      const f = this.ledger.append({ type: 'talk.owner', data: { turnId, messageId, text: req.text, via, agentId, surface: 'floor' }, opId: req.opId, actor: OWNER_ACTOR });
      this.ctx.storage.sql.exec('INSERT INTO ops (op_id, result, at) VALUES (?, ?, ?)', req.opId, JSON.stringify(accepted), now);
      this.ctx.storage.sql.exec(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, `active_desk:${agentId}`, JSON.stringify({ turnId, opId: req.opId, agentId }));
      return f;
    });
    this.feed.broadcast(owner);
    this.scheduleRollup();

    const controller = new AbortController();
    const state = newDeskTurnState(turnId, req.opId, agentId);
    const cause: ExprCause = { streamId: this.ledger.streamId, seq: owner.seq! };
    const done = (async () => {
      if (previous) await previous.done;
      if (phatic) {
        if (await this.phaticTurn({ agentId, turnId, via, cues, ownerSeq: owner.seq!, state, source: 'desk' })) return;
        if (!this.usage.take('chat', limit, runtime.now()).allowed) {
          this.feed.emit({ type: 'error', data: { code: 'rate_limited', message: limitMessage('chat', limit), turnId, opId: req.opId } });
          closeDeskTurn(this.feed, state, 'error');
          this.feed.claim(agentId, 'desk', null);
          return;
        }
      }
      await runDeskTurn(this.deskHost(), { persona, ownerSeq: owner.seq!, signal: controller.signal }, state);
    })()
      .catch((err) => logError('desk', err))
      .finally(() => {
        if (this.deskTurns.get(agentId)?.turnId === turnId) {
          this.deskTurns.delete(agentId);
          this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', `active_desk:${agentId}`);
        }
        this.scheduleRollup();
        this.expr.ownerMood(agentId, cues, cause).catch((err) => logError('expr.mood', err));
      });
    this.deskTurns.set(agentId, { turnId, controller, state, done });
    this.ctx.waitUntil(done);
    return accepted;
  }

  // ── office rooms and joined huddles (Office Phase 2, src/rooms) ─────────────────────

  /**
   * The owner talks to a conference room or a joined huddle (202 path, no model call before it): floor control plans
   * who answers, the owner's line is persisted with `surface: 'room'`, and the responders answer one after the other
   * in the background. At most one room turn runs per workspace: a newer message (any room) closes the running one
   * first, its partial reply persisted. Idempotent on opId.
   */
  async roomSay(roomId: RoomId, req: RoomSayRequest): Promise<RoomSayAccepted | RoomRefusal> {
    if (isClientId(req.clientId)) this.voice.claim(req.clientId, 'room');
    const prior = this.ctx.storage.sql.exec<{ result: string }>('SELECT result FROM ops WHERE op_id = ?', req.opId).toArray()[0];
    if (prior) return { ...(JSON.parse(prior.result) as RoomSayAccepted), duplicate: true };
    const settings = await this.getSettings();
    const kind = roomKindOf(roomId);
    const members: RoomMember[] = [];
    for (const id of req.participants) {
      const m = roomMember(id, settings);
      if (!m) return { accepted: false, code: 'bad_request', message: id === CHIEF_ID ? 'Choose a Chief of Staff first.' : `There is no coworker called ${id}.` };
      members.push(m);
    }
    if (this.expr.rateUsed('room') >= ROOM_TURNS_PER_MIN) return { accepted: false, code: 'rate_limited', message: ROOM_RATE_MESSAGE };
    const cues = sniffOwnerText(req.text, exprLexicon());
    const phatic = isPhatic(cues);
    const now = runtime.now();
    if (!phatic) {
      // A model reply must be possible: one left today, and a chat provider (the replies take theirs as they go).
      const limit = dailyLimit(this.env, 'chat');
      if (!this.usage.take('chat', limit, now).allowed) return { accepted: false, code: 'rate_limited', message: limitMessage('chat', limit) };
      this.usage.refund('chat', now);
      try {
        runtime.registry(this.env).resolve('chat', { tier: 'fast' });
      } catch (err) {
        if (err instanceof MissingProviderError) return { accepted: false, code: 'not_configured', message: ROOM_NO_PROVIDER_MESSAGE, missingKeys: err.missingKeys };
        throw err;
      }
    }
    const stats = meetingStats(this.ledger.recent(['talk.owner', 'talk.message'], ROOM_LEDGER_WINDOW), req.meetingId);
    const candidates: FloorCandidate[] = members.map((m, seat) => ({
      agentId: m.agentId,
      firstName: m.firstName,
      fullName: m.fullName,
      isChief: m.isChief,
      seat,
      title: m.title,
      departmentName: m.persona ? (fullIndex.department(m.persona.department)?.name ?? m.persona.department) : 'Chief of Staff',
      skillNames: m.persona ? [...m.persona.skills.primary, ...m.persona.skills.secondary].map(skillName) : [],
      oneLiner: m.persona?.one_liner ?? '',
    }));
    const plan = planFloor({ text: req.text, kind, candidates, phatic, lastFirst: stats.lastFirst, turnsBy: stats.turnsBy });

    // Barge-in: the running room turn (any room) is closed before the new owner line, so turns stay contiguous.
    const previous = this.roomDone;
    if (this.room && !this.room.closed) cancelRoomTurn(this.feed, this.room, 'owner');
    const gen = this.nextRoomGen();
    const turnId = ids.turn();
    const messageId = ids.message();
    const order = plan.order as AgentId[];
    const accepted: RoomSayAccepted = { accepted: true, opId: req.opId, roomId, meetingId: req.meetingId, turnId, messageId, order, mode: plan.mode, gen };
    const via = req.via === 'voice' ? 'voice' : 'text';
    const owner = this.ledger.tx(() => {
      const f = this.ledger.append({ type: 'talk.owner', data: { turnId, messageId, text: req.text, via, surface: 'room', roomId, meetingId: req.meetingId }, opId: req.opId, actor: OWNER_ACTOR });
      this.ctx.storage.sql.exec('INSERT INTO ops (op_id, result, at) VALUES (?, ?, ?)', req.opId, JSON.stringify(accepted), now);
      this.ctx.storage.sql.exec(
        `INSERT INTO meta (key, value) VALUES ('active_room', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        JSON.stringify({ turnId, opId: req.opId, roomId, meetingId: req.meetingId, agentId: null }),
      );
      return f;
    });
    this.feed.broadcast(owner);
    this.scheduleRollup();
    this.ctx.storage.sql.exec('DELETE FROM ops WHERE at < ?', now - OP_TTL_MS);

    const turn = newRoomTurn({
      roomId,
      meetingId: req.meetingId,
      turnId,
      opId: req.opId,
      gen,
      mode: plan.mode,
      order,
      chiefWrap: plan.chiefWrap,
      participants: [...req.participants],
      label: req.label ?? null,
      via,
      cues,
      ownerSeq: owner.seq!,
    });
    this.room = turn;
    const done = (async () => {
      if (previous) await previous; // the cut turn winds down (its model call aborts) first
      await runRoomTurn(this.roomHost(), turn);
    })()
      .catch((err) => logError('room', err))
      .finally(() => {
        if (this.room === turn) {
          this.room = null;
          this.ctx.storage.sql.exec(`DELETE FROM meta WHERE key = 'active_room'`);
        }
        this.scheduleRollup();
      });
    this.roomDone = done;
    this.ctx.waitUntil(done);
    return accepted;
  }

  /**
   * Barge-in or leave (Office Phase 2 §4.2.1, §4.2.7): close the running turn of this meeting now (reason 'owner', or
   * 'left' with `leave`). On leave, one quiet note lands in Talk when the owner said anything in the meeting (once
   * per meeting). Idempotent on opId; cancelling nothing is `{cancelled: false, noteId: null}`.
   */
  async roomCancel(roomId: RoomId, req: RoomCancelRequest): Promise<RoomCancelResponse> {
    if (isClientId(req.clientId)) this.voice.claim(req.clientId, 'room');
    const prior = this.ctx.storage.sql.exec<{ result: string }>('SELECT result FROM ops WHERE op_id = ?', req.opId).toArray()[0];
    if (prior) return JSON.parse(prior.result) as RoomCancelResponse;
    const t = this.room;
    const cancelled = !!t && !t.closed && t.roomId === roomId && t.meetingId === req.meetingId && cancelRoomTurn(this.feed, t, req.leave ? 'left' : 'owner');
    const noteId = req.leave ? await this.postMeetingNote(roomId, req) : null;
    const result: RoomCancelResponse = { cancelled, noteId };
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO ops (op_id, result, at) VALUES (?, ?, ?)', req.opId, JSON.stringify(result), runtime.now());
    if (noteId) this.scheduleRollup();
    return result;
  }

  /** The meeting's one note in Talk ("Skyline room with Juno, Walt and Lena · 4 min"), or null when the owner said nothing. */
  private async postMeetingNote(roomId: RoomId, req: RoomCancelRequest): Promise<MessageId | null> {
    const frames = this.ledger.recent(['talk.owner', 'talk.message'], ROOM_LEDGER_WINDOW);
    const stats = meetingStats(frames, req.meetingId);
    if (!stats.ownerSpoke) return null;
    const existing = existingNote(frames, req.meetingId);
    if (existing) return existing.data.messageId;
    const settings = await this.getSettings();
    const names: string[] = [];
    for (const id of [...stats.speakers, ...(req.participants ?? [])]) {
      const m = roomMember(id, settings);
      if (m && !names.includes(m.firstName)) names.push(m.firstName);
    }
    const messageId = ids.message();
    const text = meetingNoteText(roomId, req.label ?? null, names, stats.firstAt, stats.lastAt);
    this.feed.append({ type: 'talk.message', data: { turnId: null, messageId, agentId: CHIEF_ID, text, kind: 'note', roomId, meetingId: req.meetingId }, actor: CHIEF_ID, opId: req.opId });
    return messageId;
  }

  /** The room turn generation (persisted, so it keeps rising across restarts). */
  private nextRoomGen(): number {
    const row = this.ctx.storage.sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'room_gen'`).toArray()[0];
    const gen = (Number(row?.value) || 0) + 1;
    this.ctx.storage.sql.exec(`INSERT INTO meta (key, value) VALUES ('room_gen', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, String(gen));
    return gen;
  }

  // ── living workforce RPC (routes in src/expr) ─────────────────────────────────────

  /** Record rendered clips in the agents' manifests (render route, pre-voice runner). */
  async exprRecordClips(rows: ManifestRow[]): Promise<number> {
    return this.expr.recordClips(rows);
  }

  /** Count one use of a per-minute limit (EXPR_RENDER_PER_MIN, quick-chat); false when used up. */
  async exprTakeRate(kind: 'render' | 'desk', limit: number): Promise<boolean> {
    return this.expr.takeRate(kind, limit);
  }

  /** An agent's manifest, mood and attention (GET /api/expr/agents/:id). */
  async exprAgentState(agentId: string, voiceKey: string, catalogVersion: string, provider: ExprTtsProvider): Promise<ExprAgentState> {
    return this.expr.agentState(agentId, voiceKey, catalogVersion, provider);
  }

  /** Persisted frames after `since` (debugging, tests, and a future `GET /api/streams/:id?since`). */
  async frames(since = 0, limit = 500): Promise<Frame[]> {
    return this.ledger.since(since, limit);
  }

  // ── mirror from ProjectDO ─────────────────────────────────────────────────────────

  /**
   * Mirror a project's persisted frames into the owner feed. Each source (stream, seq) lands once, in
   * order, with a new seq and `cause = {source, seq}`. Finished and failed jobs get a proactive
   * announcement from the Chief of Staff: in the lead's voice from the fast model when a cloud model is
   * configured (posted within 2.5 s, else the template), otherwise the template at once. The presence
   * claim updates the merged face state.
   */
  async ingest(batch: MirrorBatch): Promise<{ applied: number }> {
    // Proactive speech follows: make sure the voice is with a tab that is still here.
    this.voice.refresh();
    let applied = 0;
    let lastSeq: number | null = null;
    let announcer: Announcer | null | undefined;
    const voicing: { causeSeq: number; plan: AnnouncementPlan; announcer: Announcer }[] = [];
    for (const f of batch.frames) {
      if (typeof f.seq !== 'number' || !isPersisted(f.type)) continue;
      // The mirrored frame, its dedupe row and the announcement it causes (or the pending row that guarantees it)
      // commit together: a retry after a crash is deduplicated, so an announcement written later could be lost.
      const written = this.ledger.tx(() => {
        const seen = this.ctx.storage.sql.exec('SELECT seq FROM mirrored WHERE src_stream = ? AND src_seq = ?', batch.source, f.seq).toArray()[0];
        if (seen) return null;
        const m = this.ledger.append(
          { type: f.type, data: f.data, ...(f.actor ? { actor: f.actor } : {}), ...(f.opId ? { opId: f.opId } : {}), cause: { streamId: batch.source, seq: f.seq! } } as Parameters<Ledger['append']>[0],
          { ts: f.ts },
        );
        this.ctx.storage.sql.exec('INSERT INTO mirrored (src_stream, src_seq, seq) VALUES (?, ?, ?)', batch.source, f.seq, m.seq);
        if (f.type === 'job.started') this.ctx.storage.sql.exec('INSERT OR REPLACE INTO jobs_seen (job_id, title) VALUES (?, ?)', f.data.job.jobId, f.data.job.title);
        const plan = this.announcementPlan(m as Frame);
        if (!plan) return { mirrored: m, announcement: null };
        if (announcer === undefined) announcer = this.announcer();
        if (!announcer) return { mirrored: m, announcement: this.ledger.append(plan.frame) };
        this.ctx.storage.sql.exec('INSERT INTO pending_announcements (cause_seq, facts, frame, at) VALUES (?, ?, ?, ?)', m.seq, JSON.stringify(plan.facts), JSON.stringify(plan.frame), runtime.now());
        voicing.push({ causeSeq: m.seq!, plan, announcer });
        return { mirrored: m, announcement: null };
      });
      if (!written) continue;
      applied++;
      this.feed.broadcast(written.mirrored);
      lastSeq = written.mirrored.seq!;
      // Mood, attention and event reflexes; a celebration leads into the announcement broadcast next (or, when the
      // fast model is still writing it, into that announcement when it is posted).
      try {
        const announcementPending = !written.announcement && voicing.some((v) => v.causeSeq === written.mirrored.seq);
        await this.expr.onMirrored(written.mirrored as Frame, { announcementPending });
      } catch (err) {
        logError('expr.mirror', err);
      }
      if (written.announcement) {
        this.feed.broadcast(written.announcement);
        lastSeq = written.announcement.seq!;
      }
    }
    if (batch.presence) {
      const claim = batch.presence.claim;
      this.feed.claim(batch.presence.agentId, batch.source, claim ? { ...claim, causeSeq: lastSeq ?? claim.causeSeq } : null);
    }
    if (batch.signals?.length) {
      try {
        await this.expr.onSignals(batch.signals);
      } catch (err) {
        logError('expr.signals', err);
      }
    }
    if (applied) this.scheduleRollup();
    // The mirror never waits for the voice: the model writes in the background and the line is posted when ready.
    for (const v of voicing) this.ctx.waitUntil(this.voiceAnnouncement(v.causeSeq, v.plan, v.announcer));
    return { applied };
  }

  /**
   * What the Chief of Staff tells the owner when a job ends (talk.message kind 'announcement'): finished, failed,
   * or stopped from the UI (a stop the Chief of Staff made on the owner's word was already said in the turn).
   * The frame carries the templated text; the facts are all a voiced line may use.
   */
  private announcementPlan(frame: Frame): AnnouncementPlan | null {
    let facts: AnnouncementFacts;
    let jobId: JobId;
    if (frame.type === 'job.done') {
      jobId = frame.data.jobId;
      facts = { kind: 'done', title: this.jobTitle(jobId), summary: frame.data.summary };
    } else if (frame.type === 'job.failed') {
      jobId = frame.data.jobId;
      facts = { kind: 'failed', title: this.jobTitle(jobId), reason: frame.data.message };
    } else if (frame.type === 'job.cancelled' && frame.data.by === 'owner') {
      jobId = frame.data.jobId;
      facts = { kind: 'stopped', title: this.jobTitle(jobId) };
    } else return null;
    return {
      facts,
      frame: {
        type: 'talk.message',
        data: { turnId: null, messageId: ids.message(), agentId: CHIEF_ID, text: templateAnnouncement(facts), kind: 'announcement', jobId },
        actor: CHIEF_ID,
        cause: { streamId: frame.streamId as StreamId, seq: frame.seq! },
      },
    };
  }

  /** The fast cloud model for voiced announcements, or null (local, Mock or none: the template is used). */
  private announcer(): Announcer | null {
    try {
      const r = runtime.registry(this.env).tryResolve('chat', { tier: 'fast' });
      return r && r.provider.kind === 'cloud' ? { provider: r.provider, model: r.model } : null;
    } catch (err) {
      logError('workspace.announce', err);
      return null;
    }
  }

  /** Phrase a pending announcement in the chosen lead's voice (≤ 2.5 s, else the template) and post it once. */
  private async voiceAnnouncement(causeSeq: number, plan: AnnouncementPlan, announcer: Announcer): Promise<void> {
    let text = plan.frame.data.text;
    try {
      const settings = await this.getSettings();
      const lead = settings.leadId ? fullIndex.lead(settings.leadId) : undefined;
      const r = await composeAnnouncement({ provider: announcer.provider, model: announcer.model, lead, chiefName: settings.chiefName, facts: plan.facts });
      text = r.text;
      if (r.source === 'template') logWarn('workspace.announce', `used the template (${r.fallback}) after ${r.ms} ms`);
    } catch (err) {
      logError('workspace.announce', err);
    }
    // The celebration held for this announcement leads into it now: its speech renders while the lead-in plays.
    if (plan.facts.kind === 'done' && plan.frame.data.jobId) await this.expr.celebratePending(plan.frame.data.jobId).catch((err) => logError('expr.celebrate', err));
    this.postAnnouncement(causeSeq, { ...plan.frame, data: { ...plan.frame.data, text } });
  }

  /** Post a pending announcement exactly once (the pending row is the guard). */
  private postAnnouncement(causeSeq: number, frame: FrameInput<'talk.message'>): void {
    const posted = this.ledger.tx(() => {
      const pending = this.ctx.storage.sql.exec('DELETE FROM pending_announcements WHERE cause_seq = ?', causeSeq);
      return pending.rowsWritten > 0 ? this.ledger.append(frame) : null;
    });
    if (!posted) return;
    this.feed.broadcast(posted);
    this.scheduleRollup();
  }

  /** Announcements whose voice was still being written when the object last stopped: post their template now. */
  private postStrandedAnnouncements(): void {
    const rows = this.ctx.storage.sql.exec<{ cause_seq: number; frame: string }>('SELECT cause_seq, frame FROM pending_announcements ORDER BY cause_seq').toArray();
    for (const r of rows) {
      try {
        this.postAnnouncement(Number(r.cause_seq), JSON.parse(r.frame) as FrameInput<'talk.message'>);
      } catch (err) {
        logError('workspace.announce', err);
        this.ctx.storage.sql.exec('DELETE FROM pending_announcements WHERE cause_seq = ?', r.cause_seq);
      }
    }
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
      // The current turn, or one that finished writing after a newer turn that is already over (it may clear Thinking).
      isCurrent: (turnId: TurnId) => this.turn?.turnId === turnId || !this.turn || this.turn.settled,
      now: () => runtime.now(),
      reflexes: {
        started: (turnId: TurnId, via: 'voice' | 'text', cues?: AffectCues) => this.expr.turnStarted(turnId, via, CHIEF_ID, cues),
        spoke: (turnId: TurnId) => this.expr.spokeFor(turnId),
        firstText: (turnId: TurnId) => this.expr.firstText(turnId),
        delegated: (turnId: TurnId) => this.expr.delegated(turnId),
        ended: (turnId: TurnId) => this.expr.turnEnded(turnId),
      },
    };
  }

  private deskHost(): DeskHost {
    return {
      feed: this.feed,
      ledger: this.ledger,
      registry: () => runtime.registry(this.env),
      settings: () => this.getSettings(),
      isCurrent: (agentId, turnId) => this.deskTurns.get(agentId)?.turnId === turnId,
    };
  }

  private roomHost(): RoomHost {
    const limit = dailyLimit(this.env, 'chat');
    return {
      feed: this.feed,
      ledger: this.ledger,
      streamId: this.ledger.streamId,
      registry: () => runtime.registry(this.env),
      settings: () => this.getSettings(),
      isCurrent: (gen) => this.room?.gen === gen,
      takeRate: () => this.expr.takeRate('room', ROOM_TURNS_PER_MIN),
      takeChat: () => (this.usage.take('chat', limit, runtime.now()).allowed ? { allowed: true } : { allowed: false, message: limitMessage('chat', limit) }),
      phatic: async (agentId, turnId, via, cues) => {
        const r = await this.expr.phaticReply({ agentId, turnId, via, cues, history: { firstMeeting: false } });
        // The room plays its lines in order through each speaker's voice: the reflex frame is not sent.
        return r ? { text: r.text, intent: r.intent, lineId: r.lineId } : null;
      },
      thinking: (agentId) => this.expr.emitFace(agentId, { gesture: 'look_up', holdMs: 900 }),
      ownerMood: (agentId, cues, cause) => void this.expr.ownerMood(agentId, cues, cause).catch((err) => logError('expr.mood', err)),
      markCurrent: (t) =>
        this.ctx.storage.sql.exec(
          `INSERT INTO meta (key, value) VALUES ('active_room', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          JSON.stringify({ turnId: t.turnId, opId: t.opId, roomId: t.roomId, meetingId: t.meetingId, agentId: t.current?.agentId ?? null }),
        ),
    };
  }

  /**
   * A room turn in flight when the object stopped: close the reply being written (`talk.done {finish: 'error'}`) and
   * clear stale `room` Thinking claims.
   */
  private recoverRoomTurns(): void {
    const now = runtime.now();
    const stale = this.ctx.storage.sql.exec<{ agent_id: string }>(`SELECT DISTINCT agent_id FROM presence_claims WHERE source = 'room'`).toArray();
    for (const r of stale) this.presence.claim(r.agent_id as AgentId, 'room', null, now);
    const row = this.ctx.storage.sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'active_room'`).toArray()[0];
    if (!row) return;
    try {
      const { turnId, opId, roomId, meetingId, agentId } = JSON.parse(row.value) as { turnId: TurnId; opId?: string; roomId: RoomId; meetingId: string; agentId: AgentId | null };
      this.ledger.append({
        type: 'talk.done',
        data: { turnId, messageId: null, finish: 'error', ...(agentId ? { agentId } : {}), surface: 'room', roomId, meetingId },
        actor: agentId ?? CHIEF_ID,
        ...(opId ? { opId } : {}),
      });
    } catch (err) {
      logError('room.recover', err);
    }
    this.ctx.storage.sql.exec(`DELETE FROM meta WHERE key = 'active_room'`);
  }

  /**
   * A turn that was running when the object last died never finished: close it so the thread is consistent.
   * A fresh object runs no turn, so any 'talk' presence claim (Thinking) is stale too and is cleared, even
   * without an active_turn row: the face is the status UI and must not stay on Thinking.
   */
  private recoverInterruptedTurn(): void {
    this.presence.claim(CHIEF_ID, 'talk', null, runtime.now());
    this.recoverDeskTurns();
    this.recoverRoomTurns();
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

  /** Quick-chats in flight when the object stopped: close them, and clear stale `desk` Thinking claims. */
  private recoverDeskTurns(): void {
    const now = runtime.now();
    const stale = this.ctx.storage.sql.exec<{ agent_id: string }>(`SELECT DISTINCT agent_id FROM presence_claims WHERE source = 'desk'`).toArray();
    for (const r of stale) this.presence.claim(r.agent_id as AgentId, 'desk', null, now);
    const rows = this.ctx.storage.sql.exec<{ key: string; value: string }>(`SELECT key, value FROM meta WHERE key LIKE 'active_desk:%'`).toArray();
    for (const r of rows) {
      try {
        const { turnId, opId, agentId } = JSON.parse(r.value) as { turnId: TurnId; opId?: string; agentId: AgentId };
        this.ledger.append({ type: 'talk.done', data: { turnId, messageId: null, finish: 'error', agentId, surface: 'floor' }, actor: agentId, ...(opId ? { opId } : {}) });
      } catch (err) {
        logError('desk.recover', err);
      }
    }
    if (rows.length) this.ctx.storage.sql.exec(`DELETE FROM meta WHERE key LIKE 'active_desk:%'`);
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
