/**
 * The depositor's side of a pool: what a wallet holds that the pool would
 * take, how to put a card in, how to take it out, and how to claim what
 * it earned while it sat there. Account layouts mirror opengacha.io's
 * console on opengacha.io and the program's instruction structs (see the IDL).
 *
 * Who may deposit is the pool's rule, not ours: an own-stock pool refuses
 * anyone but its creator (`creator_only_deposits`), a decentralised pool
 * takes any card from a collection it admits. Withdrawals are never
 * pausable, so a depositor's card can always come back.
 */

import { BN } from "@coral-xyz/anchor";
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";

import { readOpenRequests, readPositions, type PoolInfo, type PositionInfo } from "./accounts";
import { decodeCoreAsset, decodeTokenMetadata } from "./metadata";
import {
  ATA_PROGRAM,
  AUTH_RULES_PROGRAM,
  CORE_PROGRAM,
  METADATA_PROGRAM,
  SYSVAR_INSTRUCTIONS,
  TOKEN_PROGRAM,
  admittedCollectionPda,
  ataFor,
  collectionBoundsPda,
  issuerWaiverPda,
  masterEditionPda,
  metadataPda,
  nftVaultPda,
  positionPda,
  requestPda,
  rewardVaultPda,
  solVaultPda,
  tokenRecordPda,
} from "./pda";
import { createAtaIdempotent } from "./ata";
import { chain } from "./program";
import { sendWithWallet } from "./wallet";

/** Compute per action, opengacha.io's figures. A pNFT deposit or withdraw
 * CPIs into Token Metadata; a Core one into the Core program; a claim moves
 * lamports and nothing else. */
const CU = {
  depositPlain: 200_000,
  depositPnft: 400_000,
  depositCore: 200_000,
  withdrawPlain: 200_000,
  withdrawPnft: 400_000,
  withdrawCore: 120_000,
  claim: 60_000,
};

interface IxBuilder {
  accounts(a: Record<string, PublicKey | null>): IxBuilder;
  remainingAccounts(r: AccountMeta[]): IxBuilder;
  instruction(): Promise<TransactionInstruction>;
}
interface Methods {
  deposit(backing: BN): IxBuilder;
  depositCore(backing: BN): IxBuilder;
  withdraw(): IxBuilder;
  withdrawCore(): IxBuilder;
  claimRewards(): IxBuilder;
}
const methods = () => chain().program.methods as unknown as Methods;

interface Fetcher<T> {
  fetch(address: PublicKey): Promise<T>;
  all(filters?: { memcmp: { offset: number; bytes: string } }[]): Promise<{ publicKey: PublicKey; account: T }[]>;
}
interface Accounts {
  pool: Fetcher<{ crownDepositor: PublicKey | null; weightIndex: PublicKey; accRewardPerPosition: BN; nextRequestId: BN; nextFulfillableId: BN }>;
  admittedCollection: Fetcher<{ collection: PublicKey }>;
  collectionBounds: Fetcher<{ collection: PublicKey; minBacking: BN; maxBacking: BN }>;
  position: Fetcher<{ depositor: PublicKey; nftMint: PublicKey; status: Record<string, unknown>; standard: number; accruedRewards: BN; rewardCheckpoint: BN }>;
  acquisitionRequest: Fetcher<{ requestId: BN; requester: PublicKey; nonce: BN }>;
}
const accounts = () => chain().program.account as unknown as Accounts;

const OFFSET_POOL = 8;

// -------------------------------------------------------------- admission

/** The verified collections this pool admits: the deposit gate. */
export async function readAdmitted(pool: PublicKey): Promise<string[]> {
  const rows = await accounts().admittedCollection.all([{ memcmp: { offset: OFFSET_POOL, bytes: pool.toBase58() } }]);
  return rows.map((r) => r.account.collection.toBase58());
}

export interface Bounds {
  minLamports: bigint;
  maxLamports: bigint;
}

/** Per-collection backing bounds, keyed by collection. Absent means the
 * pool-wide bounds apply. */
