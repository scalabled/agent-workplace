// The living runtime wired to the store, the voices and a fake audio engine, on the engine's fixture catalog:
// Talk hooks (the owner turn after the 202, held first tokens, hints, reflex replies never spoken twice, sending
// while the Chief speaks), the tab rules for server reflexes, the Floor (one line per sweep, Quiet, reduced motion)
// and the socket ops sent after every connect.
import { slimIndex } from '@headcount/catalog/slim';
import { createFakeClock, fixtureCatalog, PROFILES, type FakeClock } from '@headcount/expressions/testing';
import { buildAgentIndex, type AgentExpressionProfile } from '@headcount/expressions';
import { CHIEF_ID, makeFrame, type Frame, type FrameInput, type FrameType } from '@headcount/protocol';
import type { ExprAgentResponse, ExprRecentOp, ReflexSayData, ViewerOp } from '@headcount/protocol/ext/expressions';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../catalog';
import { navigate, paths } from '../router';
import { applyFrame, capabilities, feedEpoch, jobs, lastSeq, replayThrough, settings, sideThreads, thread } from '../store';
import { sendOwnerMessage } from '../talk/actions';
import { greetedThisSession } from '../talk/draft';
import { createFakeAudio, type FakeAudio } from '../test/fake-audio';
import { chiefSpeaker, startChiefVoice } from '../voice/chief-voice';
import { setAudioEngine } from '../voice/engine';
import { clientId } from '../lib/client-id';
import { applyServerVoice, claimVoice, resetVoiceOwner, setVoiceSend } from '../voice/owner';
import { captionLog, resetCaptions } from './captions';
import { cueLog, faceBias, resetFaces } from './faces';
import { beginSend, living } from './index';
import { createLivingRuntime, type RuntimeApi } from './runtime';
import type { LivingRuntime } from './types';

const LEAD = slimIndex.catalog.leads[0]!.id;
/** 10:00 owner-local on a Monday: daytime, outside quiet hours whatever the machine's zone. */
const DAY = new Date(2026, 9, 5, 10, 0).getTime();

const f = <T extends FrameType>(input: FrameInput<T>, seq?: number) => makeFrame('ws:local', input, seq === undefined ? { after: 0 } : { seq }) as unknown as Frame;
let seq = 100;
const persisted = <T extends FrameType>(input: FrameInput<T>) => f(input, ++seq);

function response(profile: AgentExpressionProfile, provider: ExprAgentResponse['provider'] = 'browser'): ExprAgentResponse {
  const cat = fixtureCatalog();
  const voiceKey = `${provider}:${profile.voice.xai ?? '-'}`;
  return {
    agentId: profile.agentId,
    personaId: profile.personaId,
    catalogVersion: cat.version,
    profile: profile as ExprAgentResponse['profile'],
    staffed: profile.agentId === CHIEF_ID,
    provider,
    voiceKey,
    manifest: { agentId: profile.agentId, catalogVersion: cat.version, provider, voiceKey, clips: {} },
    prevoice: null,
    baseline: { valence: 0.3, energy: 0.1 },
    reactivity: 1,
    mood: null,
    attention: null,
  };
}

/** Any coworker id answers with a Directory persona built on the fixture's tech lead (unstaffed). */
function coworker(agentId: string): AgentExpressionProfile {
  const base = PROFILES.jelena as AgentExpressionProfile;
  const personaId = agentId.slice(3);
  return { ...base, agentId, personaId, firstName: personaId.charAt(0).toUpperCase() + personaId.slice(1) };
}

interface Rig {
  rt: LivingRuntime;
  clock: FakeClock;
  engine: FakeAudio;
  sent: (ViewerOp | ExprRecentOp)[];
}

let engine: FakeAudio;
let rigs: LivingRuntime[] = [];

