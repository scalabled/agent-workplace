// Ported from oncloudnine/server/lib/http.ts (fetchWithRetry, caller deadlines on the AbortSignal) and
// biz-bot/worker/src/util.js (throwUpstream), adapted to typed ProviderErrors with redaction.
import { ProviderError, type ProviderErrorKind } from '../errors';
import type { ProviderId } from '../types';

/** Budget for a request somebody is waiting on (non-streaming). */
export const PROVIDER_TIMEOUT_MS = 60_000;
/** Budget for a whole streamed reply. */
export const PROVIDER_STREAM_TIMEOUT_MS = 180_000;
/** Retries on 429/5xx/network errors (so three attempts at most). */
export const PROVIDER_RETRIES = 2;

const DEADLINE_KEY = 'providerDeadlineAt';

/**
 * Stamp a caller's own deadline on its signal. The signal travels unchanged to the provider fetch, so a
 * background job's longer budget reaches it without a new parameter on every layer. It only ever
 * lengthens the per-request timeout; the signal itself still aborts at the deadline.
 */
export function setProviderDeadline<T extends AbortSignal | undefined>(signal: T, deadlineAt: number): T {
  if (!signal || !(deadlineAt > 0)) return signal;
  try {
    Object.defineProperty(signal, DEADLINE_KEY, { value: deadlineAt, configurable: true, enumerable: false });
  } catch {
    /* a frozen signal costs the caller its longer budget, never the request */
  }
  return signal;
}

/** How long the caller is still willing to wait, or 0 for a caller that never said. */
export function providerDeadlineMs(signal: AbortSignal | null | undefined): number {
  const at = signal ? (signal as unknown as Record<string, unknown>)[DEADLINE_KEY] : 0;
  if (typeof at !== 'number' || !Number.isFinite(at)) return 0;
  return Math.max(0, at - Date.now());
}

/** AbortSignal.any where the runtime has it (Workers, Node ≥20, browsers); a manual merge otherwise. */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  const native = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof native === 'function') return native.call(AbortSignal, signals);
  const ac = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ac.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ac.abort(s.reason), { once: true });
  }
  return ac.signal;
}

/**
 * A signal that aborts after `ms` (reason `TimeoutError`) or when `parent` aborts, stamped with the deadline
 * so provider fetches budget for it. Pass it as `ChatRequest.signal`.
 */
export function deadlineSignal(ms: number, parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, ms));
  const signal = parent ? anySignal([parent, timeout]) : timeout;
  return setProviderDeadline(signal, Date.now() + ms);
}

/** True when the signal was aborted by a deadline rather than by the caller cancelling. */
export function isDeadline(signal: AbortSignal | undefined): boolean {
  const reason: unknown = signal?.reason;
  return Boolean(signal?.aborted && reason && typeof reason === 'object' && (reason as { name?: string }).name === 'TimeoutError');
}

function retryDelayMs(attempt: number, response?: Response): number {
  const header = response?.headers.get('retry-after');
  const seconds = header ? Number.parseInt(header, 10) : Number.NaN;
  // Retry-After is honoured but never lets an upstream hold the request open for long.
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5000);
  // 250 ms, 500 ms, 1 s … plus jitter so parallel callers do not resynchronise.
  return Math.min(250 * 2 ** attempt, 4000) + Math.floor(Math.random() * 100);
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export interface RetryOptions {
  provider: ProviderId;
  /** Owner-readable provider name for messages ("OpenAI", "Local (Ollama)"). */
  label: string;
  /** Per-attempt timeout; a longer caller deadline wins. */
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal | undefined;
  /** Values to scrub from any message (the provider key). */
  secrets?: (string | undefined)[];
}

/** An aborted caller. Adapters let it propagate; the stream guard turns it into `done: cancelled`. */
export class CallerAbort extends Error {
  constructor() {
    super('The caller cancelled the request.');
    this.name = 'AbortError';
  }
}

