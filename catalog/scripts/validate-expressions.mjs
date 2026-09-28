#!/usr/bin/env node
// Validates catalog/expressions/** (the living-workforce expression library, docs/LIVING-WORKFORCE.md §3-§5,
// owner directive D5) against catalog/schema/expression-pack.schema.json and runs the cross-file, honesty
// and coverage checks of LIVING-WORKFORCE §4.7 and §10.1. Zero dependencies: a small JSON Schema 2020-12
// subset validator covers every keyword the schema uses.
//
//   node catalog/scripts/validate-expressions.mjs             validate, print totals and coverage gaps; exit 1 on errors
//   node catalog/scripts/validate-expressions.mjs --strict    quotas and missing packs become errors (the Inc 0.5 gate)
//   node catalog/scripts/validate-expressions.mjs --verbose   list every warning (default: grouped, 5 examples per rule)
//   node catalog/scripts/validate-expressions.mjs --quiet     errors and the summary line only
//   node catalog/scripts/validate-expressions.mjs --blends    also print every persona's derived archetype blend
//   node catalog/scripts/validate-expressions.mjs --json      also print a machine-readable summary (last stdout line)
//
// Files are found by walking catalog/expressions/ and classified by their top-level `kind`:
//   intents.json (kind intents) · archetypes.json (kind archetypes) · packs/<archetype>.json (archetype_pack)
//   personas/<department>.json and leads.json (signature_file; signatures/<group>.json is accepted too).
//
// Checks (errors unless marked warn):
//   files      every JSON file parses, has a known kind, sits where its kind belongs and passes the schema
//   vocab      intent, archetype and slot enums agree between the schema, intents.json and archetypes.json;
//              every intent key, archetype key, trigger event and context exists in its vocabulary
//   refs       persona_id / lead id exist in catalog/personas/*.json / catalog/leads/*.json; a persona's pack sits
//              in its department's file; one pack per persona; lead_blends name real leads
//   ids        line ids are globally unique, prefixed by their pack and segmented by intent (catchphrases: "catch")
//   slots      every {placeholder} is well formed and in the slot vocabulary, `slots` equals the placeholders,
//              each slot is allowed by the intent, tags.xai and tags.openai.say carry the same slots
//   tags       tags.xai uses only [pause] [long-pause] [laugh] [sigh] [breath] [sharp-breath] and properly nested
//              <whisper|soft|loud|slow|fast> wrappers; [cough]/[yawn] are banned; readable(xai) === text
//              (nonverbal lines: tags only); laugh_style renderings obey the same rules; openai.say has no markup
//   text       no markup, emoji, stage directions or stray whitespace in captions; no exact duplicate text within
//              a pack (warn: near-duplicates within one intent)
//   length     text (placeholders removed) ≤ the intent's max_chars. Estimated duration ≤ max_ms (a port of the
//              engine's estimateMs): selection drops a slot-free line over max_ms unless a shorter pre-voiced clip
//              exists, so it is a warning that --strict turns into an error; a slotted line over it with typical
//              fills is a warning; an intent whose max_chars cannot fit its max_ms is a spec warning
//   honesty    H1/H2 grounding: progress and result words (done, finished, completed, sent, %, halfway, nearly
//              through …) only with a grounding slot, a completion cause or a grounding context (see
//              progressGrounding below); completed external actions (H2), human embodiment (H6), side-talk
//              about the owner (H4), shared-experience sympathy (H7), never_says (persona + global list)
//   fit        (critique E4-E25) lines that presuppose the owner's turn need the owner-cue context (owner_question,
//              owner_praise, !owner_tone:negative); owner-thanking unblocks need unblocked_by:owner; evening greetings
//              never nag about brevity; weekday lines that assume a weekend off use workweek:*; report-promising
//              greetings need has_updates; "Still {step_label}" needs step_ing; side-talk replies carry reply_to:*;
//              idle lines that ask for work set solicits; juggling never invents the other thread; non-English words
//              carry lang and a gloss; hard-coded names match the catalog; "crazy/dumb/insane/lame/calm down" are
//              never said to the owner (warn: activity tails after {step_label}, self-name hard-coding, signature
//              lines that are not distinctive, writer tics shared by 3+ personas, uncapped tic lines)
//   quotas     (warn; errors under --strict) per-intent line quotas for archetype and signature packs
//   coverage   personas and leads without a signature pack (warn; errors under --strict), persona × intent pairs
//              whose selectable candidate pool is thin (warn), archetype packs whose mood.energy spread is too
//              narrow for mood to matter (warn), and slots no line uses (report only)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CATALOG = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(CATALOG, '..');
const EXPR = join(CATALOG, 'expressions');

// ── speech markup (byte-identical to packages/expressions/src/markup.ts and PG speakable/readable) ──────────
const INLINE_TAG = /^(pause|long-pause|laugh|sigh|breath|sharp-breath|cough|yawn)$/i;
const WRAP_TAG = /^(whisper|soft|loud|slow|fast)$/i;
export const PACK_INLINE_TAGS = ['pause', 'long-pause', 'laugh', 'sigh', 'breath', 'sharp-breath'];
export const PACK_WRAP_TAGS = ['whisper', 'soft', 'loud', 'slow', 'fast'];

export function speakable(raw) {
  const open = [];
  const out = String(raw)
    .replace(/\[([^\]]*)\]/g, (_m, tag) => (INLINE_TAG.test(tag.trim()) ? `[${tag.trim().toLowerCase()}]` : ' '))
    .replace(/<\s*(\/?)\s*([a-z-]*)\s*>/gi, (_m, slash, tag) => {
      const name = tag.toLowerCase();
      if (!WRAP_TAG.test(name)) return ' ';
      if (!slash) { open.push(name); return `<${name}>`; }
      const at = open.lastIndexOf(name);
      if (at < 0) return ' ';
      return open.splice(at).reverse().map((t) => `</${t}>`).join('');
    });
  return (out + open.reverse().map((t) => `</${t}>`).join('')).replace(/\s{2,}/g, ' ').replace(/\s+([,.!?…;:])/g, '$1').trim();
}
export function readable(raw) {
  return String(raw).replace(/\[[^\]]*\]/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?…;:])/g, '$1').trim();
}
export const placeholders = (s) => [...String(s).matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
const tagCount = (s) => (String(s).match(/\[[a-z-]+\]|<(?!\/)[a-z]+>/g) ?? []).length;
const tagsIn = (s) => new Set([...String(s).matchAll(/\[([a-z-]+)\]|<([a-z]+)>/gi)].map((m) => (m[1] ?? m[2]).toLowerCase()));

/** Explicit tag audit for an xAI rendering: unknown or banned tags, stray brackets, bad nesting. Returns problems. */
export function auditTags(xai) {
  const out = [];
  const stack = [];
  const tokens = String(xai).match(/\[[^\]]*\]|<[^>]*>|[[\]<>]/g) ?? [];
  for (const t of tokens) {
    if (t.length === 1) { out.push(`stray "${t}"`); continue; }
    if (t[0] === '[') {
      const name = t.slice(1, -1);
      if (/^(cough|yawn)$/i.test(name.trim())) out.push(`${t} is banned in expression packs (H12)`);
      else if (!PACK_INLINE_TAGS.includes(name)) out.push(`unknown inline tag ${t} (allowed: ${PACK_INLINE_TAGS.map((x) => `[${x}]`).join(' ')})`);
      continue;
    }
    const m = t.match(/^<(\/?)([a-z]+)>$/);
    if (!m || !PACK_WRAP_TAGS.includes(m[2])) { out.push(`unknown wrapper ${t} (allowed: ${PACK_WRAP_TAGS.map((x) => `<${x}>`).join(' ')})`); continue; }
    if (!m[1]) { stack.push(m[2]); continue; }
    if (stack.at(-1) === m[2]) stack.pop();
    else out.push(stack.includes(m[2]) ? `${t} closes out of order (open: ${stack.map((x) => `<${x}>`).join('')})` : `${t} has no opening tag`);
  }
  if (stack.length) out.push(`unclosed ${stack.map((x) => `<${x}>`).join('')}`);
  const empty = String(xai).match(/<([a-z]+)>\s*<\/\1>/);
  if (empty) out.push(`empty wrapper <${empty[1]}></${empty[1]}>`);
  return out;
}

// ── duration estimate (port of packages/expressions/src/lines.ts estimateMs; keep in sync) ─────────────────
const SLOT_SYLLABLES = {
  step_label: 8, gist: 10, blocker: 6, other_thread: 5, artifact: 4, client: 3, project: 3,
  coworker: 2, owner_name: 2, chief_name: 2, self_name: 2, eta: 3, done: 1, total: 1, finding_count: 1, weekday: 2, part_of_day: 3,
};
const TAG_MS = { pause: 300, 'long-pause': 700, laugh: 600, sigh: 500, breath: 250, 'sharp-breath': 200 };
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!w) return 0;
  if (/^\d+$/.test(w)) return Math.min(8, w.length * 2);
  let n = w.match(/[aeiouy]+/g)?.length ?? 0;
  if (n > 1 && /[^aeiouyl]e$/.test(w)) n -= 1;
  return Math.max(1, n);
}
export function estimateMs(xaiOrText, nonverbal, laughIntensity = 0.5) {
  if (nonverbal) return Math.round(500 + 700 * laughIntensity);
  const src = String(xaiOrText);
  let ms = 120;
  for (const m of src.matchAll(/\[([a-z-]+)\]/gi)) ms += TAG_MS[m[1].toLowerCase()] ?? 0;
  const words = readable(src.replace(/\{([a-z_]+)\}/g, (_m, s) => ` ${'la '.repeat(SLOT_SYLLABLES[s] ?? 3)}`));
  for (const w of words.split(/\s+/)) ms += syllables(w) * 170;
  ms += (words.match(/[,;:]/g)?.length ?? 0) * 60;
  ms += (words.match(/[—–]/g)?.length ?? 0) * 100;
  ms += (words.replace(/[.!?…]+$/, '').match(/[.!?…]+\s/g)?.length ?? 0) * 110;
  if (/<slow>/i.test(src)) ms *= 1.15;
  if (/<fast>/i.test(src)) ms *= 0.88;
  return Math.round(ms);
}

