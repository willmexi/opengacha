"use client";

/**
 * The Deposit tab of the user profile: the OpenGacha console's picker and
 * slip, for a depositor instead of a creator.
 *
 *   1. Pick the pool (only pools that take deposits from this wallet).
 *   2. The picker: every card in the wallet from a collection the pool
 *      admits, art and name, multi-select, twelve to a page.
 *   3. The slip: one row per selected card with its Low / Worth / High
 *      chips (from the card's insured value, when it has one), its own
 *      backing field checked against the band that governs the card, and
 *      one Deposit button for the lot. One wallet prompt per card, in
 *      order; every row reports its own outcome.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import type { PublicKey } from "@solana/web3.js";

import { chain, type WalletNft } from "@/lib/gacha";
import type { Hub, PoolView, DepositOutcome } from "@/lib/profile";
import { stopsFor, suggestBackingSol } from "@/lib/backing";
import { SectionRule } from "@/components/section-rule";

const LAMPORTS = 1_000_000_000;
const PER_PAGE = 12;
const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

interface Meta {
  image: string | null;
  insuredUsd: number | null;
}

interface Sale {
  usd: number | null;
  lamports: string | null;
}

/** Art and insured value for the wallet scan, from /api/meta (resolved
 * once server-side, kept in the local db), fifty mints a call. */
