// Preact wrapper around the avatar package's FaceView: faces are the status UI.
// Procedural face from catalog appearance at once; the photoreal portrait replaces it when one exists.
import { useEffect, useRef, useState } from 'preact/hooks';
import { FaceView } from '@headcount/avatar';
import { initials, type Appearance, type Lead, type PersonaSlim } from '@headcount/catalog';
import type { FaceTier, MouthSampler, PresenceState } from '@headcount/protocol';
import { portraitEpoch, portraitFor, saveLandmarks } from '../lib/portraits';
import { accentFor } from '../lib/accent';
import { registerFace } from '../living/faces';

export interface FaceSubject {
  /** Portrait id: catalog persona id or lead id. */
  id: string;
  name: string;
  accent: string;
  appearance: Appearance;
}

export const leadSubject = (l: Lead, name?: string): FaceSubject => ({ id: l.id, name: name ?? l.name, accent: l.avatar.accent_color, appearance: l.avatar.appearance });
export const personaSubject = (p: PersonaSlim): FaceSubject => ({ id: p.id, name: p.name, accent: p.avatar.accent_color, appearance: p.avatar.appearance });

export interface FaceProps {
  subject: FaceSubject | null | undefined;
  tier: FaceTier;
  state?: PresenceState;
  /** Accessible label; default "{name}, {state}". */
  label?: string;
  sampler?: MouthSampler | null;
  /** Mount only once scrolled into view (long lists). */
  lazy?: boolean;
  /** Hide from assistive tech when adjacent text already names the person. */
  decorative?: boolean;
  class?: string;
  /** The agent this face belongs to: reflex gestures and their mood reach it (the living workforce). */
  agentId?: string;
}

export function Face({ subject, tier, state = 'idle', label, sampler = null, lazy = false, decorative = false, class: cls, agentId }: FaceProps) {
  const host = useRef<HTMLDivElement>(null);
  const face = useRef<FaceView | null>(null);
  const subjectId = useRef<string | undefined>(subject?.id);
  subjectId.current = subject?.id;
  const [visible, setVisible] = useState(!lazy || typeof IntersectionObserver === 'undefined');
  const [mounted, setMounted] = useState(false);
  const epoch = portraitEpoch.value;

  // Lazy: mount when near the viewport.
  useEffect(() => {
    if (visible || !host.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(host.current);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !host.current) return;
    let view: FaceView | null = null;
    try {
      view = new FaceView({
        tier,
        // Seeds blink and sway per person (the default name would put every face in lockstep).
        ...(subject ? { name: subject.name } : {}),
        onLandmarks: (lm) => {
          if (subjectId.current) saveLandmarks(subjectId.current, lm);
        },
      });
      // Configure before mounting so the very first frame (a still token draws only once) is right.
      if (subject) view.setAppearanceFallback({ appearance: subject.appearance, accent: subject.accent, name: subject.name });
      view.setState(state, presenceText(subject, state, label));
      view.attachSampler(sampler);
      view.mount(host.current);
      face.current = view;
      setMounted(true);
    } catch (err) {
      console.warn('face unavailable', err);
    }
    return () => {
      view?.destroy();
      face.current = null;
      setMounted(false);
    };
  }, [visible]);

  useEffect(() => void face.current?.setTier(tier), [tier, mounted]);

  useEffect(() => {
    if (subject) face.current?.setAppearanceFallback({ appearance: subject.appearance, accent: subject.accent, name: subject.name });
  }, [subject?.id, subject?.name, mounted]);

  useEffect(() => {
    if (!subject || !mounted) return;
    let alive = true;
    void portraitFor(subject.id).then((info) => {
      if (alive && info) void face.current?.setPortrait(info);
    });
    return () => {
      alive = false;
    };
  }, [subject?.id, mounted, epoch]);

  useEffect(() => face.current?.setState(state, presenceText(subject, state, label)), [state, label, subject?.name, mounted]);

  useEffect(() => face.current?.attachSampler(sampler), [sampler, mounted]);

  useEffect(() => {
    const view = face.current;
    if (!agentId || !view || !mounted) return;
    // Optional calls: a hot-reloaded page can briefly hold an older FaceView without the reflex API.
    return registerFace(agentId, { cue: (c) => view.cue?.(c), setExpressionBias: (b) => view.setExpressionBias?.(b) });
  }, [agentId, mounted]);

  return (
    <div
      ref={host}
      class={`face face-${tier}${cls ? ` ${cls}` : ''}`}
      data-state={state}
      style={subject ? { '--accent': accentFor(subject.accent) } : undefined}
      aria-hidden={decorative || undefined}
    >
      {!mounted && subject && (
        <span class="face-initials" aria-hidden="true">
          {initials(subject.name)}
        </span>
      )}
    </div>
  );
}

/**
 * What follows the name in the face's accessible label: FaceView already starts it with the name, so a caller
 * label of "{name}, …" is passed without its name (never "<name>, <name>, …").
 */
export function presenceText(subject: FaceSubject | null | undefined, state: PresenceState, label?: string): string {
  if (!label) return stateWords(state);
  const prefix = subject ? `${subject.name}, ` : '';
  return prefix && label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

export function stateWords(state: PresenceState): string {
  return state === 'raised_hand' ? 'waiting on you' : state;
}
