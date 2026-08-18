/**
 * The pool's arithmetic, in bigint so it can be checked against the Rust
 * line by line. Mirrors the program's own pool arithmetic.
 *
 * The whole pricing model is two lines: a position's selection weight is
 * inverse to its backing (weight = 1e18 / backing), and the expected value
 * of a draw is the harmonic mean of active backings, which with those
 * weights collapses to `1e18 × active / total_weight`. The pull price is
 * that EV plus the pool's surcharge.
 */

export const WEIGHT_NUMERATOR = 1_000_000_000_000_000_000n; // 1e18
export const MAX_BPS = 10_000n;

export const bpsOf = (value: bigint, bps: number | bigint) => (value * BigInt(bps)) / MAX_BPS;

export function weightOf(backingLamports: bigint): bigint {
  if (backingLamports <= 0n) throw new Error("backing must be positive");
  return WEIGHT_NUMERATOR / backingLamports;
}

export function expectedValue(activePositions: number, totalWeight: bigint): bigint {
  if (activePositions <= 0) throw new Error("pool is empty");
  if (totalWeight <= 0n) throw new Error("total weight must be positive");
  return (WEIGHT_NUMERATOR * BigInt(activePositions)) / totalWeight;
}

/** What one pull costs right now. */
export function pullPrice(activePositions: number, totalWeight: bigint, surchargeBps: number): bigint {
  const ev = expectedValue(activePositions, totalWeight);
  return (ev * (MAX_BPS + BigInt(surchargeBps))) / MAX_BPS;
}

/** A position's chance of being the next draw, 0..1. */
export function odds(backingLamports: bigint, totalWeight: bigint): number {
  if (totalWeight <= 0n) return 0;
  return Number(weightOf(backingLamports)) / Number(totalWeight);
}

/** What the winner takes home on cash-out: `backing × bid_rate`. */
export function cashOutPayout(backingLamports: bigint, bidRateBps: number): bigint {
  return bpsOf(backingLamports, bidRateBps);
}

export const LAMPORTS = 1_000_000_000n;
export const sol = (lamports: bigint | number | string, digits = 3) =>
  (Number(lamports) / 1e9).toFixed(digits);
