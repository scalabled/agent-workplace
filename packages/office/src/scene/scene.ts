// createOfficeScene: the office floor as a framework-agnostic DOM scene. One CSS-transformed world
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
import { insetLayout, normInsets } from './insets';
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
import { blockedAt, clearSegment, lifeNav } from '../life/nav';
import type { Attach, Exempt } from '../life/nav';
import { distanceAt, facingOf as travelFacing, makeProfile, pointAtDistance, pointAttach, roundRoute, route as lifeRoute, seatAttach, slotAttach, speedAt, stopProfile, subPath } from '../life/route';
import type { PathProfile } from '../life/route';
import { planSpots } from '../life/spots';
import { AUTOPILOT, autopilotDue, followTarget, holdFor, springStep } from '../life/moments';
import type { Cue, HoldWhy, LifeHooks, LifeSummary, Moment, MoveHandle, MoveOptions, OfficeSpot, PlaceRef, ShowHuddleArgs } from '../life/types';
import { createLifeUi } from './life-ui';
import type { LifeUi } from './life-ui';

const WALK_SPEED = 260; // u/s
const FLIGHT_MS = 600;
const SETTLE_MS = 120;
const MAX_FACES = 96;
/** Faces mounted per task (the rest follow on the next frames). */
const FACES_PER_TASK = 24;
const RELEASE_OFFSCREEN_MS = 10_000;
const RELEASE_L0_MS = 2_000;
const ZOOM_NEIGHBOURHOOD = 3.2;
const ZOOM_DESK = 5.6;
/** The HUD row (the pill, Desks | Conference, the tools) the camera keeps focused people below. */
const HUD_BAND_PX = 64;
/** A focused person or huddle this close to an edge (share of the view) is brought in. */
const EDGE_MARGIN = 0.15;
/** Phones open on the Chief's neighbourhood at a legible zoom, with the floor filling about two thirds of the view. */
const NARROW_W = 640;
const ZOOM_PHONE = 2.4;
const PHONE_FLOOR_LINE = 0.33;
/** The opening view on a portrait phone shows at most this share of sky above the north floor line. */
const PHONE_SKY_MAX = 0.2;
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
  /** Office life: where the person is (their desk, a spot slot or a point on the floor). */
  place: PlaceRef;
  posture: 'sit' | 'stand';
  lwalk: LifeWalk | null;
  /** Face-badge lean toward a speaker (deg). */
  lean: number;
  facingCand: Facing | null;
  facingSince: number;
  /** The face anchor height eases on arrival (standing → sitting), from this height since this time. */
  zFrom: number;
  zAt: number;
  /** The direction of travel while walking (the body glyph takes it on arrival). */
  walkFacing: Facing | null;
  /** Plan zoom: the walker's dot and its trail samples (screen-independent plan points with times). */
  dot: { el: HTMLElement; trail: HTMLElement[]; hist: { x: number; y: number; t: number }[] } | null;
  /** The latest face cue (a newer cue supersedes an older one). */
  cueSeq?: number;
}

/** An office-life walk: a function of time along a smooth path. */
interface LifeWalk {
  profile: PathProfile;
  /** Scene clock (ms) at distance 0. */
  start: number;
  to: PlaceRef;
  dest: { x: number; y: number; facing: Facing; posture: 'sit' | 'stand' };
  face?: Facing | 'viewer' | Point;
  resolve: (ok: boolean) => void;
  /** When the walker enters the view (Infinity: never on this camera). Off-screen walkers are not animated. */
  enterAt: number;
  /** Instant moves (reduced motion): fade out, move, fade in. */
  fade: { moveAt: number; endAt: number } | null;
}

interface Bubble {
  id: string;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  expires: number;
  arc?: SVGSVGElement;
  /** Small talk (a huddle's bubble) rather than an owner-facing or passing-by bubble. */
  talk?: string;
  at: number;
  /** Measured size (px) of the bubble body, once. */
  w?: number;
  h?: number;
  /** Current placement: horizontal shift (px) above the face, or beside or below it; lifted and narrower last. */
  bx?: number;
  by?: number;
  /** Beside the face: a vertical shift (px), the tail staying level with the face. */
  sy?: number;
  side?: 'above' | 'right' | 'left' | 'below';
  narrow?: boolean;
  /** A reply in a joined huddle's chat: clicks pass through it. */
  passive?: boolean;
}

