// What this tab tells the WorkspaceDO (INC05-PLAN §3.3): where the owner is (`viewer`, so event reflexes play
// only at an agent's stage someone is watching) and which lines it just played (`expr.recent`, so server picks
// avoid them). Both are fire-and-forget socket ops.
import { signal } from '@preact/signals';
import type { RecencySnapshot } from '@headcount/expressions';
import { CHIEF_ID, coworkerAgentId } from '@headcount/protocol';
import type { ExprRecentOp, ExprSurface, ViewerOp } from '@headcount/protocol/ext/expressions';
import type { CurrentRoute } from '../router';

export const VIEWER_DEBOUNCE_MS = 250;
export const RECENT_MIN_GAP_MS = 10_000;
export const RECENT_MAX_PER_AGENT = 32;
/**
 * Only lines played this recently go to the server: the op carries line ids only, and the server stamps what it
 * learns as just played (a line from days ago would crowd out what is pre-voiced).
 */
export const RECENT_WINDOW_MS = 30 * 60_000;

/** Where the owner is inside the Office view (OFFICE-PHASE2 §4.5.13): a conference room or a joined huddle's room. */
export interface OfficeStage {
  mode: 'desks' | 'conference';
  roomId: string | null;
}

/** Set by the mounted Office (its mode changes); null when the Office is not on screen. */
export const officeStage = signal<OfficeStage | null>(null);

/**
 * The stage the route puts the owner at: Talk is the Chief's, a coworker's profile is their desk, and the Floor is the
 * Floor, or a room while the Office's conference stage is open.
 */
export function stageOf(route: Pick<CurrentRoute, 'name' | 'params'>, office?: OfficeStage | null): { surface: ExprSurface; stageAgentId: string | null } {
  if (route.name === 'floor' && office?.mode === 'conference' && office.roomId) return { surface: 'room', stageAgentId: null };
  switch (route.name) {
    case 'talk':
      return { surface: 'talk', stageAgentId: CHIEF_ID };
    case 'coworker':
      return route.params.personaId ? { surface: 'desk', stageAgentId: coworkerAgentId(route.params.personaId) } : { surface: 'elsewhere', stageAgentId: null };
    case 'floor':
      return { surface: 'floor', stageAgentId: null };
    default:
      return { surface: 'elsewhere', stageAgentId: null };
  }
}

export interface ViewerInput {
  route: Pick<CurrentRoute, 'name' | 'params'>;
  audioArmed: boolean;
  voiceOn: boolean;
  pageVisible: boolean;
  reducedMotion: boolean;
  quietHours: boolean;
  tzOffsetMin: number;
  /** An agent's conversation audio sounding in this tab, until when (epoch ms). */
  voice: { agentId: string; untilMs: number } | null;
  /** The Office's mode on the Floor (a room reports `surface: 'room'`). */
  office?: OfficeStage | null;
}

export function viewerOp(i: ViewerInput): ViewerOp {
  const { surface, stageAgentId } = stageOf(i.route, i.office);
  return {
    op: 'viewer',
    surface,
    stageAgentId,
    floorVisible: surface === 'floor',
    visibleProjectIds: [],
    listeningProjectIds: [],
    audioArmed: i.audioArmed,
    voiceOn: i.voiceOn,
    pageVisible: i.pageVisible,
    reducedMotion: i.reducedMotion,
    quietHours: i.quietHours,
    tzOffsetMin: i.tzOffsetMin,
    // Whole seconds: an estimate that holds steady does not resend the op on every tick.
    voice: i.voice ? { agentId: i.voice.agentId, untilMs: Math.ceil(i.voice.untilMs / 1000) * 1000 } : null,
  };
}

/** The line ids each agent played in the last RECENT_WINDOW_MS, newest first (≤ 32 per agent). */
export function recentOp(snapshot: RecencySnapshot, max = RECENT_MAX_PER_AGENT, now?: number): ExprRecentOp {
  const agents: Record<string, string[]> = {};
  for (const [agentId, list] of Object.entries(snapshot.agents)) {
    const ids = [...list]
      .filter((e) => now === undefined || (e.at <= now && now - e.at <= RECENT_WINDOW_MS))
      .sort((a, b) => b.at - a.at)
      .map((e) => e.lineId);
    const unique = [...new Set(ids)].slice(0, max);
    if (unique.length) agents[agentId] = unique;
  }
  return { op: 'expr.recent', agents };
}

export interface OpSender {
  /** Queue the latest viewer state; sent after VIEWER_DEBOUNCE_MS when it changed (or at once when `force`). */
  viewer(op: ViewerOp, force?: boolean): void;
  /** Send recency when it changed, at most every RECENT_MIN_GAP_MS (or at once when `force`, after a connect). */
  recent(op: ExprRecentOp, force?: boolean): void;
  dispose(): void;
}

export function createOpSender(send: (op: ViewerOp | ExprRecentOp) => void, clock: { now(): number; schedule(fn: () => void, ms: number): () => void }): OpSender {
  let lastViewer = '';
  let pendingViewer: ViewerOp | null = null;
  let cancelViewer: (() => void) | null = null;
  let lastRecent = '';
  let lastRecentAt = Number.NEGATIVE_INFINITY;
  let pendingRecent: ExprRecentOp | null = null;
  let cancelRecent: (() => void) | null = null;

  const flushViewer = () => {
    cancelViewer = null;
    const op = pendingViewer;
    pendingViewer = null;
    if (!op) return;
    const json = JSON.stringify(op);
    if (json === lastViewer) return;
    lastViewer = json;
    send(op);
  };

  const flushRecent = () => {
    cancelRecent = null;
    const op = pendingRecent;
    pendingRecent = null;
    if (!op) return;
    const json = JSON.stringify(op.agents);
    if (json === lastRecent) return;
    lastRecent = json;
    lastRecentAt = clock.now();
    send(op);
  };

  return {
    viewer(op, force) {
      pendingViewer = op;
      if (force) {
        lastViewer = '';
        cancelViewer?.();
        flushViewer();
        return;
      }
      cancelViewer ??= clock.schedule(flushViewer, VIEWER_DEBOUNCE_MS);
    },
    recent(op, force) {
      pendingRecent = op;
      if (force) {
        lastRecent = '';
        cancelRecent?.();
        flushRecent();
        return;
      }
      if (cancelRecent) return;
      const wait = Math.max(0, lastRecentAt + RECENT_MIN_GAP_MS - clock.now());
      cancelRecent = clock.schedule(flushRecent, wait);
    },
    dispose() {
      cancelViewer?.();
      cancelRecent?.();
      cancelViewer = cancelRecent = null;
    },
  };
}
