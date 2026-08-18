"use client";

/**
 * The storefront layout, shared by both screens, in the app's drafting
 * frame: a heading band across the top, then the stage and the pool's
 * contents side by side, sharing single hairlines edge to edge, and the
 * spec sheet cut in below its own dashed rule.
 *
 * The stage is the page's well with a control shelf along its bottom: the
 * pull, and whatever the pull is currently saying.
 */

import { SectionRule } from "@/components/section-rule";
import type { PoolConfig } from "@/lib/config";
import type { Snapshot } from "@/lib/mirror";

export function Storefront({
  config,
  snapshot,
  error,
  stage,
  shelf,
  aside,
  asideWide = false,
  sheet,
}: {
  config: PoolConfig;
  snapshot: Snapshot | null;
  /** Set when the pool could not be read at all: the stage says so. */
  error?: string | null;
  stage: React.ReactNode;
  shelf: React.ReactNode;
  aside: React.ReactNode;
  /** True while the aside is showing the pool's contents: it takes the
      room, because ten cards to read beat a pack that is only sitting
      there. The stage keeps its shelf, so the pull never leaves. */
  asideWide?: boolean;
  sheet: React.ReactNode;
}) {
  const p = snapshot?.pool;
  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6">
      <main className="frame flex min-h-[calc(100vh-var(--nav-h))] flex-col">
        <header
          className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-6 py-6 sm:px-8"
          style={{ borderBottom: "1px dashed var(--line)" }}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="heading m-0 text-[22px]">{config.name}</h1>
              <span className="label px-2 py-1 leading-none" style={{ border: "1px solid var(--hairline)" }}>
                {p ? (p.ownStock ? "Own stock" : "Open deposits") : "Reading"}
              </span>
              {p?.acquisitionsPaused && (
                <span className="label px-2 py-1 leading-none" style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}>
                  Pulls paused
                </span>
              )}
            </div>
            <p className="m-0 mt-2 max-w-[62ch] text-[13px] leading-[1.65]" style={{ color: "var(--muted)" }}>
              {config.tagline}
            </p>
            {p && (
              <p className="label m-0 mt-2.5 sm:hidden">
                {p.activePositions} cards · {p.pullCount} pulls
              </p>
            )}
          </div>

          <div className="flex w-full items-end justify-between gap-6 sm:w-auto sm:justify-end">
            <Figure k="Cards in the case" v={p ? String(p.activePositions) : null} />
            <Figure k="Pulls" v={p ? String(p.pullCount) : null} />
            <div className="flex items-baseline gap-3 sm:block sm:text-right">
              <span className="label whitespace-nowrap">Price per pull</span>
              {p ? (
                <p className="figure m-0 text-[24px] leading-none sm:mt-1.5 sm:text-[28px]" style={{ color: "var(--accent)" }}>
                  {p.priceSol}
                  <span className="ml-1.5 text-[12px]" style={{ color: "var(--faint)" }}>
                    SOL
                  </span>
                </p>
              ) : (
                <Reading w={92} h={26} />
              )}
            </div>
          </div>
        </header>

        <div className="grid flex-1" data-wide={asideWide ? "true" : "false"}>
          <section className="flex min-h-[540px] flex-col" style={{ background: "var(--well)" }}>
            <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-8 sm:px-8">
              {!snapshot && error ? (
                <div className="flex max-w-[46ch] flex-col items-center gap-3 text-center">
                  <span className="label">The pool did not answer</span>
                  <p className="m-0 text-[13px] leading-[1.65]" style={{ color: "var(--muted)" }}>
                    {error}
                  </p>
                  <button onClick={() => location.reload()} className="btn-ghost px-5 py-3 text-[11px] leading-none">
                    Try again
                  </button>
                </div>
              ) : (
                stage
              )}
            </div>
            <div
              className="shrink-0 px-4 py-5 sm:px-7"
              style={{ borderTop: "1px solid var(--hairline)", background: "var(--bg)" }}
            >
              {shelf}
            </div>
          </section>

          {/* As tall as the stage, with its own body scrolling: the contents
              list is long and the pack list is short, and neither should be
              able to change the height of the page. */}
          <aside
            className="flex max-h-[70vh] min-h-0 flex-col lg:max-h-none"
            style={{ borderLeft: "1px solid var(--hairline)" }}
          >
            {aside}
          </aside>
        </div>

        <SectionRule label="Spec sheet" />
        {sheet}
      </main>
    </div>
  );
}

function Figure({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="hidden sm:block sm:text-right">
      <span className="label">{k}</span>
      {v ? <p className="figure m-0 mt-1.5 text-[16px] leading-none">{v}</p> : <Reading w={40} h={16} />}
    </div>
  );
}

/** A figure the chain has not answered for yet. Never a dash: a dash is a
    value, and "no value" is not what is true here. */
function Reading({ w, h }: { w: number; h: number }) {
  return (
    <span
      aria-label="Reading the pool"
      className="mt-1.5 block"
      style={{ width: w, height: h - 4, background: "var(--cell)", animation: "breathe 1.4s infinite" }}
    />
  );
}
