// What the client knows about each agent it animates: the worker's expression profile (the single source), the
// AgentIndex built from it, the clip manifest, the mood (rebuilt from mood.changed and decayed locally with
// moodAt) and the attention view (from attention.changed). The Chief of Staff is loaded at boot and again when the
// lead or their name changes; a coworker on the first hover over their card.
import {
  buildAgentIndex,
  createMoodState,
  moodAt,
  type AgentExpressionProfile,
  type AgentIndex,
  type AttentionThread,
  type AttentionView,
  type ClipManifest,
  type CompiledCatalog,
  type Mailbox,
  type Mood,
  type MoodState,
  type TtsProvider,
} from '@headcount/expressions';
import type { AttentionChangedData, ExprAgentResponse, MoodChangedData } from '@headcount/protocol/ext/expressions';

export interface AgentEntry {
  resp: ExprAgentResponse;
  index: AgentIndex;
  manifest: ClipManifest;
}

export interface AgentsDeps {
  catalog: CompiledCatalog;
  fetchAgent(agentId: string): Promise<ExprAgentResponse>;
  now(): number;
  /** An agent was (re)loaded: its manifest or mood may have changed. */
  onLoaded?(entry: AgentEntry): void;
}

export interface Agents {
  load(agentId: string, opts?: { force?: boolean }): Promise<AgentEntry | null>;
  get(agentId: string): AgentEntry | null;
  index(agentId: string): AgentIndex | null;
  manifest(agentId: string): ClipManifest | null;
  provider(agentId: string): TtsProvider | null;
  /** A clip rendered at runtime joins the local manifest, so the next pick of that line finds it. */
  addClip(agentId: string, lineKey: string, clip: ClipManifest['clips'][string]): void;
  mood(agentId: string): Mood;
  moodState(agentId: string): MoodState | null;
  /** Agents with a known mood (their faces carry a palette). */
  withMood(): string[];
  applyMood(data: MoodChangedData): void;
  attention(agentId: string): AttentionView | null;
  applyAttention(data: AttentionChangedData): void;
  forget(agentId: string): void;
}

const NEUTRAL: Mood = { valence: 0, energy: 0 };

const MAILBOX_OF: Record<AttentionThread['kind'], Mailbox> = { talk: 'owner', desk: 'owner', sidethread: 'owner', meeting: 'floor', ask: 'coworker', work: 'work' };

/**
 * attention.changed → the runner's AttentionView. The frame carries no per-thread voice or floor claim, so none is
 * invented here: in Inc 0.5 the Chief's background threads are jobs, which never contend for the voice (H5, §8.1).
 */
export function attentionViewOf(data: AttentionChangedData, now: number): AttentionView {
  const thread = (t: NonNullable<AttentionChangedData['focus']>): AttentionThread => ({
    id: t.threadId,
    kind: t.kind,
    mailbox: MAILBOX_OF[t.kind],
    host: 'ws:local',
    label: t.label,
    voice: { speaking: false, untilMs: null },
    floorHeld: false,
    interruptible: t.kind === 'work' ? 'checkpoint' : 'sentence',
    since: now,
  });
  const until = data.voiceBusyUntil ? Date.parse(data.voiceBusyUntil) : NaN;
  return {
    agentId: data.agentId,
    focus: data.focus ? thread(data.focus) : null,
    background: data.background.map(thread),
    voiceBusyUntil: Number.isFinite(until) ? until : null,
    at: now,
  };
}

/** mood.changed → a MoodState that decays locally from the moment the server measured it. */
export function moodStateOf(data: MoodChangedData, reactivity: number): MoodState {
  return {
    ...createMoodState(data.agentId, data.baseline, reactivity, data.at),
    value: { valence: data.valence, energy: data.energy },
    lastKind: data.reason,
    lastCause: data.cause ?? null,
  };
}

export function createAgents(deps: AgentsDeps): Agents {
  const entries = new Map<string, AgentEntry>();
  const loading = new Map<string, Promise<AgentEntry | null>>();
  const moods = new Map<string, MoodChangedData>();
  const views = new Map<string, AttentionView>();

  async function fetchEntry(agentId: string): Promise<AgentEntry | null> {
    try {
      const resp = await deps.fetchAgent(agentId);
      const index = buildAgentIndex(deps.catalog, resp.profile as AgentExpressionProfile);
      const prev = entries.get(agentId);
      // Keep clips rendered at runtime that a stale response does not list yet.
      const clips = { ...(prev && prev.manifest.voiceKey === resp.manifest.voiceKey ? prev.manifest.clips : {}), ...resp.manifest.clips };
      const entry: AgentEntry = { resp, index, manifest: { ...(resp.manifest as ClipManifest), clips } };
      entries.set(agentId, entry);
      const known = moods.get(agentId);
      if (resp.mood && (!known || resp.mood.at > known.at)) moods.set(agentId, resp.mood);
      // No mood on the server (a new lead starts from its own baseline), or another persona behind this id now: the
      // old mood, baseline and face palette go.
      else if (!resp.mood || (prev && prev.resp.personaId !== resp.personaId)) moods.delete(agentId);
      if (resp.attention) views.set(agentId, attentionViewOf(resp.attention, deps.now()));
      deps.onLoaded?.(entry);
      return entry;
    } catch {
      return null;
    }
  }

  return {
    load(agentId, opts) {
      const have = entries.get(agentId);
      if (have && !opts?.force) return Promise.resolve(have);
      let p = loading.get(agentId);
      if (!p || opts?.force) {
        const next = fetchEntry(agentId).finally(() => {
          if (loading.get(agentId) === next) loading.delete(agentId);
        });
        loading.set(agentId, next);
        p = next;
      }
      return p;
    },
    get: (agentId) => entries.get(agentId) ?? null,
    index: (agentId) => entries.get(agentId)?.index ?? null,
    manifest: (agentId) => entries.get(agentId)?.manifest ?? null,
    provider: (agentId) => entries.get(agentId)?.resp.provider ?? null,
    addClip(agentId, lineKey, clip) {
      const e = entries.get(agentId);
      if (e) e.manifest = { ...e.manifest, clips: { ...e.manifest.clips, [lineKey]: clip } };
    },
    withMood: () => [...moods.keys()],
    moodState(agentId) {
      const data = moods.get(agentId);
      if (!data) return null;
      const e = entries.get(agentId);
      return moodStateOf(data, e?.resp.reactivity ?? e?.index.reactivity ?? 1);
    },
    mood(agentId) {
      const data = moods.get(agentId);
      const e = entries.get(agentId);
      if (data) return moodAt(moodStateOf(data, e?.resp.reactivity ?? 1), deps.now());
      return e ? { ...(e.resp.baseline ?? e.index.baseline) } : { ...NEUTRAL };
    },
    applyMood(data) {
      const known = moods.get(data.agentId);
      if (!known || data.at >= known.at) moods.set(data.agentId, data);
    },
    attention: (agentId) => views.get(agentId) ?? null,
    applyAttention(data) {
      views.set(data.agentId, attentionViewOf(data, deps.now()));
    },
    forget(agentId) {
      entries.delete(agentId);
      loading.delete(agentId);
    },
  };
}
