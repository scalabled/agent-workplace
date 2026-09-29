import { describe, expect, it } from 'vitest';
import { AGENTS, createRunnerHarness, makeState } from './testing';
import type { RunnerHarness } from './testing';
import type { ReflexSayData } from './types';

const { chief, ruth } = AGENTS;
const at = (h: RunnerHarness) => h.clock.now();
const playedIntents = (h: RunnerHarness) => h.played().map((p) => p.intent);

describe('owner speech: backchannels only inside real pauses (§1.4.1, L5)', () => {
  it('plays soft listener sounds in pauses and never over the owner', async () => {
    const h = await createRunnerHarness();
    const start = at(h);
    h.runner.ownerSpeech({ agentId: chief, kind: 'start', at: start, utteranceMs: 0 });
    const resumes: number[] = [];
    for (let i = 1; i <= 8; i++) {
      await h.clock.advance(7000);
      h.runner.ownerSpeech({ agentId: chief, kind: 'pause', at: at(h), pauseMs: 400, utteranceMs: i * 7000 });
      await h.clock.advance(300);
      resumes.push(at(h));
      h.runner.ownerSpeech({ agentId: chief, kind: 'resume', at: at(h), utteranceMs: i * 7000 + 300 });
    }
    const bcs = h.played('backchannel');
    expect(bcs.length).toBeGreaterThanOrEqual(1);
    expect(bcs.length).toBeLessThanOrEqual(3); // ≤ 3 per turn
    for (const p of h.voiced()) {
      expect(p.gainDb).toBe(-8);
      expect(p.bus).toBe('reflex');
      const end = p.stoppedAt ?? p.endAt!;
      const resume = resumes.find((r) => r >= p.startAt)!;
      expect(end - resume).toBeLessThanOrEqual(150); // faded the moment the owner resumed
      expect(p.startAt).toBeGreaterThan(resume - 300); // inside the pause
    }
    expect(h.face.cues.some((c) => c.cue.gesture === 'nod')).toBe(true);
  });

  it('cancels a pending backchannel when the owner resumes at once, and ignores short utterances or long pauses', async () => {
    const h = await createRunnerHarness();
    h.runner.ownerSpeech({ agentId: chief, kind: 'start', at: at(h), utteranceMs: 0 });
    await h.clock.advance(4000);
    h.runner.ownerSpeech({ agentId: chief, kind: 'pause', at: at(h), pauseMs: 400, utteranceMs: 4000 });
    h.runner.ownerSpeech({ agentId: chief, kind: 'resume', at: at(h), utteranceMs: 4000 });
    await h.clock.advance(1000);
    h.runner.ownerSpeech({ agentId: chief, kind: 'pause', at: at(h), pauseMs: 1500, utteranceMs: 5000 });
    await h.clock.advance(1000);
    const h2 = await createRunnerHarness();
    h2.runner.ownerSpeech({ agentId: chief, kind: 'pause', at: at(h2), pauseMs: 400, utteranceMs: 1200 });
    await h2.clock.advance(1000);
    expect(h.voiced()).toEqual([]);
    expect(h2.voiced()).toEqual([]);
  });
});

