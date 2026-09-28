import { describe, expect, it } from 'vitest';
import { applyMoodEvent, baselineMood, createMoodState, expressionBias, moodAt, moodChanged, ownerFacing, reactivityOf } from './mood';
import { archetypesFile, PROFILES, T0 } from './testing';
import { MOOD_DELTAS, MOOD_HALF_LIFE_MS } from './vocab';
import type { MoodEventKind } from './vocab';

const MIN = 60_000;

describe('baseline and reactivity (§6.1)', () => {
  it('follows the formulas with the blend’s mood bias', () => {
    const p = PROFILES.chief.personality; // warmth 90, humor 50, pace 30, risk 40
    const b = baselineMood(p, { warm: 0.5, gentle: 0.3, veteran: 0.2 }, archetypesFile);
    // v = 0.10 + 0.25·0.8 + 0.10·0 + (0.5·0.15 + 0.3·0.1 + 0.2·0.05) = 0.415
    expect(b.valence).toBeCloseTo(0.415, 3);
    // e = 0.30·(−0.4) + 0 + 0.10·(−0.2) + (0 − 0.045 − 0.02) = −0.205
    expect(b.energy).toBeCloseTo(-0.205, 3);
    expect(reactivityOf(p)).toBeCloseTo(0.6 + 0 + 0.15 * -0.4, 3);
    expect(reactivityOf({ ...p, traits: ['calm'] })).toBe(0.35); // 0.34 clamped to the 0.35 floor
  });
  it('clamps to the documented ranges', () => {
    const hi = { sliders: { warmth: 100, directness: 50, formality: 50, humor: 100, risk_appetite: 100, detail: 50, pace: 100 }, traits: [] };
    expect(baselineMood(hi, { energetic: 1 }, archetypesFile)).toEqual({ valence: 0.5, energy: 0.5 });
    expect(reactivityOf(hi)).toBe(0.9);
    const lo = { sliders: { warmth: 0, directness: 50, formality: 50, humor: 0, risk_appetite: 0, detail: 50, pace: 0 }, traits: ['steady'] };
    expect(baselineMood(lo, { 'calm-steady': 1 }, archetypesFile)).toEqual({ valence: -0.2, energy: -0.4 }); // 0.1 − 0.25 − 0.1 + 0.05; energy clamped
    expect(reactivityOf(lo)).toBe(0.35);
  });
});

describe('dynamics (§6.2)', () => {
  const base = { valence: 0.1, energy: 0.1 };

  it('decays toward the baseline with 45 min (valence) and 20 min (energy) half-lives', () => {
    const s = { ...createMoodState('a', base, 1, T0), value: { valence: 0.9, energy: 0.9 } };
    const m = moodAt(s, T0 + MOOD_HALF_LIFE_MS.energy);
    expect(m.energy).toBeCloseTo(0.1 + 0.8 / 2, 6);
    expect(moodAt(s, T0 + MOOD_HALF_LIFE_MS.valence).valence).toBeCloseTo(0.1 + 0.8 / 2, 6);
    expect(moodAt(s, T0 + 24 * 60 * MIN).valence).toBeCloseTo(0.1, 3);
    expect(moodAt(s, T0 - 5 * MIN)).toEqual(s.value); // no negative time
  });

  it('wins lift, blockers weigh, with soft saturation that never leaves [−1, 1]', () => {
    let s = createMoodState('a', base, 1, T0);
    s = applyMoodEvent(s, { kind: 'deliverable.accepted', at: T0, cause: { streamId: 'p:prj', seq: 7 } });
    expect(s.value.valence).toBeCloseTo(0.1 + 0.35 * 0.9, 6);
    expect(s.lastKind).toBe('deliverable.accepted');
    expect(s.lastCause).toEqual({ streamId: 'p:prj', seq: 7 });
    const blocked = applyMoodEvent(createMoodState('a', base, 1, T0), { kind: 'step.blocked', at: T0 });
    expect(blocked.value.valence).toBeLessThan(base.valence);
    for (let i = 0; i < 200; i++) s = applyMoodEvent(s, { kind: (i % 2 ? 'project.done' : 'everyone.stop') as MoodEventKind, at: T0, scale: 3 });
    expect(Math.abs(s.value.valence)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.value.energy)).toBeLessThanOrEqual(1);
  });

  it('scales by reactivity and event scale, and damps a sceptic’s positive valence by 0.7', () => {
    const s = createMoodState('a', { valence: 0, energy: 0 }, 0.5, T0);
    const a = applyMoodEvent(s, { kind: 'owner.praise', at: T0, scale: 2 });
    expect(a.value.valence).toBeCloseTo(0.25, 6); // 0.5 · 2 · 0.25
    const sc = applyMoodEvent(s, { kind: 'owner.praise', at: T0, scale: 2 }, { sceptic: true });
    expect(sc.value.valence).toBeCloseTo(0.175, 6);
    const neg = applyMoodEvent(s, { kind: 'verdict.block', at: T0 }, { sceptic: true });
    expect(neg.value.valence).toBeCloseTo(-0.125, 6); // negative deltas are not damped
  });

  it('decays to the event time before applying it', () => {
    const s = { ...createMoodState('a', base, 1, T0), value: { valence: 0.9, energy: 0.1 } };
    const later = applyMoodEvent(s, { kind: 'work.hour', at: T0 + MOOD_HALF_LIFE_MS.valence });
    expect(later.value.valence).toBeCloseTo(0.5, 6);
    expect(later.at).toBe(T0 + MOOD_HALF_LIFE_MS.valence);
    expect(MOOD_DELTAS['work.hour']).toEqual({ valence: 0, energy: -0.08 });
  });

  it('keeps owner-facing valence composed at −0.3', () => {
    expect(ownerFacing({ valence: -0.8, energy: -0.2 })).toEqual({ valence: -0.3, energy: -0.2 });
    expect(ownerFacing({ valence: 0.4, energy: 0 })).toEqual({ valence: 0.4, energy: 0 });
  });
});

