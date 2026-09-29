// Public types of @headcount/office (OFFICE-PLAN §5.3). Declared locally: the package has no dependencies, and
// PresenceState is a structural superset of @headcount/protocol's.

export type PresenceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'working' | 'raised_hand' | 'blocked' | 'away';
export type PresenceBadge = 'hand' | 'lamp';
export type FaceTier = 'hero' | 'tile' | 'token';
export type OfficeMode = 'desks' | 'conference';
export type TimeOfDay = 'night' | 'dusk' | 'day';
export type OfficeTheme = 'dark' | 'light';
export type HoverVia = 'pointer' | 'keyboard' | 'touch';
export type District = 'lead' | 'build' | 'grow' | 'run';
export type Facing = 'n' | 's' | 'e' | 'w';

export interface OfficePerson {
  /** Opaque; apps/web passes agent ids ('cw_<personaId>', 'cw_chief'). */
  id: string;
  name: string;
  title: string;
  /** Department id now; project pod id in Inc 1. */
  groupId: string;
  /** '#RRGGBB' catalog accent; adapted per theme via options.accentFor. */
  accent: string;
  seniority?: 'specialist' | 'senior' | 'lead' | 'principal';
}

export interface OfficeGroup {
  id: string;
  name: string;
  kind?: 'department' | 'project' | 'everyday';
  district?: District;
}

export interface OfficeRoomSpec {
  id: string;
  name: string;
  /** Includes the owner's seat. */
  seats: number;
  view: 'skyline' | 'garden';
}

/** A face the host builds (FaceView in apps/web). The office sizes and positions `el`; the host fills it. */
export interface FaceSlot {
  el: HTMLElement;
  setTier(tier: FaceTier): void;
  setState?(state: PresenceState, label?: string): void;
  destroy(): void;
  /**
   * True when the face draws its own state chrome (FaceView's hc-face__ring and glyph). The office then drops its
   * own state rings on that seat and keeps only the outer hover, focus and speaking halo, so there is one ring.
   */
  drawsChrome?: boolean;
}
export type FaceFactory = (personId: string, tier: FaceTier) => FaceSlot;

export interface OfficeCallbacks {
  onHover?(personId: string, info: { phase: 'enter' | 'dwell'; via: HoverVia }): void;
  onHoverEnd?(personId: string, info: { via: HoverVia }): void;
  onOpen?(personId: string, info: { via: 'click' | 'keyboard'; mode: OfficeMode; roomId: string | null }): void;
  /** The desk the owner is "at" (hovered or focused). */
  onFocusChange?(personId: string | null): void;
  onEnterRoom?(roomId: string, participants: string[]): void;
  /** Return false to refuse (the office then springs the badge back). */
  onInvite?(roomId: string, personIds: string[], info: { via: 'picker' | 'drag' | 'keyboard' }): void | boolean;
  onLeaveRoom?(roomId: string, participants: string[]): void;
  /** Standalone dock only (the host's own dock replaces it). */
  onTalkToRoom?(roomId: string, text: string): void;
  onModeChange?(mode: OfficeMode, roomId: string | null): void;
  /** At most 2 per second. */
  onViewportChange?(v: { personIds: string[]; roomIds: string[]; zoom: number; lod: 0 | 1 | 2 }): void;
  onRequestDirectory?(): void;
}

export interface OfficeOptions extends OfficeCallbacks {
  people: OfficePerson[];
  groups: OfficeGroup[];
  /** The Chief of Staff's person id (must be in people). */
  leadId: string;
  rooms?: OfficeRoomSpec[];
  theme?: OfficeTheme;
  timeOfDay?: TimeOfDay | 'auto';
  /** Default: initials badges. */
  faceFactory?: FaceFactory;
  accentFor?: (hex: string, theme: OfficeTheme) => string;
  /** Where manifest.json and the skyline images live. Default '/office/'. `null` forces the vector skyline. */
  assetsBase?: string | null;
  /** null/undefined follows prefers-reduced-motion. */
  reducedMotion?: boolean | null;
  initialCamera?: 'fit' | { x: number; y: number; zoom: number };
  labels?: Partial<import('./strings').OfficeStrings>;
  /** Tests. */
  now?: () => Date;
  /** Session key for restoring the camera (sessionStorage). null disables it. Default 'hc.office.camera'. */
  cameraKey?: string | null;
  /**
   * Where the keyboard map listens. 'scene' (default): keys work while focus is inside the office (the root takes
   * focus on a floor click). 'document': the host routes G, /, [ ], + − 0 and the rest from anywhere on the page
   * while the Office is the active view (typing in fields is still ignored).
   */
  keyTarget?: 'scene' | 'document';
}

export interface Camera {
  /** Projected plate coordinates (u) at the viewport centre. */
  x: number;
  y: number;
  /** Screen px per u. */
  zoom: number;
}

export interface OfficeState {
  mode: OfficeMode;
  roomId: string | null;
  /** Who is at the table of the room the owner is in (empty in desk mode). */
  participants: string[];
  /** Who is seated in each room, owner present or not (desk mode: they are waiting for the owner). */
  rooms: Record<string, string[]>;
  camera: Camera;
  lod: 0 | 1 | 2;
  focusedId: string | null;
  hoveredId: string | null;
  timeOfDay: TimeOfDay;
}

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OfficeScene {
  readonly el: HTMLElement;
  setPeople(people: OfficePerson[], groups?: OfficeGroup[], leadId?: string): void;
  setPresence(personId: string, state: PresenceState, opts?: { label?: string; badges?: PresenceBadge[] }): void;
  setSpeaking(personId: string, speaking: boolean): void;
  showBubble(personId: string, text: string, opts?: { ttlMs?: number; to?: string }): void;
  hideBubble(personId: string): void;
  anchor(personId: string): { el: HTMLElement; release(): void };
  showCaption(personId: string | null, text: string, opts?: { final?: boolean; voiced?: boolean }): void;
  setFloorQueue(personIds: string[]): void;
  focus(personId: string, opts?: { animate?: boolean; zoom?: 'keep' | 'desk' }): void;
  walkTo(target: string): void;
  zoomTo(level: 'fit' | 'neighbourhood' | 'desk' | number, at?: { x: number; y: number }): void;
  setMode(mode: OfficeMode, roomId?: string): void;
  enterRoom(roomId: string, participants?: string[]): void;
  seat(personId: string, roomId: string | null): void;
  leaveRoom(): void;
  dock(): HTMLElement;
  setTheme(theme: OfficeTheme): void;
  setTimeOfDay(tod: TimeOfDay | 'auto'): void;
  setReducedMotion(value: boolean | null): void;
  getState(): OfficeState;
  destroy(): void;
}
