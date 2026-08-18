/**
 * The RPC proxy: the browser posts JSON-RPC here, this forwards it to
 * RPC_URL. Your endpoint (and its key) never leaves the server.
 *
 * Only the methods a pull needs are allowed through, so a stranger cannot
 * borrow your RPC for arbitrary work. Add to the list if you extend the app.
 */
import { NextRequest, NextResponse } from "next/server";

const RPC = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC || "https://api.mainnet-beta.solana.com";

const ALLOWED = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getTokenAccountsByOwner",
  "getAssetsByOwner",
  "getLatestBlockhash",
  "getBlockHeight",
  "getSlot",
  "getSignatureStatuses",
  "getTransaction",
  "getBalance",
  "getMinimumBalanceForRentExemption",
  "simulateTransaction",
  "sendTransaction",
  "getRecentPrioritizationFees",
  "getFeeForMessage",
  "getVersion",
  "getHealth",
]);

export async function POST(req: NextRequest) {
  const body = await req.text();
  try {
    const parsed = JSON.parse(body) as { method?: string } | { method?: string }[];
    const calls = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of calls) {
      if (!c.method || !ALLOWED.has(c.method)) {
        return NextResponse.json({ error: `method not allowed: ${c.method}` }, { status: 403 });
      }
    }
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const upstream = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    cache: "no-store",
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
