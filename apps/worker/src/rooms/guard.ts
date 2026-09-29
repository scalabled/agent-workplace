// The reply guard (docs/dev/OFFICE-PHASE2.md §4.2.6): every room, huddle and desk reply passes it. It releases whole
// sentences and replaces or drops any sentence that claims or promises work, states a figure the owner did not say,
// reports a metric moving or a standing nobody measured, claims access to the owner's data, recounts an experience or
// a human memory, or cites a study, and stops after `maxSentences`. Coworkers speak from expertise only: opinions,
// principles, questions, disagreements (D5 "Honest and never annoying", X9). What the owner said themselves may be
// said back: their figures, and a movement they stated about the same thing.
import { WORK_CLAIM_RE, claimsWork, normaliseSentence } from '../desk/desk';
import { logWarn } from '../workspace/runtime';

// ── figures ─────────────────────────────────────────────────────────────────────

const UNITS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000 };
const SUFFIX: Record<string, number> = { k: 1_000, m: 1_000_000, mm: 1_000_000, b: 1_000_000_000, bn: 1_000_000_000, x: 1 };

/** A number as its canonical figure text ("9", "9.5", "5000"). */
function canon(n: number): string {
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 1e6) / 1e6);
}

/** One word as a number-word value: units, tens, scales, "dozen(s)"; null otherwise ("one", "half", "twice" are not figures). */
function wordValue(w: string): { kind: 'unit' | 'ten' | 'scale' | 'dozen'; n: number } | null {
  if (w in UNITS) return { kind: 'unit', n: UNITS[w]! };
  if (w in TENS) return { kind: 'ten', n: TENS[w]! };
  const scale = w.endsWith('s') && w.slice(0, -1) in SCALES ? w.slice(0, -1) : w;
  if (scale in SCALES) return { kind: 'scale', n: SCALES[scale]! };
  if (w === 'dozen' || w === 'dozens') return { kind: 'dozen', n: 12 };
  return null;
}

// A figure token: a time ("10:40"); a ratio that is not a figure ("24/7", "1:1", "50/50"); a number with separators
// and decimals, an optional currency sign, a multiplier suffix written against it ("$5k", "3x") and a percent sign, and
// not glued to letters ("B2B", "Web3", "GPT-4" are names); a quarter-like token ("q2", "Q4", "h1"); an ordinal ("3rd");
// or a word (hyphenated parts kept together: "twenty-five", "nine-point").
const TOKEN_RE =
  /(\d{1,2}:\d{2})(?!\d)|(\d+[:/]\d+)|(?<![\p{L}\d]|\p{L}-)([$€£¥]\s?)?(\d[\d,]*(?:\.\d+)?)(k|mm|m|bn|b|x)?(?![\p{L}\d])(\s?%)?|\b[qh]([1-4])\b|(?<![\p{L}\d])(\d+)(?:st|nd|rd|th)\b|([\p{L}]+(?:-[\p{L}]+)*)/giu;

/** One figure in a text, with where it is and how it was written (for the small-count and clock-time exemptions). */
export interface FigureToken {
  value: string;
  n: number;
  start: number;
  end: number;
  kind: 'time' | 'number' | 'word' | 'quarter' | 'ordinal';
  /** A unit written with the figure: "%", a currency sign, a multiplier ("k", "x") or a hyphenated word ("point"). */
  unit: string | null;
}

