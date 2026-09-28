// Test helpers: a scripted fetch that records requests, and streaming bodies split at awkward boundaries.
// Not exported from the package index.

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON body, the FormData, or the raw string. */
  body: unknown;
  signal: AbortSignal | undefined;
}

export type FakeFetch = typeof fetch & { calls: RecordedRequest[] };

export function fakeFetch(handler: (req: RecordedRequest, n: number) => Response | Promise<Response>): FakeFetch {
  const calls: RecordedRequest[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h) for (const [k, v] of Object.entries(h as Record<string, string>)) headers[k.toLowerCase()] = v;
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* raw */
      }
    }
    const req: RecordedRequest = { url, method: init?.method ?? 'GET', headers, body, signal: init?.signal ?? undefined };
    calls.push(req);
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return handler(req, calls.length - 1);
  }) as FakeFetch;
  f.calls = calls;
  return f;
}

const enc = new TextEncoder();

/** A body that delivers `text` in chunks of `size` characters (splitting lines, CRLFs and UTF-8 mid-way). */
export function chunkedBody(text: string, size = 7): ReadableStream<Uint8Array> {
  const bytes = enc.encode(text);
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + size));
      i += size;
    },
  });
}

/** SSE text from events: objects become `data: {json}`, strings are raw data; `[event, obj]` adds `event:`. */
export function sseText(events: (object | string | [string, object])[], crlf = false): string {
  const nl = crlf ? '\r\n' : '\n';
  return events
    .map((e) => {
      if (Array.isArray(e)) return `event: ${e[0]}${nl}data: ${JSON.stringify(e[1])}${nl}${nl}`;
      return `data: ${typeof e === 'string' ? e : JSON.stringify(e)}${nl}${nl}`;
    })
    .join('');
}

export function sseResponse(events: (object | string | [string, object])[], opts: { size?: number; crlf?: boolean; status?: number } = {}): Response {
  return new Response(chunkedBody(sseText(events, opts.crlf), opts.size ?? 7) as unknown as BodyInit, { status: opts.status ?? 200, headers: { 'content-type': 'text/event-stream' } });
}

export function ndjsonResponse(lines: object[], size = 11): Response {
  return new Response(chunkedBody(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', size) as unknown as BodyInit, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}

export function jsonResponse(obj: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function bytesResponse(bytes: Uint8Array, type: string): Response {
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: { 'content-type': type } });
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