// ── honesty lints ───────────────────────────────────────────────────────────────────────────────────────────
const COMPLETION_CLAIM = /\b(sent|published|posted|paid|booked|deployed|shipped|signed|emailed|submitted|launched|scheduled|delivered it)\b/i;
const EMBODIMENT = /\b(coffee|lunch|commute|my kids|slept|sleepy|weekend plans|bathroom|drive home|traffic|hungover|caffeine|my desk chair|headphones|happy tears|in tears|mid-call|on a call|you and me both)\b/i;
const OWNER_TALK = /\b(the owner|the boss|boss man|our client said)\b/i;
const SHARED_EXPERIENCE = /\b(i've been there|i have been there|been there myself|happened to me|same thing happened|i went through|i know exactly how you feel)\b/i;
const STAGE_DIRECTION = /\*[^*]+\*|\((?:laughs?|chuckles?|sighs?|smiles?|grins?|pauses?|coughs?|nods?|winks?|giggles?|snorts?|clears)\b[^)]*\)/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const SIGH_UNWELCOME = new Set(['acknowledge', 'gratitude_reply', 'greeting', 'delight', 'celebrate', 'encouragement']);
/** Mirrors GLOBAL_NEVER_SAYS in packages/expressions/src/vocab.ts: filtered out of every agent's candidates. */
export const GLOBAL_NEVER_SAYS = ['synergy', 'synergies', 'circle back', 'touch base', 'low-hanging fruit', 'per my last', 'as an ai language model', 'as a large language model'];
/** Mirrors GLOBAL_NEVER_SAYS_OWNER_FACING (E12): never in an owner-facing intent. */
export const GLOBAL_NEVER_SAYS_OWNER_FACING = ['crazy', 'dumb', 'insane', 'lame', 'calm down'];
const SIDETALK_INTENTS = new Set(['handoff_give', 'handoff_take', 'ask_coworker', 'answer_coworker', 'share_result', 'review_approve', 'review_changes', 'sidetalk_reply']);

