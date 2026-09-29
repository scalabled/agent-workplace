// Client store (signals): normalised state fed by owner-feed frames and optimistic commands.
import { computed, signal } from '@preact/signals';
import {
  CHIEF_ID,
  mergePresence,
  type AgentId,
  type CapabilitiesResponse,
  type Frame,
  type JobId,
  type JobSnapshot,
  type Modality,
  type OpId,
  type PresenceData,
  type PresenceState,
  type TalkAccepted,
  type TurnId,
  type WorkspaceSettings,
} from '@headcount/protocol';
import type { DeskSayAccepted } from '@headcount/protocol/ext/expressions';
import type { ChannelEntry, Decision, ProjectsResponse, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import type { FeedStatus } from '../api/ws';
import { applyServerVoice } from '../voice/owner';

export type ThreadFrom = 'owner' | AgentId | 'system';

export interface ThreadItem {
  /** Server MessageId, or `local:<opId>` for an owner message not yet accepted. */
  messageId: string;
  turnId: TurnId | null;
  from: ThreadFrom;
  text: string;
  /** True while talk.delta frames are still arriving. */
  streaming: boolean;
  /** `note`: one quiet line from the office (a meeting happened); never voiced, never unread. */
  kind?: 'reply' | 'announcement' | 'status' | 'reflex' | 'error' | 'note';
  /** A note's room (`skyline`, `garden`, `huddle:<hash>`). */
  roomId?: string;
  jobId?: JobId;
  /** The team project a Chief message is about (Inc 1): Talk links to its page. */
  projectId?: string;
  /** Sources the Chief's web search cited. */
  sources?: { url: string; title?: string }[];
  via?: 'text' | 'voice';
  opId?: OpId;
  /** Owner messages only: pending until accepted, failed when the send failed (text is never lost). */
  status?: 'pending' | 'failed';
  error?: string;
  missingKeys?: string[];
  /** The turn was cancelled (barge-in or a newer turn) before it finished. */
  interrupted?: boolean;
  ts: string;
}

export const settings = signal<WorkspaceSettings | null>(null);
/**
 * Floor quick-chats per coworker agent id (Inc 0.5): talk.* frames with `surface: 'floor'` (or an owner message
 * addressed to someone else) land here, never in `thread`. The Talk transcript is the Chief of Staff's alone.
 */
export const sideThreads = signal<Record<string, ThreadItem[]>>({});
/** Bumped on every `ready` frame (each (re)connect): the living layer re-sends its viewer state then. */
export const feedEpoch = signal(0);
export const capabilities = signal<CapabilitiesResponse | null>(null);
export const connection = signal<FeedStatus>('connecting');
/** Highest persisted seq applied from the owner feed. */
export const lastSeq = signal(0);
/** Persisted seq at the last `ready` frame: frames at or below it are replay, not live. */
export const replayThrough = signal(0);
export const thread = signal<ThreadItem[]>([]);
export const jobs = signal<Record<string, JobSnapshot>>({});
/** Server presence claims (thinking, working, …), per agent. */
export const presence = signal<Record<string, PresenceData>>({});
/** Client-local claims: `speaking` from the audio actually playing here, `listening` while the owner holds to talk. */
export const localPresence = signal<Record<string, { speaking?: boolean; listening?: boolean }>>({});

export const onboarded = computed(() => Boolean(settings.value?.leadId));
export const activeJobs = computed(() => Object.values(jobs.value).filter((j) => j.status === 'queued' || j.status === 'running'));
/** Every job, newest first. */
export const jobList = computed(() => Object.values(jobs.value).sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0)));
// ── Inc 1 team projects and the Inbox ─────────────────────────────────────────
export const teamProjects = signal<Record<string, TeamProjectSnapshot>>({});
export const openDecisions = signal<Record<string, Decision>>({});
/** Each team project's channel (oldest first, one entry per seq): loaded on the project page, then live. */
export const projectChannels = signal<Record<string, ChannelEntry[]>>({});

