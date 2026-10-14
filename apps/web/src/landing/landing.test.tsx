import { slimIndex } from '@headcount/catalog/slim';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coworkers, counts, images, leads, voiceSamples } from 'virtual:headcount-landing';
import { hexToOklch, nightAccent } from '../lib/accent';
import { forcedThemeFor, initTheme, parseChoice, resolveTheme } from '../lib/theme';
import { ageFloor, curate, hueGap, isSenior, isYoung } from './cast';
import { countWord, FAQ, LIVING, MEETINGS, MODALITIES, OFFICE, STEPS, TAGLINE, TALK_POINTS, TIERS, TRUST } from './content';
import { Landing } from './Landing';
import { hasSample, sampleText } from './LeadCarousel';
import { srcsetOf } from './Picture';
import { heroPeople, HERO_SIZE, wallPeople, WALL_SIZE } from './PortraitWall';
import { DEMO_EXCHANGES, nextExchange, rng } from './sidetalk';

describe('landing data (from the catalog bundle, never hard-coded)', () => {
  it('carries every lead with the catalog name, and coworkers from the catalog', () => {
    expect(leads.map((l) => l.name)).toEqual(slimIndex.catalog.leads.map((l) => l.name));
    expect(leads.map((l) => l.first)).toEqual(slimIndex.catalog.leads.map((l) => l.name.split(' ')[0]));
    for (const c of coworkers) expect(slimIndex.persona(c.id)?.name).toBe(c.name);
    expect(counts).toEqual({ leads: slimIndex.catalog.leads.length, coworkers: slimIndex.catalog.personas.length, departments: slimIndex.catalog.departments.length });
  });

  it('uses the marketing manifest, with alt text for every image', () => {
    expect(images.hero?.file).toMatch(/^\/marketing\/hero\./);
    for (const img of Object.values(images)) expect(img.alt.length).toBeGreaterThan(10);
  });

  it('casts the wall from coworkers only (the Chiefs of Staff have their carousel), younger first, at most one 45+ per row', () => {
    const wall = wallPeople(new Set());
    expect(wall).toHaveLength(Math.min(WALL_SIZE, coworkers.length));
    const leadIds = new Set(leads.map((l) => l.id));
    expect(wall.some((p) => leadIds.has(p.id))).toBe(false);
    expect(wall.every((p) => p.age)).toBe(true); // ages come from the full bundle
    expect(wall.slice(0, 6).every(isYoung)).toBe(true);
    for (let r = 0; r < wall.length; r += 6) expect(wall.slice(r, r + 6).filter(isSenior).length).toBeLessThanOrEqual(1);
    // Neighbours in the first row never share a rim colour.
    for (let i = 1; i < 6; i++) expect(hueGap(wall[i]!.accent, wall[i - 1]!.accent)).toBeGreaterThanOrEqual(30);
    const painted = new Set(coworkers.slice(0, 20).map((c) => c.id));
    expect(wallPeople(painted).every((p) => painted.has(p.id))).toBe(true);
  });

  it('opens the hero on a Chief of Staff from the younger half of the cast, never repeating a face on the wall', () => {
    const hero = heroPeople(new Set());
    expect(hero).toHaveLength(HERO_SIZE);
    expect(hero[0]!.lead).toBe(true);
    expect(hero.every(isYoung)).toBe(true);
    const wall = new Set(wallPeople(new Set(), new Set(hero.map((p) => p.id))).map((p) => p.id));
    expect(hero.some((p) => wall.has(p.id))).toBe(false);
  });
});

describe('casting helpers', () => {
  it('reads age ranges and keeps 45+ out of the first row', () => {
    expect(ageFloor('45-49')).toBe(45);
    expect(ageFloor('')).toBe(35);
    const people = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, pronouns: i % 2 ? 'she/her' : 'he/him', age: i < 4 ? '45-49' : '25-29', accent: ['#C92C49', '#2E86AB', '#6FD39B', '#E8A33D'][i % 4]! }));
    const out = curate(people, { size: 12, perRow: 4 });
    expect(out.slice(0, 4).some(isSenior)).toBe(false);
    for (let r = 0; r < 12; r += 4) expect(out.slice(r, r + 4).filter(isSenior).length).toBeLessThanOrEqual(1);
  });

  it('lifts dark accents to a luminous night tone with the same hue (OKLCH)', () => {
    for (const hex of ['#61723E', '#3B6FA5', '#8857A0', '#995C34', '#86709F']) {
      const [l0, , h0] = hexToOklch(hex)!;
      const [l1, c1, h1] = hexToOklch(nightAccent(hex))!;
      expect(l0).toBeLessThan(0.74);
      expect(l1).toBeGreaterThanOrEqual(0.735);
      expect(l1).toBeLessThanOrEqual(0.81);
      expect(c1).toBeLessThanOrEqual(0.161);
      expect(Math.min(Math.abs(h1 - h0), 360 - Math.abs(h1 - h0))).toBeLessThan(8);
    }
    expect(nightAccent('not a colour')).toBe('not a colour');
  });
});

