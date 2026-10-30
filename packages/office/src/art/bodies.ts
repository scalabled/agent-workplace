// People seen from above at plan zoom (L0): shoulders in a muted version of the coworker's accent, head and hair.
// Drawn in world space so the overview costs nothing per frame; faces replace them from L1 up.
import { K_Y, K_Z } from '../projection';
import { rngFor } from '../rng';
import type { Facing } from '../types';
import { n } from './symbols';

const HAIR = ['#17120f', '#1f1712', '#2b1f17', '#3a2a1e', '#4d3726', '#6b4d33', '#8d6b47', '#a88a62', '#5d5955', '#b9b2a8', '#241a1a', '#131313'];
const SKIN = ['#f0d2bb', '#e3b898', '#cf9a76', '#b47a58', '#94603f', '#744630', '#5b3625'];

const Y = (y: number, z = 0) => y * K_Y - z * K_Z;

/** One seated person, origin at the chair centre on the floor (projected u). */
export function bodyGlyph(personId: string, facing: Facing): string {
  const r = rngFor(`body:${personId}`);
  const hair = HAIR[Math.floor(r() * HAIR.length)]!;
  const skin = SKIN[Math.floor(r() * SKIN.length)]!;
  const long = r() < 0.4;
  const headZ = 15.4;
  const shoulderZ = 11.6;
  if (facing === 'e' || facing === 'w') {
    const dir = facing === 'e' ? 1 : -1;
    const hx = dir * 0.35;
    return (
      `<ellipse class="t" cx="0" cy="${n(Y(0, shoulderZ))}" rx="1.9" ry="2.5"/>` +
      `<ellipse class="th" cx="${n(-dir * 0.3)}" cy="${n(Y(-0.5, shoulderZ + 0.4))}" rx="1.2" ry="1.3"/>` +
      `<circle cx="${n(hx)}" cy="${n(Y(0, headZ))}" r="1.42" fill="${skin}"/>` +
      `<ellipse cx="${n(hx - dir * 0.35)}" cy="${n(Y(0, headZ) - 0.2)}" rx="${long ? 1.45 : 1.3}" ry="1.35" fill="${hair}"/>`
    );
  }
  const toward = facing === 's';
  const back = toward ? -0.9 : 0.9;
  let s =
    `<ellipse class="t" cx="0" cy="${n(Y(back * 0.3, shoulderZ))}" rx="2.7" ry="1.75"/>` +
    `<ellipse class="th" cx="0" cy="${n(Y(back * 0.3, shoulderZ) - 0.45)}" rx="1.9" ry="0.85"/>`;
  const hy = Y(back * 0.1, headZ);
  if (toward) {
    s += `<circle cx="0" cy="${n(hy)}" r="1.42" fill="${skin}"/>`;
    s += `<path d="M-1.47 ${n(hy + 0.1)}A1.47 1.4 0 0 1 1.47 ${n(hy + 0.1)}Q0.7 ${n(hy - 0.55)} 0 ${n(hy - 0.5)}Q-0.9 ${n(hy - 0.45)} -1.47 ${n(hy + 0.1)}Z" fill="${hair}"/>`;
    if (long) s += `<path d="M-1.5 ${n(hy)}Q-1.8 ${n(hy + 1.6)} -1.2 ${n(hy + 2.2)}L-0.9 ${n(hy + 0.8)}ZM1.5 ${n(hy)}Q1.8 ${n(hy + 1.6)} 1.2 ${n(hy + 2.2)}L0.9 ${n(hy + 0.8)}Z" fill="${hair}"/>`;
  } else {
    s += `<ellipse cx="0" cy="${n(hy + 0.9)}" rx="0.6" ry="0.5" fill="${skin}"/>`;
    s += `<circle cx="0" cy="${n(hy)}" r="${long ? 1.55 : 1.45}" fill="${hair}"/>`;
    if (long) s += `<ellipse cx="0" cy="${n(hy + 1.2)}" rx="1.2" ry="1" fill="${hair}"/>`;
    s += `<ellipse cx="-0.45" cy="${n(hy - 0.55)}" rx="0.7" ry="0.4" fill="#fff" opacity=".07"/>`;
  }
  return s;
}
