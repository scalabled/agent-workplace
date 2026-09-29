import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import slim from '../../../catalog/generated/slim.js';
import { buildPlateSvg } from '../art/plate';
import { FILL_CLASSES, prefixClasses } from '../art/palette';
import { fallbackSkyline } from '../art/skyline-fallback';
import { hitTest } from '../plan/hit';
import { planOffice } from '../plan/plan';
import { fromScreen, toScreen } from '../projection';
import type { FaceSlot, OfficeGroup, OfficePerson, OfficeScene } from '../types';
import { createOfficeScene } from './scene';

const LEAD = slim.leads[0]!;
const people: OfficePerson[] = [
  { id: LEAD.id, name: LEAD.name, title: 'Chief of Staff', groupId: 'chief', accent: LEAD.avatar.accent_color },
  ...slim.personas.map((p) => ({ id: p.id, name: p.name, title: p.title, groupId: p.department, accent: p.avatar.accent_color, seniority: p.seniority })),
];
const groups: OfficeGroup[] = slim.departments.map((d) => ({ id: d.id, name: d.name, kind: 'department' as const }));
const someone = slim.personas[20]!.id;
const others = slim.personas.slice(30, 34).map((p) => p.id);

let host: HTMLElement;
let scene: OfficeScene | null = null;
const make = (extra: Partial<Parameters<typeof createOfficeScene>[1]> = {}) => {
  scene = createOfficeScene(host, { people, groups, leadId: LEAD.id, assetsBase: null, reducedMotion: true, cameraKey: null, timeOfDay: 'night', ...extra });
  return scene;
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

describe('createOfficeScene', () => {
  it('renders one labelled region with a seat button per person and one roving tab stop', () => {
    const s = make();
    expect(s.el.getAttribute('role')).toBe('region');
    expect(s.el.getAttribute('aria-label')).toBe('Office floor plan');
    expect(s.el.querySelectorAll('.hc-o-seat')).toHaveLength(165);
    expect(s.el.querySelectorAll('.hc-o-seat[tabindex="0"]')).toHaveLength(1);
    expect(s.el.querySelector('.hc-o-skip')?.textContent).toBe('Use the Directory (list view)');
    expect(document.getElementById('hc-office-style')).not.toBeNull();
    expect(s.getState()).toMatchObject({ mode: 'desks', roomId: null, participants: [], timeOfDay: 'night' });
  });

  it('lights monitors, Night Shift lamps and halos from presence', () => {
    const s = make();
    s.setPresence(someone, 'working', { label: 'Reading 14 reports', badges: ['lamp'] });
    const btn = s.el.querySelector(`.hc-o-seat[data-pid="${someone}"]`) as HTMLElement;
    expect(btn.dataset.state).toBe('working');
    expect(btn.getAttribute('aria-label')).toContain('Reading 14 reports');
    const lit = s.el.querySelectorAll('.hc-o-sl[data-mon="on"][data-lamp]');
    expect(lit).toHaveLength(1);
    s.setPresence(someone, 'raised_hand');
    expect(s.el.querySelectorAll('.hc-o-sl[data-mon]')).toHaveLength(0);
    expect(s.el.querySelectorAll('.hc-o-sl[data-halo="hand"]')).toHaveLength(1);
    s.setSpeaking(someone, true);
    expect(btn.hasAttribute('data-speaking')).toBe(true);
    expect(s.el.querySelectorAll('.hc-o-sl[data-halo="speak"]')).toHaveLength(1);
  });

  it('warns once for unknown people and ignores them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = make();
    s.setPresence('nobody', 'working');
    s.setSpeaking('nobody', true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('shows a bubble for 4 s + 60 ms per character and hides it on request', () => {
    vi.useFakeTimers();
    const s = make();
    s.showBubble(someone, 'Short line.');
    expect(s.el.querySelectorAll('.hc-o-bubble')).toHaveLength(1);
    expect(s.el.querySelector('.hc-o-bubble__text')?.textContent).toBe('Short line.');
    vi.advanceTimersByTime(4000 + 60 * 11 - 10);
    expect(s.el.querySelectorAll('.hc-o-bubble')).toHaveLength(1);
    vi.advanceTimersByTime(20);
    expect(s.el.querySelectorAll('.hc-o-bubble')).toHaveLength(0);
    s.showBubble(someone, 'Again');
    s.hideBubble(someone);
    expect(s.el.querySelectorAll('.hc-o-bubble')).toHaveLength(0);
  });

  it('enters a room, seats invitees, refuses when onInvite returns false, and leaves in order', () => {
    const calls: string[] = [];
    let refuse = false;
    const s = make({
      onEnterRoom: (room, ids) => calls.push(`enter:${room}:${ids.length}`),
      onInvite: (room, ids, info) => {
        calls.push(`invite:${room}:${ids.length}:${info.via}`);
        return refuse ? false : undefined;
      },
      onLeaveRoom: (room, ids) => calls.push(`leave:${room}:${ids.length}`),
      onModeChange: (mode, room) => calls.push(`mode:${mode}:${room}`),
    });
    s.enterRoom('skyline', others.slice(0, 3));
    expect(s.getState()).toMatchObject({ mode: 'conference', roomId: 'skyline' });
    expect(s.getState().participants).toHaveLength(3);
    expect(s.el.querySelectorAll('.hc-o-stage .hc-o-sseat')).toHaveLength(3);
    s.seat(others[3]!, 'skyline');
    expect(s.getState().participants).toHaveLength(4);
    refuse = true;
    s.seat(someone, 'skyline');
    expect(s.getState().participants).toHaveLength(4);
    s.seat(others[0]!, null);
    expect(s.getState().participants).toHaveLength(3);
    s.leaveRoom();
    expect(s.getState()).toMatchObject({ mode: 'desks', roomId: null, participants: [] });
    expect(calls).toEqual([
      // Participants passed to enterRoom come from the host, so only office-side invites ask onInvite.
      'mode:conference:skyline',
      'enter:skyline:3',
      'invite:skyline:1:picker',
      'invite:skyline:1:picker',
      'mode:desks:null',
      'leave:skyline:3',
    ]);
  });

  it('respects the room capacity (the Skyline room seats 9 besides the owner)', () => {
    const s = make();
    s.enterRoom('skyline', slim.personas.slice(0, 14).map((p) => p.id));
    expect(s.getState().participants).toHaveLength(9);
  });

  it('asks the host faceFactory for faces and releases them on destroy', () => {
    const made: string[] = [];
    const destroyed: string[] = [];
    const faceFactory = (id: string): FaceSlot => {
      made.push(id);
      const el = document.createElement('div');
      return { el, setTier: () => {}, destroy: () => destroyed.push(id) };
    };
    const s = make({ faceFactory, initialCamera: { x: 440, y: 120, zoom: 3.2 } });
    expect(s.getState().lod).toBe(1);
    expect(made.length).toBeGreaterThan(0);
    expect(made.length).toBeLessThanOrEqual(96);
    s.destroy();
    scene = null;
    expect(destroyed.sort()).toEqual(made.slice().sort());
  });

  it('destroy leaves no DOM, style tag or timers behind', () => {
    vi.useFakeTimers();
    const s = make();
    s.showBubble(someone, 'Bye');
    s.destroy();
    scene = null;
    expect(host.children).toHaveLength(0);
    expect(document.getElementById('hc-office-style')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    // Calls after destroy are no-ops.
    s.setPresence(someone, 'working');
    s.enterRoom('skyline');
  });

  it('keeps the style tag while another scene is alive', () => {
    const a = make();
    const other = document.createElement('div');
    document.body.append(other);
    const b = createOfficeScene(other, { people, groups, leadId: LEAD.id, assetsBase: null, reducedMotion: true, cameraKey: null });
    a.destroy();
    scene = null;
    expect(document.getElementById('hc-office-style')).not.toBeNull();
    b.destroy();
    expect(document.getElementById('hc-office-style')).toBeNull();
  });
});

describe('review fixes (keyboard, honesty, chrome, calm, captions)', () => {
  const key = (target: EventTarget, k: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  it('takes focus on a floor click so the keyboard map works (G opens Walk to)', () => {
    const s = make();
    expect(s.el.tabIndex).toBe(-1);
    s.el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 600, clientY: 700, pointerId: 1, button: 0 }));
    expect(document.activeElement).toBe(s.el);
    key(s.el, 'g');
    expect((s.el.querySelector('.hc-o-walk') as HTMLElement).hidden).toBe(false);
  });

  it("routes keys from the whole page with keyTarget: 'document'", () => {
    const s = make({ keyTarget: 'document' });
    key(document.body, 'g');
    expect((s.el.querySelector('.hc-o-walk') as HTMLElement).hidden).toBe(false);
  });

  it('keeps letter shortcuts working from a header button outside the office, but not the keys the button uses', () => {
    const s = make({ keyTarget: 'document' });
    const btn = document.createElement('button');
    document.body.append(btn);
    key(btn, 'Enter');
    expect((s.el.querySelector('.hc-o-walk') as HTMLElement).hidden).toBe(true);
    key(btn, 'g');
    expect((s.el.querySelector('.hc-o-walk') as HTMLElement).hidden).toBe(false);
    // An open dialog outside keeps every key.
    (s.el.querySelector('.hc-o-walk') as HTMLElement).hidden = true;
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    const inner = document.createElement('button');
    dlg.append(inner);
    document.body.append(dlg);
    key(inner, 'g');
    expect((s.el.querySelector('.hc-o-walk') as HTMLElement).hidden).toBe(true);
    btn.remove();
    dlg.remove();
  });

  it("does not repeat the Chief's title in the seat label", () => {
    const s = make();
    const chief = s.el.querySelector(`.hc-o-seat[data-pid="${LEAD.id}"]`)!;
    const label = chief.getAttribute('aria-label')!;
    expect(label.match(/Chief of Staff/g)).toHaveLength(1);
  });

  it('says people in a room are waiting until the owner walks in, and reports them in getState().rooms', () => {
    const s = make();
    for (const id of others) s.seat(id, 'skyline');
    const plate = () => s.el.querySelector('.hc-o-label--room[data-id="skyline"] [data-room-status]')!.textContent;
    expect(plate()).toMatch(/· waiting for you$/);
    expect(s.getState().participants).toEqual([]);
    expect(s.getState().rooms.skyline).toEqual(others);
    s.enterRoom('skyline');
    expect(plate()).toMatch(/^Talking with /);
    expect(s.getState().participants).toEqual(others);
  });

  it('drops its own state rings when the host face draws its chrome', () => {
    const faceFactory = (): FaceSlot => ({ el: document.createElement('div'), setTier: () => {}, destroy: () => {}, drawsChrome: true });
    const s = make({ faceFactory, initialCamera: { x: 440, y: 120, zoom: 3.2 } });
    expect(s.el.querySelectorAll('.hc-o-seat[data-face][data-host-chrome]').length).toBeGreaterThan(0);
    expect(s.el.querySelectorAll('.hc-o-seat[data-face]:not([data-host-chrome])')).toHaveLength(0);
  });

  it('shows "not voiced" as a tag beside the name, not inside the spoken text', () => {
    const s = make();
    s.enterRoom('skyline', others.slice(0, 2));
    s.showCaption(others[0]!, 'Two numbers by noon.', { voiced: false });
    expect(s.el.querySelector('.hc-o-cap__text')!.textContent).toBe('Two numbers by noon.');
    expect((s.el.querySelector('.hc-o-cap__tag') as HTMLElement).hidden).toBe(false);
    s.showCaption(others[0]!, 'Voiced line.', { voiced: true });
    expect((s.el.querySelector('.hc-o-cap__tag') as HTMLElement).hidden).toBe(true);
  });

  it('calms the sky after 30 s without input and wakes on a pointer move', () => {
    vi.useFakeTimers();
    const s = make();
    expect(s.el.hasAttribute('data-calm')).toBe(false);
    vi.advanceTimersByTime(30_500);
    expect(s.el.hasAttribute('data-calm')).toBe(true);
    s.el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(s.el.hasAttribute('data-calm')).toBe(false);
  });

  it('sizes the stage table to the party, not the room', () => {
    const s = make();
    s.enterRoom('skyline', others.slice(0, 2));
    // Five seats for a small party (head + two pairs); the Skyline room itself seats nine guests.
    const faces = [...s.el.querySelectorAll<HTMLElement>('.hc-o-sseat')];
    expect(faces).toHaveLength(2);
    const ys = faces.map((f) => parseFloat(f.style.top));
    expect(Math.max(...ys)).toBeGreaterThan(0);
  });
});

describe('screen → seat hit-testing through the camera', () => {
  it('finds the seat under a screen point at any zoom', () => {
    const plan = planOffice({ people, groups, leadId: LEAD.id });
    const seat = plan.seats.find((s) => s.personId === someone)!;
    for (const zoom of [1.5, 3.2, 7]) {
      const cam = { x: seat.x, y: seat.y * 0.82, zoom };
      const target = toScreen({ x: seat.desk.x + seat.desk.w / 2, y: (seat.desk.y + seat.desk.h / 2) * 0.82 - 7.3 * 0.57 }, cam, 1440, 900);
      const hit = hitTest(plan, fromScreen(target, cam, 1440, 900));
      expect(hit).toEqual({ kind: 'seat', seatId: seat.id, personId: someone });
    }
  });
});

describe('art', () => {
  it('builds the plate once with repeated assets as <use> and prefixed fill classes', () => {
    const plan = planOffice({ people, groups, leadId: LEAD.id });
    const { svg, box } = buildPlateSvg(plan);
    expect(box.w).toBeGreaterThan(plan.bounds.w);
    expect((svg.match(/<use /g) ?? []).length).toBeGreaterThan(500);
    expect(svg).not.toMatch(/class="(w|fb|p)"/);
    expect(svg).toContain('class="hco-w"');
    expect(prefixClasses('<rect class="w hc-o-x"/>')).toBe('<rect class="hco-w hc-o-x"/>');
    expect(FILL_CLASSES.has('fl')).toBe(true);
  });

  it('draws the keyless skyline quickly, with lit windows and night beacons', () => {
    const t0 = performance.now();
    const night = fallbackSkyline('night');
    const ms = performance.now() - t0;
    expect(night.svg.startsWith('<svg')).toBe(true);
    expect(night.lights.length).toBeGreaterThan(10);
    expect(night.beacons.length).toBe(4);
    expect(fallbackSkyline('day').beacons).toHaveLength(0);
    expect(ms).toBeLessThan(50);
    expect(fallbackSkyline('dusk').svg).toBe(fallbackSkyline('dusk').svg);
  });
});