function rig(opts: { provider?: ExprAgentResponse['provider']; api?: Partial<RuntimeApi>; fetch?: (url: string) => Promise<Response> } = {}): Rig {
  const clock = createFakeClock(DAY);
  const sent: (ViewerOp | ExprRecentOp)[] = [];
  const api: RuntimeApi = {
    exprAgent: async (id) => response(id === CHIEF_ID ? (PROFILES.chief as AgentExpressionProfile) : coworker(id), opts.provider ?? 'browser'),
    exprRender: async () => {
      throw new Error('no renders in these tests');
    },
    exprPrevoice: async () => ({ accepted: true, runId: null, provider: 'browser', planned: 0, alreadyCached: 0, toRender: 0, estAudioMs: 0, remainingToday: 0 }),
    exprPrevoiceStatus: async () => {
      throw new Error('no runs');
    },
    ...opts.api,
  };
  const rt = createLivingRuntime({ catalog: fixtureCatalog(), engine: () => engine, send: (op) => sent.push(op), api, fetch: opts.fetch ?? (async () => new Response('', { status: 404 })), now: clock.now, schedule: clock.schedule });
  rigs.push(rt);
  living.value = rt;
  return { rt, clock, engine, sent };
}

beforeAll(() => {
  catalog.value = slimIndex;
});

beforeEach(() => {
  engine = createFakeAudio();
  setAudioEngine(engine);
  resetCaptions();
  resetFaces();
  capabilities.value = null;
  settings.value = { workspaceId: 'local', leadId: LEAD, chiefName: null, voiceOn: true, updatedAt: 'a', ambience: 'lively' };
  thread.value = [];
  sideThreads.value = {};
  jobs.value = {};
  lastSeq.value = 0;
  replayThrough.value = 0;
  feedEpoch.value = 0;
  greetedThisSession.value = false;
  navigate(paths.projects);
});

afterEach(() => {
  for (const r of rigs) r.dispose();
  rigs = [];
  living.value = null;
  resetVoiceOwner();
  vi.unstubAllGlobals();
});

