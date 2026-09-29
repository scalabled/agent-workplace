// The protocol's structural mirrors of @headcount/expressions (packages/protocol/src/ext/expressions.ts) must stay equal
// to the engine's types in both directions. A drift fails `pnpm typecheck` (the tuple below stops type-checking) and
// the runtime checks here.
import {
  AMBIENCES as ENGINE_AMBIENCES,
  EXPRESSION_FRAME_TYPES,
  INTENT_IDS,
  SLOT_IDS,
  SLIDER_KEYS,
  type AgentExpressionProfile,
  type Ambience,
  type AttentionChangedData,
  type AttentionThread,
  type CauseRef,
  type ClipManifest,
  type ExpressionBias,
  type FaceCue,
  type FaceGesture,
  type IntentId,
  type Mood,
  type MoodChangedData,
  type MoodEventKind,
  type PaletteState,
  type PrevoiceTier,
  type ReactHint,
  type ReflexFaceData,
  type ReflexSayData,
  type RenderRequest,
  type Seniority,
  type SideTalkLineData,
  type SliderKey,
  type SlotId,
  type SlotValues,
  type Surface,
  type TeamRole,
  type TtsProvider,
  type ViewerState,
} from '@headcount/expressions';
import { EPHEMERAL_FRAME_TYPES, PERSISTED_FRAME_TYPES, type FrameDataMap } from '@headcount/protocol';
import * as P from '@headcount/protocol/ext/expressions';
import { describe, expect, it } from 'vitest';

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Every pair must be assignable both ways: a `false` here is a type error.
const pairs: [
  Mutual<Ambience, P.Ambience>,
  Mutual<IntentId, P.ExprIntentId>,
  Mutual<SlotId, P.ExprSlotId>,
  Mutual<SlotValues, P.ExprSlotValues>,
  Mutual<TtsProvider, P.ExprTtsProvider>,
  Mutual<FaceGesture, P.FaceGesture>,
  Mutual<PaletteState, P.PaletteState>,
  Mutual<ReactHint, P.ReactHint>,
  Mutual<MoodEventKind, P.MoodEventKind>,
  Mutual<Surface, P.ExprSurface>,
  Mutual<AttentionThread['kind'], P.AttentionKind>,
  Mutual<SliderKey, P.ExprSliderKey>,
  Mutual<TeamRole, P.ExprTeamRole>,
  Mutual<Seniority, P.ExprSeniority>,
  Mutual<Mood, P.ExprMood>,
  Mutual<CauseRef, P.ExprCause>,
  Mutual<FaceCue, P.FaceCue>,
  Mutual<ExpressionBias, P.ExpressionBias>,
  Mutual<ReflexSayData, P.ReflexSayData>,
  Mutual<ReflexFaceData, P.ReflexFaceData>,
  Mutual<SideTalkLineData, P.SideTalkLineData>,
  Mutual<MoodChangedData, P.MoodChangedData>,
  Mutual<AttentionChangedData, P.AttentionChangedData>,
  Mutual<AgentExpressionProfile, P.ExprAgentProfile>,
  Mutual<ClipManifest, P.ExprClipManifest>,
  Mutual<RenderRequest, P.ExprRenderRequest>,
  Mutual<Exclude<PrevoiceTier, 'runtime'>, P.ExprPrevoiceTier>,
  // The five frames in the protocol carry exactly the engine's data.
  Mutual<FrameDataMap['reflex.say'], ReflexSayData>,
  Mutual<FrameDataMap['reflex.face'], ReflexFaceData>,
  Mutual<FrameDataMap['sidetalk.line'], SideTalkLineData>,
  Mutual<FrameDataMap['mood.changed'], MoodChangedData>,
  Mutual<FrameDataMap['attention.changed'], AttentionChangedData>,
  // The viewer op carries everything the engine's ViewerState needs.
  [Omit<P.ViewerOp, 'op' | 'reducedMotion' | 'quietHours' | 'tzOffsetMin' | 'voice'>] extends [ViewerState] ? true : false,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];

describe('protocol mirrors of the expression engine', () => {
  it('holds every pair both ways (checked by the type checker)', () => {
    expect(pairs.every(Boolean)).toBe(true);
  });

  it('lists the same Ambience values and default', () => {
    expect([...P.AMBIENCES]).toEqual([...ENGINE_AMBIENCES]);
    expect(P.DEFAULT_AMBIENCE).toBe('lively');
    expect(P.ambienceOf(undefined)).toBe('lively');
    expect(P.ambienceOf({ ambience: 'quiet' })).toBe('quiet');
    expect([P.isAmbience('buzzing'), P.isAmbience('loud'), P.isAmbience(null)]).toEqual([true, false, false]);
  });

  it('keeps the five expression frames ephemeral, never persisted', () => {
    for (const t of EXPRESSION_FRAME_TYPES) {
      expect(EPHEMERAL_FRAME_TYPES.has(t)).toBe(true);
      expect(PERSISTED_FRAME_TYPES.has(t)).toBe(false);
    }
  });

  it('covers the engine vocabularies (33 intents, 17 slots, 7 sliders)', () => {
    expect(INTENT_IDS).toHaveLength(33);
    expect(SLOT_IDS).toHaveLength(17);
    expect(SLIDER_KEYS).toHaveLength(7);
  });
});
