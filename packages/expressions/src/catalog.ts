// Catalog compilation, archetype blending and per-agent indexes (docs/LIVING-WORKFORCE.md §4, §5.2).
import { base32Int, canonicalJson, cyrb53 } from './hash';
import { catalogInternals, catalogInternalsOf, clamp, indexInternals, indexInternalsOf, lineCatalog, num } from './internal';
import type { CatalogInternals } from './internal';
import { estimateMs, intensityFromNumber, intensityOf, laughCaption, openerOf, textHashOf } from './lines';
import { BANNED_TAGS, openaiInputFromXai, placeholders, readable, speakable } from './markup';
import { baselineMood, reactivityOf } from './mood';
import type {
  AgentExpressionProfile, AgentIndex, AmbienceProfile, ArchetypeBlend, ArchetypeDef, ArchetypePack, ArchetypesFile,
  CatchphraseDef, CompiledCatalog, CompiledLine, ExpressionCatalogInput, IntentDef, LaughStyle, LineDef,
  PersonalityInput, SignatureFile, SignaturePack, WeightedLine,
} from './types';
import {
  AMBIENCES, ARCHETYPE_IDS, GLOBAL_NEVER_SAYS, GLOBAL_NEVER_SAYS_OWNER_FACING, INTENT_IDS, LAUGH_KINDS, SLIDER_KEYS, SLOT_IDS,
  isArchetypeId, isIntentId, isSlotId,
} from './vocab';
import type { Ambience, ArchetypeId, IntentId, Sliders, SlotId } from './vocab';

// ── errors ──────────────────────────────────────────────────────────────────────
export class ExpressionCatalogError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    const head = problems.slice(0, 5).join('; ');
    super(`expression catalog: ${problems.length} problem(s): ${head}${problems.length > 5 ? '; …' : ''}`);
    this.name = 'ExpressionCatalogError';
    this.problems = [...problems];
  }
}

interface Problem { where: string; message: string; lineId?: string; packId?: string; fatal?: boolean }
const fmt = (p: Problem): string => `${p.where}${p.lineId ? ` ${p.lineId}` : ''}: ${p.message}`;

// ── line checks (the runtime half of catalog/scripts/validate-expressions.mjs) ──
const LINE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9_]*\.[0-9]{2,3}$/;
const CONTEXT_TAG = /^!?[a-z][a-z0-9_]*(:[a-z0-9_-]+)?$/;
const COMPLETION_CLAIM = /\b(sent|published|posted|paid|booked|deployed|shipped|signed|emailed|submitted|launched|scheduled|delivered it)\b/i;
const EMBODIMENT = /\b(coffee|lunch|commute|my kids|slept|sleepy|weekend plans|bathroom|drive home|traffic|hungover|caffeine|my desk chair|headphones|happy tears|in tears|mid-call|on a call|you and me both)\b/i;
const LANG_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const FAMILY_ID = /^[a-z][a-z0-9-]{1,31}$/;
const OWNER_TALK = /\b(the owner|the boss|boss man|our client said)\b/i;
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
};

const phraseCache = new Map<string, RegExp>();

/** Case-insensitive whole-phrase matcher that works for phrases starting or ending with punctuation (cached). */
export function phraseRegex(phrase: string): RegExp {
  const key = String(phrase).trim().toLowerCase();
  let re = phraseCache.get(key);
  if (!re) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    re = new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'iu');
    phraseCache.set(key, re);
  }
  return re;
}

/** Whole-phrase, case-insensitive test with a cheap substring pre-filter (most texts never contain the phrase). */
export function containsPhrase(text: string, phrase: string): boolean {
  const key = String(phrase).trim().toLowerCase();
  if (!key) return false;
  const lower = text.toLowerCase();
  if (!lower.includes(key.split(/\s+/)[0]!)) return false;
  return phraseRegex(key).test(text);
}

function contextOk(tag: string, contextKeys: Set<string>): boolean {
  if (!CONTEXT_TAG.test(tag)) return false;
  const t = tag.replace(/^!/, '');
  if (contextKeys.has(t)) return true;
  const head = t.split(':')[0]!;
  return t.includes(':') && contextKeys.has(`${head}:*`);
}

