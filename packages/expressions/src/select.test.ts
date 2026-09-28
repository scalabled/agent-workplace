import { describe, expect, it } from 'vitest';
import { fillKeyOf } from './delivery';
import { createRecencyMemory } from './recency';
import { fillLine, ownerDayKey, recordUtterance, renderUtterance, scoreLine, selectLine, validateFills } from './select';
import { deriveContexts } from './state';
import { fixtureCatalog, fixtureIndex, makeState, T0 } from './testing';
import type { AgentIndex, GroundingState, RecencyMemory, SelectRequest, SelectResult } from './types';
import type { IntentId } from './vocab';

const catalog = fixtureCatalog();
const chief = fixtureIndex('chief');
const ruth = fixtureIndex('ruth');
const camila = fixtureIndex('camila');

function req(index: AgentIndex, intent: IntentId, seed: string, over: Partial<SelectRequest> = {}, state?: GroundingState): SelectRequest {
  return {
    intent, state: state ?? makeState(index.agentId, 'X'), mood: { valence: 0.2, energy: 0 }, ambience: 'lively', provider: 'xai',
    seed, now: T0, channel: 'voice', ...over,
  };
}
const ok = (r: SelectResult) => {
  if (!r.ok) throw new Error(`skipped: ${r.reason}`);
  return r.utterance;
};

describe('determinism (L7)', () => {
  it('the same catalog, seed, state, mood and recency give the same line', () => {
    const a = selectLine(chief, req(chief, 'acknowledge', 'cw_chief|acknowledge|turn_1'), createRecencyMemory());
    const b = selectLine(chief, req(chief, 'acknowledge', 'cw_chief|acknowledge|turn_1'), createRecencyMemory());
    expect(a).toEqual(b);
    const ids = new Set<string>();
    for (let i = 0; i < 80; i++) ids.add(ok(selectLine(chief, req(chief, 'acknowledge', `turn_${i}`), createRecencyMemory())).lineId);
    expect(ids.size).toBeGreaterThanOrEqual(6); // seeds spread the picks
  });
  it('golden selections are stable', () => {
    const golden = ['turn_a', 'turn_b', 'turn_c', 'turn_d'].map((s) => ok(selectLine(chief, req(chief, 'thinking_filler', s), createRecencyMemory())).lineId);
    expect(golden).toMatchInlineSnapshot(`
      [
        "warm.thinking_filler.03",
        "lead-warm-mentor.catch.01",
        "lead-warm-mentor.catch.01",
        "warm.thinking_filler.05",
      ]
    `);
  });
});

describe('grounding filter (L2, H1)', () => {
  it('never picks a progress line whose numbers are not in state', () => {
    const noTotal = makeState('cw_chief', 'Samuel', { self: { presence: 'working' }, work: { done: 3, total: null, stepLabel: 'Reading supplier quotes' } });
    for (let i = 0; i < 100; i++) {
      const u = ok(selectLine(chief, req(chief, 'micro_status', `s${i}`, {}, noTotal), createRecencyMemory()));
      expect(u.lineId).toBe('warm.micro_status.02');
      expect(u.caption).toBe('Still on reading supplier quotes.');
    }
    const full = makeState('cw_chief', 'Samuel', { self: { presence: 'working' }, work: { done: 3, total: 5 } });
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(ok(selectLine(chief, req(chief, 'micro_status', `s${i}`, {}, full), createRecencyMemory())).caption);
    expect(seen).toContain('Three of five down.');
  });
  it('reports why nothing was picked', () => {
    expect(selectLine(chief, req(chief, 'blocked', 's'), createRecencyMemory())).toEqual({ ok: false, reason: 'ungrounded', considered: 2 });
    const r = selectLine(chief, req(chief, 'micro_status', 's'), createRecencyMemory());
    expect(r.ok ? null : r.reason).toBe('context'); // only "Folded your note in." is grounded, and it needs steer_queued
    expect(selectLine(camila, req(camila, 'holding_filler', 's'), createRecencyMemory())).toEqual({ ok: false, reason: 'disabled', considered: 0 });
  });
  it('fills slots from state, sanitised: markup can never be injected', () => {
    const s = makeState('cw_chief', 'Samuel', { self: { presence: 'working' }, owner: { firstName: 'Dana' }, work: { stepLabel: 'Checking [laugh] <loud>{owner_name}</loud> totals' } });
    for (let i = 0; i < 30; i++) {
      const u = ok(selectLine(chief, req(chief, 'passing_by', `p${i}`, {}, s), createRecencyMemory()));
      expect(u.caption).not.toMatch(/[[\]<>{}]/);
      expect(u.speak.xai).not.toMatch(/\[laugh\]|<loud>/);
    }
  });
});

