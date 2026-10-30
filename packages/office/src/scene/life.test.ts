// The scene's office-life surface: moves, small-talk bubbles and their cap,
// holds reported to life, huddle markers and the card, the What's happening pill, follow and teardown.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import slim from '../../../catalog/generated/slim.js';
import { createOfficeLife } from '../life/director';
import type { LifeHooks, OfficeLifePerson } from '../life/types';
import type { OfficeGroup, OfficePerson, OfficeScene } from '../types';
import { createOfficeScene } from './scene';

const LEAD = slim.leads[0]!;
const people: OfficePerson[] = [
  { id: LEAD.id, name: LEAD.name, title: 'Chief of Staff', groupId: 'chief', accent: LEAD.avatar.accent_color },
  ...slim.personas.map((p) => ({ id: p.id, name: p.name, title: p.title, groupId: p.department, accent: p.avatar.accent_color, seniority: p.seniority })),
];
const groups: OfficeGroup[] = slim.departments.map((d) => ({ id: d.id, name: d.name, kind: 'department' as const }));
const a = slim.personas[20]!.id;
const b = slim.personas[21]!.id;
const c = slim.personas[22]!.id;
const d = slim.personas[23]!.id;

let host: HTMLElement;
let scene: OfficeScene | null = null;
const make = (extra: Partial<Parameters<typeof createOfficeScene>[1]> = {}) => {
  scene = createOfficeScene(host, { people, groups, leadId: LEAD.id, assetsBase: null, reducedMotion: true, cameraKey: null, autopilotKey: null, timeOfDay: 'night', ...extra });
  return scene;
};
const hooks = (): LifeHooks & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    onHold: (id, held, why) => calls.push(`hold:${id}:${held}:${why}`),
    onHuddleAction: (id, action) => calls.push(`action:${id}:${action}`),
    onPauseToggle: (p) => calls.push(`pause:${p}`),
    onViewChange: () => calls.push('view'),
    onPresence: (id, state) => calls.push(`presence:${id}:${state}`),
    onRoom: (id, room) => calls.push(`room:${id}:${room}`),
    onStage: (open) => calls.push(`stage:${open}`),
  };
};

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  scene?.destroy();
  scene = null;
  vi.useRealTimers();
});

