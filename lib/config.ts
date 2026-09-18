/**
 * What this storefront sells, and where. Edit pools.json, not this file.
 *
 * Two files, one per cluster: pools.json is what you sell for real,
 * pools.devnet.json is what the same storefront sells when
 * the cluster is devnet (the default). Keeping them apart means a devnet run can
 * never quote a mainnet pool's price, and switching back is one variable.
 */

import { PublicKey } from "@solana/web3.js";

import { IS_DEVNET } from "@/lib/cluster";
import devnetPoolsFile from "@/pools.devnet.json";
import poolsFile from "@/pools.json";

export interface PoolConfig {
  slug: string;
  name: string;
  tagline: string;
  address: string;
  /** Pack art: a URL or a path under public/. */
  art: string;
  /** Accent colour for this pack's glow and buttons. */
  accent: string;
}

export const POOLS: PoolConfig[] = (
  (IS_DEVNET ? devnetPoolsFile : poolsFile) as { pools: PoolConfig[] }
).pools;

export function poolBySlug(slug: string): PoolConfig | undefined {
  return POOLS.find((p) => p.slug === slug);
}

export function poolKey(p: PoolConfig): PublicKey {
  return new PublicKey(p.address);
}
