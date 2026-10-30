// Office life: the public shapes of the autonomous layer. Declared locally like the
// rest of @headcount/office (no dependencies); the host passes personality as plain data.
import type { Facing, OfficePerson, Point, PresenceBadge, PresenceState } from '../types';

export type Ambience = 'quiet' | 'lively' | 'buzzing';
export type SpotKind = 'coffee_bar' | 'water_cooler' | 'lounge' | 'library' | 'phone_booth' | 'window' | 'hallway' | 'desk_dropby';
export type LifeState = 'desk' | 'break' | 'huddle' | 'visit' | 'walking' | 'focus' | 'call' | 'meeting' | 'held';
export type WorkActivity = 'research' | 'document' | 'analysis' | 'review' | 'image' | 'video' | 'app' | 'files' | 'meeting';
export type ArchetypeName =
  | 'warm' | 'dry-wit' | 'energetic' | 'calm-steady' | 'blunt' | 'playful'
  | 'meticulous' | 'gentle' | 'hustler' | 'visionary' | 'analytical' | 'veteran';
export type SliderName = 'warmth' | 'directness' | 'formality' | 'humor' | 'risk_appetite' | 'detail' | 'pace';
export type AnchorKind = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' | 'floor_walk';

/** Personality as plain data (§2.1). Missing data falls back to neutral values. */
export interface OfficeLifePerson {
  /** The OfficePerson id. */
  id: string;
  sliders?: Partial<Record<SliderName, number>>;
  traits?: readonly string[];
  /** resolveBlend() from @headcount/expressions, e.g. {meticulous: .56, 'calm-steady': .22, analytical: .22}. */
  blend?: Readonly<Partial<Record<ArchetypeName, number>>>;
  /** Person ids. */
  pairsWellWith?: readonly string[];
  tensionWith?: readonly string[];
  teamRoles?: readonly string[];
}

/** A person as the planner sees them: personality plus the scene's department and seniority. */
export type PlannerPerson = OfficeLifePerson & Pick<OfficePerson, 'groupId' | 'seniority'>;

export type PlaceRef =
  | { kind: 'desk' }
  | { kind: 'spot'; spotId: string; slot: number }
  | { kind: 'room'; roomId: string; seat: number }
  | { kind: 'point'; x: number; y: number; facing?: Facing };

export interface SpotSlot {
  /** Where the person stands or sits (plan u). */
  x: number;
  y: number;
  facing: Facing;
  posture: 'stand' | 'sit';
  /** A clear point in front of the slot (for seats: where you stand before sitting). */
  front: Point;
}

export interface OfficeSpot {
  /** 'cafe:counter', 'cooler:cafe', 'lounge:main', 'nook:<zoneId>:<cell>', 'window:c3', 'hall:b2', 'booth:0', 'desk:<seatId>' */
  id: string;
  kind: SpotKind;
  label: string;
  /** What people face. */
  center: Point;
  slots: readonly SpotSlot[];
  /** Standing alone here reads as a break (false for hallways: they are for brief chats). */
  solo: boolean;
  /** Phone booths: real calls only. */
  realOnly: boolean;
  /** Whether ambient huddles may form here, and their largest size. */
  huddle: number;
  zoneId?: string;
  seatId?: string;
  /** The plate column the spot belongs to (windows, hallways, nooks). */
  col: number;
  /** Time-of-day multipliers. */
  tod: { night: number; dusk: number };
}

export interface Segment {
  personId: string;
  state: 'break' | 'huddle' | 'visit';
  place: PlaceRef & { kind: 'spot' };
  /** Leaves the previous place (epoch ms). */
  departAt: number;
  /** Arrives at the place. */
  start: number;
  /** Leaves the place. */
  end: number;
  /** Back at the desk; null when the next segment follows straight on (the Chief's floor walk). */
  backAt: number | null;
  huddleId?: string;
  anchor?: AnchorKind;
  crewId?: string;
  /** For visits: the host's person id. */
  hostId?: string;
}

export interface PlannedHuddle {
  id: string;
  spotId: string;
  kind: SpotKind;
  members: string[];
  start: number;
  end: number;
  crewId?: string;
  anchor?: AnchorKind;
  /** A habit: the stable owner-local minute this crew or anchor huddle usually happens (without the daily jitter). */
  usualMin?: number;
  /** Desk drop-bys: the colleague at their own desk. */
  hostId?: string;
}

export interface DayPlan {
  version: 1;
  dayKey: string;
  seed: string;
  ambience: Ambience;
  dayStart: number;
  dayEnd: number;
  segments: Record<string, Segment[]>;
  huddles: PlannedHuddle[];
  crews: { id: string; members: string[]; spotId: string }[];
  hash: string;
}

