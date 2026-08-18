/**
 * What a card is called, what it looks like, and what a settle needs to
 * know about it. Two on-chain shapes:
 *
 *   - Token Metadata (position.standard 0): a Metadata PDA beside the mint
 *     carries name, uri, the verified collection, the token standard (4 =
 *     programmable NFT, which changes the settle's account list) and, for
 *     pNFTs, the rule set.
 *   - Metaplex Core (standard 1): no PDA; name, uri and collection sit on
 *     the asset account itself.
 *
 * The image is one hop further, in the off-chain JSON the uri points at.
 * Decoders here are sequential borsh walks sized from the specs; nothing
 * is fetched that the reveal does not need.
 */

import { PublicKey } from "@solana/web3.js";

import { metadataPda } from "./pda";
import { chain } from "./program";

export interface NftMeta {
  mint: string;
  name: string;
  uri: string;
  /** The VERIFIED collection, or null. Unverified is self-asserted. */
  collection: string | null;
  /** Token Metadata standard; 4 = programmable NFT. null for Core. */
  tokenStandard: number | null;
  ruleSet: string | null;
  core: boolean;
  image: string | null;
}

/** Sequential walk of a Token Metadata account. */
export function decodeTokenMetadata(data: Buffer, mint: string): Omit<NftMeta, "image"> | null {
  try {
    if (data.length < 66 || data[0] !== 4) return null; // Key::MetadataV1
    let o = 1 + 32 + 32; // key, update authority, mint
    const str = () => {
      const len = data.readUInt32LE(o);
      o += 4;
      const s = data.subarray(o, o + len).toString("utf8").replace(/\0+$/, "");
      o += len;
      return s;
    };
    const name = str();
    str(); // symbol
    const uri = str();
    o += 2; // seller fee bps
    if (data[o++] === 1) {
      const creators = data.readUInt32LE(o);
      o += 4 + creators * 34;
    }
    o += 2; // primary sale happened, is mutable
    if (data[o++] === 1) o += 1; // edition nonce
    const tokenStandard = data[o++] === 1 ? data[o++] : null;
    let collection: string | null = null;
    if (data[o++] === 1) {
      const verified = data[o] === 1;
      const k = new PublicKey(data.subarray(o + 1, o + 33)).toBase58();
      if (verified) collection = k;
      o += 33;
    }
    // uses, collection_details, then programmable_config { rule_set }.
    let ruleSet: string | null = null;
    if (o < data.length && data[o++] === 1) o += 17;
    if (o < data.length && data[o++] === 1) o += 9;
    if (o < data.length && data[o++] === 1) {
      const variant = data[o++];
      if (variant === 0 && data[o++] === 1) {
        ruleSet = new PublicKey(data.subarray(o, o + 32)).toBase58();
      }
    }
    return { mint, name, uri, collection, tokenStandard, ruleSet, core: false };
  } catch {
    return null;
  }
}

/** A Core asset's header: owner, update authority (the collection when it
 * belongs to one), name, uri. */
export function decodeCoreAsset(data: Buffer, mint: string): Omit<NftMeta, "image"> | null {
  try {
    if (data[0] !== 1) return null; // Key::AssetV1
    let o = 1 + 32; // key, owner
    const tag = data[o++]; // UpdateAuthority: 0 None, 1 Address, 2 Collection
    let collection: string | null = null;
    if (tag === 1 || tag === 2) {
      const k = new PublicKey(data.subarray(o, o + 32)).toBase58();
      o += 32;
      if (tag === 2) collection = k;
    }
    const nameLen = data.readUInt32LE(o);
    o += 4;
    const name = data.subarray(o, o + nameLen).toString("utf8");
    o += nameLen;
    const uriLen = data.readUInt32LE(o);
    o += 4;
    const uri = data.subarray(o, o + uriLen).toString("utf8");
    return { mint, name, uri, collection, tokenStandard: null, ruleSet: null, core: true };
  } catch {
    return null;
  }
}

/** ipfs:// and ar:// made fetchable. */
/**
 * A URL a browser can load. IPFS content goes through the site's own
 * /api/ipfs (server-side gateway fallbacks, cached at the edge): browsers
 * sent straight to a public gateway's <cid>.ipfs.… subdomain fail for a
 * share of people with SSL or connection errors.
 */
