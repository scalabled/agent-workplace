#!/usr/bin/env node
// Compiles catalog/expressions/** into packages/expressions/generated/expressions.json (docs/LIVING-WORKFORCE.md §4.1):
// the cleaned ExpressionCatalogInput plus its content `version`, which the worker imports and the browser
// fetches from /api/expr/catalog. Lines or signature packs the engine rejects are dropped and reported in
// generated/report.json, so content that is still being written never breaks the app.
// Huddle packs (kind huddle_pack, catalog/expressions/huddles/*.json, docs/dev/OFFICE-LIFE.md §6.2) are compiled
// against the catalog the same lenient way and written as a separate top-level field,
// `huddles: { version, packs }`; the expressions `version` and `compileCatalog(bundle.input)` do not change.
//
//   node packages/expressions/scripts/build-expressions.mjs            build (exit 1 only on file-level errors)
//   node packages/expressions/scripts/build-expressions.mjs --check    also exit 1 when any line or huddle exchange was dropped or a file skipped
//   node packages/expressions/scripts/build-expressions.mjs --out DIR  write somewhere else
//   node packages/expressions/scripts/build-expressions.mjs --quiet    only the summary line
//
// The engine is TypeScript; this script runs it through Node's type stripping (built in from Node 22.18 and
// 23.6, re-executed with --experimental-strip-types on older 22.x) — no build step, no dependencies.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

if (!process.features?.typescript) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  if (r.error || r.status === 9) {
    console.error('build-expressions: this Node cannot strip TypeScript types; use Node ≥ 22.6.');
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

register('./ts-resolve-hook.mjs', import.meta.url);
const { compileCatalogLenient } = await import('../src/catalog.ts');
const { ExpressionCatalogError } = await import('../src/catalog.ts');
const { compileHuddlesLenient } = await import('../src/huddle.ts');
const { loadExpressionSources, REPO_ROOT } = await import('./load-expressions.mjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 && args[outIdx + 1] ? resolve(args[outIdx + 1]) : join(HERE, '..', 'generated');
const quiet = flag('--quiet');

const { input, files, skipped } = loadExpressionSources();
let result;
try {
  result = compileCatalogLenient(input);
} catch (e) {
  if (e instanceof ExpressionCatalogError) {
    for (const p of e.problems) console.error(`error ${p}`);
    console.error(`build-expressions: ${e.problems.length} file-level problem(s); nothing written.`);
    process.exit(1);
  }
  throw e;
}
const { catalog, input: cleaned, dropped, problems } = result;

let lines = 0;
for (const p of cleaned.packs) for (const list of Object.values(p.intents ?? {})) lines += list.length;
for (const f of cleaned.signatures) for (const s of f.packs ?? []) {
  for (const list of Object.values(s.lines ?? {})) lines += list.length;
  lines += (s.catchphrases ?? []).length;
}
const counts = { archetypePacks: cleaned.packs.length, signaturePacks: cleaned.signatures.reduce((a, f) => a + (f.packs?.length ?? 0), 0), lines };

// Huddle packs: the loader classifies them (wherever they sit); exchanges the engine rejects are dropped and reported.
const huddleSources = files.filter((f) => f.kind === 'huddle_pack').map((f) => JSON.parse(readFileSync(join(REPO_ROOT, f.path), 'utf8')));
const huddled = compileHuddlesLenient(huddleSources, catalog);
const huddles = { version: huddled.huddles.version, packs: huddled.packs };
const huddleCounts = { packs: huddled.packs.length, exchanges: huddled.huddles.exchanges.length, grounded: huddled.huddles.exchanges.filter((e) => e.grounded).length };

mkdirSync(outDir, { recursive: true });
const bundle = { kind: 'expression_bundle', version: catalog.version, input: cleaned, huddles };
// Write only what changed: a running `pnpm dev` (wrangler and Vite) reloads on every write of the bundle.
const writeIfChanged = (file, text) => {
  try {
    if (readFileSync(file, 'utf8') === text) return false;
  } catch {
    /* missing: write it */
  }
  writeFileSync(file, text);
  return true;
};
const changed = writeIfChanged(join(outDir, 'expressions.json'), `${JSON.stringify(bundle)}\n`);
writeIfChanged(join(outDir, 'report.json'), `${JSON.stringify({
  version: catalog.version, counts, files, skipped, dropped, problems,
  huddles: { version: huddles.version, counts: huddleCounts, dropped: huddled.dropped, problems: huddled.problems },
}, null, 2)}\n`);

if (!quiet) {
  for (const s of skipped) console.warn(`skip  ${s.path}: ${s.reason}`);
  for (const p of problems) console.warn(`drop  ${p}`);
  for (const p of huddled.problems) console.warn(`drop  ${p}`);
}
console.log(
  `expressions ${catalog.version}: ${counts.archetypePacks} archetype packs, ${counts.signaturePacks} signature packs, ${counts.lines} lines` +
    ` · huddles ${huddles.version}: ${huddleCounts.packs} packs, ${huddleCounts.exchanges} exchanges (${huddleCounts.grounded} grounded)` +
    ` · ${dropped.length} lines and ${huddled.dropped.length} exchanges dropped, ${skipped.length} files skipped → ${join(outDir, 'expressions.json')}${changed ? '' : ' (unchanged)'}`,
);
process.exit(flag('--check') && (dropped.length || huddled.dropped.length || skipped.length) ? 1 : 0);
