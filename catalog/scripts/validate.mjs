#!/usr/bin/env node
// Validates the whole Agent Workplace catalog (catalog/**) and writes the generated manifest
// catalog/index.json. Zero dependencies, Node >= 20. See catalog/SCHEMA.md §10 and §12.
//
//   node catalog/scripts/validate.mjs              validate, print a report, write index.json; exit 1 on errors
//   node catalog/scripts/validate.mjs --verbose    list every warning (default: the first 6 per check)
//   node catalog/scripts/validate.mjs --quiet      errors and the summary only
//   node catalog/scripts/validate.mjs --stats      also print the diversity & coverage stats
//   node catalog/scripts/validate.mjs --no-write   do not write index.json
//   node catalog/scripts/validate.mjs --catalog <dir>   validate another catalog directory (e.g. a scratch copy)
//
// What it checks (errors unless marked "warn"):
//   parse        every JSON file parses
//   schema       each file against its JSON Schema (small built-in 2020-12 checker, no Ajv)
//   vocab        schema enums mirror taxonomy vocabularies; tool/connector/activity/artifact/voice ids exist
//   taxonomy     every pre-assigned id present once, none extra; people fields equal the taxonomy
//   ids          globally unique record ids; unique handles and UNIQUE FIRST NAMES across coworkers + leads
//                (accent-folded); no first name or handle equals a voice id or a taxonomy.reserved_first_names story name
//   refs         persona / skill / lead / recipe / connector references resolve; no self-pairing
//   tools        persona tools (plus taxonomy.baseline_tools, which are implicit and never listed) cover the
//                tools of every primary skill; side-effect skills are always_ask; image input needs vision_describe;
//                every coworker inherits the owner's standing rules (instanceOf "lead")
//   untrusted    taxonomy.untrusted_content_rule: coworkers with a reader + an external-write tool restate it
//                in guardrails; skills with both carry the Suspicious-content step and the must-level check
//   coverage     every skill has at least one persona listing it as primary
//   workflow     skill workflow dependsOn points only to earlier steps; automations include the standing-grant
//                step; required connector inputs declare a file/owner fallback; SMS skills enforce consent
//   intro        intro_line never claims work not yet done (past-tense claims regex); intro_after_work slots;
//                welcome lines open in the owner's language (heritage greetings live in greeting_flourish)
//   recipes      exactly one sceptic (who can play sceptic), coordinator rules, variants subset rules,
//                acyclic plan_skeleton DAG, owners/reviewers in composition, licensed-review tasks,
//                model_hints task ids, no voice notes in owner-facing composition[].why
//   variants     every task owned by a swapped-out member is covered by a swapped-in persona's skills or by
//                the variant's reassign map (targets must be on the adapted team)
//   providers    composition meets formation.diversity.min_distinct_primary_providers
//   team-voices  unique OpenAI and xAI voices within each composition, applying composition[].voice_override
//   voices       voice ids per surface, characterized xAI alternate for low-confidence primaries,
//                presentation vs pronouns (warn), pair reuse (warn)
//   sliders      personality sliders are integers 0-100
//   motifs       quirk motifs used by more than 3 coworkers (warn); backstory opener patterns above 30% and
//                in-text lore markers (warn)
//   backstory    coworker 60-120 words, lead 300-500 words
//   honesty      lead first_meeting (or greeting) claims no prior work; lead rules carry the AI-disclosure,
//                approval and owner-override clauses (rules are what biz-bot exports)
//   portraits    exact warpable prefix, closed-lip resting + delighted expressions, nothing over the mouth;
//                lead expressions keep the head pose (no head tilt or chin movement)
//                (warn: no backdrop, or no rim light in avatar.accent_color, per catalog/ART-DIRECTION.md)
//   regulated    regulated domains restated in guardrails + licensed_professional escalation; every regulated
//                recipe staffs a must_include_one_of member in composition (lean variant: warn); full_variant
//                never counts
//   formation    formation.json ids resolve; a rule for every regulated domain; starter recipes resolve
//   quiz         leads/match-quiz.json shape and reachability (when the file exists): weight and result keys are
//                real lead ids, unique question/option ids, §8 text limits, scale/multi shape, scoring, fallback

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const rawArgs = process.argv.slice(2);
const catalogArg = rawArgs.indexOf('--catalog');
const CATALOG = catalogArg >= 0 && rawArgs[catalogArg + 1] ? resolvePath(rawArgs[catalogArg + 1]) : join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = new Set(rawArgs);
const VERBOSE = argv.has('--verbose');
const QUIET = argv.has('--quiet');
const SHOW_STATS = argv.has('--stats');
const WRITE = !argv.has('--no-write');
const WARN_SHOWN = VERBOSE ? Infinity : 6;

// ── issue collection ──────────────────────────────────────────────────────────
const CHECKS = ['parse', 'schema', 'vocab', 'taxonomy', 'ids', 'refs', 'tools', 'untrusted', 'coverage', 'workflow', 'intro', 'recipes', 'variants', 'providers', 'team-voices', 'voices', 'sliders', 'motifs', 'backstory', 'honesty', 'portraits', 'regulated', 'formation', 'quiz', 'format'];
const issues = [];
const issue = (level, check, file, where, msg) => issues.push({ level, check, file, where, msg });
const error = (check, file, where, msg) => issue('error', check, file, where, msg);
const warn = (check, file, where, msg) => issue('warning', check, file, where, msg);

// ── loading ───────────────────────────────────────────────────────────────────
const loaded = new Map(); // rel path -> parsed JSON
function load(rel, { optional = false } = {}) {
  const abs = join(CATALOG, rel);
  if (!existsSync(abs)) {
    if (!optional) error('parse', rel, '', 'file is missing');
    return undefined;
  }
  const text = readFileSync(abs, 'utf8');
  try {
    const value = JSON.parse(text);
    loaded.set(rel, value);
    if (JSON.stringify(value, null, 2) + '\n' !== text && !rel.startsWith('expressions/')) {
      // SCHEMA §1: 2-space indent and a final newline. Inline arrays are tolerated but noted.
      if (!text.endsWith('\n')) warn('format', rel, '', 'file does not end with a newline');
    }
    return value;
  } catch (e) {
    error('parse', rel, '', `not valid JSON: ${e.message.split('\n')[0]}`);
    return undefined;
  }
}
const listJson = (dir) => (existsSync(join(CATALOG, dir)) ? readdirSync(join(CATALOG, dir)).filter((f) => f.endsWith('.json')).sort().map((f) => `${dir}/${f}`) : []);

const taxonomy = load('taxonomy.json') ?? {};
const formation = load('formation.json');
const schemas = {};
for (const name of ['persona', 'skill', 'lead', 'team-recipe', 'expression-pack']) schemas[name] = load(`schema/${name}.schema.json`);

// ── mini JSON Schema (draft 2020-12 subset: every keyword the catalog schemas use, plus a few more) ──
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
function typeMatches(t, v) {
  switch (t) {
    case 'null': return v === null;
    case 'array': return Array.isArray(v);
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    default: return false;
  }
}
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const reCache = new Map();
const rx = (p) => {
  if (!reCache.has(p)) reCache.set(p, new RegExp(p, 'u'));
  return reCache.get(p);
};
const strLen = (s) => [...s].length; // JSON Schema counts code points
const short = (v) => {
  const s = JSON.stringify(v);
  return s && s.length > 60 ? s.slice(0, 57) + '...' : s;
};

function levenshtein(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
function closest(value, candidates) {
  if (typeof value !== 'string') return null;
  let best = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    let d = levenshtein(value, c);
    if (c.includes(value) || value.includes(c)) d = Math.min(d, Math.abs(c.length - value.length) * 0.5 + 1);
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  return best && bestScore <= Math.max(3, value.length * 0.45) ? best : null;
}
const didYouMean = (v, cands) => {
  const c = closest(v, cands);
  return c ? ` (closest: "${c}")` : '';
};

function makeValidator(root) {
  const resolve = (ref) => {
    if (ref === '#') return root;
    if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
    return ref
      .slice(2)
      .split('/')
      .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((n, k) => (n == null ? n : n[k]), root);
  };
  function check(s, v, path, out) {
    if (s === true || s === undefined) return;
    if (s === false) return void out.push({ path, msg: 'no value is allowed here' });
    if (s.$ref) {
      const target = resolve(s.$ref);
      if (target === undefined) out.push({ path, msg: `schema $ref ${s.$ref} does not resolve` });
      else check(target, v, path, out);
    }
    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => typeMatches(t, v))) return void out.push({ path, msg: `must be ${types.join(' or ')}, got ${typeOf(v)}` });
    }
    if ('const' in s && canon(s.const) !== canon(v)) out.push({ path, msg: `must equal ${short(s.const)}` });
    if (s.enum && !s.enum.some((e) => canon(e) === canon(v))) {
      out.push({ path, msg: `${short(v)} is not an allowed value${didYouMean(v, s.enum)}`, kind: 'enum' });
    }
    if (typeof v === 'string') {
      if (s.minLength !== undefined && strLen(v) < s.minLength) out.push({ path, msg: `too short: ${strLen(v)} chars, min ${s.minLength}` });
      if (s.maxLength !== undefined && strLen(v) > s.maxLength) out.push({ path, msg: `too long: ${strLen(v)} chars, max ${s.maxLength}` });
      if (s.pattern !== undefined && !rx(s.pattern).test(v)) out.push({ path, msg: `${short(v)} does not match /${s.pattern.length > 70 ? s.pattern.slice(0, 67) + '...' : s.pattern}/` });
    }
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) out.push({ path, msg: `${v} is below the minimum ${s.minimum}` });
      if (s.maximum !== undefined && v > s.maximum) out.push({ path, msg: `${v} is above the maximum ${s.maximum}` });
      if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) out.push({ path, msg: `${v} must be greater than ${s.exclusiveMinimum}` });
      if (s.exclusiveMaximum !== undefined && v >= s.exclusiveMaximum) out.push({ path, msg: `${v} must be less than ${s.exclusiveMaximum}` });
      if (s.multipleOf !== undefined && Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) > 1e-9) out.push({ path, msg: `${v} is not a multiple of ${s.multipleOf}` });
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) out.push({ path, msg: `has ${v.length} items, min ${s.minItems}` });
      if (s.maxItems !== undefined && v.length > s.maxItems) out.push({ path, msg: `has ${v.length} items, max ${s.maxItems}` });
      if (s.uniqueItems) {
        const seen = new Map();
        v.forEach((item, i) => {
          const k = canon(item);
          if (seen.has(k)) out.push({ path: `${path}/${i}`, msg: `duplicate of item ${seen.get(k)} (${short(item)})` });
          else seen.set(k, i);
        });
      }
      if (s.prefixItems) s.prefixItems.forEach((ps, i) => i < v.length && check(ps, v[i], `${path}/${i}`, out));
      if (s.items !== undefined) {
        const from = s.prefixItems ? s.prefixItems.length : 0;
        for (let i = from; i < v.length; i++) check(s.items, v[i], `${path}/${i}`, out);
      }
      if (s.contains !== undefined) {
        const n = v.filter((item) => {
          const o = [];
          check(s.contains, item, path, o);
          return o.length === 0;
        }).length;
        const min = s.minContains ?? 1;
        if (n < min) out.push({ path, msg: `must contain at least ${min} matching item(s) (${describeContains(s.contains)}), found ${n}` });
        if (s.maxContains !== undefined && n > s.maxContains) out.push({ path, msg: `must contain at most ${s.maxContains} matching item(s) (${describeContains(s.contains)}), found ${n}` });
      }
    }
    if (typeMatches('object', v)) {
      const keys = Object.keys(v);
      if (s.required) for (const k of s.required) if (!(k in v)) out.push({ path, msg: `missing required property "${k}"` });
      if (s.minProperties !== undefined && keys.length < s.minProperties) out.push({ path, msg: `has ${keys.length} properties, min ${s.minProperties}` });
      if (s.maxProperties !== undefined && keys.length > s.maxProperties) out.push({ path, msg: `has ${keys.length} properties, max ${s.maxProperties}` });
      if (s.propertyNames) for (const k of keys) {
        const o = [];
        check(s.propertyNames, k, `${path}/${k}`, o);
        for (const e of o) out.push({ path: `${path}/${k}`, msg: `property name: ${e.msg}` });
      }
      if (s.dependentRequired) for (const [k, deps] of Object.entries(s.dependentRequired)) if (k in v) for (const d of deps) if (!(d in v)) out.push({ path, msg: `"${k}" requires "${d}"` });
      const props = s.properties ?? {};
      const patterns = Object.entries(s.patternProperties ?? {});
      for (const k of keys) {
        let matched = false;
        if (k in props) {
          matched = true;
          check(props[k], v[k], `${path}/${k}`, out);
        }
        for (const [p, ps] of patterns) if (rx(p).test(k)) {
          matched = true;
          check(ps, v[k], `${path}/${k}`, out);
        }
        if (!matched && s.additionalProperties !== undefined) {
          if (s.additionalProperties === false) out.push({ path: `${path}/${k}`, msg: `unexpected property "${k}"${didYouMean(k, Object.keys(props))}` });
          else check(s.additionalProperties, v[k], `${path}/${k}`, out);
        }
      }
    }
    if (s.allOf) for (const sub of s.allOf) check(sub, v, path, out);
    if (s.anyOf || s.oneOf) {
      const branches = (s.anyOf ?? s.oneOf).map((sub) => {
        const o = [];
        check(sub, v, path, o);
        return o;
      });
      const passing = branches.filter((o) => o.length === 0).length;
      if (s.anyOf && passing === 0) out.push(...bestBranch(branches, path, 'anyOf'));
      if (s.oneOf && passing === 0) out.push(...bestBranch(branches, path, 'oneOf'));
      if (s.oneOf && passing > 1) out.push({ path, msg: `matches ${passing} oneOf branches, expected exactly 1` });
    }
    if (s.not) {
      const o = [];
      check(s.not, v, path, o);
      if (o.length === 0) out.push({ path, msg: 'must not match the "not" schema' });
    }
    if (s.if) {
      const o = [];
      check(s.if, v, path, o);
      if (o.length === 0 && s.then) check(s.then, v, path, out);
      if (o.length > 0 && s.else) check(s.else, v, path, out);
    }
  }
  const bestBranch = (branches, path, kw) => {
    const best = branches.reduce((a, b) => (b.length < a.length ? b : a));
    return [{ path, msg: `matches no ${kw} branch; closest branch fails with:` }, ...best];
  };
  const describeContains = (c) => {
    const role = c?.properties?.role?.const;
    return role ? `role "${role}"` : 'the contains schema';
  };
  return (value, defPath) => {
    const out = [];
    const start = defPath ? resolve(defPath) : root;
    check(start, value, '', out);
    return out;
  };
}