describe('latency masking at the end of a turn (§1.3)', () => {
  it('acknowledges a request at 200–350 ms, then fills at 1.8 s if no token has arrived', async () => {
    const h = await createRunnerHarness();
    const t0 = at(h);
    const n = h.face.cues.length;
    h.turn(chief, 'turn_1', 'Can you draft a follow-up to Kirsten?');
    // Face first (≤ 100 ms): attentive → thinking, then the acknowledgement's nod; the voice follows.
    expect(h.face.cues.slice(n).map((c) => [c.cue.gesture, c.at - t0])).toEqual([['look_up', 0], ['nod', 0]]);
    await h.clock.advance(2000);
    h.runner.conversation({ kind: 'first_token', turnId: 'turn_1', at: at(h), hint: null });
    await h.clock.advance(300);
    h.runner.conversation({ kind: 'first_chunk', turnId: 'turn_1', at: at(h) });
    await h.clock.advance(3000);
    h.runner.conversation({ kind: 'done', turnId: 'turn_1', at: at(h) });
    expect(playedIntents(h)).toEqual(['acknowledge', 'thinking_filler']);
    const [ack, filler] = h.voiced();
    expect(ack!.startAt - t0).toBeGreaterThanOrEqual(200);
    expect(ack!.startAt - t0).toBeLessThanOrEqual(350);
    expect(filler!.startAt - t0).toBeGreaterThanOrEqual(1800);
    expect(filler!.startAt - t0).toBeLessThanOrEqual(1880);
    expect(h.captions.shown.filter((c) => c.kind === 'reaction').map((c) => c.text)).toEqual([ack!.caption, filler!.caption]);
  });

  it('stays silent when the first token beats the filler deadline', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_q', 'what do you think about the margins');
    await h.clock.advance(500);
    h.runner.conversation({ kind: 'first_token', turnId: 'turn_q', at: at(h), hint: null });
    await h.clock.advance(400);
    h.runner.conversation({ kind: 'first_chunk', turnId: 'turn_q', at: at(h) });
    await h.clock.advance(5000);
    expect(h.played()).toEqual([]);
  });

  it('fills at 700 ms, holds at ≥ 3.5 s, and hands back honestly when the turn goes to the background', async () => {
    const h = await createRunnerHarness();
    const t0 = at(h);
    h.turn(chief, 'turn_slow', 'what do you think about the margins');
    await h.clock.advance(8000);
    h.runner.conversation({ kind: 'backgrounded', turnId: 'turn_slow', at: at(h), etaMs: 120_000 });
    await h.clock.advance(3000);
    expect(playedIntents(h)).toEqual(['thinking_filler', 'holding_filler', 'deferral']);
    const [filler, holding, deferral] = h.voiced();
    expect(filler!.startAt - t0).toBeGreaterThanOrEqual(700);
    expect(filler!.startAt - t0).toBeLessThanOrEqual(780);
    expect(holding!.startAt - t0).toBeGreaterThanOrEqual(3500);
    expect(holding!.startAt - (filler!.endAt ?? 0)).toBeGreaterThanOrEqual(800);
    expect(deferral!.startAt - t0).toBeGreaterThanOrEqual(8000);
    expect(h.captions.shown.find((c) => c.kind === 'line')?.text).toBe(deferral!.caption);
  });

  it('holds once when tokens arrive but nothing is speakable by 3.5 s', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_tok', 'what do you think about the margins');
    await h.clock.advance(500);
    h.runner.conversation({ kind: 'first_token', turnId: 'turn_tok', at: at(h), hint: null });
    await h.clock.advance(6000);
    expect(playedIntents(h)).toEqual(['holding_filler']);
  });

  it('never starts a filler later than 2.2 s after the end of turn', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_late', 'what do you think about the margins', 'voice', at(h) - 2300);
    await h.clock.advance(1000);
    expect(h.played('thinking_filler')).toEqual([]);
  });

  it('plays the hinted reaction instead of a filler', async () => {
    const h = await createRunnerHarness();
    for (let i = 0; i < 6; i++) {
      h.turn(chief, `turn_h${i}`, 'so what should we call the new blend');
      await h.clock.advance(600);
      h.runner.conversation({ kind: 'first_token', turnId: `turn_h${i}`, at: at(h), hint: 'laugh' });
      await h.clock.advance(4000);
      h.runner.conversation({ kind: 'first_chunk', turnId: `turn_h${i}`, at: at(h) });
      h.runner.conversation({ kind: 'done', turnId: `turn_h${i}`, at: at(h) });
      await h.clock.advance(100_000); // laughs are ≥ 90 s apart
    }
    expect(h.played('laugh').length).toBeGreaterThanOrEqual(3);
    expect(h.played('thinking_filler')).toEqual([]);
  });

  it('with a realtime front that acknowledges, skips acknowledgements and fillers', async () => {
    const h = await createRunnerHarness();
    h.settings.frontAcks = true;
    h.turn(chief, 'turn_f', 'Can you draft a follow-up to Kirsten?');
    await h.clock.advance(3000);
    expect(h.played()).toEqual([]);
  });

  it('text exchanges are face-only, with a "one sec" bubble if nothing arrives by 2.5 s', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_t', 'Can you draft a follow-up to Kirsten?', 'text');
    await h.clock.advance(3000);
    expect(h.voiced()).toEqual([]);
    expect(h.face.cues.some((c) => c.cue.gesture === 'nod')).toBe(true); // the acknowledgement as a nod
    const bubble = h.captions.shown.find((c) => c.kind === 'bubble')!;
    expect(bubble.at - (at(h) - 3000)).toBeGreaterThanOrEqual(2500);
    expect(h.played('thinking_filler')).toHaveLength(1);
    // The "one sec" bubble yields to the answer as soon as it starts streaming.
    expect(h.captions.cleared).toEqual([]);
    h.runner.conversation({ kind: 'first_token', turnId: 'turn_t', at: at(h), hint: null });
    expect(h.captions.cleared).toEqual([{ agentId: chief, kind: 'bubble', at: at(h) }]);
  });

  it('a fast answer leaves nothing to clear', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_fast', 'Can you draft a follow-up to Kirsten?', 'text');
    await h.clock.advance(400);
    h.runner.conversation({ kind: 'first_token', turnId: 'turn_fast', at: at(h), hint: null });
    await h.clock.advance(3000);
    expect(h.played('thinking_filler')).toEqual([]);
    expect(h.captions.cleared).toEqual([]);
  });
});