function checkLine(
  def: LineDef, packId: string, intentKeys: readonly IntentId[], where: string,
  intents: ReadonlyMap<IntentId, IntentDef>, contextKeys: Set<string>, neverSays: readonly string[], catchphrase = false,
): string[] {
  const out: string[] = [];
  if (typeof def?.id !== 'string' || !LINE_ID.test(def.id)) return [`bad line id ${JSON.stringify(def?.id)}`];
  const [pack, seg] = def.id.split('.');
  if (pack !== packId) out.push(`id must start with "${packId}."`);
  if (catchphrase) {
    // §4.2: <persona>.catch.<nn>; a single-intent catchphrase may also use its intent segment (validator rule).
    if (seg !== 'catch' && !(intentKeys.length === 1 && seg === intentKeys[0])) out.push('catchphrase ids use the "catch" segment');
  } else if (seg !== intentKeys[0]) out.push(`id intent segment must be "${intentKeys[0]}"`);
  if (typeof def.text !== 'string' || !def.text.trim()) return [...out, 'text is empty'];
  if (/[[\]<>]/.test(def.text)) out.push('text must not contain markup; put it in tags.xai');
  const defs = intentKeys.map((k) => intents.get(k)).filter((d): d is IntentDef => !!d);
  const inText = [...new Set(placeholders(def.text))];
  const declared = def.slots ?? [];
  for (const s of declared) if (!isSlotId(s)) out.push(`unknown slot ${s}`);
  if (!sameSet(inText, declared)) out.push(`slots ${JSON.stringify(declared)} must equal placeholders ${JSON.stringify(inText)}`);
  for (const s of inText) for (const d of defs) if (!d.slots.includes(s as SlotId)) out.push(`slot {${s}} is not allowed in intent ${d.id}`);
  const maxChars = Math.min(...defs.map((d) => d.max_chars));
  if (def.text.replace(/\{[a-z_]+\}/g, '').length > maxChars) out.push(`text longer than ${maxChars} characters`);
  const xai = def.tags?.xai;
  if (def.nonverbal) {
    if (!/^\(.+\)$/.test(def.text)) out.push('nonverbal text is a caption in parentheses, e.g. "(chuckles)"');
    if (xai === undefined || readable(xai) !== '') out.push('nonverbal lines need tags.xai made only of tags');
  } else if (xai !== undefined && readable(xai) !== def.text) {
    out.push(`readable(tags.xai) "${readable(xai)}" must equal text "${def.text}"`);
  }
  if (xai !== undefined) {
    if (speakable(xai) !== xai.replace(/\s{2,}/g, ' ').trim()) out.push(`tags.xai has unknown or unbalanced tags (speakable: "${speakable(xai)}")`);
    if (BANNED_TAGS.test(xai)) out.push('[cough] and [yawn] are not allowed');
  }
  const say = def.tags?.openai?.say;
  if (say !== undefined && !sameSet([...new Set(placeholders(say))], inText)) out.push('tags.openai.say must use the same slots as text');
  for (const c of def.context ?? []) if (!contextOk(c, contextKeys)) out.push(`unknown context ${c}`);
  if (def.mood && (Math.abs(num(def.mood.valence, 9)) > 1 || Math.abs(num(def.mood.energy, 9)) > 1)) out.push('mood must be within -1…1');
  if (def.weight !== undefined && !(def.weight >= 0.1 && def.weight <= 5)) out.push('weight must be 0.1…5');
  if (def.max_per_week !== undefined && !(Number.isInteger(def.max_per_week) && def.max_per_week >= 1)) out.push('max_per_week must be an integer ≥ 1');
  if (def.family !== undefined && !FAMILY_ID.test(def.family)) out.push(`family ${JSON.stringify(def.family)} must be a short kebab-case id`);
  if (def.lang !== undefined && !LANG_TAG.test(def.lang)) out.push(`lang ${JSON.stringify(def.lang)} must be a BCP-47 tag`);
  if (def.lang !== undefined && !def.gloss?.trim()) out.push('a line with non-English words (lang) needs an English gloss (E17)');
  if (COMPLETION_CLAIM.test(def.text)) out.push('canned lines never claim a completed external action (H2)');
  if (EMBODIMENT.test(def.text)) out.push('no human-embodiment claims in micro-talk (H6)');
  if (defs.some((d) => d.family === 'sidetalk') && (declared.includes('owner_name') || OWNER_TALK.test(def.text))) out.push('side-talk never talks about the owner (H4)');
  for (const phrase of neverSays) if (containsPhrase(def.text, phrase)) out.push(`uses never_says phrase "${phrase}"`);
  return out;
}

