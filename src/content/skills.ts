import { fx, type Fx } from '../core/fixed';
import { sec } from '../sim/types';

export type SkillBranch = 'Might' | 'Survival' | 'Tactics';

export interface ActiveSkill {
  targeted: boolean;
  radius: Fx;
  castRange: Fx;
  cooldown: number;
  damage: number;
  damagePerLevel: number;
  effect: 'whirlwind' | 'meteor' | 'heal' | 'frost' | 'storm' | 'sentry' | 'guardian' | 'wolves' | 'totem';
}

export interface SkillDef {
  id: number;
  branch: SkillBranch;
  tier: number;
  name: string;
  desc: string;
  icon: string;
  requires: number;
  active?: ActiveSkill;
}

export const SKILLS: readonly SkillDef[] = [
  { id: 0, branch: 'Might', tier: 1, name: 'Keen Edge', desc: '+15% hero attack and power damage.', icon: '⚔', requires: -1 },
  { id: 1, branch: 'Might', tier: 2, name: 'Whirlwind', desc: 'ACTIVE • Cleave and stagger every nearby ground enemy.', icon: '🌪', requires: 0,
    active: { targeted: false, radius: fx(2.1), castRange: 0, cooldown: sec(9), damage: 62, damagePerLevel: 16, effect: 'whirlwind' } },
  { id: 2, branch: 'Might', tier: 3, name: 'Comet Breaker', desc: 'ACTIVE • Call down a devastating meteor at long range.', icon: '☄', requires: 1,
    active: { targeted: true, radius: fx(2.2), castRange: fx(6.5), cooldown: sec(15), damage: 185, damagePerLevel: 44, effect: 'meteor' } },
  { id: 3, branch: 'Survival', tier: 1, name: 'Iron Heart', desc: '+25% maximum health and immediately heal 25%.', icon: '♥', requires: -1 },
  { id: 4, branch: 'Survival', tier: 2, name: 'Renewal', desc: 'ACTIVE • Restore 35% health and unleash a healing pulse.', icon: '✦', requires: 3,
    active: { targeted: false, radius: fx(2), castRange: 0, cooldown: sec(18), damage: 0, damagePerLevel: 0, effect: 'heal' } },
  { id: 5, branch: 'Survival', tier: 3, name: 'Winter Aegis', desc: 'ACTIVE • Freeze, damage, and slow all enemies around you.', icon: '❄', requires: 4,
    active: { targeted: false, radius: fx(2.8), castRange: 0, cooldown: sec(14), damage: 48, damagePerLevel: 13, effect: 'frost' } },
  { id: 6, branch: 'Tactics', tier: 1, name: 'Long Reach', desc: '+20% hero attack range and 15% shorter power cooldowns.', icon: '◎', requires: -1 },
  { id: 7, branch: 'Tactics', tier: 2, name: 'Runic Barrage', desc: 'ACTIVE • Blanket a chosen area with arcane projectiles.', icon: '✹', requires: 6,
    active: { targeted: true, radius: fx(2.5), castRange: fx(6), cooldown: sec(12), damage: 38, damagePerLevel: 11, effect: 'storm' } },
  { id: 8, branch: 'Tactics', tier: 3, name: 'Arcane Sentry', desc: 'ACTIVE • Deploy a rapid-firing magical sentry for 20 seconds.', icon: '♜', requires: 7,
    active: { targeted: true, radius: fx(0.7), castRange: fx(5), cooldown: sec(17), damage: 0, damagePerLevel: 0, effect: 'sentry' } },
  { id: 9, branch: 'Might', tier: 4, name: 'Titan Breaker', desc: 'ACTIVE • Smash a huge area with a stunning physical shockwave.', icon: '💥', requires: 2,
    active: { targeted: true, radius: fx(3), castRange: fx(4.5), cooldown: sec(16), damage: 145, damagePerLevel: 32, effect: 'meteor' } },
  { id: 10, branch: 'Might', tier: 5, name: 'Oathbound Guardian', desc: 'ACTIVE • Summon two persistent guardian companions.', icon: '🛡', requires: 9,
    active: { targeted: true, radius: fx(0.8), castRange: fx(4), cooldown: sec(28), damage: 0, damagePerLevel: 0, effect: 'guardian' } },
  { id: 11, branch: 'Survival', tier: 4, name: 'Sanctuary', desc: 'ACTIVE • Restore health and release a radiant pulse.', icon: '☀', requires: 5,
    active: { targeted: false, radius: fx(3.2), castRange: 0, cooldown: sec(20), damage: 70, damagePerLevel: 18, effect: 'heal' } },
  { id: 12, branch: 'Survival', tier: 5, name: 'Spirit Pack', desc: 'ACTIVE • Call persistent spirit wolves to fight beside the party.', icon: '🐺', requires: 11,
    active: { targeted: true, radius: fx(1), castRange: fx(4), cooldown: sec(30), damage: 0, damagePerLevel: 0, effect: 'wolves' } },
  { id: 13, branch: 'Tactics', tier: 4, name: 'Tempest Crown', desc: 'ACTIVE • Create a wide, lingering storm that shreds crowded waves.', icon: '⚡', requires: 8,
    active: { targeted: true, radius: fx(3.4), castRange: fx(7), cooldown: sec(18), damage: 55, damagePerLevel: 14, effect: 'storm' } },
  { id: 14, branch: 'Tactics', tier: 5, name: 'Eternal Totem', desc: 'ACTIVE • Plant a persistent runic familiar.', icon: '🔮', requires: 13,
    active: { targeted: true, radius: fx(0.8), castRange: fx(6), cooldown: sec(30), damage: 0, damagePerLevel: 0, effect: 'totem' } },
];

export const skillDef = (id: number): SkillDef => SKILLS[id] ?? SKILLS[0];
export const hasSkill = (skills: readonly number[], id: number): boolean => skills.includes(id);
export const activeSkills = (skills: readonly number[]): readonly SkillDef[] =>
  SKILLS.filter((s) => !!s.active && hasSkill(skills, s.id));
export function availableSkills(skills: readonly number[]): readonly SkillDef[] {
  return SKILLS.filter((s) => !hasSkill(skills, s.id) && (s.requires < 0 || hasSkill(skills, s.requires)));
}
