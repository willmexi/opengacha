/**
 * Every address the pull path needs, derived from seeds.
 *
 * Seeds mirror the program's constants.rs byte for byte. Nothing here talks
 * to the network; a PDA is arithmetic on public keys.
 *
 *   pool             ["pool", pool_key]
 *   sol_vault        ["sol_vault", pool]
 *   reward_vault     ["reward_vault", pool]
 *   protocol_config  ["protocol_config"]
 *   request          ["request", pool, requester, nonce as LE u64]
 *   requester_state  ["requester", pool, requester]
 *   position         ["position", pool, nft_mint]
 *   nft_vault        ["nft_vault", position]
 *   identity         ["identity"]            (the program's own signer for the request)
 *   collection_bounds ["bounds", pool, collection]
 *   admitted_collection ["collection", pool, collection]
 *   issuer_waiver     ["issuer-waiver", pool, collection]
 */

import { PublicKey } from "@solana/web3.js";

import { PROGRAM_ID } from "./program";

// Programs and sysvars the pull path names explicitly.
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const AUTH_RULES_PROGRAM = new PublicKey("auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg");
export const CORE_PROGRAM = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
export const SYSVAR_INSTRUCTIONS = new PublicKey("Sysvar1nstructions1111111111111111111111111");
export const SYSVAR_SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");
/** The randomness the program is pinned to: its VRF program and the one
 * queue it accepts. Passed as accounts on every request; the program
 * refuses any other. */
export const VRF_PROGRAM = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
export const VRF_QUEUE = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");

const find = (seeds: (Buffer | Uint8Array)[], programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

const u64le = (n: number | bigint) => {
  const out = Buffer.alloc(8);
  new DataView(out.buffer, out.byteOffset).setBigUint64(0, BigInt(n), true);
  return out;
};

export const solVaultPda = (pool: PublicKey) => find([Buffer.from("sol_vault"), pool.toBuffer()]);
export const rewardVaultPda = (pool: PublicKey) => find([Buffer.from("reward_vault"), pool.toBuffer()]);
export const protocolConfigPda = () => find([Buffer.from("protocol_config")]);
export const programIdentityPda = () => find([Buffer.from("identity")]);
export const requestPda = (pool: PublicKey, requester: PublicKey, nonce: number | bigint) =>
  find([Buffer.from("request"), pool.toBuffer(), requester.toBuffer(), u64le(nonce)]);
export const requesterStatePda = (pool: PublicKey, requester: PublicKey) =>
  find([Buffer.from("requester"), pool.toBuffer(), requester.toBuffer()]);
export const positionPda = (pool: PublicKey, mint: PublicKey) =>
  find([Buffer.from("position"), pool.toBuffer(), mint.toBuffer()]);
export const nftVaultPda = (position: PublicKey) => find([Buffer.from("nft_vault"), position.toBuffer()]);
export const collectionBoundsPda = (pool: PublicKey, collection: PublicKey) =>
  find([Buffer.from("bounds"), pool.toBuffer(), collection.toBuffer()]);
export const admittedCollectionPda = (pool: PublicKey, collection: PublicKey) =>
  find([Buffer.from("collection"), pool.toBuffer(), collection.toBuffer()]);
export const issuerWaiverPda = (pool: PublicKey, collection: PublicKey) =>
  find([Buffer.from("issuer-waiver"), pool.toBuffer(), collection.toBuffer()]);

// Token Metadata's own PDAs, for pNFT settles.
export const metadataPda = (mint: PublicKey) =>
  find([Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM);
export const masterEditionPda = (mint: PublicKey) =>
  find(
    [Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer(), Buffer.from("edition")],
    METADATA_PROGRAM
  );
export const tokenRecordPda = (mint: PublicKey, tokenAccount: PublicKey) =>
  find(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM.toBuffer(),
      mint.toBuffer(),
      Buffer.from("token_record"),
      tokenAccount.toBuffer(),
    ],
    METADATA_PROGRAM
  );
/** The associated token account of `owner` for `mint`. */
export const ataFor = (owner: PublicKey, mint: PublicKey) =>
  find([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM);
