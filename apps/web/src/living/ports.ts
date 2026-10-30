// The runner's ports in the browser (LIVING-PLAN §5 B2): audio over the AudioEngine's reflex API (§3.6), faces over
// the face registry, captions over the caption signals, and runtime renders over POST /api/expr/render.
import type { AudioEngine, BrowserVoiceHint, PreparedAudio, SpeakerActivity } from '@headcount/audio';
import { fillKeyOf, type AudioBus, type PreparedClip, type ReflexAudioPort, type ReflexCaptionPort, type ReflexFacePort, type ReflexPlayHandle, type RenderRequest } from '@headcount/expressions';
import type { ExprClipRef, ExprRenderRequest } from '@headcount/protocol/ext/expressions';
import type { Agents } from './agents';
import { clearCaption, showCaption } from './captions';
import type { BudgetPause } from './budget-pause';
import type { WebClipStore } from './clips';
import { biasFace, cueFace } from './faces';

/** Heard time still to come for text that has streamed in but is not synthesised yet (≈ speaking rate). */
export const MS_PER_UNSYNTHESISED_CHAR = 65;
/** How long a browser-voice reflex may wait to start before it is dropped (the runner passes no TTL here). */
export const REFLEX_TEXT_TTL_MS = 1500;

export interface AudioPortDeps {
  engine(): AudioEngine;
  /** Characters of this agent's reply that have streamed in but are not synthesised yet (0 when none). */
  pendingChars(agentId: string): number;
  /** Inside a VAD pause of a live hold-to-talk recording (the only time a backchannel may sound). */
  inOwnerPause(): boolean;
  /** The browser voice for an agent's keyless reflexes. */
  voiceHint(agentId: string): BrowserVoiceHint | undefined;
}

const DROPPED: ReflexPlayHandle = Object.freeze({ started: Promise.resolve(false), done: Promise.resolve('dropped' as const), stop() {} });
/** A play that never starts (nothing sounds). */
export const DROPPED_PLAY: ReflexPlayHandle = DROPPED;

/** The engine has the Inc 0.5 reflex API (a hot-reloaded page can briefly run an older engine). */
function reflexCapable(e: AudioEngine): boolean {
  return typeof (e as Partial<AudioEngine>).playPrepared === 'function' && typeof (e as Partial<AudioEngine>).activity === 'function';
}

const IDLE: SpeakerActivity = { conversation: false, reflex: false, ambient: false, remainingMs: null, streamOpen: false };

export function activityOf(e: AudioEngine, agentId: string): SpeakerActivity {
  try {
    return reflexCapable(e) ? e.activity(agentId) : IDLE;
  } catch {
    return IDLE;
  }
}

/**
 * Is the agent's voice busy, and for how long? Busy while a conversation or a reflex sounds. While the reply's
 * stream is still open, text that has not been synthesised yet adds MS_PER_UNSYNTHESISED_CHAR per character.
 */
export function voiceBusyOf(a: SpeakerActivity, pendingChars: number): { busy: boolean; remainingMs: number | null; bus: AudioBus | null } {
  if (!a.conversation && !a.reflex) return { busy: false, remainingMs: null, bus: null };
  let remainingMs = a.remainingMs;
  if (a.conversation && a.streamOpen && pendingChars > 0) remainingMs = (remainingMs ?? 0) + MS_PER_UNSYNTHESISED_CHAR * pendingChars;
  return { busy: true, remainingMs, bus: a.conversation ? 'conversation' : 'reflex' };
}

export function createAudioPort(deps: AudioPortDeps): ReflexAudioPort {
  const engine = (): AudioEngine | null => {
    try {
      return deps.engine();
    } catch {
      return null;
    }
  };
  return {
    armed: () => engine()?.armed ?? false,
    // A live mic is the owner speaking, except inside a real pause (so a soft backchannel can land there, L5).
    ownerSpeaking: () => {
      const e = engine();
      return !!e && e.micLive() && !deps.inOwnerPause();
    },
    voiceBusy(agentId) {
      const e = engine();
      return e ? voiceBusyOf(activityOf(e, agentId), deps.pendingChars(agentId)) : { busy: false, remainingMs: null, bus: null };
    },
    foregroundActive() {
      const e = engine();
      try {
        return !!e && reflexCapable(e) && e.foregroundActive();
      } catch {
        return false;
      }
    },
    play(req) {
      const e = engine();
      const audio = req.clip.handle as PreparedAudio | null;
      if (!e || !audio || !reflexCapable(e)) return DROPPED;
      // Nothing but a backchannel ever sounds while the owner's mic is live (L5): a progress line, a celebration or an
      // acknowledgement arriving in a push-to-talk pause is dropped, never played into the open mic.
      const backchannel = req.intent === 'backchannel';
      const micLive = e.micLive();
      if (micLive && !backchannel) return DROPPED;
      // Priority 1 (juggling) while this agent's own answer sounds: it waits for the next sentence boundary.
      const interject = req.bus !== 'ambient' && req.priority <= 1 && activityOf(e, req.agentId).conversation;
      return e.playPrepared({
        speakerId: req.agentId,
        audio,
        bus: req.bus === 'ambient' ? 'ambient' : 'reflex',
        gainDb: req.gainDb,
        priority: req.priority,
        ttlMs: req.ttlMs,
        mode: interject ? 'interject' : 'now',
        // Only a backchannel inside a real pause gets here with the mic live (the gate and the check above stop the rest).
        duringOwner: micLive && backchannel,
        ...(req.onStart ? { onStart: req.onStart } : {}),
      });
    },
    speakText(agentId, text, opts) {
      const e = engine();
      if (!e || typeof (e as Partial<AudioEngine>).speakReflexText !== 'function') return null;
      const hint = deps.voiceHint(agentId);
      return e.speakReflexText({
        speakerId: agentId,
        text,
        bus: opts.bus === 'ambient' ? 'ambient' : 'reflex',
        priority: opts.priority,
        ttlMs: REFLEX_TEXT_TTL_MS,
        ...(hint ? { voiceHint: hint } : {}),
      });
    },
  };
}

export const facePort: ReflexFacePort = { cue: cueFace, bias: biasFace };

export const captionPort: ReflexCaptionPort = { show: showCaption, clear: clearCaption };

export interface RenderDeps {
  exprRender(req: ExprRenderRequest): Promise<ExprClipRef>;
  clips: WebClipStore;
  agents: Agents;
  /** Shared with pre-voicing: a budget refusal (429) stops render requests until the budget can have come back. */
  pause?: BudgetPause;
  now?(): number;
}

/** Runtime render (POST /api/expr/render) in the agent's own provider, then decode; null on any failure. */
export function createRender(deps: RenderDeps): (req: RenderRequest) => Promise<PreparedClip | null> {
  const now = deps.now ?? Date.now;
  return async (req) => {
    const provider = deps.agents.provider(req.agentId) ?? req.provider;
    if (provider === 'browser') return null; // nothing to render: the browser voice speaks the text
    if (deps.pause?.blocked(now())) return null; // budget spent: captions and faces only, no request
    try {
      const ref = await deps.exprRender({ agentId: req.agentId, lineId: req.lineId, fills: req.fills, provider });
      deps.agents.addClip(req.agentId, `${req.lineId}|${fillKeyOf(req.fills)}`, { clipKey: ref.clipKey, durationMs: ref.durationMs, scope: ref.scope });
      return await deps.clips.load(ref.clipKey);
    } catch (err) {
      deps.pause?.note(err, now());
      return null;
    }
  };
}