describe('context and ambience filters', () => {
  it('respects required and negated contexts, and prefers specific lines', () => {
    const idle = makeState('cw_chief', 'Samuel');
    const idleIds = new Set<string>();
    for (let i = 0; i < 40; i++) idleIds.add(ok(selectLine(chief, req(chief, 'passing_by', `i${i}`, {}, idle), createRecencyMemory())).lineId);
    expect([...idleIds].sort()).toEqual(['warm.passing_by.04', 'warm.passing_by.07']);
    // E25: after a soliciting line somewhere on the Floor, idle desks say they are available without asking.
    for (let i = 0; i < 20; i++) expect(ok(selectLine(chief, req(chief, 'passing_by', `i${i}`, { excludeSoliciting: true }, idle), createRecencyMemory())).lineId).toBe('warm.passing_by.07');
    const unstaffed = makeState('cw_chief', 'Samuel', { self: { staffed: false } });
    expect(ok(selectLine(chief, req(chief, 'passing_by', 'u', {}, unstaffed), createRecencyMemory())).caption).toBe('Hi — Samuel. Nothing on my desk yet.');
    const s = makeState('cw_chief', 'Samuel', { history: { firstMeeting: true } });
    const wl = chief.candidates('greeting').find((c) => c.line.id === 'warm.greeting.04')!;
    const plain = chief.candidates('greeting').find((c) => c.line.id === 'warm.greeting.06')!;
    const r = req(chief, 'greeting', 'g', {}, s);
    const ctx = deriveContexts(s);
    const mem = createRecencyMemory();
    expect(scoreLine(wl, r, mem, ctx) / wl.prior).toBeCloseTo((scoreLine(plain, r, mem, ctx) / plain.prior) * 1.3, 6);
  });
  it('caps laugh intensity by Ambience and drops loud lines in Quiet', () => {
    const quiet = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const r = selectLine(chief, req(chief, 'laugh', `l${i}`, { laughIntensityCap: 0.4 }), createRecencyMemory());
      quiet.add(ok(r).lineId);
    }
    expect([...quiet].sort()).toEqual(['lead-warm-mentor.laugh.00', 'warm.laugh.02']);
    const lively = new Set<string>();
    for (let i = 0; i < 120; i++) lively.add(ok(selectLine(chief, req(chief, 'laugh', `l${i}`), createRecencyMemory())).lineId);
    expect(lively.size).toBeGreaterThan(2);
  });
  it('filters never_says for every candidate, archetype lines included', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 300; i++) ids.add(ok(selectLine(ruth, req(ruth, 'acknowledge', `a${i}`), createRecencyMemory())).lineId);
    expect(ids.has('warm.acknowledge.06')).toBe(false); // "Absolutely — on it."
    const chiefIds = new Set<string>();
    for (let i = 0; i < 300; i++) chiefIds.add(ok(selectLine(chief, req(chief, 'acknowledge', `a${i}`), createRecencyMemory())).lineId);
    expect(chiefIds.has('warm.acknowledge.06')).toBe(true);
    const onlyBanned = selectLine(ruth, req(ruth, 'acknowledge', 'x', {}, makeState('r', 'Ruth', { owner: { firstName: null } })), createRecencyMemory());
    expect(onlyBanned.ok).toBe(true);
  });
  it('drops lines that are too long for the window and lines without a decoded clip when instant is required', () => {
    expect(selectLine(chief, req(chief, 'thinking_filler', 's', { maxDurationMs: 200 }), createRecencyMemory())).toMatchObject({ ok: false, reason: 'too_long' });
    const none = selectLine(chief, req(chief, 'thinking_filler', 's', { instantOnly: true, clips: { has: () => false, durationMs: () => null }, clipKeyOf: () => 'k' }), createRecencyMemory());
    expect(none).toMatchObject({ ok: false, reason: 'not_instant' });
    const only = selectLine(chief, req(chief, 'thinking_filler', 's', {
      instantOnly: true,
      clips: { has: (k) => k === 'clip-mm', durationMs: () => 700 },
      clipKeyOf: (id) => (id === 'warm.thinking_filler.03' ? 'clip-mm' : undefined),
    }), createRecencyMemory());
    expect(ok(only).lineId).toBe('warm.thinking_filler.03');
    // Browser and mock voices are always instant; nonverbal lines cannot be voiced by the browser.
    for (let i = 0; i < 40; i++) expect(ok(selectLine(chief, req(chief, 'laugh', `b${i}`, { provider: 'browser', instantOnly: true }), createRecencyMemory())).nonverbal).toBe(false);
  });
  it('enforces per-day caps on catchphrases', () => {
    const mem = createRecencyMemory();
    const day = ownerDayKey(makeState('cw_chief', 'Samuel'));
    mem.record('cw_chief', { lineId: 'lead-warm-mentor.catch.01', intent: 'acknowledge', textHash: 1, opener: "let's", at: T0 - 5000 }, day);
    mem.record('cw_chief', { lineId: 'lead-warm-mentor.catch.01', intent: 'thinking_filler', textHash: 1, opener: "let's", at: T0 - 4000 }, day);
    for (let i = 0; i < 100; i++) {
      expect(ok(selectLine(chief, req(chief, 'thinking_filler', `c${i}`), mem)).lineId).not.toBe('lead-warm-mentor.catch.01');
    }
  });
});

