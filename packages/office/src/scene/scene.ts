// createOfficeScene (OFFICE-PLAN §5): the office floor as a framework-agnostic DOM scene. One CSS-transformed world
// layer (plate SVG + people-from-above + light), screen-space HTML for faces, labels and bubbles, a screen-space sky
// behind, the conference stage and the HUD on top. A single rAF loop runs only while something moves.
import { buildLightSvg } from '../art/light';
import { bodyGlyph } from '../art/bodies';
import { buildPlateSvg } from '../art/plate';
import type { OfficeManifest } from '../art/skyline';
import { conferenceEntry, gardenEntry, loadManifest, normalizeBase, srcsetOf } from '../art/skyline';
import { hitTest } from '../plan/hit';
import { DEFAULT_ROOMS, planOffice } from '../plan/plan';
import type { OfficePlan, OfficeSeat, PlanRoom, PlanZone } from '../plan/types';
import { pathLength, pointAt, simplify, walkPath } from '../plan/walk';
import { K_Y, K_Z, fromScreen } from '../projection';
import type { OfficeStrings } from '../strings';
import { resolveStrings } from '../strings';
import { injectStyles, releaseStyles } from '../styles';
import { timeOfDayAt } from '../time';
import type {
  Camera,
  FaceSlot,
  FaceTier,
  Facing,
  HoverVia,
  OfficeGroup,
  OfficeMode,
  OfficeOptions,
  OfficePerson,
  OfficeScene,
  OfficeState,
  OfficeTheme,
  Point,
  PresenceBadge,
  PresenceState,
  Rect,
  TimeOfDay,
} from '../types';
import { createStage } from '../stage/stage';
import type { Stage } from '../stage/stage';
import { openPicker } from '../stage/picker';
import type { Picker } from '../stage/picker';
import type { Viewport } from './camera';
import {
  MAX_ZOOM,
  clampCamera,
  clampZoom,
  easeInOut,
  easeOut,
  fitCamera,
  flightCamera,
  followPoint,
  frameRect,
  inertiaDuration,
  inertiaOffset,
  lerpCamera,
  minZoomFor,
  outOfBounds,
  panBy,
  rubberBand,
  velocityOf,
  zoomAround,
} from './camera';
import { createDwell } from './dwell';
import { createHud } from './hud';
import type { Hud } from './hud';
import { faceSize, allocateTiers, lodFor, NAMES_ZOOM } from './lod';
import type { Lod } from './lod';
import { makeFace } from './faces';
import { createSky } from './sky';
import type { SkyLayer } from './sky';

const WALK_SPEED = 260; // u/s
const FLIGHT_MS = 600;
const SETTLE_MS = 120;
const MAX_FACES = 96;
const RELEASE_OFFSCREEN_MS = 10_000;
const RELEASE_L0_MS = 2_000;
const ZOOM_NEIGHBOURHOOD = 3.2;
const ZOOM_DESK = 5.6;
/** Phones open on the Chief's neighbourhood at a legible zoom, with the floor filling about two thirds of the view. */
const NARROW_W = 640;
const ZOOM_PHONE = 2.4;
const PHONE_FLOOR_LINE = 0.33;
/** Twinkle and beacons pause after this long without input (WCAG 2.2.2) and resume on pointer or key. */
const CALM_MS = 30_000;
/** Status lines under a badge stay within the §2.1 cap. */
const STATUS_CAP = 48;
/** Projected y of the skyline's waterline anchor inside the north glass. */
const SKY_ANCHOR_Z = 14;

interface Walk {
  path: Point[];
  len: number;
  start: number;
  dur: number;
  /** Where the walker ends up: a room seat or back at the desk. */
  to: { roomId: string; seatIndex: number } | null;
  done?: () => void;
}

interface PView {
  person: OfficePerson;
  acc: string;
  seat: OfficeSeat | null;
  btn: HTMLButtonElement;
  faceBox: HTMLElement;
  nameEl: HTMLElement;
  subEl: HTMLElement;
  body: SVGGElement | null;
  light: SVGGElement | null;
  /** Current place (plan u) and facing. */
  x: number;
  y: number;
  facing: Facing;
  roomId: string | null;
  roomSeat: number;
  walk: Walk | null;
  slot: FaceSlot | null;
  tier: FaceTier;
  lastVisible: number;
  visible: boolean;
  sx: number;
  sy: number;
  state: PresenceState;
  label: string;
  badges: PresenceBadge[];
  speaking: boolean;
  bodyFacing: Facing | null;
}

interface Bubble {
  id: string;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  expires: number;
  arc?: SVGSVGElement;
}

interface AnchorRec {
  id: string;
  el: HTMLElement;
}

interface Label {
  el: HTMLElement;
  /** Projected position. */
  p: Point;
  kind: 'zone' | 'room' | 'place' | 'chief';
  id: string;
}

