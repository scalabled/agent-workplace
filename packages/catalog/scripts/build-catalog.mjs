#!/usr/bin/env node
// Builds the generated catalog bundles from /catalog (read-only; another process may be editing it).
//   generated/full.js  (+ .d.ts)  full records for the worker
//   generated/slim.js  (+ .d.ts)  what the web needs: leads in full, personas slim, departments, skills index, match quiz
//   generated/report.json          counts + warnings
// Unparsable files and incomplete records are skipped with a warning; the build never fails on content.
// Flags: --quiet (only print warnings count), --watch (rebuild on catalog changes), --catalog <dir>, --out <dir>.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? resolve(args[i + 1]) : fallback;
};

const CATALOG_DIR = opt('--catalog', resolve(here, '../../../catalog'));
const OUT_DIR = opt('--out', resolve(here, '../generated'));
const QUIET = flag('--quiet');

const SLIM_PERSONA_FIELDS = ['id', 'name', 'handle', 'pronouns', 'title', 'department', 'seniority', 'one_liner', 'backstory', 'intro_line', 'skills', 'voice'];
const REQUIRED_PERSONA_FIELDS = ['id', 'name', 'handle', 'title', 'department', 'one_liner', 'voice', 'avatar'];
const REQUIRED_LEAD_FIELDS = ['id', 'name', 'handle', 'tagline', 'backstory', 'voice', 'avatar', 'personality', 'communication'];

export function buildCatalog({ catalogDir = CATALOG_DIR } = {}) {
  const warnings = [];
  const hash = createHash('sha256');

  const readJson = (file) => {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      warnings.push(`unreadable ${rel(file)}: ${err.message}`);
      return undefined;
    }
    hash.update(file).update('\0').update(text);
    try {
      return JSON.parse(text);
    } catch (err) {
      warnings.push(`skipped ${rel(file)}: not valid JSON (${err.message.split('\n')[0]})`);
      return undefined;
    }
  };
  const rel = (file) => file.replace(catalogDir + '/', 'catalog/');
  const listJson = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => join(dir, f)) : []);
  const missing = (record, fields) => fields.filter((f) => record?.[f] === undefined || record?.[f] === null || record?.[f] === '');

  const taxonomy = readJson(join(catalogDir, 'taxonomy.json')) ?? {};
  const taxDepartments = Array.isArray(taxonomy.departments) ? taxonomy.departments : [];
  const taxLeads = Array.isArray(taxonomy.leads) ? taxonomy.leads : [];

  // Personas: one file per department.
  const personasById = new Map();
  for (const file of listJson(join(catalogDir, 'personas'))) {
    const doc = readJson(file);
    if (!doc) continue;
    if (!Array.isArray(doc.personas)) {
      warnings.push(`skipped ${rel(file)}: no personas[]`);
      continue;
    }
    for (const p of doc.personas) {
      const gaps = missing(p, REQUIRED_PERSONA_FIELDS);
      if (gaps.length) {
        warnings.push(`skipped persona ${p?.id ?? '(no id)'} in ${rel(file)}: missing ${gaps.join(', ')}`);
        continue;
      }
      if (personasById.has(p.id)) warnings.push(`duplicate persona id ${p.id} (${rel(file)}); keeping the first`);
      else personasById.set(p.id, p);
    }
  }

  // Departments in taxonomy order; personas in taxonomy order within each, then any extras.
  const departments = [];
  const orderedPersonas = [];
  const placed = new Set();
  for (const d of taxDepartments) {
    const ids = [];
    for (const tp of d.personas ?? []) {
      const p = personasById.get(tp.id);
      if (p) {
        ids.push(p.id);
        orderedPersonas.push(p);
        placed.add(p.id);
      }
    }
    for (const p of personasById.values()) {
      if (!placed.has(p.id) && p.department === d.id) {
        ids.push(p.id);
        orderedPersonas.push(p);
        placed.add(p.id);
      }
    }
    departments.push({ id: d.id, name: d.name, icon: d.icon ?? '', description: d.description ?? '', personaIds: ids });
  }
  for (const p of personasById.values()) {
    if (!placed.has(p.id)) {
      warnings.push(`persona ${p.id} has unknown department ${p.department}`);
      orderedPersonas.push(p);
    }
  }

  // Skills: one file per category.
  const skills = [];
  const skillIds = new Set();
  for (const file of listJson(join(catalogDir, 'skills'))) {
    const doc = readJson(file);
    if (!doc) continue;
    if (!Array.isArray(doc.skills)) {
      warnings.push(`skipped ${rel(file)}: no skills[]`);
      continue;
    }
    for (const s of doc.skills) {
      if (!s?.id || !s?.name) {
        warnings.push(`skipped a skill in ${rel(file)}: missing id or name`);
        continue;
      }
      if (skillIds.has(s.id)) continue;
      skillIds.add(s.id);
      skills.push(s);
    }
  }
  const taxSkillOneLiners = new Map();
  for (const c of taxonomy.skill_categories ?? []) for (const s of c.skills ?? []) taxSkillOneLiners.set(s.id, s.one_liner);

  // Leads: one file each, ordered like the taxonomy.
  const leadsById = new Map();
  for (const file of listJson(join(catalogDir, 'leads'))) {
    if (file.endsWith('match-quiz.json')) continue;
    const l = readJson(file);
    if (!l) continue;
    const gaps = missing(l, REQUIRED_LEAD_FIELDS);
    if (gaps.length) {
      warnings.push(`skipped lead ${l?.id ?? rel(file)}: missing ${gaps.join(', ')}`);
      continue;
    }
    leadsById.set(l.id, l);
  }
  const leadOrder = taxLeads.map((l) => l.id);
  const leads = [...leadsById.values()].sort((a, b) => rank(leadOrder, a.id) - rank(leadOrder, b.id) || a.id.localeCompare(b.id));

  // Optional records.
  const quizFile = join(catalogDir, 'leads', 'match-quiz.json');
  let matchQuiz = existsSync(quizFile) ? (readJson(quizFile) ?? null) : null;
  if (matchQuiz && !Array.isArray(matchQuiz.questions)) {
    warnings.push('skipped catalog/leads/match-quiz.json: no questions[]');
    matchQuiz = null;
  }
  const recipes = [];
  for (const file of listJson(join(catalogDir, 'teams'))) {
    const doc = readJson(file);
    if (doc && Array.isArray(doc.recipes)) recipes.push(...doc.recipes.filter((r) => r?.id));
  }
  const formationFile = join(catalogDir, 'formation.json');
  const formation = existsSync(formationFile) ? (readJson(formationFile) ?? null) : null;

  const sourceHash = hash.digest('hex').slice(0, 16);
  const report = {
    sourceHash,
    counts: { departments: departments.length, personas: orderedPersonas.length, skills: skills.length, leads: leads.length, recipes: recipes.length },
    warnings,
  };

  const full = {
    kind: 'full',
    sourceHash,
    departments,
    leads,
    personas: orderedPersonas,
    skills,
    matchQuiz,
    recipes,
    formation,
    honestyPolicy: taxonomy.honesty_policy ?? null,
    report,
  };

  const slim = {
    kind: 'slim',
    sourceHash,
    departments,
    leads,
    personas: orderedPersonas.map((p) => {
      const out = {};
      for (const f of SLIM_PERSONA_FIELDS) out[f] = p[f];
      out.skills = { primary: p.skills?.primary ?? [], secondary: p.skills?.secondary ?? [] };
      out.avatar = { appearance: p.avatar?.appearance ?? {}, accent_color: p.avatar?.accent_color ?? '#888888', portrait_prompt: p.avatar?.portrait_prompt ?? '' };
      return out;
    }),
    skills: skills.map((s) => ({ id: s.id, name: s.name, icon: s.icon ?? '', category: s.category ?? '', one_liner: s.one_liner ?? taxSkillOneLiners.get(s.id) ?? '' })),
    matchQuiz,
  };

  return { full, slim, report };
}

