"use client";

/**
 * What is in the pool: every card you could draw, what it is backed by,
 * and how often it comes up.
 *
 * Sorted by backing, descending — which is the same as ascending by odds,
 * because in this program they are the same number read two ways. The list
 * is the default: a column of backings is what you actually compare.
 */

import { useMemo, useState } from "react";

import { BAND } from "@/components/slab";
import type { CardJson, PoolJson } from "@/lib/mirror";
import { RARITY_ORDER, formatOdds, rarityOf, type Rarity } from "@/lib/reveal";

export function PoolShelf({ pool, cards, wide = false }: { pool: PoolJson; cards: CardJson[]; wide?: boolean }) {
  const [filter, setFilter] = useState<Rarity | "all">("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const ev = BigInt(pool.evLamports);

  const active = useMemo(
    () =>
      cards
        .filter((c) => c.status === "active")
        .map((c) => ({ ...c, rarity: rarityOf(BigInt(c.backingLamports), ev) }))
        .sort((a, b) => Number(BigInt(b.backingLamports) - BigInt(a.backingLamports))),
    [cards, ev]
  );
  const counts = useMemo(() => {
    const out = new Map<Rarity, number>();
    for (const c of active) out.set(c.rarity, (out.get(c.rarity) ?? 0) + 1);
    return out;
  }, [active]);
  const shown = filter === "all" ? active : active.filter((c) => c.rarity === filter);

  return (
    <div>
      <div className="sticky top-0 z-10" style={{ background: "var(--bg)" }}>
      <div
        className="flex items-center justify-between gap-2 px-5 py-2.5"
        style={{ borderBottom: "1px solid var(--hairline)" }}
      >
        <span className="label">Best backed first · SOL</span>
        <div className="flex gap-1">
          {(["list", "grid"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className="label rounded-[2px] px-2 py-1 transition-colors"
              style={{ color: view === v ? "var(--text)" : "var(--faint)", background: view === v ? "var(--cell)" : "transparent" }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 px-5 py-3" style={{ borderBottom: "1px solid var(--hairline)" }}>
        <Chip label="All" count={active.length} on={filter === "all"} onClick={() => setFilter("all")} />
        {RARITY_ORDER.filter((r) => counts.has(r)).map((r) => (
          <Chip
            key={r}
            label={r}
            count={counts.get(r) ?? 0}
            color={BAND[r]}
            on={filter === r}
            onClick={() => setFilter(r)}
          />
        ))}
      </div>
      </div>

      {shown.length === 0 ? (
        <p className="m-0 px-4 py-10 text-center text-[13px]" style={{ color: "var(--muted)" }}>
          No cards in this class right now.
        </p>
      ) : view === "list" ? (
        <ul className={`rows m-0 list-none p-0 ${wide ? "sm:grid sm:grid-cols-2 sm:gap-x-0" : ""}`}>
          {shown.map((c) => (
            <li key={c.address} className="flex items-center gap-3 px-5 py-2.5">
              <Art src={c.image} className="size-10" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium" title={c.name}>
                  {c.name}
                </span>
                <span className="label" style={{ color: BAND[c.rarity] }}>
                  {c.rarity} · {formatOdds(c.odds)}
                </span>
              </span>
              <span className="figure shrink-0 text-[12.5px]">{c.backingSol}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className={`grid gap-3 p-4 ${wide ? "grid-cols-3 xl:grid-cols-4" : "grid-cols-2"}`}>
          {shown.map((c) => (
            <div key={c.address} className="flex flex-col gap-1.5">
              <Art src={c.image} className="aspect-[3/4] w-full" />
              <span className="truncate text-[11.5px] font-medium" title={c.name}>
                {c.name}
              </span>
              <span className="flex items-baseline justify-between gap-2">
                <span className="label" style={{ color: BAND[c.rarity] }}>
                  {formatOdds(c.odds)}
                </span>
                <span className="figure text-[12px]">{c.backingSol}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ label, count, color, on, onClick }: { label: string; count: number; color?: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className="label flex items-center gap-1.5 px-2 py-1.5 transition-colors"
      style={{
        border: `1px solid ${on ? (color ?? "var(--text)") : "var(--hairline)"}`,
        color: on ? (color ?? "var(--text)") : "var(--faint)",
      }}
    >
      {label}
      <span className="figure text-[10px]" style={{ opacity: 0.7 }}>
        {count}
      </span>
    </button>
  );
}

function Art({ src, className }: { src: string | null; className: string }) {
  return (
    <div className={`shrink-0 overflow-hidden rounded-[3px] ${className}`} style={{ background: "var(--cell)" }}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} /> : null}
    </div>
  );
}
