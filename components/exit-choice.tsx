"use client";

/**
 * After the draw: what the winner may do with the card.
 *
 * Every pool allows two exits — keep it, and the NFT moves to your wallet;
 * or take the buyback, and the pool pays its bid rate while the card goes
 * back to whoever deposited it. A decentralised pool may allow a third:
 * keep it in the pool as its new depositor, at a backing you choose, and
 * earn from every pull until it is drawn again. Own-stock pools refuse
 * that by construction, so it is not drawn for them.
 *
 * The card itself is already sealed on the stage above, so this is the
 * decision and nothing else.
 */

import { useState } from "react";

import { sol } from "@/lib/gacha/price";
import type { DrawnCard, Settlement, Stage } from "@/lib/play";

const LAMPORTS = 1_000_000_000;

export function ExitChoice({
  card,
  stage,
  settlement,
  error,
  onKeep,
  onCashOut,
  onRelist,
  onAgain,
}: {
  card: DrawnCard;
  stage: Stage;
  settlement: Settlement | null;
  error: string | null;
  onKeep: () => void;
  onCashOut: () => void;
  onRelist: (backingLamports: bigint) => void;
  onAgain: () => void;
}) {
  const busy = stage === "settling";
  const done = stage === "settled" && settlement;
  const [relisting, setRelisting] = useState(false);
  const relist = card.relist;

  if (done) {
    return (
      <div className="panel flex w-full max-w-[560px] flex-col items-center gap-3 px-6 py-5 text-center">
        <span className="label">Settled</span>
        <p className="heading m-0 text-[16px] leading-[1.3]">
          {settlement.exit === "keep" && "Kept. The card is in your wallet."}
          {settlement.exit === "cashOut" &&
            `Bought back. ${sol(settlement.card.cashOutLamports)} SOL is in your wallet.`}
          {settlement.exit === "keepAndRelist" && "Relisted. It is your card in the pool now."}
        </p>
        {settlement.exit === "keepAndRelist" && (
          <p className="m-0 max-w-[46ch] text-[12.5px] leading-[1.6]" style={{ color: "var(--muted)" }}>
            It earns a share of every pull until someone draws it.
          </p>
        )}
        <div className="mt-1 flex items-center gap-3">
          <button onClick={onAgain} className="btn-solid px-6 py-3.5 text-[11.5px]">
            Pull again
          </button>
          <a
            href={`https://solscan.io/tx/${settlement.signature}`}
            target="_blank"
            rel="noreferrer"
            className="text-[12.5px] underline underline-offset-2"
            style={{ color: "var(--muted)" }}
          >
            View the transaction
          </a>
        </div>
      </div>
    );
  }

  if (relisting && relist) {
    return <RelistForm limits={relist} busy={busy} onBack={() => setRelisting(false)} onConfirm={onRelist} />;
  }

  return (
    <div className="panel w-full max-w-[560px] overflow-hidden">
      <div className="panel-head flex items-baseline justify-between gap-3 px-5 py-3">
        <span className="heading text-[13px]">Yours to decide</span>
        <span className="label">Position #{card.position.positionId}</span>
      </div>

      <div className="rows">
        <Choice
          title="Keep the card"
          body="The NFT moves to your wallet. It is yours, out of the pool."
          action={
            <button onClick={onKeep} disabled={busy} className="btn-solid px-5 py-3.5 text-[11.5px]">
              {busy ? "Confirm in your wallet" : "Keep"}
            </button>
          }
        />
        <Choice
          title="Take the buyback"
          body="The pool pays you now and the card goes back to its depositor."
          action={
            <button onClick={onCashOut} disabled={busy} className="btn-ghost px-5 py-3.5 text-[11.5px]">
              {sol(card.cashOutLamports)} SOL
            </button>
          }
        />
        {relist && (
          <Choice
            title="Keep it in the pool"
            body="It becomes your card in the draw, at a backing you set, earning a share of every pull until it is drawn again."
            action={
              <button
                onClick={() => setRelisting(true)}
                disabled={busy || !relist.affordable}
                className="btn-ghost px-5 py-3.5 text-[11.5px]"
                title={relist.affordable ? undefined : "Your balance does not cover the pool's minimum backing"}
              >
                Relist
              </button>
            }
          />
        )}
      </div>

      <p className="m-0 px-5 py-3 text-[11.5px] leading-[1.6]" style={{ borderTop: "1px solid var(--hairline)", color: "var(--faint)" }}>
        One signature either way. Nothing moves until you sign.
      </p>

      {error && (
        <p className="m-0 px-5 pb-4 text-[12.5px] leading-[1.6]" style={{ color: "var(--accent-lit)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function Choice({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="heading m-0 text-[13px]">{title}</p>
        <p className="m-0 mt-1 text-[12.5px] leading-[1.55]" style={{ color: "var(--muted)" }}>
          {body}
        </p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

/**
 * Relisting is a deposit, so it takes a deposit's one decision: the
 * backing. It sets the card's odds (inversely) and what the next winner's
 * buyback pays. The field starts empty on purpose — a pre-filled number
 * reads as a recommendation nobody made — with three stops to fill it,
 * clamped to what the pool and your balance allow.
 */
function RelistForm({
  limits,
  busy,
  onBack,
  onConfirm,
}: {
  limits: NonNullable<DrawnCard["relist"]>;
  busy: boolean;
  onBack: () => void;
  onConfirm: (backingLamports: bigint) => void;
}) {
  const [text, setText] = useState("");
  const min = Number(limits.minLamports) / LAMPORTS;
  const max = Number(limits.maxLamports) / LAMPORTS;
  const prev = Number(limits.previousBackingLamports) / LAMPORTS;
  const clamp = (v: number) => Math.round(Math.max(min, Math.min(max, v)) * 1000) / 1000;
  const stops = [
    { label: "Half", sol: clamp(prev / 2) },
    { label: "Same as before", sol: clamp(prev) },
    { label: "Double", sol: clamp(prev * 2) },
  ].filter((s, i, arr) => arr.findIndex((o) => o.sol === s.sol) === i);
  const value = Number(text);
  const valid = text !== "" && Number.isFinite(value) && value >= min && value <= max;

  return (
    <div className="panel w-full max-w-[560px] overflow-hidden">
      <div className="panel-head flex items-baseline justify-between gap-3 px-5 py-3">
        <span className="heading text-[13px]">Set your backing</span>
        <span className="label">
          {min.toFixed(3)} – {max.toFixed(3)} SOL
        </span>
      </div>

      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex items-center gap-2">
          <input
            id="relist-backing"
            inputMode="decimal"
            aria-label="New backing in SOL"
            placeholder={prev.toFixed(3)}
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
            className="figure min-w-0 flex-1 rounded-[3px] px-3.5 py-3 text-[15px] outline-none"
            style={{
              background: "var(--cell)",
              border: `1px solid ${text && !valid ? "var(--accent)" : "var(--line)"}`,
            }}
          />
          <span className="label shrink-0">SOL</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {stops.map((s) => (
            <button key={s.label} onClick={() => setText(String(s.sol))} className="btn-ghost px-3 py-2 text-[10.5px]">
              {s.label} · {s.sol}
            </button>
          ))}
        </div>

        <p className="m-0 text-[12px] leading-[1.6]" style={{ color: "var(--muted)" }}>
          Back it lower and it is drawn more often. Back it higher and the next winner&apos;s buyback pays more. Either
          way you earn the same share of every pull while it sits in the draw.
        </p>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => onConfirm(BigInt(Math.round(value * LAMPORTS)))}
            disabled={!valid || busy}
            className="btn-solid px-5 py-3.5 text-[11.5px]"
          >
            {busy ? "Confirm in your wallet" : `Relist at ${valid ? value : "…"} SOL`}
          </button>
          <button onClick={onBack} disabled={busy} className="btn-ghost px-4 py-3 text-[11px]">
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
