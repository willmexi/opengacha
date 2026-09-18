/**
 * Which Solana this storefront is pointed at.
 *
 * One variable decides it, `NEXT_PUBLIC_CLUSTER`, because the browser needs
 * the answer too (explorer links, the badge in the header) and a
 * `NEXT_PUBLIC_` name is the only kind that reaches both sides. Unset means
 * mainnet: a fork that never thinks about this ships against real money,
 * which is the safe default for a storefront.
 *
 * Devnet is for trying the thing: faucet SOL from https://faucet.solana.com,
 * a wallet in testnet mode, fake cards in a pool nobody paid for. Pointing a
 * storefront there changes three things and nothing else: which pools it
 * sells (pools.devnet.json), where JSON-RPC goes by default, and where the
 * explorer links land.
 */

export type Cluster = "mainnet-beta" | "devnet";

export const CLUSTER: Cluster =
  process.env.NEXT_PUBLIC_CLUSTER === "devnet" ? "devnet" : "mainnet-beta";

export const IS_DEVNET = CLUSTER === "devnet";

/**
 * The endpoint used when you have set none of your own. Both are Solana's
 * public ones: fine for a look around, rate-limited within seconds of real
 * use. Set `RPC_URL` before you show a storefront to anyone.
 */
export const PUBLIC_RPC = IS_DEVNET
  ? "https://api.devnet.solana.com"
  : "https://api.mainnet-beta.solana.com";

/** What the header says under "Open source". */
export const CLUSTER_LABEL = IS_DEVNET ? "Solana devnet" : "Solana mainnet";

/** A transaction on the explorer, on the cluster it actually happened on. */
export function explorerTx(signature: string): string {
  return `https://solscan.io/tx/${signature}${IS_DEVNET ? "?cluster=devnet" : ""}`;
}
