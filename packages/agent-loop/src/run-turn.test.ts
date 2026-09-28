import { createMockProvider, type ChatProvider, type ChatRequest, type ModelEvent } from '@headcount/models';
import { describe, expect, it } from 'vitest';
import { runTurn, type AgentTool, type LoopEvent } from './index';

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
});
