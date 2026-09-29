// Floor control for rooms and joined huddles (docs/dev/OFFICE-PHASE2.md §4.2.3): who answers an owner message, in
// what order, and whether the Chief wraps up. Pure and deterministic, so the same meeting always plans the same way.
import type { AffectCues } from '@headcount/expressions';
import { CHIEF_ID } from '@headcount/protocol';
import { ROOM_LIMITS, type FloorMode, type RoomKind } from '@headcount/protocol/ext/rooms';

export interface FloorCandidate {
  agentId: string;
  firstName: string;
  fullName: string;
  isChief: boolean;
  /** Index in `participants`: the scene's seat order from the owner's left. */
  seat: number;
  title: string;
  departmentName: string;
  skillNames: string[];
  oneLiner: string;
}

export interface FloorInput {
  text: string;
  kind: RoomKind;
  candidates: FloorCandidate[];
  phatic: boolean;
  /** The previous turn's first responder in this meeting. */
  lastFirst: string | null;
  /** Replies so far this meeting, per agent. */
  turnsBy: Record<string, number>;
}

export interface FloorPlan {
  order: string[];
  mode: FloorMode;
  chiefWrap: boolean;
}

/** A phatic owner turn ("thanks", "hi everyone"): answered from the catalog (no distress, no sincere-AI question). */
export const isPhatic = (c: AffectCues): boolean => c.phatic && !c.distress && !c.sincereAi;

