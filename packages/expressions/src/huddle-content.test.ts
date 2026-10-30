// The live huddle library (catalog/expressions/huddles/**) through the real engine and the real catalog
//: everything compiles with nothing dropped, every exchange is castable by
// real catalog personas, a 1,000-pick fuzz with adversarial events leaks nothing and grounds every fact, daily caps
// hold over a simulated day, picks stay under a millisecond, and the build writes a bundle whose huddles compile
// strictly to the same version. The §5.7 quotas are gated by `validate-expressions.mjs --strict` (content, not engine).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadExpressionSources, REPO_ROOT } from '../scripts/load-expressions.mjs';
import { buildAgentIndex, compileCatalog, compileCatalogLenient } from './catalog';
import { seededRng } from './hash';
import {
  HUDDLE_CAPTION_MAX_CHARS, HUDDLE_COMPLETION_EVENTS, HUDDLE_EVENT_KINDS, HUDDLE_SPOTS, castRoles, compileHuddles, compileHuddlesLenient,
  createHuddleRecency, fillTemplate, lintHuddleText, pickExchange,
} from './huddle';
import type { CompiledExchange, HuddleEvent, HuddlePackInput, HuddleParticipant, HuddleRequest } from './huddle';
import { laughCaption } from './lines';
import type { AgentExpressionProfile, CompiledCatalog, ExpressionCatalogInput, Sliders } from './types';
import type { Ambience, Seniority, TeamRole } from './vocab';

const { input, files } = loadExpressionSources();
const catalog: CompiledCatalog = compileCatalogLenient(input).catalog;
const packs = files.filter((f) => f.kind === 'huddle_pack').map((f) => JSON.parse(readFileSync(join(REPO_ROOT, f.path), 'utf8')) as HuddlePackInput);
const lenient = compileHuddlesLenient(packs, catalog);
const huddles = lenient.huddles;

// ── the real cast ───────────────────────────────────────────────────────────────
interface PersonaRow {
  id: string; name: string; department?: string; seniority?: Seniority; team_roles?: TeamRole[]; pairs_well_with?: string[];
  productive_tension_with?: { persona_id: string }[]; personality: { sliders: Sliders; traits?: string[] };
}
const jsonFiles = (dir: string): string[] => readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => join(dir, n));
const personaRows: PersonaRow[] = jsonFiles(join(REPO_ROOT, 'catalog/personas')).flatMap((f) => (JSON.parse(readFileSync(f, 'utf8')) as { personas: PersonaRow[] }).personas);
const leadRows = jsonFiles(join(REPO_ROOT, 'catalog/leads')).map((f) => JSON.parse(readFileSync(f, 'utf8')) as PersonaRow).filter((l) => l.id?.startsWith('lead-'));
const VOICE = { xai: 'eve', openai: 'alloy', speed: 1 };
function participant(row: PersonaRow, chief: boolean): HuddleParticipant {
  const agentId = `cw_${row.id}`;
  const profile: AgentExpressionProfile = {
    agentId, personaId: row.id, firstName: row.name.split(/\s+/)[0]!, voice: VOICE, teamRole: chief ? 'chief' : 'specialist',
    personality: {
      sliders: row.personality.sliders, traits: row.personality.traits ?? [], ...(row.team_roles ? { roles: row.team_roles } : {}),
      ...(row.seniority ? { seniority: row.seniority } : {}), ...(chief ? { leadId: row.id } : {}),
    },
  };
  const index = buildAgentIndex(catalog, profile);
  return {
    agentId, firstName: profile.firstName, index, mood: index.baseline,
    ...(row.department ? { department: row.department } : {}), ...(row.team_roles ? { teamRoles: row.team_roles } : {}), ...(chief ? { isChief: true } : {}),
    pairsWellWith: (row.pairs_well_with ?? []).map((id) => `cw_${id}`),
    tensionWith: (row.productive_tension_with ?? []).map((t) => `cw_${t.persona_id}`),
  };
}
const people: HuddleParticipant[] = [...personaRows.map((r) => participant(r, false)), ...leadRows.map((r) => participant(r, true))];

