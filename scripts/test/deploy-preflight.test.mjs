// node --test scripts/test/*.test.mjs   (plain node:test; the scripts are not part of the Vitest workspace projects)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { assetsIgnoreMatcher, checkDeployment, inlineScriptHashes, isPlaceholder, parseHeadersFile, parseJsonc, secretValues } from '../deploy-preflight.mjs';

const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const INLINE = "document.documentElement.dataset.theme = 'dark';";
const HASH = `'sha256-${createHash('sha256').update(INLINE).digest('base64')}'`;
const DO = {
  durable_objects: { bindings: [{ name: 'WORKSPACE', class_name: 'WorkspaceDO' }, { name: 'RUN', class_name: 'RunDO' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['WorkspaceDO', 'RunDO'] }],
};
const goodDeploy = () => ({
  name: 'headcount-test',
  main: 'src/index.ts',
  compatibility_date: '2026-09-01',
  compatibility_flags: ['nodejs_compat'],
  workers_dev: true,
  preview_urls: false,
  assets: { directory: '../web/dist', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
  ...DO,
  d1_databases: [{ binding: 'DB', database_name: 'headcount-test', database_id: '3f2c9a4e-1b7d-4c55-9e0a-2d6f8b1c7a90', migrations_dir: 'migrations' }],
  r2_buckets: [{ binding: 'BLOBS', bucket_name: 'headcount-test-blobs' }],
  vars: {
    WORKSPACE_ID: 'local',
    ENABLE_MOCK: 'false',
    DEFAULT_CHAT: 'auto',
    ALLOWED_ORIGINS: 'https://headcount-test.example.workers.dev',
    ACCESS_TEAM_DOMAIN: 'https://acme.cloudflareaccess.com',
    ACCESS_AUD: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    CHAT_DAILY_LIMIT: '300',
    JOB_DAILY_LIMIT: '10',
    MAX_ACTIVE_JOBS: '2',
    TTS_DAILY_LIMIT: '500',
    STT_DAILY_LIMIT: '100',
    PORTRAIT_DAILY_LIMIT: '10',
    EXPR_CLIP_DAILY_LIMIT: '200',
    EXPR_RENDER_PER_MIN: '10',
    EXPR_PREVOICE_MAX_CLIPS: '100',
  },
});

/** A minimal repo that passes every check; `files` adds or replaces files, `access: false` drops the JWT check. */
function fixture({ deploy = goodDeploy(), files = {}, access = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hc-preflight-test-'));
  roots.push(root);
  const put = (rel, content) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  };
  put('apps/worker/wrangler.jsonc', `{\n  // dev\n  "name": "headcount", "compatibility_date": "2026-09-01", "compatibility_flags": ["nodejs_compat"],\n  ${JSON.stringify(DO).slice(1, -1)},\n}`);
  put('apps/worker/wrangler.deploy.jsonc', JSON.stringify(deploy));
  put('apps/worker/migrations/0001_init.sql', 'CREATE TABLE t (id TEXT);');
  put('apps/worker/src/index.ts', access ? "const jwt = req.headers.get('Cf-Access-Jwt-Assertion');" : 'export default {};');
  put('packages/catalog/generated/full.js', 'export default {};');
  put('packages/expressions/generated/expressions.json', '{}');
  put('apps/web/dist/index.html', `<!doctype html><html><head><script>${INLINE}</script><script type="module" crossorigin src="/assets/index-abc.js"></script></head><body><div id="app"></div></body></html>`);
  put('apps/web/dist/assets/index-abc.js', 'export const x = 1;\n');
  put('apps/web/dist/_headers', `/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' ${HASH}; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: microphone=(self)\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
  put('apps/web/dist/.assetsignore', 'dev/\n*.map\n');
  for (const [rel, content] of Object.entries(files)) put(rel, content);
  return root;
}

const run = (root, extra = {}) => checkDeployment({ root, devVars: null, ...extra });
const byName = (checks, name) => checks.find((c) => c.name === name);
const fails = (checks) => checks.filter((c) => c.level === 'fail').map((c) => c.name);

describe('helpers', () => {
  it('parses JSONC with comments, // inside strings and trailing commas', () => {
    const v = parseJsonc('{\n // c\n "a": "http://x/*y*/", /* b */ "b": [1, 2,],\n}');
    assert.deepEqual(v, { a: 'http://x/*y*/', b: [1, 2] });
  });
  it('recognises placeholders', () => {
    for (const p of ['<database id>', '00000000-0000-4000-8000-000000000000', 'TODO', '', undefined, 'your-bucket']) assert.equal(isPlaceholder(p), true, String(p));
    for (const p of ['3f2c9a4e-1b7d-4c55-9e0a-2d6f8b1c7a90', 'headcount-test-blobs']) assert.equal(isPlaceholder(p), false, p);
  });
  it('matches .assetsignore patterns like wrangler', () => {
    const m = assetsIgnoreMatcher('dev/\n*.map\n/secret.txt\n# comment\n');
    assert.equal(m('dev/landmarks.html'), true);
    assert.equal(m('assets/app.js.map'), true);
    assert.equal(m('secret.txt'), true);
    assert.equal(m('nested/secret.txt'), false);
    assert.equal(m('_headers'), true);
    assert.equal(m('assets/app.js'), false);
    assert.equal(m('marketing/dev.webp'), false);
  });
  it('hashes inline scripts only', () => {
    assert.deepEqual(inlineScriptHashes(`<script>${INLINE}</script><script src="/a.js"></script>`), [HASH]);
  });
  it('parses _headers', () => {
    const rules = parseHeadersFile('/*\n  X-A: 1\n  X-B: two: parts\n/assets/*\n  Cache-Control: immutable\n');
    assert.deepEqual(rules, [
      { pattern: '/*', headers: { 'x-a': '1', 'x-b': 'two: parts' } },
      { pattern: '/assets/*', headers: { 'cache-control': 'immutable' } },
    ]);
  });
  it('reads secret-looking values from a dotenv file', () => {
    const s = secretValues('OPENAI_API_KEY="abcdefghijklmnop"\nENABLE_MOCK=true\nSHORT_KEY=abc\n# X_TOKEN=commented1234567\nXAI_API_KEY=xyzxyzxyzxyzxyz # note\n');
    assert.deepEqual(s.map((x) => x.name), ['OPENAI_API_KEY', 'XAI_API_KEY']);
    assert.equal(s[1].value, 'xyzxyzxyzxyzxyz');
  });
});

describe('checkDeployment', () => {
  it('passes a complete deployment', () => {
    const checks = run(fixture());
    assert.deepEqual(fails(checks), []);
    assert.equal(byName(checks, 'security headers').level, 'ok');
  });

  it('fails without a deploy config', () => {
    const root = fixture();
    rmSync(join(root, 'apps/worker/wrangler.deploy.jsonc'));
    assert.deepEqual(fails(run(root)), ['deploy config']);
  });

  it('fails a placeholder D1 id, dev origins, the Ollama URL and secrets in vars', () => {
    const deploy = goodDeploy();
    deploy.d1_databases[0].database_id = '00000000-0000-4000-8000-000000000000';
    deploy.vars.ALLOWED_ORIGINS = 'http://localhost:5173,https://headcount-test.example.workers.dev';
    deploy.vars.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    deploy.vars.OPENAI_API_KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD';
    const f = fails(run(fixture({ deploy })));
    for (const name of ['D1 binding', 'allowed origins', 'Ollama', 'no secrets in vars']) assert.ok(f.includes(name), name);
  });

  it('fails when Durable Object classes or tags drift from the dev config', () => {
    const deploy = goodDeploy();
    deploy.migrations = [{ tag: 'v1', new_sqlite_classes: ['WorkspaceDO'] }];
    assert.ok(fails(run(fixture({ deploy }))).includes('durable objects'));
  });

  it('fails assets that would 404 the SPA or skip the worker', () => {
    const deploy = goodDeploy();
    deploy.assets.run_worker_first = true;
    delete deploy.assets.not_found_handling;
    const f = fails(run(fixture({ deploy })));
    assert.ok(f.includes('worker-first routes') && f.includes('SPA fallback'));
  });

  it('fails a published dev page unless .assetsignore drops it', () => {
    const root = fixture({ files: { 'apps/web/dist/dev/landmarks.html': '<p>dev</p>', 'apps/web/dist/.assetsignore': '*.map\n' } });
    assert.ok(fails(run(root)).includes('dev pages'));
    const ok = fixture({ files: { 'apps/web/dist/dev/landmarks.html': '<p>dev</p>' } });
    assert.equal(byName(run(ok), 'dev pages').level, 'ok');
  });

  it('finds key patterns and local secret values without printing the value', () => {
    const value = 'zz-local-secret-value-1234567890';
    const root = fixture({ files: { 'apps/web/dist/assets/leak.js': `const k = "${value}"; const o = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";`, 'local.vars': `ANTHROPIC_API_KEY=${value}\n` } });
    const check = byName(run(root, { devVars: 'local.vars' }), 'no secrets in published files');
    assert.equal(check.level, 'fail');
    assert.match(check.message, /value of ANTHROPIC_API_KEY/);
    assert.match(check.message, /Anthropic key pattern/);
    assert.ok(!check.message.includes(value));
  });

  it('does not flag look-alikes such as desk- ids', () => {
    const root = fixture({ files: { 'apps/web/dist/assets/ok.js': 'const id = "desk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF";' } });
    assert.equal(byName(run(root), 'no secrets in published files').level, 'ok');
  });

  it("fails a CSP that would block index.html's inline script", () => {
    const root = fixture({ files: { 'apps/web/dist/_headers': "/*\n  Content-Security-Policy: default-src 'self'; frame-ancestors 'none'\n" } });
    const check = byName(run(root), 'security headers');
    assert.equal(check.level, 'fail');
    assert.ok(check.message.includes(HASH));
  });

  it('requires Access config and a worker-side JWT check (or an explicit waiver)', () => {
    const deploy = goodDeploy();
    deploy.vars.ACCESS_AUD = '<application audience (AUD) tag>';
    assert.ok(fails(run(fixture({ deploy }))).includes('access config'));
    const root = fixture({ access: false });
    assert.equal(byName(run(root), 'worker verifies Access').level, 'fail');
    assert.equal(byName(run(root, { acceptAccessOnly: true }), 'worker verifies Access').level, 'warn');
  });

  it('lets a keyless smoke deploy through before Access exists, with Mock forced on', () => {
    const deploy = goodDeploy();
    deploy.vars.ACCESS_AUD = '<application audience (AUD) tag>';
    const checks = run(fixture({ deploy, access: false }), { smoke: true });
    assert.deepEqual(fails(checks), []);
    assert.equal(byName(checks, 'access config').level, 'warn');
    assert.equal(byName(checks, 'worker verifies Access').level, 'warn');
    assert.match(byName(checks, 'smoke deploy').message, /--var ENABLE_MOCK:true --var DEFAULT_CHAT:mock --var MOCK_MEDIA:true/);
  });

  it('warns on unset or high spending limits, fails non-numbers', () => {
    const deploy = goodDeploy();
    delete deploy.vars.TTS_DAILY_LIMIT;
    deploy.vars.CHAT_DAILY_LIMIT = '5000';
    assert.equal(byName(run(fixture({ deploy })), 'spending limits').level, 'warn');
    deploy.vars.JOB_DAILY_LIMIT = 'ten';
    assert.equal(byName(run(fixture({ deploy })), 'spending limits').level, 'fail');
  });

  it('checks the uncompressed worker bundle against the 64 MiB limit on both plans (gzip is informational)', () => {
    const root = fixture();
    const MiB = 1024 * 1024;
    const bundle = (raw, gz = raw / 4) => ({ rawBytes: raw * MiB, gzipBytes: gz * MiB, files: [] });
    // 8.2 MiB raw / 1.8 MiB gzip (today's build) used to be 61% of Free's old 3 MiB gzip limit: now fine on both.
    assert.equal(byName(run(root, { plan: 'free', bundle: bundle(8.2, 1.8) }), 'worker bundle size').level, 'ok');
    assert.equal(byName(run(root, { plan: 'paid', bundle: bundle(8.2, 1.8) }), 'worker bundle size').level, 'ok');
    assert.equal(byName(run(root, { plan: 'paid', bundle: bundle(55) }), 'worker bundle size').level, 'warn');
    assert.equal(byName(run(root, { plan: 'free', bundle: bundle(65, 3) }), 'worker bundle size').level, 'fail');
    assert.match(byName(run(root, { bundle: bundle(8.2, 1.8) }), 'worker bundle size').message, /8\.20 MiB uncompressed = 13% of the 64 MiB limit, 1\.80 MiB gzip/);
    assert.equal(byName(run(root, { bundleError: 'wrangler deploy --dry-run failed: x' }), 'worker bundle size').level, 'fail');
  });

  it('warns that the Free plan CPU limit is too small for keyed use', () => {
    const root = fixture();
    assert.equal(byName(run(root, { plan: 'free' }), 'workers plan').level, 'warn');
    assert.equal(byName(run(root), 'workers plan').level, 'ok');
  });

  it('fails Mock settings in the file; the smoke deploy passes them with --var instead', () => {
    const deploy = goodDeploy();
    deploy.vars.ENABLE_MOCK = 'true';
    deploy.vars.DEFAULT_CHAT = 'mock';
    const full = byName(run(fixture({ deploy })), 'mock provider');
    assert.equal(full.level, 'fail');
    assert.match(full.message, /ENABLE_MOCK=true, DEFAULT_CHAT=mock/);
    assert.equal(byName(run(fixture({ deploy }), { smoke: true }), 'mock provider').level, 'warn');
    assert.equal(byName(run(fixture(), { smoke: true }), 'mock provider').level, 'ok');
  });

  it('fails an Ollama URL on the owner machine or LAN, and notes leftover model vars', () => {
    for (const url of ['http://127.0.0.1:11434', 'http://192.168.1.20:11434', 'http://gpu.local:11434', 'http://10.0.0.5:11434']) {
      const deploy = goodDeploy();
      deploy.vars.OLLAMA_BASE_URL = url;
      assert.equal(byName(run(fixture({ deploy })), 'Ollama').level, 'fail', url);
    }
    const deploy = goodDeploy();
    deploy.vars.OLLAMA_CHAT_MODEL = 'qwen3:32b';
    const ok = byName(run(fixture({ deploy })), 'Ollama');
    assert.equal(ok.level, 'ok');
    assert.match(ok.message, /OLLAMA_CHAT_MODEL can go/);
  });

  it('checks D1 migrations even while the database id is a placeholder', () => {
    const deploy = goodDeploy();
    deploy.d1_databases[0].database_id = '<database id printed by wrangler d1 create>';
    const root = fixture({ deploy });
    assert.equal(byName(run(root), 'D1 migrations').level, 'ok');
    rmSync(join(root, 'apps/worker/migrations'), { recursive: true });
    assert.equal(byName(run(root), 'D1 migrations').level, 'fail');
    const dup = fixture({ files: { 'apps/worker/migrations/0001_again.sql': 'SELECT 1;' } });
    assert.match(byName(run(dup), 'D1 migrations').message, /0001_\* twice/);
  });

  it('fails secret-bearing files in the build and a Worker with no hostname', () => {
    const root = fixture({ files: { 'apps/web/dist/.dev.vars': 'X=1', 'apps/web/dist/nested/.env.local': 'X=1' } });
    const check = byName(run(root), 'secret files');
    assert.equal(check.level, 'fail');
    assert.match(check.message, /\.dev\.vars, nested\/\.env\.local|nested\/\.env\.local, \.dev\.vars/);
    const deploy = goodDeploy();
    deploy.workers_dev = false;
    assert.equal(byName(run(fixture({ deploy })), 'hostnames').level, 'fail');
  });

  it('checks a build in another directory with --dist', () => {
    const root = fixture({ files: { 'scratch/dist/index.html': '<!doctype html><p>x</p>', 'scratch/dist/dev/landmarks.html': 'x' } });
    const checks = run(root, { dist: 'scratch/dist' });
    assert.equal(byName(checks, 'dev pages').level, 'fail');
  });
});