/** Merge channel entries into a project's channel (dedupe by seq, keep order). */
export function mergeChannel(projectId: string, entries: readonly ChannelEntry[]): void {
  const cur = projectChannels.value[projectId] ?? [];
  const bySeq = new Map(cur.map((e) => [e.seq, e]));
  let changed = false;
  for (const e of entries) {
    if (bySeq.has(e.seq)) continue;
    bySeq.set(e.seq, e);
    changed = true;
  }
  if (!changed) return;
  projectChannels.value = { ...projectChannels.value, [projectId]: [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-400) };
}
export const projectList = computed(() => Object.values(teamProjects.value).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)));
export const decisionList = computed(() => Object.values(openDecisions.value).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
/** The Inbox counts raised hands only, so it can reach zero (X1). */
export const raisedHands = computed(() => Object.keys(openDecisions.value).length);

/**
 * Keep full outputs: frames carry clipped step outputs and deliverables, GET /api/projects/:id the full text. A
 * newer snapshot replaces an older one, but never shortens text we already hold for the same step.
 */
export function upsertProject(p: TeamProjectSnapshot): void {
  const cur = teamProjects.value[p.projectId];
  if (cur && cur.updatedAt > p.updatedAt) return;
  const longer = (a?: string, b?: string) => (a && b && a.length > b.length && a.startsWith(b.replace(/…$/, '').slice(0, 200)) ? a : (b ?? a));
  const steps = p.steps.map((s) => {
    const old = cur?.steps.find((o) => o.id === s.id);
    const output = longer(old?.output, s.output);
    return output ? { ...s, output } : s;
  });
  const deliverable = longer(cur?.deliverable, p.deliverable);
  teamProjects.value = { ...teamProjects.value, [p.projectId]: { ...p, steps, ...(deliverable ? { deliverable } : {}) } };
}

export function mergeProjects(r: ProjectsResponse): void {
  for (const p of r.projects) upsertProject(p);
  const open: Record<string, Decision> = {};
  for (const d of r.decisions) if (d.status === 'open') open[d.decisionId] = d;
  openDecisions.value = open;
}

/**
 * Who is doing team work now, keyed by agent id: step owners work, reviewers think, and the lead of a plan waiting
 * for the owner's OK raises a hand. Drives faces and the office.
 */
export const teamWork = computed(() => {
  const out: Record<string, { state: 'working' | 'thinking' | 'raised_hand'; label: string }> = {};
  for (const p of Object.values(teamProjects.value)) {
    if (p.status === 'planning') {
      const lead = p.team.find((m) => m.role === 'lead') ?? p.team[0];
      if (lead) out[`cw_${lead.personaId}`] = { state: 'working', label: `Drafting the plan: ${p.title}` };
      continue;
    }
    if (p.status === 'proposed') {
      const lead = p.team.find((m) => m.role === 'lead') ?? p.team[0];
      if (lead) out[`cw_${lead.personaId}`] = { state: 'raised_hand', label: `Waiting on you: ${p.title}` };
      continue;
    }
    // A meeting: the one speaking now.
    if (p.discussion) out[`cw_${p.discussion.speakerId}`] = { state: 'thinking', label: p.kickoff === 'pending' ? 'Speaking in the kickoff' : `In the discussion: ${p.discussion.question}` };
    // A teammate (or the owner) asked someone who has not answered yet: they are working out the answer.
    const lines = projectChannels.value[p.projectId] ?? [];
    const answered = new Set(lines.filter((e) => e.replyTo).map((e) => e.replyTo!));
    for (const e of lines) {
      if (answered.has(e.seq) || !e.toId || e.toId === 'owner') continue;
      if (e.kind === 'ask') out[`cw_${e.toId}`] ??= { state: 'thinking', label: `Answering ${p.team.find((m) => m.personaId === e.fromId)?.name.split(' ')[0] ?? 'a teammate'}` };
      else if (e.kind === 'owner' && Date.now() - Date.parse(e.at) < 120_000) out[`cw_${e.toId}`] ??= { state: 'thinking', label: 'Replying to you' };
    }
    // Paused: a step already under way still finishes, so its people still show it.
    if (p.status !== 'running' && p.status !== 'paused') continue;
    for (const st of p.steps) {
      const lead = st.byId ?? st.ownerId;
      if (st.status === 'working' || st.status === 'revising') out[`cw_${lead}`] = { state: 'working', label: st.status === 'revising' ? `Revising: ${st.title}` : st.title };
      else if (st.status === 'reviewing') {
        // Everyone in the cluster but the lead reviews (co-owners and reviewers).
        for (const r of [...[st.ownerId, ...(st.coOwnerIds ?? [])].filter((o) => o !== lead), ...st.reviewerIds]) out[`cw_${r}`] ??= { state: 'thinking', label: `Reviewing: ${st.title}` };
      } else if (st.status === 'asking') out[`cw_${lead}`] = { state: 'raised_hand', label: `Question for you: ${st.question?.text ?? st.title}` };
    }
  }
  return out;
});

/**
 * Settings only move forward: a copy older than the one held (a slow GET, a stale frame) is ignored, so the app
 * never flips back to an earlier Chief of Staff or name. Returns whether it was applied.
 */
export function acceptSettings(next: WorkspaceSettings): boolean {
  const cur = settings.value;
  if (cur && next.updatedAt < cur.updatedAt) return false;
  settings.value = next;
  return true;
}

/** Is a capability usable? Mock-only TTS/STT/image report unavailable, so they stay hidden (X8). */
export function can(m: Modality): boolean {
  return capabilities.value?.modalities[m]?.available === true;
}

// ── presence ────────────────────────────────────────────────────────────────────
export interface ShownPresence {
  state: PresenceState;
  label: string;
}

const DEFAULT_LABELS: Record<PresenceState, string> = {
  idle: 'Available',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  working: 'Working',
  raised_hand: 'Waiting on you',
};

/** Merge server claims with local ones by PRESENCE_PRIORITY (speaking > raised hand > listening > …). */
export function presenceFor(agentId: string): ShownPresence {
  const claims: ShownPresence[] = [];
  const local = localPresence.value[agentId];
  if (local?.speaking) claims.push({ state: 'speaking', label: DEFAULT_LABELS.speaking });
  if (local?.listening) claims.push({ state: 'listening', label: DEFAULT_LABELS.listening });
  const server = presence.value[agentId];
  if (server) claims.push({ state: server.state, label: server.label || DEFAULT_LABELS[server.state] });
  const team = teamWork.value[agentId];
  if (team) claims.push(team);
  return mergePresence(claims) ?? { state: 'idle', label: DEFAULT_LABELS.idle };
}

export const chiefPresence = computed(() => presenceFor(CHIEF_ID));

export function setLocalPresence(agentId: string, claim: 'speaking' | 'listening', on: boolean): void {
  const cur = localPresence.value[agentId] ?? {};
  if (Boolean(cur[claim]) === on) return;
  localPresence.value = { ...localPresence.value, [agentId]: { ...cur, [claim]: on } };
}

/** Presence is ephemeral: when the feed drops, stale claims must not keep animating. */
export function clearServerPresence(): void {
  if (Object.keys(presence.value).length) presence.value = {};
}

// ── thread helpers ──────────────────────────────────────────────────────────────
function upsertThread(item: ThreadItem, match?: (m: ThreadItem) => boolean) {
  const list = thread.value;
  const i = list.findIndex((m) => m.messageId === item.messageId || (match?.(m) ?? false));
  if (i >= 0) {
    thread.value = list.map((m, j) => (j === i ? { ...m, ...item } : m));
    return;
  }
  // A reply lands with its own turn: one that finished writing after the owner's next message (a typed follow-up
  // or a "thanks" never cuts it) sits right after its turn, live and in a replayed thread alike.
  if (item.from !== 'owner' && item.turnId) {
    let at = -1;
    for (let j = list.length - 1; j >= 0; j--) {
      if (list[j]!.turnId === item.turnId) {
        at = j;
        break;
      }
    }
    if (at >= 0 && at < list.length - 1) {
      thread.value = [...list.slice(0, at + 1), item, ...list.slice(at + 1)];
      return;
    }
  }
  thread.value = [...list, item];
}

function patchThread(messageId: string, patch: Partial<ThreadItem>) {
  thread.value = thread.value.map((m) => (m.messageId === messageId ? { ...m, ...patch } : m));
}

const localId = (opId: OpId) => `local:${opId}`;

/** Optimistic owner message (shown at once, reconciled by opId when the echo arrives). */
export function addPendingOwner(opId: OpId, text: string, via: 'text' | 'voice'): void {
  upsertThread({ messageId: localId(opId), turnId: null, from: 'owner', text, streaming: false, via, opId, status: 'pending', ts: new Date().toISOString() });
}

/** 202 from POST /api/talk: re-key the optimistic item to the server's ids (the echo may already have replaced it). */
export function markOwnerAccepted(accepted: TalkAccepted): void {
  const item = thread.value.find((m) => m.messageId === localId(accepted.opId));
  if (!item) return;
  const already = thread.value.some((m) => m.messageId === accepted.messageId);
  if (already) thread.value = thread.value.filter((m) => m !== item);
  else patchThread(item.messageId, { messageId: accepted.messageId, turnId: accepted.turnId, status: undefined, error: undefined });
}

export function markOwnerFailed(opId: OpId, message: string): void {
  const item = thread.value.find((m) => m.opId === opId && m.from === 'owner' && m.status !== undefined);
  if (item) patchThread(item.messageId, { status: 'failed', error: message });
}

export function markOwnerRetrying(opId: OpId): void {
  const item = thread.value.find((m) => m.opId === opId && m.from === 'owner');
  if (item) patchThread(item.messageId, { status: 'pending', error: undefined });
}

export function dismissThreadItem(messageId: string): void {
  thread.value = thread.value.filter((m) => m.messageId !== messageId);
}

/**
 * Merge job snapshots from GET /api/jobs (after a reload or reconnect). A snapshot replaces the local copy only
 * when it is newer, so frames applied meanwhile are never rolled back.
 */
export function mergeJobs(snapshots: JobSnapshot[]): void {
  let next: Record<string, JobSnapshot> | null = null;
  for (const job of snapshots) {
    const cur = (next ?? jobs.value)[job.jobId];
    if (cur && cur.updatedAt >= job.updatedAt) continue;
    next ??= { ...jobs.value };
    next[job.jobId] = cur ? { ...cur, ...job } : job;
  }
  if (next) jobs.value = next;
}

function patchJob(jobId: string, patch: Partial<JobSnapshot>, ts: string) {
  const prev = jobs.value[jobId];
  if (prev) jobs.value = { ...jobs.value, [jobId]: { ...prev, ...patch, updatedAt: ts } };
}

// ── frame listeners (voice, announcements) ──────────────────────────────────────
export interface FrameInfo {
  /** False for frames replayed on (re)connect: never speak or animate those. */
  live: boolean;
}
type FrameListener = (frame: Frame, info: FrameInfo) => void;
const listeners = new Set<FrameListener>();

/** Subscribe to frames after they are applied to the store. */
export function onFrame(cb: FrameListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Forget everything the feed produced (the server ledger was reset). */
export function resetFeedState(): void {
  lastSeq.value = 0;
  replayThrough.value = 0;
  thread.value = thread.value.filter((m) => m.from === 'owner' && m.status !== undefined);
  const side: Record<string, ThreadItem[]> = {};
  for (const [id, list] of Object.entries(sideThreads.value)) {
    const keep = list.filter((m) => m.from === 'owner' && m.status !== undefined);
    if (keep.length) side[id] = keep;
  }
  sideThreads.value = side;
  jobs.value = {};
  presence.value = {};
  teamProjects.value = {};
  openDecisions.value = {};
  projectChannels.value = {};
}

// ── Floor quick-chats ───────────────────────────────────────────────────────────
function upsertSide(agentId: string, item: ThreadItem, match?: (m: ThreadItem) => boolean) {
  const list = sideThreads.value[agentId] ?? [];
  const i = list.findIndex((m) => m.messageId === item.messageId || (match?.(m) ?? false));
  const next = i < 0 ? [...list, item] : list.map((m, j) => (j === i ? { ...m, ...item } : m));
  sideThreads.value = { ...sideThreads.value, [agentId]: next };
}

function patchSide(agentId: string, pred: (m: ThreadItem) => boolean, patch: Partial<ThreadItem>) {
  const list = sideThreads.value[agentId];
  if (!list?.some(pred)) return;
  sideThreads.value = { ...sideThreads.value, [agentId]: list.map((m) => (pred(m) ? { ...m, ...patch } : m)) };
}

/** Optimistic Floor quick-chat message (reconciled by opId when the echo arrives). */
export function addPendingSide(agentId: string, opId: OpId, text: string): void {
  upsertSide(agentId, { messageId: localId(opId), turnId: null, from: 'owner', text, streaming: false, via: 'text', opId, status: 'pending', ts: new Date().toISOString() });
}

/** 202 from POST /api/desk/:personaId/say. */
export function markSideAccepted(agentId: string, accepted: DeskSayAccepted): void {
  const list = sideThreads.value[agentId] ?? [];
  const item = list.find((m) => m.messageId === localId(accepted.opId));
  if (!item) return;
  if (list.some((m) => m.messageId === accepted.messageId)) sideThreads.value = { ...sideThreads.value, [agentId]: list.filter((m) => m !== item) };
  else patchSide(agentId, (m) => m === item, { messageId: accepted.messageId, turnId: accepted.turnId, status: undefined, error: undefined });
}

export function markSideFailed(agentId: string, opId: OpId, message: string): void {
  patchSide(agentId, (m) => m.opId === opId && m.from === 'owner' && m.status !== undefined, { status: 'failed', error: message });
}

/** A talk.* frame that belongs to a Floor quick-chat, and the coworker it is with. */
function floorAgent(frame: Frame): string | null {
  switch (frame.type) {
    case 'talk.owner':
      return frame.data.surface === 'floor' || (frame.data.agentId && frame.data.agentId !== CHIEF_ID) ? (frame.data.agentId ?? null) : null;
    case 'talk.delta':
    case 'talk.message':
      return frame.data.surface === 'floor' ? frame.data.agentId : null;
    case 'talk.done':
      return frame.data.surface === 'floor' || (frame.data.agentId && frame.data.agentId !== CHIEF_ID) ? (frame.data.agentId ?? null) : null;
    default:
      return null;
  }
}

function reduceSide(agentId: string, frame: Frame): void {
  switch (frame.type) {
    case 'talk.owner':
      upsertSide(
        agentId,
        { messageId: frame.data.messageId, turnId: frame.data.turnId, from: 'owner', text: frame.data.text, streaming: false, via: frame.data.via, ...(frame.opId ? { opId: frame.opId } : {}), status: undefined, error: undefined, ts: frame.ts },
        (m) => !!frame.opId && m.opId === frame.opId && m.from === 'owner',
      );
      break;
    case 'talk.delta': {
      const cur = sideThreads.value[agentId]?.find((m) => m.messageId === frame.data.messageId);
      if (cur && !cur.streaming) break;
      upsertSide(agentId, { messageId: frame.data.messageId, turnId: frame.data.turnId, from: frame.data.agentId, text: (cur?.text ?? '') + frame.data.delta, streaming: true, kind: 'reply', ts: cur?.ts ?? frame.ts });
      break;
    }
    case 'talk.message':
      upsertSide(agentId, { messageId: frame.data.messageId, turnId: frame.data.turnId, from: frame.data.agentId, text: frame.data.text, streaming: false, kind: frame.data.kind, ts: frame.ts });
      break;
    case 'talk.done': {
      const cancelled = frame.data.finish === 'cancelled';
      patchSide(agentId, (m) => m.turnId === frame.data.turnId && m.streaming, { streaming: false, ...(cancelled ? { interrupted: true } : {}) });
      const agent = presence.value[agentId];
      if (agent?.state === 'thinking') presence.value = { ...presence.value, [agentId]: { ...agent, state: 'idle', label: '' } };
      break;
    }
    default:
      break;
  }
}

// ── office rooms (Office Phase 2) ───────────────────────────────────────────────
/** Turn and op ids of room turns seen on the feed: their error frames belong to the room's dock, never to Talk. */
const roomKeys = new Set<string>();
const ROOM_KEYS_KEPT = 200;

function rememberRoomKey(key: string | undefined): void {
  if (!key) return;
  roomKeys.add(key);
  if (roomKeys.size > ROOM_KEYS_KEPT) roomKeys.delete(roomKeys.values().next().value!);
}

/**
 * A frame of an office room or a joined huddle (`surface: 'room'`), or an error of one of their turns. The store keeps
 * none of them (the room session reads them through onFrame): never in `thread`, `sideThreads` or unread.
 */
export function isRoomFrame(frame: Frame): boolean {
  switch (frame.type) {
    case 'talk.owner':
    case 'talk.delta':
    case 'talk.message':
    case 'talk.done':
      return frame.data.surface === 'room';
    case 'error':
      return (!!frame.data.turnId && roomKeys.has(frame.data.turnId)) || (!!frame.data.opId && roomKeys.has(frame.data.opId));
    default:
      return false;
  }
}

/** A talk.* frame of the Chief's Talk thread: no surface, or `'talk'` (never a Floor quick-chat or an office room). */
export function isTalkSurface(surface: string | undefined): boolean {
  return surface === undefined || surface === 'talk';
}

export type ApplyResult = 'applied' | 'ignored' | 'resync';

/**
 * Apply one feed frame. Persisted frames at or below lastSeq are ignored (replay overlap).
 * Returns 'resync' when the server's ledger is behind our cursor (fresh server state): the caller
 * reconnects with since=0 after the store was reset.
 */
export function applyFrame(frame: Frame): ApplyResult {
  if (frame.type === 'ready') {
    // Who speaks now (one voice per workspace), before anything live arrives on this socket.
    applyServerVoice(frame.data.voice);
    if (frame.data.lastSeq < lastSeq.value) {
      resetFeedState();
      return 'resync';
    }
    replayThrough.value = frame.data.lastSeq;
    feedEpoch.value++;
    return 'applied';
  }
  if (frame.seq !== undefined) {
    if (frame.seq <= lastSeq.value) return 'ignored';
    lastSeq.value = frame.seq;
  }
  const live = frame.seq === undefined || frame.seq > replayThrough.value;
  reduce(frame, live);
  for (const cb of listeners) {
    try {
      cb(frame, { live });
    } catch (err) {
      console.error('frame listener failed', err);
    }
  }
  return 'applied';
}

function reduce(frame: Frame, live: boolean): void {
  // Office rooms and joined huddles reach onFrame listeners (the room session) only.
  if (frame.type === 'talk.owner' && frame.data.surface === 'room') {
    rememberRoomKey(frame.data.turnId);
    rememberRoomKey(frame.opId);
  }
  if (isRoomFrame(frame)) return;
  const side = floorAgent(frame);
  if (side) return reduceSide(side, frame);
  switch (frame.type) {
    case 'talk.owner':
      upsertThread(
        { messageId: frame.data.messageId, turnId: frame.data.turnId, from: 'owner', text: frame.data.text, streaming: false, via: frame.data.via, ...(frame.opId ? { opId: frame.opId } : {}), status: undefined, error: undefined, ts: frame.ts },
        (m) => !!frame.opId && m.opId === frame.opId && m.from === 'owner',
      );
      break;
    case 'talk.delta': {
      const cur = thread.value.find((m) => m.messageId === frame.data.messageId);
      if (cur && !cur.streaming) break; // the complete message already arrived
      upsertThread({ messageId: frame.data.messageId, turnId: frame.data.turnId, from: frame.data.agentId, text: (cur?.text ?? '') + frame.data.delta, streaming: true, kind: 'reply', ts: cur?.ts ?? frame.ts });
      break;
    }
    case 'talk.message':
      upsertThread({
        messageId: frame.data.messageId,
        turnId: frame.data.turnId,
        from: frame.data.agentId,
        text: frame.data.text,
        streaming: false,
        kind: frame.data.kind,
        ...(frame.data.jobId ? { jobId: frame.data.jobId } : {}),
        ...(frame.data.projectId ? { projectId: frame.data.projectId } : {}),
        ...(frame.data.sources?.length ? { sources: frame.data.sources } : {}),
        ...(frame.data.kind === 'note' && frame.data.roomId ? { roomId: frame.data.roomId } : {}),
        ts: frame.ts,
      });
      break;
    case 'talk.done': {
      const id = frame.data.messageId;
      if (id) patchThread(id, { streaming: false, ...(frame.data.finish === 'cancelled' ? { interrupted: true } : {}) });
      // Any other half-streamed message of this turn stops streaming too.
      thread.value = thread.value.map((m) => (m.turnId === frame.data.turnId && m.streaming ? { ...m, streaming: false, interrupted: frame.data.finish === 'cancelled' || m.interrupted } : m));
      // The Chief of Staff's turn is over (a coworker's quick-chat never resets the Chief's face).
      const chief = presence.value[CHIEF_ID];
      if (chief?.state === 'thinking') presence.value = { ...presence.value, [CHIEF_ID]: { ...chief, state: 'idle', label: '' } };
      break;
    }
    case 'job.started':
      jobs.value = { ...jobs.value, [frame.data.job.jobId]: frame.data.job };
      break;
    case 'project.proposed':
      upsertProject(frame.data.project);
      // A replayed proposal must not reopen a hand the project has already moved past.
      if (frame.data.decision.status === 'open' && teamProjects.value[frame.data.project.projectId]?.status === 'proposed') openDecisions.value = { ...openDecisions.value, [frame.data.decision.decisionId]: frame.data.decision };
      break;
    case 'project.updated':
      upsertProject(frame.data.project);
      break;
    case 'project.channel':
      mergeChannel(frame.data.entry.projectId, [frame.data.entry]);
      break;
    case 'decision.opened':
      if (frame.data.decision.status === 'open') openDecisions.value = { ...openDecisions.value, [frame.data.decision.decisionId]: frame.data.decision };
      break;
    case 'decision.resolved': {
      const { [frame.data.decision.decisionId]: _gone, ...rest } = openDecisions.value;
      openDecisions.value = rest;
      break;
    }
    case 'job.progress':
      patchJob(frame.data.jobId, { status: 'running', label: frame.data.label, step: frame.data.step, of: frame.data.of, ...(frame.data.partial ? { partial: frame.data.partial } : {}) }, frame.ts);
      break;
    case 'job.steered': {
      const job = jobs.value[frame.data.jobId];
      if (job) {
        const prev = job.steers.find((s) => s.steerId === frame.data.steerId);
        const others = job.steers.filter((s) => s.steerId !== frame.data.steerId);
        const steer = { steerId: frame.data.steerId, text: frame.data.text, status: frame.data.status, at: prev?.at ?? frame.ts, ...(frame.data.status === 'applied' ? { appliedAt: frame.ts } : {}) };
        patchJob(frame.data.jobId, { steers: [...others, steer].sort((a, b) => (a.at < b.at ? -1 : 1)) }, frame.ts);
      }
      break;
    }
    case 'job.done':
      patchJob(frame.data.jobId, { status: 'done', summary: frame.data.summary, result: frame.data.result, label: frame.data.finishedText, finishedAt: frame.ts }, frame.ts);
      break;
    case 'job.failed':
      patchJob(frame.data.jobId, { status: 'failed', error: { code: frame.data.code, message: frame.data.message }, finishedAt: frame.ts }, frame.ts);
      break;
    case 'job.cancelled':
      patchJob(frame.data.jobId, { status: 'cancelled', finishedAt: frame.ts }, frame.ts);
      break;
    case 'presence':
      presence.value = { ...presence.value, [frame.data.agentId]: frame.data };
      break;
    case 'workspace.updated':
      // Replayed history holds every earlier version (an earlier lead, no lead at all): only live changes (another
      // tab) apply. Current settings come from GET /api/workspace.
      if (live) acceptSettings(frame.data.settings);
      break;
    case 'error': {
      const d = frame.data;
      const owner = d.opId ? thread.value.find((m) => m.from === 'owner' && m.opId === d.opId && m.status !== undefined) : undefined;
      if (owner) {
        patchThread(owner.messageId, { status: 'failed', error: d.message });
        break;
      }
      upsertThread({
        messageId: `error:${d.turnId ?? d.opId ?? frame.ts}`,
        turnId: d.turnId ?? null,
        from: 'system',
        text: d.message,
        streaming: false,
        kind: 'error',
        ...(d.missingKeys?.length ? { missingKeys: d.missingKeys } : {}),
        ts: frame.ts,
      });
      break;
    }
    case 'voice.owner':
      applyServerVoice(frame.data);
      break;
    case 'ready':
      break;
  }
}