/**
 * One fetch policy for every provider call: a per-attempt timeout, two retries with exponential backoff and
 * jitter on 429/5xx/network errors (capped Retry-After), retried bodies cancelled, and never a retry on behalf
 * of a caller who already gave up. Returns the final Response (ok or not); throws ProviderError('unreachable').
 */
export async function fetchWithRetry(doFetch: typeof fetch, url: string, init: RequestInit, opts: RetryOptions): Promise<Response> {
  const caller = opts.signal ?? init.signal ?? null;
  const timeoutMs = Math.max(opts.timeoutMs ?? PROVIDER_TIMEOUT_MS, providerDeadlineMs(caller));
  const retries = opts.retries ?? PROVIDER_RETRIES;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (caller?.aborted) throw new CallerAbort();
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = caller ? anySignal([caller, timeout]) : timeout;
    try {
      const res = await doFetch(url, { ...init, signal });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        try {
          await res.body?.cancel();
        } catch {
          /* the retried body is never read */
        }
        await sleep(retryDelayMs(attempt, res), caller);
        continue;
      }
      return res;
    } catch (e) {
      if (caller?.aborted) throw new CallerAbort();
      lastError = timeout.aborted ? new Error(`no answer within ${Math.round(timeoutMs / 1000)} s`) : e;
      if (attempt >= retries) break;
      await sleep(retryDelayMs(attempt), caller);
    }
  }
  const reason = describeNetworkError(lastError);
  throw new ProviderError(opts.provider, redact(`${opts.label} is not reachable (${reason}).`, opts.secrets), undefined, true, /within/.test(reason) ? 'timeout' : 'unreachable');
}

function describeNetworkError(e: unknown): string {
  if (!e) return 'network error';
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  return err.cause?.code || err.cause?.message || err.message || String(e);
}

const KEYLIKE = /\b(?:sk-ant-|sk-proj-|sk-|xai-|AIza)[A-Za-z0-9_\-*.]{6,}/g;
const BEARER = /(Bearer\s+)[A-Za-z0-9_\-.~+/=]{8,}/gi;

/** Remove anything key-shaped (and the exact secrets given) from a message before it leaves the adapter. */
export function redact(text: string, secrets: (string | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  return out.replace(BEARER, '$1[redacted]').replace(KEYLIKE, '[redacted]');
}

function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model_not_found';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream';
  return 'bad_request';
}

/** Read an upstream error body (JSON or text) into a ProviderError with a useful, key-free message. */
export async function upstreamError(res: Response, opts: { provider: ProviderId; label: string; keyName?: string; secrets?: (string | undefined)[] }): Promise<ProviderError> {
  const text = await res.text().catch(() => '');
  let detail = '';
  try {
    const body = JSON.parse(text) as Record<string, unknown> | Record<string, unknown>[];
    const b = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | undefined;
    const err = b?.error as Record<string, unknown> | string | undefined;
    detail = (typeof err === 'object' && err && typeof err.message === 'string' ? err.message : '') || (typeof err === 'string' ? err : '') || (typeof b?.message === 'string' ? b.message : '') || (typeof b?.detail === 'string' ? b.detail : '');
  } catch {
    detail = text;
  }
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 400);
  const kind = kindForStatus(res.status);
  const retryable = kind === 'rate_limited' || kind === 'upstream' || kind === 'timeout';
  let message: string;
  if (kind === 'auth' && opts.keyName) message = `${opts.label} rejected the key in ${opts.keyName} (${res.status}).${detail ? ` ${detail}` : ''}`;
  else if (kind === 'rate_limited') message = `${opts.label} is rate limiting requests (429).${detail ? ` ${detail}` : ''}`;
  else message = `${opts.label} answered ${res.status}${detail ? `: ${detail}` : '.'}`;
  return new ProviderError(opts.provider, redact(message, opts.secrets), res.status, retryable, kind);
}

/** Strip trailing slashes. */
export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** True for loopback / .localhost / .test hosts (a provider there is "local"). */
export function isLocalUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.test') || host === '0.0.0.0';
  } catch {
    return false;
  }
}
