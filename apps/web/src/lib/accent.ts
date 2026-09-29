// Per-agent accents on the dark theme (D3: "luminous per-agent accents with subtle glow"). The catalog colours
// were chosen for light surfaces and lifted only to 3:1 on the dark panel, so several read brown-grey as rings
// and glows at night. On dark, each accent keeps its hue and moves to OKLCH lightness ≈ 0.76 with capped chroma
// (in the sRGB gamut); light keeps the catalog value.
import { resolvedTheme, type ResolvedTheme } from './theme';

/** Target lightness range for dark-theme accents (OKLCH L). */
export const NIGHT_L = { min: 0.74, target: 0.76, max: 0.8 } as const;
/** Chroma ceiling: luminous, never neon. */
export const NIGHT_C_MAX = 0.16;

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): [number, number, number] | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

function oklchToLinear(L: number, C: number, H: number): Rgb {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const inGamut = (rgb: Rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

export function oklchToHex(L: number, C: number, H: number): string {
  // Reduce chroma until the colour fits sRGB (same lightness and hue).
  let c = C;
  let rgb = oklchToLinear(L, c, H);
  for (let i = 0; i < 24 && !inGamut(rgb); i++) {
    c *= 0.9;
    rgb = oklchToLinear(L, c, H);
  }
  return `#${rgb
    .map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

const cache = new Map<string, string>();

/** The luminous night version of an accent: same hue, OKLCH L within [0.74, 0.8], chroma ≤ 0.16. */
export function nightAccent(hex: string): string {
  const hit = cache.get(hex);
  if (hit) return hit;
  const lch = hexToOklch(hex);
  if (!lch) return hex;
  const [L, C, H] = lch;
  const l = L < NIGHT_L.min ? NIGHT_L.target : Math.min(L, NIGHT_L.max);
  const out = oklchToHex(l, Math.min(C, NIGHT_C_MAX), H);
  cache.set(hex, out);
  return out;
}

/** The accent to paint with on the current theme (read in render: switching theme re-renders the caller). */
export function accentFor(hex: string, theme: ResolvedTheme = resolvedTheme.value): string {
  return theme === 'dark' ? nightAccent(hex) : hex;
}
