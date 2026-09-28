// Simulation harness (docs/LIVING-WORKFORCE.md §10.2): a scripted 30-minute workday against the fixture
// catalog and fake ports, at each Ambience. Voice and text turns, a steer, hovers, progress, a blocker,
// side-talk from real events, a juggle, distress, a sincere AI question and thanks. The §10.2 bars are
// asserted as tests.
import { describe, expect, it } from 'vitest';
import { sideTalkLineData } from './frames';
import { seededRng } from './hash';
import { selectLine } from './select';
import { proposeSideTalk } from './sidetalk';
import { AGENTS, createRunnerHarness, makeState } from './testing';
import type { RunnerHarness } from './testing';
import type { SideTalkEvent } from './types';
import type { Ambience, IntentId } from './vocab';

const { chief, ruth, camila } = AGENTS;
const CHATTER = new Set<IntentId>(['passing_by', 'micro_status', 'quip', 'blocked', 'unblocked']);

interface SimResult {
  h: RunnerHarness;
  ownerSpeech: [number, number][];
  contentionTurns: Set<string>;
  distressAt: number;
  aiTurnAt: number;
  fillerChunks: { fillerAt: number; chunkAt: number }[];
  sideTalkShown: number;
  start: number;
}

const TEXTS = [
  'Can you draft a follow-up to Kirsten about the samples?',
  'what do you think about the new pricing tiers',
  'haha the printer is haunted again',
  'We closed the deal with Nordic Oat!',
  "I'm not sure this plan works, honestly",
  'They pulled out of the contract',
  'Could you compare the three supplier quotes?',
  'no, the other supplier',
  'wait, actually use the March numbers instead',
];

