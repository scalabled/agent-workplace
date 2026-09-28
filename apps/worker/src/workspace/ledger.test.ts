import { CHIEF_ID, parseFrame, type Frame } from '@headcount/protocol';
import { describe, expect, it } from 'vitest';
import { FakeStorage } from '../../test/fake-cloud';
import { Feed, PresenceBoard } from './feed';
import { Ledger, type SqlHost } from './ledger';

const host = () => new FakeStorage() as unknown as SqlHost;

function feedWith(storage: SqlHost) {
  const ledger = new Ledger(storage, 'ws:local');
  const presence = new PresenceBoard(storage);
  const sockets: { send(m: string): void }[] = [];
  const feed = new Feed('local', ledger, presence, () => sockets);
  return { ledger, presence, feed, sockets };
}

function socket() {
  const got: Frame[] = [];
  return { got, send: (m: string) => void got.push(parseFrame(m)!) };
}

describe('Ledger', () => {
  it('assigns gap-free seqs and replays after a cursor, oldest first', () => {
    const ledger = new Ledger(host(), 'ws:local');
    for (let i = 0; i < 5; i++) ledger.append({ type: 'workspace.updated', data: { settings: { workspaceId: 'local', leadId: null, chiefName: `n${i}`, voiceOn: true, updatedAt: '' } } });
    expect(ledger.lastSeq()).toBe(5);
    expect(ledger.since(2).map((f) => f.seq)).toEqual([3, 4, 5]);
    expect(ledger.since(0, 2).map((f) => f.seq)).toEqual([1, 2]);
    expect(ledger.since(5)).toEqual([]);
  });

  it('keeps seqs gap-free when a transaction rolls back', () => {
    const storage = host();
    const ledger = new Ledger(storage, 'ws:local');
    ledger.append({ type: 'job.cancelled', data: { jobId: 'job_a' } });
    expect(() =>
      ledger.tx(() => {
        ledger.append({ type: 'job.cancelled', data: { jobId: 'job_b' } });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    const next = ledger.append({ type: 'job.cancelled', data: { jobId: 'job_c' } });
    expect(next.seq).toBe(2);
    expect(ledger.since(0).map((f) => (f.data as { jobId: string }).jobId)).toEqual(['job_a', 'job_c']);
  });

  it('round-trips envelope fields and tracks the roll-up and forward outboxes', () => {
    const ledger = new Ledger(host(), 'p:everyday:local', () => Date.parse('2026-09-28T10:00:00Z'));
    const f = ledger.append({ type: 'job.cancelled', data: { jobId: 'job_a', reason: 'r' }, actor: 'owner', opId: 'op1', cause: { streamId: 'ws:local', seq: 7 } });
    expect(f).toEqual({ v: 1, streamId: 'p:everyday:local', seq: 1, ts: '2026-09-28T10:00:00.000Z', type: 'job.cancelled', data: { jobId: 'job_a', reason: 'r' }, actor: 'owner', opId: 'op1', cause: { streamId: 'ws:local', seq: 7 } });
    expect(ledger.get(1)).toEqual(f);
    ledger.append({ type: 'job.cancelled', data: { jobId: 'job_b' } });
    expect(ledger.unrolled().map((x) => x.seq)).toEqual([1, 2]);
    ledger.markRolled(1);
    expect(ledger.unrolled().map((x) => x.seq)).toEqual([2]);
    expect(ledger.unforwarded().map((x) => x.seq)).toEqual([1, 2]);
    ledger.markForwarded(2);
    expect(ledger.unforwarded()).toEqual([]);
  });

  it('returns the newest frames of given types, oldest first', () => {
    const ledger = new Ledger(host(), 'ws:local');
    ledger.append({ type: 'talk.owner', data: { turnId: 'turn_1', messageId: 'msg_1', text: 'a', via: 'text' } });
    ledger.append({ type: 'job.cancelled', data: { jobId: 'job_x' } });
    ledger.append({ type: 'talk.owner', data: { turnId: 'turn_2', messageId: 'msg_2', text: 'b', via: 'text' } });
    ledger.append({ type: 'talk.owner', data: { turnId: 'turn_3', messageId: 'msg_3', text: 'c', via: 'text' } });
    expect(ledger.recent(['talk.owner'], 2).map((f) => (f.data as { text: string }).text)).toEqual(['b', 'c']);
  });
});

describe('Feed', () => {
  it('greets a socket with ready, replays missed frames in order, then sends presence', () => {
    const { feed } = feedWith(host());
    for (let i = 1; i <= 4; i++) feed.append({ type: 'job.cancelled', data: { jobId: `job_${i}` } });
    const s = socket();
    const last = feed.open(s, 1);
    expect(last).toBe(4);
    expect(s.got.map((f) => f.type)).toEqual(['ready', 'job.cancelled', 'job.cancelled', 'job.cancelled', 'presence']);
    expect(s.got[0]).toMatchObject({ type: 'ready', after: 4, data: { lastSeq: 4, replayFrom: 1, workspaceId: 'local', streamId: 'ws:local' } });
    expect(s.got.slice(1, 4).map((f) => f.seq)).toEqual([2, 3, 4]);
    expect(s.got[4]).toMatchObject({ type: 'presence', data: { agentId: CHIEF_ID, state: 'idle' } });
  });

  it('pages a long replay with resume', () => {
    const { feed } = feedWith(host());
    for (let i = 1; i <= 7; i++) feed.append({ type: 'job.cancelled', data: { jobId: `job_${i}` } });
    const s = socket();
    expect(feed.replay(s, 0, 3)).toBe(3);
    expect(feed.replay(s, 3, 3)).toBe(6);
    expect(feed.replay(s, 6, 3)).toBe(7);
    expect(s.got.map((f) => f.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('broadcasts persisted and ephemeral frames to every socket', () => {
    const { feed, sockets } = feedWith(host());
    const a = socket();
    const b = socket();
    sockets.push(a, b, { send: () => { throw new Error('closed'); } });
    feed.append({ type: 'job.cancelled', data: { jobId: 'job_1' } });
    feed.emit({ type: 'talk.delta', data: { turnId: 'turn_1', messageId: 'msg_1', agentId: CHIEF_ID, delta: 'hi' } });
    expect(a.got.map((f) => [f.type, f.seq, f.after])).toEqual([
      ['job.cancelled', 1, undefined],
      ['talk.delta', undefined, 1],
    ]);
    expect(b.got.length).toBe(2);
  });
});

describe('PresenceBoard', () => {
  it('merges claims by priority and reports only changes', () => {
    const storage = host();
    const board = new PresenceBoard(storage);
    expect(board.claim(CHIEF_ID, 'p:everyday:local', { state: 'working', label: 'Comparing warranties', causeSeq: 3, projectId: 'everyday' })).toMatchObject({ state: 'working', label: 'Comparing warranties', causeSeq: 3, projectId: 'everyday', dwellMs: 300 });
    expect(board.claim(CHIEF_ID, 'talk', { state: 'thinking', label: 'Thinking', causeSeq: 4 })).toMatchObject({ state: 'thinking', dwellMs: 600 });
    // Same merged state again → no frame.
    expect(board.claim(CHIEF_ID, 'talk', { state: 'thinking', label: 'Thinking', causeSeq: 4 })).toBeNull();
    // Talk ends → back to working (the job still runs); job ends → idle.
    expect(board.claim(CHIEF_ID, 'talk', null)).toMatchObject({ state: 'working' });
    expect(board.claim(CHIEF_ID, 'p:everyday:local', null)).toMatchObject({ state: 'idle', label: 'Available' });
    // Claims survive a new board over the same storage (hibernation).
    board.claim(CHIEF_ID, 'p:everyday:local', { state: 'working', label: 'Writing up', causeSeq: 9 });
    expect(new PresenceBoard(storage).snapshot()).toEqual([expect.objectContaining({ agentId: CHIEF_ID, state: 'working', label: 'Writing up' })]);
  });
});
