import { describe, expect, it } from 'vitest';
import { createChatterBudget, createTimingGate, reflexProbability } from './gate';
import { seededRng } from './hash';
import { fixtureCatalog, fixtureIndex, T0 } from './testing';
import type { GateInput, GateVerdict } from './types';
import type { Ambience, IntentId } from './vocab';

const catalog = fixtureCatalog();

function input(intent: IntentId, over: Partial<GateInput> = {}): GateInput {
  return {
    agentId: 'cw_chief', intent, now: T0, ambience: 'lively', surface: 'talk', turnId: 'turn_1', ownerSpeaking: false, agentVoiceBusy: false,
    foregroundAudio: false, ownerAtStage: true, audioArmed: true, voiceOn: true, listening: false, exchange: 'voice', quietHours: false,
    reducedMotion: false, approvalInProgress: false, stopped: false, pageVisible: true, ...over,
  };
}
function setup(ambience: Ambience = 'lively') {
  const budget = createChatterBudget(catalog.ambience, ambience);
  return { budget, gate: createTimingGate(catalog, budget) };
}
const rng = () => seededRng('gate-test');
const plan = (v: GateVerdict) => {
  if (!v.allow) throw new Error(`denied: ${v.reason}`);
  return v.plan;
};

describe('silence rules (§1.4)', () => {
  it('never over the owner: only a backchannel nod while the owner speaks', () => {
    const { gate } = setup();
    expect(gate.check(input('backchannel', { ownerSpeaking: true }), rng())).toEqual({ allow: false, reason: 'owner_speaking', faceOnly: { gesture: 'nod', holdMs: 400 } });
    expect(gate.check(input('acknowledge', { ownerSpeaking: true }), rng())).toEqual({ allow: false, reason: 'owner_speaking', faceOnly: null });
  });
  it('stop, approval read-backs and hidden pages silence reflexes', () => {
    const { gate } = setup();
    expect(gate.check(input('acknowledge', { stopped: true }), rng())).toMatchObject({ allow: false, reason: 'stopped', faceOnly: null });
    expect(gate.check(input('backchannel', { approvalInProgress: true }), rng())).toMatchObject({ allow: false, reason: 'approval', faceOnly: null });
    expect(gate.check(input('passing_by', { surface: 'floor', ownerAtStage: false, exchange: 'none', pageVisible: false }), rng())).toMatchObject({ allow: false, reason: 'hidden' });
    expect(gate.check(input('acknowledge', { pageVisible: false }), rng()).allow).toBe(true); // owner-directed follows the conversation
  });
  it('one voice: a speaking agent only juggles', () => {
    const { gate } = setup();
    expect(gate.check(input('acknowledge', { agentVoiceBusy: true }), rng())).toMatchObject({ allow: false, reason: 'voice_busy' });
    expect(gate.check(input('juggling', { agentVoiceBusy: true }), rng()).allow).toBe(true);
  });
});

describe('Ambience levels (§9.1)', () => {
  it('Quiet: functional reflexes voiced, expressive ones face-only, chatter off', () => {
    const { gate } = setup('quiet');
    expect(plan(gate.check(input('acknowledge', { ambience: 'quiet' }), rng())).voice).toBe(true);
    expect(gate.check(input('laugh', { ambience: 'quiet' }), rng())).toMatchObject({ allow: false, reason: 'ambience', faceOnly: { gesture: 'smile', expression: 'delighted' } });
    expect(gate.check(input('backchannel', { ambience: 'quiet' }), rng())).toMatchObject({ allow: false, faceOnly: { gesture: 'nod' } });
    const floor = { ambience: 'quiet' as const, surface: 'floor' as const, ownerAtStage: false, exchange: 'none' as const };
    expect(gate.check(input('passing_by', floor), rng())).toMatchObject({ allow: false, reason: 'ambience', faceOnly: { gesture: 'look_up' } });
    expect(gate.check(input('quip', floor), rng())).toEqual({ allow: false, reason: 'ambience', faceOnly: null });
    expect(gate.check(input('handoff_give', floor), rng())).toMatchObject({ allow: false, reason: 'ambience', faceOnly: null });
  });
  it('Lively: side-talk as bubbles, voiced only while listening in; Buzzing voices it on the Floor', () => {
    const lively = setup('lively');
    const floor = { surface: 'floor' as const, ownerAtStage: false, exchange: 'none' as const };
    expect(plan(lively.gate.check(input('handoff_give', { ...floor, listening: true }), rng()))).toMatchObject({ voice: false, bubble: true });
    const buzzing = setup('buzzing');
    expect(plan(buzzing.gate.check(input('handoff_give', { ...floor, ambience: 'buzzing' }), rng()))).toMatchObject({ voice: true, bubble: true, gainDb: -6 });
    expect(plan(lively.gate.check(input('passing_by', floor), rng()))).toMatchObject({ voice: true, bubble: true, gainDb: -4, caption: 'line' });
  });
  it('quiet hours follow the Quiet column for chatter only; replies to a greeting bypass Ambience', () => {
    const { gate } = setup();
    const floor = { surface: 'floor' as const, ownerAtStage: false, exchange: 'none' as const, quietHours: true };
    expect(gate.check(input('passing_by', floor), rng())).toMatchObject({ allow: false, reason: 'ambience' });
    expect(gate.check(input('acknowledge', { quietHours: true }), rng()).allow).toBe(true);
    const q = setup('quiet');
    expect(q.gate.check(input('greeting', { ambience: 'quiet', exchange: 'none' }), rng())).toMatchObject({ allow: false, reason: 'ambience' });
    expect(plan(q.gate.check(input('greeting', { ambience: 'quiet', exchange: 'voice' }), rng())).voice).toBe(true);
  });
});

