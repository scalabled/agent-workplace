// Shared face motion: turns (presence state, mouth sampler, time) into one FacePose per frame.
// Both renderers (portrait strip-warp and the illustrated fallback) draw the same pose, so they
// lip-sync through the same sampler and show the same honest state cues.
//
// The mouth smoothing, blink schedule, brow micro-raise and energy sway are ported from
// personagram-ai/src/web/avatar/face-lipsync.js (_updateSpeakingFrame/_updateIdleFrame), made
// dt-based (so a 15/30/60 fps tier animates at the same speed) and freed from its own rAF loop.
//
// Living workforce (Inc 0.5, INC05-PLAN §3.7): a cue layer plays short reflex gestures (nod, look-up, glance…)
// on top of the state pose, and a mood palette (`expressionBias`) eases corner pull, brows, pitch, blink and sway.
// Everything is pose parameters: no new assets, no new loops.
import type { MouthSample, MouthSampler, PresenceState, VisemeParams } from '@headcount/protocol';
import type { ExpressionBias, FaceCue, FaceGesture, PaletteState } from '@headcount/protocol/ext/expressions';
import { seededRandom } from './color';
import { REST_PARAMS, sampleToParams } from './visemes';

/** Everything a renderer needs for one frame. All head motion is small and already eased. */
export interface FacePose {
  /** Smoothed mouth parameters (image-height units, PG space). cornerPull may be negative (a mood frown). */
  mouth: VisemeParams;
  /** The driver's current shape is TONGUE (tongue tint in the cavity). */
  tongue: boolean;
  /** 0 open … 1 closed. */
  blink: number;
  /** 0 … 1 brow raise. */
  brow: number;
  /** 0 … 1 inner-brow raise (a concerned look); only the illustrated face draws it. */
  browInner: number;
  /** Smoothed speech energy of what is playing (0 when silent). */
  energy: number;
  /** Whole-head sway: fractions of width/height, and radians. */
  swayX: number;
  swayY: number;
  swayRot: number;
  /** −1 … 1: head turned left/right (±12° intent; renderers keep it subtle). */
  yaw: number;
  /** −1 … 1: head down/up (up = positive). */
  pitch: number;
  /** 0 … 1: attentive lean toward the viewer. */
  lean: number;
  /** −1 … 1 gaze, used only by renderers that can move eyes (the illustrated face). */
  lookX: number;
  lookY: number;
  /** −1 … 1 breathing phase × amplitude (0 when still). */
  breath: number;
  /** A sampler is producing audible speech right now. */
  talking: boolean;
}

export const STILL_POSE: Readonly<FacePose> = Object.freeze({
  mouth: REST_PARAMS,
  tongue: false,
  blink: 0,
  brow: 0,
  browInner: 0,
  energy: 0,
  swayX: 0,
  swayY: 0,
  swayRot: 0,
  yaw: 0,
  pitch: 0,
  lean: 0,
  lookX: 0,
  lookY: 0,
  breath: 0,
  talking: false,
});

// Smoothing time constants (ms): opening movements, closing/relaxing movements, bilabial snap.
const ATTACK_MS = 40;
const RELEASE_MS = 90;
const SNAP_MS = 20;
/** Faint sway floor that keeps a head alive between utterances (PG IDLE_SWAY). */
const IDLE_SWAY = 0.12;
/** State poses ease over ~400 ms (EXPERIENCE §10.6 head yaw 400 ms). */
const POSE_TAU_MS = 140;
const ENERGY_TAU_TALK_MS = 98; // PG: 0.15 per 16 ms frame
const ENERGY_TAU_IDLE_MS = 530; // PG: 0.06 per 33 ms idle frame
const BROW_TAU_MS = 260; // PG: ×0.94 per 16 ms
const BREATH_PERIOD_MS = 4600;
/** The mood palette eases over ~300 ms (95 % after three time constants). */
const BIAS_TAU_MS = 100;
/** A change of palette expression holds at least this long before the next change (no flicker). */
export const EXPRESSION_HOLD_MS = 1200;
/** Corner pull (bias and smile) is scaled down while the mouth is busy speaking. */
const SPEAKING_CORNER_SCALE = 0.4;
/** Head gestures play at half amplitude while the face speaks. */
const SPEAKING_HEAD_SCALE = 0.5;
/** Default weight of a cue's palette expression (as expressionBias() uses). */
const CUE_EXPRESSION_WEIGHT = 0.8;

