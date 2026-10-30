// Pre-voicing (LIVING-PLAN §3.2 `exprPrevoice`, §4 A3): plan, skip and record stored clips, reuse finished runs, dry
// runs that spend nothing, the daily budget stop, and a runner that resumes after a restart.
import { afterEach, describe, expect, it } from 'vitest';
import { exprSetup, fakeTts, useProviders, type SpeechCall } from '../../test/expr-kit';
import { RunDO } from '../runs/run-do';
import { defaultRuntime, runtime } from '../workspace/runtime';
import { chiefProfile, indexFor } from './catalog';

afterEach(() => Object.assign(runtime, defaultRuntime));

const XAI = { XAI_API_KEY: 'xai-test-key' };
const P0 = { agentIds: ['cw_chief'], tiers: ['p0'] };

describe('POST /api/expr/prevoice', () => {
  it('plans P0, renders it in the background, records the manifest, and reuses the finished run', async () => {
    useProviders();
    const s = await exprSetup({ MOCK_MEDIA: 'true' });
    const r = await s.api('POST', '/api/expr/prevoice', P0);
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ accepted: true, provider: 'mock', alreadyCached: 0 });
    expect(r.body.planned).toBeGreaterThanOrEqual(60);
    expect(r.body.toRender).toBe(r.body.planned);
    expect(r.body.runId).toMatch(/^pv_/);
    expect(r.body.estAudioMs).toBeGreaterThan(0);

    const ticks = await s.runPrevoice();
    expect(ticks).toBeGreaterThan(r.body.planned / 3 - 1);
    const status = await s.api('GET', `/api/expr/prevoice/${r.body.runId}`);
    expect(status.body).toMatchObject({ runId: r.body.runId, state: 'done', provider: 'mock', rendered: r.body.planned, failed: 0, tiers: ['p0'], agentIds: ['cw_chief'] });

    const agent = await s.api('GET', '/api/expr/agents/cw_chief');
    expect(Object.keys(agent.body.manifest.clips).length).toBeGreaterThanOrEqual(r.body.planned);
    expect(agent.body.prevoice).toMatchObject({ runId: r.body.runId, state: 'done' });

    const again = await s.api('POST', '/api/expr/prevoice', P0);
    expect(again).toMatchObject({ status: 200, body: { reused: true, toRender: 0, runId: r.body.runId } });
  });

  it('skips clips already stored (recording them without TTS) and renders only the rest; a dry run spends nothing', async () => {
    const calls: SpeechCall[] = [];
    useProviders({ speech: { xai: fakeTts('xai', calls) } });
    const s = await exprSetup(XAI);
    const dry = await s.api('POST', '/api/expr/prevoice', { ...P0, dryRun: true });
    expect(dry).toMatchObject({ status: 200, body: { dryRun: true, runId: null, alreadyCached: 0 } });
    expect(dry.body.planned).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
    expect(s.t.r2.objects.size).toBe(0);
    expect(Object.keys((await s.api('GET', '/api/expr/agents/cw_chief')).body.manifest.clips)).toHaveLength(0);

    // One line rendered at runtime first: the run records it without TTS and renders only the other.
    const [a, b] = chiefLines('acknowledge');
    expect((await s.api('POST', '/api/expr/render', { agentId: 'cw_chief', lineId: a, fills: {}, provider: 'xai' })).status).toBe(200);
    expect(calls).toHaveLength(1);
    const items = [a!, b!].map((lineId) => ({ agentId: 'cw_chief', lineId, fills: {} }));
    const r = await s.api('POST', '/api/expr/prevoice', { agentIds: ['cw_chief'], items });
    expect(r).toMatchObject({ status: 202, body: { planned: 2, alreadyCached: 1, toRender: 1 } });
    await s.runPrevoice();
    expect(calls).toHaveLength(2);
    expect((await s.api('GET', `/api/expr/prevoice/${r.body.runId}`)).body).toMatchObject({ state: 'done', cached: 1, rendered: 1 });
    const clips = (await s.api('GET', '/api/expr/agents/cw_chief')).body.manifest.clips;
    expect(clips[`${a}|`]).toBeTruthy();
    expect(clips[`${b}|`]).toBeTruthy();
  });

  it('stops with stopped_budget when the day’s clip budget runs out, and answers 429 when nothing fits', async () => {
    const calls: SpeechCall[] = [];
    useProviders({ speech: { xai: fakeTts('xai', calls) } });
    const s = await exprSetup({ ...XAI, EXPR_CLIP_DAILY_LIMIT: '4' });
    const r = await s.api('POST', '/api/expr/prevoice', P0);
    expect(r.status).toBe(202);
    expect(r.body.remainingToday).toBe(4);
    await s.runPrevoice();
    const status = (await s.api('GET', `/api/expr/prevoice/${r.body.runId}`)).body;
    expect(status).toMatchObject({ state: 'stopped_budget', rendered: 4, error: expect.stringContaining('EXPR_CLIP_DAILY_LIMIT') });
    expect(calls).toHaveLength(4);
    // A new plan (different tiers) finds nothing left in today's budget.
    const none = await s.api('POST', '/api/expr/prevoice', { agentIds: ['cw_chief'], tiers: ['p1'] });
    expect(none).toMatchObject({ status: 429, body: { error: { code: 'rate_limited', message: expect.stringContaining('EXPR_CLIP_DAILY_LIMIT') } } });
  });

  it('resumes after the runner object restarts (its queue is in SQLite)', async () => {
    useProviders();
    const s = await exprSetup({ MOCK_MEDIA: 'true' });
    const r = await s.api('POST', '/api/expr/prevoice', P0);
    await s.runner().alarm(); // one tick, then the object "dies"
    const state = s.t.namespaces.RUN.state('run:expr-prevoice:local');
    const mid = await s.runner().prevoiceStatus(r.body.runId);
    expect(mid).toMatchObject({ state: 'running', rendered: 3 });
    state.storage.alarmAt = null; // lost with the old instance
    const revived = new RunDO(state as unknown as DurableObjectState, s.t.env);
    await Promise.resolve();
    expect(state.storage.alarmAt).not.toBeNull(); // the constructor re-arms an unfinished run
    for (let i = 0; i < 200 && state.storage.alarmAt !== null; i++) await revived.alarm();
    expect(await revived.prevoiceStatus(r.body.runId)).toMatchObject({ state: 'done', rendered: r.body.planned });
  });

  it('plans nothing for the browser voice, validates the request, and 404s an unknown agent or run', async () => {
    useProviders();
    const s = await exprSetup({});
    const r = await s.api('POST', '/api/expr/prevoice', P0);
    expect(r).toMatchObject({ status: 200, body: { provider: 'browser', planned: 0, toRender: 0, runId: null } });
    expect((await s.api('POST', '/api/expr/prevoice', { agentIds: [] })).status).toBe(400);
    expect((await s.api('POST', '/api/expr/prevoice', { agentIds: ['cw_chief'], tiers: ['p9'] })).status).toBe(400);
    expect((await s.api('POST', '/api/expr/prevoice', { agentIds: ['cw_chief'], perIntent: 99 })).status).toBe(400);
    expect((await s.api('POST', '/api/expr/prevoice', { agentIds: ['cw_nobody-at-all'] })).status).toBe(404);
    expect((await s.api('GET', '/api/expr/prevoice/pv_01aaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(404);
    const noLead = await exprSetup({ MOCK_MEDIA: 'true' }, { lead: null });
    expect((await noLead.api('POST', '/api/expr/prevoice', P0)).status).toBe(404);
  });

  it('re-validates caller items: unknown lines and bad fills are skipped', async () => {
    useProviders();
    const s = await exprSetup({ MOCK_MEDIA: 'true' });
    const ack = chiefLines('acknowledge')[0]!;
    const r = await s.api('POST', '/api/expr/prevoice', {
      agentIds: ['cw_chief'],
      items: [
        { agentId: 'cw_chief', lineId: ack, fills: {} },
        { agentId: 'cw_chief', lineId: 'no.such.line', fills: {} },
        { agentId: 'cw_chief', lineId: ack, fills: { gist: '<b>bad</b>' } },
      ],
    });
    expect(r).toMatchObject({ status: 202, body: { planned: 1, toRender: 1 } });
    await s.runPrevoice();
    expect((await s.api('GET', '/api/expr/agents/cw_chief')).body.manifest.clips[`${ack}|`]).toBeTruthy();
  });
});

describe('the owner’s name in pre-voicing (Office Phase 2 §4.2.10)', () => {
  it('fills {owner_name} lines, keeps them workspace-scoped, and a rename re-plans', async () => {
    useProviders();
    const s = await exprSetup({ MOCK_MEDIA: 'true' });
    const body = { agentIds: ['cw_chief'], tiers: ['p0', 'p1'], dryRun: true };
    const without = await s.api('POST', '/api/expr/prevoice', body);
    await s.api('PUT', '/api/workspace', { ownerName: 'Greg' });
    const named = await s.api('POST', '/api/expr/prevoice', body);
    // More lines become eligible once the office knows the owner's name.
    expect(named.body.planned).toBeGreaterThan(without.body.planned);
    const { planPrevoiceRun, prevoiceFingerprint } = await import('./prevoice');
    const settings = await s.ws.getSettings();
    const plan = await planPrevoiceRun(runtime.registry(s.t.env), true, settings, { agentIds: ['cw_chief'], tiers: ['p0', 'p1'] }, 300);
    const withName = plan.items.filter((i) => i.text.includes('Greg'));
    expect(withName.length).toBeGreaterThan(0);
    expect(withName.every((i) => i.scope === 'workspace')).toBe(true);
    const req = { agentIds: ['cw_chief'], tiers: ['p0', 'p1'] as ('p0' | 'p1')[] };
    expect(await prevoiceFingerprint(req, plan, 300, 'Greg')).not.toBe(await prevoiceFingerprint(req, plan, 300, 'Gregory'));
    expect(await prevoiceFingerprint(req, plan, 300, null)).toBe(await prevoiceFingerprint(req, plan, 300));
  });
});

/** Slot-free verbal lines of the Chief for an intent, by prior. */
describe('speculative pre-voicing of a lead the owner has not chosen (LIVING-WORKFORCE §7.1)', () => {
  it('pre-voices cw_<leadId> into the very clips cw_chief finds once that lead is chosen', async () => {
    const calls: SpeechCall[] = [];
    useProviders({ speech: { xai: fakeTts('xai', calls) } });
    const s = await exprSetup(XAI, { lead: null });
    const agent = await s.api('GET', '/api/expr/agents/cw_lead-steady-operator');
    expect(agent.status).toBe(200);
    expect(agent.body).toMatchObject({ agentId: 'cw_lead-steady-operator', personaId: 'lead-steady-operator', staffed: false, provider: 'xai', profile: { teamRole: 'chief', personality: { leadId: 'lead-steady-operator' } } });
    // The Chief does not exist yet; unknown leads stay unknown.
    expect((await s.api('GET', '/api/expr/agents/cw_chief')).status).toBe(404);
    expect((await s.api('GET', '/api/expr/agents/cw_lead-nobody')).status).toBe(404);

    const r = await s.api('POST', '/api/expr/prevoice', { agentIds: ['cw_lead-steady-operator'], tiers: ['p0'] });
    expect(r.status).toBe(202);
    await s.runPrevoice();
    expect(calls).toHaveLength(r.body.toRender);
    expect((await s.api('GET', `/api/expr/prevoice/${r.body.runId}`)).body).toMatchObject({ state: 'done', failed: 0 });

    // The owner picks that lead (default name): the Chief's P0 is already in R2, so nothing new is rendered.
    await s.ws.updateSettings({ leadId: 'lead-steady-operator' });
    const chief = await s.api('POST', '/api/expr/prevoice', P0);
    expect(chief.body).toMatchObject({ planned: r.body.planned, alreadyCached: r.body.planned, toRender: 0 });
    expect(calls).toHaveLength(r.body.toRender);
  });
});

function chiefLines(intent: 'acknowledge' | 'thinking_filler'): string[] {
  const index = indexFor(chiefProfile({ leadId: 'lead-warm-mentor', chiefName: null })!);
  return [...index.candidates(intent)]
    .sort((a, b) => b.prior - a.prior || a.line.id.localeCompare(b.line.id))
    .filter((w) => !w.line.slots.length && !w.line.nonverbal)
    .map((w) => w.line.id);
}
