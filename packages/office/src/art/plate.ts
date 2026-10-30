// The static plate: one SVG built once from an OfficePlan. Floors, carpets, glazing, furniture and
// things in painter's order. Repeated assets (desks, chairs, lamps, plants) are emitted once into <defs> and placed
// with <use>, which keeps the DOM small. Coordinates are projected u (x, y·sin55° − z·cos55°).
import { prefixClasses } from './palette';
import * as S from './symbols';
import { WINDOW_Z } from './symbols';
import { K_Y, K_Z } from '../projection';
import type { OfficePlan, PlanProp } from '../plan/types';
import type { Rect } from '../types';

/** The plate's projected view box: the floor plus the window band above it and the slab below. */
export function plateBox(plan: Pick<OfficePlan, 'bounds'>): Rect {
  const top = -WINDOW_Z * K_Z - 4;
  return { x: -8, y: top, w: plan.bounds.w + 16, h: plan.bounds.h * K_Y + 22 - top };
}

/** Emits each distinct asset once into <defs>; returns a <use> for it. */
class Defs {
  private ids = new Map<string, string>();
  out = '';
  constructor(private readonly prefix: string) {}
  use(key: string, build: () => string, x: number, y: number): string {
    let id = this.ids.get(key);
    if (!id) {
      id = `${this.prefix}${this.ids.size.toString(36)}`;
      this.ids.set(key, id);
      this.out += `<g id="${id}">${build()}</g>`;
    }
    return `<use href="#${id}" x="${S.n(x)}" y="${S.n(y)}"/>`;
  }
}

/** Seeded variants are folded into a few shapes each, so the defs stay small while the office still looks lived-in. */
const fold = (v: number | undefined, k: number) => Math.abs(Math.floor(v ?? 0)) % k;

function renderProp(p: PlanProp, d: Defs): string {
  const X = p.x;
  const PY = p.y * K_Y;
  const w = p.w ?? 0;
  const dd = p.d ?? 0;
  const h = p.h ?? 0;
  const f = p.facing ?? 's';
  const at = (key: string, build: () => string) => d.use(key, build, X, PY);
  switch (p.symbol) {
    case 'carpet':
      return S.carpet(p.x, p.y, w, dd, p.district ?? 'run');
    case 'rug':
      return S.rug(p.x, p.y, w, dd, p.variant ?? 0);
    case 'room-floor':
      return S.roomFloor(p.x, p.y, w, dd);
    case 'cafe-floor':
      return S.cafeFloor(p.x, p.y, w, dd);
    case 'mat':
      return S.mat(p.x, p.y, w, dd);
    case 'desk':
      return at(`desk:${f}:${p.variant ?? 0}`, () => S.desk(f, p.variant ?? 0));
    case 'desk-lamp':
      return at(`lamp:${f}`, () => S.deskLamp(f));
    case 'chair': {
      const key = `chair:${f}:${p.variant ?? 0}`;
      if (!p.turn) return at(key, () => S.chair(f, p.variant ?? 0));
      return d.use(key, () => S.chair(f, p.variant ?? 0), X, PY).replace('/>', ` transform="rotate(${S.n(p.turn)} ${S.n(X)} ${S.n(PY)})"/>`);
    }
    case 'bench-screen':
      return at(`bench-screen:${w}`, () => S.benchScreen(w));
    case 'plant-monstera': {
      const v = fold(p.variant, 4);
      return at(`monstera:${v}`, () => S.plantMonstera(v));
    }
    case 'plant-snake': {
      const v = fold(p.variant, 4);
      return at(`snake:${v}`, () => S.plantSnake(v));
    }
    case 'plant-fiddle': {
      const v = fold(p.variant, 4);
      return at(`fiddle:${v}`, () => S.plantFiddle(v));
    }
    case 'plant-pothos': {
      const v = fold(p.variant, 3);
      return at(`pothos:${v}`, () => S.plantPothos(v));
    }
    case 'whiteboard': {
      const v = fold(p.variant, 5);
      return at(`wb:${v}`, () => S.whiteboard(v));
    }
    case 'shelf-low': {
      const v = fold(p.variant, 3);
      return at(`shelf-low:${w}:${dd}:${h}:${v}`, () => S.shelfLow(w, dd, h, v));
    }
    case 'shelf-tall':
      return at(`shelf-tall:${w}:${dd}:${h}:${p.variant}:${f}`, () => S.shelfTall(w, dd, h, p.variant ?? 0, f));
    case 'printer':
      return at(`printer:${w}:${dd}:${h}`, () => S.printer(w, dd, h));
    case 'bin':
      return at('bin', () => S.bin());
    case 'sofa':
      return at(`sofa:${w}:${dd}:${h}:${f}`, () => S.sofa(w, dd, h, f));
    case 'armchair':
      return at(`armchair:${f}:${p.variant ?? 0}`, () => S.armchair(f, p.variant ?? 0));
    case 'coffee-table':
      return at(`coffee-table:${w}:${dd}`, () => S.coffeeTable(w, dd));
    case 'side-table':
      return at('side-table', () => S.sideTable());
    case 'floor-lamp':
      return at('floor-lamp', () => S.floorLamp());
    case 'pendant':
      return at('pendant', () => S.pendant());
    case 'feature-wall':
      return `<g transform="translate(${S.n(X)} ${S.n(PY)})">${S.featureWall(w, dd, h)}</g>`;
    case 'coffee-counter':
      return at(`counter:${w}:${dd}:${h}`, () => S.coffeeCounter(w, dd, h));
    case 'fridge':
      return at(`fridge:${w}:${dd}:${h}`, () => S.fridge(w, dd, h));
    case 'tall-cabinet':
      return at(`cabinet:${w}:${dd}:${h}`, () => S.tallCabinet(w, dd, h));
    case 'island':
      return at(`island:${w}:${dd}:${h}`, () => S.island(w, dd, h));
    case 'stool':
      return at('stool', () => S.stool());
    case 'water-cooler':
      return at('cooler', () => S.waterCooler());
    case 'high-table':
      return at('high-table', () => S.highTable());
    case 'conf-table':
      return at(`conf:${w}:${dd}:${h}`, () => S.confTable(w, dd, h));
    case 'glass':
      return at(`glass:${S.n(w)}:${S.n(dd)}:${h}`, () => S.glass(w, dd, h)).replace('<use ', `<use class="hc-o-glass"${p.roomId ? ` data-room="${p.roomId}"` : ''} `);
    case 'column':
      return at('column', () => S.column());
    case 'phone-booth':
      return at(`booth:${w}:${dd}:${h}:${p.variant ?? 0}`, () => S.phoneBooth(w, dd, h, p.variant ?? 0));
    case 'exec-desk':
      return at(`exec:${w}:${dd}:${h}`, () => S.execDesk(w, dd, h));
    case 'credenza':
      return at(`credenza:${w}:${dd}:${h}`, () => S.credenza(w, dd, h));
    case 'plant-wall':
      return at(`plant-wall:${S.n(w)}:${dd}:${h}`, () => S.plantWall(w, dd, h, 77));
    case 'reception-desk':
      return at(`reception:${w}:${dd}:${h}`, () => S.receptionDesk(w, dd, h));
    case 'bench':
      return at(`bench:${w}:${dd}:${h}`, () => S.bench(w, dd, h));
    case 'door-plate':
      return at('door-plate', () => S.doorPlate());
    case 'display':
      return at('display', () => S.display());
    default:
      return '';
  }
}

