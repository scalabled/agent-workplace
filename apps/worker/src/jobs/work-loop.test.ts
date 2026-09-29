import { createMockProvider, type ChatProvider, type ChatRequest, type ModelEvent } from '@headcount/models';
import { describe, expect, it } from 'vitest';
import { REASONING_ALLOWANCE } from '@headcount/agent-loop';
import { defaultPlan, lenientJson, mockDeliverable, normalizePlan, PHASE_BUDGETS, planJob, runWorkStep, synthesize, WorkError, type JobContext } from './work-loop';

const ctx = (over: Partial<JobContext> = {}): JobContext => ({ title: 'Office chairs', brief: 'look into office chairs under $500', steers: [], plan: [], notes: [], chiefName: 'Rosa', lead: undefined, ...over });
const deps = (provider: ChatProvider = createMockProvider().chat) => ({ provider, model: 'mock-1', signal: new AbortController().signal });

function scripted(events: ModelEvent[][], as: Pick<ChatProvider, 'id' | 'kind'> = { id: 'mock', kind: 'mock' }): ChatProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    ...as,
    family: 'mock',
    requests,
    defaultModel: () => 'x',
    async *chat(req) {
      requests.push(req);
      for (const e of events[requests.length - 1] ?? [{ type: 'error', message: 'exhausted' }]) yield e;
    },
  };
}

/** A cloud reasoning model as Claude Opus 5 behaves: at a small budget it can spend every token thinking. */
const opus = (events: ModelEvent[][]) => scripted(events, { id: 'anthropic', kind: 'cloud' });
const opusDeps = (provider: ChatProvider) => ({ provider, model: 'claude-opus-5', signal: new AbortController().signal });
const thoughtOnly: ModelEvent[] = [{ type: 'reasoning', delta: 'Let me think about office chairs…' }, { type: 'usage', input: 1400, output: 9500, usd: null, costStatus: 'unavailable' }, { type: 'done', finish: 'length' }];
const finding = (id: string, text: string): ModelEvent => ({ type: 'tool_call', id, name: 'record_finding', arguments: JSON.stringify({ finding: text }) });
const hooks = (found: string[] = []) => ({ onFinding: (f: string) => void found.push(f), checkpoint: () => undefined });

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

describe('reasoning budgets', () => {
  it('gives each phase room to think and an explicit effort on a cloud reasoning model', async () => {
    const plan = opus([[{ type: 'tool_call', id: 'p', name: 'submit_plan', arguments: JSON.stringify({ steps: [{ label: 'Comparing prices', goal: 'a' }, { label: 'Reading reviews', goal: 'b' }] }) }, { type: 'done', finish: 'tool_calls' }]]);
    await planJob(opusDeps(plan), ctx());
    expect(plan.requests[0]).toMatchObject({ maxTokens: PHASE_BUDGETS.plan.output + REASONING_ALLOWANCE.low, reasoningEffort: 'low', toolChoice: { name: 'submit_plan' } });
    const synth = opus([[{ type: 'tool_call', id: 's', name: 'submit_deliverable', arguments: JSON.stringify({ summary: 'Buy the Aeron.', markdown: '# Chairs' }) }, { type: 'done', finish: 'tool_calls' }]]);
    await synthesize(opusDeps(synth), ctx());
    expect(synth.requests[0]).toMatchObject({ maxTokens: PHASE_BUDGETS.synthesis.output + REASONING_ALLOWANCE.medium, reasoningEffort: 'medium' });
    // Mock and local models get the output budget only, and no effort (Ollama would switch thinking on).
    const mock = scripted([[{ type: 'text', delta: 'Notes.' }, { type: 'done', finish: 'stop' }]]);
    await runWorkStep(deps(mock), ctx({ plan: defaultPlan('Office chairs') }), 0, hooks());
    expect(mock.requests[0]!.maxTokens).toBe(PHASE_BUDGETS.work.output);
    expect(mock.requests[0]!.reasoningEffort).toBeUndefined();
  });

  it('recovers a work step whose first call spent the whole budget thinking (the "empty step" bug)', async () => {
    const found: string[] = [];
    const p = opus([
      thoughtOnly,
      [finding('f1', 'The Aeron lasts 12 years.'), { type: 'done', finish: 'tool_calls' }],
      [{ type: 'text', delta: '**Gathering options**\n\n- The Aeron lasts.' }, { type: 'done', finish: 'stop' }],
    ]);
    const r = await runWorkStep(opusDeps(p), ctx({ plan: defaultPlan('Office chairs') }), 1, hooks(found));
    expect(r.text).toContain('The Aeron lasts.');
    expect(found).toEqual(['The Aeron lasts 12 years.']);
    const first = PHASE_BUDGETS.work.output + REASONING_ALLOWANCE.medium;
    expect(p.requests.map((q) => [q.maxTokens, q.reasoningEffort])).toEqual([
      [first, 'medium'],
      [first * 2, 'low'],
      [first * 2, 'low'],
    ]);
  });

  it('fails a step that only ever thought, retryably, instead of returning nothing', async () => {
    const p = opus([thoughtOnly, thoughtOnly]);
    const err = await runWorkStep(opusDeps(p), ctx({ plan: defaultPlan('Office chairs') }), 0, hooks()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkError);
    expect((err as WorkError).retryable).toBe(true);
    expect((err as WorkError).message).toContain('whole budget thinking');
  });

  it('never fails a step that recorded findings, even when the model then errors', async () => {
    const found: string[] = [];
    const p = opus([
      [finding('f1', 'Steelcase Leap has a 12-year warranty (unverified).'), finding('f2', 'Herman Miller Aeron is about $1,400 new (unverified).'), { type: 'done', finish: 'tool_calls' }],
      [{ type: 'error', message: 'Anthropic: overloaded', retryable: true }],
    ]);
    const r = await runWorkStep(opusDeps(p), ctx({ plan: defaultPlan('Office chairs') }), 0, hooks(found));
    expect(r.findings).toEqual(found);
    expect(r.text).toBe('- Steelcase Leap has a 12-year warranty (unverified).\n- Herman Miller Aeron is about $1,400 new (unverified).');
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
