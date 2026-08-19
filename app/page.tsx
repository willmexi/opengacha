import Link from "next/link";

import { LiveCase, LiveLine, PoolCards } from "@/components/live";
import { SectionRule } from "@/components/section-rule";

/**
 * The front of the shop, in the protocol's own drafting frame: the page
 * stands between two dashed rails, its sections cut by dashed rules. It
 * opens on a case with a real card in it, priced from the chain, because
 * that is what is being sold; the fork comes after, for the people who
 * want to run one of these themselves.
 */

/* A pull genuinely is a sequence, so it is numbered. Nothing else here is. */
const PULL = [
  [
    "The pool quotes itself",
    "Price is read from the pool account: the harmonic mean of what its cards are backed by, plus the creator's surcharge. Never a number this site made up.",
  ],
  [
    "You sign one transaction",
    "It requests the draw at a price cap of your quote plus the pool's slippage. Re-price past the cap and the program refuses rather than overcharge you.",
  ],
  [
    "The draw lands",
    "Randomness is requested on chain in the same transaction and settled within seconds. The request account keeps the value your card was drawn from.",
  ],
  [
    "You decide what happens to it",
    "Keep it and the card moves to your wallet. Take the buyback and the pool pays its bid rate. Where the pool allows it, relist it and earn from every pull until it is drawn again.",
  ],
] as const;

const ENFORCED = [
  ["Randomness", "Verifiable, requested by the program", "Nobody — not the creator, not this site — picks which card you draw or when."],
  ["Your price", "Capped by the transaction you sign", "The cap travels with the request. A pool that re-prices mid-flight loses the sale instead of taking more."],
  ["Custody", "None, at any point", "The buyer signs and pays from their own wallet. This site holds no keys, no cards and no funds."],
] as const;

