// Real state in the office (OFFICE-PHASE2 §4.5.5): faces are the status UI. Presence from the store reaches the scene
// (diffed, so a frame costs one comparison per agent), speaking follows the audio actually playing in this tab, and
// real work overrides ambient life: the Chief's running job shows as work at their place (monitor lit, the running
// sentence as the status; the server never claims the Chief busy, D2) and sets their activity (research walks them to
// the library), coworkers staffed on a running team project show their step as work (reviewers think), and anyone
// the owner is talking to stays where they are while the conversation lasts and 20 s after. People in a live meeting
// gather at the lounge round the Chief of Staff, who moderates, until it ends.
import { effect, type ReadonlySignal } from '@preact/signals';
import { activityOf, type OfficeLife, type OfficeScene, type PresenceBadge, type PresenceState, type WorkActivity } from '@headcount/office';
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
export function shownClaim(server: PresenceData | undefined, local: { listening?: boolean } | undefined, work?: TeamWorkClaim | { label: string } | null): ShownClaim {
  const claims: { state: PresenceState; label: string }[] = [];
  if (local?.listening) claims.push({ state: 'listening', label: DEFAULT_LABELS.listening! });
  if (server) claims.push({ state: server.state, label: server.label || DEFAULT_LABELS[server.state] || '' });
  if (work) {
    const state = 'state' in work ? work.state : 'working';
    claims.push({ state, label: work.label || DEFAULT_LABELS[state]! });
  }
  const m = mergePresence(claims as { state: Exclude<PresenceState, 'blocked' | 'away'>; label: string }[]) ?? { state: 'idle' as const, label: DEFAULT_LABELS.idle! };
  return { state: m.state, label: m.label, badges: server?.badges?.slice() ?? [] };
}

/** A staffed coworker's part in a running team project (the store's teamWork). */
export interface TeamWorkClaim {
  state: 'working' | 'thinking' | 'raised_hand';
  label: string;
}

export interface PresenceBindingDeps {
  scene: Pick<OfficeScene, 'setPresence' | 'setSpeaking'>;
  /** Office life, once it runs (it starts after the people arrive). */
  life: ReadonlySignal<OfficeLife | null>;
  presence: ReadonlySignal<Record<string, PresenceData>>;
  localPresence: ReadonlySignal<Record<string, { speaking?: boolean; listening?: boolean }>>;
  jobs: ReadonlySignal<Record<string, JobSnapshot>>;
  /** Coworkers on running team projects, keyed by agent id (Inc 1). */
  teamWork?: ReadonlySignal<Record<string, TeamWorkClaim>>;
  /** The Chief's merged state (Talk's): thinking, speaking or listening means a conversation. */
  chiefState: ReadonlySignal<string>;
  /** Meetings live now (agent ids at the table, the Chief first), and where people can gather. */
  meetings?: ReadonlySignal<readonly { meetingId: string; agentIds: readonly string[] }[]>;
  gatherSpots?(): readonly { id: string; kind: string; slots: readonly unknown[] }[];
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
      const team = d.teamWork?.value ?? {};
      const ids = [...Object.keys(server), ...Object.keys(local), ...applied.keys(), ...Object.keys(team), ...(work ? [CHIEF_ID] : [])];
      for (const id of new Set(ids)) {
        const c = shownClaim(server[id], local[id], id === CHIEF_ID ? work : (team[id] ?? null));
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

  // ── real work → where they work (the Chief's running job, team steps) ──
  let activities = new Map<string, WorkActivity | null>();
  let activityLife: OfficeLife | null = null;
  disposers.push(
    effect(() => {
      const life = d.life.value;
      const running = chiefJob(d.jobs.value);
      const next = new Map<string, WorkActivity | null>([[CHIEF_ID, running ? activityOf(running.label) : null]]);
      for (const [id, w] of Object.entries(d.teamWork?.value ?? {})) if (w.state === 'working') next.set(id, activityOf(w.label));
      const fresh = life !== activityLife;
      for (const [id, a] of next) if (fresh || activities.get(id) !== a) life?.setActivity(id, a);
      for (const id of activities.keys()) if (!next.has(id)) life?.setActivity(id, null);
      activities = next;
      activityLife = life;
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
  // ── a live meeting gathers its people at a lounge (one place per meeting), released when it ends ──
  const gathered = new Map<string, () => void>();
  let gatherLife: OfficeLife | null = null;
  if (d.meetings && d.gatherSpots)
    disposers.push(
      effect(() => {
        const life = d.life.value;
        const live = d.meetings!.value.slice(0, 2);
        if (life !== gatherLife) {
          for (const u of gathered.values()) u();
          gathered.clear();
          gatherLife = life;
        }
        if (!life) return;
        const spots = [...d.gatherSpots!()].filter((sp) => sp.kind === 'lounge' || sp.kind === 'library' || sp.kind === 'coffee_bar').sort((a, b) => b.slots.length - a.slots.length);
        const want = new Map<string, { spotId: string; slot: number }>();
        live.forEach((m, i) => {
          const sp = spots[i];
          if (!sp) return;
          m.agentIds.slice(0, sp.slots.length).forEach((id, slot) => want.set(`${m.meetingId}|${id}`, { spotId: sp.id, slot }));
        });
        for (const [key, unpin] of gathered) {
          if (want.has(key)) continue;
          unpin();
          gathered.delete(key);
        }
        for (const [key, at] of want) if (!gathered.has(key)) gathered.set(key, life.pin(key.split('|')[1]!, { kind: 'spot', spotId: at.spotId, slot: at.slot }, 'host'));
      }),
    );
  disposers.push(() => {
    for (const u of gathered.values()) u();
    gathered.clear();
  });
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