interface StatePose {
  yaw: number;
  pitch: number;
  lean: number;
  lookX: number;
  lookY: number;
  /** Held brow raise (raised hand). */
  brow: number;
  /** Sway multiplier (working damps it). */
  sway: number;
}

/**
 * State cues (EXPERIENCE §4.2, renderer honesty: no emotions). Listening leans in; thinking looks
 * gently away and up with slower blinks; working looks down (reading) with damped sway; raised
 * hand keeps an idle face with a held brow (the glyph beside the face is DOM chrome).
 */
export const STATE_POSES: Readonly<Record<PresenceState, StatePose>> = Object.freeze({
  idle: { yaw: 0, pitch: 0, lean: 0, lookX: 0, lookY: 0, brow: 0, sway: 1 },
  listening: { yaw: 0, pitch: 0.12, lean: 1, lookX: 0, lookY: 0, brow: 0.18, sway: 0.7 },
  thinking: { yaw: 0.34, pitch: 0.4, lean: 0, lookX: 0.75, lookY: -0.6, brow: 0.1, sway: 0.6 },
  speaking: { yaw: 0, pitch: 0, lean: 0.25, lookX: 0, lookY: 0, brow: 0, sway: 1 },
  working: { yaw: -0.08, pitch: -0.5, lean: 0, lookX: -0.1, lookY: 0.7, brow: 0, sway: 0.4 },
  raised_hand: { yaw: 0, pitch: 0.05, lean: 0.2, lookX: 0, lookY: 0, brow: 0.45, sway: 0.8 },
});

/**
 * What each palette expression adds at full weight (mirror of @headcount/expressions mood.ts PRESET). A cue's
 * expression swaps the bias's expression part for its own while it holds; the mood part (valence) stays.
 */
export const PALETTE_PRESETS: Readonly<Record<PaletteState, { cornerPull: number; brow: number; pitchDeg: number }>> = Object.freeze({
  resting: { cornerPull: 0, brow: 0, pitchDeg: 0 },
  delighted: { cornerPull: 0.35, brow: 0.05, pitchDeg: 0 },
  concerned: { cornerPull: -0.15, brow: 0.4, pitchDeg: -2 },
  thinking: { cornerPull: 0, brow: 0.3, pitchDeg: 4 },
});

const GESTURES: ReadonlySet<FaceGesture> = new Set<FaceGesture>(['none', 'nod', 'double_nod', 'look_up', 'brow_flash', 'head_tilt', 'smile', 'wince', 'exhale', 'glance', 'still']);
const PALETTE: ReadonlySet<PaletteState> = new Set<PaletteState>(['resting', 'thinking', 'delighted', 'concerned']);

/** The smile gesture's corner pull and eye squint at full hold (visible on a 64 px face, INC05 feel review). */
export const SMILE_CORNER_PULL = 0.7;
export const SMILE_SQUINT = 0.22;
/** The look-up's head pitch and the brow raise it holds. */
export const LOOK_UP_PITCH = 0.32;
export const LOOK_UP_BROW = 0.45;

/** Ease-in / ease-out lengths (ms) of the held gestures; the plateau is the cue's holdMs. */
const HELD: Partial<Record<FaceGesture, { in: number; out: number }>> = {
  look_up: { in: 150, out: 300 },
  head_tilt: { in: 150, out: 300 },
  smile: { in: 120, out: 300 },
  wince: { in: 80, out: 300 },
};

