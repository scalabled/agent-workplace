import { describe, expect, it } from 'vitest';
import { manifestClips, moodEventFor, planServerReflex, reflexIntentFor } from './events';
import type { ServerReflexArgs, ViewerState } from './events';
import { createChatterBudget, createTimingGate } from './gate';
import { applyMoodEvent, createMoodState } from './mood';
import { createRecencyMemory } from './recency';
import { fixtureCatalog, fixtureIndex, fixtureManifest, makeState, T0 } from './testing';
import type { Ambience } from './vocab';

const catalog = fixtureCatalog();
const chief = fixtureIndex('chief');
const atStage: ViewerState = { surface: 'talk', stageAgentId: 'cw_chief', floorVisible: false, visibleProjectIds: [], listeningProjectIds: [], audioArmed: true, voiceOn: true };

function args(over: Partial<ServerReflexArgs> & { ambience?: Ambience } = {}): ServerReflexArgs {
  const ambience = over.ambience ?? 'lively';
  const budget = createChatterBudget(catalog.ambience, ambience);
  return {
    catalog, gate: createTimingGate(catalog, budget), recency: createRecencyMemory(), index: chief,
    state: makeState('cw_chief', 'Samuel', { self: { presence: 'working' }, work: { stepLabel: 'Reading supplier quotes', done: 3, total: 5 } }),
    mood: { valence: 0.3, energy: 0.1 }, intent: 'micro_status', ambience, provider: 'xai', viewer: atStage, now: T0,
    cause: { streamId: 'p:everyday:local', seq: 1204 }, ...over,
  };
}

