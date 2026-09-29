// The conference stage (OFFICE-PLAN §2.4, §4.5): a closer composition from the owner's seat at the near end of the
// table. Far glass with the city (Skyline room) or the living wall (Garden room; generated art, vector when keyless),
// the walnut table in perspective and sized to the party, participants seated in chairs along it (chair back and
// accent-tinted shoulders behind each face, tucked behind the table edge) with tent cards, the speaker lifted to hero
// under the pendant's warm pool, captions, the floor line and a dock for the host's composer.
import { mulberry32 } from '../rng';
import type { OfficeStrings } from '../strings';
import type { FaceSlot, FaceTier, OfficePerson, PresenceState } from '../types';
import type { StageGeom, StageSeatPos } from './perspective';
import { emptyChair, narrowPositions, stageGeometry, tableEdges, tablePath, tiltFor } from './perspective';

/** Mix two '#rrggbb' colours (k of `a`). Falls back to `b` for anything that is not a 6-digit hex. */
function mixHex(a: string, b: string, k: number): string {
  const parse = (h: string) => (/^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
  const ca = parse(a);
  const cb = parse(b)!;
  if (!ca) return b;
  return `#${ca.map((v, i) => Math.round(v * k + cb[i]! * (1 - k)).toString(16).padStart(2, '0')).join('')}`;
}

/** Seats the table is drawn for: the party plus the owner (at least 5), and never fewer than the highest seat in use. */
export function tableSeatsFor(people: number, highestSlot = -1): number {
  return Math.max(5, Math.max(people, highestSlot + 1) + 1);
}

export interface StageBackdrop {
  src?: string;
  srcset?: string;
  lqip?: string;
  /** 0–1 of the image height. */
  horizon?: number;
  aspect?: number;
  /** Lit windows (0–1 of the image) for CSS twinkle. */
  lights?: { x: number; y: number; r: number; warm: boolean }[];
}

export interface StageHost {
  doc: Document;
  strings: OfficeStrings;
  person(id: string): OfficePerson | undefined;
  accent(id: string): string;
  groupName(id: string): string;
  face(id: string, tier: FaceTier): FaceSlot;
  reducedMotion(): boolean;
  backdrop(view: 'skyline' | 'garden'): StageBackdrop | null;
  now(): number;
  onLeave(): void;
  onInvite(): void;
  onTalk(text: string): void;
  onOpen(id: string): void;
  onDismiss(id: string): void;
  onFocusChange(id: string | null): void;
}

export interface StageRoom {
  id: string;
  name: string;
  view: 'skyline' | 'garden';
  capacity: number;
}

interface SeatView {
  id: string;
  slot: number;
  el: HTMLElement;
  faceBtn: HTMLButtonElement;
  faceBox: HTMLElement;
  face: FaceSlot | null;
  tier: FaceTier;
  card: HTMLElement;
  state: PresenceState;
  label: string;
}

export interface Stage {
  readonly el: HTMLElement;
  readonly dockEl: HTMLElement;
  readonly isOpen: boolean;
  open(room: StageRoom, participants: readonly string[], animate: boolean): void;
  close(animate: boolean): void;
  /** Participants now at the table; `arriving` ones slide in from the door side. */
  setParticipants(ids: readonly string[], arriving?: readonly string[]): void;
  setSpeaking(id: string | null, on: boolean): void;
  setPresence(id: string, state: PresenceState, label?: string): void;
  showCaption(id: string | null, text: string, opts?: { final?: boolean; voiced?: boolean }): void;
  setFloorQueue(ids: readonly string[]): void;
  claimDock(): HTMLElement;
  focusFirst(): boolean;
  moveFocus(dir: -1 | 1): void;
  focusedId(): string | null;
  toggleCaptions(): void;
  layout(): void;
  destroy(): void;
}

const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** The Garden room's far wall: a dense living wall of ferns and moss under warm wall-washers. */
function gardenSvg(w: number, h: number, floorY: number): string {
  const wallH = Math.max(60, floorY);
  const rand = mulberry32(311);
  const f = (v: number) => v.toFixed(1);
  const greens = ['#18301f', '#1f3b27', '#26472f', '#2f5638', '#3a6842', '#4a7b4d', '#5f8f58'];
  let leaves = '';
  const count = Math.min(1400, Math.round((w * wallH) / 700));
  for (let i = 0; i < count; i++) {
    const layer = i / count;
    const x = rand() * (w + 40) - 20;
    const y = rand() * (wallH + 20) - 10;
    const size = 12 + rand() * 26 * (0.6 + layer * 0.6);
    const lit = Math.max(0, 1 - y / wallH) * 0.5 + layer * 0.5;
    const c = greens[Math.min(greens.length - 1, Math.floor(lit * greens.length * (0.7 + rand() * 0.5)))]!;
    const a = Math.round(rand() * 360);
    leaves += `<path d="M0 0Q${f(size * 0.5)} ${f(-size * 0.32)} ${f(size)} 0Q${f(size * 0.5)} ${f(size * 0.32)} 0 0Z" fill="${c}" transform="translate(${f(x)} ${f(y)}) rotate(${a})"/>`;
  }
  let washes = '';
  for (let i = 0; i < 6; i++) {
    const cx = w * (0.08 + i * 0.168);
    washes += `<ellipse cx="${f(cx)}" cy="${f(wallH * 0.05)}" rx="${f(w * 0.09)}" ry="${f(wallH * 0.55)}" fill="url(#hc-o-gwash)"/>`;
  }
  return (
    `<svg class="hc-o-stage__garden" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" aria-hidden="true">` +
    `<defs><radialGradient id="hc-o-gwash"><stop offset="0" stop-color="#ffd9a0" stop-opacity=".2"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="hc-o-gshade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".45" stop-color="#000" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient></defs>` +
    `<rect width="${w.toFixed(0)}" height="${f(wallH)}" fill="#122117"/>${leaves}${washes}` +
    `<rect width="${w.toFixed(0)}" height="${f(wallH)}" fill="url(#hc-o-gshade)"/>` +
    `<rect y="${f(wallH - 3)}" width="${w.toFixed(0)}" height="4" fill="#0b0c0d"/></svg>`
  );
}

export function createStage(host: StageHost): Stage {
  const { doc, strings: S } = host;
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    e.className = cls;
    if (parent) parent.append(e);
    return e;
  };
  const el = mk('div', 'hc-o-stage');
  el.hidden = true;
  el.tabIndex = -1;
  el.setAttribute('role', 'region');
  const bg = mk('div', 'hc-o-stage__bg', el);
  const glass = mk('div', 'hc-o-stage__glass', el);
  const svgNS = 'http://www.w3.org/2000/svg';
  const tableSvg = doc.createElementNS(svgNS, 'svg');
  tableSvg.setAttribute('class', 'hc-o-stage__table');
  tableSvg.setAttribute('aria-hidden', 'true');
  el.append(tableSvg);
  const cards = mk('div', 'hc-o-stage__cards', el);
  const seatsEl = mk('div', 'hc-o-stage__seats', el);
  seatsEl.setAttribute('role', 'group');
  const head = mk('div', 'hc-o-stage__head', el);
  const title = mk('div', 'hc-o-stage__title', head);
  const roomName = mk('b', '', title);
  const talking = mk('span', '', title);
  const clock = mk('span', 'hc-o-stage__clock', title);
  const actions = mk('div', 'hc-o-stage__actions', head);
  const inviteBtn = mk('button', 'hc-o-btn', actions);
  inviteBtn.type = 'button';
  inviteBtn.innerHTML = `${S.invite} <kbd>I</kbd>`;
  const ccBtn = mk('button', 'hc-o-btn', actions);
  ccBtn.type = 'button';
  ccBtn.textContent = 'CC';
  ccBtn.setAttribute('aria-label', S.captions);
  ccBtn.setAttribute('aria-pressed', 'true');
  const leaveBtn = mk('button', 'hc-o-btn hc-o-btn--leave', actions);
  leaveBtn.type = 'button';
  leaveBtn.innerHTML = `${S.leave} <kbd>Esc</kbd>`;
  const empty = mk('div', 'hc-o-stage__empty', el);
  empty.textContent = S.emptyStage;
  const bottom = mk('div', 'hc-o-stage__bottom', el);
  const floorLine = mk('div', 'hc-o-stage__floor', bottom);
  const cap = mk('div', 'hc-o-stage__cap', bottom);
  cap.hidden = true;
  const capWho = mk('div', 'hc-o-cap__who', cap);
  const capName = mk('b', '', capWho);
  // "not voiced" is a tag beside the speaker's name, never part of the spoken text.
  const capTag = mk('span', 'hc-o-cap__tag', capWho);
  capTag.textContent = S.notVoiced;
  capTag.hidden = true;
  const capText = mk('span', 'hc-o-cap__text', cap);
  const dockEl = mk('div', 'hc-o-stage__dock', bottom);
  // Standalone composer (the host's own dock replaces it through scene.dock()).
  const form = mk('form', 'hc-o-compose', dockEl);
  const input = mk('input', 'hc-o-input', form);
  input.type = 'text';
  input.placeholder = S.messageRoom;
  input.setAttribute('aria-label', S.messageRoom);
  const send = mk('button', 'hc-o-btn hc-o-btn--primary', form);
  send.type = 'submit';
  send.textContent = S.send;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    host.onTalk(text);
  });

  let room: StageRoom | null = null;
  let isOpen = false;
  let openedAt = 0;
  let geom: StageGeom | null = null;
  const seats = new Map<string, SeatView>();
  let order: string[] = [];
  let speaker: string | null = null;
  let captionsOn = true;
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let focused: string | null = null;
  const floorFaces: FaceSlot[] = [];
  let bgKey = '';

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  inviteBtn.addEventListener('click', () => host.onInvite());
  leaveBtn.addEventListener('click', () => host.onLeave());
  ccBtn.addEventListener('click', () => api.toggleCaptions());

  const setTier = (v: SeatView, tier: FaceTier) => {
    if (v.tier === tier) return;
    v.tier = tier;
    v.face?.setTier(tier);
  };

  const renderBackdrop = () => {
    if (!room || !geom) return;
    const key = `${room.view}:${geom.w}x${geom.h}`;
    const bd = host.backdrop(room.view);
    el.dataset.view = room.view;
    if (room.view === 'garden') {
      // The generated living wall when there is art, else the vector wall (keyless).
      const gKey = `${key}:${bd?.src ?? 'vector'}`;
      if (bgKey !== gKey) {
        bgKey = gKey;
        bg.replaceChildren();
        if (bd?.src) {
          const frame = mk('div', 'hc-o-stage__frame hc-o-stage__frame--wall', bg);
          if (bd.lqip) frame.style.backgroundImage = `url("${bd.lqip}")`;
          const img = mk('img', '', frame);
          img.alt = '';
          img.decoding = 'async';
          if (bd.srcset) {
            img.srcset = bd.srcset;
            img.sizes = '100vw';
          }
          img.src = bd.src;
        } else bg.innerHTML = gardenSvg(geom.w, geom.h, geom.wallFloorY);
      }
      const frame = bg.querySelector<HTMLElement>('.hc-o-stage__frame--wall');
      if (frame) {
        // Cover the wall from the top of the stage to the floor line; the floor hides the rest.
        const aspect = bd?.aspect ?? 16 / 9;
        const fw = Math.max(geom.w, geom.wallFloorY * aspect) * 1.02;
        const fh = fw / aspect;
        frame.style.cssText += `;width:${fw.toFixed(0)}px;height:${fh.toFixed(0)}px;left:${((geom.w - fw) / 2).toFixed(0)}px;top:${Math.min(0, (geom.wallFloorY - fh) * 0.25).toFixed(0)}px`;
      }
      el.style.setProperty('--floor-y', `${geom.wallFloorY.toFixed(0)}px`);
      glass.innerHTML = '';
      return;
    }
    const srcKey = `${key}:${bd?.src ?? 'none'}`;
    if (bgKey !== srcKey) {
      bgKey = srcKey;
      bg.replaceChildren();
      if (bd?.src) {
        const frame = mk('div', 'hc-o-stage__frame', bg);
        if (bd.lqip) frame.style.backgroundImage = `url("${bd.lqip}")`;
        const img = mk('img', '', frame);
        img.alt = '';
        img.decoding = 'async';
        if (bd.srcset) {
          img.srcset = bd.srcset;
          img.sizes = '100vw';
        }
        img.src = bd.src;
        const tw = mk('div', 'hc-o-sky__tw', frame);
        const rand = mulberry32(3);
        for (const l of (bd.lights ?? []).slice(0, 40)) {
          const i = mk('i', l.warm ? 'w' : 'c', tw);
          i.style.cssText = `left:${(l.x * 100).toFixed(2)}%;top:${(l.y * 100).toFixed(2)}%;--d:${Math.max(1.6, l.r * 2).toFixed(1)}px;--t:${(5 + rand() * 6).toFixed(2)}s;--dl:${(-rand() * 11).toFixed(2)}s`;
        }
      } else {
        bg.innerHTML = `<div class="hc-o-stage__frame hc-o-stage__frame--vector"></div>`;
      }
    }
    // Place the image so its horizon sits at eye level and it covers the glass down to the floor line.
    const frame = bg.firstElementChild as HTMLElement | null;
    if (frame) {
      const hz = bd?.horizon ?? 0.4;
      const aspect = bd?.aspect ?? 16 / 9;
      const fh = Math.max(geom.horizonY / hz, (geom.wallFloorY - geom.horizonY) / (1 - hz), geom.w / aspect) * 1.04;
      const fw = fh * aspect;
      frame.style.cssText += `;width:${fw.toFixed(0)}px;height:${fh.toFixed(0)}px;left:${((geom.w - fw) / 2).toFixed(0)}px;top:${(geom.horizonY - hz * fh).toFixed(0)}px`;
    }
    // Far glass: mullions and a transom, frontal to the camera.
    let m = '';
    const n = 7;
    for (let i = 1; i < n; i++) m += `<i style="left:${((i / n) * 100).toFixed(2)}%"></i>`;
    glass.innerHTML = `${m}<b style="top:${(geom.wallFloorY - 2).toFixed(0)}px"></b><u style="top:${Math.max(0, geom.horizonY * 0.18).toFixed(0)}px"></u>`;
    glass.style.height = `${geom.wallFloorY.toFixed(0)}px`;
    el.style.setProperty('--floor-y', `${geom.wallFloorY.toFixed(0)}px`);
  };

  const poolAt = (): { x: number; y: number } | null => {
    if (!geom) return null;
    const sp = speaker ? seats.get(speaker) : null;
    const spPos = sp && !geom.narrow ? geom.seats[sp.slot] : null;
    return spPos ? { x: (spPos.card.x * 2 + geom.pool.x) / 3, y: (spPos.card.y * 2 + geom.pool.y) / 3 } : geom.pool;
  };
  const updatePool = () => {
    const p = poolAt();
    const e = tableSvg.querySelector<SVGEllipseElement>('.hc-o-stage__pool');
    if (!p || !e) return;
    e.style.setProperty('cx', `${p.x.toFixed(0)}px`);
    e.style.setProperty('cy', `${p.y.toFixed(0)}px`);
  };

  const renderTable = () => {
    if (!geom) return;
    const g = geom;
    const { farY, nearY, cx, farHalf, nearHalf } = g.table;
    const f = (v: number) => v.toFixed(1);
    const d = tablePath(g);
    const [edgeL, edgeR] = tableEdges(g);
    const pool = poolAt() ?? g.pool;
    const pr = Math.max(80, (nearY - farY) * 0.42);
    tableSvg.setAttribute('viewBox', `0 0 ${g.w.toFixed(0)} ${g.h.toFixed(0)}`);
    tableSvg.setAttribute('width', g.w.toFixed(0));
    tableSvg.setAttribute('height', g.h.toFixed(0));
    // Long window reflections and grain lines converging on the far end.
    let streaks = '';
    for (const [u, wFar, wNear, a] of [[-0.42, 0.05, 0.12, 0.05], [0.08, 0.03, 0.09, 0.07], [0.46, 0.06, 0.16, 0.045]] as const) {
      const x0 = cx + u * farHalf;
      const x1 = cx + u * nearHalf;
      streaks += `<path d="M${f(x0 - wFar * farHalf)} ${f(farY + 2)}L${f(x0 + wFar * farHalf)} ${f(farY + 2)}L${f(x1 + wNear * nearHalf)} ${f(nearY)}L${f(x1 - wNear * nearHalf)} ${f(nearY)}Z" fill="url(#hc-o-tstreak)" opacity="${(a * 1.4).toFixed(3)}"/>`;
    }
    let grain = '';
    for (let i = -6; i <= 6; i++) {
      const u = i / 7.4;
      grain += `M${f(cx + u * farHalf)} ${f(farY + 2)}L${f(cx + u * nearHalf)} ${f(nearY)}`;
    }
    // Each occupied seat gets a glass of water and a notebook in front of it.
    let places = '';
    for (const v of seats.values()) {
      const p = g.seats[v.slot];
      if (!p || g.narrow) continue;
      const k = p.place.scale;
      const side = p.side === 'left' ? -1 : p.side === 'right' ? 1 : 0;
      const nx = p.place.x - side * 10 * k;
      places += `<g transform="translate(${f(nx)} ${f(p.place.y)}) scale(${k.toFixed(3)})"><rect x="-17" y="-9" width="30" height="20" rx="2" fill="#d9d3c8" opacity=".78" transform="rotate(${side * -8 - 3}) skewX(${side * -18})"/><rect x="-15" y="-7" width="3" height="16" fill="#8b6f58" opacity=".6" transform="rotate(${side * -8 - 3}) skewX(${side * -18})"/></g>`;
      const gx = p.place.x + side * 30 * k;
      places += `<g transform="translate(${f(gx)} ${f(p.place.y - 6 * k)}) scale(${k.toFixed(3)})"><ellipse cx="0" cy="14" rx="7" ry="2.6" fill="#000" opacity=".35"/><path d="M-6 -10L-5 12Q0 14 5 12L6 -10Z" fill="#cfe2ff" opacity=".16"/><ellipse cx="0" cy="-10" rx="6" ry="2.2" fill="none" stroke="#dfeaff" stroke-opacity=".45" stroke-width="1"/><path d="M-3.5 -6L-3 9" stroke="#fff" stroke-opacity=".35" stroke-width="1.2"/></g>`;
    }
    // Empty seats between people: chairs pushed in, faint (.35) with a hairline top edge. None beyond the last person.
    let chairs = '';
    // Occupied seats: a scrim that lifts the face off the skyline, the chair back and the shoulders, all painted
    // before the table so its long edge tucks them in (they sit at the table, not in front of it).
    let scrims = '';
    let bodies = '';
    let bodyDefs = '';
    if (!g.narrow) {
      const taken = new Set([...seats.values()].map((v) => v.slot));
      const last = Math.max(-1, ...taken);
      g.seats.forEach((p, i) => {
        if (taken.has(i) || i > last) return;
        const c = emptyChair(g, i);
        if (c.d) chairs += `<path d="${c.d}" fill="url(#hc-o-chair)" fill-opacity=".35"/><path d="${c.top}" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="1"/>`;
      });
      for (const v of [...seats.values()].sort((a, b) => a.slot - b.slot)) {
        const p = g.seats[v.slot];
        if (!p) continue;
        const sz = p.size;
        scrims += `<ellipse cx="${f(p.x)}" cy="${f(p.y)}" rx="${f(sz * 0.85)}" ry="${f(sz * 0.85)}" fill="url(#hc-o-scrim)"/>`;
        const out = p.side === 'left' ? -1 : p.side === 'right' ? 1 : 0;
        // Chair back: a rounded mesh back a little outboard, rising behind the shoulders to the base of the head.
        const bw = sz * 1.08;
        const bx = p.x + out * sz * 0.1 - bw / 2;
        const bt = p.y - sz * 0.12;
        const bb = p.tableY + sz * 0.18;
        const br = bw * 0.28;
        bodies += `<path d="M${f(bx)} ${f(bb)}V${f(bt + br)}Q${f(bx)} ${f(bt)} ${f(bx + br)} ${f(bt)}H${f(bx + bw - br)}Q${f(bx + bw)} ${f(bt)} ${f(bx + bw)} ${f(bt + br)}V${f(bb)}Z" fill="url(#hc-o-chairback)"/>`;
        bodies += `<path d="M${f(bx + br * 0.4)} ${f(bt + 1.5)}H${f(bx + bw - br * 0.4)}" stroke="#fff" stroke-opacity=".08" stroke-width="1" fill="none"/>`;
        // Shoulders: 1.3 × the face wide, a rounded top from just under the chin, in a muted version of the accent.
        const sw = sz * 1.3;
        const sx = p.x - sw / 2;
        const st = p.y + sz * 0.36;
        const sb = p.tableY + sz * 0.3;
        const sr = sw * 0.34;
        const fill = mixHex(host.accent(v.id), '#262a31', 0.38);
        // The torso fades out toward the floor instead of ending in a hard edge.
        bodyDefs += `<linearGradient id="hc-o-sh${v.slot}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fill}"/><stop offset=".55" stop-color="${fill}"/><stop offset="1" stop-color="${fill}" stop-opacity="0"/></linearGradient>`;
        const top = `M${f(sx)} ${f(st + sr * 0.9)}Q${f(sx)} ${f(st)} ${f(sx + sr)} ${f(st)}H${f(sx + sw - sr)}Q${f(sx + sw)} ${f(st)} ${f(sx + sw)} ${f(st + sr * 0.9)}`;
        bodies += `<path d="${top}V${f(sb)}H${f(sx)}Z" fill="url(#hc-o-sh${v.slot})"/><path d="${top}V${f(sb)}H${f(sx)}Z" fill="url(#hc-o-torso)"/>`;
        bodies += `<path d="${top}" fill="none" stroke="#fff" stroke-opacity=".06" stroke-width="1.2"/>`;
      }
    }
    const puckY = g.pool.y;
    tableSvg.innerHTML =
      `<defs><linearGradient id="hc-o-tbl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c211a"/><stop offset=".45" stop-color="#3d2c21"/><stop offset="1" stop-color="#4b3628"/></linearGradient>` +
      `<linearGradient id="hc-o-tstreak" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9cff5" stop-opacity=".9"/><stop offset=".6" stop-color="#b9cff5" stop-opacity=".25"/><stop offset="1" stop-color="#b9cff5" stop-opacity="0"/></linearGradient>` +
      `<radialGradient id="hc-o-tpool"><stop offset="0" stop-color="#ffd59a" stop-opacity=".34"/><stop offset=".5" stop-color="#ffd59a" stop-opacity=".11"/><stop offset="1" stop-color="#ffd59a" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="hc-o-tedge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
      `<linearGradient id="hc-o-tnear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>` +
      `<linearGradient id="hc-o-chair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2f37"/><stop offset=".7" stop-color="#15171b"/><stop offset="1" stop-color="#0b0c0e"/></linearGradient>` +
      `<linearGradient id="hc-o-torso" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".05"/><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity=".3"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>` +
      `<linearGradient id="hc-o-chairback" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d323b"/><stop offset=".6" stop-color="#171a1f"/><stop offset="1" stop-color="#101216" stop-opacity="0"/></linearGradient>` +
      bodyDefs +
      `<radialGradient id="hc-o-scrim"><stop offset="0" stop-color="rgb(4,6,10)" stop-opacity=".55"/><stop offset=".6" stop-color="rgb(4,6,10)" stop-opacity=".32"/><stop offset="1" stop-color="rgb(4,6,10)" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="hc-o-tshadow"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>` +
      `<ellipse cx="${cx}" cy="${f(farY + (nearY - farY) * 0.6)}" rx="${f(nearHalf * 1.15)}" ry="${f((nearY - farY) * 0.66)}" fill="url(#hc-o-tshadow)"/>` +
      scrims +
      chairs +
      bodies +
      `<path d="${edgeL}" fill="#1b140f"/><path d="${edgeR}" fill="#1b140f"/>` +
      `<path d="${d}" fill="url(#hc-o-tbl)"/>` +
      `<path d="${grain}" stroke="#000" stroke-opacity=".10" stroke-width="1" fill="none"/>` +
      streaks +
      `<path d="${d}" fill="none" stroke="rgba(255,235,210,.08)" stroke-width="1"/>` +
      `<rect x="${f(cx - farHalf)}" y="${f(farY - 0.5)}" width="${f(farHalf * 2)}" height="1.4" fill="url(#hc-o-tedge)"/>` +
      `<ellipse class="hc-o-stage__pool" cx="${pool.x.toFixed(0)}" cy="${pool.y.toFixed(0)}" rx="${(pr * 1.5).toFixed(0)}" ry="${(pr * 0.5).toFixed(0)}" fill="url(#hc-o-tpool)"/>` +
      `<ellipse cx="${cx}" cy="${f(puckY + 2)}" rx="${f(farHalf * 0.26)}" ry="${f(farHalf * 0.07)}" fill="#000" opacity=".4"/>` +
      `<ellipse cx="${cx}" cy="${f(puckY)}" rx="${f(farHalf * 0.22)}" ry="${f(farHalf * 0.07)}" fill="#15171b"/>` +
      `<ellipse cx="${cx}" cy="${f(puckY - 1.5)}" rx="${f(farHalf * 0.19)}" ry="${f(farHalf * 0.055)}" fill="#262a31"/>` +
      `<ellipse class="hc-o-stage__puck" cx="${cx}" cy="${f(puckY - 1.5)}" rx="${f(farHalf * 0.07)}" ry="${f(farHalf * 0.02)}"/>` +
      places +
      `<rect x="0" y="${f(g.h - Math.min(260, g.h * 0.3))}" width="${g.w.toFixed(0)}" height="${f(Math.min(260, g.h * 0.3))}" fill="url(#hc-o-tnear)"/>`;
  };

  const layoutSeats = () => {
    if (!geom) return;
    const g = geom;
    const sp = speaker ? seats.get(speaker) : null;
    const spPos = sp ? g.seats[sp.slot] ?? null : null;
    const rm = host.reducedMotion();
    const narrowPos = g.narrow ? narrowPositions(g.w, g.h, order.length, Math.max(0, speaker ? order.indexOf(speaker) : 0)) : null;
    for (const v of seats.values()) {
      const p = g.seats[v.slot];
      if (!p) continue;
      const isSpeaker = v.id === speaker;
      const np = narrowPos ? narrowPos[order.indexOf(v.id)] : null;
      const x = np ? np.x : p.x;
      const y = np ? np.y : p.y;
      const size = np ? np.size : p.size;
      v.el.style.left = `${x.toFixed(1)}px`;
      v.el.style.top = `${y.toFixed(1)}px`;
      v.el.style.zIndex = String(Math.round(p.depth * 100) + (isSpeaker ? 200 : 0));
      v.el.style.setProperty('--fs', `${size.toFixed(1)}px`);
      const tilt = rm || np ? 0 : tiltFor(p, spPos, false);
      v.el.style.setProperty('--tilt', `${tilt.toFixed(1)}deg`);
      v.card.style.left = `${p.card.x.toFixed(1)}px`;
      v.card.style.top = `${p.card.y.toFixed(1)}px`;
      v.card.style.setProperty('--cs', p.card.scale.toFixed(3));
      v.card.style.zIndex = String(Math.round(p.depth * 100));
      v.el.dataset.side = p.side;
    }
    updatePool();
  };

  const updateTitle = () => {
    if (!room) return;
    roomName.textContent = room.name;
    const names = order.map((id) => host.person(id)?.name.split(/\s+/)[0] ?? id);
    talking.textContent = names.length ? S.talkingWith(names) : S.free;
    empty.hidden = order.length > 0;
    el.setAttribute('aria-label', room.name);
    seatsEl.setAttribute('aria-label', names.length ? S.talkingWith(names) : room.name);
  };

  const speakerTiers = () => {
    const recent = speaker;
    for (const v of seats.values()) setTier(v, v.id === recent ? 'hero' : 'token');
  };

  const addSeat = (id: string, slot: number, arriving: boolean) => {
    const p = host.person(id);
    if (!p) return;
    const acc = host.accent(id);
    const seat = mk('div', 'hc-o-sseat');
    seat.dataset.pid = id;
    seat.style.setProperty('--acc', acc);
    const faceBtn = mk('button', 'hc-o-sseat__face', seat);
    faceBtn.type = 'button';
    faceBtn.tabIndex = -1;
    const faceBox = mk('span', 'hc-o-sseat__facebox', faceBtn);
    mk('span', 'hc-o-sseat__ring', faceBtn);
    const nm = mk('span', 'hc-o-sseat__name', seat);
    nm.textContent = p.name.split(/\s+/)[0] ?? p.name;
    const back = mk('button', 'hc-o-sseat__back', seat);
    back.type = 'button';
    back.textContent = S.backToDesk;
    back.tabIndex = -1;
    back.addEventListener('click', (e) => {
      e.stopPropagation();
      host.onDismiss(id);
    });
    const face = host.face(id, 'token');
    faceBox.append(face.el);
    if (face.drawsChrome) seat.dataset.hostChrome = '';
    faceBtn.setAttribute('aria-label', S.seatLabel(p.name, p.title, host.groupName(p.groupId), ''));
    faceBtn.addEventListener('click', () => host.onOpen(id));
    faceBtn.addEventListener('focus', () => {
      focused = id;
      host.onFocusChange(id);
    });
    const card = mk('div', 'hc-o-tent', cards);
    card.dataset.pid = id;
    card.style.setProperty('--acc', acc);
    const cb = mk('b', '', card);
    cb.textContent = p.name;
    const cs = mk('small', '', card);
    cs.textContent = p.title;
    const v: SeatView = { id, slot, el: seat, faceBtn, faceBox, face, tier: 'token', card, state: 'idle', label: '' };
    seats.set(id, v);
    seatsEl.append(seat);
    if (arriving && !host.reducedMotion()) {
      seat.classList.add('is-arriving');
      card.classList.add('is-arriving');
      void seat.offsetWidth;
      later(() => {
        seat.classList.remove('is-arriving');
        card.classList.remove('is-arriving');
      }, 20);
    }
  };

  const removeSeat = (id: string) => {
    const v = seats.get(id);
    if (!v) return;
    seats.delete(id);
    v.face?.destroy();
    v.el.remove();
    v.card.remove();
    if (focused === id) focused = null;
  };

  let partySize = 0;
  const layoutGeometry = () => {
    if (!room) return;
    const w = el.clientWidth || doc.documentElement.clientWidth || 1280;
    const h = el.clientHeight || doc.documentElement.clientHeight || 800;
    const narrow = w < 900;
    if (narrow) el.dataset.narrow = '';
    else delete el.dataset.narrow;
    const highest = Math.max(-1, ...[...seats.values()].map((v) => v.slot));
    geom = stageGeometry(w, h, tableSeatsFor(Math.max(partySize, seats.size), highest), { top: narrow ? 60 : 64, bottom: narrow ? 150 : 176 });
  };

  const updateFocusable = () => {
    const first = focused && seats.has(focused) ? focused : order[0];
    for (const v of seats.values()) v.faceBtn.tabIndex = v.id === first ? 0 : -1;
  };

  const api: Stage = {
    el,
    dockEl,
    get isOpen() {
      return isOpen;
    },
    open(r, participants, animate) {
      room = r;
      isOpen = true;
      openedAt = host.now();
      el.hidden = false;
      el.dataset.view = r.view;
      bgKey = '';
      partySize = participants.length;
      api.layout();
      api.setParticipants(participants, []);
      if (animate && !host.reducedMotion()) {
        el.classList.add('is-entering');
        void el.offsetWidth;
        el.classList.remove('is-entering');
      }
      // The meeting clock starts with the owner's first words (as the Talk note measures it); an empty room shows none.
      clock.textContent = '';
      clock.hidden = true;
      if (clockTimer) clearInterval(clockTimer);
      clockTimer = null;
    },
    close(animate) {
      if (!isOpen) return;
      isOpen = false;
      if (clockTimer) clearInterval(clockTimer);
      clockTimer = null;
      const finish = () => {
        if (isOpen) return;
        el.hidden = true;
        el.classList.remove('is-leaving');
        for (const id of [...seats.keys()]) removeSeat(id);
        order = [];
        partySize = 0;
        speaker = null;
        cap.hidden = true;
        for (const f of floorFaces.splice(0)) f.destroy();
        floorLine.replaceChildren();
      };
      if (animate && !host.reducedMotion()) {
        el.classList.add('is-leaving');
        later(finish, 260);
      } else finish();
    },
    setParticipants(ids, arriving = []) {
      const next = ids.filter((id) => host.person(id));
      for (const id of [...seats.keys()]) if (!next.includes(id)) removeSeat(id);
      const used = new Set([...seats.values()].map((v) => v.slot));
      // The table follows the party (room.capacity only limits the picker): re-lay it out when the count changes.
      partySize = next.length;
      if (room) layoutGeometry();
      const capacity = geom?.seats.length ?? 10;
      for (const id of next) {
        if (seats.has(id)) continue;
        let slot = 0;
        while (used.has(slot) && slot < capacity) slot++;
        if (slot >= capacity) continue;
        used.add(slot);
        addSeat(id, slot, arriving.includes(id));
      }
      order = next.filter((id) => seats.has(id)).sort((a, b) => seats.get(a)!.slot - seats.get(b)!.slot);
      if (speaker && !seats.has(speaker)) speaker = null;
      updateTitle();
      updateFocusable();
      layoutSeats();
      renderTable();
      speakerTiers();
    },
    setSpeaking(id, on) {
      const next = on ? id : speaker === id ? null : speaker;
      if (next === speaker) return;
      if (speaker) {
        const prev = seats.get(speaker);
        if (prev) {
          delete prev.el.dataset.speaking;
          delete prev.card.dataset.speaking;
        }
      }
      speaker = next && seats.has(next) ? next : null;
      if (speaker) {
        const v = seats.get(speaker)!;
        v.el.dataset.speaking = '';
        v.card.dataset.speaking = '';
      }
      if (speaker) el.dataset.speaking = '';
      else delete el.dataset.speaking;
      speakerTiers();
      layoutSeats();
    },
    setPresence(id, state, label = '') {
      const v = seats.get(id);
      if (!v) return;
      v.state = state;
      v.label = label;
      v.el.dataset.state = state;
      v.face?.setState?.(state, label);
      const p = host.person(id);
      if (p) v.faceBtn.setAttribute('aria-label', S.seatLabel(p.name, p.title, host.groupName(p.groupId), state === 'idle' ? '' : label || S.states[state]));
    },
    showCaption(id, text, opts = {}) {
      if (!text) {
        cap.hidden = true;
        return;
      }
      if (!id && isOpen && !clockTimer) {
        openedAt = host.now();
        clock.hidden = false;
        clock.textContent = fmtTime(0);
        clockTimer = setInterval(() => {
          clock.textContent = fmtTime(host.now() - openedAt);
        }, 1000);
      }
      const p = id ? host.person(id) : null;
      capName.textContent = p ? p.name.split(/\s+/)[0]!.toUpperCase() : S.you.toUpperCase();
      capName.style.color = id ? host.accent(id) : '';
      capText.textContent = text;
      capTag.hidden = opts.voiced !== false;
      cap.hidden = !captionsOn;
      cap.dataset.final = opts.final ? '1' : '';
    },
    setFloorQueue(ids) {
      for (const f of floorFaces.splice(0)) f.destroy();
      floorLine.replaceChildren();
      const list = ids.filter((id) => host.person(id));
      if (!list.length) return;
      const lbl = mk('span', 'hc-o-stage__floorlbl', floorLine);
      lbl.textContent = `${S.floor}:`;
      list.forEach((id, i) => {
        if (i) mk('span', 'hc-o-stage__arrow', floorLine).textContent = '→';
        const chip = mk('span', 'hc-o-stage__chip', floorLine);
        const fb = mk('span', 'hc-o-stage__chipface', chip);
        fb.style.setProperty('--acc', host.accent(id));
        const f = host.face(id, 'token');
        floorFaces.push(f);
        fb.append(f.el);
        mk('span', '', chip).textContent = host.person(id)!.name.split(/\s+/)[0]!;
      });
    },
    claimDock() {
      form.remove();
      dockEl.dataset.host = '';
      return dockEl;
    },
    focusFirst() {
      const id = (focused && seats.has(focused) ? focused : order[0]) ?? null;
      if (!id) {
        (dockEl.querySelector('input,textarea,button') as HTMLElement | null)?.focus();
        return false;
      }
      seats.get(id)!.faceBtn.focus();
      return true;
    },
    moveFocus(dir) {
      if (!order.length) return;
      const i = focused ? order.indexOf(focused) : -1;
      const next = order[(i + dir + order.length) % order.length]!;
      focused = next;
      updateFocusable();
      seats.get(next)!.faceBtn.focus();
    },
    focusedId: () => (focused && seats.has(focused) && doc.activeElement === seats.get(focused)!.faceBtn ? focused : null),
    toggleCaptions() {
      captionsOn = !captionsOn;
      ccBtn.setAttribute('aria-pressed', String(captionsOn));
      if (!captionsOn) cap.hidden = true;
      else if (capText.textContent) cap.hidden = false;
    },
    layout() {
      if (!room) return;
      layoutGeometry();
      renderBackdrop();
      renderTable();
      layoutSeats();
    },
    destroy() {
      if (clockTimer) clearInterval(clockTimer);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const id of [...seats.keys()]) removeSeat(id);
      for (const f of floorFaces.splice(0)) f.destroy();
      el.remove();
    },
  };
  return api;
}

export type { StageSeatPos };
