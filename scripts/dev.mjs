#!/usr/bin/env node
// pnpm dev — builds the catalog and expression bundles, applies local D1 migrations, then runs wrangler dev (worker, :8787)
// and Vite (web, :5173) with prefixed logs. Ctrl-C (or either process exiting) stops both.
//
// Flags:
//   --mock               keyless run: Mock chat (DEFAULT_CHAT=mock) and every provider key blanked, even if
//                        apps/worker/.dev.vars has keys (--var beats .dev.vars); email goes to the test mailbox — used by e2e
//   --local              local-only run: every cloud key blanked, Ollama kept (DEFAULT_CHAT=auto → Ollama when it
//                        answers, else Mock). Nothing leaves the machine.
//   --chat <provider>    pin the chat provider for this run (anthropic, openai, xai, gemini, openai-compatible,
//                        ollama), for example when one provider's account is out of credit. Coworkers that
//                        prefer Anthropic would still call it, so any other pin also blanks the Anthropic key
//                        (it serves chat only; voices and images keep their keys).
//   --mock-media         Mock TTS/STT answer and count as available (silent audio with timing, a fixed
//                        transcript): demos the provider voice path without keys. Off by default (keyless → 503).
//   --worker-port <n>    default 8787
//   --web-port <n>       default 5173
//   --persist-to <dir>   wrangler local state dir (relative to apps/worker); default .wrangler/state
//   --fresh              delete the persist dir first (clean DOs, D1, R2)
//   --no-watch           do not rebuild the catalog and expression bundles when catalog/ changes
//
// Env: HEADCOUNT_ALLOWED_ORIGINS adds origins the worker accepts besides the web and worker ports.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, watch } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const workerPort = Number(opt('--worker-port', process.env.HEADCOUNT_WORKER_PORT ?? 8787));
const webPort = Number(opt('--web-port', process.env.HEADCOUNT_WEB_PORT ?? 5173));
const persistTo = opt('--persist-to', null);
const workerDir = join(root, 'apps/worker');
const webDir = join(root, 'apps/web');
const bin = (dir, name) => join(dir, 'node_modules/.bin', name);

const COLORS = { catalog: '\x1b[35m', expressions: '\x1b[95m', db: '\x1b[36m', worker: '\x1b[33m', web: '\x1b[32m', dev: '\x1b[34m' };
const tty = process.stdout.isTTY;
const tag = (name) => (tty ? `${COLORS[name] ?? ''}[${name}]\x1b[0m` : `[${name}]`);
const log = (name, line) => process.stdout.write(`${tag(name)} ${line}\n`);

function pipe(name, stream) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) log(name, line);
  });
  stream.on('end', () => buf.trim() && log(name, buf));
}

// 0. Fail fast when a port is taken (a stale server would otherwise answer the readiness check).
const portFree = (port, host) =>
  new Promise((resolveFree) => {
    const srv = createServer()
      .once('error', () => resolveFree(false))
      .once('listening', () => srv.close(() => resolveFree(true)))
      .listen(port, host);
  });
for (const [name, port, host, flagName] of [
  ['worker', workerPort, '127.0.0.1', '--worker-port'],
  ['web', webPort, 'localhost', '--web-port'],
]) {
  if (!(await portFree(port, host))) {
    log('dev', `port ${port} (${name}) is already in use. Stop the other server (lsof -nP -iTCP:${port} -sTCP:LISTEN) or pass ${flagName} <n>.`);
    process.exit(1);
  }
}

// 1. Catalog bundle (tolerates files still being edited).
const { writeBundles } = await import(join(root, 'packages/catalog/scripts/build-catalog.mjs'));
try {
  const { report } = writeBundles({ quiet: true });
  log('catalog', `${report.counts.leads} leads, ${report.counts.personas} personas${report.warnings.length ? `, ${report.warnings.length} warning(s)` : ''}`);
} catch (err) {
  log('catalog', `build failed: ${err.message}`);
}