describe('Talk hooks (B5)', () => {
  it('starts the owner turn when the 202 comes back, with the server turnId and the send time', async () => {
    const { rt } = rig();
    const ownerTurn = vi.spyOn(rt.runner, 'ownerTurn');
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { opId: string };
      return new Response(JSON.stringify({ accepted: true, opId: body.opId, turnId: 'turn_srv', messageId: 'msg_o' }), { status: 202 });
    });
    const before = Date.now();
    await sendOwnerMessage('Can you look into three packaging suppliers?');
    expect(ownerTurn).toHaveBeenCalledTimes(1);
    const e = ownerTurn.mock.calls[0]![0];
    expect(e).toMatchObject({ agentId: CHIEF_ID, turnId: 'turn_srv', mode: 'text', text: 'Can you look into three packaging suppliers?' });
    expect(e.at).toBeGreaterThanOrEqual(before);
    expect(e.cues.request).toBeGreaterThanOrEqual(0.6);
  });

  it('holds a first token that beats the 202, then replays it with its reaction hint', () => {
    const { rt } = rig();
    const conversation = vi.spyOn(rt.runner, 'conversation');
    const settle = beginSend();
    applyFrame(f({ type: 'talk.delta', data: { turnId: 'turn_b', messageId: 'msg_b', agentId: CHIEF_ID, delta: 'Ha, ', hint: 'laugh' } }));
    expect(conversation).not.toHaveBeenCalled();
    rt.ownerTurn({ agentId: CHIEF_ID, turnId: 'turn_b', at: Date.now(), mode: 'text', text: 'haha the printer is haunted again' });
    settle();
    expect(conversation).toHaveBeenCalledWith({ kind: 'first_token', turnId: 'turn_b', at: expect.any(Number), hint: 'laugh' });
    // Later deltas of the same turn are not first tokens.
    applyFrame(f({ type: 'talk.delta', data: { turnId: 'turn_b', messageId: 'msg_b', agentId: CHIEF_ID, delta: 'so' } }));
    expect(conversation.mock.calls.filter(([e]) => e.kind === 'first_token')).toHaveLength(1);
  });

  it('a turn of this tab whose end comes back replayed (it finished while the socket was down) closes silently', async () => {
    const { rt, clock } = rig();
    const stop = startChiefVoice();
    const conversation = vi.spyOn(rt.runner, 'conversation');
    rt.ownerTurn({ agentId: CHIEF_ID, turnId: 'turn_rp', at: clock.now(), mode: 'voice', text: 'What should we focus on this week?' });
    applyFrame(f({ type: 'talk.delta', data: { turnId: 'turn_rp', messageId: 'msg_rp', agentId: CHIEF_ID, delta: 'Let me look at the' } }));
    replayThrough.value = seq + 3;
    applyFrame(persisted({ type: 'talk.message', data: { turnId: 'turn_rp', messageId: 'msg_rp', agentId: CHIEF_ID, text: 'Let me look at the week first.', kind: 'reply' } }));
    applyFrame(persisted({ type: 'talk.done', data: { turnId: 'turn_rp', messageId: 'msg_rp', finish: 'stop', route: 'answer' } }));
    // History this tab never saw live reaches no one.
    applyFrame(persisted({ type: 'talk.done', data: { turnId: 'turn_old', messageId: 'msg_old', finish: 'stop', route: 'answer' } }));
    await engine.drain();
    await clock.advance(10);
    const ends = conversation.mock.calls.map(([e]) => e).filter((e) => e.kind === 'done' || e.kind === 'cancelled');
    expect(ends).toEqual([{ kind: 'done', turnId: 'turn_rp', at: expect.any(Number), replayed: true }]);
    // Nothing is voiced for it afterwards: not the rest of the reply, not a "still working on it".
    await clock.advance(10_000);
    expect(engine.spoken.flatMap((r) => r.chunks)).toEqual([]);
    expect(engine.reflexes).toEqual([]);
    stop();
  });

  it('never speaks a reflex reply through the Chief’s speaker (its clip voices it)', async () => {
    rig();
    const stop = startChiefVoice();
    applyFrame(persisted({ type: 'talk.message', data: { turnId: 'turn_t', messageId: 'msg_r', agentId: CHIEF_ID, text: 'Anytime.', kind: 'reflex', intent: 'gratitude_reply', lineId: 'warm.gratitude_reply.01' } }));
    await engine.drain();
    expect(engine.spoken).toHaveLength(0);
    applyFrame(persisted({ type: 'talk.message', data: { turnId: 'turn_u', messageId: 'msg_u', agentId: CHIEF_ID, text: 'Here is the plan.', kind: 'reply' } }));
    await engine.drain();
    expect(engine.spoken).toHaveLength(1);
    expect(thread.value.find((m) => m.messageId === 'msg_r')?.kind).toBe('reflex');
    stop();
  });

  describe('sending while the Chief speaks (§2.3)', () => {
    const accept = () =>
      vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { opId: string };
        return new Response(JSON.stringify({ accepted: true, opId: body.opId, turnId: `turn_${body.opId}`, messageId: `msg_${body.opId}` }), { status: 202 });
      });
    const speaking = (remainingMs: number) => engine.setActivity(CHIEF_ID, { conversation: true, remainingMs, streamOpen: false });

    it('a stop or steer ends the reply at the sentence boundary', async () => {
      const { rt } = rig();
      accept();
      expect(rt.cues('wait, stop — do the invoices first').stopOrSteer).toBeGreaterThanOrEqual(0.6);
      speaking(1500);
      await sendOwnerMessage('wait, stop — do the invoices first');
      expect(engine.boundaryStops).toEqual([CHIEF_ID]);
      expect(engine.stops).toEqual([]);
    });

    it('under 2.5 s left it finishes; 2.5–8 s it finishes and juggles; over 8 s it stops at the boundary', async () => {
      const { rt } = rig();
      accept();
      speaking(2000);
      await sendOwnerMessage('what about Tuesday?');
      speaking(5000);
      expect(rt.sendDecision(CHIEF_ID, 'and the budget?')).toBe('juggle');
      await sendOwnerMessage('and the budget?');
      expect(engine.boundaryStops).toEqual([]);
      expect(engine.stops).toEqual([]);
      speaking(12_000);
      await sendOwnerMessage('one more thing');
      expect(engine.boundaryStops).toEqual([CHIEF_ID]);
    });

    it('without the living layer the voice stops at once, as before', async () => {
      accept();
      living.value = null;
      speaking(5000);
      await sendOwnerMessage('what about Tuesday?');
      expect(engine.stops).toContain(CHIEF_ID);
    });
  });
});

