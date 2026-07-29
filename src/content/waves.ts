import { deriveSeed, nextInt, shuffle, type RngHolder } from '../core/rng';
import { sec, type SpawnOrder } from '../sim/types';
import { ENEMY } from './enemies';

export const WaveMod = {
  None: 0,
  Hasted: 1,
  Armoured: 2,
  Shielded: 3,
  Swarm: 4,
  Regenerating: 5,
} as const;

export const WAVE_MOD_INFO: readonly { name: string; desc: string; icon: string }[] = [
  { name: '', desc: '', icon: '' },
  { name: 'Hasted', desc: 'Enemies move 30% faster.', icon: '💨' },
  { name: 'Armoured', desc: 'Enemies gain +5 armour and 10% more health.', icon: '🛡' },
  { name: 'Shielded', desc: 'Enemies arrive with a regenerating barrier.', icon: '🔷' },
  { name: 'Swarm', desc: 'Twice as many enemies, each with 30% less health.', icon: '🐜' },
  { name: 'Regenerating', desc: 'Enemies heal 1.5% of their health every second.', icon: '💚' },
];

interface PoolEntry {
  defId: number;
  cost: number;
  minWave: number;
  /** Larger = more likely to be picked. */
  weight: number;
  /** Spawned in tight bunches of this size. */
  clump: number;
}

const POOL: readonly PoolEntry[] = [
  { defId: ENEMY.Ghoul, cost: 10, minWave: 1, weight: 10, clump: 4 },
  { defId: ENEMY.DireWolf, cost: 12, minWave: 2, weight: 8, clump: 5 },
  { defId: ENEMY.Skeleton, cost: 5, minWave: 3, weight: 7, clump: 8 },
  { defId: ENEMY.Shade, cost: 18, minWave: 4, weight: 6, clump: 4 },
  { defId: ENEMY.Abomination, cost: 30, minWave: 6, weight: 6, clump: 2 },
  { defId: ENEMY.BoneGolem, cost: 20, minWave: 8, weight: 5, clump: 3 },
  { defId: ENEMY.SpiritWarden, cost: 34, minWave: 9, weight: 5, clump: 2 },
  { defId: ENEMY.Shaman, cost: 30, minWave: 11, weight: 4, clump: 1 },
  { defId: ENEMY.Gargoyle, cost: 46, minWave: 12, weight: 4, clump: 2 },
  { defId: ENEMY.Necromancer, cost: 38, minWave: 14, weight: 3, clump: 1 },
];

const BOSS_ROTATION: readonly number[] = [
  ENEMY.Infernal, ENEMY.BoneDragon, ENEMY.ObsidianColossus,
];

export interface WavePlan {
  wave: number;
  orders: SpawnOrder[];
  hpPct: number;
  mod: number;
  isBoss: boolean;
  /** Gold handed to every player when the wave is cleared. */
  reward: number;
  /** Human readable line for the HUD. */
  label: string;
}

export function isBossWave(wave: number): boolean {
  return wave % 5 === 0;
}

/** Health multiplier (percent) applied to every enemy in a wave. */
export function waveHpPct(wave: number): number {
  const w = wave - 1;
  return 100 + 24 * w + Math.floor((w * w * 11) / 5);
}

function rollMod(rng: RngHolder, wave: number): number {
  if (wave < 4) return WaveMod.None;
  if (nextInt(rng, 100) < 45) return WaveMod.None;
  const options: number[] = [WaveMod.Hasted, WaveMod.Armoured, WaveMod.Swarm];
  if (wave >= 7) options.push(WaveMod.Regenerating);
  if (wave >= 9) options.push(WaveMod.Shielded);
  return options[nextInt(rng, options.length)];
}

/**
 * Deterministically build the spawn schedule for a wave.
 *
 * Only depends on (matchSeed, wave, laneCount), so both peers generate exactly
 * the same wave without exchanging a single byte about it.
 */
