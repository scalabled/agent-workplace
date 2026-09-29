// The living runtime as the rest of the app sees it (type-only: importing this never loads the engine).
import type { AffectCues, CompiledCatalog, ReflexRunner } from '@headcount/expressions';
import type { Ambience } from '@headcount/protocol/ext/expressions';
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
  dispose(): void;
}
