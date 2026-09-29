// Selection (§5): filter → score → seeded weighted pick → fill → utterance. Synchronous, O(candidates),
// no I/O. The same catalog, seed, state, mood and recency give the same pick everywhere (L7).
import { fillKeyOf } from './delivery';
import { seededRng } from './hash';
import { containsPhrase } from './catalog';
import { catalogInternalsOf, indexInternalsOf, lineCatalog, num } from './internal';
import type { IndexInternals } from './internal';
import { estimateMs, INTENSITY_VALUE } from './lines';
import { instructionsFromTags, openaiInputFromXai, placeholders, readable, speakable, stripMarkupChars } from './markup';
import { ownerFacing } from './mood';
import { deriveContexts, resolveSlots, sanitizeGist, sanitizeSlotValue } from './state';
import type {
  AgentIndex, CompiledCatalog, CompiledLine, FaceCue, GroundingState, IntentDef, RecencyMemory, SelectRequest, SelectResult,
  SkipReason, SlotValues, Utterance, WeightedLine,
} from './types';
import { SIDETALK_OPENERS } from './vocab';
import type { IntentId, SlotId, TtsProvider } from './vocab';

export { seededRng } from './hash';
export { readable, speakable } from './markup';

const SIDETALK_INTENTS = new Set<IntentId>([...SIDETALK_OPENERS, 'handoff_take', 'sidetalk_reply']);

/** Short delivery hints per intent for providers that take free-text instructions (§5.6). */
const INTENT_HINTS: Readonly<Partial<Record<IntentId, string>>> = {
  backchannel: 'A short, soft listener sound at low volume; listening, not agreeing.',
  acknowledge: 'A quick, relaxed receipt of a request.',
  thinking_filler: 'Thinking aloud, relaxed and unhurried.',
  holding_filler: 'Calm and reassuring, a little quieter.',
  deferral: 'Warm and matter-of-fact.',
  laugh: 'A natural, genuine laugh.',
  surprise: 'Genuinely surprised, brief.',
  delight: 'Warmly pleased.',
  concern: 'Sober and steady, a little lower.',
  sympathy: 'Soft, gentle and sincere.',
  encouragement: 'Warm and steady, quietly confident.',
  gratitude_reply: 'Warm and easy.',
  apology: 'Light and sincere, never grovelling.',
  yield_floor: 'Gentle, handing over the floor.',
  juggling: 'Friendly and quick, a brief aside.',
  back_with_you: 'Refocused and friendly.',
  greeting: 'A friendly hello.',
  passing_by: 'Casual, glancing up from work, a little quieter.',
  micro_status: 'Matter-of-fact and brief.',
  quip: 'A light aside, a little quieter.',
  sign_off: 'A friendly goodbye.',
  handoff_give: 'A casual aside to a colleague.',
  handoff_take: 'A casual reply to a colleague.',
  ask_coworker: 'A casual question to a colleague.',
  answer_coworker: 'A casual answer to a colleague.',
  share_result: 'A casual, pleased aside to a colleague.',
  review_approve: 'Friendly and approving, to a colleague.',
  review_changes: 'Kind and constructive, to a colleague.',
  sidetalk_reply: 'A casual reply to a colleague.',
  celebrate: 'Pleased and bright.',
  blocked: 'Matter-of-fact, a little deflated, never dramatic.',
  unblocked: 'Relieved.',
  oops: 'A light self-correction, unbothered.',
};

const pick = (fills: SlotValues, slots: readonly SlotId[]): SlotValues => {
  const out: SlotValues = {};
  for (const s of slots) if (fills[s] !== undefined) out[s] = fills[s];
  return out;
};

/** Substitute sanitised fills into a template; a slot at a sentence start is capitalised. */
function substitute(template: string, fills: SlotValues, sentenceStart = true): string {
  const out = template.replace(/\{([a-z_]+)\}/g, (_m, slot: string, offset: number, whole: string) => {
    const raw = fills[slot as SlotId];
    if (raw === undefined) return '';
    const v = stripMarkupChars(raw);
    const before = readable(whole.slice(0, offset));
    const atStart = before === '' ? sentenceStart : /[.!?…]$/.test(before);
    return atStart && v ? v[0]!.toUpperCase() + v.slice(1) : v;
  });
  return out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.!?;:])/g, '$1').trim();
}

