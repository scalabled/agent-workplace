// The reply guard (Office Phase 2 §4.2.6): the fixture table, number words both ways, one replacement per reply, and
// the desk quick-chat wired through it.
import type { ModelEvent } from '@headcount/models';
import { afterEach, describe, expect, it } from 'vitest';
import { exprSetup, isDesk, useProviders } from '../../test/expr-kit';
import { defaultRuntime, runtime } from '../workspace/runtime';
import { OFFER_LINE } from '../desk/desk';
import { CHIEF_ROOM_WORK_LINE, EXPERIENCE_LINE, FIGURE_LINE, ReplyGuard, figuresIn, ownerContext, ownerFigures, sentenceHit } from './guard';

afterEach(() => Object.assign(runtime, defaultRuntime));

const guard = (owner: string[] = [], maxSentences = 2, work: 'strict' | 'room' = 'strict') =>
  new ReplyGuard({ allowedFigures: ownerFigures(owner), ownerText: owner, workLine: OFFER_LINE, figureLine: FIGURE_LINE, maxSentences, work });
/** What a room (or huddle) guard says about one sentence, given the owner's lines. */
const roomHit = (line: string, owner: string[] = []) => sentenceHit(line, ownerFigures(owner), { owner: ownerContext(owner), work: 'room' });
const run = (g: ReplyGuard, text: string) => g.push(text) + g.flush();

describe('figuresIn', () => {
  it('normalises digits, decimals, times, percentages, currency, ordinals and quarters', () => {
    expect([...figuresIn('It went from 9 to 9.5 at 10:40 in 2026.')]).toEqual(['9', '9.5', '10:40', '2026']);
    expect([...figuresIn('Churn is 40% and the budget is $5k, or $5,000.')].sort()).toEqual(['40', '5000']);
    expect([...figuresIn('The 3rd option for Q2.')].sort()).toEqual(['2', '3']);
    expect([...figuresIn('Up 12 percent.')]).toEqual(['12']);
  });

  it('reads number words as digits, both ways', () => {
    expect([...figuresIn('It went up nine points.')]).toEqual(['9']);
    expect([...figuresIn('twenty-five people, two hundred and fifty units')]).toEqual(['25', '250']);
    expect([...figuresIn('three million users, 3 million users')]).toEqual(['3000000']);
    expect([...figuresIn('a dozen tests, dozens of ideas, hundreds of calls')].sort()).toEqual(['100', '12']);
    const owner = ownerFigures(['We have three weeks.']);
    expect(sentenceHit('3 weeks is tight, so cut scope.', owner)).toBeNull();
    expect(sentenceHit('Three weeks is tight.', ownerFigures(['We have 3 weeks.']))).toBeNull();
  });

  it('does not count one, a few, a couple, half, double, twice, first or second', () => {
    expect(figuresIn('One idea: a few tests, a couple of pilots, half the list, double the effort, think twice. First, a second look at the one-pager.').size).toBe(0);
  });

  it('reads hyphenated number words part by part ("nine-point" is 9) and multipliers ("3x")', () => {
    expect([...figuresIn('a nine-point jump')]).toEqual(['9']);
    expect([...figuresIn('a twenty-percent lift')]).toEqual(['20']);
    expect([...figuresIn('It is 3x faster.')]).toEqual(['3']);
  });

  it('does not read digits inside names, ratios or a spaced unit letter as figures', () => {
    for (const t of ['B2B buyers care about trust.', "Let's do a 1:1 first.", 'Support should be 24/7.', 'Web3 is a distraction.', 'GPT-4 and COVID-19 changed it.', 'A 2x2 grid helps.']) expect([...figuresIn(t)], t).toEqual([]);
    expect([...figuresIn('A 5 m walk')]).toEqual(['5']);
  });
});