/** The figures a text states, in order, with positions (see `figuresIn`). */
export function figureTokens(text: string): FigureToken[] {
  const out: FigureToken[] = [];
  const s = String(text ?? '');
  // A run of number words ("twenty five", "two hundred and fifty") becomes one value.
  interface Run {
    total: number;
    current: number;
    any: boolean;
    start: number;
    end: number;
    unit: string | null;
  }
  let run = null as Run | null;
  let lastDigit: FigureToken | null = null;
  const closeRun = () => {
    const r = run;
    if (r?.any) {
      const n = r.total + r.current;
      out.push({ value: canon(n), n, start: r.start, end: r.end, kind: 'word', unit: r.unit });
    }
    run = null;
  };
  const addWords = (values: { kind: string; n: number }[], start: number, end: number): Run => {
    const r: Run = run ?? { total: 0, current: 0, any: false, start, end, unit: null };
    run = r;
    r.end = end;
    for (const v of values) {
      r.any = true;
      if (v.kind === 'unit' || v.kind === 'ten') r.current += v.n;
      else if (v.kind === 'dozen') r.current = (r.current || 1) * 12;
      else if (v.n === 100) r.current = (r.current || 1) * 100;
      else {
        r.total += (r.current || 1) * v.n;
        r.current = 0;
      }
    }
    return r;
  };
  for (const m of s.matchAll(TOKEN_RE)) {
    const [whole, time, ratio, currency, num, suffix, percent, quarter, ordinal, word] = m;
    const at = m.index ?? 0;
    if (word !== undefined) {
      const lower = word.toLowerCase();
      const parts = lower.split('-');
      const values = parts.map(wordValue);
      // Number words first, then (hyphenated) a unit word: "nine-point" → 9 with unit "point".
      let k = 0;
      while (k < values.length && values[k] !== null) k++;
      if (k > 0) {
        const nums = values.slice(0, k) as { kind: string; n: number }[];
        // A scale right after a digit: "3 million" → 3000000.
        if (!run && k === values.length && nums[0]!.kind === 'scale' && lastDigit && /^\s*$/.test(s.slice(lastDigit.end, at))) {
          const n = lastDigit.n * nums[0]!.n;
          out[out.indexOf(lastDigit)] = { ...lastDigit, value: canon(n), n, end: at + whole.length };
          lastDigit = null;
          continue;
        }
        const r = addWords(nums, at, at + whole.length);
        if (k < values.length) {
          r.unit = parts.slice(k).join('-');
          closeRun();
        }
        lastDigit = null;
        continue;
      }
      // "and" inside a run ("two hundred and fifty") keeps it open.
      if (run && lower === 'and') continue;
      closeRun();
      lastDigit = null;
      continue;
    }
    closeRun();
    lastDigit = null;
    if (ratio !== undefined) continue;
    if (time !== undefined) out.push({ value: time, n: NaN, start: at, end: at + whole.length, kind: 'time', unit: null });
    else if (quarter !== undefined) out.push({ value: quarter, n: Number(quarter), start: at, end: at + whole.length, kind: 'quarter', unit: null });
    else if (ordinal !== undefined) out.push({ value: canon(Number(ordinal)), n: Number(ordinal), start: at, end: at + whole.length, kind: 'ordinal', unit: null });
    else if (num !== undefined) {
      const base = Number(num.replace(/,/g, ''));
      const mult = suffix ? SUFFIX[suffix.toLowerCase()] ?? 1 : 1;
      const n = base * mult;
      const unit = percent ? '%' : currency ? currency.trim() : suffix ? suffix.toLowerCase() : null;
      const tok: FigureToken = { value: canon(n), n, start: at, end: at + whole.length, kind: 'number', unit };
      out.push(tok);
      if (!suffix && !percent) lastDigit = tok;
    }
  }
  closeRun();
  return out.filter((f) => f.value !== '');
}

/**
 * The figures a text states, normalised: digits and decimals ("9", "9.5", "10:40", "2026"), percentages, currency and
 * multipliers ("40%" → "40", "$5k" → "5000", "$5,000" → "5000", "3x" → "3"), ordinals ("3rd" → "3"), quarter-like
 * tokens ("q2" → "2"), and number words from two to billions and dozen(s), hyphenated too ("nine" → "9", "twenty-five"
 * → "25", "nine-point" → "9", "three million" → "3000000", "a dozen" → "12"). Not figures: one, a few, a couple, half,
 * double, twice; ratios ("24/7", "1:1"); digits inside names ("B2B", "Web3", "GPT-4").
 */
export function figuresIn(text: string): Set<string> {
  return new Set(figureTokens(text).map((f) => f.value));
}

// Words that make a small count a metric: "3 customers", "five points", "a rate of 4".
const METRIC_NOUN_RE =
  /^(?:%|percent|pct|points?|pts|percentage|rates?|revenue|sales|users?|customers?|clients?|buyers?|subscribers?|sign-?ups?|leads?|deals?|orders?|conversions?|visitors?|visits|views|downloads|installs|reviews?|stars?|ratings?|churn|retention|growth|margins?|mrr|arr|nps|roi|ctr|traffic|sessions|bookings|units|dollars|euros|pounds|bucks|times|x|k|million|billion|thousand|grand)$/i;