/** Fill a line's caption, xAI rendering and OpenAI `say` from sanitised slot values (§5.5). */
export function fillLine(line: CompiledLine, fills: SlotValues): { caption: string; xai: string; openaiSay: string } {
  return fillAt(line, fills, true);
}

function fillAt(line: CompiledLine, fills: SlotValues, sentenceStart: boolean): { caption: string; xai: string; openaiSay: string } {
  return {
    caption: substitute(line.text, fills, sentenceStart),
    xai: line.xai ? substitute(line.xai, fills, sentenceStart) : '',
    openaiSay: line.openai.say ? substitute(line.openai.say, fills, sentenceStart) : '',
  };
}

/** Owner-local YYYY-MM-DD, derived from the state's epoch time and owner-local hour (daily caps, §4.2). */
export function ownerDayKey(state: Pick<GroundingState, 'now'>): string {
  const epoch = num(state.now?.epochMs, 0);
  const utcHour = new Date(epoch).getUTCHours();
  let offset = num(state.now?.localHour, utcHour) - utcHour;
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  return new Date(epoch + offset * 3_600_000).toISOString().slice(0, 10);
}

function neverSaysHit(ii: IndexInternals, line: CompiledLine, caption: string, ownerFacingIntent: boolean): boolean {
  const test = () => ii.neverSays.some((p) => containsPhrase(caption, p)) || (ownerFacingIntent && ii.ownerNever.some((p) => containsPhrase(caption, p)));
  if (!line.slots.length) {
    const key = `${line.id}|${line.intent}`;
    const cached = ii.staticNever.get(key);
    if (cached !== undefined) return cached;
    const hit = test();
    ii.staticNever.set(key, hit);
    return hit;
  }
  return test();
}

const isOwnerFacing = (intent: IntentId): boolean => !SIDETALK_INTENTS.has(intent);

/** A reply that laughs or shrugs (E7): never after a changes or block verdict, where it reads as a sneer at a colleague. */
const LAUGHING_REPLY = /\b(ha|hah|haha|heh|hehe|lol)\b/i;
function laughsOrShrugs(line: CompiledLine): boolean {
  if (line.nonverbal || /\[laugh\]/i.test(line.xai) || LAUGHING_REPLY.test(line.text)) return true;
  return line.text.replace(/\{[a-z_]+\}/g, 'x').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length <= 1;
}

/**
 * score = prior × moodFit × contextBonus × recency × textRecency × openerPenalty × crossAgent × weeklyWear (§5.3, E1).
 * Line recency reads the agent's ring for this intent, so hours of other talk never erase it.
 */
export function scoreLine(line: WeightedLine, req: SelectRequest, recency: RecencyMemory, contexts: ReadonlySet<string>): number {
  const l = line.line;
  const d = lineCatalog.get(l)?.defaults ?? {};
  const mood = isOwnerFacing(req.intent) ? ownerFacing(req.mood, num(d.owner_facing_valence_floor, -0.3)) : req.mood;
  let moodFit = num(d.mood_neutral_fit, 0.8);
  if (l.mood) {
    const sigma = num(l.mood.spread, num(d.mood_fit_default_spread, 0.6));
    const dist2 = (mood.valence - l.mood.valence) ** 2 + (mood.energy - l.mood.energy) ** 2;
    moodFit = Math.max(0.05, Math.exp(-dist2 / (2 * sigma * sigma)));
  }
  const matched = l.require.filter((c) => contexts.has(c)).length;
  const contextBonus = Math.min(num(d.context_bonus_cap, 1.69), Math.pow(num(d.context_match_bonus, 1.3), matched));
  const tau = num(d.recency_tau, 8);
  const agentId = req.state.self.agentId;
  const recent = recency.recent(agentId);
  const ring = recency.recentFor(agentId, l.intent);
  const k = ring.findIndex((e) => e.lineId === l.id);
  const kt = recent.findIndex((e) => e.textHash === l.textHash);
  const recencyF = k < 0 ? 1 : 1 - 0.9 * Math.exp(-k / tau);
  const textF = kt < 0 ? 1 : 1 - 0.9 * Math.exp(-kt / tau);
  const opener = recent[0] && recent[0].opener === l.opener ? 0.5 : 1;
  const cross = recency.recentText(l.textHash, req.now, num(d.cross_agent_text_dedupe_ms, 60_000)) ? 0.2 : 1;
  const week = Math.min(num(d.weekly_wear_cap, 10), recency.usesWeek(agentId, l.id, ownerDayKey(req.state)));
  const wear = week > 0 ? Math.pow(num(d.weekly_wear_factor, 0.7), week) : 1;
  return line.prior * moodFit * contextBonus * recencyF * textF * opener * cross * wear;
}

