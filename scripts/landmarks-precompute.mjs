#!/usr/bin/env node
// node scripts/landmarks-precompute.mjs — measures face landmarks for every stored portrait that has none, so
// faces warp (and lip-sync) from their first appearance instead of measuring in the owner's browser. Owned by media.
//
// Headless Chromium (Playwright, a repo dependency) opens the dev page apps/web/public/dev/landmarks.html on the
// running web server. That page imports the app's own @headcount/avatar through Vite (MediaPipe tasks-vision with the
// same pinned CDN config, the same mesh → geometry mapping and normalizeLandmarks), detects each portrait and PUTs
// the result bound to the portrait version it measured. Idempotent: portraits that already have landmarks are
// skipped, and a portrait replaced mid-run is reported as stale (run again).
//
// Options: --web <url> (default http://localhost:5173, the Vite server of pnpm dev) · --only <id>[,<id>]
//          · --force (re-measure and replace saved landmarks) · --delegate CPU|GPU (default CPU: headless has no GPU)
//          · --dry-run (list who would be measured) · --headed (show the browser)

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const values = (name) =>
  args
    .flatMap((a, i) => (a === name && args[i + 1] && !args[i + 1].startsWith('--') ? [args[i + 1]] : a.startsWith(`${name}=`) ? [a.slice(name.length + 1)] : []))
    .flatMap((v) => v.split(','))
    .map((s) => s.trim())
    .filter(Boolean);

if (has('--help') || has('-h')) {
  console.log(`Usage: node scripts/landmarks-precompute.mjs [--only <id,id>] [--force] [--delegate CPU|GPU] [--dry-run] [--headed] [--web <url>]
Measures face landmarks for stored portraits that have none, through the running app (pnpm dev).`);
  process.exit(0);
}

const web = (values('--web')[0] ?? 'http://localhost:5173').replace(/\/+$/, '');
const only = values('--only');
const force = has('--force');
const dryRun = has('--dry-run');
const delegate = (values('--delegate')[0] ?? 'CPU').toUpperCase();
if (delegate !== 'CPU' && delegate !== 'GPU') {
  console.error('--delegate must be CPU or GPU.');
  process.exit(1);
}

let portraits;
try {
  const res = await fetch(`${web}/api/portraits`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`GET /api/portraits answered ${res.status}`);
  ({ portraits } = await res.json());
} catch (err) {
  console.error(`The app is not reachable at ${web} (${err.message}). Start it with pnpm dev, or pass --web <url>.`);
  process.exit(1);
}

const known = new Set(portraits.map((p) => p.personaId));
const unknown = only.filter((id) => !known.has(id));
if (unknown.length) console.log(`No stored portrait for ${unknown.join(', ')} (generate it first); skipped.`);
const todo = portraits.filter((p) => (only.length ? only.includes(p.personaId) : true) && (force || !p.hasLandmarks)).map((p) => p.personaId);
const have = portraits.filter((p) => p.hasLandmarks).length;

if (!todo.length) {
  console.log(`Nothing to measure: ${have} of ${portraits.length} stored portraits have landmarks${only.length ? ' (of those asked for, all have them)' : ''}.`);
  process.exit(0);
}
if (dryRun) {
  console.log(`Would ${force ? 're-measure' : 'measure'} ${todo.length} portrait${todo.length === 1 ? '' : 's'}:`);
  for (const id of todo) console.log(`  ${id}`);
  process.exit(0);
}

console.log(`Measuring ${todo.length} of ${portraits.length} stored portraits via ${web} (${delegate})${force ? ', replacing saved landmarks' : ''}`);
const browser = await chromium.launch({ headless: !has('--headed') });
const counts = { saved: 0, exists: 0, failed: 0 };
let exitCode = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error(`[page] ${err.message}`));
  await page.goto(`${web}/dev/landmarks.html?delegate=${delegate}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__landmarks && (window.__landmarks.ready || window.__landmarks.error), null, { timeout: 120_000 });
  const loadError = await page.evaluate(() => window.__landmarks.error);
  if (loadError) throw new Error(`the face mapper did not load: ${loadError}`);

  const width = String(todo.length).length;
  for (const [i, id] of todo.entries()) {
    const r = await page.evaluate(([personaId, f]) => window.__landmarks.measure(personaId, { force: f }), [id, force]);
    const prefix = `[${String(i + 1).padStart(width)}/${todo.length}] ${id}`;
    if (r.status === 'saved') counts.saved++;
    else if (r.status === 'exists') counts.exists++;
    else counts.failed++;
    const word = { saved: 'saved', exists: 'already had landmarks', stale: 'portrait changed while measuring (run again)', no_face: 'no face found', no_portrait: 'no portrait', error: 'failed' }[r.status] ?? r.status;
    console.log(`${prefix} … ${word} in ${(r.ms / 1000).toFixed(1)} s${r.message && r.status !== 'exists' ? ` (${r.message})` : ''}`);
  }
} catch (err) {
  console.error(`Stopped: ${err.message}`);
  exitCode = 1;
} finally {
  await browser.close();
}

console.log(`Done: ${counts.saved} saved, ${counts.exists} already had landmarks, ${counts.failed} not measured.`);
process.exit(exitCode || (counts.failed ? 1 : 0));
