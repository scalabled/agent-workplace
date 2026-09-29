// @headcount/office (OFFICE-PLAN §5.3): the Office view. A framework-agnostic 3/4 top-down office floor with desks,
// glass conference rooms, typical office things and a city skyline, plus the conference stage. No dependencies.
export { createOfficeScene } from './scene/scene';
export { planOffice, DEFAULT_ROOMS } from './plan/plan';
export { DISTRICT_ORDER } from './plan/districts';
export { timeOfDayAt } from './time';
export { DEFAULT_STRINGS } from './strings';
export { hitTest } from './plan/hit';
export { project, unproject, toScreen, fromScreen } from './projection';
export { fitCamera, cameraBounds, clampCamera, zoomAround } from './scene/camera';
export type { OfficeStrings } from './strings';
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
