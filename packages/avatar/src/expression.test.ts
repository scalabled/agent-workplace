// Reflex gestures and the mood palette: the FaceMotion cue layer and bias, FaceView's cue(),
// setExpressionBias(), data attributes, tiers, reduced motion and scheduler slots, and what the renderers draw.
import type { MouthSampler } from '@headcount/protocol';
import type { ExpressionBias, FaceGesture } from '@headcount/protocol/ext/expressions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FaceView } from './face-view';
import { EXPRESSION_HOLD_MS, FaceMotion, LOOK_UP_BROW, SMILE_CORNER_PULL, SMILE_SQUINT, STILL_POSE, gestureDurationMs, type FacePose } from './motion';
import { lookFromAppearance } from './look';
import { PortraitRenderer } from './portrait-renderer';
import { ProceduralRenderer } from './procedural-renderer';
import { FaceScheduler, setFaceScheduler } from './scheduler';
import { asCtx, FakeCanvas, FakeContext } from './test-utils/fake-canvas';
import { VISEMES } from './visemes';

const talkingSampler: MouthSampler = {
  sample: () => ({ openness: 1, width: 0.3, round: 0, energy: 0.6, voiced: true, heard: true, done: false, params: { ...VISEMES.OPEN_WIDE }, shape: 'OPEN_WIDE' }),
};

const FIELDS = ['pitch', 'yaw', 'lean', 'brow', 'swayRot', 'swayX', 'breath', 'blink', 'lookX'] as const;
type Field = (typeof FIELDS)[number] | 'cornerPull';
const value = (p: FacePose, f: Field) => (f === 'cornerPull' ? p.mouth.cornerPull : p[f]);

/**
 * Runs a cued face beside an identical uncued twin and records the difference per field, frame by frame.
 * The cue is given at 1000 ms (after both settled) and stamped on the next frame.
 */
function againstTwin(gesture: FaceGesture, opts: { holdMs?: number; state?: 'idle' | 'thinking'; sampler?: MouthSampler; seed?: number } = {}) {
  const cued = new FaceMotion({ seed: opts.seed ?? 7 });
  const twin = new FaceMotion({ seed: opts.seed ?? 7 });
  for (const m of [cued, twin]) {
    m.state = opts.state ?? 'idle';
    m.sampler = opts.sampler ?? null;
  }
  for (let t = 0; t <= 1000; t += 16) {
    cued.update(t);
    twin.update(t);
  }
  const holdMs = opts.holdMs ?? 500;
  cued.cue({ gesture, holdMs });
  const start = 1016;
  const frames: { e: number; d: Record<Field, number>; cued: FacePose; twin: FacePose }[] = [];
  const end = start + gestureDurationMs({ gesture, holdMs }) + 240;
  for (let t = start; t <= end; t += 16) {
    const a = cued.update(t);
    const b = twin.update(t);
    const d = {} as Record<Field, number>;
    for (const f of [...FIELDS, 'cornerPull'] as Field[]) d[f] = value(a, f) - value(b, f);
    frames.push({ e: t - start, d, cued: a, twin: b });
  }
  const peak = (f: Field) => frames.reduce((m, fr) => (Math.abs(fr.d[f]) > Math.abs(m) ? fr.d[f] : m), 0);
  const last = frames.at(-1)!;
  return { cued, twin, frames, peak, last };
}

function expectBackToRest(last: { d: Record<Field, number> }) {
  for (const [f, v] of Object.entries(last.d)) expect(Math.abs(v), `${f} returns to the twin`).toBeLessThan(1e-9);
}

const bias = (b: Partial<ExpressionBias> = {}): ExpressionBias => ({ expression: 'resting', weight: 0, cornerPull: 0, brow: 0, pitchDeg: 0, blinkScale: 1, swayScale: 1, ...b });
const delighted = bias({ expression: 'delighted', weight: 0.35, cornerPull: 0.3, brow: 0.02, pitchDeg: 1.2, blinkScale: 0.9, swayScale: 1.2 });
const concerned = bias({ expression: 'concerned', weight: 0.3, cornerPull: -0.1, brow: 0.12, pitchDeg: -1.1, blinkScale: 1.2, swayScale: 0.9 });

