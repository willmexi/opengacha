"use client";

/**
 * Beside the case: what else is for sale, and what is in the pack you are
 * looking at. Two tabs, because a shopper is doing one of two things —
 * choosing a pack, or reading the odds on the one they chose.
 */

import { useEffect, useRef, useState } from "react";

import { PoolShelf } from "@/components/pool-shelf";
import { BAND } from "@/components/slab";
import { POOLS } from "@/lib/config";
import type { Snapshot } from "@/lib/mirror";
import { formatOdds, rarityOf } from "@/lib/reveal";

export type Tab = "packs" | "inside";

export function SideTabs({
  selected,
  onSelect,
  snapshot,
  locked,
  tab,
  onTab,
}: {
  selected: string;
  onSelect: (slug: string) => void;
  snapshot: Snapshot | null;
  /** True while a pull is in flight: switching packs mid-draw is refused. */
  locked: boolean;
  /** Owned by the page: the storefront's columns follow it. */
  tab: Tab;
  onTab: (t: Tab) => void;
}) {
  const wide = tab === "inside";
  // The body dips while the column resizes, so the list does not lay itself
  // out twice in front of the reader.
  const [swapping, setSwapping] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSwapping(true);
    const t = setTimeout(() => setSwapping(false), 200);
    return () => clearTimeout(t);
  }, [tab]);
  const tabs: [Tab, string][] = [
    ["packs", `Packs · ${POOLS.length}`],
    ["inside", `In this pack${snapshot ? ` · ${snapshot.pool.activePositions}` : ""}`],
  ];
  return (
    <>
      <div className="flex shrink-0" style={{ borderBottom: "1px solid var(--hairline)", background: "var(--cell)" }}>
        {tabs.map(([t, label]) => (
          <button
            key={t}
            onClick={() => onTab(t)}
            aria-pressed={tab === t}
            className="label relative flex-1 px-3 py-3.5 transition-colors"
            style={{
              color: tab === t ? "var(--text)" : "var(--faint)",
              background: tab === t ? "var(--bg)" : "transparent",
              borderRight: t === "packs" ? "1px solid var(--hairline)" : undefined,
            }}
          >
            {label}
            {tab === t && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px]" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
      </div>
      <div className="tab-body scroll-quiet min-h-0 flex-1 overflow-y-auto" data-swapping={swapping ? "true" : "false"}>
        {tab === "packs" ? (
          <PackList selected={selected} onSelect={onSelect} locked={locked} />
        ) : snapshot ? (
          <PoolShelf pool={snapshot.pool} cards={snapshot.cards} wide={wide} />
        ) : (
          <p className="m-0 px-4 py-8 text-[12.5px]" style={{ color: "var(--muted)", animation: "breathe 1.4s infinite" }}>
            Reading the pool…
          </p>
        )}
      </div>

      {/* Pinned under the scroll, never clipped by it: the card most people
          are here for, and the way into the full contents. */}
      {tab === "packs" && <Chase snapshot={snapshot} onSeeAll={() => onTab("inside")} />}
    </>
  );
}

function PackList({ selected, onSelect, locked }: { selected: string; onSelect: (slug: string) => void; locked: boolean }) {
  const [quotes, setQuotes] = useState<Record<string, { price: string; cards: number }>>({});

  // One quote per row, refreshed slowly: this is a menu, not a ticker.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const next: Record<string, { price: string; cards: number }> = {};
      await Promise.all(
        POOLS.map(async (p) => {
          try {
            const res = await fetch(`/api/pool/${p.slug}`);
            const json = (await res.json()) as { pool?: { priceSol: string; activePositions: number } };
            if (json.pool) next[p.slug] = { price: json.pool.priceSol, cards: json.pool.activePositions };
          } catch {
            /* the row shows without a quote */
          }
        })
      );
      if (alive) setQuotes(next);
    };
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <ul className="rows m-0 list-none p-0">
      {POOLS.map((p) => {
        const on = p.slug === selected;
        const q = quotes[p.slug];
        return (
          <li key={p.slug}>
            <button
              onClick={() => onSelect(p.slug)}
              disabled={locked}
              aria-current={on ? "true" : undefined}
              style={{ background: on ? "var(--cell)" : "transparent" }}
              className="hover-corners flex w-full items-center gap-3.5 px-5 py-3.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
            >
              <img src={p.art} alt="" className="h-14 w-11 shrink-0 object-contain" draggable={false} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{p.name}</span>
                <span className="label">{q ? `${q.cards} cards` : "…"}</span>
              </span>
              <span className="figure shrink-0 text-[12.5px]" style={{ color: on ? "var(--accent-lit)" : "var(--text)" }}>
                {q ? `${q.price} SOL` : "…"}
              </span>
            </button>
          </li>
        );
      })}
      <li className="px-4 py-3.5 text-[11.5px] leading-[1.6]" style={{ color: "var(--faint)" }}>
        Add a pack in <code className="figure text-[11px]">pools.json</code>: any pool on the OpenGacha program.
      </li>
    </ul>
  );
}

/**
 * The best-backed card in the selected pool, in the room the pack list
 * leaves over. It is the card most people are here for, and it is the way
 * into the full contents.
 */
function Chase({ snapshot, onSeeAll }: { snapshot: Snapshot | null; onSeeAll: () => void }) {
  if (!snapshot) return null;
  const active = snapshot.cards.filter((c) => c.status === "active");
  if (active.length === 0) return null;
  const top = active.reduce((a, b) => (BigInt(b.backingLamports) > BigInt(a.backingLamports) ? b : a));
  const band = BAND[rarityOf(BigInt(top.backingLamports), BigInt(snapshot.pool.evLamports))];

  return (
    <div className="shrink-0" style={{ borderTop: "1px solid var(--hairline)", background: "var(--surface)" }}>
      <div className="flex items-center justify-between gap-2 px-5 pt-3.5">
        <span className="label">Best backed in this pack</span>
        <button onClick={onSeeAll} className="label transition-colors hover:text-[var(--accent-lit)]" style={{ color: "var(--accent-lit)" }}>
          See all {active.length} →
        </button>
      </div>
      <div className="flex items-center gap-3.5 px-5 pt-3 pb-4">
        <div className="size-16 shrink-0 overflow-hidden rounded-[3px]" style={{ background: "var(--cell)" }}>
          {top.image && <img src={top.image} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[12.5px] font-medium" title={top.name}>
            {top.name}
          </p>
          <p className="label m-0 mt-1" style={{ color: band }}>
            {formatOdds(top.odds)} of pulls
          </p>
        </div>
        <span className="figure shrink-0 text-[13px]">{top.backingSol}</span>
      </div>
    </div>
  );
}
