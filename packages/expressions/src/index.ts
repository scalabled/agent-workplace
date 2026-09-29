// @headcount/expressions — the reflex engine of the living workforce (docs/LIVING-WORKFORCE.md §11).
// Pure, isomorphic TypeScript: runs in the browser (ReflexRunner) and in Workers (WorkspaceDO, ProjectDO).

// ── vocabulary ──────────────────────────────────────────────────────────────────
export type {
  Ambience, AmbienceLevel, ArchetypeId, FaceGesture, IntentFamily, IntentId, Mailbox, Mood, MoodEventKind, PaletteState,
  OwnerTone, PrevoiceTier, Seniority, SliderKey, Sliders, SlotId, Surface, TeamRole, TtsProvider, UnblockedBy,
} from './vocab';
export {
  AMBIENCES, ARCHETYPE_IDS, FLOOR_INTENTS, GLOBAL_NEVER_SAYS, GLOBAL_NEVER_SAYS_OWNER_FACING, INTENT_IDS, LAUGH_KINDS, MAILBOX_PRIORITY, MOOD_DELTAS, MOOD_HALF_LIFE_MS,
  REACTION_INTENTS, SIDETALK_OPENERS, SLIDER_KEYS, SLOT_IDS, isArchetypeId, isIntentId, isSlotId,
} from './vocab';

// ── shapes ──────────────────────────────────────────────────────────────────────
export type {
  AffectCues, AffectLexicon, AgentExpressionProfile, AgentIndex, AmbienceProfile, ArchetypeBlend, ArchetypeDef, ArchetypePack,
  ArchetypesFile, AttentionChangedData, AttentionThread, AttentionView, AudioBus, BudgetClass, CatchphraseDef, CauseRef,
  ChannelPlan, ChatterBudget, ClipAvailability, ClipManifest, ClipStore, CommonFills, CompiledCatalog, CompiledLine, Contention,
  ConversationEvent, Envelope, ExpressionBias, ExpressionCatalogInput, ExpressionFrame, FaceCue, GateInput, GateVerdict,
  GroundingState, IntentDef, IntentsFile, LaughStyle, LineDef, Mailboxes, MoodChangedData, MoodEvent, MoodFit, MoodState,
  OwnerSpeechEvent, OwnerTurnEvent, PersonalityInput, PreparedClip, PrevoiceItem, ReactHint, RecencyMemory, RecencySnapshot,
  RecentEntry, ReflexAudioPort, ReflexCaptionPort, ReflexFaceData, ReflexFacePort, ReflexPlayHandle, ReflexPlayRequest,
  ReflexRunner, ReflexRunnerDeps, ReflexSayData, ReflexSettings, ReflexTelemetry, RenderRequest, Rng, SelectRequest,
  SelectResult, SideTalkContext, SideTalkEvent, SideTalkLineData, SideTalkLinePlan, SideTalkProposal, SignatureFile,
  SignaturePack, SkipReason, SlotValues, TimingGate, TtsDelivery, Utterance, WeightedLine,
} from './types';

// ── compile and index ───────────────────────────────────────────────────────────
export {
  ExpressionCatalogError, LAUGH_XAI_BY_KIND, buildAgentIndex, catalogVersion, compileCatalog, compileCatalogLenient, deriveBlend,
  laughXaiFor, resolveBlend, sliderStatsOf, topicsFor,
} from './catalog';

// ── grounding ───────────────────────────────────────────────────────────────────
export {
  deriveContexts, etaPhrase, isGerundLabel, isOwnerAsk, isOwnerQuestion, numberWord, ownerToneOf, partOfDay, resolveSlots, sanitizeGist, weekdayName,
} from './state';

// ── recency and randomness ──────────────────────────────────────────────────────
export { createRecencyMemory } from './recency';
export { seededRng } from './hash';

// ── selection, filling, delivery ────────────────────────────────────────────────
export {
  fillLine, lineOf, ownerDayKey, recordUtterance, renderUtterance, scoreLine, selectLine, validateFills,
} from './select';
export { openaiInputFromXai, readable, speakable } from './markup';
export { DEFAULT_TTS_MODEL, clipKey, fillKeyOf, toDelivery, voiceKeyOf } from './delivery';

// ── mood and face ───────────────────────────────────────────────────────────────
export {
  applyMoodEvent, baselineMood, createMoodState, expressionBias, moodAt, moodChanged, ownerFacing, reactivityOf,
} from './mood';

// ── owner affect ────────────────────────────────────────────────────────────────
export { REACT_HINT_MAX_CHARS, maybeReactHintPrefix, parseReactHint, reactionFor, sniffOwnerText } from './affect';

// ── gates and budgets ───────────────────────────────────────────────────────────
export { budgetClassFor, createChatterBudget, createTimingGate, faceCueFor, reflexProbability } from './gate';

// ── actors and attention ────────────────────────────────────────────────────────
export { contentionFor, createMailboxes, mergeAttention } from './actor';

// ── side-talk ───────────────────────────────────────────────────────────────────
export { proposeSideTalk, sideTalkText } from './sidetalk';

// ── server event reflexes (additive) ────────────────────────────────────────────
export { moodEventFor, planServerReflex, reflexIntentFor } from './events';
export type { ServerReflexArgs, ViewerState, WorkEventKind } from './events';

// ── huddle small talk (docs/dev/OFFICE-LIFE.md §5, §6.2) ───────────────────────
export {
  HUDDLE_CAPTION_MAX_CHARS, HUDDLE_COMPLETION_EVENTS, HUDDLE_CONTEXTS, HUDDLE_EVENT_KINDS, HUDDLE_GROUNDED_SLOTS, HUDDLE_PARTICIPANT_MEMORY_MS,
  HUDDLE_ROLES, HUDDLE_SAD_GATE, HUDDLE_SAD_VALENCE, HUDDLE_SLOTS, HUDDLE_SPOTS, HUDDLE_TEXT_MAX_CHARS, HUDDLE_TOPICS, HUDDLE_WEEKLY_CAP,
  castRoles, compileHuddles, compileHuddlesLenient,
  createHuddleRecency, huddleReadingMs, huddleScriptOf, huddleUtterance, huddlesVersion, lintHuddleText, pickExchange, renderHuddleUtterance,
} from './huddle';
export type {
  CastOptions, CompiledExchange, CompiledHuddleLine, CompiledHuddles, HuddleEvent, HuddleEventKind, HuddleExchangeDef, HuddleLineDef,
  HuddleLinePlan, HuddleLint, HuddleLintContext, HuddlePackInput, HuddlePair, HuddleParticipant, HuddlePick, HuddleRecency,
  HuddleRecencySnapshot, HuddleRequest, HuddleRequiresDef, HuddleRole, HuddleRoleDef, HuddleScriptOut, HuddleSlot, HuddleSpot,
  HuddleTopic, HuddleWho,
} from './huddle';

// ── pre-voicing ─────────────────────────────────────────────────────────────────
export { planPrevoice } from './prevoice';

// ── protocol frame data ─────────────────────────────────────────────────────────
export {
  EXPRESSION_FRAME_TYPES, attentionChangedData, clipAlignmentUrl, clipUrl, isExpressionFrame, moodChangedData, reflexFaceData,
  reflexSayData, sideTalkLineData,
} from './frames';

// ── client reflex runner ────────────────────────────────────────────────────────
export { createReflexRunner, humourOnly } from './runner';
