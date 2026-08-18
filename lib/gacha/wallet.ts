/**
 * The wallet: one store every surface reads, and one send routine every
 * transaction goes through. Both are opengacha.io's, carried over.
 *
 * The store: the header, the screens and the manage page each used to ask
 * Phantom on their own, so a page could say "no wallet" while the header
 * showed the address. Everything reads `useWalletOwner()` instead. It
 * restores silently (Phantom answers `connect({ onlyIfTrusted })` without
 * a prompt for a site it has approved) and follows the extension's own
 * events, so a switch there reaches every surface at once.
 *
 * The send routine, three rules learned the hard way:
 *   1. Simulate before the wallet is asked, and fail OPEN. A transaction
 *      that would fail on chain trips Phantom's "could be malicious" wall;
 *      the program's own error is a better sentence. An RPC that could not
 *      answer is not a refusal.
 *   2. Prefer the wallet's `signAndSendTransaction`. Phantom can only guard
 *      a transaction it submits itself, and every settle here moves an NFT.
 *   3. Confirm on the block-height deadline, and on a timeout ask the ledger
 *      once before believing it: a dropped socket is not a failed transaction.
 *
 * Swap the provider for @solana/wallet-adapter in a bigger product; keep
 * the store shape and the send.
 */

import { useSyncExternalStore } from "react";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import { chain } from "./program";

interface Provider {
  publicKey: { toBase58(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect?(): Promise<void>;
  signTransaction(tx: Transaction): Promise<Transaction>;
  signAndSendTransaction?(tx: Transaction): Promise<{ signature: string }>;
  on?(event: string, handler: (arg: unknown) => void): void;
}

const provider = (): Provider | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: Provider }; solana?: Provider };
  return w.phantom?.solana ?? w.solana ?? null;
};

// ------------------------------------------------------------- the store

let current: string | null = null;
const listeners = new Set<() => void>();
let wired = false;
let restoreTried = false;

const emit = () => listeners.forEach((l) => l());

/** Record the connected wallet (or its absence) and tell every reader. */
export function setWallet(address: string | null) {
  if (current === address) return;
  current = address;
  emit();
}

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const p = provider();
  // A wallet already connected in this tab shows up on the provider before
  // any event fires.
  if (p?.publicKey) current = p.publicKey.toBase58();
  p?.on?.("accountChanged", (pk) => {
    const key =
      pk && typeof (pk as { toBase58?: unknown }).toBase58 === "function"
        ? (pk as { toBase58(): string }).toBase58()
        : null;
    setWallet(key);
  });
  p?.on?.("disconnect", () => setWallet(null));
}

/** Connect with a prompt, and return the wallet's key. */
export async function connectWallet(): Promise<PublicKey> {
  const p = provider();
  if (!p) throw new Error("No Solana wallet found. Install Phantom to continue.");
  const { publicKey } = await p.connect();
  setWallet(publicKey.toBase58());
  return new PublicKey(publicKey.toBase58());
}

/** Ask Phantom for the session it already trusts, without a prompt. */
export async function restoreWallet(): Promise<PublicKey | null> {
  if (restoreTried) return current ? new PublicKey(current) : null;
  restoreTried = true;
  const p = provider();
  if (!p) return null;
  if (p.publicKey) {
    setWallet(p.publicKey.toBase58());
  } else {
    try {
      const { publicKey } = await p.connect({ onlyIfTrusted: true });
      setWallet(publicKey.toBase58());
    } catch {
      /* not trusted yet: a Connect button is the way in */
    }
  }
  return current ? new PublicKey(current) : null;
}

/** Sign the wallet out of this site: Phantom forgets the session (so the
 * next reload does not restore it) and every reader hears null. */
export async function disconnectWallet(): Promise<void> {
  try {
    await provider()?.disconnect?.();
  } catch {
    /* the extension declined or was gone; the page still lets go */
  }
  restoreTried = true;
  setWallet(null);
}

