// The content and timing review (docs/dev/living-workforce-critique.md, E1–E25): the engine behaviours that keep
// reflexes from presupposing what the owner said, wearing out over weeks, crowding the Floor or talking over a mood.
import { describe, expect, it } from 'vitest';
import { sniffOwnerText } from './affect';
import { buildAgentIndex, compileCatalog, topicsFor } from './catalog';
import { createRecencyMemory } from './recency';
import { lineOf, ownerDayKey, recordUtterance, selectLine } from './select';
import { deriveContexts, isGerundLabel } from './state';
import { AGENTS, createRunnerHarness, FIXTURE_SIGNATURES, fixtureCatalogInput, intentsFile, makeState, PROFILES, T0 } from './testing';
import type { AgentExpressionProfile, AgentIndex, ExpressionFrame, GroundingState, SelectRequest, SelectResult, SignatureFile } from './types';
import type { IntentId } from './vocab';

type SideTalkLineFrame = Extract<ExpressionFrame, { type: 'sidetalk.line' }>;

const lex = intentsFile.affect_lexicon;
const ctxOf = (text: string, over: Parameters<typeof makeState>[2] = {}) =>
  deriveContexts(makeState('cw_test', 'Tess', { ...over, exchange: { cues: sniffOwnerText(text, lex) } }));

// A small signature pack that exercises the review's line fields.
const TEST_FILE: SignatureFile = {
  kind: 'signature_file',
  group: 'industry-specialists',
  version: 1,
  packs: [
    {
      persona_id: 'test-persona',
      archetypes: { warm: 1 },
      laugh_style: { kind: 'warm_laugh', intensity: 0.5, readiness: 0.6, caption: '(laughs)', xai: '[laugh]', openai: { say: 'Ha!' } },
      lines: {
        acknowledge: [
          { id: 'test-persona.acknowledge.01', text: 'Love it. On it.', context: ['!owner_tone:negative'] },
          { id: 'test-persona.acknowledge.02', text: 'Noted. Next step, it lands.', context: ['steer_queued'] },
        ],
        delight: [
          { id: 'test-persona.delight.01', text: "Ooh, that's a star dish!", context: ['topic:hospitality'] },
          { id: 'test-persona.delight.02', text: "That's crazy good news!" },
          { id: 'test-persona.delight.03', text: 'Ka pai! Lovely.', lang: 'mi', gloss: 'te reo Māori: good, well done', family: 'ka-pai', tags: { openai: { instructions: '"Ka pai" is te reo Māori for good; say it naturally.' } } },
          { id: 'test-persona.delight.04', text: 'Ka pai, that one.', lang: 'mi', gloss: 'te reo Māori: good, well done', family: 'ka-pai', tags: { openai: { instructions: '"Ka pai" is te reo Māori for good; say it naturally.' } } },
        ],
        sidetalk_reply: [
          { id: 'test-persona.sidetalk_reply.01', text: 'Ha! Fair.', tags: { xai: '[laugh] Ha! Fair.' }, context: ['reply_to:review_changes'] },
          { id: 'test-persona.sidetalk_reply.02', text: 'Fair. Fixing it now.', context: ['reply_to:review_changes'] },
          { id: 'test-persona.sidetalk_reply.03', text: 'Thanks, lovely.', context: ['reply_to:share_result'] },
        ],
        unblocked: [{ id: 'test-persona.unblocked.01', text: 'Thanks for sorting that, {owner_name}!', slots: ['owner_name'], context: ['unblocked_by:owner'] }],
      },
      catchphrases: [],
      never_says: [],
      topics: { hospitality: ['menu', 'food cost'] },
      family_max_per_day: { 'ka-pai': 1 },
    },
  ],
};
const catalog = compileCatalog(fixtureCatalogInput({ signatures: [...FIXTURE_SIGNATURES, TEST_FILE] }));
const PROFILE: AgentExpressionProfile = { ...PROFILES.camila, agentId: 'cw_test', personaId: 'test-persona', firstName: 'Tess' };
const tess: AgentIndex = buildAgentIndex(catalog, PROFILE);

