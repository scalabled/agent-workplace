import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../scripts/build-catalog.mjs';
import { catalogFull, fullIndex } from './full';
import { chiefDisplayName, initials, leadVoiceRef, personaVoiceRef, renameLine, scoreMatchQuiz } from './helpers';
import { catalogSlim, slimIndex } from './slim';
import type { Lead, MatchQuiz } from './types';

describe('generated bundles (real catalog)', () => {
  it('loads leads and personas', () => {
    expect(catalogFull.kind).toBe('full');
    expect(catalogSlim.kind).toBe('slim');
    expect(catalogSlim.leads.length).toBeGreaterThan(0);
    expect(catalogSlim.personas.length).toBe(catalogFull.personas.length);
    expect(catalogSlim.sourceHash).toBe(catalogFull.sourceHash);
  });
  it('slims personas to the web fields', () => {
    const p = catalogSlim.personas[0]!;
    expect(Object.keys(p).sort()).toEqual(['avatar', 'backstory', 'department', 'handle', 'id', 'intro_line', 'name', 'one_liner', 'pronouns', 'seniority', 'skills', 'title', 'voice'].sort());
    expect(Object.keys(p.avatar).sort()).toEqual(['accent_color', 'appearance', 'portrait_prompt']);
    expect(slimIndex.persona(p.id)?.name).toBe(p.name);
    expect(fullIndex.persona(p.id)?.instructions).toBeTypeOf('string');
  });
  it('maps voices', () => {
    const lead = catalogFull.leads[0]!;
    expect(leadVoiceRef(lead).openai).toBe(lead.voice.openai_tts);
    const p = catalogFull.personas[0]!;
    expect(personaVoiceRef(p).xai).toBe(p.voice.xai.voice);
  });
});

describe('build tolerance', () => {
  it('skips unparsable files and incomplete records with warnings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
    mkdirSync(join(dir, 'personas'));
    mkdirSync(join(dir, 'leads'));
    writeFileSync(join(dir, 'taxonomy.json'), JSON.stringify({ departments: [{ id: 'd1', name: 'D1', personas: [{ id: 'a' }] }], leads: [] }));
    writeFileSync(join(dir, 'personas', 'd1.json'), JSON.stringify({ personas: [{ id: 'a', name: 'A B', handle: 'a', title: 't', department: 'd1', one_liner: 'x', voice: {}, avatar: {} }, { id: 'b' }] }));
    writeFileSync(join(dir, 'personas', 'd2.json'), '{ "personas": [ { "id": ');
    const { full, slim, report } = buildCatalog({ catalogDir: dir });
    expect(full.personas.map((p) => p.id)).toEqual(['a']);
    expect(slim.departments[0]?.personaIds).toEqual(['a']);
    expect(slim.matchQuiz).toBeNull();
    expect(report.warnings.some((w) => w.includes('d2.json'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('persona b'))).toBe(true);
  });
});

describe('helpers', () => {
  it('names the chief', () => {
    expect(chiefDisplayName({ name: 'Kobby Owusu' }, null)).toBe('Kobby');
    expect(chiefDisplayName({ name: 'Kobby Owusu' }, ' Rosa ')).toBe('Rosa');
    expect(initials('Anne-Marie Chen')).toBe('AC');
  });
  it('scores the match quiz with normalisation and autonomy tie-break', () => {
    const quiz: MatchQuiz = {
      version: 1,
      intro: '',
      questions: [
        { id: 'q1', prompt: '', kind: 'single', options: [{ id: 'a', label: '', weights: { l1: 2 } }, { id: 'b', label: '', weights: { l2: 2 } }] },
        { id: 'q2', prompt: '', kind: 'scale', scale: { min: 1, max: 5, low_label: '', high_label: '', weights_low: { l1: 1 }, weights_high: { l2: 1 } } },
      ],
      scoring: { method: 'weighted_sum', normalize_by_max_possible: true, show_top: 3 },
      results: {},
    };
    const leads = [
      { id: 'l1', defaults: { autonomy: 3 } },
      { id: 'l2', defaults: { autonomy: 2 } },
    ] as Pick<Lead, 'id' | 'defaults'>[];
    expect(scoreMatchQuiz(quiz, { q1: 'a', q2: 1 }, leads)[0]?.leadId).toBe('l1');
    expect(scoreMatchQuiz(quiz, { q1: 'b', q2: 5 }, leads)[0]).toMatchObject({ leadId: 'l2', normalized: 1 });
    expect(scoreMatchQuiz(quiz, {}, leads)[0]?.leadId).toBe('l2');
  });
});

describe('renameLine', () => {
  const lead = { name: 'Paolo Bautista' };
  it('replaces the catalog first name with the chosen one, whole words only', () => {
    expect(renameLine("I'm Paolo. Give me the messy version.", lead, 'Rosa')).toBe("I'm Rosa. Give me the messy version.");
    expect(renameLine('Paolozzi and Paolo’s plan', lead, 'Rosa')).toBe('Paolozzi and Rosa’s plan');
    expect(renameLine('Costs $5', lead, '$& Rosa')).toBe('Costs $5');
    expect(renameLine('Hi Paolo', lead, '$1 Lu')).toBe('Hi $1 Lu');
  });
  it('leaves the line alone without a different name', () => {
    expect(renameLine("I'm Paolo.", lead, null)).toBe("I'm Paolo.");
    expect(renameLine("I'm Paolo.", lead, 'Paolo')).toBe("I'm Paolo.");
    expect(renameLine('Hello, I’m Tou.', { name: 'Tou Moua' }, 'Ana')).toBe('Hello, I’m Ana.');
  });
  it('covers every catalog greeting', () => {
    for (const l of catalogFull.leads) {
      const first = l.name.split(' ')[0]!;
      const out = renameLine(l.communication.greeting, l, 'Rosa');
      expect(out).not.toMatch(new RegExp(`\\b${first}\\b`));
    }
  });
});