/** How long a gesture moves the face (ms), per the §3.7 timing table. 0 → no gesture. */
export function gestureDurationMs(cue: Pick<FaceCue, 'gesture' | 'holdMs'>): number {
  const hold = Math.max(0, finite(cue.holdMs, 0));
  switch (cue.gesture) {
    case 'nod':
      return 380;
    case 'double_nod':
      return 600;
    case 'brow_flash':
      return 180;
    case 'exhale':
      return 600;
    case 'glance':
      return 800;
    case 'still':
      return hold;
    case 'look_up':
    case 'head_tilt':
    case 'smile':
    case 'wince': {
      const h = HELD[cue.gesture]!;
      return h.in + hold + h.out;
    }
    default:
      return 0;
  }
}

/** A cue made safe: known gesture and expression, finite hold and weight. null → nothing to do. */
export function sanitizeCue(cue: FaceCue | null | undefined): FaceCue | null {
  if (!cue || typeof cue !== 'object') return null;
  const gesture: FaceGesture = GESTURES.has(cue.gesture) ? cue.gesture : 'none';
  const expression = cue.expression && PALETTE.has(cue.expression) ? cue.expression : undefined;
  if (gesture === 'none' && !expression) return null;
  const out: FaceCue = { gesture, holdMs: Math.min(20_000, Math.max(0, finite(cue.holdMs, 0))) };
  if (expression) out.expression = expression;
  if (cue.weight !== undefined) out.weight = clamp(finite(cue.weight, CUE_EXPRESSION_WEIGHT), 0, 1);
  return out;
}

function sanitizeBias(b: ExpressionBias): ExpressionBias {
  return {
    expression: PALETTE.has(b.expression) ? b.expression : 'resting',
    weight: clamp(finite(b.weight, 0), 0, 1),
    cornerPull: clamp(finite(b.cornerPull, 0), -1, 1),
    brow: clamp(finite(b.brow, 0), -1, 1),
    pitchDeg: clamp(finite(b.pitchDeg, 0), -12, 12),
    blinkScale: clamp(finite(b.blinkScale, 1), 0.5, 2),
    swayScale: clamp(finite(b.swayScale, 1), 0, 2),
  };
}

/** The face parameters a palette bias maps to (§3.7 bias mapping). */
interface BiasParams {
  cornerPull: number;
  brow: number;
  browInner: number;
  pitch: number;
  blinkScale: number;
  swayScale: number;
}

const NEUTRAL: Readonly<BiasParams> = Object.freeze({ cornerPull: 0, brow: 0, browInner: 0, pitch: 0, blinkScale: 1, swayScale: 1 });

function biasParams(b: ExpressionBias | null): BiasParams {
  if (!b) return { ...NEUTRAL };
  return {
    cornerPull: b.cornerPull,
    brow: b.brow,
    browInner: b.expression === 'concerned' ? 0.4 * b.weight : 0,
    pitch: b.pitchDeg / 12,
    blinkScale: b.blinkScale,
    swayScale: b.swayScale,
  };
}

/** The bias with its expression part swapped for `expression` at `weight` (the mood part stays). */
function withExpression(base: ExpressionBias | null, expression: PaletteState, weight: number): ExpressionBias {
  const from = PALETTE_PRESETS[base?.expression ?? 'resting'];
  const to = PALETTE_PRESETS[expression];
  const bw = base?.weight ?? 0;
  return {
    expression,
    weight,
    cornerPull: clamp((base?.cornerPull ?? 0) - from.cornerPull * bw + to.cornerPull * weight, -1, 1),
    brow: clamp((base?.brow ?? 0) - from.brow * bw + to.brow * weight, -1, 1),
    pitchDeg: (base?.pitchDeg ?? 0) - from.pitchDeg * bw + to.pitchDeg * weight,
    blinkScale: base?.blinkScale ?? 1,
    swayScale: base?.swayScale ?? 1,
  };
}