describe('which tab plays a server reflex (§3.3)', () => {
  const say = (over: Partial<ReflexSayData> = {}): ReflexSayData => ({
    agentId: CHIEF_ID, intent: 'gratitude_reply', lineId: 'warm.gratitude_reply.01', fillKey: '', caption: 'Anytime.', clip: null, render: null,
    channels: { voice: true, bubble: true, caption: 'line' }, face: { gesture: 'smile', expression: 'delighted', holdMs: 1200 }, gainDb: 0, priority: 1, ttlMs: 1500, audience: 'owner', ...over,
  });

  it('an owner-turn reflex plays only in the tab that sent the turn; others show the face', () => {
    const { rt } = rig();
    const frame = vi.spyOn(rt.runner, 'frame');
    applyFrame(f({ type: 'reflex.say', data: say({ turnId: 'turn_elsewhere' }) }));
    expect(frame.mock.calls.map(([x]) => x.type)).toEqual(['reflex.face']);
    rt.ownerTurn({ agentId: CHIEF_ID, turnId: 'turn_mine', at: Date.now(), mode: 'text', text: 'thanks' });
    applyFrame(f({ type: 'reflex.say', data: say({ turnId: 'turn_mine' }) }));
    expect(frame.mock.calls.map(([x]) => x.type)).toEqual(['reflex.face', 'reflex.say']);
  });

  it('holds a reflex for a turn still being sent, then plays it once the turn is ours', () => {
    const { rt } = rig();
    const frame = vi.spyOn(rt.runner, 'frame');
    const settle = beginSend();
    applyFrame(f({ type: 'reflex.say', data: say({ turnId: 'turn_fast' }) }));
    expect(frame).not.toHaveBeenCalled();
    rt.ownerTurn({ agentId: CHIEF_ID, turnId: 'turn_fast', at: Date.now(), mode: 'text', text: 'thanks' });
    settle();
    expect(frame.mock.calls.map(([x]) => x.type)).toEqual(['reflex.say']);
  });

  it('one voice per workspace: a tab without the voice captions reflexes and never plays one', async () => {
    const { rt, clock } = rig();
    navigate(paths.talk);
    await clock.advance(10);
    const setSettings = vi.spyOn(rt.runner, 'setSettings');
    applyServerVoice({ clientId: 'cOTHERTAB0000000', reason: 'claim', at: 0 });
    expect(setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ voiceOn: false }));
    rt.ownerTurn({ agentId: CHIEF_ID, turnId: 'turn_other', at: Date.now(), mode: 'text', text: 'thanks' });
    applyFrame(f({ type: 'reflex.say', data: say({ turnId: 'turn_other' }) }));
    applyFrame(f({ type: 'reflex.say', data: say({ intent: 'micro_status', lineId: 'warm.micro_status.01', caption: 'Halfway there.' }) }));
    await clock.advance(3000);
    expect(engine.reflexes).toEqual([]);
    // The voice comes back to this tab: voice on again for the next line.
    applyServerVoice({ clientId: clientId(), reason: 'claim', at: 0 });
    expect(setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ voiceOn: true }));
  });

  it('one voice per workspace: a reaction that arrives before this tab’s claim is echoed stays with the device that had the voice', () => {
    const { rt } = rig();
    navigate(paths.talk);
    const frame = vi.spyOn(rt.runner, 'frame');
    const sent: { claimId: string }[] = [];
    setVoiceSend((op) => sent.push(op));
    applyServerVoice({ clientId: 'cOTHERTAB0000000', reason: 'claim', at: 0 });
    claimVoice();
    applyFrame(f({ type: 'reflex.say', data: say({ intent: 'micro_status', lineId: 'warm.micro_status.01', caption: 'Halfway there.' }) }));
    applyServerVoice({ clientId: clientId(), reason: 'claim', claimId: sent[0]!.claimId, at: 0 });
    applyFrame(f({ type: 'reflex.say', data: say({ intent: 'micro_status', lineId: 'warm.micro_status.02', caption: 'Nearly there.' }) }));
    const says = frame.mock.calls.filter(([x]) => x.type === 'reflex.say').map(([x]) => (x.data as ReflexSayData).channels.voice);
    expect(says).toEqual([false, true]); // caption and face only, then voiced here
  });

  it('an event reflex plays only at that agent’s visible stage', () => {
    const { rt } = rig();
    const frame = vi.spyOn(rt.runner, 'frame');
    navigate(paths.floor);
    applyFrame(f({ type: 'reflex.say', data: say({ intent: 'micro_status', audience: 'owner' }) }));
    navigate(paths.talk);
    applyFrame(f({ type: 'reflex.say', data: say({ intent: 'micro_status', audience: 'owner' }) }));
    expect(frame.mock.calls.map(([x]) => x.type)).toEqual(['reflex.face', 'reflex.say']);
  });

  it('a phatic reply waits for the previous answer to finish (it is the next answer), with the face at once', async () => {
    const { rt, clock } = rig();
    const frame = vi.spyOn(rt.runner, 'frame');
    rt.ownerTurn({ agentId: CHIEF_ID, turnId: 'turn_thx', at: Date.now(), mode: 'text', text: 'thanks' });
    engine.setActivity(CHIEF_ID, { conversation: true, remainingMs: 3000, streamOpen: false });
    applyFrame(f({ type: 'reflex.say', data: say({ turnId: 'turn_thx' }) }));
    expect(frame.mock.calls.map(([x]) => x.type)).toEqual(['reflex.face']);
    await clock.advance(1000);
    expect(frame.mock.calls.map(([x]) => x.type)).toEqual(['reflex.face']);
    engine.setActivity(CHIEF_ID, null);
    await clock.advance(200);
    expect(frame.mock.calls.map(([x]) => x.type)).toEqual(['reflex.face', 'reflex.say']);
  });

  it('a celebration at Talk is a lead-in: the announcement waits for it, and a stale progress line gives way', async () => {
    const { rt, clock } = rig();
    navigate(paths.talk);
    const frame = vi.spyOn(rt.runner, 'frame');
    const holdNext = vi.spyOn(chiefSpeaker, 'holdNext');
    // A progress line plays (browser voice here) and is still sounding when the job finishes.
    applyFrame(f({ type: 'reflex.say', data: say({ intent: 'micro_status', caption: 'Three of five so far.', ttlMs: 20_000 }) }));
    await clock.advance(1000);
    await engine.drain();
    const progress = engine.reflexes.find((r) => r.key === 'Three of five so far.');
    expect(progress?.stopped).toBe(false);
    engine.setActivity(CHIEF_ID, { reflex: true });
    applyFrame(f({ type: 'reflex.say', data: say({ intent: 'celebrate', caption: 'Nice.', ttlMs: 3000 }) }));
    expect(holdNext).toHaveBeenCalledTimes(1);
    expect(progress?.stopped).toBe(true);
    expect(frame.mock.calls.filter(([x]) => x.type === 'reflex.say')).toHaveLength(2);
    holdNext.mockRestore();
  });

  it('mood reaches the faces and the mood cache', () => {
    const { rt } = rig();
    const frame = vi.spyOn(rt.runner, 'frame');
    const bias = { expression: 'delighted' as const, weight: 0.5, cornerPull: 0.2, brow: 0.1, pitchDeg: 2, blinkScale: 1, swayScale: 1 };
    applyFrame(f({ type: 'mood.changed', data: { agentId: CHIEF_ID, valence: 0.6, energy: 0.3, at: Date.now(), baseline: { valence: 0.3, energy: 0.1 }, bias, reason: 'job.done' } }));
    expect(frame).toHaveBeenCalledWith(expect.objectContaining({ type: 'mood.changed' }));
  });
});

