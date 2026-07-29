import { fx, fxi, type Fx } from '../core/fixed';
import { GROUND, PROP } from './art';

export interface MapDef {
  id: number;
  key: string;
  name: string;
  blurb: string;
  w: number;
  h: number;
  ground: number;
  groundAlt: number;
  road: number;
  /** Stroke colour used to outline the edge of the lane. */
  roadEdge: string;
  /** Waypoint chains in cell coordinates. Entries may start off-grid. */
  lanes: readonly (readonly [number, number])[][];
  core: readonly [number, number];
  /** Cells that can never hold a tower (scenery). */
  blocked: readonly (readonly [number, number])[];
  propTiles: readonly number[];
}

export const MAPS: readonly MapDef[] = [
  {
    id: 0,
    key: 'twin-gates',
    name: 'Twin Gates',
    blurb: 'Two lanes pour in from the north and merge before the keep.',
    w: 14,
    h: 20,
    ground: GROUND.grass,
    groundAlt: GROUND.grassAlt,
    // A dirt track on grass: maximum contrast, so the lane is unmistakable.
    road: GROUND.dirt,
    roadEdge: 'rgba(90,55,20,0.55)',
    lanes: [
      [[2, -1], [2, 4], [5, 4], [5, 8], [7, 8], [7, 11], [2, 11], [2, 15], [7, 15], [7, 18]],
      [[11, -1], [11, 4], [9, 4], [9, 8], [7, 8], [7, 11], [2, 11], [2, 15], [7, 15], [7, 18]],
    ],
    core: [7, 18],
    blocked: [[0, 8], [1, 8], [12, 12], [13, 12], [0, 17], [13, 6], [5, 17], [9, 17]],
    propTiles: [PROP.tree, PROP.bushLarge, PROP.bushSmall, PROP.spikePlant],
  },
  {
    id: 1,
    key: 'serpent-pass',
    name: 'Serpent Pass',
    blurb: 'One long switchback. Everything has to walk the whole gauntlet.',
    w: 14,
    h: 20,
    ground: GROUND.sand,
    groundAlt: GROUND.sandAlt,
    road: GROUND.stone,
    roadEdge: 'rgba(45,65,80,0.55)',
    lanes: [
      [[7, -1], [7, 3], [2, 3], [2, 7], [11, 7], [11, 11], [3, 11], [3, 15], [7, 15], [7, 18]],
    ],
    core: [7, 18],
    blocked: [[0, 1], [13, 1], [0, 13], [13, 16], [12, 17], [1, 17], [6, 0], [8, 0]],
    propTiles: [PROP.rockLarge, PROP.rockMed, PROP.rockSmall, PROP.spikePlant],
  },
  {
    id: 2,
    key: 'iron-fork',
    name: 'Iron Fork',
    blurb: 'Flanking columns from east and west. Split your attention.',
    w: 14,
    h: 20,
    ground: GROUND.stone,
    groundAlt: GROUND.stoneAlt,
    road: GROUND.sand,
    roadEdge: 'rgba(120,100,60,0.55)',
    lanes: [
      [[-1, 3], [4, 3], [4, 8], [1, 8], [1, 13], [7, 13], [7, 18]],
      [[14, 3], [9, 3], [9, 8], [12, 8], [12, 13], [7, 13], [7, 18]],
    ],
    core: [7, 18],
    blocked: [[6, 5], [7, 5], [6, 6], [7, 6], [0, 18], [13, 18], [2, 0], [11, 0]],
    propTiles: [PROP.rockMed, PROP.rockLarge, PROP.bushSmall, PROP.leaf],
  },
];

export function getMap(id: number): MapDef {
  return MAPS[id] ?? MAPS[0];
}

// ------------------------------------------------------------------ derived

export interface LanePath {
  /** Waypoints in fixed-point world units (cell centres). */
  pts: { x: Fx; y: Fx }[];
  /** Cumulative distance at each waypoint. */
  cum: Fx[];
  total: Fx;
}

export interface MapRuntime {
  def: MapDef;
  lanes: LanePath[];
  /** `true` where a lane runs - not buildable. */
  pathCells: boolean[];
  /** `true` where scenery blocks building. */
  blockedCells: boolean[];
  coreX: Fx;
  coreY: Fx;
  /** Longest lane length, used to normalise "how far along" comparisons. */
  maxLaneLen: Fx;
}

const runtimeCache = new Map<number, MapRuntime>();

/** Cell centre in world units. */
export function cellCenter(c: number): Fx {
  return fxi(c) + (1 << 15);
}

export function buildMapRuntime(id: number): MapRuntime {
  const cached = runtimeCache.get(id);
  if (cached) return cached;

  const def = getMap(id);
  const pathCells = new Array<boolean>(def.w * def.h).fill(false);
  const blockedCells = new Array<boolean>(def.w * def.h).fill(false);

  const lanes: LanePath[] = def.lanes.map((wps) => {
    const pts = wps.map(([cx, cy]) => ({ x: cellCenter(cx), y: cellCenter(cy) }));
    const cum: Fx[] = [0];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      // Lanes are axis-aligned by construction, so |dx| + |dy| is exact.
      total += Math.abs(dx) + Math.abs(dy);
      cum.push(total);
    }
    return { pts, cum, total };
  });

  // Rasterise every lane segment onto the grid so we know what is un-buildable.
  for (const wps of def.lanes) {
    for (let i = 1; i < wps.length; i++) {
      const [ax, ay] = wps[i - 1];
      const [bx, by] = wps[i];
      const stepX = Math.sign(bx - ax);
      const stepY = Math.sign(by - ay);
      let x = ax;
      let y = ay;
      markCell(pathCells, def, x, y);
      while (x !== bx || y !== by) {
        if (x !== bx) x += stepX;
        else if (y !== by) y += stepY;
        markCell(pathCells, def, x, y);
      }
    }
  }

  // Widen the un-buildable strip by nothing (towers may hug the road) but do
  // keep the core tile itself reserved.
  for (const [bx, by] of def.blocked) markCell(blockedCells, def, bx, by);
  markCell(blockedCells, def, def.core[0], def.core[1]);
  markCell(blockedCells, def, def.core[0] - 1, def.core[1]);
  markCell(blockedCells, def, def.core[0] + 1, def.core[1]);

  const rt: MapRuntime = {
    def,
    lanes,
    pathCells,
    blockedCells,
    coreX: cellCenter(def.core[0]),
    coreY: cellCenter(def.core[1]),
    maxLaneLen: lanes.reduce((m, l) => Math.max(m, l.total), 0),
  };
  runtimeCache.set(id, rt);
  return rt;
}

function markCell(arr: boolean[], def: MapDef, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= def.w || y >= def.h) return;
  arr[y * def.w + x] = true;
}

export function isBuildable(rt: MapRuntime, cx: number, cy: number): boolean {
  const { w, h } = rt.def;
  if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
  const i = cy * w + cx;
  return !rt.pathCells[i] && !rt.blockedCells[i];
}

/** Spawn point for a lane, pulled one cell further off-screen. */
export function laneSpawn(rt: MapRuntime, lane: number): { x: Fx; y: Fx } {
  const l = rt.lanes[lane % rt.lanes.length];
  return { x: l.pts[0].x, y: l.pts[0].y };
}

/** Straight-line flight distance for flyers, used for "first" targeting. */
export const FLYER_LANE_LEN: Fx = fx(24);
