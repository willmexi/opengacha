"use client";

/**
 * The landing's live pieces. Both read the same snapshot route the
 * storefront reads, so what a visitor sees on the front page is the pool
 * as it stands on chain right now, not a picture of one.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { Slab } from "@/components/slab";
import { POOLS } from "@/lib/config";
import type { Snapshot } from "@/lib/mirror";
import { formatOdds, revealCard } from "@/lib/reveal";

/*
 * One read per pool, shared. The hero case, the live line and the pool
 * rows all want the same snapshot; without this the landing asks for the
 * first pool three times on every load, which a rate-limited RPC feels.
 */
const cache = new Map<string, { at: number; snap: Snapshot }>();
const inFlight = new Map<string, Promise<Snapshot>>();
const TTL_MS = 10_000;

function readPoolSnapshot(slug: string): Promise<Snapshot> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.snap);
  const running = inFlight.get(slug);
  if (running) return running;
  const p = fetch(`/api/pool/${slug}`)
    .then((r) => r.json() as Promise<Snapshot>)
    .then((snap) => {
      if (snap?.pool) cache.set(slug, { at: Date.now(), snap });
      return snap;
    })
    .finally(() => inFlight.delete(slug));
  inFlight.set(slug, p);
  return p;
}

function useSnapshot(slug: string) {
  const [snap, setSnap] = useState<Snapshot | null>(() => cache.get(slug)?.snap ?? null);
  useEffect(() => {
    let alive = true;
    readPoolSnapshot(slug)
      .then((j) => alive && j?.pool && setSnap(j))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug]);
  return snap;
}

/**
 * The case in the hero: the pool's best cards, one at a time, sealed. The
 * chase card leads, because that is what a case in a shop window holds.
 */
export function LiveCase() {
  const snap = useSnapshot(POOLS[0].slug);
  const [ready, setReady] = useState<string[]>([]);
  const [i, setI] = useState(0);

  const best = (snap?.cards ?? [])
    .filter((c) => c.status === "active" && c.image)
    .sort((a, b) => Number(BigInt(b.backingLamports) - BigInt(a.backingLamports)))
    .slice(0, 5);

  // Nothing is shown until its art is in the cache: a case that blanks
  // between cards looks broken, and these images come from a gateway.
  const keys = best.map((c) => c.address).join();
  useEffect(() => {
    let alive = true;
    for (const c of best) {
      const img = new Image();
      img.onload = () => alive && setReady((r) => (r.includes(c.address) ? r : [...r, c.address]));
      img.src = c.image!;
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  const shown = best.filter((c) => ready.includes(c.address));

  useEffect(() => {
    if (shown.length < 2) return;
    const t = setInterval(() => setI((n) => n + 1), 4600);
    return () => clearInterval(t);
  }, [shown.length]);

  const at = shown.length ? i % shown.length : 0;

  return (
    <div className="stage flex min-h-[540px] flex-col items-center justify-center gap-5 px-4 py-9 sm:min-h-[600px] sm:px-6">
      {shown.length && snap ? (
        <>
          {/* Every card stays mounted and fades: the art comes from a
              gateway that will happily fetch it again otherwise, and a case
              that empties between cards reads as broken. */}
          <div className="relative h-[500px] w-full max-w-[330px]">
            {shown.map((c, n) => (
              <div
                key={c.address}
                aria-hidden={n !== at}
                className="absolute inset-0 flex justify-center"
                style={{ opacity: n === at ? 1 : 0, transition: "opacity 460ms var(--ease)" }}
              >
                <Slab
                  card={revealCard(c, snap.pool.evLamports)}
                  cert={`Cert #${c.positionId}`}
                  odds={formatOdds(c.odds)}
                  width={330}
                  className="max-w-full"
                />
              </div>
            ))}
          </div>
          <p className="label m-0">From {POOLS[0].name}</p>
          {shown.length > 1 && (
            <div className="flex items-center gap-2">
              {shown.map((c, n) => (
                <button
                  key={c.address}
                  onClick={() => setI(n)}
                  aria-label={`Show ${c.name}`}
                  aria-current={n === at ? "true" : undefined}
                  className="h-[3px] w-7 rounded-full transition-colors"
                  style={{ background: n === at ? "var(--accent)" : "var(--track)" }}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        /* Nothing while the cards load: no words, no pulse; the cards
           simply appear when the read lands. */
        <div aria-busy="true" className="min-h-[1px]" />
      )}
    </div>
  );
}

/** One line of live truth under the hero copy. */
export function LiveLine() {
  const snap = useSnapshot(POOLS[0].slug);
  const p = snap?.pool;
  return (
    <p className="figure m-0 text-[12px]" style={{ color: "var(--faint)" }}>
      {p ? (
        <>
          <span style={{ color: "var(--accent-lit)" }}>{p.priceSol} SOL</span> per pull ·{" "}
          {p.activePositions} cards in the case · {p.pullCount} pulls so far
        </>
      ) : (
        /* Silent until the figures land; the line keeps its height so the
           copy above does not jump when they do. */
        <span aria-busy="true">&nbsp;</span>
      )}
    </p>
  );
}

/** What this storefront sells, priced from the chain. */
export function PoolCards() {
  return (
    <section className="cells sm:grid-cols-2" style={{ borderInline: "none" }}>
      {POOLS.map((p) => (
        <PoolCard key={p.slug} slug={p.slug} />
      ))}
    </section>
  );
}

function PoolCard({ slug }: { slug: string }) {
  const config = POOLS.find((p) => p.slug === slug)!;
  const snap = useSnapshot(slug);
  const p = snap?.pool;
  return (
    <Link href={`/packs?pool=${slug}`} className="hover-corners group flex flex-col">
      <div className="flex flex-1 items-center gap-5 px-6 py-6 sm:px-8">
        <img src={config.art} alt="" className="h-28 w-auto shrink-0 object-contain" draggable={false} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="heading text-[15px]">{config.name}</span>
            <span className="label">{p ? (p.ownStock ? "Own stock" : "Open deposits") : "…"}</span>
          </div>
          <p className="m-0 mt-2 text-[13px] leading-[1.65]" style={{ color: "var(--muted)" }}>
            {config.tagline}
          </p>
          <span className="label mt-3 inline-block" style={{ color: "var(--accent)" }}>
            Open this pack →
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3" style={{ borderTop: "1px solid var(--hairline)" }}>
        <Fig k="Per pull" v={p ? `${p.priceSol} SOL` : "…"} lead />
        <Fig k="Cards" v={p ? String(p.activePositions) : "…"} />
        <Fig k="Pulls" v={p ? String(p.pullCount) : "…"} />
      </div>
    </Link>
  );
}

function Fig({ k, v, lead }: { k: string; v: string; lead?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 px-6 py-4 sm:px-8" style={{ borderLeft: "1px solid var(--hairline)" }}>
      <span className="label">{k}</span>
      <span className="figure text-[14px]" style={{ color: lead ? "var(--accent)" : "var(--value)" }}>
        {v}
      </span>
    </div>
  );
}
