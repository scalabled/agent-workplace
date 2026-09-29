#!/usr/bin/env node
// Deploy preflight for the Cloudflare TEST deployment (docs/DEPLOY.md). Run it after `pnpm build` and before
// `wrangler deploy`: a structurally broken or unsafe deployment (placeholder D1 id, dev origins, the Ollama URL, no
// auth, a dev page or a key inside the published files) fails here instead of shipping.
// After oncloudnine tools/deploy.ts (checks + leaked-config scan), extended for Workers Static Assets, Durable Object
// migrations, spending limits and Cloudflare Access.
//
// Local only: it reads files and, unless --skip-bundle, runs `wrangler deploy --dry-run` (bundles, uploads nothing).
// It never calls Cloudflare. Secret values are never printed: only the variable name and the file they were found in.
//
//   node scripts/deploy-preflight.mjs [options]
//     --config <path>        deploy config (default apps/worker/wrangler.deploy.jsonc)
//     --dev-config <path>    local-dev config to compare against (default apps/worker/wrangler.jsonc)
//     --plan paid|free       Workers plan whose limits apply (default paid; Free's 10 ms CPU is a warning)
//     --dev-vars <path>      file whose *_KEY/*_SECRET/*_TOKEN values must not appear in published files
//                            (default apps/worker/.dev.vars); --no-dev-vars skips that scan (pattern scan still runs)
//     --skip-bundle          do not bundle the worker (skips the size check and the bundle's secret scan)
//     --dist <dir>           check this build instead of the config's assets.directory (e.g. a scratch vite build)
//     --accept-access-only   downgrade "the worker does not verify Cloudflare Access" from FAIL to warning
//     --smoke                keyless first deploy (DEPLOY.md §8.1 step 9): checks the config as deployed with
//                            --var ENABLE_MOCK:true --var DEFAULT_CHAT:mock --var MOCK_MEDIA:true, and downgrades the
//                            Access checks to warnings (the workers.dev Access toggle needs the Worker to exist).
//                            Never set provider secrets before a full preflight passes.
//     --json                 print the checks as JSON
// Exit code 1 when any check fails.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const MiB = 1024 * 1024;
// Worker size: since 2026-09-04 only the UNCOMPRESSED upload counts, 64 MiB on both plans (the 3 MiB / 10 MiB gzip
// limits are gone; gzip is informational). What still differs by plan: CPU per request (Free 10 ms, Paid 30 s by
// default) and static-asset files per version. https://developers.cloudflare.com/workers/platform/limits/
export const PLAN_LIMITS = {
  free: { bundleRaw: 64 * MiB, assetCount: 20_000, cpuMs: 10 },
  paid: { bundleRaw: 64 * MiB, assetCount: 100_000, cpuMs: 30_000 },
};
export const MAX_ASSET_BYTES = 25 * MiB;

/** Spending limits the deployed config should set, with the ceiling this preflight accepts without a warning. */
export const BUDGETS = {
  CHAT_DAILY_LIMIT: 500,
  JOB_DAILY_LIMIT: 20,
  MAX_ACTIVE_JOBS: 3,
  TTS_DAILY_LIMIT: 1000,
  STT_DAILY_LIMIT: 200,
  PORTRAIT_DAILY_LIMIT: 20,
  EXPR_CLIP_DAILY_LIMIT: 300,
  EXPR_RENDER_PER_MIN: 20,
  EXPR_PREVOICE_MAX_CLIPS: 300,
};