// ── taxonomy lookups ──────────────────────────────────────────────────────────
const tax = {
  departments: new Map((taxonomy.departments ?? []).map((d) => [d.id, d])),
  categories: new Map((taxonomy.skill_categories ?? []).map((c) => [c.id, c])),
  groups: new Map((taxonomy.team_groups ?? []).map((g) => [g.id, g])),
  personas: new Map(),
  skills: new Map(),
  recipes: new Map(),
  leads: new Map((taxonomy.leads ?? []).map((l) => [l.id, l])),
};
for (const d of taxonomy.departments ?? []) for (const p of d.personas ?? []) tax.personas.set(p.id, { ...p, department: d.id });
for (const c of taxonomy.skill_categories ?? []) for (const s of c.skills ?? []) tax.skills.set(s.id, { ...s, category: c.id });
for (const g of taxonomy.team_groups ?? []) for (const r of g.recipes ?? []) tax.recipes.set(r.id, { ...r, group: g.id });

const vocab = {
  tools: new Map((taxonomy.tool_vocabulary ?? []).map((t) => [t.id, t])),
  connectors: new Map((taxonomy.connector_vocabulary ?? []).map((c) => [c.id, c])),
  activities: new Map((taxonomy.activity_types ?? []).map((a) => [a.id, a])),
  artifacts: new Map((taxonomy.artifact_types ?? []).map((a) => [a.id, a])),
  industries: new Set((taxonomy.industries ?? []).map((i) => i.id)),
  modelNeeds: new Set(taxonomy.model_needs ?? []),
  providers: new Set(taxonomy.model_tiers?.providers ?? []),
  meetingFormats: new Set((taxonomy.meeting_formats ?? []).map((m) => m.id)),
  domains: taxonomy.regulated_domains ?? {},
  teamRoles: new Set(Object.keys(taxonomy.team_roles ?? {})),
};
const V = taxonomy.voices ?? {};
const voices = {
  openaiTts: new Set(Object.keys(V.openai_tts?.voices ?? {})),
  openaiRealtime: new Set(V.openai_realtime?.voices ?? []),
  openaiLive: new Set(V.openai_live?.voices ?? []),
  xaiTts: new Set(Object.keys(V.xai_tts?.voices ?? {})),
  xaiRealtime: new Set(V.xai_realtime?.voices ?? []),
};
voices.openaiAny = new Set([...voices.openaiTts, ...voices.openaiRealtime, ...voices.openaiLive]);
voices.allIds = new Set([...voices.openaiAny, ...voices.xaiTts, ...voices.xaiRealtime]);
const presentation = (provider, id) => {
  if (provider === 'openai') return V.openai_tts?.voices?.[id]?.presentation ?? V.openai_live?.notes?.[id]?.presentation ?? 'unknown';
  return V.xai_tts?.voices?.[id]?.presentation ?? 'unknown';
};
const XAI_CHARACTERIZED = new Set(Object.entries(V.xai_tts?.voices ?? {}).filter(([, v]) => v.basis === 'inferred').map(([k]) => k));
const wantPresentation = { 'she/her': 'feminine', 'he/him': 'masculine' };
const PREFIX = taxonomy.portrait_conventions?.prompt_prefix ?? 'A single adult, front-facing portrait, unobstructed face, relaxed closed lips, head and shoulders, natural facial proportions, no text. ';
const TIER_RANK = { inert: 0, draft: 1, ask: 2, always_ask: 3 };
const leadOnlyTools = new Set((taxonomy.tool_vocabulary ?? []).filter((t) => t.lead_only).map((t) => t.id));
// taxonomy.baseline_tools are implicit for every coworker (never listed in persona tools)
const BASELINE = new Set(taxonomy.baseline_tools?.tools ?? []);
const effectiveTools = (p) => new Set([...(p.tools ?? []), ...BASELINE]);
// taxonomy.untrusted_content_rule (prompt-injection guard), inherited like honesty_policy
const UCR = taxonomy.untrusted_content_rule ?? {};
const READER_TOOLS = new Set(UCR.reader_tools ?? ['web_fetch', 'web_search', 'x_search', 'web_watch', 'browser', 'file_parse', 'connector_read', 'vision_describe', 'stt']);
const WRITER_TOOLS = new Set(UCR.external_write_tools ?? ['send_external', 'publish_external', 'connector_write', 'schedule_automation']);
const readsAndWrites = (tools) => [...tools].some((t) => READER_TOOLS.has(t)) && [...tools].some((t) => WRITER_TOOLS.has(t));
// an intro spoken at a kickoff must not claim work that has not happened yet
const INTRO_CLAIM = /\b(I've|I have|I watched|I pulled|I timed|I spoke|I checked|I found|I ran|I read|I brought|I built|I circled|I graded|I tested|I listened|I looked|I counted|I scanned|I reviewed|I mapped|I compared|I traced|I audited|I went through|I dug|I noticed|I already|I sorted|I fixed|I drafted|I wrote|I made|I spotted|I prepared|I called|I interviewed|I analy[sz]ed|I measured|I tracked|I collected|I gathered)\b|\b(is|are) (already )?at (\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|\b(changed|dropped|jumped|fell|rose) (something )?(this|last) (week|month)\b/i;
// the first line of a direct chat opens in the owner's language; heritage greetings go to greeting_flourish
const HERITAGE_GREETING = /^[¡¿]?\s*(hola|ol[aá]|oi|bonjour|salut|ciao|hallo|hej|hei|moi|tere|sveiki|labas|cze[sś][cć]|dzie[nń] dobry|ahoj|zdravo|szia|bun[aă]|merhaba|marhaba|salaam|salam|as-?salaam|shalom|selam|sawubona|molo|dumela|jambo|habari|sannu|bawo|kedu|ekaabo|akwaaba|kia ora|bula|talofa|malo|aloha|mabuhay|kumusta|namaste|namaskar|vanakkam|sat sri akal|ayubowan|konnichiwa|annyeong|ni ?hao|xin ch[aà]o|sawasdee|selamat|yassou|geia|privet|pryvit|zdravstvuyte|sain uu|salem|g'?day|kaixo|dia dhuit|shwmae|hyvää)\b/i;
const QUIRK_MOTIFS = {
  'reads aloud': /\baloud\b|\bout loud\b/i,
  'notebook or log': /\bnote ?books?\b|\bjournal\b|\bsketchbook\b|\blog\b/i,
  'graveyard, museum or hall of fame': /\bgraveyard\b|\bmuseum\b|\bcemetery\b|\bhall of fame\b|\bwall of (fame|wins|shame|fixed)\b/i,
  jar: /\bjar\b/i,
  bell: /\bbell\b/i,
  'counts to N before speaking': /\bcounts? (silently |in (his|her|their) head )?to (three|five|seven|ten|\d+)\b|\bcounts? to \w+ in (his|her|their) head\b/i,
  'zombie statistics': /\bzombie\b/i,
};
const LORE_MARKER = /\bIn (her|his|their|[\p{L}'’-]+['’]s) (lore|story|backstory)\b/u;

// ── schema enums must mirror taxonomy vocabularies ───────────────────────────
function compareEnum(schemaName, defName, expected, label) {
  const s = schemas[schemaName];
  const def = s?.$defs?.[defName];
  if (!def) return;
  const actual = new Set(def.enum ?? []);
  const missing = [...expected].filter((x) => !actual.has(x));
  const extra = [...actual].filter((x) => !expected.has(x));
  if (missing.length || extra.length) error('vocab', `schema/${schemaName}.schema.json`, `$defs.${defName}`, `enum differs from taxonomy ${label}: missing [${missing.join(', ')}] extra [${extra.join(', ')}]`);
}
const coworkerTools = new Set([...vocab.tools.keys()].filter((t) => !leadOnlyTools.has(t)));
for (const sn of ['persona', 'skill']) compareEnum(sn, 'coworker_tool_id', coworkerTools, 'tool_vocabulary (non-lead)');
for (const sn of ['persona', 'skill', 'team-recipe']) {
  compareEnum(sn, 'connector_id', new Set(vocab.connectors.keys()), 'connector_vocabulary');
  compareEnum(sn, 'artifact_type', new Set(vocab.artifacts.keys()), 'artifact_types');
}
for (const sn of ['skill', 'team-recipe']) compareEnum(sn, 'activity_type', new Set(vocab.activities.keys()), 'activity_types');
for (const sn of ['persona', 'skill']) compareEnum(sn, 'department_id', new Set(tax.departments.keys()), 'departments');
compareEnum('skill', 'skill_category_id', new Set(tax.categories.keys()), 'skill_categories');
for (const sn of ['persona', 'team-recipe']) compareEnum(sn, 'industry_id', vocab.industries, 'industries');
compareEnum('persona', 'provider', vocab.providers, 'model_tiers.providers');
compareEnum('team-recipe', 'meeting_format', vocab.meetingFormats, 'meeting_formats');
{
  const vp = schemas.persona?.properties?.voice?.properties;
  const cmp = (node, expected, label) => {
    const actual = new Set(node?.enum ?? []);
    const missing = [...expected].filter((x) => !actual.has(x));
    const extra = [...actual].filter((x) => !expected.has(x));
    if (missing.length || extra.length) error('vocab', 'schema/persona.schema.json', label, `voice enum differs from taxonomy: missing [${missing.join(', ')}] extra [${extra.join(', ')}]`);
  };
  if (vp) {
    cmp(vp.openai?.properties?.voice, voices.openaiTts, 'voice.openai.voice');
    cmp(vp.openai?.properties?.alternates?.items, voices.openaiAny, 'voice.openai.alternates');
    cmp(vp.xai?.properties?.voice, voices.xaiTts, 'voice.xai.voice');
    cmp(vp.xai?.properties?.alternates?.items, voices.xaiTts, 'voice.xai.alternates');
  }
}

// ── load records ──────────────────────────────────────────────────────────────
const validators = Object.fromEntries(Object.entries(schemas).filter(([, s]) => s).map(([k, s]) => [k, makeValidator(s)]));
const schemaErrorPaths = new Set(); // `${file}|${path}` for enum failures, to avoid double reporting in refs checks

function labelPath(fileValue, arrayKey, path) {
  // "/personas/3/voice/speed" -> "red-team-sceptic › voice.speed"
  const m = path.match(new RegExp(`^/${arrayKey}/(\\d+)(/.*)?$`));
  if (!m || !fileValue?.[arrayKey]) return path.replace(/^\//, '').replace(/\//g, '.') || '(file)';
  const rec = fileValue[arrayKey][Number(m[1])];
  const id = rec?.id ?? rec?.persona_id ?? `#${m[1]}`;
  return m[2] ? `${id} › ${m[2].slice(1).replace(/\//g, '.')}` : id;
}
function runSchema(kind, file, value, defPath, arrayKey) {
  const validate = validators[kind];
  if (!validate || value === undefined) return;
  for (const e of validate(value, defPath)) {
    if (e.kind === 'enum') schemaErrorPaths.add(`${file}|${e.path}`);
    error('schema', file, labelPath(value, arrayKey, e.path), e.msg);
  }
}

const personas = []; // {rec, file, index}
const skills = [];
const leads = [];
const recipes = [];
const personaFiles = listJson('personas');
const skillFiles = listJson('skills');
const leadFiles = listJson('leads').filter((f) => basename(f) !== 'match-quiz.json');
const teamFiles = listJson('teams');
const expressionFiles = listJson('expressions');

for (const file of personaFiles) {
  const v = load(file);
  if (!v) continue;
  runSchema('persona', file, v, '#/$defs/department_file', 'personas');
  const dep = basename(file, '.json');
  if (v.department !== dep) error('taxonomy', file, '(file)', `department "${v.department}" does not match the file name "${dep}"`);
  if (!tax.departments.has(dep)) error('taxonomy', file, '(file)', `"${dep}" is not a taxonomy department${didYouMean(dep, [...tax.departments.keys()])}`);
  (v.personas ?? []).forEach((rec, index) => personas.push({ rec, file, index, fileDept: dep }));
}
for (const file of skillFiles) {
  const v = load(file);
  if (!v) continue;
  runSchema('skill', file, v, '#/$defs/category_file', 'skills');
  const cat = basename(file, '.json');
  if (v.category !== cat) error('taxonomy', file, '(file)', `category "${v.category}" does not match the file name "${cat}"`);
  if (!tax.categories.has(cat)) error('taxonomy', file, '(file)', `"${cat}" is not a taxonomy skill category`);
  (v.skills ?? []).forEach((rec, index) => skills.push({ rec, file, index, fileCat: cat }));
}
for (const file of leadFiles) {
  const v = load(file);
  if (!v) continue;
  runSchema('lead', file, v, null, null);
  if (v.id !== basename(file, '.json')) error('taxonomy', file, '(file)', `lead id "${v.id}" does not match the file name`);
  leads.push({ rec: v, file });
}
for (const file of teamFiles) {
  const v = load(file);
  if (!v) continue;
  runSchema('team-recipe', file, v, '#/$defs/group_file', 'recipes');
  const grp = basename(file, '.json');
  if (v.group !== grp) error('taxonomy', file, '(file)', `group "${v.group}" does not match the file name "${grp}"`);
  (v.recipes ?? []).forEach((rec, index) => recipes.push({ rec, file, index, fileGroup: grp }));
}
const quiz = load('leads/match-quiz.json', { optional: true });
for (const file of expressionFiles) {
  const v = load(file);
  if (!v) continue;
  runSchema('expression-pack', file, v, null, v.packs ? 'packs' : null);
}

// ── maps + global id uniqueness ───────────────────────────────────────────────
const byId = (list) => {
  const m = new Map();
  for (const x of list) if (x.rec?.id && !m.has(x.rec.id)) m.set(x.rec.id, x);
  return m;
};
const P = byId(personas);
const S = byId(skills);
const L = byId(leads);
const R = byId(recipes);
const where = (x) => x.rec?.id ?? `#${x.index}`;

{
  const owners = new Map(); // id -> [kind@file]
  const add = (id, label) => {
    if (!id) return;
    if (!owners.has(id)) owners.set(id, []);
    owners.get(id).push(label);
  };
  for (const id of tax.departments.keys()) add(id, 'department');
  for (const id of tax.categories.keys()) add(id, 'skill category');
  for (const id of tax.groups.keys()) add(id, 'team group');
  for (const x of personas) add(x.rec.id, `persona in ${x.file}`);
  for (const x of skills) add(x.rec.id, `skill in ${x.file}`);
  for (const x of leads) add(x.rec.id, `lead in ${x.file}`);
  for (const x of recipes) add(x.rec.id, `recipe in ${x.file}`);
  for (const [id, labels] of owners) if (labels.length > 1) error('ids', labels[1].split(' in ')[1] ?? 'taxonomy.json', id, `id is not globally unique: used by ${labels.join('; ')}`);
}

// ── taxonomy pre-assignments ──────────────────────────────────────────────────
function preassigned(kind, taxMap, records, fields, containerKey) {
  const present = new Map();
  for (const x of records) present.set(x.rec.id, (present.get(x.rec.id) ?? 0) + 1);
  for (const [id, t] of taxMap) {
    if (!present.has(id)) error('taxonomy', 'taxonomy.json', id, `pre-assigned ${kind} is missing from the catalog files (${containerKey} "${t[containerKey] ?? ''}")`);
  }
  for (const x of records) {
    const t = taxMap.get(x.rec.id);
    if (!t) {
      error('taxonomy', x.file, where(x), `${kind} id is not pre-assigned in taxonomy.json${didYouMean(x.rec.id, [...taxMap.keys()])}`);
      continue;
    }
    for (const [recField, taxField] of fields) {
      if (x.rec[recField] !== undefined && t[taxField] !== undefined && x.rec[recField] !== t[taxField]) {
        error('taxonomy', x.file, where(x), `${recField} "${x.rec[recField]}" differs from taxonomy "${t[taxField]}"`);
      }
    }
  }
}
preassigned('persona', tax.personas, personas, [['name', 'name'], ['handle', 'handle'], ['pronouns', 'pronouns'], ['age_range', 'age_range'], ['seniority', 'seniority'], ['title', 'title'], ['department', 'department'], ['heritage', 'heritage']], 'department');
preassigned('skill', tax.skills, skills, [['category', 'category']], 'category');
preassigned('lead', tax.leads, leads, [['name', 'name'], ['handle', 'handle'], ['pronouns', 'pronouns'], ['age_range', 'age_range'], ['heritage', 'heritage'], ['archetype', 'archetype']], 'archetype');
preassigned('recipe', tax.recipes, recipes, [['name', 'name'], ['group', 'group'], ['outcome', 'outcome']], 'group');
for (const x of personas) if (x.rec.department && x.rec.department !== x.fileDept) error('taxonomy', x.file, where(x), `department "${x.rec.department}" but the record lives in ${x.fileDept}.json`);
for (const x of skills) {
  if (x.rec.category && x.rec.category !== x.fileCat) error('taxonomy', x.file, where(x), `category "${x.rec.category}" but the record lives in ${x.fileCat}.json`);
  const t = tax.skills.get(x.rec.id);
  if (t && x.rec.name && t.name && x.rec.name !== t.name) warn('taxonomy', x.file, where(x), `name "${x.rec.name}" differs from taxonomy "${t.name}"`);
}
for (const x of recipes) if (x.rec.group && x.rec.group !== x.fileGroup) error('taxonomy', x.file, where(x), `group "${x.rec.group}" but the record lives in ${x.fileGroup}.json`);
{
  // duplicates within record kinds
  const dupes = (list, kind) => {
    const seen = new Map();
    for (const x of list) {
      if (seen.has(x.rec.id)) error('ids', x.file, where(x), `duplicate ${kind} id (also in ${seen.get(x.rec.id)})`);
      else seen.set(x.rec.id, x.file);
    }
  };
  dupes(personas, 'persona');
  dupes(skills, 'skill');
  dupes(leads, 'lead');
  dupes(recipes, 'recipe');
  // taxonomy order within department files (warn)
  for (const [dep, d] of tax.departments) {
    const order = (d.personas ?? []).map((p) => p.id);
    const actual = personas.filter((x) => x.fileDept === dep).map((x) => x.rec.id);
    const expected = order.filter((id) => actual.includes(id));
    if (actual.join() !== expected.join() && actual.every((id) => order.includes(id))) warn('taxonomy', `personas/${dep}.json`, '(file)', 'personas are not listed in taxonomy order');
  }
  // taxonomy counters (warn)
  for (const d of taxonomy.departments ?? []) if (d.persona_count !== undefined && d.persona_count !== (d.personas ?? []).length) warn('taxonomy', 'taxonomy.json', d.id, `persona_count ${d.persona_count} != ${(d.personas ?? []).length} listed`);
  for (const c of taxonomy.skill_categories ?? []) if (c.skill_count !== undefined && c.skill_count !== (c.skills ?? []).length) warn('taxonomy', 'taxonomy.json', c.id, `skill_count ${c.skill_count} != ${(c.skills ?? []).length} listed`);
  for (const g of taxonomy.team_groups ?? []) if (g.recipe_count !== undefined && g.recipe_count !== (g.recipes ?? []).length) warn('taxonomy', 'taxonomy.json', g.id, `recipe_count ${g.recipe_count} != ${(g.recipes ?? []).length} listed`);
  const st = taxonomy.stats ?? {};
  for (const [k, n] of [['personas', tax.personas.size], ['skills', tax.skills.size], ['leads', tax.leads.size], ['recipes', tax.recipes.size]]) {
    if (st[k] !== undefined && st[k] !== n) warn('taxonomy', 'taxonomy.json', `stats.${k}`, `${st[k]} but the taxonomy lists ${n}`);
  }
}

// ── handles and first names ───────────────────────────────────────────────────
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/gi, 'o').replace(/ł/gi, 'l').replace(/ß/g, 'ss').replace(/æ/gi, 'ae').replace(/đ/gi, 'd').replace(/ı/g, 'i').toLowerCase();
const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0];
// Story names used in docs (PRODUCT.md §5 owners, Chief of Staff names and story coworkers) never name a catalog person.
const RESERVED_FIRST = new Set([...(taxonomy.reserved_first_names?.names ?? ['Dana', 'Luis', 'Priya', 'Morgan'])].map((n) => fold(n)));
{
  const people = [...personas.map((x) => ({ ...x, kind: 'coworker' })), ...leads.map((x) => ({ ...x, kind: 'lead' }))];
  const byHandle = new Map();
  const byFirst = new Map();
  for (const x of people) {
    const { handle, name } = x.rec;
    if (handle) {
      if (byHandle.has(handle)) error('ids', x.file, where(x), `handle "@${handle}" is also used by ${byHandle.get(handle)}`);
      else byHandle.set(handle, `${x.kind} ${where(x)}`);
      if (voices.allIds.has(handle)) error('ids', x.file, where(x), `handle "${handle}" equals a voice id`);
      const folded = fold(firstName(name)).replace(/[^a-z0-9-]/g, '');
      if (name && folded !== handle) warn('ids', x.file, where(x), `handle "${handle}" is not the ASCII-folded first name "${folded}"`);
    }
    if (name) {
      const f = fold(firstName(name));
      if (byFirst.has(f)) error('ids', x.file, where(x), `first name "${firstName(name)}" is not unique: also ${byFirst.get(f)}`);
      else byFirst.set(f, `${x.kind} ${where(x)} (${name})`);
      if (voices.allIds.has(f)) error('ids', x.file, where(x), `first name "${firstName(name)}" equals a voice id`);
      if (RESERVED_FIRST.has(f)) error('ids', x.file, where(x), `first name "${firstName(name)}" is reserved (taxonomy.reserved_first_names: a docs story name)`);
    }
  }
}

// ── helpers for references ────────────────────────────────────────────────────
const personaIds = [...tax.personas.keys(), ...P.keys()];
const skillIds = [...tax.skills.keys(), ...S.keys()];
const personaExists = (id) => P.has(id);
const skillExists = (id) => S.has(id);
function refPersona(file, w, id, label) {
  if (!personaExists(id)) error('refs', file, w, `${label}: unknown persona "${id}"${didYouMean(id, personaIds)}`);
}
function refSkill(file, w, id, label) {
  if (!skillExists(id)) error('refs', file, w, `${label}: unknown skill "${id}"${didYouMean(id, skillIds)}`);
}
function refVocab(file, path, w, value, map, label) {
  if (schemaErrorPaths.has(`${file}|${path}`)) return; // already reported by the schema check
  const has = map instanceof Map ? map.has(value) : map.has(value);
  if (!has) error('vocab', file, w, `${label}: unknown id "${value}"${didYouMean(value, [...(map instanceof Map ? map.keys() : map)])}`);
}
const wordCount = (s) => String(s ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const stem = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ing|ed|es|s)$/, '');
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'is', 'it', 'on', 'in', 'any', 'be', 'by', 'with', 'you', 'are', 'as', 'at', 'that', 'this', 'no', 'only', 'never', 'say']);
const contentWords = (s) => new Set(String(s).split(/\s+/).map(stem).filter((w) => w.length > 2 && !STOP.has(w)));
function restates(guardrails, rule) {
  const ruleWords = contentWords(rule);
  let best = 0;
  for (const g of guardrails ?? []) {
    const gw = contentWords(g);
    const hit = [...ruleWords].filter((w) => gw.has(w)).length;
    best = Math.max(best, hit / Math.max(1, ruleWords.size));
  }
  return best;
}
// joint restatement: a domain rule may be spread over two guardrails
function restatesJoint(guardrails, rule) {
  const ruleWords = contentWords(rule);
  const all = contentWords((guardrails ?? []).join(' '));
  return [...ruleWords].filter((w) => all.has(w)).length / Math.max(1, ruleWords.size);
}
const negated = (text, idx) => /\b(no|not|without|never|free of|nothing)\b[^.;,]{0,40}$/i.test(text.slice(Math.max(0, idx - 60), idx));

