// Huddle small talk (docs/dev/OFFICE-LIFE.md §3, §5, §6.2): pre-authored exchanges of 2–4 turns for office huddles.
// Exchanges are cast to the people present by personality, grounded only in real team-visible events, kept fresh
// across days (floor-wide daily and weekly caps, a 14-day memory per participant), filled, timed for bubbles, and
// mapped onto the existing delivery helpers for listen-in voice. Pure, isomorphic and deterministic: the same
// compiled huddles, request and recency always give the same pick. Nothing here plays, shows or records anything.
import type { PresenceState } from '@headcount/protocol';
import { containsPhrase, ExpressionCatalogError, laughXaiFor } from './catalog';
import { fillKeyOf } from './delivery';
import { base32Int, cyrb53, fnv1a32, seededRng } from './hash';
import { catalogInternalsOf, clamp, num } from './internal';
import { estimateMs, laughCaption } from './lines';
import { BANNED_TAGS, instructionsFromTags, openaiInputFromXai, placeholders, readable, speakable, stripMarkupChars } from './markup';
import { ownerDayKey } from './select';
import { deriveContexts, partOfDay, sanitizeGist, sanitizeSlotValue, weekdayName } from './state';
import type { AgentIndex, CauseRef, CompiledCatalog, GroundingState, LaughStyle, MoodFit, SlotValues, Utterance } from './types';
import { GLOBAL_NEVER_SAYS, isArchetypeId } from './vocab';
import type { Ambience, ArchetypeId, FaceGesture, Mood, TeamRole, TtsProvider } from './vocab';

// ── vocabulary ──────────────────────────────────────────────────────────────────
export type HuddleSpot = 'water_cooler' | 'coffee_bar' | 'lounge' | 'library' | 'phone_booth' | 'desk_dropby' | 'hallway' | 'window';
export type HuddleTopic = 'craft' | 'debate' | 'tools' | 'ideas' | 'self_aware' | 'office' | 'owner_projects' | 'wins' | 'welcome';
export type HuddleRole = 'A' | 'B' | 'C';
export type HuddleSlot = 'name_a' | 'name_b' | 'name_c' | 'chief_name' | 'part_of_day' | 'weekday' | 'coworker' | 'project' | 'artifact' | 'gist';
export type HuddleEventKind = 'job.done' | 'deliverable.accepted' | 'verdict.approve' | 'project.done' | 'project.active' | 'hired';
export type HuddleWho = 'A' | 'B' | 'either' | 'other';
export type HuddlePair = 'well' | 'tension' | 'any';

export const HUDDLE_SPOTS: readonly HuddleSpot[] = Object.freeze(['water_cooler', 'coffee_bar', 'lounge', 'library', 'phone_booth', 'desk_dropby', 'hallway', 'window']);
export const HUDDLE_TOPICS: readonly HuddleTopic[] = Object.freeze(['craft', 'debate', 'tools', 'ideas', 'self_aware', 'office', 'owner_projects', 'wins', 'welcome']);
export const HUDDLE_ROLES: readonly HuddleRole[] = Object.freeze(['A', 'B', 'C']);
export const HUDDLE_SLOTS: readonly HuddleSlot[] = Object.freeze(['name_a', 'name_b', 'name_c', 'chief_name', 'part_of_day', 'weekday', 'coworker', 'project', 'artifact', 'gist']);
/** Slots whose values come only from a real event: grounded exchanges only (§5.3). */
export const HUDDLE_GROUNDED_SLOTS: readonly HuddleSlot[] = Object.freeze(['coworker', 'project', 'artifact', 'gist']);
export const HUDDLE_EVENT_KINDS: readonly HuddleEventKind[] = Object.freeze(['job.done', 'deliverable.accepted', 'verdict.approve', 'project.done', 'project.active', 'hired']);
/** Events that certify finished work: only these ground completion words ("came through", "out of my queue"). */
export const HUDDLE_COMPLETION_EVENTS: readonly HuddleEventKind[] = Object.freeze(['job.done', 'deliverable.accepted', 'verdict.approve', 'project.done']);
/** Huddle-only contexts on top of the expressions context vocabulary (§5.3). */
export const HUDDLE_CONTEXTS: readonly string[] = Object.freeze(['crew', 'first_today', 'same_department', 'cross_department', 'night', 'spot_empty']);
/** Exchanges whose mood fit is at or below this valence are "sad": they play only on a real low day (§5.6). */
export const HUDDLE_SAD_VALENCE = -0.2;
/** Sad exchanges need the participants' mean valence below this, and pushed there by real events (below baseline). */
export const HUDDLE_SAD_GATE = -0.1;
/** Floor-wide weekly cap for ungrounded exchanges (grounded ones keep 2: their events refresh them). */
export const HUDDLE_WEEKLY_CAP = 4;
/** Authored text limit (write to ≤ 60) and the filled-caption limit a bubble can show in two lines. */
export const HUDDLE_TEXT_MAX_CHARS = 90;
export const HUDDLE_CAPTION_MAX_CHARS = 100;
/** A participant never hears the same exchange twice within this window, when alternatives exist (§6.2). */
export const HUDDLE_PARTICIPANT_MEMORY_MS = 14 * 86_400_000;

const FACE_GESTURES: readonly FaceGesture[] = ['none', 'nod', 'double_nod', 'look_up', 'brow_flash', 'head_tilt', 'smile', 'wince', 'exhale', 'glance', 'still'];
const TEAM_ROLES: readonly TeamRole[] = ['lead', 'co_owner', 'reviewer', 'sceptic', 'facilitator', 'specialist'];
const WEEK_MS = 7 * 86_400_000;
const HOUR_MS = 3_600_000;
const NAME_MAX = 24;
/** Default age windows per event kind when an exchange sets no `max_age_h` (§3.7: wins 8 h, welcome 48 h). */
const DEFAULT_MAX_AGE_H: Readonly<Record<HuddleEventKind, number>> = {
  'job.done': 8, 'deliverable.accepted': 8, 'verdict.approve': 8, 'project.done': 24, 'project.active': 72, hired: 48,
};
const SMALL_TALK_HINT = 'Casual small talk with a colleague: relaxed, conversational, a little quieter.';
const LAUGH_HINT = 'A natural, genuine laugh.';
const DEFAULT_LAUGH: LaughStyle = { kind: 'chuckle', intensity: 0.3, readiness: 0.5, caption: '(chuckles)' };

// ── catalog file shapes (catalog/schema/expression-pack.schema.json $defs/huddle_pack) ──────────────────────
export interface HuddleRoleDef {
  archetypes?: ArchetypeId[]; departments?: string[]; team_roles?: TeamRole[]; chief?: boolean; in_event?: boolean;
  /** Desk drop-bys: true casts the colleague at their own desk (the host), false the one who dropped by. */
  at_desk?: boolean;
}
export interface HuddleLineDef {
  role: HuddleRole; text?: string; laugh?: true; face?: FaceGesture;
  tags?: { xai?: string; openai?: { instructions?: string; say?: string } };
  slots?: HuddleSlot[]; pause_ms?: number;
}
export interface HuddleRequiresDef { events: HuddleEventKind[]; who?: HuddleWho; max_age_h?: number }
export interface HuddleExchangeDef {
  id: string; spots: HuddleSpot[]; topics: HuddleTopic[]; roles?: Partial<Record<HuddleRole, HuddleRoleDef>>;
  size?: [number, number]; pair?: HuddlePair; mood?: MoodFit; context?: string[]; grounded?: boolean;
  requires?: HuddleRequiresDef; lines: HuddleLineDef[]; weight?: number; max_per_day?: number; max_per_week?: number; note?: string;
}
export interface HuddlePackInput {
  $schema?: string; kind: 'huddle_pack'; id: string; version: number; writer?: string; about?: string; exchanges: HuddleExchangeDef[];
}

// ── compiled shapes ─────────────────────────────────────────────────────────────
export interface CompiledHuddleLine {
  readonly index: number; readonly role: HuddleRole; readonly kind: 'line' | 'laugh' | 'face';
  /** The spoken template ('' for beats). */
  readonly text: string;
  readonly xai: string;
  readonly openai: { readonly say: string; readonly instructions: string | null };
  readonly face: FaceGesture | null;
  readonly slots: readonly HuddleSlot[];
  readonly pauseMs: number | null;
}
export interface CompiledExchange {
  readonly id: string; readonly packId: string;
  readonly spots: readonly HuddleSpot[]; readonly topics: readonly HuddleTopic[];
  /** The primary topic (the first listed). */
  readonly topic: HuddleTopic;
  readonly roles: Readonly<Partial<Record<HuddleRole, Readonly<HuddleRoleDef>>>>;
  /** Roles that take a turn, in A, B, C order: the people an exchange casts. */
  readonly rolesUsed: readonly HuddleRole[];
  /** [min, max] people present; extra people listen. */
  readonly size: readonly [number, number];
  readonly pair: HuddlePair; readonly mood: MoodFit | null;
  readonly require: readonly string[]; readonly forbid: readonly string[];
  readonly grounded: boolean;
  readonly requires: { readonly events: readonly HuddleEventKind[]; readonly who: HuddleWho; readonly maxAgeMs: number } | null;
  readonly lines: readonly CompiledHuddleLine[];
  /** Every slot any line uses. */
  readonly slots: readonly HuddleSlot[];
  readonly weight: number; readonly maxPerDay: number; readonly maxPerWeek: number;
  readonly hasLaugh: boolean;
  /** A low-mood exchange (mood.valence ≤ HUDDLE_SAD_VALENCE): only on a real low day, one per floor per day. */
  readonly sad: boolean;
}
export interface CompiledHuddles {
  /** `h1_…`: a content hash over the packs, independent of file order. */
  readonly version: string;
  readonly exchanges: readonly CompiledExchange[];
  /** The expressions catalog the huddles were compiled against (context vocabulary, archetypes, defaults). */
  readonly catalog: CompiledCatalog;
  bySpot(spot: HuddleSpot): readonly CompiledExchange[];
  byId(id: string): CompiledExchange | undefined;
}

