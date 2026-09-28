// Owner affect (§3.3): a deterministic sniffer (< 1 ms) so reflexes can react before any model has read
// the turn, plus the optional `⟦react:…⟧` hint the conversation layer may open its reply with.
import type { AffectCues, AffectLexicon, IntentsFile, ReactHint } from './types';
import type { IntentId } from './vocab';

const BASE: Readonly<Record<string, number>> = {
  request: 0.6, humor: 0.7, gratitude: 0.8, praise: 0.7, farewell: 0.7, greeting: 0.7, good_news: 0.6, bad_news: 0.6,
  frustration: 0.5, correction: 0.75, doubt: 0.6, stop_or_steer: 0.6,
};
const EXCLAIM = new Set(['humor', 'gratitude', 'praise', 'good_news', 'bad_news', 'frustration', 'greeting']);
const NEGATABLE = new Set(['humor', 'praise', 'good_news', 'gratitude', 'bad_news', 'frustration', 'doubt', 'self_doubt', 'distress']);
const NEGATORS = new Set(['not', 'no', 'never', "isn't", "wasn't", "don't", "didn't", "doesn't", "aren't", "won't", "hardly", 'nothing', 'without']);
const EXTRA_HUMOR = ['funny', 'hilarious'];
const LAUGH_TOKEN = /(?<![\p{L}\p{N}])(?:a?(?:ha){2,}h?|he(?:he)+|lo+l|lmf?ao+|rofl|ha\s?ha)(?![\p{L}\p{N}])/giu;
const QUESTION_START = /^(what|why|how|when|where|who|whom|which|can|could|would|should|is|are|am|do|does|did|will|shall|have|has|may|might)\b/i;
const IMPERATIVE = new Set(['draft', 'write', 'find', 'check', 'make', 'build', 'pull', 'prepare', 'send', 'schedule', 'research', 'compare', 'summarise', 'summarize', 'fix', 'update', 'look', 'get', 'put', 'set', 'book', 'call', 'plan', 'review', 'list', 'create', 'add']);
const FILLERS = new Set([
  'ok', 'okay', 'so', 'well', 'then', 'and', 'you', 'too', 'all', 'for', 'now', 'again', 'very', 'much', 'the', 'a', 'that',
  'this', 'it', 'guys', 'team', 'everyone', 'mate', 'really', 'just', 'oh', 'ah', 'great', 'cool', 'nice', 'alright',
  'right', 'lot', 'lots', 'today', 'tonight', 'tomorrow', 'soon', 'have', 'good', 'one', 'day', 'there', 'everybody', 'x', 'xx', 'folks',
]);
const ENTITY_LEAD = new Set(['for', 'the', 'on', 'about', 'with', 'to', 'from', 'at', 'in', 'of', 'my', 'our', 'your', 'their']);
/** Built-in forms of the sincere "are you an AI?" question, on top of the lexicon (H6 errs on the side of honesty). */
const SINCERE_AI_RE = [
  /\b(?:are|r)\s+(?:you|u)\s+(?:a\s+|an\s+|actually\s+|really\s+)*(?:real|human|ai|a\.i\.|bot|robot|person|machine|program)\b/i,
  /\bam\s+i\s+(?:talking|speaking|chatting)\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:real\s+)?(?:person|human|bot|robot|ai|machine)\b/i,
  /\bis\s+(?:this|that)\s+(?:a\s+|an\s+)?(?:real\s+)?(?:person|human|bot|robot|ai)\b/i,
];

const phraseRes = new Map<string, RegExp>();
function phraseRe(phrase: string): RegExp {
  let re = phraseRes.get(phrase);
  if (!re) {
    const p = phrase.toLowerCase().trim();
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const wordy = /^[\p{L}\p{N}]/u.test(p);
    const tail = /[\p{L}\p{N}]$/u.test(p);
    re = new RegExp(`${wordy ? "(?<![\\p{L}\\p{N}'])" : ''}${esc}${tail ? '(?![\\p{L}\\p{N}])' : ''}`, 'giu');
    phraseRes.set(phrase, re);
  }
  re.lastIndex = 0;
  return re;
}

