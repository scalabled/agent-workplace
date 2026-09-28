// ONE requestAnimationFrame loop for every face on the page (ARCHITECTURE §9.4, EXPERIENCE §4.5).
// Heroes always render; tiles render round-robin, most important first, inside a per-frame
// budget; tokens render only when something changed. At most N tiles animate (the rest show a
// still frame), off-screen faces pause (IntersectionObserver), a hidden tab pauses everything,
// and a sustained overrun demotes the lowest-priority animated tile to a still token for a while.
// The loop stops by itself when nothing needs a frame.
import type { FaceTier } from '@headcount/protocol';

export interface ScheduledFace {
  /** The tier the caller asked for. */
  readonly tier: FaceTier;
  /** Higher = more important (speaking hero ≫ idle tile). */
  priority(): number;
  /** Should this face draw now at `tier` (the effective tier after caps/demotion)? */
  wantsFrame(now: number, tier: FaceTier): boolean;
  /** Keep the loop running for this face (animated or has pending work)? */
  isLive(tier: FaceTier): boolean;
  /** Draw one frame at the effective tier. */
  frame(now: number, tier: FaceTier): void;
  /** The effective tier changed (cap or demotion): redraw on the next frame. */
  invalidate(): void;
}

export interface FaceHandle {
  /** Make sure the loop runs (state, sampler or content changed). */
  wake(): void;
  /** Track visibility of this element (IntersectionObserver). */
  observe(el: Element | null): void;
  remove(): void;
  /** The tier the scheduler is currently rendering this face at. */
  effectiveTier(): FaceTier;
}

export interface FaceSchedulerOptions {
  /** Per-frame budget for tiles and tokens, ms (heroes are never skipped). Default 6. */
  budgetMs?: number;
  /** Tiles animated at once; the rest render still. Default 3. */
  maxAnimatedTiles?: number;
  /** Sustained starvation before a tile is demoted, ms. Default 2000. */
  demoteAfterMs?: number;
  /** How long a demoted tile stays a token, ms. Default 2000. */
  demoteForMs?: number;
  now?: () => number;
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
  /** null disables visibility tracking (every face counts as visible). */
  IntersectionObserver?: typeof IntersectionObserver | null;
  document?: Document | null;
}

interface Entry {
  face: ScheduledFace;
  el: Element | null;
  visible: boolean;
  lastFrameAt: number;
  demotedUntil: number;
  effective: FaceTier;
}

export interface SchedulerStats {
  faces: number;
  visible: number;
  running: boolean;
  ticks: number;
  lastWorkMs: number;
  overrunMs: number;
  demoted: number;
  animatedTiles: number;
}

export class FaceScheduler {
  private readonly entries = new Set<Entry>();
  private readonly byEl = new Map<Element, Entry>();
  private rafId = 0;
  private ticks = 0;
  private lastTickAt: number | null = null;
  private lastWorkMs = 0;
  private overrunMs = 0;
  private io: IntersectionObserver | null = null;
  private readonly opts: Required<Omit<FaceSchedulerOptions, 'IntersectionObserver' | 'document'>> & {
    IntersectionObserver: typeof IntersectionObserver | null;
    document: Document | null;
  };
  private readonly onVisibility = () => {
    if (this.opts.document?.visibilityState !== 'hidden') this.wake();
  };