function compileLine(
  def: LineDef, meta: { packId: string; intent: IntentId; source: CompiledLine['source']; archetype: ArchetypeId | null; laughIntensity?: number },
): CompiledLine {
  const nonverbal = !!def.nonverbal;
  const xai = def.tags?.xai ?? (nonverbal ? '' : def.text);
  const context = def.context ?? [];
  const intensity = meta.laughIntensity !== undefined ? intensityFromNumber(meta.laughIntensity) : intensityOf(xai, meta.intent, nonverbal);
  // Default caps (E1, E2, E17): catchphrases, quips and non-English lines wear out fastest.
  const wearsOut = meta.source === 'catchphrase' || meta.intent === 'quip';
  const maxPerDay = def.max_per_day ?? (wearsOut || def.lang ? 1 : null);
  const maxPerWeek = def.max_per_week ?? (wearsOut ? Math.max(2, maxPerDay ?? 1) : null);
  return Object.freeze({
    id: def.id,
    packId: meta.packId,
    intent: meta.intent,
    source: meta.source,
    archetype: meta.archetype,
    text: def.text,
    xai,
    openai: Object.freeze({
      say: def.tags?.openai?.say ?? (nonverbal ? '' : openaiInputFromXai(xai)),
      instructions: def.tags?.openai?.instructions ?? null,
    }),
    nonverbal,
    slots: Object.freeze([...(def.slots ?? [])]),
    mood: def.mood ? Object.freeze({ ...def.mood }) : null,
    weight: def.weight ?? 1,
    require: Object.freeze(context.filter((c) => !c.startsWith('!'))),
    forbid: Object.freeze(context.filter((c) => c.startsWith('!')).map((c) => c.slice(1))),
    maxPerDay,
    textHash: textHashOf(def.text),
    opener: openerOf(def.text),
    estMs: estimateMs(xai || def.text, nonverbal, meta.laughIntensity ?? 0.5),
    intensity,
    maxPerWeek,
    family: def.family ?? null,
    solicits: !!def.solicits,
    lang: def.lang ?? null,
    gloss: def.gloss?.trim() || null,
  });
}

/**
 * The xAI rendering of each laugh kind (E13). xAI has one `[laugh]` sound, so the kind is composed from tags:
 * a snort starts with a sharp breath, a giggle is quick, a dry huff and a breathy laugh lead with a breath.
 */
export const LAUGH_XAI_BY_KIND: Readonly<Record<LaughStyle['kind'], string>> = Object.freeze({
  chuckle: '<soft>[laugh]</soft>',
  warm_laugh: '[laugh]',
  belly_laugh: '[laugh] [laugh]',
  giggle: '<fast>[laugh]</fast>',
  snort: '[sharp-breath] [laugh]',
  breathy: '[breath] <soft>[laugh]</soft>',
  dry_huff: '[breath] <soft>[laugh]</soft>',
  silent_smile: '',
});

const GENERIC_LAUGH_XAI = new Set(['[laugh]', '<soft>[laugh]</soft>']);

/** A laugh style's xAI rendering: an authored one wins unless it is one of the two generic sounds (E13). */
export function laughXaiFor(style: LaughStyle): string {
  if (style.kind === 'silent_smile') return '';
  const authored = style.xai === undefined ? '' : speakable(style.xai);
  if (authored && !GENERIC_LAUGH_XAI.has(authored)) return authored;
  return LAUGH_XAI_BY_KIND[style.kind] ?? (authored || '[laugh]');
}

/** A laugh style becomes the persona's (or archetype's) own nonverbal laugh line `<pack>.laugh.00` (§4.4). */
function laughLineDef(packId: string, style: LaughStyle): LineDef {
  const silent = style.kind === 'silent_smile';
  return {
    id: `${packId}.laugh.00`,
    text: laughCaption(style),
    nonverbal: true,
    tags: {
      xai: laughXaiFor(style),
      ...(style.openai && !silent ? { openai: { say: style.openai.say, ...(style.openai.instructions ? { instructions: style.openai.instructions } : {}) } } : {}),
    },
  };
}

function checkLaughStyle(style: LaughStyle | undefined): string[] {
  const out: string[] = [];
  if (!style || typeof style !== 'object') return ['laugh style is missing'];
  if (!(LAUGH_KINDS as readonly string[]).includes(style.kind)) out.push(`unknown laugh kind ${style.kind}`);
  if (!(style.intensity >= 0 && style.intensity <= 1)) out.push('laugh intensity must be 0…1');
  if (!(style.readiness >= 0 && style.readiness <= 1)) out.push('laugh readiness must be 0…1');
  if (typeof style.caption !== 'string' || style.caption.length < 3) out.push('laugh caption is required');
  if (style.xai !== undefined && (readable(style.xai) !== '' || BANNED_TAGS.test(style.xai))) out.push('laugh xai must be tags only, no [cough]/[yawn]');
  return out;
}

function blendProblems(blend: ArchetypeBlend | undefined): string[] {
  if (!blend || typeof blend !== 'object') return ['archetype blend is missing'];
  const entries = Object.entries(blend);
  const out: string[] = [];
  if (entries.length < 1 || entries.length > 4) out.push('a blend has 1–4 archetypes');
  for (const [k, w] of entries) {
    if (!isArchetypeId(k)) out.push(`unknown archetype ${k}`);
    if (!(typeof w === 'number' && w > 0 && w <= 1)) out.push(`weight for ${k} must be in (0, 1]`);
  }
  const sum = entries.reduce((a, [, w]) => a + (typeof w === 'number' ? w : 0), 0);
  if (Math.abs(sum - 1) > 0.011) out.push('archetype weights must sum to 1');
  return out;
}

