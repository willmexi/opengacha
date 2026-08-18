/**
 * GET /api/ipfs/<cid>[/path] — IPFS content through the site.
 *
 * Browsers were sent to public gateways directly (ipfs.io, which then
 * bounces to a <cid>.ipfs.dweb.link subdomain), and for a share of people
 * that ends in ERR_SSL_PROTOCOL_ERROR or ERR_CONNECTION_RESET: some
 * networks and resolvers choke on the wildcard subdomain hosts, and a
 * public gateway has bad minutes. So the page asks its own origin, this
 * route asks the gateways in order server-side, and the answer is cached
 * at the edge for a year (a CID never changes). One bad gateway is a
 * fallthrough, not a broken image.
 */
import { NextRequest, NextResponse } from "next/server";

const GATEWAYS = [
  process.env.NEXT_PUBLIC_IPFS_GATEWAY, // a dedicated gateway, when the deployment has one
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://w3s.link/ipfs/",
  "https://nftstorage.link/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
].filter((g): g is string => Boolean(g));

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const rel = path.map(encodeURIComponent).join("/");
  if (!rel || !/^[a-zA-Z0-9]+/.test(path[0] ?? "")) return new NextResponse("bad path", { status: 400 });

  for (const base of GATEWAYS) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/${rel}`, {
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
        headers: { accept: "*/*", "user-agent": "opengacha-ipfs-proxy/1" },
      });
      if (!res.ok || !res.body) continue;
      const headers = new Headers();
      headers.set("content-type", res.headers.get("content-type") ?? "application/octet-stream");
      const len = res.headers.get("content-length");
      if (len) headers.set("content-length", len);
      headers.set("cache-control", "public, max-age=86400, s-maxage=31536000, immutable");
      headers.set("access-control-allow-origin", "*");
      return new NextResponse(res.body, { status: 200, headers });
    } catch {
      /* next gateway */
    }
  }
  return new NextResponse("not reachable on any gateway", { status: 502, headers: { "cache-control": "no-store" } });
}
