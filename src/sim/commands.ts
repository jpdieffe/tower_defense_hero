import type { Fx } from '../core/fixed';

/**
 * Every player action is a fixed-shape record of plain integers.
 *
 * Keeping commands numeric means they serialise identically, hash identically
 * and can never carry a floating-point value into the simulation.
 */
export interface Command {
  /** CmdType */
  t: number;
  /** Player index that issued it. */
  p: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

export const CmdType = {
  Noop: 0,
  Build: 1,
  Upgrade: 2,
  Sell: 4,
  SetTargetMode: 5,
  MoveHero: 6,
  UseAbility: 7,
  UseItem: 8,
  BuyShop: 9,
  ToggleReady: 10,
  Emote: 11,
  SetRally: 12,
  ChooseSkill: 13,
} as const;

export function cmd(t: number, p: number, a = 0, b = 0, c = 0, d = 0): Command {
  return { t, p, a, b, c, d };
}

export const build = (p: number, defId: number, cx: number, cy: number): Command =>
  cmd(CmdType.Build, p, defId, cx, cy);

/** Which upgrade track an Upgrade command pays into. */
export const Track = { Speed: 0, Power: 1 } as const;

export const upgrade = (p: number, towerId: number, track: number): Command =>
  cmd(CmdType.Upgrade, p, towerId, track);

export const sell = (p: number, towerId: number): Command =>
  cmd(CmdType.Sell, p, towerId);

export const setTargetMode = (p: number, towerId: number, mode: number): Command =>
  cmd(CmdType.SetTargetMode, p, towerId, mode);

export const setRally = (p: number, towerId: number, x: Fx, y: Fx): Command =>
  cmd(CmdType.SetRally, p, towerId, x, y);

export const moveHero = (p: number, x: Fx, y: Fx): Command =>
  cmd(CmdType.MoveHero, p, x, y);

/** skillId -1 casts the hero's signature power; learned active skills use their id. */
export const useAbility = (p: number, skillId: number, x: Fx, y: Fx): Command =>
  cmd(CmdType.UseAbility, p, x, y, skillId);

export const useItem = (p: number, slot: number, x: Fx, y: Fx): Command =>
  cmd(CmdType.UseItem, p, slot, x, y);

export const buyShop = (p: number, slot: number): Command =>
  cmd(CmdType.BuyShop, p, slot);

export const toggleReady = (p: number): Command => cmd(CmdType.ToggleReady, p);

export const emote = (p: number, id: number): Command => cmd(CmdType.Emote, p, id);
export const chooseSkill = (p: number, skillId: number): Command => cmd(CmdType.ChooseSkill, p, skillId);

/** Compact wire form: fewer bytes per tick than a keyed object. */
export function packCommand(c: Command): number[] {
  return [c.t, c.p, c.a, c.b, c.c, c.d];
}

export function unpackCommand(v: readonly number[]): Command {
  return { t: v[0] | 0, p: v[1] | 0, a: v[2] | 0, b: v[3] | 0, c: v[4] | 0, d: v[5] | 0 };
}
