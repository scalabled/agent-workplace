// The living runtime's office additions (OFFICE-PHASE2 §4.5.13): the huddle packs kept at boot, the shared ambient
// voice window, mood and provider lookups, room frames ignored, the viewer reporting a room, and sayIntent (the Join
// greeting and the sign-off), which never plays in a tab without the voice.
import { slimIndex } from '@headcount/catalog/slim';
import { createFakeClock, fixtureCatalog, PROFILES } from '@headcount/expressions/testing';
import type { AgentExpressionProfile } from '@headcount/expressions';
import { CHIEF_ID, makeFrame, type Frame, type FrameInput, type FrameType } from '@headcount/protocol';
import type { ExprAgentResponse, ExprRecentOp, ViewerOp } from '@headcount/protocol/ext/expressions';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../catalog';
import { clientId } from '../lib/client-id';
import { navigate, paths } from '../router';
import { applyFrame, feedEpoch, jobs, lastSeq, replayThrough, settings, sideThreads, thread } from '../store';
import { createFakeAudio, type FakeAudio } from '../test/fake-audio';
import { setAudioEngine } from '../voice/engine';
import { applyServerVoice, resetVoiceOwner } from '../voice/owner';
import { resetCaptions } from './captions';
import { resetFaces } from './faces';
import { living } from './index';
import { createLivingRuntime, isRoomTalk, type RuntimeApi } from './runtime';
import type { LivingRuntime } from './types';
import { officeStage, viewerOp } from './viewer';

const LEAD = slimIndex.catalog.leads[0]!.id;
const DAY = new Date(2026, 9, 5, 10, 0).getTime();
const f = <T extends FrameType>(input: FrameInput<T>, seq?: number) => makeFrame('ws:local', input, seq === undefined ? { after: 0 } : { seq }) as unknown as Frame;

