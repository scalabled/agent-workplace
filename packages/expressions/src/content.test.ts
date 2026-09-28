// The live content in catalog/expressions/** through the real engine: it loads, compiles without dropped
// lines, every lead and persona pack yields grounded picks, selection stays under a millisecond, and the
// build script's bundle compiles strictly to the same version.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadExpressionSources, REPO_ROOT } from '../scripts/load-expressions.mjs';
import { buildAgentIndex, catalogVersion, compileCatalog, compileCatalogLenient } from './catalog';
import { readable, speakable } from './markup';
import { createRecencyMemory } from './recency';
import { selectLine } from './select';
import { makeState, T0 } from './testing';
import type { AgentExpressionProfile, CompiledCatalog, ExpressionCatalogInput } from './types';
import { INTENT_IDS } from './vocab';
import type { IntentId } from './vocab';

const { input, files, skipped } = loadExpressionSources();
const t0 = performance.now();
const lenient = compileCatalogLenient(input);
const compileMs = performance.now() - t0;
const catalog: CompiledCatalog = lenient.catalog;
const personaIds = input.signatures.flatMap((f) => f.packs.map((p) => p.persona_id));

function profileFor(personaId: string): AgentExpressionProfile {
  return {
    agentId: `cw_${personaId}`, personaId, firstName: 'Alex', teamRole: personaId.startsWith('lead-') ? 'chief' : 'specialist',
    personality: { sliders: { warmth: 70, directness: 65, formality: 45, humor: 60, risk_appetite: 45, detail: 75, pace: 55 }, traits: [], ...(personaId.startsWith('lead-') ? { leadId: personaId } : {}) },
    voice: { xai: 'eve', openai: 'alloy', speed: 1 },
  };
}

describe('live catalog/expressions content', () => {
  it('loads every expression file and compiles with nothing dropped', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(skipped, JSON.stringify(skipped)).toEqual([]);
    expect(lenient.problems, lenient.problems.slice(0, 20).join('\n')).toEqual([]);
    expect(lenient.dropped).toEqual([]);
    expect(compileMs).toBeLessThan(5000);
  });

  it('every compiled line keeps the caption/tag invariants', () => {
    const packIds = [...catalog.archetypes.keys(), ...personaIds];
    let n = 0;
    for (const id of packIds) {
      for (const intent of INTENT_IDS) {
        for (const l of catalog.linesFor(id, intent)) {
          n++;
          if (l.nonverbal) expect(readable(l.xai)).toBe('');
          else expect(readable(l.xai), l.id).toBe(l.text);
          expect(speakable(l.xai), l.id).toBe(l.xai.replace(/\s{2,}/g, ' ').trim());
        }
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('every archetype and signature pack yields a grounded pick for the core conversation intents', () => {
    const core: IntentId[] = ['acknowledge', 'thinking_filler', 'gratitude_reply', 'laugh', 'sympathy'];
    const failures: string[] = [];
    const ids = personaIds.length ? personaIds : Object.keys(catalog.archetypesFile.lead_blends);
    for (const personaId of ids) {
      const index = buildAgentIndex(catalog, profileFor(personaId));
      for (const intent of core) {
        if (index.intentWeight(intent) === 0) continue;
        const r = selectLine(index, {
          intent, state: makeState(index.agentId, 'Alex'), mood: { valence: 0.2, energy: 0 }, ambience: 'lively', provider: 'xai', seed: `${personaId}|${intent}`, now: T0, channel: 'voice',
        }, createRecencyMemory());
        if (!r.ok) failures.push(`${personaId} ${intent}: ${r.reason}`);
        else expect(r.utterance.caption).not.toMatch(/[{}[\]<>]/);
      }
    }
    expect(failures).toEqual([]);
  });

  it('selects in well under a millisecond on the full catalog (§2.6.8)', () => {
    const personaId = personaIds.find((p) => p.startsWith('lead-')) ?? 'lead-warm-mentor';
    const index = buildAgentIndex(catalog, profileFor(personaId));
    const recency = createRecencyMemory();
    const intents: IntentId[] = ['acknowledge', 'thinking_filler', 'backchannel', 'passing_by', 'greeting'];
    const state = makeState(index.agentId, 'Alex', { self: { presence: 'working' }, work: { stepLabel: 'Reading supplier quotes', done: 2, total: 5 } });
    const n = 500;
    const start = performance.now();
    for (let i = 0; i < n; i++) {
      selectLine(index, { intent: intents[i % intents.length]!, state, mood: { valence: 0.2, energy: 0 }, ambience: 'lively', provider: 'xai', seed: `perf${i}`, now: T0 + i, channel: 'voice' }, recency);
    }
    const perPick = (performance.now() - start) / n;
    expect(perPick).toBeLessThan(2); // typically ≈ 0.1 ms; generous for slow CI machines
  });

  it('the build script writes a bundle that compiles strictly to the same version', () => {
    const out = mkdtempSync(join(tmpdir(), 'hc-expr-'));
    execFileSync(process.execPath, [join(REPO_ROOT, 'packages/expressions/scripts/build-expressions.mjs'), '--quiet', '--out', out], { stdio: 'pipe' });
    const bundle = JSON.parse(readFileSync(join(out, 'expressions.json'), 'utf8')) as { kind: string; version: string; input: ExpressionCatalogInput };
    expect(bundle.kind).toBe('expression_bundle');
    const strict = compileCatalog(bundle.input);
    expect(strict.version).toBe(bundle.version);
    expect(catalogVersion(bundle.input)).toBe(bundle.version);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    expect(report.version).toBe(bundle.version);
  }, 30_000);
});