function useCardMeta(mints: string[]): Record<string, Meta> {
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const key = mints.join(",");
  useEffect(() => {
    const missing = key ? key.split(",").filter((m) => !(m in meta)) : [];
    if (missing.length === 0) return;
    let live = true;
    (async () => {
      for (let i = 0; i < missing.length; i += 50) {
        const batch = missing.slice(i, i + 50);
        let got: Record<string, { image?: string | null; insuredUsd?: number | null }> = {};
        try {
          const res = await fetch(`/api/meta?mints=${batch.join(",")}`);
          got = (await res.json()) as typeof got;
        } catch {
          /* a card without art is still a card */
        }
        if (!live) return;
        setMeta((prev) => {
          const next = { ...prev };
          for (const m of batch) next[m] = { image: got[m]?.image ?? null, insuredUsd: got[m]?.insuredUsd ?? null };
          return next;
        });
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return meta;
}

/** Last sales for the cards whose metadata carries no insured value, from
 * /api/worth, four mints a call, two calls in flight: a walk is up to 41
 * chain reads per card, so this is paced, and the chips show "…" until a
 * card's answer lands. `undefined` = not asked yet, `null` = walked, none. */
function useLastSales(mints: string[]): Record<string, Sale | null> {
  const [sales, setSales] = useState<Record<string, Sale | null>>({});
  const key = mints.join(",");
  useEffect(() => {
    const queue = key ? key.split(",").filter((m) => !(m in sales)) : [];
    if (queue.length === 0) return;
    let live = true;
    let next = 0;
    const worker = async () => {
      while (live && next < queue.length) {
        const batch = queue.slice(next, next + 4);
        next += 4;
        try {
          const res = await fetch(`/api/worth?mints=${batch.join(",")}`);
          const got = (await res.json()) as Record<string, Sale | null>;
          if (!live) return;
          setSales((prev) => {
            const out = { ...prev };
            for (const m of batch) out[m] = got[m] ?? null;
            return out;
          });
        } catch {
          // Left unanswered: the chips fall to the floor ladder for now and
          // the next visit asks again.
          if (!live) return;
          setSales((prev) => ({ ...prev, ...Object.fromEntries(batch.map((m) => [m, null])) }));
        }
      }
    };
    void worker();
    void worker();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return sales;
}

/** The wallet's SOL, read once per wallet and after every action, so the
 * slip can say up front whether the backings fit. */
function useBalance(wallet: PublicKey | null, epoch: number): number | null {
  const [sol, setSol] = useState<number | null>(null);
  const address = wallet?.toBase58() ?? null;
  useEffect(() => {
    if (!wallet) return;
    let live = true;
    chain()
      .connection.getBalance(wallet)
      .then((l) => live && setSol(l / LAMPORTS))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, epoch]);
  return sol;
}

/** SOL in USD from the site's own cached route; null shows SOL alone. */
function useSolUsd(): number | null {
  const [usd, setUsd] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/sol-price")
      .then((r) => r.json())
      .then((j: { usd?: number | null }) => {
        if (live && typeof j.usd === "number") setUsd(j.usd);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return usd;
}

export function DepositPanel({ hub }: { hub: Hub }) {
  const open = hub.pools.filter((v) => v.canDeposit);
  const [slug, setSlug] = useState<string | null>(null);
  const view = open.find((v) => v.config.slug === slug) ?? open[0] ?? null;

  const viewSlug = view?.config.slug ?? null;
  const { loadHoldings, holdingsEpoch } = hub;
  useEffect(() => {
    // First look: scan if not scanned. After an action (epoch moved): scan
    // again, the old list staying on screen until the new one lands.
    if (viewSlug) loadHoldings(viewSlug, holdingsEpoch > 0);
  }, [viewSlug, loadHoldings, holdingsEpoch]);
  const holdings = viewSlug ? hub.holdings(viewSlug) : { list: [] as WalletNft[], loading: false, error: null };
  const meta = useCardMeta(holdings.list.map((h) => h.mint));
  const solUsd = useSolUsd();
  const balance = useBalance(hub.wallet, hub.holdingsEpoch);
  // Only cards whose metadata gave no insured value go to the sale walk,
  // and only once the metadata has answered for them.
  const sales = useLastSales(holdings.list.map((h) => h.mint).filter((m) => meta[m] !== undefined && meta[m]?.insuredUsd === null));

  const [sel, setSel] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<DepositOutcome[] | null>(null);
  const busy = hub.busy === `deposit:${viewSlug}`;

  // A different pool is a different picker: clear the selection. Only on a
  // real change between two pools; a re-render or a moment without a view
  // must not throw away what the person selected and typed.
  const [seenSlug, setSeenSlug] = useState<string | null>(viewSlug);
  if (viewSlug && seenSlug && viewSlug !== seenSlug) {
    setSeenSlug(viewSlug);
    setSel([]);
    setPage(0);
    setResults(null);
    setProgress(null);
  } else if (viewSlug && !seenSlug) {
    setSeenSlug(viewSlug);
  }

  const byMint = useMemo(() => new Map(holdings.list.map((h) => [h.mint, h])), [holdings.list]);
  const boundsSol = (nft: WalletNft) => {
    if (!view) return { minSol: 0, maxSol: Number.POSITIVE_INFINITY };
    const b = hub.boundsFor(view, nft.collection);
    return { minSol: Number(b.minLamports) / LAMPORTS, maxSol: Number(b.maxLamports) / LAMPORTS };
  };
  /** The card's worth in SOL and where it came from: insured value at the
   * live rate, else its last sale (a SOL sale needs no rate), else nothing.
   * `pending` while the sale walk is still out for it. */
  const worthOf = (mint: string): { sol: number | null; source: "insured" | "sale" | null; pending: boolean } => {
    const usd = meta[mint]?.insuredUsd;
    if (usd && solUsd) return { sol: usd / solUsd, source: "insured", pending: false };
    if (meta[mint] === undefined) return { sol: null, source: null, pending: true };
    const sale = sales[mint];
    if (sale === undefined) return { sol: null, source: null, pending: meta[mint]?.insuredUsd === null };
    if (sale?.lamports) return { sol: Number(sale.lamports) / LAMPORTS, source: "sale", pending: false };
    if (sale?.usd && solUsd) return { sol: sale.usd / solUsd, source: "sale", pending: false };
    return { sol: null, source: null, pending: false };
  };
  const amountFor = (nft: WalletNft): string => {
    if (nft.mint in amounts) return amounts[nft.mint];
    return String(suggestBackingSol(worthOf(nft.mint).sol, boundsSol(nft)));
  };

  const toggle = (mint: string) => {
    if (busy) return;
    setResults(null);
    setSel((s) => (s.includes(mint) ? s.filter((m) => m !== mint) : [...s, mint]));
  };

  const rows = sel
    .map((mint) => byMint.get(mint))
    .filter((n): n is WalletNft => Boolean(n))
    .map((nft) => {
      const raw = Number(amountFor(nft));
      const b = boundsSol(nft);
      const valid = amountFor(nft).trim() !== "" && Number.isFinite(raw) && raw >= b.minSol && raw <= b.maxSol;
      return { nft, raw, valid, bounds: b };
    });
  const allValid = rows.length > 0 && rows.every((r) => r.valid);
  const total = rows.reduce((a, r) => a + (r.valid ? r.raw : 0), 0);
  // What the batch will take from the wallet: the backings, rent per
  // position, and fees. Said before the press, not after.
  const needSol = total + 0.006 * rows.length + 0.005;
  const shortOfSol = balance !== null && allValid && balance < needSol;

  const deposit = async () => {
    if (!view || !allValid || busy) return;
    setResults(null);
    setProgress({ done: 0, total: rows.length });
    const out = await hub.depositMany(
      view,
      rows.map((r) => ({ nft: r.nft, backingLamports: BigInt(Math.round(r.raw * LAMPORTS)) })),
      (done, t) => setProgress({ done, total: t })
    );
    setResults(out);
    // The rows that went through leave the slip; the failed ones stay to fix.
    const failed = new Set(out.filter((o) => o.error).map((o) => o.mint));
    setSel((s) => s.filter((m) => failed.has(m)));
  };

  if (!view) {
    return (
      <p className="m-0 px-5 py-8 text-[13px] leading-[1.65]" style={{ color: "var(--muted)" }}>
        None of the pools here takes deposits from you: they are own-stock pools, stocked by their creators. You can
        still pull from them on{" "}
        <Link href="/packs" className="underline underline-offset-2">
          packs
        </Link>{" "}
        or{" "}
        <Link href="/spinner" className="underline underline-offset-2">
          spins
        </Link>
        .
      </p>
    );
  }

  const pageCount = Math.max(1, Math.ceil(holdings.list.length / PER_PAGE));
  const safe = Math.min(page, pageCount - 1);
  const shown = holdings.list.slice(safe * PER_PAGE, safe * PER_PAGE + PER_PAGE);

  return (
    <>
      <section>
        <SectionRule label="Pool" />
        <div className="flex flex-wrap gap-2 px-6 py-5 sm:px-8">
          {open.map((v) => (
            <button
              key={v.config.slug}
              onClick={() => setSlug(v.config.slug)}
              aria-current={v === view ? "true" : undefined}
              className="hover-corners flex items-center gap-3 rounded-[3px] px-3 py-2 text-left"
              style={{ border: `1px solid ${v === view ? "var(--accent)" : "var(--hairline)"}` }}
            >
              <img src={v.config.art} alt="" className="h-9 w-7 object-contain" draggable={false} />
              <span>
                <span className="block text-[12.5px] font-medium">{v.config.name}</span>
                <span className="label">
                  {v.pool.ownStock ? "Your own-stock pool" : "Open deposits"} · admits {v.admitted.length} collections
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionRule label={`Cards in your wallet this pool would take · ${holdings.list.length}`} />
        <div className="px-6 py-5 sm:px-8">
          <p className="m-0 mb-4 max-w-[76ch] text-[13px] leading-[1.65]" style={{ color: "var(--muted)" }}>
            Backing is what your card sits behind. Back it lower and it is drawn more often; back it higher and a
            winner who takes the buyback pays you more. Either way it earns a share of every pull&apos;s fee while it
            is in the draw, and you can withdraw it whenever it is not mid-settle. Pick one card or many.
          </p>

          {holdings.error && (
            <p className="m-0 mb-3 text-[13px] leading-[1.65]" style={{ color: "var(--accent-lit)" }}>
              Could not read your wallet: {holdings.error}{" "}
              <button onClick={() => viewSlug && loadHoldings(viewSlug, true)} className="underline underline-offset-2">
                Try again
              </button>
            </p>
          )}
          {holdings.loading && holdings.list.length === 0 ? (
            <p className="m-0 text-[13px]" style={{ color: "var(--muted)", animation: "breathe 1.4s infinite" }}>
              Reading your wallet…
            </p>
          ) : holdings.list.length === 0 ? (
            !holdings.error && (
              <p className="m-0 text-[13px] leading-[1.65]" style={{ color: "var(--muted)" }}>
                Nothing in your wallet from the collections this pool admits.{" "}
                <button onClick={() => viewSlug && loadHoldings(viewSlug, true)} className="underline underline-offset-2">
                  Scan again
                </button>
              </p>
            )
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-4">
                <span className="label">
                  {sel.length === 0 ? "Select cards to deposit" : `${sel.length} selected`}
                </span>
                <button
                  onClick={() => {
                    if (busy) return;
                    setResults(null);
                    setSel(sel.length === holdings.list.length ? [] : holdings.list.map((h) => h.mint));
                  }}
                  className="btn-ghost px-3 py-1.5 text-[10.5px]"
                >
                  {sel.length === holdings.list.length ? "Select none" : "Select all"}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((n) => {
                  const on = sel.includes(n.mint);
                  const img = meta[n.mint]?.image;
                  return (
                    <button
                      key={n.mint}
                      onClick={() => toggle(n.mint)}
                      aria-pressed={on}
                      className="flex cursor-pointer items-center gap-3 rounded-[4px] p-2.5 text-left"
                      style={{
                        border: `1px solid ${on ? "var(--accent)" : "var(--hairline)"}`,
                        backgroundColor: on ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                      }}
                    >
                      {img ? (
                        <img
                          src={img}
                          alt=""
                          className="size-12 shrink-0 rounded-[4px] object-cover"
                          style={{ border: "1px solid var(--hairline)", background: "var(--cell)" }}
                          draggable={false}
                        />
                      ) : (
                        <span
                          className="size-12 shrink-0 rounded-[4px]"
                          style={{
                            background: "var(--cell)",
                            animation: meta[n.mint] === undefined ? "breathe 1.4s infinite" : undefined,
                          }}
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{n.name}</span>
                        <span className="label block truncate">
                          {short(n.mint)} · {n.core ? "Core" : n.tokenStandard === 4 ? "pNFT" : "NFT"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {pageCount > 1 && (
                <div className="mt-3 flex items-center justify-between gap-4">
                  <button onClick={() => setPage(safe - 1)} disabled={safe === 0} className="btn-ghost px-4 py-2 text-[11px] disabled:opacity-40">
                    ← Previous
                  </button>
                  <span className="label tabular-nums">
                    {safe * PER_PAGE + 1}–{safe * PER_PAGE + shown.length} of {holdings.list.length}
                  </span>
                  <button
                    onClick={() => setPage(safe + 1)}
                    disabled={safe >= pageCount - 1}
                    className="btn-ghost px-4 py-2 text-[11px] disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {rows.length > 0 && (
        <section>
          <SectionRule label={`Deposit · ${rows.length} ${rows.length === 1 ? "card" : "cards"}`} />
          <div className="px-6 py-5 sm:px-8">
            <div className="rounded-[4px]" style={{ border: "1px solid var(--line)", background: "var(--well)" }}>
              {rows.map((r) => (
                <SlipRow
                  key={r.nft.mint}
                  nft={r.nft}
                  image={meta[r.nft.mint]?.image ?? null}
                  worth={worthOf(r.nft.mint)}
                  bounds={r.bounds}
                  value={amountFor(r.nft)}
                  valid={r.valid}
                  outcome={results?.find((o) => o.mint === r.nft.mint) ?? null}
                  locked={busy}
                  onChange={(v) => setAmounts((a) => ({ ...a, [r.nft.mint]: v }))}
                  onRemove={() => toggle(r.nft.mint)}
                />
              ))}

              <div className="px-3.5 py-3">
                {progress && (busy || results) && (
                  <div className="mb-3">
                    <p className="m-0 mb-1.5 flex items-baseline justify-between text-[12px]" style={{ color: "var(--muted)" }}>
                      <span>{busy ? "Approve each transaction in your wallet…" : "Done"}</span>
                      <span className="tabular-nums">
                        {progress.done}/{progress.total} deposits processed
                      </span>
                    </p>
                    <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--cell)" }}>
                      <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{
                          width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%`,
                          background: "var(--accent)",
                        }}
                      />
                    </div>
                  </div>
                )}
                {results && (
                  <p className="m-0 mb-2 text-[12px]" style={{ color: "var(--muted)" }}>
                    {results.filter((x) => x.signature).length} deposited
                    {results.some((x) => x.error) && (
                      <span style={{ color: "var(--accent-lit)" }}>
                        {" "}· {results.filter((x) => x.error).length} not sent: fix or remove them and try again
                      </span>
                    )}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[13px]" style={{ color: "var(--muted)" }}>
                    A deposit locks the backing you chose in the pool (it comes back to you when the card is kept, or
                    with the card when you withdraw) plus about 0.006 SOL rent per position, refunded when the card leaves.
                    <span className="block text-[12px]" style={{ color: "var(--faint)" }}>
                      {balance !== null && `Wallet ${balance.toFixed(3)} SOL · this batch needs about ${needSol.toFixed(3)} SOL. `}
                      {rows.length === 1
                        ? "One wallet prompt."
                        : `${rows.length} wallet prompts, one per card, in order; close one and the rest wait for next time.`}
                    </span>
                  </span>
                  <button
                    onClick={() => void deposit()}
                    disabled={busy || !allValid || shortOfSol}
                    className="btn-solid ml-auto px-6 py-3 text-[11px] leading-none disabled:opacity-40"
                  >
                    {busy
                      ? "Depositing…"
                      : `Deposit ${rows.length} ${rows.length === 1 ? "card" : "cards"}${total > 0 ? ` · ${total.toFixed(3)} SOL total` : ""}`}
                  </button>
                </div>
                {!allValid && !busy && (
                  <p className="m-0 mt-2 text-[12px]" style={{ color: "var(--accent-lit)" }}>
                    Every row needs a backing inside its band before the batch can go.
                  </p>
                )}
                {shortOfSol && !busy && (
                  <p className="m-0 mt-2 text-[12px]" style={{ color: "var(--accent-lit)" }}>
                    Not enough SOL: this batch needs about {needSol.toFixed(3)} SOL and the wallet holds{" "}
                    {balance!.toFixed(3)} SOL. Top up, lower the backings, or remove a card.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function SlipRow({
  nft,
  image,
  worth,
  bounds,
  value,
  valid,
  outcome,
  locked,
  onChange,
  onRemove,
}: {
  nft: WalletNft;
  image: string | null;
  worth: { sol: number | null; source: "insured" | "sale" | null; pending: boolean };
  bounds: { minSol: number; maxSol: number };
  value: string;
  valid: boolean;
  outcome: DepositOutcome | null;
  locked: boolean;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const stops = stopsFor(worth.sol, bounds);
  const current = Number(value);
  const typedEmpty = value.trim() === "";
  const capText = bounds.maxSol >= 100_000 ? "no cap" : `${bounds.maxSol.toFixed(3)} SOL`;
  const worthText = worth.sol
    ? `${worth.source === "insured" ? "Insured" : "Last sale"} ${(Math.round(worth.sol * 1000) / 1000).toFixed(3)} SOL`
    : worth.pending
      ? "Looking up its last sale…"
      : "No price on record, the slab ladder";
  const sub = outcome?.error
    ? outcome.error
    : outcome?.signature
      ? "Deposited"
      : `${worthText} · band ${bounds.minSol.toFixed(3)} to ${capText}`;
  const subColor = outcome?.error ? "var(--accent-lit)" : outcome?.signature ? "var(--accent)" : "var(--faint)";
  const done = Boolean(outcome?.signature);

  return (
    <div
      className="flex flex-wrap items-center gap-3 px-3.5 py-2.5"
      style={{
        borderBottom: "1px solid var(--hairline)",
        borderLeft: `2px solid ${outcome?.error ? "var(--accent-lit)" : done ? "var(--accent)" : "transparent"}`,
      }}
    >
      {image ? (
        <img src={image} alt="" className="size-9 shrink-0 rounded-[4px] object-cover" style={{ border: "1px solid var(--hairline)" }} draggable={false} />
      ) : (
        <span className="size-9 shrink-0 rounded-[4px]" style={{ background: "var(--cell)" }} />
      )}
      <span className="min-w-0 flex-1 basis-40">
        <span className="block truncate text-[13px] font-medium">{nft.name}</span>
        <span className="block truncate text-[11px]" style={{ color: subColor }}>
          {sub}
        </span>
      </span>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
        {!done && (
          <span className="flex shrink-0 gap-1" role="group" aria-label="Backing presets">
            {(
              [
                ["Low", stops.low],
                [worth.sol ? "Worth" : "Mid", stops.mid],
                ["High", stops.high],
              ] as const
            ).map(([label, v]) => {
              const on = current === v;
              return (
                <button
                  key={label}
                  onClick={() => onChange(String(v))}
                  disabled={locked}
                  className="flex flex-col items-center gap-0.5 rounded-[4px] px-2 py-1 leading-none"
                  style={{
                    color: on ? "var(--accent)" : "var(--faint)",
                    border: `1px solid ${on ? "var(--accent)" : "var(--hairline)"}`,
                  }}
                >
                  <span className="text-[9px] font-bold uppercase tracking-[0.06em]">{label}</span>
                  <span
                    className="text-[11px] font-medium tabular-nums"
                    style={{ animation: worth.pending && label !== "Low" ? "breathe 1.4s infinite" : undefined }}
                  >
                    {v}
                  </span>
                </button>
              );
            })}
          </span>
        )}
        <div
          className="flex items-center rounded-[4px]"
          style={{ border: `1px solid ${valid || typedEmpty ? "var(--line)" : "var(--accent-lit)"}`, background: "var(--cell)" }}
        >
          <input
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder={`min ${bounds.minSol.toFixed(3)}`}
            inputMode="decimal"
            disabled={locked || done}
            aria-label={`Backing for ${nft.name} in SOL`}
            className="figure w-24 min-w-0 border-none bg-transparent px-3 py-2 text-right text-[16px] font-medium tabular-nums outline-none sm:text-[13px]"
            style={{ color: "var(--text)" }}
          />
          <span className="pr-2.5 text-[11px] font-medium" style={{ color: "var(--faint)" }}>
            SOL
          </span>
        </div>
        <button onClick={onRemove} disabled={locked} className="btn-ghost px-2.5 py-2 text-[11px]" aria-label="Remove from this deposit">
          ×
        </button>
      </div>
    </div>
  );
}
