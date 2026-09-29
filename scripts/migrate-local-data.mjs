#!/usr/bin/env node
// Move the local data worth keeping from `pnpm dev`'s state to the Cloudflare test deployment (docs/DEPLOY.md §7).
//
// What moves (paid for once, expensive to redo):
//   R2 portraits/*        generated portraits, WITH their customMetadata (version, provider, prompt hash…)
//   D1 portraits rows     the matching rows, WITH their face landmarks (measured in a browser; bound to the version)
//   R2 expr/clips/*       pre-voiced clips + .align.json sidecars (content-addressed: later renders become free hits)
//   R2 ws/<ws>/expr/*     workspace-scoped clips (only reused when the deployed WORKSPACE_ID is the same)
//   R2 media/*            marketing originals: only with --include media (the landing uses public/marketing files)
// What does not (reported, regenerated): D1 media_usage (budgets start fresh), ledger_events/jobs/workspaces (roll-ups
// of Durable Object state), and all Durable Object SQLite (conversations, jobs, expression manifest, voice owner):
// there is no import path into a deployed Durable Object. Onboarding runs again; the expression manifest is rebuilt
// for free from the migrated clips on the first pre-voice run.
//
// `wrangler r2 object put` cannot set customMetadata (and the S3 API lowercases metadata names, while the worker
// reads camelCase ones), so --execute uploads through wrangler's own R2/D1 bindings (getPlatformProxy): "remote": true
// against the account after `wrangler login`, or locally for a rehearsal. --export also writes a plain-wrangler
// fallback (r2-put.sh + d1-portraits.sql for `wrangler d1 execute --remote --file`) and says what it loses.
//
//   node scripts/migrate-local-data.mjs [--dry-run]           inventory, plan and the exact commands; read-only, no
//                                                             network (the default)
//   node scripts/migrate-local-data.mjs --export <dir>        also write the objects, r2-manifest.json, r2-put.sh and
//                                                             d1-portraits.sql (still no network)
//   node scripts/migrate-local-data.mjs --execute --target local --persist-to <dir>
//                                                             rehearse into a scratch state dir (no account needed);
//                                                             then `wrangler dev -c wrangler.deploy.jsonc --persist-to <dir>`
//   node scripts/migrate-local-data.mjs --execute             upload to the deploy config's bucket and database
//                                                             (owner-run after `wrangler login`; asks you to type the
//                                                             bucket name unless --yes)
// Options: --state <dir> (default apps/worker/.wrangler/state/v3), --config <deploy config> (default
// apps/worker/wrangler.deploy.jsonc), --dev-config <path>, --include portraits,clips,ws-clips[,media],
// --overwrite (replace a remote portrait whose version differs), --concurrency <n> (default 6), --json.
// Local state is read from a snapshot copy, so a running `pnpm dev` is never locked or written. The script never reads
// .dev.vars or any secret, and prints only object keys, counts and sizes.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPlaceholder, parseJsonc } from './deploy-preflight.mjs';

const MiB = 1024 * 1024;
export const DEFAULT_INCLUDE = ['portraits', 'clips', 'ws-clips'];
const PORTRAIT_KEY = /^portraits\/([^/]+)\.(png|jpg|webp)$/;
const PORTRAIT_COLUMNS = ['persona_id', 'subject_kind', 'r2_key', 'mime', 'bytes', 'version', 'provider', 'model', 'prompt_hash', 'generated_at', 'landmarks', 'landmarks_at', 'created_at', 'updated_at'];

async function sqlite() {
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => (/SQLite/i.test(String(w?.message ?? w)) ? undefined : emit.call(process, w, ...rest));
  try {
    return (await import('node:sqlite')).DatabaseSync;
  } catch {
    throw new Error('This script needs node:sqlite (Node 22.13 or newer).');
  } finally {
    process.emitWarning = emit;
  }
}

/** Copy a SQLite file (+ -wal/-shm) to a temp dir and open the copy: the live file is never locked or written. */
async function openSnapshot(file) {
  const DatabaseSync = await sqlite();
  const dir = mkdtempSync(join(tmpdir(), 'hc-migrate-'));
  const copy = join(dir, basename(file));
  copyFileSync(file, copy);
  for (const suffix of ['-wal', '-shm']) if (existsSync(file + suffix)) copyFileSync(file + suffix, copy + suffix);
  const db = new DatabaseSync(copy);
  return { db, close: () => (db.close(), rmSync(dir, { recursive: true, force: true })) };
}

const sqliteFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite').map((f) => join(dir, f)) : []);
const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' ORDER BY name").all().map((r) => r.name);
const count = (db, t) => Number(db.prepare(`SELECT count(*) AS n FROM "${t.replace(/"/g, '""')}"`).get().n);
const json = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

// ── reading local state ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Everything the local state holds: R2 objects (from miniflare's metadata DB + blob files), D1 portrait rows and
 * table counts, and Durable Object table counts. Throws with a readable sentence when the layout is not recognised.
 */
export async function readLocalState(stateDir, { bucket = 'headcount-blobs' } = {}) {
  if (!existsSync(stateDir)) throw new Error(`No local state at ${stateDir}. Run pnpm dev once, or pass --state.`);
  const blobsDir = join(stateDir, 'r2', bucket, 'blobs');
  const out = { stateDir, bucket, objects: [], portraitRows: [], d1Counts: {}, doCounts: {} };

  // R2: one metadata DB per bucket; pick the one whose blobs live under r2/<bucket>/blobs.
  for (const file of sqliteFiles(join(stateDir, 'r2', 'miniflare-R2BucketObject'))) {
    const { db, close } = await openSnapshot(file);
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_mf_objects'").get()) continue;
      const rows = db.prepare('SELECT key, blob_id, size, etag, uploaded, http_metadata, custom_metadata FROM _mf_objects ORDER BY key').all();
      if (rows.length && !existsSync(join(blobsDir, String(rows[0].blob_id)))) continue;
      out.objects = rows.map((r) => ({
        key: r.key,
        size: Number(r.size),
        etag: r.etag,
        uploaded: Number(r.uploaded),
        httpMetadata: json(r.http_metadata, {}),
        customMetadata: json(r.custom_metadata, {}),
        blobPath: join(blobsDir, String(r.blob_id)),
      }));
      break;
    } finally {
      close();
    }
  }

  // D1: the database that has the portraits table.
  for (const file of sqliteFiles(join(stateDir, 'd1', 'miniflare-D1DatabaseObject'))) {
    const { db, close } = await openSnapshot(file);
    try {
      const tables = tableNames(db);
      if (!tables.includes('portraits')) continue;
      for (const t of tables) out.d1Counts[t] = count(db, t);
      out.portraitRows = db.prepare(`SELECT ${PORTRAIT_COLUMNS.join(', ')} FROM portraits WHERE r2_key IS NOT NULL AND version IS NOT NULL ORDER BY persona_id`).all().map((r) => ({ ...r }));
      break;
    } finally {
      close();
    }
  }

  // Durable Objects: counts only (for the report of what is not migrated).
  const doRoot = join(stateDir, 'do');
  if (existsSync(doRoot)) {
    for (const cls of readdirSync(doRoot)) {
      const totals = {};
      for (const file of sqliteFiles(join(doRoot, cls))) {
        const { db, close } = await openSnapshot(file);
        try {
          for (const t of tableNames(db)) totals[t] = (totals[t] ?? 0) + count(db, t);
        } finally {
          close();
        }
      }
      out.doCounts[cls.replace(/^[^-]+-/, '')] = totals;
    }
  }
  return out;
}

// ── planning ────────────────────────────────────────────────────────────────────────────────────────────────────

export function kindOf(key, workspaceId) {
  if (PORTRAIT_KEY.test(key)) return 'portraits';
  if (key.startsWith('expr/clips/')) return 'clips';
  if (key.startsWith(`ws/${workspaceId}/expr/`)) return 'ws-clips';
  if (key.startsWith('media/')) return 'media';
  return 'other';
}

/**
 * What to move. Objects of the included kinds, and portrait rows whose image moves too. Rows whose R2 object is gone
 * are dropped (the worker would forget them anyway); a row whose version differs from the object's metadata moves as
 * it is, with a warning (landmarks are bound to the row's version).
 */