/** A laugh: a muted caption chip beside the face, no header or tail, ≤ 1.2 s, outside the bubble caps. */
interface Chip {
  id: string;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  w?: number;
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
  let spotsCache: OfficeSpot[] = [];
  let spotById = new Map<string, OfficeSpot>();
  let lifeHooks: LifeHooks | null = null;
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
  /** The camera is still the default opening view (not restored, not set by the host) and nobody has moved it. */
  let openedOnDefault = true;
  let cameraTouched = false;
  /** The host's overlays over the office (OfficeOptions.insets): the HUD and bubbles keep out of them. */
  let insets = normInsets(options.insets);

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
  // Walkers at plan zoom: accent dots with a short fading trail on their own composited layer (transform-only
  // updates, ≤ 30 Hz), so a walk never repaints the plate.
  const walkersEl = mk('div', 'hc-o-walkers', root);
  walkersEl.setAttribute('aria-hidden', 'true');
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
      cameraTouched = true;
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
        place: { kind: 'desk' },
        posture: 'sit',
        lwalk: null,
        lean: 0,
        facingCand: null,
        facingSince: 0,
        zFrom: NaN,
        zAt: 0,
        walkFacing: null,
        dot: null,
      };
      if (prev) {
        prev.slot?.destroy();
        dropDot(prev);
        if (prev.lwalk) {
          const w = prev.lwalk;
          prev.lwalk = null;
          w.resolve(false);
        }
        const away = prev.place.kind === 'point' || (prev.place.kind === 'spot' && spotsCache.some((sp) => prev.place.kind === 'spot' && sp.id === prev.place.spotId));
        if (away && !prev.roomId) {
          // Office life: someone away from their desk stays where they are.
          v.x = prev.x;
          v.y = prev.y;
          v.place = prev.place;
          v.posture = prev.posture;
          v.facing = prev.facing;
          v.btn.dataset.away = '';
        } else if (prev.seat && prev.seat.id !== seat.id && !prev.roomId && !reducedMotion()) {
          // FLIP: someone whose desk moved glides from the old desk to the new one.
          const path = simplify([{ x: prev.x, y: prev.y }, { x: seat.x, y: seat.y }]);
          v.x = prev.x;
          v.y = prev.y;
          v.walk = { path, len: pathLength(path), start: clock(), dur: 600, to: null };
        }
      }
      views.set(p.id, v);
      setBody(v, prev?.bodyFacing && v.place.kind !== 'desk' ? prev.bodyFacing : v.facing);
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
    const nextSpots = planSpots(plan);
    spotsCache = spotsCache.length ? spotsCache.filter((a) => nextSpots.some((b) => b.id === a.id)) : nextSpots;
    buildWorld();
    buildViews();
    spotsCache = nextSpots;
    spotById = new Map(spotsCache.map((sp) => [sp.id, sp]));
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
  /** Where an away person is, in words ("Coffee bar", "At Juno's desk", "Water cooler · with Pax"). */
  const placeText = (v: PView): string => {
    if (v.place.kind !== 'spot') return '';
    const sp = spotById.get(v.place.spotId);
    if (!sp) return '';
    let label = sp.label;
    if (sp.kind === 'desk_dropby' && sp.seatId) {
      const host = plan.seats.find((x) => x.id === sp.seatId)?.personId;
      const hv = host ? views.get(host) : undefined;
      if (hv) label = S.life.atDesk(firstName(hv.person.name));
    }
    const hid = lifeUi?.huddleOf(v.person.id);
    const with_ = hid ? (huddleMembers.get(hid) ?? []).filter((id) => id !== v.person.id).map((id) => firstName(views.get(id)?.person.name ?? id)) : [];
    return S.life.withNames(label, with_);
  };
  const statusText = (v: PView): string => {
    if (v.roomId && mode === 'desks') {
      const r = plan.rooms.find((x) => x.id === v.roomId);
      if (r) return S.inRoom(r.name);
    }
    if (v.speaking) return S.states.speaking;
    if (v.state === 'idle') {
      const where = !v.lwalk ? placeText(v) : '';
      if (where) return where;
      return v.badges.includes('lamp') ? S.nightShift : '';
    }
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
      const atDesk = !v.roomId && !v.walk && !v.lwalk && v.place.kind === 'desk';
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
    if (stepLifeWalks(tt)) active = true;
    if (walkerTick) walkersAt = tt;
    if (stepFollow(tt)) active = true;
    render();
    if (active) requestFrame();
    else scheduleLifeWake();
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
    cameraTouched = true;
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
    const line = vp.h > vp.w ? PHONE_SKY_MAX : PHONE_FLOOR_LINE;
    return clampCamera({ x, y: Y(0) + (vp.h * (0.5 - line)) / zoom, zoom }, box, vp);
  };
  /** The opening view: the hero shot on laptops, the Chief's neighbourhood on phones. */
  const openCamera = (): Camera => (narrow() ? phoneCamera() : fit);
  const skyLayout = () => {
    // The sky is framed for the opening view, so the waterline sits in the north glass there.
    sky.layout({ vp, fit: openCamera(), cam, anchorY: Y(0, SKY_ANCHOR_Z), floorY: Y(0), anchorX: box.x + box.w / 2, parallax: !reducedMotion() });
  };

  /** Where a face floats (plan z): desks and rooms as before; standing and walking at head height; seated away lower. */
  const lifeZ = (v: PView): number => {
    if (v.roomId || v.walk || v.lwalk) return anchorZ(v.facing, true);
    if (v.place.kind === 'desk') return anchorZ(v.facing, false);
    return v.posture === 'sit' ? (v.facing === 's' ? 5 : 7) : 11;
  };
  const Z_EASE_MS = 280;
  const personAnchor = (v: PView): Point => {
    let z = lifeZ(v);
    if (!Number.isNaN(v.zFrom)) {
      const k = (clock() - v.zAt) / Z_EASE_MS;
      if (k >= 1) v.zFrom = NaN;
      else z = v.zFrom + (z - v.zFrom) * easeOut(Math.max(0, k));
    }
    return { x: v.x, y: Y(v.y, z) };
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
    const rm = reducedMotion();
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
      // A walker's badge bobs 0.6 px at 1.9 Hz at L1 and L2 (a transform; off with reduced motion).
      const bob = v.lwalk && !v.lwalk.fade && lod > 0 && !rm ? Math.sin((t / 1000) * 1.9 * 2 * Math.PI) * 0.6 : 0;
      if (vis && (sx !== v.sx || sy !== v.sy || camMoved || bob)) {
        v.sx = sx;
        v.sy = sy;
        v.btn.style.transform = `translate3d(${sx.toFixed(1)}px,${(sy + bob).toFixed(1)}px,0) scale(${k.toFixed(4)})`;
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
    placeGhosts();
    placeDots();
    fadeCrossedLabels();
    if (lifeUi && mode === 'desks') {
      lifeUi.place(
        (p, z) => {
          const sx = (p.x - cam.x) * cam.zoom + vp.w / 2;
          const sy = (Y(p.y, z) - cam.y) * cam.zoom + vp.h / 2;
          return sx > -40 && sx < vp.w + 40 && sy > -40 && sy < vp.h + 40 ? { x: sx, y: sy } : null;
        },
        lod,
        vp,
        (members) => {
          // The bottom of the lowest member's name plate (screen px).
          let y = -Infinity;
          for (const id of members) {
            const v = views.get(id);
            if (v?.visible && Number.isFinite(v.sy)) y = Math.max(y, v.sy + faceSize(lod, cam.zoom) / 2 + 14);
          }
          return Number.isFinite(y) ? y : null;
        },
        (members) => {
          // Where the members stand on the floor (screen px), padded like the default ring around one spot.
          let x0 = Infinity;
          let x1 = -Infinity;
          let y0 = Infinity;
          let y1 = -Infinity;
          let n = 0;
          for (const id of members) {
            const v = views.get(id);
            if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
            const sx = (v.x - cam.x) * cam.zoom + vp.w / 2;
            const sy = (Y(v.y, 0) - cam.y) * cam.zoom + vp.h / 2;
            x0 = Math.min(x0, sx);
            x1 = Math.max(x1, sx);
            y0 = Math.min(y0, sy);
            y1 = Math.max(y1, sy);
            n++;
          }
          if (n < 2) return null;
          const z = cam.zoom;
          return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(34 * z, x1 - x0 + 26 * z), h: Math.max(21 * z, y1 - y0 + 16 * z) };
        },
      );
    }
  };

  // ── walkers at plan zoom: a 7 px accent dot with a 2 s fading trail ──
  const TRAIL = 8;
  const dropDot = (v: PView) => {
    if (!v.dot) return;
    v.dot.el.remove();
    for (const e of v.dot.trail) e.remove();
    v.dot = null;
  };
  const placeDots = () => {
    const on = lod === 0 && mode === 'desks';
    const t = clock();
    for (const v of views.values()) {
      const w = v.lwalk;
      if (!on || !w || w.fade || !v.visible || w.start > t) {
        if (v.dot) dropDot(v);
        continue;
      }
      if (!v.dot) {
        const trail: HTMLElement[] = [];
        for (let i = 0; i < TRAIL; i++) {
          const e = mk('i', 'hc-o-walker__trail', walkersEl);
          e.style.setProperty('--acc', v.acc);
          e.style.setProperty('--k', String(i));
          trail.push(e);
        }
        const el = mk('i', 'hc-o-walker', walkersEl);
        el.style.setProperty('--acc', v.acc);
        v.dot = { el, trail, hist: [] };
      }
      const d = v.dot;
      const last = d.hist[d.hist.length - 1];
      if (!last || t - last.t >= 250) {
        d.hist.push({ x: v.x, y: v.y, t });
        if (d.hist.length > TRAIL + 1) d.hist.shift();
      }
      const at = (x: number, y: number) => `translate3d(${((x - cam.x) * cam.zoom + vp.w / 2).toFixed(1)}px,${((Y(y, 2) - cam.y) * cam.zoom + vp.h / 2).toFixed(1)}px,0)`;
      d.el.style.transform = at(v.x, v.y);
      for (let i = 0; i < TRAIL; i++) {
        const sample = d.hist[d.hist.length - 2 - i];
        d.trail[i]!.style.transform = sample && t - sample.t < 2000 ? at(sample.x, sample.y) : 'translate3d(-40px,-40px,0)';
      }
    }
  };
  /**
   * A neighbourhood's floor sign (or a place's sign) fades to 40 % while a walker crosses it or someone away from their
   * desk stands on it (≤ 10 checks a second), so a name plate never fights a sign.
   */
  let labelsCheckedAt = 0;
  const fadeCrossedLabels = () => {
    const t = clock();
    if (t - labelsCheckedAt < 100) return;
    labelsCheckedAt = t;
    const walkers: Point[] = [];
    if (mode === 'desks') {
      for (const v of views.values()) {
        if (!v.visible || !Number.isFinite(v.sx)) continue;
        const walking = !!v.lwalk && !v.lwalk.fade;
        if (!walking && (v.place.kind === 'desk' || lod === 0)) continue;
        if (walking) walkers.push({ x: (v.x - cam.x) * cam.zoom + vp.w / 2, y: (Y(v.y, 2) - cam.y) * cam.zoom + vp.h / 2 });
        walkers.push({ x: v.sx, y: v.sy });
        if (lod > 0) walkers.push({ x: v.sx, y: v.sy + faceSize(lod, cam.zoom) / 2 + 12 });
      }
    }
    for (const l of labels) {
      if (l.kind !== 'zone' && l.kind !== 'place') continue;
      let hit = false;
      if (walkers.length) {
        const r = l.el.firstElementChild as HTMLElement | null;
        const w = r?.offsetWidth ?? 80;
        const hgt = r?.offsetHeight ?? 18;
        const sx = (l.p.x - cam.x) * cam.zoom + vp.w / 2;
        const sy = (l.p.y - cam.y) * cam.zoom + vp.h / 2;
        hit = walkers.some((p) => p.x > sx - 6 && p.x < sx + w + 6 && p.y > sy - 8 && p.y < sy + hgt + 8);
      }
      l.el.classList.toggle('is-crossed', hit);
    }
  };

  /** At desk zoom, an empty desk whose person is away says where they are ("Kate · Coffee bar"), ≤ 25 at a time. */
  const ghosts = new Map<string, { el: HTMLElement; text: string }>();
  const placeGhosts = () => {
    const seen = new Set<string>();
    if (lod === 2 && mode === 'desks') {
      for (const v of views.values()) {
        if (!v.seat || v.roomId || (v.place.kind === 'desk' && !v.lwalk)) continue;
        // Right next to their desk (a drop-by next door, walking past), the person is the label: no ghost plate.
        if (Math.hypot(v.x - v.seat.x, v.y - v.seat.y) < 60) continue;
        if (seen.size >= 25) break;
        const sx = (v.seat.x - cam.x) * cam.zoom + vp.w / 2;
        const sy = (Y(v.seat.y, anchorZ(v.seat.facing, false)) - cam.y) * cam.zoom + vp.h / 2;
        if (sx < -60 || sx > vp.w + 60 || sy < -30 || sy > vp.h + 30) continue;
        seen.add(v.person.id);
        let g = ghosts.get(v.person.id);
        if (!g) {
          const el = mk('div', 'hc-o-ghostplate', labelsEl);
          g = { el, text: '' };
          ghosts.set(v.person.id, g);
        }
        const where = v.lwalk ? S.life.walking : (placeText(v) || S.life.away).split(' · ')[0]!;
        const text = `${firstName(v.person.name)}\n${where}`;
        if (text !== g.text) {
          g.text = text;
          g.el.replaceChildren();
          const b = mk('b', '', g.el);
          b.textContent = firstName(v.person.name);
          const i = mk('span', '', g.el);
          i.textContent = where;
          g.el.setAttribute('aria-hidden', 'true');
        }
        g.el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;
      }
    }
    for (const [id, g] of ghosts) {
      if (seen.has(id)) continue;
      g.el.remove();
      ghosts.delete(id);
    }
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
    lifeHooks?.onViewChange({ input: clock() - lastInput < 4000 });
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
    recomputeEntries();
    lifeHooks?.onViewChange({ input: clock() - lastInput < 4000 });
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
    // Mount at most a couple of dozen faces per task, nearest first; the rest follow on the next frames (no long
    // task when the view jumps to a neighbourhood full of people).
    let budget = FACES_PER_TASK;
    let more = false;
    for (const v of keep) {
      if (v.slot) continue;
      if (budget-- <= 0) {
        more = true;
        break;
      }
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
    facesTimer = later(manageFaces, more ? 24 : RELEASE_OFFSCREEN_MS + 50);
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
    const wasRoom = v.roomId;
    v.roomId = null;
    v.roomSeat = -1;
    v.place = { kind: 'desk' };
    delete v.btn.dataset.away;
    if (wasRoom) lifeHooks?.onRoom?.(v.person.id, null);
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
    if (v.roomId !== rid) lifeHooks?.onRoom?.(v.person.id, rid);
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
    if (v.lwalk) {
      const w = v.lwalk;
      if (!w.fade) {
        const p = pointAtDistance(w.profile, distanceAt(w.profile, (clock() - w.start) / 1000));
        v.x = p.x;
        v.y = p.y;
      }
      v.lwalk = null;
      w.resolve(false);
    }
    const away = v.place.kind !== 'desk';
    const from = v.roomId || away ? { ...v.seat, x: v.x, y: v.y } : v.seat;
    const path = v.roomId === room.id ? simplify([{ x: v.x, y: v.y }, rs]) : walkPath(plan.walk, plan, from, room, rs);
    v.place = { kind: 'desk' };
    delete v.btn.dataset.away;
    const len = pathLength(path);
    const dur = Math.min(1600, Math.max(600, (len / WALK_SPEED) * 1000));
    v.roomId = room.id;
    v.roomSeat = seatIndex;
    v.btn.dataset.room = room.id;
    v.walk = { path, len, start: clock() + delay, dur, to: { roomId: room.id, seatIndex } };
    applyPresence(v);
    lifeHooks?.onRoom?.(v.person.id, room.id);
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

  // ── office life: walks ─────────────────────────────────────────────────────────────────
  const FADE_MS = 160;
  const nav = () => lifeNav(plan);
  /** Where a place is, how the person faces there and whether they sit. */
  const destOf = (v: PView, to: PlaceRef): LifeWalk['dest'] | null => {
    if (to.kind === 'desk') return v.seat ? { x: v.seat.x, y: v.seat.y, facing: v.seat.facing, posture: 'sit' } : null;
    if (to.kind === 'spot') {
      const sl = spotById.get(to.spotId)?.slots[to.slot];
      return sl ? { x: sl.x, y: sl.y, facing: sl.facing, posture: sl.posture } : null;
    }
    if (to.kind === 'point') return { x: to.x, y: to.y, facing: to.facing ?? v.bodyFacing ?? v.facing, posture: 'stand' };
    return null;
  };
  /** The ways out of where someone is right now. */
  const attachOf = (v: PView): Attach[] => {
    const n = nav();
    if (!v.lwalk && !v.walk && v.place.kind === 'desk' && v.seat) return seatAttach(n, plan, v.seat);
    if (!v.lwalk && !v.walk && v.place.kind === 'spot') {
      const sp = spotById.get(v.place.spotId);
      if (sp) return slotAttach(n, sp, v.place.slot);
    }
    return pointAttach(n, { x: v.x, y: v.y });
  };
  const attachTo = (v: PView, to: PlaceRef): Attach[] => {
    const n = nav();
    if (to.kind === 'desk' && v.seat) return seatAttach(n, plan, v.seat);
    if (to.kind === 'spot') {
      const sp = spotById.get(to.spotId);
      if (sp) return slotAttach(n, sp, to.slot);
    }
    return pointAttach(n, to.kind === 'point' ? { x: to.x, y: to.y } : { x: v.x, y: v.y });
  };
  const inViewAt = (x: number, y: number, margin = 0.15): boolean => {
    const a = { x, y: Y(y, 11) };
    const sx = (a.x - cam.x) * cam.zoom + vp.w / 2;
    const sy = (a.y - cam.y) * cam.zoom + vp.h / 2;
    return sx > -vp.w * margin && sx < vp.w * (1 + margin) && sy > -vp.h * margin && sy < vp.h * (1 + margin);
  };
  /** The first time (scene clock) a walk's path enters the view, sampled every 100 ms. */
  const enterTime = (w: LifeWalk, from: number): number => {
    if (w.fade) return 0;
    const end = w.start + w.profile.dur * 1000;
    for (let t = Math.max(from, w.start); t <= end; t += 100) {
      const p = pointAtDistance(w.profile, distanceAt(w.profile, (t - w.start) / 1000));
      if (inViewAt(p.x, p.y)) return t;
    }
    return inViewAt(w.dest.x, w.dest.y) ? end : Infinity;
  };
  const turnToward = (v: PView, toward: Facing | 'viewer' | Point | undefined, fallback: Facing) => {
    let f: Facing = fallback;
    if (toward === 'viewer') f = 's';
    else if (typeof toward === 'string') f = toward;
    else if (toward) f = travelFacing(toward.x - v.x, toward.y - v.y);
    setBody(v, f);
  };
  const finishLifeWalk = (v: PView) => {
    const w = v.lwalk;
    if (!w) return;
    const zBefore = lifeZ(v);
    v.lwalk = null;
    v.x = w.dest.x;
    v.y = w.dest.y;
    v.place = w.to;
    v.posture = w.dest.posture;
    v.facing = w.to.kind === 'desk' ? (v.seat?.facing ?? v.facing) : w.dest.facing;
    // Sitting down (or back at the desk): the face settles to its new height instead of jumping (only in view: an
    // off-screen arrival costs no frames).
    if (!w.fade && !reducedMotion() && Math.abs(lifeZ(v) - zBefore) > 0.5 && inViewAt(v.x, v.y, 0.05)) {
      v.zFrom = zBefore;
      v.zAt = clock();
      requestFrame();
    }
    if (w.to.kind === 'desk') {
      delete v.btn.dataset.away;
      setBody(v, v.facing);
    } else {
      v.btn.dataset.away = '';
      if (v.walkFacing) setBody(v, v.walkFacing);
      // The arrival turn, 150 ms after stopping.
      later(() => views.get(v.person.id) === v && !v.lwalk && turnToward(v, w.face, w.dest.facing), reducedMotion() ? 0 : 150);
    }
    v.walkFacing = null;
    dropDot(v);
    delete v.btn.dataset.walking;
    v.body?.removeAttribute('data-walking');
    placeBody(v);
    applyPresence(v);
    w.resolve(true);
  };
  let walkersAt = 0;
  let walkerTick = false;
  const stepLifeWalks = (t: number): boolean => {
    let any = false;
    walkerTick = false;
    for (const v of views.values()) {
      if (!Number.isNaN(v.zFrom)) {
        if (t - v.zAt < Z_EASE_MS) any = true;
        v.sx = NaN;
      }
      const w = v.lwalk;
      if (!w) continue;
      if (w.fade) {
        // Reduced motion: fade out at the origin, move, fade in at the destination.
        if (t >= w.fade.moveAt && v.btn.dataset.fade === 'out') {
          v.x = w.dest.x;
          v.y = w.dest.y;
          placeBody(v);
          v.btn.dataset.fade = 'in';
          v.body?.setAttribute('data-fade', 'in');
          v.sx = NaN;
        }
        if (t >= w.fade.endAt) {
          delete v.btn.dataset.fade;
          v.body?.removeAttribute('data-fade');
          finishLifeWalk(v);
        } else any = true;
        continue;
      }
      const el = (t - w.start) / 1000;
      if (el >= w.profile.dur) {
        finishLifeWalk(v);
        continue;
      }
      if (el < 0) {
        any = any || t >= w.enterAt;
        continue;
      }
      // Off-screen walkers are not animated: their position is a function of time, computed when they come into
      // view (or the camera moves) and at the end. At plan zoom a walker moves at ≤ 30 Hz (a dot in its own layer).
      if (!(moving || t >= w.enterAt)) continue;
      any = true;
      if (lod === 0 && !moving && t - walkersAt < 33) continue;
      walkerTick = true;
      const s0 = distanceAt(w.profile, el);
      const p = pointAtDistance(w.profile, s0);
      v.x = p.x;
      v.y = p.y;
      // Facing follows the direction of travel once it has held for 0.15 s (no flicker on corners). The plate's
      // body glyph is hidden while walking (the dot layer draws them), so it is updated on arrival, not per frame.
      const ahead = pointAtDistance(w.profile, Math.min(w.profile.len, s0 + 1.5));
      const dx = ahead.x - p.x;
      const dy = ahead.y - p.y;
      if (Math.hypot(dx, dy) > 0.05) {
        const f = travelFacing(dx, dy);
        if (f !== v.walkFacing) {
          if (f !== v.facingCand) {
            v.facingCand = f;
            v.facingSince = t;
          } else if (t - v.facingSince >= 150 || v.walkFacing === null) v.walkFacing = f;
        } else v.facingCand = null;
      }
      if (!inViewAt(p.x, p.y, 0.3) && !moving) w.enterAt = enterTime(w, t);
    }
    return any;
  };
  /** With no frame running, wake for the next off-screen walker that enters the view or finishes. */
  let lifeWake: ReturnType<typeof setTimeout> | null = null;
  const scheduleLifeWake = () => {
    if (lifeWake) clearTimeout(lifeWake);
    lifeWake = null;
    let next = Infinity;
    for (const v of views.values()) {
      const w = v.lwalk;
      if (!w) continue;
      next = Math.min(next, w.enterAt, w.fade ? w.fade.endAt : w.start + w.profile.dur * 1000);
    }
    if (next === Infinity || destroyed) return;
    lifeWake = setTimeout(() => {
      lifeWake = null;
      if (destroyed) return;
      // An arrival nobody can see finishes here, without a frame; a walker entering the view wakes the frame loop.
      const t = clock();
      let frame = false;
      for (const v of views.values()) {
        const w = v.lwalk;
        if (!w) continue;
        if (w.fade) {
          if (t >= Math.min(w.fade.moveAt, w.fade.endAt) - 1) frame = true;
          continue;
        }
        const end = w.start + w.profile.dur * 1000;
        if (t >= end - 1 && !inViewAt(w.dest.x, w.dest.y, 0.05) && lod > 0) finishLifeWalk(v);
        else if (t >= w.enterAt - 1 || t >= end - 1) frame = true;
      }
      if (frame) requestFrame();
      else scheduleLifeWake();
    }, Math.max(0, next - clock()));
  };
  const recomputeEntries = () => {
    const t = clock();
    for (const v of views.values()) if (v.lwalk && !v.lwalk.fade) v.lwalk.enterAt = enterTime(v.lwalk, t);
  };

  /**
   * Someone stopped mid-walk for the owner steps 6 u to the edge of the lane (to the right of travel, where they
   * already keep), so the aisle stays clear for others while they wait; a small, slow step.
   */
  const sidestep = (v: PView, end: Point, before: Point) => {
    if (reducedMotion() || v.lwalk || v.walk || v.roomId || views.get(v.person.id) !== v) return;
    const len = Math.hypot(end.x - before.x, end.y - before.y);
    if (len < 0.01) return;
    const ux = (end.x - before.x) / len;
    const uy = (end.y - before.y) / len;
    const q = { x: end.x - uy * 6, y: end.y + ux * 6 };
    const g = nav().grid;
    if (blockedAt(g, q.x, q.y) || !clearSegment(g, end, q)) return;
    v.lwalk = { profile: makeProfile([end, q], 14, false), start: clock(), to: { kind: 'point', x: q.x, y: q.y }, dest: { x: q.x, y: q.y, facing: v.bodyFacing ?? v.facing, posture: 'stand' }, face: 'viewer', resolve: () => {}, enterAt: 0, fade: null };
    requestFrame();
  };

  const lifeMove = (id: string, to: PlaceRef, opts: MoveOptions = {}): MoveHandle => {
    let resolveDone: (ok: boolean) => void = () => {};
    const done = new Promise<boolean>((r) => (resolveDone = r));
    const fail = (): MoveHandle => {
      resolveDone(false);
      return { durationMs: 0, cancel() {}, done };
    };
    if (destroyed) return fail();
    const v = views.get(id);
    if (!v || v.roomId || v.walk || to.kind === 'room') return fail();
    const dest = destOf(v, to);
    if (!dest) return fail();
    // A walk in progress is superseded from where the person is now.
    if (v.lwalk) {
      const old = v.lwalk;
      if (!old.fade) {
        const p = pointAtDistance(old.profile, distanceAt(old.profile, (clock() - old.start) / 1000));
        v.x = p.x;
        v.y = p.y;
      }
      v.lwalk = null;
      delete v.btn.dataset.fade;
      v.body?.removeAttribute('data-fade');
      old.resolve(false);
      v.place = { kind: 'point', x: v.x, y: v.y };
    }
    let settled = false;
    const resolve = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolveDone(ok);
    };
    const now = clock();
    const instant = opts.pace === 'instant';
    if (instant) {
      const visible = opts.fade !== false && inViewAt(v.x, v.y, 0.05);
      if (!visible) {
        // Nobody sees it: be there now.
        v.lwalk = { profile: makeProfile([dest, dest], 1), start: now, to, dest, face: opts.face, resolve, enterAt: Infinity, fade: null };
        finishLifeWalk(v);
        requestFrame();
        return { durationMs: 0, cancel() {}, done };
      }
      v.lwalk = { profile: makeProfile([dest, dest], 1), start: now, to, dest, face: opts.face, resolve, enterAt: 0, fade: { moveAt: now + FADE_MS, endAt: now + 2 * FADE_MS } };
      v.btn.dataset.fade = 'out';
      v.body?.setAttribute('data-fade', 'out');
      v.btn.dataset.walking = '';
      applyPresence(v);
      requestFrame();
      return { durationMs: 2 * FADE_MS, cancel() {}, done };
    }
    const from = { x: v.x, y: v.y };
    const n = nav();
    let pts: Point[];
    const samePlace = Math.hypot(dest.x - from.x, dest.y - from.y) < 0.5;
    const sameSpot = to.kind === 'spot' && v.place.kind === 'spot' && v.place.spotId === to.spotId;
    const exempt: Exempt[] = [
      { x: from.x, y: from.y, r: 6 },
      { x: dest.x, y: dest.y, r: 6 },
    ];
    if (samePlace) pts = [from, dest];
    else if (sameSpot) pts = [from, dest];
    else {
      const r = lifeRoute(n, attachOf(v), attachTo(v, to));
      pts = r ? roundRoute(n, r.pts, exempt) : [from, dest];
    }
    if (Math.hypot(pts[0]!.x - from.x, pts[0]!.y - from.y) > 0.5) pts.unshift(from);
    const speed = opts.pace === 'brisk' ? Math.max(opts.speed ?? 90, 60) : (opts.speed ?? 42);
    const profile = makeProfile(pts, speed, false);
    const start = now + (opts.delayMs ?? 0) - Math.min(opts.elapsedMs ?? 0, profile.dur * 1000 - 1);
    const w: LifeWalk = { profile, start, to, dest, face: opts.face, resolve, enterAt: 0, fade: null };
    w.enterAt = enterTime(w, now);
    v.lwalk = w;
    v.place = { kind: 'point', x: v.x, y: v.y };
    v.facingCand = null;
    v.walkFacing = v.bodyFacing;
    v.btn.dataset.walking = '';
    v.body?.setAttribute('data-walking', '');
    delete v.btn.dataset.away;
    applyPresence(v);
    // A walk that starts off-screen costs no frame: the frame loop wakes when it enters the view or arrives.
    if (w.enterAt <= now || moving) requestFrame();
    else scheduleLifeWake();
    return {
      durationMs: Math.max(0, start - now) + profile.dur * 1000,
      cancel() {
        if (v.lwalk !== w) return;
        // Ease to a stop within 0.5 s, where they are.
        const t = clock();
        const el = (t - w.start) / 1000;
        const s0 = distanceAt(w.profile, Math.max(0, el));
        const sp = speedAt(w.profile, el);
        const stopLen = Math.min(w.profile.len - s0, sp * 0.25);
        const p = pointAtDistance(w.profile, s0);
        v.x = p.x;
        v.y = p.y;
        if (stopLen > 0.2) {
          const path = subPath(w.profile, s0, s0 + stopLen);
          const end = path[path.length - 1]!;
          const before = path[path.length - 2] ?? p;
          const sw: LifeWalk = {
            profile: stopProfile(path, sp, 0.5),
            start: t,
            to: { kind: 'point', x: end.x, y: end.y },
            dest: { x: end.x, y: end.y, facing: v.walkFacing ?? v.bodyFacing ?? v.facing, posture: 'stand' },
            face: 'viewer',
            resolve: (ok) => ok && sidestep(v, end, before),
            enterAt: 0,
            fade: null,
          };
          v.lwalk = sw;
          requestFrame();
        } else {
          v.lwalk = { profile: makeProfile([p, p], 1), start: t, to: { kind: 'point', x: p.x, y: p.y }, dest: { x: p.x, y: p.y, facing: v.bodyFacing ?? v.facing, posture: 'stand' }, face: 'viewer', resolve: () => {}, enterAt: 0, fade: null };
          finishLifeWalk(v);
        }
        resolve(false);
      },
      done,
    };
  };

  // ── bubbles and anchors ────────────────────────────────────────────────────────────────────────────────────
  const bubbles = new Map<string, Bubble>();
  const chips = new Map<string, Chip>();
  const removeChip = (id: string) => {
    const c = chips.get(id);
    if (!c) return;
    if (c.timer) clearTimeout(c.timer);
    chips.delete(id);
    if (reducedMotion()) c.el.remove();
    else {
      c.el.classList.add('is-leaving');
      later(() => c.el.remove(), 200);
    }
  };
  const anchors = new Set<AnchorRec>();
  const bubbleTtl = (text: string, ttl?: number) => ttl ?? Math.min(9000, 4000 + 60 * text.length);
  const armBubble = (b: Bubble, ms: number) => {
    if (b.timer) clearTimeout(b.timer);
    b.expires = clock() + ms;
    b.timer = setTimeout(() => {
      b.timer = null;
      if (hoveredId === b.id && !b.talk) armBubble(b, 3000);
      else removeBubble(b.id);
    }, ms);
  };
  /** At most three ambient bubbles on screen (A1): owner-facing and passing-by bubbles pre-empt small talk. */
  const MAX_AMBIENT_BUBBLES = 3;
  const capTalk = () => {
    const talk = [...bubbles.values()].filter((b) => b.talk).sort((a, b) => a.at - b.at);
    while (bubbles.size > MAX_AMBIENT_BUBBLES && talk.length) removeBubble(talk.shift()!.id);
  };
  const removeBubble = (id: string) => {
    const b = bubbles.get(id);
    if (!b) return;
    if (b.timer) clearTimeout(b.timer);
    bubbles.delete(id);
    if (!b.talk) lifeHooks?.onHold(id, false, 'bubble');
    else delete views.get(id)?.btn.dataset.talking;
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
  /** Every visible face with its name plate, on screen (rebuilt once per frame while bubbles or chips show). */
  const faceBoxes = (): { id: string; r: Rect }[] => {
    const out: { id: string; r: Rect }[] = [];
    if (lod === 0) return out;
    for (const v of views.values()) {
      if (!v.visible || !Number.isFinite(v.sx) || v.roomId) continue;
      const fs = faceSize(lod, cam.zoom, v.person.id === leadId);
      out.push({ id: v.person.id, r: { x: v.sx - fs / 2 - 4, y: v.sy - fs / 2 - 4, w: fs + 8, h: fs + 26 } });
    }
    return out;
  };
  /** The HUD's controls on screen (the pill, the mode switch, the tools, zoom and minimap), cached for half a second. */
  let hudCache: { at: number; rects: Rect[] } | null = null;
  const hudRects = (): Rect[] => {
    const t = clock();
    if (hudCache && t - hudCache.at < 500) return hudCache.rects.slice();
    const o = root.getBoundingClientRect();
    const rects: Rect[] = [];
    for (const e of hud.el.querySelectorAll<HTMLElement>('.hc-o-life,.hc-o-seg,.hc-o-tools,.hc-o-zoom,.hc-o-mini,.hc-o-follow')) {
      if (e.hidden) continue;
      const r = e.getBoundingClientRect();
      if (r.width && r.height) rects.push({ x: r.left - o.left - 6, y: r.top - o.top - 6, w: r.width + 12, h: r.height + 12 });
    }
    rects.push(...insetLayout(insets, vp.w, vp.h).reserved);
    hudCache = { at: t, rects };
    return rects.slice();
  };
  /** Move the HUD's controls out of the host's reserved areas (CSS translate, so every layout rule still applies). */
  const applyInsets = () => {
    const { offsets } = insetLayout(insets, vp.w, vp.h);
    for (const [k, o] of Object.entries(offsets)) {
      root.style.setProperty(`--hc-o-${k}-x`, `${o.x}px`);
      root.style.setProperty(`--hc-o-${k}-y`, `${o.y}px`);
    }
    hudCache = null;
  };
  const hitsAny = (r: Rect, blocks: readonly Rect[]) => blocks.some((f) => r.x < f.x + f.w && r.x + r.w > f.x && r.y < f.y + f.h && r.y + r.h > f.y);
  const placeBubbles = () => {
    // An open huddle card already shows its lines: that huddle's own bubbles step aside.
    const card = lifeUi?.cardId();
    const cardMembers = card ? huddleMembers.get(card) : undefined;
    const faces = bubbles.size || chips.size ? faceBoxes() : [];
    const cardR = lifeUi?.cardRect() ?? null;
    /** Bubbles already placed this frame (and the HUD): the next one keeps clear of them too. */
    const placed: Rect[] = bubbles.size ? hudRects() : [];
    for (const b of bubbles.values()) {
      const v = views.get(b.id);
      if (!v) continue;
      const p = faceTop(v);
      b.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
      const shown = v.visible && mode === 'desks' && !(b.talk && cardMembers?.includes(b.id));
      b.el.style.visibility = shown ? '' : 'hidden';
      if (shown && lod > 0) placed.push(avoidFaces(b, v, p, faces, placed, cardR));
    }
    for (const c of chips.values()) {
      const v = views.get(c.id);
      if (!v) continue;
      const shown = v.visible && mode === 'desks' && lod > 0;
      c.el.style.visibility = shown ? '' : 'hidden';
      if (!shown) continue;
      // Beside the face (right, else left), never over another face or a bubble.
      const fs = faceSize(lod, cam.zoom, v.person.id === leadId);
      const w = (c.w ??= (c.el.firstElementChild as HTMLElement | null)?.offsetWidth || 90);
      const blocks = [...faces.filter((f) => f.id !== c.id).map((f) => f.r), ...placed];
      const right = { x: v.sx + fs / 2 + 6, y: v.sy - 10, w, h: 20 };
      const left = { x: v.sx - fs / 2 - 6 - w, y: v.sy - 10, w, h: 20 };
      const side = !hitsAny(right, blocks) || hitsAny(left, blocks) ? 'right' : 'left';
      const r = side === 'right' ? right : left;
      c.el.style.transform = `translate3d(${r.x.toFixed(1)}px,${r.y.toFixed(1)}px,0)`;
      placed.push(r);
    }
    for (const a of anchors) {
      const v = views.get(a.id);
      if (!v) continue;
      const p = faceTop(v);
      a.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
      a.el.style.visibility = v.visible ? '' : 'hidden';
    }
  };
  /**
   * A bubble never covers anyone's face or name plate, a groupmate's or a bystander's, nor
   * another bubble or the open card: above the speaker, else shifted above-left or above-right (the tail stays on the
   * speaker), else below, else beside; as a last resort narrower (≤ 200 px) and lifted above the group's top-most face.
   */
  const avoidFaces = (b: Bubble, v: PView, anchor: Point, faces: readonly { id: string; r: Rect }[], placed: readonly Rect[], cardR: Rect | null): Rect => {
    if (b.w === undefined) {
      const inner = b.el.firstElementChild as HTMLElement | null;
      b.w = inner?.offsetWidth || 200;
      b.h = inner?.offsetHeight || 52;
    }
    const w = b.w;
    const h = b.h ?? 52;
    const fs = faceSize(lod, cam.zoom, v.person.id === leadId);
    const near = (r: Rect) => Math.abs(r.x + r.w / 2 - anchor.x) < w + 80 && Math.abs(r.y + r.h / 2 - anchor.y) < h + fs + 120;
    const blocks: Rect[] = [...faces.filter((f) => f.id !== v.person.id && near(f.r)).map((f) => f.r), ...placed];
    if (cardR) blocks.push(cardR);
    const inView = (r: Rect) => r.x >= 4 && r.x + r.w <= vp.w - 4 && r.y >= 4 && r.y + r.h <= vp.h - 4;
    const ok = (r: Rect) => !hitsAny(r, blocks) && inView(r);
    const top = anchor.y - 8 - h;
    const faceMid = anchor.y + fs / 2 + 6;
    let bx = 0;
    let by = 0;
    let sy = 0;
    let side: NonNullable<Bubble['side']> = 'above';
    let narrow = false;
    let rect: Rect = { x: anchor.x - w / 2, y: top, w, h };
    /**
     * The smallest horizontal slide of a bubble centred on the speaker at height y that passes `test`; the tail stays on
     * the speaker (a slide of at most half the width less 16 px). null when none does.
     */
    const slideAt = (y: number, ww: number, hh: number, test: (r: Rect) => boolean = ok): number | null => {
      const x0 = anchor.x - ww / 2;
      const lim = ww / 2 - 16;
      const cands = [0, 4 - x0, vp.w - 4 - (x0 + ww)];
      for (const f of blocks) cands.push(f.x + f.w - x0 + 2, -(x0 + ww - f.x + 2));
      const c = cands.filter((d) => Math.abs(d) <= lim && test({ x: x0 + d, y, w: ww, h: hh })).sort((m, n) => Math.abs(m) - Math.abs(n))[0];
      return c ?? null;
    };
    if (!ok(rect)) {
      const belowY = anchor.y + fs + 30;
      const right: Rect = { x: anchor.x + fs / 2 + 12, y: faceMid - h / 2, w, h };
      const left: Rect = { x: anchor.x - fs / 2 - 12 - w, y: faceMid - h / 2, w, h };
      const above = slideAt(top, w, h);
      const under = above === null ? slideAt(belowY, w, h) : null;
      if (above !== null) {
        bx = above;
        rect = { x: anchor.x - w / 2 + above, y: top, w, h };
      } else if (under !== null) {
        side = 'below';
        bx = under;
        rect = { x: anchor.x - w / 2 + under, y: belowY, w, h };
      } else if (ok(right)) {
        side = 'right';
        rect = right;
      } else if (ok(left)) {
        side = 'left';
        rect = left;
      } else if ((() => {
        // Beside the face, slid up or down (the tail stays on the face, at worst from the bubble's corner): clear of
        // the HUD at the top edge.
        const lim = h / 2 + Math.min(12, fs / 2);
        for (let k = 8; k <= lim; k += 8) {
          for (const d of [k, -k]) {
            for (const [sd, r] of [['right', right], ['left', left]] as const) {
              const c = { ...r, y: r.y + d };
              if (ok(c)) {
                side = sd;
                rect = c;
                sy = d;
                return true;
              }
            }
          }
        }
        return false;
      })()) {
        /* placed beside, shifted */
      } else {
        // Last resort: narrower, lifted above the group's top-most face (slid into the view if it has to).
        const hid = lifeUi.huddleOf(v.person.id);
        const group = hid ? (huddleMembers.get(hid) ?? []) : [v.person.id];
        let topMost = anchor.y;
        for (const id of group) {
          const o = views.get(id);
          if (o?.visible && Number.isFinite(o.sy)) topMost = Math.min(topMost, o.sy - faceSize(lod, cam.zoom, id === leadId) / 2 - 6);
        }
        const nw = Math.min(w, 200);
        const nh = Math.max(h, Math.round((h * w) / 200));
        const liftY = topMost - 8 - nh;
        const hudR = hudRects();
        const hard = cardR ? [...hudR, cardR] : hudR;
        const lifted = slideAt(liftY, nw, nh) ?? slideAt(liftY, nw, nh, (r) => inView(r) && !hitsAny(r, hard));
        if (lifted !== null) {
          narrow = true;
          by = topMost - anchor.y;
          bx = lifted;
          rect = { x: anchor.x - nw / 2 + lifted, y: liftY, w: nw, h: nh };
        } else {
          // At the edge of the view (someone at the north glass): never a clipped bubble, never under the HUD or the
          // card; the in-view place that covers the fewest faces, below first.
          const area = (r: Rect, f: Rect) => Math.max(0, Math.min(r.x + r.w, f.x + f.w) - Math.max(r.x, f.x)) * Math.max(0, Math.min(r.y + r.h, f.y + f.h) - Math.max(r.y, f.y));
          const cover = (r: Rect) => (hitsAny(r, hard) ? 1e9 : 0) + blocks.reduce((a, f) => a + area(r, f), 0);
          const inside = (r: Rect) => inView(r) && !hitsAny(r, hard);
          const opts: { side: NonNullable<Bubble['side']>; r: Rect; bx: number }[] = [];
          const ub = slideAt(belowY, w, h, inside);
          if (ub !== null) opts.push({ side: 'below', r: { x: anchor.x - w / 2 + ub, y: belowY, w, h }, bx: ub });
          if (inside(right)) opts.push({ side: 'right', r: right, bx: 0 });
          if (inside(left)) opts.push({ side: 'left', r: left, bx: 0 });
          const ua = slideAt(top, w, h, inside);
          if (ua !== null) opts.push({ side: 'above', r: { x: anchor.x - w / 2 + ua, y: top, w, h }, bx: ua });
          const best = opts.sort((m, n) => cover(m.r) - cover(n.r))[0];
          if (best) {
            side = best.side;
            rect = best.r;
            bx = best.bx;
          }
        }
      }
    }
    if (bx !== (b.bx ?? 0)) {
      b.bx = bx;
      if (bx) b.el.style.setProperty('--bx', `${bx.toFixed(1)}px`);
      else b.el.style.removeProperty('--bx');
    }
    if (by !== (b.by ?? 0)) {
      b.by = by;
      if (by) b.el.style.setProperty('--by', `${by.toFixed(1)}px`);
      else b.el.style.removeProperty('--by');
    }
    if (sy !== (b.sy ?? 0)) {
      b.sy = sy;
      if (sy) b.el.style.setProperty('--sy', `${sy.toFixed(1)}px`);
      else b.el.style.removeProperty('--sy');
    }
    if (side !== (b.side ?? 'above') || narrow !== !!b.narrow) {
      b.side = side;
      b.narrow = narrow;
      b.el.classList.toggle('is-below', side === 'below');
      b.el.classList.toggle('is-right', side === 'right');
      b.el.classList.toggle('is-left', side === 'left');
      b.el.classList.toggle('is-narrow', narrow);
    }
    return rect;
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
  /** The desk-mode camera from before the owner walked into a room: remembered for the Floor, and flown back to on leaving. */
  let deskCam: Camera | null = null;
  const saveCamera = () => {
    if (!cameraKey) return;
    // In a room, the Floor remembers the office view from before it (never the room's close-up).
    const c = mode === 'conference' && deskCam ? deskCam : cam;
    try {
      win.sessionStorage?.setItem(cameraKey, JSON.stringify({ x: c.x, y: c.y, zoom: c.zoom, w: vp.w, h: vp.h }));
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
    stopFollow();
    lifeUi.closeCard();
    lifeHooks?.onStage?.(true);
    for (const id of roomPeople.get(room.id) ?? []) {
      const v = views.get(id);
      if (v) stage.setPresence(id, v.speaking ? 'speaking' : v.state, v.label);
    }
    for (const id of speaking) if ((roomPeople.get(room.id) ?? []).includes(id)) stage.setSpeaking(id, true);
    manageFaces();
    reportViewport();
    // Keyboard users land on the first participant; otherwise the stage itself takes focus (no ring), so Esc, I and
    // C work at once. A picker opened meanwhile (I pressed as the stage appears) keeps its focus.
    later(() => {
      if (picker) return;
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
      lifeHooks?.onHold(id, true, 'hover');
      lifeUi?.hoverPerson(id);
      options.onHover?.(id, { phase: 'enter', via });
      options.onFocusChange?.(id);
    },
    onDwell: (id, via) => options.onHover?.(id, { phase: 'dwell', via }),
    onLeave: (id, via) => {
      if (hoveredId === id) hoveredId = null;
      views.get(id)?.btn.removeAttribute('data-hover');
      scheduleTiers();
      lifeHooks?.onHold(id, false, 'hover');
      lifeUi?.hoverPerson(null);
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
    return !!t?.closest?.('.hc-o-hud,.hc-o-stage,.hc-o-picker,.hc-o-bubble,.hc-o-skip,.hc-o-anchor,.hc-o-hcard,.hc-o-huddle');
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
    if (followingId) stopFollow();
    if (!(e.target as HTMLElement)?.closest?.('.hc-o-hcard,.hc-o-huddle')) lifeUi?.closeCard();
    const p = localPoint(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      cameraTouched = true;
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
    lifeHooks?.onHold(st.seatId, true, 'drag');
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
      lifeHooks?.onHold(id, false, 'drag');
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
        cameraTouched = true;
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
        // A tap is a click: they look up (the dwell) and the quick chat opens in place, in one gesture.
        if (st.touch) dwell.tap(st.seatId);
        options.onOpen?.(st.seatId, { via: 'click', mode, roomId });
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
    if ((e.target as HTMLElement)?.closest?.('.hc-o-menu,.hc-o-picker,.hc-o-stage,.hc-o-hcard')) return;
    e.preventDefault();
    stopMotion();
    if (followingId) stopFollow();
    const p = localPoint(e);
    cameraTouched = true;
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

  /**
   * The free part of the view (px): below the HUD row and clear of the host's insets, less a margin at each edge.
   * A focused person or huddle is framed inside it, never half under the HUD or at the viewport's edge.
   */
  const safeArea = () => {
    const mx = vp.w * EDGE_MARGIN;
    const my = vp.h * EDGE_MARGIN;
    return { left: mx + insets.left, right: vp.w - mx - insets.right, top: Math.max(my, HUD_BAND_PX + insets.top), bottom: vp.h - my - insets.bottom };
  };
  /** Is a projected point inside the safe area with this camera? */
  const inSafeArea = (p: Point, c: Camera = cam): boolean => {
    const a = safeArea();
    const sx = (p.x - c.x) * c.zoom + vp.w / 2;
    const sy = (p.y - c.y) * c.zoom + vp.h / 2;
    return sx >= a.left && sx <= a.right && sy >= a.top && sy <= a.bottom;
  };
  /** A camera at `zoom` that puts `p` at the centre of the safe area (below the HUD band). */
  const frameAt = (p: Point, zoom: number): Camera => {
    const a = safeArea();
    return { x: p.x - ((a.left + a.right) / 2 - vp.w / 2) / zoom, y: p.y - ((a.top + a.bottom) / 2 - vp.h / 2) / zoom, zoom };
  };
  /** The seat that focusSeat is flying to: its own focus event must not replace that flight with a nudge. */
  let flyingToSeat: string | null = null;

  const focusSeat = (id: string, opts: { animate?: boolean; zoom?: 'keep' | 'desk' } = {}) => {
    const v = views.get(id);
    if (!v) return;
    rovingId = id;
    updateRoving();
    const a = personAnchor(v);
    let target: Camera;
    if (opts.zoom === 'desk') target = frameAt(a, Math.max(cam.zoom, ZOOM_DESK));
    else target = followPoint(cam, a, vp);
    const animate = opts.animate !== false;
    flyTo(target, undefined, animate ? (opts.zoom === 'desk' ? FLIGHT_MS : 250) : 0);
    flyingToSeat = id;
    try {
      v.btn.focus({ preventScroll: true });
    } finally {
      flyingToSeat = null;
    }
  };

  const onFocusIn = (e: FocusEvent) => {
    const id = seatUnder(e);
    if (!id) return;
    focusedId = id;
    rovingId = id;
    updateRoving();
    const v = views.get(id)!;
    if (flyingToSeat !== id && (!v.visible || !inSafeArea(personAnchor(v)))) {
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
    lifeHooks?.onHold(id, true, 'focus');
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
    lifeHooks?.onHold(id, false, 'focus');
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
    // A header button keeps the keys it acts on (Enter, Space, arrows, Esc…); the office's letter shortcuts still work
    // from it (after picking an Ambience, H finds a huddle). Open menus, dialogs and lists keep every key.
    if (keyTarget === 'document' && e.target instanceof Node && !root.contains(e.target) && e.target !== doc.body && e.target !== doc.documentElement) {
      const t = e.target as HTMLElement;
      if (t.closest?.('[role=menu],[role=dialog],[role=listbox],[contenteditable]')) return;
      if (t.closest?.('button,a,[role=button],[role=radio],[role=tab]') && (e.key.length !== 1 || e.key === ' ')) return;
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
      f: () => {
        if (!focusedId) return;
        api.focus(focusedId, { animate: true, zoom: 'desk' });
        api.follow(focusedId);
      },
      h: () => nextHuddle(),
      Escape: () => {
        if (hud.closeMenus()) return;
        if (lifeUi?.closePopover()) return;
        if (followingId) {
          stopFollow();
          return;
        }
        if (lifeUi?.cardId()) {
          const id = lifeUi.cardId()!;
          if (lifeJoined.has(id)) lifeHooks?.onHuddleAction(id, 'leave');
          lifeUi.closeCard();
          return;
        }
        if (focusedId && bubbles.has(focusedId)) api.hideBubble(focusedId);
        else if (findIds) {
          findIds = null;
          applyFind();
        } else if (focusedId) (doc.activeElement as HTMLElement | null)?.blur();
      },
    };
    const fn = map[k.length === 1 ? k.toLowerCase() : k] ?? map[k];
    if (!fn) return;
    if (followingId && ['+', '=', '-', '_', '0', '[', ']', 'PageUp', 'PageDown', 'Home'].includes(k)) stopFollow();
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
  let lastPointer: Point | null = null;
  const wake = (e?: Event) => {
    if (e && e.type === 'pointermove') {
      const pe = e as PointerEvent;
      const p = { x: pe.clientX, y: pe.clientY };
      const small = lastPointer && Math.hypot(p.x - lastPointer.x, p.y - lastPointer.y) <= 3;
      lastPointer = p;
      if (small) return;
    }
    lastInput = clock();
    if (root.dataset.calm !== undefined) delete root.dataset.calm;
    if (!calmTimer) calmTimer = later(checkCalm, CALM_MS);
    // Any input stops an autopilot flight where it is (no snap back).
    if (apFlying) {
      apFlying = false;
      flight = null;
      apInterrupted = clock();
    }
  };
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const) root.addEventListener(type, wake as EventListener, { capture: true, passive: true });
  if (keyEl !== root) keyEl.addEventListener('keydown', wake as EventListener, { capture: true, passive: true });
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

  // ── office life: the layer, follow and autopilot ─────────────────────────────────────
  const huddleMembers = new Map<string, string[]>();
  const lifeJoined = new Set<string>();
  let lifeSummary: LifeSummary | null = null;
  const lifeUi: LifeUi = createLifeUi({
    doc,
    strings: S,
    root,
    hud: hud.el,
    before: peopleEl,
    firstName: (id) => firstName(views.get(id)?.person.name ?? id),
    accent: (id) => views.get(id)?.acc ?? '#888',
    onHuddleAction: (id, action, text) => {
      if (action === 'room') {
        // Open in a room: they walk to a table for a proper roundtable.
        const members = (huddleMembers.get(id) ?? []).slice();
        lifeHooks?.onHuddleAction(id, 'leave');
        lifeUi.closeCard();
        const free = plan.rooms.find((r) => !(roomPeople.get(r.id) ?? []).length) ?? plan.rooms[0];
        if (free) api.enterRoom(free.id, members);
        return;
      }
      if (action === 'open' || action === 'close') placeBubbles();
      lifeHooks?.onHuddleAction(id, action, text);
    },
    onPause: (p) => {
      lifeHooks?.onPauseToggle(p);
      options.onLifePause?.(p);
    },
    onAutopilot: (on) => api.setAutopilot(on),
    onMoment: (m, then) => {
      flyTo({ x: m.at.x, y: m.at.y, zoom: Math.max(cam.zoom, Math.min(AUTOPILOT.maxZoom, m.zoom)) }, undefined, FLIGHT_MS);
      const id = m.personIds[0];
      if (then === 'follow' && id) later(() => api.follow(id), FLIGHT_MS + 20);
      // A raised hand: talk to them (the host opens its quick chat, as a click on their face would).
      if (then === 'talk' && id) later(() => options.onOpen?.(id, { via: 'click', mode, roomId }), FLIGHT_MS + 20);
    },
    onFollowStop: () => stopFollow(),
    onOffer: (accept) => {
      storeAp('offer', 'done');
      lifeUi.offerWander(false);
      if (accept) api.setAutopilot(true);
    },
    onCardHold: (members, held) => {
      for (const id of members) lifeHooks?.onHold(id, held, 'hover');
    },
    reducedMotion,
  });
  const nextHuddle = () => {
    const id = lifeUi.nextHuddle((hid) => {
      const members = huddleMembers.get(hid) ?? [];
      return members.some((m) => api.visibility(m) > 0);
    });
    if (!id) return;
    const members = (huddleMembers.get(id) ?? []).map((m) => views.get(m)).filter((v): v is PView => !!v);
    // Bring the whole huddle into the free part of the view (not only when it is off-screen): its ring and card are
    // never half under the HUD or cut by an edge.
    if (members.length && !members.every((v) => inSafeArea(personAnchor(v)))) {
      const c = members.reduce((a, v) => ({ x: a.x + v.x / members.length, y: a.y + v.y / members.length }), { x: 0, y: 0 });
      flyTo(frameAt({ x: c.x, y: Y(c.y, 11) }, Math.max(cam.zoom, ZOOM_NEIGHBOURHOOD)), undefined, FLIGHT_MS);
    }
  };

  // Follow: a critically damped spring keeps the person inside a 25 % inset, at L1 or closer.
  /** Keep a following camera over the floor (no void beside or below the plate when the plate is larger than the view). */
  const overFloor = (c: Camera): Camera => {
    const hw = vp.w / 2 / c.zoom;
    const hh = vp.h / 2 / c.zoom;
    let { x, y } = c;
    if (box.w > 2 * hw) x = Math.min(box.x + box.w - hw, Math.max(box.x + hw, x));
    if (box.h > 2 * hh) y = Math.min(box.y + box.h - hh, y);
    return clampCamera({ x, y, zoom: c.zoom }, box, vp);
  };
  let followingId: string | null = null;
  let followVel = { x: 0, y: 0 };
  let followLast = 0;
  const stopFollow = () => {
    if (!followingId) return;
    followingId = null;
    lifeUi.setFollow(null);
    lifeHooks?.onFollow?.(null);
    options.onFollowChange?.(null);
  };
  const stepFollow = (t: number): boolean => {
    if (!followingId) return false;
    const v = views.get(followingId);
    if (!v || mode !== 'desks') {
      stopFollow();
      return false;
    }
    if (flight) {
      followLast = t;
      return true;
    }
    const a = personAnchor(v);
    const target = overFloor({ ...followTarget(cam, a, vp.w / 2 / cam.zoom, vp.h / 2 / cam.zoom, 0.25), zoom: cam.zoom });
    const dt = followLast ? Math.min(0.05, Math.max(0.001, (t - followLast) / 1000)) : 1 / 60;
    followLast = t;
    if (reducedMotion()) {
      // Reduced motion: the camera jumps when the person leaves the inset.
      if (Math.hypot(target.x - cam.x, target.y - cam.y) > 0.01) cam = clampCamera({ x: target.x, y: target.y, zoom: cam.zoom }, box, vp);
      return false;
    }
    const [x, vx] = springStep(cam.x, followVel.x, target.x, dt);
    const [y, vy] = springStep(cam.y, followVel.y, target.y, dt);
    cam = clampCamera({ x, y, zoom: cam.zoom }, box, vp);
    followVel = { x: vx, y: vy };
    const settling = Math.hypot(target.x - cam.x, target.y - cam.y) > 0.05 || Math.hypot(vx, vy) > 0.05;
    return settling || !!v.lwalk || !!v.walk;
  };

  // Autopilot: optional, off by default, stored per viewer; flies to the top moment after 20 s without input.
  const apKey = options.autopilotKey === undefined ? 'hc.office.autopilot' : options.autopilotKey;
  const readAp = (suffix = ''): string | null => {
    if (!apKey) return null;
    try {
      return win.localStorage?.getItem(apKey + (suffix ? `.${suffix}` : '')) ?? null;
    } catch {
      return null;
    }
  };
  const storeAp = (suffix: string, value: string) => {
    if (!apKey) return;
    try {
      win.localStorage?.setItem(apKey + (suffix ? `.${suffix}` : ''), value);
    } catch {
      /* storage unavailable */
    }
  };
  let autopilot = options.autopilot ?? readAp() === 'on';
  let apFlying = false;
  let apFlights: number[] = [];
  let apHoldUntil = 0;
  let apInterrupted: number | null = null;
  let offered: Moment | null = null;
  let apTimer: ReturnType<typeof setTimeout> | null = null;
  let passiveCounted = false;
  const apBlocked = () =>
    reducedMotion() || mode !== 'desks' || stage.isOpen || !!picker || !!followingId || doc.visibilityState === 'hidden' || isTyping(doc.activeElement) || lifeJoined.size > 0 || !!lifeUi.cardId();
  const apCheck = () => {
    apTimer = null;
    if (destroyed) return;
    const now = clock();
    // The one-time offer: after a minute of passive watching on two separate visits.
    if (!autopilot && !passiveCounted && lifeSummary && now - lastInput >= 60_000) {
      passiveCounted = true;
      const visits = Number(readAp('visits') ?? '0') + 1;
      storeAp('visits', String(visits));
      if (visits >= 2 && readAp('offer') !== 'done' && !reducedMotion()) lifeUi.offerWander(true);
    }
    if (autopilot && offered && !apBlocked() && autopilotDue({ lastInput, flights: apFlights, holdUntil: apHoldUntil, interruptedAt: apInterrupted }, now)) {
      const m = offered;
      const target = { x: m.at.x, y: m.at.y, zoom: Math.max(2.6, Math.min(AUTOPILOT.maxZoom, m.zoom)) };
      const far = Math.hypot(target.x - cam.x, target.y - cam.y) * cam.zoom > vp.w * AUTOPILOT.farViewports;
      apFlying = true;
      apFlights = [...apFlights.filter((t) => now - t < 60_000), now];
      apHoldUntil = now + AUTOPILOT.flightMs + holdFor(m, Date.now());
      const land = () => {
        apFlying = false;
      };
      lifeHooks?.onMomentShown?.(m);
      if (far) {
        // Two phases: out toward the floor, then in.
        const mid = { x: (cam.x + target.x) / 2, y: (cam.y + target.y) / 2, zoom: Math.max(minZoom, Math.min(cam.zoom, target.zoom) / 2.2) };
        flyTo(mid, () => apFlying && flyTo(target, land, AUTOPILOT.flightMs * 0.6), AUTOPILOT.flightMs * 0.5);
      } else flyTo(target, land, AUTOPILOT.flightMs);
    }
    // Opt-in autopilot polls every 2 s; otherwise one timer waits for the next minute of calm (the one-time offer).
    if (autopilot) apTimer = setTimeout(apCheck, 2000);
    else if (!passiveCounted && lifeSummary && doc.visibilityState !== 'hidden') apTimer = setTimeout(apCheck, Math.max(2000, lastInput + 60_000 - now + 50));
  };
  const startAp = () => {
    if (!apTimer && !destroyed) apTimer = setTimeout(apCheck, 2000);
  };

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
      lifeHooks?.onReplan?.();
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
      lifeHooks?.onPresence?.(id, v.state, v.badges, v.speaking);
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
      lifeHooks?.onPresence?.(id, v.state, v.badges, v.speaking);
    },
    showBubble(id, text, opts = {}) {
      if (destroyed) return;
      const v = known(id);
      if (!v) return;
      let b = bubbles.get(id);
      if (b?.talk) {
        removeBubble(id);
        b = undefined;
      }
      if (!b) {
        const el = mk('div', 'hc-o-bubble', bubblesEl);
        el.style.setProperty('--acc', v.acc);
        el.setAttribute('role', 'note');
        b = { id, el, timer: null, expires: 0, at: clock() };
        bubbles.set(id, b);
        lifeHooks?.onHold(id, true, 'bubble');
        if (!reducedMotion()) {
          el.classList.add('is-entering');
          void el.offsetWidth;
          el.classList.remove('is-entering');
        }
      }
      b.passive = !!opts.passive;
      b.el.classList.toggle('hc-o-bubble--passive', b.passive);
      b.w = undefined;
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
      capTalk();
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
      else lifeHooks?.onHold(id, true, 'anchor');
      placeBubbles();
      let released = false;
      return {
        el,
        release() {
          if (released) return;
          released = true;
          anchors.delete(rec);
          el.remove();
          if (views.has(id)) lifeHooks?.onHold(id, false, 'anchor');
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
      if (mode === 'desks') deskCam = flight ? flight.to : cam;
      picker?.close();
      hud.closeMenus();
      stopFollow();
      dwell.clear();
      for (const id of [...bubbles.keys()]) removeBubble(id);
      for (const id of [...chips.keys()]) removeChip(id);
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
      const wasOpen = stage.isOpen;
      stage.close(!reducedMotion());
      setModeState('desks', null);
      if (wasOpen) lifeHooks?.onStage?.(false);
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
      // Step back out to the office view from before the room (never left on the room's close-up).
      const back = deskCam;
      deskCam = null;
      if (back) flyTo(back, undefined, reducedMotion() ? 0 : FLIGHT_MS);
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
    setInsets(next) {
      if (destroyed) return;
      insets = normInsets(next);
      applyInsets();
      placeBubbles();
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
        followingId,
        autopilot,
        lifePaused: !!lifeSummary?.paused,
        huddles: [...huddleMembers].map(([id, members]) => ({ id, members: members.slice() })),
        huddleCard: lifeUi.cardId(),
      };
    },
    nameOf(id) {
      return views.get(id)?.person.name ?? id;
    },

    // ── office life: the director drives the scene only through these ──
    getPlan() {
      return plan;
    },
    spots() {
      return spotsCache;
    },
    moveTo(id, to, opts) {
      return lifeMove(id, to, opts);
    },
    placeOf(id) {
      const v = views.get(id);
      if (!v) return { place: { kind: 'desk' }, x: 0, y: 0, walking: false };
      if (v.lwalk && !v.lwalk.fade) {
        const p = pointAtDistance(v.lwalk.profile, distanceAt(v.lwalk.profile, (clock() - v.lwalk.start) / 1000));
        return { place: { kind: 'point', x: p.x, y: p.y }, x: p.x, y: p.y, walking: true };
      }
      if (v.roomId) return { place: { kind: 'room', roomId: v.roomId, seat: v.roomSeat }, x: v.x, y: v.y, walking: !!v.walk };
      return { place: v.place, x: v.x, y: v.y, walking: !!v.walk || !!v.lwalk };
    },
    face(id, toward, opts) {
      const v = views.get(id);
      if (!v || destroyed) return;
      // At a desk people keep facing their screen; elsewhere their body turns (plan view).
      if (v.place.kind !== 'desk' || v.lwalk) turnToward(v, toward, v.bodyFacing ?? v.facing);
      if (opts?.lean !== undefined) {
        v.lean = reducedMotion() ? 0 : opts.lean;
        if (v.lean) v.btn.style.setProperty('--lean', `${v.lean}deg`);
        else v.btn.style.removeProperty('--lean');
      }
    },
    cue(id, gesture: Cue) {
      const v = views.get(id);
      if (!v || destroyed) return;
      if (v.slot?.cue) {
        v.slot.cue(gesture);
        return;
      }
      // Off-screen or at plan zoom a face cue shows nothing: skip it (no style work for faces nobody sees).
      if (reducedMotion() || !v.visible || lod === 0) return;
      // Restart the animation without forcing a layout: clear it now, set it on the next frame.
      delete v.btn.dataset.cue;
      const seq = (v.cueSeq = (v.cueSeq ?? 0) + 1);
      const set = () => {
        if (destroyed || v.cueSeq !== seq) return;
        v.btn.dataset.cue = gesture;
        later(() => {
          if (v.cueSeq === seq && v.btn.dataset.cue === gesture) delete v.btn.dataset.cue;
        }, 950);
      };
      const raf = win.requestAnimationFrame?.bind(win);
      if (raf) raf(set);
      else later(set, 16);
    },
    say(id, text, opts) {
      if (destroyed || mode !== 'desks') return;
      const v = views.get(id);
      if (!v) return;
      if (opts.nonverbal) {
        // A laugh is a caption chip beside the face (no name, no tail, ≤ 1.2 s), never a speech bubble.
        removeChip(id);
        const el = mk('div', 'hc-o-chip', bubblesEl);
        el.setAttribute('aria-hidden', 'true');
        const inner = mk('span', 'hc-o-chip__in', el);
        inner.textContent = text;
        const c: Chip = { id, el, timer: null };
        chips.set(id, c);
        if (!reducedMotion()) {
          el.classList.add('is-entering');
          void el.offsetWidth;
          el.classList.remove('is-entering');
        }
        c.timer = setTimeout(() => removeChip(id), Math.min(1200, opts.ttlMs));
        placeBubbles();
        return;
      }
      const prev = bubbles.get(id);
      // Owner-facing and passing-by bubbles are never replaced by small talk.
      if (prev && !prev.talk) return;
      if (prev) removeBubble(id);
      const el = mk('div', `hc-o-bubble hc-o-bubble--talk${opts.nonverbal ? ' is-nonverbal' : ''}`, bubblesEl);
      el.style.setProperty('--acc', v.acc);
      el.setAttribute('aria-hidden', 'true');
      const b: Bubble = { id, el, timer: null, expires: 0, talk: opts.huddleId, at: clock() };
      bubbles.set(id, b);
      if (!reducedMotion()) {
        el.classList.add('is-entering');
        void el.offsetWidth;
        el.classList.remove('is-entering');
      }
      const inner = mk('div', 'hc-o-bubble__in', el);
      const who = mk('b', 'hc-o-bubble__who', inner);
      who.textContent = firstName(v.person.name);
      const t = mk('span', 'hc-o-bubble__text', inner);
      t.textContent = text;
      v.btn.dataset.talking = '';
      armBubble(b, opts.ttlMs);
      capTalk();
      placeBubbles();
      scheduleTiers();
    },
    unsay(id) {
      const b = bubbles.get(id);
      if (b?.talk) removeBubble(id);
      removeChip(id);
    },
    trimBubbles(ids, maxMs) {
      for (const id of ids) {
        const b = bubbles.get(id);
        if (b && !b.talk && b.expires - clock() > maxMs) armBubble(b, maxMs);
      }
    },
    frameOpening(p) {
      // Only the default opening view that nobody has moved: a restored camera or any input wins.
      if (destroyed || !openedOnDefault || cameraTouched || mode !== 'desks') return;
      const zoom = narrow() ? cam.zoom : clampZoom(ZOOM_NEIGHBOURHOOD, minZoom);
      const at = { x: p.x, y: Y(p.y, 6) };
      let next: Camera;
      if (narrow()) {
        // Phones: the target at 40 % of the height, and at most a fifth of a portrait screen of sky above the floor.
        next = { x: at.x, y: at.y + (vp.h * 0.1) / zoom, zoom };
        if (vp.h > vp.w) next.y = Math.max(next.y, Y(0) + (vp.h * (0.5 - PHONE_SKY_MAX)) / zoom);
      } else next = frameAt(at, zoom);
      cam = clampCamera(next, box, vp);
      lod = lodFor(cam.zoom);
      root.dataset.lod = String(lod);
      settledZoom = cam.zoom;
      render();
      settle();
    },
    visibility(id) {
      const v = views.get(id);
      if (!v || destroyed || mode !== 'desks') return 0;
      const a = personAnchor(v);
      const sx = (a.x - cam.x) * cam.zoom + vp.w / 2;
      const sy = (a.y - cam.y) * cam.zoom + vp.h / 2;
      return sx >= 0 && sx <= vp.w && sy >= 0 && sy <= vp.h ? ((lod + 1) as 1 | 2 | 3) : 0;
    },
    visibilityAt(p) {
      if (destroyed || mode !== 'desks') return 0;
      const sx = (p.x - cam.x) * cam.zoom + vp.w / 2;
      const sy = (Y(p.y, 11) - cam.y) * cam.zoom + vp.h / 2;
      return sx >= 0 && sx <= vp.w && sy >= 0 && sy <= vp.h ? ((lod + 1) as 1 | 2 | 3) : 0;
    },
    showHuddle(h: ShowHuddleArgs) {
      if (destroyed) return;
      const prev = huddleMembers.get(h.id) ?? [];
      huddleMembers.set(h.id, h.members.slice());
      if (h.joined) lifeJoined.add(h.id);
      else lifeJoined.delete(h.id);
      lifeUi.showHuddle(h);
      if (prev.length !== h.members.length || prev.some((m, i) => m !== h.members[i])) {
        for (const id of new Set([...prev, ...h.members])) {
          const v = views.get(id);
          if (v) applyPresence(v);
        }
      }
      if (!raf) render();
    },
    hideHuddle(id) {
      const members = huddleMembers.get(id) ?? [];
      huddleMembers.delete(id);
      lifeJoined.delete(id);
      lifeUi.hideHuddle(id);
      for (const m of members) {
        const v = views.get(m);
        if (v) applyPresence(v);
      }
    },
    setLifeSummary(sum) {
      lifeSummary = sum;
      lifeUi.setSummary(sum);
      lifeUi.setPaused(!!sum?.paused);
      if (sum) startAp();
    },
    follow(id) {
      if (destroyed) return;
      if (!id) {
        stopFollow();
        return;
      }
      const v = views.get(id);
      if (!v || mode !== 'desks') return;
      followingId = id;
      followVel = { x: 0, y: 0 };
      followLast = 0;
      lifeUi.setFollow(firstName(v.person.name));
      // They keep going: the camera follows a walker, it does not hold them (life drops their hover and focus holds).
      lifeHooks?.onFollow?.(id);
      options.onFollowChange?.(id);
      if (cam.zoom < ZOOM_NEIGHBOURHOOD * 0.75) {
        const a = personAnchor(v);
        flyTo(overFloor({ x: a.x, y: a.y, zoom: ZOOM_NEIGHBOURHOOD }), undefined, FLIGHT_MS);
      } else requestFrame();
    },
    setAutopilot(on) {
      if (destroyed) return;
      const next = on && !reducedMotion();
      if (next === autopilot) {
        lifeUi.setAutopilot(autopilot);
        return;
      }
      autopilot = next;
      storeAp('', next ? 'on' : 'off');
      apInterrupted = null;
      lifeUi.setAutopilot(next);
      options.onAutopilotChange?.(next);
      if (next) startAp();
    },
    offerMoment(m) {
      offered = m;
    },
    attachLife(hooks) {
      lifeHooks = hooks;
      // Replay what the scene already knows: presence and room seating.
      for (const v of views.values()) {
        if (v.state !== 'idle' || v.speaking || v.badges.length) hooks.onPresence?.(v.person.id, v.state, v.badges, v.speaking);
        if (v.roomId) hooks.onRoom?.(v.person.id, v.roomId);
      }
      if (stage.isOpen) hooks.onStage?.(true);
      return () => {
        if (lifeHooks === hooks) lifeHooks = null;
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
      for (const c of chips.values()) if (c.timer) clearTimeout(c.timer);
      chips.clear();
      anchors.clear();
      dwell.destroy();
      picker?.close();
      if (lifeWake) clearTimeout(lifeWake);
      if (apTimer) clearTimeout(apTimer);
      for (const v of views.values()) {
        const w = v.lwalk;
        v.lwalk = null;
        w?.resolve(false);
      }
      lifeUi.destroy();
      lifeHooks = null;
      ro?.disconnect();
      win.removeEventListener?.('resize', onResize);
      if (keyEl !== root) {
        keyEl.removeEventListener('keydown', onKeyDown as EventListener);
        keyEl.removeEventListener('keydown', wake as EventListener, { capture: true });
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
  applyInsets();
  const initial = options.initialCamera;
  if (initial && initial !== 'fit') {
    cam = clampCamera({ ...initial, zoom: clampZoom(initial.zoom, minZoom) }, box, vp);
    openedOnDefault = false;
  } else if (!initial) {
    const restored = restoreCamera();
    cam = restored ? clampCamera({ ...restored, zoom: clampZoom(restored.zoom, minZoom) }, box, vp) : openCamera();
    // The last camera the owner used wins over life's opening frame.
    openedOnDefault = !restored;
  } else cam = openCamera();
  wake();
  lod = lodFor(cam.zoom);
  root.dataset.lod = String(lod);
  settledZoom = cam.zoom;
  render();
  settle();
  scheduleClock();
  lifeUi.setAutopilot(autopilot);
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