describe('work events → mood and event reflexes (§2.5, §6.2)', () => {
  it('maps work events to mood events and reflex intents', () => {
    expect(moodEventFor('verdict', 'approve')).toBe('verdict.approve');
    expect(moodEventFor('step.blocked')).toBe('step.blocked');
    expect(moodEventFor('job.progress')).toBeNull();
    expect(reflexIntentFor('job.progress')).toBe('micro_status');
    expect(reflexIntentFor('deliverable.accepted')).toBe('celebrate');
    expect(reflexIntentFor('step.retry')).toBe('oops');
    expect(reflexIntentFor('job.failed')).toBeNull();
    const s = applyMoodEvent(createMoodState('cw_chief', chief.baseline, chief.reactivity, T0), { kind: moodEventFor('step.blocked')!, at: T0 });
    expect(s.value.valence).toBeLessThan(chief.baseline.valence);
  });

  it('emits a grounded micro-status only to a viewer at the agent’s stage', async () => {
    const manifest = await fixtureManifest(chief, catalog, 'xai', { owner_name: 'Dana', self_name: 'Samuel' });
    const r = planServerReflex(args({ manifest }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.frame).toMatchObject({ agentId: 'cw_chief', intent: 'micro_status', audience: 'owner', cause: { streamId: 'p:everyday:local', seq: 1204 } });
    expect(r.frame.caption).toMatch(/Three of five|reading supplier quotes/);
    expect(r.frame.clip === null).toBe(r.frame.render !== null); // a clip, or a render request for runtime text
    expect(planServerReflex(args({ viewer: { ...atStage, surface: 'floor', stageAgentId: null } }))).toEqual({ ok: false, reason: 'no_viewer', face: null });
  });

  it('names the real blocker, celebrates a real win, and respects Quiet and cooldowns', () => {
    const blocked = planServerReflex(args({ intent: 'blocked', state: makeState('cw_chief', 'Samuel', { self: { presence: 'working', blocked: true }, work: { blocker: 'HubSpot needs a sign-in' } }) }));
    expect(blocked.ok && blocked.frame.caption).toMatch(/HubSpot needs a sign-in/);
    const a = args({ intent: 'celebrate', state: makeState('cw_chief', 'Samuel', { work: { artifact: 'the supplier shortlist' } }) });
    const win = planServerReflex(a);
    expect(win.ok).toBe(true);
    expect(planServerReflex({ ...a, now: T0 + 60_000, cause: { streamId: 'p:x', seq: 2 } })).toMatchObject({ ok: false, reason: 'cooldown' });
    const quiet = planServerReflex(args({ ambience: 'quiet' }));
    expect(quiet).toMatchObject({ ok: false, reason: 'ambience', face: { gesture: 'glance', expression: 'thinking' } });
  });

  it('answers a phatic thanks as the whole reply, in voice or text', async () => {
    const manifest = await fixtureManifest(chief, catalog, 'xai', { owner_name: 'Dana', self_name: 'Samuel' });
    const voice = planServerReflex(args({ intent: 'gratitude_reply', exchange: 'voice', turnId: 'turn_9', manifest, state: makeState('cw_chief', 'Samuel') }));
    if (!voice.ok) throw new Error(voice.reason);
    expect(voice.frame).toMatchObject({ intent: 'gratitude_reply', audience: 'owner', turnId: 'turn_9', channels: { voice: true, bubble: true, caption: 'line' } });
    expect(voice.frame.clip?.key).toMatch(/^c1_/);
    const text = planServerReflex(args({ intent: 'gratitude_reply', exchange: 'text', turnId: 'turn_10', state: makeState('cw_chief', 'Samuel') }));
    expect(text.ok && text.frame.channels).toEqual({ voice: false, bubble: true, caption: 'none' });
  });
});

describe('reflex-grade server picks (instantOnly)', () => {
  const chiefState = () => makeState('cw_chief', 'Samuel', { owner: { firstName: null } });

  it('picks only a line whose clip is already in the manifest', async () => {
    const full = await fixtureManifest(chief, catalog, 'xai', { self_name: 'Samuel' });
    const probe = planServerReflex(args({ intent: 'thinking_filler', exchange: 'voice', turnId: 'turn_probe', state: chiefState(), manifest: full, instantOnly: true }));
    if (!probe.ok) throw new Error(probe.reason);
    // Keep exactly one rendered clip: the instant pick must be that line, whatever the seed.
    const keep = Object.entries(full.clips).find(([k]) => k.startsWith(`${probe.frame.lineId}|`))!;
    const one = { ...full, clips: { [keep[0]]: keep[1] } };
    for (const turnId of ['turn_a', 'turn_b', 'turn_c']) {
      const r = planServerReflex(args({ intent: 'thinking_filler', exchange: 'voice', turnId, state: chiefState(), manifest: one, instantOnly: true }));
      if (!r.ok) throw new Error(r.reason);
      expect(r.frame.lineId).toBe(probe.frame.lineId);
      expect(r.frame.clip?.key).toBe(keep[1].clipKey);
    }
  });

  it('skips as not_instant when nothing is rendered, and falls back to clips from the caller', async () => {
    const empty = { agentId: 'cw_chief', catalogVersion: catalog.version, provider: 'xai' as const, voiceKey: 'xai:leo', clips: {} };
    const r = planServerReflex(args({ intent: 'acknowledge', exchange: 'voice', turnId: 'turn_n', state: chiefState(), manifest: empty, instantOnly: true }));
    expect(r).toMatchObject({ ok: false, reason: 'not_instant' });
    // Without instantOnly the same request picks a line and asks the client to render it.
    const any = planServerReflex(args({ intent: 'acknowledge', exchange: 'voice', turnId: 'turn_m', state: chiefState(), manifest: empty }));
    expect(any.ok && any.frame.clip === null && any.frame.render !== null).toBe(true);
    // Browser voices are always instant (speechSynthesis starts at once).
    const browser = planServerReflex(args({ intent: 'acknowledge', exchange: 'voice', turnId: 'turn_b2', state: chiefState(), provider: 'browser', instantOnly: true }));
    expect(browser.ok).toBe(true);
    const full = await fixtureManifest(chief, catalog, 'xai', { self_name: 'Samuel' });
    const viaClips = planServerReflex(args({ intent: 'acknowledge', exchange: 'voice', turnId: 'turn_c2', state: chiefState(), manifest: full, clips: manifestClips(full), instantOnly: true }));
    expect(viaClips.ok && viaClips.frame.clip?.key).toMatch(/^c1_/);
  });

  it('reads availability and durations from a manifest', () => {
    const m = { agentId: 'a', catalogVersion: 'v', provider: 'mock' as const, voiceKey: 'mock', clips: { 'x|': { clipKey: 'c1_a', durationMs: 640, scope: 'shared' as const, pronunciationChecked: true } } };
    const c = manifestClips(m);
    expect([c.has('c1_a'), c.has('c1_b'), c.durationMs('c1_a'), c.durationMs('c1_b'), c.pronunciationChecked?.('c1_a')]).toEqual([true, false, 640, null, true]);
  });
});
