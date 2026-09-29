// Grounding: the only way live state enters a line (§3.4, §8.3, H1). A slot that does not resolve is
// absent from the result, and every line that needs it is filtered out by selection.
import { catalogInternalsOf, num } from './internal';
import { stripMarkupChars } from './markup';
import type { AffectCues, CompiledCatalog, GroundingState, SlotValues } from './types';
import type { OwnerTone, SlotId } from './vocab';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Integer as a spoken word up to twelve, digits above; null below `min` or when not an integer. */
export function numberWord(n: number | null | undefined, min = 1): string | null {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min) return null;
  return n <= 12 ? NUMBER_WORDS[n]! : String(n);
}

/** Owner-local part of day: morning 05–12, afternoon 12–17, evening 17–22, late_night otherwise. */
export function partOfDay(localHour: number): 'morning' | 'afternoon' | 'evening' | 'late_night' {
  const h = ((Math.floor(num(localHour, 12)) % 24) + 24) % 24;
  return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'late_night';
}

/** Weekday name for a JS-style weekday number (0 = Sunday … 6 = Saturday). */
export function weekdayName(weekday: number): string | null {
  return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? WEEKDAYS[weekday]! : null;
}

/** Cut at a word boundary to at most `max` characters, without dangling punctuation. */
export function capAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const i = cut.lastIndexOf(' ');
  return (i > 0 ? cut.slice(0, i) : s.slice(0, max)).replace(/[\s,;:—–-]+$/, '');
}

/** Sanitise one slot value: no markup characters, collapsed whitespace, word-boundary cap (§3.4). */
export function sanitizeSlotValue(raw: unknown, maxChars: number): string | null {
  if (typeof raw !== 'string') return null;
  const v = capAtWord(stripMarkupChars(raw), Math.max(1, maxChars));
  return v ? v : null;
}

