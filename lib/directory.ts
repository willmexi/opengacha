/**
 * The OpenGacha directory: opengacha.io's own record of a pool (listing
 * art, socials, and the volume its indexer has counted). Optional and
 * hosted; everything money-shaped comes from the chain, this is colour.
 * Cached in memory for a minute. Server-only.
 */

const DIRECTORY = process.env.DIRECTORY_API || "https://nfw-api-560813787781.us-east1.run.app";
const TTL_MS = 60_000;

export interface DirectoryStats {
  pulls: number;
  settled: number;
  volumeLamports: string;
  xUrl: string | null;
  websiteUrl: string | null;
}

const cache = new Map<string, { at: number; value: DirectoryStats | null }>();

export async function directoryStats(slug: string): Promise<DirectoryStats | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: DirectoryStats | null = null;
  try {
    const res = await fetch(`${DIRECTORY}/open/pool/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (res.ok) {
      const { project } = (await res.json()) as {
        project?: {
          xUrl?: string | null;
          websiteUrl?: string | null;
          stats?: { pullCount?: number; settledCount?: number; pullVolumeLamports?: string };
        };
      };
      if (project?.stats) {
        value = {
          pulls: project.stats.pullCount ?? 0,
          settled: project.stats.settledCount ?? 0,
          volumeLamports: project.stats.pullVolumeLamports ?? "0",
          xUrl: project.xUrl ?? null,
          websiteUrl: project.websiteUrl ?? null,
        };
      }
    }
  } catch {
    /* the directory is optional; the panel shows chain facts without it */
  }
  cache.set(slug, { at: Date.now(), value });
  return value;
}

/**
 * The art shelf: GET /art?mints= on the directory api answers a URL on
 * OpenGacha's own image domain for every mint it has shelved or can shelve
 * (one origin fetch ever, per card, made by their server; browsers only
 * touch the edge). Optional and fail-open: an api that does not answer is an
 * empty map, and the card keeps the URL its own metadata gave.
 */
export async function shelfArt(mints: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  if (process.env.ART_SHELF === "0") return out;
  for (let i = 0; i < mints.length; i += 100) {
    const chunk = mints.slice(i, i + 100);
    try {
      const res = await fetch(`${DIRECTORY}/art?mints=${chunk.join(",")}`, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) Object.assign(out, (await res.json()) as Record<string, string | null>);
    } catch {
      /* the metadata's own URL stands */
    }
  }
  return out;
}