interface Hit { start: number; end: number }

function matches(text: string, phrases: readonly string[], negatable: boolean): Hit[] {
  const hits: Hit[] = [];
  for (const phrase of phrases) {
    if (!phrase) continue;
    const re = phraseRe(phrase);
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      if (negatable) {
        const before = text.slice(Math.max(0, start - 24), start).trim().split(/\s+/).slice(-2);
        if (before.some((w) => NEGATORS.has(w.replace(/[^\p{L}']/gu, '')))) continue;
      }
      hits.push({ start, end: start + m[0].length });
    }
  }
  // Overlapping phrases ("thank you" and "thank") count once.
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Hit[] = [];
  for (const h of hits) if (!out.length || h.start >= out[out.length - 1]!.end) out.push(h);
  return out;
}

const score = (key: string, n: number, exclaim: boolean): number =>
  n <= 0 ? 0 : Math.min(1, (BASE[key] ?? 0.6) + 0.2 * (n - 1) + (exclaim && EXCLAIM.has(key) ? 0.15 : 0));

/** Words that make a distress phrase personal (E11): the owner or someone close to them, not a topic of work. */
const PERSONAL = new Set([
  'i', "i'm", 'im', "i've", 'ive', "i'd", 'me', 'my', 'mine', 'myself', 'we', "we're", "we've", 'our', 'ours', 'us',
  'you', 'your', "you're", 'yours', 'mum', 'mom', 'dad', 'mother', 'father', 'wife', 'husband', 'partner', 'son',
  'daughter', 'brother', 'sister', 'family', 'grandma', 'grandad', 'grandpa', 'granny', 'nan', 'friend', 'kid', 'kids', 'baby',
]);
const PROXIMITY_CHARS = 48;

/** Hits not covered by any of the `not` phrases (E10 "no kidding", E11 "happy accident"). */
function outside(hits: Hit[], nots: Hit[]): Hit[] {
  return nots.length ? hits.filter((h) => !nots.some((n) => n.start <= h.start && n.end >= h.end)) : hits;
}

/** A distress hit counts only near a first- or second-person word or a family word (E11). */
function personal(t: string, h: Hit): boolean {
  const around = t.slice(Math.max(0, h.start - PROXIMITY_CHARS), Math.min(t.length, h.end + PROXIMITY_CHARS));
  return around.split(/\s+/).some((w) => PERSONAL.has(w.replace(/[^\p{L}']/gu, '')));
}

/** Score the owner's turn for reaction cues (§3.3). Whole-word, case-insensitive, with simple negation. */
export function sniffOwnerText(text: string, lexicon: AffectLexicon): AffectCues {
  const raw = String(text ?? '');
  const t = raw.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  const exclaim = /!/.test(t);
  const lex = (k: string): readonly string[] => lexicon[k] ?? [];
  const hitsFor = (k: string, extra: readonly string[] = []) => matches(t, [...lex(k), ...extra], NEGATABLE.has(k));

  const all = new Map<string, Hit[]>();
  for (const k of ['request', 'humor', 'gratitude', 'praise', 'farewell', 'greeting', 'good_news', 'bad_news', 'frustration', 'correction', 'doubt', 'stop_or_steer', 'self_doubt']) {
    all.set(k, hitsFor(k, k === 'humor' ? EXTRA_HUMOR : []));
  }
  const laughs = [...t.matchAll(LAUGH_TOKEN)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  if (laughs.length) all.set('humor', [...all.get('humor')!, ...laughs.filter((l) => !all.get('humor')!.some((h) => h.start <= l.start && h.end >= l.end))]);
  // "No kidding" and "are you kidding me" are not jokes (E10).
  all.set('humor', outside(all.get('humor')!, matches(t, lex('not_humor'), false)));

  const words = t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const first = words[0]?.replace(/[^\p{L}']/gu, '') ?? '';
  let request = score('request', all.get('request')!.length, exclaim);
  if (request > 0 && IMPERATIVE.has(first)) request = Math.min(1, request + 0.2);
  else if (!request && IMPERATIVE.has(first) && words.length >= 3) request = 0.6;
  let correction = score('correction', all.get('correction')!.length, exclaim);
  if (/^no[,.!]|^nope\b|^wrong\b/.test(t)) correction = Math.max(correction, 0.8);
  const question = /\?/.test(t) || QUESTION_START.test(t);
  // Distress (E11): personal, and not a work topic ("crisis comms plan", "happy accident", "planning layoffs").
  const distress = outside(matches(t, lex('distress'), true), matches(t, lex('distress_not'), false)).some((h) => personal(t, h));
  const sincereAi = matches(t, lex('sincere_ai'), false).length > 0 || SINCERE_AI_RE.some((re) => re.test(t));

  const cues: AffectCues = {
    request,
    question,
    humor: score('humor', all.get('humor')!.length, exclaim),
    gratitude: score('gratitude', all.get('gratitude')!.length, exclaim),
    praise: score('praise', all.get('praise')!.length, exclaim),
    farewell: score('farewell', all.get('farewell')!.length, exclaim),
    greeting: score('greeting', all.get('greeting')!.length, exclaim),
    goodNews: score('good_news', all.get('good_news')!.length, exclaim),
    badNews: score('bad_news', all.get('bad_news')!.length, exclaim),
    frustration: score('frustration', all.get('frustration')!.length, exclaim),
    distress,
    correction,
    doubt: score('doubt', all.get('doubt')!.length, exclaim),
    stopOrSteer: score('stop_or_steer', all.get('stop_or_steer')!.length, exclaim),
    sincereAi,
    phatic: false,
    words: words.length,
    selfDoubt: score('self_doubt', all.get('self_doubt')!.length, exclaim),
  };

  // Phatic: short, no question, no request, no entity, dominated by thanks/praise/hello/bye (§3.3).
  const phaticKeys = ['gratitude', 'praise', 'greeting', 'farewell'];
  const covered = new Set<number>();
  for (const k of phaticKeys) for (const h of all.get(k)!) for (let i = h.start; i < h.end; i++) covered.add(i);
  let content = 0;
  let pos = 0;
  const rawTokens = raw.replace(/\s+/g, ' ').trim().split(' ');
  let entity = false;
  const lowTokens = t.split(' ');
  for (let i = 0; i < lowTokens.length; i++) {
    const tok = lowTokens[i]!;
    const start = t.indexOf(tok, pos);
    pos = start + tok.length;
    const bare = tok.replace(/[^\p{L}\p{N}']/gu, '');
    if (!bare) continue;
    const inPhrase = start >= 0 && covered.has(start);
    const orig = rawTokens[i] ?? '';
    const prev = (lowTokens[i - 1] ?? '').replace(/[^\p{L}']/gu, '');
    if (i > 0 && /^[A-Z][\p{L}'-]*/u.test(orig) && bare !== 'i' && ENTITY_LEAD.has(prev)) entity = true;
    if (inPhrase || FILLERS.has(bare)) continue;
    if (i > 0 && /^[A-Z]/.test(orig) && !/^i('|$)/.test(bare) && !ENTITY_LEAD.has(prev)) continue; // a name used to address someone
    content++;
  }
  const dominant = Math.max(cues.gratitude, cues.praise, cues.greeting, cues.farewell) >= 0.6;
  const clean = !cues.distress && !cues.sincereAi && cues.badNews === 0 && cues.frustration === 0 && cues.correction === 0 && cues.doubt === 0 && cues.selfDoubt === 0 && cues.stopOrSteer === 0 && cues.request === 0;
  const maxWords = 6;
  cues.phatic = dominant && clean && !question && !entity && cues.words <= maxWords && content <= 1;
  return cues;
}

const HINTS = new Set<ReactHint>(['laugh', 'surprise', 'delight', 'concern', 'sympathy', 'encouragement', 'apology', 'none']);
const HINT_RE = /^\s*(?:⟦|\[\[)\s*react\s*:\s*([a-z_]*)\s*(?:⟧|\]\])[ \t]*/i;

/** Longest a hint token can be; streaming hosts buffer at most this many leading characters. */
export const REACT_HINT_MAX_CHARS = 32;

/** True while `head` could still become a `⟦react:…⟧` token (streaming hosts keep buffering). */
export function maybeReactHintPrefix(head: string): boolean {
  const h = head.trimStart();
  if (!h) return true;
  if (h.length > REACT_HINT_MAX_CHARS) return false;
  const target = h.startsWith('[') ? '[[react:' : '⟦react:';
  const probe = h.toLowerCase();
  if (probe.length <= target.length) return target.startsWith(probe);
  return probe.startsWith(target) && !/⟧|\]\]/.test(probe);
}

/** Strip a leading `⟦react:laugh⟧` (or `[[react:laugh]]`) from the reply head (§3.3). Unknown hints are stripped too. */
export function parseReactHint(head: string): { hint: ReactHint | null; rest: string } {
  const m = HINT_RE.exec(head ?? '');
  if (!m) return { hint: null, rest: head ?? '' };
  const v = (m[1] ?? '').toLowerCase() as ReactHint;
  return { hint: HINTS.has(v) ? v : null, rest: (head ?? '').slice(m[0].length) };
}

const DEFAULT_PRECEDENCE: readonly IntentId[] = ['sympathy', 'concern', 'apology', 'delight', 'surprise', 'laugh', 'encouragement', 'acknowledge'];

/**
 * The owner-directed reflex for a turn, by precedence (sympathy > concern > apology > delight > surprise >
 * laugh > encouragement > acknowledge). Sincere "are you an AI?" → nothing (H6); distress → only sympathy;
 * laughs never follow frustration, corrections, self-doubt or bad news (H4); phatic turns belong to the host.
 * A lexicon-only laugh needs a clean joke (E10: humour ≥ 0.6 with bad news and frustration both < 0.3); anything
 * murkier ("haha great, the site's down again") waits for the conversation layer's `⟦react:laugh⟧` hint.
 */
export function reactionFor(cues: AffectCues, hint: ReactHint | null, defaults: IntentsFile['defaults']): IntentId | null {
  if (cues.sincereAi) return null;
  if (cues.distress) return 'sympathy';
  if (cues.phatic) return null;
  const cand = new Set<IntentId>();
  const selfDoubt = cues.selfDoubt ?? 0;
  if (cues.frustration >= 0.5) cand.add('sympathy');
  if (cues.badNews >= 0.6) cand.add('concern');
  if (cues.correction >= 0.7) cand.add('apology');
  if (cues.goodNews >= 0.6 || cues.praise >= 0.6) cand.add('delight');
  if (Math.max(cues.goodNews, cues.badNews) >= 0.9) cand.add('surprise');
  const laughOk = cues.frustration < 0.5 && cues.correction < 0.7 && cues.doubt < 0.6 && selfDoubt < 0.6 && cues.badNews < 0.6;
  const lexiconLaughOk = laughOk && cues.badNews < 0.3 && cues.frustration < 0.3;
  if (cues.humor >= 0.6 && lexiconLaughOk) cand.add('laugh');
  if (cues.doubt >= 0.6 || selfDoubt >= 0.6) cand.add('encouragement');
  if (hint && hint !== 'none' && (hint !== 'laugh' || laughOk)) cand.add(hint as IntentId);
  if (cues.request >= 0.6 || cues.stopOrSteer >= 0.6) cand.add('acknowledge');
  const precedence = Array.isArray(defaults.reaction_precedence) ? (defaults.reaction_precedence as readonly IntentId[]) : DEFAULT_PRECEDENCE;
  for (const id of precedence) if (cand.has(id)) return id;
  return null;
}