export function planMigration(state, { include = DEFAULT_INCLUDE, workspaceId = 'local', sourceWorkspaceId = 'local' } = {}) {
  const groups = {};
  const objects = [];
  const warnings = [];
  for (const o of state.objects) {
    const kind = kindOf(o.key, sourceWorkspaceId);
    const g = (groups[kind] ??= { objects: 0, bytes: 0, migrate: false });
    g.objects++;
    g.bytes += o.size;
    const wanted = include.includes(kind) && !(kind === 'ws-clips' && workspaceId !== sourceWorkspaceId);
    g.migrate = wanted;
    if (wanted) objects.push({ ...o, kind });
  }
  if (include.includes('ws-clips') && workspaceId !== sourceWorkspaceId && groups['ws-clips']) {
    warnings.push(`ws/${sourceWorkspaceId}/expr/* is skipped: the deployed WORKSPACE_ID is "${workspaceId}", so the worker would never read them.`);
  }
  const byKey = new Map(objects.map((o) => [o.key, o]));
  const rows = [];
  if (include.includes('portraits')) {
    for (const r of state.portraitRows) {
      const obj = byKey.get(r.r2_key);
      if (!obj) {
        warnings.push(`${r.persona_id}: its image ${r.r2_key} is not in local R2; the row is not migrated.`);
        continue;
      }
      if (obj.customMetadata?.version && obj.customMetadata.version !== r.version) warnings.push(`${r.persona_id}: row version ${r.version} differs from the image's ${obj.customMetadata.version} (moved as is).`);
      rows.push(r);
    }
    const rowKeys = new Set(rows.map((r) => r.r2_key));
    const orphans = objects.filter((o) => o.kind === 'portraits' && !rowKeys.has(o.key));
    if (orphans.length) warnings.push(`${orphans.length} portrait image(s) have no D1 row; the worker adopts them on first read, without landmarks.`);
  }
  return {
    groups,
    objects,
    rows,
    warnings,
    bytes: objects.reduce((a, o) => a + o.size, 0),
    withLandmarks: rows.filter((r) => r.landmarks).length,
  };
}

// ── SQL (for --export and manual `wrangler d1 execute --file`) ──────────────────────────────────────────────────

export function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return Number.isFinite(Number(v)) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

const UPSERT = `INSERT INTO portraits (${PORTRAIT_COLUMNS.join(', ')}) VALUES (${PORTRAIT_COLUMNS.map(() => '?').join(', ')})
ON CONFLICT (persona_id) DO UPDATE SET ${PORTRAIT_COLUMNS.filter((c) => c !== 'persona_id' && c !== 'created_at')
  .map((c) => `${c} = excluded.${c}`)
  .join(', ')}, job_id = NULL, job_status = NULL, job_started_at = NULL, job_error = NULL`;

export function portraitsSql(rows) {
  const head = `-- Headcount portraits with landmarks, exported by scripts/migrate-local-data.mjs on ${new Date().toISOString()}.\n-- Upload the R2 objects first (the rows point at them), and apply the D1 migrations first (the table must exist).\n`;
  // A function replacement, so a "$&" inside a value is never read as a replacement pattern.
  return head + rows.map((r) => `${UPSERT.replace(/\(\?(, \?)*\)/, () => `(${PORTRAIT_COLUMNS.map((c) => sqlLiteral(r[c])).join(', ')})`)};`).join('\n') + '\n';
}

/** D1 refuses a single SQL statement over 100 KB; bound parameters (the --execute path) are not limited this way. */
export const D1_MAX_STATEMENT_BYTES = 100_000;

/** Byte length of the largest INSERT in portraitsSql(rows). */
export function largestStatementBytes(rows) {
  return portraitsSql(rows)
    .split('\n')
    .filter((l) => l.startsWith('INSERT'))
    .reduce((max, l) => Math.max(max, Buffer.byteLength(l)), 0);
}

