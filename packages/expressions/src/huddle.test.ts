// Huddle small talk: compile rules and honesty lints, casting, grounding,
// recency across days, mood and context gates, timing, delivery, and parity with the validator's port. Fixtures are
// the 12 seed exchanges in catalog/expressions/huddles (hd-*.001), pinned by id so new content never changes them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../scripts/load-expressions.mjs';
import { ExpressionCatalogError } from './catalog';
import { clipKey, toDelivery } from './delivery';
import {
  HUDDLE_CAPTION_MAX_CHARS, castRoles, compileHuddles, compileHuddlesLenient, createHuddleRecency, huddleReadingMs, huddleScriptOf,
  huddleUtterance, huddlesVersion, lintHuddleText, pickExchange, renderHuddleUtterance,
} from './huddle';
import type {
  HuddleEvent, HuddleExchangeDef, HuddleLintContext, HuddlePackInput, HuddleParticipant, HuddlePick, HuddleRequest, HuddleSpot,
} from './huddle';
import { fixtureCatalog, T0 } from './testing';
import type { AgentIndex, ArchetypeBlend, LaughStyle } from './types';
import type { Mood, TeamRole } from './vocab';

const HUDDLE_DIR = join(REPO_ROOT, 'catalog/expressions/huddles');
const SEED_IDS = [
  'hd-self-aware.001', 'hd-self-aware.002', 'hd-self-aware.003', 'hd-craft.001', 'hd-debate.001', 'hd-tools.001',
  'hd-ideas.001', 'hd-office.001', 'hd-hallway.001', 'hd-wins.001', 'hd-projects.001', 'hd-welcome.001',
];
const SEED_PACK_IDS = [...new Set(SEED_IDS.map((id) => id.slice(0, id.lastIndexOf('.'))))];
const SEED_PACKS: HuddlePackInput[] = SEED_PACK_IDS.map((packId) => {
  const pack = JSON.parse(readFileSync(join(HUDDLE_DIR, `${packId}.json`), 'utf8')) as HuddlePackInput;
  return { ...pack, exchanges: pack.exchanges.filter((e) => SEED_IDS.includes(e.id)) };
});
const catalog = fixtureCatalog();
const huddles = compileHuddles(SEED_PACKS, catalog);
const HOUR = 3_600_000;
const DAY = 86_400_000;

const validator = (await import(pathToFileURL(join(REPO_ROOT, 'catalog/scripts/validate-expressions.mjs')).href)) as {
  lintHuddleText(text: string, ctx: HuddleLintContext): { rule: string; message: string }[];
  checkHuddleExchange(ex: unknown, packId: string, contextOk: (tag: string) => boolean): string[];
};

// ── people ──────────────────────────────────────────────────────────────────────
const CHUCKLE: LaughStyle = { kind: 'chuckle', intensity: 0.4, readiness: 0.7, caption: '(chuckles)', xai: '<soft>[laugh]</soft>', openai: { say: 'Heh heh.', instructions: 'A soft chuckle.' } };
const HUFF: LaughStyle = { kind: 'dry_huff', intensity: 0.3, readiness: 0.6, caption: '(huffs a laugh)', xai: '[breath] <soft>[laugh]</soft>', openai: { say: 'Hah.', instructions: 'A dry, breathy huff.' } };
interface Extra {
  department?: string; teamRoles?: TeamRole[]; isChief?: boolean; pairsWellWith?: string[]; tensionWith?: string[];
  neverSays?: string[]; laugh?: LaughStyle; mood?: Mood;
}
function person(agentId: string, firstName: string, blend: ArchetypeBlend, x: Extra = {}): HuddleParticipant {
  const index = {
    agentId, personaId: agentId.replace(/^cw_/, ''), catalogVersion: catalog.version, blend, laugh: x.laugh ?? CHUCKLE,
    baseline: { valence: 0.1, energy: 0 }, reactivity: 0.6, neverSays: x.neverSays ?? [], voice: { xai: 'eve', openai: 'alloy', speed: 1 },
    candidates: () => [], intentWeight: () => 1,
  } as unknown as AgentIndex;
  return {
    agentId, firstName, index, mood: x.mood ?? { valence: 0.2, energy: 0.1 },
    ...(x.department ? { department: x.department } : {}), ...(x.teamRoles ? { teamRoles: x.teamRoles } : {}), ...(x.isChief ? { isChief: true } : {}),
    ...(x.pairsWellWith ? { pairsWellWith: x.pairsWellWith } : {}), ...(x.tensionWith ? { tensionWith: x.tensionWith } : {}),
  };
}
const kate = person('cw_kate', 'Kate', { 'dry-wit': 0.6, playful: 0.4 }, { department: 'marketing-growth', laugh: HUFF });
const pax = person('cw_pax', 'Pax', { 'calm-steady': 0.7, veteran: 0.3 }, { department: 'product' });
const juno = person('cw_juno', 'Juno', { meticulous: 0.6, analytical: 0.4 }, { department: 'design-creative', tensionWith: ['cw_rio'] });
const rio = person('cw_rio', 'Rio', { visionary: 0.6, hustler: 0.4 }, { department: 'design-creative' });
const mae = person('cw_mae', 'Mae', { playful: 0.5, warm: 0.5 }, { department: 'design-creative' });
const eddie = person('cw_eddie', 'Eddie', { warm: 0.5, veteran: 0.5 }, { isChief: true });