describe('channels (§3.2)', () => {
  it('voice follows the intent policy; text exchanges get bubbles only where the intent allows', () => {
    const { gate } = setup();
    expect(gate.check(input('acknowledge', { exchange: 'text' }), rng())).toMatchObject({ allow: false, reason: 'face_only', faceOnly: { gesture: 'nod' } });
    expect(plan(gate.check(input('thinking_filler', { exchange: 'text' }), rng()))).toMatchObject({ voice: false, bubble: true, caption: 'none' });
    expect(plan(gate.check(input('gratitude_reply', { exchange: 'text' }), rng()))).toMatchObject({ voice: false, bubble: true });
    expect(gate.check(input('acknowledge', { audioArmed: false }), rng())).toMatchObject({ allow: false, reason: 'face_only' });
    expect(plan(gate.check(input('greeting', { exchange: 'none' }), rng()))).toMatchObject({ voice: true, caption: 'line' });
    expect(gate.check(input('greeting', { exchange: 'none', ownerAtStage: false, surface: 'floor' }), rng())).toMatchObject({ allow: false, reason: 'face_only' });
  });
  it('drops ambient voices under a conversation but keeps the bubble', () => {
    const { gate } = setup();
    expect(plan(gate.check(input('passing_by', { surface: 'floor', ownerAtStage: false, exchange: 'none', foregroundAudio: true }), rng()))).toMatchObject({ voice: false, bubble: true });
  });
  it('under reduced motion, gestures become static expressions or are omitted', () => {
    const { gate } = setup();
    expect(plan(gate.check(input('thinking_filler', { reducedMotion: true }), rng())).face).toEqual({ gesture: 'none', expression: 'thinking', holdMs: 1200 });
    expect(plan(gate.check(input('backchannel', { reducedMotion: true, turnId: 'bc' }), rng())).face).toBeNull();
  });
  it('picks a delay inside the intent window, deterministically', () => {
    const { gate } = setup();
    const a = plan(gate.check(input('acknowledge'), seededRng('x'))).delayMs;
    expect(a).toBeGreaterThanOrEqual(200);
    expect(a).toBeLessThanOrEqual(350);
    expect(plan(gate.check(input('acknowledge'), seededRng('x'))).delayMs).toBe(a);
  });
});