describe('live huddle library', () => {
  it('loads and compiles every exchange with nothing dropped', () => {
    expect(packs.length).toBeGreaterThanOrEqual(1);
    expect(lenient.problems, lenient.problems.slice(0, 20).join('\n')).toEqual([]);
    expect(lenient.dropped).toEqual([]);
    expect(compileHuddles(packs, catalog).version).toBe(huddles.version);
    expect(people.length).toBeGreaterThan(150);
  });

  it('casts every exchange with at least ten pairs of real catalog personas', () => {
    const thin: string[] = [];
    for (const ex of huddles.exchanges) {
      const poolFor = (role: 'A' | 'B' | 'C') => {
        const def = ex.roles[role];
        return people.filter((p) => (!def?.departments?.length || def.departments.includes(p.department ?? '')) && (def?.chief !== true || p.isChief) && (def?.chief !== false || !p.isChief));
      };
      const as = poolFor('A');
      const bs = poolFor('B');
      const cs = ex.rolesUsed.includes('C') ? poolFor('C') : [];
      const extra = Math.max(ex.size[0], ex.rolesUsed.length) - 2;
      let pairs = 0;
      outer: for (const a of as) {
        for (const b of bs) {
          if (a === b) continue;
          const listeners = (cs.length ? cs : people).filter((c) => c !== a && c !== b).slice(0, extra);
          // Desk drop-bys: whoever an at_desk role wants is the colleague at their own desk.
          const atDesk = (p: HuddleParticipant, role: 'A' | 'B') => (ex.roles[role]?.at_desk === undefined ? p : { ...p, atDesk: ex.roles[role]!.at_desk });
          const group = [atDesk(a, 'A'), atDesk(b, 'B'), ...listeners];
          const agents = new Set(group.map((p) => p.agentId));
          if (castRoles(ex, group, { eventAgents: ex.grounded ? agents : null, who: ex.requires?.who === 'other' ? null : ex.requires?.who ?? null })) pairs++;
          if (pairs >= 10) break outer;
        }
      }
      if (pairs < 10) thin.push(`${ex.id}: ${pairs}`);
    }
    expect(thin).toEqual([]);
  });
});

// ── the fuzz ────────────────────────────────────────────────────────────────────
const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
const HOUR = 3_600_000;
const NASTY = ['<b>Deck</b>', 'Q3 memo [laugh]', '{owner_name} plan', 'Report https://evil.example/x', 'Keys sk-abcdefghijklmnop1234', 'x'.repeat(200), '⟦tainted⟧ secret plan', '', 'Everyday', 'Northwind'];
const NICE = ['Supplier price grid', 'Brand voice guide', 'Onboarding checklist', 'Competitor scan', 'Pricing memo'];
const OWNER = /\b(the owner|our owner|the boss|boss man|our human|my human|the human|the client said|they want)\b/i;
const COMPLETION = /\b(done|finished|completed?|wrapped(?: up)?|landed|(?:came|come|comes) through|shipped|delivered|launched|out of (?:my|the|your|our) queue|signed off|in the bag|nailed it)\b/i;

