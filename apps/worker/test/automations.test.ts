// biz-bot parity, stage 3b: automations. Specs and conditions (pure), then schedules, page watchers, the one-run-at-a-
// time rule, team projects that start themselves, the gate on what the owner hears, and the Chief's proposal card.
import { ids, parseFrame, type Frame, type FrameType } from '@headcount/protocol';
import type { AutomationsResponse, AutomationView } from '@headcount/protocol/ext/automations';
import type { Decision } from '@headcount/protocol/ext/projects';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeSpec, evaluate, extractValue, normalizeSpec, riskyPattern } from '../src/automations/host';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import type { ProjectDO } from '../src/jobs/project-do';
import type { WorkspaceDO } from '../src/workspace/workspace-do';
import { runtime } from '../src/workspace/runtime';
import { createTestEnv } from './fake-cloud';

describe('automation specs (pure)', () => {
  const base = { name: 'Prices', kind: 'schedule' as const, action: { type: 'job' as const, goal: 'Check competitor prices' }, gate: 'quiet' as const };

  it('normalises and refuses what cannot run', () => {
    expect(normalizeSpec({ ...base, schedule: { everyMinutes: 60 } })).toEqual({ ...base, schedule: { everyMinutes: 60 }, enabled: true });
    expect(normalizeSpec({ ...base, action: { type: 'project', goal: 'Plan the week ahead' }, gate: undefined as never, schedule: { dailyAt: '09:00' } })).toMatchObject({ action: { type: 'project', autoStart: true }, gate: 'quiet' });
    const bad: [object, RegExp][] = [
      [{ ...base, schedule: { everyMinutes: 5 } }, /at most every 15 minutes/],
      [{ ...base, schedule: { dailyAt: '25:00' } }, /HH:MM/],
      [{ ...base, schedule: {} }, /interval or a daily time/],
      [{ ...base, kind: 'page', page: { url: 'http://example.com', condition: 'changed' } }, /https/],
      [{ ...base, kind: 'page', page: { url: 'https://example.com', condition: 'below', value: 'cheap' } }, /number/],
      [{ ...base, kind: 'page', page: { url: 'https://example.com', condition: 'changed', extract: '(a+)+$' } }, /simplify/],
      [{ ...base, action: { type: 'job', goal: 'go' }, schedule: { everyMinutes: 60 } }, /what each run should do/],
    ];
    for (const [spec, err] of bad) expect(() => normalizeSpec(spec)).toThrow(err);
  });

  it('describes itself in one line', () => {
    expect(describeSpec(normalizeSpec({ ...base, schedule: { dailyAt: '09:00' } }))).toBe('Every day at 09:00 UTC → a background job');
    expect(describeSpec(normalizeSpec({ ...base, schedule: { everyMinutes: 60 * 24 * 7 } }))).toBe('Every week → a background job');
    expect(describeSpec(normalizeSpec({ ...base, kind: 'page', page: { url: 'https://shop.example.com/x', condition: 'below', value: '50' }, action: { type: 'project', goal: 'Buy the stock', autoStart: false } }))).toBe(
      'When shop.example.com drops below “50” (checked every hour) → a team project (the plan waits for your OK)',
    );
  });

  it('evaluates page conditions like biz-bot (changed after a baseline; the others when they become true)', async () => {
    expect(evaluate('changed', undefined, 'a', null, false)).toEqual({ fire: false, match: false });
    expect(evaluate('changed', undefined, 'b', 'a', false)).toEqual({ fire: true, match: true });
    expect(evaluate('contains', 'Sold out', 'now sold out!', null, false)).toEqual({ fire: true, match: true });
    expect(evaluate('contains', 'Sold out', 'now sold out!', null, true)).toEqual({ fire: false, match: true });
    expect(evaluate('below', '50', '$1,045.00', null, false)).toEqual({ fire: false, match: false });
    expect(evaluate('below', '50', '45', null, false)).toEqual({ fire: true, match: true });
    expect(await extractValue('Price: $42.50 today', String.raw`Price:\s*\$([\d.]+)`)).toBe('42.50');
    expect(await extractValue('some page')).toMatch(/^sha256:[0-9a-f]{24}$/);
    expect(riskyPattern('(a|aa)+')).toBe(true);
    expect(riskyPattern(String.raw`Price:\s*\$([\d,.]+)`)).toBe(false);
  });
});

async function setup(overrides: Partial<Env> = {}) {
  const t = await createTestEnv(overrides);
  const ws = t.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
  const project = t.namespaces.PROJECT.getByName('p:everyday:local') as ProjectDO;
  t.namespaces.WORKSPACE.state('ws:local').getWebSockets = () => [{ send: (m: string) => void parseFrame(m) } as unknown as WebSocket];
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await handle(new Request(`http://localhost${path}`, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }), t.env, t.ctx);
    return { status: res.status, body: (await res.json()) as any };
  };
  const tick = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      await project.alarm();
      await t.ctx.drain();
    }
  };
  const ofType = async <T extends FrameType>(type: T) => (await ws.frames(0, 5000)).filter((f): f is Extract<Frame, { type: T }> => f.type === type);
  const automations = async () => ((await api('GET', '/api/automations')).body as AutomationsResponse).automations;
  await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
  return { t, ws, project, api, tick, ofType, automations };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const realNow = runtime.now;