function response(profile: AgentExpressionProfile, provider: ExprAgentResponse['provider']): ExprAgentResponse {
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

let engine: FakeAudio;
let rigs: LivingRuntime[] = [];

function rig(provider: ExprAgentResponse['provider'] = 'xai') {
  const clock = createFakeClock(DAY);
  const sent: (ViewerOp | ExprRecentOp)[] = [];
  const renders: unknown[] = [];
  const api: RuntimeApi = {
    exprAgent: async (id) => response(id === CHIEF_ID ? (PROFILES.chief as AgentExpressionProfile) : (PROFILES.jelena as AgentExpressionProfile), provider),
    exprRender: async (req) => {
      renders.push(req);
      return { clipKey: `ck_${renders.length}`, url: '', alignmentUrl: '', durationMs: 600, scope: 'shared', cached: false };
    },
    exprPrevoice: async () => ({ accepted: true, runId: null, provider, planned: 0, alreadyCached: 0, toRender: 0, estAudioMs: 0, remainingToday: 0 }),
    exprPrevoiceStatus: async () => {
      throw new Error('no runs');
    },
  };
  const rt = createLivingRuntime({
    catalog: fixtureCatalog(),
    engine: () => engine,
    send: (op) => sent.push(op),
    api,
    fetch: async (url) => (url.includes('/align') ? new Response('{}', { status: 404 }) : new Response(new ArrayBuffer(16), { headers: { 'content-type': 'audio/mpeg' } })),
    now: clock.now,
    schedule: clock.schedule,
    huddles: { version: 'h1_test', packs: [{ kind: 'huddle_pack', id: 'hd-test', exchanges: [] }] },
  });
  rigs.push(rt);
  living.value = rt;
  return { rt, clock, sent, renders };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeAll(() => {
  catalog.value = slimIndex;
});

beforeEach(() => {
  engine = createFakeAudio();
  setAudioEngine(engine);
  resetCaptions();
  resetFaces();
  resetVoiceOwner();
  settings.value = { workspaceId: 'local', leadId: LEAD, chiefName: null, voiceOn: true, updatedAt: 'a', ambience: 'lively', ownerName: 'Dana Reyes' };
  thread.value = [];
  sideThreads.value = {};
  jobs.value = {};
  lastSeq.value = 0;
  replayThrough.value = 0;
  feedEpoch.value = 0;
  officeStage.value = null;
  navigate(paths.floor);
});

afterEach(() => {
  for (const r of rigs) r.dispose();
  rigs = [];
  living.value = null;
  setAudioEngine(null);
  officeStage.value = null;
});

describe('the living runtime for the office', () => {
  it('keeps the huddle packs and shares its ambient voice window', () => {
    const { rt } = rig();
    expect(rt.huddles?.version).toBe('h1_test');
    expect(rt.ambientVoice.leftMs()).toBe(20_000);
    rt.ambientVoice.spend(5000);
    expect(rt.ambientVoice.leftMs()).toBe(15_000);
  });

  it('knows moods, providers and profiles of loaded agents only', async () => {
    const { rt } = rig();
    expect(rt.moodOf('cw_tech-lead')).toBeNull();
    expect(rt.provider('cw_tech-lead')).toBeNull();
    expect(await rt.ensureAgent('cw_tech-lead')).toBe(true);
    expect(rt.provider('cw_tech-lead')).toBe('xai');
    expect(rt.profileOf('cw_tech-lead')?.firstName).toBe('Jelena');
    expect(rt.moodOf('cw_tech-lead')).toMatchObject({ valence: expect.any(Number), energy: expect.any(Number) });
  });

  it('ignores room turns: they are the room session’s, not the runner’s conversations', () => {
    const { rt } = rig();
    const conv = vi.spyOn(rt.runner, 'conversation');
    const room = { surface: 'room' as const, roomId: 'skyline' as const, meetingId: 'mtg_01j00000000000000000000000' };
    const frames = [
      f({ type: 'talk.delta', data: { turnId: 'turn_r', messageId: 'msg_r', agentId: 'cw_tech-lead', delta: 'Hello. ', ...room } }),
      f({ type: 'talk.done', data: { turnId: 'turn_r', messageId: 'msg_r', agentId: 'cw_tech-lead', finish: 'stop', ...room } } as FrameInput<'talk.done'>),
    ];
    for (const fr of frames) expect(isRoomTalk(fr)).toBe(true);
    for (const fr of frames) applyFrame(fr);
    expect(conv).not.toHaveBeenCalled();
    applyFrame(f({ type: 'talk.delta', data: { turnId: 'turn_t', messageId: 'msg_t', agentId: CHIEF_ID, delta: 'Hi. ' } }));
    expect(conv).toHaveBeenCalled();
  });

  it('reports a room to the server while the Office’s stage is open', () => {
    const base = { route: { name: 'floor' as const, params: {} }, audioArmed: true, voiceOn: true, pageVisible: true, reducedMotion: false, quietHours: false, tzOffsetMin: 0, voice: null };
    expect(viewerOp(base)).toMatchObject({ surface: 'floor', floorVisible: true });
    expect(viewerOp({ ...base, office: { mode: 'conference', roomId: 'skyline' } })).toMatchObject({ surface: 'room', floorVisible: false, stageAgentId: null });
    expect(viewerOp({ ...base, office: { mode: 'desks', roomId: null } })).toMatchObject({ surface: 'floor' });
  });

  it('sayIntent greets with catalog text at once and voices it in the tab with the voice', async () => {
    const { rt, renders } = rig('xai');
    const r = await rt.sayIntent('cw_tech-lead', 'greeting');
    expect(r?.text.length).toBeGreaterThan(0);
    expect(r?.voiced).toBe(true);
    await settle();
    expect(renders).toHaveLength(1);
    expect(engine.reflexes.map((x) => [x.speakerId, x.bus])).toEqual([['cw_tech-lead', 'reflex']]);
  });

  it('sayIntent never plays without the voice (another tab has it), keyless, or with voice off', async () => {
    applyServerVoice({ clientId: 'cOTHERTAB0000000', reason: 'claim', at: 0 });
    const a = rig('xai');
    const r = await a.rt.sayIntent('cw_tech-lead', 'greeting');
    expect(r?.voiced).toBe(false);
    await settle();
    expect(engine.reflexes).toEqual([]);
    applyServerVoice({ clientId: clientId(), reason: 'claim', at: 0 });

    const keyless = rig('browser');
    expect((await keyless.rt.sayIntent('cw_tech-lead', 'sign_off'))?.voiced).toBe(false);
    settings.value = { ...settings.value!, voiceOn: false, updatedAt: 'b' };
    const off = rig('xai');
    expect((await off.rt.sayIntent('cw_tech-lead', 'greeting'))?.voiced).toBe(false);
    await settle();
    expect(engine.reflexes).toEqual([]);
  });

  it('sayIntent greets the owner by name when a line with the name is allowed now', async () => {
    // The fixture pack has one named greeting and one without ("Ah. Hello."): whatever minute seeds the pick, the
    // named one wins while the owner has a name, and without a name the other one is still said.
    for (let minute = 0; minute < 6; minute++) {
      const { rt, clock } = rig('browser');
      await clock.advance(minute * 60_000);
      expect((await rt.sayIntent('cw_tech-lead', 'greeting'))?.text, `minute ${minute}`).toMatch(/\bDana\b/);
      rt.dispose();
    }
    settings.value = { ...settings.value!, ownerName: null, updatedAt: 'b' };
    const said = new Set<string>();
    for (let minute = 0; minute < 6; minute++) {
      const { rt, clock } = rig('browser');
      await clock.advance(minute * 60_000);
      said.add((await rt.sayIntent('cw_tech-lead', 'greeting'))?.text ?? '');
      rt.dispose();
    }
    expect([...said].some((t) => !/Dana/.test(t) && t.length > 0)).toBe(true);
  });

  it('a clip that arrives after the voice moved plays nothing', async () => {
    const { rt } = rig('xai');
    const r = await rt.sayIntent('cw_tech-lead', 'greeting');
    expect(r?.voiced).toBe(true);
    applyServerVoice({ clientId: 'cOTHERTAB0000000', reason: 'claim', at: 0 });
    await settle();
    expect(engine.reflexes).toEqual([]);
  });
});