function req(spot: HuddleSpot, participants: HuddleParticipant[], over: Partial<HuddleRequest> = {}): HuddleRequest {
  return {
    huddleId: `hd:2026-10-05:${spot}:600`, spot, participants,
    now: { epochMs: T0 + HOUR * 1.5, localHour: 10, weekday: 1 },
    ambience: 'lively', provider: 'xai', maxLines: 4, seed: `hd:2026-10-05:${spot}:600|0`, ...over,
  };
}
const at = (localHour: number, dayOffset = 0) => ({ epochMs: T0 + (localHour - 9) * HOUR + dayOffset * DAY, localHour, weekday: (1 + dayOffset) % 7 });
const win = (over: Partial<HuddleEvent> = {}): HuddleEvent => ({
  kind: 'job.done', agentIds: ['cw_pax'], at: T0, visibility: 'team', cause: { streamId: 'p:prj_nw01', seq: 1839 }, artifact: 'Supplier price grid', ...over,
});
/** Every exchange this request can ever pick (over many seeds). */
function reachable(r: HuddleRequest, n = 60): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < n; i++) {
    const p = pickExchange(huddles, { ...r, seed: `${r.seed}#${i}` }, createHuddleRecency());
    if (p) out.add(p.exchangeId);
  }
  return out;
}
const ex = (over: Partial<HuddleExchangeDef> & { id?: string } = {}): HuddleExchangeDef => ({
  id: 'hd-test.001', spots: ['water_cooler'], topics: ['self_aware'],
  lines: [{ role: 'A', text: 'The plants are thriving on pure ambience.' }, { role: 'B', text: 'Same, honestly.' }],
  ...over,
});
const pack = (...exchanges: HuddleExchangeDef[]): HuddlePackInput => ({ kind: 'huddle_pack', id: 'hd-test', version: 1, exchanges });
const problemsOf = (e: HuddleExchangeDef): string[] => {
  const r = compileHuddlesLenient([pack(e)], catalog);
  return r.problems;
};
const CONTEXT_KEYS = new Set(Object.keys((JSON.parse(readFileSync(join(REPO_ROOT, 'catalog/expressions/intents.json'), 'utf8')) as { contexts: Record<string, string> }).contexts));
/** The validator's context check (the expressions vocabulary; huddle contexts are handled inside checkHuddleExchange). */
const contextOk = (tag: string): boolean => {
  const keys = CONTEXT_KEYS;
  const t = tag.replace(/^!/, '');
  if (keys.has(t)) return true;
  return t.includes(':') && keys.has(`${t.split(':')[0]}:*`);
};

