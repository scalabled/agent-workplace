// The standalone Office demo: the real catalog (164 coworkers + the Chief of Staff), catalog-backed portraits from
// the owner's worker through the dev proxy (read-only GETs), and a small panel to drive time of day, bubbles and a
// conference room. Office life runs by default: people take breaks, huddle and chat.
// URL params: tod=auto|night|dusk|day, theme=dark|light, panel=0, faces=portraits|initials, portraits=proxy|direct,
// rm=1, seed=<n>, keys=document|scene, life=0 (off), amb=quiet|lively|buzzing, at=HH:MM (the demo clock),
// day=YYYY-MM-DD, speed=<n> (a demo-only accelerated clock), lines=sample (skip the huddle engine), owner=<name>, work=<0–1>,
// lifeseed=<workspace id>, autopilot=1, nudge=0, frame=0 (keep the fit view at open), recency=0 (forget huddle recency).
import slim from '../../catalog/generated/slim.js';
import { createOfficeLife, createOfficeScene } from '../src/index';
import type { Ambience, FaceFactory, OfficeGroup, OfficeLife, OfficeLifePerson, OfficePerson, OfficeScene, PresenceState, TimeOfDay } from '../src/index';
import { mulberry32 } from '../src/rng';
import { DEFAULT_STRINGS } from '../src/strings';
import { loadHuddleEngine } from './huddle-lines';
import type { DemoPersonality, HuddleEngine } from './huddle-lines';
import { sampleLines } from './sample-lines';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const LEAD_ID = params.get('lead') ?? 'lead-steady-operator';
const lead = slim.leads.find((l) => l.id === LEAD_ID) ?? slim.leads[0]!;
const OWNER = params.get('owner') ?? 'Dana';

const people: OfficePerson[] = [
  { id: lead.id, name: lead.name, title: 'Chief of Staff', groupId: 'chief', accent: lead.avatar.accent_color, seniority: 'principal' },
  ...slim.personas.map((p) => ({ id: p.id, name: p.name, title: p.title, groupId: p.department, accent: p.avatar.accent_color, seniority: p.seniority })),
];
const groups: OfficeGroup[] = slim.departments.map((d) => ({ id: d.id, name: d.name, kind: 'department' as const }));
const byId = new Map(people.map((p) => [p.id, p]));

// ── the demo clock (office life plans on the owner's local time; ?at and ?speed are demo-only) ──
const speed = Math.max(0.1, Math.min(20, Number(params.get('speed') ?? 1) || 1));
const t0 = Date.now();
let clockBase = t0;
const at = params.get('at');
const dayParam = params.get('day');
if ((at && /^\d{1,2}:\d{2}$/.test(at)) || (dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam))) {
  const d = new Date();
  if (dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)) {
    const [y, mo, da] = dayParam.split('-').map(Number) as [number, number, number];
    d.setFullYear(y, mo - 1, da);
  }
  if (at && /^\d{1,2}:\d{2}$/.test(at)) {
    const [h, m] = at.split(':').map(Number) as [number, number];
    d.setHours(h, m, 0, 0);
  }
  clockBase = d.getTime();
}
const demoNow = () => new Date(clockBase + (Date.now() - t0) * speed);
const demoTimers = { set: (fn: () => void, ms: number) => setTimeout(fn, ms / speed), clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };

// Portraits: GET /api/portraits lists which faces have an image (and their version, for cacheable URLs).
const portraitBase = params.get('portraits') === 'direct' ? 'http://localhost:8787' : '';
const versions = new Map<string, string>();
async function loadPortraits(): Promise<void> {
  if (params.get('faces') === 'initials') return;
  try {
    const res = await fetch(`${portraitBase}/api/portraits`);
    if (!res.ok) return;
    const body = (await res.json()) as { portraits: { personaId: string; version: string }[] };
    for (const p of body.portraits) versions.set(p.personaId, p.version);
  } catch {
    /* the worker is not running: initials */
  }
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i, a) => (i === 0 || i === a.length - 1 ? w[0] : ''))
    .join('')
    .toUpperCase();