const SMALL_MAX = 10;

/**
 * True when a figure needs the owner's word: every figure, except a clock time and a small count or ordinal (2–10)
 * that is not written with a unit and does not sit next to a metric noun ("Two things matter", "Top 3 things",
 * "back in ten seconds", "Happy to meet at 10:30" pass; "3 new customers", "a nine-point jump", "5%" do not).
 */
function needsOwner(f: FigureToken, s: string): boolean {
  if (f.kind === 'time') return false;
  if (f.kind === 'quarter') return true;
  if (!(f.n >= 2 && f.n <= SMALL_MAX)) return true;
  if (f.unit) return METRIC_NOUN_RE.test(f.unit) || /^[$€£¥%kmbx]/i.test(f.unit);
  const after = s.slice(f.end).match(/^[\s-]*([\p{L}%$]+)(?:\s+([\p{L}%]+))?(?:\s+([\p{L}%]+))?/u) ?? [];
  const before = s.slice(0, f.start).match(/(?:([\p{L}]+)\s+)?([\p{L}$]+)[\s$]*$/u) ?? [];
  return [after[1], after[2], after[3], before[1], before[2]].some((w) => !!w && METRIC_NOUN_RE.test(w));
}

// ── sentence checks ─────────────────────────────────────────────────────────────

const UP_WORDS = new Set(['up', 'rose', 'risen', 'rise', 'rises', 'grew', 'grown', 'increased', 'increase', 'spiked', 'spike', 'jumped', 'jump', 'jumps', 'climbed', 'climbs', 'lifted', 'lift', 'surged', 'surge', 'surges', 'soared', 'doubled', 'doubles', 'tripled', 'triples', 'quadrupled', 'gain', 'bump', 'uptick', 'boost']);
/** The direction a movement word says (for "the owner said it went up"). */
const directionOf = (verb: string): 'up' | 'down' => {
  const words = verb.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  return words.some((w) => UP_WORDS.has(w)) ? 'up' : 'down';
};

// A reported movement of a metric: a past-tense (or "is up") move with a time or unit around it ("went up after the
// relaunch", "jumped last quarter", "is up a third on last month").
const MOVE_RE =
  /\b(went (?:up|down)|go(?:es)? (?:up|down)|gone (?:up|down)|rose|risen|fell|fallen|grew|grown|dropped|increased|decreased|spiked|jump(?:s|ed)?|climb(?:s|ed)|declined|lifted|surged?|surges|soared|plunged|tanked|dipped|halved|(?:is|are|was|were) (?:up|down))\b/i;
const METRIC_CONTEXT_RE = /\b(after|since|last|ago|yesterday|recently|already|this (?:week|month|quarter|year)|year|quarter|month|week|by|points?|percent|pts|relaunch|launch)\b|%/i;
// A movement that is a figure in itself ("doubles", "up a third"): a claim with or without context.
const QUANT_MOVE_RE = /\b(doubles|doubled|triples|tripled|quadrupled|halves|halved)\b|\b((?:up|down|grew|rose|fell|dropped|increased|decreased|cut) (?:by )?(?:a third|a quarter|a fifth|half|two-thirds|three-quarters))\b/i;
// A result somebody got ("had a nine-point jump", "gave us a lift", "saw a dip").
const RESULT_RE =
  /\b(?:had|saw|got|gave(?: us| them| you)?|drove|delivered|posted|recorded|hit)\s+(?:a|an|the|another)\s+(?:[\w%-]+\s+){0,2}?(jump|lift|surge|spike|drop|dip|rise|increase|decrease|decline|gain|bump|uptick|boost)\b/i;
// A standing nobody measured ("already the best in the category", "3rd in the market", "above the industry average").
const STANDING_RE =
  /\b(best|worst|highest|lowest|top|leading|strongest|weakest|fastest|slowest|biggest|smallest|number one|no\.? ?1|\d+(?:st|nd|rd|th)|first|second|third)\s+(?:\w+\s+)?(?:in|of)\s+(?:the\s+|your\s+|its\s+|their\s+)?(category|market|industry|class|segment|space|sector|niche|field|country|world|region)\b|\b(above|below|ahead of|behind)\s+(?:the\s+)?(?:industry|market|category|sector)\s+(?:average|norm|benchmark|median)\b/i;