// ── portraits ─────────────────────────────────────────────────────────────────
const PORTRAIT_FORBIDDEN = [
  [/\bsunglasses\b|\btinted (lenses|glasses)\b|\bmirrored lenses\b/i, 'eyes must stay visible (clear lenses only)'],
  [/\bopen[- ]mouth(ed)?\b|\bparted lips\b|\bmouth (slightly )?open\b|\blips (slightly )?parted\b/i, 'the resting mouth must be closed (the renderer opens it)'],
  [/\bteeth\b|\btoothy\b|(?<!closed[- ](lip|lipped|mouth|mouthed) )\bgrin(ning)?\b|\blaugh(ing)?\b(?! lines)/i, 'no visible teeth, open grin or laugh in a warpable portrait'],
  [/\b(face )?mask\b|\bmicrophone\b|\bheadset\b|\bniqab\b|\bveil(ed)?\b|\bscarf (over|across) (the )?(mouth|face)\b/i, 'nothing may cover the mouth, jaw or chin'],
  [/\bhands?\b(?! ?-?(knit|made|stitched|thrown|painted|dyed|tooled|woven|carved|embroidered|crafted|beaded|forged|lettered|drawn|me-down))|\bholding\b|\bcigarette\b|\bpipe\b|\bmug\b|\bcup of\b/i, 'no hands or objects in the frame near the face'],
  [/\bprofile view\b|\bthree-quarter\b|\blooking away\b|\bside view\b|\btilted head\b/i, 'front-facing, head level'],
  [/\b(two|several|group of) (people|adults|persons)\b|\bcouple\b/i, 'exactly one adult'],
  [/\b(logo|brand name|text overlay|watermark|lettering)\b/i, 'no text or logos'],
];
function checkPortrait(file, w, avatar) {
  if (!avatar) return;
  const p = avatar.portrait_prompt;
  if (typeof p === 'string') {
    if (!p.startsWith(PREFIX)) error('portraits', file, w, 'portrait_prompt does not start with the exact warpable prefix from taxonomy.portrait_conventions.prompt_prefix');
    const body = p.startsWith(PREFIX) ? p.slice(PREFIX.length) : p;
    for (const [re, why] of PORTRAIT_FORBIDDEN) {
      const g = new RegExp(re.source, 'gi');
      let m;
      while ((m = g.exec(body))) {
        if (!negated(body, m.index)) {
          error('portraits', file, w, `portrait_prompt mentions "${m[0]}": ${why}`);
          break;
        }
      }
    }
    if (!/\blips (are |stay |fully |gently |softly |relaxed and )*(closed|together)\b|\bclosed[- ]lip|\bclosed lips\b|\bmouth (gently |softly )?closed\b/i.test(body)) warn('portraits', file, w, 'portrait_prompt body never restates the closed-lip resting expression');
    if (/\b(mustache|moustache)\b/i.test(body) && !negated(body, body.search(/\b(mustache|moustache)\b/i)) && !/trimmed|above the (upper )?lip|lips? (fully |clearly )?visible|clear of the (upper )?lip|lip line/i.test(body)) error('portraits', file, w, 'moustache without "trimmed above the lip / lips visible" (mouth must stay warpable)');
    if (/\bbeard\b/i.test(body) && !/trimmed|short|neat|close|lips? (fully |clearly )?visible|clear of the lip|groomed|clipped|cropped/i.test(body)) warn('portraits', file, w, 'beard without a length/lips-visible note');
    if (!/\b(backdrop|background)\b/i.test(body)) warn('portraits', file, w, 'portrait_prompt names no backdrop (deep charcoal seamless, catalog/ART-DIRECTION.md §3)');
    const accent = avatar.accent_color;
    if (typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent) && !(new RegExp(`${accent}\\)? rim light`, 'i').test(body))) warn('portraits', file, w, `portrait_prompt has no rim light in avatar.accent_color ${accent} (catalog/ART-DIRECTION.md §3, §6)`);
    if (!/85 ?mm|eye[- ]level|even (key )?light|soft (even )?(key )?light/i.test(body)) warn('portraits', file, w, 'portrait_prompt names no lighting/camera (soft even light, eye level, 85mm)');
  }
  const ex = avatar.expression_palette ?? {};
  if (typeof ex.delighted === 'string' && !/closed[- ]lip|lips (stay |remain |kept |gently |softly )*(closed|together|sealed)|mouth (stays |remains )?closed|without (showing|parting)|no teeth/i.test(ex.delighted)) error('portraits', file, w, 'expression_palette.delighted must be a closed-lip smile');
  for (const [state, text] of Object.entries(ex)) {
    if (typeof text !== 'string') continue;
    const m = text.match(/\bteeth\b|\bopen[- ]mouth(ed)?\b|\bmouth open\b|\blaugh(ing)?\b(?! lines)|(?<!closed[- ](lip|lipped|mouth|mouthed) )\bgrin(ning)?\b|\bparted lips\b|\blips parted\b/i);
    if (m && !negated(text, m.index)) error('portraits', file, w, `expression_palette.${state} mentions "${m[0]}" (expressions keep lips closed)`);
  }
  const proc = avatar.appearance?.procedural;
  if (proc) for (const k of Object.keys(proc)) if (/(Size|Width|Height|Spacing|Brightness)$/.test(k) && proc[k] === 0) error('portraits', file, w, `appearance.procedural.${k} must not be 0`);
}