describe('honesty and care (§1.4, H4, H6, H9)', () => {
  it('phatic turns get a face at once and the host’s reply; duplicates are ignored', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_thx', 'Thanks!');
    expect(h.face.cues.at(-1)?.cue).toMatchObject({ gesture: 'smile', expression: 'delighted' });
    await h.clock.advance(300);
    expect(h.played()).toEqual([]);
    const key = h.clips.manifest(chief)!.clips['warm.gratitude_reply.01|']!.clipKey;
    const say: ReflexSayData = {
      agentId: chief, intent: 'gratitude_reply', lineId: 'warm.gratitude_reply.01', fillKey: '', caption: 'Anytime.',
      clip: { key, url: `/api/expr/clips/${key}`, durationMs: 400, alignmentUrl: null }, render: null,
      channels: { voice: true, bubble: true, caption: 'line' }, face: { gesture: 'smile', expression: 'delighted', holdMs: 1500 },
      gainDb: 0, priority: 1, ttlMs: 1500, audience: 'owner', turnId: 'turn_thx',
    };
    h.runner.frame({ type: 'reflex.say', data: say });
    h.runner.frame({ type: 'reflex.say', data: say });
    await h.clock.advance(2000);
    expect(h.voiced().map((v) => v.caption)).toEqual(['Anytime.']);
    expect(h.captions.shown.filter((c) => c.text === 'Anytime.').map((c) => c.kind).sort()).toEqual(['bubble', 'line']);
  });

  it('a sincere "are you an AI?" gets no reflex at all', async () => {
    const h = await createRunnerHarness();
    const before = h.face.cues.length;
    h.turn(chief, 'turn_ai', 'wait, are you a bot?');
    await h.clock.advance(9000);
    expect(h.played()).toEqual([]);
    expect(h.face.cues.length).toBe(before);
  });

  it('after distress: sympathy only, and no laughs while the 30-minute lock holds', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_d', 'sorry, my dad is in hospital so this week is a mess haha');
    await h.clock.advance(4000);
    expect(playedIntents(h)).toEqual(['sympathy']);
    await h.clock.advance(200_000);
    for (let i = 0; i < 4; i++) {
      h.turn(chief, `turn_j${i}`, 'haha the printer is haunted again');
      await h.clock.advance(500);
      h.runner.conversation({ kind: 'first_token', turnId: `turn_j${i}`, at: at(h), hint: 'laugh' });
      await h.clock.advance(100_000);
    }
    expect(h.played('laugh')).toEqual([]);
  });

  it('a voice approval read-back silences everything, faces included', async () => {
    const h = await createRunnerHarness();
    h.runner.setSettings({ approvalInProgress: true });
    const before = h.face.cues.length;
    h.turn(chief, 'turn_ap', 'Can you draft a follow-up to Kirsten?');
    await h.clock.advance(3000);
    expect(h.played()).toEqual([]);
    expect(h.face.cues.slice(before).filter((c) => c.cue.gesture !== 'look_up')).toEqual([]);
  });

  it('reflex-grade lines never wait on the network: without a decoded clip the face covers it', async () => {
    const h = await createRunnerHarness({ decode: false });
    h.turn(chief, 'turn_nd', 'Can you draft a follow-up to Kirsten?');
    await h.clock.advance(3000);
    expect(h.voiced()).toEqual([]);
    expect(h.face.cues.some((c) => c.cue.gesture === 'nod')).toBe(true);
  });
});

