import type { Fx } from '../core/fixed';

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
/** Seconds -> ticks. Content tables are authored in seconds. */
export const sec = (s: number): number => Math.round(s * TICK_RATE);

// ---------------------------------------------------------------- enums

export const DmgType = {
  Physical: 0,
  Fire: 1,
  Frost: 2,
  Energy: 3,
  Poison: 4,
  True: 5,
} as const;
export type DmgType = (typeof DmgType)[keyof typeof DmgType];

export const Phase = {
  Build: 0,
  Combat: 1,
  Defeat: 2,
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export const TargetMode = {
  First: 0,
  Last: 1,
  Strongest: 2,
  Closest: 3,
} as const;
export type TargetMode = (typeof TargetMode)[keyof typeof TargetMode];
export const TARGET_MODE_NAMES = ['First', 'Last', 'Strongest', 'Closest'];

export const ProjKind = {
  Bolt: 0,
  Shell: 1,
  Shard: 2,
  Spark: 3,
  Glob: 4,
  Slug: 5,
  Ember: 6,
  Rocket: 7,
  HeroShot: 8,
  Meteor: 9,
  GiantAxe: 10,
  SwordWave: 11,
} as const;
export type ProjKind = (typeof ProjKind)[keyof typeof ProjKind];

export const GroundKind = {
  None: 0,
  Napalm: 1,
  PoisonCloud: 2,
  FrostField: 3,
  ArrowStorm: 4,
  HolyGround: 5,
} as const;
export type GroundKind = (typeof GroundKind)[keyof typeof GroundKind];

/** Transient, render/audio-only signals produced by a simulation tick. */
export const EventKind = {
  Shot: 0,
  Hit: 1,
  Explosion: 2,
  EnemyDeath: 3,
  Leak: 4,
  TowerBuilt: 5,
  TowerUpgraded: 6,
  TowerSold: 7,
  WaveStart: 8,
  WaveCleared: 9,
  HeroAbility: 10,
  HeroDeath: 11,
  HeroLevel: 12,
  GoldGain: 13,
  ItemUsed: 14,
  Defeat: 15,
  Purchase: 16,
  Denied: 17,
  Chain: 18,
  Freeze: 19,
  BossSpawn: 20,
  SoldierSpawn: 21,
  SoldierDeath: 22,
  ItemSpawn: 23,
  ItemPickup: 24,
  SkillChosen: 25,
} as const;
export type EventKind = (typeof EventKind)[keyof typeof EventKind];

export interface SimEvent {
  kind: number;
  x: Fx;
  y: Fx;
  x2: Fx;
  y2: Fx;
  a: number;
  b: number;
  owner: number;
}

// ---------------------------------------------------------------- entities

export interface Enemy {
  id: number;
  defId: number;
  lane: number;
  wp: number;
  x: Fx; y: Fx;
  px: Fx; py: Fx;
  dx: Fx; dy: Fx;
  offX: Fx; offY: Fx;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  shieldCd: number;
  armor: number;
  armorShred: number;
  baseSpeed: Fx;
  dist: Fx;
  slowPct: number;
  slowT: number;
  stunT: number;
  burnDps: number;
  burnT: number;
  burnOwner: number;
  poisonDps: number;
  poisonT: number;
  poisonOwner: number;
  poisonStacks: number;
  /** Non-zero when a Plague Vat poisoned it: bursts into a cloud on death. */
  plagueDps: number;
  /** Percent speed bonus from boss enrage. */
  speedBonus: number;
  markT: number;
  markPct: number;
  /** Id of the barracks soldier currently holding this enemy in place. */
  blockedBy: number;
  abilityCd: number;
  spawnT: number;
  bounty: number;
  xp: number;
  flying: boolean;
  boss: boolean;
  dead: boolean;
  /** Wave the enemy belongs to - used for "wave cleared" bookkeeping. */
  wave: number;
  mod: number;
  regenAcc: number;
  tint: number;
  scale: Fx;
  anim: number;
}

export interface Tower {
  id: number;
  owner: number;
  defId: number;
  /** How many upgrades went into the Power track. The rest went into Speed. */
  power: number;
  level: number;
  cx: number; cy: number;
  x: Fx; y: Fx;
  dx: Fx; dy: Fx;
  /** Barracks rally post - where the squad stands guard. */
  rx: Fx; ry: Fx;
  cd: number;
  targetMode: number;
  targetId: number;
  invested: number;
  charge: number;
  temp: number;
  kills: number;
  damageDealt: number;
  fireAnim: number;
  pulse: number;
}

export interface Projectile {
  id: number;
  owner: number;
  towerId: number;
  kind: number;
  x: Fx; y: Fx;
  px: Fx; py: Fx;
  vx: Fx; vy: Fx;
  tx: Fx; ty: Fx;
  targetId: number;
  speed: Fx;
  damage: number;
  dmgType: number;
  splash: Fx;
  life: number;
  homing: boolean;
  arcing: boolean;
  pierce: number;
  hits: number[];
  slowPct: number;
  slowT: number;
  burnDps: number;
  burnT: number;
  poisonDps: number;
  poisonT: number;
  stunT: number;
  chains: number;
  chainRange: Fx;
  armorShred: number;
  groundKind: number;
  groundRadius: Fx;
  groundLife: number;
  scale: Fx;
}

/** A melee unit trained by a barracks tower. */
export interface Soldier {
  id: number;
  towerId: number;
  owner: number;
  /** Position within the squad, used for the rally formation. */
  slot: number;
  x: Fx; y: Fx;
  px: Fx; py: Fx;
  dx: Fx; dy: Fx;
  hp: number;
  maxHp: number;
  attackCd: number;
  targetId: number;
  regenAcc: number;
  spawnT: number;
  anim: number;
}

export interface GroundEffect {
  id: number;
  owner: number;
  kind: number;
  x: Fx; y: Fx;
  radius: Fx;
  dps: number;
  dmgType: number;
  slowPct: number;
  life: number;
  maxLife: number;
  acc: number;
}

export interface Hero {
  defId: number;
  x: Fx; y: Fx;
  px: Fx; py: Fx;
  dx: Fx; dy: Fx;
  mx: Fx; my: Fx;
  moving: boolean;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  attackCd: number;
  abilityCd: number;
  abilityT: number;
  targetId: number;
  respawn: number;
  alive: boolean;
  regenAcc: number;
  anim: number;
}

export interface ItemSlot {
  itemId: number;
  charges: number;
}

export interface WorldItem {
  id: number;
  itemId: number;
  x: Fx; y: Fx;
  life: number;
  pulse: number;
}

export interface ShopSlot {
  /** `kind` 0 = relic, 1 = consumable item. */
  kind: number;
  id: number;
  cost: number;
  soldTo: number;
}

export interface PlayerState {
  idx: number;
  gold: number;
  hero: Hero;
  relics: number[];
  items: ItemSlot[];
  skills: number[];
  /** Independent cooldown by learned skill id. Signature power stays on Hero. */
  powerCooldowns: number[];
  attackBuffKind: number;
  attackBuffT: number;
  skillPoints: number;
  ready: boolean;
  kills: number;
  damage: number;
  goldEarned: number;
  towersBuilt: number;
}

export interface SpawnOrder {
  /** Tick (absolute) at which this enemy enters the map. */
  at: number;
  defId: number;
  lane: number;
  wave: number;
  hpPct: number;
  boss: boolean;
  mod: number;
}

export interface GameState {
  tick: number;
  rng: number;
  mapId: number;
  seed: number;
  difficulty: number;
  phase: number;
  phaseTimer: number;
  wave: number;
  lives: number;
  maxLives: number;
  nextId: number;
  players: PlayerState[];
  enemies: Enemy[];
  towers: Tower[];
  soldiers: Soldier[];
  projectiles: Projectile[];
  grounds: GroundEffect[];
  worldItems: WorldItem[];
  spawns: SpawnOrder[];
  shop: ShopSlot[];
  shopWave: number;
  killCount: number;
  leaked: number;
  score: number;
  gameOver: boolean;
  bestWave: number;
  waveMod: number;
  waveReward: number;
  /** Ticks of global "all towers fire faster" left, per player. */
  overload: number[];
  /** Global slow applied by Time Warp: [percent, ticksLeft]. */
  globalSlowPct: number;
  globalSlowT: number;
  nextItemSpawn: number;
}

/** Not hashed, not serialised - cleared at the top of every tick. */
export interface SimOutput {
  events: SimEvent[];
}