// 1b. Expression bundle (the living workforce's lines; the worker imports it, the web fetches it from the worker).
const buildExpressions = () => {
  const r = spawnSync(process.execPath, [join(root, 'packages/expressions/scripts/build-expressions.mjs'), '--quiet'], { cwd: root, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').filter(Boolean);
  if (r.status !== 0) log('expressions', `build failed: ${out.slice(-3).join(' · ') || `exit ${r.status}`}`);
  return { ok: r.status === 0, changed: r.status === 0 && !/\(unchanged\)/.test(out.at(-1) ?? ''), summary: (out.at(-1) ?? '').replace(/ → .*$/, '') };
};
{
  const { ok, summary } = buildExpressions();
  if (ok) log('expressions', summary);
}

// 2. Local D1 migrations (non-interactive).
const persistArgs = persistTo ? ['--persist-to', persistTo] : [];
if (flag('--fresh')) {
  const dir = join(workerDir, persistTo ?? '.wrangler/state');
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  log('dev', `cleared ${dir}`);
}
const migrate = spawnSync(bin(workerDir, 'wrangler'), ['d1', 'migrations', 'apply', 'DB', '--local', ...persistArgs], {
  cwd: workerDir,
  env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  encoding: 'utf8',
});
for (const line of `${migrate.stdout ?? ''}${migrate.stderr ?? ''}`.split('\n')) if (/applied|✅|No migrations|error|Error/i.test(line)) log('db', line.trim());
if (migrate.status !== 0) {
  log('db', 'migrations failed; stopping.');
  process.exit(migrate.status ?? 1);
}

// 3. Worker + web.
const children = new Map();
let stopping = false;

function start(name, command, argv, cwd, env = {}) {
  // Same process group as this script: a group kill (terminal Ctrl-C, Playwright teardown) reaches every child.
  const child = spawn(command, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  pipe(name, child.stdout);
  pipe(name, child.stderr);
  child.on('exit', (code, signal) => {
    children.delete(name);
    if (!stopping) {
      log('dev', `${name} exited (${signal ?? code}); stopping.`);
      stop(code ?? 1);
    }
  });
  children.set(name, child);
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const [, child] of children) child.kill('SIGTERM'); // wrangler stops its workerd on SIGTERM
  setTimeout(() => {
    for (const [, child] of children) child.kill('SIGKILL');
    process.exit(code);
  }, 4000).unref();
  if (!children.size) process.exit(code);
  const check = setInterval(() => {
    if (!children.size) {
      clearInterval(check);
      process.exit(code);
    }
  }, 100);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(0));

const workerArgs = ['dev', '--port', String(workerPort), '--ip', '127.0.0.1', ...persistArgs];
// Only the app's own pages may call the API or open the feed (the worker answers 403 to other origins).
// HEADCOUNT_ALLOWED_ORIGINS (comma-separated) adds more, e.g. a LAN address you open the app from.
const allowedOrigins = [
  ...['localhost', '127.0.0.1', '[::1]'].flatMap((h) => [`http://${h}:${webPort}`, `http://${h}:${workerPort}`]),
  ...(process.env.HEADCOUNT_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
];
workerArgs.push('--var', `ALLOWED_ORIGINS:${allowedOrigins.join(',')}`);
const CLOUD_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_API_KEY'];
if (flag('--mock')) {
  workerArgs.push('--var', 'DEFAULT_CHAT:mock', '--var', 'ENABLE_MOCK:true');
  // Keyless runs never send real email: the test mailbox inside Headcount (Inc 6).
  workerArgs.push('--var', 'MAIL_PROVIDER:sink', '--var', 'RESEND_API_KEY:');
  for (const key of [...CLOUD_KEYS, 'OLLAMA_BASE_URL']) workerArgs.push('--var', `${key}:`);
} else if (flag('--local')) {
  workerArgs.push('--var', 'DEFAULT_CHAT:auto', '--var', 'ENABLE_MOCK:true');
  for (const key of CLOUD_KEYS) workerArgs.push('--var', `${key}:`);
}
if (flag('--mock-media')) workerArgs.push('--var', 'MOCK_MEDIA:true');
const chat = !flag('--mock') && !flag('--local') ? opt('--chat', null) : null;
if (chat) workerArgs.push('--var', `DEFAULT_CHAT:${chat}`);
if (chat && chat !== 'anthropic') workerArgs.push('--var', 'ANTHROPIC_API_KEY:');
start('worker', bin(workerDir, 'wrangler'), workerArgs, workerDir, { WRANGLER_SEND_METRICS: 'false' });
start('web', bin(webDir, 'vite'), ['--port', String(webPort), '--strictPort'], webDir, {
  HEADCOUNT_WEB_PORT: String(webPort),
  HEADCOUNT_WORKER_PORT: String(workerPort),
});

// 4. Rebuild the catalog bundle when catalog/ changes, and the expression bundle when catalog/expressions/ changes
//    (Vite and wrangler reload on a new bundle; an unchanged bundle is not rewritten).
if (!flag('--no-watch')) {
  let timer = null;
  let exprTimer = null;
  try {
    watch(join(root, 'catalog'), { recursive: true }, (_e, file) => {
      if (file && !String(file).endsWith('.json')) return;
      if (file && /^expressions[\\/]/.test(String(file))) {
        clearTimeout(exprTimer);
        exprTimer = setTimeout(() => {
          const { changed, summary } = buildExpressions();
          if (changed) log('expressions', `rebuilt: ${summary}`);
        }, 500);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const { changed, report } = writeBundles({ quiet: true });
          if (changed) log('catalog', `rebuilt: ${report.counts.leads} leads, ${report.counts.personas} personas`);
        } catch (err) {
          log('catalog', `rebuild failed: ${err.message}`);
        }
      }, 500);
    });
  } catch (err) {
    log('catalog', `watch unavailable: ${err.message}`);
  }
}

// 5. Announce when both answer.
const deadline = Date.now() + 90_000;
(async function ready() {
  while (!stopping && Date.now() < deadline) {
    try {
      const [w, v] = await Promise.all([
        fetch(`http://127.0.0.1:${workerPort}/api/health`).then((r) => r.ok),
        fetch(`http://localhost:${webPort}/api/health`).then((r) => r.ok),
      ]);
      if (w && v) {
        log('dev', `ready → http://localhost:${webPort}  (worker http://127.0.0.1:${workerPort})`);
        return;
      }
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
})();
