// FaceView: one visible face. Photoreal portrait (PG strip warp when landmarks exist, still
// otherwise) or the illustrated fallback from catalog appearance; both lip-sync through the same
// MouthSampler and show the same state cues. Rendering is driven by the shared scheduler — no
// per-instance loops. Ported in spirit from personagram-ai/src/web/avatar/avatar-view.ts (revision-
// guarded loads, detect-once-when-missing, driver attached before the image is applied).
import { PRESENCE_PRIORITY, type FaceLandmarks, type FaceTier, type MouthSampler, type PresenceState } from '@headcount/protocol';
import { createChrome, updateChrome, type FaceChrome } from './chrome';
import { hash32 } from './color';
import { detectLandmarks, LandmarkerUnavailableError } from './landmarks';
import { lookFromAppearance, placeholderLook } from './look';
import { FaceMotion, gestureDurationMs, sanitizeCue } from './motion';
import { PortraitRenderer, type ViewTransform } from './portrait-renderer';
import { DESIGN_H, DESIGN_W, PROCEDURAL_FOCUS_Y, ProceduralRenderer } from './procedural-renderer';
import { faceScheduler, type FaceHandle, type ScheduledFace } from './scheduler';
import type { AppearanceFallback, ExpressionBias, FaceCue, FaceGesture, FaceViewApi, FaceViewOptions, PortraitSource } from './types';

/** Working resolution of the portrait source per tier (ARCHITECTURE §9.4). */
export const PORTRAIT_MAX_SIDE: Readonly<Record<FaceTier, number>> = Object.freeze({ hero: 1024, tile: 384, token: 256 });
/** Cap on the display canvas' backing store per tier (device pixels). */
const BACKING_MAX: Readonly<Record<FaceTier, number>> = Object.freeze({ hero: 1440, tile: 640, token: 320 });
/**
 * The warped working copy never needs more than about twice the canvas it is drawn into: a 64 px Talk face
 * (128 device px) warps a 256 px copy, not the hero's 1024 (≈4× fewer strip draws per frame, and each strip
 * stays wider than a device pixel). It is rebuilt larger when the face grows or is promoted.
 */
const WORKING_PER_BACKING = 2;
const WORKING_MIN = 192;
const FADE_MS = 300;
/** Where the face centre lands vertically when the frame is cropped (cover fit). */
const FACE_TARGET_Y = 0.47;
/** A tile playing a reflex gesture outranks idle tiles for an animated slot (a talking face still wins). */
const CUE_PRIORITY = 15;
/** Order of the last activity (a cue or speech) across faces: breaks ties toward the most recently active tile. */
let activitySeq = 0;

const STATE_WORDS: Readonly<Record<PresenceState, string>> = Object.freeze({
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  working: 'working',
  raised_hand: 'raised hand',
});

// ── environment (shared by all faces) ─────────────────────────────────────────

const views = new Set<FaceView>();
let envReady = false;
let reducedQuery: MediaQueryList | null = null;
let darkQuery: MediaQueryList | null = null;

function setupEnv(doc: Document) {
  if (envReady) return;
  envReady = true;
  const mm = typeof matchMedia === 'function' ? matchMedia : null;
  reducedQuery = mm ? mm('(prefers-reduced-motion: reduce)') : null;
  darkQuery = mm ? mm('(prefers-color-scheme: dark)') : null;
  reducedQuery?.addEventListener?.('change', () => views.forEach((v) => v.refreshEnvironment()));
  darkQuery?.addEventListener?.('change', () => faceScheduler().markAllDirty());
  if (typeof MutationObserver === 'function' && doc.documentElement) {
    new MutationObserver(() => faceScheduler().markAllDirty()).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  }
}

function osReducedMotion(): boolean {
  return !!reducedQuery?.matches;
}

function isDark(doc: Document | undefined): boolean {
  const theme = doc?.documentElement?.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return !!darkQuery?.matches;
}

// ── landmark detection: once per portrait URL, one at a time ──────────────────

const detections = new Map<string, Promise<FaceLandmarks | null>>();
const reportedUrls = new Set<string>();
let detectChain: Promise<unknown> = Promise.resolve();
let detectBlockedUntil = 0;
let warned = false;

