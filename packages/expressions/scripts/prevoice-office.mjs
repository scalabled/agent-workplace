#!/usr/bin/env node
// Pre-voice the office on a running worker (docs/dev/LIVING.md "Pre-voicing"): each line rendered once, in each
// agent's own voice, through the worker's clip endpoints only (GET /api/expr/catalog, GET /api/expr/agents/:id,
// POST /api/expr/prevoice, GET /api/expr/prevoice/:runId). It never touches settings or the conversation.
//
//   node packages/expressions/scripts/prevoice-office.mjs --dry-run            count only: no TTS, no budget
//   node packages/expressions/scripts/prevoice-office.mjs                      render (stops at --max or the daily budget)
//
// Flags:
//   --worker <url>      the worker (default http://127.0.0.1:8787)
//   --origin <url>      the web origin the worker accepts (default http://localhost:5173)
//   --leads <ids|all|none>      leads to pre-voice as they would be as Chief of Staff (default all twelve):
//                       their P0 tier (the worker's own plan, identical to cw_chief's for that lead) plus the
//                       slot-free lines of --lead-extras
//   --lead-extras <intents>     default back_with_you,celebrate,oops,micro_status
//   --coworkers <n>     the n most staffed coworkers (by recipe compositions; default 24): --coworker-intents lines
//   --coworker-intents <intents> default passing_by,greeting (lines an unstaffed coworker can actually say)
//   --per-intent <n>    lines per extra or coworker intent, by prior (default 6)
//   --p0-per-intent <n> lines per P0 intent for leads (default: the engine's 6, as cw_chief plans it); a smaller n
//                       renders the top of the same list first (a later full run skips what is stored)
//   --max <n>           stop planning at this many unique clips across the office (default 1500)
//   --reserve <n>       stop rendering when the worker has n or fewer clip renders left today (default 0): leave
//                       room for the owner's own session (the Chief's pre-voice on Talk, first hovers)
//   --dry-run           plan and count (the worker's dry run: no TTS, no budget)
//
// Clips are content-addressed (voice + text): lines already in R2 are recorded without a TTS call, and a lead's
// clips are the very clips cw_chief finds when that lead is chosen under its own name.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

if (!process.features?.typescript) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('./ts-resolve-hook.mjs', import.meta.url);
const { buildAgentIndex, clipKey, compileCatalog, planPrevoice, renderUtterance, toDelivery } = await import('../src/index.ts');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const list = (s) => (s === 'none' ? [] : s.split(',').map((x) => x.trim()).filter(Boolean));
const WORKER = opt('--worker', 'http://127.0.0.1:8787').replace(/\/$/, '');
const ORIGIN = opt('--origin', 'http://localhost:5173');
const DRY = args.includes('--dry-run');
const PER_INTENT = Number(opt('--per-intent', '6'));
const MAX = Number(opt('--max', '1500'));
const RESERVE = Number(opt('--reserve', '0'));
const P0_PER_INTENT = opt('--p0-per-intent', null);
const LEAD_EXTRAS = list(opt('--lead-extras', 'back_with_you,celebrate,oops,micro_status'));
const COWORKER_INTENTS = list(opt('--coworker-intents', 'passing_by,greeting'));
const COWORKERS = Number(opt('--coworkers', '24'));
const index = JSON.parse(readFileSync(join(ROOT, 'catalog/index.json'), 'utf8'));
const leadsArg = opt('--leads', 'all');
const LEADS = leadsArg === 'none' ? [] : leadsArg === 'all' ? index.leads.map((l) => (typeof l === 'string' ? l : l.id)) : list(leadsArg);

