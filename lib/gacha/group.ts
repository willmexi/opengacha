/**
 * Group pulls: one pull priced over many pools, on the OpenGacha program.
 *
 * A `PoolGroup` is an ordered list of member pools under one authority
 * (yours, for a group over your own packs; NFW's, for nfw.fun's "pull from
 * every pack"). A group request escrows the stock-weighted mean price of
 * the drawable members plus the rent of one ordinary request; the oracle's
 * randomness picks a member by stock; the request then **materialises**
 * into that pool's ordinary `AcquisitionRequest`, and from there it is a
 * pull like any other: `waitForDraw`, `drawnCards`, `resolve` in pull.ts
 * take it from there.
 *
 * Three calls for a storefront:
 *
 *   1. readGroup(group)              members, live price, lookup table
 *   2. requestGroup(buyer, group)    one signature, a v0 transaction
 *   3. waitForMaterialisation(gr)    → { pool, request } for pull.ts
 *
 * `fulfilGroup` is the permissionless step between 2 and 3 (what NFW's
 * worker does for groups it serves); a storefront over its own group with
 * no worker calls it from the buyer's wallet once the randomness is in, and
 * `waitForMaterialisation` does exactly that after a few quiet seconds.
 *
 * Membership and creation (`create_group`, `set_group_members`,
 * `set_group_lookup_table`) are the authority's, by the same builders; see
 * `createGroup` / `setGroupMembers` at the end.
 */

import { BN } from "@coral-xyz/anchor";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

import { MAX_BPS, WEIGHT_NUMERATOR } from "./price";
import { PROGRAM_ID, chain } from "./program";
import { VRF_PROGRAM, VRF_QUEUE, SYSVAR_SLOT_HASHES, programIdentityPda, requestPda, rewardVaultPda } from "./pda";
import { sendVersionedWithWallet, sendWithWallet } from "./wallet";

// ------------------------------------------------------------- constants

export const MAX_GROUP_MEMBERS = 16;
export const MIN_ACTIVE_RESERVE = 3;
export const GROUP_NONCE_TAG = 1n << 63n;

const u64le = (n: number | bigint) => {
  const out = Buffer.alloc(8);
  new DataView(out.buffer, out.byteOffset).setBigUint64(0, BigInt(n), true);
  return out;
};
const find = (seeds: (Buffer | Uint8Array)[], programId: PublicKey = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];
const hash = (...parts: Uint8Array[]) => {
  const joined = Buffer.concat(parts.map((p) => Buffer.from(p)));
  return Buffer.from(sha256(joined));
};

// ------------------------------------------------------------- addresses

export const groupPda = (authority: PublicKey, groupId: number | bigint) =>
  find([Buffer.from("group"), authority.toBuffer(), u64le(groupId)]);
export const groupEscrowPda = (group: PublicKey) => find([Buffer.from("group_escrow"), group.toBuffer()]);
/** The trust account of a program (this one, or the flagship a member may belong to). */
export const groupTrustPda = (programId: PublicKey = PROGRAM_ID) => find([Buffer.from("group_trust")], programId);
export const groupRequestPda = (group: PublicKey, requester: PublicKey, nonce: number | bigint) =>
  find([Buffer.from("group_request"), group.toBuffer(), requester.toBuffer(), u64le(nonce)]);
export const groupRequesterStatePda = (group: PublicKey, requester: PublicKey) =>
  find([Buffer.from("group_requester"), group.toBuffer(), requester.toBuffer()]);

/** The nonce the materialised request carries in the drawn pool. */
export function poolNonceFor(groupRequest: PublicKey): bigint {
  const h = hash(Buffer.from("nfw-group-nonce"), groupRequest.toBuffer());
  const low = new DataView(h.buffer, h.byteOffset, 8).getBigUint64(0, true);
  return (low & ~GROUP_NONCE_TAG) | GROUP_NONCE_TAG;
}

// ------------------------------------------------------------------ reads

