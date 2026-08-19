"use client";

/**
 * Screen one: packs.
 *
 * The case holds the pack; the shelf under it holds the pull. usePlay owns
 * the chain (quote, request, wait, settle) and this file owns what you see:
 * the rip starts when the transaction is in, waits on the pack while the
 * draw lands, prints the cert, seals the card, and then asks what you want
 * done with it.
 *
 * "Free demo" runs the same rip on a random card from the pool — no wallet,
 * no SOL — so nobody has to spend anything to see what they are buying.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { BuilderPanel } from "@/components/builder-panel";
import { ExitChoice } from "@/components/exit-choice";
import { Storefront } from "@/components/frame";
import { PackRip } from "@/components/packs";
import { PullControls } from "@/components/pull-controls";
import { SideTabs, type Tab } from "@/components/side-tabs";
import type { RevealCard } from "@/components/slab";
import { usePlay } from "@/lib/play";
import { usePoolSlug } from "@/lib/use-pool-slug";
import { formatOdds, revealCard } from "@/lib/reveal";

export default function PacksScreen() {
  return (
    <Suspense>
      <PacksRoute />
    </Suspense>
  );
}

function PacksRoute() {
  const [slug, setSlug] = usePoolSlug();
  // Keyed on the slug so a pack switch is a clean remount: no draw state
  // from one pool ever meets the price of another.
  return <Packs key={slug} slug={slug} onPick={setSlug} />;
}

function Packs({ slug, onPick }: { slug: string; onPick: (s: string) => void }) {
  const play = usePlay(slug);
  const { config, snapshot, stage } = play;

  /* `?settle=<requestId>`, the header's Open acquisitions menu sending the
     buyer straight into a decision: once this wallet's open pulls in this
     pool are read, the named one resumes. Once per mount, so a later pull
     on the same page is never hijacked by a stale URL. */
  const settleParam = useSearchParams().get("settle");
  const settled = useRef(false);
  useEffect(() => {
    if (settled.current || settleParam === null || stage !== "idle") return;
    const wanted = play.openPulls.find((r) => String(r.requestId) === settleParam);
    if (!wanted) return;
    settled.current = true;
    void play.resume(wanted);
  }, [settleParam, play.openPulls, stage, play]);
  const [demo, setDemo] = useState<{ card: RevealCard; cert: string; odds: string } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [tab, setTab] = useState<Tab>("packs");

  const drawn = play.cards[0];
  const inFlight = stage === "waiting" || stage === "drawn" || stage === "settling" || stage === "settled";
  const ripping = demo !== null || inFlight;
  // What the cert announces: the demo card, or the real one once drawn.
  const card =
    demo?.card ?? (drawn && snapshot && stage !== "waiting" ? revealCard(drawn.meta, snapshot.pool.evLamports) : null);
  const cert = demo ? demo.cert : drawn ? `Cert #${drawn.position.positionId}` : undefined;
  const odds = demo?.odds ?? (drawn ? formatOdds(drawn.meta.odds) : undefined);

  const startOver = () => {
    setDemo(null);
    setRevealed(false);
    play.reset();
  };
  const runDemo = () => {
    const live = (snapshot?.cards ?? []).filter((c) => c.status === "active");
    if (!snapshot || live.length === 0) return;
    const pick = live[Math.floor(Math.random() * live.length)];
    setRevealed(false);
    setDemo({
      card: revealCard(pick, snapshot.pool.evLamports),
      cert: `Cert #${pick.positionId}`,
      odds: formatOdds(pick.odds),
    });
  };

  return (
    <Storefront
      config={config}
      snapshot={snapshot}
      error={play.error}
      aside={<SideTabs selected={slug} onSelect={onPick} snapshot={snapshot} locked={ripping} tab={tab} onTab={setTab} />}
      asideWide={tab === "inside"}
      sheet={<BuilderPanel config={config} snapshot={snapshot} />}
      stage={
        <>
          <PackRip
            packArt={config.art}
            packName={config.name}
            ripping={ripping}
            card={card}
            cert={cert}
            odds={odds}
            onDone={() => setRevealed(true)}
          />

          {!demo && drawn && revealed && (
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
        ripping ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="m-0 text-[12.5px] leading-[1.55]" style={{ color: "var(--muted)" }}>
              {demo
                ? "This is a demo draw — same odds, no wallet, no SOL."
                : stage === "waiting"
                  ? "Your pull is on chain. The draw lands in a few seconds and is verifiable."
                  : "Drawn. Decide what happens to the card."}
            </p>
            {(demo ? revealed : stage === "settled") && (
              <button onClick={startOver} className="btn-ghost px-5 py-3 text-[11.5px]">
                {demo ? "Back to the pack" : "Pull again"}
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