export function generateWave(matchSeed: number, wave: number, laneCount: number): WavePlan {
  const rng: RngHolder = { rng: deriveSeed(matchSeed, wave * 7919 + 13) };
  const boss = isBossWave(wave);
  const mod = rollMod(rng, wave);
  const hpBase = waveHpPct(wave);

  let hpPct = hpBase;
  if (mod === WaveMod.Armoured) hpPct = Math.floor((hpPct * 110) / 100);
  if (mod === WaveMod.Swarm) hpPct = Math.floor((hpPct * 70) / 100);

  const available = POOL.filter((p) => p.minWave <= wave);
  let budget = 55 + 34 * wave;
  if (mod === WaveMod.Swarm) budget = Math.floor(budget * 1.9);

  // Spread the wave over a window that grows slowly, capped so late waves stay tense.
  const windowTicks = Math.min(sec(26), sec(9) + wave * sec(0.35));

  const orders: SpawnOrder[] = [];
  let guard = 0;
  while (budget > 0 && guard++ < 400) {
    const entry = weightedPick(rng, available, wave);
    if (!entry) break;
    const maxClump = Math.max(1, Math.min(entry.clump, Math.floor(budget / entry.cost)));
    if (maxClump < 1) break;
    const count = 1 + nextInt(rng, maxClump);
    const lane = nextInt(rng, laneCount);
    const start = nextInt(rng, windowTicks);
    const gap = sec(0.22) + nextInt(rng, sec(0.28));
    for (let i = 0; i < count; i++) {
      orders.push({
        at: start + i * gap,
        defId: entry.defId,
        lane,
        wave,
        hpPct,
        boss: false,
        mod,
      });
    }
    budget -= entry.cost * count;
  }

  if (boss) {
    const bossIdx = Math.floor(wave / 5) - 1;
    const bossId = BOSS_ROTATION[bossIdx % BOSS_ROTATION.length];
    const extraBosses = Math.floor(wave / 20);
    for (let i = 0; i <= extraBosses; i++) {
      orders.push({
        at: sec(3) + i * sec(6),
        defId: bossId,
        lane: nextInt(rng, laneCount),
        wave,
        hpPct: Math.floor((hpBase * 100) / 100),
        boss: true,
        mod: mod === WaveMod.Swarm ? WaveMod.None : mod,
      });
    }
  }

  // Stable ordering: the spawner pops from the front, so sort by time then by a
  // deterministic tiebreak.
  orders.sort((a, b) => (a.at - b.at) || (a.lane - b.lane) || (a.defId - b.defId));

  const reward = 55 + wave * 14 + (boss ? 120 : 0);
  const modName = mod !== WaveMod.None ? ` · ${WAVE_MOD_INFO[mod].name}` : '';

  return {
    wave,
    orders,
    hpPct,
    mod,
    isBoss: boss,
    reward,
    label: boss ? `Wave ${wave} · BOSS${modName}` : `Wave ${wave}${modName}`,
  };
}

function weightedPick(rng: RngHolder, pool: readonly PoolEntry[], wave: number): PoolEntry | null {
  if (pool.length === 0) return null;
  // Later waves lean harder on the expensive units.
  let total = 0;
  const weights: number[] = [];
  for (const p of pool) {
    const bias = p.cost >= 30 ? Math.min(3, 1 + Math.floor(wave / 10)) : 1;
    const w = p.weight * bias;
    weights.push(w);
    total += w;
  }
  let roll = nextInt(rng, total);
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * The three shop offers for a wave. Deterministic from the match seed so both
 * players browse the same stock.
 */
export function generateShop(matchSeed: number, wave: number): { kind: number; id: number }[] {
  const rng: RngHolder = { rng: deriveSeed(matchSeed, wave * 104729 + 7) };
  const relicIds = shuffle(rng, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const itemIds = shuffle(rng, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  return [
    { kind: 0, id: relicIds[0] },
    { kind: 0, id: relicIds[1] },
    { kind: 1, id: itemIds[0] },
    { kind: 1, id: itemIds[1] },
  ];
}
