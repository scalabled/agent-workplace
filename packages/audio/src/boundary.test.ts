// stopAtBoundary() on a long chunk (LIVING-WORKFORCE §2.3): the answer ends at the sentence playing, within 4 s, not
// at the end of a chunk of up to 120 tokens.
import { describe, expect, it } from 'vitest';
import { BOUNDARY_MAX_S, boundaryCutAt, chunkStops } from './engine';

describe('where a boundary stop ends a sounding chunk', () => {
  const text = 'Confirm quantities and lock POs. Then we book the carrier, and I will send you the numbers by Friday.';

  it('finds sentence and clause ends from the character alignment, else from the text', () => {
    const chars = Array.from(text);
    const aligned = chunkStops(text, { chars, startsMs: chars.map((_, i) => i * 50), endsMs: chars.map((_, i) => (i + 1) * 50) }, chars.length * 0.05);
    const sentence = aligned.find((s) => s.kind === 's')!;
    expect(sentence.at).toBeCloseTo((text.indexOf('.') + 1) * 0.05, 5);
    expect(aligned.some((s) => s.kind === 'c')).toBe(true);
    const timed = chunkStops(text, null, 10);
    expect(timed.find((s) => s.kind === 's')!.at).toBeCloseTo(((text.indexOf('.') + 1) / text.length) * 10, 5);
  });

  it('ends at the next sentence end within 4 s, else a clause, else 4 s from now; lets a short rest finish', () => {
    const stops = chunkStops(text, null, 10);
    const firstSentence = stops.find((s) => s.kind === 's')!.at;
    expect(boundaryCutAt(stops, 0.5, 10)).toBeCloseTo(firstSentence + 0.08, 5);
    // Past the first sentence and more than 4 s from the next end: a clause end inside the window.
    const afterFirst = firstSentence + 0.1;
    const cut = boundaryCutAt(stops, afterFirst, 10)!;
    expect(cut - afterFirst).toBeLessThanOrEqual(BOUNDARY_MAX_S + 0.1);
    // Near the end of the chunk: it just finishes.
    expect(boundaryCutAt(stops, 7, 10)).toBeNull();
    // No sentence or clause at all in a long stretch: a fade 4 s from now at most.
    expect(boundaryCutAt([], 1, 20)).toBeCloseTo(1 + BOUNDARY_MAX_S, 5);
  });
});
