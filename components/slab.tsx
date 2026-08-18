"use client";

/**
 * A drawn card, shown the way the protocol shows one: the art itself,
 * hairlined and lifted off the page, with the facts under it in mono —
 * class and odds on the left, what it is backed by on the right, the
 * position id as the line that identifies this copy.
 *
 * Nothing here depends on an animation having run: a card that only
 * appears once its keyframes advance is a card that disappears on a
 * throttled tab. `sealing` adds the one flourish, a light sweeping the
 * art as the draw lands.
 */

export interface RevealCard {
  name: string;
  grade: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  /** What the card is backed by, in SOL: what it is worth to the pool. */
  priceSol: string;
  image: string | null;
}

export const BAND: Record<RevealCard["rarity"], string> = {
  common: "var(--common)",
  uncommon: "var(--uncommon)",
  rare: "var(--rare)",
  epic: "var(--epic)",
  legendary: "var(--legendary)",
};

export function Slab({
  card,
  cert,
  odds,
  sealing = false,
  width = 320,
  className = "",
}: {
  card: RevealCard;
  /** The line that identifies this copy: a position id, usually. */
  cert?: string;
  odds?: string;
  sealing?: boolean;
  width?: number;
  className?: string;
}) {
  const band = BAND[card.rarity];
  return (
    <figure className={`m-0 flex flex-col gap-3 ${className}`} style={{ width, maxWidth: "100%" }}>
      <div
        className="relative overflow-hidden"
        style={{
          aspectRatio: "320 / 444",
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          background: "var(--surface)",
        }}
      >
        {card.image ? (
          <img
            src={card.image}
            alt={card.name}
            className="h-full w-full object-contain"
            draggable={false}
            style={{ filter: `drop-shadow(0 18px 34px rgba(0,0,0,.5)) drop-shadow(0 0 30px ${band}33)` }}
          />
        ) : (
          <span className="flex h-full items-center justify-center px-4 text-center text-[15px] font-medium">
            {card.name}
          </span>
        )}
        {sealing && <span aria-hidden className="card-sweep anim" />}
      </div>

      <figcaption className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[13px] font-medium" title={card.name}>
            {card.name}
          </span>
          {card.grade !== "—" && (
            <span className="label shrink-0" style={{ color: "var(--text)" }}>
              Grade {card.grade}
            </span>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="label" style={{ color: band }}>
            {card.rarity}
            {odds ? ` · ${odds}` : ""}
          </span>
          <span className="figure text-[13px]">{card.priceSol} SOL</span>
        </div>
        {cert && <span className="label">{cert}</span>}
      </figcaption>
    </figure>
  );
}
