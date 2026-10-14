import { createMockProvider, type ChatProvider, type ChatRequest, type ModelEvent } from '@headcount/models';
import { describe, expect, it } from 'vitest';
import { callBudget, clipToolOutput, lowerEffort, REASONING_ALLOWANCE, runTurn, STUCK_ROUND_LIMIT, TOOL_OUTPUT_LIMIT, type AgentTool, type LoopEvent } from './index';

/** A provider that answers each call with the next scripted event list (and records the requests). */
function scripted(script: ((req: ChatRequest) => ModelEvent[])[]): ChatProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    id: 'mock',
    kind: 'mock',
    family: 'mock',
    requests,
    defaultModel: () => 'scripted',
    async *chat(req) {
      requests.push(structuredClone({ ...req, signal: undefined }));
      const next = script[requests.length - 1];
      if (!next) {
        yield { type: 'error', message: 'script exhausted' };
        return;
      }
      for (const e of next(req)) yield e;
    },
  };
}

const call = (name: string, args: unknown, id = `c_${name}`): ModelEvent => ({ type: 'tool_call', id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
const say = (text: string): ModelEvent[] => [{ type: 'text', delta: text }, { type: 'done', finish: 'stop' }];
const tools = (...events: ModelEvent[]): ModelEvent[] => [...events, { type: 'done', finish: 'tool_calls' }];

function tool(name: string, run: (args: any) => Promise<Awaited<ReturnType<AgentTool['execute']>>> | Awaited<ReturnType<AgentTool['execute']>>): AgentTool & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    spec: { name, description: name, parameters: { type: 'object', properties: { q: { type: 'string' } } } },
    async execute(args) {
      calls.push(args);
      return run(args);
    },
  };
}

describe('runTurn (mock provider)', () => {
  const provider = createMockProvider().chat;

  it('answers without tools', async () => {
    const events: LoopEvent[] = [];
    const r = await runTurn({ provider, system: 'You are the Chief of Staff.', messages: [{ role: 'user', content: 'hi' }], onEvent: (e) => events.push(e) });
    expect(r.finish).toBe('stop');
    expect(r.text).toContain('hi');
    expect(r.fullText).toBe(r.text);
    expect(r.steps).toBe(1);
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(r.messages).toEqual([{ role: 'assistant', content: r.text }]);
  });

  it('runs a tool and feeds the result back', async () => {
    const calls: unknown[] = [];
    const delegate: AgentTool<{ task: string }> = {
      spec: { name: 'delegate', description: 'Start a job', parameters: { type: 'object', properties: { task: { type: 'string' } } }, mock: { triggers: ['look into'], reply: (out) => `Started: ${JSON.parse(out).jobId}` } },
      async execute(args) {
        calls.push(args);
        return { ok: true, content: JSON.stringify({ jobId: 'job_1' }), summary: 'job started' };
      },
    };
    const events: LoopEvent[] = [];
    const r = await runTurn({ provider, system: '', messages: [{ role: 'user', content: 'look into suppliers' }], tools: [delegate], onEvent: (e) => events.push(e) });
    expect(calls).toEqual([{ task: 'look into suppliers' }]);
    expect(r.text).toBe('Started: job_1');
    expect(r.toolCalls).toBe(1);
    expect(r.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(events.find((e) => e.type === 'tool_end')).toMatchObject({ name: 'delegate', ok: true, summary: 'job started' });
  });

  it('returns cancelled when aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runTurn({ provider, system: '', messages: [{ role: 'user', content: 'hi' }], signal: ac.signal });
    expect(r.finish).toBe('cancelled');
  });
});

