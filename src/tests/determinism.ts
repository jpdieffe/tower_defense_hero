/**
 * Headless verification that the simulation is bit-for-bit deterministic.
 *
 * This is the safety net for the whole design: if two identical command
 * streams ever produce different state hashes, the two players would start
 * seeing different games. Run with `npm run check:sim`.
 */

import { fxMul, fxDiv, fxSqrt, fx, FX_ONE } from '../core/fixed';
import { isBuildable, buildMapRuntime } from '../content/maps';
import { TOWERS } from '../content/towers';
import { build, toggleReady, upgrade, moveHero, type Command } from '../sim/commands';
import { step } from '../sim/sim';
import { cloneState, createState, hashState, type MatchConfig } from '../sim/state';
import { Phase, type GameState, type SimOutput } from '../sim/types';

const TICKS = 4000;

/** The harness drives a full six-player room. */
const PLAYER_COUNT = 6;

function makeConfig(seed: number, mapId = 0, playerCount = PLAYER_COUNT): MatchConfig {
  const players = [];
  for (let i = 0; i < playerCount; i++) players.push({ name: `P${i + 1}`, heroId: i % 5 });
  return {
    seed,
    mapId,
    players,
    startGold: 400,
    startLives: 0,
    difficulty: 0,
  };
}

/**
 * A scripted "player" that builds, upgrades and moves. Purely a function of the
 * tick number, so both runs of the test issue identical inputs.
 */
function scriptedCommands(tick: number, state: GameState): Command[] {
  const out: Command[] = [];
  const rt = buildMapRuntime(state.mapId);
  const def = rt.def;
  const np = state.players.length;

  if (tick % 37 === 0) {
    for (let p = 0; p < np; p++) {
      const player = state.players[p];
      // Deterministic scan for the first free buildable cell.
      const towerType = TOWERS[(tick / 37 + p * 3) % TOWERS.length | 0];
      if (player.gold < towerType.cost) continue;
      const startIdx = ((tick * 7 + p * 91) % (def.w * def.h)) | 0;
      for (let n = 0; n < def.w * def.h; n++) {
        const i = (startIdx + n) % (def.w * def.h);
        const cx = i % def.w;
        const cy = (i / def.w) | 0;
        if (!isBuildable(rt, cx, cy)) continue;
        if (state.towers.some((t) => t.cx === cx && t.cy === cy)) continue;
        out.push(build(p, towerType.id, cx, cy));
        break;
      }
    }
  }

  if (tick % 53 === 0) {
    for (let p = 0; p < np; p++) {
      const mine = state.towers.filter((t) => t.owner === p && t.temp === 0);
      if (mine.length === 0) continue;
      const t = mine[(tick / 53) % mine.length | 0];
      out.push(upgrade(p, t.id, (tick / 53 + p) % 2 | 0));
    }
  }

  if (tick % 61 === 0) {
    for (let p = 0; p < np; p++) {
      const x = fx(2 + ((tick / 61 + p * 5) % (def.w - 4)));
      const y = fx(3 + ((tick / 61 + p * 9) % (def.h - 6)));
      out.push(moveHero(p, x, y));
    }
  }

  // Keep the waves flowing in the test; real build phases wait indefinitely.
  if (state.phase === Phase.Build && state.tick % 120 === 0) {
    for (let p = 0; p < np; p++) {
      if (!state.players[p].ready) out.push(toggleReady(p));
    }
  }

  return out;
}

interface RunResult {
  hashes: number[];
  final: GameState;
  waves: number;
  kills: number;
  leaked: number;
  towers: number;
  peakEnemies: number;
}

function run(seed: number, mapId: number, ticks = TICKS, playerCount = PLAYER_COUNT): RunResult {
  const state = createState(makeConfig(seed, mapId, playerCount));
  const out: SimOutput = { events: [] };
  const hashes: number[] = [];
  let peakEnemies = 0;

  for (let t = 0; t < ticks; t++) {
    const cmds = scriptedCommands(t, state);
    step(state, cmds, out);
    peakEnemies = Math.max(peakEnemies, state.enemies.length);
    if (t % 25 === 0) hashes.push(hashState(state));
    assertFinite(state, t);
  }

  return {
    hashes,
    final: state,
    waves: state.wave,
    kills: state.killCount,
    leaked: state.leaked,
    towers: state.towers.length,
    peakEnemies,
  };
}

function assertFinite(s: GameState, tick: number): void {
  for (const e of s.enemies) {
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isInteger(e.hp)) {
      throw new Error(`tick ${tick}: enemy ${e.id} has a non-integer/NaN field`);
    }
  }
  for (const p of s.projectiles) {
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) {
      throw new Error(`tick ${tick}: projectile ${p.id} drifted off the integer grid`);
    }
  }
  for (const pl of s.players) {
    if (!Number.isInteger(pl.gold) || pl.gold < 0) {
      throw new Error(`tick ${tick}: player ${pl.idx} has invalid gold ${pl.gold}`);
    }
  }
}

// --------------------------------------------------------------- fixed point