function stepLabel(raw: string): string {
  let s = raw.trim().replace(/[.。]+$/, '');
  // Verb-first running copy: "Reading 14 reports" → "reading 14 reports"; keep "HubSpot…" or "CSV…".
  if (/^[A-Z][a-z'’-]+(\s|$)/.test(s)) s = s[0]!.toLowerCase() + s.slice(1);
  return s;
}

/**
 * Remaining time → spoken ETA bucket (§3.4): <4 s "a second", 4–12 s "a few seconds", 12–20 s "ten seconds",
 * 20–45 s "half a minute", 45–90 s "a minute", 90–240 s "a couple of minutes"; longer or unknown → null.
 */
export function etaPhrase(ms: number | null): string | null {
  if (ms === null || typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 4_000) return 'a second';
  if (ms < 12_000) return 'a few seconds';
  if (ms < 20_000) return 'ten seconds';
  if (ms < 45_000) return 'half a minute';
  if (ms < 90_000) return 'a minute';
  if (ms < 240_000) return 'a couple of minutes';
  return null;
}

/** Resolve the wanted slots from state. Unresolvable slots are omitted (null means unusable, §3.4). */
export function resolveSlots(state: GroundingState, wanted: readonly SlotId[], catalog: CompiledCatalog): SlotValues {
  const slotDefs = catalogInternalsOf(catalog).slots;
  const out: SlotValues = {};
  for (const slot of new Set(wanted)) {
    const raw = rawSlot(state, slot);
    if (raw === null || raw === undefined) continue;
    const v = sanitizeSlotValue(raw, num(slotDefs[slot]?.max_chars, 40));
    if (v) out[slot] = v;
  }
  return out;
}

function rawSlot(state: GroundingState, slot: SlotId): string | null {
  switch (slot) {
    case 'owner_name':
      return state.owner?.firstName ?? null;
    case 'chief_name':
      return state.chiefName ?? null;
    case 'self_name':
      return state.self?.firstName ?? null;
    case 'coworker':
      return state.counterpart?.firstName ?? null;
    case 'project': {
      const p = state.project;
      if (!p || p.id === 'everyday' || !p.shortName || p.shortName.trim().toLowerCase() === 'everyday') return null;
      return p.shortName.trim().split(/\s+/).length <= 3 ? p.shortName : null;
    }
    case 'client':
      return state.project?.client ?? null;
    case 'step_label':
      return state.work?.stepLabel ? stepLabel(state.work.stepLabel) : null;
    case 'artifact':
      return state.work?.artifact ?? null;
    case 'done': {
      const done = state.work?.done;
      const total = state.work?.total;
      if (typeof done !== 'number') return null;
      if (typeof total === 'number' && done > total) return null;
      return numberWord(done, 1);
    }
    case 'total': {
      const total = state.work?.total;
      const done = state.work?.done;
      if (typeof total !== 'number') return null; // never guessed
      if (typeof done === 'number' && done > total) return null;
      return numberWord(total, 2);
    }
    case 'eta':
      return etaPhrase(state.attention?.etaMs ?? null);
    case 'other_thread':
      return state.attention?.otherThread ?? null;
    case 'blocker':
      return state.work?.blocker ?? null;
    case 'finding_count':
      return state.review ? numberWord(state.review.findingCount, 1) : null;
    case 'weekday':
      return weekdayName(state.now?.weekday);
    case 'part_of_day': {
      const p = partOfDay(state.now?.localHour);
      return p === 'late_night' ? null : p;
    }
    case 'gist':
      return state.gist ? sanitizeGist(state.gist) : null;
    default:
      return null;
  }
}

const WIN_WINDOW_MS = 30 * 60_000;
const DEFAULT_WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * The owner's tone for one turn as the sniffer reads it (E4): negative on bad news, frustration, a correction or
 * distress (any ≥ 0.3); positive on good news, praise, thanks or humour (≥ 0.6); neutral otherwise.
 */
export function ownerToneOf(cues: AffectCues): OwnerTone {
  if (cues.distress || cues.badNews >= 0.3 || cues.frustration >= 0.3 || cues.correction >= 0.3) return 'negative';
  if (cues.goodNews >= 0.6 || cues.praise >= 0.6 || cues.gratitude >= 0.6 || cues.humor >= 0.6) return 'positive';
  return 'neutral';
}

/** A real question, not a request phrased as one ("Can you draft…?" is a request): E4 `owner_question`. */
export const isOwnerQuestion = (cues: AffectCues): boolean => cues.question && cues.request < 0.6 && cues.stopOrSteer < 0.6;

/** The owner asked for something (a question or a request): upbeat "ooh, a puzzle" fillers require it (E4 `owner_asks`). */
export const isOwnerAsk = (cues: AffectCues): boolean => cues.question || cues.request >= 0.6;

/** True when a step label reads as a gerund phrase ("reading 14 reports"), so "Still {step_label}" is grammatical (E23). */
export function isGerundLabel(label: string | null | undefined): boolean {
  const first = String(label ?? '').trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z'-]/g, '') ?? '';
  return first.length > 4 && first.endsWith('ing') && !/^(thing|string|spring|morning|evening|ceiling|during|nothing|something|anything|everything|king|wing|ring|sing|bring)$/.test(first);
}

/** Work-week contexts (E14) for a JS weekday and the workspace's working days. */
function workweekContexts(weekday: number, workDays: readonly number[] | undefined, c: Set<string>): void {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return;
  const days = new Set((workDays?.length ? workDays : DEFAULT_WORK_DAYS).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (!days.size) return;
  if (days.has(0) || days.has(6)) c.add('works_weekends');
  if (!days.has(weekday)) {
    c.add('weekend');
    return;
  }
  if (days.size === 7) return; // no first or last day in a seven-day week
  if (!days.has((weekday + 6) % 7)) c.add('workweek:first_day');
  if (!days.has((weekday + 1) % 7)) c.add('workweek:last_day');
}

/** Boolean facts about the moment, used by line `context` requirements (§3.4, intents.json `contexts`). */
export function deriveContexts(state: GroundingState): ReadonlySet<string> {
  const c = new Set<string>();
  const now = num(state.now?.epochMs, 0);
  const pod = partOfDay(state.now?.localHour);
  c.add(`part_of_day:${pod}`);
  const wd = weekdayName(state.now?.weekday);
  if (wd) c.add(`weekday:${wd.toLowerCase()}`);
  workweekContexts(state.now?.weekday, state.now?.workDays, c);
  const h = state.history;
  if (h?.firstMeeting) c.add('first_meeting');
  if (h?.returning) c.add('returning');
  if (h?.newDay) c.add('new_day');
  if (h?.lastWinAt != null && now - h.lastWinAt >= 0 && now - h.lastWinAt <= WIN_WINDOW_MS) c.add('after_win');
  const unblockedRecently = h?.lastUnblockedAt != null && now - h.lastUnblockedAt >= 0 && now - h.lastUnblockedAt <= WIN_WINDOW_MS;
  if (unblockedRecently) {
    c.add('after_blocker');
    if (h?.lastUnblockedBy) c.add(`unblocked_by:${h.lastUnblockedBy}`);
  }
  if ((h?.winsToday ?? 0) >= 3) c.add('streak');
  if ((h?.unseenUpdates ?? 0) > 0) c.add('has_updates');
  if (h?.distressThisSession) c.add('after_distress');
  const x = state.exchange;
  if (x?.mode === 'voice') c.add('voice_mode');
  if (x?.mode === 'text') c.add('text_mode');
  if (x?.steerQueued) c.add('steer_queued');
  if (x?.interrupted) c.add('interrupted');
  if (x?.ownerFarewell) c.add('owner_farewell');
  if (x?.ownerGreeting) c.add('owner_greeting');
  if (x?.ownError) c.add('own_error');
  const cues = x?.cues;
  if (cues) {
    if (isOwnerQuestion(cues)) c.add('owner_question');
    if (isOwnerAsk(cues)) c.add('owner_asks');
    if (cues.praise >= 0.6) c.add('owner_praise');
    if (cues.gratitude >= 0.6) c.add('owner_gratitude');
    if ((cues.selfDoubt ?? 0) >= 0.6) c.add('owner_self_doubt');
    c.add(`owner_tone:${ownerToneOf(cues)}`);
  }
  for (const t of x?.topics ?? []) if (/^[a-z][a-z0-9_-]*$/.test(t)) c.add(`topic:${t}`);
  const self = state.self;
  if (self?.blocked) c.add('blocked');
  if (self && !self.staffed) c.add('unstaffed');
  const busy = self?.presence === 'working' || self?.presence === 'thinking';
  if (busy && !self?.blocked) c.add('working');
  if (!busy && !self?.blocked && self?.staffed && !state.work?.stepLabel) c.add('idle');
  const activity = self?.activity ? String(self.activity).toLowerCase().replace(/[^a-z0-9_-]/g, '') : '';
  if (activity) {
    c.add(`activity:${activity}`);
    if (activity === 'meeting') c.add('in_meeting');
  }
  if (self?.role) c.add(`role:${self.role}`);
  if (state.review?.verdict) c.add(`verdict:${state.review.verdict}`);
  if (state.replyTo) {
    c.add(`reply_to:${state.replyTo}`);
    c.add('reply_to:any');
  }
  if (state.work?.stepLabel && isGerundLabel(stepLabel(state.work.stepLabel))) c.add('step_ing');
  if (etaPhrase(state.attention?.etaMs ?? null) !== null) c.add('eta_known');
  if (state.quietHours) c.add('quiet_hours');
  return c;
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const SECRET_RES: readonly RegExp[] = [
  /\b(?:sk|pk|rk|xai|ghp|gho|ghs|github_pat|xox[abprs]|AKIA|ASIA)[-_][A-Za-z0-9_-]{8,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  /\b(?:password|passwd|pwd|secret|token|api[_ -]?key)\s*[:=]\s*\S+/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, // JWT
  /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{24,}\b/g, // mixed-case opaque tokens
  /\b[a-f0-9]{32,}\b/gi, // hex digests and keys
];
const TAINT_RE = /⟦\s*(?:tainted|whisper)\s*⟧|\[\s*(?:tainted|whisper)\s*\]/i;

/**
 * A ≤ 60-character, speakable summary of a real event for side-talk (§8.3, H3). Strips markup, URLs,
 * e-mail addresses and secret-looking tokens; keeps the first sentence; cuts at a word boundary with "…".
 * Returns null for empty results and for text a host marked `⟦tainted⟧` or `⟦whisper⟧`.
 */
export function sanitizeGist(raw: string, maxChars = 60): string | null {
  if (typeof raw !== 'string' || TAINT_RE.test(raw)) return null;
  let s = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(URL_RE, ' ')
    .replace(EMAIL_RE, ' ');
  for (const re of SECRET_RES) s = s.replace(re, ' ');
  s = s
    .replace(/<[^>]*>/g, ' ')
    .replace(/[`*_#>|~]/g, ' ')
    .replace(/[[\]<>{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
  const first = s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s;
  s = first.replace(/^[\s,;:—–-]+/, '').trim();
  if (!s || !/[\p{L}\p{N}]/u.test(s)) return null;
  const max = Math.max(8, maxChars);
  if (s.length <= max) return s;
  return `${capAtWord(s, max - 1).replace(/[\s,;:.!?—–-]+$/, '')}…`;
}