/** A demo face: the catalog portrait as a still token (the app passes FaceView here). */
const faceFactory: FaceFactory = (personId, tier) => {
  const p = byId.get(personId);
  const el = document.createElement('div');
  el.className = 'demo-face';
  el.dataset.tier = tier;
  el.style.setProperty('--acc', p?.accent ?? '#888');
  const v = versions.get(personId);
  if (v) {
    const img = new Image();
    img.decoding = 'async';
    img.alt = '';
    img.draggable = false;
    img.src = `${portraitBase}/api/portraits/${encodeURIComponent(personId)}?v=${encodeURIComponent(v)}`;
    img.onerror = () => {
      el.innerHTML = `<span class="ini">${initials(p?.name ?? '?')}</span>`;
    };
    el.append(img);
  } else {
    el.innerHTML = `<span class="ini">${initials(p?.name ?? '?')}</span>`;
  }
  return {
    el,
    setTier(t) {
      el.dataset.tier = t;
    },
    setState(s) {
      el.dataset.state = s;
    },
    destroy() {
      el.remove();
    },
  };
};

// Passing-by lines (LIVING-WORKFORCE §8): short, verb-first, about their own work.
const LINES = [
  'Tightening the onboarding checklist for Monday.',
  'Pulling last quarter’s numbers into one sheet.',
  'Reading the three supplier quotes side by side.',
  'Drafting two subject lines to test tomorrow.',
  'Checking the returns policy against the new law.',
  'Sketching the launch timeline on the whiteboard.',
  'Rewriting the pricing page so it reads plainly.',
  'Waiting on one number from finance, then done.',
  'Cleaning up the tags in the help centre.',
  'Mapping where customers drop off at checkout.',
];

let scene: OfficeScene;
let life: OfficeLife | null = null;
let engine: HuddleEngine | null = null;
const log = (s: string) => {
  const el = document.getElementById('log');
  if (el) el.textContent = s;
};
const firstOf = (id: string) => (byId.get(id)?.name ?? id).split(/\s+/)[0]!;

function seedPresence(seed: number): void {
  const r = mulberry32(seed);
  // With office life on, fewer people are mid-job, so the idle ones (who take the breaks) are the majority.
  const work = Number(params.get('work') ?? (params.get('life') === '0' ? 0.34 : 0.18));
  for (const p of people) {
    const x = r();
    let state: PresenceState = 'idle';
    let label = '';
    if (x < work) {
      state = 'working';
      label = LINES[Math.floor(r() * LINES.length)]!.replace(/\.$/, '');
    } else if (x < work + 0.06) {
      state = 'thinking';
      label = 'Thinking it through';
    }
    const badges: ('lamp' | 'hand')[] = [];
    if (r() < 0.09) badges.push('lamp');
    if (p.id !== lead.id && r() < 0.012) state = 'raised_hand';
    scene.setPresence(p.id, state, { label, badges });
  }
  scene.setPresence(lead.id, 'working', { label: 'Looking into supplier prices', badges: ['lamp'] });
}

function pickPeople(n: number, seed: number): string[] {
  const r = mulberry32(seed);
  const pool = slim.personas.map((p) => p.id);
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]!);
  return out;
}

const timers: ReturnType<typeof setTimeout>[] = [];
function roundtable(): void {
  const st = scene.getState();
  if (st.mode !== 'conference' || !st.participants.length) return;
  for (const t of timers.splice(0)) clearTimeout(t);
  const order = st.participants.slice(0, 3);
  // Honest room lines: opinions and questions from expertise, never a figure, a result or a
  // promise of work. The app's rooms pass the same reply guard; nobody should copy a line that claims otherwise.
  const lines = [
    'I’d lead with sell-through, not brand love.',
    'Show me the reorder rate before we decide.',
    'If returns are the worry, I’d fix the sizing guide first.',
  ];
  scene.setFloorQueue(order);
  let t = 0;
  order.forEach((id, i) => {
    timers.push(setTimeout(() => {
      scene.setPresence(id, 'thinking');
    }, t));
    t += 700;
    timers.push(setTimeout(() => {
      scene.setPresence(id, 'idle');
      scene.setSpeaking(id, true);
      scene.showCaption(id, lines[i % lines.length]!, { voiced: false });
      scene.setFloorQueue(order.slice(i + 1));
    }, t));
    t += 3200;
    timers.push(setTimeout(() => scene.setSpeaking(id, false), t));
  });
  timers.push(setTimeout(() => scene.showCaption(null, ''), t + 400));
}

