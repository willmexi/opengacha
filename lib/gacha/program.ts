/**
 * The program, the connection, and the coder: the three things every other
 * file in lib/gacha builds on.
 *
 * One program id, from the IDL the program actually built (idl.json carries
 * its own `address`). One connection: in the browser it points at this
 * site's /api/rpc proxy so your RPC key never ships in the bundle; on the
 * server it reads RPC_URL directly. One Anchor `Program` handle for account
 * decoding and instruction building; it never signs anything, the wallet
 * does (see wallet.ts).
 */

import { AnchorProvider, BorshCoder, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import idl from "./idl.json";

export const PROGRAM_ID = new PublicKey((idl as { address: string }).address);
export const IDL = idl as Idl;

/** Where JSON-RPC goes. Browser: same-origin proxy (or NEXT_PUBLIC_RPC if
 * you are happy to expose an endpoint). Server: RPC_URL, or the public
 * mainnet endpoint as a last resort, which will rate-limit you quickly. */
export function rpcUrl(): string {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_RPC || `${window.location.origin}/api/rpc`;
  }
  return process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC || "https://api.mainnet-beta.solana.com";
}

let cached: { url: string; connection: Connection; program: Program } | null = null;

/** The shared connection + read-only program. Built once per runtime. */
export function chain(): { connection: Connection; program: Program } {
  const url = rpcUrl();
  if (cached && cached.url === url) return cached;
  const connection = new Connection(url, { commitment: "confirmed" });
  // A throwaway keypair as the provider wallet: reads and instruction
  // building need a provider, signing never happens through it.
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: Keypair.generate().publicKey,
      signTransaction: async () => {
        throw new Error("read-only provider");
      },
      signAllTransactions: async () => {
        throw new Error("read-only provider");
      },
    },
    { commitment: "confirmed" }
  );
  const program = new Program(IDL, provider);
  cached = { url, connection, program };
  return cached;
}

/** The account/event coder on its own, for decoding bytes we fetched ourselves. */
export const coder = () => new BorshCoder(IDL);
