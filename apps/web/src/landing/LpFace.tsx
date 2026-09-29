// A face on the landing page: initials in the agent's accent at once, the illustrated face (catalog appearance)
// when it nears the viewport, and the real portrait when one exists. Faces load their engine lazily.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FaceTier } from '@headcount/protocol';
import type { FaceView, LandingFaceSubject } from './face-engine';
import { landingPortrait } from './portraits';

let engineLoaded = false;

/** Restore the app's face budget if the landing tuned it (called when the landing unmounts). */
export function releaseFaces(): void {
  if (engineLoaded) void import('./face-engine').then((m) => m.releaseScheduler());
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

export interface LpFaceProps {
  subject: LandingFaceSubject;
  tier: FaceTier;
  /** Accessible label for the canvas; omit when adjacent text names the person (the face is then decorative). */
  label?: string;
  chrome?: boolean;
  class?: string;
  /** The mounted view (for voice samples), or null when it goes away. */
  onView?: (view: FaceView | null) => void;
}

export function LpFace({ subject, tier, label, chrome = false, class: cls, onView }: LpFaceProps) {
  const host = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let alive = true;
    let view: FaceView | null = null;
    const start = () => {
      void import('./face-engine')
        .then(({ createLandingFace }) => {
          engineLoaded = true;
          if (!alive) return;
          view = createLandingFace(el, subject, tier, { ...(label ? { label } : {}), chrome });
          setMounted(true);
          onView?.(view);
          void landingPortrait(subject.id).then((p) => {
            if (alive && p) void view?.setPortrait(p);
          });
        })
        .catch(() => undefined); // no canvas / chunk failed: the initials stay
    };
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'undefined') start();
    else {
      io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io?.disconnect();
          start();
        },
        { rootMargin: '320px' },
      );
      io.observe(el);
    }
    return () => {
      alive = false;
      io?.disconnect();
      view?.destroy();
      onView?.(null);
      setMounted(false);
    };
  }, [subject.id]);

  return (
    <div ref={host} class={`lp-face${cls ? ` ${cls}` : ''}`} style={{ '--accent': subject.accent }} aria-hidden={label ? undefined : 'true'}>
      {!mounted && (
        <span class="lp-face-initials" aria-hidden="true">
          {initialsOf(subject.name)}
        </span>
      )}
    </div>
  );
}