/** Personality for office life from the full catalog (loaded lazily; the demo still runs without it). */
async function loadPersonalities(): Promise<DemoPersonality[]> {
  try {
    const mods = import.meta.glob('../../catalog/generated/full.js', { import: 'default' });
    const loadFull = Object.values(mods)[0];
    if (!loadFull) return [];
    type P = { id: string; name: string; department: string; seniority?: string; personality: { sliders: Record<string, number>; traits: string[] }; team_roles?: string[]; pairs_well_with?: string[]; productive_tension_with?: { persona_id: string }[]; voice?: { openai?: { voice?: string }; xai?: { voice?: string }; speed?: number; openai_tts?: string; xai_tts?: string } };
    const full = (await loadFull()) as { personas: P[]; leads: (P & { personality: P['personality'] })[] };
    const l = full.leads.find((x) => x.id === lead.id);
    const out: DemoPersonality[] = full.personas.map((p) => ({
      id: p.id,
      personaId: p.id,
      name: p.name,
      department: p.department,
      isChief: false,
      sliders: p.personality?.sliders ?? {},
      traits: p.personality?.traits ?? [],
      roles: p.team_roles ?? [],
      ...(p.seniority ? { seniority: p.seniority } : {}),
      pairsWellWith: p.pairs_well_with ?? [],
      tensionWith: (p.productive_tension_with ?? []).map((t) => t.persona_id),
      voice: { openai: p.voice?.openai?.voice, xai: p.voice?.xai?.voice, speed: p.voice?.speed },
    }));
    if (l) {
      out.push({
        id: l.id,
        personaId: l.id,
        name: l.name,
        department: 'chief',
        isChief: true,
        sliders: (l.personality as { sliders?: Record<string, number> }).sliders ?? {},
        traits: (l.personality as { traits?: string[] }).traits ?? [],
        roles: [],
        pairsWellWith: [],
        tensionWith: [],
        voice: { openai: l.voice?.openai_tts, xai: l.voice?.xai_tts, speed: l.voice?.speed },
      });
    }
    return out;
  } catch (err) {
    console.warn('[office demo] personality unavailable', err);
    return [];
  }
}

