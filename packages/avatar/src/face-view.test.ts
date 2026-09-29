import type { FaceLandmarks, MouthSampler } from '@headcount/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FaceView, resetLandmarkCache } from './face-view';
import { configureLandmarks, DEFAULT_LANDMARKER_CONFIG } from './landmarks';
import { FaceScheduler, setFaceScheduler } from './scheduler';
import { FakeContext } from './test-utils/fake-canvas';
import { VISEMES } from './visemes';

const contexts = new WeakMap<object, FakeContext>();
const ctxOf = (host: HTMLElement) => contexts.get(host.querySelector('canvas')!)!;
let originalGetContext: PropertyDescriptor | undefined;

/** One manual loop: the only rAF in the page. */
function installScheduler() {
  let clock = 1000;
  const pending = new Map<number, (t: number) => void>();
  let id = 0;
  const scheduler = new FaceScheduler({
    now: () => clock,
    raf: (cb) => {
      pending.set(++id, cb);
      return id;
    },
    caf: (i) => pending.delete(i),
    IntersectionObserver: null,
    document: null,
  });
  setFaceScheduler(scheduler);
  return {
    scheduler,
    pending,
    frames(n = 1, dt = 16) {
      for (let i = 0; i < n; i++) {
        clock += dt;
        const entry = [...pending.entries()][0];
        if (!entry) return i;
        pending.delete(entry[0]);
        entry[1](clock);
      }
      return n;
    },
  };
}

const appearance = {
  skin_tone: 'light olive with warm undertones',
  hair: { style: 'short and neatly cut', color: 'dark brown' },
  eyewear: 'round tortoiseshell glasses with clear lenses',
  attire: 'navy blazer over a white tee',
  procedural: { avatar: 0, skinBrightness: 96 },
};

const openSampler: MouthSampler = {
  sample: () => ({ openness: 1, width: 0.2, round: 0, energy: 0.6, voiced: true, heard: true, done: false, params: { ...VISEMES.OPEN_WIDE }, shape: 'OPEN_WIDE' }),
};

let loop: ReturnType<typeof installScheduler>;

beforeEach(() => {
  originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(this: HTMLCanvasElement, kind: string) {
      if (kind !== '2d') return null;
      let c = contexts.get(this);
      if (!c) contexts.set(this, (c = new FakeContext()));
      return c;
    },
  });
  loop = installScheduler();
  resetLandmarkCache();
});

afterEach(() => {
  loop.scheduler.destroy();
  setFaceScheduler(null);
  if (originalGetContext) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext);
  else delete (HTMLCanvasElement.prototype as { getContext?: unknown }).getContext;
  vi.unstubAllGlobals();
  configureLandmarks({ ...DEFAULT_LANDMARKER_CONFIG, factory: async () => ({ detect: () => ({ faceLandmarks: [] }) }) });
});

