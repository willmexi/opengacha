"use client";

/**
 * The rip, and the cert being printed.
 *
 * The pack floats until you pull, then rattles while the draw is in flight
 * — it holds there honestly, because at that moment the card genuinely is
 * not known yet. When it lands, the label prints one line at a time (the
 * class, the grade if the card carries one, the name), and then the card
 * itself is sealed behind that label.
 *
 * A stage machine over timers, not CSS animation state: what is on screen
 * never depends on an animation having been allowed to run.
 */

import { useEffect, useMemo, useState } from "react";

import { BAND, Slab, type RevealCard } from "@/components/slab";

export type { RevealCard };

const PRINT_MS = 950;
const HOLD_MS = 1500;

export function PackRip({
  packArt,
  packName,
  ripping,
  card,
  cert,
  odds,
  onDone,
}: {
  packArt: string;
  packName: string;
  /** Flip true once the pull transaction is in: the rip plays. */
  ripping: boolean;
  /** Null while the draw is still in flight; the rip waits for it. */
  card: RevealCard | null;
  cert?: string;
  odds?: string;
  /** Called after the card has been seen; the exit choice takes over. */
  onDone: () => void;
}) {
  // The rungs are the label's own lines, in the order they are printed.
  const rungs = useMemo(() => {
    if (!card) return [];
    const out: [string, string, string][] = [["Class", card.rarity, BAND[card.rarity]]];
    if (card.grade !== "—") out.push(["Grade", card.grade, "var(--text)"]);
    out.push(["Card", card.name, "var(--text)"]);
    return out;
  }, [card]);

  // -1 while the pack is still shut; then one step per line; then the card.
  const [step, setStep] = useState(-1);

  useEffect(() => {
    if (!ripping) setStep(-1);
  }, [ripping]);

  useEffect(() => {
    if (!ripping || !card) return;
    if (step >= rungs.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), step < 0 ? 700 : PRINT_MS);
    return () => clearTimeout(t);
  }, [ripping, card, step, rungs.length]);

  useEffect(() => {
    if (!ripping || !card || step < rungs.length) return;
    const t = setTimeout(onDone, HOLD_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ripping, card, step, rungs.length]);

  const sealed = card && step >= rungs.length;

  return (
    <div className="flex min-h-[420px] w-full flex-col items-center justify-center gap-6">
      {(!ripping || (ripping && !card)) && (
        <div className="flex flex-col items-center gap-5">
          <img
            src={packArt}
            alt={`${packName}, sealed`}
            className="anim h-[clamp(240px,38vh,410px)] object-contain"
            draggable={false}
            style={{
              animation: ripping ? "rattle .42s ease-in-out infinite" : "hover-float 7s ease-in-out infinite",
              filter: ripping
                ? "drop-shadow(0 0 60px rgba(229,0,109,.5)) brightness(1.08)"
                : "drop-shadow(0 30px 55px rgba(0,0,0,.6))",
            }}
          />
          <p className="label m-0" style={ripping ? { color: "var(--accent)", animation: "breathe 1.2s infinite" } : undefined}>
            {ripping ? "Waiting for the draw" : "Sealed"}
          </p>
        </div>
      )}

      {/* The label, printing. Each line stays once it has landed. */}
      {ripping && card && !sealed && (
        <div className="panel w-[min(380px,92%)] px-5 py-4">
          <span className="label">Reading the draw</span>
          <dl className="m-0 mt-2.5 flex flex-col gap-2.5">
            {rungs.map(([k, v, colour], i) => (
              <div key={k} className="flex items-baseline justify-between gap-4" style={{ visibility: i <= step ? "visible" : "hidden" }}>
                <dt className="label shrink-0">{k}</dt>
                <dd
                  className="anim m-0 truncate text-right text-[17px] leading-none font-medium tracking-[-0.02em]"
                  style={{ color: colour, animation: i === step ? "stamp .42s var(--ease) both" : undefined }}
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {sealed && card && <Slab card={card} cert={cert} odds={odds} sealing width={360} />}
    </div>
  );
}
