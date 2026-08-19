/**
 * A pull, start to finish. Four steps, each its own function so a UI can
 * show what is happening between them:
 *
 *   1. requestPull    the buyer signs `request_acquisition`; the randomness
 *                     is requested on chain in the same transaction.
 *   2. waitForDraw    the request account flips `randomness_ready` when
 *                     the randomness lands and `fulfilled` when NFW settles
 *                     the draw, within about 1.5s of that.
 *   3. drawnCards     the request does not store what it drew. The
 *                     positions do: those whose `pending_request` equals
 *                     the request id, in position order for a batch.
 *   4. resolve        the buyer signs `resolve_choice` (or `_core`) with
 *                     Keep, CashOut, or KeepAndRelist. One transaction.
 *
 * Every account is named explicitly, in the order the Rust struct declares
 * it, mirroring the program's instruction structs (see the IDL). Anchor could
 * resolve some of them; spelling them out is what lets a failure be read
 * against the struct line by line.
 */

import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";

import {
  protocolTreasury,
  readPositions,
  readRequest,
  type PoolInfo,
  type PositionInfo,
  type RequestInfo,
} from "./accounts";
import type { NftMeta } from "./metadata";
import {
  ATA_PROGRAM,
  AUTH_RULES_PROGRAM,
  CORE_PROGRAM,
  VRF_PROGRAM,
  VRF_QUEUE,
  METADATA_PROGRAM,
  SYSVAR_INSTRUCTIONS,
  SYSVAR_SLOT_HASHES,
  TOKEN_PROGRAM,
  ataFor,
  collectionBoundsPda,
  masterEditionPda,
  metadataPda,
  nftVaultPda,
  programIdentityPda,
  protocolConfigPda,
  requestPda,
  requesterStatePda,
  rewardVaultPda,
  solVaultPda,
  tokenRecordPda,
} from "./pda";
import { createAtaIdempotent } from "./ata";
import { chain } from "./program";
import { sendWithWallet } from "./wallet";

/** Compute-unit limits, generous rather than measured: the network charges
 * only what is used, and running out fails with an error that names nothing. */
const CU = {
  request: 300_000,
  resolvePnft: 400_000,
  resolvePlain: 250_000,
};

/** The Anchor method builders this file uses, typed the way they behave. */
interface IxBuilder {
  accounts(a: Record<string, PublicKey | null>): IxBuilder;
  instruction(): Promise<TransactionInstruction>;
}
type Choice = { keep: Record<string, never> } | { cashOut: Record<string, never> } | { keepAndRelist: { backing: BN } };
interface Methods {
  requestAcquisition(args: { maxPrice: BN; batch: number; maxSlippageBps: number; minPoolBacking: BN; nonce: BN }): IxBuilder;
  resolveChoice(choice: Choice): IxBuilder;
  resolveChoiceCore(choice: Choice): IxBuilder;
  cancelRequest(): IxBuilder;
}
const methods = () => chain().program.methods as unknown as Methods;

// ------------------------------------------------------------ 1. request

export interface PullReceipt {
  /** The request account: what the wait watches and the settle names. */
  request: string;
  /** Millisecond nonce the request was seeded with. */
  nonce: number;
  batch: number;
  signature: string;
}

/**
 * Buy `batch` pulls at up to `maxUnitPriceLamports` each. The cap protects
 * the buyer: if the pool re-prices past it before the transaction lands,
 * the program refuses rather than overcharges. Slippage is the pool's own
 * default unless you pass one.
 */