// Idioms that use the movement words ("fell by the wayside", "dropped the ball", "doubled down").
const IDIOM_RE =
  /\b(?:fell (?:by the wayside|through|apart|flat|short|behind|in love|asleep|into place|off)|rose to the occasion|dropped (?:the ball|by|in|off|out|it)|jumped (?:at|in|on board|ship|the gun|through hoops)|grew (?:on|up|out of|into)|lifted (?:a finger|the mood|spirits)|climbed (?:on board|aboard)|doubled (?:down|back)|(?:is|are|was|were) (?:up|down) (?:to|for|with|on|in))\b/gi;
const EXPERIENCE_RE =
  /\b(I|we)\b[^.?!]{0,30}\b(tested|tried|ran|measured|saw|found|launched|shipped|built|surveyed|interviewed|analy[sz]ed)\b[^.?!]{0,40}\b(last|yesterday|ago|before|when we|this (?:week|month|quarter|year))\b/i;
// A human memory or a past job ("I remember a client who…", "when I worked at…").
const MEMORY_RE =
  /\b(?:I (?:still )?(?:remember|recall)\b(?! (?:you|your|that you|what you|when you|how you|the brief|this conversation))|a client I\b|clients? of mine\b|when I (?:worked|was working|ran|managed|led|was at)\b|back when I\b|in my (?:last|old|previous|first) (?:job|role|company|agency|team|startup)\b|at my (?:last|old|previous|first) (?:job|company|agency|firm|startup|place)\b|my (?:old|former|last|previous) (?:boss|team|company|agency|client|manager)\b|I once (?:worked|had|ran|managed|led|built|shipped|launched|tried|saw)\b)/i;
