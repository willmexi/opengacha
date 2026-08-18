"use client";

/**
 * The spec sheet, under the case.
 *
 * Everything the program says about this pool, in the units it stores:
 * what it costs and why, the economics a request snapshots, the rules that
 * decide what a winner may do, and the accounts you would need to do all of
 * this yourself. It sits below the fold because a shopper does not need it
 * and a developer will scroll for it.
 */

import { useState } from "react";

import type { PoolConfig } from "@/lib/config";
import { PROGRAM_ID } from "@/lib/gacha/program";
import { sol } from "@/lib/gacha/price";
import type { Snapshot } from "@/lib/mirror";

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
const span = (s: number) => (s >= 3600 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 60)}m`);
const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
/** Deposit bounds as a range; a max past 100k SOL is "no cap" in practice. */
const bounds = (min: string, max: string) => {
  const lo = Number(min) / 1e9;
  const hi = Number(max) / 1e9;
  const fmt = (n: number) => (n >= 1 ? n.toFixed(n % 1 ? 1 : 0) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""));
  return `${fmt(lo)} – ${hi >= 100_000 ? "no cap" : `${fmt(hi)} SOL`}`;
};

export function BuilderPanel({ config, snapshot }: { config: PoolConfig; snapshot: Snapshot | null }) {
  const p = snapshot?.pool;
  const d = snapshot?.directory ?? null;
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-6 py-3 sm:px-8" style={{ borderBottom: "1px solid var(--hairline)" }}>
        <span className="label">Read from the pool account · nothing configured here</span>
      </div>

      <div className="cells md:grid-cols-2 xl:[grid-template-columns:1fr_1fr_1fr_1.35fr]" style={{ borderInline: "none", borderTop: "none" }}>
        <Col label="Live">
          <Row k="Price / pull" v={p ? `${p.priceSol} SOL` : "…"} lead />
          <Row k="Expected value" v={p ? `${sol(BigInt(p.evLamports))} SOL` : "…"} hint="harmonic mean of active backings" />
          <Row k="Cards" v={p ? String(p.activePositions) : "…"} />
          <Row k="Total backing" v={p ? `${sol(BigInt(p.totalBackingLamports), 2)} SOL` : "…"} />
          <Row k="Pulls" v={p ? String(p.pullCount) : "…"} />
          {d && <Row k="Volume" v={`${sol(BigInt(d.volumeLamports), 2)} SOL`} />}
          <Row k="Fees to claim" v={p ? `${sol(BigInt(p.feesAccruedLamports))} SOL` : "…"} />
        </Col>

        <Col label="Economics">
          <Row k="Surcharge" v={p ? pct(p.surchargeBps) : "…"} hint="price = EV × (1 + surcharge)" />
          <Row k="Buyback rate" v={p ? pct(p.bidRateBps) : "…"} hint="what cashing out pays of backing" />
          <Row k="Protocol fee" v={p ? pct(p.protocolFeeBps) : "…"} />
          <Row k="Settle fee" v={p ? pct(p.settlementFeeBps) : "…"} hint="on keep, from the depositor's payout" />
          <Row k="Slippage cap" v={p ? pct(p.slippageBps) : "…"} />
          <Row k="Max per pull" v={p ? String(p.maxBatch) : "…"} />
          <Row k="Backing bounds" v={p ? bounds(p.minBackingLamports, p.maxBackingLamports) : "…"} />
        </Col>

        <Col label="Rules">
          <Row k="Who deposits" v={p ? (p.ownStock ? "The creator only" : "Anyone admitted") : "…"} />
          <Row k="Keep & relist" v={p ? (p.relistEnabled ? "Allowed" : "Off") : "…"} />
          <Row k="Winner's window" v={p ? span(p.resolveWindowSeconds) : "…"} hint="after this, anyone may settle it to keep" />
          <Row k="Refund after" v={p ? span(p.requestExpirySeconds) : "…"} hint="an undrawn pull can be cancelled" />
          <Row k="Pulls" v={p ? (p.acquisitionsPaused ? "Paused" : "Open") : "…"} />
          <div className="pt-3">
            <span className="label">Accounts · click to copy</span>
          </div>
          <Copy k="Pool" v={config.address} />
          {p && <Copy k="Weight index" v={p.weightIndex} />}
          {p && <Copy k="Creator" v={p.authority} />}
          <Copy k="Program" v={PROGRAM_ID.toBase58()} />
        </Col>

        <Col label="Pull it yourself">
          <pre
            className="figure scroll-quiet m-0 overflow-x-auto rounded-[3px] p-3 text-[10px] leading-[1.8]"
            style={{ background: "var(--well)", border: "1px solid var(--hairline)", color: "var(--muted)" }}
          >
{`const pool = await readPool(addr)
const req  = await requestPull(w, addr, pool, cap)
const done = await waitForDraw(req.request, addr)
const [c]  = await drawnCards(addr, done.requestId)
await resolve(w, addr, pool, done, c, meta, "keep")`}
          </pre>
          <p className="m-0 mt-3 text-[12px] leading-[1.65]" style={{ color: "var(--muted)" }}>
            That is the whole integration, in <code className="figure text-[11px]">lib/gacha</code>. No API key: the
            wallet signs and the program settles.{" "}
            <a href="https://www.opengacha.io/docs" className="underline underline-offset-2" target="_blank" rel="noreferrer">
              Protocol docs
            </a>
          </p>
        </Col>
      </div>
    </section>
  );
}

function Col({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-6 py-5 sm:px-8">
      <span className="label mb-2">{label}</span>
      {children}
    </div>
  );
}

function Row({ k, v, hint, lead }: { k: string; v: string; hint?: string; lead?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[5px] text-[12.5px]" title={hint}>
      <span style={{ color: "var(--muted)" }}>{k}</span>
      <span className="figure text-right text-[12.5px]" style={{ color: lead ? "var(--accent-lit)" : "var(--text)" }}>
        {v}
      </span>
    </div>
  );
}

function Copy({ k, v }: { k: string; v: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(v).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1000);
      }}
      className="flex w-full items-baseline justify-between gap-3 py-[5px] text-left text-[12.5px] transition-colors hover:text-[var(--accent-lit)]"
      title={v}
    >
      <span style={{ color: "var(--muted)" }}>{k}</span>
      <span className="figure" style={{ color: done ? "var(--accent-lit)" : "inherit" }}>
        {done ? "Copied" : short(v)}
      </span>
    </button>
  );
}