describe('honest copy (INC0 §4: present tense only for what works today)', () => {
  // What Inc 0 verifies. Anything else on the page must say "In the works" or "Planned".
  const BUILT = new Set([
    'Hire your team',
    'Delegate',
    'Watch and steer',
    'Approve',
    'Ask how it is going',
    'Change direction',
    'Type or talk',
    'Voice',
    'Images',
    'Vision',
    'Video',
    'Documents',
    'Honest AI',
    'Reflexes',
    'Passing-by chat',
    'Side-talk',
    'Mood and ambience',
    'Approvals',
    'Receipts',
    'Everyone stop',
    'Call a meeting',
    'A chair and a moderator',
    'Listen and speak',
    'Then the work starts',
    'Sign in with Google',
    'Private to your office',
    'Bring your people',
  ]);
  const all = [...STEPS.map((s) => ({ title: s.title, status: s.status })), ...LIVING, ...TALK_POINTS, ...MODALITIES, ...TRUST, ...MEETINGS, ...OFFICE];

  it('gives every capability a status, and "Works today" only to built ones', () => {
    for (const f of all) {
      expect(f.status, f.title).toBeDefined();
      if (f.status === 'now') expect(BUILT.has(f.title), `${f.title} is marked Works today`).toBe(true);
    }
    // The living workforce (Inc 0.5, Office Phase 2), approvals, receipts and Everyone stop (Inc 6), meetings and
    // your own office are built; industry packs and pricing are not.
    for (const f of [...LIVING, ...TRUST, ...MEETINGS, ...OFFICE]) expect(f.status, f.title).toBe('now');
  });

  it('never promises pause (jobs can be steered or stopped, not paused) or a voice for every coworker', () => {
    expect(TALK_POINTS.map((t) => t.body).join(' ')).not.toMatch(/\bpause\b/i);
    expect(MODALITIES.find((m) => m.title === 'Voice')!.body).not.toMatch(/each coworker/i);
  });

  it('spells in US English, without em dashes', () => {
    const text = JSON.stringify({ TAGLINE, STEPS, LIVING, TALK_POINTS, MODALITIES, TRUST, MEETINGS, OFFICE, FAQ, TIERS });
    expect(text).not.toMatch(/sceptic|labelled|colour|optimis/i);
    expect(text).not.toContain('\u2014');
  });
});