const coef = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1, tau));
const bump = (u: number) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u));
const smooth = (u: number) => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};
/** 0 → 1 over `inMs`, held, then 1 → 0 over `outMs` after `inMs + holdMs`. */
function envelope(e: number, inMs: number, holdMs: number, outMs: number): number {
  if (e < 0) return 0;
  if (e < inMs) return smooth(e / inMs);
  if (e < inMs + holdMs) return 1;
  return 1 - smooth((e - inMs - holdMs) / outMs);
}

/** Additive offsets of one gesture at `e` ms into it. */
interface GestureFrame {
  pitch: number;
  yaw: number;
  lean: number;
  swayRot: number;
  brow: number;
  cornerPull: number;
  blink: number;
  lookX: number;
  /** 0 … 1: pull the head's yaw and gaze toward the viewer. */
  toViewer: number;
  /** Replaces the breathing phase (exhale), or null. */
  breath: number | null;
  /** Sway, breath and blink hold still (the `still` gesture). */
  freeze: boolean;
}

function gestureFrame(cue: FaceCue, e: number, side: number, talking: boolean): GestureFrame {
  const k = talking ? SPEAKING_HEAD_SCALE : 1;
  const f: GestureFrame = { pitch: 0, yaw: 0, lean: 0, swayRot: 0, brow: 0, cornerPull: 0, blink: 0, lookX: 0, toViewer: 0, breath: null, freeze: false };
  const hold = Math.max(0, cue.holdMs);
  switch (cue.gesture) {
    case 'nod':
      f.pitch = -0.22 * bump(e / 380) * k;
      break;
    case 'double_nod':
      if (e < 600) f.pitch = -0.18 * bump((e % 300) / 300) * k;
      break;
    case 'look_up': {
      // Big enough to read on a 48 px Floor tile: the head comes up and the brows stay raised while it holds.
      const a = envelope(e, 150, hold, 300);
      f.pitch = LOOK_UP_PITCH * a * k;
      f.lean = 0.4 * a * k;
      f.toViewer = a * k;
      f.brow = Math.max(0.6 * bump(e / 150), LOOK_UP_BROW * a);
      break;
    }
    case 'brow_flash':
      f.brow = 0.7 * bump(e / 180);
      break;
    case 'head_tilt':
      f.swayRot = 0.05 * envelope(e, 150, hold, 300) * k;
      break;
    case 'smile': {
      // A smile you can see at 64 px: the corners lift well up and the eyes narrow a little (a Duchenne squint).
      const a = envelope(e, 120, hold, 300);
      f.cornerPull = SMILE_CORNER_PULL * a;
      f.blink = SMILE_SQUINT * a;
      break;
    }
    case 'wince': {
      const a = envelope(e, 80, hold, 300);
      f.brow = 0.3 * a;
      f.cornerPull = -0.15 * a;
      f.blink = 0.35 * bump(e / 180);
      break;
    }
    case 'exhale':
      f.pitch = -0.12 * bump(e / 600) * k;
      if (e < 600) f.breath = -bump(e / 600);
      break;
    case 'glance': {
      const a = e < 300 ? smooth(e / 300) : 1 - smooth((e - 300) / 500);
      f.yaw = side * 0.3 * a * k;
      f.lookX = side * 0.6 * a;
      break;
    }
    case 'still':
      f.freeze = e < hold;
      break;
    default:
      break;
  }
  return f;
}

export interface FaceMotionOptions {
  /** Seeds blink timing, sway phase and left/right asymmetry (deterministic per face). */
  seed?: number;
  reducedMotion?: boolean;
}

interface ActiveCue {
  cue: FaceCue;
  start: number;
  side: 1 | -1;
  /** Gesture length (ms); 0 when the cue carries only an expression. */
  gestureMs: number;
  /** Sway and breath captured when a `still` began. */
  frozen: { swayX: number; swayY: number; swayRot: number; breath: number } | null;
}

