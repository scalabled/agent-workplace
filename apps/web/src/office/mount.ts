// The Office in the app: one imperative mount that wires @headcount/office to the app's state.
// The scene first (faces, presence, desk mode), then office life once the personalities arrive (or after a short
// wait, on neutral ones), small talk from the living runtime's huddle packs, listen-in and Join, the Chief's real
// work, the camera and life switches in ⌘K, and the room stage (C's binding) when it is loaded.
//
// The first impression is the point (the owner's words: "feel familiar and meaningful … delightful"): the office stays
// veiled for the moment life takes to place everyone and frame the liveliest neighbourhood at L1, then fades in with
// the water-cooler crew already talking. Nobody sees people jump from their desks or the camera jump from the plan.
import { computed, effect, signal, type ReadonlySignal } from '@preact/signals';
import type { CatalogIndex, CatalogSlim } from '@headcount/catalog';
import {
  createOfficeLife,
  createOfficeScene,
  DEFAULT_STRINGS,
  type FaceFactory,
  type LifeState,
  type OfficeInsets,
  type OfficeLife,
  type OfficeMode,
  type OfficeScene,
  type TimeOfDay,
} from '@headcount/office';
import { CHIEF_ID, coworkerAgentId, ownerFirstNameOf, personaIdFromAgentId } from '@headcount/protocol';
import { ambienceOf } from '@headcount/protocol/ext/expressions';
import type { OfficePersonDto } from '@headcount/protocol/ext/rooms';
import { chiefName as chiefNameSig, currentLead } from '../chief';
import { leadSubject, personaSubject, type FaceSubject } from '../components/Face';
import { openReply, replyingAgent } from '../components/FloorBubble';
import type { PaletteItem } from '../components/Palette';
import { accentFor } from '../lib/accent';
import { portraitFor, saveLandmarks } from '../lib/portraits';
import { resolvedTheme } from '../lib/theme';
import { living, livingCue, livingHover } from '../living';
import { bubbles, logCaption, showCaption } from '../living/captions';
import { jobDoneSeqs } from '../living/events';
import { registerFace } from '../living/faces';
import type { LivingRuntime } from '../living/types';
import { activeDesk } from '../living/useDesk';
import { officeStage } from '../living/viewer';
import { chiefPresence, jobs, liveMeetings, localPresence, presence, projectList, settings, teamIds, teamWork } from '../store';
import { showNotice } from '../ui/notice';
import { audio } from '../voice/engine';
import { claimUnsettled, mayVoice } from '../voice/owner';
import type { PttTarget } from '../voice/ptt';
import { officeClock } from './clock';
import { createFaceFactory } from './faces';
import { huddleRender, officePeople } from './fetch';
import { groundingEvents } from './grounding';
import { createHuddleLines, type HuddlePersonInfo } from './huddles';
import { createJoin, type JoinDeps } from './join';
import { createListen } from './listen';
import { firstOf, lifePeopleOf, officeRoster, podsOf } from './people';
import { bindPresence } from './presence';
import { clearDeepLink, floorView, readDeepLink } from './view';

/** Life starts on neutral personalities if the roster has not arrived by then (it replans when it does). */
export const LIFE_START_CAP_MS = 1000;
/** The veil lifts at the latest this long after mounting, placed or not. */
export const VEIL_CAP_MS = 1600;
/** … and at the latest this long after life placed the opening (normally the first summary lifts it sooner). */
export const REVEAL_AFTER_PLACED_MS = 400;
/** Hover lines for someone away from their desk: about being available, never a work status. */
export const AVAILABILITY_TTL_MS = (text: string) => Math.min(9000, 4000 + 60 * text.length);
export const CAMERA_KEY = 'hc.office.camera';

/** C's stage binding (room/stage.ts), typed structurally so the office runs before it lands. */
export interface StageBindingLike {
  onEnterRoom(roomId: string, participants: string[]): void;
  onInvite(roomId: string, ids: string[], info: { via: 'picker' | 'drag' | 'keyboard' }): void | boolean;
  onLeaveRoom(roomId: string, participants: string[]): void;
  onModeChange(mode: OfficeMode, roomId: string | null): void;
  onOpenInRoom(personId: string): void;
  meeting(): { roomId: string; meetingId: string; participants: readonly string[] } | null;
  destroy(): void;
}
export type BindStage = (host: { scene: OfficeScene; nameOf(agentId: string): string }) => StageBindingLike;

