import type { District, Facing, Point, Rect } from '../types';

export interface PlanCell {
  id: string;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  role: 'pod' | 'room' | 'chief' | 'amenity';
  amenity?: 'cafe' | 'lounge' | 'library';
  roomId?: string;
}

export interface PlanZone {
  id: string;
  groupId: string;
  name: string;
  district: District;
  cellIds: string[];
  rect: Rect;
  /** Door plate anchor (plan u). */
  plate: Point;
  seatIds: string[];
  headcount: number;
  /** Fill-order index. */
  order: number;
}

export interface OfficeSeat {
  id: string;
  personId: string | null;
  zoneId: string;
  kind: 'desk' | 'chief';
  /** Chair centre (plan u). */
  x: number;
  y: number;
  facing: Facing;
  desk: Rect;
  /** Face anchor: plan x, y and the height z the badge floats at. */
  badge: { x: number; y: number; z: number };
  /** Monitor centre on the desk top (plan u), for the light layer. */
  monitor: Point;
  /** Desk lamp position (plan u). */
  lamp: Point;
}

export interface RoomSeat {
  id: string;
  x: number;
  y: number;
  facing: Facing;
}

export interface PlanRoom {
  id: string;
  name: string;
  view: 'skyline' | 'garden';
  cellId: string;
  rect: Rect;
  door: Point;
  table: Rect;
  seats: RoomSeat[];
  /** Seats besides the owner. */
  capacity: number;
}

export interface PlanAmenity {
  id: 'chief' | 'cafe' | 'lounge' | 'library' | 'reception';
  rect: Rect;
}

export type PropLayer = 'floor' | 'furniture';

export interface PlanProp {
  symbol: string;
  x: number;
  y: number;
  /** Footprint (plan u) for sized props (carpets, rugs, tables, walls, counters). */
  w?: number;
  d?: number;
  /** Height (u) for sized props. */
  h?: number;
  variant?: number;
  facing?: Facing;
  /** Seeded turn (degrees) for pulled-out chairs. */
  turn?: number;
  layer: PropLayer;
  /** Painter's order key: the footprint's south edge. */
  sortY: number;
  seatId?: string;
  roomId?: string;
  district?: District;
}

export interface WalkGraph {
  nodes: { id: string; x: number; y: number }[];
  edges: [string, string][];
}

export interface NavEntry {
  left?: string;
  right?: string;
  up?: string;
  down?: string;
  prevZone?: string;
  nextZone?: string;
}

export interface OfficePlan {
  version: 1;
  bounds: { w: number; h: number };
  cols: number;
  cells: PlanCell[];
  zones: PlanZone[];
  seats: OfficeSeat[];
  rooms: PlanRoom[];
  amenities: PlanAmenity[];
  props: PlanProp[];
  walk: WalkGraph;
  /** Keyed by seat id; occupied seats only. */
  nav: Record<string, NavEntry>;
  chiefSeatId: string | null;
  /** personId → seat id. */
  seatOf: Record<string, string>;
  hash: string;
}
