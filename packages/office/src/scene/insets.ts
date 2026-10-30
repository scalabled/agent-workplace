// Host insets (OfficeOptions.insets): the host's own overlays over the office (the app's Chief
// bubble in the bottom-right corner). Two adjacent edges reserve their corner; an edge with neither neighbour set
// reserves the whole strip along it. HUD controls inside a reserved area move out of it, and bubbles never enter one.
import type { OfficeInsets, Rect } from '../types';

type Edge = 'top' | 'right' | 'bottom' | 'left';
export type HudControl = 'life' | 'seg' | 'tools' | 'zoom' | 'mini' | 'follow';

export interface InsetLayout {
  /** Per HUD control, how far it moves (px, screen axes: +x right, +y down). */
  offsets: Record<HudControl, { x: number; y: number }>;
  /** Areas bubbles keep out of (px, relative to the office's top-left). */
  reserved: Rect[];
}

const n = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

export function normInsets(i: OfficeInsets | null | undefined): Required<OfficeInsets> {
  return { top: n(i?.top), right: n(i?.right), bottom: n(i?.bottom), left: n(i?.left) };
}

/** Where the HUD moves and what bubbles avoid, for insets in a view of w × h px. */
export function insetLayout(insets: OfficeInsets | null | undefined, w: number, h: number): InsetLayout {
  const i = normInsets(insets);
  const has = (e: Edge) => i[e] > 0;
  const strip = (e: Edge) => has(e) && (e === 'top' || e === 'bottom' ? !has('left') && !has('right') : !has('top') && !has('bottom'));
  /** A control in the (v, hz) corner: inside a reserved corner or strip? Move along its vertical edge first. */
  const corner = (v: 'top' | 'bottom', hz: 'left' | 'right') => {
    const inside = (has(v) && has(hz)) || strip(v) || strip(hz);
    if (!inside) return { x: 0, y: 0 };
    if (has(v)) return { x: 0, y: v === 'top' ? i.top : -i.bottom };
    return { x: hz === 'left' ? i.left : -i.right, y: 0 };
  };
  const centre = (v: 'top' | 'bottom') => (strip(v) ? { x: 0, y: v === 'top' ? i.top : -i.bottom } : { x: 0, y: 0 });
  const reserved: Rect[] = [];
  if (has('top') && has('left')) reserved.push({ x: 0, y: 0, w: i.left, h: i.top });
  if (has('top') && has('right')) reserved.push({ x: w - i.right, y: 0, w: i.right, h: i.top });
  if (has('bottom') && has('right')) reserved.push({ x: w - i.right, y: h - i.bottom, w: i.right, h: i.bottom });
  if (has('bottom') && has('left')) reserved.push({ x: 0, y: h - i.bottom, w: i.left, h: i.bottom });
  if (strip('top')) reserved.push({ x: 0, y: 0, w, h: i.top });
  if (strip('bottom')) reserved.push({ x: 0, y: h - i.bottom, w, h: i.bottom });
  if (strip('left')) reserved.push({ x: 0, y: 0, w: i.left, h });
  if (strip('right')) reserved.push({ x: w - i.right, y: 0, w: i.right, h });
  return {
    offsets: {
      life: corner('top', 'left'),
      seg: centre('top'),
      tools: corner('top', 'right'),
      zoom: corner('bottom', 'right'),
      mini: corner('bottom', 'left'),
      follow: centre('bottom'),
    },
    reserved,
  };
}
