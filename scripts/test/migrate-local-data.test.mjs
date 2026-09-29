// node --test scripts/test/*.test.mjs   (plain node:test; builds a miniflare-shaped local state in a temp dir)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { commandPlan, exportPlan, kindOf, largestStatementBytes, metadataLoss, planMigration, portraitsSql, r2PutScript, readLocalState, sqlLiteral } from '../migrate-local-data.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = ['0001_init.sql', '0002_media.sql'].map((f) => readFileSync(join(repo, 'apps/worker/migrations', f), 'utf8'));
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const LANDMARKS = JSON.stringify({ v: 1, note: "it's got 'quotes' and $& and a ; semicolon", points: [[0.1, 0.2]] });

/** A state dir shaped like wrangler's .wrangler/state/v3 (R2 metadata DB + blobs, D1 DB, one DO DB). */
function makeState() {
  const state = mkdtempSync(join(tmpdir(), 'hc-migrate-test-'));
  dirs.push(state);
  const blobs = join(state, 'r2/headcount-blobs/blobs');
  mkdirSync(blobs, { recursive: true });
  mkdirSync(join(state, 'r2/miniflare-R2BucketObject'), { recursive: true });
  const r2 = new DatabaseSync(join(state, 'r2/miniflare-R2BucketObject/abc.sqlite'));
  r2.exec(`CREATE TABLE _mf_objects (key TEXT PRIMARY KEY, blob_id TEXT, version TEXT NOT NULL, size INTEGER NOT NULL, etag TEXT NOT NULL,
    uploaded INTEGER NOT NULL, checksums TEXT NOT NULL, http_metadata TEXT NOT NULL, custom_metadata TEXT NOT NULL)`);
  const put = (key, bytes, http, custom) => {
    const id = createHash('sha256').update(key).digest('hex');
    writeFileSync(join(blobs, id), bytes);
    r2.prepare('INSERT INTO _mf_objects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(key, id, 'v', bytes.length, createHash('md5').update(bytes).digest('hex'), Date.now(), '{}', JSON.stringify(http), JSON.stringify(custom));
  };
  put('portraits/lead-a.jpg', Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]), { contentType: 'image/jpeg' }, { personaId: 'lead-a', version: 'v-a', subjectKind: 'lead' });
  put('portraits/p-b.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]), { contentType: 'image/png' }, { personaId: 'p-b', version: 'v-b2' });
  put('portraits/p-orphan.webp', Buffer.from('RIFFxxxxWEBP'), { contentType: 'image/webp' }, { version: 'v-o' });
  put('expr/clips/c1_aaaa.mp3', Buffer.from('ID3clip'), { contentType: 'audio/mpeg' }, { durationMs: '960', voiceKey: 'xai:leo' });
  put('expr/clips/c1_aaaa.align.json', Buffer.from('{"text":"hi"}'), { contentType: 'application/json' }, {});
  put('ws/local/expr/c1_bbbb.mp3', Buffer.from('ID3ws'), { contentType: 'audio/mpeg' }, { scope: 'workspace' });
  put('media/hero.jpg', Buffer.from([0xff, 0xd8, 0xff, 7]), { contentType: 'image/jpeg' }, { key: 'hero' });
  put('misc/unknown.bin', Buffer.from('?'), {}, {});
  r2.close();

  mkdirSync(join(state, 'd1/miniflare-D1DatabaseObject'), { recursive: true });
  const d1 = new DatabaseSync(join(state, 'd1/miniflare-D1DatabaseObject/def.sqlite'));
  for (const sql of MIGRATIONS) d1.exec(sql);
  const row = d1.prepare('INSERT INTO portraits (persona_id, subject_kind, r2_key, mime, bytes, version, provider, model, prompt_hash, generated_at, landmarks, landmarks_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  row.run('lead-a', 'lead', 'portraits/lead-a.jpg', 'image/jpeg', 6, 'v-a', 'xai', 'grok', 'h1', '2026-09-28T00:00:00.000Z', LANDMARKS, '2026-09-28T00:01:00.000Z');
  row.run('p-b', 'persona', 'portraits/p-b.png', 'image/png', 5, 'v-b1', 'openai', 'gpt-image', 'h2', '2026-09-28T00:00:00.000Z', null, null);
  row.run('p-gone', 'persona', 'portraits/p-gone.jpg', 'image/jpeg', 5, 'v-g', 'xai', 'grok', 'h3', '2026-09-28T00:00:00.000Z', null, null);
  d1.prepare('INSERT INTO media_usage (ws_id, day, kind, count) VALUES (?, ?, ?, ?)').run('local', '2026-09-29', 'portrait', 21);
  d1.close();

  mkdirSync(join(state, 'do/headcount-WorkspaceDO'), { recursive: true });
  const ws = new DatabaseSync(join(state, 'do/headcount-WorkspaceDO/ghi.sqlite'));
  ws.exec('CREATE TABLE events (seq INTEGER PRIMARY KEY, data TEXT); INSERT INTO events (data) VALUES (1), (2), (3);');
  ws.close();
  return state;
}

let state;
let local;
before(async () => {
  state = makeState();
  local = await readLocalState(state);
});

describe('readLocalState', () => {
  it('reads R2 objects with their metadata, portrait rows and table counts', () => {
    assert.equal(local.objects.length, 8);
    const a = local.objects.find((o) => o.key === 'portraits/lead-a.jpg');
    assert.deepEqual(a.httpMetadata, { contentType: 'image/jpeg' });
    assert.equal(a.customMetadata.version, 'v-a');
    assert.deepEqual(readFileSync(a.blobPath), Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]));
    assert.equal(local.portraitRows.length, 3);
    assert.equal(local.d1Counts.media_usage, 1);
    assert.deepEqual(local.doCounts.WorkspaceDO, { events: 3 });
  });
  it('explains a missing state dir', async () => {
    await assert.rejects(readLocalState(join(state, 'nope')), /No local state/);
  });
});

