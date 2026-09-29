// Office | Directory (OFFICE-PHASE2 §4.5.1): ?view= wins and is remembered, then the remembered choice, then the
// device default (the Office on a fine pointer ≥ 900 px, the Directory on phones and coarse pointers).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clockShift, officeClock } from './clock';
import { FLOOR_VIEW_KEY, clearDeepLink, defaultView, readDeepLink, resolveView, setFloorView, floorView } from './view';

const media = (matches: boolean) => vi.spyOn(window, 'matchMedia').mockImplementation(((q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia);

describe('the Floor view', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('defaults to the Office on a fine pointer at least 900 px wide, else the Directory', () => {
    media(true);
    expect(defaultView()).toBe('office');
    vi.restoreAllMocks();
    media(false);
    expect(defaultView()).toBe('directory');
  });

  it('?view= wins and is remembered; the remembered choice beats the device default', () => {
    media(true);
    expect(resolveView('?view=directory')).toBe('directory');
    expect(localStorage.getItem(FLOOR_VIEW_KEY)).toBe('directory');
    expect(resolveView('')).toBe('directory');
    expect(resolveView('?view=office')).toBe('office');
    expect(resolveView('?view=nonsense')).toBe('office');
    setFloorView('directory');
    expect(floorView.value).toBe('directory');
    expect(resolveView('')).toBe('directory');
  });

  it('the toggle rewrites a ?view= in the address, so a reload keeps the choice', () => {
    history.replaceState(null, '', '/app/floor?view=office&at=10:35');
    setFloorView('directory');
    expect(location.search).toBe('?view=directory&at=10:35');
    expect(resolveView()).toBe('directory');
    history.replaceState(null, '', '/app/floor');
    setFloorView('office');
    expect(location.search).toBe('');
  });

  it('works when storage throws', () => {
    media(false);
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(resolveView('?view=office')).toBe('office');
    expect(resolveView('')).toBe('directory');
  });

  it('reads the deep links once and drops them from the address (view stays)', () => {
    expect(readDeepLink('?view=office&room=skyline&focus=kate-rivera')).toEqual({ room: 'skyline', focus: 'kate-rivera' });
    expect(readDeepLink('?room=basement&focus=<script>')).toEqual({ room: null, focus: null });
    history.replaceState(null, '', '/app/floor?view=office&room=garden&focus=kate-rivera');
    clearDeepLink();
    expect(location.search).toBe('?view=office');
  });
});

describe('the office clock', () => {
  it('?at=HH:MM shifts it in dev builds only', () => {
    const now = new Date(2026, 8, 29, 8, 0, 0);
    expect(clockShift('?at=10:35', now)).toBe((2 * 60 + 35) * 60_000);
    expect(clockShift('?at=25:00', now)).toBe(0);
    expect(clockShift('', now)).toBe(0);
    const dev = officeClock('?at=23:10', true)();
    expect(dev.getHours()).toBe(23);
    expect([9, 10]).toContain(dev.getMinutes());
    const prod = officeClock('?at=23:10', false)();
    expect(Math.abs(prod.getTime() - Date.now())).toBeLessThan(1000);
  });
});