describe('timing rules', () => {
  it('backchannels: ≥ 6 s apart, ≤ 3 per turn', () => {
    const { gate } = setup();
    const at = (ms: number) => input('backchannel', { now: T0 + ms, turnId: 'speech_1' });
    gate.commit(at(0), 400);
    expect(gate.check(at(3000), rng())).toMatchObject({ allow: false, reason: 'min_gap' });
    gate.commit(at(6000), 400);
    gate.commit(at(12_000), 400);
    expect(gate.check(at(18_000), rng())).toMatchObject({ allow: false, reason: 'per_turn' });
    gate.resetTurn('speech_1');
    expect(gate.check(at(18_000), rng()).allow).toBe(true);
  });
  it('one reaction per turn across reaction intents; one acknowledgement per turn', () => {
    const { gate } = setup();
    gate.commit(input('laugh'), 800);
    expect(gate.check(input('delight'), rng())).toMatchObject({ allow: false, reason: 'reaction_per_turn' });
    expect(gate.check(input('delight', { turnId: 'turn_2' }), rng()).allow).toBe(true);
    gate.commit(input('acknowledge'), 500);
    expect(gate.check(input('acknowledge'), rng())).toMatchObject({ allow: false, reason: 'per_turn' });
  });
  it('passing-by: per-agent cooldown and a global gap, shorter in Buzzing', () => {
    for (const [amb, cooldown, gap] of [['lively', 600_000, 20_000], ['buzzing', 240_000, 8000]] as const) {
      const { gate } = setup(amb);
      const at = (agentId: string, ms: number) => input('passing_by', { agentId, ambience: amb, surface: 'floor', ownerAtStage: false, exchange: 'none', now: T0 + ms, turnId: undefined });
      gate.commit(at('cw_a', 0), 0);
      expect(gate.check(at('cw_b', gap - 1), rng())).toMatchObject({ allow: false, reason: 'global_gap', faceOnly: { gesture: 'look_up' } });
      expect(gate.check(at('cw_b', gap), rng()).allow).toBe(true);
      expect(gate.check(at('cw_a', cooldown - 1), rng())).toMatchObject({ allow: false, reason: 'cooldown' });
      expect(gate.check(at('cw_a', cooldown), rng()).allow).toBe(true);
    }
  });
  it('juggling notices once per contention (30 s cooldown) and quips per hour', () => {
    const { gate } = setup('buzzing');
    gate.commit(input('juggling', { turnId: 'a' }), 1000);
    expect(gate.check(input('juggling', { turnId: 'b', now: T0 + 29_000 }), rng())).toMatchObject({ allow: false, reason: 'cooldown' });
    expect(gate.check(input('juggling', { turnId: 'c', now: T0 + 30_000 }), rng()).allow).toBe(true);
    const q = setup('lively');
    const quip = (i: number, agentId = `cw_${i}`) => input('quip', { agentId, surface: 'floor', ownerAtStage: false, exchange: 'none', turnId: undefined, now: T0 + i * 60_000 });
    for (let i = 0; i < 3; i++) q.gate.commit(quip(i, 'cw_q'), 0);
    expect(q.gate.check(quip(3, 'cw_q'), rng())).toMatchObject({ allow: false }); // per-agent 20 min cooldown and 3/h
  });
});

