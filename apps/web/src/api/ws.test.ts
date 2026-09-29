import type { ViewerOp } from '@headcount/protocol/ext/expressions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PING_MS, PONG_TIMEOUT_MS, RESUME_IDLE_MS, RESUME_RETRY_MS, connectFeed } from './ws';

class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

describe('connectFeed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
  });
  afterEach(() => vi.useRealTimers());

  it('resumes from the last applied seq with backoff, and parses frames', () => {
    let since = 0;
    const frames: string[] = [];
    const statuses: string[] = [];
    const feed = connectFeed({
      url: (s) => `ws://x/api/ws?since=${s}`,
      since: () => since,
      onFrame: (f) => frames.push(f.type),
      onStatus: (s) => statuses.push(s),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    const first = FakeSocket.all[0]!;
    expect(first.url).toBe('ws://x/api/ws?since=0');
    first.open();
    first.onmessage?.({ data: JSON.stringify({ v: 1, streamId: 'ws:local', type: 'ready', ts: '', data: { lastSeq: 0 } }) });
    first.onmessage?.({ data: '{"op":"pong"}' });
    expect(frames).toEqual(['ready']);
    since = 12;
    first.close();
    expect(statuses).toEqual(['connecting', 'open', 'closed']);
    vi.advanceTimersByTime(499);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all[1]!.url).toBe('ws://x/api/ws?since=12');
    feed.close();
  });

  it('send() queues ops until the socket opens (latest per op) and sends at once while open', () => {
    const feed = connectFeed({ url: () => 'ws://x', since: () => 0, onFrame: () => undefined, WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
    const sock = FakeSocket.all[0]!;
    const viewer = (surface: 'talk' | 'floor'): ViewerOp => ({ op: 'viewer', surface, stageAgentId: null, floorVisible: false, visibleProjectIds: [], listeningProjectIds: [], audioArmed: false, voiceOn: true, pageVisible: true, reducedMotion: false, quietHours: false, tzOffsetMin: 0, voice: null });
    feed.send(viewer('talk'));
    feed.send(viewer('floor'));
    feed.send({ op: 'expr.recent', agents: {} });
    expect(sock.sent).toEqual([]);
    sock.open();
    expect(sock.sent.map((m) => JSON.parse(m) as { op: string; surface?: string }).map((m) => m.surface ?? m.op)).toEqual(['floor', 'expr.recent']);
    feed.send(viewer('talk'));
    expect(JSON.parse(sock.sent.at(-1)!)).toMatchObject({ op: 'viewer', surface: 'talk' });
    feed.close();
  });

  it('reconnect() replaces the socket at once and ignores the old one', () => {
    let since = 5;
    const frames: string[] = [];
    const feed = connectFeed({ url: (s) => `ws://x?since=${s}`, since: () => since, onFrame: (f) => frames.push(f.type), WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
    const old = FakeSocket.all[0]!;
    old.open();
    since = 0;
    feed.reconnect();
    vi.advanceTimersByTime(0);
    const fresh = FakeSocket.all[1]!;
    expect(fresh.url).toBe('ws://x?since=0');
    old.onmessage?.({ data: JSON.stringify({ v: 1, streamId: 'ws:local', type: 'ready', ts: '', data: {} }) });
    expect(frames).toEqual([]);
    feed.close();
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('pages a long replay with {op:"resume"} and holds live frames until the gap is filled', () => {
    let since = 0;
    const applied: (number | string)[] = [];
    const feed = connectFeed({
      url: () => 'ws://x',
      since: () => since,
      onFrame: (f) => {
        applied.push(f.seq ?? f.type);
        if (f.seq !== undefined && f.seq > since) since = f.seq;
      },
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    const sock = FakeSocket.all[0]!;
    sock.open();
    const frame = (seq: number) => JSON.stringify({ v: 1, streamId: 'ws:local', seq, type: 'talk.owner', ts: '', data: { turnId: 't', messageId: `m${seq}`, text: 'x', via: 'text' } });
    sock.onmessage?.({ data: JSON.stringify({ v: 1, streamId: 'ws:local', type: 'ready', ts: '', data: { lastSeq: 5 } }) });
    sock.onmessage?.({ data: frame(1) });
    sock.onmessage?.({ data: frame(2) });
    // A live frame from beyond the replay target arrives before the rest of the history: it waits.
    sock.onmessage?.({ data: frame(6) });
    expect(applied).toEqual(['ready', 1, 2]);
    vi.advanceTimersByTime(RESUME_IDLE_MS);
    expect(sock.sent.map((m) => JSON.parse(m))).toContainEqual({ op: 'resume', since: 2 });
    for (const n of [3, 4, 5]) sock.onmessage?.({ data: frame(n) });
    expect(applied).toEqual(['ready', 1, 2, 3, 4, 5, 6]);
    vi.advanceTimersByTime(1000);
    expect(sock.sent.filter((m) => m.includes('resume'))).toHaveLength(1);
    feed.close();
  });

  it('stops asking when the server has no more pages', () => {
    const feed = connectFeed({ url: () => 'ws://x', since: () => 0, onFrame: () => undefined, WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
    const sock = FakeSocket.all[0]!;
    sock.open();
    sock.onmessage?.({ data: JSON.stringify({ v: 1, streamId: 'ws:local', type: 'ready', ts: '', data: { lastSeq: 9 } }) });
    vi.advanceTimersByTime(RESUME_IDLE_MS + 500);
    expect(sock.sent.filter((m) => m.includes('resume'))).toHaveLength(1); // a slow page is not re-requested at once
    vi.advanceTimersByTime(RESUME_RETRY_MS * 10);
    expect(sock.sent.filter((m) => m.includes('resume')).length).toBeLessThanOrEqual(3);
    feed.close();
  });

  it('notices a half-open socket: no pong after a ping → drop it and resume from the cursor', () => {
    const statuses: string[] = [];
    const feed = connectFeed({ url: (s) => `ws://x?since=${s}`, since: () => 7, onFrame: () => undefined, onStatus: (s) => statuses.push(s), WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
    const sock = FakeSocket.all[0]!;
    sock.close = () => {
      sock.readyState = 3; // a half-open socket never fires close
    };
    sock.open();
    vi.advanceTimersByTime(PING_MS);
    expect(sock.sent.some((m) => JSON.parse(m).op === 'ping')).toBe(true);
    sock.onmessage?.({ data: '{"op":"pong"}' }); // alive: the pong keeps it
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(PING_MS - PONG_TIMEOUT_MS); // next ping, and this time silence
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);
    expect(statuses).toContain('closed');
    vi.advanceTimersByTime(1); // a 0 ms timer set during a tick runs 1 ms later under fake timers
    expect(statuses.at(-1)).toBe('connecting');
    expect(FakeSocket.all).toHaveLength(2);
    expect(FakeSocket.all[1]!.url).toBe('ws://x?since=7');
    feed.close();
  });

  it('probes at once when the tab becomes visible again', () => {
    const feed = connectFeed({ url: () => 'ws://x', since: () => 0, onFrame: () => undefined, WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
    const sock = FakeSocket.all[0]!;
    sock.close = () => {
      sock.readyState = 3;
    };
    sock.open();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sock.sent.some((m) => JSON.parse(m).op === 'ping')).toBe(true);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS + 1);
    expect(FakeSocket.all).toHaveLength(2);
    feed.close();
  });
});
