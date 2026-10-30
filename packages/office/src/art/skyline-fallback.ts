// The keyless skyline: a procedural vector city in three silhouette layers of seeded towers, lit
// windows at 8–15 % density, a variant gradient, still water with reflections and, at night, a thin moon and red
// beacons. Used when the manifest or image is missing, in tests and in the demo. Pure string output, < 5 ms.
import { mulberry32 } from '../rng';
import type { TimeOfDay } from '../types';
import type { SkyLight } from './skyline';

export const FALLBACK_W = 1600;
export const FALLBACK_H = 900;
/** The waterline, as a share of the height (matches the generated art). */
export const FALLBACK_HORIZON = 0.69;

const SKIES: Record<TimeOfDay, { stops: [number, string][]; tower: [string, string, string]; water: [string, string]; lit: number; warm: string; cool: string; glow: string }> = {
  night: {
    stops: [[0, '#04060b'], [0.4, '#081022'], [0.6, '#16264a'], [0.69, '#2b3d5e']],
    tower: ['#1a2640', '#101a2e', '#070b14'],
    water: ['#0b1220', '#04070c'],
    lit: 0.13,
    warm: '#ffd08a',
    cool: '#bcd4ff',
    glow: '#243650',
  },
  dusk: {
    stops: [[0, '#0d1834'], [0.32, '#1f2f5c'], [0.5, '#4b4a78'], [0.6, '#a86f6e'], [0.69, '#e39a66']],
    tower: ['#3a3552', '#221f36', '#131222'],
    water: ['#2a2742', '#0e0d18'],
    lit: 0.07,
    warm: '#ffd9a0',
    cool: '#d6e2ff',
    glow: '#e8a070',
  },
  day: {
    stops: [[0, '#5d6b7b'], [0.4, '#7f8d9c'], [0.69, '#a9b4bf']],
    tower: ['#8b97a3', '#6f7b88', '#56616d'],
    water: ['#6e7a86', '#48525c'],
    lit: 0,
    warm: '#fff',
    cool: '#fff',
    glow: '#b9c3cc',
  },
};

