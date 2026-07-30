import { fx, type Fx } from '../core/fixed';
import { buildMapRuntime, cellCenter } from '../content/maps';
import { heroDef } from '../content/heroes';
import { generateShop } from '../content/waves';
import { itemDef, MAX_ITEM_SLOTS } from '../content/items';
import { SKILLS } from '../content/skills';
import { sec, type GameState, type Hero, type PlayerState, Phase } from './types';

export interface MatchPlayerConfig {
  name: string;
  heroId: number;
}

export interface MatchConfig {
  seed: number;
  mapId: number;
  players: MatchPlayerConfig[];
  startGold: number;
  startLives: number;
  /** 0 = Normal, 1 = Hard, 2 = Nightmare. Scales enemy health. */
  difficulty: number;
}

export const DIFFICULTIES = [
  { key: 'normal', name: 'Normal', hpPct: 100, goldPct: 100, lives: 20 },
  { key: 'hard', name: 'Hard', hpPct: 135, goldPct: 92, lives: 15 },
  { key: 'nightmare', name: 'Nightmare', hpPct: 180, goldPct: 85, lives: 10 },
] as const;

function makeHero(defId: number, x: Fx, y: Fx): Hero {
  const d = heroDef(defId);
  return {
    defId,
    x, y, px: x, py: y,
    dx: 0, dy: fx(-1),
    mx: x, my: y,
    moving: false,
    hp: d.hp,
    maxHp: d.hp,
    level: 1,
    xp: 0,
    attackCd: 0,
    abilityCd: 0,
    abilityT: 0,
    targetId: 0,
    respawn: 0,
    alive: true,
    regenAcc: 0,
    anim: 0,
  };
}

/**
 * Where each player's hero starts, as cell offsets from the keep. Flanking the
 * keep first, then around it for the remaining players.
 */
const HERO_SPAWN_OFFSETS: readonly (readonly [number, number])[] = [
  [-2, -2], [2, -2], [0, -3], [-3, -1], [3, -1], [0, -1],
];

export function createState(cfg: MatchConfig): GameState {
  const rt = buildMapRuntime(cfg.mapId);
  const diff = DIFFICULTIES[cfg.difficulty] ?? DIFFICULTIES[0];

  const players: PlayerState[] = cfg.players.map((p, i) => {
    const off = HERO_SPAWN_OFFSETS[i % HERO_SPAWN_OFFSETS.length];
    const spawnX = cellCenter(rt.def.core[0] + off[0]);
    const spawnY = cellCenter(rt.def.core[1] + off[1]);
    return {
      idx: i,
      gold: cfg.startGold,
      hero: makeHero(p.heroId, spawnX, spawnY),
      relics: [],
      items: [],
      skills: [],
      powerCooldowns: new Array(SKILLS.length).fill(0),
      skillPoints: 0,
      ready: false,
      kills: 0,
      damage: 0,
      goldEarned: 0,
      towersBuilt: 0,
    };
  });

  const state: GameState = {
    tick: 0,
    rng: cfg.seed >>> 0 || 1,
    mapId: cfg.mapId,
    seed: cfg.seed >>> 0 || 1,
    difficulty: cfg.difficulty,
    phase: Phase.Build,
    phaseTimer: 0,
    wave: 0,
    lives: diff.lives,
    maxLives: diff.lives,
    nextId: 1,
    players,
    enemies: [],
    towers: [],
    soldiers: [],
    projectiles: [],
    grounds: [],
    worldItems: [],
    spawns: [],
    shop: [],
    shopWave: -1,
    killCount: 0,
    leaked: 0,
    score: 0,
    gameOver: false,
    bestWave: 0,
    waveMod: 0,
    waveReward: 0,
    overload: players.map(() => 0),
    globalSlowPct: 0,
    globalSlowT: 0,
    nextItemSpawn: sec(12),
  };

  refreshShop(state, 1);
  return state;
}

/** Add a late-joining hero without disturbing the fight already in progress. */
export function addPlayerToState(state: GameState, player: MatchPlayerConfig): PlayerState {
  const idx = state.players.length;
  const rt = buildMapRuntime(state.mapId);
  const off = HERO_SPAWN_OFFSETS[idx % HERO_SPAWN_OFFSETS.length];
  const spawnX = cellCenter(rt.def.core[0] + off[0]);
  const spawnY = cellCenter(rt.def.core[1] + off[1]);
  const joined: PlayerState = {
    idx,
    gold: 280,
    hero: makeHero(player.heroId, spawnX, spawnY),
    relics: [], items: [], skills: [], powerCooldowns: new Array(SKILLS.length).fill(0), skillPoints: 0, ready: false,
    kills: 0, damage: 0, goldEarned: 0, towersBuilt: 0,
  };
  state.players.push(joined);
  state.overload.push(0);
  return joined;
}

export function refreshShop(state: GameState, wave: number): void {
  if (state.shopWave === wave) return;
  state.shopWave = wave;
  state.shop = generateShop(state.seed, wave).map((s) => ({
    kind: s.kind,
    id: s.id,
    cost: s.kind === 0 ? relicCost(s.id) : itemDef(s.id).cost,
    soldTo: 0,
  }));
}

