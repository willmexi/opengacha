/**
 * GET /api/meta?mints=a,b,c
 *
 * Name, image and settle facts for up to 50 mints, fetched once and kept in
 * the local database. The reveal uses this for the card it drew.
 */
import { NextRequest, NextResponse } from "next/server";

import { ensureMetas } from "@/lib/mirror";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const mints = (req.nextUrl.searchParams.get("mints") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  if (mints.length === 0) return NextResponse.json({});
  try {
    const metas = await ensureMetas(mints);
    return NextResponse.json(Object.fromEntries(metas));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