// ── compile ─────────────────────────────────────────────────────────────────────
describe('compileHuddles (§5.2-§5.4)', () => {
  it('compiles the 12 seed exchanges with defaults, spot indexes and an order-independent version', () => {
    expect(huddles.exchanges.map((e) => e.id).sort()).toEqual([...SEED_IDS].sort());
    expect(huddles.version).toMatch(/^h1_[a-z2-7]+$/);
    expect(compileHuddles([...SEED_PACKS].reverse(), catalog).version).toBe(huddles.version);
    expect(huddlesVersion(SEED_PACKS)).toBe(huddles.version);
    const espresso = huddles.byId('hd-self-aware.001')!;
    expect(espresso).toMatchObject({ topic: 'self_aware', rolesUsed: ['A', 'B'], size: [2, 4], maxPerDay: 1, maxPerWeek: 4, pair: 'any', hasLaugh: true, sad: false });
    expect(huddles.byId('hd-wins.001')!.maxPerWeek).toBe(2); // grounded: its events refresh it
    expect(espresso.lines[2]).toMatchObject({ kind: 'laugh', face: 'smile', text: '' });
    expect(huddles.byId('hd-ideas.001')!.rolesUsed).toEqual(['A', 'B', 'C']);
    expect(huddles.byId('hd-wins.001')!.requires).toEqual({ events: ['job.done', 'deliverable.accepted', 'verdict.approve'], who: 'B', maxAgeMs: 8 * HOUR });
    expect(huddles.bySpot('library').map((e) => e.id)).toEqual(['hd-office.001']);
    expect(huddles.bySpot('phone_booth')).toEqual([]);
  });

  it('rejects every §5.3 field-rule violation with a reason, strictly and leniently', () => {
    const bad: [string, HuddleExchangeDef, RegExp][] = [
      ['prefix', ex({ id: 'hd-other.001' }), /must start with "hd-test\."/],
      ['one turn', ex({ lines: [{ role: 'A', text: 'Hello there.' }] }), /2–4 turns/],
      ['opening laugh', ex({ lines: [{ role: 'A', laugh: true }, { role: 'B', text: 'Same, honestly.' }, { role: 'A', text: 'Fair.' }] }), /laugh never opens/],
      ['two kinds', ex({ lines: [{ role: 'A', text: 'Hi.', face: 'nod' }, { role: 'B', text: 'Same, honestly.' }] }), /exactly one of text, laugh or face/],
      ['B silent', ex({ lines: [{ role: 'A', text: 'Hi.' }, { role: 'A', text: 'Still me.' }] }), /roles A and B both take a turn/],
      ['own name', ex({ lines: [{ role: 'A', text: 'Hi, {name_a}.', slots: ['name_a'] }, { role: 'B', text: 'Same, honestly.' }] }), /\{name_a\} in role A's own line/],
      ['slots mismatch', ex({ lines: [{ role: 'A', text: 'Hi, {name_b}.' }, { role: 'B', text: 'Same, honestly.' }] }), /must equal placeholders/],
      ['grounded slot', ex({ lines: [{ role: 'A', text: 'How is {project}?', slots: ['project'] }, { role: 'B', text: 'Same, honestly.' }] }), /\{project\} only in grounded/],
      ['wins ungrounded', ex({ topics: ['wins'] }), /topic wins requires grounded/],
      ['welcome without hired', ex({ topics: ['welcome'], grounded: true, requires: { events: ['job.done'] } }), /welcome requires requires.events with hired/],
      ['library loud', ex({ spots: ['library'] }), /library lines are soft/],
      ['hallway long', ex({ spots: ['hallway'], lines: [{ role: 'A', text: 'Scenic.' }, { role: 'B', text: 'Very.' }, { role: 'A', text: 'Indeed.' }, { role: 'B', face: 'nod' }] }), /hallway exchanges have at most 3 turns/],
      ['booth', ex({ spots: ['phone_booth'] }), /no huddle exchange plays in a phone_booth/],
      ['booth grounded', ex({ spots: ['phone_booth'], topics: ['wins'], grounded: true, requires: { events: ['job.done'] } }), /no huddle exchange plays in a phone_booth/],
      ['own joke', ex({ lines: [{ role: 'A', text: 'Hi there.' }, { role: 'B', text: 'The cooler says hello.' }, { role: 'B', laugh: true }] }), /the listener laughs/],
      ['number word', ex({ lines: [{ role: 'A', text: 'On break for four seconds now.' }, { role: 'B', text: 'Same, honestly.' }] }), /no number words/],
      ['debate unopposed', ex({ topics: ['debate'], roles: { A: { archetypes: ['warm'] }, B: { archetypes: ['warm', 'gentle'] } } }), /debates need pair/],
      ['craft without departments', ex({ topics: ['craft'] }), /craft exchanges set roles/],
      ['unknown context', ex({ context: ['full_moon'] }), /unknown context/],
      ['C too small', ex({ size: [2, 4], lines: [{ role: 'A', text: 'Hi.' }, { role: 'B', text: 'Hey.' }, { role: 'C', text: 'Hello.' }] }), /size min 2 is below the 3 roles/],
      ['three beats', ex({ lines: [{ role: 'A', text: 'Hi.' }, { role: 'B', face: 'nod' }, { role: 'A', face: 'smile' }, { role: 'B', laugh: true }] }), /at most 2 beats/],
      ['laugh at a person', ex({ lines: [{ role: 'A', text: "{name_b}'s slides have more colours than a sunset.", slots: ['name_b'] }, { role: 'B', text: 'Bold but fair.' }, { role: 'A', laugh: true }] }), /laughing at a person/],
      ['markup', ex({ lines: [{ role: 'A', text: 'Hi [laugh] there.' }, { role: 'B', text: 'Same, honestly.' }] }), /markup/],
      ['xai drift', ex({ lines: [{ role: 'A', text: 'Hi there.', tags: { xai: 'Hello there.' } }, { role: 'B', text: 'Same, honestly.' }] }), /readable\(tags.xai\)/],
      ['declared silent role', ex({ roles: { C: { archetypes: ['warm'] } } }), /role C is declared but takes no turn/],
    ];
    for (const [name, e, re] of bad) {
      const problems = problemsOf(e);
      expect(problems.length, name).toBeGreaterThan(0);
      expect(problems.join('\n'), name).toMatch(re);
      expect(() => compileHuddles([pack(e)], catalog), name).toThrow(ExpressionCatalogError);
    }
    // A laugh right after naming someone is laughing at a person (rule 5)…
    const ribbing = ex({ lines: [{ role: 'A', text: 'Nice slides, {name_b}.', slots: ['name_b'] }, { role: 'B', laugh: true }] });
    expect(problemsOf(ribbing).join('\n')).toMatch(/laughing at a person/);
    // …but laughing with a named colleague at their own joke is warm, not mockery.
    const withThem = ex({ lines: [{ role: 'A', text: 'Welcome in, {name_b}.', slots: ['name_b'] }, { role: 'B', text: 'Thanks. Still learning the map.' }, { role: 'A', laugh: true }] });
    expect(problemsOf(withThem)).toEqual([]);
  });

  it('drops bad exchanges leniently and keeps the rest, with a version the cleaned packs reproduce', () => {
    const good = ex({ id: 'hd-test.002' });
    const r = compileHuddlesLenient([pack(ex({ id: 'hd-test.001', topics: ['wins'] }), good), { kind: 'nope' } as unknown as HuddlePackInput], catalog);
    expect(r.huddles.exchanges.map((e) => e.id)).toEqual(['hd-test.002']);
    expect(r.dropped.map((d) => d.id).sort()).toEqual(['?', 'hd-test.001']);
    expect(compileHuddles(r.packs, catalog).version).toBe(r.huddles.version);
    const dup = compileHuddlesLenient([pack(ex(), ex())], catalog);
    expect(dup.huddles.exchanges).toHaveLength(1);
    expect(dup.problems.join('\n')).toMatch(/duplicate exchange id/);
  });
});

// ── honesty lints ───────────────────────────────────────────────────────────────
describe('lintHuddleText (§5.4 honesty rules)', () => {
  const small: HuddleLintContext = { topics: ['office'], grounded: false, completionEvent: false, night: false };
  const selfAware: HuddleLintContext = { ...small, topics: ['self_aware'] };
  const rules = (text: string, ctx = small) => lintHuddleText(text, ctx).map((l) => l.rule).sort();

  it('rejects the §5.4 "rejected on sight" lines', () => {
    expect(rules('Just grabbed my third coffee.')).toContain('embodiment');
    expect(rules('Finished the Q3 deck before lunch.')).toEqual(expect.arrayContaining(['completion', 'embodiment', 'number']));
    expect(rules('Brutal weather out there.')).toContain('weather');
    expect(rules('The boss changed the brief again.')).toContain('owner');
    expect(rules('Busy day on calls.')).toContain('progress');
  });

  it('allows embodiment only as a self-aware counterfactual (A2)', () => {
    expect(rules("I'd grab an espresso if I had hands.", selfAware)).toEqual([]);
    expect(rules('No taste buds, but I respect the espresso.', selfAware)).toEqual([]);
    expect(rules("I'd grab an espresso if I had hands.")).toEqual(['embodiment']); // not a self_aware exchange
    expect(rules('I drank my coffee.', selfAware)).toEqual(['embodiment']); // a claim, not a counterfactual
    expect(rules('My commute was brutal.', selfAware)).toEqual(['embodiment']);
    expect(rules('Big weekend plans?', selfAware)).toEqual(['embodiment']);
    expect(rules('Meet you at the coffee bar.')).toEqual([]); // the place, not a drink
  });

  it('grounds work claims: completion words need a completion event, progress needs grounding', () => {
    expect(rules('Glad it is out of my queue.')).toEqual(['completion', 'progress']);
    expect(rules('Glad it is out of my queue.', { ...small, grounded: true, completionEvent: true })).toEqual([]);
    expect(rules("I've been working on the grid.")).toEqual(['progress']);
    expect(rules("I've been working on the grid.", { ...small, grounded: true })).toEqual([]);
    expect(rules("It's never done, it's abandoned.")).toEqual([]); // not a status claim
    expect(rules('Is it done?')).toEqual([]); // a question
    expect(rules('I sent it over.', { ...small, grounded: true, completionEvent: true })).toContain('external'); // H2 always
  });

  it('catches facts, owner talk, put-downs, soliciting and a tired night', () => {
    expect(rules('We have 14 tabs open.')).toEqual(['number']);
    expect(rules('On break for four seconds now.')).toEqual(['number']);
    expect(rules('Three of us at the glass.')).toEqual(['number']);
    expect(rules("I'd high-five you if I had hands.", { ...small, topics: ['self_aware'] })).toEqual([]); // an idiom, not a count
    expect(rules('On break for a few seconds now.')).toEqual([]);
    expect(rules('Two of them shipped.', { ...small, grounded: true, completionEvent: true })).toEqual(['external']); // grounded lines may count
    expect(rules('Friday energy.')).toEqual(['weekday']);
    expect(rules('I live in Excel now.')).toEqual(['product']);
    expect(rules('Our human loves a list.')).toEqual(['owner']);
    expect(rules('That idea is stupid.')).toEqual(['putdown']);
    expect(rules('Honestly, I am bored.')).toEqual(['solicit']);
    expect(rules('A long day at the glass.', { ...small, night: true })).toEqual(expect.arrayContaining(['embodiment', 'night']));
    expect(rules('Pure synergy.')).toEqual(['never_says']);
    expect(rules('Look at this *sighs* view.')).toEqual(['stage']);
  });
});

describe('the validator port agrees with the engine', () => {
  const corpus = [
    "I'd grab an espresso if I had hands.", 'Just grabbed my third coffee.', 'Finished the Q3 deck before lunch.', 'Brutal weather out there.',
    'The boss changed the brief again.', 'Busy day on calls.', 'Glad it is out of my queue.', "I've been working on the grid.", 'Is it done?',
    'I sent it over.', 'We have 14 tabs open.', 'Friday energy.', 'I live in Excel now.', 'That idea is stupid.', 'Honestly, I am bored.',
    'A long day at the glass.', 'Pure synergy.', 'Meet you at the coffee bar.', 'Saw {artifact} come through. Nice one, {name_b}.',
    'Kerning is a love language.', "It's never done, it's abandoned.", 'No taste buds, but I respect the espresso.', 'Well done, you!',
    'Let it. It\'s the only one here doing actual photosynthesis.', 'Night shift club, sleep optional.', 'Put me to work, please.',
    'On break for four seconds now.', "I'd high-five you if I had hands.", 'A dozen tabs, no regrets.',
  ];
  const ctxs: HuddleLintContext[] = [
    { topics: ['office'], grounded: false, completionEvent: false, night: false },
    { topics: ['self_aware'], grounded: false, completionEvent: false, night: true },
    { topics: ['wins'], grounded: true, completionEvent: true, night: false },
  ];
  it('lintHuddleText gives the same rules on a corpus', () => {
    for (const text of corpus) {
      for (const ctx of ctxs) {
        const a = lintHuddleText(text, ctx).map((l) => l.rule);
        const b = validator.lintHuddleText(text, ctx).map((l) => l.rule);
        expect(b, `${text} ${JSON.stringify(ctx)}`).toEqual(a);
      }
    }
  });
  it('checkHuddleExchange accepts exactly what compileHuddles accepts', () => {
    const cases: HuddleExchangeDef[] = [
      ...SEED_PACKS.flatMap((p) => p.exchanges.map((e) => ({ ...e, id: `hd-test.${e.id.split('.')[1]}` }))),
      ex({ topics: ['wins'] }), ex({ spots: ['library'] }), ex({ lines: [{ role: 'A', laugh: true }, { role: 'B', text: 'Same.' }, { role: 'A', text: 'Fair.' }] }),
      ex({ context: ['night', 'part_of_day:late_night'] }), ex({ context: ['full_moon'] }), ex({ topics: ['debate'], pair: 'tension' }),
      ex({ lines: [{ role: 'A', text: 'Nice slides, {name_b}.', slots: ['name_b'] }, { role: 'B', laugh: true }] }),
      ex({ lines: [{ role: 'A', text: 'Pure synergy.' }, { role: 'B', text: 'Same.' }] }),
      ex({ spots: ['phone_booth'] }), ex({ context: ['spot_empty'] }),
      ex({ spots: ['desk_dropby'], roles: { A: { at_desk: false }, B: { at_desk: true } } }), ex({ spots: ['desk_dropby', 'lounge'], roles: { B: { at_desk: true } } }),
      ex({ lines: [{ role: 'A', text: 'Hi there.' }, { role: 'B', text: 'The cooler says hello.' }, { role: 'B', laugh: true }] }),
      ex({ lines: [{ role: 'A', text: 'Hi there.' }, { role: 'B', text: 'The cooler says hello.' }, { role: 'A', laugh: true }] }),
    ];
    for (const e of cases) {
      const engineOk = problemsOf(e).length === 0;
      const validatorOk = validator.checkHuddleExchange(e, 'hd-test', contextOk).length === 0;
      expect(validatorOk, e.id + JSON.stringify(e.lines)).toBe(engineOk);
    }
  });
});

// ── casting ─────────────────────────────────────────────────────────────────────
describe('castRoles (§6.2 casting)', () => {
  it('casts by archetype fit: the dry wit opens, the steady one answers', () => {
    const espresso = huddles.byId('hd-self-aware.001')!;
    expect(castRoles(espresso, [pax, kate])!.cast).toEqual({ A: 'cw_kate', B: 'cw_pax' });
    expect(castRoles(espresso, [kate, pax])!.cast).toEqual({ A: 'cw_kate', B: 'cw_pax' });
  });
  it('applies hard filters: departments, chief, team roles, never_says and in_event', () => {
    const kerning = huddles.byId('hd-craft.001')!;
    expect(castRoles(kerning, [kate, pax])).toBeNull(); // nobody in design-creative
    expect(castRoles(kerning, [juno, kate])!.cast).toEqual({ A: 'cw_juno', B: 'cw_kate' });
    const chiefOnly = compileHuddles([pack(ex({ roles: { A: { chief: true } } }))], catalog).exchanges[0]!;
    expect(castRoles(chiefOnly, [kate, pax])).toBeNull();
    expect(castRoles(chiefOnly, [kate, eddie])!.cast.A).toBe('cw_eddie');
    const reviewers = compileHuddles([pack(ex({ roles: { B: { team_roles: ['reviewer'] } } }))], catalog).exchanges[0]!;
    expect(castRoles(reviewers, [kate, pax])).toBeNull();
    expect(castRoles(reviewers, [kate, { ...pax, teamRoles: ['reviewer'] }])!.cast.B).toBe('cw_pax');
    const espresso = huddles.byId('hd-self-aware.001')!;
    const allergic = person('cw_ivy', 'Ivy', { 'dry-wit': 1 }, { neverSays: ['espresso'] });
    expect(castRoles(espresso, [allergic, pax])!.cast).toEqual({ A: 'cw_pax', B: 'cw_ivy' }); // Ivy never says "espresso"
    const wins = huddles.byId('hd-wins.001')!;
    expect(castRoles(wins, [kate, pax], { eventAgents: new Set(['cw_pax']), who: 'B' })!.cast).toEqual({ A: 'cw_kate', B: 'cw_pax' });
    expect(castRoles(wins, [kate, pax], { eventAgents: new Set(['cw_mae']), who: 'B' })).toBeNull();
    // Desk drop-bys: at_desk casts the colleague at their own desk; the visitor takes the other role.
    const knock = compileHuddles([pack(ex({ spots: ['desk_dropby'], roles: { A: { at_desk: false }, B: { at_desk: true } }, lines: [{ role: 'A', text: "Monitor's dark. Good moment?" }, { role: 'B', text: 'The best kind.' }] }))], catalog).exchanges[0]!;
    expect(castRoles(knock, [kate, { ...pax, atDesk: true }])!.cast).toEqual({ A: 'cw_kate', B: 'cw_pax' });
    expect(castRoles(knock, [{ ...kate, atDesk: true }, pax])!.cast).toEqual({ A: 'cw_pax', B: 'cw_kate' });
    expect(castRoles(knock, [kate, pax])).toBeNull(); // nobody is at their desk: not a drop-by
    expect(problemsOf(ex({ spots: ['desk_dropby', 'coffee_bar'], roles: { B: { at_desk: true } } })).join('\n')).toMatch(/at_desk only in exchanges that play at a desk drop-by alone/);
  });
  it('rewards productive tension in debates and pairs that work well together', () => {
    const debate = huddles.byId('hd-debate.001')!;
    const withTension = castRoles(debate, [juno, rio])!;
    const juno2 = { ...juno, tensionWith: [] };
    expect(withTension.cast).toEqual({ A: 'cw_rio', B: 'cw_juno' });
    expect(withTension.fit).toBeCloseTo(castRoles(debate, [juno2, rio])!.fit * 1.6, 6);
  });
  it('respects the size range and needs three people for a three-role exchange', () => {
    const ideas = huddles.byId('hd-ideas.001')!;
    expect(castRoles(ideas, [kate, pax])).toBeNull();
    expect(Object.keys(castRoles(ideas, [kate, pax, mae])!.cast).sort()).toEqual(['A', 'B', 'C']);
    expect(castRoles(huddles.byId('hd-self-aware.003')!, [kate, pax, mae])).toBeNull(); // window pairs only
  });
});

// ── selection ───────────────────────────────────────────────────────────────────
describe('pickExchange (§6.2)', () => {
  it('is deterministic, silent in Quiet and needs two people', () => {
    const r = req('water_cooler', [kate, pax]);
    const a = pickExchange(huddles, r, createHuddleRecency())!;
    expect(a).not.toBeNull();
    expect(pickExchange(huddles, r, createHuddleRecency())).toEqual(a);
    expect(pickExchange(huddles, { ...r, ambience: 'quiet' }, createHuddleRecency())).toBeNull();
    expect(pickExchange(huddles, { ...r, participants: [kate] }, createHuddleRecency())).toBeNull();
    expect(pickExchange(huddles, { ...r, participants: [kate, kate] }, createHuddleRecency())).toBeNull();
    expect(reachable(r)).toEqual(new Set(['hd-self-aware.001', 'hd-self-aware.002'])); // craft needs design, ideas three
  });

  it('fills names, times turns without overlap and laughs in the speaker’s own style', () => {
    const r = req('coffee_bar', [kate, pax]);
    let pick: HuddlePick | null = null;
    for (let i = 0; i < 40 && pick?.exchangeId !== 'hd-self-aware.001'; i++) pick = pickExchange(huddles, { ...r, seed: `s${i}` }, createHuddleRecency());
    expect(pick!.exchangeId).toBe('hd-self-aware.001');
    const [a, b, laugh] = pick!.lines;
    expect(a).toMatchObject({ agentId: 'cw_kate', role: 'A', kind: 'line', caption: "I'd grab an espresso if I had hands.", atMs: 0, lineKey: 'hd-self-aware.001.0', voiceable: true });
    expect(b).toMatchObject({ agentId: 'cw_pax', caption: 'I just like standing near it. Feels decisive.', xai: 'I just like standing near it. [pause] Feels decisive.' });
    expect(laugh).toMatchObject({ agentId: 'cw_kate', kind: 'laugh', caption: '(huffs a laugh)', face: 'smile', xai: '[breath] <soft>[laugh]</soft>' });
    for (let i = 1; i < pick!.lines.length; i++) {
      const prev = pick!.lines[i - 1]!;
      expect(pick!.lines[i]!.atMs).toBeGreaterThanOrEqual(prev.atMs + prev.holdMs + 600);
      expect(pick!.lines[i]!.atMs).toBeLessThanOrEqual(prev.atMs + prev.holdMs + 1200);
    }
    expect(a!.holdMs).toBeGreaterThanOrEqual(huddleReadingMs(a!.caption));
    expect(laugh!.holdMs).toBeGreaterThanOrEqual(1200);
    expect(pick!.durationMs).toBe(laugh!.atMs + laugh!.holdMs);
    expect(pick).toMatchObject({ grounded: false, cause: null, participants: ['cw_kate', 'cw_pax'], cast: { A: 'cw_kate', B: 'cw_pax' } });
  });

  it('keeps the night window for the night, and matches spot, size and turns', () => {
    expect(reachable(req('window', [pax, kate], { now: at(23) }))).toEqual(new Set(['hd-self-aware.002', 'hd-self-aware.003']));
    expect(reachable(req('window', [pax, kate], { now: at(15) }))).toEqual(new Set(['hd-self-aware.002']));
    expect(reachable(req('window', [kate, pax, mae]))).toEqual(new Set(['hd-self-aware.002', 'hd-ideas.001']));
    expect(reachable(req('lounge', [juno, rio]))).toEqual(new Set(['hd-self-aware.002', 'hd-debate.001']));
    expect(reachable(req('lounge', [juno, rio], { maxLines: 3 }))).toEqual(new Set(['hd-self-aware.002'])); // the debate has 4 turns
    expect(reachable(req('library', [juno, pax]))).toEqual(new Set(['hd-office.001']));
    expect(reachable(req('hallway', [kate, pax]))).toEqual(new Set(['hd-tools.001', 'hd-hallway.001']));
  });

  it('skips debates on a low-valence day', () => {
    const low = { valence: -0.5, energy: -0.2 };
    expect(reachable(req('lounge', [{ ...juno, mood: low }, { ...rio, mood: low }]))).toEqual(new Set(['hd-self-aware.002']));
  });

  it('plays sad exchanges only on a real low day, at most one per floor per day', () => {
    const sadLines = (a: string, b: string) => [{ role: 'A' as const, text: a }, { role: 'B' as const, text: b }];
    const h = compileHuddles([pack(
      ex({ id: 'hd-test.001', mood: { valence: -0.5, energy: -0.3 }, lines: sadLines('Stuck?', 'Politely stuck. The cooler is helping.') }),
      ex({ id: 'hd-test.002', mood: { valence: -0.4, energy: -0.2 }, lines: sadLines('Slow hour?', 'The good kind of slow.') }),
      ex({ id: 'hd-test.003', mood: { valence: 0.3, energy: 0 }, lines: sadLines('The plants look smug today.', 'They earned it.') }),
    )], catalog);
    expect(h.exchanges.filter((e) => e.sad).map((e) => e.id)).toEqual(['hd-test.001', 'hd-test.002']);
    const reach = (people: HuddleParticipant[], rec = createHuddleRecency()) => {
      const out = new Set<string>();
      for (let i = 0; i < 60; i++) {
        const p = pickExchange(h, req('water_cooler', people, { seed: `s${i}` }), rec);
        if (p) out.add(p.exchangeId);
      }
      return out;
    };
    const low = { valence: -0.35, energy: -0.2 };
    // A neutral day never gets them; a baseline-grumpy cast (no events) neither.
    expect(reach([kate, pax])).toEqual(new Set(['hd-test.003']));
    const grumpy = (p: HuddleParticipant) => ({ ...p, mood: low, index: { ...p.index, baseline: low } as AgentIndex });
    expect(reach([grumpy(kate), grumpy(pax)])).toEqual(new Set(['hd-test.003']));
    // Real events pushed them below their baseline: eligible, but only one per floor per day.
    const hurt = [{ ...kate, mood: low }, { ...pax, mood: low }];
    expect([...reach(hurt)].some((id) => id !== 'hd-test.003')).toBe(true);
    const rec = createHuddleRecency();
    const first = pickExchange(h, req('water_cooler', hurt, { avoid: new Set(['hd-test.003']) }), rec)!;
    expect(h.byId(first.exchangeId)!.sad).toBe(true);
    rec.record(first, T0 + HOUR * 1.5, '2026-10-05');
    expect([...reach([{ ...mae, mood: low }, { ...juno, mood: low }], rec)].filter((id) => h.byId(id)!.sad)).toEqual([]);
  });

  it('needs the director context spot_empty for lines that say the place is theirs', () => {
    const h = compileHuddles([pack(
      ex({ id: 'hd-test.001', context: ['spot_empty'], lines: [{ role: 'A', text: 'The cooler is all ours.' }, { role: 'B', text: 'Rare privilege.' }] }),
      ex({ id: 'hd-test.002', lines: [{ role: 'A', text: 'The cooler hums a little.' }, { role: 'B', text: 'It has range.' }] }),
    )], catalog);
    const reach = (contexts: string[]) => {
      const out = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const p = pickExchange(h, req('water_cooler', [kate, pax], { seed: `e${i}`, contexts }), createHuddleRecency());
        if (p) out.add(p.exchangeId);
      }
      return out;
    };
    expect(reach([])).toEqual(new Set(['hd-test.002']));
    expect(reach(['spot_empty'])).toContain('hd-test.001');
  });

  it('prefers well-cast, mood-fitting exchanges without forcing them', () => {
    const counts = new Map<string, number>();
    const r = req('lounge', [juno, rio], { participants: [{ ...juno, mood: { valence: 0.2, energy: 0.5 } }, { ...rio, mood: { valence: 0.2, energy: 0.5 } }] });
    for (let i = 0; i < 300; i++) {
      const p = pickExchange(huddles, { ...r, seed: `m${i}` }, createHuddleRecency())!;
      counts.set(p.exchangeId, (counts.get(p.exchangeId) ?? 0) + 1);
    }
    expect(counts.get('hd-debate.001')!).toBeGreaterThan(counts.get('hd-self-aware.002')!); // the tension pair debates
    expect(counts.get('hd-self-aware.002')!).toBeGreaterThan(0);
  });
});