describe('multitasking (§2.3, §2.4, L3)', () => {
  it('juggles only a real contention, then comes back', async () => {
    const h = await createRunnerHarness();
    h.surface.surface = 'desk';
    h.surface.stageAgentId = ruth;
    const t0 = at(h);
    h.attention.set(ruth, {
      agentId: ruth, at: t0, voiceBusyUntil: t0 + 9000, background: [],
      focus: { id: 'rm_nw01', kind: 'meeting', mailbox: 'floor', host: 'rm:rm_nw01', label: 'the Northwind review', voice: { speaking: true, untilMs: t0 + 9000 }, floorHeld: true, interruptible: 'sentence', since: t0 - 60_000 },
    });
    h.audio.speakFor(ruth, 9000);
    h.turn(ruth, 'turn_r1', "what's the latest on pricing?");
    await h.clock.advance(9000);
    expect(playedIntents(h)).toEqual(['juggling']);
    h.attention.delete(ruth);
    h.runner.frame({ type: 'attention.changed', data: { agentId: ruth, focus: null, background: [], voiceBusyUntil: null, floorHeld: false } });
    await h.clock.advance(1000);
    expect(playedIntents(h)).toEqual(['juggling', 'back_with_you']);
    // Without a contention there is no juggling line (H5).
    const h2 = await createRunnerHarness();
    h2.surface.stageAgentId = ruth;
    h2.turn(ruth, 'turn_r2', "what's the latest on pricing?");
    await h2.clock.advance(9000);
    expect(h2.played('juggling')).toEqual([]);
  });

  it('a new question while the reply still has 2.5–8 s to go: juggle, finish, then "I’m all yours"', async () => {
    const h = await createRunnerHarness();
    h.runner.conversation({ kind: 'speaking', turnId: 'turn_a', agentId: chief, remainingMs: 5000 });
    h.audio.speakFor(chief, 5000);
    h.turn(chief, 'turn_a', 'Can you look into supplier prices?', 'voice', at(h) - 8000); // the first turn (still speaking)
    h.turn(chief, 'turn_b', 'and what about March?');
    await h.clock.advance(7000);
    h.runner.conversation({ kind: 'done', turnId: 'turn_a', at: at(h) });
    await h.clock.advance(1000);
    expect(playedIntents(h)).toEqual(['juggling', 'back_with_you']);
    const jug = h.voiced()[0]!;
    expect(jug.priority).toBe(1);
  });

  it('an end replayed after a reconnect closes the turn silently: no "I’m all yours", no filler later', async () => {
    const h = await createRunnerHarness();
    h.runner.conversation({ kind: 'speaking', turnId: 'turn_a', agentId: chief, remainingMs: 5000 });
    h.audio.speakFor(chief, 5000);
    h.turn(chief, 'turn_a', 'Can you look into supplier prices?', 'voice', at(h) - 8000);
    h.turn(chief, 'turn_b', 'and what about March?');
    await h.clock.advance(7000);
    h.runner.conversation({ kind: 'done', turnId: 'turn_a', at: at(h), replayed: true });
    await h.clock.advance(1000);
    expect(playedIntents(h)).toEqual(['juggling']);
    // A voice turn whose reply never started sounding here gets a "still working on it"; once a replayed end closes
    // it, nothing covers it afterwards.
    for (const closed of [false, true]) {
      const h2 = await createRunnerHarness();
      h2.turn(chief, 'turn_c', 'What should we focus on this week?', 'voice');
      h2.runner.conversation({ kind: 'first_token', turnId: 'turn_c', at: at(h2), hint: null });
      if (closed) h2.runner.conversation({ kind: 'done', turnId: 'turn_c', at: at(h2), replayed: true });
      await h2.clock.advance(10_000);
      expect(playedIntents(h2)).toEqual(closed ? [] : ['holding_filler']);
    }
  });

  it('a stop or steer while speaking: yield, then acknowledge the interruption', async () => {
    const h = await createRunnerHarness();
    h.runner.conversation({ kind: 'speaking', turnId: 'turn_a', agentId: chief, remainingMs: 3000 });
    h.audio.speakFor(chief, 1200); // the host yields at the sentence boundary
    h.turn(chief, 'turn_s', 'wait, actually use the March numbers');
    await h.clock.advance(3000);
    const acks = h.played('acknowledge');
    expect(acks).toHaveLength(1);
    expect(h.voiced()[0]!.startAt).toBeGreaterThanOrEqual(h.clock.now() - 3000 + 1200);
  });
});

