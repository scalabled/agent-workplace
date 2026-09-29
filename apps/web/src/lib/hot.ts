// Live resources across hot updates (dev only). A Vite hot update re-evaluates every module between the edited file
// and the nearest component boundary without disposing the old instances, so a module that owns a live resource (the
// audio engine, the living runtime) would otherwise leave the old one running beside a new one: two runtimes voice
// every reflex twice. A module hands its resource over here: the next evaluation takes it and reuses or releases it.
// In a production build (and under tests) every module evaluates once and this is inert.

const dev = import.meta.env.DEV && import.meta.env.MODE !== 'test';

type HotGlobal = { __headcountHot?: Record<string, unknown>; __headcountHotTest?: boolean };

/** On in a dev build (and in the unit test that simulates a hot update: `globalThis.__headcountHotTest`). */
function enabled(): boolean {
  return dev || (globalThis as unknown as HotGlobal).__headcountHotTest === true;
}

function bag(): Record<string, unknown> {
  const g = globalThis as unknown as HotGlobal;
  return (g.__headcountHot ??= {});
}

/** What the previous evaluation of a module handed over under `key` (then forgotten), or undefined. */
export function hotTake<T>(key: string): T | undefined {
  if (!enabled()) return undefined;
  const b = bag();
  const v = b[key] as T | undefined;
  delete b[key];
  return v;
}

/** Hand a live resource to the next evaluation of this module (a hot update). Returns it. */
export function hotKeep<T>(key: string, value: T): T {
  if (enabled()) bag()[key] = value;
  return value;
}

/**
 * Mark this evaluation of a module as the current one under `key`. Returns `isCurrent()`: false once a hot update
 * re-evaluated the module (work the old instance still has in flight, such as a lazy boot, must then stand down).
 */
export function hotGeneration(key: string): () => boolean {
  if (!enabled()) return () => true;
  const token = {};
  bag()[`gen:${key}`] = token;
  return () => bag()[`gen:${key}`] === token;
}