describe('expressionBias (§6.4)', () => {
  it('resolves cue > presence > mood, with subtle weights', () => {
    expect(expressionBias({ valence: 0.9, energy: 0 }, 'idle', { cue: { gesture: 'wince', expression: 'concerned', holdMs: 800 } }).expression).toBe('concerned');
    expect(expressionBias({ valence: 0.9, energy: 0 }, 'raised_hand')).toMatchObject({ expression: 'concerned', weight: 0.6 });
    expect(expressionBias({ valence: 0.9, energy: 0 }, 'working')).toMatchObject({ expression: 'thinking', weight: 0.5 });
    expect(expressionBias({ valence: 0.9, energy: 0 }, 'idle')).toMatchObject({ expression: 'delighted', weight: 0.35 });
    expect(expressionBias({ valence: 0.44, energy: 0 }, 'idle')).toMatchObject({ expression: 'resting', weight: 0 });
    const d = expressionBias({ valence: 0.6, energy: 0 }, 'listening');
    expect(d.expression).toBe('delighted');
    expect(d.weight).toBeGreaterThan(0);
    expect(d.weight).toBeLessThan(0.35);
    expect(expressionBias({ valence: -0.29, energy: 0 }, 'idle').expression).toBe('resting');
    expect(expressionBias({ valence: -0.8, energy: 0 }, 'idle')).toMatchObject({ expression: 'concerned', weight: 0.3 });
  });
  it('reproduces the §10.4 example and freezes motion under reduced motion', () => {
    expect(expressionBias({ valence: 0.41, energy: 0.33 }, 'idle')).toEqual({ expression: 'resting', weight: 0, cornerPull: 0.103, brow: 0, pitchDeg: 0.66, blinkScale: 1.051, swayScale: 1.083 });
    const r = expressionBias({ valence: 0.41, energy: 0.8 }, 'idle', { reducedMotion: true });
    expect(r.blinkScale).toBe(1);
    expect(r.swayScale).toBe(1);
  });
  it('signals mood.changed on ≥ 0.15 moves or palette changes only', () => {
    const b = expressionBias({ valence: 0, energy: 0 }, 'idle');
    expect(moodChanged({ valence: 0, energy: 0 }, { valence: 0.1, energy: 0.1 }, b, b)).toBe(false);
    expect(moodChanged({ valence: 0, energy: 0 }, { valence: 0.15, energy: 0 }, b, b)).toBe(true);
    expect(moodChanged({ valence: 0, energy: 0 }, { valence: 0.05, energy: 0 }, b, { ...b, expression: 'thinking' })).toBe(true);
  });
});