describe('landing helpers', () => {
  it('builds a responsive srcset from the manifest', () => {
    const img = { key: 'x', file: '/marketing/x.webp', alt: 'x', aspect: '16:9', width: 1280, height: 720, srcset: [{ width: 640, file: '/marketing/x-640.webp' }, { width: 1280, file: '/marketing/x.webp' }] };
    expect(srcsetOf(img)).toBe('/marketing/x-640.webp 640w, /marketing/x.webp 1280w');
    expect(srcsetOf({ ...img, srcset: undefined })).toBe('/marketing/x.webp 1280w');
    expect(images.hero?.srcset?.length).toBeGreaterThan(1);
  });

  it('ships pre-voiced samples without their timing in the page (fetched on the first ▶)', () => {
    for (const v of Object.values(voiceSamples)) {
      expect(v.chunks.length).toBeGreaterThan(0);
      for (const c of v.chunks) {
        expect(c.file).toMatch(/^\/marketing\/voices\//);
        expect(c.alignment).toBeUndefined();
      }
    }
  });

  it('introduces each lead by name in their voice sample', () => {
    expect(sampleText('Kate', "Hi, I'd be your chief of staff. Tell me more.")).toBe("Hi, I'm Kate. I'd be your chief of staff. Tell me more.");
    expect(sampleText('Kate', null)).toBe("Hi, I'm Kate.");
  });
});

describe('demo side-talk', () => {
  it('pairs two different visible people, names the other one, and avoids repeats', () => {
    const names = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'];
    const random = rng(7);
    const recent = { people: [] as number[], lines: [] as number[] };
    let last: number[] = [];
    for (let i = 0; i < 40; i++) {
      const ex = nextExchange(names.length, names, random, recent)!;
      expect(ex.a).not.toBe(ex.b);
      expect(last).not.toContain(ex.a);
      expect(ex.line).not.toContain('{b}');
      if (DEMO_EXCHANGES.some(([l]) => l.includes('{b}') && l.replaceAll('{b}', names[ex.b]!) === ex.line)) expect(ex.line).toContain(names[ex.b]!);
      last = [ex.a, ex.b];
    }
    expect(nextExchange(1, names, random, recent)).toBeNull();
  });
});

describe('theme', () => {
  it('is dark unless light (or system) was chosen', () => {
    expect(parseChoice(null)).toBe('dark');
    expect(parseChoice('nonsense')).toBe('dark');
    expect(parseChoice('light')).toBe('light');
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
  });

  it('keeps the landing dark from the first render, even for an owner who chose light', () => {
    localStorage.setItem('headcount.theme', 'light');
    try {
      document.documentElement.dataset.theme = 'dark';
      initTheme(forcedThemeFor('landing'));
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(forcedThemeFor('talk')).toBeNull();
    } finally {
      localStorage.removeItem('headcount.theme');
      initTheme(null);
    }
  });
});

describe('Landing page', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    // No worker: capabilities and portraits fail, so faces stay illustrated and voice samples are absent.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
  });
  afterEach(() => {
    render(null, host);
    host.remove();
    vi.unstubAllGlobals();
    document.documentElement.dataset.theme = 'dark';
  });

  it('renders the tagline, the leads from the catalog, planned pricing and CTAs into the app', async () => {
    document.documentElement.dataset.theme = 'light';
    await act(() => render(<Landing />, host));
    expect(document.documentElement.dataset.theme).toBe('dark'); // the landing is always dark
    const h1 = host.querySelector('h1')!;
    expect(h1.textContent).toBe(TAGLINE.join(' '));
    // Screen readers get the sentence whole, not word by word.
    expect(h1.getAttribute('aria-label')).toBe('Hire an AI team. Watch it work.');
    expect(h1.querySelectorAll('.lp-line[aria-hidden="true"]').length).toBe(TAGLINE.length);
    expect([...host.querySelectorAll('.lp-lead-name')].map((n) => n.textContent)).toEqual(slimIndex.catalog.leads.map((l) => l.name));
    expect(host.textContent).toContain(`${countWord(leads.length, true)} personalities`);
    // Only what is not built yet is labelled; what works today carries no pill.
    expect(host.textContent).not.toContain('Works today');
    expect(host.querySelectorAll('.lp-status[data-status="now"]')).toHaveLength(0);
    expect(host.querySelectorAll('.lp-status[data-status="planned"]').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.lp-illus-tag').length).toBeGreaterThanOrEqual(3);
    expect(host.querySelectorAll('.lp-tier')).toHaveLength(TIERS.length);
    expect(host.querySelector('#pricing .lp-status')?.textContent).toBe('Planned pricing');
    const enter = [...host.querySelectorAll('a')].filter((a) => a.textContent?.includes('Enter the office'));
    expect(enter.length).toBeGreaterThan(1);
    for (const a of enter) expect(a.getAttribute('href')).toBe('/app');
    // Keyless: "Hear …" exactly where a pre-voiced sample says the lead's current words (never a browser voice).
    expect(host.querySelectorAll('.lp-voice').length).toBe(leads.filter(hasSample).length);
    // The hero image loads first; every other generated image is lazy and has alt text (or is decorative).
    const imgs = [...host.querySelectorAll('img')];
    expect(imgs[0]?.getAttribute('loading')).toBe('eager');
    expect(imgs.slice(1).every((i) => i.getAttribute('loading') === 'lazy')).toBe(true);
    expect(imgs.every((i) => i.hasAttribute('alt'))).toBe(true);
    // Phones get a menu with every section; the provider list is plain text, not a logo wall.
    expect([...host.querySelectorAll('#lp-nav-links a')].map((a) => a.getAttribute('href'))).toEqual(['#how', '#meetings', '#leads', '#trust', '#pricing', '#faq', '/releases']);
    expect(host.querySelectorAll('.lp-providers li').length).toBe(6);
    // The pricing section ends in a call to action, and the emphasised tier says why, honestly.
    expect(host.querySelector('#pricing .lp-pricing-cta a')?.getAttribute('href')).toBe('/app');
    expect(host.querySelector('.lp-tier-note')?.textContent).toBe('Built for small teams');
    // Nothing fabricated: no testimonials or customer claims; no em dashes in the copy.
    expect(host.textContent).not.toMatch(/testimonial|trusted by|customers love|\d+\+ (teams|customers|businesses)/i);
    expect(host.textContent).not.toContain('\u2014');
  });
});
