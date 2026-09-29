// The living-workforce host inside the WorkspaceDO (docs/dev/INC05-PLAN.md §4 A5–A9): the single writer of viewer
// state, the workspace recency memory, clip manifests, mood and attention, and the planner of the reflexes only the
// server can know about (phatic replies, the thinking-filler safety net, acknowledgements, progress lines, the
// celebration before an announcement, `oops` on a retried step, face cues). Everything it emits is ephemeral.
// Honesty: slots come from state or the cause event only (grounded or silent), the owner has no name here, and
// event lines reach a viewer only at the Chief's stage.
import {
  applyMoodEvent,
  attentionChangedData,
  createChatterBudget,
  createMoodState,
  createRecencyMemory,
  createTimingGate,
  expressionBias,
  humourOnly,
  lineOf,
  mergeAttention,
  moodAt,
  moodChanged,
  moodChangedData,
  ownerDayKey,
  planServerReflex,
  recordUtterance,
  reflexFaceData,
  reflexSayData,
  selectLine,
  type AffectCues,
  type AttentionThread,
  type AttentionView,
  type ChatterBudget,
  type ClipManifest,
  type FaceCue,
  type GroundingState,
  type IntentId,
  type Mood,
  type MoodEventKind,
  type MoodState,
  type RecencyMemory,
  type RecencySnapshot,
  type RecentEntry,
  type ReflexSayData,
  type TimingGate,
  type ViewerState,
} from '@headcount/expressions';
import { chiefDisplayName } from '@headcount/catalog';
import { fullIndex } from '@headcount/catalog/full';
import type { Registry } from '@headcount/models';
import {
  CHIEF_ID,
  EVERYDAY_PROJECT_ID,
  projectStream,
  type AgentId,
  type Frame,
  type FrameInput,
  type JobId,
  type PresenceState,
  type StreamId,
  type WorkspaceSettings,
} from '@headcount/protocol';
import {
  ambienceOf,
  type Ambience,
  type ExprCause,
  type ExprRecentOp,
  type ExprTtsProvider,
  type MoodChangedData,
  type AttentionChangedData,
  type ViewerOp,
} from '@headcount/protocol/ext/expressions';
import type { Feed } from '../workspace/feed';
import { logError } from '../workspace/runtime';
import { EXPR_CATALOG_VERSION, exprCatalog, exprCatalogReady, exprProviderFor, exprVoiceKey, indexFor, profileFor } from './catalog';
import type { ClipScope } from './clips';
import { exprTiming } from './config';
import { atStage, ownerClock, viewerStateOf, type SocketAttachment } from './viewer';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS expr_manifest (
     agent_id TEXT NOT NULL, voice_key TEXT NOT NULL, catalog_version TEXT NOT NULL, line_key TEXT NOT NULL,
     clip_key TEXT NOT NULL, duration_ms INTEGER NOT NULL, scope TEXT NOT NULL, tier TEXT NOT NULL, at INTEGER NOT NULL,
     PRIMARY KEY (agent_id, voice_key, catalog_version, line_key))`,
  `CREATE TABLE IF NOT EXISTS expr_mood (agent_id TEXT PRIMARY KEY, state TEXT NOT NULL, emitted_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS expr_recent (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS expr_rate (minute TEXT PRIMARY KEY, count INTEGER NOT NULL)`,
  // The Chief's running jobs as mirrored from the Everyday project: attention threads and grounding for progress lines.
  `CREATE TABLE IF NOT EXISTS expr_work (job_id TEXT PRIMARY KEY, title TEXT NOT NULL, label TEXT NOT NULL, step INTEGER NOT NULL, total INTEGER, since INTEGER NOT NULL, updated INTEGER NOT NULL)`,
];

/** One clip → line mapping in an agent's manifest. */
export interface ManifestRow {
  agentId: string;
  voiceKey: string;
  catalogVersion: string;
  /** `${lineId}|${fillKey}` */
  lineKey: string;
  clipKey: string;
  durationMs: number;
  scope: ClipScope;
  tier: 'p0' | 'p1' | 'p2' | 'runtime';
}

/** What GET /api/expr/agents/:id needs from the WorkspaceDO. */
export interface ExprAgentState {
  clips: ClipManifest['clips'];
  mood: MoodChangedData | null;
  attention: AttentionChangedData | null;
}

/** A phatic owner turn answered from the catalog (no model call). */
export interface PhaticReply {
  text: string;
  intent: 'gratitude_reply' | 'greeting' | 'sign_off';
  lineId: string;
  frame: ReflexSayData;
}

export interface ExprHostDeps {
  sql: SqlStorage;
  feed: Feed;
  streamId: StreamId;
  workspaceId: string;
  presence(agentId: AgentId): PresenceState;
  sockets(): WebSocket[];
  settings(): Promise<WorkspaceSettings>;
  registry(): Registry;
  mockMedia(): boolean;
  now(): number;
  /** A job's title as the owner feed knows it (jobs_seen), for the celebration's `{artifact}`. */
  jobTitle(jobId: string): string | null;
}

interface AgentCtx {
  agentId: string;
  settings: WorkspaceSettings;
  index: ReturnType<typeof indexFor>;
  firstName: string;
  provider: ExprTtsProvider;
  voiceKey: string;
  manifest: ClipManifest;
}

interface TurnInfo {
  agentId: string;
  via: 'voice' | 'text';
  text: boolean;
  filler: ReturnType<typeof setTimeout> | null;
  /** The owner's words as the sniffer read them (grounding for the filler and the acknowledgement, E4). */
  cues?: AffectCues;
}

/** The owner shared distress this recently: upbeat lines are out (`after_distress`, §1.4.4). */
const DISTRESS_LOCK_MS = 30 * 60_000;
/** Client recency ops that arrived before this isolate compiled the catalog: applied right after (≤ 4 kept). */
const PENDING_RECENT_MAX = 4;

type WorkRow = { job_id: string; title: string; label: string; step: number; total: number | null; since: number; updated: number };

/** Selection failures: no line fits (the gate did not refuse). */
const NO_LINE = new Set(['disabled', 'no_candidates', 'ungrounded', 'context', 'never_says', 'not_instant', 'too_long', 'exhausted']);

/** The phatic reply for the owner's cues: goodbye beats thanks beats hello when several are strong. */
export function phaticIntent(c: Pick<AffectCues, 'farewell' | 'gratitude' | 'praise' | 'greeting'>): PhaticReply['intent'] {
  const ranked: [PhaticReply['intent'], number][] = [
    ['sign_off', c.farewell],
    ['gratitude_reply', Math.max(c.gratitude, c.praise)],
    ['greeting', c.greeting],
  ];
  let best = ranked[0]!;
  for (const r of ranked) if (r[1] > best[1]) best = r;
  return best[0];
}

/** Owner text → the mood events it means for the addressee (A7). */
export function ownerMoodEvents(c: AffectCues): MoodEventKind[] {
  if (c.distress) return ['owner.distress'];
  const out: MoodEventKind[] = [];
  if (c.gratitude >= 0.6) out.push('owner.thanks');
  if (c.praise >= 0.6) out.push('owner.praise');
  if (c.frustration >= 0.5) out.push('owner.frustrated');
  return out;
}

/** The turn a tool-made steer belongs to: its opId is `${turnId}:${callId}`. */
export function turnOfOpId(opId: string | undefined): string | null {
  return /^(turn_[a-z0-9]+):/.exec(opId ?? '')?.[1] ?? null;
}

/** A job title as a mid-sentence `{artifact}`: plain text, no quotes or closing punctuation, lower first word. */
export function artifactOf(title: string | null | undefined): string | undefined {
  let s = String(title ?? '').replace(/[“”"‘’`]/g, '').replace(/\s+/g, ' ').trim().replace(/[.!?:;,]+$/, '');
  if (!s) return undefined;
  if (/^[A-Z][a-z'’-]+(\s|$)/.test(s)) s = s[0]!.toLowerCase() + s.slice(1);
  return s;
}

function timer(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const t = setTimeout(fn, Math.max(0, ms));
  (t as unknown as { unref?: () => void }).unref?.();
  return t;
}

export class ExprHost {
  private readonly recency: RecencyMemory;
  private gateState: { gate: TimingGate; budget: ChatterBudget } | null = null;
  private recencyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly turns = new Map<string, TurnInfo>();
  private readonly fired = new Set<string>();
  private readonly pendingMicro = new Map<string, { at: number; cause: ExprCause | undefined; steer: boolean }>();
  private microTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMicroAt = Number.NEGATIVE_INFINITY;
  private readonly moodTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private attentionKey: string | null = null;
  private lastViewer: ViewerOp | null = null;
  private wins: { lastWinAt: number | null; day: string; count: number } = { lastWinAt: null, day: '', count: 0 };
  private distressAt = Number.NEGATIVE_INFINITY;
  private ratePrunedAt = 0;
  private pendingRecent: ExprRecentOp[] = [];
  private warming = false;
  /** Job-done celebrations held for the announcement the fast model is still writing (played right before it). */
  private readonly pendingCelebrations = new Map<string, { title: string | null; cause: ExprCause | undefined; at: number }>();

  constructor(private readonly d: ExprHostDeps) {
    for (const stmt of SCHEMA) d.sql.exec(stmt);
    const saved = this.loadRecency();
    this.recency = createRecencyMemory(saved ? { snapshot: saved } : undefined);
  }

  // ── viewers (socket op `viewer`, stored in the socket attachment: survives hibernation) ──────────────────

  /** Store a validated viewer op on its socket and react to what changed (attention, catalog warm-up). */
  setViewer(ws: WebSocket, op: ViewerOp): void {
    try {
      ws.serializeAttachment({ viewer: op, at: this.d.now() } satisfies SocketAttachment);
    } catch (err) {
      logError('expr.viewer', err);
    }
    this.lastViewer = op;
    this.emitAttentionIfChanged();
    // A viewer exists: compile now (once per isolate), so later picks never pay for it on an event path.
    this.warmCatalog();
  }

  /** Compile the catalog off the socket message path (once per isolate), then apply recency ops that waited for it. */
  private warmCatalog(): void {
    if (exprCatalogReady() || this.warming) return;
    this.warming = true;
    timer(() => {
      this.warming = false;
      try {
        exprCatalog();
      } catch (err) {
        logError('expr.catalog', err);
        return;
      }
      const pending = this.pendingRecent.splice(0);
      for (const op of pending) this.mergeRecent(op).catch((err) => logError('expr.recent', err));
    }, 0);
  }

  /** Every socket's viewer, newest first. */
  viewers(): ViewerOp[] {
    const out: { v: ViewerOp; at: number }[] = [];
    for (const ws of this.d.sockets()) {
      try {
        const a = (ws as unknown as { deserializeAttachment?: () => unknown }).deserializeAttachment?.() as SocketAttachment | null | undefined;
        if (a?.viewer) out.push({ v: a.viewer, at: a.at ?? 0 });
      } catch {
        /* a closing socket */
      }
    }
    return out.sort((a, b) => b.at - a.at).map((x) => x.v);
  }

  /** A visible viewer at agent X's stage (Talk for the Chief, X's desk otherwise); one with audio armed and voice on first. */
  stageViewer(agentId: string): ViewerOp | null {
    const at = this.viewers().filter((v) => atStage(v, agentId));
    return at.find((v) => v.audioArmed && v.voiceOn) ?? at[0] ?? null;
  }

  private latestViewer(): ViewerOp | null {
    return this.lastViewer ?? this.viewers()[0] ?? null;
  }

  /** Owner-local time: the latest viewer's time zone (UTC when nobody has said). */
  private clock() {
    return ownerClock(this.d.now(), this.latestViewer()?.tzOffsetMin ?? 0);
  }

  private quietHours(): boolean {
    return this.latestViewer()?.quietHours ?? false;
  }

  /** The view an owner-turn reflex answers: the agent's stage viewer, else the latest viewer, else a default. */
  private ownerViewer(agentId: string, settings: WorkspaceSettings): ViewerState {
    const stage = this.stageViewer(agentId);
    if (stage) return viewerStateOf(stage);
    const latest = this.latestViewer();
    if (latest) return viewerStateOf(latest);
    // Nobody has said where they are yet: assume the stage; the tab that sent the turn decides what it plays.
    return { surface: agentId === CHIEF_ID ? 'talk' : 'floor', stageAgentId: agentId === CHIEF_ID ? agentId : null, floorVisible: agentId !== CHIEF_ID, visibleProjectIds: [], listeningProjectIds: [], audioArmed: true, voiceOn: settings.voiceOn, pageVisible: true };
  }

  // ── recency (socket op `expr.recent`; saved at most every 5 s) ────────────────────────────────────────────

  /**
   * Merge a client's recently played lines, so server picks avoid what the owner just heard. Before this isolate has
   * compiled the catalog the op waits for the deferred compile (a socket message never blocks the object for it).
   */
  async mergeRecent(op: ExprRecentOp): Promise<number> {
    if (!exprCatalogReady()) {
      this.pendingRecent.push(op);
      if (this.pendingRecent.length > PENDING_RECENT_MAX) this.pendingRecent.splice(0, this.pendingRecent.length - PENDING_RECENT_MAX);
      this.warmCatalog();
      return 0;
    }
    const settings = await this.d.settings();
    const clock = this.clock();
    const snapshot: RecencySnapshot = { v: 1, day: clock.dayKey, agents: {}, daily: {} };
    let merged = 0;
    for (const [agentId, lineIds] of Object.entries(op.agents)) {
      const profile = profileFor(agentId, settings);
      if (!profile) continue;
      const index = indexFor(profile);
      const known = new Set(this.recency.recent(agentId).map((e) => e.lineId));
      const entries: RecentEntry[] = [];
      lineIds.forEach((id, i) => {
        const line = lineOf(index, id);
        if (!line || known.has(line.id) || entries.some((e) => e.lineId === line.id)) return;
        entries.push({ lineId: line.id, intent: line.intent, textHash: line.textHash, opener: line.opener, at: clock.epochMs - i });
      });
      if (!entries.length) continue;
      snapshot.agents[agentId] = entries;
      snapshot.daily[agentId] = Object.fromEntries(entries.map((e) => [e.lineId, 1]));
      merged += entries.length;
    }
    if (merged) {
      this.recency.merge(snapshot);
      this.markRecencyDirty();
    }
    return merged;
  }

  /** The workspace recency memory (tests, debugging). */
  recencySnapshot(): RecencySnapshot {
    return this.recency.snapshot();
  }

  private loadRecency(): RecencySnapshot | null {
    const row = this.d.sql.exec<{ snapshot: string }>('SELECT snapshot FROM expr_recent WHERE id = 1').toArray()[0];
    if (!row) return null;
    try {
      return JSON.parse(row.snapshot) as RecencySnapshot;
    } catch {
      return null;
    }
  }

  private markRecencyDirty(): void {
    if (this.recencyTimer) return;
    this.recencyTimer = timer(() => {
      this.recencyTimer = null;
      this.saveRecency();
    }, exprTiming.recencySaveMs);
  }

  saveRecency(): void {
    try {
      this.d.sql.exec('INSERT INTO expr_recent (id, snapshot) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot', JSON.stringify(this.recency.snapshot()));
    } catch (err) {
      logError('expr.recency', err);
    }
  }

  // ── clip manifests ──────────────────────────────────────────────────────────────────────────────────────

  /** Record rendered clips in the agents' manifests; rows of older catalog versions are pruned. */
  recordClips(rows: ManifestRow[]): number {
    const now = this.d.now();
    const versions = new Map<string, string>();
    for (const r of rows) {
      this.d.sql.exec(
        `INSERT INTO expr_manifest (agent_id, voice_key, catalog_version, line_key, clip_key, duration_ms, scope, tier, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id, voice_key, catalog_version, line_key) DO UPDATE SET clip_key = excluded.clip_key, duration_ms = excluded.duration_ms,
           scope = excluded.scope, tier = excluded.tier, at = excluded.at`,
        r.agentId,
        r.voiceKey,
        r.catalogVersion,
        r.lineKey,
        r.clipKey,
        Math.max(0, Math.round(r.durationMs)),
        r.scope,
        r.tier,
        now,
      );
      versions.set(r.agentId, r.catalogVersion);
    }
    for (const [agentId, version] of versions) this.d.sql.exec('DELETE FROM expr_manifest WHERE agent_id = ? AND catalog_version != ?', agentId, version);
    return rows.length;
  }

  /** An agent's rendered clips for one voice and catalog version. */
  manifest(agentId: string, voiceKey: string, catalogVersion: string, provider: ExprTtsProvider): ClipManifest {
    const clips: ClipManifest['clips'] = {};
    const rows = this.d.sql
      .exec<{ line_key: string; clip_key: string; duration_ms: number; scope: string }>(
        'SELECT line_key, clip_key, duration_ms, scope FROM expr_manifest WHERE agent_id = ? AND voice_key = ? AND catalog_version = ?',
        agentId,
        voiceKey,
        catalogVersion,
      )
      .toArray();
    for (const r of rows) clips[r.line_key] = { clipKey: r.clip_key, durationMs: Number(r.duration_ms), scope: r.scope === 'workspace' ? 'workspace' : 'shared' };
    return { agentId, catalogVersion, provider, voiceKey, clips };
  }

  // ── per-minute rates (EXPR_RENDER_PER_MIN, Floor quick-chat) ─────────────────────────────────────────────

  /** Count one use in this minute; false when `limit` is used up. Pruned hourly. */
  takeRate(kind: 'render' | 'desk', limit: number): boolean {
    const now = this.d.now();
    const minute = new Date(now).toISOString().slice(0, 16);
    const row = this.d.sql
      .exec<{ count: number }>(
        'INSERT INTO expr_rate (minute, count) VALUES (?, 1) ON CONFLICT(minute) DO UPDATE SET count = MIN(expr_rate.count + 1, ?) RETURNING count',
        `${kind}@${minute}`,
        limit + 1,
      )
      .toArray()[0];
    if (now - this.ratePrunedAt > 3_600_000) {
      this.ratePrunedAt = now;
      this.d.sql.exec(`DELETE FROM expr_rate WHERE substr(minute, instr(minute, '@') + 1) < ?`, new Date(now - 3_600_000).toISOString().slice(0, 16));
    }
    return Number(row?.count ?? limit + 1) <= limit;
  }

  // ── agents ──────────────────────────────────────────────────────────────────────────────────────────────

  private async ctxFor(agentId: string, settings?: WorkspaceSettings): Promise<AgentCtx | null> {
    const s = settings ?? (await this.d.settings());
    const profile = profileFor(agentId, s);
    if (!profile) return null;
    const index = indexFor(profile);
    const provider = exprProviderFor(this.d.registry(), profile.voice, this.d.mockMedia());
    const voiceKey = exprVoiceKey(profile.voice, provider);
    return { agentId, settings: s, index, firstName: profile.firstName, provider, voiceKey, manifest: this.manifest(agentId, voiceKey, EXPR_CATALOG_VERSION, provider) };
  }

  /** Manifest, mood and attention of one agent (GET /api/expr/agents/:id). */
  agentState(agentId: string, voiceKey: string, catalogVersion: string, provider: ExprTtsProvider): ExprAgentState {
    const state = this.loadMood(agentId);
    const mood = state ? moodChangedData(state, this.d.now(), this.d.presence(agentId as AgentId)) : null;
    return {
      clips: this.manifest(agentId, voiceKey, catalogVersion, provider).clips,
      mood,
      attention: agentId === CHIEF_ID ? attentionChangedData(this.chiefAttention()) : null,
    };
  }

  private workRows(): WorkRow[] {
    return this.d.sql.exec<WorkRow>('SELECT job_id, title, label, step, total, since, updated FROM expr_work ORDER BY updated DESC, job_id DESC').toArray();
  }

  /** Jobs the Chief has running (as mirrored). */
  runningJobs(): number {
    return Number(this.d.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM expr_work').toArray()[0]?.n ?? 0);
  }

  /** Grounding for an agent (A9): live work for the Chief, unstaffed and idle for catalog coworkers, no owner name. */
  private grounding(
    ctx: AgentCtx,
    opts: { exchange?: Partial<GroundingState['exchange']>; cues?: AffectCues; jobId?: string; artifact?: string; history?: Partial<GroundingState['history']> } = {},
  ): GroundingState {
    const clock = this.clock();
    const chief = ctx.agentId === CHIEF_ID;
    const rows = chief ? this.workRows() : [];
    const job = opts.jobId ? rows.find((r) => r.job_id === opts.jobId) : rows[0];
    const presence: PresenceState = chief ? (rows.length ? 'working' : this.chiefTurnActive() ? 'thinking' : 'idle') : 'idle';
    const work: NonNullable<GroundingState['work']> = {};
    if (job) {
      work.stepLabel = job.label;
      work.done = Number(job.step) - 1;
      work.total = job.total === null ? null : Number(job.total);
    }
    if (opts.artifact) work.artifact = opts.artifact;
    if (this.wins.day !== clock.dayKey) this.wins = { lastWinAt: this.wins.lastWinAt, day: clock.dayKey, count: 0 };
    const lead = ctx.settings.leadId ? fullIndex.lead(ctx.settings.leadId) : undefined;
    return {
      now: { epochMs: clock.epochMs, localHour: clock.localHour, weekday: clock.weekday },
      owner: { firstName: null },
      chiefName: lead ? chiefDisplayName(lead, ctx.settings.chiefName) : null,
      self: { agentId: ctx.agentId, firstName: ctx.firstName, presence, blocked: false, staffed: chief, activity: null, role: chief ? 'chief' : null },
      ...(Object.keys(work).length ? { work } : {}),
      history: {
        firstMeeting: false,
        returning: false,
        newDay: false,
        lastWinAt: chief ? this.wins.lastWinAt : null,
        lastUnblockedAt: null,
        winsToday: chief ? this.wins.count : 0,
        distressThisSession: this.d.now() - this.distressAt < DISTRESS_LOCK_MS,
        ...opts.history,
      },
      exchange: { mode: 'none', interrupted: false, steerQueued: false, ownerFarewell: false, ownerGreeting: false, ownError: false, ...opts.exchange, ...(opts.cues ? { cues: opts.cues } : {}) },
      quietHours: this.quietHours(),
    };
  }

  private gate(ambience: Ambience): TimingGate {
    if (!this.gateState) {
      const catalog = exprCatalog();
      const budget = createChatterBudget(catalog.ambience, ambience);
      this.gateState = { budget, gate: createTimingGate(catalog, budget) };
    } else if (this.gateState.budget.ambience !== ambience) this.gateState.budget.setAmbience(ambience);
    return this.gateState.gate;
  }

  private moodNow(agentId: string, baseline: Mood): Mood {
    const s = this.loadMood(agentId);
    return s ? moodAt(s, this.d.now()) : baseline;
  }

  /** Gate, ground and pick one reflex (it is committed to the gate and recency; the caller emits it). */
  private plan(
    ctx: AgentCtx,
    intent: IntentId,
    a: { state: GroundingState; viewer: ViewerState; exchange: 'voice' | 'text' | 'none'; turnId?: string; cause?: ExprCause; instantOnly?: boolean; cues?: AffectCues; audience?: ReflexSayData['audience'] },
  ) {
    const ambience = ambienceOf(ctx.settings);
    const r = planServerReflex({
      catalog: exprCatalog(),
      gate: this.gate(ambience),
      recency: this.recency,
      index: ctx.index,
      state: a.state,
      mood: this.moodNow(ctx.agentId, ctx.index.baseline),
      intent,
      ambience,
      provider: ctx.provider,
      viewer: a.viewer,
      now: this.d.now(),
      exchange: a.exchange,
      manifest: ctx.manifest,
      quietHours: this.quietHours(),
      ...(a.turnId ? { turnId: a.turnId } : {}),
      ...(a.cause ? { cause: a.cause } : {}),
      ...(a.instantOnly ? { instantOnly: true } : {}),
      ...(a.cues ? { cues: a.cues } : {}),
      ...(a.audience ? { audience: a.audience } : {}),
    });
    if (r.ok) this.markRecencyDirty();
    return r;
  }

  /** Broadcast a `reflex.say` (ephemeral). */
  emitSay(frame: ReflexSayData): void {
    this.d.feed.emit({ type: 'reflex.say', data: frame, actor: frame.agentId as AgentId, ...(frame.cause ? { cause: frame.cause } : {}) });
  }

  /** Broadcast a `reflex.face` (ephemeral). */
  emitFace(agentId: string, cue: FaceCue, cause?: ExprCause): void {
    this.d.feed.emit({ type: 'reflex.face', data: reflexFaceData(agentId, cue, cause), actor: agentId as AgentId, ...(cause ? { cause } : {}) });
  }

  // ── owner turns (phatic replies, filler safety net, acknowledgements) ────────────────────────────────────

  /**
   * Pick the whole reply to a phatic owner turn ("thanks", "bye") in the agent's own voice, seeded by the turn. A reply
   * is never suppressed by Ambience: when the gate refuses voice (a cooldown) the line still lands as text. It is the
   * turn's answer, so with voice on it is voiced like any answer, typed turns included (a typed "thanks" is not
   * answered in silence while every other typed turn is spoken).
   * Null when no grounded line fits (the host then asks the model).
   */
  async phaticReply(p: { agentId: string; turnId: string; via: 'voice' | 'text'; cues: AffectCues; history?: Partial<GroundingState['history']> }): Promise<PhaticReply | null> {
    const ctx = await this.ctxFor(p.agentId);
    if (!ctx) return null;
    const intent = phaticIntent(p.cues);
    const state = this.grounding(ctx, {
      exchange: { mode: p.via, ownerGreeting: intent === 'greeting', ownerFarewell: intent === 'sign_off' },
      cues: p.cues,
      ...(p.history ? { history: p.history } : {}),
    });
    const exchange = ctx.settings.voiceOn ? 'voice' : p.via; // the voice policy of an answer (the state keeps the real mode)
    // The tab that sent the turn plays it (and knows whether its audio is armed); the setting decides voice here.
    const viewer: ViewerState = { ...this.ownerViewer(p.agentId, ctx.settings), audioArmed: true, voiceOn: ctx.settings.voiceOn };
    const r = this.plan(ctx, intent, { state, viewer, exchange, turnId: p.turnId, cues: p.cues, audience: 'owner' });
    if (r.ok) {
      this.fired.add(`${p.agentId}|${intent}|${p.turnId}`);
      return { text: r.frame.caption, intent, lineId: r.frame.lineId, frame: r.frame };
    }
    if (NO_LINE.has(r.reason)) return null;
    // The gate refused (a second "hi" inside the greeting cooldown): the reply is still the turn's answer, so it is
    // picked here without the timing gate and voiced like any answer when voice is on.
    const ambience = ambienceOf(ctx.settings);
    const now = this.d.now();
    const voiced = ctx.settings.voiceOn;
    const res = selectLine(
      ctx.index,
      {
        intent, state, mood: this.moodNow(ctx.agentId, ctx.index.baseline), ambience, provider: ctx.provider, seed: `${p.agentId}|${intent}|${p.turnId}`, now,
        channel: voiced ? 'voice' : 'text',
        clipKeyOf: (lineId, fk) => ctx.manifest.clips[`${lineId}|${fk}`]?.clipKey,
      },
      this.recency,
    );
    if (!res.ok) return null;
    const u = res.utterance;
    recordUtterance(this.recency, ctx.index, u, now, ownerDayKey(state));
    this.markRecencyDirty();
    const def = exprCatalog().intents.get(intent)!;
    const entry = u.split ? null : ctx.manifest.clips[`${u.lineId}|${u.fillKey}`];
    const frame = reflexSayData(
      u,
      { voice: voiced, bubble: !voiced, caption: voiced ? def.channels.caption : 'none', face: r.face ?? u.face, gainDb: def.gain_db ?? 0, priority: def.priority, ttlMs: def.timing.ttl_ms, delayMs: 0 },
      { audience: 'owner', turnId: p.turnId, clip: entry ? { key: entry.clipKey, durationMs: entry.durationMs } : null },
    );
    this.fired.add(`${p.agentId}|${intent}|${p.turnId}`);
    return { text: u.caption, intent, lineId: u.lineId, frame };
  }

  /** Any Chief of Staff turn in flight (the host's own record: set before the turn's first await). */
  chiefTurnActive(): boolean {
    for (const t of this.turns.values()) if (t.agentId === CHIEF_ID) return true;
    return false;
  }

  /**
   * A model turn started (A9): arm the thinking-filler safety net for the Chief (no text 1.2 s after the start in
   * voice, 2.5 s in text). Desk turns are covered by the client's text filler. Never for a sincere "are you an AI?"
   * (H6: no reflex at all), distress (§1.4.4: sympathy only) or a turn that is only humour (the laugh is the reflex).
   */
  turnStarted(turnId: string, via: 'voice' | 'text', agentId: string = CHIEF_ID, cues?: AffectCues): void {
    const info: TurnInfo = { agentId, via, text: false, filler: null, ...(cues ? { cues } : {}) };
    this.turns.set(turnId, info);
    if (agentId !== CHIEF_ID) return;
    this.emitAttentionIfChanged();
    if (cues && (cues.sincereAi || cues.distress || humourOnly(cues))) return;
    info.filler = timer(() => {
      info.filler = null;
      if (info.text || this.turns.get(turnId) !== info) return;
      this.ownerReflex('thinking_filler', turnId).catch((err) => logError('expr.filler', err));
    }, via === 'voice' ? exprTiming.fillerVoiceMs : exprTiming.fillerTextMs);
  }

  /** A server reflex (a filler, an acknowledgement) was already sent for this turn. */
  spokeFor(turnId: string): boolean {
    for (const k of this.fired) if (k.endsWith(`|${turnId}`)) return true;
    return false;
  }

  /** The first text delta of a turn: the filler is no longer needed. */
  firstText(turnId: string): void {
    const t = this.turns.get(turnId);
    if (!t) return;
    t.text = true;
    if (t.filler) clearTimeout(t.filler);
    t.filler = null;
  }

  /** `start_background_job` succeeded in this turn: acknowledge ("On it."). */
  delegated(turnId: string): void {
    this.ownerReflex('acknowledge', turnId).catch((err) => logError('expr.ack', err));
  }

  /** The turn is over: forget it, and let a held progress line play 400 ms later. */
  turnEnded(turnId: string): void {
    const t = this.turns.get(turnId);
    if (t?.filler) clearTimeout(t.filler);
    this.turns.delete(turnId);
    this.gateState?.gate.resetTurn(turnId);
    if (this.fired.size > 512) this.fired.clear();
    if (t?.agentId === CHIEF_ID) {
      this.emitAttentionIfChanged();
      if (this.pendingMicro.size) this.scheduleMicro(exprTiming.microStatusAfterTurnMs);
    }
  }

  /** An owner-turn reflex from the server (acknowledge, thinking filler): instant lines only, once per turn. */
  private async ownerReflex(intent: 'thinking_filler' | 'acknowledge', turnId: string, extra: { steerQueued?: boolean } = {}): Promise<boolean> {
    const t = this.turns.get(turnId);
    const agentId = t?.agentId ?? CHIEF_ID;
    const key = `${agentId}|${intent}|${turnId}`;
    if (this.fired.has(key)) return false;
    const cues = t?.cues;
    if (cues?.sincereAi || cues?.distress) return false;
    const ctx = await this.ctxFor(agentId);
    if (!ctx) return false;
    if (intent === 'thinking_filler' && (!t || t.text || this.turns.get(turnId) !== t)) return false;
    // A filler after this turn's acknowledgement would be a second "one sec" (the client drops it too).
    if (intent === 'thinking_filler' && this.fired.has(`${agentId}|acknowledge|${turnId}`)) return false;
    if (this.fired.has(key)) return false;
    const via = t?.via ?? 'text';
    const state = this.grounding(ctx, { exchange: { mode: via, steerQueued: !!extra.steerQueued }, ...(cues ? { cues } : {}) });
    const r = this.plan(ctx, intent, { state, viewer: this.ownerViewer(agentId, ctx.settings), exchange: via, turnId, instantOnly: true, audience: 'owner', ...(cues ? { cues } : {}) });
    if (!r.ok) return false;
    this.fired.add(key);
    this.emitSay(r.frame);
    return true;
  }

  /** The owner wrote to the Chief while a job runs: a glance toward the work (§3.3). Nothing to compile. */
  ownerGlance(agentId: string, cause?: ExprCause): void {
    try {
      if (agentId === CHIEF_ID && this.runningJobs()) this.emitFace(CHIEF_ID, { gesture: 'glance', holdMs: 800 }, cause);
    } catch (err) {
      logError('expr.glance', err);
    }
  }

  /** Mood from the owner's words for the agent they addressed (A7). */
  async ownerMood(agentId: string, cues: AffectCues, cause?: ExprCause): Promise<void> {
    if (cues.distress) this.distressAt = this.d.now();
    const kinds = ownerMoodEvents(cues);
    if (kinds.length) await this.foldMood(agentId, kinds, cause);
  }

  // ── work events (mirrored from the Everyday project) ───────────────────────────────────────────────────────

  /**
   * A frame the WorkspaceDO just mirrored into the owner feed (and broadcast). Runs before the job's announcement
   * is broadcast, so a celebration leads into it. When the fast model is still writing that announcement
   * (`announcementPending`), the celebration waits for it: it plays right before the announcement, whose speech then
   * renders while the lead-in plays (no silence between them, and no "that feels good" about nothing yet).
   */
  async onMirrored(f: Frame, opts: { announcementPending?: boolean } = {}): Promise<void> {
    const cause: ExprCause | undefined = typeof f.seq === 'number' ? { streamId: f.streamId, seq: f.seq } : undefined;
    const now = this.d.now();
    switch (f.type) {
      case 'job.started': {
        const j = f.data.job;
        this.d.sql.exec(
          `INSERT INTO expr_work (job_id, title, label, step, total, since, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET title = excluded.title, label = excluded.label, step = excluded.step, total = excluded.total, updated = excluded.updated`,
          j.jobId,
          j.title,
          j.label,
          j.step,
          j.of,
          now,
          now,
        );
        this.emitAttentionIfChanged();
        return;
      }
      case 'job.progress': {
        const p = f.data;
        const title = this.d.jobTitle(p.jobId) ?? 'the job';
        this.d.sql.exec(
          `INSERT INTO expr_work (job_id, title, label, step, total, since, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET label = excluded.label, step = excluded.step, total = excluded.total, updated = excluded.updated`,
          p.jobId,
          title,
          p.label,
          p.step,
          p.of,
          now,
          now,
        );
        this.emitAttentionIfChanged();
        if (p.step - 1 >= 1) this.queueMicro(p.jobId, cause, false);
        return;
      }
      case 'job.steered':
        if (f.data.status === 'queued') await this.steerAcknowledged(f.opId, cause);
        else this.queueMicro(f.data.jobId, cause, true);
        return;
      case 'job.done': {
        const jobId = f.data.jobId;
        const title = this.workTitle(jobId) ?? this.d.jobTitle(jobId);
        this.endWork(jobId);
        const clock = this.clock();
        this.wins = { lastWinAt: now, day: clock.dayKey, count: (this.wins.day === clock.dayKey ? this.wins.count : 0) + 1 };
        await this.foldMood(CHIEF_ID, ['job.done'], cause);
        if (opts.announcementPending) {
          this.pendingCelebrations.set(jobId, { title, cause, at: now });
          for (const [k, v] of this.pendingCelebrations) if (now - v.at > 60_000) this.pendingCelebrations.delete(k);
        } else await this.celebrate(title, cause);
        return;
      }
      case 'job.failed': {
        this.endWork(f.data.jobId);
        await this.foldMood(CHIEF_ID, ['job.failed'], cause);
        if (this.stageViewer(CHIEF_ID)) this.emitFace(CHIEF_ID, { gesture: 'wince', expression: 'concerned', holdMs: 2000 }, cause);
        return;
      }
      case 'job.cancelled':
        this.endWork(f.data.jobId);
        return;
      default:
        return;
    }
  }

  /** Signals the ProjectDO sends outside its ledger: a failed attempt that will be retried → mood and `oops`. */
  async onSignals(signals: readonly { kind: 'step.retry'; jobId: string; attempt: number; at: number }[]): Promise<void> {
    for (const s of signals) {
      if (s.kind !== 'step.retry') continue;
      await this.foldMood(CHIEF_ID, ['step.retry']);
      const viewer = this.stageViewer(CHIEF_ID);
      if (!viewer) continue;
      const ctx = await this.ctxFor(CHIEF_ID);
      if (!ctx) continue;
      const state = this.grounding(ctx, { jobId: s.jobId });
      const r = this.plan(ctx, 'oops', { state, viewer: viewerStateOf(viewer), exchange: 'none' });
      if (r.ok) this.emitSay(r.frame);
      else if (r.face) this.emitFace(CHIEF_ID, r.face);
    }
  }

  private workTitle(jobId: string): string | null {
    return this.d.sql.exec<{ title: string }>('SELECT title FROM expr_work WHERE job_id = ?', jobId).toArray()[0]?.title ?? null;
  }

  private endWork(jobId: JobId): void {
    this.d.sql.exec('DELETE FROM expr_work WHERE job_id = ?', jobId);
    this.pendingMicro.delete(jobId);
    this.emitAttentionIfChanged();
  }

  /** The announcement of a finished job is about to be posted: its held celebration plays first (≤ 10 s old). */
  async celebratePending(jobId: string): Promise<void> {
    const p = this.pendingCelebrations.get(jobId);
    if (!p) return;
    this.pendingCelebrations.delete(jobId);
    if (this.d.now() - p.at > 10_000) return;
    await this.celebrate(p.title, p.cause);
  }

  /** A short lead-in before the completion announcement, only for a viewer at Talk (§8.3 of the plan). */
  private async celebrate(title: string | null, cause: ExprCause | undefined): Promise<void> {
    const viewer = this.stageViewer(CHIEF_ID);
    if (!viewer) return;
    const ctx = await this.ctxFor(CHIEF_ID);
    if (!ctx) return;
    const artifact = artifactOf(title);
    const state = this.grounding(ctx, { ...(artifact ? { artifact } : {}) });
    const r = this.plan(ctx, 'celebrate', { state, viewer: viewerStateOf(viewer), exchange: 'none', ...(cause ? { cause } : {}) });
    if (r.ok) this.emitSay(r.frame);
    else if (r.face) this.emitFace(CHIEF_ID, r.face, cause);
  }

  /** A steer was queued: acknowledge it in its turn (tool steer), else nod (a steer from the job's row). */
  private async steerAcknowledged(opId: string | undefined, cause: ExprCause | undefined): Promise<void> {
    const turnId = turnOfOpId(opId);
    if (turnId && this.turns.has(turnId)) {
      await this.ownerReflex('acknowledge', turnId, { steerQueued: true });
      return;
    }
    const ctx = await this.ctxFor(CHIEF_ID);
    if (!ctx) return;
    const state = this.grounding(ctx, { exchange: { steerQueued: true } });
    const r = this.plan(ctx, 'acknowledge', { state, viewer: this.ownerViewer(CHIEF_ID, ctx.settings), exchange: 'none', instantOnly: true, audience: 'owner', ...(cause ? { cause } : {}) });
    if (r.ok) this.emitSay(r.frame);
    else if (r.face) this.emitFace(CHIEF_ID, r.face, cause);
  }

  // ── micro-status: coalesced per job (latest wins, TTL 20 s), after the active turn, 2-min cooldown ──────────

  private queueMicro(jobId: string, cause: ExprCause | undefined, steer: boolean): void {
    if (!this.stageViewer(CHIEF_ID)) return;
    // Latest wins, but an applied steer in the same window keeps its context (the line can say it landed).
    const prev = this.pendingMicro.get(jobId);
    this.pendingMicro.set(jobId, { at: this.d.now(), cause, steer: steer || !!prev?.steer });
    if (!this.chiefTurnActive()) this.scheduleMicro(0);
  }

  private scheduleMicro(ms: number): void {
    if (this.microTimer) clearTimeout(this.microTimer);
    this.microTimer = timer(() => {
      this.microTimer = null;
      this.flushMicro().catch((err) => logError('expr.micro', err));
    }, ms);
  }

  /** Play the latest fresh progress line, if the cooldown allows; everything else waiting is dropped, never delayed. */
  async flushMicro(): Promise<boolean> {
    if (!this.pendingMicro.size || this.chiefTurnActive()) return false;
    const now = this.d.now();
    // Never over a reply: while the Chief's voice is still sounding in a tab, wait for it (+400 ms).
    const voiceUntil = this.chiefVoiceUntil();
    if (voiceUntil > now) {
      this.scheduleMicro(voiceUntil - now + exprTiming.microStatusAfterTurnMs);
      return false;
    }
    const fresh = [...this.pendingMicro.entries()].filter(([, p]) => now - p.at <= exprTiming.microStatusTtlMs).sort((a, b) => b[1].at - a[1].at);
    this.pendingMicro.clear();
    if (!fresh.length || now - this.lastMicroAt < exprTiming.microStatusCooldownMs) return false;
    const viewer = this.stageViewer(CHIEF_ID);
    if (!viewer) return false;
    const ctx = await this.ctxFor(CHIEF_ID);
    if (!ctx) return false;
    const [jobId, p] = fresh[0]!;
    const state = this.grounding(ctx, { jobId, exchange: { steerQueued: p.steer } });
    const r = this.plan(ctx, 'micro_status', { state, viewer: viewerStateOf(viewer), exchange: 'none', ...(p.cause ? { cause: p.cause } : {}) });
    if (r.ok) {
      this.lastMicroAt = now;
      this.emitSay(r.frame);
      return true;
    }
    if (r.face) this.emitFace(CHIEF_ID, r.face, p.cause);
    return false;
  }

  // ── mood (A7): one state per agent with an event; emitted on a visible change, else ≤ 1 per 10 s ─────────────

  private loadMood(agentId: string): MoodState | null {
    const row = this.d.sql.exec<{ state: string }>('SELECT state FROM expr_mood WHERE agent_id = ?', agentId).toArray()[0];
    if (!row) return null;
    try {
      return JSON.parse(row.state) as MoodState;
    } catch {
      return null;
    }
  }

  /** Fold real events into an agent's mood and emit `mood.changed` per §3.3. */
  async foldMood(agentId: string, kinds: readonly MoodEventKind[], cause?: ExprCause): Promise<void> {
    if (!kinds.length) return;
    const settings = await this.d.settings();
    const profile = profileFor(agentId, settings);
    if (!profile) return;
    const index = indexFor(profile);
    const now = this.d.now();
    let state = this.loadMood(agentId);
    const b = index.baseline;
    if (!state || state.baseline.valence !== b.valence || state.baseline.energy !== b.energy || state.reactivity !== index.reactivity) {
      state = createMoodState(agentId, b, index.reactivity, now);
    }
    const presence = this.d.presence(agentId as AgentId);
    const prev = moodAt(state, now);
    const prevBias = expressionBias(prev, presence);
    let next = state;
    for (const kind of kinds) next = applyMoodEvent(next, { kind, at: now, ...(cause ? { cause } : {}) });
    const nm = moodAt(next, now);
    const nextBias = expressionBias(nm, presence);
    this.d.sql.exec(
      'INSERT INTO expr_mood (agent_id, state, emitted_at) VALUES (?, ?, 0) ON CONFLICT(agent_id) DO UPDATE SET state = excluded.state',
      agentId,
      JSON.stringify(next),
    );
    const emittedAt = Number(this.d.sql.exec<{ emitted_at: number }>('SELECT emitted_at FROM expr_mood WHERE agent_id = ?', agentId).toArray()[0]?.emitted_at ?? 0);
    if (moodChanged(prev, nm, prevBias, nextBias) || now - emittedAt >= exprTiming.moodCoalesceMs) this.emitMood(agentId);
    else if (!this.moodTimers.has(agentId)) {
      this.moodTimers.set(
        agentId,
        timer(() => {
          this.moodTimers.delete(agentId);
          this.emitMood(agentId);
        }, emittedAt + exprTiming.moodCoalesceMs - now),
      );
    }
  }

  private emitMood(agentId: string): void {
    const state = this.loadMood(agentId);
    if (!state) return;
    const now = this.d.now();
    const data = moodChangedData(state, now, this.d.presence(agentId as AgentId));
    if (!data) return;
    const pending = this.moodTimers.get(agentId);
    if (pending) clearTimeout(pending);
    this.moodTimers.delete(agentId);
    this.d.sql.exec('UPDATE expr_mood SET emitted_at = ? WHERE agent_id = ?', now, agentId);
    this.d.feed.emit({ type: 'mood.changed', data, actor: agentId as AgentId, ...(data.cause ? { cause: data.cause } : {}) });
  }

  /** The Chief's mood follows its lead: a new lead starts from its own baseline. */
  resetMood(agentId: string): void {
    this.d.sql.exec('DELETE FROM expr_mood WHERE agent_id = ?', agentId);
  }

  // ── attention (A8): one work thread per running job, plus the talk thread while a turn or the voice is live ──

  chiefAttention(): AttentionView {
    const now = this.d.now();
    const host = projectStream(this.d.workspaceId, EVERYDAY_PROJECT_ID);
    const claims: AttentionThread[] = this.workRows().map((r) => ({
      id: `job:${r.job_id}`,
      kind: 'work',
      mailbox: 'work',
      host,
      label: r.total ? `“${r.title}” (step ${r.step} of ${r.total})` : `“${r.title}”`,
      voice: { speaking: false, untilMs: null },
      floorHeld: false,
      interruptible: 'checkpoint',
      since: Number(r.since),
    }));
    const until = this.chiefVoiceUntil();
    const speaking = until > now;
    if (this.chiefTurnActive() || speaking) {
      claims.push({ id: 'talk', kind: 'talk', mailbox: 'owner', host: this.d.streamId, label: 'Talking with you', voice: { speaking, untilMs: speaking ? until : null }, floorHeld: false, interruptible: 'sentence', since: now });
    }
    return mergeAttention(CHIEF_ID, claims, now);
  }

  /** Until when a tab says the Chief's conversation voice is sounding (epoch ms; 0 when silent). */
  private chiefVoiceUntil(): number {
    return this.viewers().reduce((m, v) => (v.voice?.agentId === CHIEF_ID ? Math.max(m, v.voice.untilMs) : m), 0);
  }

  private emitAttentionIfChanged(): void {
    const data = attentionChangedData(this.chiefAttention());
    const key = JSON.stringify([data.focus, data.background, data.floorHeld, data.voiceBusyUntil !== null]);
    if (key === this.attentionKey) return;
    this.attentionKey = key;
    this.d.feed.emit({ type: 'attention.changed', data, actor: CHIEF_ID });
  }

  /** Sent to each new socket after the presence snapshot: moods of agents with an event, and the Chief's attention. */
  connectFrames(): FrameInput[] {
    const now = this.d.now();
    const out: FrameInput[] = [];
    const rows = this.d.sql.exec<{ agent_id: string; state: string }>('SELECT agent_id, state FROM expr_mood ORDER BY agent_id').toArray();
    for (const r of rows) {
      try {
        const data = moodChangedData(JSON.parse(r.state) as MoodState, now, this.d.presence(r.agent_id as AgentId));
        if (data) out.push({ type: 'mood.changed', data, actor: r.agent_id as AgentId });
      } catch {
        /* a corrupt row: skipped */
      }
    }
    const attention = attentionChangedData(this.chiefAttention());
    out.push({ type: 'attention.changed', data: attention, actor: CHIEF_ID });
    return out;
  }
}
