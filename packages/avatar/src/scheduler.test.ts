import type { FaceTier } from '@headcount/protocol';
import { describe, expect, it } from 'vitest';
import { FaceScheduler, type ScheduledFace } from './scheduler';

/** A manual rAF + clock so every tick is explicit. */
function harness(opts: { budgetMs?: number; maxAnimatedTiles?: number; IntersectionObserver?: typeof IntersectionObserver | null; document?: Document | null } = {}) {
  let clock = 0;
  let nextId = 1;
  const pending = new Map<number, (t: number) => void>();
  const cancelled: number[] = [];
  const scheduler = new FaceScheduler({
    budgetMs: opts.budgetMs ?? 6,
    maxAnimatedTiles: opts.maxAnimatedTiles ?? 3,
    now: () => clock,
    raf: (cb) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    caf: (id) => {
      cancelled.push(id);
      pending.delete(id);
    },
    IntersectionObserver: opts.IntersectionObserver ?? null,
    document: opts.document ?? null,
  });
  return {
    scheduler,
    pending,
    cancelled,
    advance(ms: number) {
      clock += ms;
    },
    get now() {
      return clock;
    },
    /** Run the pending frame (at most one exists: there is one loop). */
    frame(dt = 16) {
      clock += dt;
      expect(pending.size).toBeLessThanOrEqual(1);
      const entry = [...pending.entries()][0];
      if (!entry) return false;
      pending.delete(entry[0]);
      entry[1](clock);
      return true;
    },
  };
}

class TestFace implements ScheduledFace {
  frames: { now: number; tier: FaceTier }[] = [];
  dirty = true;
  live = true;
  cost = 0;
  constructor(
    public tier: FaceTier,
    public prio = 1,
    private readonly h?: { advance(ms: number): void },
    public interval = 0,
  ) {}
  priority() {
    return this.prio;
  }
  wantsFrame(now: number, tier: FaceTier) {
    if (this.dirty) return true;
    if (tier === 'token' || !this.live) return false;
    const last = this.frames.at(-1)?.now ?? -Infinity;
    return now - last >= this.interval;
  }
  isLive(tier: FaceTier) {
    return this.dirty || (tier !== 'token' && this.live);
  }
  frame(now: number, tier: FaceTier) {
    this.frames.push({ now, tier });
    this.dirty = false;
    this.h?.advance(this.cost);
  }
  invalidate() {
    this.dirty = true;
  }
}