export async function readBounds(pool: PublicKey): Promise<Record<string, Bounds>> {
  const rows = await accounts().collectionBounds.all([{ memcmp: { offset: OFFSET_POOL, bytes: pool.toBase58() } }]);
  const out: Record<string, Bounds> = {};
  for (const { account: b } of rows) {
    out[b.collection.toBase58()] = {
      minLamports: BigInt(b.minBacking.toString()),
      maxLamports: BigInt(b.maxBacking.toString()),
    };
  }
  return out;
}

/** The bounds a deposit (or a relist) of a card from `collection` is judged
 * against: the pool's, tightened by the collection's own band when it has one. */
export function effectiveBounds(pool: PoolInfo, collection: string | null, perCollection: Record<string, Bounds>): Bounds {
  const band = collection ? perCollection[collection] : undefined;
  return {
    minLamports: band && band.minLamports > pool.minBackingLamports ? band.minLamports : pool.minBackingLamports,
    maxLamports: band && band.maxLamports < pool.maxBackingLamports ? band.maxLamports : pool.maxBackingLamports,
  };
}

// ---------------------------------------------------------- what you hold

export interface WalletNft {
  mint: string;
  name: string;
  uri: string;
  collection: string;
  tokenStandard: number | null;
  ruleSet: string | null;
  core: boolean;
}

/**
 * The wallet's NFTs from the given admitted collections, both shapes the
 * program takes: token accounts holding one unit of a zero-decimal mint
 * whose metadata names a VERIFIED admitted collection (classic and pNFT),
 * and Metaplex Core assets in an admitted collection, found through DAS
 * (`getAssetsByOwner`; an RPC without DAS just yields no Core cards).
 */
export async function walletNfts(owner: PublicKey, admitted: string[]): Promise<WalletNft[]> {
  if (admitted.length === 0) return [];
  const admittedSet = new Set(admitted);
  const { connection } = chain();

  const tokens = (async () => {
    const { value } = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM });
    const mints = value
      .map((v) => v.account.data.parsed?.info)
      .filter((i) => i?.tokenAmount?.amount === "1" && i?.tokenAmount?.decimals === 0)
      .map((i) => new PublicKey(i.mint));
    const out: WalletNft[] = [];
    for (let i = 0; i < mints.length; i += 100) {
      const chunk = mints.slice(i, i + 100);
      const infos = await connection.getMultipleAccountsInfo(chunk.map(metadataPda));
      infos.forEach((info, j) => {
        const m = info ? decodeTokenMetadata(Buffer.from(info.data), chunk[j].toBase58()) : null;
        if (!m?.collection || !admittedSet.has(m.collection)) return;
        out.push({ mint: m.mint, name: m.name || short(m.mint), uri: m.uri, collection: m.collection, tokenStandard: m.tokenStandard, ruleSet: m.ruleSet, core: false });
      });
    }
    return out;
  })();

  const cores = walletCoreAssets(owner, admittedSet).catch(() => [] as WalletNft[]);
  const [a, b] = await Promise.all([tokens, cores]);
  return [...a, ...b];
}

async function walletCoreAssets(owner: PublicKey, admitted: Set<string>): Promise<WalletNft[]> {
  const { connection } = chain();
  const res = await fetch(connection.rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAssetsByOwner", params: { ownerAddress: owner.toBase58(), page: 1, limit: 1000 } }),
  });
  if (!res.ok) throw new Error(`das ${res.status}`);
  const items = (await res.json())?.result?.items;
  if (!Array.isArray(items)) return [];
  const out: WalletNft[] = [];
  for (const a of items) {
    if (a?.interface !== "MplCoreAsset" || a?.compression?.compressed || a?.burnt) continue;
    const collection = (a?.grouping ?? []).find((g: { group_key?: string }) => g?.group_key === "collection")?.group_value;
    if (!collection || !admitted.has(collection)) continue;
    out.push({ mint: a.id, name: a?.content?.metadata?.name || short(a.id), uri: a?.content?.json_uri ?? "", collection, tokenStandard: null, ruleSet: null, core: true });
  }
  return out;
}

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

