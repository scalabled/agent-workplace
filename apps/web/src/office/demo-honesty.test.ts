// The office demo is the reference wiring others copy: its canned room and bubble
// lines speak from expertise only. No metric movement, no figures, no promises of work, so a line like "it went up
// nine points after the relaunch" or "I can have the one-pager by tomorrow noon" can never be copied into the app.
import main from '../../../../packages/office/demo/main.ts?raw';
import samples from '../../../../packages/office/demo/sample-lines.ts?raw';
import { describe, expect, it } from 'vitest';

/** Every quoted string in a source file. */
const strings = (src: string) => [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1] ?? m[2] ?? '');

const BANNED: [string, RegExp][] = [
  ['metric movement', /\b(went|goes|go) (up|down)\b|\b(rose|fell|doubled|tripled|halved|spiked|jumped)\b/i],
  ['points after', /\bpoints? after\b/i],
  ['a figure', /\b\d+(\.\d+)?\s?(%|percent|points?)\b/i],
  ['a number word', /\b(nine|eight|seven|six|five) points\b/i],
  ['a promise of work', /\b(I can have|I['’]?ll (draft|send|have|get|write)|by tomorrow|by (monday|friday|noon|end of day))\b/i],
  ['a result claim', /\bprices are in\b/i],
];

const offending = (src: string) =>
  strings(src)
    .filter((s) => /\s/.test(s) && /[a-z]/i.test(s))
    .flatMap((s) => BANNED.filter(([, re]) => re.test(s)).map(([what]) => `${what}: "${s}"`));

describe('the office demo’s canned lines', () => {
  it('carry no figures, metric claims or promises of work', () => {
    expect(offending(main)).toEqual([]);
    expect(offending(samples)).toEqual([]);
  });

  it('would catch the lines it used to have', () => {
    expect(offending("x('Then lead with the reorder rate: it went up nine points after the relaunch.')")).not.toEqual([]);
    expect(offending("x('I can have the one-pager with both numbers by tomorrow noon.')")).not.toEqual([]);
    expect(offending("x('Supplier prices are in. Two of three went up; I’ll draft the reply.')")).not.toEqual([]);
  });
});