// ── compile ─────────────────────────────────────────────────────────────────────
interface CompileOutcome { catalog: CompiledCatalog | null; problems: Problem[] }

function compileInternal(input: ExpressionCatalogInput): CompileOutcome {
  const problems: Problem[] = [];
  const fatal = (where: string, message: string) => problems.push({ where, message, fatal: true });
  if (!input || typeof input !== 'object') return { catalog: null, problems: [{ where: 'input', message: 'missing', fatal: true }] };
  const { intents: intentsFile, archetypes: archetypesFile } = input;
  if (intentsFile?.kind !== 'intents') fatal('intents', 'kind must be "intents"');
  if (archetypesFile?.kind !== 'archetypes') fatal('archetypes', 'kind must be "archetypes"');
  if (problems.length) return { catalog: null, problems };

  // Intents, Ambience, slots, contexts.
  const intents = new Map<IntentId, IntentDef>();
  for (const def of intentsFile.intents ?? []) {
    if (!isIntentId(def?.id)) fatal('intents', `unknown intent ${JSON.stringify(def?.id)}`);
    else if (intents.has(def.id)) fatal('intents', `duplicate intent ${def.id}`);
    else if (!Array.isArray(def.timing?.delay_ms) || !def.channels?.face || !def.ambience || !Array.isArray(def.slots)) fatal('intents', `${def.id} is incomplete`);
    else intents.set(def.id, def);
  }
  for (const id of INTENT_IDS) if (!intents.has(id)) fatal('intents', `missing intent ${id}`);
  for (const a of AMBIENCES) if (!intentsFile.ambience?.[a]) fatal('intents', `missing ambience profile ${a}`);
  for (const s of SLOT_IDS) if (!intentsFile.slots?.[s]) fatal('intents', `missing slot ${s}`);
  const contextKeys = new Set(Object.keys(intentsFile.contexts ?? {}));

  // Archetypes and lead blends.
  const archetypes = new Map<ArchetypeId, ArchetypeDef>();
  for (const a of archetypesFile.archetypes ?? []) {
    if (!isArchetypeId(a?.id)) fatal('archetypes', `unknown archetype ${JSON.stringify(a?.id)}`);
    else if (archetypes.has(a.id)) fatal('archetypes', `duplicate archetype ${a.id}`);
    else {
      for (const m of checkLaughStyle(a.laugh)) fatal(`archetypes#${a.id}`, m);
      archetypes.set(a.id, a);
    }
  }
  for (const id of ARCHETYPE_IDS) if (!archetypes.has(id)) fatal('archetypes', `missing archetype ${id}`);
  for (const [leadId, blend] of Object.entries(archetypesFile.lead_blends ?? {})) for (const m of blendProblems(blend)) fatal(`archetypes.lead_blends.${leadId}`, m);
  for (const k of SLIDER_KEYS) {
    if (!(num(archetypesFile.normalization?.std?.[k], 0) > 0)) fatal('archetypes.normalization', `std.${k} must be > 0`);
  }
  if (problems.length) return { catalog: null, problems };

  const lines = new Map<string, CompiledLine[]>();
  const lineById = new Map<string, CompiledLine[]>();
  const seenIds = new Map<string, string>();
  const add = (line: CompiledLine) => {
    const key = `${line.packId}\u0000${line.intent}`;
    const list = lines.get(key);
    if (list) list.push(line);
    else lines.set(key, [line]);
    const byId = lineById.get(line.id);
    if (byId) byId.push(line);
    else lineById.set(line.id, [line]);
  };
  const claim = (id: string, where: string): boolean => {
    const prev = seenIds.get(id);
    if (prev) {
      problems.push({ where, lineId: id, message: `duplicate line id (also in ${prev})` });
      return false;
    }
    seenIds.set(id, where);
    return true;
  };

  // Archetype packs.
  const packIds = new Set<string>();
  const packs = [...(input.packs ?? [])].sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  for (const pack of packs) {
    const where = `packs/${pack?.id}`;
    if (pack?.kind !== 'archetype_pack' || !isArchetypeId(pack.id)) {
      fatal(where, 'not an archetype_pack with a known archetype id');
      continue;
    }
    if (packIds.has(pack.id)) {
      fatal(where, 'second pack for this archetype');
      continue;
    }
    packIds.add(pack.id);
    for (const [intentKey, defs] of Object.entries(pack.intents ?? {})) {
      for (const def of defs ?? []) {
        if (!isIntentId(intentKey)) {
          problems.push({ where, lineId: def?.id ?? '?', message: `unknown intent ${intentKey}` });
          continue;
        }
        const msgs = checkLine(def, pack.id, [intentKey], where, intents, contextKeys, []);
        if (!claim(def.id, where)) continue;
        if (msgs.length) {
          for (const m of msgs) problems.push({ where, lineId: def.id, message: m });
          continue;
        }
        add(compileLine(def, { packId: pack.id, intent: intentKey, source: 'archetype', archetype: pack.id }));
      }
    }
  }
  // The archetype's own nonverbal laugh (used only by agents without a signature laugh, §4.4).
  for (const a of archetypes.values()) {
    const def = laughLineDef(a.id, a.laugh);
    if (seenIds.has(def.id)) continue;
    seenIds.set(def.id, `archetypes#${a.id}`);
    add(compileLine(def, { packId: a.id, intent: 'laugh', source: 'archetype', archetype: a.id, laughIntensity: a.laugh.intensity }));
  }

  // Signature packs.
  const signatures = new Map<string, SignaturePack>();
  const sigFiles = [...(input.signatures ?? [])].sort((a, b) => String(a?.group).localeCompare(String(b?.group)));
  for (const file of sigFiles) {
    if (file?.kind !== 'signature_file' || !Array.isArray(file.packs)) {
      fatal(`signatures/${file?.group}`, 'not a signature_file');
      continue;
    }
    for (const pack of file.packs) {
      const pid = String(pack?.persona_id ?? '');
      const where = `signatures/${file.group}#${pid}`;
      const packMsgs = [
        ...(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(pid) ? [] : ['bad persona_id']),
        ...(signatures.has(pid) ? ['second signature pack for this persona'] : []),
        ...blendProblems(pack?.archetypes),
        ...checkLaughStyle(pack?.laugh_style),
        ...(Array.isArray(pack?.never_says) ? [] : ['never_says must be a list']),
        ...(pack?.lines && typeof pack.lines === 'object' ? [] : ['lines must be an object']),
        ...(Array.isArray(pack?.catchphrases) ? [] : ['catchphrases must be a list']),
        ...Object.keys(pack?.intent_weights ?? {}).filter((k) => !isIntentId(k)).map((k) => `unknown intent_weights key ${k}`),
        ...(pack?.disabled_intents ?? []).filter((k) => !isIntentId(k)).map((k) => `unknown disabled intent ${k}`),
        ...Object.entries(pack?.topics ?? {}).filter(([k, v]) => !/^[a-z][a-z0-9_-]*$/.test(k) || !Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.trim())).map(([k]) => `topics.${k} must be a list of keywords`),
        ...Object.entries(pack?.family_max_per_day ?? {}).filter(([k, v]) => !FAMILY_ID.test(k) || !(Number.isInteger(v) && v >= 1)).map(([k]) => `family_max_per_day.${k} must be an integer ≥ 1`),
      ];
      if (packMsgs.length) {
        for (const m of packMsgs) problems.push({ where, packId: pid, message: m });
        continue;
      }
      const packLines: CompiledLine[] = [];
      for (const [intentKey, defs] of Object.entries(pack.lines)) {
        for (const def of defs ?? []) {
          if (!isIntentId(intentKey)) {
            problems.push({ where, lineId: def?.id ?? '?', message: `unknown intent ${intentKey}` });
            continue;
          }
          const msgs = checkLine(def, pid, [intentKey], where, intents, contextKeys, pack.never_says);
          if (!claim(def.id, where)) {
            continue;
          }
          if (msgs.length) {
            for (const m of msgs) problems.push({ where, lineId: def.id, message: m });
            continue;
          }
          packLines.push(compileLine(def, { packId: pid, intent: intentKey, source: 'signature', archetype: null }));
        }
      }
      for (const c of pack.catchphrases as CatchphraseDef[]) {
        const keys = (c?.intents ?? []).filter(isIntentId);
        if (!keys.length || keys.length !== (c?.intents ?? []).length) {
          problems.push({ where, lineId: c?.id ?? '?', message: 'catchphrase intents must be known intent ids' });
          continue;
        }
        const msgs = checkLine(c, pid, keys, where, intents, contextKeys, pack.never_says, true);
        if (!claim(c.id, where)) {
          continue;
        }
        if (msgs.length) {
          for (const m of msgs) problems.push({ where, lineId: c.id, message: m });
          continue;
        }
        for (const intent of keys) packLines.push(compileLine(c, { packId: pid, intent, source: 'catchphrase', archetype: null }));
      }
      const laughDef = laughLineDef(pid, pack.laugh_style);
      if (!seenIds.has(laughDef.id)) {
        seenIds.set(laughDef.id, where);
        packLines.push(compileLine({ ...laughDef, weight: 2 }, { packId: pid, intent: 'laugh', source: 'signature', archetype: null, laughIntensity: pack.laugh_style.intensity }));
      }
      signatures.set(pid, pack);
      for (const l of packLines) add(l);
    }
  }

  const sliderStats = input.sliderStats ?? { mean: archetypesFile.normalization.mean, std: archetypesFile.normalization.std };
  const version = catalogVersion(input);
  const intentsFrozen = new Map(intents);
  const ambience = Object.freeze({ ...intentsFile.ambience }) as Readonly<Record<Ambience, AmbienceProfile>>;
  const empty: readonly CompiledLine[] = Object.freeze([]);
  for (const [k, v] of lines) lines.set(k, Object.freeze(v) as CompiledLine[]);
  const catalog: CompiledCatalog = Object.freeze({
    version,
    intents: intentsFrozen,
    ambience,
    defaults: intentsFile.defaults ?? {},
    archetypes: new Map(archetypes),
    archetypesFile,
    lexicon: intentsFile.affect_lexicon ?? {},
    linesFor(packId: string, intent: IntentId): readonly CompiledLine[] {
      return lines.get(`${packId}\u0000${intent}`) ?? empty;
    },
    signature(personaId: string): SignaturePack | null {
      return signatures.get(personaId) ?? null;
    },
  });
  const internals: CatalogInternals = { input, slots: intentsFile.slots, sliderStats, lineById, contextKeys };
  catalogInternals.set(catalog, internals);
  for (const list of lineById.values()) for (const l of list) lineCatalog.set(l, catalog);
  return { catalog, problems };
}

