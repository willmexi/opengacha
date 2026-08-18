/**
 * GET /api/worth?mints=a,b → { [mint]: { usd, lamports, at } | null }
 *
 * The last sale for up to four mints, walked from their transactions (see
 * lib/worth.ts) and kept in the local database. Four at a time because a
 * walk is up to 41 RPC reads per card; the client asks in small batches so
 * every call finishes well inside a serverless budget.
 */
import { NextRequest, NextResponse } from "next/server";

import { lastSaleOf } from "@/lib/worth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const mints = (req.nextUrl.searchParams.get("mints") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (mints.length === 0) return NextResponse.json({});
  const out: Record<string, unknown> = {};
  await Promise.all(
    mints.map(async (m) => {
      out[m] = await lastSaleOf(m);
    })
  );
  return NextResponse.json(out);
}