describe('runTurn (scripted provider)', () => {
  it('runs parallel tool calls and joins text across steps', async () => {
    const order: string[] = [];
    const a = tool('a', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('a');
      return { ok: true, content: 'A' };
    });
    const b = tool('b', () => {
      order.push('b');
      return { ok: true, content: 'B' };
    });
    const p = scripted([() => [{ type: 'text', delta: 'Checking both.' }, ...tools(call('a', { q: 1 }, 'x1'), call('b', { q: 2 }, 'x2'))], () => say('Both done.')]);
    const r = await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'go' }], tools: [a, b] });
    expect(order).toEqual(['b', 'a']);
    expect(r.finish).toBe('stop');
    expect(r.text).toBe('Both done.');
    expect(r.fullText).toBe('Checking both.\n\nBoth done.');
    const toolMsgs = p.requests[1]!.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.map((m) => (m as { content: string }).content)).toEqual(['A', 'B']);
  });

  it('returns unparseable arguments and unknown tools to the model as errors', async () => {
    const a = tool('a', () => ({ ok: true, content: 'A' }));
    const p = scripted([() => tools(call('a', '{nope', 'x1'), call('zzz', {}, 'x2')), () => say('ok')]);
    const r = await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'go' }], tools: [a] });
    expect(a.calls).toEqual([]);
    const toolMsgs = p.requests[1]!.messages.filter((m) => m.role === 'tool') as { content: string; isError?: boolean }[];
    expect(toolMsgs[0]!.content).toContain('argsError');
    expect(toolMsgs[1]!.content).toContain('no tool called "zzz"');
    expect(toolMsgs.every((m) => m.isError)).toBe(true);
    expect(r.finish).toBe('stop');
  });

  it('refuses a third identical failing call', async () => {
    const a = tool('a', () => ({ ok: false, error: 'boom' }));
    const p = scripted([() => tools(call('a', { q: 'x' }, '1')), () => tools(call('a', { q: 'x' }, '2')), () => tools(call('a', { q: 'x' }, '3')), () => say('giving up')]);
    const r = await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'go' }], tools: [a] });
    expect(a.calls.length).toBe(2);
    const last = p.requests[3]!.messages.at(-1) as { content: string };
    expect(last.content).toContain('already failed twice');
    expect(r.text).toBe('giving up');
  });

  it('answers a third identical call with the earlier result and a note, without running the tool again', async () => {
    let n = 0;
    const a = tool('a', () => ({ ok: true, content: `result ${++n}` }));
    const events: LoopEvent[] = [];
    const p = scripted([() => tools(call('a', { q: 'x' }, '1')), () => tools(call('a', { q: 'x' }, '2')), () => tools(call('a', { q: 'x' }, '3'), call('a', { q: 'y' }, '4')), () => say('done')]);
    const r = await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'go' }], tools: [a], onEvent: (e) => events.push(e) });
    expect(a.calls).toEqual([{ q: 'x' }, { q: 'x' }, { q: 'y' }]);
    const third = p.requests[3]!.messages.filter((m) => m.role === 'tool').at(-2) as { content: string; isError?: boolean };
    expect(third.content).toMatch(/^\[You already called a with these arguments.*Use it, or try something different\.\]\n\nresult 2$/);
    expect(third.isError).toBeUndefined();
    expect(events.filter((e) => e.type === 'tool_end' && e.summary === 'repeated call')).toHaveLength(1);
    expect(r).toMatchObject({ finish: 'stop', text: 'done', toolCalls: 4 });
  });

  it(`ends the turn as stuck after ${STUCK_ROUND_LIMIT} failed tool rounds in a row, with one tool-free wrap-up call`, async () => {
    const a = tool('a', () => ({ ok: false, error: 'boom' }));
    const rounds = Array.from({ length: STUCK_ROUND_LIMIT }, (_, i) => () => tools(call('a', { q: `try ${i}` }, `c${i}`), call('zzz', {}, `z${i}`)));
    const p = scripted([...rounds, () => say('The tool kept failing, so I stopped.')]);
    const events: LoopEvent[] = [];
    const r = await runTurn({
      provider: p,
      system: 's',
      messages: [{ role: 'user', content: 'go' }],
      tools: [a],
      onEvent: (e) => events.push(e),
      checkpoint: (info) => (info.step === STUCK_ROUND_LIMIT ? { inject: ['Owner steering: try the other source'] } : undefined),
    });
    expect(r).toMatchObject({ finish: 'stuck', text: 'The tool kept failing, so I stopped.', steps: STUCK_ROUND_LIMIT + 1 });
    expect(a.calls).toHaveLength(STUCK_ROUND_LIMIT);
    const wrapUp = p.requests.at(-1)!;
    expect(wrapUp.toolChoice).toBe('none');
    expect(events.filter((e) => e.type === 'step').at(-1)).toMatchObject({ wrapUp: true });
    // The steering and the stuck note arrive as one user message.
    const last = wrapUp.messages.at(-1) as { role: string; content: string };
    expect(last.role).toBe('user');
    expect(last.content).toMatch(/^Owner steering: try the other source\n\nYour last \d+ rounds of tool calls all failed\./);
    expect(wrapUp.messages.filter((m) => m.role === 'user')).toHaveLength(2);
  });

  it('a round with one successful call resets the failure streak', async () => {
    const a = tool('a', (args: { q: string }) => (args.q === 'good' ? { ok: true, content: 'A' } : { ok: false, error: 'boom' }));
    const fail = (i: number) => () => tools(call('a', { q: `bad ${i}` }, `f${i}`));
    const p = scripted([fail(1), fail(2), fail(3), () => tools(call('a', { q: 'good' }, 'g'), call('a', { q: 'bad 4' }, 'f4')), fail(5), fail(6), fail(7), () => say('done')]);
    const r = await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'go' }], tools: [a] });
    expect(r).toMatchObject({ finish: 'stop', text: 'done', steps: 8 });
    expect(p.requests.every((q) => q.toolChoice === undefined)).toBe(true);
  });

  it('keeps the start and the end of long tool output, with a stub that says what was left out', async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${String(i).padStart(4, '0')} ${'x'.repeat(20)}`);
    const long = lines.join('\n');
    const a = tool('a', () => ({ ok: true, content: long }));
    const p = scripted([() => tools(call('a', {})), () => say('ok')]);
    await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'go' }], tools: [a] });
    const sent = (p.requests[1]!.messages.find((m) => m.role === 'tool') as { content: string }).content;
    expect(sent.length).toBeLessThanOrEqual(TOOL_OUTPUT_LIMIT + 120);
    expect(sent.startsWith('line 0000 ')).toBe(true);
    expect(sent.endsWith(lines.at(-1)!)).toBe(true);
    const stub = sent.split('\n').find((l) => l.startsWith('[tool output elided'))!;
    const [, n, chars] = stub.match(/^\[tool output elided: (\d+) lines \/ (\d+) chars\. .+\]$/)!;
    // Whole lines on both sides: what is shown plus what the stub counts is everything.
    const shown = sent.split('\n').filter((l) => l !== stub);
    expect(shown.every((l) => lines.includes(l))).toBe(true);
    expect(shown.length + Number(n)).toBe(lines.length);
    expect(sent.length - stub.length - 2 + Number(chars)).toBe(long.length);
  });

  it('clips a single long line in the middle and leaves short output alone', () => {
    expect(clipToolOutput('short')).toBe('short');
    const blob = 'a'.repeat(700) + 'b'.repeat(600) + 'c'.repeat(300);
    const out = clipToolOutput(blob, 1000);
    expect(out).toBe(`${'a'.repeat(700)}\n[tool output elided: 1 line / 600 chars. Narrow the call to see that part.]\n${'c'.repeat(300)}`);
  });

  it('ends the turn when a tool outcome says endTurn', async () => {
    const submit = tool('submit', () => ({ ok: true, content: 'saved', endTurn: true }));
    const p = scripted([() => tools(call('submit', { q: 'plan' }))]);
    const r = await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'plan it' }], tools: [submit], toolChoice: { name: 'submit' } });
    expect(r.finish).toBe('stop');
    expect(r.endedBy).toBe('submit');
    expect(r.steps).toBe(1);
    expect(p.requests[0]!.toolChoice).toEqual({ name: 'submit' });
  });

  it('applies toolChoice to the first call only', async () => {
    const a = tool('a', () => ({ ok: true, content: 'A' }));
    const p = scripted([() => tools(call('a', {})), () => say('done')]);
    await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'go' }], tools: [a], toolChoice: 'required' });
    expect(p.requests[0]!.toolChoice).toBe('required');
    expect(p.requests[1]!.toolChoice).toBeUndefined();
  });

  it('injects steering at the checkpoint between tool rounds', async () => {
    const a = tool('a', () => ({ ok: true, content: 'A' }));
    const p = scripted([() => tools(call('a', {})), () => say('adjusted')]);
    const seen: number[] = [];
    const r = await runTurn({
      provider: p,
      system: 's',
      messages: [{ role: 'user', content: 'go' }],
      tools: [a],
      checkpoint: (info) => {
        seen.push(info.toolCalls);
        return { inject: ['Owner steering: also check Y'] };
      },
    });
    expect(seen).toEqual([1]);
    expect(p.requests[1]!.messages.at(-1)).toEqual({ role: 'user', content: 'Owner steering: also check Y' });
    expect(r.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'user', 'assistant']);
    expect(r.text).toBe('adjusted');
  });

  it('stops at a checkpoint that says cancelled', async () => {
    const a = tool('a', () => ({ ok: true, content: 'A' }));
    const p = scripted([() => tools(call('a', {})), () => say('never')]);
    const r = await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'go' }], tools: [a], checkpoint: () => ({ stop: 'cancelled' }) });
    expect(r.finish).toBe('cancelled');
    expect(p.requests.length).toBe(1);
  });

  it('makes one tool-free wrap-up call at the step ceiling', async () => {
    const a = tool('a', () => ({ ok: true, content: 'A' }));
    const p = scripted([() => tools(call('a', { q: 1 }, '1')), () => tools(call('a', { q: 2 }, '2')), () => say('best effort')]);
    const events: LoopEvent[] = [];
    const r = await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'go' }], tools: [a], maxSteps: 2, onEvent: (e) => events.push(e) });
    expect(p.requests[2]!.toolChoice).toBe('none');
    expect(events.filter((e) => e.type === 'step').at(-1)).toMatchObject({ wrapUp: true });
    expect(r.finish).toBe('length');
    expect(r.text).toBe('best effort');
  });

  it('reports provider errors with the partial text', async () => {
    const p = scripted([() => [{ type: 'text', delta: 'Half an ans' }, { type: 'error', message: 'upstream 500', code: 'http_500', retryable: true }]]);
    const r = await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'go' }] });
    expect(r.finish).toBe('error');
    expect(r.text).toBe('Half an ans');
    expect(r.error).toEqual({ message: 'upstream 500', code: 'http_500', retryable: true });
  });

  it('stops after the tool round when aborted mid-tools', async () => {
    const ac = new AbortController();
    const a = tool('a', () => {
      ac.abort();
      return { ok: true, content: 'A' };
    });
    const p = scripted([() => tools(call('a', {})), () => say('never')]);
    const r = await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'go' }], tools: [a], signal: ac.signal });
    expect(r.finish).toBe('cancelled');
    expect(p.requests.length).toBe(1);
  });

  it('sends a call that only thought (length, no text, no tool call) again once with more room and less effort', async () => {
    const thoughtOnly = (): ModelEvent[] => [{ type: 'reasoning', delta: 'Weighing it all…' }, { type: 'usage', input: 100, output: 1200, usd: null, costStatus: 'unavailable' }, { type: 'done', finish: 'length' }];
    const a = tool('record', () => ({ ok: true, content: 'Recorded.' }));
    const p = scripted([thoughtOnly, () => tools(call('record', { q: 'x' })), () => say('Notes.')]);
    const events: LoopEvent[] = [];
    const r = await runTurn({ provider: p, system: 's', messages: [{ role: 'user', content: 'go' }], tools: [a], maxTokens: 1200, reasoningEffort: 'high', onEvent: (e) => events.push(e) });
    expect(r.finish).toBe('stop');
    expect(r.text).toBe('Notes.');
    expect(r.steps).toBe(2); // the retry is the same step, not a new one
    expect(p.requests.map((q) => [q.maxTokens, q.reasoningEffort])).toEqual([
      [1200, 'high'],
      [2400, 'medium'],
      [2400, 'medium'], // the raised budget holds for the rest of the turn
    ]);
    expect(p.requests[1]!.messages).toEqual(p.requests[0]!.messages); // the same call, nothing added
    expect(events.filter((e) => e.type === 'retry')).toEqual([{ type: 'retry', step: 1, reason: 'empty_length', maxTokens: 2400, reasoningEffort: 'medium' }]);
    expect(r.usage.output).toBe(1200); // the thinking-only call is still counted
  });

  it('retries an empty length only once per turn, and never when told not to', async () => {
    const thoughtOnly = (): ModelEvent[] => [{ type: 'reasoning', delta: '…' }, { type: 'done', finish: 'length' }];
    const twice = scripted([thoughtOnly, thoughtOnly, () => say('never')]);
    const r = await runTurn({ provider: twice, system: 's', messages: [{ role: 'user', content: 'go' }], maxTokens: 500, reasoningEffort: 'low' });
    expect(r).toMatchObject({ finish: 'length', text: '', fullText: '' });
    expect(twice.requests.map((q) => [q.maxTokens, q.reasoningEffort])).toEqual([
      [500, 'low'],
      [1000, 'low'],
    ]);
    const off = scripted([thoughtOnly]);
    expect((await runTurn({ provider: off, system: 's', messages: [{ role: 'user', content: 'go' }], maxTokens: 500, emptyLengthRetry: false })).finish).toBe('length');
    expect(off.requests).toHaveLength(1);
    const custom = scripted([thoughtOnly, () => say('ok')]);
    await runTurn({ provider: custom, system: 's', messages: [{ role: 'user', content: 'go' }], maxTokens: 500, reasoningEffort: 'medium', emptyLengthRetry: { maxTokens: 9000, reasoningEffort: 'low' } });
    expect(custom.requests[1]).toMatchObject({ maxTokens: 9000, reasoningEffort: 'low' });
    // A truncated answer that has text is kept as it is.
    const cut = scripted([() => [{ type: 'text', delta: 'Half an answer' }, { type: 'done', finish: 'length' }]]);
    expect(await runTurn({ provider: cut, system: 's', messages: [{ role: 'user', content: 'go' }], maxTokens: 50 })).toMatchObject({ finish: 'length', text: 'Half an answer' });
    expect(cut.requests).toHaveLength(1);
  });
});

describe('callBudget', () => {
  it('adds room to think for cloud reasoning models only, with an explicit effort', () => {
    expect(callBudget({ id: 'anthropic', kind: 'cloud' }, 'claude-opus-5', 1500, 'medium')).toEqual({ maxTokens: 1500 + REASONING_ALLOWANCE.medium, reasoningEffort: 'medium', budget: { output: 1500, effort: 'medium' } });
    expect(callBudget({ id: 'openai', kind: 'cloud' }, 'gpt-5.6-luna', 200, 'none')).toMatchObject({ maxTokens: 200 + REASONING_ALLOWANCE.low, reasoningEffort: 'none' });
    // Models that do not reason: the output only (an effort could be rejected).
    expect(callBudget({ id: 'xai', kind: 'cloud' }, 'grok-4.20-non-reasoning', 900, 'low')).toEqual({ maxTokens: 900, budget: { output: 900, effort: 'low' } });
    expect(callBudget({ id: 'anthropic', kind: 'cloud' }, 'claude-haiku-4-5', 900, 'low')).toEqual({ maxTokens: 900, budget: { output: 900, effort: 'low' } });
    // Local models keep thinking off (Ollama thinks only when an effort is set); Mock ignores both.
    expect(callBudget({ id: 'ollama', kind: 'local' }, 'qwen3:32b', 1500, 'medium')).toEqual({ maxTokens: 1500, budget: { output: 1500, effort: 'medium' } });
    expect(callBudget({ id: 'mock', kind: 'mock' }, 'mock-1', 1500, 'medium')).toEqual({ maxTokens: 1500, budget: { output: 1500, effort: 'medium' } });
  });

  it('gives a cloud model the catalog does not know the output only (gateways cap output; the empty-length retry doubles it)', () => {
    for (const phase of [900, 1000, 1500, 4000]) {
      const b = callBudget({ id: 'openai-compatible', kind: 'cloud' }, 'deepseek-chat', phase, 'high');
      expect(b).toEqual({ maxTokens: phase, budget: { output: phase, effort: 'high' } });
      expect(b.maxTokens).toBeLessThanOrEqual(8192); // e.g. DeepSeek's documented max_tokens ceiling
    }
    expect(callBudget({ id: 'anthropic', kind: 'cloud' }, undefined, 900, 'low')).toEqual({ maxTokens: 900, budget: { output: 900, effort: 'low' } });
  });

  it('lowers effort one notch', () => {
    expect([lowerEffort('high'), lowerEffort('medium'), lowerEffort('low'), lowerEffort('none'), lowerEffort(undefined)]).toEqual(['medium', 'low', 'low', 'none', undefined]);
  });
});