function detectOnce(url: string, img: HTMLImageElement): Promise<FaceLandmarks | null> {
  const cached = detections.get(url);
  if (cached) return cached;
  if (Date.now() < detectBlockedUntil) return Promise.resolve(null);
  const p = detectChain.then(() => detectLandmarks(img));
  detectChain = p.catch(() => null);
  detections.set(url, p);
  p.catch((err: unknown) => {
    detections.delete(url);
    if (err instanceof LandmarkerUnavailableError) detectBlockedUntil = Date.now() + 60_000;
    if (!warned) {
      warned = true;
      console.warn(`[avatar] ${err instanceof Error ? err.message : 'Face mapping failed.'}`);
    }
  });
  return p;
}

/** Forget cached detections (tests). */
export function resetLandmarkCache(): void {
  detections.clear();
  reportedUrls.clear();
  detectBlockedUntil = 0;
  warned = false;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  try {
    const loc = typeof location !== 'undefined' ? location : null;
    if (loc && /^https?:/i.test(url) && new URL(url, loc.href).origin !== loc.origin) img.crossOrigin = 'anonymous';
  } catch {
    /* relative/blob URLs: same origin */
  }
  if (typeof img.decode !== 'function') {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Portrait failed to load'));
      img.src = url;
    });
  }
  img.src = url;
  return img.decode().then(
    () => img,
    () => {
      // decode() rejects on a broken image; an image that did load is still usable.
      if (img.complete && img.naturalWidth > 0) return img;
      throw new Error('Portrait failed to load');
    },
  );
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

interface LoadedPortrait {
  url: string;
  img: HTMLImageElement;
  landmarks: FaceLandmarks | null;
  renderer: PortraitRenderer | null;
  maxSide: number;
  shownAt: number | null;
}

export class FaceView implements FaceViewApi, ScheduledFace {
  private host: HTMLElement | null = null;
  private chrome: FaceChrome | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private handle: FaceHandle | null = null;
  private ro: ResizeObserver | null = null;
  private cssW = 0;
  private cssH = 0;
  private requestedTier: FaceTier;
  private renderedTier: FaceTier | null = null;
  private state: PresenceState = 'idle';
  private presenceLabel: string | undefined;
  private name: string;
  private readonly motion: FaceMotion;
  private sampler: MouthSampler | null = null;
  private portrait: LoadedPortrait | null = null;
  private portraitRev = 0;
  private fallback: ProceduralRenderer | null = null;
  private placeholder: ProceduralRenderer | null = null;
  private dirty = true;
  private lastFrameAt = -1e12;
  private destroyed = false;
  private rmOverride: boolean | undefined;
  private frames = 0;
  /** The gesture now playing (null when none), for data-face-cue and the scheduler's priority. */
  private cueGesture: FaceGesture | null = null;
  private cueTimer: ReturnType<typeof setTimeout> | null = null;
  /** A still face (token, reduced motion) redraws when a held expression comes due or an override ends. */
  private staticTimer: ReturnType<typeof setTimeout> | null = null;
  private activeSeq = 0;

  constructor(private readonly opts: FaceViewOptions = {}) {
    this.requestedTier = opts.tier ?? 'tile';
    this.name = opts.name ?? 'Coworker';
    this.rmOverride = opts.reducedMotion;
    this.motion = new FaceMotion({ seed: hash32(this.name), reducedMotion: !!opts.reducedMotion });
  }

  /** ScheduledFace: the tier the caller asked for. */
  get tier(): FaceTier {
    return this.requestedTier;
  }

  // ── public API ───────────────────────────────────────────────────────────