export interface MemberQuote {
  stock: number;
  ev: bigint;
  price: bigint;
}
export interface GroupMemberInfo {
  program: string;
  pool: string;
  weightIndex: string;
  quote: MemberQuote;
  totalBackingLamports: bigint;
}
export interface GroupInfo {
  address: string;
  authority: string;
  members: GroupMemberInfo[];
  creatorSplitBps: number;
  lookupTable: string | null;
  requestExpirySeconds: number;
  paused: boolean;
  /** Lamports; null when no member can be drawn. */
  priceLamports: bigint | null;
  stock: number;
}

/** The shared head of a `Pool` account, either program, read by hand. */
function readPoolPrefix(data: Uint8Array) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8;
  const pk = () => {
    const k = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    return k;
  };
  const u8 = () => data[o++];
  const u16 = () => {
    const v = dv.getUint16(o, true);
    o += 2;
    return v;
  };
  const u32 = () => {
    const v = dv.getUint32(o, true);
    o += 4;
    return v;
  };
  const u64 = () => {
    const v = dv.getBigUint64(o, true);
    o += 8;
    return v;
  };
  const optPk = () => (u8() === 1 ? pk() : null);
  pk(); // authority
  optPk(); // pending_authority
  pk(); // pauser
  pk(); // pool_key
  const weightIndex = pk();
  pk(); // vrf_program
  u64(); // vrf_fee
  o += 4; // bumps + standard
  const totalBacking = u64();
  u64(); // pending_backing
  const activePositions = u32();
  u32(); // pending_positions
  o += 16; // acc_reward_per_position
  u64(); u64(); u64(); // depositor_rewards_accrued, protocol_fees_accrued, pending_fees
  optPk(); optPk(); // crown position, depositor
  u64(); u64(); // crown_backing, crown_pot
  u64(); u64(); // next_request_id, next_fulfillable_id
  u64(); u64(); // head_since, next_position_id
  const surchargeBps = u16();
  u16(); u16(); u16(); u16(); u16(); u16(); // protocol_fee, crown_tithe, crown_threshold, settlement_fee, bid_rate, slippage
  u64(); u64(); u64(); // min_backing, max_backing, tvl_cap
  u8(); u8(); // max_batch, allowlist_enabled
  u64(); u64(); u64(); // resolve_window, final_window, request_expiry
  u8(); // discount_to_depositors
  const acquisitionsPaused = u8() === 1;
  return { weightIndex, totalBacking, activePositions, surchargeBps, acquisitionsPaused };
}

function quoteMember(p: { activePositions: number; acquisitionsPaused: boolean; surchargeBps: number }, totalWeight: bigint): MemberQuote {
  const drawable = !p.acquisitionsPaused && p.activePositions >= 1 + MIN_ACTIVE_RESERVE && totalWeight > 0n;
  if (!drawable) return { stock: 0, ev: 0n, price: 0n };
  const ev = (WEIGHT_NUMERATOR * BigInt(p.activePositions)) / totalWeight;
  return { stock: p.activePositions, ev, price: (ev * (MAX_BPS + BigInt(p.surchargeBps))) / MAX_BPS };
}

export function groupQuote(quotes: MemberQuote[]): { price: bigint; ev: bigint; stock: bigint } | null {
  let stock = 0n, pw = 0n, ew = 0n;
  for (const q of quotes) {
    if (q.stock === 0) continue;
    stock += BigInt(q.stock);
    pw += q.price * BigInt(q.stock);
    ew += q.ev * BigInt(q.stock);
  }
  return stock === 0n ? null : { price: pw / stock, ev: ew / stock, stock };
}

type AnyAccounts = Record<string, { fetch(k: PublicKey): Promise<any>; fetchNullable(k: PublicKey): Promise<any> }>;
const accounts = () => chain().program.account as unknown as AnyAccounts;

