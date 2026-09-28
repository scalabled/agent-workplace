import { slimIndex } from '@headcount/catalog/slim';
import type { MatchQuiz } from '@headcount/catalog';
import { describe, expect, it } from 'vitest';
import { BUILTIN_QUESTIONS, builtinQuiz, builtinWhy, closeness, firstSentence, topMatches } from './quiz';

const leads = slimIndex.catalog.leads;

describe('built-in match quiz', () => {
  const quiz = builtinQuiz(leads);

  it('has four single-choice questions with integer weights in −3…3 for every lead', () => {
    expect(quiz.questions).toHaveLength(4);
    for (const q of quiz.questions) {
      expect(q.kind).toBe('single');
      for (const o of q.options ?? []) {
        expect(Object.keys(o.weights).sort()).toEqual(leads.map((l) => l.id).sort());
        for (const w of Object.values(o.weights)) {
          expect(Number.isInteger(w)).toBe(true);
          expect(Math.abs(w)).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('ranks the top three distinct leads with a reason each', () => {
    const top = topMatches(quiz, { 'bad-news': 'straight', pace: 'fast', 'check-ins': 'rarely', humour: 'welcome' }, leads, true);
    expect(top.map((m) => m.rank)).toEqual([1, 2, 3]);
    expect(new Set(top.map((m) => m.lead.id)).size).toBe(3);
    for (const m of top) expect(m.why.length).toBeGreaterThan(20);
  });

  it('reaches most leads as the top match across all answer combinations', () => {
    const tops = new Set<string>();
    const [a, b, c, d] = BUILTIN_QUESTIONS;
    for (const o1 of a!.options) for (const o2 of b!.options) for (const o3 of c!.options) for (const o4 of d!.options)
      tops.add(topMatches(quiz, { [a!.id]: o1.id, [b!.id]: o2.id, [c!.id]: o3.id, [d!.id]: o4.id }, leads, true, 1)[0]!.lead.id);
    expect(tops.size).toBeGreaterThanOrEqual(Math.min(8, leads.length));
  });

  it('writes "why you two will get along" from the answer that fits best', () => {
    const operator = leads.find((l) => l.id === 'lead-steady-operator') ?? leads[0]!;
    const why = builtinWhy(operator, { 'check-ins': 'daily' });
    expect(why).toMatch(/^You like a short daily rhythm\. (His|Her|Their) way: /);
    expect(closeness(operator, { directness: operator.personality.sliders.directness })).toBe(3);
  });

  it('prefers the catalog quiz result copy when present', () => {
    const catalogQuiz: MatchQuiz = {
      ...quiz,
      results: { [leads[0]!.id]: { headline: 'Your steady hand', why_you_match: 'You both like a plan.' } },
    };
    const weights = Object.fromEntries(leads.map((l, i) => [l.id, i === 0 ? 3 : 0]));
    catalogQuiz.questions = [{ id: 'q', prompt: 'p', kind: 'single', options: [{ id: 'o', label: 'l', weights }] }];
    const [top] = topMatches(catalogQuiz, { q: 'o' }, leads, false);
    expect(top).toMatchObject({ headline: 'Your steady hand', why: 'You both like a plan.' });
  });

  it('trims long first sentences at a word boundary', () => {
    expect(firstSentence('Short one. Second.')).toBe('Short one.');
    const long = firstSentence(`${'word '.repeat(60)}end.`, 40);
    expect(long.length).toBeLessThanOrEqual(41);
    expect(long.endsWith('…')).toBe(true);
  });
});
