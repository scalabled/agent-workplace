// The sky layer: a screen-space panorama behind the plate. The generated art for the time
// of day (LQIP first, then the image), else the vector city; ≤ 60 CSS twinkle dots on real lit windows and ≤ 3
// slow beacons; 0.12× parallax on pan and 0.25× on zoom; a 2 s crossfade between variants. No JS animation loop.
// Below the plate's north floor line the sky gives way to the void (a --o-void veil fading in over 40 px from 12 px
// above the line), so the floor sits on the 30th floor with nothing beside or beneath it, not at water level. The
// veil moves by transform only: a CSS mask driven by a per-frame variable re-rasterises the whole panorama and costs
// ~16 ms a frame while panning. --o-sky-cut on the sky element carries the line's screen y for anyone who needs it.
import { rngFor } from '../rng';
import type { Camera, TimeOfDay } from '../types';
import { FALLBACK_H, FALLBACK_W, fallbackSkyline } from '../art/skyline-fallback';
import type { ArtEntry, OfficeManifest, SkyLight } from '../art/skyline';
import { normalizeBase, srcsetOf } from '../art/skyline';
import type { Viewport } from './camera';

export interface SkyLayout {
  vp: Viewport;
  fit: Camera;
  cam: Camera;
  /** Projected y of the line the waterline should sit on at fit (inside the north window band). */
  anchorY: number;
  /** Projected y of the plate's north floor line: the sky is cut off below it. */
  floorY: number;
  /** Projected x of the plate centre. */
  anchorX: number;
  parallax: boolean;
}

export interface SkyLayer {
  readonly el: HTMLElement;
  setManifest(m: OfficeManifest | null, base: string | null): void;
  setVariant(tod: TimeOfDay, animate: boolean): void;
  layout(l: SkyLayout): void;
  destroy(): void;
}

interface Variant {
  tod: TimeOfDay;
  el: HTMLElement;
  horizon: number;
  aspect: number;
}

const PARALLAX_PAN = 0.12;
const PARALLAX_ZOOM = 0.25;
const MAX_BEACONS = 3;