describe('anti-repetition (§5.3)', () => {
  function run(index: AgentIndex, intent: IntentId, n: number, mem: RecencyMemory, state?: GroundingState) {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const at = T0 + i * 30_000;
      const s = state ?? makeState(index.agentId, 'X', { now: { epochMs: at } });
      const u = ok(selectLine(index, req(index, intent, `${index.agentId}|${intent}|${i}`, { now: at }, s), mem));
      recordUtterance(mem, index, u, at, ownerDayKey(s));
      out.push(u.lineId);
    }
    return out;
  }
  it('never repeats one of the last three lines of an intent when alternatives exist', () => {
    const picks = run(chief, 'acknowledge', 60, createRecencyMemory());
    for (let i = 3; i < picks.length; i++) expect(picks.slice(i - 3, i)).not.toContain(picks[i]);
  });
  it('spreads picks across the pool, and recency pushes repeats further apart', () => {
    const picks = run(chief, 'backchannel', 120, createRecencyMemory());
    const within = (w: number, xs: string[]) => xs.filter((p, i) => xs.slice(Math.max(0, i - w), i).includes(p)).length;
    expect(within(3, picks)).toBe(0);
    expect(new Set(picks).size).toBeGreaterThanOrEqual(7);
    // Without memory the same seeds repeat far more often at short distance.
    const blind = picks.map((_, i) => ok(selectLine(chief, req(chief, 'backchannel', `cw_chief|backchannel|${i}`, { now: T0 + i * 30_000 }), createRecencyMemory())).lineId);
    expect(within(5, picks)).toBeLessThan(within(5, blind));
  });
  it('penalises a repeated opener and text another agent said in the last minute', () => {
    const mem = createRecencyMemory();
    const s = makeState('cw_chief', 'Samuel');
    const ctx = deriveContexts(s);
    const wl = chief.candidates('acknowledge').find((c) => c.line.id === 'warm.acknowledge.01')!; // "On it."
    const r = req(chief, 'acknowledge', 's', {}, s);
    const base = scoreLine(wl, r, mem, ctx);
    mem.record('cw_chief', { lineId: 'x', intent: 'backchannel', textHash: 42, opener: 'on', at: T0 - 1000 }, '2026-10-05');
    expect(scoreLine(wl, r, mem, ctx)).toBeCloseTo(base * 0.5, 9);
    const mem2 = createRecencyMemory();
    mem2.record('cw_data-analyst', { lineId: 'dry-wit.acknowledge.02', intent: 'acknowledge', textHash: wl.line.textHash, opener: 'x', at: T0 - 30_000 }, '2026-10-05');
    expect(scoreLine(wl, r, mem2, ctx)).toBeCloseTo(base * 0.2, 9);
    mem2.record('cw_data-analyst', { lineId: 'y', intent: 'acknowledge', textHash: 7, opener: 'x', at: T0 - 20_000 }, '2026-10-05');
    expect(scoreLine(wl, { ...r, now: T0 + 60_000 }, mem2, ctx)).toBeCloseTo(base, 9); // the window has passed
  });
  it('keeps owner-facing lines composed: valence below −0.3 scores like −0.3', () => {
    const s = makeState('cw_chief', 'Samuel');
    const ctx = deriveContexts(s);
    const wl = chief.candidates('acknowledge').find((c) => c.line.mood)!;
    const a = scoreLine(wl, req(chief, 'acknowledge', 's', { mood: { valence: -0.9, energy: 0 } }, s), createRecencyMemory(), ctx);
    const b = scoreLine(wl, req(chief, 'acknowledge', 's', { mood: { valence: -0.3, energy: 0 } }, s), createRecencyMemory(), ctx);
    expect(a).toBeCloseTo(b, 12);
  });
  it('recency memory snapshots, merges and rolls the day', () => {
    const m = createRecencyMemory({ capacity: 3 });
    for (let i = 0; i < 5; i++) m.record('a', { lineId: `l${i}`, intent: 'quip', textHash: i, opener: 'o', at: T0 + i }, '2026-10-05');
    expect(m.recent('a').map((e) => e.lineId)).toEqual(['l4', 'l3', 'l2']);
    expect(m.usesToday('a', 'l0', '2026-10-05')).toBe(1);
    expect(m.usesToday('a', 'l0', '2026-10-06')).toBe(0);
    const other = createRecencyMemory({ snapshot: m.snapshot() });
    other.record('a', { lineId: 'l9', intent: 'quip', textHash: 9, opener: 'o', at: T0 + 9 }, '2026-10-06');
    expect(other.usesToday('a', 'l0', '2026-10-06')).toBe(0);
    m.merge(other.snapshot());
    expect(m.recent('a')[0]!.lineId).toBe('l9');
    expect(m.snapshot().day).toBe('2026-10-06');
    expect(m.recentText(9, T0 + 100, 60_000)).toBe(true);
    expect(m.recentText(9, T0 + 120_000, 60_000)).toBe(false);
  });
});

