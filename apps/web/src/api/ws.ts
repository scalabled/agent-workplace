// Owner feed socket: GET /api/ws?since=<seq>, reconnect with backoff, resume from the last applied seq.
// The server replays at most WS_REPLAY_LIMIT frames per page; while the client is behind `ready.lastSeq` it
// asks for the next page ({op:'resume'}) and holds newer frames back, so a long history never leaves a gap.
import { parseFrame, routePath, type Frame, type WsClientMessage } from '@headcount/protocol';

export type FeedStatus = 'connecting' | 'open' | 'closed';

export interface FeedOptions {
  onFrame(frame: Frame): void;
  onStatus?(status: FeedStatus): void;
  /** Highest persisted seq already applied (sent as ?since= on every (re)connect). */
  since(): number;
  /** Override for tests. */
  url?: (since: number) => string;
  /** Override for tests. */
  WebSocketImpl?: typeof WebSocket;
}

export interface Feed {
  close(): void;
  /** Drop the socket and connect again at once with the current `since()` (e.g. after a resync). */
  reconnect(): void;
}

export const PING_MS = 25_000;
/**
 * After a ping, how long to wait for anything at all (the pong comes back at once). A half-open socket (laptop
 * sleep, a Wi-Fi change, a NAT timeout) stays OPEN with no close event for minutes; this notices it.
 */
export const PONG_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 8_000;
/** Quiet time after a replay burst before asking for the next page. */
export const RESUME_IDLE_MS = 40;
/** How long to wait for a requested page before asking again. */
export const RESUME_RETRY_MS = 2_000;
/** Pages asked for without progress before giving up on catching up (the ledger no longer has them). */
const MAX_STALLED_RESUMES = 3;

export function connectFeed(opts: FeedOptions): Feed {
  const WS = opts.WebSocketImpl ?? WebSocket;
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let ping: ReturnType<typeof setInterval> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  /** Messages (frames and pongs) the current socket has delivered. */
  let heard = 0;

  const url = (since: number) => {
    if (opts.url) return opts.url(since);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${routePath('ws')}?since=${since}`;
  };

  const schedule = (delay: number) => {
    clearTimeout(retry);
    retry = setTimeout(open, delay);
  };

  // Catch-up state for the current socket (reset on every connect).
  let target = 0;
  let catching = false;
  let held: Frame[] = [];
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastResumeSince = -1;
  let stalled = 0;

  const finishCatchUp = () => {
    catching = false;
    clearTimeout(resumeTimer);
    const release = held;
    held = [];
    for (const f of release) opts.onFrame(f);
  };

  const armResume = (sock: WebSocket, delay = RESUME_IDLE_MS) => {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      if (ws !== sock || !catching) return;
      const since = opts.since();
      if (since >= target) return finishCatchUp();
      stalled = since === lastResumeSince ? stalled + 1 : 0;
      if (stalled >= MAX_STALLED_RESUMES) return finishCatchUp();
      lastResumeSince = since;
      if (sock.readyState === WS.OPEN) sock.send(JSON.stringify({ op: 'resume', since } satisfies WsClientMessage));
      armResume(sock, RESUME_RETRY_MS);
    }, delay);
  };

  const deliver = (sock: WebSocket, frame: Frame) => {
    if (frame.type === 'ready') {
      held = [];
      opts.onFrame(frame);
      target = frame.data.lastSeq;
      lastResumeSince = -1;
      stalled = 0;
      catching = opts.since() < target;
      if (catching) armResume(sock);
      return;
    }
    if (!catching) return opts.onFrame(frame);
    // Behind the server: replayed frames go through; newer (live) ones wait until the gap is filled.
    if (frame.seq !== undefined && frame.seq <= target) {
      opts.onFrame(frame);
      if (opts.since() >= target) finishCatchUp();
      else armResume(sock);
      return;
    }
    held.push(frame);
    armResume(sock);
  };

  /** The current socket is gone (closed, or silent past the watchdog): report it and reconnect with the cursor. */
  const lost = (sock: WebSocket, delay: number) => {
    if (ws !== sock) return; // a replaced socket closing late
    clearInterval(ping);
    clearTimeout(watchdog);
    clearTimeout(resumeTimer);
    ws = null;
    opts.onStatus?.('closed');
    if (closed) return;
    schedule(delay);
  };

  /** Ping now; if nothing at all arrives within PONG_TIMEOUT_MS, the socket is dead: drop it and reconnect. */
  const probe = (sock: WebSocket) => {
    if (ws !== sock || sock.readyState !== WS.OPEN) return;
    const before = heard;
    try {
      sock.send(JSON.stringify({ op: 'ping', t: Date.now() } satisfies WsClientMessage));
    } catch {
      /* the watchdog decides */
    }
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (ws !== sock || heard !== before) return;
      lost(sock, 0);
      try {
        sock.close();
      } catch {
        /* half-open: nothing to close cleanly */
      }
    }, PONG_TIMEOUT_MS);
  };

  const open = () => {
    if (closed) return;
    opts.onStatus?.('connecting');
    const sock = new WS(url(opts.since()));
    ws = sock;
    catching = false;
    held = [];
    clearTimeout(resumeTimer);
    clearTimeout(watchdog);
    sock.onopen = () => {
      if (ws !== sock) return;
      attempt = 0;
      opts.onStatus?.('open');
      clearInterval(ping);
      ping = setInterval(() => probe(sock), PING_MS);
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      heard++; // frames and pongs alike prove the socket is alive
      const frame = typeof e.data === 'string' ? parseFrame(e.data) : null;
      if (frame) deliver(sock, frame);
    };
    sock.onclose = () => lost(sock, Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt++));
  };

  // Come back quickly when the device is online again or the tab returns; a socket that still looks open is
  // probed at once (after a sleep it is often half-open).
  const nudge = () => {
    if (closed) return;
    if (!ws) {
      attempt = 0;
      schedule(0);
    } else if (ws.readyState === WS.OPEN) probe(ws);
  };
  const onVisible = () => document.visibilityState === 'visible' && nudge();
  if (typeof window !== 'undefined') window.addEventListener('online', nudge);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

  open();
  return {
    close() {
      closed = true;
      clearTimeout(retry);
      clearTimeout(resumeTimer);
      clearTimeout(watchdog);
      clearInterval(ping);
      if (typeof window !== 'undefined') window.removeEventListener('online', nudge);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      const sock = ws;
      ws = null;
      sock?.close();
    },
    reconnect() {
      if (closed) return;
      const sock = ws;
      ws = null;
      clearInterval(ping);
      clearTimeout(watchdog);
      try {
        sock?.close();
      } catch {
        /* already closing */
      }
      attempt = 0;
      schedule(0);
    },
  };
}
