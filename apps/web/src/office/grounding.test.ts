// Grounded small talk: only the Chief's finished jobs of the last 8 hours whose job.done frame
// this page saw, spoken of as "write-up", never with the job's title, summary or result.
import { CHIEF_ID, makeFrame, type Frame, type JobSnapshot } from '@headcount/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { jobDoneSeqs, recordFrame, resetEvents } from '../living/events';
import { GROUNDED_MAX_AGE_MS, groundingEvents } from './grounding';

const NOW = Date.parse('2026-09-29T15:00:00Z');
const job = (jobId: string, over: Partial<JobSnapshot>): JobSnapshot =>
  ({ jobId, projectId: 'p_everyday', title: 'Compare the Lisbon supplier quotes', brief: 'my private brief', status: 'done', label: 'Done', step: 3, of: 3, agentId: CHIEF_ID, startedAt: '2026-09-29T13:00:00Z', updatedAt: '2026-09-29T14:00:00Z', finishedAt: '2026-09-29T14:00:00Z', steers: [], result: 'Quote B is 12% cheaper', summary: 'secret summary', ...over }) as JobSnapshot;

afterEach(() => resetEvents());

describe('grounded events for small talk', () => {
  it('records job.done seqs from frames (replay included)', () => {
    recordFrame(makeFrame('ws:local', { type: 'job.done', data: { jobId: 'job_a' as never, summary: 's', result: 'r', finishedText: 'done' } }, { seq: 41 }) as unknown as Frame);
    recordFrame(makeFrame('ws:local', { type: 'job.done', data: { jobId: 'job_b' as never, summary: 's', result: 'r', finishedText: 'done' } }, { after: 0 }) as unknown as Frame);
    expect(jobDoneSeqs.get('job_a')?.seq).toBe(41);
    expect(jobDoneSeqs.has('job_b')).toBe(false);
  });

  it('only done Chief jobs within 8 h with a known seq, as "the write-up", never their words', () => {
    const seqs = new Map([
      ['job_ok', { seq: 7, at: NOW }],
      ['job_old', { seq: 8, at: NOW }],
      ['job_running', { seq: 9, at: NOW }],
      ['job_other', { seq: 10, at: NOW }],
    ]);
    const jobs = {
      job_ok: job('job_ok', {}),
      job_old: job('job_old', { finishedAt: new Date(NOW - GROUNDED_MAX_AGE_MS - 60_000).toISOString() }),
      job_running: job('job_running', { status: 'running', finishedAt: undefined }),
      job_other: job('job_other', { agentId: 'cw_kate' }),
      job_unseen: job('job_unseen', {}),
    };
    const ev = groundingEvents({ jobs, seqs, workspaceId: 'local', now: NOW });
    expect(ev).toEqual([{ kind: 'job.done', agentIds: [CHIEF_ID], at: Date.parse('2026-09-29T14:00:00Z'), visibility: 'team', cause: { streamId: 'ws:local', seq: 7 }, artifact: 'the write-up' }]);
    const text = JSON.stringify(ev);
    for (const secret of ['Lisbon', 'private', '12%', 'secret']) expect(text).not.toContain(secret);
    expect(groundingEvents({ jobs, seqs, workspaceId: null, now: NOW })).toEqual([]);
  });
});