/** Key shapes that must never appear in a published file or a config var (word-bounded to avoid "desk-…"). */
export const KEY_PATTERNS = [
  { name: 'Anthropic key', re: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI key', re: /(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'xAI key', re: /(?<![A-Za-z0-9_-])xai-[A-Za-z0-9]{32,}/ },
  { name: 'Google API key', re: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/ },
  { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** The command-line overrides of a keyless smoke deploy (Mock chat and media; nothing reaches a provider). */
export const SMOKE_VARS = { ENABLE_MOCK: 'true', DEFAULT_CHAT: 'mock', MOCK_MEDIA: 'true' };

/** Files that must never be published: local secrets, env files, wrangler state. */
const SECRET_FILE = /(^|\/)(\.dev\.vars(\..*)?|\.env(\..*)?|\.wrangler\/.*|.*\.pem|.*\.key)$/i;
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.txt', '.map', '.svg', '.xml', '.webmanifest', '.md']);
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSCODE)$/i;
const ZERO_UUID = /^0{8}-0{4}-[0-9a-f]0{3}-[0-9a-f]0{3}-0{12}$/i;

// ── small helpers (exported for scripts/test/deploy-preflight.test.mjs) ─────────────────────────────────────────

/** JSON with comments and trailing commas (wrangler.jsonc) → value. Strings may contain // and /*. */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** A value someone still has to fill in: "<…>", "{…}", TODO/changeme/placeholder, or the all-zero UUID. */
export function isPlaceholder(value) {
  if (value === undefined || value === null) return true;
  const v = String(value).trim();
  return !v || /[<>{}]/.test(v) || /\b(todo|tbd|changeme|placeholder|your[-_ ]?)/i.test(v) || ZERO_UUID.test(v);
}

const isLoopbackHost = (h) => ['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'].includes(h) || h.endsWith('.localhost') || /^127\./.test(h);
/** RFC 1918 / link-local / .local names: reachable from the owner's LAN, never from a deployed Worker. */
const isPrivateHost = (h) => /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /\.(local|lan|internal|home\.arpa)$/.test(h) || /^\[?f[cd][0-9a-f]{2}:/i.test(h);

/** .assetsignore lines → predicate over dist-relative posix paths (gitignore subset: *, **, ?, trailing /, leading /). */
export function assetsIgnoreMatcher(text) {
  const rules = [];
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const dir = line.endsWith('/');
    let pat = line.replace(/\/+$/, '');
    const anchored = pat.startsWith('/') || pat.includes('/');
    pat = pat.replace(/^\//, '');
    const body = pat
      .split('**')
      .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
      .join('.*');
    const re = new RegExp(`${anchored ? '^' : '(^|/)'}${body}${dir ? '/' : '(/|$)'}`);
    rules.push(re);
  }
  // Wrangler always leaves out its own metafiles.
  return (rel) => ['.assetsignore', '_headers', '_redirects'].includes(rel) || rules.some((re) => re.test(rel));
}

/** Cloudflare `_headers` → [{pattern, headers: {lowercased name: value}}]. */
export function parseHeadersFile(text) {
  const rules = [];
  let cur = null;
  for (const raw of (text ?? '').split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      cur = { pattern: raw.trim(), headers: {} };
      rules.push(cur);
    } else if (cur) {
      const idx = raw.indexOf(':');
      if (idx > 0) cur.headers[raw.slice(0, idx).trim().toLowerCase()] = raw.slice(idx + 1).trim();
    }
  }
  return rules;
}

/** sha256-… CSP sources of every inline <script> (no src) in an HTML document. */
export function inlineScriptHashes(html) {
  const out = [];
  const re = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) if (m[1].trim()) out.push(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  return out;
}

/** KEY=VALUE lines (dotenv subset) → secret-looking entries only. Values stay in memory and are never printed. */
export function secretValues(text) {
  const out = [];
  for (const line of (text ?? '').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || !SECRET_NAME.test(m[1])) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (v.length >= 12) out.push({ name: m[1], value: v });
  }
  return out;
}

function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push({ full, rel: relative(base, full).split(sep).join('/'), size: statSync(full).size });
  }
  return out;
}

function newestMtime(dirs, skip = /node_modules|generated|\.test\./) {
  let newest = 0;
  let file = null;
  for (const d of dirs) {
    for (const f of walk(d)) {
      if (skip.test(f.full)) continue;
      const t = statSync(f.full).mtimeMs;
      if (t > newest) [newest, file] = [t, f.full];
    }
  }
  return { newest, file };
}