export interface LifeCaps {
  /** Walkers at once. */
  walkers: number;
  /** Active huddles at once. */
  huddles: number;
  /** Largest ad-hoc huddle. */
  maxHuddle: number;
  /** Largest anchor huddle. */
  maxAnchorHuddle: number;
  /** Visible huddle bubbles (A1). */
  huddleBubbles: number;
  /** Small-talk exchanges per huddle (while not listened to). */
  exchangesPerHuddle: number;
  /** Visible small-talk lines per minute, and the burst. */
  linesPerMin: number;
  burst: number;
  /** Most turns in one exchange. */
  maxLines: number;
}

export interface OfficeLifeState {
  planHash: string | null;
  dayKey: string | null;
  ambience: Ambience;
  suspended: boolean;
  paused: boolean;
  reducedMotion: boolean;
  walkers: number;
  huddles: number;
  bubbles: number;
  caps: LifeCaps;
  budget: { tokens: number; linesThisMinute: number };
  listening: string | null;
  joined: string | null;
}

// ── small talk ─────────────────────────────────────────────────────────────────
export interface HuddleLineRequest {
  huddleId: string;
  spot: { id: string; kind: SpotKind };
  participants: readonly string[];
  exchangeIndex: number;
  maxLines: number;
  /** `${huddleId}|${exchangeIndex}|${exchanges played}` (a murmur cut short by a zoom-in does not repeat its seed). */
  seed: string;
  at: Date;
  ambience: Ambience;
  listening: boolean;
  /** 'crew', 'first_today', 'same_department', 'cross_department', 'night', 'spot_empty' (nobody else at the spot) */
  contexts: readonly string[];
  /** Exchange ids already played in this huddle (the host passes them to pickExchange as `avoid`). */
  previous?: readonly string[];
  /** Desk drop-bys: the colleague at their own desk (the host casts `at_desk` roles with it). */
  hostId?: string | null;
}
export interface HuddleScriptLine {
  personId: string;
  kind: 'line' | 'laugh' | 'face';
  /** Bubble and caption text ('' for a face beat). */
  text: string;
  face?: string;
  /** Start offset from the exchange start (ms). */
  atMs: number;
  /** Estimated duration (ms). */
  estMs: number;
  data?: unknown;
}
export interface HuddleScript {
  exchangeId: string;
  topic?: string;
  grounded?: boolean;
  lines: readonly HuddleScriptLine[];
  data?: unknown;
}
export interface HuddleLineEvent {
  exchangeId: string;
  index: number;
  line: HuddleScriptLine;
  /** Shown as a bubble (or in the open huddle card). */
  visible: boolean;
  /** Shown only as the huddle's glyph at plan zoom (the words are in the card and the pill's tooltip). */
  glyph?: boolean;
  listening: boolean;
}

export interface PlaceInfo {
  place: PlaceRef;
  kind: 'desk' | 'room' | 'walking' | SpotKind;
  label: string;
  state: LifeState;
  since: number;
}

export interface HuddleInfo {
  id: string;
  spotId: string;
  spot: SpotKind;
  label: string;
  members: string[];
  startedAt: number;
  endsAt: number;
  joined: boolean;
  listening: boolean;
  crew: boolean;
  /** Desk drop-bys: the colleague at their own desk. */
  hostId?: string;
  /** A habit: the owner-local minute this crew or anchor huddle usually happens. */
  usualMin?: number;
}

export interface Moment {
  id: string;
  kind: 'raised_hand' | 'welcome' | 'win' | 'debate' | 'huddle' | 'work_move' | 'night_window' | 'arrival';
  /** Projected plate point to frame. */
  at: Point;
  zoom: number;
  personIds: string[];
  huddleId?: string;
  score: number;
  endsAt: number;
  label: string;
  /** How long the autopilot should hold it (a raised hand ≤ 10 s; a huddle mid-exchange for its remaining turns). */
  holdMs?: number;
  /** A huddle's latest line (the What's happening item previews it). */
  line?: { personId: string; text: string };
  /** A habit: the owner-local minute this crew or anchor huddle usually happens ("Their usual 10:40"). */
  usualMin?: number;
  /** The place, as a phrase ("at the water cooler"). */
  where?: string;
}

export interface LifeSummary {
  huddles: number;
  /** People away from their desk: on a break, in a huddle or walking (all of them available). */
  away: number;
  walking: number;
  paused: boolean;
  night: boolean;
  /** People standing at the north glass (the night pill says "3 at the windows"). */
  atWindows?: number;
  top: Moment | null;
  moments?: readonly Moment[];
}

// ── the scene port (additive scene API, §6.1) ────────────────────────────────────
export type Pace = 'stroll' | 'brisk' | 'instant';
export type Cue = 'nod' | 'look_up' | 'smile' | 'head_tilt' | 'brow_flash';
export type HoldWhy = 'hover' | 'focus' | 'drag' | 'bubble' | 'anchor';
export type HuddleAction = 'open' | 'join' | 'listen' | 'leave' | 'talk' | 'room' | 'close';