export class FaceMotion {
  state: PresenceState = 'idle';
  sampler: MouthSampler | null = null;
  reducedMotion: boolean;
  /** Last raw sample (diagnostics). */
  lastSample: MouthSample | null = null;

  private rand: () => number;
  private sideRand: () => number;
  private swayPhase: number;
  private readonly cur: VisemeParams = { ...REST_PARAMS };
  private energy = 0;
  private prevEnergy = 0;
  private browRaise = 0;
  private lastBrowAt = -Infinity;
  private lastT: number | null = null;
  private nextBlinkAt: number | null = null;
  private blinkStart = -1;
  private blinkDuration = 250;
  private pose = { yaw: 0, pitch: 0, lean: 0, lookX: 0, lookY: 0, brow: 0, sway: 1 };
  private talking = false;
  // ── cue layer and mood palette ──
  private pendingCue: FaceCue | null = null;
  private active: ActiveCue | null = null;
  private biasTarget: ExpressionBias | null = null;
  private biasApplied: ExpressionBias | null = null;
  private appliedExpression: PaletteState = 'resting';
  private expressionChangedAt = -Infinity;
  private shownExpression: PaletteState = 'resting';
  private readonly biasCur: BiasParams = { ...NEUTRAL };
  private biasGoal: BiasParams = { ...NEUTRAL };
  private lastSway = { swayX: 0, swayY: 0, swayRot: 0, breath: 0 };

  constructor(opts: FaceMotionOptions = {}) {
    this.rand = seededRandom(opts.seed ?? 1);
    this.sideRand = seededRandom(((opts.seed ?? 1) ^ 0x5bd1e995) >>> 0);
    this.swayPhase = this.rand() * Math.PI * 2;
    this.reducedMotion = !!opts.reducedMotion;
  }

  /** New identity (the face now shows someone else): new sway phase and blink schedule. */
  reseed(seed: number): void {
    this.rand = seededRandom(seed);
    this.sideRand = seededRandom((seed ^ 0x5bd1e995) >>> 0);
    this.swayPhase = this.rand() * Math.PI * 2;
    this.nextBlinkAt = null;
    this.blinkStart = -1;
  }

  /** A reflex gesture (+ optional palette expression) from the next frame on. Latest cue wins. */
  cue(cue: FaceCue): void {
    const c = sanitizeCue(cue);
    if (!c) return;
    this.pendingCue = c;
  }

  /** The mood palette (null → neutral). Eases over 300 ms; a change of expression waits out EXPRESSION_HOLD_MS. */
  setBias(bias: ExpressionBias | null): void {
    this.biasTarget = bias ? sanitizeBias(bias) : null;
  }

  /** The palette expression the face shows (as of the last frame): a cue's override, else the mood's. */
  get expression(): PaletteState {
    return this.shownExpression;
  }

  /** True while the attached sampler reports audible, unfinished speech (as of the last update). */
  get isTalking(): boolean {
    return this.talking;
  }

  /** A gesture is moving the head or face at `now` (never under reduced motion). */
  gestureActive(now: number): boolean {
    const a = this.active;
    return !this.reducedMotion && !!a && a.gestureMs > 0 && now - a.start < a.gestureMs;
  }

  /** True while a state transition, gesture, palette change or mouth/energy decay is still settling. */
  get settling(): boolean {
    const target = this.targetPose();
    const d =
      Math.abs(this.pose.yaw - target.yaw) +
      Math.abs(this.pose.pitch - target.pitch) +
      Math.abs(this.pose.lean - target.lean) +
      Math.abs(this.pose.lookX - target.lookX) +
      Math.abs(this.pose.lookY - target.lookY) +
      Math.abs(this.pose.brow - target.brow);
    const m = Math.abs(this.cur.openY) + Math.abs(this.cur.jawDrop) + Math.abs(this.cur.stretchX) + this.cur.cornerPull + this.cur.round;
    return d > 0.01 || m > 0.0005 || this.energy > 0.01 || this.browRaise > 0.02 || this.cueSettling() || this.biasSettling();
  }

