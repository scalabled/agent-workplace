import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timeOfDayAt } from '../time';
import { stageGeometry } from '../stage/perspective';
import { tableSeatsFor } from '../stage/stage';
import { createDwell } from './dwell';
import { allocateTiers, faceSize, lodFor } from './lod';

describe('lodFor', () => {
  it('picks the level from the zoom without history', () => {
    expect(lodFor(1.5)).toBe(0);
    expect(lodFor(3)).toBe(1);
    expect(lodFor(6)).toBe(2);
  });
  it('applies ±8 % hysteresis around the thresholds', () => {
    expect(lodFor(2.3, 0)).toBe(0);
    expect(lodFor(2.4, 0)).toBe(1);
    expect(lodFor(2.1, 1)).toBe(1);
    expect(lodFor(2.0, 1)).toBe(0);
    expect(lodFor(4.8, 1)).toBe(1);
    expect(lodFor(4.9, 1)).toBe(2);
    expect(lodFor(4.2, 2)).toBe(2);
    expect(lodFor(4.1, 2)).toBe(1);
  });
});

describe('faceSize', () => {
  it('clamps per level and scales the Chief by 1.35', () => {
    expect(faceSize(0, 9)).toBe(0);
    // L1: clamp(24, 5.2 u × zoom, 32), small enough that the chair back and base show around the badge.
    expect(faceSize(1, 2.3)).toBe(24);
    expect(faceSize(1, 4.4)).toBe(24);
    expect(faceSize(1, 5.9)).toBe(31);
    expect(faceSize(1, 8)).toBe(32);
    expect(faceSize(2, 5)).toBe(40);
    expect(faceSize(2, 9)).toBe(56);
    expect(faceSize(2, 20)).toBe(58);
    expect(faceSize(1, 4, true)).toBe(Math.round(24 * 1.35));
  });
});

describe('allocateTiers', () => {
  it('gives at most three tiles, by priority', () => {
    const tiers = allocateTiers([
      { id: 'a', bubble: true },
      { id: 'b', focused: true },
      { id: 'c', hovered: true },
      { id: 'd', speaking: true },
      { id: 'e' },
      { id: 'f', dragging: true },
    ]);
    const tiles = [...tiers].filter(([, t]) => t === 'tile').map(([id]) => id);
    expect(tiles.sort()).toEqual(['c', 'd', 'f']);
    expect(tiers.get('a')).toBe('token');
    expect(tiers.get('e')).toBe('token');
  });
});

describe('createDwell', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires enter at once and dwell after 600 ms of rest', () => {
    let t = 0;
    const events: string[] = [];
    const d = createDwell({ now: () => t, onEnter: (id, v) => events.push(`enter:${id}:${v}`), onDwell: (id, v) => events.push(`dwell:${id}:${v}`), onLeave: (id) => events.push(`leave:${id}`) });
    d.pointer('juno', 10, 10);
    expect(events).toEqual(['enter:juno:pointer']);
    vi.advanceTimersByTime(599);
    expect(events).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(events).toEqual(['enter:juno:pointer', 'dwell:juno:pointer']);
    d.pointer(null, 0, 0);
    expect(events.at(-1)).toBe('leave:juno');
  });

  it('restarts the rest timer on fast motion and camera moves', () => {
    let t = 0;
    const events: string[] = [];
    const d = createDwell({ now: () => t, onEnter: () => {}, onDwell: (id) => events.push(id), onLeave: () => {} });
    d.pointer('walt', 0, 0);
    vi.advanceTimersByTime(400);
    t = 400;
    d.pointer('walt', 0, 0);
    t = 410;
    d.pointer('walt', 20, 0); // 2 px/ms: restarts
    vi.advanceTimersByTime(400);
    expect(events).toEqual([]);
    d.cameraMoved();
    vi.advanceTimersByTime(599);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(['walt']);
  });

  it('dwells after 900 ms of keyboard focus and at once on a touch tap', () => {
    const events: string[] = [];
    const d = createDwell({ onEnter: () => {}, onDwell: (id, v) => events.push(`${id}:${v}`), onLeave: () => {} });
    d.keyboard('lena');
    vi.advanceTimersByTime(899);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(['lena:keyboard']);
    d.tap('pax');
    expect(events).toEqual(['lena:keyboard', 'pax:touch']);
  });
});

describe('timeOfDayAt', () => {
  const at = (h: number, m: number) => timeOfDayAt(new Date(2026, 8, 28, h, m));
  it('switches at 05:30, 07:30, 17:30 and 19:30', () => {
    expect(at(5, 29)).toBe('night');
    expect(at(5, 30)).toBe('dusk');
    expect(at(7, 29)).toBe('dusk');
    expect(at(7, 30)).toBe('day');
    expect(at(17, 29)).toBe('day');
    expect(at(17, 30)).toBe('dusk');
    expect(at(19, 30)).toBe('night');
    expect(at(0, 0)).toBe('night');
  });
});

describe('stageGeometry', () => {
  it('seats the Skyline room: far head plus four per side, far seats smaller than near ones', () => {
    const g = stageGeometry(1440, 900, 10);
    expect(g.seats).toHaveLength(9);
    const left = g.seats.filter((s) => s.side === 'left');
    expect(left).toHaveLength(4);
    for (let i = 1; i < left.length; i++) {
      expect(left[i]!.size).toBeGreaterThan(left[i - 1]!.size);
      expect(left[i]!.y).toBeGreaterThan(left[i - 1]!.y);
      expect(left[i]!.x).toBeLessThan(left[i - 1]!.x);
    }
    expect(left[0]!.size / g.base).toBeCloseTo(0.62, 2);
    expect(left[3]!.size / g.base).toBeCloseTo(0.96, 2);
    // Near seats stay clear of the captions and dock.
    for (const s of g.seats) expect(s.y + s.size / 2).toBeLessThan(900 - 120);
  });
  it('seats the Garden room with three per side', () => {
    expect(stageGeometry(1280, 800, 8).seats).toHaveLength(7);
  });
  it('shortens the table for a small party and keeps each tent card with its owner', () => {
    const full = stageGeometry(1440, 900, 10);
    const small = stageGeometry(1440, 900, tableSeatsFor(4));
    expect(small.seats).toHaveLength(5);
    // The far end comes toward the owner and the far pair is larger than on the full table.
    expect(small.table.farY).toBeGreaterThan(full.table.farY);
    expect(small.seats[1]!.size).toBeGreaterThan(full.seats[1]!.size);
    for (const g of [full, small]) {
      for (const seat of g.seats.slice(1)) {
        const toward = seat.side === 'left' ? 1 : -1;
        expect((seat.card.x - seat.x) * toward).toBeCloseTo(0.25 * seat.size, 5);
        // Under the chin, clear of the speaking lift (scale 1.18).
        expect(seat.card.y).toBeGreaterThan(seat.y + (seat.size / 2) * 1.18);
      }
    }
    expect(tableSeatsFor(1)).toBe(5);
    expect(tableSeatsFor(5)).toBe(6);
    expect(tableSeatsFor(2, 6)).toBe(8);
  });
});
