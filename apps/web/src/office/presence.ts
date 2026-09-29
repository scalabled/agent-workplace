// Real state in the office (OFFICE-PHASE2 §4.5.5): faces are the status UI. Presence from the store reaches the scene
// (diffed, so a frame costs one comparison per agent), speaking follows the audio actually playing in this tab, and
// real work overrides ambient life: the Chief's running job shows as work at their place (monitor lit, the running
// sentence as the status; the server never claims the Chief busy, D2) and sets their activity (research walks them to
// the library), and anyone the owner is talking to stays where they are while the conversation lasts and 20 s after.
import { effect, type ReadonlySignal } from '@preact/signals';
import { activityOf, type OfficeLife, type OfficeScene, type PresenceBadge, type PresenceState } from '@headcount/office';
import { CHIEF_ID, mergePresence, type JobSnapshot, type PresenceData } from '@headcount/protocol';

/** A person stays pinned this long after the owner stops talking with them. */
export const UNPIN_AFTER_MS = 20_000;

const DEFAULT_LABELS: Record<string, string> = {
  idle: 'Available',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  working: 'Working',
  raised_hand: 'Waiting on you',
};

export interface ShownClaim {
  state: PresenceState;
  label: string;
  badges: PresenceBadge[];
}

/**
 * The server's claim merged with local listening (local speaking is the office's own speaking halo, never a state) and,
 * for the Chief, their running job as work (the lowest claim: a conversation still shows as thinking or listening).
 */
export function shownClaim(server: PresenceData | undefined, local: { listening?: boolean } | undefined, work?: { label: string } | null): ShownClaim {
  const claims: { state: PresenceState; label: string }[] = [];
  if (local?.listening) claims.push({ state: 'listening', label: DEFAULT_LABELS.listening! });
  if (server) claims.push({ state: server.state, label: server.label || DEFAULT_LABELS[server.state] || '' });
  if (work) claims.push({ state: 'working', label: work.label || DEFAULT_LABELS.working! });
  const m = mergePresence(claims as { state: Exclude<PresenceState, 'blocked' | 'away'>; label: string }[]) ?? { state: 'idle' as const, label: DEFAULT_LABELS.idle! };
  return { state: m.state, label: m.label, badges: server?.badges?.slice() ?? [] };
}

export interface PresenceBindingDeps {
  scene: Pick<OfficeScene, 'setPresence' | 'setSpeaking'>;
  /** Office life, once it runs (it starts after the people arrive). */
  life: ReadonlySignal<OfficeLife | null>;
  presence: ReadonlySignal<Record<string, PresenceData>>;
  localPresence: ReadonlySignal<Record<string, { speaking?: boolean; listening?: boolean }>>;
  jobs: ReadonlySignal<Record<string, JobSnapshot>>;
  /** The Chief's merged state (Talk's): thinking, speaking or listening means a conversation. */
  chiefState: ReadonlySignal<string>;
  /** Whose bubble has its reply field open (a quick chat). */
  replying: ReadonlySignal<string | null>;
  /** Everyone the scene shows (ids). */
  ids(): readonly string[];
  onSpeakingChange(cb: (id: string, on: boolean) => void): () => void;
  speakingNow(): readonly string[];
  schedule?(fn: () => void, ms: number): () => void;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/** Wire presence, speaking and the real-state pins; returns the teardown. */
export function bindPresence(d: PresenceBindingDeps): () => void {
  const schedule = d.schedule ?? defaultSchedule;
  const disposers: (() => void)[] = [];
  const applied = new Map<string, string>();

  // ── presence → scene (diffed) ──
  disposers.push(
    effect(() => {
      const server = d.presence.value;
      const local = d.localPresence.value;
      const work = chiefJob(d.jobs.value);
      const seen = new Set<string>();
      const ids = [...Object.keys(server), ...Object.keys(local), ...applied.keys(), ...(work ? [CHIEF_ID] : [])];
      for (const id of new Set(ids)) {
        seen.add(id);
        const c = shownClaim(server[id], local[id], id === CHIEF_ID ? work : null);
        const key = `${c.state}|${c.label}|${c.badges.join(',')}`;
        if (applied.get(id) === key) continue;
        if (!applied.has(id) && c.state === 'idle' && !c.badges.length && !server[id]) continue;
        applied.set(id, key);
        d.scene.setPresence(id, c.state, { label: c.label, badges: c.badges });
      }
    }),
  );

  // ── speaking: the audio actually playing in this tab ──
  for (const id of d.speakingNow()) d.scene.setSpeaking(id, true);
  disposers.push(d.onSpeakingChange((id, on) => d.scene.setSpeaking(id, on)));

  // ── the Chief's running job → where they work ──
  let activityKey = '';
  disposers.push(
    effect(() => {
      const life = d.life.value;
      const running = chiefJob(d.jobs.value);
      const activity = running ? activityOf(running.label) : null;
      const key = `${life ? 1 : 0}|${activity ?? ''}`;
      if (key === activityKey) return;
      activityKey = key;
      life?.setActivity(CHIEF_ID, activity);
    }),
  );

  // ── pins: the owner is talking with them ──
  const pins = new Map<string, { unpin: () => void; cancel: (() => void) | null }>();
  const pin = (id: string) => {
    const life = d.life.peek();
    if (!life) return;
    const cur = pins.get(id);
    if (cur) {
      cur.cancel?.();
      cur.cancel = null;
      return;
    }
    pins.set(id, { unpin: life.pin(id, 'here', 'owner'), cancel: null });
  };
  const release = (id: string) => {
    const cur = pins.get(id);
    if (!cur || cur.cancel) return;
    cur.cancel = schedule(() => {
      pins.delete(id);
      cur.unpin();
    }, UNPIN_AFTER_MS);
  };
  disposers.push(
    effect(() => {
      void d.life.value;
      const s = d.chiefState.value;
      if (s === 'thinking' || s === 'speaking' || s === 'listening') pin(CHIEF_ID);
      else release(CHIEF_ID);
    }),
  );
  let replyingTo: string | null = null;
  disposers.push(
    effect(() => {
      void d.life.value;
      const id = d.replying.value;
      if (replyingTo && replyingTo !== id && !(replyingTo === CHIEF_ID && isTalking(d.chiefState.peek()))) release(replyingTo);
      replyingTo = id;
      if (id) pin(id);
    }),
  );

  return () => {
    for (const x of disposers.splice(0)) x();
    for (const p of pins.values()) {
      p.cancel?.();
      p.unpin();
    }
    pins.clear();
  };
}

const isTalking = (s: string) => s === 'thinking' || s === 'speaking' || s === 'listening';

/** The Chief's most recent running (or queued) job, if any. */
export function chiefJob(jobs: Record<string, JobSnapshot>): JobSnapshot | null {
  let best: JobSnapshot | null = null;
  for (const j of Object.values(jobs)) {
    if (j.status !== 'running' && j.status !== 'queued') continue;
    if (j.agentId && j.agentId !== CHIEF_ID) continue;
    if (!best || j.startedAt > best.startedAt) best = j;
  }
  return best;
}
