"use client";

/**
 * Screen two: the reel.
 *
 * The same chain flow as packs (usePlay) with a different show: the pool's
 * cards in a strip, still until you pull, at full speed while the draw is
 * in flight, braking onto the card you drew. The card it stops on is then
 * sealed and handed over for the same decision.
 *
 * "Free demo" spins and lands on a random card from the pool: no wallet,
 * no SOL.
 */

import { Suspense, useState } from "react";

import { BuilderPanel } from "@/components/builder-panel";
import { ExitChoice } from "@/components/exit-choice";
import { Storefront } from "@/components/frame";
import { PullControls } from "@/components/pull-controls";
import { SideTabs, type Tab } from "@/components/side-tabs";
import { Slab } from "@/components/slab";
import { Spinner } from "@/components/spinner";
import type { CardJson } from "@/lib/mirror";
import { usePlay } from "@/lib/play";
import { usePoolSlug } from "@/lib/use-pool-slug";
import { formatOdds, revealCard } from "@/lib/reveal";

export default function SpinnerScreen() {
  return (
    <Suspense>
      <ReelRoute />
    </Suspense>
  );
}

function ReelRoute() {
  const [slug, setSlug] = usePoolSlug();
  return <Reel key={slug} slug={slug} onPick={setSlug} />;
}

function Reel({ slug, onPick }: { slug: string; onPick: (s: string) => void }) {
  const play = usePlay(slug);
  const { config, snapshot, stage } = play;
  const [demo, setDemo] = useState<{ card: CardJson; landing: boolean } | null>(null);
  const [landed, setLanded] = useState(false);
  const [tab, setTab] = useState<Tab>("packs");

  const cards = snapshot?.cards ?? [];
  const faces = cards.filter((c) => c.status === "active").map((c) => c.image);
  const drawn = play.cards[0];

  const spinning = demo !== null || stage === "waiting" || stage === "drawn" || stage === "settling" || stage === "settled";
  const landing = demo ? demo.landing : stage !== "waiting" && drawn !== undefined;
  const winner = demo ? demo.card.image : (drawn?.meta.image ?? null);

  const startOver = () => {
    setDemo(null);
    setLanded(false);
    play.reset();
  };
  const runDemo = () => {
    const live = cards.filter((c) => c.status === "active");
    if (live.length === 0) return;
    setLanded(false);
    setDemo({ card: live[Math.floor(Math.random() * live.length)], landing: false });
    setTimeout(() => setDemo((d) => (d ? { ...d, landing: true } : d)), 2_500);
  };

  const landedCard = demo?.card ?? drawn?.meta ?? null;

  return (
    <Storefront
      config={config}
      snapshot={snapshot}
      error={play.error}
      aside={<SideTabs selected={slug} onSelect={onPick} snapshot={snapshot} locked={spinning} tab={tab} onTab={setTab} />}
      asideWide={tab === "inside"}
      sheet={<BuilderPanel config={config} snapshot={snapshot} />}
      stage={
        <>
          {/* Remounted after each landing so the next pull starts from a
              fresh, still strip rather than a stopped one. */}
          {!landed && (
            <div className="w-full [--cw:clamp(132px,16.5vw,224px)]">
              <Spinner
                key={demo ? "demo" : (play.request?.address ?? "idle")}
                spinning={spinning}
                landing={landing}
                onLanded={() => setLanded(true)}
                faces={faces}
                winner={winner}
              />
            </div>
          )}

          {landed && landedCard && snapshot && (
            <Slab
              card={revealCard(landedCard, snapshot.pool.evLamports)}
              cert={`Cert #${landedCard.positionId}`}
              odds={formatOdds(landedCard.odds)}
              sealing
              width={360}
            />
          )}

          {landed && !demo && drawn && (
            <ExitChoice
              card={drawn}
              stage={stage}
              settlement={play.settlement}
              error={play.error}
              onKeep={() => void play.settle("keep")}
              onCashOut={() => void play.settle("cashOut")}
              onRelist={(backing) => void play.settle("keepAndRelist", undefined, backing)}
              onAgain={startOver}
            />
          )}
        </>
      }
      shelf={
        spinning ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="m-0 text-[12.5px] leading-[1.55]" style={{ color: "var(--muted)" }}>
              {demo
                ? "This is a demo spin — same odds, no wallet, no SOL."
                : stage === "waiting"
                  ? "Your pull is on chain. The reel lands when the draw does."
                  : "Drawn. Decide what happens to the card."}
            </p>
            {(demo ? landed : stage === "settled") && (
              <button onClick={startOver} className="btn-ghost px-5 py-3 text-[11.5px]">
                {demo ? "Back to the reel" : "Spin again"}
              </button>
            )}
          </div>
        ) : (
          <PullControls play={play} onDemo={runDemo} />
        )
      }
    />
  );
}