export async function readGroup(group: PublicKey): Promise<GroupInfo> {
  const { connection } = chain();
  const g = await accounts().poolGroup.fetch(group);
  const specs: { program: PublicKey; pool: PublicKey }[] = g.members.map((m: any) => ({ program: m.program, pool: m.pool }));
  const infos = specs.length ? await connection.getMultipleAccountsInfo(specs.map((m) => m.pool)) : [];
  const prefixes = infos.map((i) => (i ? readPoolPrefix(i.data) : null));
  const heads = specs.length
    ? await connection.getMultipleAccountsInfo(
        prefixes.map((p) => p?.weightIndex ?? PublicKey.default),
        { dataSlice: { offset: 0, length: 48 } }
      )
    : [];
  const members: GroupMemberInfo[] = specs.map((m, i) => {
    const p = prefixes[i];
    const h = heads[i];
    const tw = p && h ? new DataView(h.data.buffer, h.data.byteOffset).getBigUint64(40, true) : 0n;
    return {
      program: m.program.toBase58(),
      pool: m.pool.toBase58(),
      weightIndex: (p?.weightIndex ?? PublicKey.default).toBase58(),
      quote: p ? quoteMember(p, tw) : { stock: 0, ev: 0n, price: 0n },
      totalBackingLamports: p?.totalBacking ?? 0n,
    };
  });
  const gq = groupQuote(members.map((m) => m.quote));
  return {
    address: group.toBase58(),
    authority: g.authority.toBase58(),
    members,
    creatorSplitBps: g.creatorSplitBps,
    lookupTable: (g.lookupTable as PublicKey).equals(PublicKey.default) ? null : g.lookupTable.toBase58(),
    requestExpirySeconds: Number(g.requestExpirySeconds.toString()),
    paused: g.paused,
    priceLamports: gq?.price ?? null,
    stock: Number(gq?.stock ?? 0n),
  };
}

export interface GroupRequestInfo {
  address: string;
  group: string;
  requester: string;
  requestId: number;
  pricePaidLamports: bigint;
  randomnessReady: boolean;
  randomness: Uint8Array;
  seed: Uint8Array;
  quoted: { pool: string; ev: bigint }[];
  materialisedInto: string | null;
  materialisedPool: string | null;
  cancelled: boolean;
  createdAt: number;
}

export async function readGroupRequest(key: PublicKey): Promise<GroupRequestInfo | null> {
  const r = await accounts().groupRequest.fetchNullable(key);
  if (!r) return null;
  return {
    address: key.toBase58(),
    group: r.group.toBase58(),
    requester: r.requester.toBase58(),
    requestId: Number(r.requestId.toString()),
    pricePaidLamports: BigInt(r.pricePaid.toString()),
    randomnessReady: r.randomnessReady,
    randomness: Uint8Array.from(r.randomness),
    seed: Uint8Array.from(r.seed),
    quoted: (r.quoted as any[]).map((q) => ({ pool: new PublicKey(q.pool).toBase58(), ev: BigInt(q.ev.toString()) })),
    materialisedInto: r.materialisedInto ? new PublicKey(r.materialisedInto).toBase58() : null,
    materialisedPool: r.materialisedPool ? new PublicKey(r.materialisedPool).toBase58() : null,
    cancelled: r.cancelled,
    createdAt: Number(r.createdAt.toString()),
  };
}

// ------------------------------------------------------------- the draw

/**
 * `derive_draw(randomness, seed, 0xFF)` then `uniform_below(stock)`, both
 * exactly as the program: the draw is `sha256("nfw-draw" ‖ randomness ‖
 * seed ‖ 0xFF)`; the uniform takes that digest's four u64 windows as
 * candidates, rejecting the biased tail and rehashing with
 * `sha256("nfw-reject" ‖ buf ‖ round)` when all four are refused.
 */
function memberTarget(randomness: Uint8Array, seed: Uint8Array, bound: bigint): bigint {
  const draw = hash(Buffer.from("nfw-draw"), randomness, seed, Uint8Array.from([0xff]));
  const MAX = (1n << 64n) - 1n;
  const rem = ((MAX % bound) + 1n) % bound;
  const limit = rem === 0n ? null : (1n << 64n) - rem;
  let buf: Uint8Array = Uint8Array.from(draw);
  for (let round = 0; round < 16; round++) {
    for (let chunk = 0; chunk < 4; chunk++) {
      const candidate = new DataView(buf.buffer, buf.byteOffset).getBigUint64(chunk * 8, true);
      if (limit === null || candidate < limit) return candidate % bound;
    }
    buf = hash(Buffer.from("nfw-reject"), buf, Uint8Array.from([round]));
  }
  throw new Error("draw exhausted its sampling rounds");
}

