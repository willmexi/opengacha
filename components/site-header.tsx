"use client";

/**
 * The rail across the top: who is selling, where you can go, and who you
 * are. It is the one piece of chrome on every screen, so it stays a single
 * hairline deep and lets the case below it hold the attention.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AcquisitionsMenu } from "@/components/acquisitions-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { WalletChip } from "@/components/wallet-chip";

const NAV = [
  ["/packs", "Packs"],
  ["/spinner", "Spins"],
  ["/profile", "User profile"],
] as const;

/** The doors into opengacha.io: the protocol's own site, the creator's
 * console for whoever runs a pool, and the protocol docs, which are the one place the storefront's
 * documentation lives too. Same dress as opengacha.io's own "nfw.fun ↗". */
const ELSEWHERE = [
  ["https://www.opengacha.io", "OpenGacha ↗"],
  ["https://www.opengacha.io/manage", "Manage ↗"],
  ["https://www.opengacha.io/docs", "Docs ↗"],
] as const;

export function SiteHeader() {
  const path = usePathname();
  return (
    <header
      className="sticky top-0 z-50 flex h-[var(--nav-h)] items-center gap-3 px-3 sm:gap-6 sm:px-6"
      style={{
        background: "color-mix(in srgb, var(--bg) 88%, transparent)",
        borderBottom: "1px solid var(--hairline)",
        backdropFilter: "blur(12px)",
      }}
    >
      <Link href="/" className="flex shrink-0 items-baseline gap-2">
        <span className="text-[15px] leading-none font-medium tracking-[-0.02em] sm:text-[16px]">OpenGacha</span>
        <span className="label hidden sm:inline">Storefront</span>
      </Link>

      <nav
        className="flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          maskImage: "linear-gradient(90deg, #000 88%, transparent)",
          WebkitMaskImage: "linear-gradient(90deg, #000 88%, transparent)",
        }}
      >
        {NAV.map(([href, label]) => {
          const on = path === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className="panel-hover flex h-8 shrink-0 items-center px-3 text-[13.5px] leading-none font-medium"
              style={{ color: on ? "var(--text)" : "var(--muted)", backgroundColor: on ? "var(--backdrop)" : undefined }}
            >
              {label}
            </Link>
          );
        })}
        {ELSEWHERE.map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="panel-hover flex h-8 shrink-0 items-center px-3 text-[13.5px] leading-none font-medium"
            style={{ color: "var(--muted)" }}
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <a
          href="https://github.com/willmexi/opengacha"
          className="label hidden transition-colors hover:text-[var(--text)] sm:inline"
          target="_blank"
          rel="noreferrer"
        >
          Source
        </a>
        {/* Open acquisitions: every unsettled pull, on any pack here.
            Renders nothing until a wallet is connected. */}
        <AcquisitionsMenu />
        <ThemeToggle />
        <WalletChip />
      </div>
    </header>
  );
}