function fuzzRequest(i: number): { req: HuddleRequest; events: HuddleEvent[] } {
  const rng = seededRng(`huddle-fuzz|${i}`);
  const pickOf = <T>(xs: readonly T[]): T => xs[Math.floor(rng.next() * xs.length)]!;
  const n = 2 + Math.floor(rng.next() * 3);
  const group: HuddleParticipant[] = [];
  // Same-department groups a third of the time, so craft talk gets exercised.
  const dept = rng.next() < 0.33 ? pickOf(people).department : undefined;
  const pool = dept ? people.filter((p) => p.department === dept) : people;
  while (group.length < n && group.length < pool.length) {
    const p = pickOf(pool);
    if (!group.some((g) => g.agentId === p.agentId)) group.push({ ...p, mood: { valence: rng.next() * 1.6 - 0.8, energy: rng.next() * 1.6 - 0.8 } });
  }
  const hour = Math.floor(rng.next() * 24);
  const day = Math.floor(rng.next() * 7);
  const now = T0 + (hour - 9) * HOUR + day * 86_400_000;
  const events: HuddleEvent[] = [];
  const nEvents = Math.floor(rng.next() * 4);
  for (let k = 0; k < nEvents; k++) {
    const inGroup = rng.next() < 0.7;
    const agents = inGroup ? group.slice(0, 1 + Math.floor(rng.next() * group.length)).map((p) => p.agentId) : [pickOf(people).agentId];
    events.push({
      kind: pickOf(HUDDLE_EVENT_KINDS), agentIds: agents, at: now - Math.floor(rng.next() * 80 * HOUR) + (rng.next() < 0.1 ? 5 * HOUR : 0),
      visibility: rng.next() < 0.7 ? 'team' : rng.next() < 0.5 ? 'owner' : 'whisper', cause: { streamId: 'p:prj_fz', seq: i * 10 + k },
      ...(rng.next() < 0.8 ? { artifact: rng.next() < 0.5 ? pickOf(NASTY) : pickOf(NICE) } : {}),
      ...(rng.next() < 0.8 ? { project: rng.next() < 0.5 ? pickOf(NASTY) : 'Northwind' } : {}),
      ...(rng.next() < 0.5 ? { gist: pickOf(NASTY) } : {}),
      ...(rng.next() < 0.6 ? { coworkerName: rng.next() < 0.3 ? pickOf(NASTY) : pickOf(people).firstName } : {}),
    });
  }
  const ambience: Ambience = rng.next() < 0.05 ? 'quiet' : rng.next() < 0.5 ? 'lively' : 'buzzing';
  return {
    events,
    req: {
      huddleId: `hd:fz:${i}`, spot: pickOf(HUDDLE_SPOTS), participants: group, now: { epochMs: now, localHour: hour, weekday: (1 + day) % 7 },
      ambience, provider: pickOf(['xai', 'openai', 'browser', 'mock'] as const), maxLines: 2 + Math.floor(rng.next() * 3),
      contexts: rng.next() < 0.3 ? ['crew'] : [], chiefName: rng.next() < 0.5 ? 'Eddie' : null, grounding: { events }, seed: `hd:fz:${i}|0`,
    },
  };
}