export interface OfficeMountOptions {
  host: HTMLElement;
  catalog: CatalogIndex<CatalogSlim>;
  onRequestDirectory(): void;
  /** The office is placed and framed (or the veil's cap passed): show it. */
  onReady?(): void;
  /** C's stage binding (room/stage.ts): the conference stage's session, dock and captions. */
  bindStage?: BindStage;
  /** C's room session (joined huddles). */
  openSession?: JoinDeps['openSession'];
  /** C's push-to-talk target. */
  setPttTarget?: (t: PttTarget) => () => void;
  /** C's ⌘K registry. */
  registerPaletteItems?: (provide: () => PaletteItem[]) => () => void;
  search?: string;
  dev?: boolean;
  /** Tests: faces without canvases. */
  faceFactory?: FaceFactory;
  /** Tests: plan synchronously. */
  planIn?: 'idle' | 'sync';
  /** Tests: the office's own asset base (null: the vector skyline). */
  assetsBase?: string | null;
}

export interface OfficeMount {
  readonly scene: OfficeScene;
  readonly life: ReadonlySignal<OfficeLife | null>;
  /** Who the pointer or focus rests on (FloorBubble's `hovered`). */
  readonly hovered: ReadonlySignal<string | null>;
  readonly mode: ReadonlySignal<OfficeMode>;
  /** The office is placed and framed. */
  readonly ready: ReadonlySignal<boolean>;
  /** The joined huddle, if any. */
  joinedHuddle(): string | null;
  nameOf(agentId: string): string;
  destroy(): void;
}

const TEXT_ENTRY = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/**
 * Passing by someone: in a huddle the scene shows the huddle's card (nothing here); away from
 * their desk (a break, a visit, a walk) a dwell gets an availability line, never a work status and never voiced; at
 * their desk the living runtime's passing-by (a true line in their voice, in the tab with the voice).
 */
export function hoverRoute(state: LifeState | undefined, phase: 'enter' | 'dwell'): 'none' | 'availability' | 'living' {
  if (state === 'huddle') return 'none';
  if (state === 'break' || state === 'visit' || state === 'walking') return phase === 'dwell' ? 'availability' : 'none';
  return 'living';
}

/** A rest on someone that got no line (the Floor's gaps and cooldowns) shows their name card after this long. */
export const NAME_CARD_AFTER_MS = 700;
export const NAME_CARD_TTL_MS = 4000;

/** "Product ops · at her desk": who they are and where, never something they said (a rest always shows something). */
export function nameCardText(title: string, pronouns: string | null | undefined, atDesk: boolean): string {
  const poss = pronouns?.startsWith('she') ? 'her' : pronouns?.startsWith('he') ? 'his' : 'their';
  return atDesk ? `${title} · at ${poss} desk` : title;
}

/** The availability line for someone today (seeded, so it holds for the day). */
export function availabilityLine(agentId: string, day: Date): string {
  const pool = DEFAULT_STRINGS.life.availability;
  return pool[hash(`${agentId}|${dayKey(day)}`) % pool.length]!;
}

/** The office's insets for the app's Chief bubble in the bottom-right corner (phones: the smaller bubble). */
export function chiefBubbleInsets(): OfficeInsets {
  let phone = false;
  try {
    phone = typeof matchMedia === 'function' && matchMedia('(max-width: 767px)').matches;
  } catch {
    phone = false;
  }
  return phone ? { right: 72, bottom: 72 } : { right: 88, bottom: 88 };
}

function cameraRestored(): boolean {
  try {
    return !!sessionStorage.getItem(CAMERA_KEY);
  } catch {
    return false;
  }
}

