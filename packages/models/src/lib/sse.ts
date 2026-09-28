// Ported from biz-bot/worker/src/util.js (parseSSE, sseResponse), typed; the parser also accepts
// the bare-CR line endings oncloudnine/server/lib/sse.ts handles.

export interface SseRecord {
  event: string | undefined;
  /** Raw data (multi-line data joined with \n); usually JSON. */
  data: string;
}

type ByteStream = ReadableStream<Uint8Array>;

/**
 * Parse a text/event-stream body into {event, data} records. Handles multi-line `data:`, CRLF, comments and
 * a separator split across chunks. Cancels the upstream reader if the consumer stops early (or throws), so a
 * departed client stops provider streaming and billing.
 */
export async function* parseSSE(body: ByteStream, signal?: AbortSignal): AsyncGenerator<SseRecord> {
  const reader = body.getReader();
  const stop = onAbort(signal, reader);
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | undefined;
  let dataLines: string[] = [];
  let finished = false;
  const flush = function* (): Generator<SseRecord> {
    if (dataLines.length) yield { event, data: dataLines.join('\n') };
    event = undefined;
    dataLines = [];
  };
  const handleLine = function* (line: string): Generator<SseRecord> {
    if (line === '') return yield* flush();
    if (line.startsWith(':')) return; // comment / keepalive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        finished = true;
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = nextLineBreak(buffer)) !== -1) {
        const line = buffer.slice(0, idx);
        const skip = buffer[idx] === '\r' && buffer[idx + 1] === '\n' ? 2 : 1;
        // A lone \r at the very end may be the first half of \r\n: wait for more input.
        if (buffer[idx] === '\r' && idx === buffer.length - 1) break;
        buffer = buffer.slice(idx + skip);
        yield* handleLine(line);
      }
    }
    if (buffer.length) {
      for (const line of buffer.split(/\r\n|\r|\n/)) yield* handleLine(line);
    }
    yield* flush();
  } finally {
    stop();
    if (!finished) reader.cancel().catch(() => undefined);
  }
}

/**
 * Cancel the reader when the caller aborts, so a pending read resolves even if the fetch implementation
 * does not tie the body to the signal (service bindings, test doubles).
 */
function onAbort(signal: AbortSignal | undefined, reader: ReadableStreamDefaultReader<Uint8Array>): () => void {
  if (!signal) return () => undefined;
  const cancel = () => void reader.cancel(signal.reason).catch(() => undefined);
  if (signal.aborted) cancel();
  else signal.addEventListener('abort', cancel, { once: true });
  return () => signal.removeEventListener('abort', cancel);
}

function nextLineBreak(s: string): number {
  const n = s.indexOf('\n');
  const r = s.indexOf('\r');
  if (n === -1) return r;
  if (r === -1) return n;
  return Math.min(n, r);
}

export type SseProducer = (emit: (obj: unknown) => Promise<void>, signal: AbortSignal) => Promise<void>;

/**
 * A unified SSE response. `producer(emit, signal)` calls `emit(obj)` for each event (await it for
 * backpressure); a thrown error is forwarded as `{type:'error', message, status}`; the stream always closes
 * with `data: [DONE]`. Comment heartbeats keep idle reasoning connections alive, at most one queued behind
 * a slow reader. A client disconnect or parent-signal abort aborts `signal` so the provider call stops.
 */
export function sseResponse(producer: SseProducer, opts: { heartbeatMs?: number; signal?: AbortSignal; headers?: Record<string, string> } = {}): Response {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const upstream = new AbortController();
  const parent = opts.signal;
  const heartbeatMs = opts.heartbeatMs && Number.isFinite(opts.heartbeatMs) && opts.heartbeatMs > 0 ? opts.heartbeatMs : 15_000;
  let producing = true;
  let disconnected = false;
  let pendingWrites = 0;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;

  const stopHeartbeat = () => {
    if (heartbeatTimer !== undefined) clearTimeout(heartbeatTimer);
    heartbeatTimer = undefined;
  };
  function stopProducer(reason: unknown = new DOMException('Stream producer finished', 'AbortError')) {
    producing = false;
    stopHeartbeat();
    parent?.removeEventListener('abort', abortFromParent);
    if (!upstream.signal.aborted) upstream.abort(reason);
  }
  function abortFromParent() {
    disconnected = true;
    const reason: unknown = parent?.reason ?? new DOMException('Request aborted', 'AbortError');
    stopProducer(reason);
    // Unblock a pending write even when the provider has gone silent.
    writer.abort(reason).catch(() => undefined);
  }
  const write = async (text: string) => {
    // Reject after disconnect so an awaiting producer unwinds instead of consuming a response nobody reads.
    if (disconnected) throw new DOMException('Client disconnected', 'AbortError');
    pendingWrites++;
    try {
      await writer.write(encoder.encode(text));
    } finally {
      pendingWrites--;
    }
  };
  const scheduleHeartbeat = () => {
    if (!producing || disconnected) return;
    heartbeatTimer = setTimeout(async () => {
      heartbeatTimer = undefined;
      try {
        if (!pendingWrites) await write(': keepalive\n\n');
      } catch {
        return;
      }
      scheduleHeartbeat();
    }, heartbeatMs);
  };
  writer.closed.then(
    () => stopProducer(),
    (reason: unknown) => {
      disconnected = true;
      stopProducer(reason);
    },
  );
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener('abort', abortFromParent, { once: true });
  const emit = (obj: unknown) => write(`data: ${JSON.stringify(obj)}\n\n`);
  scheduleHeartbeat();
  void (async () => {
    try {
      if (!disconnected) await producer(emit, upstream.signal);
    } catch (e) {
      stopProducer(e);
      if (!disconnected) {
        const err = e as { message?: string; status?: number };
        try {
          await emit({ type: 'error', message: err?.message || String(e), ...(err?.status ? { status: err.status } : {}) });
        } catch {
          /* client disconnected while reporting the error */
        }
      }
    } finally {
      stopProducer();
      try {
        await write('data: [DONE]\n\n');
      } catch {
        /* disconnected */
      }
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
    }
  })();
  return new Response(readable as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...opts.headers,
    },
  });
}

/** Parse a newline-delimited JSON body (Ollama). Unparseable lines are skipped. Cancels upstream on early exit. */
export async function* parseNDJSON(body: ByteStream, signal?: AbortSignal): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const stop = onAbort(signal, reader);
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  const parse = (line: string): { ok: true; value: unknown } | { ok: false } => {
    try {
      return { ok: true, value: JSON.parse(line) as unknown };
    } catch {
      return { ok: false };
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        const r = parse(line);
        if (r.ok) yield r.value;
      }
      if (done) {
        finished = true;
        break;
      }
    }
    const rest = buffer.trim();
    if (rest) {
      const r = parse(rest);
      if (r.ok) yield r.value;
    }
  } finally {
    stop();
    if (!finished) reader.cancel().catch(() => undefined);
  }
}