describe('FaceMotion gestures (§3.7 table)', () => {
  it('nod dips the head 0.22 and comes back in 380 ms', () => {
    const r = againstTwin('nod');
    expect(r.peak('pitch')).toBeLessThan(-0.21);
    expect(r.peak('pitch')).toBeGreaterThanOrEqual(-0.2201);
    expect(r.frames.filter((f) => Math.abs(f.d.pitch) > 1e-9).at(-1)!.e).toBeLessThan(380);
    expectBackToRest(r.last);
  });

  it('double_nod dips twice by 0.18', () => {
    const r = againstTwin('double_nod');
    const pitch = r.frames.map((f) => f.d.pitch);
    const minima = pitch.filter((p, i) => i > 0 && i < pitch.length - 1 && p < pitch[i - 1]! && p <= pitch[i + 1]! && p < -0.1);
    expect(minima).toHaveLength(2);
    expect(Math.min(...pitch)).toBeLessThan(-0.17);
    expectBackToRest(r.last);
  });

  it('look_up lifts and leans toward the viewer, turns the head to them and raises the brows while it holds', () => {
    const r = againstTwin('look_up', { state: 'thinking', holdMs: 600 });
    expect(r.peak('pitch')).toBeGreaterThan(0.24);
    expect(r.peak('lean')).toBeGreaterThan(0.39);
    const held = r.frames.find((f) => f.e >= 400)!;
    expect(Math.abs(held.cued.yaw)).toBeLessThan(0.01); // thinking looks away; the look-up faces the viewer
    expect(held.twin.yaw).toBeGreaterThan(0.3);
    expect(Math.abs(held.cued.lookX)).toBeLessThan(0.01);
    expect(r.frames.filter((f) => f.e < 150).some((f) => f.d.brow > 0.4)).toBe(true);
    expect(r.frames.find((f) => f.e >= 200)!.d.brow).toBeCloseTo(LOOK_UP_BROW, 6); // held, readable on a 48 px tile
    expect(gestureDurationMs({ gesture: 'look_up', holdMs: 600 })).toBe(150 + 600 + 300);
    expectBackToRest(r.last);
  });

  it('brow_flash, head_tilt, smile, exhale and glance each move their parameter and return', () => {
    const flash = againstTwin('brow_flash');
    expect(flash.peak('brow')).toBeGreaterThan(0.65);
    expectBackToRest(flash.last);
    const tilt = againstTwin('head_tilt', { holdMs: 400 });
    expect(tilt.peak('swayRot')).toBeCloseTo(0.05, 3);
    expectBackToRest(tilt.last);
    const smile = againstTwin('smile', { holdMs: 400 });
    expect(smile.peak('cornerPull')).toBeCloseTo(SMILE_CORNER_PULL, 3);
    expect(SMILE_CORNER_PULL).toBeGreaterThanOrEqual(0.6); // visible on a 64 px face
    expect(smile.frames.some((f) => f.cued.blink >= SMILE_SQUINT - 0.01)).toBe(true); // the eyes narrow a little
    expectBackToRest(smile.last);
    const exhale = againstTwin('exhale');
    expect(exhale.peak('pitch')).toBeLessThan(-0.11);
    expect(exhale.frames.some((f) => f.cued.breath < -0.9)).toBe(true);
    expectBackToRest(exhale.last);
    const glance = againstTwin('glance');
    expect(Math.abs(glance.peak('yaw'))).toBeGreaterThan(0.29);
    expect(glance.frames.filter((f) => Math.abs(f.d.yaw) > 1e-9).at(-1)!.e).toBeLessThan(800);
    expectBackToRest(glance.last);
  });

  it('glance goes to a seeded side: the same face always turns the same way', () => {
    const side = (seed: number) => Math.sign(againstTwin('glance', { seed }).peak('yaw'));
    expect(side(3)).toBe(side(3));
    const sides = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(side));
    expect(sides.size).toBe(2);
  });

  it('wince tightens the brow, drops the corners and half-blinks', () => {
    const r = againstTwin('wince', { holdMs: 300 });
    expect(r.peak('brow')).toBeGreaterThan(0.29);
    expect(r.peak('cornerPull')).toBeCloseTo(-0.15, 3);
    expect(r.frames.filter((f) => f.e < 180).some((f) => f.cued.blink > 0.33)).toBe(true);
    expectBackToRest(r.last);
  });

  it('still freezes sway, breath and blink for holdMs, then the face carries on in step', () => {
    const r = againstTwin('still', { holdMs: 600 });
    const during = r.frames.filter((f) => f.e > 0 && f.e < 600);
    const xs = new Set(during.map((f) => f.cued.swayX));
    expect(xs.size).toBe(1);
    expect(during.every((f) => f.cued.blink === 0)).toBe(true);
    expect(new Set(during.map((f) => f.twin.swayX)).size).toBeGreaterThan(5);
    expectBackToRest(r.last);
  });

  it('head gestures play at half amplitude while the face speaks', () => {
    const quiet = againstTwin('nod');
    const speaking = againstTwin('nod', { sampler: talkingSampler });
    expect(speaking.peak('pitch') / quiet.peak('pitch')).toBeCloseTo(0.5, 2);
    const smile = againstTwin('smile', { sampler: talkingSampler, holdMs: 400 });
    expect(smile.peak('cornerPull')).toBeCloseTo(SMILE_CORNER_PULL * 0.4, 3); // corner pull ×0.4 while speaking
  });

  it('the latest cue wins', () => {
    const m = new FaceMotion({ seed: 4 });
    const twin = new FaceMotion({ seed: 4 });
    for (let t = 0; t <= 1000; t += 16) {
      m.update(t);
      twin.update(t);
    }
    m.cue({ gesture: 'nod', holdMs: 0 });
    for (let t = 1016; t <= 1100; t += 16) {
      m.update(t);
      twin.update(t);
    }
    m.cue({ gesture: 'glance', holdMs: 0 }); // stamped on the next frame (1112)
    let a!: FacePose;
    let b!: FacePose;
    for (let t = 1112; t <= 1400; t += 16) {
      a = m.update(t);
      b = twin.update(t);
    }
    expect(a.pitch - b.pitch).toBeCloseTo(0, 9); // the nod was replaced
    expect(Math.abs(a.yaw - b.yaw)).toBeGreaterThan(0.1);
    expect(m.gestureActive(1400)).toBe(true);
    expect(m.gestureActive(1112 + 800)).toBe(false);
  });

  it('reduced motion omits gestures but shows a cue’s expression at once', () => {
    const m = new FaceMotion({ seed: 5, reducedMotion: true });
    m.update(0);
    m.cue({ gesture: 'look_up', expression: 'concerned', weight: 0.8, holdMs: 800 });
    const p = m.update(16);
    expect(p.pitch).toBeCloseTo((-2 * 0.8) / 12, 6); // the palette's pitch only: no look-up
    expect(p.lean).toBe(0);
    expect(p.brow).toBeCloseTo(0.4 * 0.8, 6);
    expect(p.browInner).toBeCloseTo(0.4 * 0.8, 6);
    expect(m.expression).toBe('concerned');
    expect(m.gestureActive(16)).toBe(false);
    expect(m.settling).toBe(false); // no frames needed: one still redraw
    expect(m.wakeAt()).toBe(16 + 800);
    const after = m.update(820);
    expect(after.brow).toBe(0);
    expect(m.expression).toBe('resting');
  });

  it('ignores unknown gestures and empty cues', () => {
    const m = new FaceMotion({ seed: 1 });
    m.update(0);
    m.cue({ gesture: 'moonwalk' as FaceGesture, holdMs: 100 });
    m.cue({ gesture: 'none', holdMs: 100 });
    expect(m.settling).toBe(false);
    m.cue({ gesture: 'nod', holdMs: Number.NaN });
    expect(m.settling).toBe(true);
  });
});