/** Which member the randomness selects, over the members as quoted for this request. */
export function selectMember(info: GroupInfo, r: GroupRequestInfo): number {
  const quotedEv = (pool: string) => r.quoted.find((q) => q.pool === pool)?.ev ?? 0n;
  const quotes = info.members.map((m) => (quotedEv(m.pool) > 0n ? m.quote : { stock: 0, ev: 0n, price: 0n }));
  const stock = quotes.reduce((a, q) => a + BigInt(q.stock), 0n);
  if (stock === 0n) throw new Error("no member of this group can be drawn right now");
  const target = memberTarget(r.randomness, r.seed, stock);
  let cursor = 0n;
  for (let i = 0; i < quotes.length; i++) {
    if (quotes[i].stock === 0) continue;
    const next = cursor + BigInt(quotes[i].stock);
    if (target < next) return i;
    cursor = next;
  }
  throw new Error("target out of range");
}

// ------------------------------------------------------------------ sends

const CU = { request: 400_000, fulfil: 1_200_000, admin: 200_000 };

interface IxBuilder {
  accounts(a: Record<string, PublicKey | null>): IxBuilder;
  remainingAccounts(r: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[]): IxBuilder;
  instruction(): Promise<TransactionInstruction>;
}
const methods = () => chain().program.methods as unknown as Record<string, (...a: any[]) => IxBuilder>;

async function tables(lut: string | null): Promise<AddressLookupTableAccount[]> {
  if (!lut) return [];
  const t = await chain().connection.getAddressLookupTable(new PublicKey(lut));
  return t.value ? [t.value] : [];
}

export interface GroupPullReceipt {
  groupRequest: string;
  nonce: number;
  signature: string;
}

/**
 * Buy one pull over the group at up to `maxPriceLamports` (default: the live
 * quote plus the slippage). One v0 transaction against the group's lookup
 * table, signed by the buyer.
 */