describe('the Floor (B6)', () => {
  const desks = ['cw_ana', 'cw_ben', 'cw_cai', 'cw_dee', 'cw_eli', 'cw_fay'];

  async function sweep(r: Rig, restMs: number) {
    for (const id of desks) {
      r.rt.hover(id, 'enter', 'pointer');
      await r.clock.advance(20);
      r.rt.hover(id, 'dwell', 'pointer');
      await r.clock.advance(restMs);
      r.rt.hover(id, 'leave', 'pointer');
    }
  }

  it('a sweep across six desks yields at most one line; every face still looks up', async () => {
    const r = rig();
    navigate(paths.floor);
    await sweep(r, 700);
    const lines = captionLog.filter((c) => c.kind === 'bubble');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.agentId).toBe('cw_ana');
    const lookedUp = new Set(cueLog.filter((c) => c.cue.gesture === 'look_up').map((c) => c.agentId));
    expect([...lookedUp].sort()).toEqual([...desks].sort());
  });

  it('a Directory coworker’s line is honest: they are on no project yet (H2)', async () => {
    const r = rig();
    navigate(paths.floor);
    await sweep(r, 700);
    const line = captionLog.find((c) => c.kind === 'bubble')!;
    expect(line.text).not.toMatch(/\b(working on|finished|sent|booked|deployed|drafted)\b/i);
  });

  it('Quiet turns hovers into look-ups only', async () => {
    const r = rig();
    navigate(paths.floor);
    settings.value = { ...settings.value!, ambience: 'quiet', updatedAt: 'b' };
    await sweep(r, 700);
    expect(captionLog.filter((c) => c.kind === 'bubble')).toEqual([]);
    expect(cueLog.some((c) => c.cue.gesture === 'look_up')).toBe(true);
  });

  it('reduced motion keeps the bubble and drops the gesture', async () => {
    const r = rig();
    navigate(paths.floor);
    r.rt.runner.setSettings({ reducedMotion: true });
    await sweep(r, 700);
    expect(captionLog.filter((c) => c.kind === 'bubble')).toHaveLength(1);
    expect(cueLog.filter((c) => c.cue.gesture !== 'none')).toEqual([]);
  });

  it('keyboard dwell shows a bubble and never a voice', async () => {
    const r = rig();
    navigate(paths.floor);
    r.rt.hover('cw_ana', 'dwell', 'keyboard');
    await r.clock.advance(1200);
    expect(captionLog.filter((c) => c.kind === 'bubble')).toHaveLength(1);
    expect(engine.reflexes).toEqual([]);
  });
});