  /**
   * A cue waiting for its first frame, or a gesture in motion. (A held expression needs no fast frames: an
   * animated face notices its end on its idle frames, and a still face gets a timed redraw from wakeAt().)
   */
  private cueSettling(): boolean {
    if (this.pendingCue) return true;
    const a = this.active;
    return !!a && !this.reducedMotion && this.lastT !== null && this.lastT - a.start < a.gestureMs;
  }

  /** The palette is still easing toward its goal. */
  private biasSettling(): boolean {
    const g = this.biasGoal;
    const c = this.biasCur;
    const d =
      Math.abs(g.cornerPull - c.cornerPull) + Math.abs(g.brow - c.brow) + Math.abs(g.browInner - c.browInner) + Math.abs(g.pitch - c.pitch) + Math.abs(g.blinkScale - c.blinkScale) + Math.abs(g.swayScale - c.swayScale);
    return d > 0.004;
  }

  /**
   * When (in this motion's clock) a face that only redraws on demand (a token, or reduced motion) must redraw
   * next: a held expression change coming due, or a cue's expression override ending. null → nothing pending.
   */
  wakeAt(): number | null {
    let at: number | null = null;
    const want = this.biasTarget?.expression ?? 'resting';
    if (this.biasTarget !== this.biasApplied) at = want === this.appliedExpression ? (this.lastT ?? 0) : this.expressionChangedAt + EXPRESSION_HOLD_MS;
    const a = this.active;
    if (a?.cue.expression) {
      const end = a.start + a.cue.holdMs;
      if (this.lastT === null || end > this.lastT) at = at === null ? end : Math.min(at, end);
    }
    return at;
  }

  private targetPose(): StatePose {
    if (this.reducedMotion) return STATE_POSES.idle;
    return STATE_POSES[this.state] ?? STATE_POSES.idle;
  }

  /** Start a pending cue at `now`; drop a finished one. */
  private stepCue(now: number): void {
    if (this.pendingCue) {
      const cue = this.pendingCue;
      this.pendingCue = null;
      this.active = { cue, start: now, side: this.sideRand() < 0.5 ? -1 : 1, gestureMs: gestureDurationMs(cue), frozen: null };
    }
    const a = this.active;
    if (a && now - a.start >= Math.max(a.gestureMs, a.cue.expression ? a.cue.holdMs : 0)) this.active = null;
  }

  /** Resolve the palette at `now`: expression hysteresis on the mood bias, then a cue's override. */
  private stepBias(now: number): BiasParams {
    const target = this.biasTarget;
    const want = target?.expression ?? 'resting';
    if (want === this.appliedExpression) this.biasApplied = target;
    else if (now - this.expressionChangedAt >= EXPRESSION_HOLD_MS) {
      this.biasApplied = target;
      this.appliedExpression = want;
      this.expressionChangedAt = now;
    }
    let b = this.biasApplied;
    const a = this.active;
    if (a?.cue.expression && now - a.start < a.cue.holdMs) b = withExpression(b, a.cue.expression, a.cue.weight ?? CUE_EXPRESSION_WEIGHT);
    this.shownExpression = b?.expression ?? 'resting';
    return biasParams(b);
  }

  /**
   * The pose of a face that does not animate (a token): no gestures, the palette applied at once (one static
   * redraw). With no palette this is STILL_POSE itself.
   */
  staticPose(now: number): Readonly<FacePose> {
    this.stepCue(now);
    const g = this.stepBias(now);
    this.lastT = now;
    Object.assign(this.biasCur, g);
    this.biasGoal = g;
    if (!g.cornerPull && !g.brow && !g.browInner && !g.pitch) return STILL_POSE;
    return {
      ...STILL_POSE,
      mouth: { ...REST_PARAMS, cornerPull: clamp(g.cornerPull, -1, 1) },
      brow: clamp(g.brow, 0, 1),
      browInner: clamp(g.browInner, 0, 1),
      pitch: clamp(g.pitch, -1, 1),
    };
  }

