"use client";

/**
 * The wallet in the rail: the invitation, or the identity. Connected, the
 * chip reads as a cert number — because that is what an address is here —
 * and opens a menu with the whole of it, a copy, and the way out.
 */

import { useEffect, useRef, useState } from "react";

import { connectWallet, disconnectWallet, restoreWallet, useWalletOwner } from "@/lib/gacha/wallet";

export function WalletChip() {
  const owner = useWalletOwner();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // The first mount asks the wallet for the session it already trusts.
  useEffect(() => {
    void restoreWallet();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!owner) {
    return (
      <span className="relative">
        <button
          onClick={() => {
            setConnectError(null);
            void connectWallet().catch((e) => setConnectError(friendlyConnect(e)));
          }}
          className="btn-solid px-4 py-[9px] text-[11.5px]"
        >
          Connect
        </button>
        {connectError && (
          <span
            role="alert"
            className="absolute top-full right-0 z-50 mt-1.5 w-[240px] px-3 py-2 text-[11.5px] leading-[1.5]"
            style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--accent-lit)" }}
          >
            {connectError}
          </span>
        )}
      </span>
    );
  }

  const address = owner.toBase58();
  const item =
    "flex w-full items-center px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--cell)]";
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        className="figure flex items-center gap-2 rounded-[3px] px-3 py-[9px] text-[11.5px] transition-colors"
        style={{ border: "1px solid var(--line)", color: "var(--muted)" }}
      >
        <span className="size-[6px] rounded-full" style={{ background: "var(--uncommon)" }} aria-hidden />
        {address.slice(0, 4)}…{address.slice(-4)}
      </button>
      {open && (
        <div
          role="menu"
          className="panel absolute right-0 z-50 mt-2 w-[230px] overflow-hidden py-1"
        >
          <p className="figure m-0 truncate px-3 pt-2 pb-2.5 text-[11px]" style={{ color: "var(--faint)" }} title={address}>
            {address}
          </p>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={async () => {
              await navigator.clipboard.writeText(address).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            style={{ color: "var(--accent-lit)" }}
            onClick={async () => {
              setOpen(false);
              await disconnectWallet();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

/** Why a connect did nothing, said plainly instead of swallowed. */
export function friendlyConnect(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/No Solana wallet/i.test(msg)) return "No Solana wallet found in this browser. Install Phantom, or open this page in a browser with a wallet.";
  if (/User rejected|rejected the request|declined/i.test(msg)) return "You closed the wallet prompt.";
  return msg;
}
