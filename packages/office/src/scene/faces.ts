// Faces: the host's faceFactory (FaceView in apps/web), else initials badges that mirror the
// hc-face ring language. The office sizes and positions a FaceSlot's `el`; the host fills it.
import type { FaceFactory, FaceSlot, FaceTier, OfficePerson, PresenceState } from '../types';

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

/** A text face: initials on an accent-tinted disc. */
export function initialsFace(doc: Document, person: Pick<OfficePerson, 'name'>, accent: string, tier: FaceTier): FaceSlot {
  const el = doc.createElement('div');
  el.className = 'hc-o-initials';
  el.dataset.tier = tier;
  el.style.setProperty('--acc', accent);
  el.textContent = initialsOf(person.name);
  return {
    el,
    setTier(t) {
      el.dataset.tier = t;
    },
    setState(state: PresenceState) {
      el.dataset.state = state;
    },
    destroy() {
      el.remove();
    },
  };
}

/** Build a face through the host factory, falling back to initials if it throws. */
export function makeFace(doc: Document, factory: FaceFactory | undefined, person: OfficePerson, accent: string, tier: FaceTier): FaceSlot {
  if (factory) {
    try {
      const slot = factory(person.id, tier);
      if (slot && slot.el) return slot;
    } catch (err) {
      console.warn('[office] faceFactory failed; using initials', err);
    }
  }
  return initialsFace(doc, person, accent, tier);
}
