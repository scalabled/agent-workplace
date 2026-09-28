/** Small colour helpers for the procedural face (no dependencies, deterministic). */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Parse `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (case-insensitive). Returns null when malformed. */
export function parseHex(input: string | null | undefined): Rgba | null {
  if (typeof input !== 'string') return null;
  const m = /^#?([0-9a-f]{3,8})$/i.exec(input.trim());
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
  if (hex.length !== 6 && hex.length !== 8) return null;
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
}

export function toCss(c: Rgba, alpha = 1): string {
  const a = clamp(c.a * alpha, 0, 1);
  const r = Math.round(clamp(c.r, 0, 255));
  const g = Math.round(clamp(c.g, 0, 255));
  const b = Math.round(clamp(c.b, 0, 255));
  return a >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

export function toHex(c: Rgba): string {
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Linear mix: t = 0 → a, t = 1 → b. */
export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const k = clamp(t, 0, 1);
  return { r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k, a: a.a + (b.a - a.a) * k };
}

export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

export const lighten = (c: Rgba, t: number) => mix(c, { ...WHITE, a: c.a }, t);
export const darken = (c: Rgba, t: number) => mix(c, { ...BLACK, a: c.a }, t);
export const withAlpha = (c: Rgba, a: number): Rgba => ({ ...c, a });

/** Relative luminance 0–1 (sRGB, approximate; good enough for contrast decisions). */
export function luminance(c: Rgba): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function rgbToHsl(c: Rgba): { h: number; s: number; l: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToRgb(h: number, s: number, l: number, a = 1): Rgba {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);
  if (ss === 0) return { r: ll * 255, g: ll * 255, b: ll * 255, a };
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const t = (x: number) => {
    let v = x;
    if (v < 0) v += 1;
    if (v > 1) v -= 1;
    if (v < 1 / 6) return p + (q - p) * 6 * v;
    if (v < 1 / 2) return q;
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
    return p;
  };
  return { r: t(hh + 1 / 3) * 255, g: t(hh) * 255, b: t(hh - 1 / 3) * 255, a };
}

/** Rotate hue by `deg`, keep saturation and lightness. */
export function hueRotate(c: Rgba, deg: number): Rgba {
  if (!deg) return c;
  const { h, s, l } = rgbToHsl(c);
  return hslToRgb(h + deg, s, l, c.a);
}

export function desaturate(c: Rgba, amount: number): Rgba {
  if (!amount) return c;
  const { h, s, l } = rgbToHsl(c);
  return hslToRgb(h, s * (1 - clamp(amount, 0, 1)), l, c.a);
}

/** FNV-1a 32-bit hash of a string (deterministic seeds). */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG returning [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
