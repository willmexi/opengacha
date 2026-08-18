/**
 * What this storefront sells, and where. Edit pools.json, not this file.
 */

import { PublicKey } from "@solana/web3.js";

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

export const POOLS: PoolConfig[] = (poolsFile as { pools: PoolConfig[] }).pools;

export function poolBySlug(slug: string): PoolConfig | undefined {
  return POOLS.find((p) => p.slug === slug);
}

export function poolKey(p: PoolConfig): PublicKey {
  return new PublicKey(p.address);
}
