import type { Appearance } from '@headcount/catalog';
import type { FaceLandmarks, FaceTier, MouthSampler, PresenceState } from '@headcount/protocol';
import type { ExpressionBias, FaceCue, FaceGesture, PaletteState } from '@headcount/protocol/ext/expressions';

export type { Appearance, ExpressionBias, FaceCue, FaceGesture, FaceLandmarks, FaceTier, MouthSampler, PaletteState, PresenceState };

export interface PortraitSource {
  /** Same-origin URL (GET /api/portraits/:personaId) or object URL. */
  url: string;
  /** Stored landmarks, or null → FaceView detects them once and reports via `onLandmarks`. */
  landmarks: FaceLandmarks | null;
}

/** What the procedural fallback needs (catalog `avatar.appearance` + accent). */
export interface AppearanceFallback {
  appearance: Appearance;
  /** `#RRGGBB`, the agent's one accent colour. */
  accent: string;
  /** Used for the accessible label and to seed small deterministic variations. */
  name: string;
}

export interface FaceViewOptions {
  tier?: FaceTier;
  /** Fixed accessible label. When omitted the label is "<name>, <state or presence label>". */
  label?: string;
  /** Name for the accessible label before a fallback is set. */
  name?: string;
  /** Force reduced motion (defaults to the OS `prefers-reduced-motion`, live). Lip sync stays on. */
  reducedMotion?: boolean;
  /** Called once when landmarks were detected for a portrait that had none (caller PUTs them). */
  onLandmarks?: (landmarks: FaceLandmarks) => void;
  /** Detect landmarks for portraits without them (default true; tokens never detect). */
  detectLandmarks?: boolean;
  /** Draw the state ring and glyph badge (default true). Set false when the host draws its own. */
  chrome?: boolean;
}

/**
 * The face element API used by the web shell. One FaceView per visible face; the avatar package
 * owns the only rAF scheduler (ARCHITECTURE §9.4), so instances never run their own loops.
 */
export interface FaceViewApi {
  /** Attach to a container; creates a <canvas role="img"> sized to the container. */
  mount(el: HTMLElement): void;
  /** Photoreal portrait path (strip warp when landmarks exist, still image otherwise). null → fallback. */
  setPortrait(portrait: PortraitSource | null): Promise<void>;
  /** Procedural face from catalog appearance fields; shown until/unless a portrait loads. */
  setAppearanceFallback(fallback: AppearanceFallback): void;
  /** Drive state: ring, glyph, head pose (idle blink/sway, thinking look-away, raised-hand glyph…). */
  setState(state: PresenceState, label?: string): void;
  /** The mouth follows this sampler every frame (audio actually playing). null → mouth at rest. */
  attachSampler(sampler: MouthSampler | null): void;
  /** hero (1024 px, animated) · tile (animated, ≤3 at once) · token (still + ring). */
  setTier(tier: FaceTier): void;
  /** A reflex gesture (+ optional palette expression) for cue.holdMs. Latest cue wins. */
  cue(cue: FaceCue): void;
  /** The mood palette (mood.changed / expressionBias). null → neutral. */
  setExpressionBias(bias: ExpressionBias | null): void;
  destroy(): void;
}
