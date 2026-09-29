// Motion helpers for the landing page: everything here is a no-op under prefers-reduced-motion.
import { useEffect } from 'preact/hooks';

export function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Sections rise into view once. Content is hidden only after this hook arms the page (`data-motion`), so
 * without JavaScript, observers or motion everything is simply visible.
 */
export function useReveal(root: { current: HTMLElement | null }): void {
  useEffect(() => {
    const el = root.current;
    if (!el || reducedMotion() || typeof IntersectionObserver !== 'function') return;
    const targets = [...el.querySelectorAll<HTMLElement>('[data-reveal]')];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = '';
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    // Anything already on screen shows at once; the rest waits for its turn.
    const vh = window.innerHeight;
    for (const t of targets) {
      if (t.getBoundingClientRect().top < vh) t.dataset.in = '';
      else io.observe(t);
    }
    el.dataset.motion = '';
    return () => {
      io.disconnect();
      delete el.dataset.motion;
    };
  }, []);
}
