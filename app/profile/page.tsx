"use client";

/**
 * User profile: everything you hold across every pool this storefront sells.
 *
 *   Overview   the four figures, and any pull still waiting on a decision
 *   Positions  every card you have in a pool, what it earned, and the way out
 *   Deposit    a pool that takes deposits, a card from your wallet, a backing
 *
 * This is the depositor's side of the shop, not a pool's console — a pool's
 * own revenue belongs to its creator, on opengacha.io. Own-stock pools show
 * up here like any other, and in Deposit only for the creator who runs them.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { sol } from "@/lib/gacha/price";
import { SectionRule } from "@/components/section-rule";
import { friendlyConnect } from "@/components/wallet-chip";
import { DepositPanel } from "@/components/deposit-panel";
import { PositionsPanel } from "@/components/positions-panel";
import { useHub, type Hub } from "@/lib/profile";

type Tab = "overview" | "positions" | "deposit";

/* What is behind the connect button, said before anyone clicks it. */
const WHAT = [
  [
    "Pulls waiting on you",
    "Every pull you make stays here until you keep the card, take the buyback or relist it — so a draw is never lost because you closed the tab.",
  ],
  [
    "Cards you hold in pools",
    "What each one is backed by, what it has earned from pulls so far, and the two ways out: claim the earnings, or withdraw the card itself.",
  ],
  [
    "Deposits",
    "Put a card from your wallet into a pool that takes them, at a backing you choose. It earns a share of every pull while it sits in the draw.",
  ],
] as const;

export default function ProfileScreen() {
  return (
    <Suspense>
      <ProfileHub />
    </Suspense>
  );
}

