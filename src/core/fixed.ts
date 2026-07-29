/**
 * Q16.16 fixed-point maths.
 *
 * The entire gameplay simulation runs on these integers. Floating point is
 * *banned* inside the simulation because IEEE-754 rounding, `Math.sin`,
 * `Math.pow`, etc. are not bit-identical across browsers/CPUs - and a single
 * differing bit would eventually make one player see a kill that the other
 * doesn't.
 *
 * Every operation here is exact integer arithmetic that stays well inside the
 * 2^53 range where JS numbers are exact, so it produces identical results on
 * every device.
 */

/** A Q16.16 fixed-point number, stored as an integer JS number. */
export type Fx = number;

export const FX_BITS = 16;
export const FX_ONE: Fx = 1 << FX_BITS; // 65536
export const FX_HALF: Fx = FX_ONE >> 1;
export const FX_MAX: Fx = 0x7fffffff;

/** Convert an integer to fixed-point. */
export function fxi(n: number): Fx {
  return (n * FX_ONE) | 0;
}

/**
 * Convert an author-time decimal literal to fixed-point.
 *
 * Safe for content tables: parsing a decimal literal into a double is exactly
 * specified, and `Math.round` is exact, so `fx(2.35)` is the same integer
 * everywhere. Never call this with a runtime-computed float.
 */
export function fx(n: number): Fx {
  return Math.round(n * FX_ONE);
}

/** Fixed-point -> float. Rendering only. */
export function fxToFloat(a: Fx): number {
  return a / FX_ONE;
}

/** Truncate toward negative infinity to a whole number. */
export function fxFloor(a: Fx): number {
  return Math.floor(a / FX_ONE);
}

export function fxRound(a: Fx): number {
  return Math.floor((a + FX_HALF) / FX_ONE);
}

/**
 * Exact fixed-point multiply.
 *
 * Splitting both operands into 16-bit halves keeps every partial product below
 * 2^53, so no precision is ever silently lost (a plain `a * b / 65536` would
 * lose bits once positions get large).
 */
export function fxMul(a: Fx, b: Fx): Fx {
  const ah = Math.floor(a / FX_ONE);
  const al = a - ah * FX_ONE;
  const bh = Math.floor(b / FX_ONE);
  const bl = b - bh * FX_ONE;
  return ah * bh * FX_ONE + ah * bl + al * bh + Math.floor((al * bl) / FX_ONE);
}

/** Fixed-point divide, floored. */
export function fxDiv(a: Fx, b: Fx): Fx {
  if (b === 0) return a >= 0 ? FX_MAX : -FX_MAX;
  return Math.floor((a * FX_ONE) / b);
}

/** Integer square root, exact for any non-negative integer < 2^52. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  // Math.sqrt is IEEE-754 correctly rounded (spec-required), therefore
  // deterministic; the correction loop removes any last-bit ambiguity.
  let r = Math.floor(Math.sqrt(n));
  while (r > 0 && r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** Fixed-point square root. */
export function fxSqrt(a: Fx): Fx {
  if (a <= 0) return 0;
  return isqrt(a * FX_ONE);
}

/** Squared length of a fixed-point vector (cheap - prefer this for compares). */
export function fxLen2(x: Fx, y: Fx): Fx {
  return fxMul(x, x) + fxMul(y, y);
}

/** Length of a fixed-point vector. */
export function fxLen(x: Fx, y: Fx): Fx {
  return fxSqrt(fxLen2(x, y));
}

export function fxDist(ax: Fx, ay: Fx, bx: Fx, by: Fx): Fx {
  return fxLen(bx - ax, by - ay);
}

export function fxDist2(ax: Fx, ay: Fx, bx: Fx, by: Fx): Fx {
  return fxLen2(bx - ax, by - ay);
}

export function fxAbs(a: Fx): Fx {
  return a < 0 ? -a : a;
}

export function fxClamp(a: Fx, lo: Fx, hi: Fx): Fx {
  return a < lo ? lo : a > hi ? hi : a;
}

export function clampInt(a: number, lo: number, hi: number): number {
  return a < lo ? lo : a > hi ? hi : a;
}

/** Scale an integer by a percentage, floored. Used for all combat maths. */
export function pct(value: number, percent: number): number {
  return Math.floor((value * percent) / 100);
}

/** Reusable normalize result to avoid allocating in hot loops. */
export interface Vec2 {
  x: Fx;
  y: Fx;
}

/**
 * Normalise (x, y) into `out`. Returns the original length.
 * A zero-length vector yields (0, 0).
 */
export function fxNormalize(x: Fx, y: Fx, out: Vec2): Fx {
  const len = fxLen(x, y);
  if (len <= 0) {
    out.x = 0;
    out.y = 0;
    return 0;
  }
  out.x = fxDiv(x, len);
  out.y = fxDiv(y, len);
  return len;
}

/** Dot product in fixed-point. */
export function fxDot(ax: Fx, ay: Fx, bx: Fx, by: Fx): Fx {
  return fxMul(ax, bx) + fxMul(ay, by);
}

/**
 * Shortest squared distance from point p to segment ab. Used by piercing
 * projectiles and beam weapons.
 */
export function fxSegDist2(
  px: Fx, py: Fx,
  ax: Fx, ay: Fx,
  bx: Fx, by: Fx,
): Fx {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = fxLen2(abx, aby);
  if (ab2 <= 0) return fxLen2(apx, apy);
  let t = fxDiv(fxDot(apx, apy, abx, aby), ab2);
  t = fxClamp(t, 0, FX_ONE);
  const cx = ax + fxMul(abx, t);
  const cy = ay + fxMul(aby, t);
  return fxLen2(px - cx, py - cy);
}