async function main(): Promise<void> {
  await loadPortraits();
  const tod = (params.get('tod') ?? 'auto') as TimeOfDay | 'auto';
  const host = $('office');
  document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';
  const lifeOn = params.get('life') !== '0';
  scene = createOfficeScene(host, {
    people,
    groups,
    leadId: lead.id,
    theme: params.get('theme') === 'light' ? 'light' : 'dark',
    timeOfDay: tod,
    faceFactory: params.get('faces') === 'initials' ? undefined : faceFactory,
    assetsBase: params.get('art') === '0' ? null : '/office/',
    reducedMotion: params.get('rm') === '1' ? true : null,
    initialCamera: 'fit',
    cameraKey: null,
    now: demoNow,
    autopilot: params.get('autopilot') === '1',
    autopilotKey: null,
    // The harness stands in for the Floor route with the Office as the active view (Phase 2): keys work from the
    // whole page. ?keys=scene tests the default, where they work once focus is in the office.
    keyTarget: params.get('keys') === 'scene' ? 'scene' : 'document',
    onHover(id, info) {
      if (info.phase === 'dwell' && ($('hover') as HTMLInputElement).checked) {
        // People in a huddle show the huddle card instead of a passing-by line.
        if (scene.getState().huddles.some((h) => h.members.includes(id))) return;
        const p = byId.get(id);
        const hash = Math.abs([...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
        // Honesty: someone on a break, in a huddle or walking is available, never "working on" something.
        const where = life?.whereIs(id).state;
        const onBreak = where === 'break' || where === 'huddle' || where === 'walking' || where === 'visit';
        const pool = DEFAULT_STRINGS.life.availability;
        const line = onBreak ? pool[hash % pool.length]! : LINES[hash % LINES.length]!;
        scene.showBubble(id, id === lead.id && !onBreak ? 'Looking into supplier prices. Ask me anything meanwhile.' : line);
        log(`${p?.name}: passing by (${info.via}${onBreak ? ', on a break' : ''})`);
      }
    },
    onOpen(id, info) {
      log(`Open ${byId.get(id)?.name} (${info.via}, ${info.mode})`);
      scene.showBubble(id, 'What do you need? (quick chat opens here in the app)', { ttlMs: 3500 });
    },
    onEnterRoom(roomId, ids) {
      log(`Entered ${roomId} with ${ids.length}`);
    },
    onInvite(roomId, ids, info) {
      log(`Invited ${ids.length} to ${roomId} (${info.via})`);
    },
    onLeaveRoom(roomId) {
      log(`Left ${roomId}`);
    },
    onTalkToRoom(roomId, text) {
      scene.showCaption(null, text);
      setTimeout(roundtable, 900);
      log(`To ${roomId}: ${text}`);
    },
    onRequestDirectory() {
      log('The host would switch to the Directory here.');
    },
    onFollowChange(id) {
      log(id ? `Following ${byId.get(id)?.name}` : 'Stopped following');
    },
    onAutopilotChange(on) {
      $('autopilot').setAttribute('aria-pressed', String(on));
    },
  });
  seedPresence(Number(params.get('seed') ?? 7));
  (window as unknown as { office: OfficeScene }).office = scene;

  const ambience = (['quiet', 'lively', 'buzzing'].includes(params.get('amb') ?? '') ? params.get('amb') : 'lively') as Ambience;
  const captions: string[] = [];
  const startLife = (personalities: DemoPersonality[]) => {
    const pBy = new Map(personalities.map((p) => [p.id, p]));
    const lifePeople: OfficeLifePerson[] = people.map((p) => {
      const q = pBy.get(p.id);
      if (!q) return { id: p.id };
      return {
        id: p.id,
        sliders: q.sliders,
        traits: q.traits,
        teamRoles: q.roles,
        pairsWellWith: q.pairsWellWith,
        tensionWith: q.tensionWith,
        ...(engine?.blendOf(p.id) ? { blend: engine.blendOf(p.id)! } : {}),
      };
    });
    life = createOfficeLife(scene, {
      people: lifePeople,
      seed: params.get('lifeseed') ?? 'ws_demo',
      now: demoNow,
      timers: demoTimers,
      ambience,
      reducedMotion: params.get('rm') === '1' ? true : null,
      leadId: lead.id,
      ...(params.get('nudge') === '0' ? { nudge: false } : {}),
      ...(params.get('frame') === '0' ? { frameOpening: false } : {}),
      lines: (req) => (engine ? engine.lines(req) : sampleLines(req)),
      onHuddleLine(h, e) {
        if (e.visible || e.glyph) engine?.shown(e.exchangeId, demoNow().getTime());
        if (!e.line.text) return;
        captions.push(`${firstOf(e.line.personId)} · ${h.label}: ${e.line.text}`);
        if (captions.length > 3) captions.shift();
        const el = document.getElementById('captions');
        if (el) el.textContent = captions.join('\n');
      },
      onJoinHuddle(h) {
        // The Phase 2 host plays the greeting intent; the demo says a canned hello, by name.
        const greeter = h.members[0];
        if (greeter) setTimeout(() => life?.reply(greeter, `Oh, hi ${OWNER}!`), 350);
        log(`Joined ${h.label} with ${h.members.map(firstOf).join(', ')}`);
      },
      onTalkToHuddle(h, text) {
        // Phase 2 posts to the huddle room endpoint; the demo answers with a canned line.
        const who = h.members[1] ?? h.members[0];
        log(`To the huddle: ${text}`);
        if (who) setTimeout(() => life?.reply(who, 'Good question. Want to take it to a room?'), 900);
      },
      onLeaveHuddle(h) {
        const who = h.members[h.members.length - 1];
        if (who) scene.showBubble(who, 'Catch you later.', { ttlMs: 2400, passive: true });
      },
      onListenIn(h) {
        $('listen').setAttribute('aria-pressed', String(!!h));
        log(h ? `Listening in to ${h.label} (captions only in the demo)` : 'Stopped listening');
      },
      onSummary(s) {
        const el = document.getElementById('summary');
        if (el) el.textContent = `${demoNow().toTimeString().slice(0, 5)} · ${s.huddles} huddles · ${s.away} away · ${s.walking} walking${s.paused ? ' · paused' : ''}`;
      },
      onPauseChange(p) {
        $('pause').setAttribute('aria-pressed', String(p));
      },
    });
    (window as unknown as { life: OfficeLife }).life = life;
    document.documentElement.dataset.life = '1';
  };
  /** Compile the huddle engine in idle steps while the first plan is made (the first line would compile it anyway). */
  const warmEngine = () => {
    const idle = (window as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const step = () => {
      if (engine && !engine.warm()) (idle ? idle(step, { timeout: 400 }) : setTimeout(step, 0));
    };
    if (idle) idle(step, { timeout: 400 });
    else setTimeout(step, 0);
  };
  if (lifeOn) {
    if (params.get('recency') === '0') {
      try {
        localStorage.removeItem('hc.expr.huddles.v1');
      } catch {
        /* storage unavailable */
      }
    }
    const personalities = await loadPersonalities();
    if (params.get('lines') !== 'sample') engine = await loadHuddleEngine(personalities, lead.name.split(/\s+/)[0]!);
    $('lines').textContent = engine ? `Small talk: ${engine.exchanges} exchanges from ${engine.source}` : 'Small talk: built-in sample';
    startLife(personalities);
    warmEngine();
  }
  (window as unknown as { demo: unknown }).demo = { pickPeople, roundtable, seedPresence, people, lead, demoNow, engine: () => engine };

  // Host keys (the scene leaves L and R to the host): L listens in to the open huddle card, R focuses its field.
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === 'l' || e.key === 'L') && life) {
      const card = scene.getState().huddleCard;
      life.listenIn(life.getState().listening === card ? null : card);
    } else if ((e.key === 'r' || e.key === 'R') && document.querySelector('.hc-o-hcard__input')) {
      e.preventDefault();
      (document.querySelector('.hc-o-hcard__input') as HTMLInputElement).focus();
    }
  });

  // Panel.
  const panel = $('demo');
  panel.hidden = params.get('panel') === '0';
  $('hide').addEventListener('click', () => (panel.hidden = true));
  const todRow = $('tod');
  for (const t of ['auto', 'night', 'dusk', 'day'] as const) {
    const b = document.createElement('button');
    b.className = 'b';
    b.type = 'button';
    b.textContent = t[0]!.toUpperCase() + t.slice(1);
    b.setAttribute('aria-pressed', String(t === tod));
    b.addEventListener('click', () => {
      scene.setTimeOfDay(t);
      todRow.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    todRow.append(b);
  }
  const ambRow = $('amb');
  for (const a of ['quiet', 'lively', 'buzzing'] as const) {
    const b = document.createElement('button');
    b.className = 'b';
    b.type = 'button';
    b.textContent = a[0]!.toUpperCase() + a.slice(1);
    b.setAttribute('aria-pressed', String(a === ambience));
    b.addEventListener('click', () => {
      life?.setAmbience(a);
      ambRow.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    ambRow.append(b);
  }
  const someone = (pred: (id: string) => boolean) => {
    const st = scene.getState();
    if (st.focusedId && pred(st.focusedId)) return st.focusedId;
    const inView = people.map((p) => p.id).filter((id) => scene.visibility(id) > 0 && pred(id));
    return inView[Math.floor(Math.random() * inView.length)] ?? null;
  };
  const awayOrIdle = (id: string) => life?.whereIs(id).kind !== 'desk';
  $('pause').addEventListener('click', () => {
    if (!life) return;
    if (life.getState().paused) life.resume();
    else life.pause();
  });
  $('autopilot').addEventListener('click', () => scene.setAutopilot(!scene.getState().autopilot));
  $('follow').addEventListener('click', () => {
    const id = someone((x) => life?.whereIs(x).kind === 'walking') ?? someone(awayOrIdle);
    if (id) scene.follow(id);
  });
  $('listen').addEventListener('click', () => {
    if (!life) return;
    const h = life.huddles()[0];
    life.listenIn(life.getState().listening ? null : (h?.id ?? null));
  });
  $('join').addEventListener('click', () => {
    if (!life) return;
    const h = life.huddles().find((x) => scene.visibility(x.members[0]!) > 0) ?? life.huddles()[0];
    if (!h) return log('No huddle right now.');
    scene.focus(h.members[0]!, { zoom: 'keep' });
    life.join(h.id);
  });
  $('work').addEventListener('click', () => {
    const id = someone(awayOrIdle);
    if (!id) return;
    scene.setPresence(id, 'working', { label: 'Drafting the launch note' });
    log(`${byId.get(id)?.name} starts real work: back to the desk`);
  });
  $('research').addEventListener('click', () => {
    const id = someone(() => true);
    if (!id || !life) return;
    life.setActivity(id, 'research');
    scene.setPresence(id, 'working', { label: 'Researching supplier prices' });
    log(`${byId.get(id)?.name} researches: to the library`);
  });
  $('hand').addEventListener('click', () => {
    const id = someone(awayOrIdle);
    if (!id) return;
    scene.setPresence(id, 'raised_hand', { label: 'Needs a decision from you' });
    log(`${byId.get(id)?.name} raises a hand: back to the desk`);
  });
  $('idle').addEventListener('click', () => {
    for (const p of people) if (p.id !== lead.id) scene.setPresence(p.id, 'idle');
    for (const p of people) life?.setActivity(p.id, null);
    log('Everyone idle (available)');
  });
  $('meet').addEventListener('click', () => scene.enterRoom('skyline', pickPeople(5, 11)));
  $('garden').addEventListener('click', () => scene.enterRoom('garden', pickPeople(3, 23)));
  $('round').addEventListener('click', roundtable);
  $('leave').addEventListener('click', () => scene.leaveRoom());
  $('bubble').addEventListener('click', () => {
    const st = scene.getState();
    const id = st.focusedId ?? pickPeople(1, Date.now() % 1000)[0]!;
    scene.focus(id, { zoom: 'desk' });
    setTimeout(() => scene.showBubble(id, LINES[Date.now() % LINES.length]!), 650);
  });
  $('handoff').addEventListener('click', () => {
    const [a, b] = pickPeople(2, Date.now() % 997);
    scene.showBubble(a!, 'Sending you the draft now.', { to: b! });
  });
  $('shuffle').addEventListener('click', () => seedPresence(Date.now() % 10000));
  ($('light') as HTMLInputElement).checked = params.get('theme') === 'light';
  $('light').addEventListener('change', (e) => {
    const t = (e.target as HTMLInputElement).checked ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    scene.setTheme(t);
  });
  ($('rm') as HTMLInputElement).checked = params.get('rm') === '1';
  $('rm').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked ? true : null;
    scene.setReducedMotion(on);
    life?.setReducedMotion(on);
  });
  document.documentElement.dataset.ready = '1';
}

void main();
