// The living workforce in the app (Inc 0.5): the entry the rest of the web shell calls. It is light on purpose.
// The runtime (the expression engine, the ~2.9 MB catalog, the runner and its ports) is a lazy chunk loaded once
// the app is idle; until it is ready every call here is a no-op and the app works exactly as before. Nothing here
// ever throws into the conversation: the living layer adds warmth, never failure.
import { signal } from '@preact/signals';
import type { Ambience, ExprRecentOp, FaceCue, ViewerOp } from '@headcount/protocol/ext/expressions';
import { hotGeneration, hotKeep, hotTake } from '../lib/hot';
import { trackEvents } from './events';
import { cueFace } from './faces';
import type { SendWhileSpeaking } from './policy';
import type { HoverPhase, HoverVia, LivingRuntime, OwnerTurnInput } from './types';

export type { LivingRuntime, OwnerTurnInput } from './types';

/** The runtime, once loaded. */
export const living = signal<LivingRuntime | null>(null);

// A hot update (dev) re-evaluates this module and boots a new runtime: the previous one must go first, or both would
// hear every frame and voice every reflex twice.
try {
  hotTake<LivingRuntime>('living-runtime')?.dispose();
} catch (err) {
  console.warn('living workforce:', err);
}
/** False once a hot update replaced this module: a boot it still has in flight stands down. */
const current = hotGeneration('living');

type Send = (op: ViewerOp | ExprRecentOp) => void;

let feedSend: Send | null = null;
let booting: Promise<void> | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let attempts = 0;
const MAX_ATTEMPTS = 8;
let inFlight = 0;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    console.warn('living workforce:', err);
    return fallback;
  }
}

function whenIdle(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout: 2000 });
  else setTimeout(fn, 200);
}

function boot(delayMs: number): void {
  clearTimeout(retry);
  retry = setTimeout(
    () =>
      whenIdle(() => {
        if (!current()) return;
        booting = import('./runtime')
          .then((m) => m.bootLiving({ send: (op) => feedSend?.(op) }))
          .then((rt) => {
            if (!current()) return rt.dispose();
            living.value = hotKeep('living-runtime', rt);
            attempts = 0;
          })
          .catch((err: unknown) => {
            booting = null;
            // The worker may not serve the catalog yet (starting up, or an older build): try again, slowly.
            if (++attempts < MAX_ATTEMPTS) boot(Math.min(5 * 60_000, 15_000 * 2 ** (attempts - 1)));
            else console.info('living workforce unavailable:', err);
          });
      }),
    delayMs,
  );
}

/**
 * Start (once per page) after the app is idle. `send` delivers socket ops on the current feed. The runtime outlives
 * the app screen (a goodbye can still play after leaving for the landing page); the returned cleanup detaches the
 * feed only.
 */
export function startLiving(send: Send): () => void {
  feedSend = send;
  // Real events the office may mention (job.done seqs), from the first frame on: replay included.
  safe(() => trackEvents(), undefined);
  if (!living.peek() && !booting) boot(0);
  return () => {
    if (feedSend === send) feedSend = null;
  };
}

/** Sends from this tab still waiting for their 202 (server reflexes for them are held meanwhile). */
export function sendsInFlight(): number {
  return inFlight;
}

/** A send is starting; call the returned function once it settled (after livingOwnerTurn on success). */
export function beginSend(): () => void {
  inFlight++;
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    inFlight = Math.max(0, inFlight - 1);
    safe(() => living.peek()?.sendSettled(), undefined);
  };
}

export function livingOwnerTurn(e: OwnerTurnInput): void {
  safe(() => living.peek()?.ownerTurn(e), undefined);
}

export function livingHover(agentId: string, phase: HoverPhase, via: HoverVia): void {
  safe(() => living.peek()?.hover(agentId, phase, via), undefined);
}

export function livingEnsureAgent(agentId: string): Promise<boolean> {
  return safe(() => living.peek()?.ensureAgent(agentId) ?? Promise.resolve(false), Promise.resolve(false));
}

/** null when the runtime is not ready: the caller keeps the pre-0.5 behaviour (stop the voice on send). */
export function livingSendDecision(agentId: string, text: string): SendWhileSpeaking | null {
  return safe(() => living.peek()?.sendDecision(agentId, text) ?? null, null);
}

export function livingBargeIn(agentId: string): void {
  safe(() => living.peek()?.bargeIn(agentId), undefined);
}

export function livingSetAmbience(a: Ambience): void {
  safe(() => living.peek()?.setAmbience(a), undefined);
}

/** A face gesture that needs no runtime (the look-up while speech is transcribed). */
export function livingCue(agentId: string, cue: FaceCue): void {
  safe(() => cueFace(agentId, cue), undefined);
}

/** Tests: drop the runtime and every pending start. */
export function resetLiving(): void {
  clearTimeout(retry);
  hotTake('living-runtime');
  safe(() => living.peek()?.dispose(), undefined);
  living.value = null;
  booting = null;
  feedSend = null;
  attempts = 0;
  inFlight = 0;
}
