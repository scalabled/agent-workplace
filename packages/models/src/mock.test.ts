import { describe, expect, it } from 'vitest';
import { collectEvents } from './collect';
import { createMockProvider, detectIntent, jobSubject, latestJobId, planMockTurn, summarizeJobs } from './mock';
import { fillSchema } from './schema-fill';
import type { ChatMessage, ToolSpec } from './types';

const delegate: ToolSpec = {
  name: 'delegate',
  description: 'Start a background job',
  parameters: { type: 'object', properties: { task: { type: 'string' }, reason: { type: 'string' } }, required: ['task', 'reason'] },
  mock: { triggers: ['^look into', 'research'] },
};

// The Chief of Staff's job tools as worker-core is expected to name them — no mock hints needed.
const jobTools: ToolSpec[] = [
  { name: 'start_job', description: 'Start a background job', parameters: { type: 'object', properties: { title: { type: 'string' }, brief: { type: 'string' } }, required: ['title', 'brief'] } },
  { name: 'job_status', description: 'Live state of jobs', parameters: { type: 'object', properties: { jobId: { type: 'string' } } } },
  { name: 'steer_job', description: 'Steer a running job', parameters: { type: 'object', properties: { jobId: { type: 'string' }, text: { type: 'string' } }, required: ['jobId', 'text'] } },
  { name: 'cancel_job', description: 'Cancel a job', parameters: { type: 'object', properties: { jobId: { type: 'string' }, reason: { type: 'string' } }, required: ['jobId'] } },
];

const JOB = 'job_01j9zk4q2m8x7w6v5t4s3r2q1p';
const mock = createMockProvider().chat;

describe('mock provider', () => {
  it('streams a deterministic reply ending in done', async () => {
    const a = await collectEvents(mock.chat({ messages: [{ role: 'user', content: 'hello there' }] }));
    const b = await collectEvents(mock.chat({ messages: [{ role: 'user', content: 'hello there' }] }));
    expect(a.text).toBe(b.text);
    expect(a.text).toContain('hello there');
    expect(a.finish).toBe('stop');
    expect(a.usage.usd).toBe(0);
  });

  it('calls a tool when a trigger matches, then speaks about the result', async () => {
    const first = await collectEvents(mock.chat({ messages: [{ role: 'user', content: 'Look into local coffee suppliers' }], tools: [delegate] }));
    expect(first.finish).toBe('tool_calls');
    expect(first.toolCalls[0]?.name).toBe('delegate');
    expect(JSON.parse(first.toolCalls[0]!.arguments).task).toContain('coffee');
    const second = planMockTurn({
      messages: [
        { role: 'user', content: 'Look into local coffee suppliers' },
        { role: 'assistant', content: '', toolCalls: first.toolCalls },
        { role: 'tool', toolCallId: first.toolCalls[0]!.id, name: 'delegate', content: JSON.stringify({ say: 'I started looking into it.' }) },
      ],
      tools: [delegate],
    });
    expect(second).toEqual({ kind: 'text', text: 'Done. I started looking into it.' });
  });

  it('produces schema-valid JSON for structured output', async () => {
    const out = await collectEvents(mock.chat({ messages: [{ role: 'user', content: 'x' }], responseFormat: { type: 'json_schema', name: 'v', schema: { type: 'object', properties: { verdict: { enum: ['approve', 'changes'] }, n: { type: 'integer', minimum: 2 } } } } }));
    expect(JSON.parse(out.text)).toEqual({ verdict: 'approve', n: 2 });
    expect(fillSchema({ type: 'array', items: { type: 'boolean' }, minItems: 2 })).toEqual([false, false]);
  });

  it('stops on abort', async () => {
    const ac = new AbortController();
    ac.abort();
    const out = await collectEvents(mock.chat({ messages: [{ role: 'user', content: 'a long message to stream' }], signal: ac.signal }));
    expect(out.finish).toBe('cancelled');
  });

  it('synthesises silent TTS with alignment, STT, images and embeddings', async () => {
    const m = createMockProvider();
    const tts = await m.speech.tts!({ text: 'Hi there', voice: { openai: 'echo' } });
    expect(tts.mime).toBe('audio/wav');
    expect(tts.alignment?.chars.join('')).toBe('Hi there');
    expect(new TextDecoder().decode(tts.audio.slice(0, 4))).toBe('RIFF');
    expect((await m.speech.stt!({ audio: new ArrayBuffer(10), mime: 'audio/webm' })).text).toContain('mock transcript');
    expect((await m.image.generate({ prompt: 'p' })).mime).toBe('image/svg+xml');
    const emb = await m.embeddings.embed({ texts: ['a b', 'a b'] });
    expect(emb.vectors[0]).toEqual(emb.vectors[1]);
  });
});

