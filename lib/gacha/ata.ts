/**
 * The associated token program's `CreateIdempotent` (discriminator 1), by
 * hand: the one thing this app needs from spl-token, not worth the
 * dependency. Settles and withdrawals transfer INTO a token account the
 * program does not create; idempotent, so an existing account costs nothing.
 */

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { ATA_PROGRAM, TOKEN_PROGRAM } from "./pda";

export function createAtaIdempotent(payer: PublicKey, ata: PublicKey, owner: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}