export async function requestPull(
  buyer: PublicKey,
  poolAddress: PublicKey,
  pool: PoolInfo,
  maxUnitPriceLamports: bigint,
  batch = 1,
  maxSlippageBps = pool.slippageBps
): Promise<PullReceipt> {
  // A millisecond clock as the nonce: the program requires each requester's
  // nonces to strictly increase, which a clock satisfies for free.
  const nonce = Date.now();
  const request = requestPda(poolAddress, buyer, nonce);
  const ix = await methods()
    .requestAcquisition({
      maxPrice: new BN((maxUnitPriceLamports * BigInt(batch)).toString()),
      batch,
      maxSlippageBps,
      minPoolBacking: new BN(0),
      nonce: new BN(nonce),
    })
    .accounts({
      requester: buyer,
      pool: poolAddress,
      weightIndex: new PublicKey(pool.weightIndex),
      request,
      requesterState: requesterStatePda(poolAddress, buyer),
      oracleQueue: VRF_QUEUE,
      programIdentity: programIdentityPda(),
      vrfProgram: VRF_PROGRAM,
      slotHashes: SYSVAR_SLOT_HASHES,
      solVault: solVaultPda(poolAddress),
      rewardVault: rewardVaultPda(poolAddress),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const signature = await sendWithWallet(buyer, [ix], CU.request);
  return { request: request.toBase58(), nonce, batch, signature };
}

// --------------------------------------------------------------- 2. wait

export interface WaitOptions {
  /** Give up after this long; the request is still yours afterwards. */
  timeoutMs?: number;
  /** Poll interval. Subscriptions need a WebSocket the proxy cannot carry. */
  pollMs?: number;
  onUpdate?: (r: RequestInfo) => void;
}

/** Wait until the request is fulfilled; resolves with the request as it stands. */
export async function waitForDraw(requestAddress: PublicKey, opts: WaitOptions = {}): Promise<RequestInfo> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const pollMs = opts.pollMs ?? 2_500;
  const started = Date.now();
  for (;;) {
    const r = await readRequest(requestAddress).catch(() => null);
    if (r) {
      opts.onUpdate?.(r);
      if (r.fulfilled) return r;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error("The draw did not land in time. Your pull is still open; come back and settle it.");
    }
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

// -------------------------------------------------------- 3. drawn cards

/** The positions a fulfilled request drew, in position order. */
export async function drawnCards(poolAddress: PublicKey, requestId: number): Promise<PositionInfo[]> {
  const positions = await readPositions(poolAddress);
  return positions.filter((p) => p.pendingRequest === requestId);
}

// ------------------------------------------------------------ 4. resolve

export type Exit = "keep" | "cashOut" | "keepAndRelist";

/**
 * `keep_and_relist` makes the caller pay the outgoing depositor's rents as
 * well as the new backing (the Position PDA and the vault survive under
 * the new owner), about 0.004 SOL plus the fee. Reserved off the wallet's
 * balance before the ceiling is drawn.
 */
export const RELIST_RESERVE_LAMPORTS = 5_000_000n;

export interface RelistLimits {
  minLamports: bigint;
  maxLamports: bigint;
  /** What the card was backed at by the depositor you drew it from. */
  previousBackingLamports: bigint;
  /** Whether any legal value exists at all: false when the wallet cannot
   * reach the pool's minimum. */
  affordable: boolean;
}

/**
 * The bounds a relist is judged against: the pool's, tightened by the drawn
 * card's collection band, capped by what the wallet can pay. Offering a
 * value the program will refuse is the bug this exists to prevent.
 */
export function relistLimits(
  bounds: { minLamports: bigint; maxLamports: bigint },
  card: PositionInfo,
  walletLamports: bigint
): RelistLimits {
  const affordable = walletLamports > RELIST_RESERVE_LAMPORTS ? walletLamports - RELIST_RESERVE_LAMPORTS : 0n;
  const maxLamports = affordable < bounds.maxLamports ? affordable : bounds.maxLamports;
  return {
    minLamports: bounds.minLamports,
    maxLamports,
    previousBackingLamports: card.backingLamports,
    affordable: maxLamports >= bounds.minLamports,
  };
}

/**
 * Settle one drawn card. `meta` must describe the card's mint (standard,
 * rule set, verified collection): a pNFT settle needs the Token Metadata
 * bundle, a Core settle names the collection, and a relist needs the
 * collection's bounds. `relistBackingLamports` only for keepAndRelist.
 */
export async function resolve(
  buyer: PublicKey,
  poolAddress: PublicKey,
  pool: PoolInfo,
  request: RequestInfo,
  card: PositionInfo,
  meta: Pick<NftMeta, "collection" | "tokenStandard" | "ruleSet">,
  exit: Exit,
  relistBackingLamports?: bigint
): Promise<string> {
  const choice: Choice =
    exit === "keep"
      ? { keep: {} }
      : exit === "cashOut"
        ? { cashOut: {} }
        : { keepAndRelist: { backing: new BN((relistBackingLamports ?? request.quotedEvLamports).toString()) } };
  const relist = exit === "keepAndRelist";
  if (relist && !pool.relistEnabled) throw new Error("This pool does not allow keep & relist.");
  const collection = meta.collection ? new PublicKey(meta.collection) : null;
  if (relist && !collection) throw new Error("Cannot relist a card with no verified collection.");

  const mint = new PublicKey(card.mint);
  const position = new PublicKey(card.address);
  const depositor = new PublicKey(card.depositor);
  const common = {
    caller: buyer,
    pool: poolAddress,
    weightIndex: new PublicKey(pool.weightIndex),
    request: new PublicKey(request.address),
    position,
    depositor,
    requester: buyer,
    solVault: solVaultPda(poolAddress),
    rewardVault: rewardVaultPda(poolAddress),
    systemProgram: SystemProgram.programId,
    protocolConfig: protocolConfigPda(),
    treasury: await protocolTreasury(),
  };

  if (card.standard === 1) {
    // Metaplex Core: the asset goes to a bare wallet, no token account.
    if (!collection) throw new Error("Core asset has no collection.");
    const ix = await methods()
      .resolveChoiceCore(choice)
      .accounts({
        ...common,
        asset: mint,
        coreCollection: collection,
        coreProgram: CORE_PROGRAM,
        collectionBounds: relist ? collectionBoundsPda(poolAddress, collection) : null,
      })
      .instruction();
    return sendWithWallet(buyer, [ix], CU.resolvePnft);
  }

  // Token Metadata. The NFT lands in the buyer's ATA on Keep, the
  // depositor's on CashOut, nowhere on a relist. pNFTs (standard 4) need
  // the metadata bundle; passing it to a plain NFT is harmless, missing it
  // on a pNFT fails, so it rides whenever the mint says pNFT.
  const pnft = meta.tokenStandard === 4;
  const destinationOwner = exit === "keep" ? buyer : depositor;
  const destination = relist ? null : ataFor(destinationOwner, mint);
  const vault = nftVaultPda(position);
  const ruleSet = meta.ruleSet ? new PublicKey(meta.ruleSet) : null;
  const ix = await methods()
    .resolveChoice(choice)
    .accounts({
      ...common,
      nftMint: mint,
      nftVault: vault,
      nftDestination: destination,
      tokenProgram: TOKEN_PROGRAM,
      nftMetadata: pnft || relist ? metadataPda(mint) : null,
      nftMasterEdition: pnft ? masterEditionPda(mint) : null,
      vaultTokenRecord: pnft ? tokenRecordPda(mint, vault) : null,
      destinationTokenRecord: pnft && destination ? tokenRecordPda(mint, destination) : null,
      sysvarInstructions: pnft ? SYSVAR_INSTRUCTIONS : null,
      metadataProgram: pnft ? METADATA_PROGRAM : null,
      ataProgram: pnft ? ATA_PROGRAM : null,
      authRules: pnft ? ruleSet : null,
      authRulesProgram: pnft && ruleSet ? AUTH_RULES_PROGRAM : null,
      collectionBounds: relist && collection ? collectionBoundsPda(poolAddress, collection) : null,
    })
    .instruction();
  // The destination token account usually does not exist yet (a buyer
  // keeping a card has never held this mint); create it idempotently first.
  const pre = destination ? [createAtaIdempotent(buyer, destination, destinationOwner, mint)] : [];
  return sendWithWallet(buyer, [...pre, ix], pnft ? CU.resolvePnft : CU.resolvePlain);
}

// ------------------------------------------------------------ 4. cancel

/** A request whose randomness never lands is refundable after this long:
 * the program's own expiry, mirrored so the menu can call it before asking. */
export const REQUEST_EXPIRY_MS = 15 * 60 * 1000;

/**
 * `cancel_request`: refund a pull whose draw never landed. Permissionless
 * once the request is past its expiry, head of queue only; the program
 * returns `price_paid - vrf_fee` to the ORIGINAL requester whoever signs,
 * so a storefront may offer it to the buyer as a plain button.
 */
export async function cancelRequest(caller: PublicKey, poolAddress: PublicKey, request: RequestInfo): Promise<string> {
  const ix = await methods()
    .cancelRequest()
    .accounts({
      caller,
      pool: poolAddress,
      request: new PublicKey(request.address),
      requester: new PublicKey(request.requester),
      rewardVault: rewardVaultPda(poolAddress),
    })
    .instruction();
  return sendWithWallet(caller, [ix], 120_000);
}