function req(intent: IntentId, seed: string, state: GroundingState, over: Partial<SelectRequest> = {}): SelectRequest {
  return { intent, state, mood: { valence: 0.3, energy: 0.1 }, ambience: 'lively', provider: 'xai', seed, now: T0, channel: 'text', ...over };
}
const picks = (intent: IntentId, state: GroundingState, over: Partial<SelectRequest> = {}, n = 60) => {
  const ids = new Set<string>();
  for (let i = 0; i < n; i++) {
    const r: SelectResult = selectLine(tess, req(intent, `s${i}`, state, over), createRecencyMemory());
    if (r.ok) ids.add(r.utterance.lineId);
  }
  return ids;
};

describe('contexts from the owner turn and the ledger (E4, E14, E18, E19, E23, E24)', () => {
  it('owner_question only for a real question; a request phrased as one is a request', () => {
    expect(ctxOf('What do you think about the new pricing tiers?').has('owner_question')).toBe(true);
    expect(ctxOf('Can you draft a follow-up to Kirsten?').has('owner_question')).toBe(false);
    expect(ctxOf('Draft the refund email').has('owner_question')).toBe(false);
  });
  it('owner tone, praise and self-doubt', () => {
    expect(ctxOf('The site is down again').has('owner_tone:negative')).toBe(true);
    expect(ctxOf('This is brilliant work, thank you!').has('owner_praise')).toBe(true);
    expect(ctxOf('We closed the deal!').has('owner_tone:positive')).toBe(true);
    expect(ctxOf('Is this dumb? Should we raise prices?').has('owner_self_doubt')).toBe(true);
  });
  it('the work week comes from the workspace, not from Monday to Friday (E14)', () => {
    const sun = (workDays?: number[]) => deriveContexts(makeState('cw_test', 'Tess', { now: { weekday: 0, ...(workDays ? { workDays } : {}) } }));
    expect(sun().has('weekend')).toBe(true);
    const sunToThu = sun([0, 1, 2, 3, 4]);
    expect(sunToThu.has('workweek:first_day')).toBe(true);
    expect(sunToThu.has('works_weekends')).toBe(true);
    expect(deriveContexts(makeState('cw_test', 'Tess', { now: { weekday: 5 } })).has('workweek:last_day')).toBe(true);
  });
  it('unblocked_by:owner, has_updates, step_ing and topic:*', () => {
    const s = makeState('cw_test', 'Tess', {
      history: { lastUnblockedAt: T0 - 60_000, lastUnblockedBy: 'owner', unseenUpdates: 3 },
      self: { presence: 'working' }, work: { stepLabel: 'Reading 14 supplier quotes' }, exchange: { topics: ['hospitality'] },
    });
    const c = deriveContexts(s);
    for (const k of ['unblocked_by:owner', 'after_blocker', 'has_updates', 'step_ing', 'topic:hospitality']) expect(c.has(k), k).toBe(true);
    expect(isGerundLabel('Competitor grid: step 3')).toBe(false);
    expect(isGerundLabel('morning briefing')).toBe(false);
    expect(topicsFor(tess, 'Can you look at the new menu?')).toEqual(['hospitality']);
    expect(topicsFor(tess, 'Our food cost jumped')).toEqual(['hospitality']);
    expect(topicsFor(tess, 'Menus are fine')).toEqual([]); // whole phrases only
  });
});

describe('the sniffer (E10, E11)', () => {
  it('"no kidding" is not a joke; outages are bad news', () => {
    expect(sniffOwnerText('no kidding, that took forever', lex).humor).toBe(0);
    expect(sniffOwnerText('the booking site crashed', lex).badNews).toBeGreaterThanOrEqual(0.3);
    expect(sniffOwnerText('the printer is broken again', lex).badNews).toBeGreaterThanOrEqual(0.3);
  });
  it('distress is personal, never a work topic', () => {
    expect(sniffOwnerText('sorry, my dad is in hospital', lex).distress).toBe(true);
    expect(sniffOwnerText('draft a crisis comms plan for the recall', lex).distress).toBe(false);
    expect(sniffOwnerText('can you help with planning layoffs for Q3', lex).distress).toBe(false);
    expect(sniffOwnerText('that typo was a happy accident', lex).distress).toBe(false);
  });
});