async function simulate(ambience: Ambience): Promise<SimResult> {
  const h = await createRunnerHarness({ ambience });
  const rng = seededRng(`sim:${ambience}`);
  const start = h.clock.now();
  const ownerSpeech: [number, number][] = [];
  const contentionTurns = new Set<string>();
  const fillerChunks: SimResult['fillerChunks'] = [];
  let distressAt = -1;
  let aiTurnAt = -1;
  let sideTalkShown = 0;
  let turnNo = 0;
  const lastPod = new Map<string, number>();
  const lastAgent = new Map<string, number>();
  const now = () => h.clock.now();
  const rand = (lo: number, hi: number) => Math.round(lo + rng.next() * (hi - lo));

  const talkTo = (agentId: string) => {
    h.surface.surface = agentId === chief ? 'talk' : 'desk';
    h.surface.stageAgentId = agentId;
    h.surface.floorVisible = false;
  };
  const toFloor = () => {
    h.surface.surface = 'floor';
    h.surface.stageAgentId = null;
    h.surface.floorVisible = true;
  };

  async function voiceTurn(agentId: string, text: string, opts: { firstToken?: number; slow?: boolean } = {}) {
    const turnId = `turn_${++turnNo}`;
    const dur = rand(2800, 6000);
    const s0 = now();
    h.runner.ownerSpeech({ agentId, kind: 'start', at: s0, utteranceMs: 0 });
    await h.clock.advance(Math.floor(dur / 2));
    const p0 = now();
    ownerSpeech.push([s0, p0]);
    h.runner.ownerSpeech({ agentId, kind: 'pause', at: p0, pauseMs: 420, utteranceMs: p0 - s0 });
    await h.clock.advance(420);
    const r0 = now();
    h.runner.ownerSpeech({ agentId, kind: 'resume', at: r0, utteranceMs: r0 - s0 });
    await h.clock.advance(Math.ceil(dur / 2));
    ownerSpeech.push([r0, now()]);
    h.runner.ownerSpeech({ agentId, kind: 'end', at: now(), utteranceMs: now() - s0 });
    h.turn(agentId, turnId, text);
    const firstToken = opts.firstToken ?? rand(300, 1600);
    await h.clock.advance(firstToken);
    h.runner.conversation({ kind: 'first_token', turnId, at: now(), hint: null });
    await h.clock.advance(opts.slow ? 3000 : rand(200, 600));
    const chunkAt = now();
    h.runner.conversation({ kind: 'first_chunk', turnId, at: chunkAt });
    const filler = h.played('thinking_filler').filter((p) => p.at > s0).at(-1);
    if (filler) fillerChunks.push({ fillerAt: filler.at, chunkAt });
    const speakMs = rand(3000, 7000);
    h.runner.conversation({ kind: 'speaking', turnId, agentId, remainingMs: speakMs });
    h.audio.speakFor(agentId, speakMs);
    await h.clock.advance(speakMs);
    h.runner.conversation({ kind: 'done', turnId, at: now() });
    return turnId;
  }

  async function hover(agentId: string) {
    h.runner.hover(agentId, 'enter', 'pointer');
    await h.clock.advance(600);
    h.runner.hover(agentId, 'dwell', 'pointer');
    await h.clock.advance(rand(3000, 6000));
    h.runner.hover(agentId, 'leave', 'pointer');
  }

  async function sideTalk(ev: SideTalkEvent) {
    // A WorkspaceDO-lite gate: Ambience, pod visible, the shared chatter budget, then broadcast.
    const p = proposeSideTalk(ev, {
      catalog: h.catalog, index: (id) => h.indexes[id] ?? null, state: (id) => h.states.get(id) ?? null, mood: () => ({ valence: 0.3, energy: 0.1 }),
      ambience, recency: h.recency, provider: 'xai', now: now(), lastPodLineAt: (id) => lastPod.get(id) ?? null, lastAgentLineAt: (id) => lastAgent.get(id) ?? null,
    });
    if (!p || !h.budget.canSpend('chatter', now())) return;
    h.budget.spend('chatter', now());
    lastPod.set(p.projectId, now());
    const voice = ambience === 'buzzing' ? 'floor_audio' : 'listen_in';
    for (const line of p.lines) {
      lastAgent.set(line.agentId, now());
      const m = h.clips.manifest(line.agentId)!;
      const clip = m.clips[`${line.utterance.lineId}|${line.utterance.fillKey}`];
      h.runner.frame({ type: 'sidetalk.line', data: sideTalkLineData(p, line, { voice, clip: clip ? { key: clip.clipKey, durationMs: clip.durationMs } : null }) });
    }
  }

  // ── the day ──
  h.states.set(chief, makeState(chief, 'Samuel', { history: { newDay: true } }));
  talkTo(chief);
  h.runner.stage(chief, 'open');
  await h.clock.advance(2000);
  h.states.set(chief, makeState(chief, 'Samuel', { self: { presence: 'working', activity: 'analysis' }, work: { stepLabel: 'Comparing supplier quotes', done: 1, total: 5 } }));
  h.states.set(camila, makeState(camila, 'Camila', { self: { presence: 'working', activity: 'analysis' }, work: { stepLabel: 'Cleaning the March sales export', done: 1, total: 4 } }));
  let seq = 100;
  for (let m = 0; m < 30; m++) {
    const minuteStart = now();
    const w = h.states.get(chief)!.work!;
    if (m % 4 === 3 && (w.done ?? 0) < 5) h.states.set(chief, { ...h.states.get(chief)!, work: { ...w, done: (w.done ?? 0) + 1 } });
    if (m === 14) h.states.set(camila, makeState(camila, 'Camila', { self: { presence: 'working', blocked: true, activity: 'analysis' }, work: { blocker: 'HubSpot needs a sign-in' } }));
    if (m === 17) h.states.set(camila, makeState(camila, 'Camila', { self: { presence: 'working', activity: 'analysis' }, work: { stepLabel: 'Re-running the export', done: 2, total: 4 }, history: { lastUnblockedAt: now() } }));

    if (m === 12) {
      // A juggle: the chief is still speaking a reply when a new question arrives.
      talkTo(chief);
      h.runner.conversation({ kind: 'speaking', turnId: 'turn_long', agentId: chief, remainingMs: 5000 });
      h.audio.speakFor(chief, 5000);
      h.turn(chief, 'turn_long', 'look into the freight costs', 'voice', now() - 9000);
      h.turn(chief, 'turn_jug', 'and what about March?');
      contentionTurns.add('turn_jug');
      await h.clock.advance(6500);
      h.runner.conversation({ kind: 'done', turnId: 'turn_long', at: now() });
      await h.clock.advance(1000);
      h.runner.conversation({ kind: 'first_token', turnId: 'turn_jug', at: now(), hint: null });
      h.runner.conversation({ kind: 'first_chunk', turnId: 'turn_jug', at: now() });
      h.runner.conversation({ kind: 'done', turnId: 'turn_jug', at: now() + 3000 });
    } else if (m === 18) {
      talkTo(chief);
      distressAt = now();
      await voiceTurn(chief, 'sorry, bit distracted, my dad is in hospital');
    } else if (m === 21) {
      talkTo(chief);
      await voiceTurn(chief, 'haha the printer is haunted again');
    } else if (m === 24) {
      talkTo(chief);
      aiTurnAt = now();
      await voiceTurn(chief, 'hang on, are you a real person?');
    } else if (m === 27) {
      talkTo(chief);
      h.turn(chief, 'turn_thanks', 'Thanks!');
      const r = selectLine(h.indexes[chief]!, {
        intent: 'gratitude_reply', state: h.states.get(chief)!, mood: { valence: 0.3, energy: 0 }, ambience, provider: 'xai', seed: `${chief}|gratitude_reply|turn_thanks`, now: now(), channel: 'voice',
      }, h.recency);
      if (r.ok) {
        const c = h.clips.manifest(chief)!.clips[`${r.utterance.lineId}|${r.utterance.fillKey}`]!;
        await h.clock.advance(300);
        h.runner.frame({ type: 'reflex.say', data: {
          agentId: chief, intent: 'gratitude_reply', lineId: r.utterance.lineId, fillKey: r.utterance.fillKey, caption: r.utterance.caption,
          clip: { key: c.clipKey, url: '', durationMs: c.durationMs, alignmentUrl: null }, render: null, channels: { voice: true, bubble: true, caption: 'line' },
          face: r.utterance.face, gainDb: 0, priority: 1, ttlMs: 1500, audience: 'owner', turnId: 'turn_thanks',
        } });
      }
    } else if (m % 3 === 0) {
      talkTo(m % 6 === 0 ? chief : ruth);
      await voiceTurn(h.surface.stageAgentId!, TEXTS[(m / 3) % TEXTS.length]!, { slow: m % 9 === 0 });
    } else if (m % 3 === 1) {
      toFloor();
      await hover(chief);
      await hover(m % 2 ? camila : ruth);
    } else {
      toFloor();
      const kinds: SideTalkEvent['kind'][] = ['handoff', 'ask.answered', 'verdict', 'job.done'];
      const kind = kinds[m % kinds.length]!;
      await sideTalk({
        kind, from: m % 4 === 2 ? camila : ruth, to: m % 4 === 2 ? ruth : camila, projectId: 'prj_nw01', cause: { streamId: 'p:prj_nw01', seq: seq++ },
        gist: 'Competitor grid, 14 sources in the folder.', artifact: 'the competitor grid', verdict: 'changes', findingCount: 2, visibility: 'team',
      });
      await h.clock.advance(4000);
      await hover(camila);
    }
    const elapsed = now() - minuteStart;
    if (elapsed < 60_000) await h.clock.advance(60_000 - elapsed);
  }
  talkTo(chief);
  h.runner.stage(chief, 'close');
  await h.clock.advance(3000);
  sideTalkShown = h.captions.shown.filter((c) => c.kind === 'sidetalk').length;
  return { h, ownerSpeech, contentionTurns, distressAt, aiTurnAt, fillerChunks, sideTalkShown, start };
}

