import type { HealthCacheLike, LocalHealth } from './types';

/**
 * Reachability of local providers, cached per isolate: a reachable server is trusted for 30 s, an
 * unreachable one is skipped for 10 s, and concurrent probes of the same endpoint share one request.
 */
export class HealthCache implements HealthCacheLike {
  private entries = new Map<string, { health: LocalHealth; at: number }>();
  private inflight = new Map<string, Promise<LocalHealth>>();

  constructor(
    private readonly okTtlMs = 30_000,
    private readonly downTtlMs = 10_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  peek(key: string): LocalHealth | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (this.now() - e.at > (e.health.ok ? this.okTtlMs : this.downTtlMs)) return undefined;
    return e.health;
  }

  set(key: string, health: LocalHealth): void {
    this.entries.set(key, { health, at: this.now() });
  }

  check(key: string, probe: () => Promise<LocalHealth>): Promise<LocalHealth> {
    const known = this.peek(key);
    if (known) return Promise.resolve(known);
    const running = this.inflight.get(key);
    if (running) return running;
    const p = probe()
      .catch((e: unknown): LocalHealth => ({ ok: false, reason: e instanceof Error ? e.message : 'probe failed' }))
      .then((health) => {
        this.set(key, health);
        this.inflight.delete(key);
        return health;
      });
    this.inflight.set(key, p);
    return p;
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }
}

/** The default cache, shared by every registry in this isolate (registries are created per request). */
export const sharedHealth = new HealthCache();
