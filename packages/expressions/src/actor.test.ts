import { describe, expect, it } from 'vitest';
import { contentionFor, createMailboxes, mergeAttention } from './actor';
import { etaPhrase } from './state';
import { T0 } from './testing';
import type { AttentionThread } from './types';
import { MAILBOX_PRIORITY } from './vocab';

describe('mailboxes (§2.1)', () => {
  it('reads the most urgent box first, FIFO within a box', () => {
    const mb = createMailboxes<string>();
    mb.post({ id: '1', box: 'ambient', at: T0, payload: 'quip' });
    mb.post({ id: '2', box: 'work', at: T0, payload: 'progress' });
    mb.post({ id: '3', box: 'owner', at: T0, payload: 'hello' });
    mb.post({ id: '4', box: 'owner', at: T0 + 1, payload: 'and another' });
    mb.post({ id: '5', box: 'coworker', at: T0, payload: 'ask' });
    expect([1, 2, 3, 4, 5].map(() => mb.take(T0 + 10)?.payload)).toEqual(['hello', 'and another', 'ask', 'progress', 'quip']);
    expect(mb.take(T0)).toBeNull();
    expect(MAILBOX_PRIORITY).toEqual({ owner: 0, floor: 1, coworker: 2, work: 3, ambient: 4 });
  });
  it('coalesces latest-wins and drops stale items on read', () => {
    const mb = createMailboxes<number>();
    mb.post({ id: 'a', box: 'work', at: T0, coalesceKey: 'job_7', payload: 1 });
    mb.post({ id: 'b', box: 'work', at: T0 + 5, coalesceKey: 'job_7', payload: 2 });
    mb.post({ id: 'c', box: 'ambient', at: T0, ttlMs: 1000, payload: 3 });
    expect(mb.size()).toBe(2);
    expect(mb.take(T0 + 2000)?.payload).toBe(2);
    expect(mb.take(T0 + 2000)).toBeNull(); // the ambient item expired
  });
  it('bounds boxes, reports preemption and drops by predicate', () => {
    const mb = createMailboxes<number>({ maxPerBox: { ambient: 2 } });
    for (let i = 0; i < 5; i++) mb.post({ id: `x${i}`, box: 'ambient', at: T0, payload: i });
    expect(mb.size('ambient')).toBe(2);
    expect(mb.take(T0)?.payload).toBe(3);
    const owner = { id: 'o', box: 'owner' as const, at: T0, payload: 0 };
    expect(mb.preempts(owner, 'floor')).toBe(true);
    expect(mb.preempts({ ...owner, box: 'ambient' }, 'work')).toBe(false);
    mb.post({ id: 'y', box: 'work', at: T0, payload: 9 });
    expect(mb.drop((e) => e.payload > 3)).toBe(2);
    expect(mb.size()).toBe(0);
  });
});

const thread = (over: Partial<AttentionThread>): AttentionThread => ({
  id: 't', kind: 'work', mailbox: 'work', host: 'p:prj', label: 'running the competitor grid', voice: { speaking: false, untilMs: null },
  floorHeld: false, interruptible: 'checkpoint', since: T0, ...over,
});

describe('attention (§2.2, §2.3)', () => {
  const meeting = thread({ id: 'rm_nw', kind: 'meeting', mailbox: 'floor', host: 'rm:rm_nw', label: 'the Northwind review', voice: { speaking: true, untilMs: T0 + 9000 }, floorHeld: true, interruptible: 'sentence' });
  const talk = thread({ id: 'talk', kind: 'talk', mailbox: 'owner', host: 'ws:local', label: 'Talk', since: T0 + 10 });
  const work = thread({ id: 'job_7', since: T0 - 1000 });

  it('focuses the thread holding the voice, then the floor, then the most urgent box', () => {
    const v = mergeAttention('cw_lena', [work, talk, meeting], T0 + 1000);
    expect(v.focus?.id).toBe('rm_nw');
    expect(v.background.map((t) => t.id)).toEqual(['talk', 'job_7']);
    expect(v.voiceBusyUntil).toBe(T0 + 9000);
    const after = mergeAttention('cw_lena', [work, talk, { ...meeting, floorHeld: false }], T0 + 10_000);
    expect(after.focus?.id).toBe('talk'); // the voice ended; the owner's thread is most urgent
    expect(after.voiceBusyUntil).toBeNull();
  });

  it('reports a real contention with its remaining time, and none otherwise (H5)', () => {
    const v = mergeAttention('cw_lena', [work, talk, meeting], T0 + 1000);
    const c = contentionFor(v, { mailbox: 'owner', threadId: 'talk' }, T0 + 1000);
    expect(c).toEqual({ kind: 'voice_busy', etaMs: 8000, otherThread: 'the Northwind review' });
    expect(etaPhrase(c.kind === 'none' ? null : c.etaMs)).toBe('a few seconds');
    const floorOnly = mergeAttention('cw_lena', [{ ...meeting, voice: { speaking: false, untilMs: null } }, talk], T0);
    expect(contentionFor(floorOnly, { mailbox: 'owner', threadId: 'talk' }, T0)).toEqual({ kind: 'floor_held', etaMs: null, otherThread: 'the Northwind review' });
    expect(contentionFor(mergeAttention('cw_lena', [work, talk], T0), { mailbox: 'owner', threadId: 'talk' }, T0)).toEqual({ kind: 'none' });
    expect(contentionFor(mergeAttention('cw_lena', [meeting], T0), { mailbox: 'floor', threadId: 'rm_nw' }, T0)).toEqual({ kind: 'none' });
  });
});