// ── runtime shapes ──────────────────────────────────────────────────────────────
export interface HuddleParticipant {
  agentId: string; firstName: string;
  /** From buildAgentIndex: blend (casting), never_says (hard filter), laugh style (laugh beats), voice (delivery). */
  index: AgentIndex;
  mood: Mood;
  department?: string; teamRoles?: readonly TeamRole[]; isChief?: boolean;
  /** At a desk drop-by: this person is at their own desk (the host). Casts `at_desk` roles. */
  atDesk?: boolean;
  /** Agent ids (the host maps catalog persona ids to agent ids). */
  pairsWellWith?: readonly string[]; tensionWith?: readonly string[];
}
export interface HuddleEvent {
  kind: HuddleEventKind; agentIds: readonly string[]; at: number;
  /** Only `team` events ever ground small talk (H3); `owner` and `whisper` are ignored. */
  visibility: 'team' | 'owner' | 'whisper';
  cause: CauseRef;
  project?: string; artifact?: string; gist?: string;
  /** First name of the teammate outside the huddle whose event it is (`who: 'other'`, `{coworker}`). */
  coworkerName?: string;
}
export interface HuddleRequest {
  huddleId: string; spot: HuddleSpot; participants: readonly HuddleParticipant[];
  /** Owner-local clock: `weekday` uses the JS convention (0 = Sunday); `workDays` as GroundingState (E14). */
  now: { epochMs: number; localHour: number; weekday: number; workDays?: readonly number[] };
  ambience: Ambience; provider: TtsProvider;
  /** The most turns this huddle has time for (the director's caps). */
  maxLines: number;
  /** Director contexts: crew, first_today (same_department, cross_department and night are also derived here). */
  contexts?: readonly string[];
  chiefName?: string | null;
  /** Recent ledger events and active projects, as the host sees them. Absent: grounded exchanges never play. */
  grounding?: { events: readonly HuddleEvent[] } | null;
  /** `${huddleId}|${exchangeIndex}`: the same seed gives the same pick on every device. */
  seed: string;
  /** Exchange ids already used in this huddle. */
  avoid?: ReadonlySet<string>;
}
export interface HuddleLinePlan {
  index: number; agentId: string; role: HuddleRole; kind: 'line' | 'laugh' | 'face';
  /** Bubble and caption text: a filled line, the speaker's own laugh caption ("(chuckles)"), or '' for a face beat. */
  caption: string;
  face?: FaceGesture;
  /** xAI rendering (tags kept, slots filled); '' when there is nothing to voice. */
  xai?: string;
  openai?: { say?: string; instructions?: string };
  /** Estimated audio length when voiced. */
  estMs: number;
  /** How long the bubble or beat holds on screen: reading time for lines (§3.2), 1.2–1.6 s laughs, 0.9 s face beats. */
  holdMs: number;
  /** Start time relative to the exchange start (the director adds the settle beat). */
  atMs: number;
  /** `${exchangeId}.${index}`, plus `|<fillKey>` when the line has fills: stable per rendering, for clip caching. */
  lineKey: string;
  fills: Readonly<Record<string, string>>;
  /** Whether this provider can voice the turn at all (face beats never; laughs not in browser speech). */
  voiceable: boolean;
}
export interface HuddlePick {
  exchangeId: string; packId: string; topic: HuddleTopic; topics: readonly HuddleTopic[];
  grounded: boolean; cause: CauseRef | null; eventKind: HuddleEventKind | null;
  spot: HuddleSpot; participants: readonly string[];
  cast: Partial<Record<HuddleRole, string>>;
  lines: readonly HuddleLinePlan[];
  fit: number; seed: string;
  /** End of the last turn relative to the exchange start. */
  durationMs: number;
}