describe('FaceView', () => {
  it('mounts an accessible canvas and tears down', () => {
    const host = document.createElement('div');
    const face = new FaceView({ tier: 'token' });
    face.mount(host);
    face.setAppearanceFallback({ appearance: {}, accent: '#1F5F6B', name: 'Esi Mensah' });
    face.setState('thinking');
    face.attachSampler({ sample: () => ({ openness: 0.5, width: 0, round: 0, energy: 0.4 }) });
    const canvas = host.querySelector('canvas');
    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.getAttribute('aria-label')).toBe('Esi Mensah, thinking');
    face.setState('working', 'Reading 14 outdoor-retail reports');
    expect(canvas?.getAttribute('aria-label')).toBe('Esi Mensah, Reading 14 outdoor-retail reports');
    face.destroy();
    expect(host.querySelector('canvas')).toBeNull();
    expect(loop.scheduler.stats().faces).toBe(0);
  });

  it('draws the illustrated fallback and lip-syncs it through the sampler', () => {
    const host = document.createElement('div');
    const face = new FaceView({ tier: 'hero', reducedMotion: false });
    face.mount(host);
    face.setAppearanceFallback({ appearance, accent: '#2A9D8F', name: 'Kobby Owusu' });
    loop.frames(1);
    const ctx = ctxOf(host);
    expect(face.stats().renderer).toBe('procedural');
    const cavity = () => ctx.ops.some((o) => o.kind === 'gradient' && o.stops!.some(([, c]) => c.startsWith('rgba(29, 11, 15')));
    expect(cavity(), 'closed mouth at rest').toBe(false);
    face.attachSampler(openSampler);
    face.setState('speaking');
    ctx.reset();
    loop.frames(8);
    expect(face.stats().talking).toBe(true);
    expect(cavity(), 'the mouth opens with the audio').toBe(true);
    face.attachSampler(null);
    loop.frames(30);
    ctx.reset();
    loop.frames(2, 40);
    expect(cavity(), 'the mouth rests once the sampler is gone').toBe(false);
    face.destroy();
  });

  it('many faces share one loop; a token draws once and shows its state in chrome', () => {
    const hosts = Array.from({ length: 6 }, () => document.createElement('div'));
    const faces = hosts.map((h, i) => {
      const f = new FaceView({ tier: i === 0 ? 'hero' : 'token' });
      f.mount(h);
      f.setAppearanceFallback({ appearance, accent: '#C9982A', name: `Coworker ${i}` });
      return f;
    });
    expect(loop.pending.size).toBe(1);
    loop.frames(1);
    const token = hosts[3]!;
    const drawn = ctxOf(token).count('clearRect');
    expect(drawn).toBe(1);
    loop.frames(10);
    expect(ctxOf(token).count('clearRect'), 'a still token is not redrawn every frame').toBe(1);
    expect(ctxOf(hosts[0]!).count('clearRect')).toBeGreaterThan(3);

    faces[3]!.setState('thinking');
    const root = token.querySelector('.hc-face') as HTMLElement;
    expect(root.dataset.state).toBe('thinking');
    expect(root.dataset.badge).toBe('thinking');
    faces[3]!.setState('raised_hand', 'Waiting on you: approve 2 emails');
    expect(root.dataset.badge).toBe('hand');
    expect(token.querySelector('.hc-face__badge svg')).not.toBeNull();
    faces[0]!.setState('speaking');
    expect((hosts[0]!.querySelector('.hc-face') as HTMLElement).dataset.badge).toBe('');
    faces.forEach((f) => f.destroy());
    expect(loop.scheduler.stats().faces).toBe(0);
  });

  it('reduced motion: an idle face stops drawing, but a sampler still moves the mouth', () => {
    const host = document.createElement('div');
    const face = new FaceView({ tier: 'hero', reducedMotion: true });
    face.mount(host);
    face.setAppearanceFallback({ appearance, accent: '#2A9D8F', name: 'Kobby Owusu' });
    loop.frames(3);
    expect(loop.pending.size, 'nothing to animate → the loop sleeps').toBe(0);
    face.attachSampler(openSampler);
    expect(loop.pending.size).toBe(1);
    loop.frames(10);
    expect(face.stats().talking).toBe(true);
    expect((host.querySelector('.hc-face') as HTMLElement).dataset.still).toBe('');
    face.destroy();
  });

  it('shows a portrait, detects missing landmarks once and reports them for PUT', async () => {
    class FakeImage {
      decoding = '';
      crossOrigin: string | null = null;
      naturalWidth = 600;
      naturalHeight = 800;
      width = 600;
      height = 800;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';
      decode() {
        return this.src.includes('broken') ? Promise.reject(new Error('bad')) : Promise.resolve();
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const mesh = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    Object.assign(mesh, { 10: { x: 0.5, y: 0.2 }, 152: { x: 0.5, y: 0.8 }, 234: { x: 0.28, y: 0.5 }, 454: { x: 0.72, y: 0.5 }, 61: { x: 0.43, y: 0.66 }, 291: { x: 0.57, y: 0.66 } });
    let detections = 0;
    configureLandmarks({
      factory: async () => ({
        detect: () => {
          detections++;
          return { faceLandmarks: [mesh] };
        },
      }),
    });
    const reported: FaceLandmarks[] = [];
    const a = new FaceView({ tier: 'hero', onLandmarks: (lm) => reported.push(lm) });
    const b = new FaceView({ tier: 'tile', onLandmarks: (lm) => reported.push(lm) });
    const hostA = document.createElement('div');
    const hostB = document.createElement('div');
    a.mount(hostA);
    b.mount(hostB);
    await Promise.all([a.setPortrait({ url: '/api/portraits/lead-warm-mentor', landmarks: null }), b.setPortrait({ url: '/api/portraits/lead-warm-mentor', landmarks: null })]);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(detections, 'one detection per portrait URL').toBe(1);
    expect(reported, 'reported once for the PUT').toHaveLength(1);
    expect(reported[0]!.lipUpperOuter).toHaveLength(11);
    loop.frames(2);
    expect(a.stats().renderer).toBe('portrait:1');
    expect(b.stats().renderer).toBe('portrait:1');

    // A portrait that fails to load leaves the illustrated face in place.
    const c = new FaceView({ tier: 'tile' });
    c.mount(document.createElement('div'));
    c.setAppearanceFallback({ appearance, accent: '#2A9D8F', name: 'Kobby Owusu' });
    await c.setPortrait({ url: '/api/portraits/broken', landmarks: null });
    expect(c.stats().renderer).toBe('procedural');
    // Stored landmarks skip detection entirely; tokens never detect.
    const d = new FaceView({ tier: 'token' });
    d.mount(document.createElement('div'));
    await d.setPortrait({ url: '/api/portraits/other', landmarks: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(detections).toBe(1);
    expect(d.stats().renderer).toBe('portrait:3');
    // Promoted to hero: the still copy is upgraded and the missing landmarks are detected then.
    d.setTier('hero');
    loop.frames(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(detections).toBe(2);
    loop.frames(1);
    expect(d.stats().renderer).toBe('portrait:1');
    [a, b, c, d].forEach((f) => f.destroy());
  });

  it('cross-fades from the illustration to the portrait unless motion is reduced', async () => {
    class FakeImage {
      naturalWidth = 300;
      naturalHeight = 400;
      width = 300;
      height = 400;
      src = '';
      decode() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const host = document.createElement('div');
    const face = new FaceView({ tier: 'hero', reducedMotion: false, detectLandmarks: false });
    face.mount(host);
    face.setAppearanceFallback({ appearance, accent: '#2A9D8F', name: 'Kobby Owusu' });
    await face.setPortrait({ url: '/p.png', landmarks: null });
    const ctx = ctxOf(host);
    ctx.reset();
    loop.frames(2);
    const alphas = ctx.ops.filter((o) => o.kind === 'drawImage').map((o) => o.style as number);
    expect(alphas.some((a) => a > 0 && a < 1), 'portrait fades in').toBe(true);
    loop.frames(30);
    ctx.reset();
    loop.frames(1, 40);
    expect(ctx.ops.filter((o) => o.kind === 'drawImage').every((o) => o.style === 1)).toBe(true);
    expect(ctx.count('bezier'), 'the illustration is no longer drawn under the portrait').toBe(0);
    face.destroy();
  });

  it('sizes the portrait working copy to the canvas, and grows it when the face grows', async () => {
    class FakeImage {
      naturalWidth = 600;
      naturalHeight = 800;
      width = 600;
      height = 800;
      src = '';
      decode() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const host = document.createElement('div');
    let size = 64;
    Object.defineProperty(host, 'clientWidth', { get: () => size });
    Object.defineProperty(host, 'clientHeight', { get: () => size });
    const face = new FaceView({ tier: 'hero', detectLandmarks: false });
    face.mount(host);
    await face.setPortrait({ url: '/small.png', landmarks: null });
    loop.frames(1);
    // A 64 px Talk face (hero tier) warps a small copy, not the hero's 1024 px one.
    expect(Math.max(face.stats().working!.width, face.stats().working!.height)).toBeLessThanOrEqual(256);
    size = 600;
    (face as unknown as { measure(): void }).measure();
    face.invalidate();
    loop.frames(1);
    expect(Math.max(face.stats().working!.width, face.stats().working!.height)).toBe(800); // the whole image, capped at 1024
    face.destroy();
  });

  it('seeds motion per person: two faces never sway in lockstep', () => {
    const phase = (f: FaceView) => (f as unknown as { motion: { swayPhase: number } }).motion.swayPhase;
    const a = new FaceView({ name: 'Paolo Bautista' });
    const b = new FaceView({ name: 'Sunny Baek' });
    expect(phase(a)).not.toBe(phase(b));
    const late = new FaceView();
    late.setAppearanceFallback({ appearance, accent: '#2A9D8F', name: 'Sunny Baek' });
    expect(phase(late)).toBe(phase(b));
    [a, b, late].forEach((f) => f.destroy());
  });
});