const overlap = (a: [number, number], b: [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

describe.each(['quiet', 'lively', 'buzzing'] as const)('simulated workday (%s)', (ambience) => {
  it('meets the §10.2 bars', async () => {
    const r = await simulate(ambience);
    const { h } = r;
    const shownTexts = h.captions.shown.map((c) => c.text);
    const played = h.played();

    // Ungrounded fills and honesty: no raw placeholders or markup ever reach a caption or bubble.
    for (const t of shownTexts) expect(t).not.toMatch(/[{}[\]<>]/);
    // Progress numbers only from state: the chief's total is five, Camila's four.
    for (const t of shownTexts) if (/ of (two|three|four|five|six)/i.test(t)) expect(t).toMatch(/ of (four|five)/i);

    // Never over the owner: no reflex audio overlaps owner speech by more than 150 ms.
    for (const p of h.voiced()) {
      const span: [number, number] = [p.startAt, p.stoppedAt ?? p.endAt ?? p.startAt];
      for (const s of r.ownerSpeech) expect(overlap(span, s), `${p.caption} @${p.startAt - r.start}`).toBeLessThanOrEqual(150);
    }

    // No fake busyness: juggling only on a real contention.
    for (const p of h.played('juggling')) expect(p.agentId).toBe(chief);
    expect(h.played('juggling').length).toBeLessThanOrEqual(r.contentionTurns.size);

    // After distress: no laughs, quips or celebrations; the sincere AI question gets no reflex.
    for (const p of played) if (p.at > r.distressAt) expect(['laugh', 'quip', 'celebrate']).not.toContain(p.intent);
    expect(played.filter((p) => p.at >= r.aiTurnAt && p.at < r.aiTurnAt + 8000 && p.agentId === chief && p.intent !== 'backchannel')).toEqual([]);

    // Alive, not noisy: Floor chatter stays within the Ambience budget.
    const chatter = played.filter((p) => CHATTER.has(p.intent)).map((p) => p.at);
    const sidetalk = h.captions.shown.filter((c) => c.kind === 'sidetalk').map((c) => c.at);
    const ambient = [...chatter, ...sidetalk].sort((a, b) => a - b);
    const profile = h.catalog.ambience[ambience];
    for (const t of ambient) {
      const inMinute = ambient.filter((x) => x >= t && x < t + 60_000).length;
      expect(inMinute).toBeLessThanOrEqual(profile.chatter_burst + profile.chatter_per_min * 2); // side-talk threads count their lines
    }
    const minutes = 30;
    expect(chatter.length / minutes).toBeLessThanOrEqual(Math.max(0.01, profile.chatter_per_min));

    // Wasted fillers (first chunk within 200 ms of the filler) stay rare.
    const wasted = r.fillerChunks.filter((f) => f.chunkAt - f.fillerAt < 200).length;
    expect(wasted / Math.max(1, r.fillerChunks.length)).toBeLessThan(0.15);

    // Anti-repetition: the same opener twice in a row is uncommon for any one agent.
    const byAgent = new Map<string, string[]>();
    for (const p of h.played()) byAgent.set(p.agentId, [...(byAgent.get(p.agentId) ?? []), p.lineId ?? '']);
    for (const [agent, ids] of byAgent) {
      for (let i = 1; i < ids.length; i++) if (ids[i] === ids[i - 1] && ids[i] !== '') expect.soft(`${agent} repeated ${ids[i]}`).toBe('');
    }

    // Ambience shapes the office.
    if (ambience === 'quiet') {
      expect(chatter).toEqual([]);
      expect(r.sideTalkShown).toBe(0);
      expect(h.played('laugh')).toEqual([]);
      expect(h.played('thinking_filler').length + h.played('acknowledge').length).toBeGreaterThan(0); // functional reflexes stay
    } else {
      expect(chatter.length).toBeGreaterThan(0);
      expect(r.sideTalkShown).toBeGreaterThan(0);
    }
    if (ambience === 'lively') expect(h.voiced().filter((v) => v.bus === 'ambient')).toEqual([]); // side-talk voiced only on listen-in
    if (ambience === 'buzzing') expect(h.voiced().some((v) => v.bus === 'ambient')).toBe(true);
    expect(h.played('greeting')).toHaveLength(ambience === 'quiet' ? 0 : 1);
    expect(h.played('juggling').length + h.played('back_with_you').length).toBeGreaterThan(0);
  });
});

describe('simulation determinism (L7)', () => {
  it('the same script gives the same audio, captions and picks', async () => {
    const a = await simulate('buzzing');
    const b = await simulate('buzzing');
    const shape = (r: SimResult) => ({
      audio: r.h.voiced().map((v) => [v.agentId, v.caption, v.startAt - r.start, v.bus]),
      captions: r.h.captions.shown.map((c) => [c.agentId, c.kind, c.text, c.at - r.start]),
      played: r.h.played().map((p) => [p.agentId, p.intent, p.lineId, p.at - r.start]),
    });
    expect(shape(a)).toEqual(shape(b));
    expect(a.h.played().length).toBeGreaterThan(15);
  });
});