describe('grounded small talk with the real fill', () => {
  it('reads naturally for every job.done line with the app\'s "the write-up" (never "Eddie\'s the write-up" or a bare "write-up")', () => {
    const fills = { artifact: 'the write-up', coworker: 'Eddie', name_a: 'Ana', name_b: 'Ben', name_c: 'Cleo', chief_name: 'Eddie', part_of_day: 'afternoon', weekday: 'Tuesday', project: 'Northwind', gist: 'the brief' };
    const bad: string[] = [];
    let n = 0;
    for (const ex of huddles.exchanges) {
      if (!ex.requires?.events.includes('job.done')) continue;
      for (const l of ex.lines) {
        if (l.kind !== 'line' || !l.slots.includes('artifact')) continue;
        n++;
        const caption = fillTemplate(l.text, fills);
        if (/['’]s the write-up|\b(?:the|a|an|your|our) the write-up/i.test(caption) || /(?<!\b(?:the|The)|['’]s) write-up/.test(caption) || /^write-up/i.test(caption)) bad.push(`${ex.id}: ${caption}`);
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(bad).toEqual([]);
    expect(fillTemplate("{coworker}'s {artifact} came through.", fills)).toBe("Eddie's write-up came through.");
    expect(fillTemplate('{artifact} is done.', fills)).toBe('The write-up is done.');
    expect(fillTemplate('Congrats on {artifact}, {name_b}.', fills)).toBe('Congrats on the write-up, Ben.');
  });
});

describe('1,000-pick fuzz (no leaks, grounded or silent)', () => {
  const PICKS = 1000;
  const stats = { picked: 0, silent: 0, grounded: 0, ms: 0 };
  const failures: string[] = [];
  for (let i = 0; i < PICKS; i++) {
    const { req, events } = fuzzRequest(i);
    const t0 = performance.now();
    const pick = pickExchange(huddles, req, createHuddleRecency());
    stats.ms += performance.now() - t0;
    if (req.ambience === 'quiet' && pick) failures.push(`${i}: Quiet must be silent`);
    if (!pick) { stats.silent++; continue; }
    stats.picked++;
    const fail = (m: string) => failures.push(`${i} ${pick.exchangeId}: ${m}`);
    const ex = huddles.byId(pick.exchangeId) as CompiledExchange;
    if (!ex.spots.includes(req.spot)) fail('wrong spot');
    if (pick.lines.length > req.maxLines) fail('over maxLines');
    const ids = new Set(req.participants.map((p) => p.agentId));
    const cast = Object.values(pick.cast);
    if (new Set(cast).size !== cast.length || cast.some((a) => !ids.has(a!))) fail('cast outside the huddle or doubled');
    let prevEnd = -1;
    for (const l of pick.lines) {
      if (!ids.has(l.agentId)) fail(`speaker ${l.agentId} not present`);
      if (/[{}[\]<>]/.test(l.caption)) fail(`markup or placeholder leaked: ${l.caption}`);
      if (/https?:\/\/|sk-[a-z0-9]{8,}|⟦/i.test(l.caption)) fail(`unsafe value leaked: ${l.caption}`);
      if (l.caption.length > HUDDLE_CAPTION_MAX_CHARS) fail(`caption too long: ${l.caption.length}`);
      if (OWNER.test(l.caption)) fail(`owner reference: ${l.caption}`);
      if (l.kind === 'line' && !l.caption) fail('empty spoken line');
      if (l.kind === 'laugh') {
        const speaker = req.participants.find((p) => p.agentId === l.agentId)!;
        if (l.caption !== laughCaption(speaker.index.laugh)) fail('laugh is not the speaker’s own');
      }
      if (l.atMs < prevEnd) fail('turns overlap');
      prevEnd = l.atMs + l.holdMs;
      if (l.kind === 'line') {
        const lints = lintHuddleText(l.caption, { topics: ex.topics, grounded: ex.grounded, completionEvent: pick.eventKind !== null && HUDDLE_COMPLETION_EVENTS.includes(pick.eventKind), night: false })
          .filter((x) => !['number', 'product', 'weekday', 'external'].includes(x.rule) || !ex.grounded); // fills may carry real names
        for (const x of lints) if (['owner', 'embodiment', 'completion', 'progress', 'putdown', 'solicit', 'markup'].includes(x.rule)) fail(`${x.rule}: ${l.caption}`);
      }
    }
    if (pick.grounded) {
      stats.grounded++;
      const ev = events.find((e) => e.cause.seq === pick.cause?.seq);
      if (!ev) { fail('grounded pick without its event'); continue; }
      if (ev.visibility !== 'team') fail(`grounded on a ${ev.visibility} event`);
      if (!ex.requires!.events.includes(ev.kind) || ev.kind !== pick.eventKind) fail('event kind not required by the exchange');
      if (ev.at > req.now.epochMs || req.now.epochMs - ev.at > ex.requires!.maxAgeMs) fail('stale or future event');
      const who = ex.requires!.who;
      if ((who === 'A' || who === 'B') && !ev.agentIds.includes(pick.cast[who]!)) fail(`role ${who} is not the event's agent`);
      for (const r of ex.rolesUsed) if (ex.roles[r]?.in_event && !ev.agentIds.includes(pick.cast[r]!)) fail(`in_event role ${r} not in the event`);
      if (who === 'other' && ev.agentIds.some((a) => ids.has(a))) fail('who: other with the agent present');
      if (pick.lines.some((l) => COMPLETION.test(l.caption.replace(ev.artifact ?? '\u0000', ''))) && !HUDDLE_COMPLETION_EVENTS.includes(ev.kind)) fail('completion words without a completion event');
    } else if (pick.cause !== null) fail('ungrounded pick with a cause');
    if (JSON.stringify(pickExchange(huddles, req, createHuddleRecency())) !== JSON.stringify(pick)) fail('not deterministic');
  }

  it('leaks nothing and grounds every fact', () => {
    expect(failures.slice(0, 20)).toEqual([]);
    expect(stats.picked).toBeGreaterThan(PICKS * 0.5);
    expect(stats.grounded).toBeGreaterThan(0);
  });
  it('picks in under a millisecond on the full library', () => {
    expect(stats.ms / PICKS).toBeLessThan(1);
  });
});

describe('a simulated day', () => {
  it('keeps every exchange within its floor-wide daily cap unless the library ran dry, and never repeats one to the same people', () => {
    const rec = createHuddleRecency();
    const dayKey = '2026-10-05';
    const shown = new Map<string, number>();
    const heard = new Map<string, Set<string>>();
    let overCap = 0;
    const rng = seededRng('huddle-day');
    for (let i = 0; i < 180; i++) {
      const spot = HUDDLE_SPOTS[i % HUDDLE_SPOTS.length]!;
      const group = [0, 1, 2].slice(0, 2 + (i % 2)).map(() => people[Math.floor(rng.next() * 24)]!).filter((p, k, a) => a.indexOf(p) === k);
      const now = T0 + i * 4 * 60_000;
      const pick = pickExchange(huddles, {
        huddleId: `hd:${dayKey}:${spot}:${i}`, spot, participants: group, now: { epochMs: now, localHour: 9 + Math.floor((i * 4) / 60), weekday: 1 },
        ambience: 'buzzing', provider: 'xai', maxLines: 4, seed: `hd:${dayKey}:${spot}:${i}|0`,
      }, rec);
      if (!pick) continue;
      // Past its daily cap only as the dry-library fallback: then nobody present has heard it (§6.2).
      if ((shown.get(pick.exchangeId) ?? 0) >= huddles.byId(pick.exchangeId)!.maxPerDay) {
        for (const p of pick.participants) expect(heard.get(p)?.has(pick.exchangeId) ?? false, `${pick.exchangeId} again for ${p}`).toBe(false);
        overCap++;
      }
      rec.record(pick, now, dayKey);
      shown.set(pick.exchangeId, (shown.get(pick.exchangeId) ?? 0) + 1);
      for (const p of pick.participants) {
        const seen = heard.get(p) ?? new Set<string>();
        heard.set(p, seen.add(pick.exchangeId));
      }
    }
    const picks = [...shown.values()].reduce((a, b) => a + b, 0);
    expect(overCap / picks).toBeLessThan(0.25); // the fallback is the exception: a floor that saw everything
    expect(shown.size).toBeGreaterThan(40);
  });
});

describe('the build bundle', () => {
  it('writes huddles as a separate field that compiles strictly to the same version, leaving the expressions version alone', () => {
    const out = mkdtempSync(join(tmpdir(), 'hc-huddles-'));
    execFileSync(process.execPath, [join(REPO_ROOT, 'packages/expressions/scripts/build-expressions.mjs'), '--quiet', '--out', out], { stdio: 'pipe' });
    const bundle = JSON.parse(readFileSync(join(out, 'expressions.json'), 'utf8')) as {
      kind: string; version: string; input: ExpressionCatalogInput; huddles: { version: string; packs: HuddlePackInput[] };
    };
    const strict = compileCatalog(bundle.input);
    expect(strict.version).toBe(bundle.version);
    expect(bundle.huddles.version).toBe(huddles.version);
    expect(compileHuddles(bundle.huddles.packs, strict).version).toBe(bundle.huddles.version);
    expect(compileHuddles(bundle.huddles.packs, strict).exchanges.length).toBe(huddles.exchanges.length);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as { skipped: unknown[]; huddles: { dropped: unknown[]; counts: { exchanges: number } } };
    expect(report.skipped).toEqual([]);
    expect(report.huddles.dropped).toEqual([]);
    expect(report.huddles.counts.exchanges).toBe(huddles.exchanges.length);
  }, 30_000);
});
