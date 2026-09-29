import { createRegistry, type Registry } from '@headcount/models';
import type { Env } from '../env';
import { metered, type MeterTag, type UsageSink } from '../usage/meter';
import { d1Sink } from '../usage/store';

/**
 * Process-wide seams for the WorkspaceDO and ProjectDO (worker-core). Production uses the defaults;
 * tests swap `registry` to script providers (e.g. gate a work step to prove talk never waits on it).
 */
export const runtime = {
  registry: (env: Env): Registry => createRegistry(env),
  now: (): number => Date.now(),
  /** Where metered model calls are recorded (D1; tests may swap it). */
  usage: (env: Env): UsageSink => d1Sink(env),
};

/** The model registry for one surface (and coworker), metered: every call it hands out is recorded as token usage. */
export function models(env: Env, tag: MeterTag): Registry {
  return metered(runtime.registry(env), runtime.usage(env), tag, () => runtime.now());
}

/** Defaults, so a test can restore them in afterEach. */
export const defaultRuntime = { ...runtime };

/** Log a failure without leaking request bodies, env or keys: the message only. */
export function logError(where: string, err: unknown): void {
  console.error(`[${where}]`, err instanceof Error ? err.message : String(err));
}

/** Log a recoverable condition worth seeing in the dev log (no request bodies, env or keys). */
export function logWarn(where: string, message: string): void {
  console.warn(`[${where}]`, message);
}
