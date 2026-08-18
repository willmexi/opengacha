/**
 * Reading the pool: the accounts the pull path looks at, decoded into
 * plain objects with bigint money and string keys, so the rest of the app
 * (and the JSON API routes) never touch Anchor's BN or PublicKey.
 *
 * Money reads come from here, from the accounts themselves. The sqlite
 * cache in lib/db.ts is for display; anything that decides a price or a
 * settle re-reads the chain through these functions.
 */

import type { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { protocolConfigPda } from "./pda";
import { chain } from "./program";
import { pullPrice, weightOf } from "./price";

const big = (v: BN | number | bigint) => BigInt(v.toString());
const key = (v: PublicKey) => v.toBase58();

/** Anchor's account namespace, typed the way this file uses it. */
interface Fetcher<T> {
  fetch(address: PublicKey): Promise<T>;
  fetchNullable(address: PublicKey): Promise<T | null>;
  all(filters?: { memcmp: { offset: number; bytes: string } }[]): Promise<{ publicKey: PublicKey; account: T }[]>;
}
interface Accounts {
  pool: Fetcher<RawPool>;
  position: Fetcher<RawPosition>;
  acquisitionRequest: Fetcher<RawRequest>;
  protocolConfig: Fetcher<{ treasury: PublicKey }>;
}
const accounts = () => chain().program.account as unknown as Accounts;

/** The one field the client reads from the weight index: total_weight,
 * the price denominator, at byte 40 of the header. */
const INDEX_HEADER_BYTES = 48;
const totalWeightOf = (data: Uint8Array) =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(40, true);

// Position layout: 8 discriminator, then `pool` first. Requests share it.
const OFFSET_POOL = 8;
const OFFSET_REQUESTER = 8 + 32;

export interface PoolInfo {
  address: string;
  authority: string;
  weightIndex: string;
  activePositions: number;
  pendingPositions: number;
  totalBackingLamports: bigint;
  totalWeight: bigint;
  /** Unit price for one pull, right now. */
  priceLamports: bigint;
  surchargeBps: number;
  bidRateBps: number;
  slippageBps: number;
  protocolFeeBps: number;
  settlementFeeBps: number;
  maxBatch: number;
  ownStock: boolean;
  relistEnabled: boolean;
  acquisitionsPaused: boolean;
  resolveWindowSeconds: number;
  finalWindowSeconds: number;
  requestExpirySeconds: number;
  minBackingLamports: bigint;
  maxBackingLamports: bigint;
  vrfFeeLamports: bigint;
  /** Requests ever opened on this pool: the pull count. */
  pullCount: number;
  /** Fees waiting in the pool for the creator and protocol to claim. */
  feesAccruedLamports: bigint;
  crownPotLamports: bigint;
}

interface RawPool {
  authority: PublicKey;
  weightIndex: PublicKey;
  activePositions: number;
  pendingPositions: number;
  totalBacking: BN;
  surchargeBps: number;
  bidRateBps: number;
  slippageBps: number;
  protocolFeeBps: number;
  settlementFeeBps: number;
  maxBatch: number;
  creatorOnlyDeposits: boolean;
  relistEnabled: boolean;
  acquisitionsPaused: boolean;
  resolveWindowSeconds: BN;
  finalWindowSeconds: BN;
  requestExpirySeconds: BN;
  minBacking: BN;
  maxBacking: BN;
  vrfFee: BN;
  nextRequestId: BN;
  protocolFeesAccrued: BN;
  crownPot: BN;
}

/** The pool account plus its index header, priced. Two reads. */
export async function readPool(pool: PublicKey): Promise<PoolInfo> {
  const { connection } = chain();
  const p = await accounts().pool.fetch(pool);
  const index = await connection.getAccountInfo(p.weightIndex, {
    dataSlice: { offset: 0, length: INDEX_HEADER_BYTES },
  });
  if (!index) throw new Error("weight index account missing");
  const totalWeight = totalWeightOf(index.data);
  const priceLamports =
    p.activePositions > 0 ? pullPrice(p.activePositions, totalWeight, p.surchargeBps) : 0n;
  return {
    address: key(pool),
    authority: key(p.authority),
    weightIndex: key(p.weightIndex),
    activePositions: p.activePositions,
    pendingPositions: p.pendingPositions,
    totalBackingLamports: big(p.totalBacking),
    totalWeight,
    priceLamports,
    surchargeBps: p.surchargeBps,
    bidRateBps: p.bidRateBps,
    slippageBps: p.slippageBps,
    protocolFeeBps: p.protocolFeeBps,
    settlementFeeBps: p.settlementFeeBps,
    maxBatch: p.maxBatch,
    ownStock: p.creatorOnlyDeposits,
    relistEnabled: p.relistEnabled && !p.creatorOnlyDeposits,
    acquisitionsPaused: p.acquisitionsPaused,
    resolveWindowSeconds: Number(p.resolveWindowSeconds),
    finalWindowSeconds: Number(p.finalWindowSeconds),
    requestExpirySeconds: Number(p.requestExpirySeconds),
    minBackingLamports: big(p.minBacking),
    maxBackingLamports: big(p.maxBacking),
    vrfFeeLamports: big(p.vrfFee),
    pullCount: Number(p.nextRequestId),
    feesAccruedLamports: big(p.protocolFeesAccrued),
    crownPotLamports: big(p.crownPot),
  };
}

export type PositionStatus = "staged" | "active" | "pending" | "closed";

export interface PositionInfo {
  address: string;
  mint: string;
  depositor: string;
  positionId: number;
  backingLamports: bigint;
  slotIndex: number;
  status: PositionStatus;
  /** The queue id of the request that drew it, while a settle is pending. */
  pendingRequest: number | null;
  /** 0 = Token Metadata NFT, 1 = Metaplex Core asset. */
  standard: 0 | 1;
  /** Share of the next draw, from this position's weight over the pool's. */
  odds: number;
}

interface RawPosition {
  depositor: PublicKey;
  nftMint: PublicKey;
  positionId: BN;
  backingAmount: BN;
  slotIndex: number;
  status: Record<string, unknown>;
  pendingRequest: BN | null;
  standard: number;
}

const statusOf = (s: Record<string, unknown>): PositionStatus => {
  const tag = Object.keys(s)[0] ?? "closed";
  return tag === "pendingResolution" ? "pending" : (tag as PositionStatus);
};

/** Every position in the pool, one getProgramAccounts. `totalWeight` is
 * only for the odds column; pass it from readPool when you have it. */
export async function readPositions(pool: PublicKey, totalWeight = 0n): Promise<PositionInfo[]> {
  const rows = await accounts().position.all([{ memcmp: { offset: OFFSET_POOL, bytes: pool.toBase58() } }]);
  return rows
    .map(({ publicKey, account: a }) => {
      const backing = big(a.backingAmount);
      const status = statusOf(a.status);
      return {
        address: key(publicKey),
        mint: key(a.nftMint),
        depositor: key(a.depositor),
        positionId: Number(a.positionId),
        backingLamports: backing,
        slotIndex: a.slotIndex,
        status,
        pendingRequest: a.pendingRequest === null ? null : Number(a.pendingRequest),
        standard: (a.standard === 1 ? 1 : 0) as 0 | 1,
        odds: status === "active" && totalWeight > 0n ? Number(weightOf(backing)) / Number(totalWeight) : 0,
      };
    })
    .sort((x, y) => x.positionId - y.positionId);
}

export interface RequestInfo {
  address: string;
  requester: string;
  requestId: number;
  nonce: number;
  batch: number;
  pricePaidLamports: bigint;
  quotedEvLamports: bigint;
  bidRateBps: number;
  randomnessReady: boolean;
  fulfilled: boolean;
  resolved: boolean;
  resolvedCount: number;
  createdAt: number;
  randomness: Uint8Array;
  seed: Uint8Array;
}

interface RawRequest {
  requester: PublicKey;
  requestId: BN;
  nonce: BN;
  batch: number;
  pricePaid: BN;
  quotedEv: BN;
  bidRateBps: number;
  randomnessReady: boolean;
  fulfilled: boolean;
  resolved: boolean;
  resolvedCount: number;
  createdAt: BN;
  randomness: number[];
  seed: number[];
}

export function shapeRequest(address: PublicKey, r: RawRequest): RequestInfo {
  return {
    address: key(address),
    requester: key(r.requester),
    requestId: Number(r.requestId),
    nonce: Number(r.nonce),
    batch: r.batch,
    pricePaidLamports: big(r.pricePaid),
    quotedEvLamports: big(r.quotedEv),
    bidRateBps: r.bidRateBps,
    randomnessReady: r.randomnessReady,
    fulfilled: r.fulfilled,
    resolved: r.resolved,
    resolvedCount: r.resolvedCount,
    createdAt: Number(r.createdAt),
    randomness: Uint8Array.from(r.randomness),
    seed: Uint8Array.from(r.seed),
  };
}

/** One request by address, or null when it does not exist (yet). */
export async function readRequest(address: PublicKey): Promise<RequestInfo | null> {
  const r = await accounts().acquisitionRequest.fetchNullable(address);
  return r ? shapeRequest(address, r) : null;
}

/** Decode request bytes we already hold (from a subscription). */
export function decodeRequest(address: PublicKey, data: Buffer): RequestInfo {
  const { program } = chain();
  return shapeRequest(address, program.coder.accounts.decode("acquisitionRequest", data) as RawRequest);
}

/** A wallet's still-open requests in this pool: the pulls it can settle. */
export async function readOpenRequests(pool: PublicKey, requester: PublicKey): Promise<RequestInfo[]> {
  const rows = await accounts().acquisitionRequest.all([
    { memcmp: { offset: OFFSET_POOL, bytes: pool.toBase58() } },
    { memcmp: { offset: OFFSET_REQUESTER, bytes: requester.toBase58() } },
  ]);
  return rows
    .map((r) => shapeRequest(r.publicKey, r.account))
    .filter((r) => !r.resolved)
    .sort((a, b) => a.requestId - b.requestId);
}

/** The protocol treasury a settle must pay; read once, it moves only by
 * protocol-authority action. */
let treasury: Promise<PublicKey> | null = null;
export function protocolTreasury(): Promise<PublicKey> {
  if (!treasury) {
    const read = accounts()
      .protocolConfig.fetch(protocolConfigPda())
      .then((c) => c.treasury)
      .catch((e: unknown) => {
        treasury = null;
        throw e;
      });
    treasury = read;
  }
  return treasury;
}