describe('feel review: the Chief sounds varied and reacts aloud (Inc 0.5 fixes)', () => {
  /** A manifest with a clip for every candidate line of these intents (the fixture Chief). */
  function manifestFor(intents: string[]): ExprAgentResponse['manifest']['clips'] {
    const index = buildAgentIndex(fixtureCatalog(), PROFILES.chief as AgentExpressionProfile);
    const clips: ExprAgentResponse['manifest']['clips'] = {};
    let i = 0;
    for (const intent of intents) {
      for (const w of index.candidates(intent as Parameters<typeof index.candidates>[0])) {
        if (w.line.slots.length) continue;
        clips[`${w.line.id}|`] = { clipKey: `c1_${String(++i).padStart(32, 'a')}`.slice(0, 35), durationMs: 1200, scope: 'shared' };
      }
    }
    return clips;
  }

  it('pre-voices the Chief with every thinking filler in P0, then P1', async () => {
    const requests: unknown[] = [];
    rig({
      provider: 'mock',
      api: {
        exprPrevoice: async (req) => {
          requests.push(req);
          return { accepted: true, runId: null, provider: 'mock', planned: 0, alreadyCached: 0, toRender: 0, estAudioMs: 0, remainingToday: 0, reused: true };
        },
      },
    });
    feedEpoch.value = 1;
    navigate(paths.talk);
    for (let i = 0; i < 20 && requests.length < 2; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(requests).toEqual([
      { agentIds: [CHIEF_ID], tiers: ['p0'], allLinesFor: ['thinking_filler'] },
      { agentIds: [CHIEF_ID], tiers: ['p1'] },
    ]);
  });

  it('decodes the reactions (sympathy, concern, delight …) after P0, so they can be voiced', async () => {
    const clips = manifestFor(['acknowledge', 'sympathy', 'concern']);
    const fetched: string[] = [];
    const r = rig({
      provider: 'mock',
      api: { exprAgent: async (id) => ({ ...response(PROFILES.chief as AgentExpressionProfile, 'mock'), agentId: id, manifest: { ...response(PROFILES.chief as AgentExpressionProfile, 'mock').manifest, clips } }) },
      fetch: async (url) => {
        fetched.push(url);
        return new Response('', { status: 404 });
      },
    });
    await r.rt.ensureAgent(CHIEF_ID);
    await new Promise((res) => setTimeout(res, 0));
    const index = buildAgentIndex(fixtureCatalog(), PROFILES.chief as AgentExpressionProfile);
    const keysOf = (intent: string) => Object.entries(clips).filter(([k]) => index.candidates(intent as Parameters<typeof index.candidates>[0]).some((w) => `${w.line.id}|` === k)).map(([, c]) => c.clipKey);
    const asked = () => new Set(fetched.map((u) => u.split('/').pop()!.replace(/\.json$|\/align$/, '')));
    expect(keysOf('sympathy').some((k) => asked().has(k))).toBe(false); // P0 first
    await r.clock.advance(1600);
    for (let i = 0; i < 10; i++) await new Promise((res) => setTimeout(res, 0));
    expect(keysOf('sympathy').some((k) => fetched.some((u) => u.includes(k)))).toBe(true);
    expect(keysOf('concern').some((k) => fetched.some((u) => u.includes(k)))).toBe(true);
  });

  it('a pointer crossing a desk loads nothing; the profile loads on the dwell', async () => {
    const asked: string[] = [];
    const r = rig({ api: { exprAgent: async (id) => (asked.push(id), response(coworker(id))) } });
    navigate(paths.floor);
    for (const id of ['cw_ana', 'cw_ben', 'cw_cai']) {
      r.rt.hover(id, 'enter', 'pointer');
      await r.clock.advance(50);
      r.rt.hover(id, 'leave', 'pointer');
    }
    expect(asked.filter((id) => id !== CHIEF_ID)).toEqual([]);
    r.rt.hover('cw_dee', 'enter', 'pointer');
    r.rt.hover('cw_dee', 'dwell', 'pointer');
    await r.clock.advance(10);
    expect(asked).toContain('cw_dee');
  });

  it('a new lead with no mood yet clears the previous lead’s face palette', async () => {
    let mood: ExprAgentResponse['mood'] = { agentId: CHIEF_ID, valence: 0.7, energy: 0.4, baseline: { valence: 0.3, energy: 0.1 }, reason: 'job.done', at: DAY, bias: { expression: 'delighted', weight: 0.4, cornerPull: 0.3, brow: 0.02, pitchDeg: 1, blinkScale: 1, swayScale: 1 } } as ExprAgentResponse['mood'];
    const r = rig({ api: { exprAgent: async (id) => ({ ...response(PROFILES.chief as AgentExpressionProfile), agentId: id, mood }) } });
    await r.rt.ensureAgent(CHIEF_ID);
    expect(faceBias(CHIEF_ID)?.expression).toBe('delighted');
    mood = null;
    settings.value = { ...settings.value!, leadId: slimIndex.catalog.leads[1]!.id, updatedAt: 'c' };
    for (let i = 0; i < 10; i++) await new Promise((res) => setTimeout(res, 0));
    expect(faceBias(CHIEF_ID)).toBeNull();
  });
});

describe('socket ops (B8)', () => {
  it('sends the viewer state and recency after every connect, and the viewer on a route change', async () => {
    const r = rig();
    navigate(paths.talk);
    feedEpoch.value = 1;
    expect(r.sent.map((o) => o.op)).toEqual(['viewer', 'expr.recent']);
    expect(r.sent[0]).toMatchObject({ op: 'viewer', surface: 'talk', stageAgentId: CHIEF_ID, voiceOn: true });
    navigate(paths.floor);
    await r.clock.advance(300);
    expect(r.sent.at(-1)).toMatchObject({ op: 'viewer', surface: 'floor', floorVisible: true });
    feedEpoch.value = 2;
    expect(r.sent.slice(-2).map((o) => o.op)).toEqual(['viewer', 'expr.recent']);
  });

  it('opens the Chief’s stage on Talk once the feed has caught up, greeting on a first meeting', async () => {
    const r = rig();
    const stage = vi.spyOn(r.rt.runner, 'stage');
    navigate(paths.talk);
    await r.clock.advance(10);
    expect(stage).not.toHaveBeenCalled(); // the feed has not caught up yet
    feedEpoch.value = 1;
    await r.clock.advance(10);
    expect(stage).toHaveBeenCalledWith(CHIEF_ID, 'open');
    navigate(paths.floor);
    expect(stage).toHaveBeenLastCalledWith(CHIEF_ID, 'close', 'navigate');
  });
});
