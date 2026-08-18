"use client";

/**
 * The reel: a strip of the pool's cards that spins and lands dead centre
 * on the one you drew.
 *
 * A faithful, simplified port of nfw.fun's Spinner. The physics are the
 * point and are kept intact; only the dressing is this storefront's. The
 * mechanics that make it feel right:
 *
 *  - rAF against an inline transform, never a CSS animation: the reel must
 *    hand off from constant speed to a deceleration at a moment it cannot
 *    know in advance (when the chain answers).
 *  - Speed is pinned to the WINDOW (screens/second), stride to the card, so
 *    it feels the same at every size.
 *  - Landing = quartic run-out to an overshoot, then a cubic settle back
 *    onto the mark, always ending a whole number of strides past `phase` so
 *    a card rests exactly under the centre line.
 *  - Measure with getComputedStyle().width — fractional and unscaled.
 *    offsetWidth rounds (~0.4px/stride drift) and gBCR sees transforms.
 *
 * Reduced motion is honoured without removing the draw: the strip does not
 * travel, and the moment the result is known the winning tile is simply
 * marked. The reel is how this screen says which card you drew, so it still
 * says it — it just stops moving to do so.
 */

import { useEffect, useRef, useState } from "react";

const TILES = 16;
const GAP = 0.06;
const SPEED_SCREENS_PER_SEC = 2.74;
const LAND_MS = 6500;
const LAND_TRAVEL = 16;
const SETTLE_AT = 0.93;
const OVERSHOOT = 0.12;
const SETTLE_HOLD_MS = 380;