describe('planMigration', () => {
  it('moves portraits, clips and workspace clips by default; media and unknown prefixes stay', () => {
    const p = planMigration(local);
    assert.deepEqual(p.objects.map((o) => o.key).sort(), ['expr/clips/c1_aaaa.align.json', 'expr/clips/c1_aaaa.mp3', 'portraits/lead-a.jpg', 'portraits/p-b.png', 'portraits/p-orphan.webp', 'ws/local/expr/c1_bbbb.mp3']);
    assert.equal(p.groups.media.migrate, false);
    assert.equal(p.groups.other.migrate, false);
    assert.deepEqual(p.rows.map((r) => r.persona_id), ['lead-a', 'p-b']);
    assert.equal(p.withLandmarks, 1);
    assert.ok(p.warnings.some((w) => w.startsWith('p-gone:')));
    assert.ok(p.warnings.some((w) => /p-b: row version v-b1 differs/.test(w)));
    assert.ok(p.warnings.some((w) => /1 portrait image\(s\) have no D1 row/.test(w)));
  });
  it('includes media on request and skips workspace clips for another workspace id', () => {
    const p = planMigration(local, { include: ['media', 'ws-clips'], workspaceId: 'owner', sourceWorkspaceId: 'local' });
    assert.deepEqual(p.objects.map((o) => o.key), ['media/hero.jpg']);
    assert.ok(p.warnings.some((w) => /WORKSPACE_ID is "owner"/.test(w)));
  });
  it('classifies keys', () => {
    assert.equal(kindOf('portraits/x.jpg', 'local'), 'portraits');
    assert.equal(kindOf('portraits/x.gif', 'local'), 'other');
    assert.equal(kindOf('ws/other/expr/c1.mp3', 'local'), 'other');
  });
});

