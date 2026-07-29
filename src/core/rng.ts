/**
 * Deterministic pseudo-random number generation.
 *
 * `Math.random()` is forbidden anywhere in the simulation. Every random draw
 * comes from this xorshift32 generator, whose seed lives inside the game state
 * and is therefore advanced in lockstep on both peers.
 */

export interface RngHolder {
  rng: number;
}

/** Advance the generator and return a value in [0, 2^32). */
export function nextU32(h: RngHolder): number {
  let x = h.rng >>> 0;
  if (x === 0) x = 0x9e3779b9; // xorshift cannot escape zero
  x ^= (x << 13) >>> 0;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  x >>>= 0;
  h.rng = x;
  return x;
}

/** Uniform integer in [0, n). */
export function nextInt(h: RngHolder, n: number): number {
  if (n <= 1) return 0;
  return nextU32(h) % n;
}

/** Uniform integer in [lo, hi] inclusive. */
export function nextRange(h: RngHolder, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  return lo + nextInt(h, hi - lo + 1);
}

/** True with `percent` percent probability. */
export function chance(h: RngHolder, percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return nextInt(h, 100) < percent;
}

/** Pick a random element. Never call with an empty array. */
export function pick<T>(h: RngHolder, arr: readonly T[]): T {
  return arr[nextInt(h, arr.length)];
}

/** Fisher-Yates, in place, deterministic. */
export function shuffle<T>(h: RngHolder, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(h, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/**
 * A standalone generator for things that must NOT touch simulation state
 * (UI shimmer, particle jitter, menu backgrounds).
 */
export function makeLocalRng(seed: number): () => number {
  const h: RngHolder = { rng: seed >>> 0 || 1 };
  return () => nextU32(h) / 4294967296;
}

/** Derive a stable sub-seed, e.g. per-wave generation from the match seed. */
export function deriveSeed(seed: number, salt: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ salt, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0 || 1;
}