const FORK = [
  ["Clone and run it", "npm install, copy .env.example to .env.local, add your RPC, npm run dev. SQLite writes itself on first run."],
  ["List your pools", "pools.json is the whole storefront: an address, a name, pack art. Make a pool on opengacha.io and paste it in."],
  ["Read lib/gacha", "Every call the site makes: read the pool, quote, request, wait for the draw, settle. No API key and no backend of ours."],
  ["Make it yours", "Your domain, your type, your art. Fees split on chain between the pool's creator and the protocol; nothing here can move them."],
] as const;

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6">
      <main className="frame flex flex-col">
        {/* --- The window ---------------------------------------------- */}
        <section className="grid items-center gap-10 px-4 py-14 sm:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
          <div className="flex flex-col items-start gap-6">
            <span className="label">Open source · Solana mainnet</span>
            <h1 className="display m-0 text-[clamp(36px,6vw,64px)]">
              Pull a graded card.
              <br />
              Keep it, or take
              <br />
              <span style={{ color: "var(--accent)" }}>the buyback.</span>
            </h1>
            <p className="m-0 max-w-[46ch] text-[15px] leading-[1.7]" style={{ color: "var(--muted)" }}>
              Every card in these packs is a real graded collectible, sealed and held in an on-chain pool. You draw
              with verifiable randomness, sign one transaction from your own wallet, and decide on the spot whether to
              take the card or the SOL behind it.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <Link href="/packs" className="btn-solid px-7 py-[15px] text-[12px] leading-none">
                Pull a pack
              </Link>
              <Link href="/spinner" className="btn-corner px-6 py-[15px] text-[12px] leading-none">
                <span className="c c-tl" aria-hidden />
                <span className="c c-tr" aria-hidden />
                <span className="c c-bl" aria-hidden />
                <span className="c c-br" aria-hidden />
                Watch the reel
              </Link>
              {/* The open-source affordance every storefront should wear:
                  the repo, one click from the hero, "fork" said in so many
                  words. */}
              <a
                href="https://github.com/willmexi/opengacha/fork"
                target="_blank"
                rel="noreferrer"
                className="btn-ghost inline-flex items-center gap-2 px-4 py-[13px] text-[11px] leading-none"
                title="Fork this storefront on GitHub"
              >
                <GitHubMark />
                Fork this storefront
              </a>
            </div>
            <LiveLine />
          </div>
          <LiveCase />
        </section>

        <SectionRule label="Selling now" />
        <PoolCards />

        <SectionRule label="How a pull works" />
        <section className="grid lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="px-6 py-8 sm:px-10">
            <h2 className="heading m-0 text-[22px]">Four steps, every time.</h2>
            <p className="m-0 mt-3 max-w-[34ch] text-[13.5px] leading-[1.7]" style={{ color: "var(--muted)" }}>
              Three of them are the program&apos;s; the last one is yours.
            </p>
            <Link href="/packs" className="btn-ghost mt-5 inline-block px-4 py-2.5 text-[11px] leading-none">
              Try it on a pack
            </Link>
          </div>
          <ol className="m-0 flex list-none flex-col p-0" style={{ borderLeft: "1px solid var(--hairline)" }}>
            {PULL.map(([title, body], i) => (
              <li
                key={title}
                className="flex items-baseline gap-5 px-6 py-5 sm:px-8"
                style={{ borderBottom: i < PULL.length - 1 ? "1px solid var(--hairline)" : undefined }}
              >
                <span className="label tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="heading m-0 text-[14px]">{title}</h3>
                  <p className="m-0 mt-1.5 max-w-[64ch] text-[13.5px] leading-[1.7]" style={{ color: "var(--muted)" }}>
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <SectionRule label="What the program enforces" />
        <section className="cells sm:grid-cols-3" style={{ borderInline: "none" }}>
          {ENFORCED.map(([k, headline, body]) => (
            <div key={k} className="flex flex-col gap-2.5 px-6 py-8 sm:px-8">
              <span className="label">{k}</span>
              <p className="heading m-0 text-[17px] leading-[1.25]" style={{ color: "var(--accent)" }}>
                {headline}
              </p>
              <p className="m-0 text-[13px] leading-[1.7]" style={{ color: "var(--muted)" }}>
                {body}
              </p>
            </div>
          ))}
        </section>

        <SectionRule label="Run this storefront yourself" />
        <section className="grid lg:grid-cols-[minmax(0,1fr)_420px]">
          <ol className="m-0 flex min-w-0 list-none flex-col p-0">
            {FORK.map(([t, d], i) => (
              <li
                key={t}
                className="px-6 py-5 sm:px-10"
                style={{ borderBottom: i < FORK.length - 1 ? "1px solid var(--hairline)" : undefined }}
              >
                <span className="heading text-[13.5px]">{t}</span>
                <p className="m-0 mt-1.5 max-w-[66ch] text-[13px] leading-[1.7]" style={{ color: "var(--muted)" }}>
                  {d}
                </p>
              </li>
            ))}
          </ol>
          <div
            className="flex min-w-0 flex-col gap-4 px-6 py-6 sm:px-8"
            style={{ borderLeft: "1px solid var(--hairline)", background: "var(--surface)" }}
          >
            <span className="label">A pull, in full</span>
            <pre
              className="figure scroll-quiet m-0 overflow-x-auto p-3 text-[10.5px] leading-[1.85]"
              style={{ background: "var(--well)", border: "1px solid var(--hairline)", color: "var(--muted)" }}
            >
{`const pool = await readPool(addr)
const req  = await requestPull(w, addr, pool, cap)
const done = await waitForDraw(req.request, addr)
const [c]  = await drawnCards(addr, done.requestId)
await resolve(w, addr, pool, done, c, meta, "keep")`}
            </pre>
            <div className="mt-auto flex flex-wrap gap-3">
              <a href="https://www.opengacha.io/docs" className="btn-ghost px-4 py-3 text-[11px] leading-none">
                Read the docs ↗
              </a>
              <a
                href="https://github.com/willmexi/opengacha"
                target="_blank"
                rel="noreferrer"
                className="btn-ghost inline-flex items-center gap-2 px-4 py-3 text-[11px] leading-none"
              >
                <GitHubMark />
                Source on GitHub
              </a>
            </div>
          </div>
        </section>

        <div className="rule" />
        <footer
          className="flex flex-wrap items-center justify-between gap-3 px-6 py-6 text-[11px] sm:px-10"
          style={{ color: "var(--faint)" }}
        >
          <span>An open-source project on the OpenGacha protocol · MIT</span>
          <a href="https://github.com/willmexi/opengacha" className="underline underline-offset-2">
            github.com/willmexi/opengacha
          </a>
        </footer>
      </main>
    </div>
  );
}

/** GitHub's mark, inline, the size of the label beside it. */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