  mount(el: HTMLElement): void {
    if (this.destroyed || this.host === el) return;
    const doc = el.ownerDocument;
    setupEnv(doc);
    if (!this.canvas) {
      const canvas = doc.createElement('canvas');
      canvas.setAttribute('role', 'img');
      this.canvas = canvas;
      this.chrome = createChrome(doc, canvas);
      let ctx: CanvasRenderingContext2D | null = null;
      try {
        ctx = (canvas.getContext?.('2d') as CanvasRenderingContext2D | null) ?? null;
      } catch {
        ctx = null;
      }
      this.ctx = ctx;
    }
    this.chrome!.root.remove();
    el.appendChild(this.chrome!.root);
    if (this.host && this.host !== el) this.clearHostAttrs(this.host);
    this.host = el;
    el.dataset.faceExpression = this.motion.expression;
    this.syncCueAttr();
    views.add(this);
    this.motion.reducedMotion = this.reducedMotion;
    this.measure();
    this.ro?.disconnect();
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => {
        this.measure();
        this.invalidate();
        this.handle?.wake();
      });
      this.ro.observe(el);
    }
    if (!this.handle) this.handle = faceScheduler().add(this, this.chrome!.root);
    else this.handle.observe(this.chrome!.root);
    this.updateLabel();
    this.updateChrome();
    this.invalidate();
    this.handle.wake();
  }

  async setPortrait(portrait: PortraitSource | null): Promise<void> {
    if (this.destroyed) return;
    const rev = ++this.portraitRev;
    if (!portrait) {
      this.disposePortrait();
      this.invalidate();
      this.handle?.wake();
      return;
    }
    if (this.portrait && this.portrait.url === portrait.url) {
      // Same image: adopt newly stored landmarks without reloading, or detect if still missing.
      if (portrait.landmarks && portrait.landmarks !== this.portrait.landmarks) {
        this.portrait.landmarks = portrait.landmarks;
        this.buildPortraitRenderer();
        this.invalidate();
        this.handle?.wake();
      } else if (!this.portrait.landmarks) this.maybeDetect(rev);
      return;
    }
    let img: HTMLImageElement;
    try {
      img = await loadImage(portrait.url);
    } catch {
      if (rev === this.portraitRev) {
        this.disposePortrait(); // the fallback face stays
        this.invalidate();
        this.handle?.wake();
      }
      return;
    }
    if (rev !== this.portraitRev || this.destroyed) return;
    this.disposePortrait();
    this.portrait = { url: portrait.url, img, landmarks: portrait.landmarks, renderer: null, maxSide: 0, shownAt: null };
    this.buildPortraitRenderer();
    this.invalidate();
    this.handle?.wake();
    if (!portrait.landmarks) this.maybeDetect(rev);
  }

  setAppearanceFallback(fallback: AppearanceFallback): void {
    if (this.destroyed) return;
    this.fallback = new ProceduralRenderer(lookFromAppearance(fallback));
    if (fallback.name && fallback.name !== this.name) {
      this.name = fallback.name;
      // Motion is seeded per person: two faces on screen never sway or blink in lockstep.
      this.motion.reseed(hash32(this.name));
    }
    this.updateLabel();
    this.invalidate();
    this.handle?.wake();
  }

  setState(state: PresenceState, label?: string): void {
    if (this.destroyed) return;
    this.state = state;
    this.presenceLabel = label || undefined;
    this.motion.state = state;
    this.updateLabel();
    this.updateChrome();
    this.handle?.wake();
  }

  attachSampler(sampler: MouthSampler | null): void {
    if (this.destroyed) return;
    this.sampler = sampler;
    this.motion.sampler = sampler;
    this.handle?.wake();
  }

  setTier(tier: FaceTier): void {
    if (this.destroyed || tier === this.requestedTier) return;
    this.requestedTier = tier;
    this.syncCueAttr();
    this.updateChrome();
    this.invalidate();
    this.handle?.wake();
    if (tier !== 'token' && this.portrait && !this.portrait.landmarks) this.maybeDetect(this.portraitRev);
  }

  /**
   * A reflex gesture (+ optional palette expression) for cue.holdMs; the latest cue wins (INC05-PLAN §3.7).
   * Hero and tile animate it; a token and reduced motion show only the expression, as one still redraw.
   */
  cue(cue: FaceCue): void {
    if (this.destroyed) return;
    const c = sanitizeCue(cue);
    if (!c) return;
    this.motion.cue(c);
    const ms = gestureDurationMs(c);
    if (this.cueTimer) clearTimeout(this.cueTimer);
    this.cueTimer = null;
    this.cueGesture = ms > 0 ? c.gesture : null;
    if (this.cueGesture) {
      this.activeSeq = ++activitySeq;
      this.cueTimer = setTimeout(() => {
        this.cueTimer = null;
        this.cueGesture = null;
        this.syncCueAttr();
      }, ms);
    }
    this.syncCueAttr();
    this.invalidate();
    this.handle?.wake();
  }

  /** The mood palette (mood.changed → expressionBias()); null → neutral. Eases over 300 ms. */
  setExpressionBias(bias: ExpressionBias | null): void {
    if (this.destroyed) return;
    this.motion.setBias(bias);
    this.invalidate();
    this.handle?.wake();
  }

  /** Override reduced motion (null → follow the OS). Lip sync always stays on. */
  setReducedMotion(value: boolean | null): void {
    this.rmOverride = value ?? undefined;
    this.refreshEnvironment();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.portraitRev++;
    if (this.cueTimer) clearTimeout(this.cueTimer);
    if (this.staticTimer) clearTimeout(this.staticTimer);
    this.cueTimer = this.staticTimer = null;
    this.cueGesture = null;
    if (this.host) this.clearHostAttrs(this.host);
    this.handle?.remove();
    this.handle = null;
    this.ro?.disconnect();
    this.ro = null;
    this.chrome?.root.remove();
    this.disposePortrait();
    views.delete(this);
    this.sampler = null;
    this.motion.sampler = null;
    this.canvas = null;
    this.ctx = null;
    this.chrome = null;
    this.host = null;
  }

  /** Diagnostics for harnesses and QA. */
  stats() {
    return {
      tier: this.requestedTier,
      effectiveTier: this.handle?.effectiveTier() ?? this.requestedTier,
      state: this.state,
      renderer: this.portrait?.renderer ? `portrait:${this.portrait.renderer.tier}` : this.fallback ? 'procedural' : 'placeholder',
      landmarks: !!this.portrait?.landmarks,
      talking: this.motion.isTalking,
      reducedMotion: this.reducedMotion,
      frames: this.frames,
      /** The palette expression shown, and the gesture now playing (INC05-PLAN §3.7). */
      expression: this.motion.expression,
      cue: this.cueGesture,
      canvas: this.canvas ? { width: this.canvas.width, height: this.canvas.height } : null,
      /** The portrait working copy the strip warp draws from (device pixels). */
      working: this.portrait?.renderer ? { width: this.portrait.renderer.w, height: this.portrait.renderer.h } : null,
      lastSample: this.motion.lastSample,
    };
  }

  // ── ScheduledFace ────────────────────────────────────────────────────────

  priority(): number {
    const rank = PRESENCE_PRIORITY.indexOf(this.state);
    // A cued tile takes an animated slot for its gesture; among equals the least recently active tile gives it up.
    const recency = activitySeq > 0 ? (this.activeSeq / (activitySeq + 1)) * 0.5 : 0;
    return (
      (this.requestedTier === 'hero' ? 100 : 0) +
      (this.motion.isTalking ? 20 : 0) +
      (this.cueGesture ? CUE_PRIORITY : 0) +
      (PRESENCE_PRIORITY.length - (rank < 0 ? PRESENCE_PRIORITY.length : rank)) +
      recency
    );
  }

  invalidate(): void {
    this.dirty = true;
  }

  wantsFrame(now: number, tier: FaceTier): boolean {
    if (this.destroyed || !this.ctx) return false;
    if (this.dirty) return true;
    const interval = this.interval(tier, now);
    return interval < Infinity && now - this.lastFrameAt >= interval - 1;
  }

  isLive(tier: FaceTier): boolean {
    if (this.destroyed || !this.ctx) return false;
    return this.dirty || this.interval(tier, null) < Infinity;
  }

  frame(now: number, tier: FaceTier): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas || this.destroyed) return;
    if (tier !== this.renderedTier) {
      this.renderedTier = tier;
      this.updateChrome();
    }
    this.ensureBacking(tier);
    // Upgrade the working copy when promoted or when the face grew; never churn it when a tile briefly drops to a
    // token or the face shrinks.
    if (this.portrait && tier !== 'token' && this.portrait.maxSide < this.workingSide(tier)) this.buildPortraitRenderer();
    const still = tier === 'token';
    // Tokens ignore gestures and show the palette as one still redraw.
    const pose = still ? this.motion.staticPose(now) : this.motion.update(now);
    if (this.motion.isTalking && !still) this.activeSeq = ++activitySeq;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pr = this.portrait?.renderer ?? null;
    let alpha = 0;
    if (pr && this.portrait) {
      if (this.portrait.shownAt === null) this.portrait.shownAt = now;
      alpha = still || this.reducedMotion ? 1 : clamp01((now - this.portrait.shownAt) / FADE_MS);
    }
    if (!pr || alpha < 1) {
      const proc = this.fallback ?? this.placeholderRenderer();
      proc.render(ctx, pose, this.cover(DESIGN_W, DESIGN_H, 0.5, PROCEDURAL_FOCUS_Y, tier), { dark: isDark(this.host?.ownerDocument) });
    }
    if (pr) {
      const lm = this.portrait!.landmarks;
      ctx.globalAlpha = alpha;
      pr.render(ctx, pose, this.cover(pr.w, pr.h, lm?.face.centerX ?? 0.5, lm?.face.centerY ?? 0.42, tier));
      ctx.globalAlpha = 1;
    }
    this.dirty = false;
    this.lastFrameAt = now;
    this.frames++;
    const host = this.host;
    if (host && host.dataset.faceExpression !== this.motion.expression) host.dataset.faceExpression = this.motion.expression;
    this.scheduleStaticWake(now, still || this.reducedMotion);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Re-read OS reduced motion (called by the shared media-query listener). */
  refreshEnvironment(): void {
    const rm = this.reducedMotion;
    if (this.motion.reducedMotion !== rm) {
      this.motion.reducedMotion = rm;
      this.syncCueAttr();
      this.updateChrome();
      this.invalidate();
      this.handle?.wake();
    }
  }

  private get reducedMotion(): boolean {
    return this.rmOverride ?? osReducedMotion();
  }

  private interval(tier: FaceTier, now: number | null): number {
    if (tier === 'token') return Infinity;
    const fast = tier === 'hero' ? 16 : 33;
    const slow = tier === 'hero' ? 33 : 66;
    const fading = !!this.portrait?.renderer && (this.portrait.shownAt === null || (now !== null && now - this.portrait.shownAt < FADE_MS));
    if (this.motion.isTalking || this.motion.settling || (fading && !this.reducedMotion)) return fast;
    if (this.reducedMotion) return this.sampler ? slow : Infinity; // poll the sampler so speech starts promptly
    return slow;
  }

  /** data-face-cue on the mount element while a gesture plays (not on tokens, not under reduced motion). */
  private syncCueAttr(): void {
    const host = this.host;
    if (!host) return;
    const show = this.cueGesture !== null && this.requestedTier !== 'token' && !this.reducedMotion;
    if (show) host.dataset.faceCue = this.cueGesture!;
    else delete host.dataset.faceCue;
  }

  private clearHostAttrs(host: HTMLElement): void {
    delete host.dataset.faceCue;
    delete host.dataset.faceExpression;
  }

  /** A face that only redraws on demand gets one timed redraw when its palette changes next. */
  private scheduleStaticWake(now: number, isStatic: boolean): void {
    if (this.staticTimer) clearTimeout(this.staticTimer);
    this.staticTimer = null;
    if (!isStatic) return;
    const at = this.motion.wakeAt();
    if (at === null) return;
    this.staticTimer = setTimeout(
      () => {
        this.staticTimer = null;
        if (this.destroyed) return;
        this.invalidate();
        this.handle?.wake();
      },
      Math.max(0, at - now) + 16,
    );
  }

  private placeholderRenderer(): ProceduralRenderer {
    if (!this.placeholder) this.placeholder = new ProceduralRenderer(placeholderLook(this.name));
    return this.placeholder;
  }

  private buildPortraitRenderer() {
    const p = this.portrait;
    if (!p) return;
    const tier = this.renderedTier ?? this.requestedTier;
    const still = tier === 'token';
    p.renderer?.destroy();
    // A still token keeps no working copy (maxSide 0 marks "upgrade on promotion").
    const side = this.workingSide(tier);
    p.maxSide = still ? 0 : side;
    try {
      p.renderer = new PortraitRenderer(p.img, p.landmarks, { maxSide: still ? PORTRAIT_MAX_SIDE[tier] : side, still, asym: 0.94 + ((hash32(p.url) % 1000) / 1000) * 0.12 });
    } catch {
      p.renderer = null;
    }
  }

  private disposePortrait() {
    this.portrait?.renderer?.destroy();
    this.portrait = null;
  }

  private maybeDetect(rev: number) {
    const p = this.portrait;
    if (!p || p.landmarks || this.opts.detectLandmarks === false) return;
    if (this.requestedTier === 'token') return; // stills never warp; detect when promoted
    const url = p.url;
    detectOnce(url, p.img).then(
      (lm) => {
        if (!lm || this.destroyed || rev !== this.portraitRev || this.portrait?.url !== url) return;
        this.portrait.landmarks = lm;
        this.buildPortraitRenderer();
        this.invalidate();
        this.handle?.wake();
        if (!reportedUrls.has(url)) {
          reportedUrls.add(url);
          try {
            this.opts.onLandmarks?.(lm);
          } catch {
            /* the caller's PUT failing must not break the face */
          }
        }
      },
      () => undefined,
    );
  }

  private measure() {
    const host = this.host;
    this.cssW = Math.max(1, host?.clientWidth || 96);
    this.cssH = Math.max(1, host?.clientHeight || 128);
  }

  /** The canvas backing store for this tier (device pixels, capped by BACKING_MAX). */
  private backingSize(tier: FaceTier): { bw: number; bh: number } {
    const dpr = Math.max(1, Math.min(3, (globalThis as { devicePixelRatio?: number }).devicePixelRatio || 1));
    let bw = this.cssW * dpr;
    let bh = this.cssH * dpr;
    const s = Math.min(1, BACKING_MAX[tier] / Math.max(bw, bh));
    bw = Math.max(1, Math.round(bw * s));
    bh = Math.max(1, Math.round(bh * s));
    return { bw, bh };
  }

  /** Longest side of the portrait working copy: sized to the display, capped per tier. */
  private workingSide(tier: FaceTier): number {
    const { bw, bh } = this.backingSize(tier);
    return Math.min(PORTRAIT_MAX_SIDE[tier], Math.max(WORKING_MIN, Math.ceil(Math.max(bw, bh) * WORKING_PER_BACKING)));
  }

  private ensureBacking(tier: FaceTier) {
    const canvas = this.canvas!;
    const { bw, bh } = this.backingSize(tier);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
  }

  /**
   * Cover fit of a w×h frame into the canvas, cropping around the face centre. Tokens in square
   * or round hosts crop tighter so a 40 px face is still a face, not a bust.
   */
  private cover(w: number, h: number, focusX: number, focusY: number, tier: FaceTier): ViewTransform {
    const cw = this.canvas!.width;
    const ch = this.canvas!.height;
    const squareish = cw / ch > 0.9;
    const zoom = squareish ? (tier === 'token' ? 1.28 : tier === 'tile' ? 1.1 : 1) : 1;
    const scale = Math.max(cw / w, ch / h) * zoom;
    const sw = w * scale;
    const sh = h * scale;
    let x = (cw - sw) / 2;
    let y = (ch - sh) / 2;
    if (sh > ch + 0.5) y = Math.max(ch - sh, Math.min(0, ch * FACE_TARGET_Y - focusY * sh));
    if (sw > cw + 0.5) x = Math.max(cw - sw, Math.min(0, cw * 0.5 - focusX * sw));
    return { scale, x, y };
  }

  private updateLabel() {
    if (!this.canvas) return;
    this.canvas.setAttribute('aria-label', this.opts.label ?? `${this.name}, ${this.presenceLabel ?? STATE_WORDS[this.state] ?? this.state}`);
  }

  private updateChrome() {
    if (!this.chrome) return;
    const tier = this.renderedTier ?? this.requestedTier;
    updateChrome(this.chrome, this.state, tier, this.reducedMotion, this.opts.chrome !== false);
    if (this.opts.chrome === false) {
      this.chrome.root.dataset.badge = '';
    }
  }
}