// ---------------------------------------------------------------- deposit

/**
 * Put one card into the pool at `backingLamports`. Backing sets the card's
 * odds (inverse) and what a winner's cash-out pays; it must sit inside the
 * effective bounds. The crown holder rides along unless it is the depositor
 * (the program does not consult it then). Own-stock pools refuse anyone but
 * the creator; that is the program's answer, not a check here.
 */
export async function depositCard(depositor: PublicKey, poolAddress: PublicKey, nft: WalletNft, backingLamports: bigint): Promise<string> {
  const p = await accounts().pool.fetch(poolAddress);
  const crownHolder = p.crownDepositor && !p.crownDepositor.equals(depositor) ? p.crownDepositor : null;
  const mint = new PublicKey(nft.mint);
  const collection = new PublicKey(nft.collection);
  const position = positionPda(poolAddress, mint);
  const backing = new BN(backingLamports.toString());

  if (nft.core) {
    // The issuer waiver rides in remainingAccounts unconditionally: its
    // existence on chain is the answer, and a missing account reads as
    // "not waived".
    const ix = await methods()
      .depositCore(backing)
      .accounts({
        depositor,
        pool: poolAddress,
        weightIndex: p.weightIndex,
        position,
        asset: mint,
        coreCollection: collection,
        admittedCollection: admittedCollectionPda(poolAddress, collection),
        solVault: solVaultPda(poolAddress),
        rewardVault: rewardVaultPda(poolAddress),
        crownHolder,
        collectionBounds: collectionBoundsPda(poolAddress, collection),
        coreProgram: CORE_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([{ pubkey: issuerWaiverPda(poolAddress, collection), isSigner: false, isWritable: false }])
      .instruction();
    return sendWithWallet(depositor, [ix], CU.depositCore);
  }

  const vault = nftVaultPda(position);
  const ata = ataFor(depositor, mint);
  const pnft = nft.tokenStandard === 4;
  const ruleSet = nft.ruleSet ? new PublicKey(nft.ruleSet) : null;
  const ix = await methods()
    .deposit(backing)
    .accounts({
      depositor,
      pool: poolAddress,
      weightIndex: p.weightIndex,
      position,
      nftMint: mint,
      nftMetadata: metadataPda(mint),
      nftMasterEdition: masterEditionPda(mint),
      depositorNftAccount: ata,
      nftVault: vault,
      solVault: solVaultPda(poolAddress),
      rewardVault: rewardVaultPda(poolAddress),
      crownHolder,
      admittedCollection: admittedCollectionPda(poolAddress, collection),
      allowedMint: null,
      tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      depositorTokenRecord: pnft ? tokenRecordPda(mint, ata) : null,
      vaultTokenRecord: pnft ? tokenRecordPda(mint, vault) : null,
      sysvarInstructions: pnft ? SYSVAR_INSTRUCTIONS : null,
      metadataProgram: pnft ? METADATA_PROGRAM : null,
      ataProgram: pnft ? ATA_PROGRAM : null,
      authRules: pnft ? ruleSet : null,
      authRulesProgram: pnft && ruleSet ? AUTH_RULES_PROGRAM : null,
      collectionBounds: collectionBoundsPda(poolAddress, collection),
    })
    .instruction();
  return sendWithWallet(depositor, [ix], pnft ? CU.depositPnft : CU.depositPlain);
}

// --------------------------------------------------------------- withdraw

/**
 * The head-of-queue request, or null when no draw is open. `withdraw`
 * requires it whenever a draw is in flight (the program will not take the
 * caller's word that none is), because a withdrawal moves the weight the
 * draw is about to read.
 */
async function headRequest(poolAddress: PublicKey): Promise<PublicKey | null> {
  const p = await accounts().pool.fetch(poolAddress);
  const head = Number(p.nextFulfillableId);
  if (head >= Number(p.nextRequestId)) return null;
  const open = await accounts().acquisitionRequest.all([{ memcmp: { offset: OFFSET_POOL, bytes: poolAddress.toBase58() } }]);
  const hit = open.find((r) => Number(r.account.requestId) === head);
  if (!hit) throw new Error("A draw is open but its request could not be found; try again in a moment.");
  return requestPda(poolAddress, hit.account.requester, Number(hit.account.nonce));
}

/**
 * Take a card back: its backing and whatever it earned come with it. Only
 * the depositor may, and only while the position is not mid-settle (a
 * drawn card belongs to its winner until they decide).
 */
export async function withdrawCard(depositor: PublicKey, poolAddress: PublicKey, position: PositionInfo, weightIndex: PublicKey): Promise<string> {
  if (position.depositor !== depositor.toBase58()) throw new Error("This card was deposited by another wallet.");
  if (position.status === "pending") throw new Error("This card was drawn; its winner is deciding. It comes back to you if they cash out.");
  const { connection } = chain();
  const head = await headRequest(poolAddress);
  const mint = new PublicKey(position.mint);
  const pos = new PublicKey(position.address);

  if (position.standard === 1) {
    const info = await connection.getAccountInfo(mint);
    const core = info ? decodeCoreAsset(Buffer.from(info.data), position.mint) : null;
    if (!core?.collection) throw new Error("This card's on-chain record could not be read; try again.");
    const ix = await methods()
      .withdrawCore()
      .accounts({
        depositor,
        pool: poolAddress,
        headRequest: head,
        weightIndex,
        position: pos,
        asset: mint,
        coreCollection: new PublicKey(core.collection),
        solVault: solVaultPda(poolAddress),
        rewardVault: rewardVaultPda(poolAddress),
        coreProgram: CORE_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return sendWithWallet(depositor, [ix], CU.withdrawCore);
  }

  const vault = nftVaultPda(pos);
  const ata = ataFor(depositor, mint);
  const [vaultInfo, metaInfo] = await connection.getMultipleAccountsInfo([vault, metadataPda(mint)]);
  if (!vaultInfo) throw new Error("This position's escrow vault could not be read; refresh and try again.");
  // SPL token account: `state` at byte 108, 2 = frozen. A frozen vault is a
  // pNFT in escrow, whose transfer needs the Token Metadata bundle.
  const frozen = vaultInfo.data.length > 108 && vaultInfo.data[108] === 2;
  const meta = frozen && metaInfo ? decodeTokenMetadata(Buffer.from(metaInfo.data), position.mint) : null;
  const ruleSet = meta?.ruleSet ? new PublicKey(meta.ruleSet) : null;
  const ix = await methods()
    .withdraw()
    .accounts({
      depositor,
      pool: poolAddress,
      headRequest: head,
      weightIndex,
      position: pos,
      nftMint: mint,
      nftVault: vault,
      depositorNftAccount: ata,
      solVault: solVaultPda(poolAddress),
      rewardVault: rewardVaultPda(poolAddress),
      tokenProgram: TOKEN_PROGRAM,
      nftMetadata: frozen ? metadataPda(mint) : null,
      nftMasterEdition: frozen ? masterEditionPda(mint) : null,
      vaultTokenRecord: frozen ? tokenRecordPda(mint, vault) : null,
      depositorTokenRecord: frozen ? tokenRecordPda(mint, ata) : null,
      sysvarInstructions: frozen ? SYSVAR_INSTRUCTIONS : null,
      metadataProgram: frozen ? METADATA_PROGRAM : null,
      ataProgram: frozen ? ATA_PROGRAM : null,
      systemProgram: SystemProgram.programId,
      authRules: frozen ? ruleSet : null,
      authRulesProgram: frozen && ruleSet ? AUTH_RULES_PROGRAM : null,
    })
    .instruction();
  // The token account it returns to was emptied at deposit and may be gone;
  // recreate it idempotently first, in the same transaction.
  return sendWithWallet(depositor, [createAtaIdempotent(depositor, ata, depositor, mint), ix], frozen ? CU.withdrawPnft : CU.withdrawPlain);
}

// ---------------------------------------------------------------- rewards

/** Mirrors state::pool::ACC_PRECISION. */
const ACC_PRECISION = 1_000_000_000_000n;

/**
 * What `claim_rewards` would pay a position now: what it banked plus its
 * share of the accumulator since its checkpoint. Only an active position
 * accrues; a staged one earns nothing and a drawn one banked its share at
 * fulfilment.
 */
export function earnedRewards(accrued: bigint, accRewardPerPosition: bigint, checkpoint: bigint, active: boolean): bigint {
  const pending = active && accRewardPerPosition > checkpoint ? (accRewardPerPosition - checkpoint) / ACC_PRECISION : 0n;
  return accrued + pending;
}

export interface MyPosition extends PositionInfo {
  earnedLamports: bigint;
}

/** The wallet's positions in the pool, with what each has earned. */
export async function myPositions(poolAddress: PublicKey, owner: PublicKey): Promise<MyPosition[]> {
  const [p, all] = await Promise.all([accounts().pool.fetch(poolAddress), readPositions(poolAddress)]);
  const accPer = BigInt(p.accRewardPerPosition.toString());
  const mine = all.filter((x) => x.depositor === owner.toBase58());
  if (mine.length === 0) return [];
  const raw = await Promise.all(mine.map((x) => accounts().position.fetch(new PublicKey(x.address))));
  return mine.map((x, i) => ({
    ...x,
    earnedLamports: earnedRewards(BigInt(raw[i].accruedRewards.toString()), accPer, BigInt(raw[i].rewardCheckpoint.toString()), x.status === "active"),
  }));
}

/** Claim a position's earned share of pull fees. Four accounts, no branching. */
export async function claimRewards(depositor: PublicKey, poolAddress: PublicKey, position: PublicKey): Promise<string> {
  const ix = await methods()
    .claimRewards()
    .accounts({ depositor, pool: poolAddress, position, rewardVault: rewardVaultPda(poolAddress) })
    .instruction();
  return sendWithWallet(depositor, [ix], CU.claim);
}

/**
 * Claim for many positions in one pool, packed a few per transaction: a
 * claim is four accounts and no data, so ten fit comfortably under the
 * size limit and one wallet prompt pays out ten cards. Resolves with a
 * signature or an error per position; a transaction that fails takes its
 * positions with it and the rest still go.
 */
export async function claimRewardsMany(
  depositor: PublicKey,
  poolAddress: PublicKey,
  positions: PublicKey[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, { signature: string | null; error: string | null }>> {
  const PER_TX = 10;
  const out = new Map<string, { signature: string | null; error: string | null }>();
  let done = 0;
  for (let i = 0; i < positions.length; i += PER_TX) {
    const chunk = positions.slice(i, i + PER_TX);
    try {
      const ixs = await Promise.all(
        chunk.map((position) =>
          methods()
            .claimRewards()
            .accounts({ depositor, pool: poolAddress, position, rewardVault: rewardVaultPda(poolAddress) })
            .instruction()
        )
      );
      const signature = await sendWithWallet(depositor, ixs, CU.claim * chunk.length);
      for (const p of chunk) out.set(p.toBase58(), { signature, error: null });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      for (const p of chunk) out.set(p.toBase58(), { signature: null, error });
      // A closed prompt is the person stopping; do not keep asking.
      if (/User rejected|rejected the request|declined/i.test(error)) {
        for (const p of positions.slice(i + PER_TX)) out.set(p.toBase58(), { signature: null, error: "Skipped: you stopped the batch." });
        onProgress?.(positions.length, positions.length);
        return out;
      }
    }
    done += chunk.length;
    onProgress?.(done, positions.length);
  }
  return out;
}

/** The wallet's unsettled pulls here, oldest first. Same read the screens use. */
export const myOpenPulls = readOpenRequests;