describe('automations in the workspace', () => {
  afterEach(() => {
    runtime.now = realNow;
    vi.unstubAllGlobals();
  });

  it('a schedule starts a background job; the gate decides what the owner hears; one run at a time', async () => {
    const s = await setup();
    const add = await s.api('POST', '/api/automations', { name: 'Morning prices', kind: 'schedule', schedule: { everyMinutes: 60 }, action: { type: 'job', goal: 'Check competitor coffee prices' }, gate: 'on' });
    expect(add.status).toBe(201);
    const a = add.body.automation as AutomationView;
    expect(a).toMatchObject({ enabled: true, createdBy: 'owner', describe: 'Every hour → a background job', runs: 0 });
    // An interval runs at the first tick (as in biz-bot).
    await s.tick();
    const fired = (await s.ofType('automation.fired')).at(-1)!.data;
    expect(fired).toMatchObject({ automationId: a.automationId, runKind: 'job', context: 'Scheduled run (every hour)' });
    const job = (await s.ofType('job.started')).at(-1)!.data.job;
    expect(job).toMatchObject({ jobId: fired.runId, title: 'Morning prices' });
    expect(job.brief).toContain('Check competitor coffee prices');
    // While it runs, "Run now" is skipped.
    const again = await s.api('POST', `/api/automations/${a.automationId}/run`);
    expect(again.body.automation.lastResult).toBe('Skipped: the last run is still going.');
    for (let i = 0; i < 20 && !(await s.ofType('automation.result')).length; i++) await s.tick();
    const result = (await s.ofType('automation.result')).at(-1)!.data;
    expect(result).toMatchObject({ runId: fired.runId, status: 'done', notify: true, why: 'You asked to hear after every run.' });
    // The Chief says it once, from the gate (the ordinary job announcement is held back).
    const lines = (await s.ofType('talk.message')).filter((m) => m.data.jobId === fired.runId);
    expect(lines.map((m) => m.data.text)).toEqual([expect.stringMatching(/^“Morning prices” ran: /)]);
    const view = (await s.automations())[0]!;
    expect(view.history[0]).toMatchObject({ runId: fired.runId, status: 'done', notified: true });
    expect(view.runs).toBe(1);
  });

  it('“only when it matters”: a routine run stays quiet; “never” is never said', async () => {
    const s = await setup();
    await s.api('POST', '/api/automations', { name: 'Quiet check', kind: 'schedule', schedule: { everyMinutes: 60 }, action: { type: 'job', goal: 'Check the supplier list' }, gate: 'quiet' });
    await s.tick();
    for (let i = 0; i < 20 && !(await s.ofType('automation.result')).length; i++) await s.tick();
    const result = (await s.ofType('automation.result')).at(-1)!.data;
    expect(result).toMatchObject({ status: 'done', notify: false, why: 'A routine result (mock check).' });
    expect((await s.ofType('talk.message')).some((m) => m.data.jobId === result.runId)).toBe(false);
  });

  it('a daily time first runs at its next occurrence (UTC)', async () => {
    const s = await setup();
    const t0 = Date.parse('2026-09-29T10:00:00Z');
    runtime.now = () => t0;
    const a = (await s.api('POST', '/api/automations', { name: 'Daily brief', kind: 'schedule', schedule: { dailyAt: '09:00' }, action: { type: 'job', goal: 'Summarise yesterday’s orders' }, gate: 'off' })).body.automation as AutomationView;
    expect(a.nextAt).toBe('2026-09-30T09:00:00.000Z');
    await s.tick();
    expect(await s.ofType('automation.fired')).toHaveLength(0);
    runtime.now = () => Date.parse('2026-09-30T09:01:00Z');
    await s.tick();
    expect((await s.ofType('automation.fired')).at(-1)!.data.context).toBe('Scheduled run (every day at 09:00 UTC)');
    expect((await s.automations())[0]!.nextAt).toBe('2026-10-01T09:00:00.000Z');
  });

  it('a page watcher fires when its condition becomes true, with what changed', async () => {
    const s = await setup();
    let price = '60.00';
    vi.stubGlobal('fetch', async (url: string) =>
      String(url).includes('dns-query') ? Response.json({ Answer: [{ type: 1, data: '93.184.216.34' }] }) : new Response(`<html><body><p>Price: $${price}</p></body></html>`, { headers: { 'content-type': 'text/html' } }),
    );
    let t = Date.parse('2026-09-29T10:00:00Z');
    runtime.now = () => t;
    const a = (
      await s.api('POST', '/api/automations', {
        name: 'Bean price',
        kind: 'page',
        page: { url: 'https://beans.example.com/house-blend', extract: String.raw`Price:\s*\$([\d.]+)`, condition: 'below', value: '50', everyMinutes: 30 },
        action: { type: 'job', goal: 'Tell me whether to stock up on beans' },
        gate: 'quiet',
      })
    ).body.automation as AutomationView;
    await s.tick();
    expect((await s.automations())[0]).toMatchObject({ lastValue: '60.00' });
    expect(await s.ofType('automation.fired')).toHaveLength(0);
    price = '45.00';
    t += 10 * 60_000; // not due yet (every 30 minutes)
    await s.tick();
    expect(await s.ofType('automation.fired')).toHaveLength(0);
    t += 25 * 60_000;
    await s.tick();
    const fired = (await s.ofType('automation.fired')).at(-1)!.data;
    expect(fired).toMatchObject({ automationId: a.automationId, context: 'The page now drops below “50”: 45.00 (was 60.00)' });
    // A page watcher's run is worth telling (quiet gate).
    for (let i = 0; i < 20 && !(await s.ofType('automation.result')).length; i++) await s.tick();
    expect((await s.ofType('automation.result')).at(-1)!.data).toMatchObject({ notify: true, why: 'The watched page changed.' });
    // It stays true: no second run until it becomes true again.
    t += 31 * 60_000;
    await s.tick();
    expect(await s.ofType('automation.fired')).toHaveLength(1);
  });

  it('a team project an automation starts plans and runs without the plan hand, marked as the automation’s', async () => {
    const s = await setup();
    await s.api('POST', '/api/automations', { name: 'Weekly launch review', kind: 'schedule', schedule: { everyMinutes: 60 * 24 * 7 }, action: { type: 'project', goal: 'Review this week’s spring menu launch with a small campaign' }, gate: 'off' });
    await s.tick();
    const fired = (await s.ofType('automation.fired')).at(-1)!.data;
    expect(fired.runKind).toBe('project');
    await s.tick(3);
    const p = (await s.project.getProject(fired.runId))!;
    expect(p.automation).toEqual({ automationId: fired.automationId, name: 'Weekly launch review' });
    expect(['running', 'done']).toContain(p.status);
    expect((await s.project.openDecisions()).filter((d) => d.kind === 'plan_approval')).toHaveLength(0);
    for (let i = 0; i < 40 && !(await s.ofType('automation.result')).length; i++) await s.tick();
    expect((await s.ofType('automation.result')).at(-1)!.data).toMatchObject({ status: 'done', notify: false });
    // No "is done" announcement for it: the gate said never.
    expect((await s.ofType('talk.message')).some((m) => m.data.projectId === fired.runId && m.data.kind === 'announcement')).toBe(false);
  });

  it('the Chief proposes one on a card; the owner’s OK sets it up', async () => {
    const s = await setup();
    await s.api('POST', '/api/talk', { text: 'Every morning, check the news about our competitors', opId: ids.op() });
    let hand: Decision | undefined;
    for (let i = 0; i < 200 && !hand; i++) {
      await wait(5);
      hand = (await s.project.openDecisions()).find((d) => d.kind === 'automation');
    }
    expect(hand).toMatchObject({ projectId: '', title: expect.stringContaining('wants to set up'), automation: { kind: 'schedule', schedule: { dailyAt: '09:00' }, describe: 'Every day at 09:00 UTC → a background job' } });
    expect(await s.automations()).toHaveLength(0);
    expect((await s.api('POST', `/api/decisions/${hand!.decisionId}`, { action: 'approve' })).status).toBe(202);
    await s.t.ctx.drain();
    const list = await s.automations();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ createdBy: 'chief', gate: 'quiet', action: { type: 'job' } });
    expect((await s.ofType('talk.message')).at(-1)!.data.text).toContain('Set up: Every day at 09:00 UTC → a background job');
  });

  it('the API validates, pauses, edits and removes', async () => {
    const s = await setup();
    expect((await s.api('POST', '/api/automations', { name: 'x', kind: 'schedule', schedule: { everyMinutes: 1 }, action: { type: 'job', goal: 'Check the supplier list' }, gate: 'on' })).status).toBe(400);
    const a = (await s.api('POST', '/api/automations', { name: 'Stock check', kind: 'schedule', schedule: { everyMinutes: 120 }, action: { type: 'job', goal: 'Check the stock levels' }, gate: 'on' })).body.automation as AutomationView;
    const paused = (await s.api('PUT', `/api/automations/${a.automationId}`, { enabled: false })).body.automation as AutomationView;
    expect(paused.enabled).toBe(false);
    expect(paused.nextAt).toBeUndefined();
    await s.tick();
    expect(await s.ofType('automation.fired')).toHaveLength(0);
    const edited = (await s.api('PUT', `/api/automations/${a.automationId}`, { schedule: { dailyAt: '07:30' }, gate: 'off' })).body.automation as AutomationView;
    expect(edited).toMatchObject({ describe: 'Every day at 07:30 UTC → a background job', gate: 'off', enabled: false });
    expect((await s.api('DELETE', `/api/automations/${a.automationId}`)).status).toBe(200);
    expect(await s.automations()).toHaveLength(0);
    expect((await s.api('DELETE', `/api/automations/${a.automationId}`)).status).toBe(404);
  });
});