// ── runtime-slot splits (§7.5) ──────────────────────────────────────────────────
const BOUNDARY = new Set(['—', '–', ',', ':', '.', '!', '?', '…']);

function openWrappersAt(xai: string, pos: number): string[] {
  const open: string[] = [];
  for (const m of xai.slice(0, pos).matchAll(/<\s*(\/?)\s*([a-z]+)\s*>/gi)) {
    const name = m[2]!.toLowerCase();
    if (!m[1]) open.push(name);
    else {
      const at = open.lastIndexOf(name);
      if (at >= 0) open.splice(at);
    }
  }
  return open;
}

interface SplitParts { prefixText: string; prefixXai: string; tailText: string; tailXai: string }

function splitParts(line: CompiledLine, runtime: readonly SlotId[]): SplitParts | null {
  if (line.nonverbal || !runtime.length) return null;
  const idxIn = (s: string) => Math.min(...runtime.map((r) => s.indexOf(`{${r}}`)).filter((i) => i >= 0));
  const first = idxIn(line.text);
  if (!Number.isFinite(first) || first <= 0) return null;
  const head = line.text.slice(0, first);
  let b = -1;
  for (let i = head.length - 1; i >= 0; i--) if (BOUNDARY.has(head[i]!)) { b = i; break; }
  if (b < 0) return null;
  const prefixText = head.slice(0, b + 1).trim();
  if (prefixText.split(/\s+/).filter(Boolean).length < 2) return null;
  const xai = line.xai || line.text;
  const firstX = idxIn(xai);
  if (!Number.isFinite(firstX)) return null;
  const headX = xai.slice(0, firstX);
  for (let i = headX.length - 1; i >= 0; i--) {
    if (!BOUNDARY.has(headX[i]!)) continue;
    const prefixXai = speakable(headX.slice(0, i + 1));
    if (readable(prefixXai) !== readable(prefixText)) continue;
    const reopen = openWrappersAt(xai, i + 1).map((t) => `<${t}>`).join('');
    const tailXai = speakable(reopen + xai.slice(i + 1));
    const tailText = line.text.slice(b + 1).trim();
    if (readable(tailXai) !== readable(tailText)) return null;
    return { prefixText, prefixXai, tailText, tailXai };
  }
  return null;
}

function pseudoLine(line: CompiledLine, suffix: string, text: string, xai: string): CompiledLine {
  const slots = line.slots.filter((s) => text.includes(`{${s}}`));
  return {
    ...line,
    id: `${line.id}~${suffix}`,
    text,
    xai,
    openai: { say: openaiInputFromXai(xai), instructions: line.openai.instructions },
    slots,
    estMs: estimateMs(xai, false),
  };
}

function runtimeSlotsOf(catalog: CompiledCatalog, line: CompiledLine): SlotId[] {
  const defs = catalogInternalsOf(catalog).slots;
  return line.slots.filter((s) => defs[s]?.prevoice === 'runtime');
}

// ── utterances ──────────────────────────────────────────────────────────────────
function faceFor(def: IntentDef, index: AgentIndex, line: CompiledLine): FaceCue {
  const f = def.channels.face;
  const gesture = def.id === 'laugh' && index.laugh.kind === 'silent_smile' && line.nonverbal ? 'smile' : f.gesture;
  return { gesture, ...(f.expression ? { expression: f.expression } : {}), holdMs: f.hold_ms };
}

