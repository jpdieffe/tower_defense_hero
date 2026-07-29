import { fx, type Fx } from '../core/fixed';
import { DmgType, GroundKind, ProjKind, sec, TICK_RATE } from '../sim/types';

const cps = (cellsPerSecond: number): Fx => Math.floor(fx(cellsPerSecond) / TICK_RATE);

export const AbilityKind = {
  ShieldSlam: 0,
  ArrowStorm: 1,
  Meteor: 2,
  Sentry: 3,
} as const;

export interface HeroAbility {
  kind: number;
  name: string;
  desc: string;
  cooldown: number;
  radius: Fx;
  damage: number;
  damagePerLevel: number;
  stunT: number;
  duration: number;
  /** Ability is aimed at a map point rather than cast on the hero. */
  targeted: boolean;
  castRange: Fx;
}

export interface HeroDef {
  id: number;
  key: string;
  name: string;
  title: string;
  desc: string;
  passiveName: string;
  passiveDesc: string;
  hp: number;
  hpPerLevel: number;
  regen: number;
  damage: number;
  damagePerLevel: number;
  attackCd: number;
  range: Fx;
  splash: Fx;
  dmgType: number;
  projSpeed: Fx;
  projKind: number;
  moveSpeed: Fx;
  respawn: number;
  /** Class colour, used for HUD accents and ability effects. */
  color: string;
  ability: HeroAbility;
  /** Passive knobs read by the simulation. */
  auraSlowPct: number;
  auraSlowRadius: Fx;
  critPct: number;
  critMult: number;
  burnDps: number;
  burnT: number;
  poisonDps: number;
  poisonT: number;
  armorShred: number;
  /** Percentage of damage dealt returned to the hero as health. */
  lifestealPct: number;
  goldPct: number;
  towerRatePct: number;
  towerAuraRadius: Fx;
}

export const HERO = {
  Paladin: 0,
  Orc: 1,
  DarkElf: 2,
  HighElf: 3,
  Magician: 4,
} as const;