describe('chatter budget (§9.2)', () => {
  it('owner-directed reflexes are exempt; Floor chatter spends tokens and refills at chatter_per_min', () => {
    const { gate, budget } = setup('lively');
    // Side-talk openers spend the same budget and are not spaced by the Floor gap (that is tested below).
    const status = (i: number, ms = 0) => input('handoff_give', { agentId: `cw_${i}`, surface: 'floor', ownerAtStage: false, exchange: 'none', turnId: undefined, now: T0 + ms });
    for (let i = 0; i < 3; i++) {
      expect(gate.check(status(i), rng()).allow, `agent ${i}`).toBe(true);
      gate.commit(status(i), 0);
    }
    // Burst 3: a fourth Floor line in the same instant is refused, with only the look-up.
    expect(gate.check(status(3), rng())).toMatchObject({ allow: false, reason: 'budget', faceOnly: { gesture: 'glance' } });
    expect(gate.check(input('acknowledge'), rng()).allow).toBe(true); // owner-directed: exempt
    expect(gate.check(input('celebrate'), rng()).allow).toBe(true); // at the owner's stage: exempt
    // 2 per minute: one token is back after 30 s.
    expect(gate.check(status(3, 29_000), rng()).allow).toBe(false);
    expect(gate.check(status(3, 30_000), rng()).allow).toBe(true);
    expect(budget.state(T0 + 30_000).tokens).toBeCloseTo(1, 6);
  });
  it('one Floor gap spaces every Floor intent, and bubbles on screen are counted (E8)', () => {
    const { gate } = setup('lively');
    const floor = (intent: IntentId, agentId: string, ms: number) => input(intent, { agentId, surface: 'floor', ownerAtStage: false, exchange: 'none', turnId: undefined, now: T0 + ms });
    gate.commit(floor('micro_status', 'cw_a', 0), 0, T0 + 5000);
    // A pointer sweep: the next desk's status, quip or hello within the Floor gap only looks up.
    for (const intent of ['micro_status', 'quip', 'passing_by', 'blocked', 'unblocked'] as const) {
      expect(gate.check(floor(intent, 'cw_b', 2000), rng())).toMatchObject({ allow: false });
    }
    expect(gate.check(floor('micro_status', 'cw_b', 2000), rng())).toMatchObject({ reason: 'floor_gap' });
    expect(gate.check(floor('micro_status', 'cw_b', 20_000), rng()).allow).toBe(true);
    // Lively shows one Floor bubble at a time: a side-talk bubble still on screen holds the next Floor line back.
    gate.noteBubble(T0 + 30_000);
    expect(gate.check(floor('micro_status', 'cw_b', 21_000), rng())).toMatchObject({ allow: false, reason: 'bubbles' });
    expect(gate.check(floor('micro_status', 'cw_b', 30_001), rng()).allow).toBe(true);
    // Owner-directed lines at the stage are never held back by the Floor.
    expect(gate.check(input('acknowledge', { now: T0 + 21_000 }), rng()).allow).toBe(true);
  });
  it('Quiet has no chatter at all; voiced ambient time is capped per 10 minutes', () => {
    const quiet = createChatterBudget(catalog.ambience, 'quiet');
    expect(quiet.canSpend('chatter', T0)).toBe(false);
    expect(quiet.canSpend('exempt', T0)).toBe(true);
    const b = createChatterBudget(catalog.ambience, 'buzzing');
    let t = T0;
    for (let i = 0; i < 20; i++, t += 12_000) if (b.canSpend('chatter', t, 3000)) b.spend('chatter', t, 3000);
    expect(b.state(t).voicedMsWindow).toBeLessThanOrEqual(40_000); // Buzzing: 40 s of voiced ambient per 10 minutes (E9)
    expect(b.canSpend('chatter', t, 3000)).toBe(false);
    expect(b.canSpend('chatter', t)).toBe(true); // a bubble is still fine
    expect(b.canSpend('chatter', t + 10 * 60_000, 3000)).toBe(true);
    b.setAmbience('quiet');
    expect(b.ambience).toBe('quiet');
    expect(b.state(t).tokens).toBe(0);
  });
});

describe('reflexProbability (§3.2, §6.5)', () => {
  const chief = fixtureIndex('chief');
  const ruth = fixtureIndex('ruth');
  it('scales backchannels by Ambience, archetype and energy; laughs by readiness and valence', () => {
    const w = chief.intentWeight('backchannel');
    expect(reflexProbability(catalog, chief, 'backchannel', 'lively', { valence: 0, energy: 0 })).toBeCloseTo(Math.min(0.6, 0.55 * w), 6);
    expect(reflexProbability(catalog, chief, 'backchannel', 'quiet', { valence: 0, energy: 0 })).toBe(0);
    expect(reflexProbability(catalog, ruth, 'backchannel', 'lively', { valence: 0, energy: 0 })).toBeLessThan(reflexProbability(catalog, chief, 'backchannel', 'lively', { valence: 0, energy: 0 }) + 1e-9);
    expect(reflexProbability(catalog, ruth, 'backchannel', 'lively', { valence: 0, energy: 0 })).toBeCloseTo(0.55 * ruth.intentWeight('backchannel'), 6);
    expect(reflexProbability(catalog, chief, 'laugh', 'lively', { valence: 0, energy: 0 })).toBeCloseTo(0.8 * 0.75, 6);
    expect(reflexProbability(catalog, chief, 'laugh', 'lively', { valence: -0.4, energy: 0 })).toBeCloseTo(0.8 * 0.75 * 0.8, 6);
    expect(reflexProbability(catalog, chief, 'quip', 'buzzing', { valence: 0.5, energy: 0 })).toBeCloseTo(0.35 * chief.intentWeight('quip'), 6);
    expect(reflexProbability(catalog, chief, 'acknowledge', 'lively', { valence: 0, energy: 0 })).toBe(1);
    expect(reflexProbability(catalog, fixtureIndex('camila'), 'holding_filler', 'lively', { valence: 0, energy: 0 })).toBe(0);
  });
  it('caps laughs at 0.65 and backchannels at 0.6 (E10): a laugh at nearly every joke reads as sycophantic', () => {
    expect(reflexProbability(catalog, chief, 'laugh', 'lively', { valence: 0.9, energy: 0 })).toBe(0.65);
    expect(reflexProbability(catalog, chief, 'backchannel', 'buzzing', { valence: 0, energy: 0.9 })).toBe(0.6);
  });
});
