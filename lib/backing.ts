/**
 * Backing suggestions for a deposit, the same ladder the OpenGacha console
 * and nfw.fun use, so a depositor sees the same three stops everywhere.
 *
 * A card's worth (its insured value converted to SOL) sets the ladder:
 * Low = half the worth (drawn twice as often, pays a keep less), Worth = the
 * worth itself, High = double (drawn half as often, a buyback pays more).
 * Every stop is clamped inside the bounds that govern the card, and the
 * ladder never dips under 0.25 SOL. A card without a worth has no ladder;
 * the depositor types a backing inside the band.
 */

export const MIN_WORTH_SOL = 0.25;

export interface Stops {
  low: number;
  mid: number;
  high: number;
}

/**
 * The three stops, always. A card with a known worth gets the ladder off
 * that worth; a card with none (or one under the slab floor) gets the
 * product's floor ladder, 0.25 / 0.5 / 1, the same one nfw.fun and the
 * console fall to for cheap slabs. Every stop clamped inside the band.
 */
export function stopsFor(worthSol: number | null | undefined, bounds: { minSol: number; maxSol: number }): Stops {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const clamp = (v: number) => r(Math.max(bounds.minSol, Math.min(bounds.maxSol, v)));
  if (!worthSol || !Number.isFinite(worthSol) || worthSol < MIN_WORTH_SOL) {
    return { low: clamp(0.25), mid: clamp(0.5), high: clamp(1) };
  }
  return { low: clamp(Math.max(MIN_WORTH_SOL, worthSol * 0.5)), mid: clamp(worthSol), high: clamp(worthSol * 2) };
}

/** The slip's default for a card: the middle stop (its worth when known). */
export function suggestBackingSol(worthSol: number | null | undefined, bounds: { minSol: number; maxSol: number }): number {
  return stopsFor(worthSol, bounds).mid;
}