export function createSky(doc: Document): SkyLayer {
  const el = doc.createElement('div');
  el.className = 'hc-o-sky';
  el.setAttribute('aria-hidden', 'true');
  const pan = doc.createElement('div');
  pan.className = 'hc-o-sky__pan';
  const shade = doc.createElement('div');
  shade.className = 'hc-o-sky__shade';
  const cut = doc.createElement('div');
  cut.className = 'hc-o-sky__cut';
  el.append(pan, shade, cut);
  let manifest: OfficeManifest | null = null;
  let base: string | null = null;
  let current: Variant | null = null;
  let tod: TimeOfDay | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let lastLayout: SkyLayout | null = null;

  const twinkles = (lights: readonly SkyLight[], beacons: readonly { x: number; y: number }[], key: string): HTMLElement => {
    const tw = doc.createElement('div');
    tw.className = 'hc-o-sky__tw';
    const rand = rngFor(`twinkle:${key}`);
    for (const l of lights.slice(0, 60)) {
      const i = doc.createElement('i');
      i.className = l.warm ? 'w' : 'c';
      i.style.cssText = `left:${(l.x * 100).toFixed(3)}%;top:${(l.y * 100).toFixed(3)}%;--d:${Math.max(1.6, l.r * 1.9).toFixed(1)}px;--t:${(5 + rand() * 6).toFixed(2)}s;--dl:${(-rand() * 11).toFixed(2)}s`;
      tw.append(i);
    }
    for (const b of beacons.slice(0, MAX_BEACONS)) {
      const i = doc.createElement('i');
      i.className = 'hc-o-beacon';
      i.style.cssText = `left:${(b.x * 100).toFixed(3)}%;top:${(b.y * 100).toFixed(3)}%;--dl:${(-rand() * 2.4).toFixed(2)}s`;
      tw.append(i);
    }
    return tw;
  };

  const build = (t: TimeOfDay): Variant => {
    const v = doc.createElement('div');
    v.className = 'hc-o-sky__v';
    v.dataset.v = t;
    const entry: ArtEntry | undefined = base ? manifest?.variants?.[t] : undefined;
    const useFallback = () => {
      const f = fallbackSkyline(t);
      v.innerHTML = f.svg;
      v.style.backgroundImage = '';
      v.append(twinkles(f.lights, f.beacons, `fallback:${t}`));
      v.dataset.fallback = '';
      return { tod: t, el: v, horizon: f.horizon, aspect: FALLBACK_W / FALLBACK_H };
    };
    if (!entry || !base) return useFallback();
    const b = normalizeBase(base);
    if (entry.lqip) v.style.backgroundImage = `url("${entry.lqip}")`;
    const img = doc.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    const srcset = srcsetOf(entry, b);
    if (srcset) {
      img.srcset = srcset;
      img.sizes = '130vw';
    }
    img.src = `${b}${entry.file}`;
    img.addEventListener('error', () => {
      if (img.dataset.retried || !entry.fallback) {
        const variant = useFallback();
        if (current?.el === v) current = variant;
        if (lastLayout) layoutNow(lastLayout);
        return;
      }
      img.dataset.retried = '1';
      img.removeAttribute('srcset');
      img.src = `${b}${entry.fallback}`;
    });
    img.addEventListener('load', () => v.classList.add('is-loaded'));
    v.append(img, twinkles(entry.lights ?? [], entry.beacons ?? [], entry.key));
    return { tod: t, el: v, horizon: entry.horizon ?? 0.66, aspect: entry.width / entry.height || 16 / 9 };
  };

  const show = (t: TimeOfDay, animate: boolean) => {
    const next = build(t);
    const prev = current;
    current = next;
    tod = t;
    if (animate && prev) {
      next.el.classList.add('is-entering');
      pan.append(next.el);
      // Force a style flush so the fade runs.
      void next.el.offsetWidth;
      next.el.classList.remove('is-entering');
      const timer = setTimeout(() => {
        timers.delete(timer);
        prev.el.remove();
      }, 2100);
      timers.add(timer);
    } else {
      pan.replaceChildren(next.el);
    }
    if (lastLayout) layoutNow(lastLayout);
  };

  const layoutNow = (l: SkyLayout) => {
    lastLayout = l;
    if (!current) return;
    const { vp, fit, cam } = l;
    const horizon = current.horizon;
    const aspect = current.aspect;
    // Waterline at the anchor (inside the north glass) at the fit camera.
    const h0 = (l.anchorY - fit.y) * fit.zoom + vp.h / 2;
    const fh = Math.max((vp.w * 1.3) / aspect, (h0 + vp.h * 0.18) / horizon, vp.h * 1.3);
    const fw = fh * aspect;
    const left = (vp.w - fw) / 2;
    const top = h0 - horizon * fh;
    pan.style.width = `${fw.toFixed(1)}px`;
    pan.style.height = `${fh.toFixed(1)}px`;
    pan.style.left = `${left.toFixed(1)}px`;
    pan.style.top = `${top.toFixed(1)}px`;
    pan.style.transformOrigin = `50% ${(horizon * 100).toFixed(2)}%`;
    // The north floor line on screen: the void veil starts 12 px above it.
    const floorScreen = (l.floorY - cam.y) * cam.zoom + vp.h / 2;
    el.style.setProperty('--o-sky-cut', `${floorScreen.toFixed(1)}px`);
    // Twice the view tall and never lifted more than a view above the top, so it always reaches the bottom edge.
    cut.style.height = `${(vp.h * 2 + 80).toFixed(0)}px`;
    cut.style.transform = `translate3d(0,${Math.max(floorScreen - 12, -vp.h - 60).toFixed(1)}px,0)`;
    if (!l.parallax) {
      pan.style.transform = '';
      return;
    }
    // Parallax: a fraction of the plate's own screen motion at its north centre.
    const ax = (l.anchorX - cam.x) * cam.zoom - (l.anchorX - fit.x) * fit.zoom;
    const ay = (l.anchorY - cam.y) * cam.zoom - (l.anchorY - fit.y) * fit.zoom;
    const scale = Math.min(1.6, Math.max(1, 1 + (cam.zoom / fit.zoom - 1) * PARALLAX_ZOOM));
    // Keep the scaled frame covering the view.
    const sw = fw * scale;
    const sh = fh * scale;
    const cx = left + fw / 2;
    const cy = top + fh * horizon;
    const minDx = vp.w - (cx + sw / 2);
    const maxDx = -(cx - sw / 2);
    const minDy = vp.h - (cy + sh * (1 - horizon));
    const maxDy = -(cy - sh * horizon);
    const dx = Math.min(maxDx, Math.max(minDx, ax * PARALLAX_PAN));
    const dy = Math.min(maxDy, Math.max(minDy, ay * PARALLAX_PAN));
    pan.style.transform = `translate3d(${dx.toFixed(1)}px,${dy.toFixed(1)}px,0) scale(${scale.toFixed(4)})`;
  };

  return {
    el,
    setManifest(m, b) {
      manifest = m;
      base = b;
      if (tod) show(tod, false);
    },
    setVariant(t, animate) {
      if (t === tod && current) return;
      show(t, animate);
    },
    layout: layoutNow,
    destroy() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      el.remove();
    },
  };
}