describe('the Floor: passing-by grounded in real state (§8.1)', () => {
  const onFloor = (h: RunnerHarness) => {
    h.surface.surface = 'floor';
    h.surface.stageAgentId = null;
    h.surface.floorVisible = true;
  };

  it('micro-status for new progress, then a working hello; the bubble is replyable', async () => {
    const h = await createRunnerHarness();
    onFloor(h);
    h.states.set(chief, makeState(chief, 'Samuel', { self: { presence: 'working' }, work: { stepLabel: 'Reading supplier quotes', done: 2, total: 5 } }));
    h.runner.hover(chief, 'enter', 'pointer');
    const warmed = h.clips.prefetched.at(-1)!;
    expect(warmed.tier).toBe('p1');
    expect(warmed.keys.length).toBeGreaterThan(0);
    h.runner.hover(chief, 'dwell', 'pointer');
    await h.clock.advance(1000);
    expect(playedIntents(h)).toEqual(['micro_status']);
    const bubble = h.captions.shown.find((c) => c.kind === 'bubble')!;
    expect(bubble.replyable).toBe(true);
    expect(bubble.text).toMatch(/Two of five|reading supplier quotes/);
    expect(h.face.cues.some((c) => c.cue.gesture === 'glance')).toBe(true);
    await h.clock.advance(11 * 60_000);
    h.runner.hover(chief, 'dwell', 'pointer');
    await h.clock.advance(1000);
    expect(playedIntents(h)).toEqual(['micro_status', 'passing_by']);
  });

  it('names the real blocker (tail rendered at runtime behind a pre-voiced prefix), or says the desk is quiet', async () => {
    const h = await createRunnerHarness();
    onFloor(h);
    h.states.set(chief, makeState(chief, 'Samuel', { self: { presence: 'working', blocked: true }, work: { blocker: 'HubSpot needs a sign-in' } }));
    h.runner.hover(chief, 'dwell', 'pointer');
    await h.clock.advance(3000);
    expect(playedIntents(h)).toEqual(['blocked']);
    expect(h.captions.shown.find((c) => c.kind === 'bubble')!.text).toMatch(/HubSpot needs a sign-in/);
    const h2 = await createRunnerHarness();
    onFloor(h2);
    h2.runner.hover(ruth, 'dwell', 'pointer');
    await h2.clock.advance(1000);
    expect(h2.captions.shown.find((c) => c.kind === 'bubble')!.text).toMatch(/Quiet desk/);
  });

  it('Quiet only looks up; keyboard focus gives a bubble without voice; the global gap spaces hellos', async () => {
    const q = await createRunnerHarness({ ambience: 'quiet' });
    onFloor(q);
    q.runner.hover(chief, 'dwell', 'pointer');
    await q.clock.advance(1000);
    expect(q.played()).toEqual([]);
    expect(q.captions.shown).toEqual([]);
    expect(q.face.cues.at(-1)?.cue.gesture).toBe('look_up');

    const k = await createRunnerHarness();
    onFloor(k);
    k.runner.hover(chief, 'dwell', 'keyboard');
    await k.clock.advance(1000);
    expect(k.voiced()).toEqual([]);
    expect(k.captions.shown.filter((c) => c.kind === 'bubble')).toHaveLength(1);

    const g = await createRunnerHarness();
    onFloor(g);
    g.runner.hover(chief, 'dwell', 'pointer');
    await g.clock.advance(5000);
    g.runner.hover(ruth, 'dwell', 'pointer');
    await g.clock.advance(1000);
    expect(g.played().map((p) => p.agentId)).toEqual([chief]);
  });
});