describe('FaceScheduler', () => {
  it('drives every face from ONE requestAnimationFrame loop', () => {
    const h = harness();
    const faces = [new TestFace('hero'), new TestFace('tile'), new TestFace('tile'), new TestFace('token'), new TestFace('token')];
    for (const f of faces) h.scheduler.add(f);
    expect(h.pending.size).toBe(1);
    h.frame();
    for (const f of faces) expect(f.frames).toHaveLength(1);
    expect(h.pending.size).toBe(1); // heroes and tiles are live → exactly one next frame
    h.frame();
    expect(faces[0]!.frames).toHaveLength(2);
    expect(faces[3]!.frames, 'tokens draw only when dirty').toHaveLength(1);
  });

  it('stops when nothing needs a frame and restarts on wake()', () => {
    const h = harness();
    const token = new TestFace('token');
    h.scheduler.add(token);
    h.frame();
    expect(token.frames).toHaveLength(1);
    expect(h.pending.size).toBe(0);
    expect(h.scheduler.running).toBe(false);
    token.invalidate();
    h.scheduler.wake();
    expect(h.pending.size).toBe(1);
    h.frame();
    expect(token.frames).toHaveLength(2);
  });

  it('never skips heroes; budgets tiles and tokens and catches up round-robin', () => {
    const h = harness({ budgetMs: 6, maxAnimatedTiles: 10 });
    const hero = new TestFace('hero', 1, h);
    hero.cost = 20; // a slow hero still renders every frame
    const tiles = Array.from({ length: 4 }, () => {
      const t = new TestFace('tile', 1, h);
      t.cost = 4;
      return t;
    });
    h.scheduler.add(hero);
    tiles.forEach((t) => h.scheduler.add(t));
    h.frame();
    expect(hero.frames).toHaveLength(1);
    // The hero's 20 ms do not count against the tiles' 6 ms budget: two 4 ms tiles fit (4, then 8 ≥ 6 stops).
    expect(tiles.filter((t) => t.frames.length === 1)).toHaveLength(2);
    h.frame();
    h.frame();
    h.frame();
    expect(hero.frames).toHaveLength(4);
    expect(tiles.every((t) => t.frames.length >= 1), 'round-robin reaches every tile').toBe(true);
  });

  it('animates at most N tiles, by priority; the rest render still', () => {
    const h = harness({ maxAnimatedTiles: 2 });
    const tiles = [1, 5, 3, 4].map((p) => new TestFace('tile', p));
    tiles.forEach((t) => h.scheduler.add(t));
    h.frame();
    const tierOf = (t: TestFace) => t.frames.at(-1)!.tier;
    expect(tiles.map(tierOf)).toEqual(['token', 'tile', 'token', 'tile']);
    expect(h.scheduler.stats().animatedTiles).toBe(2);
    tiles[0]!.prio = 10; // becomes the most important → promoted, the weakest animated one drops
    h.frame();
    expect(tierOf(tiles[0]!)).toBe('tile');
    expect(tiles[2]!.frames.at(-1)!.tier).toBe('token');
    expect(tiles.filter((t) => t.frames.at(-1)!.tier === 'tile')).toHaveLength(2);
  });

  it('demotes the lowest-priority tile after sustained overrun, then restores it', () => {
    const h = harness({ budgetMs: 5, maxAnimatedTiles: 3 });
    const tiles = [3, 2, 1].map((p) => {
      const t = new TestFace('tile', p, h);
      t.cost = 6; // every tile blows the budget: only one renders per frame
      return t;
    });
    tiles.forEach((t) => h.scheduler.add(t));
    let demotedAt = -1;
    for (let i = 0; i < 200 && demotedAt < 0; i++) {
      h.frame(16);
      if (h.scheduler.stats().demoted > 0) demotedAt = h.now;
    }
    expect(demotedAt, 'a demotion happens after ~2 s of starvation').toBeGreaterThanOrEqual(2000);
    expect(demotedAt).toBeLessThan(2600);
    const low = tiles[2]!;
    tiles.forEach((t) => (t.cost = 0)); // the load goes away
    h.frame();
    expect(low.frames.at(-1)!.tier, 'the lowest-priority tile shows a still frame').toBe('token');
    expect(tiles[0]!.frames.at(-1)!.tier).toBe('tile');
    for (let i = 0; i < 140; i++) h.frame(16); // demotion lasts 2 s
    expect(h.scheduler.stats().demoted).toBe(0);
    expect(low.frames.at(-1)!.tier, 'restored after the demotion window').toBe('tile');
  });

  it('pauses faces that are off-screen (IntersectionObserver)', () => {
    let callback: IntersectionObserverCallback | null = null;
    const observed: Element[] = [];
    class FakeIO {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      unobserve() {}
      disconnect() {}
    }
    const h = harness({ IntersectionObserver: FakeIO as unknown as typeof IntersectionObserver });
    const el = {} as Element;
    const face = new TestFace('tile');
    const handle = h.scheduler.add(face, el);
    expect(observed).toEqual([el]);
    const report = (isIntersecting: boolean) => callback!([{ target: el, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
    report(false);
    h.frame();
    expect(face.frames).toHaveLength(0);
    expect(h.pending.size, 'nothing visible → the loop stops').toBe(0);
    report(true);
    expect(h.pending.size).toBe(1);
    h.frame();
    expect(face.frames).toHaveLength(1);
    handle.remove();
  });

  it('does not gate on visibilityState (embedded webviews report "hidden" while on screen; real hidden tabs get no rAF)', () => {
    const listeners: (() => void)[] = [];
    const doc = {
      visibilityState: 'hidden',
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: () => undefined,
    } as unknown as Document & { visibilityState: string };
    const h = harness({ document: doc });
    const face = new TestFace('hero');
    h.scheduler.add(face);
    // A frame is requested even though the document claims to be hidden; the browser decides whether it fires.
    expect(h.pending.size).toBe(1);
    h.frame();
    expect(face.frames).toHaveLength(1);
    // Becoming visible wakes an idle loop without double-scheduling.
    (doc as { visibilityState: string }).visibilityState = 'visible';
    listeners.forEach((cb) => cb());
    expect(h.pending.size).toBeLessThanOrEqual(1);
  });

  it('cancels the pending frame when the last face leaves', () => {
    const h = harness();
    const handle = h.scheduler.add(new TestFace('hero'));
    expect(h.pending.size).toBe(1);
    handle.remove();
    expect(h.pending.size).toBe(0);
    expect(h.cancelled).toHaveLength(1);
    expect(h.scheduler.stats().faces).toBe(0);
  });
});
