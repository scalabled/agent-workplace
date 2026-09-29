import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildAgentIndex, compileCatalog, compileCatalogLenient, deriveBlend, ExpressionCatalogError, laughXaiFor, resolveBlend, sliderStatsOf } from './catalog';
import { placeholders, readable, speakable } from './markup';
import { archetypesFile, FIXTURE_PACKS, FIXTURE_SIGNATURES, fixtureCatalog, fixtureCatalogInput, fixtureIndex, PROFILES } from './testing';
import type { AgentExpressionProfile, ArchetypePack, LineDef, SignatureFile } from './types';
import { INTENT_IDS } from './vocab';
import type { Sliders } from './vocab';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function withLine(intent: string, line: LineDef): ArchetypePack[] {
  return FIXTURE_PACKS.map((p) => (p.id === 'warm' ? { ...p, intents: { ...p.intents, [intent]: [...(p.intents[intent as 'quip'] ?? []), line] } } : p));
}

describe('compileCatalog', () => {
  const catalog = fixtureCatalog();

  it('indexes every intent, archetype and Ambience profile and gets a content version', () => {
    expect([...catalog.intents.keys()].sort()).toEqual([...INTENT_IDS].sort());
    expect(catalog.archetypes.size).toBe(12);
    expect(Object.keys(catalog.ambience).sort()).toEqual(['buzzing', 'lively', 'quiet']);
    expect(catalog.version).toMatch(/^e1_[a-z2-7]+$/);
    expect(compileCatalog(fixtureCatalogInput()).version).toBe(catalog.version);
    const reordered = compileCatalog(fixtureCatalogInput({ packs: [...FIXTURE_PACKS].reverse(), signatures: [...FIXTURE_SIGNATURES].reverse() }));
    expect(reordered.version).toBe(catalog.version);
  });

  it('compiles lines with the §4.2 invariants (readable(xai) === text, known tags, slots = placeholders)', () => {
    let n = 0;
    for (const packId of ['warm', 'dry-wit', 'calm-steady', 'energetic', 'meticulous', 'lead-warm-mentor', 'red-team-sceptic', 'data-analyst']) {
      for (const intent of INTENT_IDS) {
        for (const l of catalog.linesFor(packId, intent)) {
          n++;
          if (!l.nonverbal) expect(readable(l.xai)).toBe(l.text);
          else expect(readable(l.xai)).toBe('');
          expect(speakable(l.xai)).toBe(l.xai.replace(/\s{2,}/g, ' ').trim());
          expect([...new Set(placeholders(l.text))].sort()).toEqual([...l.slots].sort());
          expect(l.estMs).toBeGreaterThan(0);
          expect(l.opener).not.toBe('');
        }
      }
    }
    expect(n).toBeGreaterThan(150);
  });

  it('synthesises the persona laugh line from its laugh style, and each archetype laugh', () => {
    const own = catalog.linesFor('lead-warm-mentor', 'laugh').find((l) => l.id === 'lead-warm-mentor.laugh.00')!;
    expect(own).toMatchObject({ text: '(chuckles)', nonverbal: true, xai: '<soft>[laugh]</soft>', source: 'signature', weight: 2, intensity: 'low' });
    expect(own.openai.say).toBe('Heh heh.');
    const arch = catalog.linesFor('playful', 'laugh').find((l) => l.id === 'playful.laugh.00')!;
    expect(arch).toMatchObject({ text: '(giggles)', nonverbal: true, source: 'archetype', archetype: 'playful' });
  });

  it('adds catchphrases to every listed intent under one id', () => {
    const tf = catalog.linesFor('lead-warm-mentor', 'thinking_filler').find((l) => l.source === 'catchphrase')!;
    const ack = catalog.linesFor('lead-warm-mentor', 'acknowledge').find((l) => l.source === 'catchphrase')!;
    expect(tf.id).toBe('lead-warm-mentor.catch.01');
    expect(ack.id).toBe(tf.id);
    expect(tf.maxPerDay).toBe(2);
  });

  it('rejects bad content with every problem listed (strict)', () => {
    const bad: LineDef[] = [
      { id: 'warm.quip.90', text: 'All sent to the client already.' }, // completion claim (H2)
      { id: 'warm.quip.91', text: 'Grabbing a coffee first.' }, // embodiment (H6)
      { id: 'warm.quip.92', text: 'Hi {owner_name}.', slots: ['owner_name'] }, // slot not allowed in quip
      { id: 'warm.quip.93', text: 'Nice.', tags: { xai: 'Nice! [cough]' } }, // readable mismatch + banned tag
      { id: 'warm.quip.94', text: 'Plain {project} words.' }, // placeholder without slots
      { id: 'warm.quip.95', text: 'Fine.', context: ['moon_phase'] }, // unknown context
    ];
    let err: unknown;
    try {
      const packs = FIXTURE_PACKS.map((p) => (p.id === 'warm' ? { ...p, intents: { ...p.intents, quip: [...(p.intents.quip ?? []), ...bad] } } : p));
      compileCatalog(fixtureCatalogInput({ packs }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ExpressionCatalogError);
    const problems = (err as ExpressionCatalogError).problems.join('\n');
    expect(problems).toMatch(/warm\.quip\.90: .*H2/);
    expect(problems).toMatch(/warm\.quip\.91: .*H6/);
    expect(problems).toMatch(/warm\.quip\.92: slot \{owner_name\} is not allowed/);
    expect(problems).toMatch(/warm\.quip\.93: readable/);
    expect(problems).toMatch(/warm\.quip\.93: \[cough\]/);
    expect(problems).toMatch(/warm\.quip\.94: slots/);
    expect(problems).toMatch(/warm\.quip\.95: unknown context moon_phase/);
  });

  it('rejects side-talk that names the owner, duplicate ids and never_says in a persona’s own lines', () => {
    const sig: SignatureFile = {
      ...FIXTURE_SIGNATURES[1]!,
      packs: [{ ...FIXTURE_SIGNATURES[1]!.packs[0]!, lines: { quip: [{ id: 'red-team-sceptic.quip.02', text: "Absolutely nothing's failed yet." }] } }],
    };
    const packs = withLine('handoff_give', { id: 'warm.handoff_give.01', text: 'The boss wants this.' });
    expect(() => compileCatalog(fixtureCatalogInput({ packs, signatures: [FIXTURE_SIGNATURES[0]!, sig, FIXTURE_SIGNATURES[2]!] }))).toThrowError(
      /duplicate line id|never_says/,
    );
    try {
      compileCatalog(fixtureCatalogInput({ packs, signatures: [FIXTURE_SIGNATURES[0]!, sig, FIXTURE_SIGNATURES[2]!] }));
    } catch (e) {
      const text = (e as ExpressionCatalogError).problems.join('\n');
      expect(text).toContain('duplicate line id');
      expect(text).toContain('uses never_says phrase "absolutely"');
    }
    const owner = withLine('ask_coworker', { id: 'warm.ask_coworker.09', text: 'Quick one, the owner asked —' });
    expect(() => compileCatalog(fixtureCatalogInput({ packs: owner }))).toThrowError(/H4/);
  });

  it('lenient compile drops bad lines and packs but keeps the rest', () => {
    const packs = withLine('quip', { id: 'warm.quip.90', text: 'All sent already.' });
    const brokenSig: SignatureFile = { ...FIXTURE_SIGNATURES[2]!, packs: [{ ...FIXTURE_SIGNATURES[2]!.packs[0]!, archetypes: { energetic: 0.5 } }] };
    const r = compileCatalogLenient(fixtureCatalogInput({ packs, signatures: [FIXTURE_SIGNATURES[0]!, FIXTURE_SIGNATURES[1]!, brokenSig] }));
    expect(r.dropped).toContain('warm.quip.90');
    expect(r.dropped).toContain('signature:data-analyst');
    expect(r.catalog.linesFor('warm', 'quip').map((l) => l.id)).not.toContain('warm.quip.90');
    expect(r.catalog.signature('data-analyst')).toBeNull();
    expect(r.catalog.signature('red-team-sceptic')).not.toBeNull();
    expect(() => compileCatalogLenient({ ...fixtureCatalogInput(), intents: { ...fixtureCatalogInput().intents, intents: [] } })).toThrowError(ExpressionCatalogError);
  });
});

describe('blending (§4.5)', () => {
  const catalog = fixtureCatalog();

  it('precedence: signature pack → lead_blends → derived', () => {
    expect(resolveBlend(catalog, PROFILES.ruth as AgentExpressionProfile)).toEqual({ 'dry-wit': 0.5, 'calm-steady': 0.3, warm: 0.2 });
    const leadOnly: AgentExpressionProfile = { ...PROFILES.chief, personaId: 'lead-dry-strategist', personality: { ...PROFILES.chief.personality, leadId: 'lead-dry-strategist' } } as AgentExpressionProfile;
    expect(resolveBlend(catalog, leadOnly)).toEqual(archetypesFile.lead_blends['lead-dry-strategist']);
    const derived = resolveBlend(catalog, PROFILES.jelena as AgentExpressionProfile);
    expect(derived).toEqual(deriveBlend(PROFILES.jelena.personality, archetypesFile));
  });

  it('derived blends have 1–3 archetypes, weights ≥ min_weight, summing to 1', () => {
    const b = deriveBlend(PROFILES.jelena.personality, archetypesFile);
    const ws = Object.values(b) as number[];
    expect(ws.length).toBeGreaterThanOrEqual(1);
    expect(ws.length).toBeLessThanOrEqual(3);
    expect(Math.abs(ws.reduce((a, x) => a + x, 0) - 1)).toBeLessThan(1e-9);
    for (const w of ws) expect(w).toBeGreaterThanOrEqual(0.12 - 0.011);
    expect(Object.keys(b)).toContain('dry-wit'); // "dry-witted" trait
  });

  it('matches the validator reference implementation for every catalog persona (live slider stats)', () => {
    let out = '';
    try {
      out = execFileSync(process.execPath, [join(ROOT, 'catalog/scripts/validate-expressions.mjs'), '--blends', '--quiet'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? ''); // exit 1 on content errors still prints the blends
    }
    const expected = new Map<string, Record<string, number>>();
    const section = out.split('Derived blends (personas):')[1]?.split('Leads (')[0] ?? '';
    for (const line of section.split('\n')) {
      const m = line.match(/^\s+(\S+)\s+(.+)$/);
      if (!m) continue;
      expected.set(m[1]!, Object.fromEntries(m[2]!.split(' · ').map((p) => { const [k, v] = p.trim().split(' '); return [k!, Number(v)]; })));
    }
    expect(expected.size).toBeGreaterThan(100);
    const personas: { id: string; personality: { sliders: Sliders; traits: string[] }; team_roles?: string[]; seniority?: string }[] = [];
    for (const f of readdirSync(join(ROOT, 'catalog/personas')).filter((x) => x.endsWith('.json'))) {
      personas.push(...(JSON.parse(readFileSync(join(ROOT, 'catalog/personas', f), 'utf8')).personas ?? []));
    }
    const leads = readdirSync(join(ROOT, 'catalog/leads')).filter((x) => x.startsWith('lead-')).map((f) => JSON.parse(readFileSync(join(ROOT, 'catalog/leads', f), 'utf8')));
    const stats = sliderStatsOf([...personas.map((p) => p.personality.sliders), ...leads.map((l) => l.personality.sliders)]);
    let compared = 0;
    for (const p of personas) {
      const want = expected.get(p.id);
      if (!want) continue;
      const got = deriveBlend({ sliders: p.personality.sliders, traits: p.personality.traits, roles: (p.team_roles ?? []) as never, seniority: p.seniority as never }, archetypesFile, stats);
      expect(got, p.id).toEqual(want);
      compared++;
    }
    expect(compared).toBe(expected.size);
  }, 30_000); // runs the whole catalog validator: slow under a full parallel test run
});

describe('buildAgentIndex (§5.2 priors)', () => {
  const catalog = fixtureCatalog();

  it('weights signature 1.6×, catchphrase 1.2×, archetype × blend weight × intent weight', () => {
    const chief = fixtureIndex('chief');
    const w = chief.intentWeight('greeting');
    const cands = chief.candidates('greeting');
    const sig = cands.find((c) => c.line.id === 'lead-warm-mentor.greeting.01')!;
    const arch = cands.find((c) => c.line.id === 'warm.greeting.01')!;
    expect(sig.prior).toBeCloseTo(1.6 * w);
    expect(arch.prior).toBeCloseTo(0.5 * w);
    const wq = chief.intentWeight('encouragement');
    const catchphrase = chief.candidates('encouragement').find((c) => c.line.id === 'lead-warm-mentor.catch.02')!;
    expect(catchphrase.prior).toBeCloseTo(1.2 * wq);
  });

  it('per-intent signature weight (E3): 1.0 in high-frequency reflexes, and catchphrases never outweigh it', () => {
    const chief = fixtureIndex('chief');
    const w = chief.intentWeight('thinking_filler');
    const cands = chief.candidates('thinking_filler');
    expect(cands.find((c) => c.line.id === 'lead-warm-mentor.thinking_filler.01')!.prior).toBeCloseTo(1 * w);
    expect(cands.find((c) => c.line.id === 'lead-warm-mentor.catch.01')!.prior).toBeCloseTo(1 * w);
    expect(cands.find((c) => c.line.id === 'warm.thinking_filler.01')!.prior).toBeCloseTo(0.5 * w);
  });

  it('defaults caps (E1, E2, E17): quips and catchphrases once a day and twice a week; lang lines once a day', () => {
    const catalog = fixtureCatalog();
    const quip = catalog.linesFor('warm', 'quip')[0]!;
    expect([quip.maxPerDay, quip.maxPerWeek]).toEqual([1, 2]);
    const catch1 = catalog.linesFor('lead-warm-mentor', 'acknowledge').find((l) => l.source === 'catchphrase')!;
    expect([catch1.maxPerDay, catch1.maxPerWeek]).toEqual([2, 2]);
    const ack = catalog.linesFor('warm', 'acknowledge')[0]!;
    expect([ack.maxPerDay, ack.maxPerWeek]).toEqual([null, null]);
  });

  it('renders each laugh kind for xAI (E13) and keeps an authored non-generic rendering', () => {
    const base = { intensity: 0.4, readiness: 0.5, caption: '(laughs)' };
    expect(laughXaiFor({ ...base, kind: 'snort', xai: '[laugh]' })).toBe('[sharp-breath] [laugh]');
    expect(laughXaiFor({ ...base, kind: 'giggle', xai: '<soft>[laugh]</soft>' })).toBe('<fast>[laugh]</fast>');
    expect(laughXaiFor({ ...base, kind: 'dry_huff' })).toBe('[breath] <soft>[laugh]</soft>');
    expect(laughXaiFor({ ...base, kind: 'belly_laugh', xai: '[laugh]' })).toBe('[laugh] [laugh]');
    expect(laughXaiFor({ ...base, kind: 'chuckle', xai: '[breath] [laugh]' })).toBe('[breath] [laugh]');
    expect(laughXaiFor({ ...base, kind: 'silent_smile' })).toBe('');
    const ruthLaugh = fixtureCatalog().linesFor('red-team-sceptic', 'laugh').find((l) => l.id.endsWith('.laugh.00'))!;
    expect(ruthLaugh.xai).toBe('[breath] <soft>[laugh]</soft>'); // a dry huff, not the generic soft laugh
  });

  it('intent weights blend archetype multipliers and signature overrides; disabled intents are 0', () => {
    const ruth = fixtureIndex('ruth');
    // dry-wit 0.7 · calm-steady 1 · warm 1.2 for backchannel, then the signature's 0.7.
    expect(ruth.intentWeight('backchannel')).toBeCloseTo((0.5 * 0.7 + 0.3 * 1 + 0.2 * 1.2) * 0.7);
    expect(ruth.intentWeight('celebrate')).toBeCloseTo((0.5 * 1 + 0.3 * 0.8 + 0.2 * 1) * 0.7); // sceptic celebrates quietly
    const camila = fixtureIndex('camila');
    expect(camila.intentWeight('holding_filler')).toBe(0);
    expect(camila.candidates('holding_filler')).toEqual([]);
  });

  it('uses one laugh voice: the signature laugh, or the dominant archetype laugh without a signature', () => {
    const chief = fixtureIndex('chief');
    const ids = chief.candidates('laugh').map((c) => c.line.id);
    expect(ids).toContain('lead-warm-mentor.laugh.00');
    expect(ids.filter((i) => i.endsWith('.laugh.00'))).toEqual(['lead-warm-mentor.laugh.00']);
    const jelena = buildAgentIndex(catalog, PROFILES.jelena as AgentExpressionProfile);
    const dominant = Object.entries(jelena.blend).sort((a, b) => b[1]! - a[1]!)[0]![0];
    expect(jelena.laugh).toEqual(catalog.archetypes.get(dominant as never)!.laugh);
    expect(jelena.candidates('laugh').filter((c) => c.line.id.endsWith('.laugh.00')).map((c) => c.line.id)).toEqual([`${dominant}.laugh.00`]);
  });

  it('carries baseline mood, reactivity, never_says and the voice', () => {
    const ruth = fixtureIndex('ruth');
    expect(ruth.neverSays).toEqual(['absolutely', 'no-brainer']);
    expect(ruth.voice.xai).toBe('luna');
    expect(ruth.baseline.valence).toBeGreaterThan(0);
    expect(ruth.reactivity).toBeGreaterThanOrEqual(0.35);
    expect(ruth.catalogVersion).toBe(catalog.version);
  });
});