/** Plural cues: the whole table is asked, whoever else is named. */
const GROUP_RE =
  /\b(everyone|everybody|all of you|you all|y'all|each of you|team|folks|anyone|any of you|go around|round the table|what do you all think|you two|you three|you both|both of you|the two of you|the three of you|you guys)\b/i;
/** Cues that ask the table only when nobody is named ("Juno, what do you think?" asks Juno). */
const OPEN_RE = /\b(what do you think|thoughts)\b/i;
/** A phatic line to the whole group ("hi all", "thanks everyone"). */
const PHATIC_GROUP_RE = /\b(all|guys|everyone|everybody|folks|team|y'all|you two|you three|you both|both of you)\b/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const straighten = (s: string) => s.replace(/[‘’ʼ`´]/g, "'");

/** Where a candidate is first addressed in the text, or -1. */
export function mentionAt(text: string, c: Pick<FloorCandidate, 'firstName' | 'fullName'>): number {
  const s = straighten(text);
  const first = c.firstName.trim();
  if (!first) return -1;
  const after = '(?![\\p{L}\\p{N}])';
  const before = '(?<![\\p{L}\\p{N}@])';
  let best = -1;
  const take = (i: number) => {
    if (i >= 0 && (best < 0 || i < best)) best = i;
  };
  // @First, any case.
  take(s.search(new RegExp(`@${escapeRe(first)}${after}`, 'iu')));
  // The full name, any case.
  if (c.fullName.trim() && c.fullName.trim() !== first) take(s.search(new RegExp(`${before}${escapeRe(c.fullName.trim())}${after}`, 'iu')));
  // The first name as a capitalised whole word; at a sentence's start only when it is plainly an address, a comma
  // following ("Hope, what do you think?") or a list of names ("Lena and Walt, …"), or a question ("Juno?"): several
  // first names are ordinary words ("Hope this helps").
  const re = new RegExp(`${before}${escapeRe(first)}${after}`, 'gu');
  for (const m of s.matchAll(re)) {
    const i = m.index ?? 0;
    const head = s.slice(0, i).replace(/["'“”‘’(\[\s]+$/u, '');
    const sentenceStart = head === '' || /[.!?…:;]$/.test(head);
    if (sentenceStart && !/^(?:\s*[,?]|\s+(?:and|&)\s+\p{Lu})/u.test(s.slice(i + m[0].length))) continue;
    take(i);
    break;
  }
  return best;
}

const STOPWORDS = new Set(
  (
    'the a an and or but if then so of to in on at by for with from about into over under as is are was were be been being am do does did done ' +
    'have has had having i me my we our us you your yours they them their he she it its this that these those there here what which who whom ' +
    'how why when where all any each every some such no not nor only own same than too very can could should would will shall may might must ' +
    'just also more most other again further once both few many much lot lots get got make made want need think know like really thing things ' +
    'good great yes okay ok please thanks thank hi hello hey let lets way well still even ever any anyone everyone everybody team folks'
  ).split(/\s+/),
);

/** Relevance tokens: lowercase words without stopwords, light suffix stripping, three characters or more. */
export function relevanceTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of straighten(text).toLowerCase().match(/\p{L}[\p{L}'-]*/gu) ?? []) {
    const w = raw.replace(/'s$/, '').replace(/'/g, '');
    if (STOPWORDS.has(w)) continue;
    for (const part of w.split('-')) {
      const t = stem(part);
      if (t.length >= 3 && !STOPWORDS.has(part)) out.add(t);
    }
  }
  return out;
}

/** Trailing s / es / ing / ed stripped (and a final e, so "price", "prices", "pricing" and "priced" meet). */
function stem(w: string): string {
  let s = w;
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && /(ss|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

/** Title × 3, department × 2, skill names × 1.5, one-liner × 1, summed over the text's tokens. */
export function relevanceScore(tokens: ReadonlySet<string>, c: FloorCandidate): number {
  if (!tokens.size) return 0;
  const fields: [Set<string>, number][] = [
    [relevanceTokens(c.title), 3],
    [relevanceTokens(c.departmentName), 2],
    [relevanceTokens(c.skillNames.join(' ')), 1.5],
    [relevanceTokens(c.oneLiner), 1],
  ];
  let score = 0;
  for (const t of tokens) for (const [set, w] of fields) if (set.has(t)) score += w;
  return score;
}

/**
 * Plan who answers (rules in order): mentions first, in the order named; a group cue fills up to the cap after them;
 * a phatic turn gets up to two catalog replies; otherwise relevance picks the top scorer plus anyone at ≥ 35 % of
 * the top (at least 1), or two (huddle: one) by rotation when nothing matches. The cap is 3 (huddle 2). Rotation
 * breaks ties: seat order starting after the previous turn's first responder, then stably by fewer replies so far,
 * so no one always goes first. The Chief answers only when named or alone; in a conference with at least two other
 * responders a planned Chief wrap-up comes last (it is said only if two others actually spoke).
 */
export function planFloor(i: FloorInput): FloorPlan {
  const cap = ROOM_LIMITS[i.kind].responders;
  const all = [...i.candidates].sort((a, b) => a.seat - b.seat);
  const n = all.reduce((m, c) => Math.max(m, c.seat + 1), 0);
  const chief = all.find((c) => c.isChief || c.agentId === CHIEF_ID) ?? null;
  const others = all.filter((c) => c !== chief);

  // Rotation: seat order starting after lastFirst, then (stable) fewer replies this meeting.
  const lastSeat = i.lastFirst ? all.find((c) => c.agentId === i.lastFirst)?.seat ?? -1 : -1;
  const rot = (c: FloorCandidate) => (n ? (c.seat - (lastSeat + 1) + n) % n : c.seat);
  const byRotation = (a: FloorCandidate, b: FloorCandidate) => (i.turnsBy[a.agentId] ?? 0) - (i.turnsBy[b.agentId] ?? 0) || rot(a) - rot(b);

  // 1. Mentions, in the order named (the Chief included).
  const mentioned = all
    .map((c) => ({ c, at: mentionAt(i.text, c) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at || byRotation(a.c, b.c))
    .map((m) => m.c);
  const text = straighten(i.text);
  const group = GROUP_RE.test(text) || (!mentioned.length && OPEN_RE.test(text));
  // The Chief is in the pool only when named or when nobody else is here.
  const pool = others.length ? others : chief ? [chief] : [];
  const tokens = relevanceTokens(i.text);
  const scored = pool.map((c) => ({ c, score: relevanceScore(tokens, c) }));
  const byRelevance = [...scored].sort((a, b) => b.score - a.score || byRotation(a.c, b.c));

  let order: FloorCandidate[];
  let mode: FloorMode;
  if (i.phatic) {
    mode = 'phatic';
    const toAll = group || PHATIC_GROUP_RE.test(text);
    const want = mentioned.length ? Math.min(mentioned.length, 2) : i.kind === 'huddle' && !toAll ? 1 : 2;
    order = (mentioned.length ? mentioned : [...pool].sort(byRotation)).slice(0, Math.min(want, cap));
  } else if (mentioned.length && !group) {
    mode = 'mention';
    order = mentioned.slice(0, cap);
  } else if (group) {
    mode = 'group';
    order = [...mentioned];
    for (const { c } of byRelevance) if (order.length < cap && !order.includes(c)) order.push(c);
    order = order.slice(0, cap);
  } else {
    mode = 'relevance';
    const top = byRelevance[0]?.score ?? 0;
    if (top <= 0) order = [...pool].sort(byRotation).slice(0, Math.min(i.kind === 'huddle' ? 1 : 2, cap));
    else {
      const bar = Math.max(1, 0.35 * top);
      order = byRelevance.filter((s, k) => k === 0 || s.score >= bar).map((s) => s.c).slice(0, cap);
    }
  }

  const ids = order.map((c) => c.agentId);
  const others2 = order.filter((c) => c !== chief).length;
  const chiefWrap = !!chief && ROOM_LIMITS[i.kind].chiefWrap && mode !== 'phatic' && !ids.includes(chief.agentId) && others2 >= 2;
  if (chiefWrap) ids.push(chief!.agentId);
  return { order: ids, mode, chiefWrap };
}
