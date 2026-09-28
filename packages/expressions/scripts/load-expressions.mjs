// Loads catalog/expressions/** for the engine: intents.json, archetypes.json and every other JSON file
// classified by its `kind` (archetype_pack | signature_file), wherever it sits (packs/, signatures/,
// personas/ …). Unparsable or unknown files are skipped and reported, so a half-written file never
// breaks the build. Also computes live slider statistics over catalog/personas + catalog/leads, exactly
// like catalog/scripts/validate-expressions.mjs. Dependency-free; Node only (the engine itself is not).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SLIDERS = ['warmth', 'directness', 'formality', 'humor', 'risk_appetite', 'detail', 'pace'];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Mean and population std of the seven sliders over catalog personas and leads (null without a catalog). */
export function catalogSliderStats(catalogDir = join(REPO_ROOT, 'catalog')) {
  const rows = [];
  for (const p of walk(join(catalogDir, 'personas'))) {
    try {
      for (const x of readJson(p).personas ?? []) if (x?.personality?.sliders) rows.push(x.personality.sliders);
    } catch {
      /* the persona catalog is validated elsewhere */
    }
  }
  for (const p of walk(join(catalogDir, 'leads'))) {
    try {
      const d = readJson(p);
      if (String(d.id ?? '').startsWith('lead-') && d.personality?.sliders) rows.push(d.personality.sliders);
    } catch {
      /* ignore */
    }
  }
  if (!rows.length) return null;
  const mean = {};
  const std = {};
  for (const k of SLIDERS) {
    const v = rows.map((r) => (typeof r[k] === 'number' ? r[k] : 50));
    mean[k] = v.reduce((a, b) => a + b, 0) / v.length;
    std[k] = Math.sqrt(v.reduce((a, b) => a + (b - mean[k]) ** 2, 0) / v.length) || 1;
  }
  return { mean, std };
}

/**
 * @param {{ exprDir?: string, catalogDir?: string }} [opts]
 * @returns {{ input: object, files: { path: string, kind: string }[], skipped: { path: string, reason: string }[] }}
 */
export function loadExpressionSources(opts = {}) {
  const catalogDir = opts.catalogDir ?? join(REPO_ROOT, 'catalog');
  const exprDir = opts.exprDir ?? join(catalogDir, 'expressions');
  const rel = (p) => relative(REPO_ROOT, p);
  const intentsPath = join(exprDir, 'intents.json');
  const archetypesPath = join(exprDir, 'archetypes.json');
  const intents = readJson(intentsPath);
  const archetypes = readJson(archetypesPath);
  const packs = [];
  const signatures = [];
  const files = [{ path: rel(intentsPath), kind: 'intents' }, { path: rel(archetypesPath), kind: 'archetypes' }];
  const skipped = [];
  for (const p of walk(exprDir)) {
    if (p === intentsPath || p === archetypesPath) continue;
    let d;
    try {
      d = readJson(p);
    } catch (e) {
      skipped.push({ path: rel(p), reason: `unparsable: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    if (d?.kind === 'archetype_pack') packs.push(d);
    else if (d?.kind === 'signature_file') signatures.push(d);
    else {
      skipped.push({ path: rel(p), reason: `unknown kind ${JSON.stringify(d?.kind)}` });
      continue;
    }
    files.push({ path: rel(p), kind: d.kind });
  }
  const sliderStats = catalogSliderStats(catalogDir);
  return { input: { intents, archetypes, packs, signatures, ...(sliderStats ? { sliderStats } : {}) }, files, skipped };
}