describe('utterances, splits and renders (§5.5, §7.5)', () => {
  const working = makeState('cw_chief', 'Samuel', { self: { presence: 'working' }, work: { stepLabel: 'Reading 14 outdoor-retail reports' } });

  it('builds per-provider speech, a face cue and a fill key', () => {
    const u = ok(selectLine(chief, req(chief, 'gratitude_reply', 'g1', {}, working), createRecencyMemory()));
    expect(u.face).toEqual({ gesture: 'smile', expression: 'delighted', holdMs: 1500 });
    expect(u.fillKey).toBe(fillKeyOf(u.fills));
    expect(u.speak.browser).toBe(u.caption);
    expect(u.speak.openai?.instructions).toContain('Warm, friendly and unhurried');
  });

  it('splits a line with a runtime slot at a boundary before it: pre-voiced prefix + runtime tail', () => {
    const r = renderUtterance(chief, 'warm.passing_by.01', { step_label: 'reading 14 outdoor-retail reports' });
    expect(r.ok).toBe(true);
    let u = (r as { ok: true; utterance: import('./types').Utterance }).utterance;
    expect(u.caption).toBe('Hi — just reading 14 outdoor-retail reports.');
    u = ok(selectLine(chief, req(chief, 'passing_by', 'x', {}, working), createRecencyMemory()));
    const all = new Map<string, import('./types').Utterance>();
    for (let i = 0; i < 60; i++) {
      const v = ok(selectLine(chief, req(chief, 'passing_by', `x${i}`, {}, working), createRecencyMemory()));
      all.set(v.lineId, v);
    }
    const hi = all.get('warm.passing_by.01')!;
    expect(hi.split?.prefix.lineId).toBe('warm.passing_by.01~prefix');
    expect(hi.split?.prefix.caption).toBe('Hi —');
    expect(hi.split?.prefix.fillKey).toBe('');
    expect(hi.split?.tailText).toBe('just reading 14 outdoor-retail reports.');
    expect(all.has('warm.passing_by.02')).toBe(false); // too long with this label for passing_by's 3 s cap
    const short = makeState('cw_chief', 'Samuel', { self: { presence: 'working' }, work: { stepLabel: 'Reading reports' } });
    let oh: import('./types').Utterance | undefined;
    for (let i = 0; i < 60 && !oh; i++) {
      const v = ok(selectLine(chief, req(chief, 'passing_by', `y${i}`, {}, short), createRecencyMemory()));
      if (v.lineId === 'warm.passing_by.02') oh = v;
    }
    expect(oh!.caption).toBe('Oh, hey. Reading reports, going nicely.');
    expect(oh!.split?.prefix.caption).toBe('Oh, hey.');
    expect(oh!.split?.tailText).toBe('Reading reports, going nicely.');
    const tail = renderUtterance(chief, 'warm.passing_by.01~tail', { step_label: 'reading 14 outdoor-retail reports' });
    expect(tail.ok && tail.utterance.speak.xai).toBe('just reading 14 outdoor-retail reports.');
    const prefix = renderUtterance(chief, 'warm.passing_by.01~prefix', {});
    expect(prefix.ok && prefix.utterance.caption).toBe('Hi —');
    void u;
  });

  it('keeps wrappers balanced across a split', () => {
    const r = renderUtterance(ruth, 'calm-steady.passing_by.01~tail', { step_label: 'checking the numbers' });
    expect(r.ok && r.utterance.speak.xai).toBe('checking the numbers.');
    const gist = renderUtterance(chief, 'warm.handoff_give.01~gist', { gist: 'Competitor grid, 14 sources in the folder.' });
    expect(gist.ok && gist.utterance.caption).toBe('Competitor grid, 14 sources in the folder.');
  });

  it('validates render requests: unknown lines, wrong or unsafe fills are refused', () => {
    expect(renderUtterance(chief, 'warm.nope.01', {}).ok).toBe(false);
    expect(renderUtterance(chief, 'red-team-sceptic.quip.01', {}).ok).toBe(false); // not this agent's line
    expect(renderUtterance(chief, 'warm.passing_by.01', {}).ok).toBe(false); // missing slot
    expect(renderUtterance(chief, 'warm.passing_by.01', { step_label: 'x <loud>y</loud>' }).ok).toBe(false);
    expect(validateFills(catalog, ['done', 'total'], { done: 'three', total: '14' })).toEqual([]);
    expect(validateFills(catalog, ['eta'], { eta: 'forever' })).toEqual(['slot eta must be one of its domain values']);
    expect(validateFills(catalog, ['owner_name'], { owner_name: 'Dana', client: 'X' })).toEqual(['slot client is not used by this line']);
  });

  it('fillLine substitutes into caption, xAI and OpenAI renderings', () => {
    const line = catalog.linesFor('warm', 'sympathy').find((l) => l.id === 'warm.sympathy.03')!;
    expect(fillLine(line, { owner_name: 'Dana' })).toEqual({ caption: "I'm sorry, Dana.", xai: "<soft>I'm sorry, Dana.</soft>", openaiSay: "I'm sorry, Dana." });
  });
});
