// Listen in: the huddle the owner listens to speaks its small talk in
// the speakers' own voices, on the ambient bus at −6 dB. Listening is the owner asking to hear them (D5: owner-directed
// talk is exempt from the ambient budget), so it voices at Quiet too and does not spend the shared ambient window; its
// own budget (90 s of voice per 10 minutes) keeps a long listen from running on. One voice per workspace: only the tab
// that may voice plays anything, checked when the render comes back too. Keyless is captions only; a render later
// than 1.2 s plays nothing (the bubble shows either way); a line never queues behind a conversation.
import type { AudioEngine, PreparedAudio } from '@headcount/audio';
import type { HuddlePick } from '@headcount/expressions';
import type { Ambience, HuddleInfo, HuddleLineEvent } from '@headcount/office';
import { CHIEF_ID, type AgentId } from '@headcount/protocol';
import type { ExprClipRef, ExprTtsProvider } from '@headcount/protocol/ext/expressions';
import type { ExprHuddleRenderRequest } from '@headcount/protocol/ext/rooms';
import type { LivingRuntime } from '../living/types';

export const LISTEN_RENDER_TIMEOUT_MS = 1200;
export const LISTEN_GAIN_DB = -6;
export const LISTEN_PRIORITY = 4;
export const LISTEN_TTL_MS = 1200;
/** Listen's own budget: this much voiced small talk per rolling window. */
export const LISTEN_BUDGET_MS = 90_000;
export const LISTEN_WINDOW_MS = 600_000;

export interface ListenDeps {
  living(): LivingRuntime | null;
  mayVoice(): boolean;
  claimUnsettled(): boolean;
  voiceOn(): boolean;
  ambience(): Ambience;
  engine(): Pick<AudioEngine, 'armed' | 'micLive' | 'foregroundActive' | 'playPrepared'> | null;
  pickOf(exchangeId: string): HuddlePick | null;
  render(req: ExprHuddleRenderRequest, signal: AbortSignal): Promise<ExprClipRef>;
  now?(): number;
  setTimer?(fn: () => void, ms: number): () => void;
}

/** Why a line was not voiced (tests and the dev hook). */
export type ListenSkip = 'not_listening' | 'no_voice' | 'unsettled' | 'voice_off' | 'not_armed' | 'keyless' | 'not_voiceable' | 'mic' | 'conversation' | 'budget' | 'no_runtime' | 'late' | 'failed';

export interface Listen {
  /** onListenIn: the huddle now listened to (null: nobody). */
  setListening(h: HuddleInfo | null): void;
  /** onHuddleLine: voice it when the owner listens and every gate allows. Returns why not, or null when it plays. */
  line(h: HuddleInfo, e: HuddleLineEvent): Promise<ListenSkip | null>;
  destroy(): void;
}

const defaultTimer = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export function createListen(d: ListenDeps): Listen {
  const now = d.now ?? Date.now;
  const setTimer = d.setTimer ?? defaultTimer;
  let listening: string | null = null;
  let destroyed = false;
  const inflight = new Set<AbortController>();
  /** Voiced listen-in audio: when it started and how long it was (Listen's own window). */
  const heard: { at: number; ms: number }[] = [];
  const leftMs = () => {
    const t = now();
    while (heard.length && t - heard[0]!.at > LISTEN_WINDOW_MS) heard.shift();
    return LISTEN_BUDGET_MS - heard.reduce((n, x) => n + x.ms, 0);
  };

  /** Every gate that does not need the render (§4.5.10 step 1). */
  const gate = (agentId: string, estMs: number, voiceable: boolean): ListenSkip | { rt: LivingRuntime; provider: ExprTtsProvider } => {
    if (!d.mayVoice()) return 'no_voice';
    if (d.claimUnsettled()) return 'unsettled';
    if (!d.voiceOn()) return 'voice_off';
    const e = d.engine();
    if (!e?.armed) return 'not_armed';
    const rt = d.living();
    if (!rt) return 'no_runtime';
    const provider = rt.provider(agentId) ?? rt.provider(CHIEF_ID);
    if (!provider || provider === 'browser') return 'keyless';
    if (!voiceable) return 'not_voiceable';
    if (e.micLive()) return 'mic';
    if (e.foregroundActive()) return 'conversation';
    if (leftMs() < estMs) return 'budget';
    return { rt, provider };
  };

  return {
    setListening(h) {
      listening = h?.id ?? null;
      if (!listening) for (const c of inflight) c.abort();
    },
    async line(h, e) {
      if (destroyed || !e.listening || listening !== h.id) return 'not_listening';
      if (e.line.kind === 'face' || !e.line.text) return 'not_voiceable';
      const pick = d.pickOf(e.exchangeId);
      const plan = pick?.lines.find((l) => l.index === e.index) ?? null;
      const agentId = e.line.personId;
      const first = gate(agentId, plan?.estMs ?? e.line.estMs, !!plan?.voiceable);
      if (typeof first === 'string') return first;
      const started = now();
      const ctrl = new AbortController();
      inflight.add(ctrl);
      const cancel = setTimer(() => ctrl.abort(), LISTEN_RENDER_TIMEOUT_MS);
      try {
        const ref = await d.render({ exchangeId: e.exchangeId, index: e.index, agentId: agentId as AgentId, fills: { ...plan!.fills }, provider: first.provider }, ctrl.signal);
        if (ctrl.signal.aborted) return 'late';
        const clip = await first.rt.loadClip(ref.clipKey);
        if (!clip) return 'failed';
        if (destroyed || ctrl.signal.aborted || now() - started > LISTEN_RENDER_TIMEOUT_MS || listening !== h.id) return 'late';
        // The world may have changed while it rendered: every gate again, at the moment it would start.
        const again = gate(agentId, clip.durationMs, true);
        if (typeof again === 'string') return again;
        const engine = d.engine();
        if (!engine) return 'not_armed';
        const handle = engine.playPrepared({
          speakerId: agentId,
          audio: clip.handle as PreparedAudio,
          bus: 'ambient',
          gainDb: LISTEN_GAIN_DB,
          priority: LISTEN_PRIORITY,
          ttlMs: LISTEN_TTL_MS,
          onStart: () => void heard.push({ at: now(), ms: clip.durationMs }),
        });
        void handle.started.catch(() => false);
        return null;
      } catch {
        return ctrl.signal.aborted ? 'late' : 'failed';
      } finally {
        cancel();
        inflight.delete(ctrl);
      }
    },
    destroy() {
      destroyed = true;
      listening = null;
      for (const c of inflight) c.abort();
      inflight.clear();
    },
  };
}