/** Soft city-light reflections on the polished floor along the north glass (night and dusk only; CSS hides them by day). */
function reflections(plan: OfficePlan): string {
  let s = '';
  const w = plan.bounds.w;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let x = 4; x < w - 4; x += 9 + rand() * 12) {
    const len = 12 + rand() * 30;
    const wid = 0.5 + rand() * 1.6;
    const warm = rand() < 0.62;
    s += `<rect x="${S.n(x)}" y="0.4" width="${S.n(wid)}" height="${S.n(len * K_Y)}" fill="url(#hc-o-refl-${warm ? 'w' : 'c'})" opacity="${S.n(0.35 + rand() * 0.65)}"/>`;
  }
  return `<g class="hc-o-refl">${s}</g>`;
}

export interface PlateSvg {
  svg: string;
  box: Rect;
}

/** The whole static plate as one SVG string (built once per plan; restyled by CSS tokens). */
export function buildPlateSvg(plan: OfficePlan, prefix = 'hc-o-d'): PlateSvg {
  const box = plateBox(plan);
  const d = new Defs(prefix);
  const w = plan.bounds.w;
  const h = plan.bounds.h;
  let floor = '';
  let furniture = '';
  for (const p of plan.props) {
    if (p.layer === 'floor') floor += renderProp(p, d);
    else furniture += renderProp(p, d);
  }
  const grads =
    `<linearGradient id="hc-o-slabfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--o-slab)"/><stop offset="1" style="stop-color:var(--o-void);stop-opacity:0"/></linearGradient>` +
    `<linearGradient id="hc-o-refl-w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc98a" stop-opacity=".16"/><stop offset="1" stop-color="#ffc98a" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="hc-o-refl-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc0ff" stop-opacity=".14"/><stop offset="1" stop-color="#9cc0ff" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="hc-o-winlight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--o-window);stop-opacity:var(--o-window-a)"/><stop offset=".45" style="stop-color:var(--o-window);stop-opacity:calc(var(--o-window-a) * .3)"/><stop offset="1" style="stop-color:var(--o-window);stop-opacity:0"/></linearGradient>`;
  const body =
    S.slab(w, h) +
    S.floorPlate(w, h) +
    floor +
    `<rect x="0" y="0" width="${w}" height="${S.n(70 * K_Y)}" fill="url(#hc-o-winlight)" class="hc-o-winlight"/>` +
    reflections(plan) +
    S.windowBand(w) +
    S.sideGlazing(w, h) +
    furniture;
  const svg =
    `<svg class="hc-o-plate" xmlns="http://www.w3.org/2000/svg" viewBox="${S.n(box.x)} ${S.n(box.y)} ${S.n(box.w)} ${S.n(box.h)}" width="${S.n(box.w)}" height="${S.n(box.h)}" aria-hidden="true" focusable="false">` +
    `<defs>${grads}${d.out}</defs>${body}</svg>`;
  return { svg: prefixClasses(svg), box };
}
