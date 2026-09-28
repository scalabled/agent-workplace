import { ProviderError } from '../errors';
import type { ModelEvent, ProviderId } from '../types';
import { isDeadline, redact } from './http';

/** The terminal event for an aborted signal: a deadline is an error, a caller's cancel is `done: cancelled`. */
export function abortEvent(signal: AbortSignal | undefined): ModelEvent {
  if (isDeadline(signal)) return { type: 'error', message: 'The model did not finish before its deadline.', code: 'timeout', retryable: false };
  return { type: 'done', finish: 'cancelled' };
}

/** Map anything thrown by an adapter to an `error` event (never leaks a key). */
export function errorEvent(e: unknown, provider: ProviderId, secrets: (string | undefined)[] = []): Extract<ModelEvent, { type: 'error' }> {
  if (e instanceof ProviderError) {
    return { type: 'error', message: redact(e.message, secrets), code: e.kind, ...(e.status !== undefined ? { status: e.status } : {}), retryable: e.retryable };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { type: 'error', message: redact(`${provider}: ${msg}`, secrets), code: 'upstream', retryable: false };
}

/**
 * Wrap a dialect's event generator so the stream ends with exactly one `done` or `error`:
 * thrown errors become `error`, an abort becomes `done: cancelled` (or a timeout error for a deadline),
 * a generator that stops without a terminal event is `incomplete` (retryable), and nothing is emitted after
 * the terminal event. Breaking out of the inner generator runs its `finally`, which cancels the upstream body.
 */
export async function* guardStream(
  provider: ProviderId,
  label: string,
  signal: AbortSignal | undefined,
  run: () => AsyncGenerator<ModelEvent>,
  secrets: (string | undefined)[] = [],
): AsyncGenerator<ModelEvent> {
  if (signal?.aborted) {
    yield abortEvent(signal);
    return;
  }
  let terminal = false;
  try {
    for await (const ev of run()) {
      if (signal?.aborted) break;
      yield ev.type === 'error' ? { ...ev, message: redact(ev.message, secrets) } : ev;
      if (ev.type === 'done' || ev.type === 'error') {
        terminal = true;
        break;
      }
    }
  } catch (e) {
    if (!terminal) {
      terminal = true;
      yield signal?.aborted ? abortEvent(signal) : errorEvent(e, provider, secrets);
    }
  }
  if (!terminal) {
    yield signal?.aborted
      ? abortEvent(signal)
      : { type: 'error', message: `${label} stopped before the reply was complete. Try again.`, code: 'incomplete', retryable: true };
  }
}
