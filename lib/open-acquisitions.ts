"use client";

/**
 * Every unsettled pull the connected wallet holds on any pool this
 * storefront sells: what the header's "Open acquisitions" menu reads.
 *
 * Money that has left the wallet and not come back should always be one
 * click away, whichever page the buyer is on and however long ago the tab
 * closed. So this is read from the chain, not from local state: one
 * `readOpenRequests` per pool in pools.json (the request account's own
 * `fulfilled` / `resolved` bytes decide the bucket), polled every thirty
 * seconds and on focus. opengacha.io does the same program-wide; here the
 * shop's own pools are the whole world.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicKey } from "@solana/web3.js";

import { POOLS, poolKey, type PoolConfig } from "@/lib/config";
import { readOpenRequests, type RequestInfo } from "@/lib/gacha/accounts";

export interface OpenAcquisition {
  config: PoolConfig;
  request: RequestInfo;
}

const POLL_MS = 30_000;

export function useOpenAcquisitions(wallet: PublicKey | null): {
  rows: OpenAcquisition[];
  loading: boolean;
  refresh: () => void;
} {
  const [rows, setRows] = useState<OpenAcquisition[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const owner = wallet?.toBase58() ?? null;

  const refresh = useCallback(async () => {
    if (!wallet) {
      setRows([]);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    try {
      const perPool = await Promise.all(
        POOLS.map(async (config) => {
          try {
            const reqs = await readOpenRequests(poolKey(config), wallet);
            return reqs.map((request) => ({ config, request }));
          } catch {
            return [] as OpenAcquisition[];
          }
        })
      );
      if (mine !== seq.current) return;
      setRows(perPool.flat().sort((a, b) => b.request.createdAt - a.request.createdAt));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // `owner` (the string) is the real dependency: the PublicKey object
    // identity changes without the wallet changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  useEffect(() => {
    void refresh();
    if (!owner) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [owner, refresh]);

  return { rows, loading, refresh: () => void refresh() };
}