function parsesAsModule(file) {
  const dir = mkdtempSync(join(tmpdir(), 'hc-preflight-parse-'));
  const copy = join(dir, 'bundle.mjs');
  try {
    copyFileSync(file, copy);
    execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
    return { ok: true };
  } catch (e) {
    const detail = String(e?.stderr ?? e?.message ?? '').split('\n').filter((l) => l.trim()).slice(0, 2).join(' ');
    return { ok: false, detail };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function scanForSecrets(files, values) {
  const hits = [];
  for (const f of files) {
    if (!TEXT_EXT.has(extname(f.rel).toLowerCase()) || f.size > 40 * MiB) continue;
    const text = readFileSync(f.full, 'utf8');
    for (const p of KEY_PATTERNS) if (p.re.test(text)) hits.push(`${f.label ?? f.rel}: ${p.name} pattern`);
    for (const s of values) if (text.includes(s.value)) hits.push(`${f.label ?? f.rel}: value of ${s.name}`);
  }
  return hits;
}

const doShape = (cfg) => ({
  bindings: (cfg.durable_objects?.bindings ?? []).map((b) => `${b.name}=${b.class_name}${b.script_name ? `@${b.script_name}` : ''}`).sort(),
  migrations: (cfg.migrations ?? []).map((m) => JSON.stringify({ tag: m.tag, new_sqlite_classes: m.new_sqlite_classes ?? [], new_classes: m.new_classes ?? [], renamed_classes: m.renamed_classes ?? [], deleted_classes: m.deleted_classes ?? [] })),
});

// ── the checks ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Run every check. Returns [{name, level: 'ok'|'warn'|'fail'|'info', message}].
 * opts: {root, config, devConfig, plan, dist?, devVars (path|null), acceptAccessOnly, smoke, bundle: {rawBytes, gzipBytes, files}?, bundleError?}
 */
export function checkDeployment(opts) {
  const root = resolve(opts.root);
  const checks = [];
  const add = (name, level, message) => checks.push({ name, level, message });
  const plan = PLAN_LIMITS[opts.plan ?? 'paid'] ?? PLAN_LIMITS.paid;
  const configPath = resolve(root, opts.config ?? 'apps/worker/wrangler.deploy.jsonc');
  const devConfigPath = resolve(root, opts.devConfig ?? 'apps/worker/wrangler.jsonc');
  const workerDir = dirname(configPath);

  // 1. The deploy config.
  if (!existsSync(configPath)) {
    add('deploy config', 'fail', `${relative(root, configPath)} is missing. Copy apps/worker/wrangler.deploy.example.jsonc to it and fill every <…> value (docs/DEPLOY.md §8.1).`);
    return checks;
  }
  let cfg;
  try {
    cfg = parseJsonc(readFileSync(configPath, 'utf8'));
  } catch (e) {
    add('deploy config', 'fail', `${relative(root, configPath)} does not parse: ${e.message}`);
    return checks;
  }
  add('deploy config', 'ok', relative(root, configPath));
  let dev = null;
  try {
    dev = parseJsonc(readFileSync(devConfigPath, 'utf8'));
  } catch {
    add('dev config', 'warn', `${relative(root, devConfigPath)} is missing or does not parse, so parity checks are skipped.`);
  }

  // 2. Identity and runtime.
  const today = new Date().toISOString().slice(0, 10);
  const date = cfg.compatibility_date;
  if (!cfg.name) add('worker name', 'fail', 'The deploy config has no `name` (wrangler would prompt).');
  else add('worker name', 'ok', `${cfg.name}${dev?.name === cfg.name ? ' (same name as the dev config: fine, but a separate test name keeps a later production Worker apart)' : ''}`);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) add('compatibility date', 'fail', 'compatibility_date is missing or not YYYY-MM-DD.');
  else if (date > today) add('compatibility date', 'fail', `compatibility_date ${date} is in the future.`);
  else if (dev?.compatibility_date && dev.compatibility_date !== date) add('compatibility date', 'warn', `compatibility_date ${date} differs from the dev config (${dev.compatibility_date}); tests ran on the dev one.`);
  else add('compatibility date', 'ok', `${date}${(cfg.compatibility_flags ?? []).length ? `, flags ${cfg.compatibility_flags.join(', ')}` : ''}`);
  if (dev && JSON.stringify([...(dev.compatibility_flags ?? [])].sort()) !== JSON.stringify([...(cfg.compatibility_flags ?? [])].sort())) {
    add('compatibility flags', 'warn', `Flags differ from the dev config (${(dev.compatibility_flags ?? []).join(', ') || 'none'}).`);
  }

  // 3. Hostnames.
  if (cfg.routes?.length || cfg.route) add('hostnames', 'info', 'Custom routes are configured: put each hostname behind Cloudflare Access too, and add it to ALLOWED_ORIGINS.');
  else if (cfg.workers_dev === false) add('hostnames', 'fail', 'workers_dev is false and there are no routes: the Worker would have no hostname.');
  if (cfg.preview_urls !== false) add('preview URLs', 'warn', 'Set "preview_urls": false. Preview URLs are extra hostnames that the workers.dev Access toggle does not protect.');
  else add('preview URLs', 'ok', 'off');

  // 4. Static assets.
  const assets = cfg.assets;
  const distDir = assets?.directory ? (opts.dist ? resolve(root, opts.dist) : resolve(workerDir, assets.directory)) : null;
  if (!assets || !distDir) {
    add('static assets', 'fail', 'No "assets" block: the SPA would not be served (the worker answers 404 for every non-/api path). See DEPLOY.md §3.');
  } else {
    const rwf = assets.run_worker_first;
    if (!existsSync(join(distDir, 'index.html'))) add('static assets', 'fail', `${relative(root, distDir)}/index.html is missing. Run \`pnpm build\` first.`);
    else add('static assets', 'ok', `${relative(root, distDir)}`);
    if (assets.not_found_handling !== 'single-page-application') add('SPA fallback', 'fail', 'Set assets.not_found_handling to "single-page-application", or reloading /app/floor answers 404.');
    else add('SPA fallback', 'ok', 'single-page-application');
    if (rwf === true) add('worker-first routes', 'fail', 'run_worker_first: true sends every request to the worker, which answers 404 for non-/api paths (src/index.ts). Use ["/api/*"].');
    else if (!Array.isArray(rwf) || !rwf.some((p) => p === '/api/*' || p === '/api*')) add('worker-first routes', 'fail', 'Set assets.run_worker_first to ["/api/*"] so /api (and the /api/ws socket) always reaches the worker, even under the SPA fallback.');
    else add('worker-first routes', 'ok', rwf.join(', '));
  }

  // 5. Durable Objects: same classes, bindings and migration tags as dev.
  const d = doShape(cfg);
  if (!d.bindings.length) add('durable objects', 'fail', 'No durable_objects.bindings.');
  else if (dev) {
    const dd = doShape(dev);
    const same = JSON.stringify(d) === JSON.stringify(dd);
    add('durable objects', same ? 'ok' : 'fail', same ? `${d.bindings.join(', ')}; migrations ${(cfg.migrations ?? []).map((m) => m.tag).join(', ')}` : `Bindings or migrations differ from the dev config. Dev: ${dd.bindings.join(', ')} / ${(dev.migrations ?? []).map((m) => m.tag).join(', ')}. Deploy: ${d.bindings.join(', ')} / ${(cfg.migrations ?? []).map((m) => m.tag).join(', ')}.`);
  }
  const legacy = (cfg.migrations ?? []).flatMap((m) => m.new_classes ?? []);
  if (legacy.length) add('durable object storage', 'fail', `${legacy.join(', ')} use new_classes (KV storage); the code needs SQLite (new_sqlite_classes).`);

  // 6. D1 and R2.
  const db = (cfg.d1_databases ?? []).find((x) => x.binding === 'DB');
  if (!db) add('D1 binding', 'fail', 'No d1_databases entry with binding "DB".');
  else if (isPlaceholder(db.database_id)) add('D1 binding', 'fail', `database_id is a placeholder. Run \`npx wrangler d1 create ${db.database_name ?? 'headcount-test'}\` and paste the id.`);
  else add('D1 binding', 'ok', `${db.database_name} (${db.database_id.slice(0, 8)}…)`);
  if (db) {
    // The same migration files as dev, numbered without gaps or duplicates; wrangler applies them in name order.
    const migDir = resolve(workerDir, db.migrations_dir ?? 'migrations');
    const devDb = (dev?.d1_databases ?? []).find((x) => x.binding === 'DB');
    const devMigDir = devDb ? resolve(dirname(devConfigPath), devDb.migrations_dir ?? 'migrations') : null;
    const files = existsSync(migDir) ? readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort() : [];
    const nums = files.map((f) => /^(\d{4})_[\w.-]+\.sql$/.exec(f)?.[1]);
    const misnamed = files.filter((_, i) => !nums[i]);
    const dupes = nums.filter((n, i) => n && nums.indexOf(n) !== i);
    if (!files.length) add('D1 migrations', 'fail', `No .sql files in ${relative(root, migDir)}: the remote database would have no tables.`);
    else if (misnamed.length || dupes.length) add('D1 migrations', 'fail', `${[...misnamed, ...dupes.map((n) => `${n}_* twice`)].join(', ')}: name them NNNN_description.sql, one number each.`);
    else if (devMigDir && devMigDir !== migDir) add('D1 migrations', 'fail', `migrations_dir differs from the dev config (${relative(root, devMigDir)} vs ${relative(root, migDir)}): the deployed schema would drift from the tested one.`);
    else add('D1 migrations', 'ok', `${files.join(', ')}. Apply before each deploy: \`npx wrangler d1 migrations apply ${db.database_name} --remote -c ${relative(workerDir, configPath)}\` (the preflight cannot see the remote state).`);
  }
  const r2 = (cfg.r2_buckets ?? []).find((x) => x.binding === 'BLOBS');
  if (!r2 || isPlaceholder(r2.bucket_name)) add('R2 binding', 'fail', 'No r2_buckets entry with binding "BLOBS" and a bucket_name.');
  else add('R2 binding', 'ok', `${r2.bucket_name} (keep it private: no public access, no r2.dev URL)`);

  // 7. Vars: dev leftovers, origins, secrets. A smoke deploy passes the Mock overrides on the command line.
  const fileVars = cfg.vars ?? {};
  const vars = { ...fileVars, ...(opts.smoke ? SMOKE_VARS : {}) };
  if (opts.smoke) add('smoke deploy', 'info', `Keyless: deploy with ${Object.entries(SMOKE_VARS).map(([k, v]) => `--var ${k}:${v}`).join(' ')} and set no secrets until the full preflight passes.`);
  const ollama = fileVars.OLLAMA_BASE_URL;
  const ollamaLeftovers = Object.keys(fileVars).filter((k) => k.startsWith('OLLAMA_') && k !== 'OLLAMA_BASE_URL');
  if (ollama) {
    let host = '';
    try {
      host = new URL(ollama).hostname;
    } catch {
      /* unparsable */
    }
    const unreachable = !host || isLoopbackHost(host) || isPrivateHost(host);
    add('Ollama', unreachable ? 'fail' : 'warn', unreachable ? `OLLAMA_BASE_URL=${ollama} is on the owner's machine or network; a deployed Worker cannot reach it, and /api/capabilities probes it on every call. Remove it.` : `OLLAMA_BASE_URL points at ${host}; make sure that server is meant to be reachable from the internet.`);
  } else add('Ollama', 'ok', `disabled (no OLLAMA_BASE_URL)${ollamaLeftovers.length ? `; ${ollamaLeftovers.join(', ')} can go (unused without it)` : ''}`);
  // The file itself must be production-shaped: Mock for the smoke deploy comes from --var, never from the file.
  const mockInFile = ['ENABLE_MOCK', 'MOCK_MEDIA'].filter((k) => fileVars[k] === 'true').concat(fileVars.DEFAULT_CHAT === 'mock' ? ['DEFAULT_CHAT'] : []);
  if (mockInFile.length) {
    add('mock provider', opts.smoke ? 'warn' : 'fail', `${mockInFile.map((k) => `${k}=${fileVars[k]}`).join(', ')} in the config. Set ENABLE_MOCK "false", DEFAULT_CHAT "auto" and MOCK_MEDIA "false" in the file; the keyless smoke deploy passes Mock with --var. With keys, Mock answers whenever a provider is missing, which hides misconfiguration.`);
  } else add('mock provider', 'ok', opts.smoke ? 'off in the file; Mock only through the smoke --var overrides' : 'off');
  const origins = String(vars.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const badOrigins = origins.filter((o) => {
    try {
      const u = new URL(o);
      return isPlaceholder(o) || u.protocol !== 'https:' || isLoopbackHost(u.hostname) || u.origin !== o;
    } catch {
      return true;
    }
  });
  if (!origins.length) add('allowed origins', 'fail', 'ALLOWED_ORIGINS is empty: the worker falls back to the localhost dev ports and 403s the deployed app (src/lib/origin.ts).');
  else if (badOrigins.length) add('allowed origins', 'fail', `ALLOWED_ORIGINS has entries that are not exact https origins of the deployment: ${badOrigins.join(', ')}.`);
  else add('allowed origins', 'ok', origins.join(', '));
  if (!vars.WORKSPACE_ID) add('workspace id', 'warn', 'WORKSPACE_ID is unset; the worker needs it (keep "local" to reuse migrated ws/local/* clips).');
  const secretVars = Object.entries(vars).filter(([k, v]) => (SECRET_NAME.test(k) && !/^ACCESS_/.test(k)) || KEY_PATTERNS.some((p) => p.re.test(String(v))));
  if (secretVars.length) add('no secrets in vars', 'fail', `${secretVars.map(([k]) => k).join(', ')} look like secrets. vars are plain text in the config and dashboard; use \`wrangler secret put\`.`);
  else add('no secrets in vars', 'ok', 'provider keys are expected as secrets (wrangler secret put)');

  // 8. Spending limits.
  const missing = Object.keys(BUDGETS).filter((k) => vars[k] === undefined || vars[k] === '');
  const high = Object.entries(BUDGETS).filter(([k, max]) => vars[k] !== undefined && vars[k] !== '' && Number(vars[k]) > max);
  const invalid = Object.keys(BUDGETS).filter((k) => vars[k] !== undefined && vars[k] !== '' && !(Number.isInteger(Number(vars[k])) && Number(vars[k]) >= 0));
  if (invalid.length) add('spending limits', 'fail', `${invalid.join(', ')} are not whole numbers (the worker would silently use the dev defaults).`);
  else if (missing.length || high.length) {
    add('spending limits', 'warn', [missing.length ? `unset (dev-sized defaults apply): ${missing.join(', ')}` : '', high.length ? `above the test ceiling: ${high.map(([k, max]) => `${k}=${vars[k]} (>${max})`).join(', ')}` : ''].filter(Boolean).join('; '));
  } else add('spending limits', 'ok', Object.keys(BUDGETS).map((k) => `${k}=${vars[k]}`).join(' '));

  // 9. Auth. The owner chose Google sign-in (AUTH_MODE=google, src/auth/auth.ts); Cloudflare Access is the fallback path.
  const workerSrc = walk(join(root, 'apps/worker/src')).filter((f) => f.rel.endsWith('.ts') && !f.rel.includes('.test.'));
  if (String(vars.AUTH_MODE ?? '').toLowerCase() === 'google') {
    const problems = [];
    if (isPlaceholder(vars.GOOGLE_CLIENT_ID) || !/\.apps\.googleusercontent\.com$/.test(String(vars.GOOGLE_CLIENT_ID))) problems.push('GOOGLE_CLIENT_ID is unset or not a Google web client id');
    let appOrigin = null;
    try {
      appOrigin = new URL(String(vars.APP_ORIGIN)).origin;
    } catch {
      problems.push('APP_ORIGIN is not a URL');
    }
    if (appOrigin && !appOrigin.startsWith('https://')) problems.push(`APP_ORIGIN=${vars.APP_ORIGIN} must be https (the session cookie is Secure)`);
    if (appOrigin && !String(vars.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).includes(appOrigin)) problems.push('APP_ORIGIN is not in ALLOWED_ORIGINS');
    for (const k of ['GOOGLE_CLIENT_SECRET', 'OWNER_EMAILS']) if (k in vars) problems.push(`${k} is a plain var: it must be a Worker secret (wrangler secret put ${k})`);
    add('google sign-in config', problems.length ? 'fail' : 'ok', problems.length ? problems.join('; ') : `client ${String(vars.GOOGLE_CLIENT_ID).slice(0, 12)}…, origin ${appOrigin}`);
    const index = existsSync(join(root, 'apps/worker/src/index.ts')) ? readFileSync(join(root, 'apps/worker/src/index.ts'), 'utf8') : '';
    const gated = /requireSession\(/.test(index) && /handleAuthRoute\(/.test(index) && existsSync(join(root, 'apps/worker/src/auth/auth.ts'));
    add('worker requires a session', gated ? 'ok' : 'fail', gated ? 'index.ts gates /api with requireSession (src/auth/auth.ts); owner secrets checked at deploy time: GOOGLE_CLIENT_SECRET, OWNER_EMAILS' : 'apps/worker/src/index.ts does not call requireSession/handleAuthRoute: the API would be open.');
  } else {
    const accessVars = ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'].filter((k) => isPlaceholder(vars[k]));
    if (accessVars.length) add('access config', opts.smoke ? 'warn' : 'fail', `${accessVars.join(', ')} unset or placeholder, and AUTH_MODE is not "google". The API would have no login: anyone with the URL spends the provider keys (DEPLOY.md §4).${opts.smoke ? ' Acceptable only for the keyless smoke deploy.' : ''}`);
    else if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(vars.ACCESS_TEAM_DOMAIN)) add('access config', 'warn', `ACCESS_TEAM_DOMAIN=${vars.ACCESS_TEAM_DOMAIN} is not https://<team>.cloudflareaccess.com (no trailing slash).`);
    else add('access config', 'ok', vars.ACCESS_TEAM_DOMAIN);
    const verifies = workerSrc.some((f) => /cf-access-jwt-assertion/i.test(readFileSync(f.full, 'utf8')));
    if (!verifies) {
      add('worker verifies Access', opts.acceptAccessOnly || opts.smoke ? 'warn' : 'fail','No code in apps/worker/src reads Cf-Access-Jwt-Assertion, so the API trusts any request that reaches it (Access misconfigured, another hostname). Add src/lib/access.ts (DEPLOY.md §4), or pass --accept-access-only once Access is confirmed on the only hostname.');
    } else add('worker verifies Access', 'ok', 'Cf-Access-Jwt-Assertion is checked in apps/worker/src');
  }

  // 10. Dev-only surfaces.
  const ignoreText = distDir && existsSync(join(distDir, '.assetsignore')) ? readFileSync(join(distDir, '.assetsignore'), 'utf8') : '';
  const ignored = assetsIgnoreMatcher(ignoreText);
  const distFiles = distDir ? walk(distDir) : [];
  const shipped = distFiles.filter((f) => !ignored(f.rel));
  const devPages = shipped.filter((f) => /^dev\//.test(f.rel));
  if (devPages.length) add('dev pages', 'fail', `${devPages.map((f) => f.rel).join(', ')} would be published. Add "dev/" to apps/web/public/.assetsignore (or move the page out of public/).`);
  else add('dev pages', 'ok', 'none published');
  const secretFiles = shipped.filter((f) => SECRET_FILE.test(f.rel));
  if (secretFiles.length) add('secret files', 'fail', `${secretFiles.map((f) => f.rel).join(', ')} would be published. Remove them from apps/web/public (and the build).`);
  else add('secret files', 'ok', 'no .dev.vars, .env, .wrangler, .pem or .key file in the build');
  const maps = shipped.filter((f) => f.rel.endsWith('.map'));
  if (maps.length) add('source maps', 'warn', `${maps.length} source maps (${(maps.reduce((a, f) => a + f.size, 0) / MiB).toFixed(1)} MiB) would be published. Fine behind Access; add "*.map" to .assetsignore to keep them local.`);
  const indexTs = existsSync(join(root, 'apps/worker/src/index.ts')) ? readFileSync(join(root, 'apps/worker/src/index.ts'), 'utf8') : '';
  const mediaSrc = existsSync(join(root, 'apps/worker/src/media/media-images.ts')) ? readFileSync(join(root, 'apps/worker/src/media/media-images.ts'), 'utf8') : '';
  if (/handleMediaRoute\(/.test(indexTs) && !/ENABLE_MEDIA_TOOLS/.test(mediaSrc + indexTs)) {
    add('media tooling route', 'warn', `POST /api/media/image (generic image generation for scripts/marketing-images.mjs) is live and ungated; only PORTRAIT_DAILY_LIMIT (${vars.PORTRAIT_DAILY_LIMIT ?? 'default 200'}) caps it.`);
  } else if (vars.ENABLE_MEDIA_TOOLS === 'true') add('media tooling route', 'warn', 'ENABLE_MEDIA_TOOLS=true exposes POST /api/media/image; turn it on only while running scripts/marketing-images.mjs.');

  // 11. Build integrity and freshness.
  if (distDir && existsSync(join(distDir, 'index.html'))) {
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    if (/src="\/src\/main\.tsx"/.test(html)) add('release build', 'fail', 'dist/index.html still points at /src/main.tsx: it is the dev index, not a `vite build` output.');
    const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    const missingRefs = refs.filter((r) => !existsSync(join(distDir, r)));
    if (missingRefs.length) add('release build', 'fail', `index.html references missing files: ${missingRefs.join(', ')}. Rebuild.`);
    const jsFiles = shipped.filter((f) => /\.m?js$/.test(f.rel));
    const broken = jsFiles.map((f) => ({ f, r: parsesAsModule(f.full) })).filter((x) => !x.r.ok);
    if (broken.length) add('bundles parse', 'fail', broken.map((x) => `${x.f.rel}: ${x.r.detail}`).join('; '));
    else add('bundles parse', 'ok', `${jsFiles.length} JavaScript files parse as modules`);
    const built = statSync(join(distDir, 'index.html')).mtimeMs;
    const src = newestMtime([join(root, 'apps/web/src'), join(root, 'apps/web/public'), ...['protocol', 'avatar', 'audio', 'office', 'catalog', 'expressions'].map((p) => join(root, 'packages', p, 'src'))].filter(existsSync));
    if (src.newest > built + 1000) add('build freshness', 'warn', `${relative(root, src.file)} changed after the last build (${new Date(built).toISOString()}). Run \`pnpm build\` again.`);
    else add('build freshness', 'ok', `built ${new Date(built).toISOString()}`);
  }
  for (const gen of ['packages/catalog/generated/full.js', 'packages/expressions/generated/expressions.json']) {
    if (!existsSync(join(root, gen))) add('generated bundles', 'fail', `${gen} is missing; run \`pnpm build\` (catalog:build, expressions:build) before bundling the worker.`);
  }

  // 12. Asset limits.
  if (distDir) {
    const tooBig = shipped.filter((f) => f.size > MAX_ASSET_BYTES);
    const total = shipped.reduce((a, f) => a + f.size, 0);
    if (tooBig.length) add('asset limits', 'fail', `Over 25 MiB per file: ${tooBig.map((f) => f.rel).join(', ')}.`);
    else if (shipped.length > plan.assetCount) add('asset limits', 'fail', `${shipped.length} files is over the plan's ${plan.assetCount} asset limit.`);
    else add('asset limits', 'ok', `${shipped.length} files, ${(total / MiB).toFixed(1)} MiB, largest ${shipped.length ? `${(Math.max(...shipped.map((f) => f.size)) / MiB).toFixed(2)} MiB` : '-'}`);
  }

  // 13. Security headers and the CSP.
  if (distDir && existsSync(join(distDir, 'index.html'))) {
    const headersPath = join(distDir, '_headers');
    if (!existsSync(headersPath)) add('security headers', 'warn', 'No _headers in the build: no CSP, no frame-ancestors, and hashed /assets/* are revalidated on every load. Add apps/web/public/_headers (DEPLOY.md §3).');
    else {
      const rules = parseHeadersFile(readFileSync(headersPath, 'utf8'));
      const all = rules.find((r) => r.pattern === '/*')?.headers ?? {};
      const csp = all['content-security-policy'] ?? all['content-security-policy-report-only'];
      const wanted = ['x-content-type-options', 'referrer-policy', 'permissions-policy'];
      const lacking = wanted.filter((h) => !all[h]);
      if (!csp) add('security headers', 'warn', 'The /* rule in _headers has no Content-Security-Policy.');
      else {
        const hashes = inlineScriptHashes(readFileSync(join(distDir, 'index.html'), 'utf8'));
        const scriptSrc = /(?:^|;)\s*script-src\s+([^;]+)/.exec(csp)?.[1] ?? /(?:^|;)\s*default-src\s+([^;]+)/.exec(csp)?.[1] ?? '';
        const unhashed = /'unsafe-inline'/.test(scriptSrc) ? [] : hashes.filter((h) => !scriptSrc.includes(h));
        if (unhashed.length) add('security headers', 'fail', `The CSP blocks index.html's inline theme script. Add ${unhashed.join(' ')} to script-src (the hash changes when that script or the hero image changes).`);
        else if (!/frame-ancestors/.test(csp)) add('security headers', 'warn', 'The CSP has no frame-ancestors (clickjacking).');
        else add('security headers', all['content-security-policy'] ? 'ok' : 'warn', `${all['content-security-policy'] ? 'CSP enforced' : 'CSP is report-only'}${lacking.length ? `; missing ${lacking.join(', ')}` : ''}`);
      }
      const assetRule = rules.find((r) => r.pattern === '/assets/*');
      if (!/immutable/.test(assetRule?.headers['cache-control'] ?? '')) add('asset caching', 'warn', 'Add a "/assets/*" rule with Cache-Control: public, max-age=31536000, immutable (Vite hashes those names).');
      else add('asset caching', 'ok', '/assets/* immutable');
    }
  }

  // 14. Secrets in anything that ships.
  let values = [];
  if (opts.devVars) {
    const p = resolve(root, opts.devVars);
    if (existsSync(p)) values = secretValues(readFileSync(p, 'utf8'));
  }
  const scanFiles = [...shipped, ...(opts.bundle?.files ?? [])];
  const hits = scanForSecrets(scanFiles, values);
  if (hits.length) add('no secrets in published files', 'fail', hits.join('; '));
  else add('no secrets in published files', 'ok', `${scanFiles.length} files scanned for key patterns${opts.devVars ? `${values.length ? ` and ${values.length} local secret value(s)` : ' (no local secret values found)'}` : ' (local secret values skipped: --no-dev-vars)'}`);

  // 15. Worker bundle size: the uncompressed upload counts (64 MiB on both plans since 2026-09-04); gzip is shown only.
  if (opts.bundle?.rawBytes !== undefined) {
    const raw = opts.bundle.rawBytes;
    const pct = Math.round((raw / plan.bundleRaw) * 100);
    const level = raw > plan.bundleRaw ? 'fail' : raw > plan.bundleRaw * 0.8 ? 'warn' : 'ok';
    const gz = opts.bundle.gzipBytes !== undefined ? `, ${(opts.bundle.gzipBytes / MiB).toFixed(2)} MiB gzip (informational)` : '';
    add('worker bundle size', level, `${(raw / MiB).toFixed(2)} MiB uncompressed = ${pct}% of the ${plan.bundleRaw / MiB} MiB limit${gz}. packages/catalog/generated/full.js and expressions.json are most of it. Startup must stay under 1 s (\`npx wrangler check startup\`).`);
  } else if (opts.bundleError) add('worker bundle size', 'fail', opts.bundleError);
  else add('worker bundle size', 'info', 'skipped (--skip-bundle)');

  // 16. Plan: CPU per request is the real difference now.
  if ((opts.plan ?? 'paid') === 'free') add('workers plan', 'warn', `Free allows ${PLAN_LIMITS.free.cpuMs} ms CPU per request: chat turns, prompt building from the catalog and stream parsing in the Durable Objects are likely to exceed it (error 1102). Use Free for the keyless smoke deploy only; Workers Paid for keys.`);
  else add('workers plan', 'ok', `Paid: ${PLAN_LIMITS.paid.cpuMs / 1000} s CPU per request by default, ${PLAN_LIMITS.paid.assetCount.toLocaleString('en-US')} asset files per version`);

  // 17. .dev.vars stays out of git.
  try {
    execFileSync('git', ['check-ignore', '-q', 'apps/worker/.dev.vars'], { cwd: root, stdio: 'ignore' });
    add('.dev.vars ignored', 'ok', 'git ignores apps/worker/.dev.vars');
  } catch (e) {
    add('.dev.vars ignored', e?.status === 1 ? 'fail' : 'info', e?.status === 1 ? 'git does not ignore apps/worker/.dev.vars.' : 'not a git checkout; skipped');
  }

  return checks;
}

/**
 * `wrangler deploy --dry-run --outdir` into a temp dir → {rawBytes, gzipBytes, files}. Local only: bundles, uploads
 * nothing. rawBytes is wrangler's "Total Upload" (what the 64 MiB limit counts), else the sum of the emitted modules.
 */
export function bundleWorker(root, configPath) {
  const workerDir = dirname(configPath);
  const out = mkdtempSync(join(tmpdir(), 'hc-preflight-bundle-'));
  const bin = join(workerDir, 'node_modules/.bin/wrangler');
  const r = spawnSync(existsSync(bin) ? bin : 'npx', existsSync(bin) ? ['deploy', '--dry-run', '--outdir', out, '-c', configPath] : ['wrangler', 'deploy', '--dry-run', '--outdir', out, '-c', configPath], {
    cwd: workerDir,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8',
    maxBuffer: 64 * MiB,
  });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const emitted = walk(out).filter((f) => !f.rel.endsWith('.map') && f.rel !== 'README.md');
  const modules = emitted.filter((f) => /\.m?js$/.test(f.rel));
  if (r.status !== 0 || !modules.length) {
    rmSync(out, { recursive: true, force: true });
    return { error: `wrangler deploy --dry-run failed: ${text.split('\n').filter((l) => /error|✘/i.test(l)).slice(0, 3).join(' ') || `exit ${r.status}`}` };
  }
  const kib = (v, unit) => Number(v) * (/mib/i.test(unit) ? 1024 * 1024 : 1024);
  const reported = /Total Upload:\s*([\d.]+)\s*(KiB|MiB)\s*\/\s*gzip:\s*([\d.]+)\s*(KiB|MiB)/i.exec(text);
  const rawBytes = reported ? Math.round(kib(reported[1], reported[2])) : emitted.reduce((a, f) => a + f.size, 0);
  const gzipBytes = reported ? Math.round(kib(reported[3], reported[4])) : modules.reduce((a, f) => a + gzipSync(readFileSync(f.full)).byteLength, 0);
  return { rawBytes, gzipBytes, files: modules.map((f) => ({ ...f, label: `worker bundle ${f.rel}` })), cleanup: () => rmSync(out, { recursive: true, force: true }) };
}

function report(checks, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
    return;
  }
  const tag = { ok: 'ok  ', warn: 'warn', fail: 'FAIL', info: 'info' };
  console.log('Headcount deploy preflight (Cloudflare test deployment):');
  for (const c of checks) console.log(`  ${tag[c.level]} ${c.name}: ${c.message}`);
  const failed = checks.filter((c) => c.level === 'fail').length;
  const warned = checks.filter((c) => c.level === 'warn').length;
  if (failed) console.error(`${failed} check(s) failed${warned ? `, ${warned} warning(s)` : ''}: not ready to deploy.`);
  else console.log(`All checks passed${warned ? ` with ${warned} warning(s)` : ''}. Next: docs/DEPLOY.md §8.`);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const opt = (n, d) => {
    const i = args.indexOf(n);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };
  const known = new Set(['--config', '--dev-config', '--plan', '--dev-vars', '--no-dev-vars', '--skip-bundle', '--dist', '--accept-access-only', '--smoke', '--json']);
  const unknown = args.filter((a) => a.startsWith('-') && !known.has(a));
  if (unknown.length) throw new Error(`Unknown option ${unknown.join(', ')}. See the header of scripts/deploy-preflight.mjs.`);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const config = opt('--config', 'apps/worker/wrangler.deploy.jsonc');
  const plan = opt('--plan', 'paid');
  if (plan !== 'paid' && plan !== 'free') throw new Error('--plan is paid or free.');
  const opts = {
    root,
    config,
    devConfig: opt('--dev-config', 'apps/worker/wrangler.jsonc'),
    plan,
    dist: opt('--dist', null),
    devVars: flag('--no-dev-vars') ? null : opt('--dev-vars', 'apps/worker/.dev.vars'),
    acceptAccessOnly: flag('--accept-access-only'),
    smoke: flag('--smoke'),
  };
  let bundle = null;
  if (!flag('--skip-bundle') && existsSync(resolve(root, config))) {
    bundle = bundleWorker(root, resolve(root, config));
    if (bundle.error) opts.bundleError = bundle.error;
    else opts.bundle = bundle;
  }
  try {
    const checks = checkDeployment(opts);
    report(checks, flag('--json'));
    process.exitCode = checks.some((c) => c.level === 'fail') ? 1 : 0;
  } finally {
    bundle?.cleanup?.();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