  /** Advance to `now` (performance.now domain) and return the pose to draw. */
  update(now: number): FacePose {
    const dt = this.lastT === null ? 16 : Math.max(1, Math.min(120, now - this.lastT));
    this.lastT = now;

    // ── mouth: follow what is actually playing ──
    let s: MouthSample | null = null;
    if (this.sampler) {
      try {
        s = this.sampler.sample(now);
      } catch {
        s = null;
      }
    }
    this.lastSample = s;
    const active = !!s && !s.done && s.heard !== false;
    this.talking = active && (s!.energy > 0.02 || !!s!.voiced || (s!.openness ?? 0) > 0.02);
    const target = active ? sampleToParams(s!) : REST_PARAMS;
    const closing = target.openY + target.jawDrop < this.cur.openY + this.cur.jawDrop;
    const isSnap = active && target.openY <= 0 && target.jawDrop <= 0.001; // bilabials shut fast
    const k = coef(dt, isSnap ? SNAP_MS : closing ? RELEASE_MS : ATTACK_MS);
    this.cur.openY += (target.openY - this.cur.openY) * k;
    this.cur.stretchX += (target.stretchX - this.cur.stretchX) * k;
    this.cur.jawDrop += (target.jawDrop - this.cur.jawDrop) * k;
    this.cur.cornerPull += (target.cornerPull - this.cur.cornerPull) * k;
    this.cur.round += (target.round - this.cur.round) * k;
    // Below the renderers' "is moving" thresholds the mouth IS at rest: snap, so idle frames stay cheap.
    if (!active && Math.abs(this.cur.openY) + Math.abs(this.cur.jawDrop) + Math.abs(this.cur.stretchX) < 0.0015 && this.cur.cornerPull < 0.02 && this.cur.round < 0.02) {
      Object.assign(this.cur, REST_PARAMS);
    }

    const sampleEnergy = active ? Math.max(0, Math.min(1, s!.energy || 0)) : 0;
    this.energy += (sampleEnergy - this.energy) * coef(dt, active ? ENERGY_TAU_TALK_MS : ENERGY_TAU_IDLE_MS);
    if (this.energy < 0.001) this.energy = 0;

    const target_ = this.targetPose();
    const pk = coef(dt, POSE_TAU_MS);
    if (this.reducedMotion) Object.assign(this.pose, STATE_POSES.idle);
    else for (const key of Object.keys(this.pose) as (keyof StatePose)[]) this.pose[key] += (target_[key] - this.pose[key]) * pk;

    // ── palette (mood bias, a cue's expression): eased, or at once under reduced motion ──
    this.stepCue(now);
    const goal = this.stepBias(now);
    this.biasGoal = goal;
    const bc = this.biasCur;
    if (this.reducedMotion) Object.assign(bc, goal);
    else {
      const bk = coef(dt, BIAS_TAU_MS);
      for (const key of Object.keys(bc) as (keyof BiasParams)[]) bc[key] += (goal[key] - bc[key]) * bk;
    }

    // ── gesture layer (never under reduced motion) ──
    const a = this.active;
    const g = a && !this.reducedMotion && now - a.start < a.gestureMs ? gestureFrame(a.cue, now - a.start, a.side, this.talking) : null;

    // ── decoration (off under reduced motion): brows, blink, sway, breathing ──
    let blink = 0;
    let swayX = 0;
    let swayY = 0;
    let swayRot = 0;
    let breath = 0;
    if (!this.reducedMotion) {
      if (active && sampleEnergy - this.prevEnergy > 0.18 && now - this.lastBrowAt > 1500) {
        this.browRaise = 1;
        this.lastBrowAt = now;
      }
      this.browRaise *= 1 - coef(dt, BROW_TAU_MS);
      // The blink schedule keeps running under a `still` (only its output is held), so it never drifts.
      blink = this.blinkAt(now, bc.blinkScale);
      const t = now / 1000;
      const sway = Math.max(this.energy, IDLE_SWAY) * this.pose.sway * bc.swayScale;
      swayX = Math.sin(t * 1.1 + this.swayPhase) * 0.004 * sway;
      swayY = Math.sin(t * 1.7 + this.swayPhase * 2) * 0.003 * sway;
      swayRot = Math.sin(t * 0.9 + this.swayPhase) * 0.007 * sway;
      breath = Math.sin(((now % BREATH_PERIOD_MS) / BREATH_PERIOD_MS) * Math.PI * 2 + this.swayPhase);
      if (g?.freeze && a) {
        // `still`: sway and breath hold where they were; no blink.
        a.frozen ??= { ...this.lastSway };
        ({ swayX, swayY, swayRot, breath } = a.frozen);
        blink = 0;
      } else this.lastSway = { swayX, swayY, swayRot, breath };
    } else {
      this.browRaise = 0;
    }
    this.prevEnergy = sampleEnergy;

    const cornerScale = this.talking ? SPEAKING_CORNER_SCALE : 1;
    const toViewer = g ? clamp(g.toViewer, 0, 1) : 0;
    let yaw = this.pose.yaw * (1 - toViewer);
    let pitch = this.pose.pitch + bc.pitch;
    let lean = this.pose.lean;
    let lookX = this.pose.lookX * (1 - toViewer);
    const lookY = this.pose.lookY * (1 - toViewer);
    let brow = Math.max(this.browRaise, this.pose.brow) + bc.brow;
    let cornerPull = this.cur.cornerPull + bc.cornerPull * cornerScale;
    if (g) {
      yaw += g.yaw;
      pitch += g.pitch;
      lean += g.lean;
      lookX += g.lookX;
      swayRot += g.swayRot;
      brow += g.brow;
      cornerPull += g.cornerPull * cornerScale;
      blink = Math.max(blink, g.blink);
      if (g.breath !== null) breath = g.breath;
    }

    return {
      mouth: { ...this.cur, cornerPull: clamp(cornerPull, -1, 1) },
      tongue: active && s!.shape === 'TONGUE',
      blink: clamp(blink, 0, 1),
      brow: clamp(brow, 0, 1),
      browInner: clamp(bc.browInner, 0, 1),
      energy: this.energy,
      swayX,
      swayY,
      swayRot,
      yaw: clamp(yaw, -1, 1),
      pitch: clamp(pitch, -1, 1),
      lean: clamp(lean, 0, 1),
      lookX: clamp(lookX, -1, 1),
      lookY,
      breath,
      talking: this.talking,
    };
  }

  /** Blink every 3–8 s (250 ms triangle); thinking blinks slower and less often; the mood scales the interval. */
  private blinkAt(now: number, scale = 1): number {
    const thinking = this.state === 'thinking';
    if (this.nextBlinkAt === null) this.nextBlinkAt = now + (1200 + this.rand() * 4000) * scale;
    if (this.blinkStart < 0 && now >= this.nextBlinkAt) {
      this.blinkStart = now;
      this.blinkDuration = thinking ? 420 : 250;
    }
    if (this.blinkStart < 0) return 0;
    const t = (now - this.blinkStart) / this.blinkDuration;
    if (t >= 1 || t < 0) {
      this.blinkStart = -1;
      this.nextBlinkAt = now + (thinking ? 5000 + this.rand() * 5000 : 3000 + this.rand() * 5000) * scale;
      return 0;
    }
    return t < 0.5 ? t * 2 : 2 - t * 2;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