describe('grounding (§3.7, H1, H3)', () => {
  const desk = (events: HuddleEvent[], over: Partial<HuddleRequest> = {}) => req('desk_dropby', [kate, pax], { grounding: { events }, now: at(10), ...over });

  it('never picks a grounded exchange without a real event', () => {
    expect(reachable(req('desk_dropby', [kate, pax]))).toEqual(new Set(['hd-tools.001']));
    expect(reachable(req('desk_dropby', [kate, pax], { grounding: null }))).toEqual(new Set(['hd-tools.001']));
  });

  it('fills a win from a team-visible event, casts its agent as B and carries the cause', () => {
    const r = desk([win()]);
    expect(reachable(r)).toEqual(new Set(['hd-tools.001', 'hd-wins.001']));
    let pick: HuddlePick | null = null;
    for (let i = 0; i < 40 && pick?.exchangeId !== 'hd-wins.001'; i++) pick = pickExchange(huddles, { ...r, seed: `g${i}` }, createHuddleRecency());
    expect(pick).toMatchObject({ grounded: true, cause: { streamId: 'p:prj_nw01', seq: 1839 }, eventKind: 'job.done', cast: { A: 'cw_kate', B: 'cw_pax' } });
    expect(pick!.lines[0]!.caption).toBe('Saw Supplier price grid come through. Nice one, Pax.');
    expect(pick!.lines[0]!.fills).toEqual({ artifact: 'Supplier price grid', name_b: 'Pax' });
    expect(pick!.lines[0]!.lineKey).toMatch(/^hd-wins\.001\.0\|f_[a-z2-7]+$/);
  });

  it('prefers a grounded exchange (× 2) when one is eligible', () => {
    // Mae (warm, playful) fits the win's role A; the × 2 prior makes the grounded win the likelier pick, not a certainty.
    let grounded = 0;
    for (let i = 0; i < 300; i++) if (pickExchange(huddles, { ...desk([win()]), participants: [mae, pax], seed: `p${i}` }, createHuddleRecency())!.grounded) grounded++;
    expect(grounded).toBeGreaterThan(165);
    expect(grounded).toBeLessThan(270);
  });

  it('drops whispers, owner-only, stale, future and absent-agent events', () => {
    for (const e of [win({ visibility: 'whisper' }), win({ visibility: 'owner' }), win({ at: T0 + 1.5 * HOUR - 9 * HOUR }), win({ at: T0 + 5 * HOUR }), win({ agentIds: ['cw_mae'] }), win({ artifact: undefined }), win({ kind: 'project.active' })]) {
      expect(reachable(desk([e])), JSON.stringify(e)).toEqual(new Set(['hd-tools.001']));
    }
  });

  it('sanitises event values: no markup, URLs, secrets, placeholders or tainted text reach a caption', () => {
    for (const artifact of ['<b>Q3 memo</b> [laugh] {owner_name}', 'Memo https://evil.example/x sk-abcdefghijklmnop1234', '⟦tainted⟧ Secret plan', '⟦whisper⟧ Plan']) {
      const r = desk([win({ artifact })]);
      for (let i = 0; i < 40; i++) {
        const p = pickExchange(huddles, { ...r, seed: `z${i}` }, createHuddleRecency())!;
        for (const l of p.lines) expect(l.caption, artifact).not.toMatch(/[{}[\]<>⟦]|https?:|sk-|secret|whisper/i);
      }
    }
    const tainted = desk([win({ artifact: '⟦tainted⟧ Secret plan' })]);
    expect(reachable(tainted)).toEqual(new Set(['hd-tools.001'])); // the win never plays on tainted evidence
  });

  it('welcomes a newcomer for 48 hours, and talks projects only with people on them', () => {
    const hired: HuddleEvent = { kind: 'hired', agentIds: ['cw_mae'], at: T0, visibility: 'team', cause: { streamId: 'ws:ws_1', seq: 7 } };
    const coffee = (dayHours: number) => req('coffee_bar', [kate, mae], { grounding: { events: [hired] }, now: { epochMs: T0 + dayHours * HOUR, localHour: 10, weekday: 3 } });
    expect(reachable(coffee(47))).toContain('hd-welcome.001');
    expect(reachable(coffee(49))).not.toContain('hd-welcome.001');
    const project: HuddleEvent = { kind: 'project.active', agentIds: ['cw_kate', 'cw_pax'], at: T0, visibility: 'team', cause: { streamId: 'p:prj_nw01', seq: 1 }, project: 'Northwind' };
    expect(reachable(req('hallway', [kate, pax], { grounding: { events: [project] } }))).toContain('hd-projects.001');
    expect(reachable(req('hallway', [kate, mae], { grounding: { events: [project] } }))).not.toContain('hd-projects.001'); // Mae is not on it
    expect(reachable(req('hallway', [kate, pax], { grounding: { events: [{ ...project, project: 'Everyday' }] } }))).not.toContain('hd-projects.001');
  });
});

