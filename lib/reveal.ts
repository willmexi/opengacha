/**
 * From a card the chain described to what the reveal announces.
 *
 * Rarity is not a property of the card; it is its backing relative to the
 * pool's expected value, the same bands opengacha.io uses: 20× and up is
 * legendary, 8× epic, 3× rare, 1.25× uncommon, the rest common. Odds are
 * the inverse of the same number, so rarity is a restatement of odds, on
 * purpose. Grade reads out of the name when the issuer wrote it there
 * (CGC 10, PSA 9...).
 */

import type { RevealCard } from "@/components/slab";
import type { CardJson } from "@/lib/mirror";
import { sol } from "@/lib/gacha/price";

export function gradeOf(name: string): string {
  return name.match(/\b(?:CGC|PSA|BGS|SGC|TAG|Grade)\s*(10|9\.5|9|8\.5|8|7)\b/i)?.[1] ?? "—";
}

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export const RARITY_ORDER: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];

export function rarityOf(backingLamports: bigint, evLamports: bigint): Rarity {
  if (evLamports <= 0n) return "common";
  const m = Number(backingLamports) / Number(evLamports);
  if (m >= 20) return "legendary";
  if (m >= 8) return "epic";
  if (m >= 3) return "rare";
  if (m >= 1.25) return "uncommon";
  return "common";
}

export function revealCard(card: CardJson, evLamports: string): RevealCard {
  const backing = BigInt(card.backingLamports);
  return {
    name: card.name,
    grade: gradeOf(card.name),
    rarity: rarityOf(backing, BigInt(evLamports)),
    priceSol: sol(backing),
    image: card.image,
  };
}

/** Odds as a percentage, keeping significant digits on the long tail. */
export function formatOdds(odds: number): string {
  if (odds <= 0) return "—";
  const pct = odds * 100;
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  if (pct >= 0.01) return `${pct.toFixed(3)}%`;
  return `${pct.toPrecision(2)}%`;
}