describe('FaceMotion palette (expression bias)', () => {
  it('eases corner pull, brow and pitch over ~300 ms, and scales corners ×0.4 while speaking', () => {
    const r = new FaceMotion({ seed: 2 });
    const twin = new FaceMotion({ seed: 2 });
    for (let t = 0; t <= 400; t += 16) {
      r.update(t);
      twin.update(t);
    }
    r.setBias(delighted);
    const first = r.update(416).mouth.cornerPull - twin.update(416).mouth.cornerPull;
    expect(first).toBeGreaterThan(0.01);
    expect(first).toBeLessThan(0.3 * 0.3);
    let a!: FacePose;
    let b!: FacePose;
    for (let t = 432; t <= 720; t += 16) {
      a = r.update(t);
      b = twin.update(t);
    }
    expect(a.mouth.cornerPull - b.mouth.cornerPull).toBeGreaterThan(0.3 * 0.94);
    expect(a.pitch - b.pitch).toBeCloseTo(1.2 / 12, 2);
    expect(a.brow - b.brow).toBeCloseTo(0.02, 2);
    expect(a.browInner).toBe(0);
    expect(r.expression).toBe('delighted');
    r.sampler = talkingSampler;
    twin.sampler = talkingSampler;
    for (let t = 736; t <= 1200; t += 16) {
      a = r.update(t);
      b = twin.update(t);
    }
    expect(a.mouth.cornerPull - b.mouth.cornerPull).toBeCloseTo(0.3 * 0.4, 2);
  });

  it('holds an expression change for 1.2 s; numbers of the same expression move at once', () => {
    const m = new FaceMotion({ seed: 3 });
    m.update(0);
    m.setBias(delighted);
    m.update(16);
    expect(m.expression).toBe('delighted'); // the first change is immediate
    m.setBias({ ...delighted, cornerPull: 0.2 });
    for (let t = 32; t <= 500; t += 16) m.update(t);
    expect(m.update(516).mouth.cornerPull).toBeCloseTo(0.2, 2);
    m.setBias(concerned);
    for (let t = 532; t < 16 + EXPRESSION_HOLD_MS; t += 16) {
      m.update(t);
      expect(m.expression).toBe('delighted');
    }
    expect(m.wakeAt()).toBe(16 + EXPRESSION_HOLD_MS);
    m.update(16 + EXPRESSION_HOLD_MS);
    expect(m.expression).toBe('concerned');
    let p!: FacePose;
    for (let t = 32 + EXPRESSION_HOLD_MS; t < 600 + EXPRESSION_HOLD_MS; t += 16) p = m.update(t);
    expect(p.mouth.cornerPull).toBeCloseTo(-0.1, 2);
    expect(p.browInner).toBeCloseTo(0.4 * 0.3, 3); // concerned lifts the inner brow
    m.setBias(null);
    expect(m.wakeAt()).not.toBeNull();
  });

  it('a cue’s expression overrides the bias for holdMs, keeping the mood part, then the bias returns', () => {
    const m = new FaceMotion({ seed: 4, reducedMotion: true });
    m.setBias(delighted); // cornerPull 0.3 = 0.25·v (0.1775) + delighted 0.35 × 0.35
    m.update(0);
    m.cue({ gesture: 'none', expression: 'concerned', holdMs: 500 });
    const p = m.update(16);
    expect(m.expression).toBe('concerned');
    const mood = 0.3 - 0.35 * 0.35;
    expect(p.mouth.cornerPull).toBeCloseTo(mood - 0.15 * 0.8, 6);
    expect(p.brow).toBeCloseTo(0.02 - 0.05 * 0.35 + 0.4 * 0.8, 6);
    m.update(520);
    expect(m.expression).toBe('delighted');
    expect(m.update(536).mouth.cornerPull).toBeCloseTo(0.3, 6);
  });

  it('blinkScale stretches the blink interval and swayScale the sway', () => {
    const blinks = (scale: number) => {
      const m = new FaceMotion({ seed: 11 });
      m.setBias(bias({ blinkScale: scale }));
      let n = 0;
      let on = false;
      for (let t = 0; t < 60_000; t += 16) {
        const b = m.update(t).blink > 0;
        if (b && !on) n++;
        on = b;
      }
      return n;
    };
    expect(blinks(1.5)).toBeLessThan(blinks(1) * 0.8);
    const sway = (scale: number) => {
      const m = new FaceMotion({ seed: 11 });
      m.setBias(bias({ swayScale: scale }));
      let max = 0;
      for (let t = 0; t < 10_000; t += 16) max = Math.max(max, Math.abs(m.update(t).swayX));
      return max;
    };
    expect(sway(1.25) / sway(1)).toBeCloseTo(1.25, 1);
  });

  it('a token shows the palette as a still pose (and STILL_POSE itself when neutral)', () => {
    const m = new FaceMotion({ seed: 1 });
    expect(m.staticPose(0)).toBe(STILL_POSE);
    m.setBias(concerned);
    m.cue({ gesture: 'nod', holdMs: 0 });
    const p = m.staticPose(10);
    expect(p.pitch).toBeCloseTo(-1.1 / 12, 6); // the bias's pitch, never the nod
    expect(p.mouth.cornerPull).toBeCloseTo(-0.1, 6);
    expect(p.browInner).toBeCloseTo(0.12, 6);
    expect(p.swayX).toBe(0);
    expect(p.blink).toBe(0);
  });
});