function relicCost(id: number): number {
  // Imported lazily to avoid a cycle at module-init time.
  return RELIC_COSTS[id] ?? 250;
}

// Mirrors src/content/items.ts RELICS costs; kept as a flat table so the shop
// generator has no import cycle with the state module.
const RELIC_COSTS: readonly number[] = [260, 240, 300, 280, 250, 230, 250, 320, 270, 240, 290, 300];

export function nextId(state: GameState): number {
  return state.nextId++;
}

export function findTower(state: GameState, id: number) {
  for (let i = 0; i < state.towers.length; i++) {
    if (state.towers[i].id === id) return state.towers[i];
  }
  return null;
}

export function findEnemy(state: GameState, id: number) {
  for (let i = 0; i < state.enemies.length; i++) {
    if (state.enemies[i].id === id) return state.enemies[i];
  }
  return null;
}

export function itemSlotCount(p: PlayerState): number {
  return p.items.length;
}

export function hasItemRoom(p: PlayerState): boolean {
  return p.items.length < MAX_ITEM_SLOTS;
}

// ---------------------------------------------------------------- hashing

const FNV_PRIME = 0x01000193;

function mix(h: number, v: number): number {
  // Fold a 32-bit value in one byte at a time (FNV-1a).
  let x = h;
  let n = v | 0;
  for (let i = 0; i < 4; i++) {
    x = Math.imul(x ^ (n & 0xff), FNV_PRIME) >>> 0;
    n >>= 8;
  }
  return x >>> 0;
}

/**
 * A 32-bit fingerprint of everything the simulation depends on.
 *
 * Peers swap this a few times a second; if it ever differs we know the two
 * worlds have drifted apart and can resynchronise instead of silently showing
 * two different games.
 */
export function hashState(s: GameState): number {
  let h = 0x811c9dc5;
  h = mix(h, s.tick);
  h = mix(h, s.rng);
  h = mix(h, s.phase);
  h = mix(h, s.phaseTimer);
  h = mix(h, s.wave);
  h = mix(h, s.lives);
  h = mix(h, s.nextId);
  h = mix(h, s.killCount);
  h = mix(h, s.leaked);
  h = mix(h, s.score);
  h = mix(h, s.gameOver ? 1 : 0);
  h = mix(h, s.globalSlowPct);
  h = mix(h, s.globalSlowT);

  for (const p of s.players) {
    h = mix(h, p.gold);
    h = mix(h, p.kills);
    h = mix(h, p.ready ? 1 : 0);
    h = mix(h, p.relics.length);
    for (const r of p.relics) h = mix(h, r);
    for (const it of p.items) h = mix(h, it.itemId * 31 + it.charges);
    h = mix(h, p.skillPoints);
    for (const sk of p.skills) h = mix(h, sk);
    for (const cd of p.powerCooldowns) h = mix(h, cd);
    const hero = p.hero;
    h = mix(h, hero.x);
    h = mix(h, hero.y);
    h = mix(h, hero.hp);
    h = mix(h, hero.level);
    h = mix(h, hero.xp);
    h = mix(h, hero.abilityCd);
    h = mix(h, hero.respawn);
    h = mix(h, hero.alive ? 1 : 0);
  }

  for (const t of s.towers) {
    h = mix(h, t.id);
    h = mix(h, t.defId * 97 + t.power * 13 + t.level);
    h = mix(h, t.cx * 64 + t.cy);
    h = mix(h, t.cd);
    h = mix(h, t.targetMode);
    h = mix(h, t.charge);
    h = mix(h, t.temp);
    h = mix(h, t.rx);
    h = mix(h, t.ry);
  }

  for (const sd of s.soldiers) {
    h = mix(h, sd.id);
    h = mix(h, sd.x);
    h = mix(h, sd.y);
    h = mix(h, sd.hp);
    h = mix(h, sd.targetId);
    h = mix(h, sd.attackCd);
  }

  for (const e of s.enemies) {
    h = mix(h, e.id);
    h = mix(h, e.x);
    h = mix(h, e.y);
    h = mix(h, e.hp);
    h = mix(h, e.shield);
    h = mix(h, e.wp);
    h = mix(h, e.blockedBy);
    h = mix(h, e.slowT * 128 + e.slowPct);
    h = mix(h, e.stunT);
    h = mix(h, e.burnT);
    h = mix(h, e.poisonT);
  }

  for (const p of s.projectiles) {
    h = mix(h, p.id);
    h = mix(h, p.x);
    h = mix(h, p.y);
    h = mix(h, p.targetId);
    h = mix(h, p.damage);
  }

  for (const g of s.grounds) {
    h = mix(h, g.id);
    h = mix(h, g.x);
    h = mix(h, g.y);
    h = mix(h, g.life);
  }
  for (const it of s.worldItems) {
    h = mix(h, it.id); h = mix(h, it.itemId); h = mix(h, it.x); h = mix(h, it.y); h = mix(h, it.life);
  }
  h = mix(h, s.nextItemSpawn);

  h = mix(h, s.spawns.length);
  return h >>> 0;
}

/** Deep clone via structured data only - used for desync recovery snapshots. */
export function cloneState(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}
