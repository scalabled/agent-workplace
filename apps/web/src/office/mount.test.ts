// The Office mount (OFFICE-PHASE2 §4.5.2, §4.5.15): 165 seats with the app's faces, life started on the roster (or
// on neutral personalities), the veil lifted once the opening is placed, hover routing, presence into the scene, the
// ⌘K items, and an unmount that leaves no office, no style tag and no pending timers.
import { slimIndex } from '@headcount/catalog/slim';
import type { FaceFactory } from '@headcount/office';
import { CHIEF_ID } from '@headcount/protocol';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../catalog';
import type { PaletteItem } from '../components/Palette';
import { bubbles, resetCaptions } from '../living/captions';
import { officeStage } from '../living/viewer';
import { presence, settings, teamIds } from '../store';
import { resetOfficeFetch } from './fetch';
import { availabilityLine, hoverRoute, LIFE_START_CAP_MS, mountOffice, nameCardText, VEIL_CAP_MS } from './mount';

const LEAD = slimIndex.catalog.leads[0]!.id;
const faces: string[] = [];
const faceFactory: FaceFactory = (id) => {
  faces.push(id);
  const el = document.createElement('div');
  return { el, drawsChrome: true, setTier() {}, destroy: () => el.remove() };
};

let host: HTMLElement;
beforeAll(() => {
  catalog.value = slimIndex;
});
beforeEach(() => {
  // A full office: everyone in the directory hired (a new office starts with the Chief alone; see below).
  teamIds.value = slimIndex.catalog.personas.map((p) => p.id);
  document.body.innerHTML = '';
  host = document.createElement('div');
  host.style.width = '1200px';
  host.style.height = '800px';
  document.body.append(host);
  settings.value = { workspaceId: 'local', leadId: LEAD, chiefName: null, voiceOn: true, updatedAt: 'a', ambience: 'lively' };
  presence.value = {};
  faces.length = 0;
  resetCaptions();
  resetOfficeFetch();
  try {
    sessionStorage.clear();
  } catch {
    /* none */
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 404 }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetCaptions();
});