// ── FaceView ──────────────────────────────────────────────────────────────────

const contexts = new WeakMap<object, FakeContext>();
let originalGetContext: PropertyDescriptor | undefined;

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
    get clock() {
      return clock;
    },
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
    /** Move the clock and the timers together, running frames as the loop asks. */
    async run(ms: number, dt = 16) {
      for (let t = 0; t < ms; t += dt) {
        await vi.advanceTimersByTimeAsync(dt);
        clock += dt;
        const entry = [...pending.entries()][0];
        if (entry) {
          pending.delete(entry[0]);
          entry[1](clock);
        }
      }
    },
  };
}

const appearance = {
  skin_tone: 'light olive with warm undertones',
  hair: { style: 'short and neatly cut', color: 'dark brown' },
  attire: 'navy blazer over a white tee',
  procedural: { avatar: 0, skinBrightness: 96 },
};

let loop: ReturnType<typeof installScheduler>;

function mountFace(opts: ConstructorParameters<typeof FaceView>[0] = {}, name = 'Jelena Petrović') {
  const host = document.createElement('div');
  const face = new FaceView({ tier: 'tile', reducedMotion: false, ...opts });
  face.mount(host);
  face.setAppearanceFallback({ appearance, accent: '#2A9D8F', name });
  return { host, face, ctx: () => contexts.get(host.querySelector('canvas')!)! };
}

