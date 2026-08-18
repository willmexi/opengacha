/**
 * GET /api/pool/<slug>[?fresh=1]
 *
 * The pool's live price and size plus every card in it, with names and
 * art, from the mini-mirror (lib/mirror.ts), and the directory's volume
 * count when opengacha.io answers. `fresh=1` skips the mirror cache, which
 * the pull screens use right after a draw lands.
 */
import { NextRequest, NextResponse } from "next/server";

import { poolBySlug } from "@/lib/config";
import { directoryStats } from "@/lib/directory";
import { snapshot } from "@/lib/mirror";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const pool = poolBySlug(slug);
  if (!pool) return NextResponse.json({ error: "unknown pool" }, { status: 404 });
  try {
    const [snap, directory] = await Promise.all([
      snapshot(pool.address, req.nextUrl.searchParams.get("fresh") === "1"),
      directoryStats(pool.slug),
    ]);
    return NextResponse.json({ ...snap, directory, config: pool });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
