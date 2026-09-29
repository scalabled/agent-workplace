// Small pure pieces of office life: personality knobs, the claim ladder, the activity classifier, turn timing,
// moment scores, the autopilot policy and the follow spring.
import { describe, expect, it } from 'vitest';
import { activityOf } from './activity';
import { readingMs, timeTurns } from './choreo';
import { lifeKnobs } from './knobs';
import { AUTOPILOT, autopilotDue, followTarget, scoreMoments, springStep } from './moments';
import type { MomentCandidate } from './moments';
import { resolveClaim } from './overrides';
import { todDensity } from './tables';

describe('office life units', () => {
  it('turns personality into habits (sociability from warmth and humour, restlessness from pace)', () => {
    const warm = lifeKnobs({ id: 'a', groupId: 'x', sliders: { warmth: 95, humor: 85, detail: 60, pace: 80 }, traits: ['warm', 'playful'] });
    const reserved = lifeKnobs({ id: 'b', groupId: 'x', sliders: { warmth: 50, humor: 35, detail: 95, pace: 30 }, traits: ['reserved', 'calm'] });
    expect(warm.s).toBeGreaterThan(0.8);
    expect(reserved.s).toBeLessThan(0.2);
    expect(warm.r).toBeGreaterThan(reserved.r);
    expect(warm.s).toBeLessThanOrEqual(0.9);
    expect(reserved.s).toBeGreaterThanOrEqual(0.1);
    // Missing data is neutral.
    const blank = lifeKnobs({ id: 'c', groupId: 'x' });
    expect(blank.s).toBeCloseTo(0.5, 5);
    expect(blank.blend).toEqual({ 'calm-steady': 1 });
    expect(lifeKnobs({ id: 'd', groupId: 'research-insights' }).c).toBeGreaterThan(blank.c);
  });

  it('resolves real state over the plan in priority order', () => {
    expect(resolveClaim([])).toBeNull();
    expect(resolveClaim([{ kind: 'work', where: 'workplace' }, { kind: 'owner', where: 'here' }])).toEqual({ kind: 'owner', where: 'here', pace: 'none' });
    expect(resolveClaim([{ kind: 'conversation' }, { kind: 'hand' }])!.kind).toBe('hand');
    expect(resolveClaim([{ kind: 'hand' }])).toEqual({ kind: 'hand', where: 'desk', pace: 'brisk' });
    expect(resolveClaim([{ kind: 'room' }, { kind: 'work' }])!.pace).toBe('none');
    expect(resolveClaim([{ kind: 'conversation' }])!.pace).toBe('none');
  });

  it('classifies work labels conservatively', () => {
    expect(activityOf('Researching supplier prices')).toBe('research');
    expect(activityOf('Reading 14 reports')).toBe('research');
    expect(activityOf('Looking into returns')).toBe('research');
    expect(activityOf('Comparing three quotes')).toBe('research');
    expect(activityOf('Drafting the launch note')).toBe('document');
    expect(activityOf('Editing the brief')).toBe('document');
    expect(activityOf('Thinking it through')).toBeNull();
    expect(activityOf('')).toBeNull();
    expect(activityOf(null)).toBeNull();
  });

  it('times turns one at a time with reading-time bubbles', () => {
    expect(readingMs('Hi')).toBe(2200);
    expect(readingMs('x'.repeat(200))).toBe(6000);
    const turns = timeTurns(
      {
        exchangeId: 'x',
        lines: [
          { personId: 'a', kind: 'line', text: "I'd grab an espresso if I had hands.", atMs: 0, estMs: 0 },
          { personId: 'b', kind: 'line', text: 'I just like standing near it.', atMs: 0, estMs: 0 },
          { personId: 'a', kind: 'laugh', text: '(chuckles)', atMs: 0, estMs: 0 },
          { personId: 'b', kind: 'face', text: '', face: 'smile', atMs: 0, estMs: 0 },
        ],
      },
      () => 0.5,
    );
    for (let i = 1; i < turns.length; i++) expect(turns[i]!.at).toBeGreaterThanOrEqual(turns[i - 1]!.at + turns[i - 1]!.ttl + 600);
    expect(turns[2]!.ttl).toBeGreaterThanOrEqual(1200);
    expect(turns[3]!.ttl).toBe(900);
  });

  it('scores moments: hands first, recently shown ones sink, far ones fade', () => {
    const base = { zoom: 3.2, personIds: ['p'], endsAt: 100_000, label: 'x' };
    const c: MomentCandidate[] = [
      { ...base, id: 'h', kind: 'huddle', at: { x: 0, y: 0 } },
      { ...base, id: 'r', kind: 'raised_hand', at: { x: 0, y: 0 } },
      { ...base, id: 'far', kind: 'debate', at: { x: 2000, y: 0 } },
      { ...base, id: 'short', kind: 'huddle', at: { x: 0, y: 0 }, endsAt: 5_000 },
    ];
    const s = scoreMoments(c, { center: { x: 0, y: 0 }, now: 0, shownAt: new Map([['h', -60_000]]) });
    expect(s.map((m) => m.id)).toEqual(['r', 'h', 'far']);
    expect(s.find((m) => m.id === 'h')!.score).toBe(5);
  });

  it('flies the autopilot only after 20 s of calm, never too often, and backs off after the owner steps in', () => {
    const now = 100_000;
    expect(autopilotDue({ lastInput: now - 10_000, flights: [], holdUntil: 0, interruptedAt: null }, now)).toBe(false);
    expect(autopilotDue({ lastInput: now - AUTOPILOT.idleMs, flights: [], holdUntil: 0, interruptedAt: null }, now)).toBe(true);
    expect(autopilotDue({ lastInput: 0, flights: [now - 5000], holdUntil: 0, interruptedAt: null }, now)).toBe(false);
    expect(autopilotDue({ lastInput: 0, flights: [now - 50_000, now - 40_000, now - 30_000, now - 20_000, now - 11_000], holdUntil: 0, interruptedAt: null }, now)).toBe(false);
    expect(autopilotDue({ lastInput: 0, flights: [], holdUntil: now + 1, interruptedAt: null }, now)).toBe(false);
    expect(autopilotDue({ lastInput: 0, flights: [], holdUntil: 0, interruptedAt: now - 30_000 }, now)).toBe(false);
  });

  it('follows a walker with a critically damped spring that keeps them inside the inset', () => {
    let cam = { x: 0, y: 0 };
    let v = { x: 0, y: 0 };
    const half = { w: 200, h: 120 };
    let worst = 0;
    for (let i = 0; i < 60 * 60; i++) {
      const t = i / 60;
      const walker = { x: 42 * t, y: 20 * Math.sin(t / 3) };
      const target = followTarget(cam, walker, half.w, half.h, 0.25);
      const [x, vx] = springStep(cam.x, v.x, target.x, 1 / 60);
      const [y, vy] = springStep(cam.y, v.y, target.y, 1 / 60);
      cam = { x, y };
      v = { x: vx, y: vy };
      worst = Math.max(worst, Math.abs(walker.x - cam.x) / half.w);
    }
    // The walker never leaves the view (|offset| < half width) while strolling at 42 u/s.
    expect(worst).toBeLessThan(1);
    const [x] = springStep(0, 0, 10, 5);
    expect(x).toBeCloseTo(10, 3);
  });

  it('has a time-of-day curve: busier mid-morning, quiet at night', () => {
    expect(todDensity(10 * 60)).toBe(1);
    expect(todDensity(3 * 60)).toBe(0.25);
    expect(todDensity(12 * 60)).toBe(0.9);
    expect(todDensity(21 * 60)).toBe(0.45);
  });
});