  constructor(options: FaceSchedulerOptions = {}) {
    const g = globalThis as unknown as {
      requestAnimationFrame?: (cb: (t: number) => void) => number;
      cancelAnimationFrame?: (id: number) => void;
      IntersectionObserver?: typeof IntersectionObserver;
      document?: Document;
      performance?: Performance;
    };
    this.opts = {
      budgetMs: options.budgetMs ?? 6,
      maxAnimatedTiles: options.maxAnimatedTiles ?? 3,
      demoteAfterMs: options.demoteAfterMs ?? 2000,
      demoteForMs: options.demoteForMs ?? 2000,
      now: options.now ?? (() => (g.performance ? g.performance.now() : Date.now())),
      raf: options.raf ?? ((cb) => (g.requestAnimationFrame ? g.requestAnimationFrame(cb) : (setTimeout(() => cb(this.opts.now()), 16) as unknown as number))),
      caf: options.caf ?? ((id) => (g.cancelAnimationFrame ? g.cancelAnimationFrame(id) : clearTimeout(id))),
      IntersectionObserver: options.IntersectionObserver === undefined ? (g.IntersectionObserver ?? null) : options.IntersectionObserver,
      document: options.document === undefined ? (g.document ?? null) : options.document,
    };
    this.opts.document?.addEventListener?.('visibilitychange', this.onVisibility);
  }

  get running(): boolean {
    return this.rafId !== 0;
  }

  /** Update tunables at runtime (e.g. the web raises maxAnimatedTiles for a gallery). */
  configure(options: Pick<FaceSchedulerOptions, 'budgetMs' | 'maxAnimatedTiles' | 'demoteAfterMs' | 'demoteForMs'>): void {
    for (const [k, v] of Object.entries(options)) if (typeof v === 'number' && Number.isFinite(v)) (this.opts as unknown as Record<string, number>)[k] = v;
    this.markAllDirty();
  }

  add(face: ScheduledFace, el?: Element | null): FaceHandle {
    const entry: Entry = { face, el: null, visible: true, lastFrameAt: -1e12, demotedUntil: 0, effective: face.tier };
    this.entries.add(entry);
    const handle: FaceHandle = {
      wake: () => this.wake(),
      observe: (target) => this.observe(entry, target),
      remove: () => this.remove(entry),
      effectiveTier: () => entry.effective,
    };
    if (el) handle.observe(el);
    this.wake();
    return handle;
  }

  /** Ask every face to redraw (theme change, reduced-motion change). */
  markAllDirty(): void {
    for (const e of this.entries) e.face.invalidate();
    this.wake();
  }

  wake(): void {
    if (this.rafId || !this.entries.size) return;
    if (this.opts.document?.visibilityState === 'hidden') return;
    this.rafId = this.opts.raf((t) => this.tick(t));
  }

  /** One frame. Public for tests and for hosts that drive their own clock. */
  tick(now: number = this.opts.now()): void {
    this.rafId = 0;
    if (this.opts.document?.visibilityState === 'hidden') return;
    const start = this.opts.now();
    this.ticks++;
    const visible = [...this.entries].filter((e) => e.visible);

    // Effective tiers: heroes stay heroes; the top N tiles animate; demoted tiles are tokens.
    const tiles = visible.filter((e) => e.face.tier === 'tile' && !(e.demotedUntil > now)).sort((a, b) => b.face.priority() - a.face.priority());
    const animated = new Set(tiles.slice(0, Math.max(0, this.opts.maxAnimatedTiles)));
    for (const e of visible) {
      const eff: FaceTier = e.face.tier === 'hero' ? 'hero' : e.face.tier === 'tile' && animated.has(e) ? 'tile' : 'token';
      if (eff !== e.effective) {
        e.effective = eff;
        e.face.invalidate();
      }
    }

    const due = visible.filter((e) => e.face.wantsFrame(now, e.effective));
    for (const e of due) {
      if (e.effective !== 'hero') continue;
      e.face.frame(now, 'hero');
      e.lastFrameAt = now;
    }
    // Most important first, but waiting raises a face's claim (+1 per 100 ms, capped) so a
    // low-priority face under sustained load still gets its turn (round-robin, not starvation).
    const claim = (e: Entry) => e.face.priority() + Math.min(50, (now - e.lastFrameAt) / 100);
    const rest = due.filter((e) => e.effective !== 'hero').sort((a, b) => claim(b) - claim(a));
    // Heroes always render and do not count against the tiles' budget (CONTRACTS §4.10): measure from here.
    const tileStart = this.opts.now();
    let rendered = 0;
    let starved = false;
    for (const e of rest) {
      if (rendered > 0 && this.opts.now() - tileStart >= this.opts.budgetMs) {
        if (e.effective === 'tile') starved = true;
        continue; // next frame; the oldest-drawn go first then
      }
      e.face.frame(now, e.effective);
      e.lastFrameAt = now;
      rendered++;
    }
    this.lastWorkMs = this.opts.now() - start;

    const dt = this.lastTickAt === null ? 16 : Math.max(0, Math.min(250, now - this.lastTickAt));
    this.lastTickAt = now;
    if (starved) this.overrunMs += dt;
    else this.overrunMs = 0;
    if (this.overrunMs >= this.opts.demoteAfterMs) {
      const victim = [...animated].sort((a, b) => a.face.priority() - b.face.priority())[0];
      if (victim) {
        victim.demotedUntil = now + this.opts.demoteForMs;
        victim.effective = 'token';
        victim.face.invalidate();
      }
      this.overrunMs = 0;
    }

    const keep =
      visible.some((e) => e.face.isLive(e.effective)) ||
      rest.length > rendered ||
      [...this.entries].some((e) => e.demotedUntil > now);
    if (keep) this.wake();
  }

