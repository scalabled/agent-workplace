import { ProviderError } from '../errors';
import { CallerAbort, PROVIDER_STREAM_TIMEOUT_MS, PROVIDER_TIMEOUT_MS, fetchWithRetry, trimSlash, upstreamError } from '../lib/http';
import type { ProviderId } from '../types';

export interface HttpClientOptions {
  provider: ProviderId;
  /** Owner-readable provider name used in messages. */
  label: string;
  /** Env var that holds the key, named in auth errors (never its value). */
  keyName?: string;
  baseUrl: string;
  headers: Record<string, string>;
  fetch: typeof fetch;
  /** Values scrubbed from every message (the key). */
  secrets: (string | undefined)[];
}

export interface RequestOptions {
  method?: string;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal | undefined;
  /** Streamed replies get the 180 s budget, others 60 s (a longer caller deadline wins). */
  stream?: boolean;
  timeoutMs?: number;
  retries?: number;
}

/** Largest file download() accepts (a generated image; the worker stores portraits up to 5 MB). */
export const DOWNLOAD_MAX_BYTES = 5_000_000;

/** True for IPv4 literals in loopback, private, link-local, CGNAT or "this network" ranges. */
function privateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** True for IPv6 literals that are loopback, unspecified, unique-local, link-local or IPv4-mapped private. */
function privateIpv6(host: string): boolean {
  if (!host.startsWith('[')) return false;
  const h = host.slice(1, -1).toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  return mapped ? privateIpv4(mapped[1]!) : /^::ffff:/.test(h);
}

/**
 * A URL a provider handed back may only point at the public internet over https: never http:, loopback,
 * private or link-local addresses, or local names. (Workers cannot resolve DNS first, so a public name that
 * resolves to a private address is not caught here; the platform's egress rules cover that in production.)
 */
export function isPublicHttpsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || (!host.includes('.') && !host.startsWith('['))) return false;
  return !privateIpv4(host) && !privateIpv6(host);
}

/** One provider endpoint: base URL, auth headers and the shared retry/deadline/redaction policy. */
export class HttpClient {
  readonly baseUrl: string;
  constructor(readonly o: HttpClientOptions) {
    this.baseUrl = trimSlash(o.baseUrl);
  }

  url(path: string): string {
    return /^https?:/.test(path) ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  /** Fetch with retries; throws ProviderError for a non-2xx answer or an unreachable host. */
  async request(path: string, opts: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { ...this.o.headers, ...opts.headers };
    let body: BodyInit | undefined = opts.body;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    const res = await fetchWithRetry(
      this.o.fetch,
      this.url(path),
      { method: opts.method ?? (body !== undefined ? 'POST' : 'GET'), headers, ...(body !== undefined ? { body } : {}) },
      {
        provider: this.o.provider,
        label: this.o.label,
        timeoutMs: opts.timeoutMs ?? (opts.stream ? PROVIDER_STREAM_TIMEOUT_MS : PROVIDER_TIMEOUT_MS),
        signal: opts.signal,
        secrets: this.o.secrets,
        ...(opts.retries !== undefined ? { retries: opts.retries } : {}),
      },
    );
    if (!res.ok) throw await upstreamError(res, { provider: this.o.provider, label: this.o.label, ...(this.o.keyName ? { keyName: this.o.keyName } : {}), secrets: this.o.secrets });
    return res;
  }

  async json<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.request(path, opts);
    try {
      return (await res.json()) as T;
    } catch (e) {
      if (opts.signal?.aborted) throw new CallerAbort();
      throw new ProviderError(this.o.provider, `${this.o.label} sent an unreadable answer.`, res.status, true, 'bad_response');
    }
  }

  async bytes(path: string, opts: RequestOptions = {}): Promise<{ data: ArrayBuffer; mime: string }> {
    const res = await this.request(path, opts);
    return { data: await res.arrayBuffer(), mime: res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  /**
   * GET a URL the provider handed back (an image on a CDN) WITHOUT the auth headers. Only public https URLs
   * are fetched, and the body is read with a byte counter: past `maxBytes` the download is aborted, so a
   * misbehaving gateway can neither aim the worker at internal addresses nor exhaust its memory.
   */
  async download(url: string, signal?: AbortSignal, maxBytes = DOWNLOAD_MAX_BYTES): Promise<{ data: ArrayBuffer; mime: string }> {
    const refuse = (why: string) => new ProviderError(this.o.provider, `${this.o.label} ${why}`, undefined, false, 'bad_response');
    // Redirects are followed by hand (at most 3), each hop checked like the first.
    let res: Response | null = null;
    for (let hop = 0; hop <= 3; hop++) {
      if (!isPublicHttpsUrl(url)) throw refuse('pointed at a file that is not on a public https address; it was not fetched.');
      res = await fetchWithRetry(this.o.fetch, url, { method: 'GET', redirect: 'manual' }, { provider: this.o.provider, label: this.o.label, signal, secrets: this.o.secrets });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!next) break;
      await res.body?.cancel().catch(() => undefined);
      url = new URL(next, url).toString();
      res = null;
    }
    if (!res) throw refuse('redirected too many times; the file was not fetched.');
    if (!res.ok) throw await upstreamError(res, { provider: this.o.provider, label: this.o.label, secrets: this.o.secrets });
    const mime = res.headers.get('content-type') ?? 'application/octet-stream';
    const tooBig = () => refuse(`sent a file over ${Math.round(maxBytes / 1_000_000)} MB; it was not kept.`);
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw tooBig();
    }
    if (!res.body) return { data: new ArrayBuffer(0), mime };
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooBig();
      }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.byteLength;
    }
    return { data: out.buffer, mime };
  }

  body(res: Response): ReadableStream<Uint8Array> {
    if (!res.body) throw new ProviderError(this.o.provider, `${this.o.label} sent an empty stream.`, res.status, true, 'incomplete');
    return res.body as unknown as ReadableStream<Uint8Array>;
  }
}

/** Throw the caller's abort if the signal fired (between awaits in non-streaming calls). */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CallerAbort();
}

export const NOT_PRICED = { usd: null, costStatus: 'unavailable' } as const;
export const FREE = { usd: 0, costStatus: 'free' } as const;
