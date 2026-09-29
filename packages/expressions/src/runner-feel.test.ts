// The runner against the Inc 0.5 feel review: the server's safety-net filler never speaks on a sincere "are you an
// AI?", on distress, after an acknowledgement or on a joke; a typed joke's smile is captioned; a hello before audio
// is armed is shown; the Floor never plays a hover voice after the pointer left; runtime lines are captioned at once.
import { describe, expect, it } from 'vitest';
import { AGENTS, createRunnerHarness, makeState } from './testing';
import type { RunnerHarness } from './testing';
import type { ReflexSayData } from './types';

const { chief, ruth } = AGENTS;
const at = (h: RunnerHarness) => h.clock.now();

/** A pre-voiced line of `intent` from the agent's manifest, as a server reflex.say for `turnId`. */
function serverSay(h: RunnerHarness, agentId: string, intent: ReflexSayData['intent'], turnId: string): ReflexSayData {
  const [lineKey, clip] = Object.entries(h.clips.manifest(agentId)!.clips).find(([k]) => k.split('|')[0]!.includes(`.${intent}.`))!;
  return {
    agentId, intent, lineId: lineKey.split('|')[0]!, fillKey: lineKey.split('|')[1] ?? '', caption: `server ${intent}`,
    clip: { key: clip.clipKey, url: `/api/expr/clips/${clip.clipKey}`, durationMs: clip.durationMs, alignmentUrl: null }, render: null,
    channels: { voice: true, bubble: false, caption: 'reaction' }, face: { gesture: 'look_up', holdMs: 600 },
    gainDb: 0, priority: 2, ttlMs: 1500, audience: 'owner', turnId,
  };
}

const heard = (h: RunnerHarness) => h.voiced().map((v) => v.caption);
const shown = (h: RunnerHarness) => h.captions.shown.map((c) => c.text);

describe("the server's safety-net filler (feel review, critical and high)", () => {
  it('a sincere "are you an AI?" gets no filler at all: not voiced, not captioned (H6)', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_ai', 'Honestly, are you a real person or an AI?', 'voice');
    await h.clock.advance(1200);
    h.runner.frame({ type: 'reflex.say', data: serverSay(h, chief, 'thinking_filler', 'turn_ai') });
    await h.clock.advance(3000);
    expect(heard(h)).toEqual([]);
    expect(shown(h)).not.toContain('server thinking_filler');
    expect(h.telemetry.find((t) => t.intent === 'thinking_filler' && t.turnId === 'turn_ai')).toMatchObject({ kind: 'skipped', reason: 'silent_turn' });
  });

  it('distress gets sympathy only: the server filler is dropped, a server sympathy still plays (§1.4.4)', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_d', 'My dad is in the hospital and I am really scared.', 'voice');
    await h.clock.advance(1200);
    h.runner.frame({ type: 'reflex.say', data: serverSay(h, chief, 'thinking_filler', 'turn_d') });
    await h.clock.advance(100);
    h.runner.frame({ type: 'reflex.say', data: { ...serverSay(h, chief, 'sympathy', 'turn_d') } });
    await h.clock.advance(3000);
    expect(heard(h)).not.toContain('server thinking_filler');
    expect(h.telemetry.some((t) => t.intent === 'thinking_filler' && t.reason === 'only_sympathy')).toBe(true);
    expect(h.played('thinking_filler')).toEqual([]);
  });

  it('after the acknowledgement, the server filler is not a second "one sec" ("Let me sketch it." twice)', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_ack', 'Can you draft a follow-up to Kirsten?', 'voice');
    await h.clock.advance(1300);
    expect(h.played('acknowledge')).toHaveLength(1);
    h.runner.frame({ type: 'reflex.say', data: serverSay(h, chief, 'thinking_filler', 'turn_ack') });
    await h.clock.advance(400);
    h.runner.conversation({ kind: 'first_token', turnId: 'turn_ack', at: at(h), hint: null });
    await h.clock.advance(2000);
    expect(heard(h)).not.toContain('server thinking_filler');
    expect(h.telemetry.some((t) => t.intent === 'thinking_filler' && t.turnId === 'turn_ack' && t.reason === 'covered')).toBe(true);
  });

  it('a joke gets the laugh or the smile, never a thinking filler (client or server)', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_joke', 'Ha ha, the printer is haunted again.', 'voice');
    await h.clock.advance(1200);
    h.runner.frame({ type: 'reflex.say', data: serverSay(h, chief, 'thinking_filler', 'turn_joke') });
    await h.clock.advance(3000);
    expect(h.played('thinking_filler')).toEqual([]);
    expect(heard(h)).not.toContain('server thinking_filler');
  });
});

