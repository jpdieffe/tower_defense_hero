/**
 * Atlas coordinates for `public/assets/sprites/towerDefense_tilesheet.png`
 * (Kenney "Tower Defense (Top-Down)", CC0).
 *
 * The sheet is a plain 23x13 grid of 64x64 tiles, so a sprite is just an index.
 */

export const SHEET_COLS = 23;
export const SHEET_ROWS = 13;
export const TILE_PX = 64;

/** Grid position -> sprite index. */
export function T(col: number, row: number): number {
  return row * SHEET_COLS + col;
}

// --- terrain -------------------------------------------------------------
// Only flat, seamless tiles are used as ground; the decorative "blob" tiles in
// this pack are designed to be combined and read as noise when scattered.
export const GROUND = {
  grass: T(10, 3),
  grassAlt: T(12, 3),
  dirt: T(10, 0),
  dirtAlt: T(12, 0),
  sand: T(10, 6),
  sandAlt: T(12, 6),
  stone: T(10, 9),
  stoneAlt: T(12, 9),
} as const;

/** Road/path tiles: vertical strip, in the four terrain colourways. */
export const ROAD = {
  grass: T(15, 7),
  dirt: T(16, 7),
  stone: T(17, 7),
  sand: T(18, 7),
  grassDash: T(15, 8),
  dirtDash: T(16, 8),
  stoneDash: T(17, 8),
  sandDash: T(18, 8),
} as const;

// --- buildable platforms -------------------------------------------------
// rows: 0 dark, 1 green, 2 brown, 3 blue-grey, 4 sand
// cols: 15 plain | 16 wrench | 17 cross | 18 target   (and 19..22 textured)
export const PLATFORM = {
  emptyPlot: T(16, 3),
  emptyPlotAlt: T(16, 4),
  towerBaseP1: T(15, 3),
  towerBaseP2: T(15, 4),
  towerBaseP3: T(15, 1),
  towerBaseDark: T(15, 0),
  towerBaseGreen: T(15, 1),
  towerBaseBrown: T(15, 2),
  targetPlot: T(18, 3),
} as const;

// --- turret heads --------------------------------------------------------
export const HEAD = {
  dualBarrel: T(19, 8),
  dualMissile: T(20, 8),
  quadRocket: T(21, 8),
  singleRocket: T(22, 8),
  heavyRound: T(19, 9),
  tripleSlot: T(20, 9),
  plateWide: T(21, 9),
  plateNarrow: T(22, 9),
  flaskGreen: T(19, 10),
  flaskRed: T(20, 10),
} as const;

// --- units ---------------------------------------------------------------
export const UNIT = {
  soldierGreen: T(15, 10),
  soldierBlue: T(16, 10),
  soldierOrange: T(17, 10),
  soldierGrey: T(18, 10),
  tankGreen: T(15, 11),
  tankSand: T(16, 11),
  planeGreen: T(17, 11),
  planeGrey: T(18, 11),
  planeShadowA: T(17, 12),
  planeShadowB: T(18, 12),
} as const;

// --- projectiles, pickups, fx -------------------------------------------
export const FXART = {
  rocketSmall: T(21, 10),
  rocketLarge: T(22, 10),
  coinGold: T(19, 11),
  bulletWhite: T(20, 11),
  bulletBronze: T(21, 11),
  bulletPale: T(22, 11),
  flameSmall: T(19, 12),
  flameMed: T(20, 12),
  flameTall: T(21, 12),
  flameBig: T(22, 12),
  smokeA: T(19, 0),
  smokeB: T(20, 0),
  smokeC: T(21, 0),
  sparkle: T(22, 0),
} as const;

// --- props / scenery -----------------------------------------------------
export const PROP = {
  bushLarge: T(15, 5),
  bushSmall: T(16, 5),
  leaf: T(17, 5),
  tree: T(18, 5),
  spikePlant: T(19, 5),
  rockSmall: T(20, 5),
  rockMed: T(21, 5),
  rockLarge: T(22, 5),
} as const;

/** The crystal sprites double as the objective "core". */
export const CRYSTAL = {
  square: T(19, 7),
  octagon: T(20, 7),
  chipped: T(21, 7),
  diamond: T(22, 7),
} as const;

/** Bitmap font row: 0-9 then % $ : + . */
export const GLYPH_ROW = 12;
export const GLYPHS = '0123456789%$:+.';