describe('stage, frames and control', () => {
  it('greets on a new day unless the owner starts talking first; signs off after a real conversation', async () => {
    const h = await createRunnerHarness();
    h.states.set(chief, makeState(chief, 'Samuel', { history: { newDay: true } }));
    const t0 = at(h);
    h.runner.stage(chief, 'open');
    await h.clock.advance(1000);
    expect(playedIntents(h)).toEqual(['greeting']);
    const g = h.voiced()[0]!;
    expect(g.startAt - t0).toBeGreaterThanOrEqual(300);
    expect(g.startAt - t0).toBeLessThanOrEqual(600);
    expect(h.captions.shown.some((c) => c.kind === 'line' && c.text === g.caption)).toBe(true);

    const h2 = await createRunnerHarness();
    h2.states.set(chief, makeState(chief, 'Samuel', { history: { newDay: true } }));
    h2.runner.stage(chief, 'open');
    await h2.clock.advance(100);
    h2.turn(chief, 'turn_x', 'what do you think about the margins');
    h2.runner.conversation({ kind: 'first_token', turnId: 'turn_x', at: at(h2), hint: null });
    await h2.clock.advance(1000);
    expect(h2.played('greeting')).toEqual([]);
    h2.runner.conversation({ kind: 'done', turnId: 'turn_x', at: at(h2) });
    h2.turn(chief, 'turn_y', 'ok and the other one');
    h2.runner.conversation({ kind: 'first_token', turnId: 'turn_y', at: at(h2), hint: null });
    h2.runner.conversation({ kind: 'done', turnId: 'turn_y', at: at(h2) });
    await h2.clock.advance(1000);
    h2.runner.stage(chief, 'close'); // Talk → Floor: never a goodbye (E20)
    await h2.clock.advance(3000);
    expect(h2.played('sign_off')).toEqual([]);
    h2.runner.stage(chief, 'open');
    h2.runner.stage(chief, 'close', 'leave'); // leaving the app: a goodbye, deferred 1.5 s
    await h2.clock.advance(1000);
    expect(h2.played('sign_off')).toEqual([]);
    await h2.clock.advance(1500);
    expect(h2.played('sign_off')).toHaveLength(1);
  });

  it('a quick return cancels the deferred sign-off; quiet minutes at an open stage never get one (D2)', async () => {
    const h = await createRunnerHarness();
    h.runner.stage(chief, 'open');
    for (const id of ['turn_1', 'turn_2']) {
      h.turn(chief, id, 'what do you think about the margins');
      h.runner.conversation({ kind: 'first_token', turnId: id, at: at(h), hint: null });
      h.runner.conversation({ kind: 'done', turnId: id, at: at(h) });
      await h.clock.advance(1000);
    }
    h.runner.stage(chief, 'close', 'leave');
    await h.clock.advance(500);
    h.runner.stage(ruth, 'open'); // the owner opened another stage straight away
    await h.clock.advance(3000);
    expect(h.played('sign_off')).toEqual([]);

    const i = await createRunnerHarness();
    i.runner.stage(chief, 'open');
    for (const id of ['turn_1', 'turn_2']) {
      i.turn(chief, id, 'what do you think about the margins');
      i.runner.conversation({ kind: 'first_token', turnId: id, at: at(i), hint: null });
      i.runner.conversation({ kind: 'done', turnId: id, at: at(i) });
      await i.clock.advance(1000);
    }
    // The owner is reading or thinking, not gone: the Chief never announces its own exit.
    await i.clock.advance(4 * 60_000);
    expect(i.played('sign_off')).toEqual([]);
    await i.clock.advance(30 * 60_000);
    expect(i.played('sign_off')).toEqual([]);
    expect(i.captions.shown.some((c) => c.kind === 'bubble')).toBe(false);
  });

  it('side-talk: bubbles for everyone, voice only for a listener, gist rendered at runtime', async () => {
    const h = await createRunnerHarness();
    h.surface.surface = 'floor';
    h.surface.floorVisible = true;
    const key = h.clips.manifest(AGENTS.camila)!.clips['warm.handoff_give.01|' + Object.keys(h.clips.manifest(AGENTS.camila)!.clips).find((k) => k.startsWith('warm.handoff_give.01|'))!.split('|')[1]]!.clipKey;
    const frame = (listen: boolean): SideTalkLineFrame => ({
      type: 'sidetalk.line',
      data: {
        threadId: listen ? 'st_2' : 'st_1', index: 0, projectId: 'prj_nw01', agentId: AGENTS.camila, toAgentId: ruth, intent: 'handoff_give',
        lineId: 'warm.handoff_give.01', text: "Ruth, it's all yours — competitor grid, 14 sources.", opener: "Ruth, it's all yours —",
        gist: 'competitor grid, 14 sources.', clip: { key, url: `/api/expr/clips/${key}`, durationMs: 900 }, voice: 'listen_in', atMs: 600,
        expiresAt: new Date(at(h) + 20_000).toISOString(), replyable: true, cause: { streamId: 'p:prj_nw01', seq: 1839 },
      },
    });
    h.runner.frame(frame(false));
    await h.clock.advance(2000);
    expect(h.captions.shown.filter((c) => c.kind === 'sidetalk').map((c) => [c.agentId, c.toAgentId, c.replyable])).toEqual([[AGENTS.camila, ruth, true]]);
    expect(h.voiced()).toEqual([]);
    h.surface.listeningProjectIds = ['prj_nw01'];
    h.runner.frame(frame(true));
    await h.clock.advance(3000);
    expect(h.voiced().map((v) => [v.bus, v.gainDb])).toContainEqual(['ambient', -6]);
    expect(h.renders.map((r) => r.lineId)).toContain('warm.handoff_give.01~gist');
  });

  it('mood frames bias the face; reflex.face frames cue it', async () => {
    const h = await createRunnerHarness();
    const bias = { expression: 'delighted' as const, weight: 0.2, cornerPull: 0.3, brow: 0, pitchDeg: 1, blinkScale: 1, swayScale: 1.1 };
    h.runner.frame({ type: 'mood.changed', data: { agentId: chief, valence: 0.6, energy: 0.3, at: at(h), baseline: { valence: 0.4, energy: 0 }, bias, reason: 'deliverable.accepted' } });
    h.runner.frame({ type: 'reflex.face', data: { agentId: ruth, cue: { gesture: 'wince', holdMs: 800 } } });
    expect(h.face.biases).toEqual([{ agentId: chief, bias }]);
    expect(h.face.cues.at(-1)).toMatchObject({ agentId: ruth, cue: { gesture: 'wince' } });
  });

  it('Everyone stop silences everything until reset; barge-in stops the agent at once', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_1', 'Can you draft a follow-up to Kirsten?');
    await h.clock.advance(100);
    h.runner.stopAll('everyone_stop');
    await h.clock.advance(3000);
    h.turn(chief, 'turn_2', 'Can you draft a follow-up to Kirsten?');
    await h.clock.advance(3000);
    expect(h.played()).toEqual([]);
    h.runner.stopAll('reset');
    h.turn(chief, 'turn_3', 'Can you draft a follow-up to Kirsten?');
    await h.clock.advance(300);
    await h.clock.advance(50);
    const playing = h.voiced().at(-1)!;
    h.runner.bargeIn(chief);
    expect(playing.stoppedAt ?? playing.endAt).toBeLessThanOrEqual(at(h));
    expect(h.face.cues.at(-1)?.cue.gesture).toBe('still');
  });

  it('one reflex voice at a time: a second agent’s reply waits its turn within its TTL', async () => {
    const h = await createRunnerHarness();
    h.runner.conversation({ kind: 'speaking', turnId: 'x', agentId: 'nobody', remainingMs: 0 });
    h.turn(chief, 'turn_1', 'Can you draft a follow-up to Kirsten?');
    await h.clock.advance(360); // the chief's acknowledgement is playing
    const key = h.clips.manifest(ruth)!.clips['warm.gratitude_reply.02|']!.clipKey;
    h.runner.frame({
      type: 'reflex.say',
      data: {
        agentId: ruth, intent: 'gratitude_reply', lineId: 'warm.gratitude_reply.02', fillKey: '', caption: 'Happy to help.', clip: { key, url: '', durationMs: 600, alignmentUrl: null },
        render: null, channels: { voice: true, bubble: false, caption: 'line' }, face: { gesture: 'smile', holdMs: 1000 }, gainDb: 0, priority: 1, ttlMs: 1500, audience: 'owner', turnId: 'turn_r',
      },
    });
    await h.clock.advance(3000);
    const [ack, reply] = h.voiced();
    expect(ack!.agentId).toBe(chief);
    expect(reply!.agentId).toBe(ruth);
    expect(reply!.startAt).toBeGreaterThanOrEqual(ack!.endAt!);
  });

  it('reduced motion keeps voice and captions but drops gestures', async () => {
    const h = await createRunnerHarness();
    h.settings.reducedMotion = true;
    h.turn(chief, 'turn_rm', 'Can you draft a follow-up to Kirsten?');
    await h.clock.advance(2500);
    expect(h.voiced().length).toBeGreaterThan(0);
    expect(h.face.cues.every((c) => c.cue.gesture === 'none')).toBe(true);
    expect(h.captions.shown.length).toBeGreaterThan(0);
    h.settings.captionReactions = false;
    h.turn(chief, 'turn_rm2', 'Could you check the invoices?');
    const n = h.captions.shown.length;
    await h.clock.advance(2500);
    expect(h.captions.shown.slice(n).filter((c) => c.kind === 'reaction')).toEqual([]);
  });
});