export function gatewayUrl(uri: string): string {
  if (uri.startsWith("ipfs://")) return `/api/ipfs/${uri.slice("ipfs://".length)}`;
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice("ar://".length)}`;
  const sub = uri.match(/^https?:\/\/([a-z0-9]+)\.ipfs\.(?:w3s\.link|dweb\.link|nftstorage\.link)(\/.*)?$/i);
  if (sub) return `/api/ipfs/${sub[1]}${sub[2] ?? ""}`;
  const path = uri.match(/^https?:\/\/(?:ipfs\.io|dweb\.link|w3s\.link|nftstorage\.link|gateway\.pinata\.cloud|cloudflare-ipfs\.com)\/ipfs\/(.+)$/i);
  if (path) return `/api/ipfs/${path[1]}`;
  return uri;
}

/** The same URL for a fetch made on the server, where a relative path has
 * no origin: IPFS goes to a public gateway directly (with the route's own
 * fallbacks unavailable here, so the first that answers wins). */
export function serverUrl(uri: string): string {
  const u = gatewayUrl(uri);
  return u.startsWith("/api/ipfs/") ? `https://ipfs.io/ipfs/${u.slice("/api/ipfs/".length)}` : u;
}

/** The on-chain half for a batch of mints: TM metadata PDAs first, then
 * the mints themselves for anything that turned out to be Core. */
export async function readOnChainMeta(mints: string[]): Promise<Map<string, Omit<NftMeta, "image">>> {
  const { connection } = chain();
  const out = new Map<string, Omit<NftMeta, "image">>();
  if (mints.length === 0) return out;
  const keys = mints.map((m) => new PublicKey(m));
  const tm = await connection.getMultipleAccountsInfo(keys.map(metadataPda));
  const coreCandidates: PublicKey[] = [];
  tm.forEach((info, i) => {
    const decoded = info ? decodeTokenMetadata(Buffer.from(info.data), mints[i]) : null;
    if (decoded) out.set(mints[i], decoded);
    else coreCandidates.push(keys[i]);
  });
  if (coreCandidates.length) {
    const assets = await connection.getMultipleAccountsInfo(coreCandidates);
    assets.forEach((info, i) => {
      const mint = coreCandidates[i].toBase58();
      const decoded = info ? decodeCoreAsset(Buffer.from(info.data), mint) : null;
      if (decoded) out.set(mint, decoded);
    });
  }
  return out;
}

/** The off-chain JSON's image and full name. On-chain names are capped at
 * 32 bytes, so the JSON usually carries the whole title. Bounded and
 * forgiving: a dead uri is a card without a picture, not a broken page. */
export async function fetchOffChain(
  uri: string
): Promise<{ image: string | null; name: string | null; insuredUsd: number | null }> {
  if (!uri) return { image: null, name: null, insuredUsd: null };
  try {
    const res = await fetch(serverUrl(uri), {
      signal: AbortSignal.timeout(6_000),
      // Some metadata hosts (Phygitals' CDN, for one) answer non-browser
      // user agents with an error page; a browser UA gets the JSON.
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    });
    if (!res.ok) return { image: null, name: null, insuredUsd: null };
    const json = (await res.json()) as { image?: unknown; name?: unknown; attributes?: unknown };
    return {
      image: typeof json.image === "string" ? gatewayUrl(json.image) : null,
      name: typeof json.name === "string" && json.name.trim() ? json.name.trim() : null,
      insuredUsd: insuredUsdOf(json.attributes),
    };
  } catch {
    return { image: null, name: null, insuredUsd: null };
  }
}

/** "Insured Value" as graded-slab issuers write it into the attributes:
 * "$1,250" and "1250" both appear; anything else is not a price. It is the
 * one honest worth a storefront has for a slab without asking a market. */
export function insuredUsdOf(attributes: unknown): number | null {
  if (!Array.isArray(attributes)) return null;
  const hit = attributes.find(
    (a) => a && typeof a === "object" && String((a as { trait_type?: unknown }).trait_type ?? "").toLowerCase() === "insured value"
  ) as { value?: unknown } | undefined;
  if (hit?.value === undefined || hit.value === null) return null;
  const n = Number(String(hit.value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