function ProfileHub() {
  const hub = useHub();
  const params = useSearchParams();
  const wanted = params.get("tab");
  const [tab, setTab] = useState<Tab>(wanted === "positions" || wanted === "deposit" ? wanted : "overview");
  const [connectError, setConnectError] = useState<string | null>(null);
  const w = hub.wallet?.toBase58();

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6">
      <main className="frame flex min-h-[calc(100vh-var(--nav-h))] flex-col">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 px-6 py-7 sm:px-8" style={{ borderBottom: "1px dashed var(--line)" }}>
        <div>
          <span className="label">{w ? "User profile" : "Not connected"}</span>
          <h1 className="heading m-0 mt-2 text-[24px] leading-none">{w ? `${w.slice(0, 6)}…${w.slice(-6)}` : "Your profile"}</h1>
          {w && (
            <p className="figure m-0 mt-1.5 text-[13px]" style={{ color: "var(--muted)" }}>
              {w}
            </p>
          )}
          <p className="m-0 mt-2.5 max-w-[70ch] text-[13.5px] leading-[1.6]" style={{ color: "var(--muted)" }}>
            Cards you deposited earn a share of every pull&apos;s fee while they sit in the draw. That share is yours to
            claim, and the cards are yours to take back whenever they are not mid-settle.
          </p>
        </div>
      </header>

      {!hub.wallet ? (
        <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-stretch">
          <section className="order-2 lg:order-1" style={{ borderRight: "1px solid var(--hairline)" }}>
            <div className="px-6 py-3.5 sm:px-8" style={{ borderBottom: "1px solid var(--hairline)", background: "var(--cell)" }}>
              <span className="label">What this page does</span>
            </div>
            <ul className="rows m-0 list-none p-0">
              {WHAT.map(([t, d]) => (
                <li key={t} className="px-5 py-4">
                  <p className="heading m-0 text-[13px]">{t}</p>
                  <p className="m-0 mt-1.5 max-w-[70ch] text-[13px] leading-[1.6]" style={{ color: "var(--muted)" }}>
                    {d}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="order-1 flex flex-col items-center gap-4 px-6 py-12 text-center lg:order-2" style={{ background: "var(--well)" }}>
            <span className="label relative">No wallet connected</span>
            <p className="relative m-0 max-w-[34ch] text-[13.5px] leading-[1.65]" style={{ color: "var(--muted)" }}>
              Connecting only reads your address. Nothing moves until you sign for it.
            </p>
            <button
              onClick={() => {
                setConnectError(null);
                void hub.connect().catch((e) => setConnectError(friendlyConnect(e)));
              }}
              className="btn-solid relative px-5 py-3 text-[11px] leading-none"
            >
              Connect wallet
            </button>
            {connectError && (
              <p className="m-0 max-w-[380px] text-[12px] leading-[1.6]" style={{ color: "var(--accent-lit)" }}>
                {connectError}
              </p>
            )}
          </section>
        </div>
      ) : (
        <>
          <div className="cells sm:grid-cols-2 lg:grid-cols-4" style={{ borderInline: "none", borderTop: "none" }}>
            <Figure k="Cards in pools" v={hub.loading ? "…" : String(hub.totals.cards)} />
            <Figure k="Backing out" v={hub.loading ? "…" : `${sol(hub.totals.backingLamports, 2)} SOL`} />
            <Figure k="Earned, unclaimed" v={hub.loading ? "…" : `${sol(hub.totals.earnedLamports, 4)} SOL`} lead />
            <Figure k="Pulls to settle" v={hub.loading ? "…" : String(hub.totals.openPulls)} />
          </div>

          <div>
            <div className="flex" style={{ borderBottom: "1px solid var(--hairline)", background: "var(--cell)" }}>
              {(
                [
                  ["overview", "Overview"],
                  ["positions", `Positions · ${hub.totals.cards}`],
                  ["deposit", "Deposit"],
                ] as [Tab, string][]
              ).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  aria-pressed={tab === t}
                  className="label relative px-5 py-3.5 transition-colors"
                  style={{
                    color: tab === t ? "var(--text)" : "var(--faint)",
                    background: tab === t ? "var(--bg)" : "transparent",
                    borderRight: "1px solid var(--hairline)",
                  }}
                >
                  {label}
                  {tab === t && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px]" style={{ background: "var(--accent)" }} />}
                </button>
              ))}
            </div>
            {tab === "overview" && <Overview hub={hub} />}
            {tab === "positions" && <PositionsPanel hub={hub} />}
            {tab === "deposit" && <DepositPanel hub={hub} />}
          </div>
        </>
      )}

      {(hub.error || hub.lastSignature) && (
        <div className="px-6 py-3.5 text-[12.5px] sm:px-8" style={{ borderTop: "1px solid var(--hairline)" }}>
          {hub.error ? (
            <p className="m-0" style={{ color: "var(--accent-lit)" }}>
              {hub.error}
            </p>
          ) : (
            <a
              href={`https://solscan.io/tx/${hub.lastSignature}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
              style={{ color: "var(--muted)" }}
            >
              Done · view the transaction
            </a>
          )}
        </div>
      )}
      </main>
    </div>
  );
}

function Figure({ k, v, lead }: { k: string; v: string; lead?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 px-6 py-4 sm:px-8">
      <span className="label">{k}</span>
      <span className="figure text-[19px] leading-none" style={{ color: lead ? "var(--accent-lit)" : "var(--text)" }}>
        {v}
      </span>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <SectionRule label={label} />
      <div className="px-6 py-5 sm:px-8">{children}</div>
    </section>
  );
}

const empty = "m-0 text-[13px] leading-[1.65]";

// ---------------------------------------------------------------- overview

function Overview({ hub }: { hub: Hub }) {
  const open = hub.pools.flatMap((v) => v.openPulls.map((r) => ({ view: v, r })));
  return (
    <>
      <Section label="Pulls waiting on you">
        {open.length === 0 ? (
          <p className={empty} style={{ color: "var(--muted)" }}>
            Nothing waiting. Every pull you make lands here until you keep it, take the buyback, or relist it.
          </p>
        ) : (
          <ul className="rows m-0 list-none p-0">
            {open.map(({ view, r }) => (
              <li key={r.address} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13px]">
                <span>
                  <span className="font-medium">{view.config.name}</span>
                  <span className="figure"> · #{r.requestId}</span> · paid{" "}
                  <span className="figure">{sol(r.pricePaidLamports)} SOL</span> ·{" "}
                  <span style={{ color: "var(--muted)" }}>
                    {r.fulfilled
                      ? "drawn, waiting for your choice"
                      : r.randomnessReady
                        ? "drawn, being fulfilled"
                        : "waiting for the draw"}
                  </span>
                </span>
                <Link href={`/packs?pool=${view.config.slug}`} className="btn-solid px-4 py-2.5 text-[10.5px]">
                  Settle it
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label="Pools on this site">
        <ul className="rows m-0 list-none p-0">
          {hub.pools.map((v) => {
            const mine = v.positions.filter((p) => p.status !== "closed");
            return (
              <li key={v.config.slug} className="flex flex-wrap items-center gap-4 py-3">
                <img src={v.config.art} alt="" className="h-11 w-9 shrink-0 object-contain" draggable={false} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{v.config.name}</span>
                  <span className="label">
                    {v.pool.ownStock ? "Own stock" : "Open deposits"} · {sol(v.pool.priceLamports)} SOL a pull ·{" "}
                    {v.pool.activePositions} cards · {mine.length ? `you hold ${mine.length}` : "you hold none"}
                  </span>
                </span>
                <Link href={`/packs?pool=${v.config.slug}`} className="btn-ghost px-4 py-2.5 text-[10.5px]">
                  Pull
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

// --------------------------------------------------------------- positions
// The Positions tab lives in components/positions-panel.tsx: rows with
// claim and withdraw, multi-select for both.

// ----------------------------------------------------------------- deposit
// The Deposit tab lives in components/deposit-panel.tsx: picker, slip,
// Low / Worth / High chips, one batch send.

