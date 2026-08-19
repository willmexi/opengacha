"use client";

/**
 * Open acquisitions: money that has left your wallet and not come back.
 *
 * opengacha.io's header menu, carried into the storefront: every unsettled
 * pull the connected wallet holds on any pool this shop sells, read from
 * the chain (lib/open-acquisitions.ts), so closing the tab loses nothing
 * and this is where a pull is found again.
 *
 * Three states, each owing the reader something different:
 *
 *   drawn      the card is out of the pool waiting on your choice: Settle
 *              opens the pack page with the request in the URL, straight
 *              into the decision
 *   drawing    randomness has not landed; nothing to do but wait
 *   expired    randomness never landed (past the program's expiry), and
 *              Refund cancels it: price_paid minus the VRF fee comes back
 *
 * The buckets come from the request account's own `fulfilled` byte, never
 * from whether this client saw the draw.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";

import { useWalletOwner } from "@/lib/gacha/wallet";
import { cancelRequest, REQUEST_EXPIRY_MS } from "@/lib/gacha/pull";
import { sol } from "@/lib/gacha/price";
import { useOpenAcquisitions, type OpenAcquisition } from "@/lib/open-acquisitions";

/** opengacha.io's pixel receipt, so the two sites share the one glyph. */
function Receipt({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden focusable="false" shapeRendering="crispEdges">
      <path d="m19,1v1h-1v1h-1v-1h-1v-1h-2v1h-1v1h-2v-1h-1v-1h-2v1h-1v1h-1v-1h-1v-1h-1v22h1v-1h1v-1h1v1h1v1h2v-1h1v-1h2v1h1v1h2v-1h1v-1h1v1h1v1h1V1h-1Zm-1,8H6v-2h12v2Zm0,4H6v-2h12v2Zm0,4H6v-2h12v2Z" />
    </svg>
  );
}

function relative(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AcquisitionsMenu() {
  const wallet = useWalletOwner();
  const { rows: all, refresh } = useOpenAcquisitions(wallet);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);

  // A clock for the relative times and the expiry bucket; only while open.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [open]);

  // Outside click and Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!wallet) return null;

  const createdMs = (r: OpenAcquisition) => r.request.createdAt * 1000;
  const fulfilled = all.filter((r) => r.request.fulfilled);
  const pending = all.filter((r) => !r.request.fulfilled);
  const expired = pending.filter((r) => now - createdMs(r) >= REQUEST_EXPIRY_MS);
  const drawing = pending.filter((r) => now - createdMs(r) < REQUEST_EXPIRY_MS);
  // The wallet here IS the purchaser, so every drawn pull is settleable now.
  const actionable = fulfilled.length + expired.length;
  // Ordered by urgency: a settlement above a refund above something in flight.
  const rows = [...fulfilled, ...expired, ...drawing];

  const cancel = async (r: OpenAcquisition) => {
    const key = r.request.address;
    setBusy(key);
    try {
      await cancelRequest(wallet, new PublicKey(r.config.address), r.request);
      refresh();
    } catch {
      /* the row stays; the reason is in the wallet or the next refresh */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open acquisitions"
        title="Open acquisitions"
        className="panel-hover relative flex size-8 shrink-0 items-center justify-center transition-colors"
        style={{ color: "var(--muted)" }}
      >
        <Receipt size={15} />
        {actionable > 0 && (
          <span
            className="absolute -top-1 -right-1 rounded-[6px] px-1 py-0.5 text-[9px] leading-none font-bold"
            style={{ backgroundColor: "var(--accent)", color: "#000" }}
          >
            {actionable}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="fixed inset-x-3 top-[calc(var(--nav-h)+4px)] z-50 overflow-hidden rounded-[6px] sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-1.5 sm:w-[360px]"
          style={{ background: "var(--surface)", border: "1px solid var(--hairline)", boxShadow: "0 12px 40px rgba(0,0,0,0.35)" }}
        >
          <p className="label m-0 px-4 pt-3.5 pb-2">
            {rows.length === 0
              ? "Open acquisitions"
              : `${rows.length} open · ${actionable} need${actionable === 1 ? "s" : ""} you`}
          </p>

          {rows.length === 0 ? (
            <div className="mx-3 mb-3 rounded-[6px] px-3 py-6 text-center" style={{ border: "1px dashed var(--hairline)" }}>
              <p className="m-0 text-[13px]" style={{ color: "var(--muted)" }}>
                No acquisitions waiting.
              </p>
              <p className="m-0 mt-1 text-[11.5px]" style={{ color: "var(--faint)" }}>
                Anything you pay for, on any pack here, shows up until it settles.
              </p>
            </div>
          ) : (
            <ul className="m-0 max-h-[320px] list-none overflow-y-auto p-0 px-1.5">
              {rows.map((r) => {
                const isFulfilled = r.request.fulfilled;
                const isExpired = !isFulfilled && now - createdMs(r) >= REQUEST_EXPIRY_MS;
                const subtitle = isFulfilled
                  ? "Drawn · choose an exit"
                  : isExpired
                    ? "Randomness never landed · refundable"
                    : `Drawing since ${relative(createdMs(r), now)}`;
                const href = `/packs?pool=${encodeURIComponent(r.config.slug)}&settle=${r.request.requestId}`;
                const isBusy = busy === r.request.address;
                return (
                  <li
                    key={r.request.address}
                    className="flex items-center gap-2.5 rounded-[6px] px-2 py-2"
                    style={{ borderBottom: "1px solid var(--hairline)" }}
                  >
                    <span
                      className="size-9 shrink-0 overflow-hidden rounded-[4px]"
                      style={{ background: "var(--backdrop)", border: "1px solid var(--hairline)" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.config.art} alt="" className="h-full w-full object-cover" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px] font-medium">
                        {r.config.name} <span style={{ color: "var(--faint)" }}>· pull #{r.request.requestId}</span>
                      </span>
                      <span className="truncate text-[11.5px]" style={{ color: isExpired ? "var(--accent)" : "var(--faint)" }}>
                        {sol(r.request.pricePaidLamports)} SOL · {subtitle}
                      </span>
                    </span>
                    {isFulfilled ? (
                      <Link
                        href={href}
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className="shrink-0 rounded-[6px] px-2.5 py-1.5 text-[12px] font-bold"
                        style={{ backgroundColor: "var(--accent)", color: "#000" }}
                      >
                        Settle
                      </Link>
                    ) : isExpired ? (
                      <button
                        role="menuitem"
                        onClick={() => void cancel(r)}
                        disabled={isBusy}
                        className="shrink-0 rounded-[6px] px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-50"
                        style={{ border: "1px solid var(--hairline)" }}
                      >
                        {isBusy ? "…" : "Refund"}
                      </button>
                    ) : (
                      <span className="shrink-0 text-[11.5px]" style={{ color: "var(--faint)" }}>
                        drawing…
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <Link
            href="/packs"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mx-3 my-3 flex items-center justify-between rounded-[6px] px-3 py-2.5 text-[13px] font-medium"
            style={{ border: "1px solid var(--hairline)", color: "var(--muted)" }}
          >
            Explore packs
            <span aria-hidden>→</span>
          </Link>
        </div>
      )}
    </div>
  );
}