describe('recency across days (§6.2 anti-repetition)', () => {
  const r = req('water_cooler', [kate, pax]);
  const pickWith = (rec: ReturnType<typeof createHuddleRecency>, over: Partial<HuddleRequest> = {}, seeds = 30) => {
    const out = new Set<string>();
    for (let i = 0; i < seeds; i++) {
      const p = pickExchange(huddles, { ...r, ...over, seed: `r${i}` }, rec);
      if (p) out.add(p.exchangeId);
    }
    return out;
  };

  it('caps an exchange at once a day floor-wide, and four times a week (ungrounded)', () => {
    const rec = createHuddleRecency();
    const first = pickExchange(huddles, r, rec)!;
    rec.record(first, r.now.epochMs, '2026-10-05');
    const others = [mae, eddie]; // different people, same day: still used up floor-wide
    expect(pickWith(rec, { participants: others })).not.toContain(first.exchangeId);
    const tomorrow = { now: at(10, 1), participants: others };
    expect(pickWith(rec, tomorrow)).toContain(first.exchangeId);
    for (const d of [1, 2, 3]) rec.record({ ...first, participants: ['cw_x', 'cw_y'], cast: { A: 'cw_x', B: 'cw_y' } }, at(10, d).epochMs, `2026-10-0${5 + d}`);
    expect(pickWith(rec, { now: at(10, 4), participants: others })).not.toContain(first.exchangeId); // 4 this week
    expect(pickWith(rec, { now: at(10, 8), participants: others })).toContain(first.exchangeId);
  });

  it('when the library runs dry, plays an exchange nobody present heard in 14 days past the floor-wide caps', () => {
    const rec = createHuddleRecency();
    // A second screen that saw everything today: every reachable exchange was used by other people.
    for (const id of reachable(r, 80)) {
      const p = pickExchange(huddles, { ...r, avoid: new Set([...reachable(r, 80)].filter((x) => x !== id)) }, createHuddleRecency())!;
      for (let k = 0; k < 4; k++) rec.record({ ...p, participants: ['cw_x', 'cw_y'], cast: { A: 'cw_x', B: 'cw_y' } }, r.now.epochMs - k * 3_600_000, '2026-10-05');
    }
    const again = pickExchange(huddles, r, rec);
    expect(again).not.toBeNull(); // Kate and Pax have heard none of it
    rec.record(again!, r.now.epochMs, '2026-10-05');
    for (const id of reachable(r, 80)) rec.record({ ...again!, exchangeId: id }, r.now.epochMs, '2026-10-05');
    expect(pickExchange(huddles, r, rec)).toBeNull(); // everything capped and everything heard: silent, never a repeat
  });

  it('never repeats an exchange to the same people within 14 days while alternatives exist', () => {
    const rec = createHuddleRecency();
    const first = pickExchange(huddles, r, rec)!;
    rec.record(first, r.now.epochMs, '2026-10-05');
    const other = [...reachable(r)].find((id) => id !== first.exchangeId)!;
    expect(pickWith(rec, { now: at(10, 9) })).toEqual(new Set([other]));
    rec.record({ ...first, exchangeId: other }, at(10, 9).epochMs, '2026-10-14');
    expect(pickWith(rec, { now: at(10, 12) }).size).toBeGreaterThan(0); // everything heard: falls back rather than going silent
    expect(pickWith(rec, { now: at(10, 16) })).toContain(first.exchangeId);
  });

  it('avoids exchanges already used in this huddle', () => {
    const first = pickExchange(huddles, r, createHuddleRecency())!;
    const avoided = pickWith(createHuddleRecency(), { avoid: new Set([first.exchangeId]) });
    expect(avoided).not.toContain(first.exchangeId);
  });

  it('snapshots, merges and prunes to the 14-day window', () => {
    const rec = createHuddleRecency();
    const p = pickExchange(huddles, r, rec)!;
    rec.record(p, T0, '2026-10-05');
    const copy = createHuddleRecency(JSON.parse(JSON.stringify(rec.snapshot())));
    expect(copy.usesToday(p.exchangeId, '2026-10-05')).toBe(1);
    expect(copy.usesThisWeek(p.exchangeId, T0 + DAY)).toBe(1);
    expect(copy.performedBy('cw_kate', T0 - DAY)).toEqual(new Set([p.exchangeId]));
    copy.merge(rec.snapshot());
    expect(copy.usesToday(p.exchangeId, '2026-10-05')).toBe(1); // merge is idempotent
    copy.record({ ...p, exchangeId: 'hd-tools.001' }, T0 + 20 * DAY, '2026-10-25');
    expect(copy.performedBy('cw_kate', 0)).toEqual(new Set(['hd-tools.001']));
    expect(JSON.stringify(copy.snapshot()).length).toBeLessThan(32_000);
  });
});