// ── honesty lints (§5.4; mirrored byte for byte by catalog/scripts/validate-expressions.mjs lintHuddleText) ──
const HD_MARKUP = /[[\]<>]/;
const HD_EMOJI = /\p{Extended_Pictographic}/u;
const HD_STAGE = /\*[^*]+\*|\((?:laughs?|chuckles?|sighs?|smiles?|grins?|pauses?|coughs?|nods?|winks?|giggles?|snorts?|clears|shrugs?)\b[^)]*\)/i;
const HD_NUMBER = /\d|%|\bpercent\b/i;
/** Cardinal number words (a count is a checkable fact); hyphenated idioms such as "high-five" are not counts. */
const HD_NUMBER_WORD = /(?<![\w-])(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|dozens?)(?![\w-])/i;
const HD_WEATHER = /\b(weather|rain(?:s|ing|y|ed)?|sunny|sunshine|snow\w*|storm(?:s|y)?|forecast|humid\w*|cloudy|drizzl\w*|heat ?wave|freezing|degrees|windy)\b/i;
const HD_WEEKDAY = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?\b/;
const HD_PRODUCT = /\b(Slack|Excel|Google|Figma|Notion|Jira|Zoom|Microsoft|Apple|iPhone|ChatGPT|OpenAI|Anthropic|Claude|Gemini|Salesforce|HubSpot|Trello|Asana|PowerPoint|Keynote|Photoshop|Canva|Airtable|Amazon|Netflix|Spotify|Twitter|LinkedIn|Instagram|TikTok|Facebook|Starbucks|Nespresso)\b/;
const HD_OWNER = /\b(the owner|our owner|the boss|boss man|our human|my human|the human|the client said|they want)\b/i;
const HD_PUTDOWN = /\b(stupid|idiot\w*|dumb|pathetic|useless|clueless|lazy|shut up|loser|moron\w*|crazy|insane|lame|ridiculous)\b/i;
const HD_SOLICIT = /\b(bored|boring day|nothing to do|put me to work|anything for (?:me|us)|slow day|waiting for (?:work|a task|something to do))\b/i;
const HD_EMBODIMENT = /\b(coffee(?! bar)|espresso|latte|cappuccino|caffeine|tea|teas|lunch|breakfast|dinner|snacks?|eat|eats|eating|ate|eaten|food|drink|drinks|drinking|drank|thirsty|thirst|hungry|hunger|sleep|sleeps|sleeping|slept|sleepy|asleep|nap|naps|napping|tired|exhausted|commute|commuting|traffic|weekends?|go(?:ing)? home|went home|at home|my home|my family|my kids|my partner|gym|workout|bathroom|toilet|headphones|hungover|long day)\b/i;
const HD_COUNTERFACTUAL = /\bif (?:I|we) (?:had|could|were)\b|\b(?:I|we) (?:can['’]t|cannot|can not|don['’]t|do not)\b|\b(?:none|neither|not one) of us\b|\bno (?:hands|taste ?buds|stomach)\b|\bin theory\b|\btheoretically\b|\bpretend\w*|\ballegedly\b|\bmetaphor\w*|\bhypothetically\b|\b(?:I|we)['’]d\b[^.!?]*\bif\b/i;
const HD_NIGHT_TIRED = /\b(tired|sleep\w*|slept|asleep|long day|exhausted|bed(?:time)?|yawn\w*|knackered|wiped out)\b/i;
const HD_COMPLETION = /\b(done|finished|completed?|wrapped(?: up)?|landed|(?:came|come|comes) through|shipped|delivered|launched|out of (?:my|the|your|our) queue|signed off|in the bag|nailed it)\b/i;
const HD_PROGRESS = /\b(working on|worked on|all (?:morning|afternoon|day|week|night)|been (?:on|at|working)|just (?:finished|wrapped|sent)|in the middle of|halfway (?:through|done|there)|(?:almost|nearly|mostly) (?:done|finished|there)|deep in|busy (?:with|day)|back-to-back|on a call|mid-call|in a meeting|my queue|my inbox)\b/i;
/** The catalog's H2 rule: canned lines never claim a completed external action, grounded or not. */
const HD_EXTERNAL_ACTION = /\b(sent|published|posted|paid|booked|deployed|shipped|signed|emailed|submitted|launched|scheduled|delivered it)\b/i;
/** Forms that are not a claim about the speaker's work (a port of the validator's NOT_A_CLAIM), removed before the completion test. */
const HD_NOT_A_CLAIM: readonly RegExp[] = [
  /\b(?:well|nicely|beautifully|brilliantly|superbly|neatly|expertly|smartly|so well|very well|really well)\s+done\b/gi,
  /\bdone\s+(?:right|properly|well|carefully|together)\b/gi,
  /\bhow\b[^.!?]*?\b(?:done|finished)\b/gi,
  /\b(?:when|once|until|till|before|as soon as|by the time|the (?:moment|minute|second))\b[^.,;:!?—–]*?\b(?:done|finished|complete|wrapped up)\b/gi,
  /\bget(?:s|ting)?\b(?:\s+[\w'’]+){0,3}?\s+done\b/gi,
  /\bhalf[- ]?(?:done|finished)\b/gi,
  /\b(?:not|never|isn['’]t|aren['’]t|wasn['’]t|won['’]t be|nothing['’]s)\s+(?:yet\s+|quite\s+|really\s+|ever\s+)?(?:done|finished|complete)\b/gi,
];

export interface HuddleLintContext {
  topics: readonly string[];
  /** The exchange is grounded (it has `requires`). */
  grounded: boolean;
  /** `requires.events` includes an event that certifies finished work. */
  completionEvent: boolean;
  /** The exchange requires a night or evening context. */
  night: boolean;
}
export interface HuddleLint { rule: string; message: string }

/** What a line asserts: questions and non-claim idioms removed (slots blanked). */
function assertedHuddleText(text: string): string {
  const sentences = String(text).replace(/\{[a-z_]+\}/g, ' ').split(/(?<=[.!?…])\s+/);
  let s = sentences.filter((x) => !/\?\s*["”’)]*\s*$/.test(x.trim())).join(' ');
  for (const re of HD_NOT_A_CLAIM) s = s.replace(re, ' ');
  return s;
}

/**
 * The §5.4 honesty and authoring lints for one spoken huddle line. Rules: markup, emoji, stage, number, weather,
 * weekday, product, owner, putdown, solicit, embodiment (self_aware counterfactuals excepted, A2), night, completion
 * (needs a completion event), progress (needs grounding), external (H2), never_says (the global list).
 */
export function lintHuddleText(text: string, ctx: HuddleLintContext): HuddleLint[] {
  const out: HuddleLint[] = [];
  const add = (rule: string, message: string) => out.push({ rule, message });
  const t = String(text);
  const bare = t.replace(/\{[a-z_]+\}/g, ' ');
  if (HD_MARKUP.test(t)) add('markup', 'text must not contain markup; put it in tags.xai');
  if (HD_EMOJI.test(t)) add('emoji', 'no emoji in captions');
  if (HD_STAGE.test(bare)) add('stage', 'no stage directions; use a laugh or face beat');
  if (HD_NUMBER.test(bare)) add('number', 'no numbers in small talk (rule 1); facts come only from grounded slots');
  const numWord = bare.match(HD_NUMBER_WORD);
  if (numWord && !ctx.grounded) add('number', `no number words in ungrounded small talk ("${numWord[0]}"): a count is a checkable fact (rule 1)`);
  const weather = bare.match(HD_WEATHER);
  if (weather) add('weather', `no weather ("${weather[0]}"): the skyline is fictional (rule 10)`);
  const weekday = bare.match(HD_WEEKDAY);
  if (weekday) add('weekday', `hard-coded weekday "${weekday[0]}"; use {weekday} or a context (rule 10)`);
  const product = bare.match(HD_PRODUCT);
  if (product) add('product', `names a real product or company ("${product[0]}") (rule 1)`);
  const owner = bare.match(HD_OWNER);
  if (owner) add('owner', `small talk never mentions the owner ("${owner[0]}") (rule 4)`);
  const putdown = bare.match(HD_PUTDOWN);
  if (putdown) add('putdown', `no put-downs or mockery ("${putdown[0]}") (rules 5, 6)`);
  const solicit = bare.match(HD_SOLICIT);
  if (solicit) add('solicit', `idle reads as pleasant availability, never boredom or asking for work ("${solicit[0]}")`);
  const body = bare.match(HD_EMBODIMENT);
  if (body && !(ctx.topics.includes('self_aware') && HD_COUNTERFACTUAL.test(bare))) {
    add('embodiment', `human-embodiment word "${body[0]}" only in self_aware lines as a counterfactual ("if I had hands") (rule 3, A2)`);
  }
  const tired = bare.match(HD_NIGHT_TIRED);
  if (ctx.night && tired) add('night', `night is not tired ("${tired[0]}") (rule 7)`);
  const done = assertedHuddleText(t).match(HD_COMPLETION);
  if (done && !ctx.completionEvent) add('completion', `completion word "${done[0]}" needs grounded requires.events with job.done, deliverable.accepted, verdict.approve or project.done (rule 2)`);
  const progress = assertedHuddleText(t).match(HD_PROGRESS);
  if (progress && !ctx.grounded) add('progress', `work-in-progress claim "${progress[0]}" only in grounded exchanges (rule 2)`);
  if (HD_EXTERNAL_ACTION.test(t)) add('external', 'canned lines never claim a completed external action (H2)');
  for (const phrase of GLOBAL_NEVER_SAYS) if (containsPhrase(t, phrase)) add('never_says', `uses globally banned phrase "${phrase}"`);
  return out;
}

// ── compile ─────────────────────────────────────────────────────────────────────
const PACK_ID = /^hd-[a-z0-9]+(-[a-z0-9]+)*$/;
const EXCHANGE_ID = /^hd-[a-z0-9]+(-[a-z0-9]+)*\.[0-9]{3}$/;
const DEPT_ID = /^[a-z][a-z0-9-]*$/;
const CONTEXT_TAG = /^!?[a-z][a-z0-9_]*(:[a-z0-9_-]+)?$/;
const NAME_SLOT: Readonly<Record<string, HuddleRole>> = { name_a: 'A', name_b: 'B', name_c: 'C' };
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
};
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function contextKnown(tag: string, keys: ReadonlySet<string>): boolean {
  if (!CONTEXT_TAG.test(tag)) return false;
  const t = tag.replace(/^!/, '');
  if (HUDDLE_CONTEXTS.includes(t) || keys.has(t)) return true;
  const head = t.split(':')[0]!;
  return t.includes(':') && keys.has(`${head}:*`);
}

/** The §5.3 field rules and §5.4 lints for one exchange (the runtime half of the validator). Empty = valid. */
function checkExchange(ex: HuddleExchangeDef, packId: string, contextKeys: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (!isObj(ex) || typeof ex.id !== 'string' || !EXCHANGE_ID.test(ex.id)) return [`bad exchange id ${JSON.stringify((ex as { id?: unknown })?.id)}`];
  if (ex.id.slice(0, ex.id.lastIndexOf('.')) !== packId) out.push(`id must start with "${packId}."`);

  const spots = Array.isArray(ex.spots) ? ex.spots : [];
  if (!spots.length) out.push('spots must list at least one spot');
  for (const s of spots) if (!HUDDLE_SPOTS.includes(s)) out.push(`unknown spot ${JSON.stringify(s)}`);
  if (new Set(spots).size !== spots.length) out.push('spots repeat');
  const topics = Array.isArray(ex.topics) ? ex.topics : [];
  if (topics.length < 1 || topics.length > 2) out.push('an exchange has 1–2 topics');
  for (const t of topics) if (!HUDDLE_TOPICS.includes(t)) out.push(`unknown topic ${JSON.stringify(t)}`);
  if (new Set(topics).size !== topics.length) out.push('topics repeat');

  const grounded = ex.grounded === true;
  if (ex.grounded !== undefined && typeof ex.grounded !== 'boolean') out.push('grounded must be a boolean');
  const req = ex.requires;
  if (grounded && !req) out.push('a grounded exchange needs requires');
  if (!grounded && req) out.push('requires only with grounded: true');
  const reqEvents = isObj(req) && Array.isArray(req.events) ? req.events : [];
  if (req) {
    if (!isObj(req)) out.push('requires must be an object');
    else {
      if (!reqEvents.length) out.push('requires.events lists at least one event');
      for (const e of reqEvents) if (!HUDDLE_EVENT_KINDS.includes(e)) out.push(`unknown event ${JSON.stringify(e)}`);
      if (new Set(reqEvents).size !== reqEvents.length) out.push('requires.events repeat');
      if (req.who !== undefined && !['A', 'B', 'either', 'other'].includes(req.who)) out.push(`requires.who ${JSON.stringify(req.who)} must be A, B, either or other`);
      if (req.max_age_h !== undefined && !(typeof req.max_age_h === 'number' && req.max_age_h >= 0.5 && req.max_age_h <= 72)) out.push('requires.max_age_h must be 0.5…72');
    }
  }
  const completionEvent = reqEvents.some((e) => HUDDLE_COMPLETION_EVENTS.includes(e));
  for (const t of ['owner_projects', 'wins', 'welcome'] as const) if (topics.includes(t) && !grounded) out.push(`topic ${t} requires grounded: true`);
  if (topics.includes('welcome') && !reqEvents.includes('hired')) out.push('topic welcome requires requires.events with hired');
  if (spots.includes('phone_booth')) out.push('no huddle exchange plays in a phone_booth: booths hold one person on a real call');

  // roles
  const roles = isObj(ex.roles) ? ex.roles : {};
  if (ex.roles !== undefined && !isObj(ex.roles)) out.push('roles must be an object');
  let chiefs = 0;
  for (const [k, r] of Object.entries(roles)) {
    if (!HUDDLE_ROLES.includes(k as HuddleRole)) { out.push(`unknown role ${k}`); continue; }
    if (!isObj(r)) { out.push(`role ${k} must be an object`); continue; }
    const def = r as HuddleRoleDef;
    for (const a of def.archetypes ?? []) if (!isArchetypeId(a)) out.push(`role ${k}: unknown archetype ${JSON.stringify(a)}`);
    if ((def.archetypes?.length ?? 0) > 4) out.push(`role ${k}: at most 4 archetypes`);
    for (const d of def.departments ?? []) if (typeof d !== 'string' || !DEPT_ID.test(d)) out.push(`role ${k}: bad department ${JSON.stringify(d)}`);
    for (const t of def.team_roles ?? []) if (!TEAM_ROLES.includes(t)) out.push(`role ${k}: unknown team role ${JSON.stringify(t)}`);
    if (def.chief !== undefined && typeof def.chief !== 'boolean') out.push(`role ${k}: chief must be a boolean`);
    if (def.chief === true) chiefs++;
    if (def.in_event !== undefined && typeof def.in_event !== 'boolean') out.push(`role ${k}: in_event must be a boolean`);
    if (def.in_event && !grounded) out.push(`role ${k}: in_event only in grounded exchanges`);
    if (def.at_desk !== undefined && typeof def.at_desk !== 'boolean') out.push(`role ${k}: at_desk must be a boolean`);
    if (def.at_desk !== undefined && !(spots.length === 1 && spots[0] === 'desk_dropby')) out.push(`role ${k}: at_desk only in exchanges that play at a desk drop-by alone`);
  }
  if (chiefs > 1) out.push('chief: true on at most one role');
  if (topics.includes('craft') && !Object.values(roles).some((r) => isObj(r) && ((r as HuddleRoleDef).departments?.length ?? 0) > 0)) {
    out.push('craft exchanges set roles.<role>.departments (rule 8)');
  }

  // lines
  const lines = Array.isArray(ex.lines) ? ex.lines : [];
  if (lines.length < 2 || lines.length > 4) out.push('an exchange has 2–4 turns');
  const used = new Set<HuddleRole>();
  let spoken = 0;
  let beats = 0;
  const night = (ex.context ?? []).some((c) => c === 'night' || c === 'part_of_day:late_night' || c === 'part_of_day:evening');
  const lintCtx: HuddleLintContext = { topics, grounded, completionEvent, night };
  lines.forEach((l, i) => {
    const w = `turn ${i}`;
    if (!isObj(l) || !HUDDLE_ROLES.includes(l.role)) { out.push(`${w}: role must be A, B or C`); return; }
    used.add(l.role);
    const kinds = [l.text !== undefined, l.laugh !== undefined, l.face !== undefined].filter(Boolean).length;
    if (kinds !== 1) out.push(`${w}: exactly one of text, laugh or face`);
    if (l.pause_ms !== undefined && !(Number.isInteger(l.pause_ms) && l.pause_ms >= 0 && l.pause_ms <= 2500)) out.push(`${w}: pause_ms must be an integer 0…2500`);
    if (l.text === undefined) {
      beats++;
      if (l.laugh !== undefined && l.laugh !== true) out.push(`${w}: laugh must be true`);
      if (l.face !== undefined && !FACE_GESTURES.includes(l.face)) out.push(`${w}: unknown face gesture ${JSON.stringify(l.face)}`);
      if (l.tags !== undefined || l.slots !== undefined) out.push(`${w}: beats take no tags or slots`);
      if (i === 0 && l.laugh) out.push('a laugh never opens an exchange');
      // The listener laughs, never the joker at their own line (§5.4 rule 5, the laugh-track review).
      const before = i > 0 ? lines[i - 1] : undefined;
      if (l.laugh && isObj(before) && typeof before.text === 'string' && before.role === l.role) out.push(`${w}: the listener laughs, not the speaker of the line before (no laughing at your own joke)`);
      // Laughter never at a person (rule 5): not right after a line about someone, and never in an exchange that
      // comments on someone's things or traits ("{name_b}'s roadmap…").
      const prev = i > 0 ? lines[i - 1] : undefined;
      if (l.laugh && isObj(prev) && typeof prev.text === 'string' && /\{(name_[abc]|coworker)\}/.test(prev.text)) {
        out.push(`${w}: a laugh right after a line that names someone reads as laughing at a person (rule 5); use a smile`);
      } else if (l.laugh && lines.some((x) => isObj(x) && typeof x.text === 'string' && /\{(name_[abc]|coworker)\}['’]s\b/.test(x.text))) {
        out.push(`${w}: no laugh in an exchange that comments on someone's things ("{name}'s …"): it reads as laughing at a person (rule 5)`);
      }
      return;
    }
    spoken++;
    if (typeof l.text !== 'string' || !l.text.trim()) { out.push(`${w}: text is empty`); return; }
    const text = l.text;
    if (/^\s|\s$|\s{2,}/.test(text)) out.push(`${w}: leading, trailing or doubled whitespace`);
    if (text.length > HUDDLE_TEXT_MAX_CHARS) out.push(`${w}: text longer than ${HUDDLE_TEXT_MAX_CHARS} characters`);
    const inText = [...new Set(placeholders(text))];
    const declared = l.slots ?? [];
    for (const s of new Set([...inText, ...declared])) if (!HUDDLE_SLOTS.includes(s as HuddleSlot)) out.push(`${w}: unknown slot {${s}}`);
    if (!sameSet(inText, declared)) out.push(`${w}: slots ${JSON.stringify(declared)} must equal placeholders ${JSON.stringify(inText)}`);
    if (placeholders(text).length !== inText.length) out.push(`${w}: a slot appears twice`);
    for (const s of inText) {
      const holder = NAME_SLOT[s];
      if (holder && holder === l.role) out.push(`${w}: {${s}} in role ${holder}'s own line`);
      if ((HUDDLE_GROUNDED_SLOTS as readonly string[]).includes(s) && !grounded) out.push(`${w}: {${s}} only in grounded exchanges`);
      if (s === 'coworker' && isObj(req) && req.who !== 'other') out.push(`${w}: {coworker} is the teammate outside the huddle: requires.who must be "other"`);
    }
    const xai = l.tags?.xai;
    if (xai !== undefined) {
      if (readable(xai) !== text) out.push(`${w}: readable(tags.xai) "${readable(xai)}" must equal text`);
      if (speakable(xai) !== xai.replace(/\s{2,}/g, ' ').trim()) out.push(`${w}: tags.xai has unknown or unbalanced tags (speakable: "${speakable(xai)}")`);
      if (BANNED_TAGS.test(xai)) out.push(`${w}: [cough] and [yawn] are not allowed`);
    }
    const say = l.tags?.openai?.say;
    if (say !== undefined && (!sameSet([...new Set(placeholders(say))], inText) || HD_MARKUP.test(say))) out.push(`${w}: tags.openai.say keeps the text's slots and has no markup`);
    if (spots.includes('library') && !/<(soft|whisper)>/i.test(xai ?? '')) out.push(`${w}: library lines are soft: wrap tags.xai in <soft> or <whisper>`);
    for (const lint of lintHuddleText(text, lintCtx)) out.push(`${w}: ${lint.message}`);
  });
  const minSpoken = spots.length && spots.every((s) => s === 'hallway') ? 1 : 2;
  if (lines.length && spoken < minSpoken) out.push(`at least ${minSpoken} spoken turn${minSpoken > 1 ? 's' : ''}`);
  if (lines.length && (!used.has('A') || !used.has('B'))) out.push('roles A and B both take a turn');
  if (beats > 2) out.push('at most 2 beats (laugh or face) per exchange');
  for (const k of Object.keys(roles)) if (HUDDLE_ROLES.includes(k as HuddleRole) && !used.has(k as HuddleRole)) out.push(`role ${k} is declared but takes no turn`);
  if (spots.includes('library') && lines.length > 3) out.push('library exchanges have at most 3 turns');
  if (spots.includes('hallway') && lines.length > 3) out.push('hallway exchanges have at most 3 turns');
  const rolesUsed = HUDDLE_ROLES.filter((r) => used.has(r));
  if (ex.size !== undefined) {
    const sz = ex.size;
    if (!Array.isArray(sz) || sz.length !== 2 || !sz.every((n) => Number.isInteger(n) && n >= 2 && n <= 4) || sz[0] > sz[1]) out.push('size is [min, max] with 2 ≤ min ≤ max ≤ 4');
    else if (sz[0] < rolesUsed.length) out.push(`size min ${sz[0]} is below the ${rolesUsed.length} roles that take a turn`);
  }
  if (isObj(req) && (req.who === 'A' || req.who === 'B') && !used.has(req.who)) out.push(`requires.who ${req.who} takes no turn`);
  if (isObj(req) && req.who === 'other' && !lines.some((l) => isObj(l) && typeof l.text === 'string' && l.text.includes('{coworker}'))) out.push('requires.who "other" needs a line with {coworker}');
  if (topics.includes('debate')) {
    const a = (roles as Partial<Record<HuddleRole, HuddleRoleDef>>).A?.archetypes ?? [];
    const b = (roles as Partial<Record<HuddleRole, HuddleRoleDef>>).B?.archetypes ?? [];
    const opposed = a.length > 0 && b.length > 0 && !a.some((x) => b.includes(x));
    if (ex.pair !== 'tension' && !opposed) out.push('debates need pair: "tension" or opposed archetypes for A and B (rule 6)');
  }
  if (ex.pair !== undefined && !['well', 'tension', 'any'].includes(ex.pair)) out.push(`pair ${JSON.stringify(ex.pair)} must be well, tension or any`);

  // context, mood, caps
  const ctx = ex.context ?? [];
  if (!Array.isArray(ctx)) out.push('context must be a list');
  else {
    for (const c of ctx) if (typeof c !== 'string' || !contextKnown(c, contextKeys)) out.push(`unknown context ${JSON.stringify(c)}`);
    for (const c of ctx) if (!c.startsWith('!') && ctx.includes(`!${c}`)) out.push(`context requires and forbids ${c}`);
  }
  if (ex.mood !== undefined) {
    const m = ex.mood;
    if (!isObj(m) || !(Math.abs(num(m.valence, 9)) <= 1) || !(Math.abs(num(m.energy, 9)) <= 1)) out.push('mood must be within -1…1');
    else if (m.spread !== undefined && !(m.spread >= 0.2 && m.spread <= 2)) out.push('mood.spread must be 0.2…2');
  }
  if (ex.weight !== undefined && !(typeof ex.weight === 'number' && ex.weight >= 0.1 && ex.weight <= 5)) out.push('weight must be 0.1…5');
  if (ex.max_per_day !== undefined && !(Number.isInteger(ex.max_per_day) && ex.max_per_day >= 1 && ex.max_per_day <= 3)) out.push('max_per_day must be an integer 1…3');
  if (ex.max_per_week !== undefined && !(Number.isInteger(ex.max_per_week) && ex.max_per_week >= 1 && ex.max_per_week <= 60)) out.push('max_per_week must be an integer 1…60');
  return out;
}

function compileExchange(ex: HuddleExchangeDef, packId: string): CompiledExchange {
  const used = new Set(ex.lines.map((l) => l.role));
  const rolesUsed = HUDDLE_ROLES.filter((r) => used.has(r));
  const lines: CompiledHuddleLine[] = ex.lines.map((l, index) => {
    const kind: CompiledHuddleLine['kind'] = l.text !== undefined ? 'line' : l.laugh ? 'laugh' : 'face';
    const text = kind === 'line' ? l.text! : '';
    const xai = kind === 'line' ? l.tags?.xai ?? text : '';
    return Object.freeze({
      index,
      role: l.role,
      kind,
      text,
      xai,
      openai: Object.freeze({ say: kind === 'line' ? l.tags?.openai?.say ?? openaiInputFromXai(xai) : '', instructions: l.tags?.openai?.instructions ?? null }),
      face: kind === 'face' ? l.face! : kind === 'laugh' ? 'smile' : null,
      slots: Object.freeze([...(l.slots ?? [])]),
      pauseMs: l.pause_ms ?? null,
    });
  });
  const context = ex.context ?? [];
  const roles: Partial<Record<HuddleRole, Readonly<HuddleRoleDef>>> = {};
  for (const [k, r] of Object.entries(ex.roles ?? {})) roles[k as HuddleRole] = Object.freeze({ ...r });
  const requires = ex.grounded && ex.requires
    ? Object.freeze({
      events: Object.freeze([...ex.requires.events]),
      who: ex.requires.who ?? 'either',
      maxAgeMs: (ex.requires.max_age_h ?? Math.max(...ex.requires.events.map((e) => DEFAULT_MAX_AGE_H[e]))) * HOUR_MS,
    })
    : null;
  return Object.freeze({
    id: ex.id,
    packId,
    spots: Object.freeze([...ex.spots]),
    topics: Object.freeze([...ex.topics]),
    topic: ex.topics[0]!,
    roles: Object.freeze(roles),
    rolesUsed: Object.freeze(rolesUsed),
    size: Object.freeze([ex.size?.[0] ?? Math.max(2, rolesUsed.length), ex.size?.[1] ?? 4] as const),
    pair: ex.pair ?? 'any',
    mood: ex.mood ? Object.freeze({ ...ex.mood }) : null,
    require: Object.freeze(context.filter((c) => !c.startsWith('!'))),
    forbid: Object.freeze(context.filter((c) => c.startsWith('!')).map((c) => c.slice(1))),
    grounded: !!ex.grounded,
    requires,
    lines: Object.freeze(lines),
    slots: Object.freeze([...new Set(lines.flatMap((l) => l.slots))]),
    weight: ex.weight ?? 1,
    maxPerDay: ex.max_per_day ?? 1,
    maxPerWeek: ex.max_per_week ?? (ex.grounded ? 2 : HUDDLE_WEEKLY_CAP),
    hasLaugh: lines.some((l) => l.kind === 'laugh'),
    sad: !!ex.mood && typeof ex.mood.valence === 'number' && ex.mood.valence <= HUDDLE_SAD_VALENCE,
  });
}

/** Content version of a set of huddle packs: `h1_…`, independent of file order. */
export function huddlesVersion(packs: readonly HuddlePackInput[]): string {
  const text = JSON.stringify([1, [...packs].sort((a, b) => String(a?.id).localeCompare(String(b?.id)))]);
  return `h1_${base32Int(cyrb53(text, 2))}${base32Int(text.length)}`;
}

interface HuddleCompileOutcome {
  huddles: CompiledHuddles;
  problems: string[];
  dropped: { id: string; reason: string }[];
  badPacks: Set<object>;
  badExchanges: Set<object>;
}

function compileHuddlesInternal(packs: readonly HuddlePackInput[], catalog: CompiledCatalog): HuddleCompileOutcome {
  const contextKeys = catalogInternalsOf(catalog).contextKeys;
  const problems: string[] = [];
  const dropped: { id: string; reason: string }[] = [];
  const badPacks = new Set<object>();
  const badExchanges = new Set<object>();
  const seenPacks = new Set<string>();
  const seenIds = new Map<string, string>();
  const exchanges: CompiledExchange[] = [];
  const sorted = [...(packs ?? [])].sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  for (const pack of sorted) {
    const where = `huddles/${(pack as { id?: unknown })?.id}`;
    const packProblems: string[] = [];
    if (!isObj(pack) || pack.kind !== 'huddle_pack') packProblems.push('kind must be "huddle_pack"');
    else {
      if (typeof pack.id !== 'string' || !PACK_ID.test(pack.id)) packProblems.push(`pack id ${JSON.stringify(pack.id)} must look like hd-<name>`);
      else if (seenPacks.has(pack.id)) packProblems.push('second pack with this id');
      if (!(Number.isInteger(pack.version) && pack.version >= 1)) packProblems.push('version must be an integer ≥ 1');
      if (!Array.isArray(pack.exchanges) || pack.exchanges.length < 1) packProblems.push('exchanges must be a non-empty list');
    }
    if (packProblems.length) {
      for (const m of packProblems) problems.push(`${where}: ${m}`);
      if (isObj(pack)) badPacks.add(pack);
      dropped.push({ id: String((pack as { id?: unknown })?.id ?? '?'), reason: packProblems.join('; ') });
      continue;
    }
    seenPacks.add(pack.id);
    for (const ex of pack.exchanges) {
      const id = isObj(ex) && typeof ex.id === 'string' ? ex.id : '?';
      const msgs = checkExchange(ex, pack.id, contextKeys);
      const prev = seenIds.get(id);
      if (prev) msgs.unshift(`duplicate exchange id (also in ${prev})`);
      else if (id !== '?') seenIds.set(id, where);
      if (msgs.length) {
        for (const m of msgs) problems.push(`${where} ${id}: ${m}`);
        if (isObj(ex)) badExchanges.add(ex);
        dropped.push({ id, reason: msgs.join('; ') });
        continue;
      }
      exchanges.push(compileExchange(ex, pack.id));
    }
  }
  const byId = new Map(exchanges.map((e) => [e.id, e]));
  const bySpot = new Map<HuddleSpot, CompiledExchange[]>();
  for (const s of HUDDLE_SPOTS) bySpot.set(s, []);
  for (const e of exchanges) for (const s of e.spots) bySpot.get(s)!.push(e);
  const empty: readonly CompiledExchange[] = Object.freeze([]);
  for (const [s, list] of bySpot) bySpot.set(s, Object.freeze(list) as CompiledExchange[]);
  const huddles: CompiledHuddles = Object.freeze({
    version: huddlesVersion(packs ?? []),
    exchanges: Object.freeze(exchanges),
    catalog,
    bySpot: (spot: HuddleSpot) => bySpot.get(spot) ?? empty,
    byId: (id: string) => byId.get(id),
  });
  return { huddles, problems, dropped, badPacks, badExchanges };
}

/**
 * Compile huddle packs against a compiled expressions catalog (its context vocabulary, archetypes and defaults).
 * Strict: any problem, including the §5.4 honesty lints, throws ExpressionCatalogError with every problem listed.
 */
export function compileHuddles(packs: readonly HuddlePackInput[], catalog: CompiledCatalog): CompiledHuddles {
  const r = compileHuddlesInternal(packs, catalog);
  if (r.problems.length) throw new ExpressionCatalogError(r.problems);
  return r.huddles;
}

/**
 * For builders and hosts that load content while it is being written: bad exchanges (and packs with file-level
 * problems) are dropped and reported. `packs` is the cleaned input, which `compileHuddles` accepts strictly and
 * which reproduces `huddles.version` (the build writes it to the bundle).
 */
export function compileHuddlesLenient(
  packs: readonly HuddlePackInput[], catalog: CompiledCatalog,
): { huddles: CompiledHuddles; packs: HuddlePackInput[]; dropped: { id: string; reason: string }[]; problems: string[] } {
  const r = compileHuddlesInternal(packs, catalog);
  if (!r.problems.length) return { huddles: r.huddles, packs: [...(packs ?? [])], dropped: [], problems: [] };
  const cleaned = (packs ?? [])
    .filter((p) => !r.badPacks.has(p))
    .map((p) => ({ ...p, exchanges: p.exchanges.filter((e) => !r.badExchanges.has(e)) }))
    .filter((p) => p.exchanges.length > 0);
  return { huddles: compileHuddlesInternal(cleaned, catalog).huddles, packs: cleaned, dropped: r.dropped, problems: r.problems };
}

// ── casting ─────────────────────────────────────────────────────────────────────
export interface CastOptions {
  /** Agents of the grounding event: `in_event` roles (and the `who` role) must be one of them. */
  eventAgents?: ReadonlySet<string> | null;
  who?: HuddleWho | null;
  /** Deterministic tie-break between equally good assignments. */
  seed?: string;
}

const neverCache = new WeakMap<CompiledExchange, Map<string, string[]>>();
/** A role's spoken templates without placeholders, for never_says tests. */
function roleTexts(ex: CompiledExchange, role: HuddleRole): string[] {
  let byRole = neverCache.get(ex);
  if (!byRole) {
    byRole = new Map();
    neverCache.set(ex, byRole);
  }
  let t = byRole.get(role);
  if (!t) {
    t = ex.lines.filter((l) => l.role === role && l.kind === 'line').map((l) => l.text.replace(/\{[a-z_]+\}/g, ' '));
    byRole.set(role, t);
  }
  return t;
}

function roleAllows(ex: CompiledExchange, role: HuddleRole, p: HuddleParticipant, opts?: CastOptions): boolean {
  const def = ex.roles[role];
  if (def?.departments?.length && !(p.department && def.departments.includes(p.department))) return false;
  if (def?.team_roles?.length && !(p.teamRoles ?? []).some((t) => def.team_roles!.includes(t))) return false;
  if (def?.chief === true && !p.isChief) return false;
  if (def?.chief === false && p.isChief) return false;
  if ((def?.in_event || opts?.who === role) && !opts?.eventAgents?.has(p.agentId)) return false;
  if (def?.at_desk !== undefined && !!p.atDesk !== def.at_desk) return false;
  const never = p.index?.neverSays ?? [];
  if (never.length && roleTexts(ex, role).some((text) => never.some((phrase) => containsPhrase(text, phrase)))) return false;
  return true;
}

/** Soft archetype fit of one role: 0.25 + 1.5 · Σ blend[a ∈ role.archetypes], capped at 1.75 (1 without archetypes). */
function roleFit(def: Readonly<HuddleRoleDef> | undefined, p: HuddleParticipant): number {
  const want = def?.archetypes ?? [];
  if (!want.length) return 1;
  let s = 0;
  for (const a of want) s += num(p.index?.blend?.[a], 0);
  return Math.min(1.75, 0.25 + 1.5 * s);
}

const mentions = (list: readonly string[] | undefined, id: string): boolean => !!list && list.includes(id);

/**
 * The best assignment of an exchange's roles to the people present (≤ 24 permutations): hard filters first
 * (departments, team roles, chief, in_event, never_says), then fit = Π role fit × 1.6 when A and B pair well
 * (`pair: well`) or in productive tension (`pair: tension`, and every debate). Null when nobody can take a role.
 */
export function castRoles(
  ex: CompiledExchange, people: readonly HuddleParticipant[], opts?: CastOptions,
): { cast: Partial<Record<HuddleRole, string>>; fit: number } | null {
  const roles = ex.rolesUsed;
  const n = people.length;
  if (n < roles.length || n < ex.size[0] || n > ex.size[1]) return null;
  const allowed = roles.map((r) => people.filter((p) => roleAllows(ex, r, p, opts)));
  if (allowed.some((a) => !a.length)) return null;
  const tension = ex.pair === 'tension' || ex.topics.includes('debate');
  let best: { cast: Partial<Record<HuddleRole, string>>; fit: number; tie: number } | null = null;
  const chosen: HuddleParticipant[] = [];
  const visit = (i: number) => {
    if (i === roles.length) {
      let fit = 1;
      roles.forEach((r, k) => { fit *= roleFit(ex.roles[r], chosen[k]!); });
      const a = chosen[0]!;
      const b = chosen[1]!;
      if (ex.pair === 'well' && (mentions(a.pairsWellWith, b.agentId) || mentions(b.pairsWellWith, a.agentId))) fit *= 1.6;
      else if (tension && (mentions(a.tensionWith, b.agentId) || mentions(b.tensionWith, a.agentId))) fit *= 1.6;
      const key = chosen.map((p) => p.agentId).join('|');
      const tie = fnv1a32(`${opts?.seed ?? ''}|${ex.id}|${key}`);
      if (!best || fit > best.fit + 1e-9 || (Math.abs(fit - best.fit) <= 1e-9 && tie < best.tie)) {
        const cast: Partial<Record<HuddleRole, string>> = {};
        roles.forEach((r, k) => { cast[r] = chosen[k]!.agentId; });
        best = { cast, fit, tie };
      }
      return;
    }
    for (const p of allowed[i]!) {
      if (chosen.includes(p)) continue;
      chosen.push(p);
      visit(i + 1);
      chosen.pop();
    }
  };
  visit(0);
  const found = best as { cast: Partial<Record<HuddleRole, string>>; fit: number; tie: number } | null;
  return found ? { cast: found.cast, fit: found.fit } : null;
}

// ── recency (§6.2): floor-wide daily and weekly uses, and a 14-day memory per participant ───────────────────
export interface HuddleRecencySnapshot {
  v: 1;
  /** exchangeId → [epoch ms, owner-local day] per use, newest last (last 14 days). */
  uses: Record<string, [number, string][]>;
  /** agentId → exchangeId → the last time this agent performed or heard it. */
  people: Record<string, Record<string, number>>;
}
export interface HuddleRecency {
  /** Floor-wide uses of an exchange on one owner-local day. */
  usesToday(exchangeId: string, dayKey: string): number;
  /** Floor-wide uses in the 7 days ending at `now`. */
  usesThisWeek(exchangeId: string, now: number): number;
  /** Exchanges this agent performed or heard since `sinceMs`. */
  performedBy(agentId: string, sinceMs: number): ReadonlySet<string>;
  /** Record a pick. Call only when it was actually shown on screen (visible-only talk consumes nothing else). */
  record(pick: HuddlePick, now: number, dayKey: string): void;
  snapshot(): HuddleRecencySnapshot;
  merge(s: HuddleRecencySnapshot): void;
}

const MAX_USES_PER_EXCHANGE = 24;
const MAX_ENTRIES_PER_AGENT = 60;

export function createHuddleRecency(snapshot?: HuddleRecencySnapshot): HuddleRecency {
  const uses = new Map<string, [number, string][]>();
  const people = new Map<string, Map<string, number>>();
  let newest = 0;
  const prune = () => {
    const since = newest - HUDDLE_PARTICIPANT_MEMORY_MS;
    for (const [id, list] of uses) {
      const kept = list.filter(([at]) => at > since).sort((a, b) => a[0] - b[0]).slice(-MAX_USES_PER_EXCHANGE);
      if (kept.length) uses.set(id, kept);
      else uses.delete(id);
    }
    for (const [agent, m] of people) {
      const kept = [...m].filter(([, at]) => at > since).sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES_PER_AGENT);
      if (kept.length) people.set(agent, new Map(kept));
      else people.delete(agent);
    }
  };
  const addUse = (id: string, at: number, day: string) => {
    const list = uses.get(id) ?? [];
    if (!list.some(([a, d]) => a === at && d === day)) list.push([at, day]);
    uses.set(id, list);
  };
  const touch = (agent: string, id: string, at: number) => {
    const m = people.get(agent) ?? new Map<string, number>();
    m.set(id, Math.max(m.get(id) ?? 0, at));
    people.set(agent, m);
  };
  const rec: HuddleRecency = {
    usesToday(exchangeId, dayKey) {
      return (uses.get(exchangeId) ?? []).filter(([, d]) => d === dayKey).length;
    },
    usesThisWeek(exchangeId, now) {
      return (uses.get(exchangeId) ?? []).filter(([at]) => at > now - WEEK_MS && at <= now).length;
    },
    performedBy(agentId, sinceMs) {
      const out = new Set<string>();
      for (const [id, at] of people.get(agentId) ?? []) if (at >= sinceMs) out.add(id);
      return out;
    },
    record(pick, now, dayKey) {
      addUse(pick.exchangeId, now, dayKey);
      for (const a of new Set([...pick.participants, ...Object.values(pick.cast).filter((x): x is string => !!x)])) touch(a, pick.exchangeId, now);
      newest = Math.max(newest, now);
      prune();
    },
    snapshot() {
      const u: Record<string, [number, string][]> = {};
      for (const [id, list] of uses) u[id] = list.map(([at, d]) => [at, d]);
      const p: Record<string, Record<string, number>> = {};
      for (const [agent, m] of people) p[agent] = Object.fromEntries(m);
      return { v: 1, uses: u, people: p };
    },
    merge(s) {
      if (!s || s.v !== 1) return;
      for (const [id, list] of Object.entries(s.uses ?? {})) {
        for (const e of list ?? []) {
          if (!Array.isArray(e) || typeof e[0] !== 'number' || typeof e[1] !== 'string') continue;
          addUse(id, e[0], e[1]);
          newest = Math.max(newest, e[0]);
        }
      }
      for (const [agent, m] of Object.entries(s.people ?? {})) {
        for (const [id, at] of Object.entries(m ?? {})) {
          if (typeof at !== 'number') continue;
          touch(agent, id, at);
          newest = Math.max(newest, at);
        }
      }
      prune();
    },
  };
  if (snapshot) rec.merge(snapshot);
  return rec;
}

// ── filling and delivery ────────────────────────────────────────────────────────
/**
 * Substitute sanitised fills into a template; a slot at a sentence start is capitalised (as select.ts). A fill that
 * carries its own article ("the write-up") drops it after a possessive or another determiner ("Eddie's write-up",
 * never "Eddie's the write-up").
 */
export function fillTemplate(template: string, fills: Readonly<Record<string, string>>, sentenceStart = true): string {
  const out = template.replace(/\{([a-z_]+)\}/g, (_m, slot: string, offset: number, whole: string) => {
    const raw = fills[slot];
    if (raw === undefined) return '';
    let v = stripMarkupChars(raw);
    if (/^(?:the|a|an)\s/i.test(v) && /(?:['’]s|\b(?:the|a|an|your|our|their|his|her|my|its|this|that))\s+$/i.test(whole.slice(0, offset))) v = v.replace(/^(?:the|a|an)\s+/i, '');
    const before = readable(whole.slice(0, offset));
    const atStart = before === '' ? sentenceStart : /[.!?…]$/.test(before);
    return atStart && v ? v[0]!.toUpperCase() + v.slice(1) : v;
  });
  return out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.!?;:])/g, '$1').trim();
}

/** Bubble reading time (§3.2): clamp(1,800 + 55 ms × chars, 2,200, 6,000). */
export function huddleReadingMs(caption: string): number {
  return clamp(1800 + 55 * String(caption).length, 2200, 6000);
}

function slotMax(catalog: CompiledCatalog, slot: string, fallback: number): number {
  const slots = catalogInternalsOf(catalog).slots as Record<string, { max_chars?: number } | undefined>;
  return num(slots[slot]?.max_chars, fallback);
}

/**
 * A value from a real event (project, artifact, coworker): text a host marked ⟦tainted⟧ or ⟦whisper⟧ never surfaces,
 * and URLs, e-mail addresses, secret-looking tokens and markup are removed (sanitizeGist rules) before the
 * word-boundary cap (§6.2 grounding, H3).
 */
function eventValue(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const safe = sanitizeGist(raw, 400);
  return safe ? sanitizeSlotValue(safe.replace(/[.!?…]+$/, ''), max) : null;
}

function projectName(raw: string | undefined, max: number): string | null {
  const v = eventValue(raw, max);
  if (!v || v.toLowerCase() === 'everyday' || v.split(/\s+/).length > 3) return null;
  return v;
}

function dominantInstructions(catalog: CompiledCatalog, index: AgentIndex | undefined): string | null {
  const entries = Object.entries(index?.blend ?? {}).filter(([, w]) => (w ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const dom = entries[0]?.[0];
  return dom && isArchetypeId(dom) ? catalog.archetypes.get(dom)?.delivery.openai_instructions ?? null : null;
}

interface LineCore {
  kind: CompiledHuddleLine['kind']; caption: string; face?: FaceGesture; xai: string;
  openai: { say?: string; instructions?: string } | undefined; estMs: number; fills: Record<string, string>; lineKey: string;
}

/** One turn rendered for one speaker: the single place captions, renderings and keys are made (pick and render agree). */
function coreLine(h: CompiledHuddles, ex: CompiledExchange, line: CompiledHuddleLine, speaker: AgentIndex | undefined, allFills: Readonly<Record<string, string>>): LineCore {
  const base = `${ex.id}.${line.index}`;
  if (line.kind === 'face') return { kind: 'face', caption: '', face: line.face ?? 'nod', xai: '', openai: undefined, estMs: 0, fills: {}, lineKey: base };
  if (line.kind === 'laugh') {
    const style = speaker?.laugh ?? DEFAULT_LAUGH;
    const silent = style.kind === 'silent_smile';
    const say = silent ? '' : style.openai?.say ?? '';
    return {
      kind: 'laugh',
      caption: laughCaption(style),
      face: 'smile',
      xai: silent ? '' : laughXaiFor(style),
      openai: say ? { say, instructions: style.openai?.instructions ?? LAUGH_HINT } : undefined,
      estMs: silent ? 0 : estimateMs('', true, style.intensity),
      fills: {},
      lineKey: base,
    };
  }
  const fills: Record<string, string> = {};
  for (const s of line.slots) if (allFills[s] !== undefined) fills[s] = allFills[s]!;
  const caption = fillTemplate(line.text, fills);
  const xai = speakable(fillTemplate(line.xai, fills));
  const say = fillTemplate(line.openai.say, fills);
  const instructions = [dominantInstructions(h.catalog, speaker), SMALL_TALK_HINT, line.openai.instructions ?? instructionsFromTags(line.xai)]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const fk = Object.keys(fills).length ? fillKeyOf(fills as SlotValues) : '';
  return {
    kind: 'line', caption, xai, openai: { say, instructions }, estMs: estimateMs(xai || caption, false), fills, lineKey: fk ? `${base}|${fk}` : base,
  };
}

function voiceableFor(core: LineCore, provider: TtsProvider): boolean {
  if (core.kind === 'face') return false;
  if (core.kind === 'line') return !!core.caption;
  if (provider === 'browser') return false;
  if (provider === 'xai') return !!core.xai;
  if (provider === 'openai') return !!core.openai?.say;
  return !!core.caption;
}

function utteranceOf(core: LineCore, agentId: string, lineId: string, seed: string): Utterance {
  const nonverbal = core.kind !== 'line';
  return {
    agentId,
    intent: core.kind === 'laugh' ? 'laugh' : 'sidetalk_reply',
    lineId,
    source: core.kind === 'laugh' ? 'signature' : 'archetype',
    caption: core.caption,
    fills: core.fills as SlotValues,
    fillKey: fillKeyOf(core.fills as SlotValues),
    nonverbal,
    speak: {
      xai: core.xai,
      openai: core.openai?.say ? { input: core.openai.say, instructions: core.openai.instructions ?? '' } : null,
      browser: nonverbal ? null : core.caption || null,
    },
    estMs: core.estMs,
    face: { gesture: core.face ?? 'none', holdMs: core.kind === 'face' ? 900 : core.kind === 'laugh' ? 1200 : 0 },
    seed,
  };
}

/**
 * The Utterance for one turn of a pick, for `toDelivery` and `clipKey` on listen-in (the speaker's voice comes from
 * their AgentIndex). Face beats yield an utterance with an empty caption, which no provider voices.
 */
export function huddleUtterance(pick: HuddlePick, index: number): Utterance {
  const l = pick.lines[index];
  if (!l) throw new RangeError(`huddle ${pick.exchangeId} has no turn ${index}`);
  const core: LineCore = {
    kind: l.kind, caption: l.caption, face: l.face, xai: l.xai ?? '', openai: l.openai, estMs: l.estMs, fills: { ...l.fills }, lineKey: l.lineKey,
  };
  return utteranceOf(core, l.agentId, `${pick.exchangeId}.${l.index}`, pick.seed);
}

/**
 * Rebuild one turn server-side (the Phase 2 `POST /api/expr/huddle/render` route): validates that the turn exists
 * and is voiceable and that the fills are exactly the turn's slots, already sanitised. Produces the same Utterance
 * (and so the same clip key) as `huddleUtterance` on the client.
 */
export function renderHuddleUtterance(
  h: CompiledHuddles, req: { exchangeId: string; index: number; speaker: AgentIndex; fills: Readonly<Record<string, string>> },
): { ok: true; utterance: Utterance } | { ok: false; problems: string[] } {
  const ex = h.byId(req.exchangeId);
  if (!ex) return { ok: false, problems: [`unknown exchange ${req.exchangeId}`] };
  const line = ex.lines[req.index];
  if (!line) return { ok: false, problems: [`exchange ${req.exchangeId} has no turn ${req.index}`] };
  if (line.kind === 'face') return { ok: false, problems: ['a face beat has nothing to voice'] };
  const problems: string[] = [];
  const fills = req.fills ?? {};
  for (const k of Object.keys(fills)) if (!line.slots.includes(k as HuddleSlot)) problems.push(`slot ${k} is not used by this turn`);
  for (const s of line.slots) {
    const v = fills[s];
    if (typeof v !== 'string' || !v) { problems.push(`slot ${s} is missing`); continue; }
    const clean = s === 'gist' ? sanitizeGist(v)
      : HUDDLE_GROUNDED_SLOTS.includes(s) ? eventValue(v, slotMax(h.catalog, s, 40))
        : sanitizeSlotValue(v, s.startsWith('name_') ? NAME_MAX : slotMax(h.catalog, s, 40));
    if (clean !== v) problems.push(`slot ${s} has markup, extra whitespace or is too long`);
  }
  if (problems.length) return { ok: false, problems };
  const core = coreLine(h, ex, line, req.speaker, fills);
  return { ok: true, utterance: utteranceOf(core, req.speaker.agentId, `${ex.id}.${line.index}`, `render:${ex.id}.${line.index}`) };
}

/** The pick as the office director's `HuddleScript` (packages/office life): bubbles hold for `estMs`. */
export interface HuddleScriptOut {
  exchangeId: string; topic: HuddleTopic; grounded: boolean;
  lines: { personId: string; kind: 'line' | 'laugh' | 'face'; text: string; face?: string; atMs: number; estMs: number; data: { index: number; role: HuddleRole; lineKey: string; audioMs: number } }[];
  data: HuddlePick;
}
export function huddleScriptOf(pick: HuddlePick): HuddleScriptOut {
  return {
    exchangeId: pick.exchangeId,
    topic: pick.topic,
    grounded: pick.grounded,
    lines: pick.lines.map((l) => ({
      personId: l.agentId,
      kind: l.kind,
      text: l.caption,
      ...(l.face ? { face: l.face } : {}),
      atMs: l.atMs,
      estMs: l.holdMs,
      data: { index: l.index, role: l.role, lineKey: l.lineKey, audioMs: l.estMs },
    })),
    data: pick,
  };
}

// ── selection ───────────────────────────────────────────────────────────────────
const TIME_CONTEXT = /^(part_of_day:|weekday:|workweek:|weekend$|works_weekends$)/;
const AFTER_WIN_MS = 30 * 60_000;

/** The contexts that hold for this huddle: owner-local time (deriveContexts rules), director contexts, and derived ones. */
function huddleContexts(req: HuddleRequest, people: readonly HuddleParticipant[], events: readonly HuddleEvent[]): Set<string> {
  const timeState: GroundingState = {
    now: req.now,
    owner: { firstName: null },
    chiefName: null,
    self: { agentId: '', firstName: '', presence: 'idle' as PresenceState, blocked: false, staffed: true, activity: null, role: null },
    history: { firstMeeting: false, returning: false, newDay: false, lastWinAt: null, lastUnblockedAt: null, winsToday: 0, distressThisSession: false },
    exchange: { mode: 'none', interrupted: false, steerQueued: false, ownerFarewell: false, ownerGreeting: false, ownError: false },
    quietHours: false,
  };
  const c = new Set([...deriveContexts(timeState)].filter((x) => TIME_CONTEXT.test(x)));
  for (const x of req.contexts ?? []) if (typeof x === 'string') c.add(x);
  const hour = ((Math.floor(num(req.now.localHour, 12)) % 24) + 24) % 24;
  if (hour >= 22 || hour < 6) c.add('night');
  const depts = people.map((p) => p.department).filter((d): d is string => !!d);
  if (depts.length === people.length && new Set(depts).size === 1) c.add('same_department');
  else if (new Set(depts).size > 1) c.add('cross_department');
  const ids = new Set(people.map((p) => p.agentId));
  if (events.some((e) => HUDDLE_COMPLETION_EVENTS.includes(e.kind) && req.now.epochMs - e.at <= AFTER_WIN_MS && e.agentIds.some((a) => ids.has(a)))) c.add('after_win');
  return c;
}

const sadCache = new WeakMap<CompiledHuddles, readonly CompiledExchange[]>();
/** The library's sad exchanges (one per floor per day, only on a real low day). */
function sadExchanges(h: CompiledHuddles): readonly CompiledExchange[] {
  let list = sadCache.get(h);
  if (!list) sadCache.set(h, (list = h.exchanges.filter((ex) => ex.sad)));
  return list;
}

function moodFitOf(fit: MoodFit | null, m: Mood, catalog: CompiledCatalog): number {
  const d = catalog.defaults;
  if (!fit) return num(d.mood_neutral_fit, 0.8);
  const sigma = num(fit.spread, num(d.mood_fit_default_spread, 0.6));
  const dist2 = (m.valence - fit.valence) ** 2 + (m.energy - fit.energy) ** 2;
  return Math.max(0.05, Math.exp(-dist2 / (2 * sigma * sigma)));
}

interface Candidate {
  ex: CompiledExchange; cast: Partial<Record<HuddleRole, string>>; fit: number; fills: Record<string, string>; event: HuddleEvent | null;
}

/** Static and grounded slot values for a cast; null when any slot the exchange uses cannot be filled. */
function fillsFor(
  h: CompiledHuddles, ex: CompiledExchange, cast: Partial<Record<HuddleRole, string>>, byId: ReadonlyMap<string, HuddleParticipant>,
  req: HuddleRequest, event: HuddleEvent | null,
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const s of ex.slots) {
    let v: string | null = null;
    switch (s) {
      case 'name_a': case 'name_b': case 'name_c': {
        const who = cast[NAME_SLOT[s]!];
        v = who ? sanitizeSlotValue(byId.get(who)?.firstName, NAME_MAX) : null;
        break;
      }
      case 'chief_name':
        v = sanitizeSlotValue(req.chiefName ?? undefined, slotMax(h.catalog, 'chief_name', NAME_MAX));
        break;
      case 'part_of_day': {
        const p = partOfDay(req.now.localHour);
        v = p === 'late_night' ? null : p;
        break;
      }
      case 'weekday':
        v = weekdayName(req.now.weekday);
        break;
      case 'project':
        v = event ? projectName(event.project, slotMax(h.catalog, 'project', 32)) : null;
        break;
      case 'artifact':
        v = event ? eventValue(event.artifact, slotMax(h.catalog, 'artifact', 40)) : null;
        break;
      case 'gist':
        v = event?.gist ? sanitizeGist(event.gist) : null;
        break;
      case 'coworker':
        v = event ? eventValue(event.coworkerName, slotMax(h.catalog, 'coworker', NAME_MAX)) : null;
        break;
      default:
        v = null;
    }
    if (!v) return null;
    out[s] = v;
  }
  // Every filled caption must fit a two-line bubble.
  for (const l of ex.lines) if (l.kind === 'line' && l.slots.length && fillTemplate(l.text, out).length > HUDDLE_CAPTION_MAX_CHARS) return null;
  return out;
}

/** Cast and fill an exchange, grounded in the most recent matching event when it needs one. */
function candidateFor(
  h: CompiledHuddles, ex: CompiledExchange, people: readonly HuddleParticipant[], byId: ReadonlyMap<string, HuddleParticipant>,
  req: HuddleRequest, events: readonly HuddleEvent[],
): Candidate | null {
  if (!ex.requires) {
    const c = castRoles(ex, people, { seed: req.seed });
    if (!c) return null;
    const fills = fillsFor(h, ex, c.cast, byId, req, null);
    return fills ? { ex, cast: c.cast, fit: c.fit, fills, event: null } : null;
  }
  const now = req.now.epochMs;
  for (const ev of events) {
    if (!ex.requires.events.includes(ev.kind) || now - ev.at > ex.requires.maxAgeMs) continue;
    const agents = new Set(ev.agentIds);
    const present = people.filter((p) => agents.has(p.agentId)).length;
    if (ex.requires.who === 'other' ? present > 0 || !ev.coworkerName : present === 0) continue;
    const c = castRoles(ex, people, { eventAgents: agents, who: ex.requires.who, seed: req.seed });
    if (!c) continue;
    const fills = fillsFor(h, ex, c.cast, byId, req, ev);
    if (fills) return { ex, cast: c.cast, fit: c.fit, fills, event: ev };
  }
  return null;
}

/**
 * Pick one exchange for a huddle (§6.2), or null for a silent huddle. Pure and deterministic (≤ 1 ms):
 * spot → size and turns → contexts → mood gate → daily and weekly caps → grounding (team events only, slots from
 * the event) → casting (hard filters, archetype fit, pair affinity) → 14-day participant memory (when alternatives
 * exist) → score = weight × fit × moodFit × topicPrior × 0.6^usesThisWeek × contextBonus → seeded pick → fill →
 * time. Quiet Ambience is always silent. Never records: call `recency.record` when the exchange is shown.
 */
export function pickExchange(h: CompiledHuddles, req: HuddleRequest, recency: HuddleRecency): HuddlePick | null {
  if (req.ambience === 'quiet') return null;
  const seen = new Set<string>();
  const people = (req.participants ?? []).filter((p) => p && typeof p.agentId === 'string' && !seen.has(p.agentId) && !!seen.add(p.agentId));
  if (people.length < 2) return null;
  const byId = new Map(people.map((p) => [p.agentId, p]));
  const now = num(req.now?.epochMs, 0);
  const dayKey = ownerDayKey({ now: req.now });
  const events = [...(req.grounding?.events ?? [])]
    .filter((e) => e && e.visibility === 'team' && HUDDLE_EVENT_KINDS.includes(e.kind) && Array.isArray(e.agentIds) && typeof e.at === 'number' && e.at <= now)
    .sort((a, b) => b.at - a.at || String(a.cause?.seq).localeCompare(String(b.cause?.seq)));
  const contexts = huddleContexts(req, people, events);
  const mean: Mood = {
    valence: people.reduce((s, p) => s + num(p.mood?.valence, 0), 0) / people.length,
    energy: people.reduce((s, p) => s + num(p.mood?.energy, 0), 0) / people.length,
  };
  const lowValence = mean.valence < -0.2;
  // Sad exchanges only on a real low day: the mean valence is low and real events put it there (below baseline);
  // at most one per floor per owner-local day. A baseline-grumpy cast never gets "rough stretch?" lines.
  const eventDelta = people.reduce((s, p) => s + (num(p.mood?.valence, 0) - num(p.index?.baseline?.valence, num(p.mood?.valence, 0))), 0) / people.length;
  const lowDay = mean.valence < HUDDLE_SAD_GATE && eventDelta <= HUDDLE_SAD_GATE;
  const sadToday = lowDay && sadExchanges(h).some((ex) => recency.usesToday(ex.id, dayKey) > 0);
  const night = contexts.has('night');
  const maxLines = Math.max(2, Math.floor(num(req.maxLines, 4)));

  const eligible: Candidate[] = [];
  /** Passed every filter but a floor-wide daily or weekly cap: the second-screen fallback below. */
  const capped: CompiledExchange[] = [];
  for (const ex of h.bySpot(req.spot)) {
    if (ex.lines.length > maxLines) continue;
    if (people.length < ex.size[0] || people.length > ex.size[1] || people.length < ex.rolesUsed.length) continue;
    if (!ex.require.every((c) => contexts.has(c)) || ex.forbid.some((c) => contexts.has(c))) continue;
    if (lowValence && ex.topics.includes('debate')) continue;
    if (ex.sad && (!lowDay || sadToday)) continue;
    if (req.avoid?.has(ex.id)) continue;
    if (recency.usesToday(ex.id, dayKey) >= ex.maxPerDay || recency.usesThisWeek(ex.id, now) >= ex.maxPerWeek) {
      if (!ex.grounded && !ex.sad) capped.push(ex);
      continue;
    }
    const c = candidateFor(h, ex, people, byId, req, events);
    if (c) eligible.push(c);
  }

  // The 14-day memory: nobody present hears an exchange twice while fresh ones remain.
  const heard = new Set<string>();
  for (const p of people) for (const id of recency.performedBy(p.agentId, now - HUDDLE_PARTICIPANT_MEMORY_MS)) heard.add(id);
  const fresh = eligible.filter((c) => !heard.has(c.ex.id));
  if (!fresh.length) {
    // The library ran dry for this floor (a second screen that sees every huddle): any ungrounded exchange that
    // nobody present has heard in 14 days may play again, past the floor-wide daily and weekly caps.
    for (const ex of capped) {
      if (heard.has(ex.id)) continue;
      const c = candidateFor(h, ex, people, byId, req, events);
      if (c) fresh.push(c);
    }
  }
  if (!fresh.length && !eligible.length) return null;
  const pool = fresh.length ? fresh : eligible;

  const d = h.catalog.defaults;
  const T = Math.max(0.05, num(d.selection_temperature, 0.7));
  const bonusBase = num(d.context_match_bonus, 1.3);
  const bonusCap = num(d.context_bonus_cap, 1.69);
  const weights = pool.map((c) => {
    const ex = c.ex;
    let prior = 1;
    if (ex.grounded) prior *= 2;
    if (night && ex.topics.includes('self_aware')) prior *= 1.2;
    if (lowValence && ex.hasLaugh) prior *= 0.6;
    const contextBonus = Math.min(bonusCap, Math.pow(bonusBase, ex.require.length));
    const wear = Math.pow(0.6, recency.usesThisWeek(ex.id, now));
    const score = ex.weight * c.fit * moodFitOf(ex.mood, mean, h.catalog) * prior * wear * contextBonus;
    return Math.pow(Math.max(score, 1e-12), 1 / T);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const rng = seededRng(req.seed);
  let r = rng.next() * total;
  let chosen = pool[pool.length - 1]!;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r < 0) {
      chosen = pool[i]!;
      break;
    }
  }

  // Fill and time the turns: each starts after the previous one's hold plus its pause (600–1,200 ms unless authored).
  const timing = seededRng(`${req.seed}|${chosen.ex.id}|t`);
  const lines: HuddleLinePlan[] = [];
  let at = 0;
  for (const line of chosen.ex.lines) {
    const agentId = chosen.cast[line.role]!;
    const speaker = byId.get(agentId);
    const core = coreLine(h, chosen.ex, line, speaker?.index, chosen.fills);
    const jitter = timing.next();
    const pause = line.pauseMs ?? (line.index === 0 ? 0 : Math.round(600 + 600 * jitter));
    at += pause;
    const holdMs = core.kind === 'face' ? 900 : core.kind === 'laugh' ? Math.max(core.estMs, Math.round(1200 + 400 * timing.next())) : Math.max(huddleReadingMs(core.caption), core.estMs + 400);
    lines.push({
      index: line.index,
      agentId,
      role: line.role,
      kind: core.kind,
      caption: core.caption,
      ...(core.face ? { face: core.face } : {}),
      ...(core.xai ? { xai: core.xai } : {}),
      ...(core.openai ? { openai: core.openai } : {}),
      estMs: core.estMs,
      holdMs,
      atMs: at,
      lineKey: core.lineKey,
      fills: Object.freeze({ ...core.fills }),
      voiceable: voiceableFor(core, req.provider),
    });
    at += holdMs;
  }
  return {
    exchangeId: chosen.ex.id,
    packId: chosen.ex.packId,
    topic: chosen.ex.topic,
    topics: chosen.ex.topics,
    grounded: chosen.ex.grounded,
    cause: chosen.event ? { ...chosen.event.cause } : null,
    eventKind: chosen.event?.kind ?? null,
    spot: req.spot,
    participants: people.map((p) => p.agentId),
    cast: { ...chosen.cast },
    lines,
    fit: chosen.fit,
    seed: req.seed,
    durationMs: at,
  };
}