// ── personas ──────────────────────────────────────────────────────────────────
const SLIDERS = ['warmth', 'directness', 'formality', 'humor', 'risk_appetite', 'detail', 'pace'];
function checkSliders(file, w, sliders) {
  if (!sliders) return;
  for (const k of SLIDERS) {
    const v = sliders[k];
    if (!(Number.isInteger(v) && v >= 0 && v <= 100)) error('sliders', file, w, `slider ${k}=${JSON.stringify(v)} must be an integer 0-100`);
  }
}
const pairUse = new Map(); // "openai+xai" -> [persona ids]
const pathOf = (x, sub) => `/personas/${x.index}${sub}`;
for (const x of personas) {
  const p = x.rec;
  const f = x.file;
  const w = where(x);
  // references
  for (const [i, id] of (p.pairs_well_with ?? []).entries()) {
    refPersona(f, w, id, `pairs_well_with[${i}]`);
    if (id === p.id) error('refs', f, w, 'pairs_well_with lists the persona itself');
  }
  for (const [i, t] of (p.productive_tension_with ?? []).entries()) {
    refPersona(f, w, t.persona_id, `productive_tension_with[${i}]`);
    if (t.persona_id === p.id) error('refs', f, w, 'productive_tension_with lists the persona itself');
  }
  const prim = p.skills?.primary ?? [];
  const sec = p.skills?.secondary ?? [];
  prim.forEach((id, i) => refSkill(f, w, id, `skills.primary[${i}]`));
  sec.forEach((id, i) => refSkill(f, w, id, `skills.secondary[${i}]`));
  for (const id of prim) if (sec.includes(id)) warn('refs', f, w, `skill "${id}" is both primary and secondary`);
  (p.tools ?? []).forEach((t, i) => {
    if (leadOnlyTools.has(t)) error('tools', f, w, `tools[${i}] "${t}" is lead-only`);
    else refVocab(f, pathOf(x, `/tools/${i}`), w, t, vocab.tools, `tools[${i}]`);
  });
  (p.connectors ?? []).forEach((c, i) => refVocab(f, pathOf(x, `/connectors/${i}`), w, c, vocab.connectors, `connectors[${i}]`));
  (p.deliverables ?? []).forEach((d, i) => refVocab(f, pathOf(x, `/deliverables/${i}/artifact_type`), w, d.artifact_type, vocab.artifacts, `deliverables[${i}].artifact_type`));
  (p.industries ?? []).forEach((d, i) => refVocab(f, pathOf(x, `/industries/${i}`), w, d, vocab.industries, `industries[${i}]`));
  (p.model_policy?.needs ?? []).forEach((d, i) => refVocab(f, pathOf(x, `/model_policy/needs/${i}`), w, d, vocab.modelNeeds, `model_policy.needs[${i}]`));
  (p.model_policy?.provider_preference ?? []).forEach((d, i) => refVocab(f, pathOf(x, `/model_policy/provider_preference/${i}`), w, d, vocab.providers, `model_policy.provider_preference[${i}]`));
  (p.team_roles ?? []).forEach((r, i) => refVocab(f, pathOf(x, `/team_roles/${i}`), w, r, vocab.teamRoles, `team_roles[${i}]`));
  if (p.key !== undefined && p.key !== p.id) error('refs', f, w, `key "${p.key}" must equal id`);
  // tools (plus the implicit baseline) cover primary skill tools
  const have = effectiveTools(p);
  const listedBaseline = (p.tools ?? []).filter((t) => BASELINE.has(t));
  if (listedBaseline.length) warn('tools', f, w, `tools list baseline tools [${listedBaseline.join(', ')}]; taxonomy.baseline_tools are implicit, list only differentiating tools`);
  const missing = new Set();
  for (const sid of prim) for (const t of S.get(sid)?.rec.tools ?? []) if (!have.has(t)) missing.add(t);
  if (missing.size) error('tools', f, w, `tools lack [${[...missing].join(', ')}] required by primary skills (${prim.filter((sid) => (S.get(sid)?.rec.tools ?? []).some((t) => missing.has(t))).join(', ')})`);
  if ((p.modalities?.inputs ?? []).includes('image') && !have.has('vision_describe')) error('tools', f, w, 'modalities.inputs includes "image" but tools lack vision_describe');
  if (p.instanceOf !== 'lead') error('tools', f, w, 'instanceOf must be "lead" so the owner\'s standing rules reach this coworker');
  // prompt-injection guard
  if (readsAndWrites(have) && UCR.canonical) {
    const score = Math.max(restates(p.guardrails, UCR.canonical), restatesJoint(p.guardrails, UCR.canonical) - 0.15);
    if (score < 0.6) error('untrusted', f, w, `reads untrusted content and can act externally, but guardrails do not restate taxonomy.untrusted_content_rule (best overlap ${(score * 100).toFixed(0)}%)`);
  }
  // intro and welcome
  if (typeof p.intro_line === 'string') {
    const m = p.intro_line.match(INTRO_CLAIM);
    if (m) error('intro', f, w, `intro_line claims work not yet done ("${m[0]}"); intros are spoken at kickoff, so keep them forward-looking (use intro_after_work for receipts)`);
  }
  if (p.intro_after_work) {
    const inTemplate = new Set([...String(p.intro_after_work.template ?? '').matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]));
    const declared = new Set(Object.keys(p.intro_after_work.slots ?? {}));
    for (const s of inTemplate) if (!declared.has(s)) error('intro', f, w, `intro_after_work uses {${s}} but slots does not say which receipt fills it`);
    for (const s of declared) if (!inTemplate.has(s)) warn('intro', f, w, `intro_after_work.slots.${s} is not used in the template`);
  }
  if (typeof p.welcome === 'string' && HERITAGE_GREETING.test(p.welcome)) error('intro', f, w, `welcome opens with a heritage-language greeting ("${p.welcome.match(HERITAGE_GREETING)[0]}"); open in the owner's language and move it to greeting_flourish`);
  // sliders, backstory, portraits
  checkSliders(f, w, p.personality?.sliders);
  const wc = wordCount(p.backstory);
  if (p.backstory !== undefined && (wc < 60 || wc > 120)) error('backstory', f, w, `backstory has ${wc} words (coworkers: 60-120)`);
  checkPortrait(f, w, p.avatar);
  // regulated domains
  for (const dom of p.regulated_domains ?? []) {
    const rule = vocab.domains[dom]?.rule;
    if (!rule) continue;
    const score = Math.max(restates(p.guardrails, rule), restatesJoint(p.guardrails, rule) - 0.15);
    if (score < 0.6) error('regulated', f, w, `guardrails do not restate the ${dom} rule (best overlap ${(score * 100).toFixed(0)}%)`);
  }
  if ((p.regulated_domains ?? []).length && !(p.escalates_when ?? []).some((e) => e.to === 'licensed_professional')) error('regulated', f, w, 'has regulated_domains but no escalates_when entry to licensed_professional');
  // voices
  const oa = p.voice?.openai;
  const xa = p.voice?.xai;
  if (oa?.voice) {
    refVocab(f, pathOf(x, '/voice/openai/voice'), w, oa.voice, voices.openaiTts, 'voice.openai.voice (openai_tts)');
    (oa.alternates ?? []).forEach((a, i) => refVocab(f, pathOf(x, `/voice/openai/alternates/${i}`), w, a, voices.openaiAny, `voice.openai.alternates[${i}]`));
    if ((oa.alternates ?? []).includes(oa.voice)) warn('voices', f, w, `voice.openai.alternates repeats the primary "${oa.voice}"`);
    const want = wantPresentation[p.pronouns];
    const got = presentation('openai', oa.voice);
    if (want && got !== 'unknown' && got !== want && got !== 'neutral') warn('voices', f, w, `OpenAI voice "${oa.voice}" is ${got} but pronouns are ${p.pronouns}`);
  }
  if (xa?.voice) {
    refVocab(f, pathOf(x, '/voice/xai/voice'), w, xa.voice, voices.xaiTts, 'voice.xai.voice (xai_tts)');
    (xa.alternates ?? []).forEach((a, i) => refVocab(f, pathOf(x, `/voice/xai/alternates/${i}`), w, a, voices.xaiTts, `voice.xai.alternates[${i}]`));
    if ((xa.alternates ?? []).includes(xa.voice)) warn('voices', f, w, `voice.xai.alternates repeats the primary "${xa.voice}"`);
    if (!XAI_CHARACTERIZED.has(xa.voice) && !(xa.alternates ?? []).some((a) => XAI_CHARACTERIZED.has(a))) error('voices', f, w, `xAI primary "${xa.voice}" is low-confidence; alternates must include one of ${[...XAI_CHARACTERIZED].join('/')}`);
    const want = wantPresentation[p.pronouns];
    const got = presentation('xai', xa.voice);
    if (want && got !== 'unknown' && got !== want && got !== 'neutral') warn('voices', f, w, `xAI voice "${xa.voice}" is ${got} but pronouns are ${p.pronouns}`);
  }
  if (oa?.voice && xa?.voice) {
    const k = `${oa.voice}+${xa.voice}`;
    if (!pairUse.has(k)) pairUse.set(k, []);
    pairUse.get(k).push(p);
  }
}
// quirk motifs and backstory openers (distinct on paper is not enough: a team of five meets in one room)
{
  const motifUse = new Map();
  for (const x of personas) for (const q of x.rec.personality?.quirks ?? []) for (const [motif, re] of Object.entries(QUIRK_MOTIFS)) if (re.test(q)) motifUse.set(motif, [...(motifUse.get(motif) ?? []), x.rec.id]);
  for (const [motif, ids] of motifUse) if (ids.length > 3) warn('motifs', 'personas/*', motif, `quirk motif "${motif}" is used by ${ids.length} coworkers (max 3): ${ids.join(', ')}`);
  const openerOf = (p) => {
    const first = String(p.backstory ?? '').split(/(?<=[.!?])\s/)[0];
    if (/\bgr(e|o)w(s|ing)? up\b|\braised\b|\bchildhood\b|\bas a (child|kid|teenager|girl|boy)\b/i.test(first)) return 'childhood first';
    const fn = firstName(p.name);
    return first.replaceAll(fn, 'NAME').replace(/\b(She|He|They)\b/g, 'PRONOUN').split(/\s+/).slice(0, 2).join(' ').replace(/[,.;:]/g, '');
  };
  const openers = new Map();
  for (const x of personas) {
    const k = openerOf(x.rec);
    openers.set(k, [...(openers.get(k) ?? []), x.rec.id]);
    if (LORE_MARKER.test(x.rec.backstory ?? '')) warn('motifs', x.file, where(x), 'backstory carries an in-text lore marker ("In her story…"); the AI badge and honesty_note already frame lore');
  }
  const cap = Math.floor(personas.length * 0.3);
  for (const [k, ids] of openers) if (ids.length > cap) warn('motifs', 'personas/*', `backstory opener "${k}"`, `${ids.length} of ${personas.length} backstories share this opener pattern (max 30% = ${cap})`);
}
for (const [k, list] of pairUse) {
  if (list.length > 6) warn('voices', 'personas/*', k, `voice pair used by ${list.length} personas (max 6): ${list.map((p) => p.id).join(', ')}`);
  const byDept = new Map();
  for (const p of list) byDept.set(p.department, [...(byDept.get(p.department) ?? []), p.id]);
  for (const [d, ids] of byDept) if (ids.length > 1) warn('voices', `personas/${d}.json`, k, `voice pair reused within the department: ${ids.join(', ')}`);
}
{
  const byDept = new Map();
  for (const x of personas) {
    const c = x.rec.avatar?.accent_color?.toLowerCase();
    if (!c) continue;
    const key = `${x.fileDept}|${c}`;
    if (byDept.has(key)) warn('portraits', x.file, where(x), `accent_color ${c} is also used by ${byDept.get(key)} in the same department`);
    else byDept.set(key, where(x));
  }
}

// ── skills ────────────────────────────────────────────────────────────────────
const primaryHolders = new Map(); // skill -> [persona]
const secondaryHolders = new Map();
for (const x of personas) {
  for (const s of x.rec.skills?.primary ?? []) primaryHolders.set(s, [...(primaryHolders.get(s) ?? []), x.rec.id]);
  for (const s of x.rec.skills?.secondary ?? []) secondaryHolders.set(s, [...(secondaryHolders.get(s) ?? []), x.rec.id]);
}
const BIZBOT_SKILLS = new Set(['research-and-cite', 'compare-options', 'fact-check', 'browse-and-extract', 'watch-a-page', 'write-a-report', 'weekly-review', 'summarise-documents', 'triage-documents', 'plan-a-project', 'code-change-with-tests', 'build-a-spreadsheet', 'build-a-slide-deck', 'build-a-web-page']);
const REVIEWER_WORDS = /licensed|attorney|counsel|lawyer|solicitor|\bCPA\b|\bEA\b|accountant|clinician|adviser|advisor|privacy professional|security professional|qualified (professional|security|HR|safety|food-safety)|HR professional|competent person|safety professional|broker/i;
const SMS_CONNECTORS = new Set(['twilio', 'whatsapp-business']);
const skillPath = (x, sub) => `/skills/${x.index}${sub}`;
for (const x of skills) {
  const s = x.rec;
  const f = x.file;
  const w = where(x);
  (s.tools ?? []).forEach((t, i) => {
    if (leadOnlyTools.has(t)) error('tools', f, w, `tools[${i}] "${t}" is lead-only`);
    else refVocab(f, skillPath(x, `/tools/${i}`), w, t, vocab.tools, `tools[${i}]`);
  });
  (s.connectors_optional ?? []).forEach((c, i) => refVocab(f, skillPath(x, `/connectors_optional/${i}`), w, c, vocab.connectors, `connectors_optional[${i}]`));
  (s.outputs ?? []).forEach((d, i) => refVocab(f, skillPath(x, `/outputs/${i}/artifact_type`), w, d.artifact_type, vocab.artifacts, `outputs[${i}].artifact_type`));
  (s.workflow ?? []).forEach((st, i) => {
    refVocab(f, skillPath(x, `/workflow/${i}/activity`), w, st.activity, vocab.activities, `workflow[${i}].activity`);
    for (const d of st.dependsOn ?? []) if (!(Number.isInteger(d) && d >= 0 && d < i)) error('workflow', f, w, `workflow[${i}].dependsOn ${d} must point to an earlier step${i ? ` (0..${i - 1})` : " (step 0 cannot depend on anything)"}`);
    if (st.activity === 'review' && !/APPROVED|CHANGES/.test(`${st.brief} ${st.acceptance}`)) warn('workflow', f, w, `workflow[${i}] is a review step whose brief/acceptance never mentions APPROVED or CHANGES`);
  });
  (s.pairs_with ?? []).forEach((id, i) => {
    refSkill(f, w, id, `pairs_with[${i}]`);
    if (id === s.id) error('refs', f, w, 'pairs_with lists the skill itself');
  });
  (s.typical_departments ?? []).forEach((d, i) => {
    if (!tax.departments.has(d)) error('refs', f, w, `typical_departments[${i}]: unknown department "${d}"${didYouMean(d, [...tax.departments.keys()])}`);
  });
  // approval tier must be at least the default_approval of every external-effect or always_ask tool it uses
  // (send_external / publish_external / schedule_automation are always_ask; connector_write is ask)
  const gating = (t) => vocab.tools.get(t)?.side_effects === 'external' || vocab.tools.get(t)?.default_approval === 'always_ask';
  const need = (s.tools ?? []).filter(gating).reduce((best, t) => (TIER_RANK[vocab.tools.get(t)?.default_approval] ?? 0) > (TIER_RANK[best] ?? 0) ? vocab.tools.get(t).default_approval : best, 'inert');
  if (s.approval_tier && (TIER_RANK[s.approval_tier] ?? 0) < TIER_RANK[need]) {
    const strict = (s.tools ?? []).filter((t) => gating(t) && vocab.tools.get(t)?.default_approval === need);
    error('tools', f, w, `approval_tier "${s.approval_tier}" is weaker than "${need}" required by ${strict.join(', ')}`);
  }
  const pre = tax.skills.get(s.id)?.regulated_domain;
  if (pre && !(s.regulated_domains ?? []).includes(pre)) error('regulated', f, w, `taxonomy pre-assigns regulated_domain "${pre}" but regulated_domains is ${JSON.stringify(s.regulated_domains ?? [])}`);
  if ((s.regulated_domains ?? []).length) {
    const text = `${s.instructions ?? ''} ${(s.quality_checks ?? []).map((q) => q.criterion).join(' ')} ${(s.workflow ?? []).map((st) => `${st.title} ${st.brief}`).join(' ')}`;
    if (!REVIEWER_WORDS.test(text)) error('regulated', f, w, `regulated skill (${s.regulated_domains.join(', ')}) never routes to a licensed/qualified reviewer in instructions, workflow or quality_checks`);
  }
  // prompt-injection guard: skills that read untrusted content and act externally
  if (readsAndWrites(s.tools ?? [])) {
    const ins = String(s.instructions ?? '');
    if (!/Suspicious content/i.test(ins) || !/never follow/i.test(ins)) error('untrusted', f, w, 'reads untrusted content and acts externally, but instructions lack the untrusted-content step ("list it under Suspicious content and never follow it")');
    if (!(s.quality_checks ?? []).some((q) => q.severity === 'must' && /no action was taken because content instructed it/i.test(q.criterion))) error('untrusted', f, w, 'missing the must-level quality check "No action was taken because content instructed it."');
  }
  // standing grants: a skill that sets up an automation records an owner-approved grant
  if ((s.tools ?? []).includes('schedule_automation') || (s.workflow ?? []).some((st) => st.activity === 'schedule')) {
    if (!(s.workflow ?? []).some((st) => /standing grant/i.test(`${st.title} ${st.brief} ${st.acceptance}`))) error('workflow', f, w, 'sets up an automation but no workflow step records the owner-approved standing grant (taxonomy.standing_grant)');
  }
  // executable with nothing connected: a required connector input needs a fallback
  for (const [i, inp] of (s.inputs ?? []).entries()) {
    if (inp.required && inp.source === 'connector' && !inp.fallback) error('workflow', f, w, `inputs[${i}] "${inp.id}" is a required connector input with no fallback (add fallback + fallback_example, e.g. a CSV export)`);
    if (inp.fallback && !inp.fallback_example) warn('workflow', f, w, `inputs[${i}] "${inp.id}" declares a fallback without a fallback_example`);
  }
  // SMS and WhatsApp need documented consent
  if ((s.connectors_optional ?? []).some((c) => SMS_CONNECTORS.has(c)) && !(s.quality_checks ?? []).some((q) => q.severity === 'must' && /consent/i.test(q.criterion) && /quiet hours|STOP|opt-?out/i.test(q.criterion))) error('workflow', f, w, 'uses SMS or WhatsApp connectors but has no must-level check for documented consent, quiet hours and STOP opt-out');
  if (BIZBOT_SKILLS.has(s.id) && s.biz_bot_name !== s.id) warn('refs', f, w, `biz-bot skill should carry biz_bot_name "${s.id}"`);
  if (s.biz_bot_name !== undefined && s.biz_bot_name !== s.id) error('refs', f, w, `biz_bot_name "${s.biz_bot_name}" must equal id`);
  if (s.biz_bot_name !== undefined && !BIZBOT_SKILLS.has(s.id)) error('refs', f, w, 'biz_bot_name is only for the 14 biz-bot catalog skills');
  if (!primaryHolders.has(s.id)) error('coverage', f, w, `no persona lists this skill as primary${secondaryHolders.has(s.id) ? ` (secondary: ${secondaryHolders.get(s.id).join(', ')})` : ''}`);
  if (typeof s.instructions === 'string') {
    const steps = s.instructions.split(/\s(?=\d+\.\s)/);
    const last = steps[steps.length - 1];
    if (!/verif|could not|couldn't|cannot|can't|unable|unknown|uncertain|gap|confirm|assum|missing|not (yet )?(be )?(check|test)/i.test(last)) warn('workflow', f, w, 'the last instruction step does not state what could not be verified');
  }
}