type SideTalkLineFrame = Extract<import('./types').ExpressionFrame, { type: 'sidetalk.line' }>;

describe('server frames and the runner cover a turn once (Inc 0.5 R1–R3)', () => {
  /** A pre-voiced line of `intent` from the agent's manifest, as a server reflex.say for `turnId`. */
  const serverSay = (h: RunnerHarness, agentId: string, intent: ReflexSayData['intent'], turnId: string): ReflexSayData => {
    const [lineKey, clip] = Object.entries(h.clips.manifest(agentId)!.clips).find(([k]) => k.split('|')[0]!.includes(`.${intent}.`))!;
    return {
      agentId, intent, lineId: lineKey.split('|')[0]!, fillKey: lineKey.split('|')[1] ?? '', caption: `server ${intent}`,
      clip: { key: clip.clipKey, url: `/api/expr/clips/${clip.clipKey}`, durationMs: clip.durationMs, alignmentUrl: null }, render: null,
      channels: { voice: true, bubble: false, caption: 'reaction' }, face: { gesture: 'nod', holdMs: 600 },
      gainDb: 0, priority: 2, ttlMs: 1500, audience: 'owner', turnId,
    };
  };

  it('R2: a server filler that plays first covers the turn; the runner adds none of its own', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_sf', 'what do you think about the margins');
    await h.clock.advance(500);
    const say = serverSay(h, chief, 'thinking_filler', 'turn_sf');
    h.runner.frame({ type: 'reflex.say', data: say });
    await h.clock.advance(3000);
    expect(h.played('thinking_filler').map((p) => p.lineId)).toEqual([say.lineId]);
    expect(h.voiced().map((v) => v.caption)).toEqual(['server thinking_filler']);
  });

  it('R2: a server acknowledgement cancels the runner’s pending one for that turn', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_sa', 'Can you draft a follow-up to Kirsten?');
    await h.clock.advance(100); // the runner's own acknowledgement is scheduled for 200–350 ms
    h.runner.frame({ type: 'reflex.say', data: serverSay(h, chief, 'acknowledge', 'turn_sa') });
    await h.clock.advance(1000);
    h.runner.conversation({ kind: 'first_token', turnId: 'turn_sa', at: at(h), hint: null });
    await h.clock.advance(3000);
    expect(h.played('acknowledge')).toHaveLength(1);
    expect(h.voiced()[0]!.caption).toBe('server acknowledge');
    expect(h.telemetry.some((t) => t.kind === 'dropped' && t.intent === 'acknowledge' && t.reason === 'server_played')).toBe(true);
  });

  it('R1: a server frame that arrives before the owner turn is known keeps the runner from firing that intent', async () => {
    const h = await createRunnerHarness();
    h.runner.frame({ type: 'reflex.say', data: serverSay(h, chief, 'acknowledge', 'turn_early') });
    await h.clock.advance(50);
    h.turn(chief, 'turn_early', 'Can you draft a follow-up to Kirsten?');
    await h.clock.advance(1000);
    h.runner.conversation({ kind: 'first_token', turnId: 'turn_early', at: at(h), hint: null });
    await h.clock.advance(3000);
    expect(h.played('acknowledge')).toHaveLength(1);
    expect(h.telemetry.find((t) => t.kind === 'skipped' && t.intent === 'acknowledge')).toMatchObject({ reason: 'server_played', turnId: 'turn_early' });
  });

  it('the runner first: a later server frame for the same turn and intent is ignored', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_cf', 'Can you draft a follow-up to Kirsten?');
    await h.clock.advance(400); // the runner's acknowledgement started
    h.runner.frame({ type: 'reflex.say', data: serverSay(h, chief, 'acknowledge', 'turn_cf') });
    h.runner.conversation({ kind: 'first_token', turnId: 'turn_cf', at: at(h), hint: null });
    await h.clock.advance(3000);
    expect(h.played('acknowledge')).toHaveLength(1);
    expect(h.voiced().map((v) => v.caption)).not.toContain('server acknowledge');
  });

  it('R3: telemetry of a turn’s reflexes carries its turnId', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_tel', 'Can you draft a follow-up to Kirsten?');
    await h.clock.advance(3000);
    const ack = h.played('acknowledge')[0]!;
    expect(ack.turnId).toBe('turn_tel');
  });
});
