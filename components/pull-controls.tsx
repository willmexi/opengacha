"use client";

/**
 * The control shelf: the pull, a free demo of the same animation, and one
 * line saying what signing costs and what protects it. Both screens use
 * it; only what happens above the shelf differs.
 */

import type { Play } from "@/lib/play";

export function PullControls({ play, onDemo }: { play: Play; onDemo: () => void }) {
  const { snapshot, stage } = play;
  const price = snapshot?.pool.priceSol ?? "…";
  const wallet = play.wallet?.toBase58();
  const paused = snapshot?.pool.acquisitionsPaused;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void play.pull(1)}
          disabled={stage === "signing" || !snapshot || paused}
          className="btn-solid px-5 py-3 text-[11px] leading-none"
        >
          {paused ? "Pulls are paused" : stage === "signing" ? "Confirm in your wallet" : `Pull · ${price} SOL`}
        </button>
        <button onClick={onDemo} disabled={!snapshot} className="btn-ghost px-5 py-3 text-[11px] leading-none">
          Free demo
        </button>

        <p className="m-0 ml-auto max-w-[38ch] text-[11.5px] leading-[1.55]" style={{ color: "var(--muted)" }}>
          {wallet ? (
            <>
              Paying from <span className="figure">{wallet.slice(0, 4)}…{wallet.slice(-4)}</span>.{" "}
            </>
          ) : (
            "Your wallet connects on the first pull. "
          )}
          One signature, capped at the quote
          {snapshot ? ` +${(snapshot.pool.slippageBps / 100).toFixed(1)}%` : ""}.
        </p>
      </div>

      {play.error && (
        <p className="m-0 text-[12.5px] leading-[1.6]" style={{ color: "var(--accent)" }}>
          {play.error}
        </p>
      )}

      {play.openPulls.length > 0 && stage === "idle" && (
        <button
          onClick={() => void play.resume(play.openPulls[0])}
          className="self-start text-[12.5px] underline underline-offset-2"
          style={{ color: "var(--accent)" }}
        >
          {play.openPulls.length} pull{play.openPulls.length > 1 ? "s" : ""} here still need settling. Open{" "}
          {play.openPulls.length > 1 ? "the first" : "it"}
        </button>
      )}
    </div>
  );
}