export function Spinner({
  spinning,
  landing,
  onLanded,
  faces = [],
  winner = null,
}: {
  /** False: the reel stands still. True: full speed, the pull is in flight. */
  spinning: boolean;
  /** Flip true when the result is known; the reel decelerates and lands. */
  landing: boolean;
  onLanded: () => void;
  /** Card art to fill the tiles with while spinning (the pool's cards). */
  faces?: (string | null)[];
  /** The drawn card's art; the tile that lands under the mark shows it. */
  winner?: string | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const spinningRef = useRef(spinning);
  const landingRef = useRef(landing);
  const onLandedRef = useRef(onLanded);
  spinningRef.current = spinning;
  landingRef.current = landing;
  onLandedRef.current = onLanded;
  const [stopped, setStopped] = useState(false);
  // Which tile ends under the mark is decided the moment the reel starts
  // braking (it depends on where it is then). That tile is dressed as the
  // winner while it is still a blur, so nothing visibly swaps.
  const [winnerTile, setWinnerTile] = useState<number | null>(null);

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const box = boxRef.current!;
    const track = trackRef.current!;
    let offset = 0;
    let last = 0;
    let decelerating = false;
    let startedAt = 0;
    let from = 0;
    let to = 0;
    let raf = 0;
    let handoff = 0;

    /** Park a tile exactly under the mark, by the same phase maths the
        landing uses, and mark it. Used only when motion is reduced. */
    const park = () => {
      const { s: stride, phase } = metrics();
      const k = Math.floor(TILES / 2);
      track.style.transform = `translate3d(${-(phase + k * stride)}px, 0, 0)`;
      setWinnerTile(k % TILES);
      setStopped(true);
      handoff = window.setTimeout(() => onLandedRef.current(), SETTLE_HOLD_MS);
    };

    const metrics = () => {
      const first = track.firstElementChild as HTMLElement | null;
      const cw = first ? parseFloat(getComputedStyle(first).width) || 1 : 1;
      const boxW = parseFloat(getComputedStyle(box).width) || box.clientWidth;
      return { boxW, s: cw * (1 + GAP) || 1, phase: cw / 2 - boxW / 2 };
    };

    // Reduced motion: nothing travels. Wait for the result, then park on it.
    if (still) {
      let wait = 0;
      if (landingRef.current) park();
      else
        wait = window.setInterval(() => {
          if (!landingRef.current) return;
          window.clearInterval(wait);
          park();
        }, 120);
      return () => {
        window.clearInterval(wait);
        window.clearTimeout(handoff);
      };
    }

    const frame = (t: number) => {
      const { s, phase, boxW } = metrics();
      const dt = last === 0 ? 0 : Math.min(0.05, (t - last) / 1000);
      last = t;
      let done = false;

      if (!decelerating) {
        if (spinningRef.current) offset += SPEED_SCREENS_PER_SEC * boxW * dt;
        if (landingRef.current) {
          decelerating = true;
          startedAt = t;
          from = offset;
          const strides = Math.ceil((offset + LAND_TRAVEL * s - phase) / s);
          to = phase + strides * s;
          setWinnerTile(((strides % TILES) + TILES) % TILES);
        }
      } else {
        const p = Math.min(1, (t - startedAt) / LAND_MS);
        const peak = to + OVERSHOOT * s;
        if (p < SETTLE_AT) {
          const q = p / SETTLE_AT;
          offset = from + (peak - from) * (1 - Math.pow(1 - q, 4));
        } else {
          const q = (p - SETTLE_AT) / (1 - SETTLE_AT);
          offset = peak + (to - peak) * (1 - Math.pow(1 - q, 3));
        }
        done = p >= 1;
      }

      // Wrap by whole strides: preserves offset mod s (the landing target
      // stays valid) and is invisible — every tile shows the same back.
      const wrapped = offset % (s * TILES);
      track.style.transform = `translate3d(${-wrapped}px, 0, 0)`;

      if (done) {
        setStopped(true);
        handoff = window.setTimeout(() => onLandedRef.current(), SETTLE_HOLD_MS);
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(handoff);
    };
    // Built once, never rebuilt: restarting the loop would reset the reel.
  }, []);

  return (
    <div
      ref={boxRef}
      className="relative flex h-[clamp(340px,50vh,480px)] w-full items-center overflow-hidden"
      style={{
        maskImage: "linear-gradient(90deg, transparent, #000 13%, #000 87%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 13%, #000 87%, transparent)",
      }}
    >
      <div
        ref={trackRef}
        className="flex shrink-0 items-center will-change-transform"
        style={{ gap: `calc(var(--cw) * ${GAP})` }}
      >
        {Array.from({ length: TILES * 2 }, (_, i) => {
          const tile = i % TILES;
          const face =
            winnerTile !== null && tile === winnerTile && winner
              ? winner
              : faces.length
                ? faces[tile % faces.length]
                : null;
          return <CardTile key={i} face={face} lit={stopped && tile === winnerTile} />;
        })}
      </div>
      {/* The centre mark — what turns a moving strip into a draw. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2"
        style={{ opacity: stopped ? 0 : 1, transition: "opacity var(--dur) var(--ease)" }}
      >
        <span
          className="absolute inset-y-6 left-1/2 w-px -translate-x-1/2"
          style={{ background: "linear-gradient(to bottom, transparent, var(--accent) 16%, var(--accent) 84%, transparent)" }}
        />
        <span className="absolute top-3 left-1/2 -translate-x-1/2" style={{ borderInline: "5px solid transparent", borderTop: "6px solid var(--accent)" }} />
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2" style={{ borderInline: "5px solid transparent", borderBottom: "6px solid var(--accent)" }} />
      </div>
    </div>
  );
}

/** One tile: a card face when we have art, a card back otherwise. */
function CardTile({ face, lit }: { face: string | null; lit: boolean }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden"
      style={{
        width: "var(--cw)",
        aspectRatio: "320.953 / 444",
        borderRadius: 8,
        border: `1px solid ${lit ? "var(--accent)" : "rgba(255,255,255,.12)"}`,
        backgroundColor: "var(--cell)",
        filter: lit
          ? "drop-shadow(0 0 40px color-mix(in srgb, var(--accent) 55%, transparent))"
          : "drop-shadow(0 22px 34px rgba(0,0,0,.5))",
        transition: "filter var(--dur-slow) var(--ease), border-color var(--dur-slow) var(--ease)",
      }}
    >
      {face ? (
        <img src={face} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span className="figure text-[26px]" style={{ color: "var(--muted)" }}>
          ?
        </span>
      )}
    </div>
  );
}
