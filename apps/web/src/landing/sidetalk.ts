// Demo side-talk for the landing page's portrait wall. Clearly labelled "Demo" on the page: in a real office,
// side-talk is derived from real hand-offs, asks and results (D5). Lines never name anyone themselves: `{b}` is
// filled with the other coworker's first name from the catalog at runtime.

export const DEMO_EXCHANGES: readonly (readonly [string, string])[] = [
  ['{b}, the outline is in your queue. Two charts need your eye.', 'On it. Notes back in ten.'],
  ['Quick one, {b}: which figures did the owner sign off on?', 'The March ones. I pinned them to the project.'],
  ['{b}, your headline options made me laugh. Number three!', 'Ha, that was the long shot. Glad it landed.'],
  ['Heads up, {b}: the client moved the deadline to Thursday.', 'Noted. I’ll re-plan and flag anything at risk.'],
  ['{b}, can you check my sources before this goes out?', 'Sure. Anything uncited gets an “unverified” badge.'],
  ['Handing the draft to you, {b}. Ready for review.', 'Got it. Notes, not rewrites. Promise.'],
  ['{b}, want a second pair of eyes on the budget sheet?', 'Yes please. It ties out, but I want a skeptic.'],
  ['Nice work on the research grid, {b}.', 'Thanks! The competitor column was the fun part.'],
];

export interface Exchange {
  a: number;
  b: number;
  line: string;
  reply: string;
}

/** A tiny deterministic PRNG (mulberry32): the demo is varied but reproducible in tests. */
export function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick the next exchange among `count` visible faces: two different people, neither of whom spoke in the last
 * round (when there are enough faces), and a line not used recently.
 */
export function nextExchange(count: number, names: readonly string[], random: () => number, recent: { people: number[]; lines: number[] }): Exchange | null {
  if (count < 2) return null;
  const pick = (avoid: number[]) => {
    const pool = [...Array(count).keys()].filter((i) => !avoid.includes(i));
    const from = pool.length ? pool : [...Array(count).keys()];
    return from[Math.floor(random() * from.length)]!;
  };
  const avoidPeople = count > 4 ? recent.people : [];
  const a = pick(avoidPeople);
  const b = pick([...avoidPeople, a]);
  if (a === b) return null;
  const linePool = [...DEMO_EXCHANGES.keys()].filter((i) => !recent.lines.includes(i));
  const li = (linePool.length ? linePool : [...DEMO_EXCHANGES.keys()])[Math.floor(random() * (linePool.length || DEMO_EXCHANGES.length))]!;
  const [line, reply] = DEMO_EXCHANGES[li]!;
  recent.people = [a, b];
  recent.lines = [...recent.lines, li].slice(-3);
  return { a, b, line: line.replaceAll('{b}', names[b] ?? 'there'), reply };
}