const subscribe = (l: () => void) => {
  wire();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getSnapshot = () => current;
const getServerSnapshot = () => null;

/** One PublicKey object per address, so a hook that lists the wallet in a
 * dependency array sees the same value across renders. A fresh object every
 * render re-ran every effect keyed on the wallet, and every one of those
 * effects was an RPC read. */
const keys = new Map<string, PublicKey>();
function keyFor(address: string): PublicKey | null {
  const hit = keys.get(address);
  if (hit) return hit;
  try {
    const k = new PublicKey(address);
    keys.set(address, k);
    return k;
  } catch {
    return null;
  }
}

/** The connected wallet, as every surface should read it. Stable identity
 * per address (see keyFor). */
export function useWalletOwner(): PublicKey | null {
  const address = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return address ? keyFor(address) : null;
}

// -------------------------------------------------------------- the send

/** The program's own error line out of a simulation log, if there is one. */
function programError(logs: string[] | null | undefined): string | null {
  for (const line of logs ?? []) {
    // The system program's own words, the commonest failure of all: the
    // payer cannot cover a transfer or an account's rent.
    const short = line.match(/insufficient lamports (\d+), need (\d+)/);
    if (short) {
      const have = Number(short[1]) / 1e9;
      const need = Number(short[2]) / 1e9;
      return `Not enough SOL: this needs about ${need.toFixed(4)} SOL more than the ${have.toFixed(4)} SOL available. Top up your wallet or lower the backing.`;
    }
    if (/Error: insufficient funds/i.test(line)) return "Not enough tokens in the source account for this transfer.";
  }
  for (const line of logs ?? []) {
    const m = line.match(/Error Message: (.+)$/) ?? line.match(/custom program error: (.+)$/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Sign and send `instructions` as one transaction from `payer`, wait for
 * confirmation, return the signature.
 */
export async function sendWithWallet(
  payer: PublicKey,
  instructions: TransactionInstruction[],
  computeUnits: number
): Promise<string> {
  const w = provider();
  if (!w) throw new Error("No Solana wallet found.");
  const { connection } = chain();

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  for (const ix of instructions) tx.add(ix);
  tx.feePayer = payer;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  // 1. Simulate, fail open.
  try {
    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err) {
      const reason = programError(sim.value.logs);
      throw new Error(reason ?? `Transaction would fail: ${JSON.stringify(sim.value.err)}`);
    }
  } catch (e) {
    if (e instanceof Error && !/fetch|network|timeout|429|503/i.test(e.message)) throw e;
  }

  // 2. Send through the wallet when it can, else sign and submit ourselves.
  let signature: string;
  if (typeof w.signAndSendTransaction === "function") {
    signature = (await w.signAndSendTransaction(tx)).signature;
  } else {
    const signed = await w.signTransaction(tx);
    signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 3 });
  }

  // 3. Confirm by polling the ledger. web3's confirmTransaction wants a
  // websocket, and the site's /api/rpc is HTTP only, so it would sit on a
  // failing socket until the blockhash expired. Ask every 1.5s instead,
  // until the transaction is confirmed, fails, or its blockhash is past.
  await confirmByPolling(connection, signature, lastValidBlockHeight);
  return signature;
}

async function confirmByPolling(connection: Connection, signature: string, lastValidBlockHeight: number): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const s = value[0];
    if (s) {
      if (s.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(s.err)}`);
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") return;
    }
    const height = await connection.getBlockHeight("confirmed");
    if (height > lastValidBlockHeight) {
      // One last look with history, in case it landed and the status
      // cache had not caught up.
      const late = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      const l = late.value;
      if (l && !l.err && (l.confirmationStatus === "confirmed" || l.confirmationStatus === "finalized")) return;
      throw new Error("The transaction expired before it was confirmed. Check your wallet's activity; if it is not there, try again.");
    }
    await sleep(1_500);
  }
}