describe('the scene for office life', () => {
  it('moves a person to a spot and back (reduced motion: a fade, then they are there)', async () => {
    vi.useFakeTimers();
    const s = make();
    const cooler = s.spots().find((x) => x.id === 'cooler:cafe')!;
    const h = s.moveTo(a, { kind: 'spot', spotId: cooler.id, slot: 0 }, { pace: 'instant' });
    vi.advanceTimersByTime(600);
    await expect(h.done).resolves.toBe(true);
    const p = s.placeOf(a);
    expect(p.place).toEqual({ kind: 'spot', spotId: cooler.id, slot: 0 });
    expect(p.x).toBeCloseTo(cooler.slots[0]!.x, 3);
    const btn = s.el.querySelector(`.hc-o-seat[data-pid="${a}"]`) as HTMLElement;
    expect(btn.hasAttribute('data-away')).toBe(true);
    // The accessible name says where they are.
    expect(btn.getAttribute('aria-label')).toContain('Water cooler');
    const back = s.moveTo(a, { kind: 'desk' }, { pace: 'instant' });
    vi.advanceTimersByTime(600);
    await expect(back.done).resolves.toBe(true);
    expect(s.placeOf(a).place.kind).toBe('desk');
    expect(btn.hasAttribute('data-away')).toBe(false);
  });

  it('strolls along a smooth route (walking attributes while moving, then arrival)', async () => {
    vi.useFakeTimers();
    const s = make({ reducedMotion: false });
    const sofa = s.spots().find((x) => x.id === 'lounge:sofa')!;
    const h = s.moveTo(a, { kind: 'spot', spotId: sofa.id, slot: 1 }, { speed: 42 });
    expect(h.durationMs).toBeGreaterThan(1500);
    expect(h.durationMs).toBeLessThan(17_000);
    const btn = s.el.querySelector(`.hc-o-seat[data-pid="${a}"]`) as HTMLElement;
    expect(btn.hasAttribute('data-walking')).toBe(true);
    // Mid-walk the person is somewhere between their desk and the sofa.
    vi.advanceTimersByTime(h.durationMs / 2);
    expect(s.placeOf(a).walking).toBe(true);
    vi.advanceTimersByTime(h.durationMs);
    await expect(h.done).resolves.toBe(true);
    expect(btn.hasAttribute('data-walking')).toBe(false);
    expect(s.placeOf(a).place).toEqual({ kind: 'spot', spotId: sofa.id, slot: 1 });
  });

  it('eases to a stop on cancel (the promise says it did not arrive)', async () => {
    vi.useFakeTimers();
    const s = make({ reducedMotion: false });
    const h = s.moveTo(a, { kind: 'spot', spotId: 'cooler:cafe', slot: 0 });
    vi.advanceTimersByTime(800);
    h.cancel();
    await expect(h.done).resolves.toBe(false);
    vi.advanceTimersByTime(600);
    expect(s.placeOf(a).place.kind).toBe('point');
  });

  it('someone stopped mid-walk for the owner steps to the lane edge, clear of the aisle', async () => {
    vi.useFakeTimers();
    const s = make({ reducedMotion: false });
    const h = s.moveTo(a, { kind: 'spot', spotId: 'cooler:cafe', slot: 0 }, { speed: 42 });
    vi.advanceTimersByTime(Math.min(4000, h.durationMs / 2));
    h.cancel();
    await expect(h.done).resolves.toBe(false);
    vi.advanceTimersByTime(560); // eased to a stop (≤ 0.5 s)
    const stopped = s.placeOf(a);
    vi.advanceTimersByTime(2000);
    const after = s.placeOf(a);
    expect(after.walking).toBe(false);
    expect(Math.hypot(after.x - stopped.x, after.y - stopped.y)).toBeCloseTo(6, 0);
  });

  it('shows small talk as captioned bubbles, at most three ambient bubbles, owner-facing ones first', () => {
    vi.useFakeTimers();
    const s = make();
    s.say(a, 'One.', { huddleId: 'h1', ttlMs: 3000 });
    s.say(b, 'Two.', { huddleId: 'h1', ttlMs: 3000 });
    s.say(c, 'Three.', { huddleId: 'h2', ttlMs: 3000 });
    expect(s.el.querySelectorAll('.hc-o-bubble--talk')).toHaveLength(3);
    s.showBubble(d, 'Passing by.');
    expect(s.el.querySelectorAll('.hc-o-bubble:not(.is-leaving)').length).toBeLessThanOrEqual(3);
    expect(s.el.querySelectorAll('.hc-o-bubble--talk:not(.is-leaving)')).toHaveLength(2);
    // Small talk never replaces an owner-facing bubble.
    s.say(d, 'Small talk.', { huddleId: 'h3', ttlMs: 3000 });
    expect(s.el.querySelector(`.hc-o-bubble--talk .hc-o-bubble__text`)?.textContent).not.toBe('Small talk.');
    vi.advanceTimersByTime(3500);
    expect(s.el.querySelectorAll('.hc-o-bubble--talk:not(.is-leaving)')).toHaveLength(0);
  });

  it('reports holds, presence, rooms and the stage to life, and never writes presence itself', () => {
    const s = make();
    s.setPresence(a, 'working', { label: 'Reading' });
    const hk = hooks();
    s.attachLife(hk);
    // Attaching replays what the scene already knows.
    expect(hk.calls).toContain(`presence:${a}:working`);
    s.setPresence(b, 'thinking');
    expect(hk.calls).toContain(`presence:${b}:thinking`);
    const btn = s.el.querySelector(`.hc-o-seat[data-pid="${c}"]`) as HTMLElement;
    btn.focus();
    btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(hk.calls).toContain(`hold:${c}:true:focus`);
    s.showBubble(d, 'Hello.');
    expect(hk.calls).toContain(`hold:${d}:true:bubble`);
    s.enterRoom('skyline', [a]);
    expect(hk.calls).toContain(`room:${a}:skyline`);
    expect(hk.calls).toContain('stage:true');
  });

  it('draws a huddle marker with its card (Join, Listen) and forwards the actions', () => {
    vi.useFakeTimers();
    const s = make();
    const hk = hooks();
    s.attachLife(hk);
    s.showHuddle({ id: 'h1', members: [a, b], center: { x: 420, y: 150 }, label: 'Water cooler', talking: true, joined: false, listening: false, lines: [{ personId: a, text: "I'd grab an espresso if I had hands." }] });
    const marker = s.el.querySelector('.hc-o-huddle') as HTMLButtonElement;
    expect(marker.getAttribute('aria-label')).toMatch(/^Water cooler huddle: /);
    marker.click();
    const card = s.el.querySelector('.hc-o-hcard') as HTMLElement;
    expect(card.hidden).toBe(false);
    expect(card.textContent).toContain("I'd grab an espresso if I had hands.");
    (card.querySelector('.hc-o-btn--primary') as HTMLButtonElement).click();
    expect(hk.calls).toContain('action:h1:join');
    expect(hk.calls.some((x) => x.startsWith('hold:') && x.endsWith(':true:hover'))).toBe(true);
    expect(s.getState().huddles).toEqual([{ id: 'h1', members: [a, b] }]);
    expect(s.getState().huddleCard).toBe('h1');
    // Joined: the card becomes a quick group chat.
    s.showHuddle({ id: 'h1', members: [a, b], center: { x: 420, y: 150 }, label: 'Water cooler', talking: false, joined: true, listening: false, lines: [] });
    expect(card.querySelector('.hc-o-hcard__input')).not.toBeNull();
    s.hideHuddle('h1');
    expect(s.el.querySelector('.hc-o-huddle')).toBeNull();
    expect(card.hidden).toBe(true);
  });

  it("shows What's happening, with Pause and Autopilot, and a Following chip", () => {
    const s = make({ reducedMotion: false });
    const hk = hooks();
    s.attachLife(hk);
    s.setLifeSummary({ huddles: 3, away: 21, walking: 2, paused: false, night: false, top: null, moments: [] });
    const pill = s.el.querySelector('.hc-o-life__pill') as HTMLButtonElement;
    // Away from the desk means available (D2): "on a break", never "away"; no "0 huddles"; the dot has a name.
    expect(pill.textContent).toContain('3 huddles · 21 on a break');
    expect(pill.getAttribute('aria-label')).toBe("What's happening: 3 huddles · 21 on a break");
    s.setLifeSummary({ huddles: 0, away: 12, walking: 2, paused: false, night: false, top: null, moments: [] });
    expect(pill.textContent).toBe('12 on a break');
    s.setLifeSummary({ huddles: 0, away: 3, walking: 0, paused: false, night: true, atWindows: 3, top: null, moments: [] });
    expect(pill.textContent).toBe('Night floor · 3 at the windows');
    s.setLifeSummary({ huddles: 3, away: 21, walking: 2, paused: false, night: false, top: null, moments: [] });
    pill.click();
    const pop = s.el.querySelector('.hc-o-life__pop') as HTMLElement;
    expect(pop.hidden).toBe(false);
    const switches = [...pop.querySelectorAll<HTMLInputElement>('input[role=switch]')];
    expect(switches).toHaveLength(2);
    switches[1]!.click();
    expect(hk.calls).toContain('pause:true');
    switches[0]!.click();
    expect(s.getState().autopilot).toBe(true);
    s.follow(a);
    expect(s.getState().followingId).toBe(a);
    const chip = s.el.querySelector('.hc-o-follow') as HTMLElement;
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toContain('Following');
    s.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    s.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(s.getState().followingId).toBeNull();
    s.setLifeSummary(null);
    expect((s.el.querySelector('.hc-o-life') as HTMLElement).hidden).toBe(true);
  });

  it('gives each moment its own action and previews what a huddle is saying', () => {
    const opened: string[] = [];
    const s = make({ reducedMotion: false, onOpen: (id) => opened.push(id) });
    const hk = hooks();
    s.attachLife(hk);
    vi.useFakeTimers();
    const at = { x: 400, y: 120 };
    s.setLifeSummary({
      huddles: 1, away: 3, walking: 1, paused: false, night: false, top: null,
      moments: [
        { id: 'm:hand', kind: 'raised_hand', at, zoom: 3.4, personIds: [a], score: 100, endsAt: 0, label: 'Waiting on you' },
        { id: 'm:h1', kind: 'huddle', at, zoom: 3.2, personIds: [b, c], huddleId: 'h1', score: 45, endsAt: 0, label: 'Water cooler', line: { personId: b, text: 'Still or sparkling?' }, usualMin: 640, where: 'at the water cooler' },
        { id: 'm:walk', kind: 'arrival', at, zoom: 3.2, personIds: [d], score: 20, endsAt: 0, label: 'On the way · Coffee bar' },
      ],
    });
    s.showHuddle({ id: 'h1', members: [b, c], center: { x: 420, y: 150 }, label: 'Water cooler', talking: false, joined: false, listening: false, lines: [] });
    (s.el.querySelector('.hc-o-life__pill') as HTMLButtonElement).click();
    const rows = [...s.el.querySelectorAll('.hc-o-life__row')];
    expect(rows).toHaveLength(3);
    const acts = (r: Element) => [...r.querySelectorAll('.hc-o-life__act')].map((x) => x.textContent);
    expect(acts(rows[0]!)).toEqual(['Talk']);
    expect(acts(rows[1]!)).toEqual(['Listen', 'Join']);
    expect(acts(rows[2]!)).toEqual(['Follow']);
    // Calm: a raised hand asks; otherwise only the top moment's action is filled.
    const filled = (r: Element) => [...r.querySelectorAll('.hc-o-life__act.hc-o-btn--primary')].map((x) => x.textContent);
    expect(rows.map(filled)).toEqual([['Talk'], [], []]);
    expect(rows[1]!.textContent).toContain('“Still or sparkling?”');
    expect(rows[1]!.textContent).toMatch(/Water cooler · their usual 10:40/);
    (rows[1]!.querySelectorAll('.hc-o-life__act')[0] as HTMLButtonElement).click();
    expect(hk.calls).toContain('action:h1:listen');
    (s.el.querySelector('.hc-o-life__pill') as HTMLButtonElement).click();
    (s.el.querySelector('.hc-o-life__row .hc-o-life__act') as HTMLButtonElement).click();
    vi.advanceTimersByTime(700);
    expect(opened).toContain(a);
  });

  it('draws laughs as caption chips (no bubble, outside the cap), and replies that clicks pass through', () => {
    vi.useFakeTimers();
    const s = make();
    s.say(a, 'Race you back to the desks?', { huddleId: 'h1', ttlMs: 3000 });
    s.say(b, '(laughs softly)', { huddleId: 'h1', ttlMs: 1500, nonverbal: true });
    expect(s.el.querySelectorAll('.hc-o-bubble--talk')).toHaveLength(1);
    const chip = s.el.querySelector('.hc-o-chip') as HTMLElement;
    expect(chip.textContent).toBe('(laughs softly)');
    expect(chip.querySelector('.hc-o-bubble__who')).toBeNull();
    vi.advanceTimersByTime(1300);
    expect(s.el.querySelector('.hc-o-chip:not(.is-leaving)')).toBeNull();
    // A reply in a joined chat is passive, and Leave trims it to ≤ 4 s.
    s.showBubble(c, 'Good question. Want to take it to a room?', { ttlMs: 9000, passive: true });
    const reply = s.el.querySelector('.hc-o-bubble--passive') as HTMLElement;
    expect(reply).not.toBeNull();
    s.trimBubbles!([c], 4000);
    vi.advanceTimersByTime(4100);
    expect(s.el.querySelector('.hc-o-bubble--passive:not(.is-leaving)')).toBeNull();
  });

  it('titles a drop-by by its host, says a habit, appends a laugh to its line, and joins straight into the chat', () => {
    vi.useFakeTimers();
    const s = make();
    const hk = hooks();
    s.attachLife(hk);
    s.showHuddle({ id: 'd1', members: [a, b], hostId: a, center: { x: 420, y: 150 }, label: 'At a desk', talking: false, joined: false, listening: false, lines: [] });
    (s.el.querySelector('.hc-o-huddle') as HTMLButtonElement).click();
    const card = s.el.querySelector('.hc-o-hcard') as HTMLElement;
    const first = (id: string) => people.find((p) => p.id === id)!.name.split(' ')[0];
    expect(card.querySelector('.hc-o-hcard__head')!.textContent).toBe(`At ${first(a)}'s desk · ${first(b)} visiting`);
    s.hideHuddle('d1');
    s.showHuddle({ id: 'h2', members: [c, d], center: { x: 420, y: 150 }, label: 'Water cooler', usualMin: 640, where: 'at the water cooler', talking: false, joined: false, listening: false, lines: [{ personId: c, text: 'Race you back to the desks?' }, { personId: d, text: '(laughs)', nonverbal: true }] });
    (s.el.querySelector('.hc-o-huddle') as HTMLButtonElement).click();
    expect(card.querySelector('.hc-o-hcard__sub')!.textContent).toMatch(/^Their usual 10:40.* at the water cooler$/);
    const rows = card.querySelectorAll('.hc-o-hcard__line');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain(`Race you back to the desks? · ${first(d)} laughs`);
    (card.querySelector('.hc-o-btn--primary') as HTMLButtonElement).click();
    expect(hk.calls).toContain('action:h2:join');
    s.showHuddle({ id: 'h2', members: [c, d], center: { x: 420, y: 150 }, label: 'Water cooler', talking: false, joined: true, listening: false, lines: [{ personId: c, text: 'Oh, hi Dana!' }] });
    vi.advanceTimersByTime(10);
    expect(document.activeElement?.classList.contains('hc-o-hcard__input')).toBe(true);
  });

  it('never stacks the pill sheet on the huddle card', () => {
    const s = make();
    s.attachLife(hooks());
    s.setLifeSummary({ huddles: 1, away: 2, walking: 0, paused: false, night: false, top: null, moments: [] });
    s.showHuddle({ id: 'h1', members: [a, b], center: { x: 420, y: 150 }, label: 'Water cooler', talking: false, joined: false, listening: false, lines: [] });
    (s.el.querySelector('.hc-o-huddle') as HTMLButtonElement).click();
    const card = s.el.querySelector('.hc-o-hcard') as HTMLElement;
    const pop = s.el.querySelector('.hc-o-life__pop') as HTMLElement;
    expect(card.hidden).toBe(false);
    (s.el.querySelector('.hc-o-life__pill') as HTMLButtonElement).click();
    expect(pop.hidden).toBe(false);
    expect(card.hidden).toBe(true);
    (s.el.querySelector('.hc-o-huddle') as HTMLButtonElement).click();
    expect(card.hidden).toBe(false);
    expect(pop.hidden).toBe(true);
  });

  it('tells life who the camera follows, and opens on the liveliest place only on the default view', () => {
    const s = make({ reducedMotion: false, initialCamera: 'fit' });
    const hk = hooks();
    const follows: (string | null)[] = [];
    s.attachLife({ ...hk, onFollow: (id) => follows.push(id) });
    const fitZoom = s.getState().camera.zoom;
    s.frameOpening!({ x: 400, y: 150 });
    expect(s.getState().camera.zoom).toBeGreaterThan(fitZoom);
    expect(s.getState().lod).toBe(1);
    s.follow(a);
    s.follow(null);
    expect(follows).toEqual([a, null]);
    // A host camera (or a restored one) is never overridden.
    s.destroy();
    const t = make({ initialCamera: { x: 100, y: 100, zoom: 1.2 } });
    const before = t.getState().camera;
    t.frameOpening!({ x: 400, y: 150 });
    expect(t.getState().camera).toEqual(before);
  });

  it('runs a whole life on a real scene and leaves nothing behind', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 10, 40));
    const s = make();
    const lifePeople: OfficeLifePerson[] = people.map((p) => ({ id: p.id }));
    const setPresence = vi.spyOn(s, 'setPresence');
    const life = createOfficeLife(s, { people: lifePeople, seed: 'ws_scene', observe: false, leadId: LEAD.id, lines: () => null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(life.getState().planHash).toMatch(/^[0-9a-f]{16}$/);
    expect(s.el.querySelectorAll('.hc-o-seat[data-away]').length).toBeGreaterThan(3);
    expect(setPresence).not.toHaveBeenCalled();
    life.destroy();
    s.destroy();
    scene = null;
    expect(document.querySelector('.hc-office')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
