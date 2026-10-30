// The floor plate template. 1 u = 10 cm. Cells 96 × 80 u in an 8 × 3 grid; 16 u aisles between
// columns; 14 u window clearance (north), a 24 u boulevard, an 18 u aisle and a 34 u reception strip (south).

export const CELL_W = 96;
export const CELL_H = 80;
export const AISLE_X = 16;
export const COL_PITCH = CELL_W + AISLE_X;
export const NORTH_CLEAR = 14;
export const BOULEVARD = 24;
export const LOWER_AISLE = 18;
export const RECEPTION = 34;
export const BASE_COLS = 8;
export const ROWS = 3;
export const ROW_Y = [NORTH_CLEAR, NORTH_CLEAR + CELL_H + BOULEVARD, NORTH_CLEAR + CELL_H + BOULEVARD + CELL_H + LOWER_AISLE] as const;
export const PLATE_H = ROW_Y[2] + CELL_H + RECEPTION; // 330

/** Seat geometry inside a neighbourhood cell. */
export const HEAD_W = 18;
export const DESK_PITCH = 16;
export const DESK_W = 15.4;
export const DESK_D = 8;
export const DESK_Z = 7.3;
export const SCREEN_Z = 11.5;
/** Bench offsets from the cell top: chair zone 9, desk 8, screen 1, desk 8, chair zone 9; benches at +2 and +43. */
export const BENCH_Y = [2, 43] as const;
export const WALL_Z = 30;
export const GLASS_Z = 28;

/** Corridor centre lines (plan y) for walks. */
export const CORRIDORS = {
  north: NORTH_CLEAR / 2,
  boulevard: ROW_Y[0] + CELL_H + BOULEVARD / 2,
  aisle: ROW_Y[1] + CELL_H + LOWER_AISLE / 2,
  reception: ROW_Y[2] + CELL_H + RECEPTION / 2,
} as const;

export const plateWidth = (cols: number): number => cols * COL_PITCH - AISLE_X;
export const colX = (col: number): number => col * COL_PITCH;
