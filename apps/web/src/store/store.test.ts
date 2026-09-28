import { CHIEF_ID, makeFrame, type Frame, type FrameInput, type FrameType } from '@headcount/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPendingOwner,
  applyFrame,
  chiefPresence,
  jobs,
  lastSeq,
  localPresence,
  markOwnerAccepted,
  markOwnerFailed,
  mergeJobs,
  onFrame,
  settings,
  presence,
  replayThrough,
  setLocalPresence,
  thread,
} from './index';

const at = (seq?: number) => (seq === undefined ? { after: 0 } : { seq });
const f = <T extends FrameType>(input: FrameInput<T>, seq?: number) => makeFrame('ws:local', input, at(seq)) as unknown as Frame;
const ready = (last: number) => f({ type: 'ready', data: { workspaceId: 'local', streamId: 'ws:local', lastSeq: last, replayFrom: 0, serverTime: '' } });

describe('store.applyFrame', () => {
  beforeEach(() => {
    lastSeq.value = 0;
    replayThrough.value = 0;
    thread.value = [];
    jobs.value = {};
    presence.value = {};
    localPresence.value = {};
  });

  it('assembles streamed replies and ignores replayed seqs', () => {
    applyFrame(f({ type: 'talk.owner', data: { turnId: 'turn_1', messageId: 'msg_o', text: 'hi', via: 'text' } }, 1));
    applyFrame(f({ type: 'talk.delta', data: { turnId: 'turn_1', messageId: 'msg_c', agentId: CHIEF_ID, delta: 'Hel' } }));
    applyFrame(f({ type: 'talk.delta', data: { turnId: 'turn_1', messageId: 'msg_c', agentId: CHIEF_ID, delta: 'lo' } }));
    expect(thread.value.map((m) => m.text)).toEqual(['hi', 'Hello']);
    applyFrame(f({ type: 'talk.message', data: { turnId: 'turn_1', messageId: 'msg_c', agentId: CHIEF_ID, text: 'Hello.', kind: 'reply' } }, 2));
    expect(applyFrame(f({ type: 'talk.owner', data: { turnId: 'turn_1', messageId: 'msg_o', text: 'dup', via: 'text' } }, 1))).toBe('ignored');
    // A straggling delta after the complete message changes nothing.
    applyFrame(f({ type: 'talk.delta', data: { turnId: 'turn_1', messageId: 'msg_c', agentId: CHIEF_ID, delta: '!!' } }));
    expect(thread.value.map((m) => [m.text, m.streaming])).toEqual([
      ['hi', false],
      ['Hello.', false],
    ]);
    expect(lastSeq.value).toBe(2);
  });

  it('reconciles an optimistic owner message by opId (echo first or 202 first)', () => {
    addPendingOwner('op_a', 'look into suppliers', 'text');
    expect(thread.value[0]).toMatchObject({ messageId: 'local:op_a', status: 'pending' });
    // Echo arrives before the 202.
    applyFrame(makeFrame('ws:local', { type: 'talk.owner', opId: 'op_a', data: { turnId: 'turn_a', messageId: 'msg_a', text: 'look into suppliers', via: 'text' } }, { seq: 1 }) as Frame);
    expect(thread.value).toHaveLength(1);
    expect(thread.value[0]).toMatchObject({ messageId: 'msg_a', status: undefined });
    markOwnerAccepted({ accepted: true, opId: 'op_a', turnId: 'turn_a', messageId: 'msg_a' });
    expect(thread.value).toHaveLength(1);

    // 202 first, then the echo.
    addPendingOwner('op_b', 'and packaging', 'voice');
    markOwnerAccepted({ accepted: true, opId: 'op_b', turnId: 'turn_b', messageId: 'msg_b' });
    expect(thread.value[1]).toMatchObject({ messageId: 'msg_b', status: undefined, via: 'voice' });
    applyFrame(makeFrame('ws:local', { type: 'talk.owner', opId: 'op_b', data: { turnId: 'turn_b', messageId: 'msg_b', text: 'and packaging', via: 'voice' } }, { seq: 2 }) as Frame);
    expect(thread.value).toHaveLength(2);
  });

  it('keeps a failed message with its reason (text is never lost)', () => {
    addPendingOwner('op_c', 'hello', 'text');
    markOwnerFailed('op_c', 'Could not reach Headcount.');
    expect(thread.value[0]).toMatchObject({ text: 'hello', status: 'failed', error: 'Could not reach Headcount.' });
    // An error frame naming a command's opId marks that message too.
    addPendingOwner('op_d', 'again', 'text');
    applyFrame(f({ type: 'error', opId: 'op_d', data: { code: 'not_configured', message: 'Chat needs a key.', opId: 'op_d' } }));
    expect(thread.value[1]).toMatchObject({ status: 'failed', error: 'Chat needs a key.' });
    // Other errors become one quiet system line with the missing keys.
    applyFrame(f({ type: 'error', data: { code: 'provider_error', message: 'The model did not answer.', turnId: 'turn_x', missingKeys: ['OPENAI_API_KEY'] } }));
    expect(thread.value[2]).toMatchObject({ from: 'system', kind: 'error', missingKeys: ['OPENAI_API_KEY'] });
  });

  it('marks replayed frames as not live, and live ones as live', () => {
    const seen: [string, boolean][] = [];
    const off = onFrame((fr, { live }) => seen.push([fr.type, live]));
    applyFrame(ready(2));
    applyFrame(f({ type: 'talk.owner', data: { turnId: 'turn_1', messageId: 'msg_o', text: 'old', via: 'text' } }, 1));
    applyFrame(f({ type: 'talk.message', data: { turnId: 'turn_1', messageId: 'msg_c', agentId: CHIEF_ID, text: 'old reply', kind: 'reply' } }, 2));
    applyFrame(f({ type: 'talk.message', data: { turnId: null, messageId: 'msg_d', agentId: CHIEF_ID, text: 'new', kind: 'announcement' } }, 3));
    off();
    expect(seen).toEqual([
      ['talk.owner', false],
      ['talk.message', false],
      ['talk.message', true],
    ]);
  });

  it('asks for a resync when the server ledger is behind the cursor', () => {
    applyFrame(f({ type: 'talk.owner', data: { turnId: 'turn_1', messageId: 'msg_o', text: 'hi', via: 'text' } }, 7));
    addPendingOwner('op_keep', 'unsent', 'text');
    expect(applyFrame(ready(0))).toBe('resync');
    expect(lastSeq.value).toBe(0);
    expect(thread.value.map((m) => m.text)).toEqual(['unsent']);
  });

  it('tracks the job lifecycle with steers', () => {
    const job = { jobId: 'job_1', projectId: 'everyday', title: 'Suppliers', brief: 'look into suppliers', status: 'running', label: 'Starting', step: 0, of: 3, agentId: CHIEF_ID, startedAt: 't0', updatedAt: 't0', steers: [] } as const;
    applyFrame(f({ type: 'job.started', data: { job: { ...job, steers: [] } } }, 1));
    applyFrame(f({ type: 'job.progress', data: { jobId: 'job_1', label: 'Reading reviews', step: 1, of: 3 } }, 2));
    applyFrame(f({ type: 'job.steered', data: { jobId: 'job_1', steerId: 'steer_1', text: 'also mailers', status: 'queued' } }, 3));
    applyFrame(f({ type: 'job.steered', data: { jobId: 'job_1', steerId: 'steer_1', text: 'also mailers', status: 'applied' } }, 4));
    expect(jobs.value.job_1!.steers).toHaveLength(1);
    expect(jobs.value.job_1!.steers[0]).toMatchObject({ status: 'applied' });
    applyFrame(f({ type: 'job.done', data: { jobId: 'job_1', summary: 's', result: '# r', finishedText: 'Finished' } }, 5));
    expect(jobs.value.job_1).toMatchObject({ status: 'done', label: 'Finished', step: 1, result: '# r' });
  });

  it('never lets replayed or older settings roll the workspace back', () => {
    const at = (iso: string, leadId: string | null) => ({ workspaceId: 'local', leadId, chiefName: null, voiceOn: true, updatedAt: iso });
    settings.value = at('2026-01-01T00:00:05.000Z', 'lead-a');
    applyFrame(ready(3));
    applyFrame(f({ type: 'workspace.updated', data: { settings: at('2026-01-01T00:00:01.000Z', null) } }, 1));
    expect(settings.value?.leadId).toBe('lead-a');
    applyFrame(f({ type: 'workspace.updated', data: { settings: at('2026-01-01T00:00:09.000Z', 'lead-b') } }, 4));
    expect(settings.value?.leadId).toBe('lead-b');
    applyFrame(f({ type: 'workspace.updated', data: { settings: at('2026-01-01T00:00:07.000Z', 'lead-c') } }, 5));
    expect(settings.value?.leadId).toBe('lead-b');
    settings.value = null;
  });

  it('merges job snapshots from GET /api/jobs without rolling back newer frames', () => {
    const snap = (id: string, updatedAt: string, label: string) => ({ jobId: id, projectId: 'everyday', title: id, brief: id, status: 'running', label, step: 2, of: 4, agentId: CHIEF_ID, startedAt: '2026-01-01T00:00:00.000Z', updatedAt, steers: [] }) as never;
    mergeJobs([snap('job_a', '2026-01-01T00:00:05.000Z', 'Reading')]);
    expect(jobs.value.job_a?.label).toBe('Reading');
    mergeJobs([snap('job_a', '2026-01-01T00:00:01.000Z', 'Older'), snap('job_b', '2026-01-01T00:00:02.000Z', 'Planning')]);
    expect(jobs.value.job_a?.label).toBe('Reading');
    expect(jobs.value.job_b?.label).toBe('Planning');
    mergeJobs([snap('job_a', '2026-01-01T00:00:09.000Z', 'Comparing')]);
    expect(jobs.value.job_a?.label).toBe('Comparing');
  });

  it('merges local speaking over server claims, and a finished turn ends thinking', () => {
    applyFrame(f({ type: 'presence', data: { agentId: CHIEF_ID, state: 'thinking', label: 'Thinking about suppliers', causeSeq: 1 } }));
    expect(chiefPresence.value).toEqual({ state: 'thinking', label: 'Thinking about suppliers' });
    setLocalPresence(CHIEF_ID, 'speaking', true);
    expect(chiefPresence.value.state).toBe('speaking');
    setLocalPresence(CHIEF_ID, 'speaking', false);
    applyFrame(f({ type: 'talk.done', data: { turnId: 'turn_1', messageId: null, finish: 'stop' } }, 1));
    expect(chiefPresence.value.state).toBe('idle');
  });
});
