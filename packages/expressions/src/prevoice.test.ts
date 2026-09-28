import { describe, expect, it } from 'vitest';
import { clipKey, toDelivery } from './delivery';
import { planPrevoice } from './prevoice';
import { renderUtterance } from './select';
import { fixtureCatalog, fixtureIndex } from './testing';
import type { CommonFills, PrevoiceItem } from './types';

const catalog = fixtureCatalog();
const chief = fixtureIndex('chief');
const fills: CommonFills = { owner_name: 'Dana', chief_name: 'Samuel', self_name: 'Samuel', coworkers: ['Ruth', 'Camila'], projects: ['Northwind'] };
const P0 = new Set(['backchannel', 'acknowledge', 'thinking_filler', 'holding_filler', 'laugh', 'gratitude_reply', 'greeting', 'sign_off', 'juggling']);

describe('planPrevoice (§7)', () => {
  it('P0 covers the reflex-grade intents, with every finite value', async () => {
    const items = await planPrevoice(chief, catalog, 'xai', fills, { tiers: ['p0'] });
    expect(items.length).toBeGreaterThan(20);
    for (const it of items) {
      expect(it.tier).toBe('p0');
      expect(P0.has(it.intent), it.intent).toBe(true);
      expect(it.clipKey).toMatch(/^c1_/);
    }
    const eta = items.filter((i) => i.lineId === 'warm.juggling.02');
    expect(eta.map((i) => i.fills.eta).sort()).toEqual(['a couple of minutes', 'a few seconds', 'a minute', 'a second', 'half a minute', 'ten seconds']);
    const pod = items.filter((i) => i.lineId === 'warm.greeting.02').map((i) => i.fills.part_of_day);
    expect(pod.sort()).toEqual(['afternoon', 'evening', 'morning']);
    expect(items.some((i) => i.lineId === 'lead-warm-mentor.laugh.00')).toBe(true);
  });

  it('stores owner and team fills under the workspace scope, slot-free and self_name lines as shared (H8)', async () => {
    const items = await planPrevoice(chief, catalog, 'xai', fills);
    const byLine = (id: string) => items.filter((i) => i.lineId === id);
    expect(byLine('warm.acknowledge.04')[0]).toMatchObject({ scope: 'workspace', fills: { owner_name: 'Dana' } });
    expect(byLine('warm.acknowledge.01')[0]).toMatchObject({ scope: 'shared', fills: {}, fillKey: '' });
    expect(byLine('warm.passing_by.05')[0]).toMatchObject({ scope: 'shared', fills: { self_name: 'Samuel' }, tier: 'p1' });
    expect(byLine('warm.handoff_give.01').map((i) => [i.fills.coworker, i.scope, i.tier])).toEqual([['Ruth', 'workspace', 'p2'], ['Camila', 'workspace', 'p2']]);
  });

  it('pre-voices the prefix of runtime lines (P1) and slot-free lines of runtime intents, never runtime slots', async () => {
    const items = await planPrevoice(chief, catalog, 'xai', fills);
    const prefix = items.find((i) => i.lineId === 'warm.passing_by.01~prefix')!;
    expect(prefix).toMatchObject({ tier: 'p1', fills: {}, scope: 'shared' });
    expect(prefix.delivery.input).toBe('Hi —');
    expect(items.find((i) => i.lineId === 'warm.juggling.01~prefix')?.delivery.input).toBe('Hang on —');
    expect(items.find((i) => i.lineId === 'warm.micro_status.03')?.tier).toBe('p1');
    for (const it of items) for (const s of ['step_label', 'artifact', 'blocker', 'other_thread', 'client', 'gist']) expect(it.fills).not.toHaveProperty(s);
    // Owner-named lines need the owner's name; without it they are skipped, never guessed.
    const anon = await planPrevoice(chief, catalog, 'xai', { self_name: 'Samuel' }, { tiers: ['p0'] });
    expect(anon.some((i) => 'owner_name' in i.fills)).toBe(false);
  });

  it('keys clips by delivery: the same text in the same voice shares a clip; the manifest key is lineId|fillKey', async () => {
    const ruth = fixtureIndex('ruth');
    const items = await planPrevoice(ruth, catalog, 'xai', { self_name: 'Ruth' }, { tiers: ['p0'], perIntent: 20 });
    const mm = items.filter((i) => i.delivery.input === 'mm');
    expect(mm.length).toBeGreaterThanOrEqual(2); // "mm" is in dry-wit, calm-steady and warm
    expect(new Set(mm.map((i) => i.clipKey)).size).toBe(1);
    const one: PrevoiceItem = items[0]!;
    const r = renderUtterance(ruth, one.lineId, one.fills);
    expect(r.ok).toBe(true);
    if (r.ok) expect(await clipKey(toDelivery(r.utterance, ruth.voice, 'xai')!)).toBe(one.clipKey); // the render path agrees
  });

  it('respects limits and providers', async () => {
    const top = await planPrevoice(chief, catalog, 'xai', fills, { tiers: ['p0'], perIntent: 2 });
    const perLine = new Map<string, Set<string>>();
    for (const i of top) perLine.set(i.intent, (perLine.get(i.intent) ?? new Set()).add(i.lineId));
    for (const lines of perLine.values()) expect(lines.size).toBeLessThanOrEqual(2);
    const all = await planPrevoice(chief, catalog, 'xai', fills, { tiers: ['p0'], perIntent: 2, allLinesFor: ['acknowledge'] });
    expect(new Set(all.filter((i) => i.intent === 'acknowledge').map((i) => i.lineId)).size).toBe(chief.candidates('acknowledge').length);
    const capped = await planPrevoice(chief, catalog, 'xai', fills, { maxClips: 10 });
    expect(new Set(capped.map((i) => i.clipKey)).size).toBeLessThanOrEqual(10);
    expect(await planPrevoice(chief, catalog, 'browser', fills)).toEqual([]);
    const oa = await planPrevoice(chief, catalog, 'openai', fills, { tiers: ['p0'] });
    const laugh = oa.find((i) => i.lineId === 'lead-warm-mentor.laugh.00')!;
    expect(laugh.delivery).toMatchObject({ provider: 'openai', voiceId: 'verse', input: 'Heh heh.' });
    expect(laugh.delivery.instructions).toContain('pleased with itself');
  });
});
