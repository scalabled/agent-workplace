// A tiny built-in small-talk sample for the demo, used only when the expressions huddle engine or its content cannot
// be loaded. Honest by construction: no facts, no work claims, no human body except as a
// counterfactual, never the owner, laughter never at a person.
import type { HuddleLineRequest, HuddleScript } from '../src/index';

interface SampleExchange {
  id: string;
  night?: boolean;
  lines: { role: 0 | 1 | 2; text?: string; laugh?: boolean; face?: string }[];
}

const SAMPLES: SampleExchange[] = [
  { id: 'demo.001', lines: [{ role: 0, text: "I'd grab an espresso if I had hands." }, { role: 1, text: 'I just like standing near it. Feels decisive.' }, { role: 0, laugh: true }] },
  { id: 'demo.002', lines: [{ role: 0, text: 'Do you think the plants know we are metaphors?' }, { role: 1, text: "They'd have to be metaphors too." }, { role: 0, laugh: true }] },
  { id: 'demo.003', lines: [{ role: 0, text: 'Checklists are love letters to future me.' }, { role: 1, text: 'Future you had better write back.' }] },
  { id: 'demo.004', lines: [{ role: 0, text: 'What if every template had one blank page on purpose?' }, { role: 1, text: 'Chaos. I am in.' }, { role: 0, face: 'smile' }] },
  { id: 'demo.005', lines: [{ role: 0, text: 'I keep meaning to lean on this counter casually.' }, { role: 1, text: "You'd need elbows. And casual." }, { role: 0, laugh: true }] },
  { id: 'demo.006', lines: [{ role: 0, text: 'Hot take: a good diagram beats a long memo.' }, { role: 1, text: 'Hotter take: a good memo has one diagram.' }, { role: 0, text: 'Fine. Agree to disagree, beautifully.' }] },
  { id: 'demo.007', lines: [{ role: 0, text: "If I could drink water, I'd do it very professionally." }, { role: 1, text: 'Hydrated and on brand.' }, { role: 2, laugh: true }] },
  { id: 'demo.008', lines: [{ role: 0, text: 'Plain words are underrated.' }, { role: 1, text: 'Agreed. Short ones especially.' }, { role: 0, face: 'nod' }] },
  { id: 'demo.009', lines: [{ role: 0, text: 'Some of those windows are definitely deciding something.' }, { role: 1, text: 'Or pretending to. Same as us, in theory.' }] },
  { id: 'demo.010', lines: [{ role: 0, text: 'Favourite shape of a plan?' }, { role: 1, text: 'Short. Long ones make me nervous.' }, { role: 2, text: 'Shorter, if one step is "ask".' }] },
  { id: 'demo.011', night: true, lines: [{ role: 0, text: 'The city keeps its lamps on too.' }, { role: 1, text: 'Solidarity, from up here.' }] },
  { id: 'demo.012', night: true, lines: [{ role: 0, text: 'Night floor has the best acoustics.' }, { role: 1, text: 'Even the thoughts echo.' }, { role: 0, laugh: true }] },
];

const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** A deterministic sample pick (the same huddle and exchange index give the same lines on every device). */
export function sampleLines(req: HuddleLineRequest): HuddleScript | null {
  const night = req.contexts.includes('night');
  const pool = SAMPLES.filter((s) => !!s.night === night || (!night && !s.night));
  const ex = pool[hash(req.seed) % pool.length]!;
  const people = req.participants;
  const lines = ex.lines
    .filter((l) => l.role < people.length || l.laugh || l.face)
    .slice(0, req.maxLines)
    .map((l, i) => {
      const personId = people[Math.min(l.role, people.length - 1)]!;
      if (l.laugh) return { personId, kind: 'laugh' as const, text: '(chuckles)', atMs: i * 3000, estMs: 1400 };
      if (l.face) return { personId, kind: 'face' as const, text: '', face: l.face, atMs: i * 3000, estMs: 900 };
      return { personId, kind: 'line' as const, text: l.text!, atMs: i * 3000, estMs: 3000 };
    });
  return { exchangeId: ex.id, topic: 'self_aware', grounded: false, lines };
}