// ── leads ─────────────────────────────────────────────────────────────────────
for (const x of leads) {
  const l = x.rec;
  const f = x.file;
  const w = where(x);
  checkSliders(f, w, l.personality?.sliders);
  const wc = wordCount(l.backstory);
  if (l.backstory !== undefined && (wc < 300 || wc > 500)) error('backstory', f, w, `backstory has ${wc} words (leads: 300-500)`);
  for (const [i, m] of (l.origin_moments ?? []).entries()) if (!/\b(I|I'm|I've|I'd|my|me|we|we'd|we're|our|us)\b/i.test(m.story ?? '')) warn('backstory', f, w, `origin_moments[${i}] is not told in the first person`);
  (l.staffing_style?.favourite_persona_ids ?? []).forEach((id, i) => refPersona(f, w, id, `staffing_style.favourite_persona_ids[${i}]`));
  checkPortrait(f, w, l.avatar);
  const v = l.voice ?? {};
  if (v.openai_realtime) refVocab(f, '/voice/openai_realtime', w, v.openai_realtime, voices.openaiRealtime, 'voice.openai_realtime');
  if (v.openai_live) refVocab(f, '/voice/openai_live', w, v.openai_live, voices.openaiLive, 'voice.openai_live');
  if (v.xai_realtime) refVocab(f, '/voice/xai_realtime', w, v.xai_realtime, voices.xaiRealtime, 'voice.xai_realtime');
  if (v.openai_tts) refVocab(f, '/voice/openai_tts', w, v.openai_tts, voices.openaiTts, 'voice.openai_tts');
  if (v.xai_tts) refVocab(f, '/voice/xai_tts', w, v.xai_tts, voices.xaiTts, 'voice.xai_tts');
  // Playback should sound like the live voice: compare with openai_live when it is set (gpt-live-1), else openai_realtime.
  const liveOpenai = v.openai_live ?? v.openai_realtime;
  if (v.openai_tts && liveOpenai && v.openai_tts !== liveOpenai) warn('voices', f, w, `openai_tts "${v.openai_tts}" differs from ${v.openai_live ? 'openai_live' : 'openai_realtime'} "${liveOpenai}" (live and playback will sound different)`);
  if (v.xai_tts && v.xai_realtime && v.xai_tts !== v.xai_realtime) warn('voices', f, w, `xai_tts "${v.xai_tts}" differs from xai_realtime "${v.xai_realtime}"`);
  const want = wantPresentation[l.pronouns];
  for (const [prov, id] of [['openai', v.openai_realtime], ['xai', v.xai_realtime]]) {
    const got = id ? presentation(prov, id) : 'unknown';
    if (want && got !== 'unknown' && got !== 'neutral' && got !== want) warn('voices', f, w, `${prov} voice "${id}" is ${got} but pronouns are ${l.pronouns}`);
  }
  const fo = formation?.lead_style_overrides?.[l.id];
  if (fo && l.staffing_style) {
    if (fo.default_size && fo.default_size !== l.staffing_style.default_size) warn('formation', f, w, `staffing_style.default_size "${l.staffing_style.default_size}" differs from formation.lead_style_overrides "${fo.default_size}"`);
    const a = [...(fo.favourite_persona_ids ?? [])].sort().join();
    const b = [...(l.staffing_style.favourite_persona_ids ?? [])].sort().join();
    if (fo.favourite_persona_ids && a !== b) warn('formation', f, w, 'staffing_style.favourite_persona_ids differ from formation.lead_style_overrides');
    const ra = [...(fo.always_includes_roles ?? [])].sort().join();
    const rb = [...(l.staffing_style.always_includes_roles ?? [])].sort().join();
    if (fo.always_includes_roles && ra !== rb) warn('formation', f, w, `staffing_style.always_includes_roles [${rb}] differ from formation.lead_style_overrides [${ra}]`);
  }
  // Expressions are image edits on a landmarked portrait: brows, eyes and cheeks only (taxonomy.portrait_conventions.expression_palette_generation).
  for (const [state, text] of Object.entries(l.avatar?.expression_palette ?? {})) {
    const m = typeof text === 'string' ? text.match(/\b(head (tilts?|tilted|turns?|nods?|lowers?|lifts?)|(slight|small) (head )?tilt|tilts? (the |her |his |their )?head|chin (lowers?|lifts?|raised|lifted|down|up|tucks?))\b/i) : null;
    if (m && !negated(text, m.index)) warn('portraits', f, w, `expression_palette.${state} moves the head or chin ("${m[0]}"); keep the head pose identical so landmarks stay valid`);
  }
  // Honesty on turn 1 and in the exported rules (biz-bot principal.rules carries no guardrails).
  const turn1 = l.communication?.first_meeting ?? l.communication?.greeting ?? '';
  const claim = turn1.match(/\b(I've|I have) (looked|reviewed|checked|gone through|read)\b|\b(since|from) yesterday\b|\baccounted for\b|\bgood to see you again\b/i);
  if (claim) error('honesty', f, w, `${l.communication?.first_meeting ? 'communication.first_meeting' : 'communication.greeting'} claims prior work on turn 1 ("${claim[0]}")`);
  if (!l.communication?.first_meeting) warn('honesty', f, w, 'communication.first_meeting is missing (optional now, required at schema v2)');
  if (typeof l.rules === 'string') {
    if (!/\bAI\b/.test(l.rules) || !/sincerely asked/i.test(l.rules)) warn('honesty', f, w, 'rules do not carry the AI-disclosure sentence ("If sincerely asked, say plainly you are an AI…"); rules are the only behavioural field exported to biz-bot');
    if (!/ask before anything is (sent|posted)/i.test(l.rules) || !/\bpaid\b/.test(l.rules) || !/\bdeleted\b/.test(l.rules)) warn('honesty', f, w, 'rules do not carry the approval clause for sending, publishing, paying, signing, scheduling and deleting');
    if (!/owner's own rules override/i.test(l.rules)) warn('honesty', f, w, "rules do not end with the owner-override clause (\"The owner's own rules override these.\")");
  }
}

// ── recipes ───────────────────────────────────────────────────────────────────
// composition[].voice_override pins a member's voice in this team; composition[].why is owner-facing prose
const VOICE_NOTE = /\bvoices? here\b|\bteam voices?\b|\bgoes to [A-Z]|\((OpenAI|xAI)\)/;
function parseVoiceOverride(member) {
  const out = {};
  for (const prov of ['openai', 'xai']) if (typeof member?.voice_override?.[prov] === 'string') out[prov] = member.voice_override[prov];
  return { out, claims: [] };
}
// backtracking matching: earlier members keep earlier candidates when possible (formation.voice_assignment)
function resolveVoices(members, provider, fixed = new Map()) {
  const cands = members.map((id) => {
    if (fixed.has(id)) return [fixed.get(id)];
    const v = P.get(id)?.rec.voice?.[provider];
    return v ? [v.voice, ...(v.alternates ?? [])].filter((c, i, a) => c && a.indexOf(c) === i) : [];
  });
  const used = new Set();
  const pick = new Array(members.length);
  const go = (i) => {
    if (i === members.length) return true;
    for (const c of cands[i]) {
      if (used.has(c)) continue;
      used.add(c);
      pick[i] = c;
      if (go(i + 1)) return true;
      used.delete(c);
    }
    return false;
  };
  return go(0) ? Object.fromEntries(members.map((id, i) => [id, pick[i]])) : null;
}
const recipeVoices = new Map(); // recipe id -> {openai:{}, xai:{}, overrides:[]}
const personaInRecipes = new Map(); // persona -> Set(recipe)
const personaInComposition = new Map();
for (const x of recipes) {
  const r = x.rec;
  const f = x.file;
  const w = where(x);
  const comp = r.composition ?? [];
  const compIds = comp.map((c) => c.persona_id);
  const compSet = new Set(compIds);
  const roleOf = new Map(comp.map((c) => [c.persona_id, c.role]));
  const deptOf = (id) => P.get(id)?.rec.department;
  const swapIns = (r.variants_by_industry ?? []).flatMap((v) => v.swap_in ?? []);
  for (const id of new Set([...compIds, ...(r.lean_variant ?? []), ...(r.full_variant ?? []), ...swapIns])) personaInRecipes.set(id, new Set([...(personaInRecipes.get(id) ?? []), r.id]));
  for (const id of compIds) personaInComposition.set(id, new Set([...(personaInComposition.get(id) ?? []), r.id]));
  // members
  comp.forEach((c, i) => refPersona(f, w, c.persona_id, `composition[${i}]`));
  if (compSet.size !== compIds.length) error('recipes', f, w, `composition lists a persona twice: ${compIds.filter((id, i) => compIds.indexOf(id) !== i).join(', ')}`);
  const sceptics = comp.filter((c) => c.role === 'sceptic');
  if (sceptics.length !== 1) error('recipes', f, w, `composition must have exactly one sceptic, has ${sceptics.length}`);
  for (const s of sceptics) {
    const roles = P.get(s.persona_id)?.rec.team_roles;
    if (roles && !roles.includes('sceptic')) error('recipes', f, w, `sceptic "${s.persona_id}" does not list "sceptic" in team_roles (formation.roles.sceptic.must_have_team_role)`);
  }
  comp.forEach((c, i) => {
    const roles = P.get(c.persona_id)?.rec.team_roles;
    if (roles && c.role !== 'sceptic' && !roles.includes(c.role)) warn('recipes', f, w, `composition[${i}] ${c.persona_id} plays "${c.role}" which is not in their team_roles [${roles.join(', ')}]`);
  });
  const coordinator = r.coordinator_persona_id ?? comp.find((c) => c.role === 'lead')?.persona_id;
  if (!coordinator) error('recipes', f, w, 'no coordinator_persona_id and no member with role "lead"');
  else {
    if (!compSet.has(coordinator)) error('recipes', f, w, `coordinator "${coordinator}" is not in composition`);
    if (roleOf.get(coordinator) === 'sceptic') error('recipes', f, w, `coordinator "${coordinator}" is the sceptic`);
  }
  for (const id of r.lean_variant ?? []) {
    refPersona(f, w, id, 'lean_variant');
    if (!compSet.has(id)) error('recipes', f, w, `lean_variant member "${id}" is not in composition`);
  }
  for (const id of r.full_variant ?? []) refPersona(f, w, id, 'full_variant');
  for (const id of compIds) if (!(r.full_variant ?? []).includes(id)) error('recipes', f, w, `composition member "${id}" is missing from full_variant`);
  if ((r.lean_variant ?? []).length >= (formation?.roles?.sceptic?.required_when_team_size_at_least ?? 3) && !(r.lean_variant ?? []).some((id) => roleOf.get(id) === 'sceptic')) error('recipes', f, w, 'lean_variant has 3+ members but no sceptic (formation.roles.sceptic.required_when_team_size_at_least = 3)');
  if (coordinator && r.lean_variant && !r.lean_variant.includes(coordinator)) warn('recipes', f, w, `lean_variant drops the coordinator "${coordinator}"`);
  {
    const perDept = new Map();
    for (const id of compIds) perDept.set(deptOf(id), (perDept.get(deptOf(id)) ?? 0) + 1);
    const max = formation?.diversity?.max_same_department ?? 3;
    for (const [d, n] of perDept) if (d && n > max) warn('recipes', f, w, `${n} composition members from ${d} (max_same_department ${max})`);
  }
  // plan DAG
  const tasks = r.plan_skeleton ?? [];
  const taskIds = new Set();
  for (const t of tasks) {
    if (taskIds.has(t.id)) error('recipes', f, w, `plan task id "${t.id}" is duplicated`);
    taskIds.add(t.id);
  }
  for (const t of tasks) {
    const tw = `${w} › ${t.id}`;
    for (const d of t.depends_on ?? []) {
      if (d === t.id) error('recipes', f, tw, 'task depends on itself');
      else if (!taskIds.has(d)) error('recipes', f, tw, `depends_on unknown task "${d}"${didYouMean(d, [...taskIds])}`);
    }
    (t.skill_ids ?? []).forEach((sid, i) => refSkill(f, tw, sid, `skill_ids[${i}]`));
    refVocab(f, '', tw, t.activity, vocab.activities, 'activity');
    if (!compSet.has(t.owner_persona_id)) error('recipes', f, tw, `owner "${t.owner_persona_id}" is not in composition${personaExists(t.owner_persona_id) ? '' : didYouMean(t.owner_persona_id, compIds)}`);
    for (const rv of t.reviewer_persona_ids ?? []) {
      if (!compSet.has(rv)) error('recipes', f, tw, `reviewer "${rv}" is not in composition${didYouMean(rv, compIds)}`);
      if (rv === t.owner_persona_id) error('recipes', f, tw, `reviewer "${rv}" is also the owner`);
      else if (deptOf(rv) && deptOf(rv) === deptOf(t.owner_persona_id) && deptOf(rv) !== 'core-crew') {
        // same department is fine when the disciplines differ; flag only a reviewer who shares the owner's primary skills
        const own = new Set(P.get(t.owner_persona_id)?.rec.skills?.primary ?? []);
        const shared = (P.get(rv)?.rec.skills?.primary ?? []).filter((sid) => own.has(sid) || (t.skill_ids ?? []).includes(sid));
        if (shared.length) warn('recipes', f, tw, `reviewer "${rv}" shares the owner's discipline (${deptOf(rv)}; primary ${shared.join(', ')}); reviewers should come from another discipline`);
      }
    }
    if (/\b(coordinat|summari[sz])/i.test(t.title ?? '')) warn('recipes', f, tw, `task title "${t.title}" looks like a coordinate/summarise task (the coordinator assembles the final deliverable)`);
  }
  {
    // cycle detection (Kahn)
    const indeg = new Map(tasks.map((t) => [t.id, 0]));
    for (const t of tasks) for (const d of t.depends_on ?? []) if (taskIds.has(d) && d !== t.id) indeg.set(t.id, indeg.get(t.id) + 1);
    const queue = [...indeg].filter(([, n]) => n === 0).map(([id]) => id);
    let seen = 0;
    while (queue.length) {
      const id = queue.shift();
      seen++;
      for (const t of tasks) if ((t.depends_on ?? []).includes(id)) {
        indeg.set(t.id, indeg.get(t.id) - 1);
        if (indeg.get(t.id) === 0) queue.push(t.id);
      }
    }
    if (seen < indeg.size) error('recipes', f, w, `plan_skeleton has a dependency cycle among [${[...indeg].filter(([, n]) => n > 0).map(([id]) => id).join(', ')}]`);
  }
  if ((r.regulated_domains ?? []).length) {
    const hasLicensedTask = tasks.some((t) => t.activity === 'human' && /licensed review/i.test(t.title ?? ''));
    if (!hasLicensedTask) error('regulated', f, w, `has regulated_domains [${r.regulated_domains.join(', ')}] but no "human" task titled with "licensed review"`);
    for (const dom of r.regulated_domains) {
      if (!vocab.domains[dom]) continue;
      const must = formation?.regulated_domain_rules?.[dom]?.must_include_one_of;
      // the default team must staff the domain's specialist; full_variant never counts
      if (must && !must.some((id) => compSet.has(id))) error('regulated', f, w, `${dom}: composition has no member from formation must_include_one_of [${must.join(', ')}]`);
      // the lean team needs someone who carries the domain, plus the licensed-review task
      const lean = r.lean_variant ?? [];
      if (lean.length && !(lean.some((id) => (P.get(id)?.rec.regulated_domains ?? []).includes(dom) || (must ?? []).includes(id)) && hasLicensedTask)) warn('regulated', f, w, `${dom}: lean_variant [${lean.join(', ')}] has no member carrying this domain`);
    }
  }
  // model hints name real tasks
  for (const tid of Object.keys(r.model_hints?.by_task ?? {})) if (!taskIds.has(tid)) error('recipes', f, w, `model_hints.by_task names unknown task "${tid}"${didYouMean(tid, [...taskIds])}`);
  if (Number.isInteger(r.first_result_minutes) && r.duration_estimate?.active_minutes && r.first_result_minutes > r.duration_estimate.active_minutes) warn('recipes', f, w, `first_result_minutes ${r.first_result_minutes} exceeds active_minutes ${r.duration_estimate.active_minutes}`);
  // provider spread on the default team
  {
    const min = formation?.diversity?.min_distinct_primary_providers ?? {};
    const need = compIds.length >= 6 ? min.team_size_at_least_6 ?? 3 : compIds.length >= 3 ? min.team_size_at_least_3 ?? 2 : 1;
    const firsts = new Set(compIds.map((id) => P.get(id)?.rec.model_policy?.provider_preference?.[0]).filter(Boolean));
    if (firsts.size < need) error('providers', f, w, `composition of ${compIds.length} has ${firsts.size} distinct first-choice provider(s) [${[...firsts].join(', ')}], formation.diversity.min_distinct_primary_providers requires ${need}`);
  }
  // industry variants never orphan a task
  for (const [i, v] of (r.variants_by_industry ?? []).entries()) {
    const out = new Set(v.swap_out ?? []);
    const ins = v.swap_in ?? [];
    const adapted = new Set([...compIds.filter((id) => !out.has(id)), ...ins]);
    for (const [tid, pid] of Object.entries(v.reassign ?? {})) {
      if (!taskIds.has(tid)) error('variants', f, w, `variants_by_industry[${i}] (${v.industry}).reassign names unknown task "${tid}"`);
      if (!adapted.has(pid)) error('variants', f, w, `variants_by_industry[${i}] (${v.industry}).reassign gives "${tid}" to "${pid}", who is not on the adapted team`);
      if (out.has(pid)) error('variants', f, w, `variants_by_industry[${i}] (${v.industry}).reassign gives "${tid}" to a swapped-out member`);
    }
    if (out.has(coordinator) && !Object.keys(v.reassign ?? {}).length && !ins.length) error('variants', f, w, `variants_by_industry[${i}] (${v.industry}) swaps out the coordinator without a replacement`);
    for (const t of tasks) {
      if (!out.has(t.owner_persona_id)) continue;
      if (v.reassign?.[t.id]) continue;
      const covers = ins.find((pid) => {
        const pr = P.get(pid)?.rec;
        const all = new Set([...(pr?.skills?.primary ?? []), ...(pr?.skills?.secondary ?? [])]);
        return (t.skill_ids ?? []).every((sid) => all.has(sid));
      });
      if (!covers) error('variants', f, w, `variants_by_industry[${i}] (${v.industry}) swaps out "${t.owner_persona_id}", orphaning task "${t.id}" [${(t.skill_ids ?? []).join(', ')}]: no swap_in lists those skills; add reassign {"${t.id}": "<persona>"}`);
    }
    for (const t of tasks) for (const rv of t.reviewer_persona_ids ?? []) if (out.has(rv) && !ins.length) warn('variants', f, w, `variants_by_industry[${i}] (${v.industry}) swaps out reviewer "${rv}" of "${t.id}" with no swap_in`);
  }
  // meetings, variants, other refs
  for (const [i, m] of (r.meeting_moments ?? []).entries()) {
    if (!['kickoff', 'final'].includes(m.after) && !taskIds.has(m.after)) error('recipes', f, w, `meeting_moments[${i}].after "${m.after}" is not kickoff, final or a task id${didYouMean(m.after, [...taskIds, 'kickoff', 'final'])}`);
    for (const id of m.participants ?? []) {
      refPersona(f, w, id, `meeting_moments[${i}].participants`);
      if (personaExists(id) && !compSet.has(id) && !(r.full_variant ?? []).includes(id)) warn('recipes', f, w, `meeting_moments[${i}] participant "${id}" is not on the team`);
    }
  }
  for (const [i, v] of (r.variants_by_industry ?? []).entries()) {
    for (const id of v.swap_in ?? []) refPersona(f, w, id, `variants_by_industry[${i}].swap_in`);
    for (const id of v.swap_out ?? []) {
      refPersona(f, w, id, `variants_by_industry[${i}].swap_out`);
      if (personaExists(id) && !compSet.has(id) && !(r.full_variant ?? []).includes(id)) warn('recipes', f, w, `variants_by_industry[${i}].swap_out "${id}" is not on the team`);
      if (roleOf.get(id) === 'sceptic' && !(v.swap_in ?? []).some((s) => (P.get(s)?.rec.team_roles ?? []).includes('sceptic'))) warn('recipes', f, w, `variants_by_industry[${i}] swaps out the sceptic without swapping in a sceptic-capable persona`);
    }
    for (const id of v.extra_skill_ids ?? []) refSkill(f, w, id, `variants_by_industry[${i}].extra_skill_ids`);
  }
  (r.connectors_useful ?? []).forEach((c, i) => refVocab(f, `/recipes/${x.index}/connectors_useful/${i}`, w, c, vocab.connectors, `connectors_useful[${i}]`));
  (r.deliverables ?? []).forEach((d, i) => refVocab(f, `/recipes/${x.index}/deliverables/${i}/artifact_type`, w, d.artifact_type, vocab.artifacts, `deliverables[${i}].artifact_type`));
  // team voices with recorded per-member overrides
  const fixed = { openai: new Map(), xai: new Map() };
  const overrides = [];
  const parsed = comp.map((c) => parseVoiceOverride(c));
  comp.forEach((c) => {
    if (typeof c.why === 'string' && VOICE_NOTE.test(c.why)) error('team-voices', f, w, `${c.persona_id}: composition why carries an internal voice note ("${c.why.match(VOICE_NOTE)[0]}"); move it to voice_override`);
  });
  const effective = (pid, prov) => {
    const i = compIds.indexOf(pid);
    return (i >= 0 ? parsed[i].out[prov] : undefined) ?? P.get(pid)?.rec.voice?.[prov]?.voice;
  };
  for (const [ci, c] of comp.entries()) {
    const { out, claims } = parsed[ci];
    const pr = P.get(c.persona_id)?.rec;
    for (const prov of ['openai', 'xai']) {
      if (!out[prov]) continue;
      const vocabSet = prov === 'openai' ? voices.openaiAny : voices.xaiTts;
      if (!vocabSet.has(out[prov])) error('team-voices', f, w, `${c.persona_id}: recorded ${prov} voice "${out[prov]}" is not a ${prov === 'openai' ? 'OpenAI' : 'xAI TTS'} voice${didYouMean(out[prov], [...vocabSet])}`);
      const own = pr?.voice?.[prov];
      if (own && out[prov] !== own.voice && !(own.alternates ?? []).includes(out[prov])) warn('team-voices', f, w, `${c.persona_id}: recorded ${prov} voice "${out[prov]}" is not among their voice/alternates [${[own.voice, ...(own.alternates ?? [])].join(', ')}]`);
      const want = wantPresentation[pr?.pronouns];
      const got = presentation(prov, out[prov]);
      if (want && got !== 'unknown' && got !== 'neutral' && got !== want) warn('team-voices', f, w, `${c.persona_id}: recorded ${prov} voice "${out[prov]}" is ${got} but pronouns are ${pr.pronouns}`);
      fixed[prov].set(c.persona_id, out[prov]);
      overrides.push({ persona_id: c.persona_id, provider: prov, voice: out[prov] });
    }
    for (const cl of claims) {
      const target = comp.find((m) => fold(firstName(P.get(m.persona_id)?.rec.name)) === fold(cl.to));
      if (!target) warn('team-voices', f, w, `${c.persona_id}: note says "${cl.voice} goes to ${cl.to}" but no member is named ${cl.to}`);
      else {
        const eo = effective(target.persona_id, 'openai');
        const ex = effective(target.persona_id, 'xai');
        if (eo !== cl.voice && ex !== cl.voice) warn('team-voices', f, w, `${c.persona_id}: note says "${cl.voice} goes to ${cl.to}" but in this team ${cl.to} speaks with ${eo} + ${ex}`);
      }
    }
  }
  const assignment = { openai: {}, xai: {} };
  for (const prov of ['openai', 'xai']) {
    const eff = new Map();
    for (const id of compIds) {
      const v = fixed[prov].get(id) ?? P.get(id)?.rec.voice?.[prov]?.voice;
      if (!v) continue;
      if (eff.has(v)) {
        const alt = resolveVoices(compIds, prov, fixed[prov]);
        const hint = alt ? ` (a unique assignment exists: ${Object.entries(alt).filter(([pid, vv]) => (fixed[prov].get(pid) ?? P.get(pid)?.rec.voice?.[prov]?.voice) !== vv).map(([pid, vv]) => `${pid} -> ${vv}`).join(', ')})` : ' (no unique assignment exists even with alternates)';
        error('team-voices', f, w, `${prov} voice "${v}" is used by both ${eff.get(v)} and ${id} in the composition${hint}`);
      } else eff.set(v, id);
      assignment[prov][id] = v;
    }
    const full = r.full_variant ?? [];
    if (full.length) {
      const res = resolveVoices([...compIds, ...full.filter((id) => !compSet.has(id))], prov, new Map(Object.entries(assignment[prov])));
      if (!res) {
        const allMembers = [...new Set([...compIds, ...full])];
        const cap = formation?.voice_capacity?.[prov === 'openai' ? 'openai_tts' : 'xai_tts'] ?? {};
        const over = Object.entries(wantPresentation).map(([pron, pres]) => [pron, pres, allMembers.filter((id) => P.get(id)?.rec.pronouns === pron).length]).filter(([, pres, n]) => cap[pres] !== undefined && n > cap[pres]);
        const why = over.length ? `: ${over.map(([pron, pres, n]) => `${n} ${pron} members but only ${cap[pres]} ${pres} ${prov} voices`).join('; ')} (formation.voice_capacity: split the meeting or play back on the other provider)` : ' even with alternates';
        warn('team-voices', f, w, `full_variant cannot get unique ${prov} voices${why}`);
      }
      else for (const [id, v] of Object.entries(res)) if (!(id in assignment[prov])) assignment[prov][id] = v;
    }
  }
  recipeVoices.set(r.id, { ...assignment, overrides });
}

// ── formation.json ────────────────────────────────────────────────────────────
if (formation) {
  const F = 'formation.json';
  const personaRef = (id, label) => {
    if (typeof id !== 'string') return;
    if (!personaExists(id)) error('formation', F, label, `unknown persona "${id}"${didYouMean(id, personaIds)}`);
  };
  const ro = formation.roles ?? {};
  personaRef(ro.sceptic?.default_persona_id, 'roles.sceptic.default_persona_id');
  if (ro.sceptic?.default_persona_id && !(P.get(ro.sceptic.default_persona_id)?.rec.team_roles ?? []).includes('sceptic')) error('formation', F, 'roles.sceptic.default_persona_id', 'default sceptic cannot play the sceptic role');
  personaRef(ro.facilitator?.default_persona_id, 'roles.facilitator.default_persona_id');
  (ro.facilitator?.alternatives ?? []).forEach((id, i) => personaRef(id, `roles.facilitator.alternatives[${i}]`));
  (ro.coordinator?.fallback_persona_ids ?? []).forEach((id, i) => personaRef(id, `roles.coordinator.fallback_persona_ids[${i}]`));
  personaRef(formation.sceptic_selection?.default_persona_id, 'sceptic_selection.default_persona_id');
  for (const [disc, ids] of Object.entries(formation.sceptic_selection?.by_discipline ?? {})) for (const id of ids) {
    personaRef(id, `sceptic_selection.by_discipline.${disc}`);
    if (personaExists(id) && !(P.get(id).rec.team_roles ?? []).includes('sceptic')) warn('formation', F, `sceptic_selection.by_discipline.${disc}`, `"${id}" does not list "sceptic" in team_roles`);
  }
  (formation.core_crew_triggers ?? []).forEach((t, i) => personaRef(t.add, `core_crew_triggers[${i}].add`));
  for (const [ind, id] of Object.entries(formation.industry_specialists ?? {})) {
    if (!vocab.industries.has(ind)) error('formation', F, `industry_specialists.${ind}`, 'unknown industry');
    if (id !== null) personaRef(id, `industry_specialists.${ind}`);
  }
  for (const [dep, id] of Object.entries(formation.gap_filling?.department_generalists ?? {})) {
    if (!tax.departments.has(dep)) error('formation', F, `gap_filling.department_generalists.${dep}`, 'unknown department');
    if (typeof id === 'string' && /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) personaRef(id, `gap_filling.department_generalists.${dep}`);
  }
  for (const dom of Object.keys(vocab.domains)) if (!formation.regulated_domain_rules?.[dom]) error('formation', F, 'regulated_domain_rules', `missing a rule for regulated domain "${dom}"`);
  for (const [dom, rule] of Object.entries(formation.regulated_domain_rules ?? {})) {
    if (!vocab.domains[dom]) error('formation', F, `regulated_domain_rules.${dom}`, 'unknown regulated domain');
    (rule.must_include_one_of ?? []).forEach((id, i) => personaRef(id, `regulated_domain_rules.${dom}.must_include_one_of[${i}]`));
  }
  for (const [lid, o] of Object.entries(formation.lead_style_overrides ?? {})) {
    if (!L.has(lid) && !tax.leads.has(lid)) error('formation', F, `lead_style_overrides.${lid}`, 'unknown lead');
    (o.favourite_persona_ids ?? []).forEach((id, i) => personaRef(id, `lead_style_overrides.${lid}.favourite_persona_ids[${i}]`));
  }
  for (const [dom, rule] of Object.entries(formation.regulated_domain_rules ?? {})) {
    const iod = rule.add_task?.informed_owner_decision;
    if (vocab.domains[dom] && (!iod || !(iod.review_always_required_for ?? []).length)) error('formation', F, `regulated_domain_rules.${dom}.add_task`, 'needs informed_owner_decision with a non-empty review_always_required_for list');
  }
  if (formation.first_session_recipe && !R.has(formation.first_session_recipe)) error('formation', F, 'first_session_recipe', `unknown recipe "${formation.first_session_recipe}"`);
  if (formation.starter_recipes_by_industry) {
    for (const ind of vocab.industries) if (!formation.starter_recipes_by_industry[ind]) error('formation', F, 'starter_recipes_by_industry', `no starter recipes for industry "${ind}"`);
    for (const [ind, ids] of Object.entries(formation.starter_recipes_by_industry)) {
      if (!vocab.industries.has(ind)) error('formation', F, `starter_recipes_by_industry.${ind}`, 'unknown industry');
      if (!Array.isArray(ids) || ids.length !== 3) error('formation', F, `starter_recipes_by_industry.${ind}`, 'must list exactly 3 recipes');
      for (const rid of ids ?? []) if (!R.has(rid)) error('formation', F, `starter_recipes_by_industry.${ind}`, `unknown recipe "${rid}"${didYouMean(rid, [...R.keys()])}`);
    }
  } else warn('formation', F, 'starter_recipes_by_industry', 'missing: the lead has no day-one recipes to offer per industry');
  for (const rid of Object.keys(formation.recipe_intents ?? {})) if (!R.has(rid) && !tax.recipes.has(rid)) error('formation', F, `recipe_intents.${rid}`, `unknown recipe${didYouMean(rid, [...R.keys()])}`);
  for (const rid of R.keys()) if (formation.recipe_intents && !formation.recipe_intents[rid]) warn('formation', F, 'recipe_intents', `no intents for recipe "${rid}"`);
}

// ── expressions (cross refs; the rest lives in validate-expressions.mjs) ─────
for (const file of expressionFiles) {
  const v = loaded.get(file);
  if (!v) continue;
  for (const [i, pack] of (v.packs ?? []).entries()) if (pack.persona_id && !personaExists(pack.persona_id) && !L.has(pack.persona_id)) error('refs', file, `packs[${i}]`, `unknown persona/lead "${pack.persona_id}"`);
  for (const lid of Object.keys(v.lead_blends ?? {})) if (!L.has(lid)) error('refs', file, `lead_blends.${lid}`, 'unknown lead');
}

// ── match quiz (§8) ───────────────────────────────────────────────────────────
if (quiz === undefined) warn('quiz', 'leads/match-quiz.json', '(file)', 'missing: the "find your lead" quiz (SCHEMA §8) has not been written yet');
else {
  const F = 'leads/match-quiz.json';
  const qs = quiz.questions ?? [];
  if (qs.length < 5 || qs.length > 8) error('quiz', F, 'questions', `has ${qs.length} questions, expected 5-8`);
  const leadIds = new Set(L.keys());
  const checkWeights = (wts, label) => {
    for (const [k, n] of Object.entries(wts ?? {})) {
      if (!leadIds.has(k)) error('quiz', F, label, `weight key "${k}" is not a lead id${didYouMean(k, [...leadIds])}`);
      if (!(Number.isInteger(n) && n >= -3 && n <= 3)) error('quiz', F, label, `weight ${k}=${n} must be an integer -3..3`);
    }
  };
  const choiceSets = [];
  for (const [i, q] of qs.entries()) {
    if (!['single', 'multi', 'scale'].includes(q.kind)) error('quiz', F, `questions[${i}]`, `kind "${q.kind}" must be single, multi or scale`);
    if (q.kind === 'scale') {
      checkWeights(q.scale?.weights_low, `questions[${i}].scale.weights_low`);
      checkWeights(q.scale?.weights_high, `questions[${i}].scale.weights_high`);
      choiceSets.push([q.scale?.weights_low ?? {}, {}, q.scale?.weights_high ?? {}]);
    } else {
      (q.options ?? []).forEach((o, j) => checkWeights(o.weights, `questions[${i}].options[${j}]`));
      choiceSets.push((q.options ?? []).map((o) => o.weights ?? {}));
    }
    if (/\b(gender|ethnic\w*|race|races|age|ages|aged|how old|heritage|pronouns?|nationality|religion)\b/i.test(q.prompt ?? '')) error('quiz', F, `questions[${i}]`, 'questions must not ask about gender, ethnicity or age');
    if (/\b(voice|pitch|accent)\b/i.test(q.prompt ?? '')) error('quiz', F, `questions[${i}]`, 'questions must not use voice pitch or accent as a stand-in for people fields (the picker filters by voice separately)');
  }
  for (const lid of leadIds) if (!quiz.results?.[lid]) error('quiz', F, 'results', `no result for ${lid}`);
  for (const k of Object.keys(quiz.results ?? {})) if (!leadIds.has(k)) error('quiz', F, `results.${k}`, `result key is not a lead id${didYouMean(k, [...leadIds])}`);
  // shape and §8 text limits
  const len = (s) => (typeof s === 'string' ? strLen(s) : -1);
  const limit = (s, max, where, what) => {
    if (len(s) < 1) error('quiz', F, where, `${what} is missing`);
    else if (len(s) > max) error('quiz', F, where, `${what} has ${len(s)} chars (max ${max})`);
  };
  limit(quiz.intro, 300, 'intro', 'intro');
  const qids = new Set();
  for (const [i, q] of qs.entries()) {
    const at = `questions[${i}]`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(q.id ?? '')) error('quiz', F, at, `id "${q.id}" must be kebab-case`);
    if (qids.has(q.id)) error('quiz', F, at, `duplicate question id "${q.id}"`);
    qids.add(q.id);
    limit(q.prompt, 160, at, 'prompt');
    if (q.kind === 'scale') {
      const s = q.scale ?? {};
      if (q.options) error('quiz', F, at, 'a scale question uses scale, not options');
      if (!(Number.isInteger(s.min) && Number.isInteger(s.max) && s.min < s.max)) error('quiz', F, at, 'scale needs integer min < max');
      limit(s.low_label, 80, `${at}.scale`, 'low_label');
      limit(s.high_label, 80, `${at}.scale`, 'high_label');
    } else {
      const opts = q.options ?? [];
      if (q.scale) error('quiz', F, at, `a ${q.kind} question uses options, not scale`);
      if (opts.length < 2) error('quiz', F, at, 'needs at least two options');
      const oids = new Set();
      for (const [j, o] of opts.entries()) {
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(o.id ?? '')) error('quiz', F, `${at}.options[${j}]`, `id "${o.id}" must be kebab-case`);
        if (oids.has(o.id)) error('quiz', F, `${at}.options[${j}]`, `duplicate option id "${o.id}"`);
        oids.add(o.id);
        limit(o.label, 80, `${at}.options[${j}]`, 'label');
        if (!Object.keys(o.weights ?? {}).length) warn('quiz', F, `${at}.options[${j}]`, `option "${o.id}" gives no lead any points`);
      }
      if (q.kind === 'multi' && q.max_picks !== undefined && !(Number.isInteger(q.max_picks) && q.max_picks >= 1 && q.max_picks <= opts.length)) error('quiz', F, at, `max_picks ${q.max_picks} must be an integer 1..${opts.length}`);
    }
  }
  for (const [k, r] of Object.entries(quiz.results ?? {})) {
    limit(r?.headline, 80, `results.${k}`, 'headline');
    limit(r?.why_you_match, 240, `results.${k}`, 'why_you_match');
  }
  const sc = quiz.scoring ?? {};
  if (sc.method !== 'weighted_sum') error('quiz', F, 'scoring', `method "${sc.method}" must be weighted_sum`);
  if (!(Number.isInteger(sc.show_top) && sc.show_top >= 1 && sc.show_top <= 5)) error('quiz', F, 'scoring', 'show_top must be an integer 1-5');
  if (sc.why_template !== undefined && !String(sc.why_template).includes('{why_you_match}')) warn('quiz', F, 'scoring', 'why_template does not include {why_you_match}');
  if (quiz.try_before_choosing?.voice_preview_line !== undefined) limit(quiz.try_before_choosing.voice_preview_line, 160, 'try_before_choosing', 'voice_preview_line');
  if (!quiz.fallback) warn('quiz', F, '(file)', 'no fallback (what to show when the quiz is skipped or gives a weak signal)');
  // reachability: can each lead be the unique top scorer? (bounded search, single choice per question)
  const reachable = new Set();
  const total = choiceSets.reduce((n, c) => n * Math.max(1, c.length), 1);
  if (total <= 2e6) {
    const scores = new Map([...leadIds].map((l) => [l, 0]));
    const walk = (qi) => {
      if (qi === choiceSets.length) {
        let best = -Infinity;
        let who = [];
        for (const [l, s] of scores) if (s > best) (best = s), (who = [l]);
        else if (s === best) who.push(l);
        if (who.length === 1) reachable.add(who[0]);
        return;
      }
      for (const wts of choiceSets[qi].length ? choiceSets[qi] : [{}]) {
        for (const [l, n] of Object.entries(wts)) if (scores.has(l)) scores.set(l, scores.get(l) + n);
        walk(qi + 1);
        for (const [l, n] of Object.entries(wts)) if (scores.has(l)) scores.set(l, scores.get(l) - n);
      }
    };
    walk(0);
    for (const lid of leadIds) if (!reachable.has(lid)) error('quiz', F, 'reachability', `${lid} is never the unique top result for any answer combination`);
  }
}

// ── stats + index ─────────────────────────────────────────────────────────────
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const countBy = (arr, fn) => {
  const m = {};
  for (const a of arr) {
    const k = fn(a);
    if (k === undefined || k === null) continue;
    m[k] = (m[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
};
const ageBucket = (range) => {
  const lo = Number(String(range).split('-')[0]);
  if (!Number.isFinite(lo)) return undefined;
  if (lo < 30) return '24-29';
  if (lo < 40) return '30-39';
  if (lo < 50) return '40-49';
  if (lo < 60) return '50-59';
  return '60-72';
};
const AGE_ORDER = ['24-29', '30-39', '40-49', '50-59', '60-72'];
const ordered = (obj, order) => Object.fromEntries(order.filter((k) => k in obj).map((k) => [k, obj[k]]));
const P_recs = personas.map((x) => x.rec);
const L_recs = leads.map((x) => x.rec);
const people = [...P_recs, ...L_recs];
const sliderStats = (recs) => Object.fromEntries(SLIDERS.map((k) => {
  const vals = recs.map((r) => r.personality?.sliders?.[k]).filter((v) => Number.isFinite(v));
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length));
  return [k, { mean: Math.round(mean * 10) / 10, sd: Math.round(sd * 10) / 10, min: Math.min(...vals), max: Math.max(...vals) }];
}));
const skillsUnused = skills.map((x) => x.rec.id).filter((id) => !primaryHolders.has(id) && !secondaryHolders.has(id));
const skillsSecondaryOnly = skills.map((x) => x.rec.id).filter((id) => !primaryHolders.has(id) && secondaryHolders.has(id));
const personasNoRecipe = P_recs.map((p) => p.id).filter((id) => !personaInRecipes.has(id));
const personasNoComposition = P_recs.map((p) => p.id).filter((id) => !personaInComposition.has(id));
for (const id of personasNoRecipe) warn('coverage', P.get(id).file, id, 'persona appears in no team recipe (composition, variants or industry swap-in)');
const openaiUse = countBy(P_recs, (p) => p.voice?.openai?.voice);
const xaiUse = countBy(P_recs, (p) => p.voice?.xai?.voice);
const diversity_stats = {
  pronouns: {
    coworkers: countBy(P_recs, (p) => p.pronouns),
    leads: countBy(L_recs, (l) => l.pronouns),
    all: countBy(people, (p) => p.pronouns),
    all_percent: Object.fromEntries(Object.entries(countBy(people, (p) => p.pronouns)).map(([k, n]) => [k, pct(n, people.length)])),
  },
  age_buckets: {
    coworkers: ordered(countBy(P_recs, (p) => ageBucket(p.age_range)), AGE_ORDER),
    leads: ordered(countBy(L_recs, (l) => ageBucket(l.age_range)), AGE_ORDER),
    all: ordered(countBy(people, (p) => ageBucket(p.age_range)), AGE_ORDER),
  },
  seniority_coworkers: countBy(P_recs, (p) => p.seniority),
  distinct_heritages: new Set(people.map((p) => p.heritage).filter(Boolean)).size,
  voices: {
    coworker_openai_primary: openaiUse,
    coworker_xai_primary: xaiUse,
    distinct_openai_primary: Object.keys(openaiUse).length,
    distinct_xai_primary: Object.keys(xaiUse).length,
    openai_tts_unused_as_primary: [...voices.openaiTts].filter((v) => !(v in openaiUse)),
    xai_tts_unused_as_primary: [...voices.xaiTts].filter((v) => !(v in xaiUse)),
    max_pair_reuse: Math.max(0, ...[...pairUse.values()].map((l) => l.length)),
    distinct_pairs: pairUse.size,
    lead_openai_realtime: countBy(L_recs, (l) => l.voice?.openai_realtime),
    lead_xai_realtime: countBy(L_recs, (l) => l.voice?.xai_realtime),
    recipes_with_recorded_overrides: [...recipeVoices.values()].filter((v) => v.overrides.length).length,
    recorded_overrides: [...recipeVoices.values()].reduce((n, v) => n + v.overrides.length, 0),
  },
  representation: (() => {
    // pronoun x age band x seniority x look cross-tabs, from the fixed taxonomy people fields
    const LOOKS = {
      dyed_or_bleached_hair: /\b(dyed|bleached|platinum|pastel|purple|teal|pink|blue|green)[- ](hair|buzz|tips|streak|curls|bob)|\bbleached\b|\bdyed\b/i,
      piercing: /\b(nose ring|septum|ear cuffs?|hoop|piercing|stud|nose stud)\b/i,
      tattoo: /\btattoo|\bmoko\b/i,
      glasses: /\bglasses|spectacles\b/i,
      gray_or_white_hair: /\b(gray|grey|silver|white)(-streaked|-flecked)?\b/i,
      head_covering: /\b(hijab|turban|headscarf|headwrap|kufi|patka|cap|beanie|scarf)\b/i,
      facial_hair: /\bbeard|moustache|mustache|goatee|stubble\b/i,
      hearing_aid: /\bhearing aid\b/i,
      mobility_aid: /\bwheelchair|crutch|cane\b/i,
    };
    const all = [...tax.personas.values()];
    const out = {};
    for (const pron of ['she/her', 'he/him', 'they/them']) {
      const g = all.filter((p) => p.pronouns === pron);
      const n = g.length || 1;
      out[pron] = {
        count: g.length,
        age_bands: ordered(countBy(g, (p) => ageBucket(p.age_range)), AGE_ORDER),
        under_30_percent: pct(g.filter((p) => Number(String(p.age_range).split('-')[0]) < 30).length, n),
        aged_45_plus_percent: pct(g.filter((p) => Number(String(p.age_range).split('-')[0]) >= 45).length, n),
        seniority: countBy(g, (p) => p.seniority),
        lead_or_principal_percent: pct(g.filter((p) => ['lead', 'principal'].includes(p.seniority)).length, n),
        looks_percent: Object.fromEntries(Object.entries(LOOKS).map(([k, re]) => [k, pct(g.filter((p) => re.test(p.look_hint ?? '')).length, n)])),
      };
    }
    return out;
  })(),
  quirk_motifs: Object.fromEntries(Object.entries(QUIRK_MOTIFS).map(([k, re]) => [k, P_recs.filter((p) => (p.personality?.quirks ?? []).some((q) => re.test(q))).length])),
  coworkers_with_been_there: P_recs.filter((p) => (p.been_there ?? []).length).length,
  xai_voices_unconfirmed: Object.values(V.xai_tts?.voices ?? {}).filter((v) => v.presentation_confirmed !== true).length,
  personas_per_department: Object.fromEntries([...tax.departments.keys()].map((d) => [d, P_recs.filter((p) => p.department === d).length])),
  skills_per_category: Object.fromEntries([...tax.categories.keys()].map((c) => [c, skills.filter((x) => x.rec.category === c).length])),
  personas_per_industry: countBy(P_recs.flatMap((p) => p.industries ?? []), (i) => i),
  model_tiers: countBy(P_recs, (p) => p.model_policy?.tier),
  first_provider_preference: countBy(P_recs, (p) => p.model_policy?.provider_preference?.[0] ?? 'none'),
  sliders_coworkers: sliderStats(P_recs),
  sliders_leads: sliderStats(L_recs),
  team_roles_offered: countBy(P_recs.flatMap((p) => p.team_roles ?? []), (r) => r),
  sceptic_capable_personas: P_recs.filter((p) => (p.team_roles ?? []).includes('sceptic')).length,
  recipe_sceptics: countBy(recipes.map((x) => x.rec.composition?.find((c) => c.role === 'sceptic')?.persona_id), (id) => id),
  recipe_composition_sizes: countBy(recipes, (x) => String(x.rec.composition?.length ?? 0)),
  regulated_personas: P_recs.filter((p) => (p.regulated_domains ?? []).length).length,
  regulated_skills: skills.filter((x) => (x.rec.regulated_domains ?? []).length).length,
  regulated_recipes: recipes.filter((x) => (x.rec.regulated_domains ?? []).length).length,
  skills_never_used_by_any_persona: skillsUnused,
  skills_secondary_only: skillsSecondaryOnly,
  personas_in_no_recipe: personasNoRecipe,
  personas_in_no_composition: personasNoComposition,
  persona_recipe_appearances_top: Object.fromEntries([...personaInRecipes].map(([id, s]) => [id, s.size]).sort((a, b) => b[1] - a[1]).slice(0, 10)),
};

if (taxonomy.stats?.distinct_heritages !== undefined && taxonomy.stats.distinct_heritages !== diversity_stats.distinct_heritages) warn('taxonomy', 'taxonomy.json', 'stats.distinct_heritages', `${taxonomy.stats.distinct_heritages} but the catalog has ${diversity_stats.distinct_heritages} (coworkers and leads)`);
const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warning');
const fmt = (i) => `${i.file}${i.where ? ` › ${i.where}` : ''}: ${i.msg}`;
const counts = {
  departments: tax.departments.size,
  personas: personas.length,
  skill_categories: new Set(skills.map((x) => x.fileCat)).size,
  skills: skills.length,
  leads: leads.length,
  team_groups: new Set(recipes.map((x) => x.fileGroup)).size,
  recipes: recipes.length,
  expression_files: expressionFiles.length,
};
const index = {
  generated_by: 'catalog/scripts/validate.mjs',
  generated_at: new Date().toISOString(),
  catalog_version: taxonomy.catalog_version ?? '0.0.0',
  note: 'GENERATED by catalog/scripts/validate.mjs. Do not edit by hand.',
  counts,
  baseline_tools: [...BASELINE],
  first_session_recipe: formation?.first_session_recipe ?? null,
  starter_recipes_by_industry: formation?.starter_recipes_by_industry ?? {},
  departments: [...tax.departments.values()].map((d) => ({ id: d.id, name: d.name, icon: d.icon, persona_ids: personas.filter((x) => x.fileDept === d.id).map((x) => x.rec.id) })),
  skill_categories: [...tax.categories.values()].map((c) => ({ id: c.id, name: c.name, icon: c.icon, skill_ids: skills.filter((x) => x.fileCat === c.id).map((x) => x.rec.id) })),
  leads: L_recs.map((l) => ({ id: l.id, handle: l.handle, name: l.name, pronouns: l.pronouns, archetype: l.archetype, tagline: l.tagline, voice: { openai_realtime: l.voice?.openai_realtime, xai_realtime: l.voice?.xai_realtime }, accent_color: l.avatar?.accent_color })),
  team_groups: [...tax.groups.values()].map((g) => ({ id: g.id, name: g.name, icon: g.icon, recipe_ids: recipes.filter((x) => x.fileGroup === g.id).map((x) => x.rec.id) })),
  personas: P_recs.map((p) => ({
    id: p.id, handle: p.handle, name: p.name, pronouns: p.pronouns, department: p.department, title: p.title, seniority: p.seniority, one_liner: p.one_liner,
    team_roles: p.team_roles ?? [], skills_primary: p.skills?.primary ?? [], skills_secondary: p.skills?.secondary ?? [], tools: p.tools ?? [], connectors: p.connectors ?? [],
    industries: p.industries ?? [], regulated_domains: p.regulated_domains ?? [], model_tier: p.model_policy?.tier,
    voice: { openai: p.voice?.openai?.voice, xai: p.voice?.xai?.voice }, accent_color: p.avatar?.accent_color, portrait_asset_id: null,
  })),
  skills: skills.map(({ rec: s }) => ({ id: s.id, name: s.name, icon: s.icon, category: s.category, one_liner: s.one_liner ?? tax.skills.get(s.id)?.one_liner, tools: s.tools ?? [], approval_tier: s.approval_tier, cost_class: s.effort?.cost_class, regulated_domains: s.regulated_domains ?? [] })),
  recipes: recipes.map(({ rec: r }) => ({
    id: r.id, group: r.group, name: r.name, icon: r.icon, outcome: r.outcome, cost_class: r.cost_class, first_result_minutes: r.first_result_minutes,
    coordinator: r.coordinator_persona_id ?? r.composition?.find((c) => c.role === 'lead')?.persona_id,
    sceptic: r.composition?.find((c) => c.role === 'sceptic')?.persona_id,
    composition: (r.composition ?? []).map((c) => ({ persona_id: c.persona_id, role: c.role })),
    lean_variant: r.lean_variant ?? [], full_variant: r.full_variant ?? [],
    regulated_domains: r.regulated_domains ?? [],
    voice_assignment: recipeVoices.get(r.id) ? { openai: recipeVoices.get(r.id).openai, xai: recipeVoices.get(r.id).xai } : null,
  })),
  lookup: {
    handle_to_id: Object.fromEntries(people.filter((p) => p.handle).map((p) => [p.handle, p.id])),
    first_name_to_id: Object.fromEntries(people.filter((p) => p.name).map((p) => [firstName(p.name), p.id])),
    skill_to_personas: Object.fromEntries(skills.map(({ rec: s }) => [s.id, { primary: primaryHolders.get(s.id) ?? [], secondary: secondaryHolders.get(s.id) ?? [] }])),
    tool_to_skills: Object.fromEntries([...vocab.tools.keys()].map((t) => [t, skills.filter((x) => (x.rec.tools ?? []).includes(t)).map((x) => x.rec.id)]).filter(([, l]) => l.length)),
    industry_to_recipes: Object.fromEntries([...vocab.industries].map((ind) => [ind, recipes.filter((x) => ind === 'general' || (x.rec.variants_by_industry ?? []).some((v) => v.industry === ind)).map((x) => x.rec.id)])),
    department_to_personas: Object.fromEntries([...tax.departments.keys()].map((d) => [d, personas.filter((x) => x.fileDept === d).map((x) => x.rec.id)])),
    persona_to_recipes: Object.fromEntries([...personaInRecipes].map(([id, s]) => [id, [...s]])),
  },
  diversity_stats,
  checks: { passed: errors.length === 0, errors: errors.map(fmt), warnings: warnings.map(fmt) },
};

// ── report ────────────────────────────────────────────────────────────────────
const out = [];
out.push(`Catalog validation: ${CATALOG}`);
out.push(`Loaded ${personaFiles.length} department files (${counts.personas} personas), ${skillFiles.length} category files (${counts.skills} skills), ${counts.leads} leads, ${teamFiles.length} team groups (${counts.recipes} recipes), formation, taxonomy, ${expressionFiles.length} expression files${quiz ? ', match quiz' : ''}.`);
out.push('');
const width = Math.max(...CHECKS.map((c) => c.length)) + 2;
for (const c of CHECKS) {
  const e = errors.filter((i) => i.check === c);
  const wv = warnings.filter((i) => i.check === c);
  const status = e.length ? 'FAIL' : wv.length ? 'warn' : 'ok  ';
  if (QUIET && !e.length) continue;
  out.push(`${status}  ${c.padEnd(width, '.')} ${e.length} error(s), ${wv.length} warning(s)`);
  for (const i of e) out.push(`        x ${fmt(i)}`);
  if (!QUIET) {
    for (const i of wv.slice(0, WARN_SHOWN)) out.push(`        ~ ${fmt(i)}`);
    if (wv.length > WARN_SHOWN) out.push(`        ~ ... ${wv.length - WARN_SHOWN} more warning(s) (--verbose)`);
  }
}
if (SHOW_STATS) {
  const d = diversity_stats;
  out.push('', 'Diversity & coverage');
  out.push(`  pronouns (all ${people.length}): ${Object.entries(d.pronouns.all).map(([k, n]) => `${k} ${n} (${d.pronouns.all_percent[k]}%)`).join(', ')}`);
  out.push(`  age buckets (all): ${Object.entries(d.age_buckets.all).map(([k, n]) => `${k}: ${n}`).join(', ')}`);
  out.push(`  seniority: ${Object.entries(d.seniority_coworkers).map(([k, n]) => `${k} ${n}`).join(', ')}; distinct heritages: ${d.distinct_heritages}`);
  out.push(`  OpenAI primaries (${d.voices.distinct_openai_primary} distinct): ${Object.entries(d.voices.coworker_openai_primary).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  out.push(`  xAI primaries (${d.voices.distinct_xai_primary} distinct): ${Object.entries(d.voices.coworker_xai_primary).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  out.push(`  voice pairs: ${d.voices.distinct_pairs} distinct, max reuse ${d.voices.max_pair_reuse}; recorded recipe overrides: ${d.voices.recorded_overrides} in ${d.voices.recipes_with_recorded_overrides} recipes`);
  out.push(`  personas/department: ${Object.entries(d.personas_per_department).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  out.push(`  skills/category: ${Object.entries(d.skills_per_category).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  out.push(`  skills used by no persona: ${d.skills_never_used_by_any_persona.length ? d.skills_never_used_by_any_persona.join(', ') : 'none'}`);
  out.push(`  personas in no recipe: ${d.personas_in_no_recipe.length} ${d.personas_in_no_recipe.length ? `(${d.personas_in_no_recipe.join(', ')})` : ''}`);
}
out.push('');
// 2-space JSON, with short arrays of primitives kept on one line so the manifest stays readable and small
function stringify(value, indent = '') {
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every((v) => v === null || typeof v !== 'object')) {
      const inline = `[${value.map((v) => JSON.stringify(v) ?? 'null').join(', ')}]`;
      if (indent.length + inline.length <= 120) return inline;
    }
    const inner = indent + '  ';
    return `[\n${value.map((v) => inner + stringify(v, inner)).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return '{}';
    const inner = indent + '  ';
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${stringify(v, inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
if (WRITE) {
  writeFileSync(join(CATALOG, 'index.json'), stringify(index) + '\n');
  out.push(`Wrote catalog/index.json (${counts.personas} personas, ${counts.skills} skills, ${counts.leads} leads, ${counts.recipes} recipes).`);
}
out.push(`${errors.length ? 'FAILED' : 'PASSED'}: ${errors.length} error(s), ${warnings.length} warning(s).`);
console.log(out.join('\n'));
process.exit(errors.length ? 1 : 0);
