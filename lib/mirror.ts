/**
 * The mini-mirror: read a pool from the chain, hydrate what its cards are
 * called and look like, remember it all in SQLite. Route handlers call
 * `snapshot(pool)`; the browser only ever sees the JSON this returns.
 *
 * Freshness: a snapshot younger than POOL_TTL_MS is served as is, so a
 * busy page costs one chain read per few seconds, not one per visitor.
 * Card metadata is fetched once per mint and kept: it does not change.
 * Server-only.
 */

import { PublicKey } from "@solana/web3.js";

import { readPool, readPositions, type PoolInfo } from "@/lib/gacha/accounts";
import { fetchOffChain, gatewayUrl, readOnChainMeta } from "@/lib/gacha/metadata";
import { shelfArt } from "@/lib/directory";
import { expectedValue, sol } from "@/lib/gacha/price";
import * as store from "@/lib/db";

const POOL_TTL_MS = 8_000;

/** PoolInfo with bigints as strings, safe to JSON. */
export type PoolJson = Omit<
  PoolInfo,
  | "totalBackingLamports"
  | "totalWeight"
  | "priceLamports"
  | "minBackingLamports"
  | "maxBackingLamports"
  | "vrfFeeLamports"
  | "feesAccruedLamports"
  | "crownPotLamports"
> & {
  totalBackingLamports: string;
  totalWeight: string;
  priceLamports: string;
  priceSol: string;
  /** Expected value of a draw (the price before surcharge). */
  evLamports: string;
  minBackingLamports: string;
  maxBackingLamports: string;
  vrfFeeLamports: string;
  feesAccruedLamports: string;
  crownPotLamports: string;
};

export interface CardJson {
  address: string;
  mint: string;
  depositor: string;
  positionId: number;
  backingLamports: string;
  backingSol: string;
  slotIndex: number;
  status: string;
  pendingRequest: number | null;
  standard: number;
  odds: number;
  name: string;
  image: string | null;
  collection: string | null;
  tokenStandard: number | null;
  ruleSet: string | null;
}

export interface Snapshot {
  pool: PoolJson;
  cards: CardJson[];
  fetchedAt: number;
  /** Filled in by the route from the directory; null when it is unreachable. */
  directory?: import("@/lib/directory").DirectoryStats | null;
}

const toJson = (p: PoolInfo): PoolJson => ({
  ...p,
  totalBackingLamports: p.totalBackingLamports.toString(),
  totalWeight: p.totalWeight.toString(),
  priceLamports: p.priceLamports.toString(),
  priceSol: sol(p.priceLamports),
  evLamports: (p.activePositions > 0 ? expectedValue(p.activePositions, p.totalWeight) : 0n).toString(),
  minBackingLamports: p.minBackingLamports.toString(),
  maxBackingLamports: p.maxBackingLamports.toString(),
  vrfFeeLamports: p.vrfFeeLamports.toString(),
  feesAccruedLamports: p.feesAccruedLamports.toString(),
  crownPotLamports: p.crownPotLamports.toString(),
});

/** Names, images and settle facts for mints we have not seen before. */
export async function ensureMetas(mints: string[]): Promise<Map<string, store.StoredMeta>> {
  const have = store.getMetas(mints);
  const missing = mints.filter((m) => !have.has(m) || have.get(m)!.fetchedAt === 0);
  if (missing.length) {
    // The shelf and the chain in parallel: the shelf gives the picture's
    // durable home, the chain and the JSON give the rest.
    const [onChain, shelf] = await Promise.all([readOnChainMeta(missing), shelfArt(missing)]);
    // Off-chain JSON in parallel, bounded per fetch inside fetchOffChain.
    await Promise.all(
      [...onChain.values()].map(async (m) => {
        const off = await fetchOffChain(m.uri);
        const row: store.StoredMeta = {
          mint: m.mint,
          name: off.name && off.name.length > m.name.length ? off.name : m.name,
          image: shelf[m.mint] ?? off.image,
          uri: m.uri,
          collection: m.collection,
          tokenStandard: m.tokenStandard,
          ruleSet: m.ruleSet,
          core: m.core,
          insuredUsd: off.insuredUsd,
          fetchedAt: Date.now(),
        };
        store.putMeta(row);
        have.set(m.mint, row);
      })
    );
  }
  // Images leave through the site's own /api/ipfs however they were stored
  // (rows written before the route carry a public-gateway URL).
  for (const [k, v] of have) if (v.image) have.set(k, { ...v, image: gatewayUrl(v.image) });
  return have;
}

/** The pool and its cards, from the cache when fresh, else from the chain. */
export async function snapshot(address: string, fresh = false): Promise<Snapshot> {
  const cached = store.getPool<PoolJson>(address);
  if (!fresh && cached && Date.now() - cached.fetchedAt < POOL_TTL_MS) {
    return assemble(cached.info, store.getPositions(address), cached.fetchedAt);
  }
  const key = new PublicKey(address);
  const info = await readPool(key);
  const positions = await readPositions(key, info.totalWeight);
  const rows: store.StoredPosition[] = positions.map((p) => ({
    pool: address,
    address: p.address,
    mint: p.mint,
    depositor: p.depositor,
    positionId: p.positionId,
    backing: p.backingLamports.toString(),
    slotIndex: p.slotIndex,
    status: p.status,
    pendingRequest: p.pendingRequest,
    standard: p.standard,
    odds: p.odds,
  }));
  const json = toJson(info);
  store.putPool(address, json);
  store.putPositions(address, rows);
  return assemble(json, rows, Date.now());
}

async function assemble(pool: PoolJson, rows: store.StoredPosition[], fetchedAt: number): Promise<Snapshot> {
  const metas = await ensureMetas(rows.map((r) => r.mint));
  const cards: CardJson[] = rows.map((r) => {
    const m = metas.get(r.mint);
    return {
      address: r.address,
      mint: r.mint,
      depositor: r.depositor,
      positionId: r.positionId,
      backingLamports: r.backing,
      backingSol: sol(BigInt(r.backing)),
      slotIndex: r.slotIndex,
      status: r.status,
      pendingRequest: r.pendingRequest,
      standard: r.standard,
      odds: r.odds,
      name: m?.name ?? `${r.mint.slice(0, 4)}…${r.mint.slice(-4)}`,
      image: m?.image ? gatewayUrl(m.image) : null,
      collection: m?.collection ?? null,
      tokenStandard: m?.tokenStandard ?? null,
      ruleSet: m?.ruleSet ?? null,
    };
  });
  return { pool, cards, fetchedAt };
}
