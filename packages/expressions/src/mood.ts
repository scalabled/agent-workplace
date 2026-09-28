// Mood: valence and energy in −1…1, a pure fold over ledger events with exponential decay (§6).
import type { PresenceState } from '@headcount/protocol';
import { clamp, num } from './internal';
import type { ArchetypeBlend, ArchetypesFile, ExpressionBias, FaceCue, MoodEvent, MoodState, PersonalityInput } from './types';
import { MOOD_DELTAS, MOOD_HALF_LIFE_MS } from './vocab';
import type { ArchetypeId, Mood, PaletteState } from './vocab';

const norm = (s: unknown): number => clamp((num(s, 50) - 50) / 50, -1, 1);
const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const CALM_TRAITS = new Set(['calm', 'steady', 'unflappable', 'composed']);

/** Baseline mood from personality sliders (normalised as (s − 50) / 50) plus the blend's archetype mood_bias (§6.1). */
export function baselineMood(p: PersonalityInput, blend: ArchetypeBlend, archetypes: ArchetypesFile): Mood {
  const s = p.sliders;
  let bv = 0;
  let be = 0;
  for (const [id, w] of Object.entries(blend) as [ArchetypeId, number][]) {
    const def = archetypes.archetypes.find((a) => a.id === id);
    if (!def || !(w > 0)) continue;
    bv += w * num(def.mood_bias?.valence, 0);
    be += w * num(def.mood_bias?.energy, 0);
  }
  return {
    valence: round3(clamp(0.1 + 0.25 * norm(s?.warmth) + 0.1 * norm(s?.humor) + bv, -0.3, 0.5)),
    energy: round3(clamp(0.3 * norm(s?.pace) + 0.1 * norm(s?.humor) + 0.1 * norm(s?.risk_appetite) + be, -0.4, 0.5)),
  };
}

/** How strongly events move this agent's mood (§6.1): humour and pace raise it, calm traits damp it. */
export function reactivityOf(p: PersonalityInput): number {
  const calm = (p.traits ?? []).some((t) => CALM_TRAITS.has(String(t).toLowerCase())) ? 1 : 0;
  return round3(clamp(0.6 + 0.15 * norm(p.sliders?.humor) + 0.15 * norm(p.sliders?.pace) - 0.2 * calm, 0.35, 1));
}

export function createMoodState(agentId: string, baseline: Mood, reactivity: number, now: number): MoodState {
  return { agentId, baseline: { ...baseline }, reactivity, value: { ...baseline }, at: now, lastCause: null, lastKind: null };
}

/** Mood at `now`: each axis decays toward the baseline with its own half-life. Pure; clients decay locally. */
export function moodAt(s: MoodState, now: number): Mood {
  const dt = Math.max(0, now - s.at);
  const fv = Math.pow(2, -dt / MOOD_HALF_LIFE_MS.valence);
  const fe = Math.pow(2, -dt / MOOD_HALF_LIFE_MS.energy);
  return {
    valence: s.baseline.valence + (s.value.valence - s.baseline.valence) * fv,
    energy: s.baseline.energy + (s.value.energy - s.baseline.energy) * fe,
  };
}

const saturate = (m: number, d: number): number => clamp(m + d * (1 - m * Math.sign(d)), -1, 1);

/** Fold one event in: Δ' = ρ · scale · Δ with soft saturation; sceptics damp positive valence by 0.7 (§6.2). */
export function applyMoodEvent(s: MoodState, e: MoodEvent, opts?: { sceptic?: boolean }): MoodState {
  const at = Math.max(s.at, e.at);
  const current = moodAt(s, at);
  const delta = MOOD_DELTAS[e.kind];
  if (!delta) return s;
  const k = s.reactivity * num(e.scale, 1);
  let dv = delta.valence * k;
  const de = delta.energy * k;
  if (opts?.sceptic && dv > 0) dv *= 0.7;
  return {
    ...s,
    value: { valence: saturate(current.valence, dv), energy: saturate(current.energy, de) },
    at,
    lastCause: e.cause ?? null,
    lastKind: e.kind,
  };
}

/** Owner-facing lines stay composed: valence is clamped at `floor` (default −0.3, §5.3, H7). */
export function ownerFacing(m: Mood, floor = -0.3): Mood {
  return { valence: Math.max(floor, m.valence), energy: m.energy };
}

/** Emit `mood.changed` when either axis moved ≥ 0.15 or the palette state changed (§6.3). */
export function moodChanged(prev: Mood, next: Mood, prevBias: ExpressionBias, nextBias: ExpressionBias): boolean {
  return Math.abs(next.valence - prev.valence) >= 0.15 || Math.abs(next.energy - prev.energy) >= 0.15 || prevBias.expression !== nextBias.expression;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Procedural-face presets per palette state (§6.4), scaled by the expression weight. */
const PRESET: Readonly<Record<PaletteState, { cornerPull: number; brow: number; pitchDeg: number }>> = {
  resting: { cornerPull: 0, brow: 0, pitchDeg: 0 },
  delighted: { cornerPull: 0.35, brow: 0.05, pitchDeg: 0 },
  concerned: { cornerPull: -0.15, brow: 0.4, pitchDeg: -2 },
  thinking: { cornerPull: 0, brow: 0.3, pitchDeg: 4 },
};

/**
 * Mood → face (§6.4). Order: an active reflex cue with an expression, then presence (raised hand →
 * concerned 0.6; thinking/working → thinking 0.5), then mood (v ≥ 0.45 delighted, v ≤ −0.3 concerned),
 * else resting. A subtle bias on purpose: a persistent grin reads as fake.
 */
export function expressionBias(m: Mood, presence: PresenceState, opts?: { reducedMotion?: boolean; cue?: FaceCue | null }): ExpressionBias {
  const v = clamp(m.valence, -1, 1);
  const e = clamp(m.energy, -1, 1);
  let expression: PaletteState = 'resting';
  let weight = 0;
  if (opts?.cue?.expression) {
    expression = opts.cue.expression;
    weight = clamp(num(opts.cue.weight, 0.8), 0, 1);
  } else if (presence === 'raised_hand') {
    expression = 'concerned';
    weight = 0.6;
  } else if (presence === 'thinking' || presence === 'working') {
    expression = 'thinking';
    weight = 0.5;
  } else if (v >= 0.45) {
    expression = 'delighted';
    weight = 0.35 * smoothstep(0.45, 0.9, v);
  } else if (v <= -0.3) {
    expression = 'concerned';
    weight = 0.3 * smoothstep(0.3, 0.8, -v);
  }
  const preset = PRESET[expression];
  const reduced = !!opts?.reducedMotion;
  return {
    expression,
    weight: round3(weight),
    cornerPull: round3(clamp(0.25 * v + preset.cornerPull * weight, -1, 1)),
    brow: round3(clamp(preset.brow * weight, -1, 1)),
    pitchDeg: round3(2 * e + preset.pitchDeg * weight),
    blinkScale: reduced ? 1 : round3(1.15 - 0.3 * e),
    swayScale: reduced ? 1 : round3(1 + 0.25 * e),
  };
}