describe('selection (E5, E7, E12, E17, E19, E21)', () => {
  const idle = makeState('cw_test', 'Tess');
  it('evaluative acks stay off bad news (E4)', () => {
    const bad = makeState('cw_test', 'Tess', { exchange: { cues: sniffOwnerText('They pulled out of the contract, can you redo the forecast', lex) } });
    expect(picks('acknowledge', bad)).not.toContain('test-persona.acknowledge.01');
  });
  it('context-first: a steer gets the line written for it, every time (E5)', () => {
    const steer = makeState('cw_test', 'Tess', { exchange: { steerQueued: true } });
    const ids = picks('acknowledge', steer);
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) expect(lineOf(tess, id)?.require).toContain('steer_queued');
  });
  it('domain reactions need the topic (E19); owner-facing lines never say "crazy" (E12)', () => {
    expect(picks('delight', idle)).not.toContain('test-persona.delight.01');
    const topical = makeState('cw_test', 'Tess', { exchange: { topics: ['hospitality'] } });
    expect(picks('delight', topical, {}, 120)).toContain('test-persona.delight.01');
    expect(picks('delight', topical, {}, 120)).not.toContain('test-persona.delight.02');
  });
  it('non-English lines need a pronunciation channel, and a phrase family is capped per day (E17, E21)', () => {
    const voiceXai = picks('delight', idle, { channel: 'voice', provider: 'xai' }, 120);
    expect([...voiceXai].filter((id) => id.startsWith('test-persona.delight.0') && /0[34]$/.test(id))).toEqual([]);
    const withOpenai = picks('delight', idle, { channel: 'voice', provider: 'openai' }, 200);
    expect(withOpenai.has('test-persona.delight.03') || withOpenai.has('test-persona.delight.04')).toBe(true);
    // One "Ka pai" today: after either family line plays, neither is eligible.
    const mem = createRecencyMemory();
    const u = selectLine(tess, req('delight', 'x', idle), mem);
    const kaPai = lineOf(tess, 'test-persona.delight.03')!;
    recordUtterance(mem, tess, { ...(u.ok ? u.utterance : ({} as never)), lineId: kaPai.id, intent: 'delight' }, T0, ownerDayKey(idle));
    for (let i = 0; i < 80; i++) {
      const r = selectLine(tess, req('delight', `f${i}`, idle), mem);
      if (r.ok) expect(['test-persona.delight.03', 'test-persona.delight.04']).not.toContain(r.utterance.lineId);
    }
  });
  it('side-talk replies answer their opener, and never laugh after a changes verdict (E7)', () => {
    const afterChanges = makeState('cw_test', 'Tess', { replyTo: 'review_changes', review: { verdict: 'changes', findingCount: 2 } });
    const ids = picks('sidetalk_reply', afterChanges);
    expect(ids).toContain('test-persona.sidetalk_reply.02');
    expect(ids).not.toContain('test-persona.sidetalk_reply.01');
    expect(ids).not.toContain('test-persona.sidetalk_reply.03');
    for (const id of ids) expect(lineOf(tess, id)!.require.some((c) => c.startsWith('reply_to:'))).toBe(true);
  });
  it('an owner-thanking unblock needs unblocked_by:owner (E18)', () => {
    const byOther = makeState('cw_test', 'Tess', { history: { lastUnblockedAt: T0 - 1000, lastUnblockedBy: 'coworker' } });
    for (const id of picks('unblocked', byOther)) expect(lineOf(tess, id)!.require).not.toContain('unblocked_by:owner');
    const byOwner = makeState('cw_test', 'Tess', { history: { lastUnblockedAt: T0 - 1000, lastUnblockedBy: 'owner' } });
    const ids = picks('unblocked', byOwner);
    expect(ids).toContain('test-persona.unblocked.01');
    for (const id of ids) expect(lineOf(tess, id)!.require).toContain('unblocked_by:owner'); // context-first
  });
});

describe('wear-out over weeks (E1)', () => {
  it('per-intent rings survive other talk, and weekly uses persist in the snapshot', () => {
    const mem = createRecencyMemory();
    const day = ownerDayKey(makeState('cw_test', 'Tess'));
    const entry = (lineId: string, intent: IntentId, at: number) => ({ lineId, intent, textHash: lineId.length, opener: 'x', at });
    mem.record('cw_test', entry('a.quip.01', 'quip', T0), day);
    for (let i = 0; i < 60; i++) mem.record('cw_test', entry(`a.backchannel.${i}`, 'backchannel', T0 + i), day);
    expect(mem.recentFor('cw_test', 'quip').map((e) => e.lineId)).toEqual(['a.quip.01']);
    expect(mem.usesWeek('cw_test', 'a.quip.01', day)).toBe(1);
    const again = createRecencyMemory({ snapshot: mem.snapshot() });
    expect(again.snapshot().v).toBe(2);
    expect(again.usesWeek('cw_test', 'a.quip.01', day)).toBe(1);
    expect(again.recentFor('cw_test', 'quip').map((e) => e.lineId)).toEqual(['a.quip.01']);
  });
});

