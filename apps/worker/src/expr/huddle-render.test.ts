// POST /api/expr/huddle/render (Office Phase 2 §4.2.9): validation, provider checks, clip-key parity with the client's
// `clipKey(toDelivery(huddleUtterance(pick, i), voice, provider))`, and the free cache hit.
import { clipKey, createHuddleRecency, huddleUtterance, pickExchange, toDelivery, type HuddleParticipant, type HuddlePick } from '@headcount/expressions';
import { afterEach, describe, expect, it } from 'vitest';
import { exprSetup, useProviders } from '../../test/expr-kit';
import type { Env } from '../env';
import { defaultRuntime, runtime } from '../workspace/runtime';
import { exprHuddles, indexFor, profileFor } from './catalog';

afterEach(() => Object.assign(runtime, defaultRuntime));

const SETTINGS = { leadId: 'lead-warm-mentor', chiefName: null };
const AGENTS = ['cw_senior-copywriter', 'cw_tech-lead', 'cw_contracts-analyst'];

function participants(): HuddleParticipant[] {
  return AGENTS.map((agentId) => {
    const profile = profileFor(agentId, SETTINGS)!;
    const index = indexFor(profile);
    return { agentId, firstName: profile.firstName, index, mood: index.baseline };
  });
}

/** A pick with at least one voiced line that has fills (a name, the part of day), for the parity test. */
function aPick(): HuddlePick {
  const h = exprHuddles()!;
  const people = participants().slice(0, 2);
  for (const spot of ['window', 'hallway', 'water_cooler', 'coffee_bar', 'lounge'] as const) {
    for (let i = 0; i < 300; i++) {
      const pick = pickExchange(
        h,
        {
          huddleId: `hd:2026-09-29:${spot}:635`,
          spot,
          participants: people,
          now: { epochMs: Date.UTC(2026, 8, 29, 10, 35), localHour: 10, weekday: 2 },
          ambience: 'lively',
          provider: 'mock',
          maxLines: 6,
          seed: `hd:2026-09-29:${spot}:635|${i}`,
        },
        createHuddleRecency(),
      );
      if (pick && pick.lines.some((l) => l.voiceable && Object.keys(l.fills).length)) return pick;
    }
  }
  throw new Error('no pick with fills');
}

const render = (s: Awaited<ReturnType<typeof exprSetup>>, body: unknown) => s.api('POST', '/api/expr/huddle/render', body);

describe('POST /api/expr/huddle/render', () => {
  it('renders each turn in the speaker’s voice with the client’s clip key, then serves it from storage', async () => {
    useProviders();
    const s = await exprSetup({ MOCK_MEDIA: 'true' } as Partial<Env>);
    const pick = aPick();
    const people = new Map(participants().map((p) => [p.agentId, p]));
    let checked = 0;
    for (let k = 0; k < pick.lines.length; k++) {
      const line = pick.lines[k]!;
      if (!line.voiceable) continue;
      const u = huddleUtterance(pick, k);
      const delivery = toDelivery(u, people.get(line.agentId)!.index.voice, 'mock')!;
      const expected = await clipKey(delivery);
      const r = await render(s, { exchangeId: pick.exchangeId, index: line.index, agentId: line.agentId, fills: line.fills, provider: 'mock' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ clipKey: expected, url: `/api/expr/clips/${expected}`, scope: 'shared' });
      const again = await render(s, { exchangeId: pick.exchangeId, index: line.index, agentId: line.agentId, fills: line.fills, provider: 'mock' });
      expect(again.body).toMatchObject({ clipKey: expected, cached: true });
      expect((await s.api('GET', `/api/expr/clips/${expected}`)).status).toBe(200);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('validates the body, the agent, the turn and the fills', async () => {
    useProviders();
    const s = await exprSetup({ MOCK_MEDIA: 'true' } as Partial<Env>);
    const pick = aPick();
    const line = pick.lines.find((l) => l.voiceable && Object.keys(l.fills).length)!;
    const ok = { exchangeId: pick.exchangeId, index: line.index, agentId: line.agentId, fills: line.fills, provider: 'mock' };
    expect((await render(s, [])).status).toBe(400);
    expect((await render(s, { ...ok, index: -1 })).status).toBe(400);
    expect((await render(s, { ...ok, provider: 'loud' })).status).toBe(400);
    expect((await render(s, { ...ok, agentId: 'nobody' })).status).toBe(400);
    expect((await render(s, { ...ok, agentId: 'cw_nobody-at-all' })).status).toBe(404);
    expect((await render(s, { ...ok, exchangeId: 'hd-nope.999' })).status).toBe(400);
    expect((await render(s, { ...ok, fills: { ...line.fills, project: 'Secret plan' } })).status).toBe(400);
    expect((await render(s, { ...ok, fills: {} })).status).toBe(400);
    expect((await render(s, { ...ok, fills: Object.fromEntries(Object.keys(line.fills).map((k) => [k, '<b>Kate</b>'])) })).status).toBe(400);
    expect((await render(s, { ...ok, provider: 'xai' })).status).toBe(409);
    const fresh = await exprSetup({ MOCK_MEDIA: 'true' } as Partial<Env>, { lead: null });
    expect((await render(fresh, { ...ok, agentId: 'cw_chief' })).body.error).toMatchObject({ code: 'not_found', message: 'Choose a Chief of Staff first.' });
  });

  it('answers 503 without a voice provider (keyless listen-in is captions only)', async () => {
    useProviders();
    const s = await exprSetup();
    const pick = aPick();
    const line = pick.lines.find((l) => l.voiceable)!;
    const r = await render(s, { exchangeId: pick.exchangeId, index: line.index, agentId: line.agentId, fills: line.fills, provider: 'browser' });
    expect(r.status).toBe(503);
    expect(r.body.error.missingKeys).toEqual(['XAI_API_KEY', 'OPENAI_API_KEY']);
  });
});
