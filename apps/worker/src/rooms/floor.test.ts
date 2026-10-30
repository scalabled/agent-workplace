// Floor control (Office Phase 2 §4.2.3): mentions, group cues, relevance, rotation, the Chief, caps and phatic turns.
import { firstName } from '@headcount/catalog';
import { catalogFull, fullIndex } from '@headcount/catalog/full';
import { CHIEF_ID, coworkerAgentId } from '@headcount/protocol';
import { describe, expect, it } from 'vitest';
import { mentionAt, planFloor, relevanceScore, relevanceTokens, type FloorCandidate, type FloorInput } from './floor';

const skills = new Map(catalogFull.skills.map((s) => [s.id, s.name]));

function persona(id: string, seat: number): FloorCandidate {
  const p = fullIndex.persona(id)!;
  return {
    agentId: coworkerAgentId(p.id),
    firstName: firstName(p.name),
    fullName: p.name,
    isChief: false,
    seat,
    title: p.title,
    departmentName: fullIndex.department(p.department)?.name ?? p.department,
    skillNames: [...p.skills.primary, ...p.skills.secondary].map((s) => skills.get(s) ?? s),
    oneLiner: p.one_liner,
  };
}

function fake(first: string, seat: number, over: Partial<FloorCandidate> = {}): FloorCandidate {
  return { agentId: `cw_${first.toLowerCase()}`, firstName: first, fullName: `${first} Tester`, isChief: false, seat, title: 'Generalist', departmentName: 'Core crew', skillNames: [], oneLiner: 'Helps out.', ...over };
}

const chief = (seat: number): FloorCandidate => ({ agentId: CHIEF_ID, firstName: 'Rosa', fullName: 'Rosa', isChief: true, seat, title: 'Chief of Staff', departmentName: 'Chief of Staff', skillNames: [], oneLiner: '' });

const plan = (text: string, candidates: FloorCandidate[], over: Partial<FloorInput> = {}) =>
  planFloor({ text, kind: 'skyline', candidates, phatic: false, lastFirst: null, turnsBy: {}, ...over });

const table = [fake('Juno', 0), fake('Walt', 1), fake('Lena', 2), fake('Kate', 3), fake('Pax', 4)];

describe('mentions', () => {
  it('answer first, in the order named; @juno and "Juno," both count', () => {
    expect(plan('Lena and Walt, is this worth it?', table)).toEqual({ order: ['cw_lena', 'cw_walt'], mode: 'mention', chiefWrap: false });
    expect(plan('what does @juno say?', table).order).toEqual(['cw_juno']);
    expect(plan('Juno, is this worth it?', table).order).toEqual(['cw_juno']);
    expect(plan('I wonder whether Pax agrees.', table).order).toEqual(['cw_pax']);
    expect(plan('Pax Tester, your view?', table).order).toEqual(['cw_pax']);
  });

  it('skips a first name that opens a sentence without a comma (names that are ordinary words)', () => {
    const hope = fake('Hope', 0);
    expect(mentionAt('Hope this helps.', hope)).toBe(-1);
    expect(mentionAt('Hope, what do you think?', hope)).toBe(0);
    expect(mentionAt('Thanks. Hope you agree.', hope)).toBe(-1);
    expect(mentionAt('I asked Hope first.', hope)).toBeGreaterThan(0);
    expect(mentionAt('Hope and Juno, thoughts?', hope)).toBe(0);
    expect(mentionAt('Hope?', hope)).toBe(0);
    expect(mentionAt('Hope and pray.', hope)).toBe(-1);
    expect(mentionAt('hope, lowercase is not a name', hope)).toBe(-1);
  });

  it('caps at three and a group cue fills up after the mentions', () => {
    expect(plan('Pax, Kate, Lena and Walt: go.', table).order).toEqual(['cw_pax', 'cw_kate', 'cw_lena']);
    const g = plan('Pax, and everyone else: what do you all think?', table);
    expect(g.mode).toBe('group');
    expect(g.order).toHaveLength(3);
    expect(g.order[0]).toBe('cw_pax');
    // "what do you think" asks the table only when nobody is named.
    expect(plan('Juno, what do you think?', table).order).toEqual(['cw_juno']);
  });
});