export function mountOffice(o: OfficeMountOptions): OfficeMount {
  const c = o.catalog;
  const search = o.search ?? (typeof location === 'undefined' ? '' : location.search);
  const deep = readDeepLink(search);
  const clock = officeClock(search, o.dev ?? import.meta.env.DEV);
  const disposers: (() => void)[] = [];
  let destroyed = false;
  const lifeSig = signal<OfficeLife | null>(null);
  const hovered = signal<string | null>(null);
  const mode = signal<OfficeMode>('desks');
  const ready = signal(false);
  const autopilot = signal(false);
  const paused = signal(false);
  const sky = signal<TimeOfDay | 'auto'>('auto');
  let stage: StageBindingLike | null = null;

  // ── people ──
  let roster = officeRoster(c, currentLead.peek(), chiefNameSig.peek(), podsOf(projectList.peek()), teamIds.peek() ?? []);
  let chiefKey = `${currentLead.peek()?.id ?? ''}|${chiefNameSig.peek()}`;
  const personOf = new Map(roster.people.map((p) => [p.id, p]));
  const dtoOf = new Map<string, OfficePersonDto>();
  const nameOf = (id: string) => personOf.get(id)?.name ?? id;
  const subjectFor = (id: string): FaceSubject | null => {
    if (id === CHIEF_ID) {
      const lead = currentLead.peek();
      return lead ? leadSubject(lead, chiefNameSig.peek()) : null;
    }
    const p = c.persona(personaIdFromAgentId(id) ?? '');
    return p ? personaSubject(p) : null;
  };

  const faceFactory =
    o.faceFactory ??
    createFaceFactory({
      subjectFor,
      accentFor: (hex) => accentFor(hex, resolvedTheme.peek()),
      sampler: (id) => {
        try {
          return audio().sampler(id);
        } catch {
          return null;
        }
      },
      portraitFor,
      saveLandmarks,
      registerFace,
    });

  // ── the scene ──
  const restored = cameraRestored();
  const scene: OfficeScene = createOfficeScene(o.host, {
    people: roster.people,
    groups: roster.groups,
    leadId: CHIEF_ID,
    theme: resolvedTheme.peek(),
    accentFor: (hex, theme) => accentFor(hex, theme),
    faceFactory,
    keyTarget: 'document',
    timeOfDay: 'auto',
    reducedMotion: null,
    now: clock,
    insets: chiefBubbleInsets(),
    ...(o.assetsBase !== undefined ? { assetsBase: o.assetsBase } : {}),
    onHover(id, info) {
      if (info.phase === 'enter') hovered.value = id;
      const route = hoverRoute(lifeSig.peek()?.whereIs(id).state, info.phase);
      if (route === 'availability') availability(id);
      else if (route === 'living') {
        livingHover(id, info.phase, info.via);
        if (info.phase === 'dwell') nameCardLater(id);
      }
    },
    onHoverEnd(id, info) {
      if (hovered.peek() === id) hovered.value = null;
      cancelNameCard();
      livingHover(id, 'leave', info.via);
    },
    onOpen(id, info) {
      if (info.mode === 'conference') stage?.onOpenInRoom(id);
      else openReply(id);
    },
    onFocusChange(id) {
      activeDesk.value = id;
    },
    onEnterRoom: (r, ids) => stage?.onEnterRoom(r, ids),
    onInvite: (r, ids, info) => stage?.onInvite(r, ids, info),
    onLeaveRoom: (r, ids) => stage?.onLeaveRoom(r, ids),
    onModeChange(m, r) {
      mode.value = m;
      officeStage.value = { mode: m, roomId: r };
      stage?.onModeChange(m, r);
    },
    onRequestDirectory: () => o.onRequestDirectory(),
    onAutopilotChange: (on) => (autopilot.value = on),
    onLifePause: (p) => (paused.value = p),
  });
  officeStage.value = { mode: 'desks', roomId: null };
  autopilot.value = scene.getState().autopilot;

  // A deliberate rest always shows something: when the Floor's gaps and cooldowns hold back a hello (most rests in a
  // busy office), a quiet name card with their role and where they are, and Chat. Never voiced, never "said".
  let nameCard: ReturnType<typeof setTimeout> | undefined;
  const cancelNameCard = () => {
    clearTimeout(nameCard);
    nameCard = undefined;
  };
  const nameCardLater = (id: string) => {
    cancelNameCard();
    nameCard = setTimeout(() => {
      nameCard = undefined;
      if (destroyed || hovered.peek() !== id || mode.peek() !== 'desks' || bubbles.peek()[id]) return;
      const p = personOf.get(id);
      if (!p) return;
      const pronouns = id === CHIEF_ID ? currentLead.peek()?.pronouns : c.persona(personaIdFromAgentId(id) ?? '')?.pronouns;
      const where = lifeSig.peek()?.whereIs(id);
      const atDesk = !where || (where.place.kind === 'desk' && where.state !== 'walking');
      showCaption({ agentId: id, text: nameCardText(p.title, pronouns, atDesk), kind: 'bubble', replyable: true, ttlMs: NAME_CARD_TTL_MS, card: true });
    }, NAME_CARD_AFTER_MS);
  };
  disposers.push(cancelNameCard);

  const availability = (id: string) => {
    const text = availabilityLine(id, clock());
    showCaption({ agentId: id, text, kind: 'bubble', replyable: true, ttlMs: AVAILABILITY_TTL_MS(text), intent: 'passing_by' });
    livingCue(id, { gesture: 'look_up', holdMs: 1200 });
  };

  // ── the veil: lifted when life has placed everyone and framed the view, or at the cap ──
  const reveal = () => {
    if (ready.peek() || destroyed) return;
    ready.value = true;
    o.onReady?.();
  };
  const veilCap = setTimeout(reveal, VEIL_CAP_MS);
  disposers.push(() => clearTimeout(veilCap));

  // ── small talk, listen-in, join ──
  const rt = (): LivingRuntime | null => living.peek();
  const personInfo = (id: string): HuddlePersonInfo | null => {
    const p = personOf.get(id);
    if (!p) return null;
    const d = dtoOf.get(id);
    return {
      firstName: firstOf(p.name),
      groupId: p.groupId,
      isChief: id === CHIEF_ID,
      teamRoles: d?.teamRoles ?? [],
      pairsWellWith: d?.pairsWellWith ?? [],
      tensionWith: d?.tensionWith ?? [],
      profile: d?.profile ?? null,
    };
  };
  let grounding: { key: unknown; value: { events: ReturnType<typeof groundingEvents> } } | null = null;
  const huddles = createHuddleLines({
    living: rt,
    person: personInfo,
    chiefName: () => chiefNameSig.peek() || null,
    grounding: () => {
      const j = jobs.peek();
      if (grounding?.key !== j) grounding = { key: j, value: { events: groundingEvents({ jobs: j, seqs: jobDoneSeqs, workspaceId: settings.peek()?.workspaceId, now: clock().getTime() }) } };
      return grounding.value;
    },
    storage: (() => {
      try {
        return localStorage;
      } catch {
        return null;
      }
    })(),
  });
  const listen = createListen({
    living: rt,
    mayVoice,
    claimUnsettled,
    voiceOn: () => settings.peek()?.voiceOn ?? false,
    ambience: () => ambienceOf(settings.peek()),
    engine: () => {
      try {
        return audio();
      } catch {
        return null;
      }
    },
    pickOf: (x) => huddles.pickOf(x),
    render: (req, signal) => huddleRender(req, signal),
  });
  const join = o.openSession
    ? createJoin({
        life: () => lifeSig.peek(),
        living: rt,
        openSession: o.openSession,
        setPttTarget: o.setPttTarget ?? (() => () => undefined),
        firstName: (id) => firstOf(nameOf(id)),
        ownerFirstName: () => ownerFirstNameOf(settings.peek()),
        warmth: (id) => dtoOf.get(id)?.profile.personality.sliders.warmth ?? null,
        showBubble: (id, text, opts) => scene.showBubble(id, text, opts),
        notice: (text) => showNotice(text, 'error'),
        seed: settings.peek()?.workspaceId ?? 'office',
      })
    : null;

  // ── office life ──
  let placed = false;
  const startLife = () => {
    if (lifeSig.peek() || destroyed) return;
    const s = settings.peek();
    lifeSig.value = createOfficeLife(scene, {
      people: lifePeopleOf(roster.people, [...dtoOf.values()]),
      seed: s?.workspaceId ?? 'office',
      ambience: ambienceOf(s),
      reducedMotion: null,
      leadId: CHIEF_ID,
      now: clock,
      planIn: o.planIn ?? 'idle',
      frameOpening: !restored && !deep.focus && !deep.room,
      lines: (req) => huddles.lines(req),
      onHuddleLine(h, e) {
        if (e.visible || e.glyph) huddles.shown(e.exchangeId, clock().getTime());
        const l = e.line;
        if (l.kind === 'line' && l.text) {
          const others = h.members.filter((m) => m !== l.personId).map((m) => firstOf(nameOf(m)));
          logCaption({ agentId: l.personId, text: `${firstOf(nameOf(l.personId))} → ${others.join(', ')} · ${h.label}: ${l.text}`, kind: 'smalltalk' });
        } else if (l.kind === 'laugh') logCaption({ agentId: l.personId, text: `${firstOf(nameOf(l.personId))} laughs`, kind: 'smalltalk' });
        if (e.listening) void listen.line(h, e);
      },
      onJoinHuddle: (h) => join?.onJoin(h),
      onLeaveHuddle: (h) => join?.onLeave(h),
      // A joined huddle life ends by itself (dispersed, replanned at the day's turn) closes like a leave: push-to-talk
      // goes back to the Chief and the meeting leaves its note.
      onHuddleEnd: (h) => join?.onEnd(h),
      onTalkToHuddle: (h, text) => join?.onTalk(h, text),
      onHuddleToRoom: (h) => join?.onToRoom(h),
      onListenIn: (h, info) => {
        listen.setListening(h);
        // The huddle had nothing more to say: Listening ends with one quiet line, not silence.
        if (!h && info?.reason === 'quiet') showNotice("They've gone quiet.", 'info', 3500);
      },
      onPauseChange: (p) => (paused.value = p),
      // The veil lifts with the first count of the floor (the pill is right from the first frame), soon after the
      // opening is placed.
      onSummary() {
        if (placed) reveal();
      },
      onOpened() {
        placed = true;
        huddles.warm();
        // Run the director once right away: it counts the floor (the first summary lifts the veil).
        const now = setTimeout(() => lifeSig.peek()?.tick(), 0);
        const cap = setTimeout(reveal, REVEAL_AFTER_PLACED_MS);
        disposers.push(() => {
          clearTimeout(now);
          clearTimeout(cap);
        });
      },
    });
  };
  const peopleKey = `${settings.peek()?.leadId ?? ''}|${chiefNameSig.peek()}`;
  void officePeople(peopleKey).then((r) => {
    if (destroyed) return;
    for (const d of r?.people ?? []) dtoOf.set(d.agentId, d);
    const life = lifeSig.peek();
    if (life) {
      if (r) life.setPeople(lifePeopleOf(roster.people, [...dtoOf.values()]));
    } else startLife();
  });
  const lifeCap = setTimeout(startLife, LIFE_START_CAP_MS);
  disposers.push(() => clearTimeout(lifeCap));

  // ── real state ──
  disposers.push(
    bindPresence({
      scene,
      life: lifeSig,
      presence,
      localPresence,
      jobs,
      teamWork,
      chiefState: computed(() => chiefPresence.value.state),
      meetings: computed(() => liveMeetings.value.map((m) => ({ meetingId: m.meetingId, agentIds: [CHIEF_ID, ...(m.people ?? [m.chairId]).map((id) => `cw_${id}`)] }))),
      gatherSpots: () => scene.spots(),
      replying: replyingAgent,
      ids: () => roster.people.map((p) => p.id),
      onSpeakingChange: (cb) => {
        try {
          return audio().onSpeakingChange(cb);
        } catch {
          return () => undefined;
        }
      },
      speakingNow: () => {
        try {
          return audio().speaking();
        } catch {
          return [];
        }
      },
    }),
  );

  // ── settings: theme, Ambience, a new lead or name ──
  disposers.push(effect(() => scene.setTheme(resolvedTheme.value)));
  disposers.push(
    effect(() => {
      const a = ambienceOf(settings.value);
      lifeSig.value?.setAmbience(a);
    }),
  );
  disposers.push(
    effect(() => {
      // Inc 1: a team project under way seats its people together in a pod; they go back when it ends. Hiring adds desks.
      const next = officeRoster(c, currentLead.value, chiefNameSig.value, podsOf(projectList.value), teamIds.value ?? []);
      if (next.key === roster.key) return;
      const newChief = `${currentLead.peek()?.id ?? ''}|${chiefNameSig.peek()}` !== chiefKey;
      chiefKey = `${currentLead.peek()?.id ?? ''}|${chiefNameSig.peek()}`;
      roster = next;
      personOf.clear();
      for (const p of roster.people) personOf.set(p.id, p);
      scene.setPeople(roster.people, roster.groups, CHIEF_ID);
      lifeSig.peek()?.setPeople(lifePeopleOf(roster.people, [...dtoOf.values()]));
      if (!newChief) return;
      // A new Chief of Staff has a new profile: fetch the roster again.
      void officePeople(`${settings.peek()?.leadId ?? ''}|${chiefNameSig.peek()}`).then((r) => {
        if (destroyed || !r) return;
        for (const d of r.people) dtoOf.set(d.agentId, d);
        lifeSig.peek()?.setPeople(lifePeopleOf(roster.people, [...dtoOf.values()]));
      });
    }),
  );
  if (typeof matchMedia === 'function') {
    try {
      const mq = matchMedia('(max-width: 767px)');
      const onChange = () => scene.setInsets(chiefBubbleInsets());
      mq.addEventListener('change', onChange);
      disposers.push(() => mq.removeEventListener('change', onChange));
    } catch {
      /* no media queries */
    }
  }

  // ── host keys: L listens in to the open huddle card (R lives in the Floor route) ──
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'l' && e.key !== 'L') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
    if (e.target instanceof Element && e.target.closest(TEXT_ENTRY)) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    const life = lifeSig.peek();
    const card = scene.getState().huddleCard;
    if (!life || !card) return;
    e.preventDefault();
    life.listenIn(life.getState().listening === card ? null : card);
  };
  document.addEventListener('keydown', onKey);
  disposers.push(() => document.removeEventListener('keydown', onKey));
  const onHide = () => huddles.flush();
  window.addEventListener('pagehide', onHide);
  disposers.push(() => window.removeEventListener('pagehide', onHide));

  // ── ⌘K: the camera, life and the sky, while the Office is on screen ──
  if (o.registerPaletteItems) {
    disposers.push(
      o.registerPaletteItems(() => {
        const items: PaletteItem[] = [
          autopilot.value
            ? { id: 'office-camera-still', label: 'Office: keep the camera still', group: 'Office', icon: 'floor', keywords: 'autopilot camera', run: () => scene.setAutopilot(false) }
            : { id: 'office-camera-wander', label: 'Office: let the camera wander', group: 'Office', icon: 'floor', keywords: 'autopilot camera', run: () => scene.setAutopilot(true) },
          paused.value
            ? { id: 'office-life-resume', label: 'Resume office life', group: 'Office', icon: 'play', keywords: 'office life', run: () => lifeSig.peek()?.resume() }
            : { id: 'office-life-pause', label: 'Pause office life', group: 'Office', icon: 'stop', keywords: 'office life still', run: () => lifeSig.peek()?.pause() },
        ];
        for (const t of ['auto', 'night', 'dusk', 'day'] as const) {
          items.push({
            id: `office-sky-${t}`,
            label: `Office sky: ${t[0]!.toUpperCase()}${t.slice(1)}`,
            ...(sky.value === t ? { hint: 'Now' } : {}),
            group: 'Office',
            icon: t === 'day' ? 'sun' : 'moon',
            keywords: 'time of day skyline',
            run: () => {
              sky.value = t;
              scene.setTimeOfDay(t);
            },
          });
        }
        return items;
      }),
    );
  }

  // ── the stage (C), then the deep links ──
  if (o.bindStage) {
    try {
      stage = o.bindStage({ scene, nameOf });
    } catch (err) {
      console.warn('office stage unavailable:', err);
      stage = null;
    }
  }
  if (deep.room) scene.enterRoom(deep.room);
  else if (deep.focus && c.persona(deep.focus)) scene.focus(coworkerAgentId(deep.focus), { zoom: 'desk' });
  if (deep.room || deep.focus) clearDeepLink();

  // ── dev hook ──
  if (o.dev ?? import.meta.env.DEV) {
    const w = window as unknown as { __headcount?: Record<string, unknown> };
    // `life` is the running OfficeLife (null until it starts), `view()` the Floor's view.
    const hook = {
      scene,
      get life() {
        return lifeSig.peek();
      },
      view: () => floorView.peek(),
      stage: () => stage?.meeting() ?? null,
      huddles,
      ready: () => ready.peek(),
    };
    w.__headcount = { ...(w.__headcount ?? {}), office: hook };
    disposers.push(() => {
      const h = w.__headcount;
      if (h && 'office' in h) delete h.office;
    });
  }

  return {
    scene,
    life: lifeSig,
    hovered,
    mode,
    ready,
    joinedHuddle: () => join?.current() ?? null,
    nameOf,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // Keys and effects off → stage → life → scene.
      for (const d of disposers.splice(0)) {
        try {
          d();
        } catch (err) {
          console.warn('office teardown:', err);
        }
      }
      join?.destroy();
      listen.destroy();
      huddles.destroy();
      try {
        stage?.destroy();
      } catch (err) {
        console.warn('office stage teardown:', err);
      }
      stage = null;
      lifeSig.peek()?.destroy();
      lifeSig.value = null;
      scene.destroy();
      officeStage.value = null;
      if (activeDesk.peek() && personOf.has(activeDesk.peek()!)) activeDesk.value = null;
    },
  };
}
