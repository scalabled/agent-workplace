// The `viewer` and `expr.recent` socket ops (docs/dev/INC05-PLAN.md §3.3, §4 A6): strict validation, and what a
// socket attachment holds. Attachments survive hibernation (and must stay under 2 KB), so lists are capped.
import type { ViewerState } from '@headcount/expressions';
import type { ExprRecentOp, ExprSurface, ViewerOp } from '@headcount/protocol/ext/expressions';

const SURFACES = new Set<ExprSurface>(['talk', 'desk', 'floor', 'room', 'elsewhere']);
const AGENT_ID = /^cw_[a-z0-9][a-z0-9_-]{0,80}$/;
const PROJECT_ID = /^[A-Za-z0-9_:-]{1,64}$/;
const LINE_ID = /^[A-Za-z0-9_.:~-]{1,120}$/;
const MAX_PROJECTS = 12;
const MAX_RECENT_AGENTS = 24;
const MAX_RECENT_LINES = 32;

/** What a feed socket's attachment holds (serializeAttachment). */
export interface SocketAttachment {
  viewer?: ViewerOp;
  /** Epoch ms of the last viewer op. */
  at?: number;
}

const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

function ids(v: unknown, re: RegExp, max: number): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || !re.test(x)) return null;
    if (!out.includes(x)) out.push(x);
  }
  return out.slice(0, max);
}

/** A validated `viewer` op, or null when any field is missing or malformed (the op is then ignored). */
export function parseViewerOp(raw: unknown): ViewerOp | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.op !== 'viewer' || typeof o.surface !== 'string' || !SURFACES.has(o.surface as ExprSurface)) return null;
  const stage = o.stageAgentId === null ? null : typeof o.stageAgentId === 'string' && AGENT_ID.test(o.stageAgentId) ? o.stageAgentId : undefined;
  if (stage === undefined) return null;
  const flags = ['floorVisible', 'audioArmed', 'voiceOn', 'pageVisible', 'reducedMotion', 'quietHours'].map((k) => bool(o[k]));
  if (flags.some((f) => f === null)) return null;
  const visible = ids(o.visibleProjectIds, PROJECT_ID, MAX_PROJECTS);
  const listening = ids(o.listeningProjectIds, PROJECT_ID, MAX_PROJECTS);
  if (!visible || !listening) return null;
  const tz = o.tzOffsetMin;
  if (typeof tz !== 'number' || !Number.isInteger(tz) || tz < -14 * 60 || tz > 14 * 60) return null;
  let voice: ViewerOp['voice'] = null;
  if (o.voice !== null) {
    const v = o.voice as Record<string, unknown> | undefined;
    if (!v || typeof v !== 'object' || typeof v.agentId !== 'string' || !AGENT_ID.test(v.agentId) || typeof v.untilMs !== 'number' || !Number.isFinite(v.untilMs)) return null;
    voice = { agentId: v.agentId, untilMs: Math.floor(v.untilMs) };
  }
  const [floorVisible, audioArmed, voiceOn, pageVisible, reducedMotion, quietHours] = flags as boolean[];
  return {
    op: 'viewer',
    surface: o.surface as ExprSurface,
    stageAgentId: stage,
    floorVisible: floorVisible!,
    visibleProjectIds: visible,
    listeningProjectIds: listening,
    audioArmed: audioArmed!,
    voiceOn: voiceOn!,
    pageVisible: pageVisible!,
    reducedMotion: reducedMotion!,
    quietHours: quietHours!,
    tzOffsetMin: tz,
    voice,
  };
}

/** A validated `expr.recent` op (≤ 24 agents, ≤ 32 line ids each), or null. */
export function parseRecentOp(raw: unknown): ExprRecentOp | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.op !== 'expr.recent' || !o.agents || typeof o.agents !== 'object' || Array.isArray(o.agents)) return null;
  const agents: Record<string, string[]> = {};
  for (const [agentId, list] of Object.entries(o.agents as Record<string, unknown>).slice(0, MAX_RECENT_AGENTS)) {
    if (!AGENT_ID.test(agentId)) return null;
    const lines = ids(list, LINE_ID, MAX_RECENT_LINES);
    if (!lines) return null;
    agents[agentId] = lines;
  }
  return { op: 'expr.recent', agents };
}

/** The engine's view of a viewer (planServerReflex). */
export function viewerStateOf(v: ViewerOp): ViewerState {
  return {
    surface: v.surface,
    stageAgentId: v.stageAgentId,
    floorVisible: v.floorVisible,
    visibleProjectIds: v.visibleProjectIds,
    listeningProjectIds: v.listeningProjectIds,
    audioArmed: v.audioArmed,
    voiceOn: v.voiceOn,
    pageVisible: v.pageVisible,
  };
}

/** Someone is at agent X's stage: Talk (the Chief) or X's desk, on a visible page. */
export function atStage(v: ViewerOp, agentId: string): boolean {
  return (v.surface === 'talk' || v.surface === 'desk') && v.stageAgentId === agentId && v.pageVisible;
}

/** Owner-local clock parts for a `Date.prototype.getTimezoneOffset()` value (minutes west of UTC). */
export function ownerClock(now: number, tzOffsetMin: number): { epochMs: number; localHour: number; weekday: number; dayKey: string } {
  const local = new Date(now - tzOffsetMin * 60_000);
  return { epochMs: now, localHour: local.getUTCHours(), weekday: local.getUTCDay(), dayKey: local.toISOString().slice(0, 10) };
}