async function call(method, path, body) {
  const res = await fetch(`${WORKER}${path}`, {
    method,
    headers: { origin: ORIGIN, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${json?.error?.message ?? text.slice(0, 200)}`), { status: res.status });
  return json;
}

// ── the office: leads, then the most staffed coworkers ──────────────────────────
function popularCoworkers(n) {
  const score = new Map();
  const starter = new Set(Object.values(index.starter_recipes_by_industry ?? {}).flat());
  for (const r of index.recipes ?? []) {
    const w = starter.has(r.id) ? 2 : 1;
    for (const c of r.composition ?? []) score.set(c.persona_id, (score.get(c.persona_id) ?? 0) + w);
  }
  return [...score.entries()]
    .filter(([id]) => (index.personas ?? []).some((p) => p.id === id))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([id, s]) => ({ id, score: s }));
}

/** Contexts an unstaffed Directory coworker can be in during 0.5 (deriveContexts on its grounding). */
const COWORKER_CONTEXT = (c) => c === 'unstaffed' || c === 'first_meeting' || c === 'returning' || c === 'new_day' || /^(part_of_day|weekday|workweek):/.test(c) || c === 'weekend';

/** The clip key of a line in this agent's voice, or null when it has no voice (a nonverbal line on a provider without it). */
async function keyOf(idx, provider, lineId, fills) {
  const r = renderUtterance(idx, lineId, fills);
  if (!r.ok) return null;
  const delivery = toDelivery(r.utterance, idx.voice, provider);
  return delivery ? clipKey(delivery) : null;
}

/** Top lines of an intent an agent can say with at most its own name filled, best-fitting first. */
async function topLines(idx, provider, intent, n, opts = {}) {
  const out = [];
  const cands = [...idx.candidates(intent)]
    .filter((w) => w.line.slots.every((s) => s === 'self_name' && opts.selfName))
    .filter((w) => !opts.contextOk || (w.line.require.every(opts.contextOk) && !w.line.forbid.includes('unstaffed')))
    .sort((a, b) => (opts.prefer ? Number(b.line.require.includes(opts.prefer)) - Number(a.line.require.includes(opts.prefer)) : 0) || b.prior - a.prior || a.line.id.localeCompare(b.line.id));
  for (const w of cands) {
    if (out.length >= n) break;
    const fills = w.line.slots.includes('self_name') ? { self_name: opts.selfName } : {};
    const key = await keyOf(idx, provider, w.line.id, fills);
    if (key) out.push({ lineId: w.line.id, fills, intent, clipKey: key });
  }
  return out;
}

async function main() {
  const bundle = await call('GET', '/api/expr/catalog');
  const catalog = compileCatalog(bundle.input);
  console.log(`worker ${WORKER} · catalog ${catalog.version}${DRY ? ' · dry run' : ''}`);

  /** Planned batches in order: one per agent (a run is capped by EXPR_PREVOICE_MAX_CLIPS). */
  const batches = [];
  const seen = new Set();
  let skippedBrowser = 0;
  const plan = async (agentId, label, build) => {
    let agent;
    try {
      agent = await call('GET', `/api/expr/agents/${agentId}`);
    } catch (err) {
      console.warn(`skip ${agentId}: ${err.message}`);
      return;
    }
    if (agent.provider === 'browser') {
      skippedBrowser++;
      return;
    }
    const idx = buildAgentIndex(catalog, agent.profile);
    const items = await build(agent, idx);
    const fresh = [];
    for (const it of items) {
      if (seen.size >= MAX) break;
      const key = it.clipKey ?? null;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      fresh.push(it);
    }
    if (fresh.length) batches.push({ agentId, label, provider: agent.provider, items: fresh });
  };

  for (const leadId of LEADS) {
    const agentId = `cw_${leadId}`;
    await plan(agentId, `lead ${leadId}`, async (agent, idx) => {
      const p0 = await planPrevoice(idx, catalog, agent.provider, { self_name: agent.profile.firstName }, { tiers: ['p0'], ...(P0_PER_INTENT ? { perIntent: Number(P0_PER_INTENT) } : {}) });
      const items = p0.map((i) => ({ lineId: i.lineId, fills: i.fills, clipKey: i.clipKey, intent: i.intent }));
      for (const intent of LEAD_EXTRAS) {
        for (const it of await topLines(idx, agent.provider, intent, PER_INTENT)) items.push(it);
      }
      return items;
    });
  }
  for (const { id } of popularCoworkers(COWORKERS)) {
    await plan(`cw_${id}`, `coworker ${id}`, async (agent, idx) => {
      const items = [];
      for (const intent of COWORKER_INTENTS) {
        for (const it of await topLines(idx, agent.provider, intent, PER_INTENT, { selfName: agent.profile.firstName, contextOk: COWORKER_CONTEXT, prefer: 'unstaffed' })) items.push(it);
      }
      return items;
    });
  }
  if (skippedBrowser) console.log(`${skippedBrowser} agent(s) use the browser voice (no TTS provider): nothing to pre-voice for them.`);

  const totals = { planned: 0, alreadyCached: 0, toRender: 0, estAudioMs: 0, rendered: 0, cached: 0, failed: 0, runs: 0 };
  let remaining = null;
  let stopped = null;
  for (const b of batches) {
    const body = { agentIds: [b.agentId], items: b.items.map(({ lineId, fills }) => ({ agentId: b.agentId, lineId, fills })), dryRun: true };
    const dry = await call('POST', '/api/expr/prevoice', body);
    remaining = dry.remainingToday;
    totals.planned += dry.planned;
    totals.alreadyCached += dry.alreadyCached;
    totals.toRender += dry.toRender;
    totals.estAudioMs += dry.estAudioMs;
    const line = `${b.label.padEnd(40)} ${String(dry.planned).padStart(3)} planned · ${String(dry.alreadyCached).padStart(3)} stored · ${String(dry.toRender).padStart(3)} to render (${dry.provider})`;
    if (DRY) {
      console.log(line);
      continue;
    }
    if (dry.toRender > 0 && dry.provider !== 'mock' && dry.remainingToday - dry.toRender < RESERVE) {
      stopped = `${dry.remainingToday} clip renders are left today (EXPR_CLIP_DAILY_LIMIT) and ${RESERVE} are kept for the owner; ${b.label} and later agents were not rendered`;
      break;
    }
    const acc = await call('POST', '/api/expr/prevoice', { ...body, dryRun: false });
    totals.runs++;
    if (!acc.runId || acc.reused || acc.toRender === 0) {
      totals.cached += acc.planned;
      console.log(`${line} → stored already`);
      continue;
    }
    let st;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      st = await call('GET', `/api/expr/prevoice/${acc.runId}`);
      if (st.state !== 'queued' && st.state !== 'running') break;
    }
    totals.rendered += st.rendered;
    totals.cached += st.cached;
    totals.failed += st.failed;
    console.log(`${line} → ${st.state}: ${st.rendered} rendered, ${st.cached} stored, ${st.failed} failed${st.error ? ` (${st.error})` : ''}`);
    if (st.state === 'stopped_budget') {
      stopped = `the daily clip budget ran out during ${b.label}`;
      break;
    }
  }
  const mins = (totals.estAudioMs / 60_000).toFixed(1);
  console.log(
    `\n${batches.length} agents · ${totals.planned} clips planned · ${totals.alreadyCached} already stored · ${totals.toRender} to render (≈ ${mins} min of audio)` +
      (DRY ? '' : ` · ${totals.rendered} rendered · ${totals.failed} failed`) +
      (remaining !== null ? ` · ${remaining} renders left today` : ''),
  );
  if (stopped) console.log(`stopped: ${stopped}. Run again after the UTC day turns (stored clips are skipped).`);
}

main().catch((err) => {
  console.error(`prevoice-office: ${err.message}`);
  process.exit(1);
});