const isTyping = (t: EventTarget | null): boolean => {
  const e = t as HTMLElement | null;
  if (!e || !e.tagName) return false;
  return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const capStatus = (text: string) => (text.length <= STATUS_CAP ? text : `${text.slice(0, STATUS_CAP - 1).replace(/[\s,;:.-]+\S*$/, '')}…`);
const Y = (y: number, z = 0) => y * K_Y - z * K_Z;

/** Where a face floats (plan z, u) for a seat facing: over the chair for people facing the camera, at head height otherwise. */
const anchorZ = (facing: Facing, inRoom: boolean): number => (inRoom ? 11 : facing === 's' ? 5 : 14.5);

export function createOfficeScene(host: HTMLElement, options: OfficeOptions): OfficeScene {
  const doc = host.ownerDocument;
  const win = doc.defaultView ?? (globalThis as unknown as Window);
  const S: OfficeStrings = resolveStrings(options.labels);
  const now = () => (options.now ? options.now().getTime() : Date.now());
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  injectStyles(doc);

  // ── state ──────────────────────────────────────────────────────────────────────────────────────────────────
  let people: OfficePerson[] = options.people.slice();
  let groups: OfficeGroup[] = options.groups.slice();
  let leadId = options.leadId;
  const rooms = (options.rooms ?? DEFAULT_ROOMS).slice();
  let theme: OfficeTheme = options.theme ?? 'dark';
  let todSetting: TimeOfDay | 'auto' = options.timeOfDay ?? 'auto';
  let tod: TimeOfDay = todSetting === 'auto' ? timeOfDayAt(new Date(now())) : todSetting;
  let rmSetting: boolean | null = options.reducedMotion ?? null;
  const assetsBase = options.assetsBase === null ? null : normalizeBase(options.assetsBase ?? '/office/');
  const cameraKey = options.cameraKey === undefined ? 'hc.office.camera' : options.cameraKey;
  let manifest: OfficeManifest | null = null;
  let destroyed = false;

  let plan!: OfficePlan;
  const views = new Map<string, PView>();
  const presence = new Map<string, { state: PresenceState; label: string; badges: PresenceBadge[] }>();
  const speaking = new Set<string>();
  const warned = new Set<string>();
  let mode: OfficeMode = 'desks';
  let roomId: string | null = null;
  let lastRoom: string | null = null;
  /** Who sits in each room (plan view), by room seat index. */
  const roomPeople = new Map<string, string[]>();
  let focusedId: string | null = null;
  let rovingId: string | null = null;
  let hoveredId: string | null = null;
  let dragId: string | null = null;
  let cam: Camera = { x: 0, y: 0, zoom: 1 };
  let vp: Viewport = { w: 1280, h: 800 };
  let fit: Camera = cam;
  let minZoom = 0.5;
  let lod: Lod = 0;
  let settledZoom = 1;
  let box: Rect = { x: 0, y: 0, w: 1, h: 1 };
  let findIds: Set<string> | null = null;

  const reducedMotion = (): boolean => {
    if (rmSetting !== null) return rmSetting;
    try {
      return !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  };
  const accentOf = (hex: string) => (options.accentFor ? options.accentFor(hex, theme) : hex);

  // ── DOM ────────────────────────────────────────────────────────────────────────────────────────────────────
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.append(e);
    return e;
  };
  const root = mk('div', 'hc-office');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', S.region);
  root.setAttribute('aria-roledescription', S.roleDescription);
  root.dataset.theme = theme;
  root.dataset.tod = tod;
  root.dataset.mode = mode;
  root.dataset.lod = '0';
  // Focusable (not a tab stop) so the keyboard map works after a click on the floor.
  root.tabIndex = -1;
  const skip = mk('a', 'hc-o-skip', root);
  skip.href = '#';
  skip.textContent = S.skipToDirectory;
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    options.onRequestDirectory?.();
  });
  const sky: SkyLayer = createSky(doc);
  root.append(sky.el);
  const world = mk('div', 'hc-o-world', root);
  world.setAttribute('aria-hidden', 'true');
  const labelsEl = mk('div', 'hc-o-labels', root);
  labelsEl.setAttribute('aria-hidden', 'true');
  const peopleEl = mk('div', 'hc-o-people', root);
  peopleEl.setAttribute('role', 'group');
  peopleEl.setAttribute('aria-label', S.seatsGroup);
  const bubblesEl = mk('div', 'hc-o-bubbles', root);
  const ghost = mk('div', 'hc-o-ghost', root);
  ghost.hidden = true;
  host.append(root);

  const stage: Stage = createStage({
    doc,
    strings: S,
    person: (id) => views.get(id)?.person,
    accent: (id) => views.get(id)?.acc ?? '#888',
    groupName: (gid) => groupName(gid),
    face: (id, tier) => makeFace(doc, options.faceFactory, views.get(id)!.person, views.get(id)!.acc, tier),
    reducedMotion,
    backdrop: (view) => {
      if (!assetsBase) return null;
      // The Skyline room looks through glass at the city for the time of day; the Garden room at its living wall.
      const e = view === 'garden' ? gardenEntry(manifest) : conferenceEntry(manifest, tod);
      if (!e) return null;
      return { src: `${assetsBase}${e.file}`, srcset: srcsetOf(e, assetsBase), lqip: e.lqip, horizon: e.horizon, aspect: e.width / e.height, lights: view === 'garden' ? [] : e.lights };
    },
    now: clock,
    onLeave: () => api.leaveRoom(),
    onInvite: () => openInvitePicker(),
    onTalk: (text) => roomId && options.onTalkToRoom?.(roomId, text),
    onOpen: (id) => options.onOpen?.(id, { via: 'click', mode, roomId }),
    onDismiss: (id) => api.seat(id, null),
    onFocusChange: (id) => options.onFocusChange?.(id),
  });
  root.append(stage.el);
  let picker: Picker | null = null;

  const hud: Hud = createHud({
    doc,
    strings: S,
    onZoom: (dir) => (dir === 0 ? api.zoomTo('fit') : zoomStep(dir)),
    onMode: (m) => api.setMode(m),
    walkTargets: () => [
      ...plan.rooms.map((r) => ({ id: r.id, label: r.name, group: 'rooms' as const })),
      { id: 'chief', label: S.places.chief, group: 'places' as const },
      ...(['cafe', 'lounge', 'library', 'reception'] as const).map((p) => ({ id: p, label: S.places[p], group: 'places' as const })),
      ...[...plan.zones].sort((a, b) => a.order - b.order).map((z) => ({ id: z.groupId, label: z.name, group: 'teams' as const })),
    ],
    onWalk: (id) => api.walkTo(id),
    find: (q) => findPeople(q),
    onFindChange: (q, ids) => {
      findIds = q ? new Set(ids) : null;
      applyFind();
    },
    onFindCommit: (id) => {
      api.focus(id, { animate: true, zoom: 'desk' });
    },
    onMinimap: (p) => {
      cam = clampCamera({ x: p.x, y: p.y, zoom: cam.zoom }, box, vp);
      stopMotion();
      requestFrame();
    },
  });
  root.append(hud.el);
  hud.setMode(mode);

  // ── plan and layers ────────────────────────────────────────────────────────────────────────────────────────
  const groupById = () => new Map(groups.map((g) => [g.id, g]));
  let groupsMap = groupById();
  const groupName = (gid: string) => groupsMap.get(gid)?.name ?? (gid === 'chief' ? S.places.chief : gid);
  const groupOrder = (gid: string) => plan.zones.find((z) => z.groupId === gid)?.order ?? -1;

  let bodiesSvg: SVGSVGElement | null = null;
  let lightSvg: SVGSVGElement | null = null;
  let plateSvg: SVGSVGElement | null = null;
  const labels: Label[] = [];

  const svgNS = 'http://www.w3.org/2000/svg';

  const buildWorld = () => {
    const plate = buildPlateSvg(plan);
    box = plate.box;
    const byId = new Map(people.map((p) => [p.id, p]));
    const light = buildLightSvg({ plan, accentOf: (pid) => accentOf(byId.get(pid)?.accent ?? '#888888') }, box);
    world.innerHTML = plate.svg + `<svg class="hc-o-bodies" xmlns="${svgNS}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" width="${box.w}" height="${box.h}" aria-hidden="true" focusable="false"></svg>` + light;
    world.style.width = `${box.w}px`;
    world.style.height = `${box.h}px`;
    plateSvg = world.querySelector('svg.hc-o-plate');
    bodiesSvg = world.querySelector('svg.hc-o-bodies');
    lightSvg = world.querySelector('svg.hc-o-light');
    applyWallArt();
    updateClock();
  };

  const buildLabels = () => {
    labelsEl.replaceChildren();
    labels.length = 0;
    const add = (kind: Label['kind'], id: string, p: Point, html: string, cls = '') => {
      const e = mk('div', `hc-o-label hc-o-label--${kind}${cls ? ` ${cls}` : ''}`, labelsEl);
      e.innerHTML = `<div class="hc-o-label__in">${html}</div>`;
      e.dataset.id = id;
      labels.push({ el: e, p, kind, id });
      return e;
    };
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    for (const z of plan.zones) {
      const cell = plan.cells.find((c) => c.id === z.cellIds[0])!;
      // A floor sign in the aisle under the neighbourhood: small caps at plan zoom, a door plate from L1.
      add('zone', z.id, { x: cell.x + 1, y: Y(cell.y + cell.h + 1.5) }, `<span>${esc(z.name)}</span><i>${S.headcount(z.headcount)}</i>`);
    }
    for (const r of plan.rooms) {
      add('room', r.id, { x: r.rect.x + r.rect.w / 2, y: Y(r.rect.y + r.rect.h - 2.5) }, `<b>${esc(r.name)}</b><small data-room-status></small>`);
    }
    const chief = plan.cells.find((c) => c.role === 'chief');
    const lead = views.get(leadId);
    if (chief && lead) add('chief', 'chief', { x: chief.x + 10, y: Y(chief.y + chief.h - 1, 0) }, `<b>${esc(lead.person.name)}</b><small>${esc(S.places.chief)}</small><em data-chief-status></em>`);
    for (const a of plan.amenities) {
      if (a.id === 'chief') continue;
      const r = a.rect;
      // Inside the cell's top-left corner (the aisle below belongs to the neighbourhood signs and the rooms).
      const p = a.id === 'reception' ? { x: r.x + r.w / 2, y: Y(r.y + r.h - 3) } : { x: r.x + 3, y: Y(r.y + 4) };
      add('place', a.id, p, `<span>${esc(S.places[a.id as 'cafe'])}</span>`, a.id === 'reception' ? 'is-center' : '');
    }
    updateRoomLabels();
    updateChiefLabel();
  };

  const buildViews = () => {
    const old = new Map(views);
    views.clear();
    peopleEl.replaceChildren();
    const seatByPerson = new Map(plan.seats.filter((s) => s.personId).map((s) => [s.personId!, s]));
    const lightBySeat = new Map<string, SVGGElement>();
    lightSvg?.querySelectorAll<SVGGElement>('g.hc-o-sl').forEach((g) => lightBySeat.set(g.dataset.seat ?? g.getAttribute('data-seat') ?? '', g));
    for (const p of people) {
      const seat = seatByPerson.get(p.id) ?? null;
      if (!seat) continue;
      const prev = old.get(p.id);
      const acc = accentOf(p.accent);
      const btn = mk('button', 'hc-o-seat', peopleEl);
      btn.type = 'button';
      btn.tabIndex = -1;
      btn.dataset.pid = p.id;
      btn.style.setProperty('--acc', acc);
      if (seat.kind === 'chief') btn.dataset.chief = '';
      mk('span', 'hc-o-seat__hit', btn);
      mk('span', 'hc-o-seat__shadow', btn);
      // Shoulders under the face, so a badge reads as a person sitting in the chair, not a floating head.
      mk('span', 'hc-o-seat__body', btn);
      const faceBox = mk('span', 'hc-o-seat__face', btn);
      mk('span', 'hc-o-seat__ring', btn);
      const plate = mk('span', 'hc-o-seat__plate', btn);
      mk('i', 'hc-o-seat__pip', plate);
      const nameEl = mk('span', 'hc-o-seat__name', plate);
      nameEl.dataset.first = firstName(p.name);
      nameEl.dataset.full = p.name;
      const parts = p.name.trim().split(/\s+/);
      nameEl.dataset.short = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.` : p.name;
      const subEl = mk('span', 'hc-o-seat__sub', btn);
      const body = bodiesSvg ? (doc.createElementNS(svgNS, 'g') as SVGGElement) : null;
      if (body && bodiesSvg) {
        body.setAttribute('class', 'hc-o-body');
        body.setAttribute('style', `--acc:${acc}`);
        bodiesSvg.append(body);
      }
      const pres = presence.get(p.id);
      const v: PView = {
        person: p,
        acc,
        seat,
        btn,
        faceBox,
        nameEl,
        subEl,
        body,
        light: lightBySeat.get(seat.id) ?? null,
        x: seat.x,
        y: seat.y,
        facing: seat.facing,
        roomId: null,
        roomSeat: -1,
        walk: null,
        slot: null,
        tier: 'token',
        lastVisible: 0,
        visible: false,
        sx: NaN,
        sy: NaN,
        state: pres?.state ?? 'idle',
        label: pres?.label ?? '',
        badges: pres?.badges ?? [],
        speaking: speaking.has(p.id),
        bodyFacing: null,
      };
      if (prev) {
        prev.slot?.destroy();
        // FLIP: someone whose desk moved glides from the old desk to the new one.
        if (prev.seat && prev.seat.id !== seat.id && !prev.roomId && !reducedMotion()) {
          const path = simplify([{ x: prev.x, y: prev.y }, { x: seat.x, y: seat.y }]);
          v.x = prev.x;
          v.y = prev.y;
          v.walk = { path, len: pathLength(path), start: clock(), dur: 600, to: null };
        }
      }
      views.set(p.id, v);
      setBody(v, v.facing);
      placeBody(v);
      applyPresence(v);
    }
    for (const prev of old.values()) if (!views.has(prev.person.id)) prev.slot?.destroy();
    // Room occupants who no longer exist leave.
    for (const [rid, list] of roomPeople) roomPeople.set(rid, list.filter((id) => views.has(id)));
    for (const [rid, list] of roomPeople) list.forEach((id, i) => placeInRoom(views.get(id)!, rid, i));
    rovingId = rovingId && views.has(rovingId) ? rovingId : views.has(leadId) ? leadId : (views.keys().next().value ?? null);
    updateRoving();
    applyFind();
  };

  const replan = () => {
    plan = planOffice({ people, groups, leadId, rooms });
    groupsMap = groupById();
    buildWorld();
    buildViews();
    buildLabels();
    hud.setMinimap(
      plan.cells.map((c) => ({ rect: { x: c.x, y: Y(c.row === 0 && c.role !== 'pod' ? 0 : c.y), w: c.w, h: (c.row === 0 && c.role !== 'pod' ? c.y + c.h : c.h) * K_Y }, kind: c.role })),
      box,
    );
    measure();
    minZoom = minZoomFor(box, vp);
    fit = fitCamera(box, vp);
  };

  // ── presence ───────────────────────────────────────────────────────────────────────────────────────────────
  const statusText = (v: PView): string => {
    if (v.roomId && mode === 'desks') {
      const r = plan.rooms.find((x) => x.id === v.roomId);
      if (r) return S.inRoom(r.name);
    }
    if (v.speaking) return S.states.speaking;
    if (v.state === 'idle') return v.badges.includes('lamp') ? S.nightShift : '';
    return v.label || S.states[v.state];
  };

  const applyPresence = (v: PView) => {
    const state = v.state;
    v.btn.dataset.state = state;
    if (v.speaking) v.btn.dataset.speaking = '';
    else delete v.btn.dataset.speaking;
    if (v.badges.includes('lamp')) v.btn.dataset.lamp = '';
    else delete v.btn.dataset.lamp;
    v.slot?.setState?.(v.speaking ? 'speaking' : state, v.label);
    const light = v.light;
    if (light) {
      const atDesk = !v.roomId && !v.walk;
      const mon = atDesk && (state === 'working' || state === 'thinking') ? (state === 'working' ? 'on' : 'dim') : '';
      if (mon) light.setAttribute('data-mon', mon);
      else light.removeAttribute('data-mon');
      if (v.badges.includes('lamp')) light.setAttribute('data-lamp', '');
      else light.removeAttribute('data-lamp');
      const halo = atDesk ? (v.speaking ? 'speak' : state === 'raised_hand' || v.badges.includes('hand') ? 'hand' : '') : '';
      if (halo) light.setAttribute('data-halo', halo);
      else light.removeAttribute('data-halo');
    }
    if (v.body) v.body.setAttribute('data-state', v.speaking ? 'speaking' : state);
    const sub = statusText(v);
    // In a room the door plate already says who is there; the status line stays in the accessible name only.
    v.subEl.textContent = v.roomId ? '' : capStatus(sub);
    v.btn.dataset.sub = sub && !v.roomId ? '1' : '';
    v.btn.setAttribute('aria-label', S.seatLabel(v.person.name, v.person.title, groupName(v.person.groupId), sub));
    if (v.person.id === leadId) updateChiefLabel();
  };

  const updateChiefLabel = () => {
    const el = labelsEl.querySelector<HTMLElement>('[data-chief-status]');
    const v = views.get(leadId);
    if (!el || !v) return;
    el.textContent = statusText(v) || S.available;
  };

  const updateRoomLabels = () => {
    for (const r of plan.rooms) {
      const el = labelsEl.querySelector<HTMLElement>(`.hc-o-label--room[data-id="${r.id}"] [data-room-status]`);
      if (!el) continue;
      const list = roomPeople.get(r.id) ?? [];
      const names = list.map((id) => firstName(views.get(id)?.person.name ?? id));
      // Honest (X3): a meeting happens only while the owner is in the room; before that, people are waiting.
      el.textContent = !list.length ? S.free : mode === 'conference' && roomId === r.id ? S.talkingWith(names) : S.waitingIn(names);
    }
  };

  const known = (id: string): PView | null => {
    const v = views.get(id);
    if (!v && !warned.has(id)) {
      warned.add(id);
      console.warn(`[office] unknown person id: ${id}`);
    }
    return v ?? null;
  };

  // ── camera and the frame loop ──────────────────────────────────────────────────────────────────────────────
  let raf = 0;
  let flight: { from: Camera; to: Camera; start: number; dur: number; done?: () => void } | null = null;
  let inertia: { v: Point; start: number; base: Camera; dur: number } | null = null;
  let spring: { from: Camera; to: Camera; start: number } | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let moving = false;
  let lastCamKey = '';
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!destroyed) fn();
    }, ms);
    timers.add(t);
    return t;
  };

  const requestFrame = () => {
    if (raf || destroyed) return;
    const rafFn = win.requestAnimationFrame?.bind(win);
    if (rafFn) raf = rafFn(tick);
    else raf = setTimeout(() => tick(clock()), 16) as unknown as number;
  };
  const cancelFrame = () => {
    if (!raf) return;
    if (win.cancelAnimationFrame) win.cancelAnimationFrame(raf);
    else clearTimeout(raf);
    raf = 0;
  };

  const stopMotion = () => {
    flight = null;
    inertia = null;
    spring = null;
  };

  const tick = (t: number) => {
    raf = 0;
    if (destroyed) return;
    const tt = typeof t === 'number' && t > 0 ? t : clock();
    let active = false;
    if (flight) {
      const k = Math.min(1, (tt - flight.start) / flight.dur);
      cam = flightCamera(flight.from, flight.to, easeInOut(k));
      if (k >= 1) {
        const done = flight.done;
        flight = null;
        done?.();
      } else active = true;
    }
    if (inertia) {
      const el = tt - inertia.start;
      const off = inertiaOffset(inertia.v, Math.min(el, inertia.dur));
      const raw = panBy(inertia.base, off.x, off.y);
      cam = rubberBand(raw, box, vp);
      if (el >= inertia.dur) {
        inertia = null;
        if (outOfBounds(cam, box, vp)) startSpring();
      } else active = true;
    }
    if (spring) {
      const k = Math.min(1, (tt - spring.start) / 280);
      cam = lerpCamera(spring.from, spring.to, easeOut(k));
      if (k >= 1) spring = null;
      else active = true;
    }
    if (stepWalks(tt)) active = true;
    render();
    if (active) requestFrame();
  };

  const startSpring = () => {
    const to = clampCamera(cam, box, vp);
    if (reducedMotion()) {
      cam = to;
      return;
    }
    spring = { from: cam, to, start: clock() };
    requestFrame();
  };

  const flyTo = (to: Camera, done?: () => void, dur = FLIGHT_MS) => {
    stopMotion();
    const target = clampCamera({ ...to, zoom: clampZoom(to.zoom, minZoom) }, box, vp);
    if (reducedMotion() || dur <= 0) {
      cam = target;
      requestFrame();
      done?.();
      return;
    }
    flight = { from: cam, to: target, start: clock(), dur, done };
    requestFrame();
  };

  const worldTransform = () => {
    const tx = (box.x - cam.x) * cam.zoom + vp.w / 2;
    const ty = (box.y - cam.y) * cam.zoom + vp.h / 2;
    world.style.transform = `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${cam.zoom.toFixed(5)})`;
  };

  const narrow = () => vp.w < NARROW_W;
  /** Phones: the Chief's neighbourhood at 2.4 px/u with the north floor line a third of the way down. */
  const phoneCamera = (): Camera => {
    const chief = plan.cells.find((c) => c.role === 'chief');
    const x = chief ? chief.x + chief.w / 2 : box.x + box.w / 2;
    const zoom = clampZoom(ZOOM_PHONE, minZoom);
    return clampCamera({ x, y: (vp.h * (0.5 - PHONE_FLOOR_LINE)) / zoom, zoom }, box, vp);
  };
  /** The opening view: the hero shot on laptops, the Chief's neighbourhood on phones. */
  const openCamera = (): Camera => (narrow() ? phoneCamera() : fit);
  const skyLayout = () => {
    // The sky is framed for the opening view, so the waterline sits in the north glass there.
    sky.layout({ vp, fit: openCamera(), cam, anchorY: Y(0, SKY_ANCHOR_Z), floorY: Y(0), anchorX: box.x + box.w / 2, parallax: !reducedMotion() });
  };

  const personAnchor = (v: PView): Point => {
    const inRoom = !!v.roomId || !!v.walk;
    return { x: v.x, y: Y(v.y, anchorZ(v.facing, inRoom)) };
  };

  const render = () => {
    const key = `${cam.x.toFixed(3)}:${cam.y.toFixed(3)}:${cam.zoom.toFixed(4)}:${vp.w}:${vp.h}`;
    const camMoved = key !== lastCamKey;
    lastCamKey = key;
    if (camMoved) {
      if (!moving) {
        moving = true;
        root.dataset.moving = '';
      }
      worldTransform();
      skyLayout();
      dwell.cameraMoved();
      const nextLod = lodFor(cam.zoom, lod);
      if (nextLod !== lod) setLod(nextLod);
      scheduleSettle();
    }
    const k = settledZoom > 0 ? scaleForZoom(cam.zoom) / Math.max(1, scaleForZoom(settledZoom)) : 1;
    const t = clock();
    const mx = vp.w * 0.25;
    const my = vp.h * 0.25;
    for (const v of views.values()) {
      const a = personAnchor(v);
      const sx = (a.x - cam.x) * cam.zoom + vp.w / 2;
      const sy = (a.y - cam.y) * cam.zoom + vp.h / 2;
      const vis = sx > -mx && sx < vp.w + mx && sy > -my && sy < vp.h + my;
      if (vis) v.lastVisible = t;
      if (vis !== v.visible) {
        v.visible = vis;
        // Someone who walks into view while the camera is still gets their face without waiting for a settle.
        if (vis && !v.slot && !moving && lod > 0) requestFaces();
        // Off-screen seats are parked far away (not hidden), so keyboard focus can still reach them.
        if (!vis) v.btn.style.transform = 'translate3d(-9999px,-9999px,0)';
        else v.sx = NaN;
      }
      if (vis && (sx !== v.sx || sy !== v.sy || camMoved)) {
        v.sx = sx;
        v.sy = sy;
        v.btn.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0) scale(${k.toFixed(4)})`;
      }
    }
    if (camMoved) {
      for (const l of labels) {
        const sx = (l.p.x - cam.x) * cam.zoom + vp.w / 2;
        const sy = (l.p.y - cam.y) * cam.zoom + vp.h / 2;
        l.el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;
      }
      if (cam.zoom > fit.zoom * 1.6 && vp.w >= 1024) {
        const tl = fromScreen({ x: 0, y: 0 }, cam, vp.w, vp.h);
        hud.updateMinimap({ x: tl.x, y: tl.y, w: vp.w / cam.zoom, h: vp.h / cam.zoom });
      } else hud.updateMinimap(null);
    }
    placeBubbles();
  };

  /** The zoom-dependent part of a badge's size, for the live scale between settles. */
  const scaleForZoom = (z: number) => (lod === 0 ? 1 : faceSize(lod, z));

  const scheduleSettle = () => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (!destroyed && !flight && !inertia && !spring && !panState) settle();
      else if (!destroyed) scheduleSettle();
    }, SETTLE_MS);
  };

  const setLod = (next: Lod) => {
    lod = next;
    root.dataset.lod = String(next);
    settledZoom = cam.zoom;
    applySizes();
  };

  const applySizes = () => {
    const fs = faceSize(lod, cam.zoom);
    root.style.setProperty('--fs', `${fs}px`);
    root.style.setProperty('--hit', `${lod === 0 ? Math.max(14, Math.min(40, 12 * cam.zoom)) : Math.max(44, fs)}px`);
    root.style.setProperty('--z', cam.zoom.toFixed(3));
    root.style.setProperty('--pitch', `${Math.round(16 * cam.zoom)}px`);
    const names = cam.zoom >= NAMES_ZOOM && lod > 0 ? (lod === 2 ? (cam.zoom >= 7.4 ? 'full' : 'short') : 'first') : '';
    if (names) root.dataset.names = names;
    else delete root.dataset.names;
  };

  const settle = () => {
    moving = false;
    delete root.dataset.moving;
    settledZoom = cam.zoom;
    applySizes();
    // Badges return to scale 1 at their exact pixel size, so faces redraw sharp.
    for (const v of views.values()) {
      if (!v.visible) continue;
      v.btn.style.transform = `translate3d(${v.sx.toFixed(1)}px,${v.sy.toFixed(1)}px,0)`;
    }
    manageFaces();
    reportViewport();
    saveCamera();
  };

  // ── faces: mounting, LRU release, tiers ────────────────────────────────────────────────────────────────────
  let facesTimer: ReturnType<typeof setTimeout> | null = null;
  let tierTimer: ReturnType<typeof setTimeout> | null = null;
  const mountFace = (v: PView) => {
    if (v.slot) return;
    v.slot = makeFace(doc, options.faceFactory, v.person, v.acc, v.tier);
    v.slot.setState?.(v.speaking ? 'speaking' : v.state, v.label);
    v.faceBox.append(v.slot.el);
    v.btn.dataset.face = '';
    if (v.slot.drawsChrome) v.btn.dataset.hostChrome = '';
    else delete v.btn.dataset.hostChrome;
  };
  const releaseFace = (v: PView) => {
    if (!v.slot) return;
    v.slot.destroy();
    v.slot.el.remove();
    v.slot = null;
    delete v.btn.dataset.face;
    delete v.btn.dataset.hostChrome;
  };
  const manageFaces = () => {
    if (facesTimer) clearTimeout(facesTimer);
    facesTimer = null;
    if (stage.isOpen) {
      for (const v of views.values()) releaseFace(v);
      return;
    }
    if (lod === 0) {
      facesTimer = later(() => {
        if (lod === 0) for (const v of views.values()) releaseFace(v);
      }, RELEASE_L0_MS);
      return;
    }
    const t = clock();
    const cx = vp.w / 2;
    const cy = vp.h / 2;
    const want = [...views.values()].filter((v) => v.visible).sort((a, b) => Math.hypot(a.sx - cx, a.sy - cy) - Math.hypot(b.sx - cx, b.sy - cy));
    const keep = new Set(want.slice(0, MAX_FACES));
    let mounted = [...views.values()].filter((v) => v.slot).length;
    for (const v of keep) {
      if (v.slot) continue;
      if (mounted >= MAX_FACES) {
        // Release the longest-unseen face to make room.
        const victim = [...views.values()].filter((x) => x.slot && !keep.has(x)).sort((a, b) => a.lastVisible - b.lastVisible)[0];
        if (!victim) break;
        releaseFace(victim);
        mounted--;
      }
      mountFace(v);
      mounted++;
    }
    for (const v of views.values()) if (v.slot && !keep.has(v) && t - v.lastVisible > RELEASE_OFFSCREEN_MS) releaseFace(v);
    facesTimer = later(manageFaces, RELEASE_OFFSCREEN_MS + 50);
    scheduleTiers();
  };
  let facesSoon: ReturnType<typeof setTimeout> | null = null;
  const requestFaces = () => {
    if (facesSoon) return;
    facesSoon = later(() => {
      facesSoon = null;
      if (!moving && !stage.isOpen) manageFaces();
    }, 120);
  };
  const scheduleTiers = () => {
    if (tierTimer) clearTimeout(tierTimer);
    tierTimer = later(() => {
      const tiers = allocateTiers(
        [...views.values()].map((v) => ({ id: v.person.id, speaking: v.speaking, dragging: v.person.id === dragId, hovered: v.person.id === hoveredId, focused: v.person.id === focusedId, bubble: bubbles.has(v.person.id) })),
        3,
      );
      for (const v of views.values()) {
        const tier = tiers.get(v.person.id) ?? 'token';
        if (tier !== v.tier) {
          v.tier = tier;
          v.slot?.setTier(tier);
        }
        v.btn.dataset.tier = tier;
      }
    }, 150);
  };

  // ── walks and rooms on the plan ───────────────────────────────────────────────────────────────────────────
  const facingOf = (dx: number, dy: number): Facing => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n');
  const setBody = (v: PView, facing: Facing) => {
    if (!v.body || v.bodyFacing === facing) return;
    v.bodyFacing = facing;
    v.body.innerHTML = bodyGlyph(v.person.id, facing);
  };
  const placeBody = (v: PView) => {
    if (!v.body) return;
    v.body.setAttribute('transform', `translate(${v.x.toFixed(2)} ${Y(v.y).toFixed(2)})`);
  };

  const stepWalks = (t: number): boolean => {
    let any = false;
    for (const v of views.values()) {
      const w = v.walk;
      if (!w) continue;
      const k = Math.min(1, (t - w.start) / w.dur);
      const d = easeInOut(k) * w.len;
      const p = pointAt(w.path, d);
      const ahead = pointAt(w.path, Math.min(w.len, d + 2));
      if (Math.hypot(ahead.x - p.x, ahead.y - p.y) > 0.05) setBody(v, facingOf(ahead.x - p.x, ahead.y - p.y));
      v.x = p.x;
      v.y = p.y;
      placeBody(v);
      if (k >= 1) {
        v.walk = null;
        finishWalk(v, w);
      } else any = true;
    }
    return any;
  };

  const finishWalk = (v: PView, w: Walk) => {
    if (w.to) placeInRoom(v, w.to.roomId, w.to.seatIndex);
    else placeAtDesk(v);
    w.done?.();
  };

  const placeAtDesk = (v: PView) => {
    v.roomId = null;
    v.roomSeat = -1;
    if (v.seat) {
      v.x = v.seat.x;
      v.y = v.seat.y;
      v.facing = v.seat.facing;
    }
    delete v.btn.dataset.room;
    setBody(v, v.facing);
    placeBody(v);
    applyPresence(v);
  };

  const placeInRoom = (v: PView, rid: string, i: number) => {
    const room = plan.rooms.find((r) => r.id === rid);
    const rs = room?.seats[i];
    if (!room || !rs) return;
    v.roomId = rid;
    v.roomSeat = i;
    v.x = rs.x;
    v.y = rs.y;
    v.facing = rs.facing;
    v.btn.dataset.room = rid;
    setBody(v, rs.facing);
    placeBody(v);
    applyPresence(v);
  };

  /** Room seat order for the plan: the far (north) side first, then the south side, then the ends. */
  const freeRoomSeat = (room: PlanRoom, taken: readonly string[]): number => {
    const used = new Set(taken.map((id) => views.get(id)?.roomSeat ?? -1));
    for (let i = 0; i < room.seats.length; i++) if (!used.has(i)) return i;
    return -1;
  };

  const walkInto = (v: PView, room: PlanRoom, seatIndex: number, delay: number, animate: boolean): number => {
    const rs = room.seats[seatIndex]!;
    if (!animate || !v.seat) {
      placeInRoom(v, room.id, seatIndex);
      return 0;
    }
    const from = v.roomId ? { ...v.seat, x: v.x, y: v.y } : v.seat;
    const path = v.roomId === room.id ? simplify([{ x: v.x, y: v.y }, rs]) : walkPath(plan.walk, plan, from, room, rs);
    const len = pathLength(path);
    const dur = Math.min(1600, Math.max(600, (len / WALK_SPEED) * 1000));
    v.roomId = room.id;
    v.roomSeat = seatIndex;
    v.btn.dataset.room = room.id;
    v.walk = { path, len, start: clock() + delay, dur, to: { roomId: room.id, seatIndex } };
    applyPresence(v);
    requestFrame();
    return dur + delay;
  };

  const walkBack = (v: PView, delay: number, animate: boolean): number => {
    const rid = v.roomId;
    const room = plan.rooms.find((r) => r.id === rid);
    if (!room || !v.seat || !animate) {
      placeAtDesk(v);
      return 0;
    }
    const rs = { x: v.x, y: v.y };
    const path = walkPath(plan.walk, plan, v.seat, room, rs).slice().reverse();
    const len = pathLength(path);
    const dur = Math.min(1600, Math.max(600, (len / WALK_SPEED) * 1000));
    v.walk = { path, len, start: clock() + delay, dur, to: null };
    requestFrame();
    return dur + delay;
  };

  // ── bubbles and anchors ────────────────────────────────────────────────────────────────────────────────────
  const bubbles = new Map<string, Bubble>();
  const anchors = new Set<AnchorRec>();
  const bubbleTtl = (text: string, ttl?: number) => ttl ?? Math.min(9000, 4000 + 60 * text.length);
  const armBubble = (b: Bubble, ms: number) => {
    if (b.timer) clearTimeout(b.timer);
    b.expires = clock() + ms;
    b.timer = setTimeout(() => {
      b.timer = null;
      if (hoveredId === b.id) armBubble(b, 3000);
      else removeBubble(b.id);
    }, ms);
  };
  const removeBubble = (id: string) => {
    const b = bubbles.get(id);
    if (!b) return;
    if (b.timer) clearTimeout(b.timer);
    bubbles.delete(id);
    b.arc?.remove();
    if (reducedMotion()) b.el.remove();
    else {
      b.el.classList.add('is-leaving');
      later(() => b.el.remove(), 200);
    }
    scheduleTiers();
  };
  const faceTop = (v: PView): Point => {
    const fs = lod === 0 ? 10 : faceSize(lod, cam.zoom, v.person.id === leadId);
    return { x: v.sx, y: v.sy - fs / 2 - (lod === 0 ? 4 : 6) };
  };
  const placeBubbles = () => {
    for (const b of bubbles.values()) {
      const v = views.get(b.id);
      if (!v) continue;
      const p = faceTop(v);
      b.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
      b.el.style.visibility = v.visible && mode === 'desks' ? '' : 'hidden';
    }
    for (const a of anchors) {
      const v = views.get(a.id);
      if (!v) continue;
      const p = faceTop(v);
      a.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
      a.el.style.visibility = v.visible ? '' : 'hidden';
    }
  };
  const handoffArc = (from: PView, to: PView): SVGSVGElement | undefined => {
    if (reducedMotion() || !from.visible || !to.visible) return undefined;
    const a = faceTop(from);
    const b = faceTop(to);
    const s = doc.createElementNS(svgNS, 'svg') as SVGSVGElement;
    s.setAttribute('class', 'hc-o-arc');
    s.setAttribute('width', String(vp.w));
    s.setAttribute('height', String(vp.h));
    const mx = (a.x + b.x) / 2;
    const my = Math.min(a.y, b.y) - Math.max(24, Math.abs(a.x - b.x) * 0.25);
    s.innerHTML = `<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}" pathLength="1"/>`;
    bubblesEl.append(s);
    later(() => s.remove(), 1300);
    return s;
  };

  // ── LOD-independent helpers ───────────────────────────────────────────────────────────────────────────────
  const measure = () => {
    const w = root.clientWidth || host.clientWidth;
    const h = root.clientHeight || host.clientHeight;
    vp = { w: w > 0 ? w : 1280, h: h > 0 ? h : 800 };
    minZoom = minZoomFor(box, vp);
    fit = fitCamera(box, vp);
  };

  const updateRoving = () => {
    for (const v of views.values()) v.btn.tabIndex = v.person.id === rovingId ? 0 : -1;
  };

  const applyFind = () => {
    if (findIds) root.dataset.finding = '';
    else delete root.dataset.finding;
    for (const v of views.values()) {
      if (findIds?.has(v.person.id)) v.btn.dataset.match = '';
      else delete v.btn.dataset.match;
    }
  };

  const findPeople = (q: string) => {
    const n = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const qq = n(q);
    const out: { id: string; name: string; sub: string; rank: number }[] = [];
    for (const v of views.values()) {
      const p = v.person;
      const g = groupName(p.groupId);
      const name = n(p.name);
      const rank = name.startsWith(qq) ? 0 : name.includes(` ${qq}`) ? 1 : name.includes(qq) ? 2 : n(p.title).includes(qq) ? 3 : n(g).includes(qq) ? 4 : -1;
      if (rank >= 0) out.push({ id: p.id, name: p.name, sub: `${p.title} · ${g}`, rank });
    }
    return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  };

  const zoneRect = (z: PlanZone): Rect => ({ x: z.rect.x, y: Y(z.rect.y), w: z.rect.w, h: z.rect.h * K_Y });

  const zoomStep = (dir: 1 | -1, at?: Point) => {
    const target = clampZoom(cam.zoom * (dir > 0 ? 1.6 : 1 / 1.6), minZoom);
    const pt = at ?? { x: vp.w / 2, y: vp.h / 2 };
    flyTo(zoomAround(cam, target, pt, vp), undefined, 250);
  };

  // ── viewport report and session camera ─────────────────────────────────────────────────────────────────────
  let lastReport = 0;
  let reportTimer: ReturnType<typeof setTimeout> | null = null;
  const reportViewport = () => {
    if (!options.onViewportChange) return;
    const since = clock() - lastReport;
    if (since < 500) {
      if (!reportTimer) reportTimer = later(() => {
        reportTimer = null;
        reportViewport();
      }, 500 - since);
      return;
    }
    lastReport = clock();
    const personIds = [...views.values()].filter((v) => v.visible && v.sx >= 0 && v.sx <= vp.w && v.sy >= 0 && v.sy <= vp.h).map((v) => v.person.id);
    const tl = fromScreen({ x: 0, y: 0 }, cam, vp.w, vp.h);
    const br = fromScreen({ x: vp.w, y: vp.h }, cam, vp.w, vp.h);
    const roomIds = plan.rooms.filter((r) => r.rect.x < br.x && r.rect.x + r.rect.w > tl.x && Y(r.rect.y) < br.y && Y(r.rect.y + r.rect.h) > tl.y).map((r) => r.id);
    options.onViewportChange({ personIds: stage.isOpen && roomId ? (roomPeople.get(roomId) ?? []).slice() : personIds, roomIds: stage.isOpen && roomId ? [roomId] : roomIds, zoom: cam.zoom, lod });
  };
  const saveCamera = () => {
    if (!cameraKey) return;
    try {
      win.sessionStorage?.setItem(cameraKey, JSON.stringify({ x: cam.x, y: cam.y, zoom: cam.zoom, w: vp.w, h: vp.h }));
    } catch {
      /* storage unavailable */
    }
  };
  const restoreCamera = (): Camera | null => {
    if (!cameraKey) return null;
    try {
      const raw = win.sessionStorage?.getItem(cameraKey);
      if (!raw) return null;
      const c = JSON.parse(raw) as { x: number; y: number; zoom: number };
      if (![c.x, c.y, c.zoom].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
      return { x: c.x, y: c.y, zoom: c.zoom };
    } catch {
      return null;
    }
  };

  // ── wall art and the clock ─────────────────────────────────────────────────────────────────────────────────
  const applyWallArt = () => {
    const art = manifest?.art;
    if (!plateSvg || !art?.length || !assetsBase) return;
    plateSvg.querySelectorAll<SVGGElement>('g.hc-o-art').forEach((g) => {
      const i = Number(g.getAttribute('data-art') ?? 0);
      const e = art[i % art.length]!;
      const r = g.querySelector('rect');
      if (!r) return;
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((a) => r.getAttribute(a) ?? '0');
      const file = e.srcset?.[0]?.file ?? e.file;
      g.innerHTML = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#1b1a19"/><image href="${assetsBase}${file}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;
    });
  };
  let clockTimer: ReturnType<typeof setTimeout> | null = null;
  const updateClock = () => {
    if (!plateSvg) return;
    const d = new Date(now());
    const m = d.getMinutes();
    const h = (d.getHours() % 12) + m / 60;
    plateSvg.querySelectorAll('.hc-o-clock-h').forEach((e) => e.setAttribute('transform', `rotate(${(h * 30).toFixed(1)})`));
    plateSvg.querySelectorAll('.hc-o-clock-m').forEach((e) => e.setAttribute('transform', `rotate(${m * 6})`));
  };
  const scheduleClock = () => {
    if (clockTimer) clearTimeout(clockTimer);
    const d = new Date(now());
    const ms = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds());
    clockTimer = setTimeout(() => {
      if (destroyed) return;
      updateClock();
      applyTimeOfDay(false);
      scheduleClock();
    }, Math.max(1000, ms));
  };

  const applyTimeOfDay = (animate: boolean) => {
    const next = todSetting === 'auto' ? timeOfDayAt(new Date(now())) : todSetting;
    const changed = next !== tod;
    tod = next;
    root.dataset.tod = tod;
    sky.setVariant(tod, animate && changed && !reducedMotion());
    if (changed && stage.isOpen) stage.layout();
  };

  // ── modes: rooms and the stage ─────────────────────────────────────────────────────────────────────────────
  const roomById = (id: string) => plan.rooms.find((r) => r.id === id) ?? null;
  const roomRectProjected = (r: PlanRoom): Rect => ({ x: r.rect.x, y: Y(r.rect.y) - 14, w: r.rect.w, h: r.rect.h * K_Y + 14 });

  const setModeState = (m: OfficeMode, rid: string | null) => {
    const changed = m !== mode || rid !== roomId;
    mode = m;
    roomId = rid;
    root.dataset.mode = m;
    hud.setMode(m);
    updateRoomLabels();
    if (changed) options.onModeChange?.(m, rid);
  };

  const openStage = (room: PlanRoom, animate: boolean) => {
    if (!roomId || roomId !== room.id || mode !== 'conference') return;
    const cap = room.capacity;
    stage.open({ id: room.id, name: room.name, view: room.view, capacity: cap + 1 }, roomPeople.get(room.id) ?? [], animate);
    for (const id of roomPeople.get(room.id) ?? []) {
      const v = views.get(id);
      if (v) stage.setPresence(id, v.speaking ? 'speaking' : v.state, v.label);
    }
    for (const id of speaking) if ((roomPeople.get(room.id) ?? []).includes(id)) stage.setSpeaking(id, true);
    manageFaces();
    reportViewport();
    // Keyboard users land on the first participant; otherwise the stage itself takes focus (no ring), so Esc, I and
    // C work at once.
    later(() => {
      if (lastKeyboard) stage.focusFirst();
      else if (root.contains(doc.activeElement) || doc.activeElement === doc.body || !doc.activeElement) stage.el.focus({ preventScroll: true });
    }, animate ? 260 : 0);
  };

  /** Seat people in a room (plan walks + stage arrivals); returns the ids actually seated. */
  const seatInRoom = (room: PlanRoom, ids: readonly string[], animate: boolean): string[] => {
    const list = roomPeople.get(room.id) ?? [];
    roomPeople.set(room.id, list);
    const added: string[] = [];
    let delay = 0;
    for (const id of ids) {
      const v = views.get(id);
      if (!v || list.includes(id) || list.length >= room.capacity) continue;
      // Someone in the other room leaves it first.
      for (const [rid, other] of roomPeople) if (rid !== room.id && other.includes(id)) roomPeople.set(rid, other.filter((x) => x !== id));
      const i = freeRoomSeat(room, list);
      if (i < 0) continue;
      list.push(id);
      added.push(id);
      walkInto(v, room, i, delay, animate);
      delay += 120;
    }
    updateRoomLabels();
    return added;
  };

  const invite = (rid: string, ids: readonly string[], via: 'picker' | 'drag' | 'keyboard'): boolean => {
    const room = roomById(rid);
    if (!room) return false;
    const list = roomPeople.get(rid) ?? [];
    const fresh = ids.filter((id) => views.has(id) && !list.includes(id)).slice(0, Math.max(0, room.capacity - list.length));
    if (!fresh.length) return false;
    const ok = options.onInvite?.(rid, fresh, { via });
    if (ok === false) return false;
    const animate = !reducedMotion();
    const added = seatInRoom(room, fresh, animate && !(stage.isOpen && roomId === rid));
    if (stage.isOpen && roomId === rid) {
      stage.setParticipants(roomPeople.get(rid) ?? [], added);
      for (const id of added) {
        const v = views.get(id)!;
        stage.setPresence(id, v.state, v.label);
      }
    }
    return added.length > 0;
  };

  const openInvitePicker = () => {
    const rid = roomId ?? lastRoom ?? plan.rooms[0]?.id;
    const room = rid ? roomById(rid) : null;
    if (!room || picker) return;
    const current = roomPeople.get(room.id) ?? [];
    picker = openPicker(root, {
      doc,
      strings: S,
      roomName: room.name,
      capacity: room.capacity,
      current,
      people: [...views.values()].map((v) => v.person),
      groupName,
      groupOrder: (g) => (g === 'chief' || views.get(leadId)?.person.groupId === g ? -1 : groupOrder(g)),
      face: (id) => makeFace(doc, options.faceFactory, views.get(id)!.person, views.get(id)!.acc, 'token'),
      onInvite: (ids) => invite(room.id, ids, 'picker'),
      onClose: () => {
        picker = null;
        if (stage.isOpen) stage.focusFirst();
      },
    });
  };

  // ── input: pointer, wheel, keyboard ────────────────────────────────────────────────────────────────────────
  const dwell = createDwell({
    now: clock,
    onEnter: (id, via) => {
      hoveredId = id;
      views.get(id)?.btn.setAttribute('data-hover', '');
      scheduleTiers();
      options.onHover?.(id, { phase: 'enter', via });
      options.onFocusChange?.(id);
    },
    onDwell: (id, via) => options.onHover?.(id, { phase: 'dwell', via }),
    onLeave: (id, via) => {
      if (hoveredId === id) hoveredId = null;
      views.get(id)?.btn.removeAttribute('data-hover');
      scheduleTiers();
      options.onHoverEnd?.(id, { via });
      if (!focusedId) options.onFocusChange?.(null);
      const b = bubbles.get(id);
      if (b && b.expires - clock() < 3000) armBubble(b, 3000);
    },
  });

  interface PanState {
    id: number;
    x0: number;
    y0: number;
    t0: number;
    cam0: Camera;
    samples: { x: number; y: number; t: number }[];
    seatId: string | null;
    moved: boolean;
    dragging: boolean;
    touch: boolean;
    longPress: ReturnType<typeof setTimeout> | null;
  }
  let panState: PanState | null = null;
  const pointers = new Map<number, Point>();
  let pinch: { d0: number; z0: number; cam0: Camera; mid0: Point } | null = null;

  const localPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const seatUnder = (e: Event): string | null => {
    const t = e.target as HTMLElement | null;
    const btn = t?.closest?.('.hc-o-seat') as HTMLElement | null;
    return btn && peopleEl.contains(btn) ? (btn.dataset.pid ?? null) : null;
  };
  const inChrome = (e: Event) => {
    const t = e.target as HTMLElement | null;
    return !!t?.closest?.('.hc-o-hud,.hc-o-stage,.hc-o-picker,.hc-o-bubble,.hc-o-skip,.hc-o-anchor');
  };

  const roomAt = (p: Point): string | null => {
    const proj = fromScreen(p, cam, vp.w, vp.h);
    const floor = { x: proj.x, y: proj.y / K_Y };
    for (const r of plan.rooms) if (floor.x >= r.rect.x && floor.x <= r.rect.x + r.rect.w && floor.y >= r.rect.y - 4 && floor.y <= r.rect.y + r.rect.h) return r.id;
    return null;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (inChrome(e) || mode !== 'desks' || picker) return;
    if (e.button !== undefined && e.button > 0) return;
    const p = localPoint(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [Point, Point];
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: cam.zoom, cam0: cam, mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      if (panState?.longPress) clearTimeout(panState.longPress);
      panState = null;
      return;
    }
    stopMotion();
    const seatId = seatUnder(e);
    // A click on the floor (not a seat, which takes focus itself) gives the scene focus, so G, /, [ ], + − 0 work.
    if (!seatId && doc.activeElement !== root) root.focus({ preventScroll: true });
    const touch = e.pointerType === 'touch';
    panState = { id: e.pointerId, x0: p.x, y0: p.y, t0: clock(), cam0: cam, samples: [{ ...p, t: clock() }], seatId, moved: false, dragging: false, touch, longPress: null };
    if (seatId && touch) {
      const st = panState;
      st.longPress = setTimeout(() => {
        if (panState === st && !st.moved) startDrag(st, p);
      }, 400);
    }
    try {
      root.setPointerCapture?.(e.pointerId);
    } catch {
      /* not capturable */
    }
  };

  const startDrag = (st: PanState, p: Point) => {
    if (!st.seatId) return;
    st.dragging = true;
    dragId = st.seatId;
    const v = views.get(st.seatId)!;
    v.btn.dataset.dragging = '';
    ghost.hidden = false;
    ghost.style.setProperty('--acc', v.acc);
    ghost.replaceChildren();
    const g = makeFace(doc, options.faceFactory, v.person, v.acc, 'token');
    ghost.append(g.el);
    ghost.dataset.slot = '';
    (ghost as HTMLElement & { _slot?: FaceSlot })._slot = g;
    moveGhost(p);
    scheduleTiers();
  };
  const moveGhost = (p: Point) => {
    ghost.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
    const rid = roomAt(p);
    if (rid) root.dataset.drop = rid;
    else delete root.dataset.drop;
    lightSvg?.querySelectorAll('.hc-o-droplight').forEach((r) => r.toggleAttribute('data-on', r.getAttribute('data-room') === rid));
  };
  const endDrag = (st: PanState, p: Point) => {
    const id = st.seatId!;
    const v = views.get(id);
    const rid = roomAt(p);
    const slot = (ghost as HTMLElement & { _slot?: FaceSlot })._slot;
    const cleanup = () => {
      ghost.hidden = true;
      ghost.classList.remove('is-returning');
      slot?.destroy();
      ghost.replaceChildren();
      delete root.dataset.drop;
      lightSvg?.querySelectorAll('.hc-o-droplight').forEach((r) => r.removeAttribute('data-on'));
      if (v) delete v.btn.dataset.dragging;
      dragId = null;
      scheduleTiers();
    };
    const ok = rid ? invite(rid, [id], 'drag') : false;
    if (ok || !v || reducedMotion()) {
      cleanup();
      return;
    }
    // Spring back to the seat.
    ghost.classList.add('is-returning');
    ghost.style.transform = `translate3d(${v.sx.toFixed(1)}px,${v.sy.toFixed(1)}px,0)`;
    later(cleanup, 260);
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = localPoint(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [Point, Point];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = clampZoom(pinch.z0 * (d / Math.max(1, pinch.d0)), minZoom);
      const c = zoomAround(pinch.cam0, z, pinch.mid0, vp);
      cam = rubberBand(panBy(c, mid.x - pinch.mid0.x, mid.y - pinch.mid0.y), box, vp);
      requestFrame();
      return;
    }
    const st = panState;
    if (st && st.id === e.pointerId) {
      const dx = p.x - st.x0;
      const dy = p.y - st.y0;
      if (!st.moved && Math.hypot(dx, dy) >= (st.seatId && !st.touch ? 6 : 5)) {
        st.moved = true;
        if (st.longPress) clearTimeout(st.longPress);
        if (st.seatId && !st.touch) startDrag(st, p);
        else root.dataset.panning = '';
        dwell.clear();
      }
      if (st.dragging) {
        moveGhost(p);
        return;
      }
      if (st.moved) {
        st.samples.push({ ...p, t: clock() });
        if (st.samples.length > 12) st.samples.shift();
        cam = rubberBand(panBy(st.cam0, dx, dy), box, vp);
        requestFrame();
      }
      return;
    }
    if (mode === 'desks' && e.pointerType !== 'touch' && !inChrome(e)) dwell.pointer(seatUnder(e), p.x, p.y, 'pointer');
    else if (inChrome(e) && dwell.current && !(e.target as HTMLElement).closest?.('.hc-o-bubble')) dwell.pointer(null, p.x, p.y);
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        if (outOfBounds(cam, box, vp)) startSpring();
        else scheduleSettle();
      }
      return;
    }
    const st = panState;
    if (!st || st.id !== e.pointerId) return;
    panState = null;
    if (st.longPress) clearTimeout(st.longPress);
    delete root.dataset.panning;
    const p = localPoint(e);
    if (st.dragging) {
      endDrag(st, p);
      return;
    }
    const dt = clock() - st.t0;
    if (!st.moved && dt < 350) {
      if (st.seatId) {
        if (st.touch) {
          if (dwell.current === st.seatId) options.onOpen?.(st.seatId, { via: 'click', mode, roomId });
          else dwell.tap(st.seatId);
        } else options.onOpen?.(st.seatId, { via: 'click', mode, roomId });
        rovingId = st.seatId;
        updateRoving();
        return;
      }
      const hit = hitTest(plan, fromScreen(p, cam, vp.w, vp.h));
      if (hit?.kind === 'room') api.enterRoom(hit.roomId);
      else if (hit?.kind === 'amenity') api.walkTo(hit.id);
      return;
    }
    if (!st.moved) return;
    const v = velocityOf(st.samples, clock());
    if (!reducedMotion() && Math.hypot(v.x, v.y) > 0.05) {
      inertia = { v, start: clock(), base: cam, dur: inertiaDuration(v) };
      requestFrame();
    } else if (outOfBounds(cam, box, vp)) startSpring();
    else scheduleSettle();
  };

  const onPointerCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = null;
    const st = panState;
    if (st?.longPress) clearTimeout(st.longPress);
    if (st?.dragging) endDrag(st, { x: -1e4, y: -1e4 });
    panState = null;
    delete root.dataset.panning;
    if (outOfBounds(cam, box, vp)) startSpring();
  };

  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' && dwell.current && !panState) dwell.pointer(null, 0, 0);
  };

  let wheelNotch = { t: 0, n: 0 };
  const onWheel = (e: WheelEvent) => {
    if (mode !== 'desks' || picker) return;
    if ((e.target as HTMLElement)?.closest?.('.hc-o-menu,.hc-o-picker,.hc-o-stage')) return;
    e.preventDefault();
    stopMotion();
    const p = localPoint(e);
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vp.h : 1;
    const dx = e.deltaX * scale;
    const dy = e.deltaY * scale;
    const t = clock();
    // A notched mouse wheel: line mode, or repeated large vertical steps with no horizontal part.
    const notched = e.deltaMode === 1 || (Math.abs(dy) >= 40 && dx === 0 && Number.isInteger(e.deltaY) && (t - wheelNotch.t < 400 ? ++wheelNotch.n >= 1 : ((wheelNotch.n = 0), true)));
    wheelNotch.t = t;
    if (e.ctrlKey || e.metaKey) {
      const z = clampZoom(cam.zoom * Math.exp(-dy * 0.01), minZoom);
      cam = clampCamera(zoomAround(cam, z, p, vp), box, vp);
    } else if (notched) {
      const z = clampZoom(cam.zoom * Math.exp(-Math.sign(dy) * Math.min(Math.abs(dy), 120) * 0.0035), minZoom);
      cam = clampCamera(zoomAround(cam, z, p, vp), box, vp);
    } else {
      cam = clampCamera(panBy(cam, -dx, -dy), box, vp);
    }
    requestFrame();
  };

  // Safari trackpad pinch.
  let gesture0: { z: number; cam: Camera; p: Point } | null = null;
  const onGestureStart = (e: Event) => {
    if (mode !== 'desks') return;
    e.preventDefault();
    const ge = e as unknown as { clientX: number; clientY: number };
    gesture0 = { z: cam.zoom, cam, p: localPoint(ge) };
  };
  const onGestureChange = (e: Event) => {
    if (!gesture0) return;
    e.preventDefault();
    const scale = (e as unknown as { scale: number }).scale ?? 1;
    cam = clampCamera(zoomAround(gesture0.cam, clampZoom(gesture0.z * scale, minZoom), gesture0.p, vp), box, vp);
    requestFrame();
  };
  const onGestureEnd = () => {
    gesture0 = null;
  };

  const onDblClick = (e: MouseEvent) => {
    if (mode !== 'desks' || inChrome(e) || seatUnder(e)) return;
    const p = localPoint(e);
    const z = clampZoom(cam.zoom * 2, minZoom);
    flyTo(zoomAround(cam, z, p, vp), undefined, 250);
  };

  const focusSeat = (id: string, opts: { animate?: boolean; zoom?: 'keep' | 'desk' } = {}) => {
    const v = views.get(id);
    if (!v) return;
    rovingId = id;
    updateRoving();
    const a = personAnchor(v);
    let target: Camera;
    if (opts.zoom === 'desk') target = { x: a.x, y: a.y, zoom: Math.max(cam.zoom, ZOOM_DESK) };
    else target = followPoint(cam, a, vp);
    const animate = opts.animate !== false;
    flyTo(target, undefined, animate ? (opts.zoom === 'desk' ? FLIGHT_MS : 250) : 0);
    v.btn.focus({ preventScroll: true });
  };

  const onFocusIn = (e: FocusEvent) => {
    const id = seatUnder(e);
    if (!id) return;
    focusedId = id;
    rovingId = id;
    updateRoving();
    const v = views.get(id)!;
    if (!v.visible || v.sx < vp.w * 0.15 || v.sx > vp.w * 0.85 || v.sy < vp.h * 0.15 || v.sy > vp.h * 0.85) {
      flyTo(followPoint(cam, personAnchor(v), vp), undefined, 250);
    }
    let kbd = false;
    try {
      kbd = !!(e.target as HTMLElement).matches?.(':focus-visible');
    } catch {
      kbd = true;
    }
    if (kbd || !hoveredId) dwell.keyboard(id);
    scheduleTiers();
    options.onFocusChange?.(id);
  };
  const onFocusOut = (e: FocusEvent) => {
    const id = seatUnder(e);
    if (!id) return;
    const next = e.relatedTarget as HTMLElement | null;
    if (next && peopleEl.contains(next)) return;
    focusedId = null;
    dwell.keyboard(null);
    scheduleTiers();
    if (!hoveredId) options.onFocusChange?.(null);
  };

  const navMove = (dir: 'left' | 'right' | 'up' | 'down' | 'prevZone' | 'nextZone') => {
    const cur = views.get(focusedId ?? rovingId ?? leadId);
    if (!cur?.seat) return;
    const nextSeat = plan.nav[cur.seat.id]?.[dir];
    const s = nextSeat ? plan.seats.find((x) => x.id === nextSeat) : null;
    if (s?.personId) focusSeat(s.personId, { animate: true, zoom: 'keep' });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (destroyed || !root.isConnected) return;
    // Document-level routing (keyTarget 'document') leaves keys aimed at other widgets on the page alone.
    if (keyTarget === 'document' && e.target instanceof Node && !root.contains(e.target) && e.target !== doc.body && e.target !== doc.documentElement) {
      const t = e.target as HTMLElement;
      if (t.closest?.('button,a,[role=button],[role=menu],[role=dialog],[role=listbox],[contenteditable]')) return;
    }
    // Esc in the stage's own (empty) message field leaves the room; with text in it, Esc clears the text first.
    if (e.key === 'Escape' && mode === 'conference' && !picker && (e.target as HTMLElement)?.closest?.('.hc-o-compose')) {
      const input = e.target as HTMLInputElement;
      e.preventDefault();
      if (input.value) input.value = '';
      else api.leaveRoom();
      return;
    }
    if (e.defaultPrevented || isTyping(e.target) || e.altKey || e.metaKey || e.ctrlKey) return;
    const k = e.key;
    if (k === 'r' || k === 'R' || k === ' ' || k === 'l' || k === 'L') return; // the host's keys
    if (picker) return;
    if (mode === 'conference' && stage.isOpen) {
      if (k === 'ArrowLeft' || k === 'ArrowUp') stage.moveFocus(-1);
      else if (k === 'ArrowRight' || k === 'ArrowDown') stage.moveFocus(1);
      else if (k === 'Enter') {
        const id = stage.focusedId();
        if (!id) return;
        options.onOpen?.(id, { via: 'keyboard', mode, roomId });
      } else if (k === 'i' || k === 'I') openInvitePicker();
      else if (k === 'c' || k === 'C') stage.toggleCaptions();
      else if (k === 'Escape') api.leaveRoom();
      else return;
      e.preventDefault();
      return;
    }
    const map: Record<string, () => void> = {
      ArrowLeft: () => navMove('left'),
      ArrowRight: () => navMove('right'),
      ArrowUp: () => navMove('up'),
      ArrowDown: () => navMove('down'),
      '[': () => navMove('prevZone'),
      ']': () => navMove('nextZone'),
      PageUp: () => navMove('prevZone'),
      PageDown: () => navMove('nextZone'),
      Home: () => views.has(leadId) && focusSeat(leadId, { animate: true, zoom: 'keep' }),
      Enter: () => {
        const id = focusedId;
        if (id) options.onOpen?.(id, { via: 'keyboard', mode, roomId });
      },
      i: () => {
        const id = focusedId;
        const rid = lastRoom ?? plan.rooms[0]?.id;
        if (id && rid) invite(rid, [id], 'keyboard');
      },
      g: () => hud.openWalk(),
      '/': () => hud.openFind(),
      '+': () => zoomStep(1),
      '=': () => zoomStep(1),
      '-': () => zoomStep(-1),
      _: () => zoomStep(-1),
      '0': () => api.zoomTo('fit'),
      f: () => focusedId && api.focus(focusedId, { animate: true, zoom: 'desk' }),
      Escape: () => {
        if (hud.closeMenus()) return;
        if (focusedId && bubbles.has(focusedId)) api.hideBubble(focusedId);
        else if (findIds) {
          findIds = null;
          applyFind();
        } else if (focusedId) (doc.activeElement as HTMLElement | null)?.blur();
      },
    };
    const fn = map[k.length === 1 ? k.toLowerCase() : k] ?? map[k];
    if (!fn) return;
    // Arrows and Enter act on the focused seat; [ ], PageUp/PageDown and Home also work from the floor.
    if ((k.startsWith('Arrow') || k === 'Enter') && !peopleEl.contains(doc.activeElement)) return;
    e.preventDefault();
    fn();
  };

  let lastKeyboard = false;
  const keyTarget = options.keyTarget ?? 'scene';
  const keyEl: HTMLElement | Document = keyTarget === 'document' ? doc : root;
  root.addEventListener('keydown', () => (lastKeyboard = true), true);
  root.addEventListener('pointerdown', () => (lastKeyboard = false), true);

  // Calm: after 30 s without input the sky's twinkle and beacons pause; any pointer or key brings them back.
  let lastInput = clock();
  let calmTimer: ReturnType<typeof setTimeout> | null = null;
  const checkCalm = () => {
    calmTimer = null;
    const idle = clock() - lastInput;
    if (idle >= CALM_MS - 20) root.dataset.calm = '';
    else calmTimer = later(checkCalm, CALM_MS - idle);
  };
  const wake = () => {
    lastInput = clock();
    if (root.dataset.calm !== undefined) delete root.dataset.calm;
    if (!calmTimer) calmTimer = later(checkCalm, CALM_MS);
  };
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const) root.addEventListener(type, wake, { capture: true, passive: true });
  if (keyEl !== root) keyEl.addEventListener('keydown', wake, { capture: true, passive: true });
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('pointerleave', onPointerLeave);
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('dblclick', onDblClick);
  keyEl.addEventListener('keydown', onKeyDown as EventListener);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('gesturestart', onGestureStart as EventListener);
  root.addEventListener('gesturechange', onGestureChange as EventListener);
  root.addEventListener('gestureend', onGestureEnd as EventListener);
  // Clicks on seat buttons come from pointerup; a keyboard "click" (Enter/Space on a button) is handled in keydown.
  // Assistive-technology activation (a click with no pointer) opens the desk; Space stays the host's push-to-talk.
  let spaceAt = 0;
  root.addEventListener('keyup', (e) => {
    if (e.key === ' ') spaceAt = clock();
  });
  peopleEl.addEventListener('click', (e) => {
    e.preventDefault();
    const id = seatUnder(e);
    if (id && e.detail === 0 && clock() - spaceAt > 300) options.onOpen?.(id, { via: 'keyboard', mode, roomId });
  });

  let ro: ResizeObserver | null = null;
  const onResize = () => {
    const before = vp;
    measure();
    if (before.w === vp.w && before.h === vp.h) return;
    // Keep the same framing relative to fit.
    if (Math.abs(cam.zoom - fit.zoom) < 1e-6 || cam.zoom < minZoom) cam = fit;
    cam = clampCamera({ ...cam, zoom: clampZoom(cam.zoom, minZoom) }, box, vp);
    if (stage.isOpen) stage.layout();
    requestFrame();
  };
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(onResize);
    ro.observe(root);
  } else win.addEventListener?.('resize', onResize);

  let mql: MediaQueryList | null = null;
  const onMotionPref = () => {
    if (rmSetting === null) applyMotion();
  };
  const applyMotion = () => {
    if (reducedMotion()) root.dataset.rm = '';
    else delete root.dataset.rm;
    skyLayout();
  };
  try {
    mql = win.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    mql?.addEventListener?.('change', onMotionPref);
  } catch {
    mql = null;
  }

  // ── public API ─────────────────────────────────────────────────────────────────────────────────────────────
  const api: OfficeScene = {
    el: root,
    setPeople(next, nextGroups, nextLead) {
      if (destroyed) return;
      people = next.slice();
      if (nextGroups) groups = nextGroups.slice();
      if (nextLead) leadId = nextLead;
      replan();
      render();
      scheduleSettle();
      requestFrame();
    },
    setPresence(id, state, opts = {}) {
      if (destroyed) return;
      presence.set(id, { state, label: opts.label ?? '', badges: opts.badges ?? [] });
      const v = known(id);
      if (!v) return;
      v.state = state;
      v.label = opts.label ?? '';
      v.badges = opts.badges ?? [];
      applyPresence(v);
      if (stage.isOpen && v.roomId === roomId) stage.setPresence(id, v.speaking ? 'speaking' : state, v.label);
    },
    setSpeaking(id, on) {
      if (destroyed) return;
      if (on) speaking.add(id);
      else speaking.delete(id);
      const v = known(id);
      if (!v || v.speaking === on) return;
      v.speaking = on;
      applyPresence(v);
      scheduleTiers();
      if (stage.isOpen) stage.setSpeaking(id, on);
    },
    showBubble(id, text, opts = {}) {
      if (destroyed) return;
      const v = known(id);
      if (!v) return;
      let b = bubbles.get(id);
      if (!b) {
        const el = mk('div', 'hc-o-bubble', bubblesEl);
        el.style.setProperty('--acc', v.acc);
        el.setAttribute('role', 'note');
        b = { id, el, timer: null, expires: 0 };
        bubbles.set(id, b);
        if (!reducedMotion()) {
          el.classList.add('is-entering');
          void el.offsetWidth;
          el.classList.remove('is-entering');
        }
      }
      b.el.replaceChildren();
      const inner = mk('div', 'hc-o-bubble__in', b.el);
      const who = mk('b', 'hc-o-bubble__who', inner);
      who.textContent = firstName(v.person.name);
      if (opts.to && views.has(opts.to)) {
        const to = views.get(opts.to)!;
        who.textContent = `${firstName(v.person.name)} → ${firstName(to.person.name)}`;
        b.arc?.remove();
        b.arc = handoffArc(v, to);
      }
      const t = mk('span', 'hc-o-bubble__text', inner);
      t.textContent = text;
      armBubble(b, bubbleTtl(text, opts.ttlMs));
      placeBubbles();
      scheduleTiers();
    },
    hideBubble(id) {
      removeBubble(id);
    },
    anchor(id) {
      const el = mk('div', 'hc-o-anchor', bubblesEl);
      const rec: AnchorRec = { id, el };
      anchors.add(rec);
      if (!views.has(id)) known(id);
      placeBubbles();
      return {
        el,
        release() {
          anchors.delete(rec);
          el.remove();
        },
      };
    },
    showCaption(id, text, opts) {
      if (!destroyed) stage.showCaption(id, text, opts);
    },
    setFloorQueue(ids) {
      if (!destroyed) stage.setFloorQueue(ids);
    },
    focus(id, opts = {}) {
      if (destroyed || !known(id)) return;
      if (mode === 'conference' && stage.isOpen) {
        if ((roomPeople.get(roomId ?? '') ?? []).includes(id)) {
          stage.focusFirst();
          return;
        }
        api.leaveRoom();
      }
      focusSeat(id, { animate: opts.animate, zoom: opts.zoom ?? 'desk' });
    },
    walkTo(target) {
      if (destroyed) return;
      if (roomById(target)) {
        api.enterRoom(target);
        return;
      }
      if (mode === 'conference') api.leaveRoom();
      let r: Rect | null = null;
      if (target === 'chief') {
        const a = plan.amenities.find((x) => x.id === 'chief');
        if (a) r = { x: a.rect.x, y: Y(a.rect.y) - 16, w: a.rect.w, h: a.rect.h * K_Y + 16 };
      } else {
        const a = plan.amenities.find((x) => x.id === target);
        if (a) r = { x: a.rect.x, y: Y(a.rect.y) - 14, w: a.rect.w, h: a.rect.h * K_Y + 14 };
        const z = plan.zones.find((x) => x.groupId === target || x.id === target);
        if (z) r = zoneRect(z);
      }
      if (!r) return;
      flyTo(frameRect(r, vp, { margin: 0.1, maxZoom: ZOOM_NEIGHBOURHOOD + 0.6, minZoom }));
    },
    zoomTo(level, at) {
      if (destroyed) return;
      if (level === 'fit') {
        flyTo(fit, undefined, 400);
        return;
      }
      const z = level === 'neighbourhood' ? ZOOM_NEIGHBOURHOOD : level === 'desk' ? ZOOM_DESK : Math.min(MAX_ZOOM, level);
      flyTo({ x: at?.x ?? cam.x, y: at?.y ?? cam.y, zoom: z }, undefined, 400);
    },
    setMode(m, rid) {
      if (destroyed) return;
      if (m === 'conference') api.enterRoom(rid ?? roomId ?? lastRoom ?? plan.rooms[0]?.id ?? 'skyline');
      else api.leaveRoom();
    },
    enterRoom(rid, participants = []) {
      if (destroyed) return;
      const room = roomById(rid);
      if (!room) return;
      if (mode === 'conference' && roomId === rid && stage.isOpen) {
        if (participants.length) invite(rid, participants, 'picker');
        return;
      }
      if (mode === 'conference' && roomId && roomId !== rid) api.leaveRoom();
      picker?.close();
      hud.closeMenus();
      dwell.clear();
      for (const id of [...bubbles.keys()]) removeBubble(id);
      lastRoom = rid;
      setModeState('conference', rid);
      const animate = !reducedMotion();
      const fresh = participants.filter((id) => views.has(id));
      const added = seatInRoom(room, fresh, animate);
      const all = (roomPeople.get(rid) ?? []).slice();
      options.onEnterRoom?.(rid, all);
      const walkEnd = Math.max(0, ...added.map((id) => {
        const w = views.get(id)?.walk;
        return w ? w.start - clock() + w.dur : 0;
      }));
      const target = frameRect(roomRectProjected(room), vp, { margin: 0.08, maxZoom: 7, minZoom });
      if (!animate) {
        cam = clampCamera(target, box, vp);
        requestFrame();
        openStage(room, false);
        return;
      }
      flyTo(target, () => {
        later(() => openStage(room, true), Math.max(0, walkEnd - FLIGHT_MS) + 120);
      });
    },
    seat(id, rid) {
      if (destroyed) return;
      const v = known(id);
      if (!v) return;
      if (rid) {
        invite(rid, [id], 'picker');
        return;
      }
      const from = v.roomId;
      if (!from) return;
      roomPeople.set(from, (roomPeople.get(from) ?? []).filter((x) => x !== id));
      updateRoomLabels();
      walkBack(v, 0, !reducedMotion());
      if (stage.isOpen && roomId === from) stage.setParticipants(roomPeople.get(from) ?? []);
    },
    leaveRoom() {
      if (destroyed || mode !== 'conference') return;
      const rid = roomId;
      const list = rid ? (roomPeople.get(rid) ?? []).slice() : [];
      picker?.close();
      stage.close(!reducedMotion());
      setModeState('desks', null);
      if (rid) {
        roomPeople.set(rid, []);
        let delay = 0;
        for (const id of list) {
          const v = views.get(id);
          if (!v) continue;
          walkBack(v, delay, !reducedMotion());
          delay += 120;
        }
        updateRoomLabels();
        options.onLeaveRoom?.(rid, list);
      }
      manageFaces();
      requestFrame();
      later(() => {
        const v = views.get(rovingId ?? '');
        if (root.contains(doc.activeElement) || doc.activeElement === doc.body) v?.btn.focus({ preventScroll: true });
      }, 50);
    },
    dock() {
      return stage.claimDock();
    },
    setTheme(t) {
      if (destroyed || t === theme) return;
      theme = t;
      root.dataset.theme = t;
      if (options.accentFor) {
        const cameraBefore = cam;
        replan();
        cam = cameraBefore;
        render();
        settle();
      }
    },
    setTimeOfDay(t) {
      if (destroyed) return;
      todSetting = t;
      applyTimeOfDay(true);
    },
    setReducedMotion(value) {
      if (destroyed) return;
      rmSetting = value;
      applyMotion();
    },
    getState(): OfficeState {
      return {
        mode,
        roomId,
        participants: roomId ? (roomPeople.get(roomId) ?? []).slice() : [],
        rooms: Object.fromEntries(plan.rooms.map((r) => [r.id, (roomPeople.get(r.id) ?? []).slice()])),
        camera: { ...cam },
        lod,
        focusedId,
        hoveredId,
        timeOfDay: tod,
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelFrame();
      if (settleTimer) clearTimeout(settleTimer);
      if (clockTimer) clearTimeout(clockTimer);
      if (todTimer) clearInterval(todTimer);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const b of bubbles.values()) if (b.timer) clearTimeout(b.timer);
      bubbles.clear();
      anchors.clear();
      dwell.destroy();
      picker?.close();
      ro?.disconnect();
      win.removeEventListener?.('resize', onResize);
      if (keyEl !== root) {
        keyEl.removeEventListener('keydown', onKeyDown as EventListener);
        keyEl.removeEventListener('keydown', wake, { capture: true });
      }
      mql?.removeEventListener?.('change', onMotionPref);
      for (const v of views.values()) releaseFace(v);
      views.clear();
      stage.destroy();
      sky.destroy();
      hud.destroy();
      root.remove();
      releaseStyles(doc);
    },
  };

  // ── boot ───────────────────────────────────────────────────────────────────────────────────────────────────
  replan();
  applyMotion();
  // The sky waits briefly for the art manifest (LQIP first, then the image), else draws the vector city.
  let skyReady = false;
  const skyFallback = () => {
    if (skyReady || destroyed) return;
    skyReady = true;
    sky.setVariant(tod, false);
    skyLayout();
  };
  if (!assetsBase) skyFallback();
  else later(skyFallback, 700);
  const initial = options.initialCamera;
  if (initial && initial !== 'fit') cam = clampCamera({ ...initial, zoom: clampZoom(initial.zoom, minZoom) }, box, vp);
  else if (!initial) {
    const restored = restoreCamera();
    cam = restored ? clampCamera({ ...restored, zoom: clampZoom(restored.zoom, minZoom) }, box, vp) : openCamera();
  } else cam = openCamera();
  wake();
  lod = lodFor(cam.zoom);
  root.dataset.lod = String(lod);
  settledZoom = cam.zoom;
  render();
  settle();
  scheduleClock();
  const todTimer = setInterval(() => !destroyed && applyTimeOfDay(true), 5 * 60_000);
  if (assetsBase) {
    void loadManifest(assetsBase).then((m) => {
      if (destroyed) return;
      if (!m) return skyFallback();
      manifest = m;
      sky.setManifest(m, assetsBase);
      if (!skyReady) {
        skyReady = true;
        sky.setVariant(tod, false);
      }
      skyLayout();
      applyWallArt();
      if (stage.isOpen) stage.layout();
    });
  }
  return api;
}

