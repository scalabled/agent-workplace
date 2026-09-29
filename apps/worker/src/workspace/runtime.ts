import { createRegistry, type Registry } from '@headcount/models';
import type { Env } from '../env';

/**
 * Process-wide seams for the WorkspaceDO and ProjectDO (worker-core). Production uses the defaults;
 * tests swap `registry` to script providers (e.g. gate a work step to prove talk never waits on it).
 */
export const runtime = {
  registry: (env: Env): Registry => createRegistry(env),
  now: (): number => Date.now(),
};

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