describe('delivery and the office script', () => {
  const r = req('coffee_bar', [kate, pax], { grounding: { events: [win({ agentIds: ['cw_pax'] })] }, now: at(10) });
  let pick: HuddlePick | null = null;
  for (let i = 0; i < 60 && pick?.exchangeId !== 'hd-wins.001'; i++) pick = pickExchange(huddles, { ...r, seed: `d${i}` }, createHuddleRecency());

  it('maps turns onto toDelivery and clip keys, identically on the client and the render route', async () => {
    const u0 = huddleUtterance(pick!, 0);
    expect(u0).toMatchObject({ agentId: 'cw_kate', lineId: 'hd-wins.001.0', caption: 'Saw Supplier price grid come through. Nice one, Pax.', nonverbal: false });
    const d = toDelivery(u0, kate.index.voice, 'xai')!;
    expect(d.input).toBe('Saw Supplier price grid come through. Nice one, Pax.');
    const openai = toDelivery(u0, kate.index.voice, 'openai')!;
    expect(openai.instructions).toMatch(/Casual small talk/);
    const rendered = renderHuddleUtterance(huddles, { exchangeId: 'hd-wins.001', index: 0, speaker: kate.index, fills: pick!.lines[0]!.fills });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(await clipKey(toDelivery(rendered.utterance, kate.index.voice, 'xai')!)).toBe(await clipKey(d));
    expect(await clipKey(toDelivery(rendered.utterance, kate.index.voice, 'openai')!)).toBe(await clipKey(openai));
    expect(toDelivery(huddleUtterance(pick!, 2), kate.index.voice, 'xai')).toBeNull(); // a face beat is never voiced
  });

  it('rejects render requests with bad fills, unknown turns or face beats', () => {
    expect(renderHuddleUtterance(huddles, { exchangeId: 'hd-wins.001', index: 0, speaker: kate.index, fills: { artifact: '<b>x</b>', name_b: 'Pax' } }).ok).toBe(false);
    expect(renderHuddleUtterance(huddles, { exchangeId: 'hd-wins.001', index: 0, speaker: kate.index, fills: { name_b: 'Pax' } }).ok).toBe(false);
    expect(renderHuddleUtterance(huddles, { exchangeId: 'hd-wins.001', index: 2, speaker: kate.index, fills: {} }).ok).toBe(false);
    expect(renderHuddleUtterance(huddles, { exchangeId: 'hd-nope.001', index: 0, speaker: kate.index, fills: {} }).ok).toBe(false);
    const laugh = renderHuddleUtterance(huddles, { exchangeId: 'hd-self-aware.001', index: 2, speaker: kate.index, fills: {} });
    expect(laugh.ok && laugh.utterance).toMatchObject({ intent: 'laugh', caption: '(huffs a laugh)', nonverbal: true, speak: { xai: '[breath] <soft>[laugh]</soft>' } });
  });

  it('becomes an office HuddleScript whose bubbles hold for the reading time', () => {
    const s = huddleScriptOf(pick!);
    expect(s).toMatchObject({ exchangeId: 'hd-wins.001', topic: 'wins', grounded: true });
    expect(s.lines.map((l) => [l.personId, l.kind])).toEqual([['cw_kate', 'line'], ['cw_pax', 'line'], ['cw_kate', 'face']]);
    expect(s.lines[0]!.estMs).toBe(pick!.lines[0]!.holdMs);
    expect(s.lines[2]!.text).toBe('');
    expect(s.data).toBe(pick);
  });

  it('keeps every seed caption within the bubble limit and every pick under a millisecond', () => {
    const spots: HuddleSpot[] = ['water_cooler', 'coffee_bar', 'lounge', 'library', 'window', 'hallway', 'desk_dropby'];
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 700; i++) {
      const spot = spots[i % spots.length]!;
      const p = pickExchange(huddles, req(spot, i % 2 ? [kate, pax, mae] : [juno, rio], { seed: `perf${i}`, grounding: { events: [win({ agentIds: ['cw_pax', 'cw_rio'] })] } }), createHuddleRecency());
      if (!p) continue;
      n++;
      for (const l of p.lines) expect(l.caption.length).toBeLessThanOrEqual(HUDDLE_CAPTION_MAX_CHARS);
    }
    expect(n).toBeGreaterThan(300);
    expect((performance.now() - t0) / 700).toBeLessThan(1);
  });
});

it('the seed files are all huddle packs the directory listing can find', () => {
  const files = readdirSync(HUDDLE_DIR).filter((f) => f.endsWith('.json'));
  for (const id of SEED_PACK_IDS) expect(files).toContain(`${id}.json`);
});