export interface MoveHandle {
  /** Real (wall-clock) duration of the move, including any delay. */
  readonly durationMs: number;
  /** Eases to a stop (≤ 0.5 s) where the person is. */
  cancel(): void;
  /** true on arrival, false when cancelled or superseded. */
  readonly done: Promise<boolean>;
}

export interface MoveOptions {
  pace?: Pace;
  /** Cruise speed (u/s) for strolls. */
  speed?: number;
  delayMs?: number;
  /** Start partway (a walk in progress when the office opens). */
  elapsedMs?: number;
  /** Instant moves fade (160 ms out, 160 ms in) unless false (the opening placement). */
  fade?: boolean;
  /** Turn toward this on arrival. */
  face?: Facing | 'viewer' | Point;
}

export interface ShowHuddleArgs {
  id: string;
  members: string[];
  /** Plan point (floor) at the group's centre. */
  center: Point;
  label: string;
  talking: boolean;
  joined: boolean;
  listening: boolean;
  lines: readonly { personId: string; text: string; nonverbal?: boolean }[];
  /** Whoever is saying a line right now (the plan-zoom glyph pulses in their accent). */
  speaker?: string | null;
  /** Desk drop-bys: the colleague at their own desk (the card says "At Jasleen's desk · Nayra visiting"). */
  hostId?: string;
  /** A habit: the owner-local minute this crew or anchor huddle usually happens ("Their usual 10:40 …"). */
  usualMin?: number;
  /** The place as a phrase, for the habit line ("at the water cooler"). */
  where?: string;
}

export interface LifeHooks {
  onHold(personId: string, held: boolean, why: HoldWhy): void;
  onHuddleAction(id: string, action: HuddleAction, text?: string): void;
  onPauseToggle(paused: boolean): void;
  /** Camera settled or LOD changed (visibility may differ); `input` says the owner moved it (not autopilot or follow). */
  onViewChange(info?: { input?: boolean }): void;
  /** The camera follows this person (null: nobody): they keep walking; hover and focus do not hold them. */
  onFollow?(personId: string | null): void;
  /** The autopilot flew to this moment. */
  onMomentShown?(m: Moment): void;
  /** Presence as the scene knows it (setPresence / setSpeaking). */
  onPresence?(personId: string, state: PresenceState, badges: readonly PresenceBadge[], speaking: boolean): void;
  /** Room seating changed (null = back at the desk). */
  onRoom?(personId: string, roomId: string | null): void;
  /** People were re-planned (setPeople). */
  onReplan?(): void;
  /** The conference stage opened or closed (the floor is off-screen for life while it is open). */
  onStage?(open: boolean): void;
}

/** What the director needs from the scene. `OfficeScene` implements it. */
export interface LifeScenePort {
  readonly el: HTMLElement;
  getPlan(): import('../plan/types').OfficePlan;
  spots(): readonly OfficeSpot[];
  moveTo(personId: string, to: PlaceRef, opts?: MoveOptions): MoveHandle;
  placeOf(personId: string): { place: PlaceRef; x: number; y: number; walking: boolean };
  face(personId: string, toward: Facing | 'viewer' | Point, opts?: { lean?: number }): void;
  cue(personId: string, gesture: Cue): void;
  say(personId: string, text: string, opts: { huddleId: string; ttlMs: number; nonverbal?: boolean }): void;
  unsay?(personId: string): void;
  /** 0 off-screen, 1 L0, 2 L1, 3 L2. */
  visibility(personId: string): 0 | 1 | 2 | 3;
  /** Visibility of a plan point. */
  visibilityAt?(p: Point): 0 | 1 | 2 | 3;
  showHuddle(h: ShowHuddleArgs): void;
  hideHuddle(id: string): void;
  setLifeSummary(s: LifeSummary | null): void;
  follow(personId: string | null): void;
  setAutopilot(on: boolean): void;
  offerMoment(m: Moment | null): void;
  attachLife(hooks: LifeHooks): () => void;
  getState(): { mode: string; hoveredId: string | null; focusedId: string | null; rooms: Record<string, string[]>; camera?: { x: number; y: number; zoom: number } };
  nameOf?(personId: string): string;
  /** Owner-facing bubbles (a joined huddle's replies): never capped, never replaced by small talk. */
  showBubble?(personId: string, text: string, opts?: { ttlMs?: number; passive?: boolean }): void;
  /** Shorten these people's owner-facing bubbles to at most `maxMs` from now (a joined huddle's replies after Leave). */
  trimBubbles?(personIds: readonly string[], maxMs: number): void;
  /** Open on this plan point at L1 when the scene is still on its default opening view and nobody has moved it. */
  frameOpening?(p: Point): void;
  /** Walk the owner into a conference room with these people (a huddle's "Open in a room"). */
  enterRoom?(roomId: string, participants?: string[]): void;
}

export type { Facing, Point };