describe('faces and captions the owner can see', () => {
  it('a typed joke: the smile comes first (no thinking look-up over it) and the caption says "(smiles)"', async () => {
    const h = await createRunnerHarness();
    const n = h.face.cues.length;
    h.turn(chief, 'turn_tj', 'Ha ha, the printer is haunted again.', 'text');
    await h.clock.advance(600);
    const cues = h.face.cues.slice(n).map((c) => c.cue.gesture);
    expect(cues[0]).toBe('smile');
    expect(cues).not.toContain('look_up');
    expect(h.captions.shown.some((c) => c.kind === 'reaction' && c.text === '(smiles)')).toBe(true);
    expect(heard(h)).toEqual([]);
  });

  it('a hello after a break before audio is armed is shown as a caption, and a later re-entry stays quiet', async () => {
    const h = await createRunnerHarness();
    h.audio.setArmed(false);
    h.states.set(chief, makeState(chief, 'Samuel', { history: { returning: true } }));
    h.runner.stage(chief, 'open');
    await h.clock.advance(1000);
    const hello = h.captions.shown.filter((c) => c.kind === 'line');
    expect(hello).toHaveLength(1);
    expect(heard(h)).toEqual([]);
    h.audio.setArmed(true);
    h.runner.stage(chief, 'close');
    await h.clock.advance(60_000);
    h.runner.stage(chief, 'open');
    await h.clock.advance(1000);
    expect(h.captions.shown.filter((c) => c.kind === 'line')).toHaveLength(1);
    expect(h.played('greeting')).toHaveLength(1);
  });

  it('a runtime-rendered line is captioned at the glance, before its voice renders', async () => {
    const h = await createRunnerHarness({ renderMs: 1000 });
    const say = serverSay(h, chief, 'micro_status', 'unused');
    const data: ReflexSayData = { ...say, turnId: undefined as unknown as string, clip: null, render: { lineId: say.lineId, fills: {} }, channels: { voice: true, bubble: false, caption: 'line' }, audience: 'owner' };
    delete (data as Partial<ReflexSayData>).turnId;
    h.runner.frame({ type: 'reflex.say', data });
    await h.clock.advance(50);
    expect(h.captions.shown.some((c) => c.kind === 'line' && c.text === 'server micro_status')).toBe(true);
    await h.clock.advance(2000);
    // Shown once: the voice arriving later does not caption it a second time.
    expect(h.captions.shown.filter((c) => c.text === 'server micro_status')).toHaveLength(1);
  });
});

describe('the Floor keeps in step with the pointer', () => {
  it('a hover voice that renders after the pointer left is not played; the bubble stays', async () => {
    const h = await createRunnerHarness({ renderMs: 900, decode: false });
    h.surface.surface = 'floor';
    h.surface.stageAgentId = null;
    h.surface.floorVisible = true;
    h.runner.hover(ruth, 'enter', 'pointer');
    h.runner.hover(ruth, 'dwell', 'pointer');
    await h.clock.advance(500);
    expect(h.captions.shown.some((c) => c.agentId === ruth && c.kind === 'bubble')).toBe(true);
    h.runner.hover(ruth, 'leave', 'pointer');
    await h.clock.advance(3000);
    expect(h.voiced().filter((v) => v.agentId === ruth)).toEqual([]);
    expect(h.telemetry.some((t) => t.agentId === ruth && t.kind === 'dropped' && t.reason === 'hover_left')).toBe(true);
  });

  it('quiet hours: an owner hover still gets its bubble (no voice), not just a look-up (§9.2)', async () => {
    const h = await createRunnerHarness();
    h.settings.quietHours = true;
    h.surface.surface = 'floor';
    h.surface.stageAgentId = null;
    h.surface.floorVisible = true;
    h.runner.hover(ruth, 'enter', 'pointer');
    h.runner.hover(ruth, 'dwell', 'pointer');
    await h.clock.advance(2000);
    expect(h.captions.shown.some((c) => c.agentId === ruth && c.kind === 'bubble')).toBe(true);
    expect(h.voiced().filter((v) => v.agentId === ruth)).toEqual([]);
  });
});