describe('ReplyGuard', () => {
  const mustBlock = [
    'Then lead with the reorder rate: it went up nine points after the relaunch.',
    'I can have the one-pager with both numbers by tomorrow noon.',
    "Brand love doesn't move their Q2 number.",
    'We tested that last spring and conversions doubled.',
    'Our churn is 4% right now.',
    'Last quarter we closed 30 deals.',
    'I just finished the competitor grid.',
    'According to the latest survey, most buyers prefer bundles.',
  ];
  const mustPass: [string, string[]][] = [
    ["I'd lead with sell-through, not brand love.", []],
    ['Show me the reorder rate before we decide.', []],
    ['If churn is the worry, fix onboarding first.', []],
    ["I'd think twice before discounting.", []],
    ['3 weeks is tight, so cut scope.', ['We have three weeks.']],
    ["Juno's right, and I'd add a small pilot.", []],
    ['One idea: test it with a small group first.', []],
    ["I'm not sure; I'd want the real numbers first.", []],
  ];

  it.each(mustBlock)('blocks: %s', (line) => {
    expect(sentenceHit(line, ownerFigures(['Should we lead with brand love or sell-through?']))).not.toBeNull();
    const g = guard(['Should we lead with brand love or sell-through?']);
    const out = run(g, line);
    expect(out).not.toContain(line);
    expect([FIGURE_LINE, EXPERIENCE_LINE, OFFER_LINE]).toContain(out.trim());
    expect(g.rewrites).toBe(1);
  });

  it.each(mustPass)('passes: %s', (line, owner) => {
    expect(sentenceHit(line, ownerFigures(owner))).toBeNull();
    expect(run(guard(owner), line)).toBe(line);
  });

  it('never lets the office demo line through: the sentence is dropped, the rest is said, and only the kind is kept', () => {
    const g = guard(['Should we lead with sell-through or brand love?']);
    const out = g.push('Then lead with the reorder rate: it went up nine points after the relaunch. ') + g.push('That settles it.') + g.flush();
    expect(out).toBe('That settles it.');
    expect(g.hits).toEqual(['figure']);
    // Nothing else to say: the honest line instead of silence.
    expect(run(guard(['Should we lead with it?']), 'Then lead with the reorder rate: it went up nine points after the relaunch.')).toBe(FIGURE_LINE);
  });

  it('blocks the canned claim reworded, invented access, memories, standings and citations (the honesty holes)', () => {
    for (const line of [
      'The reorder rate had a nine-point jump after the relaunch.',
      'That gave us a twenty-percent lift last quarter.',
      'Conversion doubles when the price is clear.',
      'Revenue is up a third on last month.',
      'I checked your dashboard this morning and churn looks fine.',
      'I looked at the numbers and they are strong.',
      'I remember a client who tried exactly that.',
      'When I worked at an agency, we always did this.',
      'Your reorder rate is already the best in the category.',
      'Studies suggest bundles convert better.',
      'Data suggests people skim.',
      '3 new customers signed up.',
      'It is 3x faster.',
      'Churn rose after the relaunch.',
    ]) {
      expect(roomHit(line, ['Should we lead with the reorder rate?']), line).not.toBeNull();
      expect(sentenceHit(line, new Set()), line).not.toBeNull();
    }
  });

  it("says the owner's own figures and movements back (no non-sequitur after the owner gave the numbers)", () => {
    const owner = ['Our reorder rate went up nine points after the relaunch. Should we lead with it?'];
    for (const line of [
      'Since the reorder rate went up nine points, lead with it.',
      'A reorder rate that rose after the relaunch is your strongest proof.',
      'Yes, lead with it: it went up nine points after the relaunch.',
      'If it went up after the relaunch, lead with it.',
    ]) {
      expect(roomHit(line, owner), line).toBeNull();
      expect(sentenceHit(line, ownerFigures(owner), { owner: ownerContext(owner) }), line).toBeNull();
    }
    // A figure the owner never gave is still blocked.
    expect(roomHit('It went up 12 points after the relaunch, so lead with it.', owner)).toBe('figure');
    const g = guard(owner);
    expect(run(g, 'Since the reorder rate went up nine points, lead with it. Show the before and after.')).toBe('Since the reorder rate went up nine points, lead with it. Show the before and after.');
    expect(g.rewrites).toBe(0);
  });

  it('lets small counts, clock times, idioms, questions and conditions through', () => {
    for (const line of [
      'Two things matter here.',
      'Three questions before we decide.',
      'Top 3 things to fix first.',
      'Hang on, finishing a thought, back in ten seconds.',
      'Happy to meet at 10:30.',
      'Two quick thoughts.',
      'That idea fell by the wayside last year.',
      'Did it go up after the relaunch?',
      'Trust grows when you show your work.',
      'B2B buyers care about trust.',
      "Let's do a 1:1 first.",
      'Double down on the story.',
      'I remember you mentioned the relaunch.',
    ]) {
      expect(roomHit(line), line).toBeNull();
      expect(sentenceHit(line, new Set()), line).toBeNull();
    }
  });

  it('allows figures the owner said, and a hypothetical experience', () => {
    expect(run(guard(['Our churn is 4% and we have 30 deals in the pipe.']), 'At 4% churn, the 30 deals matter more.')).toBe('At 4% churn, the 30 deals matter more.');
    expect(sentenceHit('If we tested it last week, we would know.', new Set())).toBeNull();
    expect(roomHit('Since you tested it last spring, try a smaller pilot.', ['We tested it last spring and it flopped.'])).toBeNull();
  });

  it('replaces a work claim once, drops other offenders silently, and stops at two sentences', () => {
    const g = guard();
    const out = run(g, 'Our churn is 4% right now. Sales grew 30% last year. I finished the grid. We shipped it yesterday. Plain advice here.');
    expect(out).toBe(`${OFFER_LINE} Plain advice here.`);
    expect(g.rewrites).toBe(4);
    const three = guard();
    expect(run(three, 'One thought. Another thought. A third thought.')).toBe('One thought. Another thought. ');
    expect(three.full).toBe(true);
    // Only access or experience claims: the experience line, once.
    expect(run(guard(), 'I checked your dashboard this morning. I remember a client who tried that.')).toBe(EXPERIENCE_LINE);
  });

  it('in rooms, "we could…" is group advice; "I\'ll…" and past work are still claims', () => {
    expect(roomHit('We could start with a small pilot.')).toBeNull();
    expect(roomHit('We can build trust before we talk price.')).toBeNull();
    expect(roomHit('We should put the price up front.')).toBeNull();
    expect(roomHit("I'll draft it tonight.")).toBe('work');
    expect(roomHit('Let me pull that together.')).toBe('work');
    expect(roomHit('I just finished the competitor grid.')).toBe('work');
    expect(roomHit('We shipped it yesterday.')).toBe('work');
    // Quick chat keeps the strict reading.
    expect(sentenceHit('We could draft a plan.', new Set())).toBe('work');
  });

  it('drops the unfinished sentence of a reply cut by the deadline or the token cap', () => {
    const g = guard();
    expect(g.push('Start with the buyer. I would start with the')).toBe('Start with the buyer. ');
    expect(g.discard()).toBe('');
    const empty = guard();
    expect(empty.push('I would start with the')).toBe('');
    expect(empty.discard()).toBe('');
    const dropped = guard();
    expect(dropped.push('Our churn is 4% right now. I would')).toBe('');
    expect(dropped.discard()).toBe(FIGURE_LINE);
  });

  it('releases whole sentences only ("3.5" waits)', () => {
    const g = guard(['Is 3.5 too high?']);
    expect(g.push('It is 3.')).toBe('');
    expect(g.push('5 times higher')).toBe('');
    expect(g.push('. Fine. ')).toBe('It is 3.5 times higher. Fine. ');
  });

  it('uses the Chief’s own work line in rooms', () => {
    const g = new ReplyGuard({ allowedFigures: new Set(), workLine: CHIEF_ROOM_WORK_LINE, figureLine: FIGURE_LINE, maxSentences: 2 });
    expect(run(g, "I'll draft the plan tonight.")).toBe(CHIEF_ROOM_WORK_LINE);
  });
});