describe('group cues and relevance', () => {
  it('a group cue fills to three', () => {
    expect(plan('What do you all think?', table)).toMatchObject({ mode: 'group', order: ['cw_juno', 'cw_walt', 'cw_lena'] });
    expect(plan('Thoughts?', table).order).toHaveLength(3);
    expect(plan('Does anyone disagree?', table).order).toHaveLength(3);
  });

  it('picks the legal persona for a contract question, and adds a second only above 0.35 × top', () => {
    const people = [persona('senior-copywriter', 0), persona('contracts-analyst', 1), persona('tech-lead', 2), persona('privacy-specialist', 3)];
    const q = 'Should we sign this supplier contract as it stands?';
    const p = plan(q, people);
    expect(p.mode).toBe('relevance');
    expect(p.order[0]).toBe('cw_contracts-analyst');
    const tokens = relevanceTokens(q);
    const scores = people.map((c) => relevanceScore(tokens, c));
    const top = Math.max(...scores);
    const bar = Math.max(1, 0.35 * top);
    const expected = people.filter((_, k) => scores[k]! >= bar).length;
    expect(p.order).toHaveLength(Math.min(3, expected));
    for (const id of p.order.slice(1)) expect(scores[people.findIndex((c) => c.agentId === id)]!).toBeGreaterThanOrEqual(bar);
    // A synthetic table makes the bar visible: Ada 4.5 (title ×3 + skill ×1.5), bar 1.575; Cy 3 (department ×2 +
    // one-liner ×1) joins, Bo 1 (one-liner) does not.
    const a = fake('Ada', 0, { title: 'Pricing strategist', skillNames: ['Price review'] });
    const b = fake('Bo', 1, { oneLiner: 'Talks pricing.' });
    const c = fake('Cy', 2, { departmentName: 'Pricing', oneLiner: 'Talks pricing.' });
    const synthetic = plan('How should we set pricing?', [a, b, c]);
    expect(synthetic.order).toEqual(['cw_ada', 'cw_cy']);
  });

  it('"you two", "both of you" and "you guys" ask the whole huddle', () => {
    const pair = [fake('Jip', 0), fake('Fleur', 1)];
    for (const text of [
      'What is the first thing you two would fix about how we launch?',
      'What would you both change?',
      'Both of you: where would you start?',
      'Would the two of you ship it?',
      'What do you guys make of the brief?',
    ]) {
      const p = plan(text, pair, { kind: 'huddle' });
      expect(p.mode, text).toBe('group');
      expect(p.order.sort(), text).toEqual(['cw_fleur', 'cw_jip']);
    }
    expect(plan('thanks, you two', pair, { phatic: true, kind: 'huddle' }).order).toHaveLength(2);
  });

  it('with nothing relevant, two speak by rotation (a huddle: one)', () => {
    expect(plan('Hmm.', table).order).toEqual(['cw_juno', 'cw_walt']);
    expect(plan('Hmm.', table.slice(0, 3), { kind: 'huddle' }).order).toEqual(['cw_juno']);
  });
});

describe('rotation', () => {
  it('moves the first speaker: seat order after the previous first, then fewer replies', () => {
    const first = plan('Hmm.', table);
    expect(first.order[0]).toBe('cw_juno');
    const second = plan('Hmm.', table, { lastFirst: 'cw_juno', turnsBy: { cw_juno: 1, cw_walt: 1 } });
    expect(second.order[0]).not.toBe('cw_juno');
    expect(second.order).toEqual(['cw_lena', 'cw_kate']);
    // Equal replies: seat order starting after the previous first.
    expect(plan('Hmm.', table, { lastFirst: 'cw_lena', turnsBy: {} }).order).toEqual(['cw_kate', 'cw_pax']);
  });
});

describe('the Chief', () => {
  const withChief = [chief(0), ...table.slice(0, 3).map((c, i) => ({ ...c, seat: i + 1 }))];

  it('answers only when named or alone', () => {
    // Not a responder when others are here (a planned wrap-up comes last, after two others).
    expect(plan('Hmm.', withChief)).toEqual({ order: ['cw_juno', 'cw_walt', CHIEF_ID], mode: 'relevance', chiefWrap: true });
    expect(plan('Hmm.', withChief.slice(0, 2)).order).toEqual(['cw_juno']);
    expect(plan('Rosa, what do you make of it?', withChief).order).toEqual([CHIEF_ID]);
    expect(plan('@rosa thoughts?', withChief).order[0]).toBe(CHIEF_ID);
    expect(plan('What do you think?', [chief(0)]).order).toEqual([CHIEF_ID]);
  });

  it('wraps up a conference only with at least two other responders, last, and never in a huddle', () => {
    expect(plan('What do you all think?', withChief)).toEqual({ order: ['cw_juno', 'cw_walt', 'cw_lena', CHIEF_ID], mode: 'group', chiefWrap: true });
    expect(plan('Juno, your view?', withChief)).toMatchObject({ order: ['cw_juno'], chiefWrap: false });
    const huddle = plan('What do you all think?', withChief.slice(0, 3), { kind: 'huddle' });
    expect(huddle.chiefWrap).toBe(false);
    expect(huddle.order).toHaveLength(2);
    expect(huddle.order).not.toContain(CHIEF_ID);
  });
});

describe('phatic turns', () => {
  it('pick at most two by rotation (a huddle one, or two when greeted all), named people first', () => {
    expect(plan('hi everyone', table, { phatic: true })).toEqual({ order: ['cw_juno', 'cw_walt'], mode: 'phatic', chiefWrap: false });
    expect(plan('thanks', table.slice(0, 3), { phatic: true, kind: 'huddle' }).order).toEqual(['cw_juno']);
    expect(plan('thanks all', table.slice(0, 3), { phatic: true, kind: 'huddle' }).order).toHaveLength(2);
    expect(plan('thanks, Lena', table, { phatic: true }).order).toEqual(['cw_lena']);
    expect(plan('hi everyone', [chief(0), ...table.slice(0, 3).map((c, i) => ({ ...c, seat: i + 1 }))], { phatic: true }).chiefWrap).toBe(false);
  });
});
