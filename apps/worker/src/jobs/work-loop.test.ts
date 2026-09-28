import { createMockProvider, type ChatProvider, type ChatRequest, type ModelEvent } from '@headcount/models';
import { describe, expect, it } from 'vitest';
import { defaultPlan, lenientJson, mockDeliverable, normalizePlan, planJob, runWorkStep, synthesize, WorkError, type JobContext } from './work-loop';

const ctx = (over: Partial<JobContext> = {}): JobContext => ({ title: 'Office chairs', brief: 'look into office chairs under $500', steers: [], plan: [], notes: [], chiefName: 'Rosa', lead: undefined, ...over });
const deps = (provider: ChatProvider = createMockProvider().chat) => ({ provider, model: 'mock-1', signal: new AbortController().signal });

function scripted(events: ModelEvent[][]): ChatProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    id: 'mock',
    kind: 'mock',
    family: 'mock',
    requests,
    defaultModel: () => 'x',
    async *chat(req) {
      requests.push(req);
      for (const e of events[requests.length - 1] ?? [{ type: 'error', message: 'exhausted' }]) yield e;
    },
  };
}

describe('plans', () => {
  it('normalizes a model plan and rejects unusable ones', () => {
    expect(normalizePlan({ steps: [{ label: 'Comparing prices.', goal: 'Prices' }, { label: 'Reading reviews', goal: 'Reviews' }] })).toEqual([
      { label: 'Comparing prices', goal: 'Prices' },
      { label: 'Reading reviews', goal: 'Reviews' },
    ]);
    expect(normalizePlan({ steps: [{ label: 'Same' }, { label: 'same' }] })).toBeNull();
    expect(normalizePlan({ steps: [{ label: 'x'.repeat(120) }, { label: 'ok' }] })).toBeNull();
    expect(normalizePlan(['Checking a', 'Checking b', 'Checking c', 'Checking d', 'Checking e'])?.length).toBe(4);
  });

  it('reads JSON out of prose', () => {
    expect(lenientJson('Here you go:\n```json\n{"steps": [1, 2]}\n```\nDone.')).toEqual({ steps: [1, 2] });
    expect(lenientJson('Plan: {"steps": ["a", "b"]} hope that helps}')).toEqual({ steps: ['a', 'b'] });
    expect(lenientJson('no json here')).toBeNull();
  });

  it('builds a default plan that covers owner steering', () => {
    const plan = defaultPlan('Office chairs', ['also check warranties']);
    expect(plan.map((p) => p.label)).toEqual(['Pinning down what matters for office chairs', 'Gathering options and facts on office chairs', 'Weighing trade-offs and risks', 'Checking your note: “also check warranties”']);
  });

  it('plans with the Mock provider through submit_plan', async () => {
    const r = await planJob(deps(), ctx());
    expect(r.source).toBe('model');
    expect(r.steps).toHaveLength(3);
  });

  it('falls back to the default plan when the model answers in prose', async () => {
    const p = scripted([[{ type: 'text', delta: 'I would compare prices.' }, { type: 'done', finish: 'stop' }]]);
    const r = await planJob(deps(p), ctx());
    expect(r.source).toBe('fallback');
    expect(p.requests[0]!.toolChoice).toEqual({ name: 'submit_plan' });
  });

  it('raises a retryable WorkError on provider errors', async () => {
    const p = scripted([[{ type: 'error', message: 'upstream 503', retryable: true }]]);
    await expect(planJob(deps(p), ctx())).rejects.toBeInstanceOf(WorkError);
  });
});

describe('work steps', () => {
  it('records findings through the tool and returns the step notes (Mock)', async () => {
    const found: string[] = [];
    const plan = defaultPlan('Office chairs');
    const r = await runWorkStep(deps(), ctx({ plan }), 1, { onFinding: (f) => void found.push(f), checkpoint: () => undefined });
    expect(found).toEqual([expect.stringContaining('Gathering options and facts on office chairs')]);
    expect(r.findings).toEqual(found);
    expect(r.text).toContain('**Gathering options and facts on office chairs** (mock model)');
  });

  it('injects steering at the checkpoint between tool calls', async () => {
    let steered = false;
    const plan = defaultPlan('Office chairs');
    const found: string[] = [];
    const r = await runWorkStep(deps(), ctx({ plan }), 0, {
      onFinding: (f) => void found.push(f),
      checkpoint: () => {
        if (steered) return;
        steered = true;
        return { inject: ["Owner's steering (apply it from now on; it overrides the brief): also check delivery times"] };
      },
    });
    expect(found).toHaveLength(2);
    expect(found[1]).toContain('also check delivery times');
    expect(r.text).toContain('also check delivery times');
  });
});

describe('synthesis', () => {
  it('writes a Markdown deliverable (Mock)', async () => {
    const c = ctx({ steers: ['also check warranties'], plan: defaultPlan('Office chairs'), notes: [{ label: 'Weighing trade-offs and risks', text: '**Weighing trade-offs and risks** (mock model)\n\n- Goal: x' }] });
    const r = await synthesize(deps(), c);
    expect(r).toEqual(mockDeliverable(c));
    expect(r.markdown).toMatch(/^# Office chairs/);
    expect(r.markdown).toContain('## Your notes along the way\n- also check warranties');
    expect(r.summary).toContain('“also check warranties”');
  });

  it('accepts a prose deliverable when the model skips the tool', async () => {
    const p = scripted([[{ type: 'text', delta: '# Chairs\n\nBuy the Aeron. It lasts.' }, { type: 'done', finish: 'stop' }]]);
    const r = await synthesize(deps(p), ctx());
    expect(r).toEqual({ summary: 'Buy the Aeron.', markdown: '# Chairs\n\nBuy the Aeron. It lasts.' });
  });
});