export async function requestGroup(
  buyer: PublicKey,
  group: PublicKey,
  opts: { maxPriceLamports?: bigint; maxSlippageBps?: number; minPoolBackingLamports?: bigint } = {}
): Promise<GroupPullReceipt> {
  const info = await readGroup(group);
  if (info.paused) throw new Error("this group is paused");
  if (info.priceLamports === null) throw new Error("no member of this group can be drawn right now");
  const slippage = opts.maxSlippageBps ?? 1_000;
  const maxPrice = opts.maxPriceLamports ?? info.priceLamports + (info.priceLamports * BigInt(slippage)) / 10_000n;
  const nonce = Date.now();
  const groupRequest = groupRequestPda(group, buyer, nonce);
  const ix = await methods()
    .requestGroup({
      maxPrice: new BN(maxPrice.toString()),
      maxSlippageBps: slippage,
      minPoolBacking: new BN((opts.minPoolBackingLamports ?? 0n).toString()),
      nonce: new BN(nonce),
    })
    .accounts({
      requester: buyer,
      group,
      groupTrust: groupTrustPda(),
      groupRequest,
      groupRequesterState: groupRequesterStatePda(group, buyer),
      escrow: groupEscrowPda(group),
      oracleQueue: VRF_QUEUE,
      programIdentity: programIdentityPda(),
      vrfProgram: VRF_PROGRAM,
      slotHashes: SYSVAR_SLOT_HASHES,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(
      info.members.flatMap((m) => [
        { pubkey: new PublicKey(m.pool), isWritable: false, isSigner: false },
        { pubkey: new PublicKey(m.weightIndex), isWritable: false, isSigner: false },
      ])
    )
    .instruction();
  const signature = await sendVersionedWithWallet(buyer, [ix], CU.request, await tables(info.lookupTable));
  return { groupRequest: groupRequest.toBase58(), nonce, signature };
}

/**
 * Materialise a group request whose randomness is in: the permissionless
 * step, from any wallet. Returns the pool and request it became.
 */
export async function fulfilGroup(caller: PublicKey, groupRequest: PublicKey): Promise<{ pool: string; program: string; request: string; signature: string }> {
  const r = await readGroupRequest(groupRequest);
  if (!r) throw new Error("group request not found");
  if (r.materialisedInto) throw new Error("already materialised");
  if (!r.randomnessReady) throw new Error("randomness not in yet");
  const group = new PublicKey(r.group);
  const info = await readGroup(group);
  const idx = selectMember(info, r);
  const drawn = info.members[idx];
  const drawnProgram = new PublicKey(drawn.program);
  const drawnPool = new PublicKey(drawn.pool);
  const request = requestPda(drawnPool, new PublicKey(r.requester), poolNonceFor(groupRequest));
  // `requestPda` derives under this program; a flagship member derives the
  // same seeds under its own id.
  const drawnRequest = drawnProgram.equals(PROGRAM_ID)
    ? request
    : find([Buffer.from("request"), drawnPool.toBuffer(), new PublicKey(r.requester).toBuffer(), u64le(poolNonceFor(groupRequest))], drawnProgram);
  const ix = await methods()
    .fulfilGroup()
    .accounts({
      caller,
      group,
      groupTrust: groupTrustPda(),
      groupRequest,
      escrow: groupEscrowPda(group),
      drawnPool,
      drawnRequest,
      drawnRewardVault: find([Buffer.from("reward_vault"), drawnPool.toBuffer()], drawnProgram),
      drawnProgram,
      drawnTrust: groupTrustPda(drawnProgram),
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(
      info.members.flatMap((m) => {
        const prog = new PublicKey(m.program);
        const pool = new PublicKey(m.pool);
        return [
          { pubkey: pool, isWritable: true, isSigner: false },
          { pubkey: new PublicKey(m.weightIndex), isWritable: false, isSigner: false },
          { pubkey: find([Buffer.from("reward_vault"), pool.toBuffer()], prog), isWritable: true, isSigner: false },
          { pubkey: groupTrustPda(prog), isWritable: false, isSigner: false },
          { pubkey: prog, isWritable: false, isSigner: false },
        ];
      })
    )
    .instruction();
  const signature = await sendVersionedWithWallet(caller, [ix], CU.fulfil, await tables(info.lookupTable));
  return { pool: drawn.pool, program: drawn.program, request: drawnRequest.toBase58(), signature };
}

/**
 * Follow a group request until it is a pool request. A served group is
 * materialised by NFW's worker within a tick of the randomness; otherwise,
 * after `selfFulfilAfterMs` with the randomness in, the buyer's wallet does
 * it (one approval). Resolves with what pull.ts needs next.
 */
export async function waitForMaterialisation(
  buyer: PublicKey,
  groupRequest: PublicKey,
  opts: { timeoutMs?: number; selfFulfilAfterMs?: number; onStatus?: (s: string) => void } = {}
): Promise<{ pool: string; program: string; request: string; requestId: number }> {
  const { connection } = chain();
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const selfAfter = opts.selfFulfilAfterMs ?? 6_000;
  const started = Date.now();
  let readyAt: number | null = null;
  let triedAt = 0;
  for (;;) {
    const r = await readGroupRequest(groupRequest);
    if (!r) throw new Error("group request vanished");
    if (r.cancelled) throw new Error("this pull expired and was refunded");
    if (r.materialisedInto && r.materialisedPool) {
      const info = await connection.getAccountInfo(new PublicKey(r.materialisedInto));
      if (!info) throw new Error("materialised request not readable yet");
      const requestId = Number(new DataView(info.data.buffer, info.data.byteOffset).getBigUint64(8 + 32 + 32 + 8, true));
      opts.onStatus?.("materialised");
      return { pool: r.materialisedPool, program: info.owner.toBase58(), request: r.materialisedInto, requestId };
    }
    if (!r.randomnessReady) opts.onStatus?.("waiting-randomness");
    else {
      readyAt ??= Date.now();
      opts.onStatus?.("waiting-worker");
      if (Date.now() - readyAt > selfAfter && Date.now() - triedAt > 20_000) {
        triedAt = Date.now();
        opts.onStatus?.("self-fulfilling");
        try {
          await fulfilGroup(buyer, groupRequest);
        } catch {
          /* the worker may have beaten us, or the wallet declined */
        }
      }
    }
    if (Date.now() - started > timeoutMs) throw new Error("the draw did not land in time; the pull is still open");
    await new Promise((res) => setTimeout(res, 1_500));
  }
}

// ------------------------------------------------------------- authority

/** Create a group under `authority` (your wallet). `groupId` is yours to pick. */
export async function createGroup(
  authority: PublicKey,
  groupId: number | bigint,
  opts: { creatorSplitBps?: number; requestExpirySeconds?: number } = {}
): Promise<{ group: string; signature: string }> {
  const group = groupPda(authority, groupId);
  const ix = await methods()
    .createGroup(new BN(groupId.toString()), opts.creatorSplitBps ?? 10_000, new BN(opts.requestExpirySeconds ?? 600))
    .accounts({ authority, group, systemProgram: SystemProgram.programId })
    .instruction();
  const signature = await sendWithWallet(authority, [ix], CU.admin);
  return { group: group.toBase58(), signature };
}

/** Replace the member list: the pools, in the order they are to be drawn over. */
export async function setGroupMembers(authority: PublicKey, group: PublicKey, pools: PublicKey[]): Promise<string> {
  const ix = await methods()
    .setGroupMembers()
    .accounts({ authority, group, groupTrust: groupTrustPda() })
    .remainingAccounts(pools.map((p) => ({ pubkey: p, isWritable: false, isSigner: false })))
    .instruction();
  return sendWithWallet(authority, [ix], CU.admin);
}

/**
 * Create (or extend) the group's address lookup table with every account a
 * request or a fulfil over its members names, and record it on the group.
 * Run after `setGroupMembers`; idempotent.
 */
export async function syncGroupLookupTable(authority: PublicKey, group: PublicKey, flagshipProgram?: PublicKey): Promise<string> {
  const { connection } = chain();
  const info = await readGroup(group);
  const want: PublicKey[] = [
    group, groupEscrowPda(group), groupTrustPda(), PROGRAM_ID, SystemProgram.programId,
    VRF_PROGRAM, VRF_QUEUE, SYSVAR_SLOT_HASHES, programIdentityPda(),
  ];
  if (flagshipProgram) want.push(flagshipProgram, groupTrustPda(flagshipProgram));
  for (const m of info.members) {
    const prog = new PublicKey(m.program);
    const pool = new PublicKey(m.pool);
    want.push(pool, new PublicKey(m.weightIndex), find([Buffer.from("reward_vault"), pool.toBuffer()], prog));
  }
  let lut = info.lookupTable ? new PublicKey(info.lookupTable) : null;
  let have: PublicKey[] = [];
  if (lut) {
    const t = await connection.getAddressLookupTable(lut);
    have = t.value?.state.addresses ?? [];
  }
  if (!lut) {
    const slot = await connection.getSlot("finalized");
    const [createIx, addr] = AddressLookupTableProgram.createLookupTable({ authority, payer: authority, recentSlot: slot });
    await sendWithWallet(authority, [createIx], CU.admin);
    lut = addr;
  }
  const haveSet = new Set(have.map((k) => k.toBase58()));
  const seen = new Set<string>();
  const missing = want.filter((k) => !haveSet.has(k.toBase58()) && !seen.has(k.toBase58()) && (seen.add(k.toBase58()), true));
  for (let i = 0; i < missing.length; i += 24) {
    const ix = AddressLookupTableProgram.extendLookupTable({ lookupTable: lut, authority, payer: authority, addresses: missing.slice(i, i + 24) });
    await sendWithWallet(authority, [ix], CU.admin);
  }
  if (!info.lookupTable || info.lookupTable !== lut.toBase58()) {
    const ix = await methods().setGroupLookupTable(lut).accounts({ authority, group }).instruction();
    return sendWithWallet(authority, [ix], CU.admin);
  }
  return "";
}