function checkFixedPoint(): string[] {
  const problems: string[] = [];
  let h = 12345;
  const next = (): number => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h >>> 0;
  };

  for (let i = 0; i < 200000; i++) {
    // Values in the range positions/speeds actually reach.
    const a = ((next() % 4000000) - 2000000) | 0;
    const b = ((next() % 4000000) - 2000000) | 0;

    const got = fxMul(a, b);
    // BigInt reference: floor((a*b) / 2^16) with correct negative flooring.
    const prod = BigInt(a) * BigInt(b);
    const shift = BigInt(FX_ONE);
    let want = prod / shift;
    if (prod < 0n && prod % shift !== 0n) want -= 1n;
    if (BigInt(got) !== want) {
      problems.push(`fxMul(${a}, ${b}) = ${got}, expected ${want}`);
      if (problems.length > 5) break;
    }
  }

  // Division and sqrt round-trips
  for (let i = 1; i < 20000; i++) {
    const v = i * 977;
    const r = fxSqrt(v);
    if (fxMul(r, r) > v + FX_ONE) problems.push(`fxSqrt(${v}) = ${r} overshoots`);
    const d = fxDiv(fx(1), fx(3));
    if (d !== Math.floor(FX_ONE / 3)) problems.push('fxDiv(1, 3) is wrong');
    if (problems.length > 5) break;
  }

  return problems;
}

// ------------------------------------------------------------------- report

export interface Report {
  ok: boolean;
  lines: string[];
}

export function runChecks(): Report {
  const lines: string[] = [];
  let ok = true;

  const fpProblems = checkFixedPoint();
  if (fpProblems.length) {
    ok = false;
    lines.push('FAIL  fixed-point maths:');
    for (const p of fpProblems) lines.push(`        ${p}`);
  } else {
    lines.push('PASS  fixed-point multiply/divide/sqrt are exact (220k random cases)');
  }

  for (const mapId of [0, 1, 2]) {
    const seed = 0x1234abcd ^ (mapId * 7919);
    const a = run(seed, mapId);
    const b = run(seed, mapId);

    const mismatch = a.hashes.findIndex((h, i) => h !== b.hashes[i]);
    if (mismatch >= 0) {
      ok = false;
      lines.push(`FAIL  map ${mapId}: runs diverged at sample ${mismatch} (tick ${mismatch * 25})`);
    } else {
      lines.push(
        `PASS  map ${mapId}: ${a.hashes.length} hash samples identical over ${TICKS} ticks`
        + `  [wave ${a.waves}, ${a.kills} kills, ${a.leaked} leaked, ${a.towers} towers, peak ${a.peakEnemies} enemies]`,
      );
    }

    if (a.final.wave < 3) {
      ok = false;
      lines.push(`FAIL  map ${mapId}: only reached wave ${a.final.wave} - the wave loop looks stuck`);
    }
    if (a.kills === 0) {
      ok = false;
      lines.push(`FAIL  map ${mapId}: nothing was ever killed - towers are not shooting`);
    }
  }

  // Snapshot round trip: a resynced client must continue identically.
  {
    const seed = 0x77aa55;
    const state = createState(makeConfig(seed));
    const out: SimOutput = { events: [] };
    for (let t = 0; t < 900; t++) step(state, scriptedCommands(t, state), out);

    const copy = cloneState(state);
    let divergedAt = -1;
    for (let t = 900; t < 1800; t++) {
      const cmdsA = scriptedCommands(t, state);
      step(state, cmdsA, out);
      const cmdsB = scriptedCommands(t, copy);
      step(copy, cmdsB, { events: [] });
      if (hashState(state) !== hashState(copy)) { divergedAt = t; break; }
    }
    if (divergedAt >= 0) {
      ok = false;
      lines.push(`FAIL  snapshot round-trip diverged at tick ${divergedAt}`);
    } else {
      lines.push('PASS  JSON snapshot round-trip stays in sync for 900 further ticks');
    }
  }

  // Different seeds really do produce different games.
  {
    const a = run(1111, 0, 900);
    const b = run(2222, 0, 900);
    if (a.hashes[a.hashes.length - 1] === b.hashes[b.hashes.length - 1]) {
      ok = false;
      lines.push('FAIL  two different seeds produced the same world');
    } else {
      lines.push('PASS  different seeds produce different worlds');
    }
  }

  // Long soak: push deep into the wave ladder and make sure nothing explodes,
  // including the defeat path once the scripted (deliberately mediocre) bot
  // finally gets overrun.
  {
    const soak = run(0xbeef01, 0, 60000);
    const s = soak.final;
    lines.push(
      `PASS  soak: 60k ticks reached wave ${s.wave} `
      + `(${soak.kills} kills, ${soak.leaked} leaks, lives ${s.lives}/${s.maxLives}, `
      + `peak ${soak.peakEnemies} enemies, gameOver=${s.gameOver})`,
    );
    if (s.wave < 8) {
      ok = false;
      lines.push(`FAIL  soak only reached wave ${s.wave}; the wave loop is probably stalling`);
    }
    const soakRepeat = run(0xbeef01, 0, 60000);
    if (soakRepeat.hashes[soakRepeat.hashes.length - 1] !== soak.hashes[soak.hashes.length - 1]) {
      ok = false;
      lines.push('FAIL  soak run was not reproducible');
    } else {
      lines.push('PASS  soak run is reproducible end to end');
    }
  }

  return { ok, lines };
}