describe('mountOffice', () => {
  it('mounts 165 seats with the app’s faces, starts life, lifts the veil, and unmounts cleanly', async () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    let items: (() => PaletteItem[]) | null = null;
    const m = mountOffice({
      host,
      catalog: slimIndex,
      onRequestDirectory: vi.fn(),
      onReady,
      faceFactory,
      planIn: 'sync',
      assetsBase: null,
      search: '',
      dev: false,
      registerPaletteItems: (p) => {
        items = p;
        return () => (items = null);
      },
    });
    expect(host.querySelectorAll('.hc-o-seat')).toHaveLength(165);
    expect(host.querySelector(`.hc-o-seat[data-pid="${CHIEF_ID}"]`)).not.toBeNull();
    expect(document.getElementById('hc-office-style')).not.toBeNull();
    expect(officeStage.value).toEqual({ mode: 'desks', roomId: null });
    // No roster (404): life starts on neutral personalities after the cap.
    await vi.advanceTimersByTimeAsync(LIFE_START_CAP_MS + 50);
    expect(m.life.value).not.toBeNull();
    await vi.advanceTimersByTimeAsync(VEIL_CAP_MS);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(m.ready.value).toBe(true);
    // Presence reaches the scene.
    presence.value = { [CHIEF_ID]: { agentId: CHIEF_ID, state: 'working', label: 'Researching supplier prices', causeSeq: 3 } };
    expect(host.querySelector(`.hc-o-seat[data-pid="${CHIEF_ID}"]`)?.getAttribute('data-state')).toBe('working');
    // ⌘K: camera, life and sky while mounted.
    const labels = items!().map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['Office: let the camera wander', 'Pause office life', 'Office sky: Auto', 'Office sky: Night']));
    items!().find((i) => i.id === 'office-life-pause')!.run();
    expect(m.life.value!.getState().paused).toBe(true);
    m.destroy();
    expect(items).toBeNull();
    expect(host.querySelector('.hc-office')).toBeNull();
    expect(document.getElementById('hc-office-style')).toBeNull();
    expect(officeStage.value).toBeNull();
    expect(m.life.value).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('routes hover: nothing in a huddle, availability on a dwell away from the desk, the runtime at the desk', () => {
    expect(hoverRoute('huddle', 'dwell')).toBe('none');
    expect(hoverRoute('break', 'enter')).toBe('none');
    expect(hoverRoute('break', 'dwell')).toBe('availability');
    expect(hoverRoute('visit', 'dwell')).toBe('availability');
    expect(hoverRoute('walking', 'dwell')).toBe('availability');
    expect(hoverRoute('desk', 'enter')).toBe('living');
    expect(hoverRoute(undefined, 'dwell')).toBe('living');
    const day = new Date(2026, 8, 29, 10, 0);
    expect(availabilityLine('cw_kate', day)).toBe(availabilityLine('cw_kate', new Date(2026, 8, 29, 17, 0)));
    expect(availabilityLine('cw_kate', day)).toMatch(/\?$/);
  });

  it('a rest that gets no line shows a name card: role and where, in their pronouns, never a claim', () => {
    expect(nameCardText('Product ops', 'she/her', true)).toBe('Product ops · at her desk');
    expect(nameCardText('Copy lead', 'he/him', true)).toBe('Copy lead · at his desk');
    expect(nameCardText('Data analyst', 'they/them', true)).toBe('Data analyst · at their desk');
    expect(nameCardText('Data analyst', null, false)).toBe('Data analyst');
  });

  it('shows no bubble before anyone rests on a face', () => {
    const m = mountOffice({ host, catalog: slimIndex, onRequestDirectory: vi.fn(), faceFactory, planIn: 'sync', assetsBase: null, search: '', dev: false });
    expect(Object.keys(bubbles.value)).toEqual([]);
    m.destroy();
  });

  it('opens on a deep link: &room= enters that room, &focus= goes to that desk', () => {
    history.replaceState(null, '', '/app/floor?view=office&room=garden');
    const m = mountOffice({ host, catalog: slimIndex, onRequestDirectory: vi.fn(), faceFactory, planIn: 'sync', assetsBase: null, dev: false });
    expect(m.scene.getState()).toMatchObject({ mode: 'conference', roomId: 'garden' });
    expect(location.search).toBe('?view=office');
    m.destroy();
    const persona = slimIndex.catalog.personas[12]!;
    history.replaceState(null, '', `/app/floor?view=office&focus=${persona.id}`);
    const f = mountOffice({ host, catalog: slimIndex, onRequestDirectory: vi.fn(), faceFactory, planIn: 'sync', assetsBase: null, dev: false });
    expect(f.scene.getState().focusedId).toBe(`cw_${persona.id}`);
    f.destroy();
    history.replaceState(null, '', '/');
  });

  it('asks for the Directory through the skip link', () => {
    const onRequestDirectory = vi.fn();
    const m = mountOffice({ host, catalog: slimIndex, onRequestDirectory, faceFactory, planIn: 'sync', assetsBase: null, search: '', dev: false });
    (host.querySelector('.hc-o-skip') as HTMLAnchorElement).click();
    expect(onRequestDirectory).toHaveBeenCalledTimes(1);
    m.destroy();
  });

  it('a new office: the Chief alone until the owner hires, then the hires get desks', async () => {
    teamIds.value = [];
    const m = mountOffice({ host, catalog: slimIndex, onRequestDirectory: vi.fn(), faceFactory, planIn: 'sync', assetsBase: null, search: '', dev: false });
    expect([...host.querySelectorAll('.hc-o-seat')].map((s) => s.getAttribute('data-pid'))).toEqual([CHIEF_ID]);
    teamIds.value = ['bookkeeper', 'social-media-manager'];
    await new Promise((r) => setTimeout(r, 0));
    expect(host.querySelectorAll('.hc-o-seat')).toHaveLength(3);
    expect(host.querySelector('.hc-o-seat[data-pid="cw_bookkeeper"]')).not.toBeNull();
    m.destroy();
  });
});