export const HEROES: readonly HeroDef[] = [
  {
    id: HERO.Paladin,
    key: 'paladin',
    name: 'Paladin',
    title: 'Shield of the Northern Keep',
    desc: 'A walking roadblock in plate. Wade into the lane and hold it.',
    passiveName: 'Devotion Aura',
    passiveDesc: 'Enemies within 2 cells are slowed by 18%.',
    hp: 400, hpPerLevel: 62, regen: 6,
    damage: 24, damagePerLevel: 6,
    attackCd: sec(0.8), range: fx(1.15), splash: fx(0.75),
    dmgType: DmgType.Physical, projSpeed: 0, projKind: ProjKind.HeroShot,
    moveSpeed: cps(2.6), respawn: sec(12),
    color: '#5ea8ff',
    ability: {
      kind: AbilityKind.ShieldSlam,
      name: 'Thunder Clap',
      desc: 'Hammer the ground: heavy damage and a 1.2s stun all around you.',
      cooldown: sec(12), radius: fx(2.3), damage: 70, damagePerLevel: 20,
      stunT: sec(1.2), duration: 0, targeted: false, castRange: 0,
    },
    auraSlowPct: 18, auraSlowRadius: fx(2.0),
    critPct: 0, critMult: 200, burnDps: 0, burnT: 0,
    poisonDps: 0, poisonT: 0, armorShred: 0, lifestealPct: 0,
    goldPct: 0, towerRatePct: 0, towerAuraRadius: 0,
  },
  {
    id: HERO.Orc,
    key: 'orc',
    name: 'Orc',
    title: 'Warchief of the Broken Tusk',
    desc: 'Slow, enormous cleaves that heal him. The longer the brawl, the better.',
    passiveName: 'Bloodthirst',
    passiveDesc: 'Heals for 22% of all damage he deals.',
    hp: 500, hpPerLevel: 74, regen: 5,
    damage: 38, damagePerLevel: 10,
    attackCd: sec(1.05), range: fx(1.25), splash: fx(1.05),
    dmgType: DmgType.Physical, projSpeed: 0, projKind: ProjKind.HeroShot,
    moveSpeed: cps(2.5), respawn: sec(13),
    color: '#7bc043',
    ability: {
      kind: AbilityKind.ShieldSlam,
      name: 'Bloodrage',
      desc: 'Spin through everything nearby: massive damage and a short stagger.',
      cooldown: sec(13), radius: fx(2.7), damage: 95, damagePerLevel: 26,
      stunT: sec(0.5), duration: 0, targeted: false, castRange: 0,
    },
    auraSlowPct: 0, auraSlowRadius: 0,
    critPct: 12, critMult: 220, burnDps: 0, burnT: 0,
    poisonDps: 0, poisonT: 0, armorShred: 2, lifestealPct: 22,
    goldPct: 0, towerRatePct: 0, towerAuraRadius: 0,
  },
  {
    id: HERO.DarkElf,
    key: 'dark-elf',
    name: 'Dark Elf',
    title: 'Widow of the Underdark',
    desc: 'Venomed bolts that rot armour away. Fragile, but nothing stays healthy.',
    passiveName: 'Venomed Bolts',
    passiveDesc: 'Every hit poisons for 18/s over 3s and strips 2 armour.',
    hp: 230, hpPerLevel: 30, regen: 4,
    damage: 20, damagePerLevel: 6,
    attackCd: sec(0.5), range: fx(3.1), splash: 0,
    dmgType: DmgType.Physical, projSpeed: cps(19), projKind: ProjKind.Bolt,
    moveSpeed: cps(3.1), respawn: sec(12),
    color: '#b06cff',
    ability: {
      kind: AbilityKind.Sentry,
      name: 'Shade Totem',
      desc: 'Plant a shadow totem that fires on its own for 20 seconds.',
      cooldown: sec(18), radius: fx(0.5), damage: 0, damagePerLevel: 0,
      stunT: 0, duration: sec(20), targeted: true, castRange: fx(4.5),
    },
    auraSlowPct: 0, auraSlowRadius: 0,
    critPct: 0, critMult: 200, burnDps: 0, burnT: 0,
    poisonDps: 18, poisonT: sec(3), armorShred: 2, lifestealPct: 0,
    goldPct: 0, towerRatePct: 0, towerAuraRadius: 0,
  },
  {
    id: HERO.HighElf,
    key: 'high-elf',
    name: 'High Elf',
    title: 'Warden of the Silver Spires',
    desc: 'Lethal from range and she keeps the whole line firing faster.',
    passiveName: 'Elven Cadence',
    passiveDesc: '20% of shots crit, and towers within 2.4 cells fire 14% faster.',
    hp: 240, hpPerLevel: 32, regen: 4,
    damage: 27, damagePerLevel: 8,
    attackCd: sec(0.55), range: fx(3.6), splash: 0,
    dmgType: DmgType.Physical, projSpeed: cps(22), projKind: ProjKind.HeroShot,
    moveSpeed: cps(3.0), respawn: sec(12),
    color: '#7ee8ff',
    ability: {
      kind: AbilityKind.ArrowStorm,
      name: 'Starfall',
      desc: 'Rain enchanted arrows on a chosen area for 3.5 seconds.',
      cooldown: sec(14), radius: fx(2.4), damage: 48, damagePerLevel: 13,
      stunT: 0, duration: sec(3.5), targeted: true, castRange: fx(6),
    },
    auraSlowPct: 0, auraSlowRadius: 0,
    critPct: 20, critMult: 200, burnDps: 0, burnT: 0,
    poisonDps: 0, poisonT: 0, armorShred: 0, lifestealPct: 0,
    goldPct: 0, towerRatePct: 14, towerAuraRadius: fx(2.4),
  },
  {
    id: HERO.Magician,
    key: 'magician',
    name: 'Magician',
    title: 'Keeper of the Violet Flame',
    desc: 'Every attack splashes and burns. Best against dense packs.',
    passiveName: 'Searing Brand',
    passiveDesc: 'Attacks set targets alight for 8 damage/s over 2s.',
    hp: 215, hpPerLevel: 28, regen: 4,
    damage: 21, damagePerLevel: 7,
    attackCd: sec(0.9), range: fx(3.0), splash: fx(0.85),
    dmgType: DmgType.Fire, projSpeed: cps(13), projKind: ProjKind.Ember,
    moveSpeed: cps(2.6), respawn: sec(12),
    color: '#ff8a45',
    ability: {
      kind: AbilityKind.Meteor,
      name: 'Rain of Fire',
      desc: 'Call down a burning star: huge burst damage plus scorched ground.',
      cooldown: sec(16), radius: fx(2.5), damage: 240, damagePerLevel: 62,
      stunT: 0, duration: sec(4), targeted: true, castRange: fx(6.5),
    },
    auraSlowPct: 0, auraSlowRadius: 0,
    critPct: 0, critMult: 200, burnDps: 8, burnT: sec(2),
    poisonDps: 0, poisonT: 0, armorShred: 0, lifestealPct: 0,
    goldPct: 0, towerRatePct: 0, towerAuraRadius: 0,
  },
];

export function heroDef(id: number): HeroDef {
  return HEROES[id] ?? HEROES[0];
}

export const MAX_HERO_LEVEL = 10;

/** Total XP required to reach each level (index 0 = level 1). */
export const HERO_XP_TABLE: readonly number[] = [
  0, 60, 150, 280, 460, 700, 1010, 1400, 1880, 2460,
];

export function heroLevelForXp(xp: number): number {
  let lvl = 1;
  for (let i = 1; i < HERO_XP_TABLE.length; i++) {
    if (xp >= HERO_XP_TABLE[i]) lvl = i + 1;
  }
  return Math.min(lvl, MAX_HERO_LEVEL);
}

export const SENTRY_STATS = {
  damage: 26,
  cooldown: sec(0.45),
  range: fx(2.8),
  projSpeed: cps(18),
  dmgType: DmgType.Energy,
  groundKind: GroundKind.None,
};