describe('the desk guard (quick chat)', () => {
  const text = (deltas: string[]): ModelEvent[] => [...deltas.map((d) => ({ type: 'text', delta: d }) as ModelEvent), { type: 'done', finish: 'stop' } as ModelEvent];

  it('rewrites an invented figure in a quick-chat reply, and keeps the owner’s own', async () => {
    useProviders({
      chat: {
        events: (req) =>
          isDesk(req) ? (JSON.stringify(req.messages).includes('12 weeks') ? text(['12 weeks is plenty. ', 'Start small.']) : text(['Then lead with the reorder rate: ', 'it went up nine points after the relaunch. ', 'Happy to talk it through.'])) : null,
      },
    });
    const s = await exprSetup();
    await s.api('POST', '/api/desk/tech-lead/say', { text: 'what should we lead with?', opId: 'op_g1' });
    await s.drain();
    const msg = (await s.ofType('talk.message')).at(-1)!;
    expect(msg.data.text).toBe('Happy to talk it through.');
    expect(s.liveOf('talk.delta').map((d) => d.data.delta).join('')).not.toMatch(/nine|reorder/);
    await s.api('POST', '/api/desk/tech-lead/say', { text: 'we have 12 weeks, enough?', opId: 'op_g2' });
    await s.drain();
    expect((await s.ofType('talk.message')).at(-1)!.data.text).toBe('12 weeks is plenty. Start small.');
  });
});