/**
 * Content version: a hash over the input with packs and signature files in a stable order, so file order
 * never changes it (one native JSON pass plus one hash pass: ≈ 20 ms on the full catalog).
 */
export function catalogVersion(input: ExpressionCatalogInput): string {
  const text = JSON.stringify([
    1,
    input.intents,
    input.archetypes,
    [...(input.packs ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    [...(input.signatures ?? [])].sort((a, b) => String(a.group).localeCompare(String(b.group))),
    input.sliderStats ? canonicalJson(input.sliderStats) : null,
  ]);
  return `e1_${base32Int(cyrb53(text, 1))}${base32Int(text.length)}`;
}

/**
 * Compile the catalog files into a fast, frozen catalog. Strict: any problem (schema-level or per line,
 * including the honesty lints) throws ExpressionCatalogError with every problem listed.
 */
export function compileCatalog(input: ExpressionCatalogInput): CompiledCatalog {
  const { catalog, problems } = compileInternal(input);
  if (problems.length || !catalog) throw new ExpressionCatalogError(problems.map(fmt));
  return catalog;
}

/**
 * Additive helper for builders and hosts that load content while it is still being edited: lines and
 * signature packs with problems are dropped (and reported); only file-level problems throw. Returns the
 * cleaned input too, which `compileCatalog` accepts strictly (the build writes it to the bundle).
 */
export function compileCatalogLenient(
  input: ExpressionCatalogInput,
): { catalog: CompiledCatalog; input: ExpressionCatalogInput; dropped: readonly string[]; problems: readonly string[] } {
  let current = input;
  const dropped: string[] = [];
  const reported: string[] = [];
  for (let pass = 0; pass < 4; pass++) {
    const { catalog, problems } = compileInternal(current);
    const fatalOnes = problems.filter((p) => p.fatal || (!p.lineId && !p.packId));
    if (fatalOnes.length || !catalog) throw new ExpressionCatalogError((fatalOnes.length ? fatalOnes : problems).map(fmt));
    if (!problems.length) return { catalog, input: current, dropped, problems: reported };
    reported.push(...problems.map(fmt));
    const badLines = new Set(problems.filter((p) => p.lineId).map((p) => p.lineId!));
    const badPacks = new Set(problems.filter((p) => p.packId).map((p) => p.packId!));
    dropped.push(...badLines, ...[...badPacks].map((p) => `signature:${p}`));
    current = withoutLines(current, badLines, badPacks);
  }
  throw new ExpressionCatalogError(reported);
}

function withoutLines(input: ExpressionCatalogInput, badLines: Set<string>, badPacks: Set<string>): ExpressionCatalogInput {
  // Duplicate ids are dropped wherever they appear after the first; ids are cleared everywhere they are bad.
  const keep = (defs: readonly LineDef[] | undefined) => (defs ?? []).filter((d) => d && !badLines.has(d.id));
  const packs: ArchetypePack[] = (input.packs ?? []).map((p) => ({
    ...p,
    intents: Object.fromEntries(Object.entries(p.intents ?? {}).map(([k, v]) => [k, keep(v)])),
  }));
  const signatures: SignatureFile[] = (input.signatures ?? []).map((f) => ({
    ...f,
    packs: (f.packs ?? [])
      .filter((p) => !badPacks.has(String(p?.persona_id)))
      .map((p) => ({
        ...p,
        lines: Object.fromEntries(Object.entries(p.lines ?? {}).map(([k, v]) => [k, keep(v)])),
        catchphrases: (p.catchphrases ?? []).filter((c) => c && !badLines.has(c.id)),
      })),
  }));
  return { ...input, packs, signatures };
}

// ── blending (§4.5) ─────────────────────────────────────────────────────────────
/**
 * Derived archetype blend from personality. Reference implementation: deriveBlend in
 * catalog/scripts/validate-expressions.mjs (same z-scores, affinities, top-k softmax, rounding).
 */
export function deriveBlend(p: PersonalityInput, archetypes: ArchetypesFile, stats?: { mean: Sliders; std: Sliders }): ArchetypeBlend {
  const st = stats ?? archetypes.normalization;
  const clip = num(archetypes.normalization.clip, 2.5);
  const { top_k, temperature, min_weight, trait_bonus_cap } = archetypes.blend_rule;
  const z = {} as Record<string, number>;
  for (const k of SLIDER_KEYS) z[k] = clamp((num(p.sliders?.[k], st.mean[k]) - st.mean[k]) / (st.std[k] || 1), -clip, clip);
  const tl = (p.traits ?? []).map((t) => String(t).toLowerCase());
  const affinity = archetypes.archetypes
    .map((a): [ArchetypeId, number] => {
      let v = SLIDER_KEYS.reduce((s, k) => s + (a.mapping.sliders[k] ?? 0) * z[k]!, 0);
      v += Math.min(trait_bonus_cap, tl.reduce((s, t) => s + (a.mapping.traits[t] ?? 0), 0));
      v += (p.roles ?? []).reduce((s, r) => s + (a.mapping.roles?.[r] ?? 0), 0);
      v += p.seniority ? a.mapping.seniority?.[p.seniority] ?? 0 : 0;
      return [a.id, v];
    })
    .sort((x, y) => y[1] - x[1])
    .slice(0, Math.max(1, top_k));
  const ex = affinity.map(([, v]) => Math.exp(v / (temperature || 1)));
  const total = ex.reduce((a, b) => a + b, 0);
  let kept = affinity.map(([id], i): [ArchetypeId, number] => [id, ex[i]! / total]).filter(([, w]) => w >= min_weight);
  if (!kept.length) kept = [[affinity[0]![0], 1]];
  const keptTotal = kept.reduce((a, [, w]) => a + w, 0);
  kept = kept.map(([id, w]): [ArchetypeId, number] => [id, Math.round((w / keptTotal) * 100) / 100]);
  const drift = 1 - kept.reduce((a, [, w]) => a + w, 0);
  kept[0]![1] = Math.round((kept[0]![1] + drift) * 100) / 100;
  return Object.fromEntries(kept) as ArchetypeBlend;
}

/** Blend precedence (§4.5): signature pack → lead_blends → derived from personality. */
export function resolveBlend(catalog: CompiledCatalog, profile: AgentExpressionProfile): ArchetypeBlend {
  const sig = catalog.signature(profile.personaId);
  if (sig && !blendProblems(sig.archetypes).length) return { ...sig.archetypes };
  const lead = catalog.archetypesFile.lead_blends[profile.personality.leadId ?? profile.personaId];
  if (lead) return { ...lead };
  return deriveBlend(profile.personality, catalog.archetypesFile, catalogInternalsOf(catalog).sliderStats);
}

const DEFAULT_LAUGH: LaughStyle = {
  kind: 'chuckle', intensity: 0.3, readiness: 0.5, caption: '(chuckles)', xai: '<soft>[laugh]</soft>', openai: { say: 'Heh heh.', instructions: 'A soft, low chuckle.' },
};

/** Precomputed candidates and priors for one agent (§5.2). */
export function buildAgentIndex(catalog: CompiledCatalog, profile: AgentExpressionProfile): AgentIndex {
  const blend = resolveBlend(catalog, profile);
  const entries = (Object.entries(blend) as [ArchetypeId, number][]).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
  const dominant = entries[0]?.[0] ?? null;
  const sig = catalog.signature(profile.personaId);
  const laugh = sig?.laugh_style ?? (dominant ? catalog.archetypes.get(dominant)?.laugh : undefined) ?? DEFAULT_LAUGH;
  const baseline = baselineMood(profile.personality, blend, catalog.archetypesFile);
  const reactivity = reactivityOf(profile.personality);
  const neverSays = Object.freeze([...(sig?.never_says ?? [])]);
  const d = catalog.defaults;
  const sigSource = num(d.signature_source_weight, 1.6);
  const catchSource = num(d.catchphrase_source_weight, 1.2);
  // Per-intent source weight (E3): signature lines lead in greetings, passing-by and quips, and blend in with the
  // archetype lines in high-frequency reflexes so a handful of distinctive lines never take most of the picks.
  const sigWeightFor = (intent: IntentId) => num(catalog.intents.get(intent)?.signature_weight, sigSource);
  const weightCache = new Map<IntentId, number>();
  const candCache = new Map<IntentId, readonly WeightedLine[]>();
  const disabled = new Set(sig?.disabled_intents ?? []);
  const sceptic = profile.teamRole === 'sceptic';

  const intentWeight = (intent: IntentId): number => {
    const cached = weightCache.get(intent);
    if (cached !== undefined) return cached;
    let w: number;
    if (disabled.has(intent)) w = 0;
    else {
      let aw = 0;
      let total = 0;
      for (const [a, bw] of entries) {
        aw += bw * num(catalog.archetypes.get(a)?.intent_weights[intent], 1);
        total += bw;
      }
      w = (total > 0 ? aw / total : 1) * num(sig?.intent_weights?.[intent], 1);
      if (intent === 'celebrate' && sceptic) w *= 0.7;
      w = Math.max(0, w);
    }
    weightCache.set(intent, w);
    return w;
  };

  const lines = new Map<string, CompiledLine[]>();
  const remember = (l: CompiledLine) => {
    const list = lines.get(l.id);
    if (!list) lines.set(l.id, [l]);
    else if (!list.includes(l)) list.push(l);
  };

  const candidates = (intent: IntentId): readonly WeightedLine[] => {
    const cached = candCache.get(intent);
    if (cached) return cached;
    const w = intentWeight(intent);
    const out: WeightedLine[] = [];
    if (w > 0) {
      if (sig) {
        const sw = sigWeightFor(intent);
        const cw = Math.min(catchSource, sw);
        for (const line of catalog.linesFor(profile.personaId, intent)) {
          out.push({ line, prior: line.weight * (line.source === 'catchphrase' ? cw : sw) * w });
        }
      }
      for (const [a, bw] of entries) {
        for (const line of catalog.linesFor(a, intent)) {
          if (line.id === `${a}.laugh.00` && (sig || a !== dominant)) continue; // one laugh voice per agent
          out.push({ line, prior: line.weight * bw * w });
        }
      }
    }
    for (const wl of out) remember(wl.line);
    const frozen = Object.freeze(out.map((x) => Object.freeze(x)));
    candCache.set(intent, frozen);
    return frozen;
  };

  const dominantDef = dominant ? catalog.archetypes.get(dominant) : undefined;
  const index: AgentIndex = Object.freeze({
    agentId: profile.agentId,
    personaId: profile.personaId,
    catalogVersion: catalog.version,
    blend: Object.freeze({ ...blend }),
    laugh,
    baseline,
    reactivity,
    neverSays,
    voice: profile.voice,
    candidates,
    intentWeight,
  });
  const families = new Map<string, string[]>();
  const familyCaps = sig?.family_max_per_day ?? {};
  const familyDefault = Math.max(1, Math.floor(num(d.family_max_per_day, 2)));
  indexInternals.set(index, {
    catalog,
    profile,
    neverSays: [...neverSays, ...GLOBAL_NEVER_SAYS].map((p) => String(p).trim().toLowerCase()).filter(Boolean),
    ownerNever: GLOBAL_NEVER_SAYS_OWNER_FACING.map((p) => p.toLowerCase()),
    dominant,
    archetypeInstructions: dominantDef?.delivery.openai_instructions ?? null,
    lines,
    staticNever: new Map(),
    families,
    familyCap: (f: string) => Math.max(1, Math.floor(num(familyCaps[f], familyDefault))),
    topics: Object.entries(sig?.topics ?? {}).map(([k, v]) => [k, v.map((x) => String(x).trim().toLowerCase()).filter(Boolean)] as const),
  });
  // Warm every intent once so line lookups by id work before the first selection.
  for (const intent of INTENT_IDS) candidates(intent);
  for (const list of lines.values()) {
    const f = list[0]?.family;
    if (!f) continue;
    const ids = families.get(f) ?? [];
    if (!ids.includes(list[0]!.id)) ids.push(list[0]!.id);
    families.set(f, ids);
  }
  return index;
}

/**
 * Topics of this agent's that the owner's text mentions (E19): whole-phrase, case-insensitive keyword matches
 * against the signature pack's `topics`. Hosts pass the result as `exchange.topics`; it sets `topic:<id>`.
 */
export function topicsFor(index: AgentIndex, text: string): string[] {
  const ii = indexInternalsOf(index);
  if (!ii.topics.length || !text) return [];
  return ii.topics.filter(([, words]) => words.some((w) => containsPhrase(text, w))).map(([id]) => id);
}

/** Slider statistics over a set of personalities (mean and population std), for `sliderStats`. */
export function sliderStatsOf(rows: readonly Sliders[]): { mean: Sliders; std: Sliders } {
  const mean = {} as Sliders;
  const std = {} as Sliders;
  for (const k of SLIDER_KEYS) {
    const v = rows.map((r) => num(r[k], 50));
    const m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    mean[k] = m;
    std[k] = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length)) || 1;
  }
  return { mean, std };
}
