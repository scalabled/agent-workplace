// The standalone Office demo: the real catalog (164 coworkers + the Chief of Staff), catalog-backed portraits from
// the owner's worker through the dev proxy (read-only GETs), and a small panel to drive time of day, bubbles and a
// conference room. URL params: tod=auto|night|dusk|day, theme=dark|light, panel=0, faces=portraits|initials,
// portraits=proxy|direct, rm=1, seed=<n>, keys=document|scene.
import slim from '../../catalog/generated/slim.js';
import { createOfficeScene } from '../src/index';
import type { FaceFactory, OfficeGroup, OfficePerson, OfficeScene, PresenceState, TimeOfDay } from '../src/index';
import { mulberry32 } from '../src/rng';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const LEAD_ID = params.get('lead') ?? 'lead-steady-operator';
const lead = slim.leads.find((l) => l.id === LEAD_ID) ?? slim.leads[0]!;

const people: OfficePerson[] = [
  { id: lead.id, name: lead.name, title: 'Chief of Staff', groupId: 'chief', accent: lead.avatar.accent_color, seniority: 'principal' },
  ...slim.personas.map((p) => ({ id: p.id, name: p.name, title: p.title, groupId: p.department, accent: p.avatar.accent_color, seniority: p.seniority })),
];
const groups: OfficeGroup[] = slim.departments.map((d) => ({ id: d.id, name: d.name, kind: 'department' as const }));
const byId = new Map(people.map((p) => [p.id, p]));

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
const log = (s: string) => {
  const el = document.getElementById('log');
  if (el) el.textContent = s;
};

function seedPresence(seed: number): void {
  const r = mulberry32(seed);
  for (const p of people) {
    const x = r();
    let state: PresenceState = 'idle';
    let label = '';
    if (x < 0.34) {
      state = 'working';
      label = LINES[Math.floor(r() * LINES.length)]!.replace(/\.$/, '');
    } else if (x < 0.44) {
      state = 'thinking';
      label = 'Thinking it through';
    }
    const badges: ('lamp' | 'hand')[] = [];
    if (r() < 0.09) badges.push('lamp');
    if (p.id !== lead.id && r() < 0.018) state = 'raised_hand';
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
  const lines = [
    'Brand love doesn’t move their Q2 number. Show me sell-through.',
    'Then lead with the reorder rate: it went up nine points after the relaunch.',
    'I can have the one-pager with both numbers by tomorrow noon.',
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

async function main(): Promise<void> {
  await loadPortraits();
  const tod = (params.get('tod') ?? 'auto') as TimeOfDay | 'auto';
  const host = $('office');
  document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';
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
    // The harness stands in for the Floor route with the Office as the active view (Phase 2): keys work from the
    // whole page. ?keys=scene tests the default, where they work once focus is in the office.
    keyTarget: params.get('keys') === 'scene' ? 'scene' : 'document',
    onHover(id, info) {
      if (info.phase === 'dwell' && ($('hover') as HTMLInputElement).checked) {
        const p = byId.get(id);
        const line = LINES[Math.abs([...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % LINES.length]!;
        scene.showBubble(id, id === lead.id ? 'Supplier prices are in. Two of three went up; I’ll draft the reply.' : line);
        log(`${p?.name}: passing by (${info.via})`);
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
  });
  seedPresence(Number(params.get('seed') ?? 7));
  (window as unknown as { office: OfficeScene; demo: unknown }).office = scene;
  (window as unknown as { demo: unknown }).demo = { pickPeople, roundtable, seedPresence, people, lead };

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
  $('rm').addEventListener('change', (e) => scene.setReducedMotion((e.target as HTMLInputElement).checked ? true : null));
  document.documentElement.dataset.ready = '1';
}

void main();
