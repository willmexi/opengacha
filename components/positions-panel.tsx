"use client";

/**
 * The Positions tab of the user profile: every card the wallet holds in
 * any pool here, what it earned, and the two things a depositor does with
 * them: claim (the earnings, the card stays) and withdraw (card, backing
 * and earnings back to the wallet).
 *
 * One at a time from the row, or many at once: tick rows, then Claim
 * selected (packed ten to a transaction per pool, so one prompt pays out
 * ten cards) or Withdraw selected (one prompt per card, in order, since
 * each moves an NFT). A meter shows the batch landing and every row
 * reports its own outcome.
 */

import { useState } from "react";

import { sol } from "@/lib/gacha/price";
import type { MyPosition } from "@/lib/gacha";
import type { Hub, PoolView, ActionOutcome } from "@/lib/profile";

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

type Row = { view: PoolView; p: MyPosition };

export function PositionsPanel({ hub }: { hub: Hub }) {
  const rows: Row[] = hub.pools.flatMap((v) => v.positions.filter((p) => p.status !== "closed").map((p) => ({ view: v, p })));
  const [sel, setSel] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [results, setResults] = useState<ActionOutcome[] | null>(null);
  const batchBusy = hub.busy === "claim:batch" || hub.busy === "withdraw:batch";

  if (hub.loading && rows.length === 0) {
    return (
      <p className="m-0 px-5 py-8 text-[13px]" style={{ color: "var(--muted)", animation: "breathe 1.4s infinite" }}>
        Reading the chain…
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="m-0 px-5 py-8 text-[13px] leading-[1.65]" style={{ color: "var(--muted)" }}>
        You hold no cards in any pool here. Deposit into a pool that takes deposits and your card earns from every pull
        while it sits in the draw.
      </p>
    );
  }

  const present = new Set(rows.map((r) => r.p.address));
  const chosen = rows.filter((r) => sel.includes(r.p.address));
  const claimable = chosen.filter((r) => r.p.earnedLamports > 0n);
  const withdrawable = chosen.filter((r) => r.p.status !== "pending");
  const claimTotal = claimable.reduce((a, r) => a + r.p.earnedLamports, 0n);
  const toggle = (address: string) => {
    if (batchBusy) return;
    setResults(null);
    setSel((s) => (s.includes(address) ? s.filter((a) => a !== address) : [...s, address]));
  };
  const allOn = rows.length > 0 && rows.every((r) => sel.includes(r.p.address));

  const runBatch = async (label: "Claiming" | "Withdrawing", items: Row[]) => {
    if (items.length === 0 || batchBusy) return;
    setResults(null);
    setProgress({ label, done: 0, total: items.length });
    const payload = items.map((r) => ({ view: r.view, position: r.p }));
    const out =
      label === "Claiming"
        ? await hub.claimMany(payload, (done, total) => setProgress({ label, done, total }))
        : await hub.withdrawMany(payload, (done, total) => setProgress({ label, done, total }));
    setResults(out);
    // What went through leaves the selection; what failed stays ticked.
    const failed = new Set(out.filter((o) => o.error).map((o) => o.address));
    setSel((s) => s.filter((a) => failed.has(a) && present.has(a)));
  };

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-3 px-6 py-3 sm:px-8"
        style={{ borderBottom: "1px solid var(--hairline)", background: "var(--cell)" }}
      >
        <button
          onClick={() => {
            if (batchBusy) return;
            setResults(null);
            setSel(allOn ? [] : rows.map((r) => r.p.address));
          }}
          className="btn-ghost px-3 py-1.5 text-[10.5px]"
        >
          {allOn ? "Select none" : "Select all"}
        </button>
        <span className="label">{sel.length === 0 ? "Tick cards to claim or withdraw together" : `${sel.length} selected`}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => void runBatch("Claiming", claimable)}
            disabled={batchBusy || hub.busy !== null || claimable.length === 0}
            className="btn-ghost px-4 py-2.5 text-[10.5px] disabled:opacity-40"
            title="Take what the ticked cards have earned; the cards stay in their pools. Ten claims share one wallet prompt."
          >
            {hub.busy === "claim:batch"
              ? "Claiming…"
              : `Claim selected${claimable.length ? ` · ${claimable.length} · ${sol(claimTotal, 4)} SOL` : ""}`}
          </button>
          <button
            onClick={() => void runBatch("Withdrawing", withdrawable)}
            disabled={batchBusy || hub.busy !== null || withdrawable.length === 0}
            className="btn-solid px-4 py-2.5 text-[10.5px] disabled:opacity-40"
            title="Take the ticked cards, their backing and their earnings back to your wallet. One wallet prompt per card."
          >
            {hub.busy === "withdraw:batch" ? "Withdrawing…" : `Withdraw selected${withdrawable.length ? ` · ${withdrawable.length}` : ""}`}
          </button>
        </div>
        {chosen.length > 0 && (claimable.length < chosen.length || withdrawable.length < chosen.length) && (
          <p className="m-0 w-full text-[12px]" style={{ color: "var(--faint)" }}>
            {claimable.length < chosen.length && `${chosen.length - claimable.length} of the ticked cards have nothing to claim yet. `}
            {withdrawable.length < chosen.length && `${chosen.length - withdrawable.length} of the ticked cards are drawn and waiting on a winner, so they cannot be withdrawn now.`}
          </p>
        )}
        {progress && (batchBusy || results) && (
          <div className="w-full">
            <p className="m-0 mb-1.5 flex items-baseline justify-between text-[12px]" style={{ color: "var(--muted)" }}>
              <span>{batchBusy ? `${progress.label}: approve each transaction in your wallet…` : "Done"}</span>
              <span className="tabular-nums">
                {progress.done}/{progress.total} processed
              </span>
            </p>
            <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--well)" }}>
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%`,
                  background: "var(--accent)",
                }}
              />
            </div>
            {results && (
              <p className="m-0 mt-1.5 text-[12px]" style={{ color: "var(--muted)" }}>
                {results.filter((r) => r.signature).length} done
                {results.some((r) => r.error) && (
                  <span style={{ color: "var(--accent-lit)" }}> · {results.filter((r) => r.error).length} not sent, see the rows</span>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      <ul className="rows m-0 list-none p-0">
        {rows.map((r) => (
          <PositionRow
            key={r.p.address}
            view={r.view}
            p={r.p}
            hub={hub}
            on={sel.includes(r.p.address)}
            onToggle={() => toggle(r.p.address)}
            outcome={results?.find((o) => o.address === r.p.address) ?? null}
            batchBusy={batchBusy}
          />
        ))}
      </ul>
    </>
  );
}

function PositionRow({
  view,
  p,
  hub,
  on,
  onToggle,
  outcome,
  batchBusy,
}: {
  view: PoolView;
  p: MyPosition;
  hub: Hub;
  on: boolean;
  onToggle: () => void;
  outcome: ActionOutcome | null;
  batchBusy: boolean;
}) {
  const withdrawing = hub.busy === `withdraw:${p.address}`;
  const claiming = hub.busy === `claim:${p.address}`;
  const status =
    p.status === "active"
      ? "In the draw"
      : p.status === "staged"
        ? "Staged: joins the draw once the queue clears"
        : "Drawn: its winner is deciding";
  return (
    <li
      className="flex flex-wrap items-center gap-4 px-6 py-3.5 sm:px-8"
      style={{
        backgroundColor: on ? "color-mix(in srgb, var(--accent) 6%, transparent)" : undefined,
        borderLeft: `2px solid ${outcome?.error ? "var(--accent-lit)" : outcome?.signature ? "var(--accent)" : "transparent"}`,
      }}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={onToggle}
        disabled={batchBusy}
        aria-label={`Select ${view.config.name} #${p.positionId}`}
        className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">
          {view.config.name} <span className="figure text-[12px]">#{p.positionId} · {short(p.mint)}</span>
        </span>
        <span className="label" style={{ color: outcome?.error ? "var(--accent-lit)" : outcome?.signature ? "var(--accent)" : undefined }}>
          {outcome?.error
            ? outcome.error
            : outcome?.signature
              ? "Done"
              : `${status} · backed ${sol(p.backingLamports)} SOL · earned ${sol(p.earnedLamports, 4)} SOL`}
        </span>
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => void hub.claim(view, p)}
          disabled={hub.busy !== null || p.earnedLamports === 0n}
          className="btn-ghost px-4 py-2.5 text-[10.5px] disabled:opacity-40"
          title="Take what this card has earned from pulls; the card stays in the pool"
        >
          {claiming ? "Confirm…" : "Claim"}
        </button>
        <button
          onClick={() => void hub.withdraw(view, p)}
          disabled={hub.busy !== null || p.status === "pending"}
          className="btn-solid px-4 py-2.5 text-[10.5px] disabled:opacity-40"
          title="Take the card, its backing and its earnings back to your wallet"
        >
          {withdrawing ? "Confirm…" : "Withdraw"}
        </button>
      </div>
    </li>
  );
}
