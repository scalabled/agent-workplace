// The living runtime as the rest of the app sees it (type-only: importing this never loads the engine).
import type { AffectCues, CompiledCatalog, Mood, PreparedClip, ReflexRunner } from '@headcount/expressions';
import type { Ambience, ExprAgentProfile, ExprTtsProvider } from '@headcount/protocol/ext/expressions';
import type { SendWhileSpeaking } from './policy';

export interface OwnerTurnInput {
  agentId: string;
  turnId: string;
  /** When the owner finished: the send (text) or the push-to-talk release (voice). */
  at: number;
  mode: 'voice' | 'text';
  text: string;
}

export type HoverPhase = 'enter' | 'dwell' | 'leave';
export type HoverVia = 'pointer' | 'keyboard' | 'touch';

export interface LivingRuntime {
  readonly runner: ReflexRunner;
  readonly catalog: CompiledCatalog;
  /** An owner turn this tab sent was accepted (after POST /api/talk or /api/desk/…/say resolved). */
  ownerTurn(e: OwnerTurnInput): void;
  /** A send from this tab settled: server reflexes held for it are released, or reduced to faces. */
  sendSettled(): void;
  hover(agentId: string, phase: HoverPhase, via: HoverVia): void;
  /** Load an agent's expression profile (first hover, a desk). */
  ensureAgent(agentId: string): Promise<boolean>;
  /** What to do with an agent's voice when the owner sends while it speaks (§2.3). */
  sendDecision(agentId: string, text: string): SendWhileSpeaking;
  /** Esc, a tap on the face, holding to talk: the agent stops at once, and so do their reflexes. */
  bargeIn(agentId: string): void;
  setAmbience(a: Ambience): void;
  cues(text: string): AffectCues;
  clipsDecoded(): number;
  // ── the Office ──
  /** The bundle's small-talk packs, kept at boot (null when the worker serves none). */
  readonly huddles: { version: string; packs: readonly unknown[] } | null;
  /** The runner's own rolling 10-minute window of voiced ambient audio, shared with the office's listen-in. */
  readonly ambientVoice: { leftMs(): number; spend(ms: number): void };
  /** A clip from the runtime's clip store (Cache Storage, then the network), decoded. null on any failure. */
  loadClip(clipKey: string): Promise<PreparedClip | null>;
  /** The agent's mood decayed to now, when their profile is loaded; else null. */
  moodOf(agentId: string): Mood | null;
  /** The renderer the agent's reflexes use (loaded agents only). */
  provider(agentId: string): ExprTtsProvider | null;
  /** The agent's expression profile (loaded agents only). */
  profileOf(agentId: string): ExprAgentProfile | null;
  /**
   * An owner-directed greeting or sign-off by catalog selection with live grounding (owner name, first meeting).
   * Voiced only when voice is on and this tab may voice; returns the caption text. Never throws.
   */
  sayIntent(agentId: string, intent: 'greeting' | 'sign_off'): Promise<{ text: string; voiced: boolean } | null>;
  dispose(): void;
}
