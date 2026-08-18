/**
 * What a card last actually sold for, read from its own transactions; the
 * same walk the OpenGacha console and nfw.fun perform, done here on the
 * server so one visitor's answer serves the next (it lands in the local
 * database on two clocks: a found sale keeps for a day, "no sale" for an
 * hour, the normal answer for a slab).
 *
 * Why it exists: an issuer that writes an insured value into the metadata
 * gives a card its worth for free. One that writes only the grade does not,
 * and then the last trade is the one honest number the deposit chips can
 * stand on. Three issuers, three shapes, all reducing to one test: money
 * moved in a transaction that touched this mint, and not as part of a
 * multi-asset batch. USDC first (the largest negative USDC delta: the
 * buyer's balance drops by the price); failing that the SOL leg (the
 * largest lamport debit above a dust floor that excludes rent and fees).
 *
 * Bounded: signatures newest-first, stop at the first sale, give up after
 * SALE_SCAN_TXS transactions. Up to 41 RPC reads per card, which is why
 * the route that calls this takes a few mints at a time.
 */

import { PublicKey } from "@solana/web3.js";

import { chain } from "@/lib/gacha/program";
import * as store from "@/lib/db";

export interface LastSale {
  usd: number | null;
  lamports: string | null;
  at: number;
}

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SALE_SCAN_TXS = 40;
const SOL_SALE_DUST_LAMPORTS = 50_000_000n; // 0.05 SOL
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const NONE_TTL_MS = 60 * 60 * 1000;

const inflight = new Map<string, Promise<LastSale | null>>();

/** The card's last sale: the database when fresh, else the walk. A walk
 * already out for this mint answers this caller too. */
export async function lastSaleOf(mint: string): Promise<LastSale | null> {
  const stored = store.getSale(mint);
  if (stored) {
    const ttl = stored.sale ? FOUND_TTL_MS : NONE_TTL_MS;
    if (Date.now() - stored.checkedAt < ttl) return stored.sale;
  }
  const running = inflight.get(mint);
  if (running) return running;
  const walk = scanSale(mint).finally(() => inflight.delete(mint));
  inflight.set(mint, walk);
  return walk;
}

async function scanSale(mint: string): Promise<LastSale | null> {
  const { connection } = chain();
  let found: LastSale | null = null;
  let completed = false;
  try {
    const sigs = await connection.getSignaturesForAddress(new PublicKey(mint), { limit: SALE_SCAN_TXS });
    for (const s of sigs) {
      const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      if (!tx || tx.meta?.err) continue;
      const logs = tx.meta?.logMessages ?? [];
      let paid = 0;
      for (const post of tx.meta?.postTokenBalances ?? []) {
        if (post.mint !== USDC_MINT) continue;
        const pre = (tx.meta?.preTokenBalances ?? []).find((p) => p.accountIndex === post.accountIndex);
        const delta = (post.uiTokenAmount.uiAmount ?? 0) - (pre?.uiTokenAmount.uiAmount ?? 0);
        if (delta < 0) paid = Math.max(paid, -delta);
      }
      let paidLamports = 0n;
      if (paid === 0) {
        const pre = tx.meta?.preBalances ?? [];
        const post = tx.meta?.postBalances ?? [];
        for (let i = 0; i < post.length; i++) {
          const delta = BigInt(pre[i] ?? 0) - BigInt(post[i] ?? 0);
          if (delta > paidLamports) paidLamports = delta;
        }
        if (paidLamports < SOL_SALE_DUST_LAMPORTS) paidLamports = 0n;
      }
      if (paid === 0 && paidLamports === 0n) continue;
      // The batch guard: a single-card settlement logs at most two
      // Transfers (payment and asset). BuyCore is exempt, one card per call.
      const transfers = logs.filter((l) => l.includes("Instruction: Transfer")).length;
      const isSale = logs.some((l) => l.includes("Instruction: BuyCore")) || transfers <= 2;
      if (!isSale) continue;
      found = {
        usd: paid > 0 ? paid : null,
        lamports: paidLamports > 0n ? paidLamports.toString() : null,
        at: (s.blockTime ?? 0) * 1000,
      };
      break;
    }
    completed = true;
  } catch {
    // Display only: a card with no price renders as one with no price.
  }
  // A completed walk is an answer either way; an aborted one (rate limit,
  // network) stays unstored so the next request actually retries.
  if (completed) store.putSale(mint, found);
  return found;
}
