import { describe, expect, it } from 'vitest';
import { estimateTokens, findSentenceEnd, lastClauseBoundary, SentenceChunker, splitAtClauses } from './chunker';

function chunks(deltas: string[], opts: Partial<ConstructorParameters<typeof SentenceChunker>[0]> = {}, flush = true) {
  const out: string[] = [];
  const c = new SentenceChunker({ ...opts, onChunk: (s) => out.push(s) });
  for (const d of deltas) c.push(d);
  if (flush) c.flush();
  return out;
}

describe('SentenceChunker', () => {
  // Ported from personagram-ai tests/streaming.test.ts
  it('emits complete sentences and flushes trailing text', () => {
    expect(chunks(['Hello world.', ' How are you?'], { maxTokens: 80 })).toEqual(['Hello world.', 'How are you?']);
  });

  it('releases the first sentence the moment it completes, across token-sized deltas', () => {
    const out: string[] = [];
    const c = new SentenceChunker({ onChunk: (s) => out.push(s) });
    for (const d of ['I', ' started', ' it.', ' Pax', ' will', ' have']) c.push(d);
    expect(out).toEqual(['I started it.']); // no flush needed: first audio can start now
    c.push(' a first grid soon.');
    c.flush();
    expect(out).toEqual(['I started it.', 'Pax will have a first grid soon.']);
  });

  it('needs whitespace after the mark (decimals and domains do not end a sentence)', () => {
    expect(chunks(['It costs 3.50 today and example.com is up. Next'], {}, false)).toEqual(['It costs 3.50 today and example.com is up.']);
  });

  it('does not split on abbreviations or initials', () => {
    expect(chunks(['Dr. Lee met J. Smith, e.g. on Monday. Then left.'])).toEqual(['Dr. Lee met J. Smith, e.g. on Monday.', 'Then left.']);
  });

  it('keeps closing quotes and brackets with their sentence', () => {
    expect(chunks(['She said "done." (Really!) OK then, that is all.'])).toEqual(['She said "done."', '(Really!) OK then, that is all.']);
  });

  it('treats a newline as a boundary (lists, paragraphs)', () => {
    expect(chunks(['Three things\n- the first one is long enough\n- the second one is long enough'])).toEqual([
      'Three things',
      '- the first one is long enough',
      '- the second one is long enough',
    ]);
  });

  it('merges short sentences after the first', () => {
    expect(chunks(['Sure. Yes. No. Maybe so. That is the long one here.'])).toEqual(['Sure.', 'Yes. No. Maybe so. That is the long one here.']);
    expect(chunks(['Sure. Yes, that sentence is long enough. Ok.'])).toEqual(['Sure.', 'Yes, that sentence is long enough.', 'Ok.']);
  });

  it('releases a long first sentence at a clause boundary once it passes 60 characters', () => {
    const out = chunks(['I looked at the three suppliers you sent over this morning, and the cheapest one'], {}, false);
    expect(out).toEqual(['I looked at the three suppliers you sent over this morning,']);
  });

  it('does not release clauses early after the first chunk', () => {
    const out = chunks(['Done. I looked at the three suppliers you sent over this morning, and the cheapest one'], {}, false);
    expect(out).toEqual(['Done.']);
  });

  it('splits an over-long sentence at clauses, never inside a word', () => {
    const long = Array.from({ length: 12 }, (_, i) => `clause number ${i} goes here`).join(', ') + '.';
    const out = chunks([long], { maxTokens: 30 });
    expect(out.length).toBeGreaterThan(1);
    for (const piece of out) expect(estimateTokens(piece)).toBeLessThanOrEqual(30);
    expect(out.join(' ').replace(/\s+/g, ' ')).toBe(long);
  });

  it('flush is idempotent and reset drops buffered text', () => {
    const out: string[] = [];
    const c = new SentenceChunker({ onChunk: (s) => out.push(s) });
    c.push('Partial thought');
    c.reset();
    c.flush();
    c.flush();
    expect(out).toEqual([]);
    expect(c.chunksEmitted).toBe(0);
  });
});

describe('chunker helpers', () => {
  it('findSentenceEnd', () => {
    expect(findSentenceEnd('Hi there. Next')).toBe(9);
    expect(findSentenceEnd('No end yet')).toBe(-1);
    expect(findSentenceEnd('Wait… what')).toBe(5);
    expect(findSentenceEnd('Mr. Smith')).toBe(-1);
  });

  it('lastClauseBoundary ignores cuts in the first 12 characters', () => {
    expect(lastClauseBoundary('Ok, so the plan is this, then that')).toBe(24);
    expect(lastClauseBoundary('Ok, fine')).toBe(-1);
  });

  it('splitAtClauses falls back to whitespace', () => {
    const pieces = splitAtClauses('word '.repeat(40).trim(), 10);
    expect(pieces.every((p) => estimateTokens(p) <= 10)).toBe(true);
  });

  it('estimateTokens errs high', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello world')).toBe(4);
  });
});