function instructionsFor(ii: IndexInternals, index: AgentIndex, def: IntentDef, line: CompiledLine): string {
  const hint = def.id === 'laugh' && line.nonverbal ? index.laugh.openai?.instructions ?? INTENT_HINTS.laugh : INTENT_HINTS[def.id];
  return [ii.archetypeInstructions, hint, line.openai.instructions ?? instructionsFromTags(line.xai)]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

function buildUtterance(index: AgentIndex, line: CompiledLine, fills: SlotValues, seed: string, withSplit: boolean, sentenceStart = true): Utterance {
  const ii = indexInternalsOf(index);
  const def = ii.catalog.intents.get(line.intent)!;
  const lf = pick(fills, line.slots);
  const f = fillAt(line, lf, sentenceStart);
  const xai = speakable(f.xai);
  const openaiInput = f.openaiSay.trim();
  const u: Utterance = {
    agentId: index.agentId,
    intent: line.intent,
    lineId: line.id,
    source: line.source,
    caption: f.caption,
    fills: lf,
    fillKey: fillKeyOf(lf),
    nonverbal: line.nonverbal,
    speak: {
      xai,
      openai: openaiInput ? { input: openaiInput, instructions: instructionsFor(ii, index, def, line) } : null,
      browser: line.nonverbal ? null : f.caption,
    },
    estMs: line.slots.length ? estimateMs(f.xai || f.caption, line.nonverbal) : line.estMs,
    face: faceFor(def, index, line),
    seed,
    ...(line.gloss ? { gloss: line.gloss } : {}),
    ...(line.solicits ? { solicits: true } : {}),
  };
  if (withSplit) {
    const parts = splitParts(line, runtimeSlotsOf(ii.catalog, line));
    if (parts) {
      const prefix = buildUtterance(index, pseudoLine(line, 'prefix', parts.prefixText, parts.prefixXai), lf, seed, false);
      const tailText = substitute(parts.tailText, lf, /[.!?…]$/.test(parts.prefixText));
      u.split = { prefix, tailText };
    }
  }
  return u;
}

function unvoiceable(line: CompiledLine, provider: TtsProvider): boolean {
  if (!line.nonverbal) return false;
  if (provider === 'browser') return true;
  if (provider === 'openai') return !line.openai.say;
  if (provider === 'xai') return !line.xai;
  return false;
}

function isInstant(index: AgentIndex, line: CompiledLine, lf: SlotValues, fk: string, req: SelectRequest): boolean {
  if (req.provider === 'browser') return true;
  if (!req.clips || !req.clipKeyOf) return req.provider === 'mock';
  const ii = indexInternalsOf(index);
  const parts = splitParts(line, runtimeSlotsOf(ii.catalog, line));
  if (parts) {
    const prefixSlots = line.slots.filter((s) => parts.prefixText.includes(`{${s}}`));
    const key = req.clipKeyOf(`${line.id}~prefix`, fillKeyOf(pick(lf, prefixSlots)));
    return !!key && req.clips.has(key);
  }
  const key = req.clipKeyOf(line.id, fk);
  return !!key && req.clips.has(key);
}

const STAGES: readonly SkipReason[] = ['ungrounded', 'context', 'never_says', 'too_long', 'not_instant', 'exhausted'];

/** Pick one line for an intent (§5.1). Pure: it never records the pick (see `recordUtterance`). */
export function selectLine(index: AgentIndex, req: SelectRequest, recency: RecencyMemory): SelectResult {
  const ii = indexInternalsOf(index);
  const catalog = ii.catalog;
  const def = catalog.intents.get(req.intent);
  if (!def) return { ok: false, reason: 'no_candidates', considered: 0 };
  if (!(index.intentWeight(req.intent) > 0)) return { ok: false, reason: 'disabled', considered: 0 };
  const cands = index.candidates(req.intent);
  if (!cands.length) return { ok: false, reason: 'no_candidates', considered: 0 };

  const d = catalog.defaults;
  const contexts = deriveContexts(req.state);
  const wanted = new Set<SlotId>();
  for (const c of cands) for (const s of c.line.slots) wanted.add(s);
  const fills = resolveSlots(req.state, [...wanted], catalog);
  const cap = req.laughIntensityCap ?? num(catalog.ambience[req.ambience]?.laugh_intensity_cap, 1);
  const baseMaxMs = Math.min(def.max_ms, req.maxDurationMs ?? Number.POSITIVE_INFINITY);
  // Duration budgets that match the moment (E6): a line written for a steer or an interruption may run longer, and
  // that budget also overrides the dynamic cap (the honest "lands at the next step" line is worth the time).
  const ctxBudgets = Object.entries(def.max_ms_by_context ?? {}).filter(([c, v]) => typeof v === 'number' && contexts.has(c));
  const maxMsFor = (line: CompiledLine): number => {
    let m = -1;
    for (const [c, v] of ctxBudgets) if (line.require.includes(c)) m = Math.max(m, v);
    return m >= 0 ? m : baseMaxMs;
  };
  const dayKey = ownerDayKey(req.state);
  const ownerFacingIntent = isOwnerFacing(req.intent);
  // Side-talk replies answer the opener they follow (E7): only lines tagged for it (or reply_to:any), and after a
  // changes or block verdict never a laugh, a "heh" or a one-word shrug.
  const isReply = req.intent === 'sidetalk_reply';
  const harshReply = isReply && (req.state.replyTo === 'review_changes' || req.state.review?.verdict === 'block');
  let furthest = -1;
  const fail = (stage: number) => {
    if (stage > furthest) furthest = stage;
  };
  const eligible: { wl: WeightedLine; lf: SlotValues }[] = [];

  for (const wl of cands) {
    const line = wl.line;
    if (!line.slots.every((s) => fills[s] !== undefined)) { fail(0); continue; }
    if (!line.require.every((c) => contexts.has(c)) || line.forbid.some((c) => contexts.has(c))) { fail(1); continue; }
    if (isReply && !line.require.some((c) => c.startsWith('reply_to:'))) { fail(1); continue; }
    if (harshReply && laughsOrShrugs(line)) { fail(1); continue; }
    if (req.ambience === 'quiet' && line.intensity === 'high') { fail(1); continue; }
    if ((req.intent === 'laugh' || /\[laugh\]/i.test(line.xai)) && INTENSITY_VALUE[line.intensity] > cap) { fail(1); continue; }
    const lf = pick(fills, line.slots);
    const caption = line.slots.length ? substitute(line.text, lf) : line.text;
    if (neverSaysHit(ii, line, caption, ownerFacingIntent)) { fail(2); continue; }
    const fk = fillKeyOf(lf);
    const key = req.clipKeyOf?.(line.id, fk);
    const clipMs = key && req.clips?.has(key) ? req.clips.durationMs(key) : null;
    const est = clipMs ?? (line.slots.length ? estimateMs(substitute(line.xai || line.text, lf), line.nonverbal) : line.estMs);
    if (est > maxMsFor(line)) { fail(3); continue; }
    if (req.channel === 'voice' && unvoiceable(line, req.provider)) { fail(4); continue; }
    // Non-English words (E17) are voiced only where pronunciation is controlled: OpenAI with instructions, or a
    // clip a human checked. Otherwise the agent says one of its English lines.
    if (req.channel === 'voice' && line.lang && !((req.provider === 'openai' && !!line.openai.instructions) || (!!key && !!req.clips?.pronunciationChecked?.(key)))) { fail(4); continue; }
    if (req.instantOnly && !isInstant(index, line, lf, fk, req)) { fail(4); continue; }
    if (line.maxPerDay !== null && recency.usesToday(index.agentId, line.id, dayKey) >= line.maxPerDay) { fail(5); continue; }
    if (line.maxPerWeek !== null && recency.usesWeek(index.agentId, line.id, dayKey) >= line.maxPerWeek) { fail(5); continue; }
    if (line.family) {
      const used = (ii.families.get(line.family) ?? []).reduce((s, id) => s + recency.usesToday(index.agentId, id, dayKey), 0);
      if (used >= ii.familyCap(line.family)) { fail(5); continue; }
    }
    if (req.excludeSoliciting && line.solicits) { fail(5); continue; }
    eligible.push({ wl, lf });
  }
  if (!eligible.length) return { ok: false, reason: furthest >= 0 ? STAGES[furthest]! : 'no_candidates', considered: cands.length };

  // Context-first (E5): when the trigger set a specific context (a steer, an interruption, a first meeting, a reply
  // to an opener …), lines written for it are the pool; generic lines are only the fallback.
  let pool = eligible;
  const firstTags = [...(Array.isArray(d.context_first) ? (d.context_first as string[]) : []), ...(def.context_first ?? [])];
  const holdingFirst = new Set<string>();
  for (const t of firstTags) {
    if (t.endsWith(':*')) {
      for (const c of contexts) if (c.startsWith(t.slice(0, -1)) && !c.endsWith(':any')) holdingFirst.add(c);
    } else if (contexts.has(t)) holdingFirst.add(t);
  }
  if (holdingFirst.size) {
    const specific = pool.filter((e) => e.wl.line.require.some((c) => holdingFirst.has(c)));
    if (specific.length) pool = specific;
  }
  // Texts a teammate on the pod said recently (E7), when alternatives exist.
  if (req.avoidTextHashes?.size) {
    const fresh = pool.filter((e) => !req.avoidTextHashes!.has(e.wl.line.textHash));
    if (fresh.length) pool = fresh;
  }

  // Hard exclusion: the last N lines of this intent (N = max(3, ⌈pool/2⌉)), when alternatives exist (§5.3, E1).
  const minN = Math.max(0, Math.floor(num(d.same_intent_hard_exclude, 3)));
  const n = Math.max(minN, Math.ceil(pool.length / 2));
  const lastSame = new Set(recency.recentFor(index.agentId, req.intent).slice(0, n).map((e) => e.lineId));
  const unrepeated = pool.filter((e) => !lastSame.has(e.wl.line.id));
  if (unrepeated.length) pool = unrepeated;
  // Hard exclusion across intents (E1): a text among this agent's last N picks is never said again right away, when
  // alternatives exist (a catchphrase that is both an acknowledgement and a filler: "Let me sketch it." twice).
  const textN = Math.max(0, Math.floor(num(d.recent_text_hard_exclude, 4)));
  if (textN) {
    const lastTexts = new Set(recency.recent(index.agentId).slice(0, textN).map((e) => e.textHash));
    const freshText = pool.filter((e) => !lastTexts.has(e.wl.line.textHash));
    if (freshText.length) pool = freshText;
  }

  const scoreReq: SelectRequest = req.state.self.agentId === index.agentId ? req : { ...req, state: { ...req.state, self: { ...req.state.self, agentId: index.agentId } } };
  const T = Math.max(0.05, num(d.selection_temperature, 0.7));
  const weights = pool.map((e) => Math.pow(Math.max(scoreLine(e.wl, scoreReq, recency, contexts), 1e-12), 1 / T));
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
  const utterance = buildUtterance(index, chosen.wl.line, chosen.lf, req.seed, true);
  return { ok: true, utterance, considered: cands.length };
}

// ── additive helpers for hosts ──────────────────────────────────────────────────
/** Record a played utterance in recency memory (selection itself never records). */
export function recordUtterance(recency: RecencyMemory, index: AgentIndex, u: Utterance, at: number, dayKey: string): void {
  const baseId = u.lineId.replace(/~(prefix|tail|gist)$/, '');
  const line = indexInternalsOf(index).lines.get(baseId)?.find((l) => l.intent === u.intent) ?? indexInternalsOf(index).lines.get(baseId)?.[0];
  recency.record(index.agentId, {
    lineId: baseId,
    intent: u.intent,
    textHash: line?.textHash ?? 0,
    opener: line?.opener ?? '',
    at,
  }, dayKey);
}

/** Validate client-supplied fills for a line's slots (used by `POST /api/expr/render`). Empty = valid. */
export function validateFills(catalog: CompiledCatalog, slots: readonly SlotId[], fills: SlotValues): string[] {
  const defs = catalogInternalsOf(catalog).slots;
  const problems: string[] = [];
  for (const [k, v] of Object.entries(fills ?? {})) {
    const slot = k as SlotId;
    if (!slots.includes(slot)) {
      problems.push(`slot ${k} is not used by this line`);
      continue;
    }
    const def = defs[slot];
    if (typeof v !== 'string' || !v) {
      problems.push(`slot ${k} must be a non-empty string`);
      continue;
    }
    if (sanitizeSlotValue(v, num(def?.max_chars, 40)) !== v) problems.push(`slot ${k} has markup, extra whitespace or is too long`);
    if (slot === 'gist' && sanitizeGist(v) !== v) problems.push('gist must already be sanitised');
    if (def?.prevoice === 'finite' && def.domain && !def.domain.includes(v)) {
      const numeric = (slot === 'done' || slot === 'total' || slot === 'finding_count') && /^\d{1,4}$/.test(v);
      if (!numeric) problems.push(`slot ${k} must be one of its domain values`);
    }
  }
  for (const s of slots) if (fills?.[s] === undefined) problems.push(`slot ${s} is missing`);
  return problems;
}

/**
 * Rebuild the utterance for a line id and fills: `<id>` (whole line), `<id>~prefix` / `<id>~tail` (the §7.5
 * split parts) or `<id>~gist` (a side-talk gist in this agent's voice). Validates that the agent can say the
 * line and that the fills pass the slot validators. For the render endpoint and the pre-voicer.
 */
export function renderUtterance(
  index: AgentIndex, lineId: string, fills: SlotValues,
): { ok: true; utterance: Utterance } | { ok: false; problems: string[] } {
  const ii = indexInternalsOf(index);
  const m = /^(.*?)(?:~(prefix|tail|gist))?$/.exec(lineId)!;
  const baseId = m[1]!;
  const part = m[2] as 'prefix' | 'tail' | 'gist' | undefined;
  const line = ii.lines.get(baseId)?.[0];
  if (!line) return { ok: false, problems: [`unknown line ${baseId} for ${index.agentId}`] };
  if (part === 'gist') {
    const problems = validateFills(ii.catalog, ['gist'], pick(fills, ['gist']));
    if (problems.length) return { ok: false, problems };
    const gistLine = pseudoLine({ ...line, slots: ['gist'], nonverbal: false }, 'gist', '{gist}', '{gist}');
    return { ok: true, utterance: buildUtterance(index, gistLine, pick(fills, ['gist']), `render:${lineId}`, false) };
  }
  if (!part) {
    const problems = validateFills(ii.catalog, line.slots, pick(fills, line.slots));
    if (problems.length) return { ok: false, problems };
    return { ok: true, utterance: buildUtterance(index, line, fills, `render:${lineId}`, false) };
  }
  const parts = splitParts(line, runtimeSlotsOf(ii.catalog, line));
  if (!parts) return { ok: false, problems: [`line ${baseId} has no ${part}`] };
  const pl = part === 'prefix' ? pseudoLine(line, 'prefix', parts.prefixText, parts.prefixXai) : pseudoLine(line, 'tail', parts.tailText, parts.tailXai);
  const problems = validateFills(ii.catalog, pl.slots, pick(fills, pl.slots));
  if (problems.length) return { ok: false, problems };
  const sentenceStart = part === 'prefix' || /[.!?…]$/.test(parts.prefixText);
  return { ok: true, utterance: buildUtterance(index, pl, fills, `render:${lineId}`, false, sentenceStart) };
}

/** The line behind a line id for this agent (any intent), or null. */
export function lineOf(index: AgentIndex, lineId: string): CompiledLine | null {
  return indexInternalsOf(index).lines.get(lineId.replace(/~(prefix|tail|gist)$/, ''))?.[0] ?? null;
}

/** The pre-voiceable prefix of a line with runtime slots (§7.5) as its own pseudo-line `<id>~prefix`, or null. */
export function prefixLineOf(index: AgentIndex, line: CompiledLine): CompiledLine | null {
  const ii = indexInternalsOf(index);
  const parts = splitParts(line, runtimeSlotsOf(ii.catalog, line));
  return parts ? pseudoLine(line, 'prefix', parts.prefixText, parts.prefixXai) : null;
}

/** Utterance for an exact line and fills (no filtering, no randomness): used by pre-voicing. */
export function utteranceFor(index: AgentIndex, line: CompiledLine, fills: SlotValues): Utterance {
  return buildUtterance(index, line, fills, `prevoice:${line.id}`, true);
}

/** Placeholders of a line's text, for callers that build fills themselves. */
export function slotsOf(text: string): SlotId[] {
  return [...new Set(placeholders(text))] as SlotId[];
}