describe('the runner (E9, E11, E25)', () => {
  const { chief, camila, ruth } = AGENTS;
  it('the distress lock lasts 30 minutes, then jokes can land again (E11)', async () => {
    const h = await createRunnerHarness();
    h.turn(chief, 'turn_d', 'sorry, my dad is in hospital');
    await h.clock.advance(4000);
    h.turn(chief, 'turn_j0', 'haha the printer is haunted again');
    await h.clock.advance(500);
    h.runner.conversation({ kind: 'first_token', turnId: 'turn_j0', at: h.clock.now(), hint: 'laugh' });
    await h.clock.advance(5000);
    expect(h.played('laugh')).toEqual([]);
    await h.clock.advance(31 * 60_000);
    for (let i = 1; i <= 8; i++) {
      h.turn(chief, `turn_j${i}`, 'haha the printer is haunted again');
      await h.clock.advance(500);
      h.runner.conversation({ kind: 'first_token', turnId: `turn_j${i}`, at: h.clock.now(), hint: 'laugh' });
      await h.clock.advance(100_000);
    }
    expect(h.played('laugh').length).toBeGreaterThan(0);
  });

  it('Buzzing voices side-talk on the Floor only for an owner who touched it recently (E9)', async () => {
    const h = await createRunnerHarness({ ambience: 'buzzing' });
    h.surface.surface = 'floor';
    h.surface.floorVisible = true;
    const clips = h.clips.manifest(camila)!.clips;
    const k = Object.keys(clips).find((x) => x.startsWith('warm.handoff_give.01|'))!;
    const frame = (threadId: string): SideTalkLineFrame => ({
      type: 'sidetalk.line',
      data: {
        threadId, index: 0, projectId: 'prj_nw01', agentId: camila, toAgentId: ruth, intent: 'handoff_give',
        lineId: 'warm.handoff_give.01', text: "Ruth, it's all yours — competitor grid.", opener: "Ruth, it's all yours —",
        gist: 'competitor grid.', clip: { key: clips[k]!.clipKey, url: '', durationMs: 900 }, voice: 'floor_audio', atMs: 300,
        expiresAt: new Date(h.clock.now() + 20_000).toISOString(), replyable: true, cause: { streamId: 'p:prj_nw01', seq: Number(threadId.slice(3)) },
      },
    });
    h.runner.frame(frame('st_1'));
    await h.clock.advance(3000);
    expect(h.voiced().filter((v) => v.bus === 'ambient')).toEqual([]); // passive viewer: bubbles only
    h.runner.hover(ruth, 'enter', 'pointer');
    await h.clock.advance(700);
    h.runner.hover(ruth, 'dwell', 'pointer');
    await h.clock.advance(12_000);
    h.runner.hover(ruth, 'leave', 'pointer');
    h.runner.frame(frame('st_2'));
    await h.clock.advance(3000);
    expect(h.voiced().some((v) => v.bus === 'ambient' && v.agentId === camila)).toBe(true);
  });

  it('idle desks ask for work at most once per 10 minutes across the Floor (E25)', async () => {
    const h = await createRunnerHarness({ ambience: 'buzzing' });
    h.surface.surface = 'floor';
    h.surface.floorVisible = true;
    for (const [id, name] of [[chief, 'Samuel'], [camila, 'Camila'], [ruth, 'Ruth']] as const) h.states.set(id, makeState(id, name));
    for (let i = 0; i < 18; i++) {
      const id = [chief, camila, ruth][i % 3]!;
      h.runner.hover(id, 'enter', 'pointer');
      await h.clock.advance(700);
      h.runner.hover(id, 'dwell', 'pointer');
      await h.clock.advance(4000);
      h.runner.hover(id, 'leave', 'pointer');
      await h.clock.advance(25_000);
    }
    const soliciting = h.played('passing_by').filter((p) => {
      const index = h.indexes[p.agentId];
      return index && p.lineId ? lineOf(index, p.lineId)?.solicits : false;
    });
    expect(h.played('passing_by').length).toBeGreaterThan(2);
    expect(soliciting.length).toBeLessThanOrEqual(1); // 18 hovers over 9 minutes
  });
});