// ── fit lints (critique E4, E14-E25): what a reflex may presuppose, promise or invent ──────────────────────────
/** A filler or encouragement that praises a question: plays before any model read the turn (E4 owner_question). */
const QUESTION_PRAISE = /\bquestions?\b|\b(good|great|fair|interesting|excellent|brilliant|lovely|juicy|smart|clever) one\b/i;
/** Encouragement that assumes the owner asked something ("fair question", "asking the right…"). */
const QUESTION_PRAISE_ENC = /\b(good|great|fair|right|silly|dumb|stupid|important|smart|sensible|reasonable) (question|thing to (ask|be asking))\b|\bquestion to (ask|be asking)\b|\basking the right\b|\bto be asking\b/i;
/** Thanking back or modesty: fits praise, not a plain thanks (E4 owner_praise). */
const THANKS_BACK = /\b(thank(s| you)|aw+|too kind|kind of you|that's kind|sweet of you|means a lot|flatter\w*|blush\w*|stop it|modest\w*|appreciate (that|it)|appreciated|nice to hear|good to hear|glad you (like|think|thought)|you're (kind|sweet|too))\b/i;
/** An acknowledgement that judges the request (E4 !owner_tone:negative). */
const EVALUATIVE_ACK = /\b(love (this|it|that)|fun|great (shout|idea|one|call|question|tweak)|good (tweak|shout|call|idea)|ooh|exciting|this one matters|beautiful|nice one|good one|brilliant|let's build it|bring it to life|great direction|favou?rite|delicious|juicy|my kind of)\b/i;
/** Thanking the owner for an unblock (E18 unblocked_by:owner). */
const UNBLOCK_THANKS = /\b(thank(s| you)?|cheers|appreciate|you sorted|you fixed|ta\b)/i;
/** Brevity or rest words in an evening greeting (E15): late_night only. */
const EVENING_NAG = /\b(short|brief|quick|tight|rest|late|bed|sleep|keep it)\b/i;
/** Weekday lines that assume a working week or a weekend off (E14): use workweek:first_day / workweek:last_day. */
const WEEK_ASSUMPTION = /\b(weekend|week|made it|nearly there|last push|home stretch)\b/i;
/** Greetings that promise a report (E24 has_updates). */
const REPORT_PROMISE = /hand-?over|three numbers|pre-shift|full board|lots to talk about|what moved|news for you|updates? for you|catch you up|bring you up to speed|here's where we are/i;
/** The step label spliced in as a predicate (E23 step_ing). */
const STEP_SPLICE = /\b(still|busy|just|i'm|quietly|currently|happily|carefully|am|now|keep|kept|steadily|calmly|gently|slowly|mid|halfway)\s+\{step_label\}/i;
/** A concrete second activity after the real step (E16a). */
const ACTIVITY_TAIL = /\{(step_label|project)\}[^.?!]*[.?!—–,]\s*[^{]*\b(reading|drawing|humming|tab, tab|typing|testing|listening|watching|scrolling|calling|sketching|scribbling|clicking|tapping)\b/i;
/** A juggling line that names another activity without {other_thread} (E16d). */
const JUGGLE_INVENTED = /\b(call|meeting|review|email|inbox|phone|interview|standup|stand-up|workshop|session)\b/i;
/** An idle line that asks the owner for work (E25 solicits). */
const SOLICITS = /\?\s*$|\b(anything (for|i can)|got (anything|something)|throw me|pick me|use me|send (me|something)|what can i|need (anything|a hand|help)|put me to work|give me something|anything you need|want me to|point me|hand me|toss me|my way)\b/i;
/** Non-English words that need `lang` and a gloss (E17). Names with diacritics are not flagged. */
const NON_ENGLISH = /(?<![\p{L}\p{N}])(kia ora|ka pai|ka kite|mahi|malamu|mingi|hwyl|chwarae teg|diolch|head aega|võrreldes|millega|hamba kahle|sawubona|ngiyabonga|mahalo|kamisaki|olá|hola|buenas|bula|salut|bonjour|hej|hej då|selam|talofa|gamarjoba|hei|cześć|dzień dobry|merhaba|yassou|marhaba|shukran|ma'a salama|yalla|gracias|muchas|uno, dos, tres|hasta (luego|pronto)|cuídate|qué (bueno|alegría)|claro|vamos|voilà|merci|oui|très bien|à bientôt|ciao|grazie|obrigad[oa]|tchau|ahoj|dumela|mālō e lelei|slán)(?![\p{L}\p{N}])|¡/iu;
/** Tic patterns shared across the catalog (E22): warn when three or more personas use one. */
const WRITER_TICS = [
  ['is just vibes', /\bjust vibes\b/i], ['wearing a', /\bwearing an? \w+/i], ['graveyard', /\bgraveyard\b/i],
  ['I keep a list/jar/log', /\bI keep an? (list|jar|log|folder|file|spreadsheet)\b/i], ['I name every', /\bI name (every|each|all)\b/i],
  ['tired customer/reader', /\b(like|as) an? (tired|busy|sleepy|grumpy) (customer|reader|reviewer|person)\b/i],
  ['count to N', /\bcount to (three|five|ten|\d+)\b/i], ['good bones', /\bgood bones\b/i], ['metaphorically', /\bmetaphorically\b/i],
  ['love language', /\blove language\b/i],
];
/** Capitalised words that can follow "I'm" or precede "here" without being a name. */
const SELF_INTRO_STOP = new Set(['Tap', 'Click', 'Sign', 'Start', 'Look', 'Stop', 'Right', 'Over', 'Out', 'Up', 'Down', 'Here', 'Back', 'Sorry', 'Still', 'Not', 'On', 'In', 'All', 'Off', 'Free', 'Around', 'Glad', 'Happy', 'Afraid', 'Ready', 'Listening', 'Stuck', 'Done', 'Free', 'Quiet', 'Holding', 'Paused', 'Nothing', 'Everyone', 'Everything', 'Someone', 'Anyone', 'Help', 'Hi', 'Hello', 'Hey']);
/** Tic words that wear out fastest in high-frequency intents without a cap (E2). */
const TIC_WORDS = /\b(copy|move|checkmate|gate|kia ora|boring|brave|vibes|dream|hand-?over|checklist|band|tempo|setlist|code name|steal list|podium|halftime|sunrise crew)\b/i;
const HIGH_FREQ = new Set(['backchannel', 'acknowledge', 'thinking_filler', 'holding_filler', 'laugh', 'concern', 'delight', 'surprise', 'sympathy', 'gratitude_reply']);

/** Case-insensitive whole-phrase test, same semantics as the engine's containsPhrase. */
export function containsPhrase(text, phrase) {
  const key = String(phrase).trim().toLowerCase();
  if (!key) return false;
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'iu').test(String(text));
}

// Progress and result grounding (H1, H2). A canned line may only say that work is finished, or how far along it
// is, when live state proves it. "Result" words claim completion; "magnitude" words claim how far along.
const RESULT_WORDS = /\b(done|finished|completed|sent|wrapped (?:it |this |that |things )?up)\b|(?:['’]s|\bis|\bare|\bwas|\bnow|\ball)\s+complete\b/i;
const MAGNITUDE_WORDS = /%|\b[a-z-]+ percent (?:done|through|there|complete|finished|of the way)\b|\bhalf-?way (?:through|done|there)\b|\b(?:almost|nearly|mostly|practically) (?:done|finished|through|complete|there)\b|\bmost of the way\b/i;
// Forms that are not a status claim about the speaker's work; removed before the test.
const NOT_A_CLAIM = [
  /\b(?:well|nicely|beautifully|brilliantly|superbly|neatly|expertly|smartly|so well|very well|really well)\s+done\b/gi, // praise
  /\bdone\s+(?:right|properly|well|carefully|together)\b/gi, // manner ("one idea, done properly"), not a status
  /\bhow\b[^.!?]*?\b(?:done|finished)\b/gi, // "how the work gets done"
  /\b(?:when|once|until|till|before|as soon as|by the time|the (?:moment|minute|second))\b[^.,;:!?—–]*?\b(?:done|finished|complete|wrapped up)\b/gi, // future / conditional
  /\bget(?:s|ting)?\b(?:\s+[\w'’]+){0,3}?\s+done\b/gi, // "let's get it done", "lists get done"
  /\bhalf[- ]?(?:done|finished)\b/gi,
  /\b(?:not|never|isn['’]t|aren['’]t|wasn['’]t|won['’]t be|nothing['’]s)\s+(?:yet\s+|quite\s+|really\s+|ever\s+)?(?:done|finished|complete)\b/gi,
  /\byou(?:['’]ve|['’]d| have| had)?\s+(?:already\s+|just\s+|really\s+)?(?:done|finished)\b/gi, // the owner's or a coworker's doing
];
const RESULT_SLOTS = ['done', 'total', 'artifact', 'gist'];
const MAGNITUDE_SLOTS = ['done', 'total', 'eta'];
/** Cause events that certify a finished result (intents.json `requires: cause:*`). */
const COMPLETION_EVENTS = new Set(['job.done', 'deliverable.accepted', 'decision.resolved', 'project.done', 'handoff', 'ask.answered', 'verdict', 'step.unblocked']);
const COMPLETION_REPLY = /^reply_to:(celebrate|share_result|review_approve|review_changes|handoff_give|handoff_take|answer_coworker)$/;

/** Strip questions and non-claim idioms; what remains is what the line asserts. */
function assertedText(text) {
  const sentences = String(text).replace(/\{[a-z_]+\}/g, ' ').split(/(?<=[.!?…])\s+/);
  let s = sentences.filter((x) => !/\?\s*["”’)]*\s*$/.test(x.trim())).join(' ');
  for (const re of NOT_A_CLAIM) s = s.replace(re, ' ');
  return s;
}

/**
 * Grounding problems for progress/result words in one line under one intent (empty = fine).
 * Result words need a {done}/{total}/{artifact}/{gist} slot, an intent whose cause event certifies a result
 * (share_result, celebrate, handoff_*, answer_coworker, review_*, unblocked), or a reply_to:<completion opener>
 * or after_win context. Magnitude words need {done}/{total}/{eta}, a completion cause or a weekday:* context
 * (the week's progress, "Friday. Nearly there.").
 */
export function progressGrounding(line, intentDef) {
  const asserted = assertedText(line.text);
  const r = asserted.match(RESULT_WORDS);
  const m = asserted.match(MAGNITUDE_WORDS);
  if (!r && !m) return [];
  const slots = line.slots ?? [];
  const context = line.context ?? [];
  const causes = (intentDef?.requires ?? []).filter((q) => q.startsWith('cause:')).flatMap((q) => q.slice(6).split('|'));
  const completionCause = causes.some((c) => COMPLETION_EVENTS.has(c));
  const out = [];
  if (r && !(slots.some((s) => RESULT_SLOTS.includes(s)) || completionCause || context.some((c) => COMPLETION_REPLY.test(c) || c === 'after_win'))) {
    out.push(`result word "${r[0]}" is ungrounded in ${intentDef?.id ?? '?'}: needs a {done}/{total}/{artifact}/{gist} slot, a completion cause or a reply_to:<completion>/after_win context (H1/H2)`);
  }
  if (m && !(slots.some((s) => MAGNITUDE_SLOTS.includes(s)) || completionCause || context.some((c) => c.startsWith('weekday:') || c.startsWith('workweek:')))) {
    out.push(`progress word "${m[0]}" is ungrounded in ${intentDef?.id ?? '?'}: needs a {done}/{total}/{eta} slot or a completion cause (H1)`);
  }
  return out;
}

// ── mini JSON Schema (2020-12 subset) ───────────────────────────────────────────────────────────────────────
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
function makeChecker(schema) {
  const resolveRef = (ref) => {
    if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
    return ref.slice(2).split('/').reduce((node, key) => node[key], schema);
  };
  function check(s, v, path, out) {
    if (s.$ref) return check(resolveRef(s.$ref), v, path, out);
    if (s.oneOf) {
      const passing = s.oneOf.map((sub) => { const o = []; check(sub, v, path, o); return o; });
      const ok = passing.filter((o) => o.length === 0).length;
      if (ok !== 1) {
        const byKind = s.oneOf.findIndex((sub) => resolveRef(sub.$ref ?? '#').properties?.kind?.const === v?.kind);
        const best = byKind >= 0 ? passing[byKind] : [...passing].sort((a, b) => a.length - b.length)[0];
        out.push(...(ok > 1 ? [`${path}: matches more than one shape`] : best));
      }
      return;
    }
    if (s.const !== undefined && v !== s.const) out.push(`${path}: must be ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(v)) out.push(`${path}: ${JSON.stringify(v)} is not one of ${s.enum.length > 8 ? s.enum.slice(0, 8).join(', ') + ', …' : s.enum.join(', ')}`);
    if (s.type) {
      const t = typeOf(v);
      const allowed = Array.isArray(s.type) ? s.type : [s.type];
      if (!allowed.some((a) => a === t || (a === 'number' && t === 'integer'))) { out.push(`${path}: expected ${allowed.join('|')}, got ${t}`); return; }
    }
    if (typeof v === 'string') {
      if (s.minLength !== undefined && [...v].length < s.minLength) out.push(`${path}: shorter than ${s.minLength}`);
      if (s.maxLength !== undefined && [...v].length > s.maxLength) out.push(`${path}: longer than ${s.maxLength}`);
      if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) out.push(`${path}: ${JSON.stringify(v)} does not match ${s.pattern}`);
    }
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) out.push(`${path}: below ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) out.push(`${path}: above ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) out.push(`${path}: fewer than ${s.minItems} items`);
      if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${path}: more than ${s.maxItems} items`);
      if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) out.push(`${path}: items are not unique`);
      if (s.items) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`, out));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (s.minProperties !== undefined && keys.length < s.minProperties) out.push(`${path}: fewer than ${s.minProperties} properties`);
      if (s.maxProperties !== undefined && keys.length > s.maxProperties) out.push(`${path}: more than ${s.maxProperties} properties`);
      for (const r of s.required ?? []) if (!(r in v)) out.push(`${path}: missing ${r}`);
      for (const k of keys) {
        if (s.propertyNames) check(s.propertyNames, k, `${path}{${k}}`, out);
        if (s.properties && k in s.properties) check(s.properties[k], v[k], `${path}.${k}`, out);
        else if (s.additionalProperties === false) out.push(`${path}: unexpected property ${k}`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') check(s.additionalProperties, v[k], `${path}.${k}`, out);
      }
    }
  }
  return (v) => { const out = []; check(schema, v, '$', out); return out; };
}

// ── derived blends (the reference implementation of LIVING-WORKFORCE §4.5; mirrored by the engine) ──────────
const SLIDERS = ['warmth', 'directness', 'formality', 'humor', 'risk_appetite', 'detail', 'pace'];
export function sliderStats(rows) {
  const mean = {}, std = {};
  for (const k of SLIDERS) {
    const v = rows.map((r) => r[k]);
    mean[k] = v.reduce((a, b) => a + b, 0) / v.length;
    std[k] = Math.sqrt(v.reduce((a, b) => a + (b - mean[k]) ** 2, 0) / v.length) || 1;
  }
  return { mean, std };
}
export function deriveBlend({ sliders, traits = [], roles = [], seniority }, file, stats = file.normalization) {
  const { clip } = file.normalization;
  const { top_k, temperature, min_weight, trait_bonus_cap } = file.blend_rule;
  const z = Object.fromEntries(SLIDERS.map((k) => [k, Math.max(-clip, Math.min(clip, (sliders[k] - stats.mean[k]) / stats.std[k]))]));
  const tl = traits.map((t) => t.toLowerCase());
  const affinity = file.archetypes.map((a) => {
    let v = SLIDERS.reduce((s, k) => s + (a.mapping.sliders[k] ?? 0) * z[k], 0);
    v += Math.min(trait_bonus_cap, tl.reduce((s, t) => s + (a.mapping.traits[t] ?? 0), 0));
    v += roles.reduce((s, r) => s + (a.mapping.roles?.[r] ?? 0), 0);
    v += seniority ? a.mapping.seniority?.[seniority] ?? 0 : 0;
    return [a.id, v];
  }).sort((x, y) => y[1] - x[1]).slice(0, top_k);
  const ex = affinity.map(([, v]) => Math.exp(v / temperature));
  const total = ex.reduce((a, b) => a + b, 0);
  let kept = affinity.map(([id], i) => [id, ex[i] / total]).filter(([, w]) => w >= min_weight);
  const keptTotal = kept.reduce((a, [, w]) => a + w, 0);
  kept = kept.map(([id, w]) => [id, Math.round((w / keptTotal) * 100) / 100]);
  const drift = 1 - kept.reduce((a, [, w]) => a + w, 0);
  kept[0][1] = Math.round((kept[0][1] + drift) * 100) / 100;
  return Object.fromEntries(kept);
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────
function main() {
  const args = new Set(process.argv.slice(2));
  const STRICT = args.has('--strict');
  const QUIET = args.has('--quiet');
  const VERBOSE = args.has('--verbose');
  const JSON_OUT = args.has('--json');

  const errors = [];
  const warnings = new Map(); // rule → messages
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const warn = (rule, where, msg) => { if (!warnings.has(rule)) warnings.set(rule, []); warnings.get(rule).push(`${where}: ${msg}`); };
  const gate = (rule, where, msg) => (STRICT ? err(where, msg) : warn(rule, where, msg));
  const rel = (p) => relative(ROOT, p);
  const walk = (dir) => {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (name.endsWith('.json')) out.push(p);
    }
    return out;
  };
  const tryJson = (p) => {
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { err(rel(p), `does not parse as JSON: ${e.message}`); return undefined; }
  };

  // Schema.
  const schemaPath = join(CATALOG, 'schema', 'expression-pack.schema.json');
  const schema = tryJson(schemaPath);
  if (!schema) { report(); return; }
  const validate = makeChecker(schema);
  const schemaCheck = (p, d) => {
    const out = validate(d);
    for (const m of out.slice(0, 40)) err(rel(p), m);
    if (out.length > 40) err(rel(p), `… and ${out.length - 40} more schema errors`);
    return out.length === 0;
  };

  // Catalog personas and leads (read-only references).
  const personas = new Map();
  const departments = new Set();
  for (const p of walk(join(CATALOG, 'personas'))) {
    const d = tryJson(p);
    if (d?.department) departments.add(d.department);
    for (const x of d?.personas ?? []) personas.set(x.id, x);
  }
  const leads = new Map();
  for (const p of walk(join(CATALOG, 'leads'))) { const d = tryJson(p); if (String(d?.id ?? '').startsWith('lead-')) leads.set(d.id, d); }
  const FIRST_NAMES = new Set([...personas.values(), ...leads.values()].map((x) => String(x.name ?? '').trim().split(/\s+/)[0]).filter(Boolean));

  // Expression files, classified by kind.
  const intentsPath = join(EXPR, 'intents.json');
  const archetypesPath = join(EXPR, 'archetypes.json');
  let intentsFile, archetypesFile;
  const packFiles = [];
  const sigFiles = [];
  for (const p of walk(EXPR)) {
    const d = tryJson(p);
    if (d === undefined) continue;
    const r = relative(EXPR, p).split('\\').join('/');
    const base = r.split('/').pop();
    switch (d?.kind) {
      case 'intents':
        if (r !== 'intents.json') err(rel(p), 'the intents file must be catalog/expressions/intents.json');
        else intentsFile = d;
        break;
      case 'archetypes':
        if (r !== 'archetypes.json') err(rel(p), 'the archetypes file must be catalog/expressions/archetypes.json');
        else archetypesFile = d;
        break;
      case 'archetype_pack':
        if (!/^packs\/[^/]+\.json$/.test(r)) err(rel(p), 'archetype packs live in catalog/expressions/packs/<archetype>.json');
        if (`${d.id}.json` !== base) err(rel(p), `file name must be ${d.id}.json`);
        packFiles.push({ p, d });
        break;
      case 'signature_file': {
        const ok = d.group === 'leads' ? ['leads.json', 'signatures/leads.json'].includes(r) : [`personas/${d.group}.json`, `signatures/${d.group}.json`].includes(r);
        if (!ok) err(rel(p), d.group === 'leads' ? 'lead signatures live in catalog/expressions/leads.json' : `signature file for group "${d.group}" must be catalog/expressions/personas/${d.group}.json`);
        if (d.group !== 'leads' && departments.size && !departments.has(d.group)) err(rel(p), `group "${d.group}" is not a catalog department`);
        sigFiles.push({ p, d });
        break;
      }
      default:
        err(rel(p), `unknown kind ${JSON.stringify(d?.kind)} (expected intents, archetypes, archetype_pack or signature_file)`);
    }
  }
  if (!intentsFile || !archetypesFile) {
    if (!intentsFile) err(rel(intentsPath), 'missing or unreadable');
    if (!archetypesFile) err(rel(archetypesPath), 'missing or unreadable');
    report();
    return;
  }
  schemaCheck(intentsPath, intentsFile);
  schemaCheck(archetypesPath, archetypesFile);
  for (const { p, d } of [...packFiles, ...sigFiles]) schemaCheck(p, d);

  // ── vocabularies ──
  const SCHEMA_INTENTS = schema.$defs.intent_id.enum;
  const SCHEMA_ARCHETYPES = schema.$defs.archetype_id.enum;
  const SCHEMA_SLOTS = schema.$defs.slot_id.enum;
  const intents = new Map((intentsFile.intents ?? []).map((i) => [i.id, i]));
  const archetypes = new Map((archetypesFile.archetypes ?? []).map((a) => [a.id, a]));
  const slotVocab = new Set(Object.keys(intentsFile.slots ?? {}));
  const sameSet = (a, b) => { const sa = new Set(a), sb = new Set(b); return sa.size === sb.size && [...sa].every((x) => sb.has(x)); };
  if (!sameSet([...intents.keys()], SCHEMA_INTENTS)) err(rel(intentsPath), 'intent ids differ from schema $defs.intent_id');
  if (!sameSet([...archetypes.keys()], SCHEMA_ARCHETYPES)) err(rel(archetypesPath), 'archetype ids differ from schema $defs.archetype_id');
  if (!sameSet([...slotVocab], SCHEMA_SLOTS)) err(rel(intentsPath), 'slots differ from schema $defs.slot_id');
  const intentOk = (where, k) => { if (!intents.has(k)) { err(where, `unknown intent "${k}"`); return false; } return true; };
  const archetypeOk = (where, k) => { if (!archetypes.has(k)) { err(where, `unknown archetype "${k}"`); return false; } return true; };

  const contextKeys = new Set(Object.keys(intentsFile.contexts ?? {}));
  const contextOk = (tag) => {
    const t = tag.replace(/^!/, '');
    if (contextKeys.has(t)) return true;
    const [head] = t.split(':');
    return t.includes(':') && contextKeys.has(`${head}:*`);
  };
  for (const c of Array.isArray(intentsFile.defaults?.context_first) ? intentsFile.defaults.context_first : []) {
    if (!contextOk(String(c).replace(/:\*$/, ':x'))) err(`${rel(intentsPath)} defaults.context_first`, `unknown context ${c}`);
  }
  for (const i of intentsFile.intents ?? []) {
    const where = `${rel(intentsPath)}#${i.id}`;
    for (const t of i.triggers ?? []) {
      if (!intentsFile.trigger_events?.[t.on]) err(where, `trigger ${t.on} is not in trigger_events`);
      for (const c of t.context ?? []) if (!contextOk(c)) err(where, `unknown context ${c}`);
    }
    if (i.timing?.delay_ms?.[0] > i.timing?.delay_ms?.[1]) err(where, 'delay_ms min > max');
    if (i.latency === 'reflex' && i.prevoice === 'runtime') err(where, 'reflex intents must be pre-voiced');
    for (const c of Object.keys(i.max_ms_by_context ?? {})) if (!contextOk(c)) err(where, `max_ms_by_context: unknown context ${c}`);
    for (const c of i.context_first ?? []) if (!contextOk(c.replace(/:\*$/, ':x'))) err(where, `context_first: unknown context ${c}`);
    for (const s of i.slots ?? []) if (!slotVocab.has(s)) err(where, `unknown slot ${s}`);
    if (i.family === 'sidetalk' && (i.slots ?? []).includes('owner_name')) err(where, 'side-talk never names the owner');
    for (const ex of i.examples ?? []) for (const s of placeholders(readable(ex))) if (!(i.slots ?? []).includes(s)) err(where, `example uses slot {${s}} not allowed for this intent`);
    // max_chars and max_ms must describe the same line: plain speech runs ≈ 3.8 characters per syllable.
    const atMaxChars = estimateMs('la '.repeat(Math.round(i.max_chars / 3.8)).trim(), false);
    if (atMaxChars > i.max_ms * 1.15) warn('spec', where, `a ${i.max_chars}-character line estimates ≈${atMaxChars} ms, well over max_ms ${i.max_ms}; lines written to max_chars will be unselectable`);
  }

  // ── archetypes.json ──
  const sumOk = (blend) => Math.abs(Object.values(blend ?? {}).reduce((a, b) => a + b, 0) - 1) <= 0.011;
  for (const a of archetypes.values()) {
    const where = `${rel(archetypesPath)}#${a.id}`;
    for (const k of Object.keys(a.mapping?.traits ?? {})) if (k !== k.toLowerCase()) err(where, `trait key ${k} must be lowercase`);
    for (const k of Object.keys(a.intent_weights ?? {})) intentOk(where, k);
    for (const k of Object.keys(a.exemplars ?? {})) intentOk(where, k);
  }
  for (const [leadId, blend] of Object.entries(archetypesFile.lead_blends ?? {})) {
    if (leads.size && !leads.has(leadId)) err(rel(archetypesPath), `lead_blends: unknown lead ${leadId}`);
    for (const k of Object.keys(blend)) archetypeOk(`${rel(archetypesPath)} lead_blends.${leadId}`, k);
    if (!sumOk(blend)) err(rel(archetypesPath), `lead_blends.${leadId}: weights must sum to 1`);
  }
  for (const id of leads.keys()) if (!archetypesFile.lead_blends?.[id]) warn('lead-blends', rel(archetypesPath), `no lead_blends entry for ${id}`);

  // ── lines ──
  const lineIds = new Map();
  const narrowMood = new Map(); // archetype pack → intents whose lines span < 0.4 energy
  const slotUse = new Map(); // slot → lines using it
  const overBudget = new Set(); // slot-free lines whose estimate exceeds max_ms (dead without a shorter clip)
  const counts = { archetype: 0, signature: 0, catchphrase: 0, exemplar: 0 };
  const perIntent = Object.fromEntries([...intents.keys()].map((k) => [k, { archetype: 0, signature: 0, catchphrase: 0 }]));

  /** One line (or catchphrase) under its intents. Returns nothing; records errors and warnings. */
  function checkLine(where, line, packPrefix, intentKeys, opts = {}) {
    const w = `${where} ${line.id ?? '(no id)'}`;
    if (typeof line.id !== 'string' || typeof line.text !== 'string') { err(w, 'line needs a string id and text'); return; }
    if (lineIds.has(line.id)) err(w, `duplicate line id (also in ${lineIds.get(line.id)})`);
    else lineIds.set(line.id, where);
    const [pack, seg] = line.id.split('.');
    if (pack !== packPrefix) err(w, `id must start with "${packPrefix}."`);
    if (opts.catchphrase) {
      if (seg !== 'catch' && !(intentKeys.length === 1 && seg === intentKeys[0])) err(w, 'catchphrase ids use the "catch" segment');
    } else if (seg !== intentKeys[0]) err(w, `id intent segment must be "${intentKeys[0]}"`);
    const defs = intentKeys.filter((k) => intentOk(w, k)).map((k) => intents.get(k));
    if (!defs.length) return;
    const text = line.text;

    // text hygiene
    if (/[[\]<>]/.test(text)) err(w, 'text must not contain markup; put it in tags.xai');
    if (EMOJI.test(text)) err(w, 'no emoji in captions');
    if (!line.nonverbal && STAGE_DIRECTION.test(text.replace(/\{[a-z_]+\}/g, ' '))) err(w, 'no stage directions in text; use a nonverbal line or tags.xai');
    if (/^\s|\s$|\s{2,}/.test(text)) err(w, 'caption has leading, trailing or doubled whitespace');

    // slots
    const rawPh = [...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
    for (const s of rawPh) if (!/^[a-z_]+$/.test(s)) err(w, `malformed placeholder {${s}}`);
    if (/[{}]/.test(text.replace(/\{[^{}]*\}/g, ''))) err(w, 'unbalanced { or } in text');
    const inText = [...new Set(placeholders(text))];
    for (const s of inText) slotUse.set(s, (slotUse.get(s) ?? 0) + 1);
    const declared = line.slots ?? [];
    for (const s of new Set([...inText, ...declared])) if (!slotVocab.has(s)) err(w, `unknown slot {${s}} (vocabulary: intents.json slots)`);
    if (!sameSet(inText, declared)) err(w, `slots ${JSON.stringify(declared)} must equal placeholders ${JSON.stringify(inText)}`);
    for (const s of inText) for (const d of defs) if (slotVocab.has(s) && !d.slots.includes(s)) err(w, `slot {${s}} is not allowed in intent ${d.id} (allowed: ${d.slots.join(', ') || 'none'})`);
    if (placeholders(text).length !== inText.length) warn('slot-repeat', w, 'a slot appears twice in the text');

    // delivery tags
    const xai = line.tags?.xai;
    if (line.nonverbal) {
      if (!/^\(.+\)$/.test(text)) err(w, 'nonverbal text is a caption in parentheses, e.g. "(chuckles)"');
      if (xai === undefined || readable(xai) !== '') err(w, 'nonverbal lines need tags.xai made only of tags');
      if (!line.tags?.openai?.say) warn('nonverbal-say', w, 'nonverbal line has no tags.openai.say; OpenAI voices fall back to face-only');
    } else if (xai !== undefined && readable(xai) !== text) {
      err(w, `readable(tags.xai) "${readable(xai)}" must equal text "${text}"`);
    }
    if (xai !== undefined) {
      const tagProblems = auditTags(xai);
      for (const problem of tagProblems) err(w, `tags.xai: ${problem}`);
      // Backstop with the engine's own rule: what xAI receives must be exactly what was authored.
      if (!tagProblems.length && speakable(xai) !== xai.replace(/\s{2,}/g, ' ').trim()) err(w, `tags.xai is not stable under speakable() ("${speakable(xai)}")`);
      const n = tagCount(xai);
      if (n > 3) warn('tag-budget', w, `${n} expressive tags (more than 3)`);
      // A nonverbal line is the laugh itself (E13 renders laugh kinds as e.g. "<soft>[laugh]</soft>" or
      // "[breath] [laugh]"); the archetype's tag_budget limits decoration on spoken lines only.
      else if (opts.archetype && !line.nonverbal && n > (opts.archetype.delivery?.tag_budget ?? 3)) warn('tag-budget', w, `${n} tags, over the ${opts.archetype.id} tag_budget of ${opts.archetype.delivery.tag_budget}`);
      if (opts.archetype) for (const t of opts.archetype.delivery?.avoid_tags ?? []) if (tagsIn(xai).has(t.replace(/[[\]<>]/g, ''))) warn('avoid-tag', w, `${t} is in the ${opts.archetype.id} avoid_tags`);
      if (/\[sigh\]/.test(xai) && intentKeys.some((k) => SIGH_UNWELCOME.has(k))) warn('sigh', w, '[sigh] toward the owner can read as exasperation in this intent');
    }
    const say = line.tags?.openai?.say;
    if (say !== undefined) {
      if (/[[\]<>]/.test(say)) err(w, 'tags.openai.say is read verbatim; no markup');
      if (!sameSet([...new Set(placeholders(say))], inText)) err(w, 'tags.openai.say must use the same slots as text');
    }

    // contexts
    const ctx = line.context ?? [];
    for (const c of ctx) if (!contextOk(c)) err(w, `unknown context ${c}`);
    for (const c of ctx) if (!c.startsWith('!') && ctx.includes(`!${c}`)) err(w, `context requires and forbids ${c}; the line can never play`);
    const pos = ctx.filter((c) => !c.startsWith('!'));
    const exclusive = [['working', 'idle'], ['working', 'unstaffed'], ['idle', 'unstaffed'], ['working', 'blocked'], ['voice_mode', 'text_mode']];
    for (const [a, b] of exclusive) if (pos.includes(a) && pos.includes(b)) err(w, `contexts ${a} and ${b} never hold together; the line can never play`);
    const pods = pos.filter((c) => c.startsWith('part_of_day:'));
    const wds = pos.filter((c) => c.startsWith('weekday:'));
    if (pods.length > 1 || wds.length > 1) err(w, 'two part_of_day or weekday requirements never hold together');

    // length and duration
    const maxChars = Math.min(...defs.map((d) => d.max_chars));
    const bare = text.replace(/\{[a-z_]+\}/g, '');
    if (bare.length > maxChars) err(w, `text is ${bare.length} characters without slots, over ${maxChars} for ${intentKeys.join('/')}`);
    // Per intent (a catchphrase is compiled once per intent), with context budgets (E6 max_ms_by_context).
    const budgetOf = (d) => Math.max(d.max_ms, ...Object.entries(d.max_ms_by_context ?? {}).filter(([c]) => (line.context ?? []).includes(c)).map(([, v]) => v));
    const est = estimateMs(xai ?? text, !!line.nonverbal);
    const tooLong = defs.filter((d) => est > budgetOf(d));
    if (tooLong.length) {
      const maxMs = Math.min(...tooLong.map(budgetOf));
      const where2 = tooLong.map((d) => d.id).join('/');
      if (inText.length) warn('duration-slotted', w, `≈${est} ms with typical fills, over max_ms ${maxMs} for ${where2}; it only plays with short fills`);
      else if (tooLong.length === defs.length) { gate('duration', w, `≈${est} ms estimated, over max_ms ${maxMs} for ${where2}; unselectable unless a pre-voiced clip is shorter`); overBudget.add(line); }
      else warn('duration-partial', w, `≈${est} ms: too long for ${where2} (max_ms ${maxMs}), so it only plays in its other intents; drop those intents`);
    }

    // honesty
    for (const d of defs) for (const p of progressGrounding(line, d)) err(w, p);
    if (COMPLETION_CLAIM.test(text)) err(w, 'canned lines never claim a completed external action (H2)');
    if (EMBODIMENT.test(text)) err(w, 'no human-embodiment claims in micro-talk (H6)');
    if (defs.some((d) => d.family === 'sidetalk') && (declared.includes('owner_name') || OWNER_TALK.test(text))) err(w, 'side-talk never talks about the owner (H4)');
    if (intentKeys.includes('sympathy') && SHARED_EXPERIENCE.test(text)) err(w, 'sympathy never claims shared experience (H7)');
    for (const phrase of GLOBAL_NEVER_SAYS) if (containsPhrase(text, phrase)) err(w, `uses globally banned phrase "${phrase}"; no agent can ever say it`);
    if (intentKeys.some((k) => !SIDETALK_INTENTS.has(k))) for (const phrase of GLOBAL_NEVER_SAYS_OWNER_FACING) if (containsPhrase(text, phrase)) err(w, `"${phrase}" is never said to the owner (E12); it is filtered out of owner-facing intents`);
    for (const phrase of opts.neverSays ?? []) if (containsPhrase(text, phrase)) err(w, `uses its own never_says phrase "${phrase}"`);

    // fit: what a reflex may presuppose, promise or invent (critique E4, E14-E25)
    const has = (c) => ctx.includes(c);
    const inIntent = (...ks) => intentKeys.some((k) => ks.includes(k));
    if (inIntent('thinking_filler', 'holding_filler') && QUESTION_PRAISE.test(text) && !has('owner_question')) err(w, 'praises a question before any model read the turn; add context owner_question (E4)');
    if (inIntent('encouragement') && QUESTION_PRAISE_ENC.test(text) && !has('owner_question')) err(w, 'answers a question the owner may not have asked; add context owner_question (E4)');
    if (inIntent('gratitude_reply') && THANKS_BACK.test(text) && !has('owner_praise')) err(w, 'thanks back or plays modest, which fits praise, not a plain thanks; add context owner_praise (E4)');
    if (inIntent('acknowledge') && EVALUATIVE_ACK.test(text) && !has('!owner_tone:negative') && !has('owner_tone:positive')) err(w, 'an evaluative acknowledgement lands on bad-news requests too; add context !owner_tone:negative (E4)');
    if (inIntent('unblocked') && UNBLOCK_THANKS.test(text) && !has('unblocked_by:owner')) err(w, 'thanks the owner for an unblock that may be a retry or a coworker; add context unblocked_by:owner (E18)');
    if (inIntent('greeting') && has('part_of_day:evening') && EVENING_NAG.test(text)) err(w, 'an evening greeting that nags about brevity or rest; that belongs to part_of_day:late_night (E15)');
    if (ctx.some((c) => /^weekday:/.test(c)) && !ctx.some((c) => /^workweek:/.test(c)) && WEEK_ASSUMPTION.test(text)) err(w, 'assumes a Monday-Friday week; use workweek:first_day / workweek:last_day instead of weekday:* (E14)');
    if (inIntent('greeting') && REPORT_PROMISE.test(text) && !has('has_updates')) err(w, 'promises a report; add context has_updates (E24)');
    if (STEP_SPLICE.test(text) && !has('step_ing')) err(w, 'splices {step_label} in as a predicate; add context step_ing (E23)');
    if (inIntent('passing_by', 'micro_status') && ACTIVITY_TAIL.test(text)) warn('activity-tail', w, 'names a second activity after the real step; keep the tail to manner, not action (E16)');
    if (inIntent('juggling') && !inText.includes('other_thread') && !has('in_meeting') && (JUGGLE_INVENTED.test(text) || /mid-call/i.test(text))) err(w, 'names another thread without {other_thread} or in_meeting; juggling never invents the contention (E16)');
    if (inIntent('sidetalk_reply') && !ctx.some((c) => c.startsWith('reply_to:'))) err(w, 'a side-talk reply needs reply_to:<opener> or reply_to:any (E7)');
    if (inIntent('passing_by') && has('idle') && SOLICITS.test(text) && !line.solicits) err(w, 'an idle line that asks the owner for work; set solicits: true (E25)');
    if (line.lang !== undefined) {
      if (!line.gloss) err(w, 'a line with lang needs a gloss (E17)');
      if (!line.tags?.openai?.instructions) warn('lang-voice', w, 'lang line without tags.openai.instructions: never voiced until a clip is pronunciation-checked (E17)');
    } else if (NON_ENGLISH.test(text)) err(w, 'non-English words need lang and a gloss (E17)');
    if (opts.firstName) {
      // A self-introduction ("I'm X", "X here", "X, <role>.") must use {self_name} or the current catalog first name,
      // so a catalog rename can never leave an agent introducing itself by an old name (E16).
      for (const m of text.matchAll(/(?<![\p{L}])(?:I'm|I am)\s+([A-Z][\p{Ll}-]+)(?=[,.!?—–]|\s+(?:here|and|from|the|your|on)\b|$)|(?:^|[.,!?—–]\s)([A-Z][\p{Ll}-]+)(?= here\b)/gu)) {
        const name = m[1] ?? m[2];
        if (name && name !== opts.firstName && !SELF_INTRO_STOP.has(name)) err(w, `introduces itself as "${name}", not the catalog first name "${opts.firstName}"; use {self_name} (E16)`);
      }
      if (containsPhrase(text, opts.firstName) && defs.every((d) => d.slots.includes('self_name'))) warn('self-name', w, `hard-codes "${opts.firstName}"; use {self_name} so a rename cannot break it (E16)`);
    }
    if (!opts.archetype && (opts.catchphrase || intentKeys.some((k) => HIGH_FREQ.has(k))) && TIC_WORDS.test(text) && line.max_per_day === undefined && !line.family) warn('uncapped-tic', w, 'a tic word in a high-frequency intent with no max_per_day or family (E2, E21)');
  }

  /** Exact duplicates within a pack are errors; case/punctuation variants within one intent are warnings. */
  function checkDuplicates(where, entries) {
    const exact = new Map();
    const near = new Map();
    const norm = (t) => t.toLowerCase().replace(/[’‘]/g, "'").replace(/[.,!?;:—–…"“”()]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const { line, intent } of entries) {
      if (typeof line.text !== 'string') continue;
      if (exact.has(line.text)) err(`${where} ${line.id}`, `duplicate text "${line.text}" (also ${exact.get(line.text)})`);
      else exact.set(line.text, line.id);
      const k = `${intent}|${norm(line.text)}`;
      if (near.has(k) && near.get(k).text !== line.text) warn('near-duplicate', `${where} ${line.id}`, `"${line.text}" differs from ${near.get(k).id} only in case or punctuation`);
      else if (!near.has(k)) near.set(k, { id: line.id, text: line.text });
    }
  }

  /** Opener variety (§4.6) and, for archetype packs (the shared base), mood coverage per intent: warnings only. */
  function checkVariety(where, intent, lines, moodCoverage = false) {
    if (lines.length >= 6) {
      const openers = new Map();
      for (const l of lines) {
        const o = String(l.text).trim().replace(/^[("'“‘¡¿\s]+/, '').match(/^(\{[a-z_]+\}|[^\s,.!?;:—–…)]+)/i)?.[1]?.toLowerCase() ?? '';
        openers.set(o, (openers.get(o) ?? 0) + 1);
      }
      const [top, n] = [...openers.entries()].filter(([o]) => !o.startsWith("{")).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
      if (n / lines.length > 0.4) warn('openers', `${where} ${intent}`, `${n} of ${lines.length} lines open with "${top}"`);
    }
    if (moodCoverage && lines.length >= 4) {
      // The mood plane: a pack whose lines for an intent sit within a narrow energy band gives the mood model
      // nothing to choose between (moodFit differs by < 10 % across them). Aggregated into one warning per pack.
      const e = lines.map((l) => l.mood?.energy).filter((x) => typeof x === 'number');
      if (e.length === lines.length && Math.max(...e) - Math.min(...e) < 0.4) narrowMood.set(where, [...(narrowMood.get(where) ?? []), intent]);
    }
  }

  for (const a of archetypes.values()) {
    for (const [intent, lines] of Object.entries(a.exemplars ?? {})) {
      for (const l of lines) { counts.exemplar++; checkLine(`${rel(archetypesPath)}#${a.id}`, l, `ex-${a.id}`, [intent]); }
    }
  }

  const packsById = new Map();
  const archetypeLines = new Map(); // archetype → intent → lines
  for (const { p, d } of packFiles) {
    const where = rel(p);
    if (!archetypeOk(where, d.id)) continue;
    if (packsById.has(d.id)) { err(where, `second pack for ${d.id}`); continue; }
    packsById.set(d.id, { p, d });
    const byIntent = new Map();
    archetypeLines.set(d.id, byIntent);
    const entries = [];
    for (const [intent, lines] of Object.entries(d.intents ?? {})) {
      if (!intentOk(where, intent)) continue;
      byIntent.set(intent, lines);
      for (const l of lines) {
        counts.archetype++;
        perIntent[intent].archetype++;
        checkLine(where, l, d.id, [intent], { archetype: archetypes.get(d.id) });
        entries.push({ line: l, intent });
      }
      checkVariety(where, intent, lines, true);
    }
    checkDuplicates(where, entries);
    for (const i of intents.values()) {
      const n = d.intents?.[i.id]?.length ?? 0;
      if (n < i.quota.archetype) gate('quota-archetype', where, `${i.id}: ${n} lines, quota ${i.quota.archetype}`);
    }
  }
  for (const id of archetypes.keys()) if (!packsById.has(id)) gate('coverage', 'catalog/expressions/packs/', `missing archetype pack ${id}.json`);
  for (const [where, list] of narrowMood) warn('mood-coverage', where, `${list.length} of ${intents.size} intents keep every line's mood.energy within 0.4, so mood barely changes line choice (§4.6): ${list.join(', ')}`);

  const signed = new Map(); // persona/lead id → { pack, file }
  const sigAll = []; // every signature line and catchphrase: { pack, intent, line }
  for (const { p, d } of sigFiles) {
    for (const pack of d.packs ?? []) {
      const id = pack.persona_id;
      const where = `${rel(p)}#${id}`;
      const isLead = String(id).startsWith('lead-');
      const persona = personas.get(id);
      if (isLead ? leads.size && !leads.has(id) : personas.size && !persona) err(where, `unknown ${isLead ? 'lead' : 'persona'} id "${id}" (not in catalog/${isLead ? 'leads' : 'personas'})`);
      if (isLead && d.group !== 'leads') err(where, 'lead packs live in catalog/expressions/leads.json');
      if (!isLead && d.group === 'leads') err(where, 'only lead packs live in leads.json');
      if (!isLead && persona && persona.department !== d.group) err(where, `persona belongs in catalog/expressions/personas/${persona.department}.json`);
      if (signed.has(id)) { err(where, `second signature pack for ${id} (also in ${signed.get(id).file})`); continue; }
      signed.set(id, { pack, file: rel(p), isLead });
      const firstName = String((isLead ? leads.get(id)?.name : persona?.name) ?? '').trim().split(/\s+/)[0] || null;
      for (const n of pack.never_says ?? []) if (/[()]/.test(n)) err(`${where} never_says`, `"${n}" has a parenthetical qualifier, so it never matches; write the phrase itself (E12)`);
      for (const k of Object.keys(pack.archetypes ?? {})) archetypeOk(where, k);
      if (!sumOk(pack.archetypes)) err(where, 'archetype weights must sum to 1');
      for (const k of Object.keys(pack.intent_weights ?? {})) intentOk(`${where} intent_weights`, k);
      for (const k of pack.disabled_intents ?? []) {
        intentOk(`${where} disabled_intents`, k);
        if (pack.lines?.[k]?.length) warn('dead-lines', where, `${k} is disabled but has ${pack.lines[k].length} lines`);
      }
      const ls = pack.laugh_style;
      if (ls?.xai !== undefined) {
        if (readable(ls.xai) !== '') err(`${where} laugh_style`, 'xai must be tags only');
        for (const problem of auditTags(ls.xai)) err(`${where} laugh_style`, `xai: ${problem}`);
      }
      if (ls && ls.kind !== 'silent_smile' && !ls.openai?.say) warn('nonverbal-say', `${where} laugh_style`, 'no openai.say; OpenAI voices fall back to face-only');
      if (ls?.caption && !/^\(.+\)$/.test(ls.caption)) warn('laugh-caption', `${where} laugh_style`, `caption "${ls.caption}" should be parenthesised, e.g. "(chuckles)"`);
      const entries = [];
      for (const [intent, lines] of Object.entries(pack.lines ?? {})) {
        if (!intentOk(where, intent)) continue;
        for (const l of lines) {
          counts.signature++;
          perIntent[intent].signature++;
          checkLine(where, l, id, [intent], { neverSays: pack.never_says, firstName });
          entries.push({ line: l, intent });
          sigAll.push({ pack: id, intent, line: l });
        }
        checkVariety(where, intent, lines);
      }
      for (const c of pack.catchphrases ?? []) {
        counts.catchphrase++;
        for (const k of c.intents ?? []) if (perIntent[k]) perIntent[k].catchphrase++;
        checkLine(where, c, id, c.intents ?? [], { neverSays: pack.never_says, catchphrase: true, firstName });
        entries.push({ line: c, intent: 'catch' });
        sigAll.push({ pack: id, intent: 'catch', line: c });
      }
      checkDuplicates(where, entries);
      const lead = leads.get(id);
      for (const word of lead?.communication?.words_they_avoid ?? []) {
        // A qualified word ("failure (about a person)") is written in never_says as concrete phrases (E12): any entry
        // containing the bare word counts.
        const bare = word.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
        const covered = (pack.never_says ?? []).some((n) => n.toLowerCase() === word.toLowerCase() || (bare !== word.toLowerCase() && containsPhrase(n, bare)));
        if (!covered) warn('never-says', where, `never_says is missing lead word_they_avoid "${word}"`);
      }
      for (const i of intents.values()) {
        const need = i.quota.signature * (isLead ? 2 : 1);
        const n = pack.lines?.[i.id]?.length ?? 0;
        if (n < need && !(pack.disabled_intents ?? []).includes(i.id)) gate('quota-signature', where, `${i.id}: ${n} signature lines, quota ${need}`);
      }
    }
  }

  // ── distinctness (E22): a signature line many personas share is not a signature ──
  const normText = (t) => String(t).toLowerCase().replace(/[’‘]/g, "'").replace(/[.,!?;:—–…"“”()]/g, ' ').replace(/\s+/g, ' ').trim();
  const archTexts = new Set();
  for (const [, byIntent] of archetypeLines) for (const [intent, ls] of byIntent) for (const l of ls) archTexts.add(`${intent}|${normText(l.text)}`);
  const sigTexts = new Map();
  for (const x of sigAll) {
    if (x.intent === 'catch' || typeof x.line.text !== 'string') continue;
    const k = `${x.intent}|${normText(x.line.text)}`;
    if (!sigTexts.has(k)) sigTexts.set(k, []);
    sigTexts.get(k).push(x);
  }
  for (const [k, list] of sigTexts) {
    const loud = list.filter((x) => (x.line.weight ?? 1) > 0.6);
    const packs = new Set(list.map((x) => x.pack)).size;
    if (archTexts.has(k)) for (const x of loud) warn('distinct', `${x.pack} ${x.line.id}`, `"${x.line.text}" duplicates an archetype line; give it weight 0.6 or drop it (E22)`);
    else if (packs >= 4) for (const x of loud) warn('distinct', `${x.pack} ${x.line.id}`, `"${x.line.text}" is in ${packs} signature packs; weight 0.6 or move it into an archetype pack (E22)`);
  }
  for (const [name, re] of WRITER_TICS) {
    const who = [...new Set(sigAll.filter((x) => typeof x.line.text === 'string' && re.test(x.line.text)).map((x) => x.pack))];
    if (who.length >= 3) warn('writer-tic', name, `used by ${who.length} personas (${who.slice(0, 6).join(', ')}${who.length > 6 ? ', …' : ''}); keep it to two (E22)`);
  }

  // ── coverage ──
  const missingPersonas = [...personas.keys()].filter((id) => !signed.has(id));
  const missingLeads = [...leads.keys()].filter((id) => !signed.has(id));
  for (const id of missingPersonas) gate('coverage', 'catalog/expressions/personas/', `no signature pack for persona ${id} (${personas.get(id).department})`);
  for (const id of missingLeads) gate('coverage', 'catalog/expressions/leads.json', `no signature pack for lead ${id}`);

  // Live slider normalisation and derived blends (packs without `archetypes` fall back to them).
  let live = archetypesFile.normalization;
  if (personas.size) {
    const rows = [...[...personas.values()].map((p) => p.personality.sliders), ...[...leads.values()].map((l) => l.personality.sliders)];
    live = sliderStats(rows);
    for (const k of SLIDERS) {
      if (Math.abs(live.mean[k] - archetypesFile.normalization.mean[k]) > 1.5 || Math.abs(live.std[k] - archetypesFile.normalization.std[k]) > 1.5) {
        warn('normalization', rel(archetypesPath), `normalization.${k} drifted from the catalog (mean ${live.mean[k].toFixed(1)}, std ${live.std[k].toFixed(1)}); update the fallback values`);
      }
    }
  }
  const blendOf = (id) => {
    const sig = signed.get(id)?.pack;
    if (sig?.archetypes) return sig.archetypes;
    if (archetypesFile.lead_blends?.[id]) return archetypesFile.lead_blends[id];
    const p = personas.get(id) ?? leads.get(id);
    if (!p?.personality?.sliders) return {};
    return deriveBlend({ sliders: p.personality.sliders, traits: p.personality.traits ?? [], roles: p.team_roles ?? [], seniority: p.seniority }, archetypesFile, live);
  };

  // Effective candidate pool per agent × intent: own lines + catchphrases + blended archetype lines, minus
  // never_says hits (persona list + global list). Mirrors buildAgentIndex's candidate set before state filters.
  const THIN = 4;
  const thin = [];
  const dominantCount = new Map();
  for (const id of [...leads.keys(), ...personas.keys()]) {
    const sig = signed.get(id)?.pack;
    const blend = blendOf(id);
    const dom = Object.entries(blend).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (dom) dominantCount.set(dom, (dominantCount.get(dom) ?? 0) + 1);
    const never = [...(sig?.never_says ?? []), ...GLOBAL_NEVER_SAYS];
    for (const intent of intents.keys()) {
      if ((sig?.disabled_intents ?? []).includes(intent) || sig?.intent_weights?.[intent] === 0) continue;
      const pool = [
        ...(sig?.lines?.[intent] ?? []),
        ...(sig?.catchphrases ?? []).filter((c) => (c.intents ?? []).includes(intent)),
        ...Object.keys(blend).flatMap((a) => archetypeLines.get(a)?.get(intent) ?? []),
      ].filter((l) => typeof l.text === 'string' && !overBudget.has(l) && !never.some((n) => containsPhrase(l.text, n)));
      const open = pool.filter((l) => !(l.context ?? []).some((c) => !c.startsWith('!')) && !(l.slots ?? []).length).length;
      if (pool.length < THIN) thin.push({ id, intent, pool: pool.length, open });
    }
  }
  for (const t of thin) warn('thin-pool', t.id, `${t.intent}: only ${t.pool} selectable candidate lines after never_says and max_ms (${t.open} need no slot or context)`);

  // ── totals ──
  const lines = [];
  const total = counts.archetype + counts.signature + counts.catchphrase;
  lines.push('');
  lines.push(`Totals: ${total} lines (archetype ${counts.archetype} · signature ${counts.signature} · catchphrases ${counts.catchphrase}) + ${counts.exemplar} exemplars`);
  lines.push('');
  lines.push('Lines per intent             archetype  signature  catch   total  (archetype quota × 12)');
  for (const [k, c] of Object.entries(perIntent)) {
    const q = intents.get(k).quota.archetype;
    lines.push(`  ${k.padEnd(26)} ${String(c.archetype).padStart(9)} ${String(c.signature).padStart(10)} ${String(c.catchphrase).padStart(6)} ${String(c.archetype + c.signature + c.catchphrase).padStart(7)}  ${String(q * 12).padStart(5)}`);
  }
  lines.push('');
  lines.push('Lines per archetype          pack lines  intents<quota  exemplars  dominant for');
  for (const [id, a] of archetypes) {
    const pack = packsById.get(id)?.d;
    const n = Object.values(pack?.intents ?? {}).reduce((s, x) => s + x.length, 0);
    const under = [...intents.values()].filter((i) => (pack?.intents?.[i.id]?.length ?? 0) < i.quota.archetype).length;
    const ex = Object.values(a.exemplars ?? {}).reduce((s, x) => s + x.length, 0);
    lines.push(`  ${id.padEnd(26)} ${String(pack ? n : 'missing').padStart(10)} ${String(under).padStart(14)} ${String(ex).padStart(10)}  ${String(dominantCount.get(id) ?? 0).padStart(4)} agents`);
  }
  lines.push('');
  lines.push('Packs per department         personas  packs  lines  missing');
  const deptRows = [...departments].sort().map((dep) => {
    const ids = [...personas.values()].filter((p) => p.department === dep).map((p) => p.id);
    const have = ids.filter((id) => signed.has(id));
    const n = have.reduce((s, id) => { const pk = signed.get(id).pack; return s + Object.values(pk.lines ?? {}).reduce((a, x) => a + x.length, 0) + (pk.catchphrases?.length ?? 0); }, 0);
    return { dep, personas: ids.length, packs: have.length, lines: n };
  });
  for (const r of deptRows) lines.push(`  ${r.dep.padEnd(26)} ${String(r.personas).padStart(8)} ${String(r.packs).padStart(6)} ${String(r.lines).padStart(6)} ${String(r.personas - r.packs).padStart(8)}`);
  const leadLines = [...leads.keys()].filter((id) => signed.has(id)).reduce((s, id) => { const pk = signed.get(id).pack; return s + Object.values(pk.lines ?? {}).reduce((a, x) => a + x.length, 0) + (pk.catchphrases?.length ?? 0); }, 0);
  lines.push(`  ${'leads'.padEnd(26)} ${String(leads.size).padStart(8)} ${String(leads.size - missingLeads.length).padStart(6)} ${String(leadLines).padStart(6)} ${String(missingLeads.length).padStart(8)}`);
  lines.push('');
  lines.push('Coverage gaps');
  lines.push(`  personas without a signature pack: ${missingPersonas.length ? missingPersonas.join(', ') : 'none'}`);
  lines.push(`  leads without a signature pack:    ${missingLeads.length ? missingLeads.join(', ') : 'none'}`);
  lines.push(`  archetype packs missing:           ${[...archetypes.keys()].filter((id) => !packsById.has(id)).join(', ') || 'none'}`);
  const archUnder = [];
  for (const [id] of archetypes) for (const i of intents.values()) { const n = packsById.get(id)?.d.intents?.[i.id]?.length ?? 0; if (n < i.quota.archetype) archUnder.push(`${id}/${i.id} ${n}<${i.quota.archetype}`); }
  lines.push(`  archetype intents under quota:     ${archUnder.length ? archUnder.join(', ') : 'none'}`);
  const sigUnder = new Map();
  for (const [id, { pack, isLead }] of signed) for (const i of intents.values()) {
    const need = i.quota.signature * (isLead ? 2 : 1);
    if ((pack.lines?.[i.id]?.length ?? 0) < need && !(pack.disabled_intents ?? []).includes(i.id)) sigUnder.set(i.id, [...(sigUnder.get(i.id) ?? []), id]);
  }
  lines.push(`  signature intents under quota:     ${sigUnder.size ? [...sigUnder].map(([k, v]) => `${k} (${v.length} packs)`).join(', ') : 'none'}`);
  const thinByIntent = new Map();
  for (const t of thin) thinByIntent.set(t.intent, (thinByIntent.get(t.intent) ?? 0) + 1);
  lines.push(`  thin candidate pools (< ${THIN}):     ${thin.length ? [...thinByIntent].map(([k, v]) => `${k} (${v} agents)`).join(', ') : 'none'}`);
  const overByIntent = new Map();
  for (const l of overBudget) { const k = String(l.id).split('.')[1]; overByIntent.set(k, (overByIntent.get(k) ?? 0) + 1); }
  const unusedSlots = [...slotVocab].filter((x) => !slotUse.has(x));
  lines.push(`  slots no line uses:                ${unusedSlots.length ? `${unusedSlots.join(', ')} (gist is appended to side-talk openers at runtime; client is allowed by no intent)` : 'none'}`);
  lines.push(`  slot-free lines over max_ms:       ${overBudget.size ? `${overBudget.size} (${[...overByIntent].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')})` : 'none'}`);

  if (args.has('--blends')) {
    const top = new Map(), any = new Map();
    const out = [];
    for (const p of personas.values()) {
      const b = deriveBlend({ sliders: p.personality.sliders, traits: p.personality.traits, roles: p.team_roles, seniority: p.seniority }, archetypesFile, live);
      const ids = Object.keys(b);
      top.set(ids[0], (top.get(ids[0]) ?? 0) + 1);
      for (const id of ids) any.set(id, (any.get(id) ?? 0) + 1);
      out.push(`  ${p.id.padEnd(34)} ${Object.entries(b).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ')}`);
    }
    console.log('Derived blends (personas):');
    console.log(out.join('\n'));
    console.log('Leads (lead_blends · derived):');
    for (const l of leads.values()) {
      const d = deriveBlend({ sliders: l.personality.sliders, traits: l.personality.traits }, archetypesFile, live);
      const set = archetypesFile.lead_blends?.[l.id] ?? {};
      console.log(`  ${l.id.padEnd(34)} ${Object.entries(set).map(([k, v]) => `${k} ${v}`).join(' · ')}   |   ${Object.entries(d).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ')}`);
    }
    const fmt = (m) => SCHEMA_ARCHETYPES.map((id) => `${id} ${m.get(id) ?? 0}`).join(', ');
    console.log(`Top archetype counts: ${fmt(top)}`);
    console.log(`Appears in blend:     ${fmt(any)}`);
    const never = SCHEMA_ARCHETYPES.filter((id) => !any.get(id));
    if (never.length) warn('blends', rel(archetypesPath), `archetypes never derived for any persona: ${never.join(', ')}`);
  }

  report({
    totals: lines,
    summary: {
      files: { intents: 1, archetypes: 1, archetype_packs: packFiles.length, signature_files: sigFiles.length },
      intents: intents.size,
      archetypes: archetypes.size,
      signature_packs: signed.size,
      lines: { total, ...counts },
      per_intent: perIntent,
      per_department: Object.fromEntries(deptRows.map((r) => [r.dep, { personas: r.personas, packs: r.packs, lines: r.lines }])),
      coverage: { lines_over_max_ms: overBudget.size, unused_slots: unusedSlots, personas_without_pack: missingPersonas, leads_without_pack: missingLeads, archetype_intents_under_quota: archUnder, signature_intents_under_quota: Object.fromEntries([...sigUnder].map(([k, v]) => [k, v.length])), thin_pools: thin },
    },
  });

  function report(extra = {}) {
    const nWarn = [...warnings.values()].reduce((a, b) => a + b.length, 0);
    if (!QUIET) {
      for (const [rule, msgs] of [...warnings].sort()) {
        const shown = VERBOSE ? msgs : msgs.slice(0, 5);
        console.warn(`warn  [${rule}] ${msgs.length} warning${msgs.length === 1 ? '' : 's'}`);
        for (const m of shown) console.warn(`        ${m}`);
        if (shown.length < msgs.length) console.warn(`        … ${msgs.length - shown.length} more (--verbose)`);
      }
    }
    for (const e of errors) console.error(`error ${e}`);
    if (!QUIET && extra.totals) console.log(extra.totals.join('\n'));
    const s = extra.summary;
    console.log(`\nexpressions: ${s?.intents ?? '?'} intents, ${s?.archetypes ?? '?'} archetypes, ${s?.files.archetype_packs ?? '?'} archetype packs, ${s?.signature_packs ?? '?'} signature packs, ${s?.lines.total ?? '?'} lines · ${errors.length} errors, ${nWarn} warnings`);
    if (JSON_OUT) console.log(JSON.stringify({ errors: errors.length, warnings: nWarn, ...(s ?? {}) }));
    process.exitCode = errors.length ? 1 : 0;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