describe('FaceView cue() and setExpressionBias()', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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
  });
  afterEach(() => {
    loop.scheduler.destroy();
    setFaceScheduler(null);
    if (originalGetContext) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext);
    vi.useRealTimers();
  });

  it('a tile plays the gesture with data-face-cue for its length, and always carries data-face-expression', async () => {
    const { host, face } = mountFace();
    expect(host.dataset.faceExpression).toBe('resting');
    expect(host.dataset.faceCue).toBeUndefined();
    loop.frames(3);
    face.cue({ gesture: 'look_up', holdMs: 900 });
    expect(host.dataset.faceCue).toBe('look_up');
    expect(face.stats().cue).toBe('look_up');
    await loop.run(1300);
    expect(host.dataset.faceCue).toBe('look_up');
    await loop.run(100);
    expect(host.dataset.faceCue).toBeUndefined(); // 150 + 900 + 300 ms
    face.setExpressionBias(delighted);
    loop.frames(2);
    expect(host.dataset.faceExpression).toBe('delighted');
    face.cue({ gesture: 'smile', expression: 'concerned', holdMs: 400 });
    loop.frames(2);
    expect(host.dataset.faceExpression).toBe('concerned');
    await loop.run(600);
    expect(host.dataset.faceExpression).toBe('delighted');
    face.destroy();
    expect(host.dataset.faceExpression).toBeUndefined();
  });

  it('a token ignores gestures and redraws once for the palette, and again when an override ends', async () => {
    const { host, face, ctx } = mountFace({ tier: 'token' });
    loop.frames(2);
    const draws = () => ctx().count('clearRect');
    const base = draws();
    loop.frames(5);
    expect(draws()).toBe(base);
    face.cue({ gesture: 'nod', holdMs: 0 });
    expect(host.dataset.faceCue).toBeUndefined();
    loop.frames(5);
    expect(draws()).toBe(base + 1); // woke, one still redraw, asleep again
    face.setExpressionBias(concerned);
    loop.frames(5);
    expect(draws()).toBe(base + 2);
    expect(host.dataset.faceExpression).toBe('concerned');
    face.cue({ gesture: 'none', expression: 'delighted', holdMs: 500 });
    loop.frames(1);
    expect(host.dataset.faceExpression).toBe('delighted');
    const mid = draws();
    await loop.run(560);
    expect(draws()).toBe(mid + 1); // the timed redraw when the override ends
    expect(host.dataset.faceExpression).toBe('concerned');
    face.destroy();
  });

  it('reduced motion: no gesture and no data-face-cue; the palette applies without easing and the loop sleeps', async () => {
    const { host, face } = mountFace({ tier: 'hero', reducedMotion: true });
    loop.frames(3);
    expect(loop.pending.size).toBe(0);
    face.cue({ gesture: 'look_up', expression: 'thinking', holdMs: 600 });
    expect(host.dataset.faceCue).toBeUndefined();
    expect(loop.pending.size).toBe(1); // the cue wakes the shared loop (no loop of its own)
    loop.frames(1);
    expect(host.dataset.faceExpression).toBe('thinking');
    loop.frames(3);
    expect(loop.pending.size).toBe(0);
    await loop.run(700);
    expect(host.dataset.faceExpression).toBe('resting');
    face.setReducedMotion(false);
    face.cue({ gesture: 'glance', holdMs: 0 });
    expect(host.dataset.faceCue).toBe('glance');
    face.setReducedMotion(true);
    expect(host.dataset.faceCue).toBeUndefined();
    face.destroy();
  });

  it('a cued tile takes an animated slot from the least recently active tile', async () => {
    const faces = ['Ada Ng', 'Ben Addo', 'Cleo Park', 'Dev Rao'].map((n) => mountFace({}, n));
    loop.frames(2);
    faces[0]!.face.cue({ gesture: 'nod', holdMs: 0 });
    await loop.run(50);
    faces[1]!.face.cue({ gesture: 'nod', holdMs: 0 });
    await loop.run(500); // both nods are over
    const tiers = () => faces.map((f) => f.face.stats().effectiveTier);
    expect(tiers()).toEqual(['tile', 'tile', 'tile', 'token']);
    faces[3]!.face.cue({ gesture: 'look_up', holdMs: 800 });
    loop.frames(1);
    expect(tiers()).toEqual(['tile', 'tile', 'token', 'tile']); // Cleo was never active
    expect(faces[3]!.host.dataset.faceCue).toBe('look_up');
    await loop.run(1400);
    expect(tiers().filter((t) => t === 'tile')).toHaveLength(3);
    expect(loop.scheduler.stats().animatedTiles).toBe(3);
    faces.forEach((f) => f.face.destroy());
  });

  it('a gesture cued before promotion still plays once the face becomes a tile', () => {
    const { host, face } = mountFace({ tier: 'token' });
    face.cue({ gesture: 'look_up', holdMs: 1200 });
    expect(host.dataset.faceCue).toBeUndefined();
    face.setTier('tile');
    expect(host.dataset.faceCue).toBe('look_up');
    loop.frames(12);
    expect(face.stats().frames).toBeGreaterThan(3);
    face.destroy();
  });
});