describe('SQL export', () => {
  it('escapes literals', () => {
    assert.equal(sqlLiteral(null), 'NULL');
    assert.equal(sqlLiteral(5), '5');
    assert.equal(sqlLiteral("it's"), "'it''s'");
  });
  it('round-trips rows, landmarks included, into a freshly migrated database (and upserts idempotently)', () => {
    const p = planMigration(local);
    const sql = portraitsSql(p.rows);
    const db = new DatabaseSync(':memory:');
    for (const m of MIGRATIONS) db.exec(m);
    db.exec(sql);
    db.exec(sql);
    const rows = db.prepare('SELECT persona_id, version, landmarks, job_status FROM portraits ORDER BY persona_id').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].landmarks, LANDMARKS);
    assert.equal(rows[1].version, 'v-b1');
    assert.equal(rows[0].job_status, null);
    db.close();
  });
  it('exports objects byte for byte with a manifest', () => {
    const out = mkdtempSync(join(tmpdir(), 'hc-migrate-export-'));
    dirs.push(out);
    const p = planMigration(local);
    const r = exportPlan(p, out);
    assert.equal(r.files, p.objects.length);
    const manifest = JSON.parse(readFileSync(join(out, 'r2-manifest.json'), 'utf8'));
    const clip = manifest.find((m) => m.key === 'expr/clips/c1_aaaa.mp3');
    assert.deepEqual(clip.customMetadata, { durationMs: '960', voiceKey: 'xai:leo' });
    assert.equal(readFileSync(join(out, clip.file), 'utf8'), 'ID3clip');
    assert.match(readFileSync(join(out, 'd1-portraits.sql'), 'utf8'), /INSERT INTO portraits/);
    assert.match(readFileSync(join(out, 'r2-put.sh'), 'utf8'), /r2 object put 'headcount-test-blobs\/portraits\/lead-a\.jpg' --remote/);
  });
});

describe('plain-wrangler fallback and the command plan', () => {
  it('counts the objects whose customMetadata a CLI upload would drop', () => {
    assert.deepEqual(metadataLoss(planMigration(local).objects), { portraits: 3, clips: 1, 'ws-clips': 1 });
  });
  it('writes one quoted `wrangler r2 object put --remote` per object, with http metadata and the loss spelled out', () => {
    const objects = [{ key: "portraits/it's.jpg", kind: 'portraits', httpMetadata: { contentType: 'image/jpeg', cacheControl: 'no-store' }, customMetadata: { version: 'v1' } }];
    const sh = r2PutScript(objects, { bucket: 'b', dir: '/x y', wrangler: '/w/wrangler', config: '/c/deploy.jsonc' });
    assert.match(sh, /^#!\/bin\/sh/);
    assert.match(sh, /# {3}1 portraits: still served/);
    assert.ok(sh.includes(`"$WRANGLER" r2 object put 'b/portraits/it'\\''s.jpg' --remote --file '/x y/r2/portraits/it'\\''s.jpg' --content-type 'image/jpeg' --cache-control 'no-store' -c '/c/deploy.jsonc' >/dev/null`));
    const r = spawnSync('sh', ['-n'], { input: sh });
    assert.equal(r.status, 0, String(r.stderr));
  });
  it('prints the owner commands in order: migrations, --execute, a check, then the fallback', () => {
    const p = planMigration(local);
    const lines = commandPlan(p, { database: 'headcount-test', bucket: 'headcount-test-blobs', fromExample: true, exportDir: '/tmp/x' }).join('\n');
    const order = ['cp apps/worker/wrangler.deploy.example.jsonc', 'd1 migrations apply headcount-test --remote', 'migrate-local-data.mjs --execute', 'SELECT count(*), count(landmarks)', '--export /tmp/x', 'sh /tmp/x/r2-put.sh', 'd1 execute headcount-test --remote --file /tmp/x/d1-portraits.sql'];
    let at = -1;
    for (const needle of order) {
      const i = lines.indexOf(needle);
      assert.ok(i > at, `${needle} out of order`);
      at = i;
    }
    assert.match(lines, /loses R2 customMetadata on 5 objects/);
    assert.ok(largestStatementBytes(p.rows) < 100_000);
  });
  it('dry-runs by default from the command line, and refuses --execute with --dry-run', () => {
    const script = join(repo, 'scripts/migrate-local-data.mjs');
    const dry = spawnSync(process.execPath, [script, '--state', state], { encoding: 'utf8' });
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /Plan: 6 objects/);
    assert.match(dry.stdout, /Dry run: nothing was uploaded/);
    const both = spawnSync(process.execPath, [script, '--state', state, '--execute', '--dry-run'], { encoding: 'utf8' });
    assert.equal(both.status, 1);
    assert.match(both.stderr, /Pick one/);
  });
});