  stats(): SchedulerStats {
    const now = this.opts.now();
    const list = [...this.entries];
    return {
      faces: list.length,
      visible: list.filter((e) => e.visible).length,
      running: this.running,
      ticks: this.ticks,
      lastWorkMs: this.lastWorkMs,
      overrunMs: this.overrunMs,
      demoted: list.filter((e) => e.demotedUntil > now).length,
      animatedTiles: list.filter((e) => e.visible && e.effective === 'tile').length,
    };
  }

  /** Stop the loop and forget every face (tests, teardown). */
  destroy(): void {
    if (this.rafId) this.opts.caf(this.rafId);
    this.rafId = 0;
    this.io?.disconnect();
    this.io = null;
    this.entries.clear();
    this.byEl.clear();
    this.opts.document?.removeEventListener?.('visibilitychange', this.onVisibility);
  }

  private observe(entry: Entry, el: Element | null) {
    if (entry.el) {
      this.io?.unobserve(entry.el);
      this.byEl.delete(entry.el);
    }
    entry.el = el;
    entry.visible = true;
    if (!el) return;
    this.byEl.set(el, entry);
    const IO = this.opts.IntersectionObserver;
    if (!IO) return;
    if (!this.io) {
      this.io = new IO(
        (records) => {
          let changed = false;
          for (const r of records) {
            const e = this.byEl.get(r.target);
            if (!e || e.visible === r.isIntersecting) continue;
            e.visible = r.isIntersecting;
            if (e.visible) e.face.invalidate();
            changed = true;
          }
          if (changed) this.wake();
        },
        { rootMargin: '96px' },
      );
    }
    this.io.observe(el);
  }

  private remove(entry: Entry) {
    if (!this.entries.delete(entry)) return;
    if (entry.el) {
      this.io?.unobserve(entry.el);
      this.byEl.delete(entry.el);
    }
    if (!this.entries.size && this.rafId) {
      this.opts.caf(this.rafId);
      this.rafId = 0;
    }
  }
}

let shared: FaceScheduler | null = null;

/** The page-wide scheduler every FaceView registers with. */
export function faceScheduler(): FaceScheduler {
  if (!shared) shared = new FaceScheduler();
  return shared;
}

/** Tune the shared scheduler (budget, animated tile cap, demotion). */
export function configureFaceScheduler(options: Pick<FaceSchedulerOptions, 'budgetMs' | 'maxAnimatedTiles' | 'demoteAfterMs' | 'demoteForMs'>): void {
  faceScheduler().configure(options);
}

/** Replace the shared scheduler (tests inject clocks and fake rAF). Returns the previous one. */
export function setFaceScheduler(next: FaceScheduler | null): FaceScheduler | null {
  const prev = shared;
  shared = next;
  return prev;
}