/** Objects whose R2 customMetadata a plain `wrangler r2 object put` would drop, by kind. */
export function metadataLoss(objects) {
  const byKind = {};
  for (const o of objects) if (Object.keys(o.customMetadata ?? {}).length) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
  return byKind;
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const HTTP_FLAGS = { contentType: '--content-type', contentDisposition: '--content-disposition', contentEncoding: '--content-encoding', contentLanguage: '--content-language', cacheControl: '--cache-control' };
const LOSS_NOTE = {
  portraits: 'still served, since D1 holds the version, but revalidated on every load instead of cached as immutable',
  clips: 'durationMs reads as 0 and the alignment as unavailable',
  'ws-clips': 'durationMs reads as 0 and the alignment as unavailable',
  media: 'the version is lost, so images are revalidated on every load',
};

/**
 * The plain-wrangler fallback: one `wrangler r2 object put <bucket>/<key> --remote` per object (http metadata kept,
 * customMetadata lost). Paths are absolute, so it runs from anywhere; it uses the repo's pinned wrangler.
 */
export function r2PutScript(objects, { bucket, dir, wrangler, config }) {
  const loss = metadataLoss(objects);
  const lost = Object.entries(loss);
  const lines = [
    '#!/bin/sh',
    `# Generated by scripts/migrate-local-data.mjs --export on ${new Date().toISOString()}.`,
    '# FALLBACK ONLY. Prefer `node scripts/migrate-local-data.mjs --execute`, which keeps R2 customMetadata and verifies',
    '# every upload. `wrangler r2 object put` has no custom-metadata option, so this script drops it:',
    ...(lost.length ? lost.map(([k, n]) => `#   ${n} ${k}: ${LOSS_NOTE[k] ?? 'metadata lost'}`) : ['#   (no object here carries customMetadata)']),
    '# Run after `npx wrangler login` (and set CLOUDFLARE_ACCOUNT_ID if your login has several accounts). Then load the',
    '# D1 rows: wrangler d1 execute <database> --remote --file d1-portraits.sql -c <deploy config>',
    'set -eu',
    `WRANGLER="\${WRANGLER:-${wrangler}}"`,
    `echo ${shq(`Uploading ${objects.length} objects to R2 bucket ${bucket} (remote)...`)}`,
  ];
  objects.forEach((o, i) => {
    const flags = Object.entries(o.httpMetadata ?? {})
      .filter(([k, v]) => HTTP_FLAGS[k] && v)
      .map(([k, v]) => `${HTTP_FLAGS[k]} ${shq(v)}`);
    lines.push(`"$WRANGLER" r2 object put ${shq(`${bucket}/${o.key}`)} --remote --file ${shq(join(dir, 'r2', ...o.key.split('/')))}${flags.length ? ` ${flags.join(' ')}` : ''}${config ? ` -c ${shq(config)}` : ''} >/dev/null`);
    if ((i + 1) % 100 === 0 || i === objects.length - 1) lines.push(`echo ${shq(`  ${i + 1}/${objects.length}`)}`);
  });
  return `${lines.join('\n')}\n`;
}

export function exportPlan(planned, dir, { bucket = 'headcount-test-blobs', wrangler = 'npx wrangler', config = null } = {}) {
  mkdirSync(join(dir, 'r2'), { recursive: true });
  const manifest = [];
  for (const o of planned.objects) {
    const target = join(dir, 'r2', ...o.key.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(o.blobPath, target);
    manifest.push({ key: o.key, file: `r2/${o.key}`, size: o.size, etag: o.etag, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata });
  }
  writeFileSync(join(dir, 'r2-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  writeFileSync(join(dir, 'd1-portraits.sql'), portraitsSql(planned.rows));
  writeFileSync(join(dir, 'r2-put.sh'), r2PutScript(planned.objects, { bucket, dir, wrangler, config }), { mode: 0o755 });
  return { files: manifest.length, sql: join(dir, 'd1-portraits.sql'), script: join(dir, 'r2-put.sh') };
}

// ── applying (through wrangler's bindings) ──────────────────────────────────────────────────────────────────────

function loadDeployConfig(root, configPath) {
  const p = resolve(root, configPath);
  if (!existsSync(p)) throw new Error(`${relative(root, p)} is missing. Copy apps/worker/wrangler.deploy.example.jsonc and fill it in first (docs/DEPLOY.md §8.1).`);
  const cfg = parseJsonc(readFileSync(p, 'utf8'));
  const db = (cfg.d1_databases ?? []).find((d) => d.binding === 'DB');
  const r2 = (cfg.r2_buckets ?? []).find((b) => b.binding === 'BLOBS');
  if (!r2?.bucket_name || isPlaceholder(r2.bucket_name)) throw new Error('The deploy config has no BLOBS bucket_name.');
  if (!db?.database_name) throw new Error('The deploy config has no DB database.');
  return { path: p, cfg, db, r2, workspaceId: cfg.vars?.WORKSPACE_ID ?? 'local' };
}

const canonical = (m) => JSON.stringify(Object.entries(m ?? {}).sort(([a], [b]) => a.localeCompare(b)));

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

export async function applyPlan(planned, { root, deploy, target, persistTo, concurrency = 6, overwrite = false, log = console.log }) {
  const remote = target === 'remote';
  if (remote && isPlaceholder(deploy.db.database_id)) throw new Error('The deploy config still has a placeholder database_id.');
  const workerDir = join(root, 'apps/worker');
  const tmp = mkdtempSync(join(tmpdir(), 'hc-migrate-config-'));
  const tmpConfig = join(tmp, 'wrangler.jsonc');
  writeFileSync(
    tmpConfig,
    JSON.stringify({
      name: 'headcount-migrate',
      compatibility_date: deploy.cfg.compatibility_date ?? '2026-09-01',
      r2_buckets: [{ binding: 'BLOBS', bucket_name: deploy.r2.bucket_name, ...(remote ? { remote: true } : {}) }],
      d1_databases: [
        {
          binding: 'DB',
          database_name: deploy.db.database_name,
          // Local D1 files are keyed by this id: the same one `wrangler dev -c wrangler.deploy.jsonc` will use.
          database_id: deploy.db.database_id,
          migrations_dir: resolve(dirname(deploy.path), deploy.db.migrations_dir ?? 'migrations'),
          ...(remote ? { remote: true } : {}),
        },
      ],
    }),
  );
  const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
  const wranglerBin = join(workerDir, 'node_modules/.bin/wrangler');
  if (!remote) {
    // A rehearsal target gets the real migrations, exactly as `pnpm dev` applies them.
    const r = spawnSync(wranglerBin, ['d1', 'migrations', 'apply', deploy.db.database_name, '--local', '--persist-to', persistTo, '-c', tmpConfig], { cwd: tmp, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Local D1 migrations failed: ${`${r.stdout}${r.stderr}`.split('\n').filter((l) => /error/i.test(l)).slice(0, 2).join(' ')}`);
  }
  const requireFromWorker = createRequire(join(workerDir, 'package.json'));
  const { getPlatformProxy } = await import(pathToFileURL(requireFromWorker.resolve('wrangler')).href);
  const proxy = await getPlatformProxy({ configPath: tmpConfig, envFiles: [], persist: remote ? false : { path: join(persistTo, 'v3') }, remoteBindings: remote });
  const { BLOBS, DB } = proxy.env;
  const result = { uploaded: 0, skipped: 0, failed: [], conflicts: [], rows: 0 };
  try {
    const hasTable = await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'portraits'").first();
    if (!hasTable) throw new Error(`The ${remote ? 'remote' : 'rehearsal'} D1 has no portraits table. Apply the migrations first: npx wrangler d1 migrations apply ${deploy.db.database_name} --remote -c ${relative(workerDir, deploy.path)}`);

    // A remote portrait with another version is newer work: keep it unless --overwrite.
    const remoteVersions = new Map();
    for (const r of (await DB.prepare('SELECT persona_id, version FROM portraits WHERE r2_key IS NOT NULL').all()).results ?? []) remoteVersions.set(r.persona_id, r.version);
    const keep = new Set();
    for (const r of planned.rows) {
      const v = remoteVersions.get(r.persona_id);
      if (v && v !== r.version && !overwrite) {
        result.conflicts.push(r.persona_id);
        keep.add(r.r2_key);
      }
    }

    let done = 0;
    await pool(planned.objects, concurrency, async (o) => {
      try {
        if (keep.has(o.key)) return void result.skipped++;
        const head = await BLOBS.head(o.key);
        const sameVersion = !o.customMetadata?.version || head?.customMetadata?.version === o.customMetadata.version;
        if (head && head.size === o.size && head.etag === o.etag && sameVersion) return void result.skipped++;
        const bytes = readFileSync(o.blobPath);
        if (bytes.byteLength !== o.size) throw new Error(`local blob is ${bytes.byteLength} bytes, metadata says ${o.size}`);
        await BLOBS.put(o.key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { httpMetadata: o.httpMetadata, customMetadata: o.customMetadata });
        const check = await BLOBS.head(o.key);
        if (!check || check.size !== o.size || canonical(check.customMetadata) !== canonical(o.customMetadata)) throw new Error('verification failed after upload');
        result.uploaded++;
      } catch (err) {
        result.failed.push(`${o.key}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (++done % 100 === 0 || done === planned.objects.length) log(`  R2 ${done}/${planned.objects.length}`);
      }
    });

    // Rows after their images, and only for images that are now there.
    const failedKeys = new Set(result.failed.map((f) => f.slice(0, f.indexOf(':'))));
    const rows = planned.rows.filter((r) => !keep.has(r.r2_key) && !failedKeys.has(r.r2_key));
    for (let i = 0; i < rows.length; i += 20) {
      await DB.batch(rows.slice(i, i + 20).map((r) => DB.prepare(UPSERT).bind(...PORTRAIT_COLUMNS.map((c) => r[c] ?? null))));
      result.rows += Math.min(20, rows.length - i);
    }
  } finally {
    await proxy.dispose();
    rmSync(tmp, { recursive: true, force: true });
  }
  return result;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const fmt = (b) => `${(b / MiB).toFixed(1)} MiB`;

export function describe(state, planned, { include }) {
  const lines = [`Local state: ${state.stateDir}`, `R2 (${state.bucket}): ${state.objects.length} objects, ${fmt(state.objects.reduce((a, o) => a + o.size, 0))}`];
  const why = {
    portraits: 'paid images; their D1 rows carry the landmarks',
    clips: 'pre-voiced clips; content-addressed, so they become free hits',
    'ws-clips': 'workspace clips (same WORKSPACE_ID only)',
    media: 'marketing originals; the landing uses public/marketing',
    other: 'unknown prefix',
  };
  for (const [kind, g] of Object.entries(planned.groups)) lines.push(`  ${kind.padEnd(10)} ${String(g.objects).padStart(5)}  ${fmt(g.bytes).padStart(9)}  → ${g.migrate ? 'migrate' : `skip${kind === 'media' ? ' (--include media)' : ''}`}: ${why[kind]}`);
  lines.push(`D1: portraits ${planned.rows.length} row(s) to migrate (${planned.withLandmarks} with landmarks)${include.includes('portraits') ? '' : ' (portraits not included)'}`);
  const rest = Object.entries(state.d1Counts).filter(([t]) => t !== 'portraits');
  if (rest.length) lines.push(`  not migrated: ${rest.map(([t, n]) => `${t} ${n}`).join(', ')} (budgets start fresh; the rest are roll-ups of Durable Object state)`);
  const dos = Object.entries(state.doCounts).filter(([, t]) => Object.keys(t).length);
  if (dos.length) {
    lines.push('Durable Objects (not migrated; no import path; regenerated by onboarding and the first pre-voice run):');
    for (const [cls, t] of dos) lines.push(`  ${cls}: ${Object.entries(t).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
  for (const w of planned.warnings) lines.push(`warning: ${w}`);
  lines.push(`Plan: ${planned.objects.length} objects (${fmt(planned.bytes)}) and ${planned.rows.length} portrait rows.`);
  return lines.join('\n');
}

/**
 * The owner's commands, in order, for this plan. `target` names the deploy config's database and bucket; `configRel`
 * is that config relative to apps/worker. Nothing here runs: it is printed by the dry run.
 */
export function commandPlan(planned, { database, bucket, configRel = 'wrangler.deploy.jsonc', fromExample = false, exportDir = '/tmp/hc-export', include = DEFAULT_INCLUDE }) {
  const loss = Object.entries(metadataLoss(planned.objects));
  const incl = include.join(',') === DEFAULT_INCLUDE.join(',') ? '' : ` --include ${include.join(',')}`;
  const stmt = largestStatementBytes(planned.rows);
  const lines = ['Commands (owner-run from the repo root after `npx wrangler login`; nothing above touched the network):'];
  if (fromExample) lines.push('  0. cp apps/worker/wrangler.deploy.example.jsonc apps/worker/wrangler.deploy.jsonc   (names below come from the example; fill its <…> values)');
  lines.push(
    `  1. (cd apps/worker && npx wrangler d1 migrations apply ${database} --remote -c ${configRel})   # creates the portraits table`,
    `  2. node scripts/migrate-local-data.mjs --execute${incl}`,
    `     Uploads ${planned.objects.length} objects (${fmt(planned.bytes)}) to R2 ${bucket} with their customMetadata, verifies each, then upserts ${planned.rows.length} portrait rows into D1 ${database}. Asks you to type the bucket name. Re-runs skip what is already there.`,
    `  3. (cd apps/worker && npx wrangler d1 execute ${database} --remote -c ${configRel} --command "SELECT count(*), count(landmarks) FROM portraits")   # expect ${planned.rows.length}, ${planned.withLandmarks}`,
    'Plain-wrangler fallback (no bindings; use only if step 2 cannot run):',
    `  node scripts/migrate-local-data.mjs --export ${exportDir}${incl}`,
    `  sh ${exportDir}/r2-put.sh   (${planned.objects.length} × wrangler r2 object put ${bucket}/<key> --remote --file … --content-type …)`,
    `  (cd apps/worker && npx wrangler d1 execute ${database} --remote --file ${exportDir}/d1-portraits.sql -c ${configRel})`,
    loss.length
      ? `  It loses R2 customMetadata on ${loss.reduce((a, [, n]) => a + n, 0)} objects: ${loss.map(([k, n]) => `${n} ${k} (${LOSS_NOTE[k] ?? 'metadata lost'})`).join('; ')}.`
      : '  No planned object carries customMetadata, so the fallback loses nothing.',
    `  Largest SQL statement: ${(stmt / 1000).toFixed(1)} KB (D1 allows ${D1_MAX_STATEMENT_BYTES / 1000} KB)${stmt > D1_MAX_STATEMENT_BYTES ? ': TOO LARGE for `d1 execute --file`; use --execute' : ''}.`,
  );
  return lines;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const opt = (n, d) => {
    const i = args.indexOf(n);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
  };
  const known = new Set(['--dry-run', '--execute', '--apply', '--export', '--target', '--persist-to', '--state', '--config', '--dev-config', '--include', '--overwrite', '--concurrency', '--json', '--yes', '--help', '-h']);
  const unknown = args.filter((a) => a.startsWith('-') && !known.has(a));
  if (unknown.length) throw new Error(`Unknown option ${unknown.join(', ')}. See the header of scripts/migrate-local-data.mjs.`);
  if (flag('--help') || flag('-h')) {
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
    console.log(self.slice(1, self.findIndex((l) => l.startsWith('import'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n').trim());
    return;
  }
  const execute = flag('--execute') || flag('--apply'); // --apply: earlier name, kept as an alias
  if (execute && flag('--dry-run')) throw new Error('Pick one of --dry-run (the default) and --execute.');

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const include = opt('--include', DEFAULT_INCLUDE.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const badKinds = include.filter((k) => !['portraits', 'clips', 'ws-clips', 'media'].includes(k));
  if (badKinds.length) throw new Error(`--include takes portraits, clips, ws-clips and media (not ${badKinds.join(', ')}).`);
  const devCfg = parseJsonc(readFileSync(resolve(root, opt('--dev-config', 'apps/worker/wrangler.jsonc')), 'utf8'));
  const bucket = (devCfg.r2_buckets ?? []).find((b) => b.binding === 'BLOBS')?.bucket_name ?? 'headcount-blobs';
  const sourceWorkspaceId = devCfg.vars?.WORKSPACE_ID ?? 'local';
  const stateDir = resolve(root, opt('--state', 'apps/worker/.wrangler/state/v3'));
  const target = opt('--target', 'remote');
  const configArg = opt('--config', 'apps/worker/wrangler.deploy.jsonc');
  const examplePath = 'apps/worker/wrangler.deploy.example.jsonc';
  const fromExample = !execute && !existsSync(resolve(root, configArg)) && existsSync(resolve(root, examplePath));
  // --execute needs the real deploy config; the dry run falls back to the example for names only.
  const deploy = execute || existsSync(resolve(root, configArg)) ? loadDeployConfig(root, configArg) : fromExample ? loadDeployConfig(root, examplePath) : null;

  const state = await readLocalState(stateDir, { bucket });
  const planned = planMigration(state, { include, workspaceId: deploy?.workspaceId ?? sourceWorkspaceId, sourceWorkspaceId });
  const exportDir = opt('--export');
  const commands = commandPlan(planned, {
    database: deploy?.db.database_name ?? 'headcount-test',
    bucket: deploy?.r2.bucket_name ?? 'headcount-test-blobs',
    configRel: deploy && !fromExample ? relative(join(root, 'apps/worker'), deploy.path) : 'wrangler.deploy.jsonc',
    fromExample,
    exportDir: exportDir ? resolve(exportDir) : '/tmp/hc-export',
    include,
  });
  if (flag('--json') && !execute && !exportDir) {
    const out = { groups: planned.groups, rows: planned.rows.length, withLandmarks: planned.withLandmarks, bytes: planned.bytes, metadataLoss: metadataLoss(planned.objects), warnings: planned.warnings, d1Counts: state.d1Counts, doCounts: state.doCounts, commands };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }
  console.log(describe(state, planned, { include }));

  if (exportDir) {
    const deployPath = deploy && !fromExample ? deploy.path : null;
    const r = exportPlan(planned, resolve(exportDir), { bucket: deploy?.r2.bucket_name ?? 'headcount-test-blobs', wrangler: join(root, 'apps/worker/node_modules/.bin/wrangler'), config: deployPath });
    console.log(`Exported ${r.files} objects and ${planned.rows.length} rows to ${resolve(exportDir)} (r2/, r2-manifest.json, r2-put.sh, d1-portraits.sql). Nothing was uploaded.`);
  }
  if (!execute) {
    console.log(commands.join('\n'));
    console.log('Dry run: nothing was uploaded. Add --execute to upload (docs/DEPLOY.md §7).');
    return;
  }
  if (target !== 'remote' && target !== 'local') throw new Error('--target is remote or local.');
  if (target === 'local' && !opt('--persist-to')) throw new Error('--target local needs --persist-to <dir> (a scratch state dir, never apps/worker/.wrangler/state).');
  const persistTo = target === 'local' ? resolve(opt('--persist-to')) : null;
  if (persistTo && resolve(root, 'apps/worker/.wrangler').startsWith(persistTo)) throw new Error('Refusing to rehearse into (or above) the live dev state.');
  if (persistTo && persistTo.startsWith(resolve(root, 'apps/worker/.wrangler/state'))) throw new Error('Refusing to rehearse into the live dev state.');
  if (target === 'remote' && !flag('--yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Upload ${planned.objects.length} objects (${fmt(planned.bytes)}) to R2 bucket "${deploy.r2.bucket_name}" and ${planned.rows.length} rows to D1 "${deploy.db.database_name}" on your Cloudflare account? Type the bucket name to continue: `);
    rl.close();
    if (answer.trim() !== deploy.r2.bucket_name) {
      console.log('Cancelled; nothing was uploaded.');
      return;
    }
  }
  console.log(`Executing against ${target === 'remote' ? `remote ${deploy.r2.bucket_name} / ${deploy.db.database_name}` : `rehearsal state ${persistTo}`}…`);
  const r = await applyPlan(planned, { root, deploy, target, persistTo, concurrency: Number(opt('--concurrency', '6')) || 6, overwrite: flag('--overwrite') });
  console.log(`R2: ${r.uploaded} uploaded, ${r.skipped} already there or kept. D1: ${r.rows} portrait rows upserted.`);
  if (r.conflicts.length) console.log(`Kept ${r.conflicts.length} remote portrait(s) with a different version (--overwrite replaces them): ${r.conflicts.join(', ')}`);
  if (r.failed.length) {
    console.error(`${r.failed.length} object(s) failed (their rows were not written; run again to retry):\n  ${r.failed.slice(0, 20).join('\n  ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
