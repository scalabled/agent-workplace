// Faces in the office (OFFICE-PHASE2 §4.5.4): the office asks for a face per person and tier; the app answers with
// FaceView (portrait or procedural fallback, state ring and glyph, the mouth on the audio engine's sampler above
// token size), registered so reflex cues and the mood palette reach it. Stored landmarks only: detection never runs
// in the office (budget §6).
import { FaceView } from '@headcount/avatar';
import type { FaceFactory, FaceSlot, FaceTier as OfficeTier, PresenceState as OfficeState } from '@headcount/office';
import type { FaceLandmarks, FaceTier, MouthSampler, PresenceState } from '@headcount/protocol';
import type { FaceCue } from '@headcount/protocol/ext/expressions';
import { presenceText, type FaceSubject } from '../components/Face';
import type { CueableFace } from '../living/faces';
import type { PortraitInfo } from '../lib/portraits';

/** The office's blocked and away read as available on a face (the office draws where someone is). */
export function toProtocolState(s: OfficeState): PresenceState {
  return s === 'blocked' || s === 'away' ? 'idle' : s;
}

/** What a face needs from the app (injected, so tests run without canvases or audio). */
export interface FaceDeps {
  subjectFor(agentId: string): FaceSubject | null;
  accentFor(hex: string): string;
  sampler(agentId: string): MouthSampler | null;
  portraitFor(id: string): Promise<PortraitInfo | null>;
  saveLandmarks(id: string, landmarks: FaceLandmarks): void;
  registerFace(agentId: string, face: CueableFace): () => void;
  /** Tests: a stand-in for FaceView. */
  createView?(opts: ConstructorParameters<typeof FaceView>[0]): FaceViewLike;
}

/** The FaceView methods the office uses. */
export type FaceViewLike = Pick<FaceView, 'mount' | 'setPortrait' | 'setAppearanceFallback' | 'setState' | 'attachSampler' | 'setTier' | 'cue' | 'setExpressionBias' | 'destroy'>;

export function createFaceFactory(deps: FaceDeps): FaceFactory {
  return (agentId: string, tier: OfficeTier): FaceSlot => {
    const subject = deps.subjectFor(agentId);
    const el = document.createElement('div');
    el.className = 'office-face';
    if (subject) el.style.setProperty('--accent', deps.accentFor(subject.accent));
    const opts = { tier: tier as FaceTier, detectLandmarks: false, ...(subject ? { name: subject.name, onLandmarks: (lm: FaceLandmarks) => deps.saveLandmarks(subject.id, lm) } : {}) };
    const view: FaceViewLike = deps.createView ? deps.createView(opts) : new FaceView(opts);
    if (subject) view.setAppearanceFallback({ appearance: subject.appearance, accent: subject.accent, name: subject.name });
    view.mount(el);
    let alive = true;
    if (subject)
      void deps
        .portraitFor(subject.id)
        .then((info) => {
          if (alive && info) void view.setPortrait(info);
        })
        .catch(() => undefined);
    const unregister = deps.registerFace(agentId, { cue: (c: FaceCue) => view.cue(c), setExpressionBias: (b) => view.setExpressionBias(b) });
    /** The mouth moves only on faces big enough to see it (tile and hero); tokens stay still. */
    const attach = (t: OfficeTier) => view.attachSampler(t === 'token' ? null : deps.sampler(agentId));
    attach(tier);
    return {
      el,
      drawsChrome: true,
      setTier(t) {
        view.setTier(t as FaceTier);
        attach(t);
      },
      setState(s, label) {
        const st = toProtocolState(s);
        view.setState(st, presenceText(subject, st, label));
      },
      cue(g) {
        view.cue({ gesture: g as FaceCue['gesture'], holdMs: 900 });
      },
      destroy() {
        alive = false;
        unregister();
        view.destroy();
        el.remove();
      },
    };
  };
}