describe('mock job intents (keyless delegate → status → steer → cancel)', () => {
  const plan = (messages: ChatMessage[], system?: string) => planMockTurn({ messages, tools: jobTools, ...(system ? { system } : {}) });

  it('starts a job from "look into X" with a title and brief taken from the words', () => {
    const p = plan([{ role: 'user', content: 'Could you look into local coffee suppliers for the café?' }]);
    expect(p).toMatchObject({ kind: 'tool', tool: { name: 'start_job' }, args: { title: 'Local coffee suppliers for the café', brief: 'Local coffee suppliers for the café' } });
    expect(jobSubject('Please research competitor pricing.')).toBe('competitor pricing');
  });

  it('answers "how\'s it going?" with job_status and speaks from the live state', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'look into coffee suppliers' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'start_job', arguments: '{"title":"Coffee suppliers"}' }] },
      { role: 'tool', toolCallId: 'c1', name: 'start_job', content: JSON.stringify({ jobId: JOB, title: 'Coffee suppliers' }) },
      { role: 'assistant', content: 'On it.' },
      { role: 'user', content: "How's it going?" },
    ];
    const p = plan(history);
    expect(p).toMatchObject({ kind: 'tool', tool: { name: 'job_status' }, args: { jobId: JOB } });
    const after = plan([
      ...history,
      { role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 'job_status', arguments: JSON.stringify({ jobId: JOB }) }] },
      { role: 'tool', toolCallId: 'c2', name: 'job_status', content: JSON.stringify({ jobs: [{ jobId: JOB, title: 'Coffee suppliers', status: 'running', step: 2, of: 4, label: 'Comparing prices' }] }) },
    ]);
    expect(after).toEqual({ kind: 'text', text: 'Coffee suppliers: step 2 of 4, comparing prices.' });
  });

  it('steers the latest job from "also check Y", finding the id in the system prompt', () => {
    const p = plan([{ role: 'user', content: 'Also check delivery times.' }], `Active jobs:\n- ${JOB} Coffee suppliers (running)`);
    expect(p).toMatchObject({ kind: 'tool', tool: { name: 'steer_job' }, args: { jobId: JOB, text: 'Check delivery times' } });
    const after = plan([
      { role: 'user', content: 'Also check delivery times.' },
      { role: 'assistant', content: '', toolCalls: [{ id: 's1', name: 'steer_job', arguments: '{}' }] },
      { role: 'tool', toolCallId: 's1', name: 'steer_job', content: JSON.stringify({ status: 'queued' }) },
    ]);
    expect(after).toEqual({ kind: 'text', text: 'Noted. I will fold that in at the next checkpoint.' });
  });

  it('treats "also …" as a new job when nothing is running, and cancels on request', () => {
    expect(plan([{ role: 'user', content: 'also check delivery times' }])).toMatchObject({ tool: { name: 'start_job' } });
    expect(plan([{ role: 'user', content: 'Cancel that job please' }], `job ${JOB}`)).toMatchObject({ tool: { name: 'cancel_job' }, args: { jobId: JOB, reason: 'The owner asked to stop.' } });
  });

  it('does not call a tool twice in one turn, and chats normally without an intent', () => {
    expect(plan([{ role: 'user', content: 'Thanks, that is all.' }])).toMatchObject({ kind: 'text' });
    const p = plan([
      { role: 'user', content: 'look into coffee' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'start_job', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c1', name: 'start_job', content: '{"say":"Started the coffee research."}' },
    ]);
    expect(p).toEqual({ kind: 'text', text: 'Started the coffee research.' });
  });

  it('prefers a leading "look into" over a status phrase later in the sentence', () => {
    expect(detectIntent('Look into how the pricing is going in Berlin', jobTools, true)?.intent).toBe('start');
    expect(detectIntent('any update on the coffee thing?', jobTools, true)?.intent).toBe('status');
  });

  it('finds the most recent job id', () => {
    expect(latestJobId({ messages: [{ role: 'tool', toolCallId: 'a', name: 'x', content: 'job_aaaaaaaaaa then job_bbbbbbbbbb' }], system: 'job_cccccccccc' })).toBe('job_bbbbbbbbbb');
    expect(latestJobId({ messages: [{ role: 'user', content: 'hi' }] })).toBeNull();
  });

  it('summarises job lists', () => {
    expect(summarizeJobs('{"jobs":[]}')).toBe('Nothing is running right now.');
    expect(summarizeJobs(JSON.stringify({ job: { title: 'Pricing', status: 'done' } }))).toBe('Pricing: done.');
    expect(summarizeJobs('not json')).toBeNull();
  });
});

describe('mock directives (biz-bot)', () => {
  it('!tool <name> {json} calls that tool once with those args', async () => {
    const out = await collectEvents(mock.chat({ messages: [{ role: 'user', content: '!tool steer_job {"jobId":"job_x1234567","text":"faster"}' }], tools: jobTools }));
    expect(out.toolCalls[0]).toMatchObject({ name: 'steer_job', arguments: '{"jobId":"job_x1234567","text":"faster"}' });
  });

  it('!slow <ms> delays the reply and stays cancellable', async () => {
    const ac = new AbortController();
    const started = Date.now();
    setTimeout(() => ac.abort(), 30);
    const out = await collectEvents(mock.chat({ messages: [{ role: 'user', content: 'hi !slow 5000' }], signal: ac.signal }));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.finish).toBe('cancelled');
    expect(out.reasoning).toBeTruthy();
  });
});
