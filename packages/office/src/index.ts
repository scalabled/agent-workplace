// @headcount/office: the Office view. A framework-agnostic 3/4 top-down office floor with desks,
// glass conference rooms, typical office things and a city skyline, plus the conference stage. No dependencies.
export { createOfficeScene } from './scene/scene';
export { planOffice, DEFAULT_ROOMS } from './plan/plan';
export { DISTRICT_ORDER } from './plan/districts';
export { timeOfDayAt } from './time';
export { DEFAULT_STRINGS } from './strings';
export { hitTest } from './plan/hit';
export { project, unproject, toScreen, fromScreen } from './projection';
export { fitCamera, cameraBounds, clampCamera, zoomAround } from './scene/camera';
export type { OfficeStrings, LifeStrings } from './strings';

// Office life: the office runs itself.
export { createOfficeLife } from './life/director';
export type { LifeTimers, OfficeLife, OfficeLifeCallbacks, OfficeLifeOptions } from './life/director';
export { planDay, replanFrom, segmentAt } from './life/planner';
export type { PlanDayInput } from './life/planner';
export { planSpots } from './life/spots';
export { activityOf, ACTIVITY_PLACES } from './life/activity';
export { resolveClaim, CLAIM_ORDER } from './life/overrides';
export type { Claim, ClaimKind } from './life/overrides';
export { lifeKnobs, DEFAULT_SLIDER_STATS } from './life/knobs';
export type { LifeKnobs, SliderStats } from './life/knobs';
export { LIFE_CAPS, TOD_DENSITY, AMBIENCE_K } from './life/tables';
export { readingMs, timeTurns } from './life/choreo';
export { scoreMoments, AUTOPILOT, MOMENT_BASE } from './life/moments';
export type {
  Ambience,
  AnchorKind,
  ArchetypeName,
  Cue,
  DayPlan,
  HoldWhy,
  HuddleAction,
  HuddleInfo,
  HuddleLineEvent,
  HuddleLineRequest,
  HuddleScript,
  HuddleScriptLine,
  LifeCaps,
  LifeHooks,
  LifeScenePort,
  LifeState,
  LifeSummary,
  Moment,
  MoveHandle,
  MoveOptions,
  OfficeLifePerson,
  OfficeLifeState,
  OfficeSpot,
  PlaceInfo,
  PlaceRef,
  PlannedHuddle,
  PlannerPerson,
  Segment,
  ShowHuddleArgs,
  SpotKind,
  SpotSlot,
  WorkActivity,
} from './life/types';
export type { OfficePlan, OfficeSeat, PlanRoom, PlanZone, PlanCell } from './plan/types';
export type { OfficeManifest } from './art/skyline';
export type {
  Camera,
  District,
  FaceFactory,
  FaceSlot,
  FaceTier,
  HoverVia,
  OfficeCallbacks,
  OfficeGroup,
  OfficeInsets,
  OfficeMode,
  OfficeOptions,
  OfficePerson,
  OfficeRoomSpec,
  OfficeScene,
  OfficeState,
  OfficeTheme,
  PresenceBadge,
  PresenceState,
  TimeOfDay,
} from './types';
