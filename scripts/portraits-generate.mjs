#!/usr/bin/env node
// pnpm portraits:generate — pre-generates catalog portraits through the running worker, one at a time
// (POST /api/portraits/:personaId/generate?wait=1). Existing portraits are skipped unless --force. The worker
// holds the provider keys; this script never sees them. Owned by media.
//
// Who:   (default) the 12 leads · --all  leads + every coworker · --department <id>[,<id>]  coworkers in those
//        departments (repeatable) · --only <id>[,<id>]  exactly these ids
// How:   --worker <url> (default http://127.0.0.1:8787) · --force (regenerate even when a portrait exists)
//        · --dry-run (list who would be painted, call nothing)
// Stops: when no image provider is configured (names the key to add), at the worker's daily limit
//        (PORTRAIT_DAILY_LIMIT), or after 3 failures in a row.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const values = (name) =>
  args
    .flatMap((a, i) => (a === name && args[i + 1] && !args[i + 1].startsWith('--') ? [args[i + 1]] : a.startsWith(`${name}=`) ? [a.slice(name.length + 1)] : []))
    .flatMap((v) => v.split(','))
    .map((s) => s.trim())
    .filter(Boolean);

if (has('--help') || has('-h')) {
  console.log(`Usage: pnpm portraits:generate [--all | --department <id> | --only <id,id>] [--force] [--dry-run] [--worker <url>]
Paints catalog portraits one at a time through the running worker (pnpm dev). Default: the 12 leads.`);
  process.exit(0);
}

const worker = (values('--worker')[0] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const force = has('--force');
const dryRun = has('--dry-run');

// Read the catalog only through packages/catalog (its generated slim bundle).
const { writeBundles } = await import(pathToFileURL(join(root, 'packages/catalog/scripts/build-catalog.mjs')).href);
writeBundles({ quiet: true });
const { default: slim } = await import(pathToFileURL(join(root, 'packages/catalog/generated/slim.js')).href);

const names = new Map([...slim.leads.map((l) => [l.id, l.name]), ...slim.personas.map((p) => [p.id, p.name])]);
let ids = slim.leads.map((l) => l.id);
if (has('--all')) ids = [...ids, ...slim.personas.map((p) => p.id)];
const departments = values('--department');
if (departments.length) {
  const known = new Map(slim.departments.map((d) => [d.id, d]));
  const unknown = departments.filter((d) => !known.has(d));
  if (unknown.length) {
    console.error(`Unknown department ${unknown.join(', ')}. Known: ${[...known.keys()].join(', ')}`);
    process.exit(1);
  }
  ids = departments.flatMap((d) => known.get(d).personaIds);
}
const only = values('--only');
if (only.length) ids = only;
ids = [...new Set(ids)];

const label = (id) => (names.has(id) ? `${id} (${names.get(id)})` : id);
if (dryRun) {
  console.log(`Would ${force ? 'regenerate' : 'generate missing'} portraits for ${ids.length}:`);
  for (const id of ids) console.log(`  ${label(id)}`);
  process.exit(0);
}

async function getJson(path, init) {
  const res = await fetch(`${worker}${path}`, init);
  return { res, body: await res.json().catch(() => ({})) };
}

try {
  const { res, body: caps } = await getJson('/api/capabilities');
  if (!res.ok) throw new Error(`capabilities ${res.status}`);
  if (!caps.modalities?.image?.available) {
    const keys = caps.modalities?.image?.missingKeys ?? [];
    console.error(`Portraits need an image provider. Add ${keys.length ? keys.join(' or ') : 'OPENAI_API_KEY or XAI_API_KEY'} to apps/worker/.dev.vars, then restart pnpm dev.`);
    process.exit(1);
  }
} catch (err) {
  console.error(`The worker is not reachable at ${worker} (${err.message}). Start it with pnpm dev.`);
  process.exit(1);
}

/** Poll GET /api/portraits/:id while another request paints it. */
async function waitForPortrait(id, timeoutMs = 240_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${worker}/api/portraits/${encodeURIComponent(id)}`, { method: 'GET' });
    await res.arrayBuffer().catch(() => undefined);
    if (res.ok) return 'ready';
    if (res.headers.get('x-portrait-status') !== 'generating') return res.headers.get('x-portrait-status') ?? 'none';
  }
  return 'timeout';
}

const width = String(ids.length).length;
const counts = { generated: 0, skipped: 0, failed: 0 };
let failuresInARow = 0;
let stopped = null;
console.log(`Painting ${ids.length} portrait${ids.length === 1 ? '' : 's'} via ${worker}${force ? ' (force)' : ''}`);

for (const [i, id] of ids.entries()) {
  const prefix = `[${String(i + 1).padStart(width)}/${ids.length}] ${label(id)}`;
  const started = Date.now();
  let res, body;
  try {
    ({ res, body } = await getJson(`/api/portraits/${encodeURIComponent(id)}/generate?wait=1${force ? '&force=1' : ''}`, { method: 'POST', signal: AbortSignal.timeout(300_000) }));
  } catch (err) {
    counts.failed++;
    failuresInARow++;
    console.log(`${prefix} … failed: ${err.message}`);
    if (failuresInARow >= 3) {
      stopped = 'three failures in a row';
      break;
    }
    continue;
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status === 200) {
    counts.generated++;
    failuresInARow = 0;
    console.log(`${prefix} … generated in ${secs} s (${body.provider ?? 'provider'}${body.remainingToday !== undefined ? `, ${body.remainingToday} left today` : ''})`);
  } else if (res.status === 202 && body.status === 'exists') {
    counts.skipped++;
    failuresInARow = 0;
    console.log(`${prefix} … exists, skipped`);
  } else if (res.status === 202 && body.status === 'generating') {
    process.stdout.write(`${prefix} … already being painted, waiting`);
    const outcome = await waitForPortrait(id);
    console.log(` … ${outcome}`);
    if (outcome === 'ready') counts.generated++;
    else counts.failed++;
  } else if (res.status === 503) {
    const keys = body.error?.missingKeys ?? [];
    stopped = `${body.error?.message ?? 'no image provider'}${keys.length ? ` (add ${keys.join(' or ')})` : ''}`;
    break;
  } else if (res.status === 429) {
    stopped = body.error?.message ?? 'the daily portrait limit is used up';
    break;
  } else {
    counts.failed++;
    failuresInARow++;
    console.log(`${prefix} … failed (${res.status}): ${body.error?.message ?? 'unknown error'}`);
    if (failuresInARow >= 3) {
      stopped = 'three failures in a row';
      break;
    }
  }
}

if (stopped) console.log(`Stopped: ${stopped}`);
console.log(`Done: ${counts.generated} generated, ${counts.skipped} already existed, ${counts.failed} failed.`);
process.exit(stopped || counts.failed ? 1 : 0);