describe('renderers draw the palette', () => {
  const style = lookFromAppearance({ appearance, accent: '#C9982A', name: 'Amara Tesfaye' });
  const render = (extra: Partial<FacePose>) => {
    const ctx = new FakeContext();
    new ProceduralRenderer(style).render(asCtx(ctx), { ...STILL_POSE, ...extra }, { scale: 1, x: 0, y: 0 });
    return ctx.ops;
  };

  it('the illustrated face lifts the inner brow ends for a concerned look', () => {
    const plain = render({});
    const worried = render({ browInner: 1 });
    expect(worried).toHaveLength(plain.length);
    const diff = plain.map((op, i) => [op, worried[i]!] as const).filter(([a, b]) => a.args.join() !== b.args.join());
    expect(diff.map(([a]) => a.kind).sort()).toEqual(['moveTo', 'moveTo', 'quad', 'quad']);
    for (const [a, b] of diff.filter(([o]) => o.kind === 'moveTo')) {
      expect(b.args[0]).toBe(a.args[0]);
      expect(a.args[1]! - b.args[1]!).toBeCloseTo(3.4, 6); // raised (y up)
    }
  });

  it('the illustrated face lowers the mouth corners for negative corner pull', () => {
    const rest = render({});
    const frown = render({ mouth: { ...VISEMES.REST, cornerPull: -0.4 } });
    const smile = render({ mouth: { ...VISEMES.REST, cornerPull: 0.4 } });
    const cornerY = (ops: typeof rest) => {
      // The lower-lip path starts at the left corner: the first moveTo after the upper lip fill.
      const moves = ops.filter((o) => o.kind === 'moveTo');
      return moves.map((m) => m.args[1]!);
    };
    const r = cornerY(rest);
    const f = cornerY(frown);
    const s = cornerY(smile);
    const changed = r.map((y, i) => [y, f[i]!, s[i]!] as const).filter(([a, b]) => a !== b);
    expect(changed.length).toBeGreaterThan(0);
    for (const [y, down, up] of changed) {
      expect(down).toBeGreaterThan(y);
      expect(up).toBeLessThan(y);
    }
  });

  it('the portrait warps the mouth for a frown as it does for a smile', () => {
    const marks = {
      face: { x: 0.15, y: 0.08, width: 0.7, height: 0.82, centerX: 0.5, centerY: 0.49 },
      mouth: { x: 0.5, y: 0.62 },
      mouthWidth: 0.2,
      mouthHeight: 0.045,
      eyeSpan: 0.28,
      leftEye: { x: 0.36, y: 0.38 },
      rightEye: { x: 0.64, y: 0.38 },
      leftEyeWidth: 0.1,
      rightEyeWidth: 0.1,
    };
    const img = { width: 600, height: 800, naturalWidth: 600, naturalHeight: 800 } as unknown as HTMLImageElement;
    const r = new PortraitRenderer(img, marks, { asym: 1, createCanvas: () => new FakeCanvas() as unknown as HTMLCanvasElement });
    const strips = (cornerPull: number) => {
      const ctx = new FakeContext();
      r.drawFrame(asCtx(ctx), { ...VISEMES.REST, cornerPull });
      return ctx.ops.filter((o) => o.kind === 'drawImage').length;
    };
    const still = strips(0);
    expect(strips(0.3)).toBeGreaterThan(still);
    expect(strips(-0.3)).toBeGreaterThan(still);
  });
});