export interface FallbackSkyline {
  svg: string;
  horizon: number;
  lights: SkyLight[];
  beacons: { x: number; y: number }[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function fallbackSkyline(tod: TimeOfDay, seed = 1729): FallbackSkyline {
  const W = FALLBACK_W;
  const H = FALLBACK_H;
  const hy = H * FALLBACK_HORIZON;
  const sky = SKIES[tod];
  const rand = mulberry32(seed);
  const lights: SkyLight[] = [];
  const beacons: { x: number; y: number }[] = [];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">`;
  s += `<defs><linearGradient id="hc-o-fsky-${tod}" x1="0" y1="0" x2="0" y2="${hy}" gradientUnits="userSpaceOnUse">${sky.stops.map(([o, c]) => `<stop offset="${o / FALLBACK_HORIZON}" stop-color="${c}"/>`).join('')}</linearGradient>`;
  s += `<linearGradient id="hc-o-fwater-${tod}" x1="0" y1="${hy}" x2="0" y2="${H}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${sky.water[0]}"/><stop offset="1" stop-color="${sky.water[1]}"/></linearGradient>`;
  s += `<radialGradient id="hc-o-fglow-${tod}" cx=".5" cy="1" r=".8"><stop offset="0" stop-color="${sky.glow}" stop-opacity=".55"/><stop offset="1" stop-color="${sky.glow}" stop-opacity="0"/></radialGradient></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#hc-o-fsky-${tod})"/>`;
  s += `<rect x="0" y="${r1(hy - 220)}" width="${W}" height="220" fill="url(#hc-o-fglow-${tod})"/>`;
  if (tod === 'night') {
    for (let i = 0; i < 90; i++) {
      const x = rand() * W;
      const y = rand() * hy * 0.5;
      s += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(0.5 + rand() * 0.7)}" fill="#dfe8ff" opacity="${r1(0.15 + rand() * 0.35)}"/>`;
    }
    s += `<path d="M1262 118a26 26 0 1 0 22 40a22 22 0 1 1 -22 -40z" fill="#e9eef8" opacity=".75"/>`;
  }
  const layers = [
    { count: 46, min: 90, max: 280, wmin: 12, wmax: 34, fill: sky.tower[0], lit: sky.lit * 0.6, win: 2 },
    { count: 34, min: 110, max: 380, wmin: 18, wmax: 46, fill: sky.tower[1], lit: sky.lit * 0.85, win: 2.5 },
    { count: 22, min: 70, max: 440, wmin: 24, wmax: 62, fill: sky.tower[2], lit: sky.lit, win: 3 },
  ];
  let reflect = '';
  layers.forEach((L, li) => {
    let x = -20 - rand() * 40;
    let towers = '';
    let windows = '';
    const tall: { x: number; y: number; h: number }[] = [];
    while (x < W + 20) {
      const w = L.wmin + rand() * (L.wmax - L.wmin);
      const hBase = L.min + Math.pow(rand(), 1.25) * (L.max - L.min);
      const h = hBase * (0.85 + 0.3 * Math.sin((x / W) * Math.PI * 2 + li));
      const top = hy - h;
      towers += `M${r1(x)} ${r1(hy)}V${r1(top)}`;
      if (rand() < 0.25) towers += `H${r1(x + w * 0.3)}V${r1(top - 8 - rand() * 14)}H${r1(x + w * 0.62)}V${r1(top)}`;
      towers += `H${r1(x + w)}V${r1(hy)}Z`;
      tall.push({ x: x + w / 2, y: top, h });
      if (L.lit > 0) {
        const cols = Math.max(2, Math.floor(w / (L.win + 2.5)));
        const rows = Math.floor(h / (L.win + 3));
        for (let r = 1; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (rand() > L.lit) continue;
            const wx = x + 2 + c * ((w - 4) / cols);
            const wy = top + 3 + r * (L.win + 3);
            if (wy > hy - 3) continue;
            const warm = rand() < 0.7;
            windows += `<rect x="${r1(wx)}" y="${r1(wy)}" width="${r1(L.win * 0.8)}" height="${r1(L.win)}" fill="${warm ? sky.warm : sky.cool}" opacity="${r1(0.35 + rand() * 0.55)}"/>`;
            if (li === 2 && lights.length < 60 && rand() < 0.08) lights.push({ x: wx / W, y: wy / H, r: 1.2, warm });
            if (li >= 1 && rand() < 0.06) reflect += `<rect x="${r1(wx)}" y="${r1(hy + 4 + rand() * 30)}" width="${r1(L.win)}" height="${r1(20 + rand() * 60)}" fill="${warm ? sky.warm : sky.cool}" opacity="${r1(0.05 + rand() * 0.1)}"/>`;
          }
        }
      }
      x += w + rand() * 4 - (li === 0 ? 3 : 0);
    }
    s += `<path d="${towers}" fill="${L.fill}"/>${windows}`;
    if (li === 2 && tod === 'night') {
      tall.sort((a, b) => b.h - a.h);
      for (const t of tall.slice(0, 4)) beacons.push({ x: t.x / W, y: (t.y - 3) / H });
    }
  });
  s += `<rect x="0" y="${r1(hy)}" width="${W}" height="${r1(H - hy)}" fill="url(#hc-o-fwater-${tod})"/>`;
  s += reflect;
  s += `<rect x="0" y="${r1(hy)}" width="${W}" height="1.5" fill="${sky.glow}" opacity=".35"/>`;
  for (const b of beacons) s += `<circle cx="${r1(b.x * W)}" cy="${r1(b.y * H)}" r="2" fill="#ff4a3a" opacity=".5"/>`;
  s += '</svg>';
  return { svg: s, horizon: FALLBACK_HORIZON, lights, beacons };
}
