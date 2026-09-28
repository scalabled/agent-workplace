// Shared face motion: turns (presence state, mouth sampler, time) into one FacePose per frame.
// Both renderers (portrait strip-warp and the illustrated fallback) draw the same pose, so they
// lip-sync through the same sampler and show the same honest state cues.
//
// The mouth smoothing, blink schedule, brow micro-raise and energy sway are ported from
// personagram-ai/src/web/avatar/face-lipsync.js (_updateSpeakingFrame/_updateIdleFrame), made
// dt-based (so a 15/30/60 fps tier animates at the same speed) and freed from its own rAF loop.
import type { MouthSample, MouthSampler, PresenceState, VisemeParams } from '@headcount/protocol';
import { seededRandom } from './color';
import { REST_PARAMS, sampleToParams } from './visemes';

/** Everything a renderer needs for one frame. All head motion is small and already eased. */
export interface FacePose {
  /** Smoothed mouth parameters (image-height units, PG space). */
  mouth: VisemeParams;
  /** The driver's current shape is TONGUE (tongue tint in the cavity). */
  tongue: boolean;
  /** 0 open … 1 closed. */
  blink: number;
  /** 0 … 1 brow raise. */
  brow: number;
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

const coef = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1, tau));

export interface FaceMotionOptions {
  /** Seeds blink timing, sway phase and left/right asymmetry (deterministic per face). */
  seed?: number;
  reducedMotion?: boolean;
}

export class FaceMotion {
  state: PresenceState = 'idle';
  sampler: MouthSampler | null = null;
  reducedMotion: boolean;
  /** Last raw sample (diagnostics). */
  lastSample: MouthSample | null = null;

  private rand: () => number;
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

  constructor(opts: FaceMotionOptions = {}) {
    this.rand = seededRandom(opts.seed ?? 1);
    this.swayPhase = this.rand() * Math.PI * 2;
    this.reducedMotion = !!opts.reducedMotion;
  }

  /** New identity (the face now shows someone else): new sway phase and blink schedule. */
  reseed(seed: number): void {
    this.rand = seededRandom(seed);
    this.swayPhase = this.rand() * Math.PI * 2;
    this.nextBlinkAt = null;
    this.blinkStart = -1;
  }

  /** True while the attached sampler reports audible, unfinished speech (as of the last update). */
  get isTalking(): boolean {
    return this.talking;
  }

  /** True while a state transition or mouth/energy decay is still settling. */
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
    return d > 0.01 || m > 0.0005 || this.energy > 0.01 || this.browRaise > 0.02;
  }

  private targetPose(): StatePose {
    if (this.reducedMotion) return STATE_POSES.idle;
    return STATE_POSES[this.state] ?? STATE_POSES.idle;
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
      blink = this.blinkAt(now);
      const t = now / 1000;
      const sway = Math.max(this.energy, IDLE_SWAY) * this.pose.sway;
      swayX = Math.sin(t * 1.1 + this.swayPhase) * 0.004 * sway;
      swayY = Math.sin(t * 1.7 + this.swayPhase * 2) * 0.003 * sway;
      swayRot = Math.sin(t * 0.9 + this.swayPhase) * 0.007 * sway;
      breath = Math.sin(((now % BREATH_PERIOD_MS) / BREATH_PERIOD_MS) * Math.PI * 2 + this.swayPhase);
    } else {
      this.browRaise = 0;
    }
    this.prevEnergy = sampleEnergy;

    return {
      mouth: { ...this.cur },
      tongue: active && s!.shape === 'TONGUE',
      blink,
      brow: Math.min(1, Math.max(this.browRaise, this.pose.brow)),
      energy: this.energy,
      swayX,
      swayY,
      swayRot,
      yaw: this.pose.yaw,
      pitch: this.pose.pitch,
      lean: this.pose.lean,
      lookX: this.pose.lookX,
      lookY: this.pose.lookY,
      breath,
      talking: this.talking,
    };
  }

  /** Blink every 3–8 s (250 ms triangle); thinking blinks slower and less often. */
  private blinkAt(now: number): number {
    const thinking = this.state === 'thinking';
    if (this.nextBlinkAt === null) this.nextBlinkAt = now + 1200 + this.rand() * 4000;
    if (this.blinkStart < 0 && now >= this.nextBlinkAt) {
      this.blinkStart = now;
      this.blinkDuration = thinking ? 420 : 250;
    }
    if (this.blinkStart < 0) return 0;
    const t = (now - this.blinkStart) / this.blinkDuration;
    if (t >= 1 || t < 0) {
      this.blinkStart = -1;
      this.nextBlinkAt = now + (thinking ? 5000 + this.rand() * 5000 : 3000 + this.rand() * 5000);
      return 0;
    }
    return t < 0.5 ? t * 2 : 2 - t * 2;
  }
}