function rank(order, id) {
  const i = order.indexOf(id);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

function moduleSource(value) {
  // JSON.parse of a string literal is the fastest way for V8 to materialise a large object.
  return `// GENERATED by packages/catalog/scripts/build-catalog.mjs. Do not edit.\nexport default JSON.parse(${JSON.stringify(JSON.stringify(value))});\n`;
}

function writeIfChanged(file, content) {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false;
  writeFileSync(file, content);
  return true;
}

export function writeBundles({ outDir = OUT_DIR, catalogDir = CATALOG_DIR, quiet = QUIET } = {}) {
  const { full, slim, report } = buildCatalog({ catalogDir });
  mkdirSync(outDir, { recursive: true });
  const changed = [
    writeIfChanged(join(outDir, 'full.js'), moduleSource(full)),
    writeIfChanged(join(outDir, 'full.d.ts'), `// GENERATED. Do not edit.\ndeclare const catalog: import('../src/types').CatalogFull;\nexport default catalog;\n`),
    writeIfChanged(join(outDir, 'slim.js'), moduleSource(slim)),
    writeIfChanged(join(outDir, 'slim.d.ts'), `// GENERATED. Do not edit.\ndeclare const catalog: import('../src/types').CatalogSlim;\nexport default catalog;\n`),
    writeIfChanged(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n'),
  ].some(Boolean);
  const c = report.counts;
  const summary = `catalog: ${c.leads} leads, ${c.personas} personas, ${c.departments} departments, ${c.skills} skills${slim.matchQuiz ? ', match quiz' : ''}${changed ? '' : ' (unchanged)'}`;
  if (!quiet) {
    console.log(summary);
    for (const w of report.warnings) console.warn(`  warning: ${w}`);
  } else if (report.warnings.length) {
    console.warn(`${summary}; ${report.warnings.length} warning(s), see packages/catalog/generated/report.json`);
  }
  return { report, changed };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  writeBundles();
  if (flag('--watch')) {
    let timer = null;
    console.log(`catalog: watching ${CATALOG_DIR}`);
    watch(CATALOG_DIR, { recursive: true }, (_event, name) => {
      if (name && !String(name).endsWith('.json')) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          writeBundles({ quiet: true });
        } catch (err) {
          console.warn(`catalog: rebuild failed: ${err.message}`);
        }
      }, 400);
    });
  }
}
