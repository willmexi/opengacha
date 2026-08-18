/**
 * GET /api/sol-price → { usd: number | null }
 *
 * SOL in USD, proxied and cached for a minute so a page of visitors makes
 * one upstream call, not one each (the public price APIs rate-limit per IP).
 * Two sources in order; if both fail the answer is null and the UI shows
 * SOL alone rather than a guess.
 */
import { NextResponse } from "next/server";

const SOURCES: { url: string; pick: (j: unknown) => number | undefined }[] = [
  {
    url: "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    pick: (j) => (j as { solana?: { usd?: number } })?.solana?.usd,
  },
  {
    url: "https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112",
    pick: (j) => {
      const v = (j as Record<string, { usdPrice?: number; price?: number }>)?.["So11111111111111111111111111111111111111112"];
      return v?.usdPrice ?? v?.price;
    },
  },
];

export async function GET() {
  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url, { next: { revalidate: 60 }, signal: AbortSignal.timeout(5_000) });
      if (!res.ok) continue;
      const usd = src.pick(await res.json());
      if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) {
        return NextResponse.json({ usd }, { headers: { "cache-control": "public, max-age=60" } });
      }
    } catch {
      /* next source */
    }
  }
  return NextResponse.json({ usd: null }, { headers: { "cache-control": "public, max-age=30" } });
}