// Access the coworker does not have ("I checked your dashboard", "I looked at the numbers").
const ACCESS_RE =
  /\bI(?:'ve| have)?(?: just| already| quickly)?\s+(?:checked|looked (?:at|through|over)|pulled|reviewed|went through|dug (?:into|through)|opened|skimmed|scanned|read|saw|glanced at|combed through)\s+(?:your|the|our)\s+(?:[\w-]+\s+)?(dashboards?|numbers|data|analytics|metrics|inbox|files?|site|website|deck|reports?|figures|stats|spreadsheets?|sheets?|crm|reviews|accounts?|funnel|logs)\b|\bI (?:can )?see (?:from|in) (?:your|the) (?:[\w-]+\s+)?(dashboards?|numbers|data|analytics|metrics|stats|reports?)\b/i;
const HYPOTHETICAL_RE = /\b(if|would|could|might|should|may|whether|unless|suppose|imagine)\b/i;
const CITATION_RE =
  /\b(according to|studies (?:show|suggest|say|find|found)|research (?:shows|suggests|says|finds|found)|(?:the )?data (?:shows|says|suggests|indicates)|the numbers (?:show|say|suggest)|surveys? (?:show|say|suggest)s?|reports? (?:show|say|suggest)s?|evidence (?:shows|suggests)|benchmarks? (?:show|say|suggest)s?)\b/i;
const PRONOUN_SUBJECT = new Set(['it', 'that', 'this', 'they', 'those', 'these', 'which', 'number', 'figure', 'metric']);
const SUBJECT_STOP = new Set(['the', 'a', 'an', 'our', 'your', 'their', 'its', 'my', 'since', 'because', 'as', 'and', 'so', 'then', 'when', 'that', 'who', 'which', 'you', 'said', 'yes', 'lead', 'with', 'if', 'has', 'have', 'had', 'been', 'really', 'already', 'just', 'also']);

export type GuardHit = 'work' | 'figure' | 'metric' | 'experience' | 'access' | 'citation';

/** True when a sentence recounts a past experience as fact ("We tested that last spring"); hypotheticals pass. */
export function claimsExperience(sentence: string): boolean {
  const s = normaliseSentence(sentence);
  const m = EXPERIENCE_RE.exec(s);
  if (!m) return false;
  const verbAt = m.index + m[0].indexOf(m[2]!, m[0].indexOf(m[1]!) + m[1]!.length);
  return !HYPOTHETICAL_RE.test(s.slice(0, verbAt));
}

/** What the owner said, as the guard reads it: their figures, their words, and the movements they stated. */
export interface OwnerContext {
  figures: ReadonlySet<string>;
  /** Lowercased, normalised owner text. */
  text: string;
  moves: { dir: 'up' | 'down'; words: Set<string> }[];
}

const contentWords = (s: string): Set<string> =>
  new Set(
    (s.toLowerCase().match(/\p{L}[\p{L}'-]*/gu) ?? [])
      .map((w) => w.replace(/'s$/, ''))
      .filter((w) => w.length >= 3 && !SUBJECT_STOP.has(w) && !METRIC_CONTEXT_RE.test(w)),
  );

/** Every movement a text states, with its direction and where its verb is. */
function movesIn(s: string): { dir: 'up' | 'down'; at: number }[] {
  const out: { dir: 'up' | 'down'; at: number }[] = [];
  const clean = s.replace(IDIOM_RE, (m) => ' '.repeat(m.length));
  for (const re of [MOVE_RE, QUANT_MOVE_RE, RESULT_RE]) {
    const g = new RegExp(re.source, 'gi');
    for (const m of clean.matchAll(g)) {
      const word = m[1] ?? m[2] ?? m[0];
      out.push({ dir: directionOf(word), at: m.index ?? 0 });
    }
  }
  return out;
}

/** The owner's context for a conversation (`texts`: their messages in it). */
export function ownerContext(texts: readonly string[]): OwnerContext {
  const moves: OwnerContext['moves'] = [];
  for (const t of texts) {
    for (const sentence of normaliseSentence(String(t ?? '')).split(/(?<=[.!?…])\s+/)) {
      const found = movesIn(sentence);
      if (!found.length) continue;
      const words = contentWords(sentence);
      for (const f of found) moves.push({ dir: f.dir, words });
    }
  }
  return { figures: ownerFigures(texts), text: normaliseSentence(texts.join('\n')).toLowerCase(), moves };
}

const NO_OWNER: OwnerContext = { figures: new Set(), text: '', moves: [] };

/** True when the clause holding position `at` is a condition or a modal ("If it went up…", "…would rise"). */
function hypotheticalAt(s: string, at: number): boolean {
  const head = s.slice(0, at);
  const cut = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'), head.lastIndexOf(':'), head.lastIndexOf('—'), head.lastIndexOf(' - '));
  return HYPOTHETICAL_RE.test(head.slice(cut + 1));
}

/**
 * A metric claim in the sentence the owner did not make, if any: a movement (with a time or unit around it), a
 * quantified movement ("doubles", "up a third"), a result ("had a nine-point jump") or a standing ("the best in the
 * category"). Conditions, modals and questions claim nothing. A movement the owner stated in the same direction may be
 * said back when it is about the same thing: "it", a word the owner used before or around their verb, or the owner's
 * own figures (`ownedFigures`).
 */
function metricClaim(s: string, owner: OwnerContext, ownedFigures: boolean): boolean {
  if (/\?\s*["'”’)\]]*\s*$/.test(s)) return false;
  const clean = s.replace(IDIOM_RE, (m) => ' '.repeat(m.length));
  const standing = STANDING_RE.exec(clean);
  if (standing && !hypotheticalAt(clean, standing.index)) {
    const key = (standing[1] ?? standing[3] ?? '').toLowerCase();
    if (!key || !owner.text.includes(key)) return true;
  }
  const found: { dir: 'up' | 'down'; at: number }[] = [];
  const move = MOVE_RE.exec(clean);
  if (move && METRIC_CONTEXT_RE.test(clean)) found.push({ dir: directionOf(move[1]!), at: move.index });
  const quant = QUANT_MOVE_RE.exec(clean);
  if (quant) found.push({ dir: directionOf(quant[1] ?? quant[2]!), at: quant.index });
  const result = RESULT_RE.exec(clean);
  if (result) found.push({ dir: directionOf(result[1]!), at: result.index });
  for (const f of found) {
    if (hypotheticalAt(clean, f.at)) continue;
    const words = (clean.slice(0, f.at).split(/[,;:—]/).pop()!.toLowerCase().match(/\p{L}[\p{L}'-]*/gu) ?? []).map((w) => w.replace(/'s$/, ''));
    const subject = words.slice(-4).filter((w) => PRONOUN_SUBJECT.has(w) || !SUBJECT_STOP.has(w));
    const pronoun = subject.length > 0 && subject.every((w) => PRONOUN_SUBJECT.has(w));
    const said = owner.moves.some((m) => m.dir === f.dir && (ownedFigures || pronoun || subject.some((w) => m.words.has(w))));
    if (!said) return true;
  }
  return false;
}

// Rooms: only a first-person-singular promise is a work promise; "we could start with a pilot" is group advice.
const SINGULAR_PROMISE_RE =
  /\b(?:I(?:'ll| will| can| could| shall)|let me|I can have)\s+(?:(?!not\b|never\b)\w+\s+){0,3}?(?:do|send|draft|write|have(?! to\b)|get|pull|put|prepare|look|research|dig|start|finish|build|book|email)\b/i;

/**
 * A coworker staffed on a project really is working, so "I'm drafting the offer" is true; what they still cannot do
 * is act outside: send, book, pay, publish, contact, deploy.
 */
const EXTERNAL_CLAIM_RE = /\b(I|I'm|I've|I'll|we|we're|we've|we'll)\b[^.?!]{0,40}\b(sent|emailed|booked|paid|published|posted|deployed|shipped|called|contacted|texted|messaged)\b/i;
const EXTERNAL_PROMISE_RE =
  /\b(?:(?:I|we)(?:'ll| will| can| could| shall)|let me|let us)\s+(?:(?!not\b|never\b)\w+\s+){0,3}?(?:send|email|book|pay|publish|post|deploy|ship|call|contact|text|message)\b/i;

export interface SentenceCheckOptions {
  /** What the owner said in this conversation (their figures and stated movements may be said back). */
  owner?: OwnerContext;
  /**
   * 'strict' (quick chat): any "I/we will, can, could + work verb" is a promise. 'room': only "I…" promises are.
   * 'staffed' (a quick chat with someone on a project): only claims and promises of outside actions are.
   */
  work?: 'strict' | 'room' | 'staffed';
}

/**
 * What is wrong with one sentence, if anything, in the guard's order: work, figures, access, memory, metric
 * (movement or standing), experience, citation. `allowed` are the figures the owner said.
 */
export function sentenceHit(sentence: string, allowed: ReadonlySet<string>, o: SentenceCheckOptions = {}): GuardHit | null {
  const owner = o.owner ?? { ...NO_OWNER, figures: allowed };
  const s = normaliseSentence(sentence);
  const work = o.work === 'staffed' ? EXTERNAL_CLAIM_RE.test(s) || EXTERNAL_PROMISE_RE.test(s) : o.work === 'room' ? WORK_CLAIM_RE.test(s) || SINGULAR_PROMISE_RE.test(s) : claimsWork(sentence);
  if (work) return 'work';
  // Figures: the owner's own may be said back; a clock time or a small count with no metric beside it is not a figure.
  let owned = 0;
  for (const f of figureTokens(s)) {
    if (allowed.has(f.value)) owned++;
    else if (needsOwner(f, s)) return 'figure';
  }
  if (ACCESS_RE.test(s)) return 'access';
  const memory = MEMORY_RE.exec(s);
  if (memory && !hypotheticalAt(s, memory.index)) return 'experience';
  if (metricClaim(s, owner, owned > 0)) return 'metric';
  if (claimsExperience(s)) {
    const m = EXPERIENCE_RE.exec(s)!;
    if (!(owner.text.includes(m[2]!.toLowerCase()) && owner.text.includes(m[3]!.toLowerCase()))) return 'experience';
  }
  const cite = CITATION_RE.exec(s);
  if (cite && !owner.text.includes(cite[1]!.toLowerCase())) return 'citation';
  return null;
}

// ── the guard ───────────────────────────────────────────────────────────────────

export interface ReplyGuardOptions {
  /** Figures the owner said in this conversation (`figuresIn` of their messages). */
  allowedFigures: Set<string>;
  /** The owner's messages in this conversation: movements they stated may be said back ("since it went up…"). */
  ownerText?: readonly string[];
  /** Replaces the first sentence that claims or promises work. */
  workLine: string;
  /** Said when every sentence had a figure, metric or citation the owner did not give (nothing else to say). */
  figureLine: string;
  /** Said when every sentence claimed access or an experience (default EXPERIENCE_LINE). */
  experienceLine?: string;
  /** Sentences released at most; the rest is dropped. */
  maxSentences: number;
  /** 'room' treats "we could…" as advice; 'strict' (default) as a promise (quick chat); 'staffed' checks outside actions only. */
  work?: 'strict' | 'room' | 'staffed';
  /** Log tag (kinds only, never text). */
  where?: string;
}

export const FIGURE_LINE = "I'd want the real numbers before I put a figure on it.";
/** Alternatives, so two responders in one turn do not say the same line. */
export const FIGURE_LINES = [FIGURE_LINE, "I'd rather see the real numbers before I guess at a figure.", "Without the real numbers I won't put a figure on it."] as const;
export const EXPERIENCE_LINE = "I can't speak to that firsthand; I'd go by what you've seen.";
export const CHIEF_ROOM_WORK_LINE = 'Bring it to me in Talk and it goes on my list.';

/**
 * Releases a streamed reply one complete sentence at a time (the HonestyGuard splitter: an end mark followed by
 * whitespace, so "3.5" and a trailing "Hi." wait) and checks each sentence. A work claim is replaced by the work line
 * (once per reply; it tells the owner something true). A sentence with an unsupported figure, metric, access,
 * experience or citation is dropped silently; only when nothing else was said does the reply end with the figure (or
 * experience) line. Replacements count toward `maxSentences`.
 */
export class ReplyGuard {
  private pending = '';
  private released = 0;
  private usedWork = false;
  private owed: string | null = null;
  private readonly owner: OwnerContext;
  private work: 'strict' | 'room' | 'staffed';
  rewrites = 0;
  readonly hits: GuardHit[] = [];

  constructor(private readonly o: ReplyGuardOptions) {
    this.owner = o.ownerText ? { ...ownerContext(o.ownerText), figures: o.allowedFigures } : { ...NO_OWNER, figures: o.allowedFigures };
    this.work = o.work ?? 'strict';
  }

  /** Real work was started this turn (a tool did it): saying so is true now; only outside actions stay off limits. */
  allowWork(): void {
    this.work = 'staffed';
  }

  /** Complete sentences ready to stream ('' while a sentence is still open). */
  push(delta: string): string {
    this.pending += delta;
    const re = /[.!?…]+["'”’)\]]*\s+/g;
    let out = '';
    let cut = 0;
    for (let m = re.exec(this.pending); m; m = re.exec(this.pending)) {
      const end = m.index + m[0].length;
      out += this.check(this.pending.slice(cut, end));
      cut = end;
    }
    this.pending = this.pending.slice(cut);
    return out;
  }

  /** The rest at the end of a complete reply, then the owed line if nothing was said. */
  flush(): string {
    const rest = this.pending;
    this.pending = '';
    const out = rest.trim() ? this.check(rest) : '';
    return out + this.owedLine();
  }

  /**
   * The end of a reply that was cut off (the deadline or the token cap): the unfinished sentence is dropped, never
   * released as a fragment. Returns the owed line only when nothing at all was said and something was dropped.
   */
  discard(): string {
    this.pending = '';
    return this.owedLine();
  }

  /** True once the reply reached its sentence cap (the caller may stop reading the model). */
  get full(): boolean {
    return this.released >= this.o.maxSentences;
  }

  private owedLine(): string {
    if (this.released || !this.owed) return '';
    const line = this.owed;
    this.owed = null;
    this.released++;
    return line;
  }

  private check(sentence: string): string {
    if (!sentence.trim()) return this.released ? sentence : '';
    if (this.released >= this.o.maxSentences) return '';
    const hit = sentenceHit(sentence, this.o.allowedFigures, { owner: this.owner, work: this.work });
    if (!hit) {
      this.released++;
      return sentence;
    }
    this.rewrites++;
    this.hits.push(hit);
    logWarn(this.o.where ?? 'reply.guard', `dropped a sentence (${hit}; the text is not logged)`);
    const trail = /\s+$/.exec(sentence)?.[0] ?? '';
    if (hit === 'work') {
      if (this.usedWork) return '';
      this.usedWork = true;
      this.released++;
      return `${this.o.workLine}${trail}`;
    }
    this.owed ??= hit === 'access' || hit === 'experience' ? this.o.experienceLine ?? EXPERIENCE_LINE : this.o.figureLine;
    return '';
  }
}

/** The figures in the owner's own messages (what a reply may repeat). */
export function ownerFigures(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const f of figuresIn(t)) out.add(f);
  return out;
}
