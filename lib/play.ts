"use client";

/**
 * usePlay: the whole pull flow as one hook, shared by the packs screen and
 * the spinner screen. The screens own the animation; this owns the chain.
 *
 *   idle ──pull()──▶ signing ──▶ waiting ──▶ drawn ──settle()──▶ settling ──▶ settled
 *                                                 └──────────── error (with the pull still open)
 *
 * The snapshot (price, cards, art) comes from this site's /api/pool route,
 * which reads the chain through the mini-mirror. The money paths (request,
 * settle) read the chain directly through /api/rpc and sign with the
 * wallet. On mount, any of the wallet's unsettled pulls in this pool are
 * offered back, so a closed tab never strands a draw.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";

import { poolBySlug, type PoolConfig } from "@/lib/config";
import {
  cashOutPayout,
  chain,
  connectWallet,
  drawnCards,
  effectiveBounds,
  readBounds,
  readOpenRequests,
  readPool,
  relistLimits,
  requestPull,
  resolve,
  restoreWallet,
  sol,
  useWalletOwner,
  waitForDraw,
  type Exit,
  type PoolInfo,
  type PositionInfo,
  type RelistLimits,
  type RequestInfo,
} from "@/lib/gacha";
import type { CardJson, Snapshot } from "@/lib/mirror";

export type Stage = "idle" | "signing" | "waiting" | "drawn" | "settling" | "settled" | "error";

export interface DrawnCard {
  position: PositionInfo;
  meta: CardJson;
  /** What cash-out pays for this card, at the request's own bid rate. */
  cashOutLamports: bigint;
  /** The relist bounds for this card, when the pool allows relisting; null
   * on own-stock pools and wherever the creator switched it off. */
  relist: RelistLimits | null;
}

export interface Settlement {
  exit: Exit;
  signature: string;
  card: DrawnCard;
}

export interface Play {
  config: PoolConfig;
  snapshot: Snapshot | null;
  refresh: (fresh?: boolean) => Promise<void>;
  wallet: PublicKey | null;
  connect: () => Promise<PublicKey>;
  stage: Stage;
  error: string | null;
  /** The live request while a pull is in flight, and after the draw. */
  request: RequestInfo | null;
  /** The cards the draw produced (one, unless a batch). */
  cards: DrawnCard[];
  settlement: Settlement | null;
  /** Unsettled pulls this wallet already holds in this pool. */
  openPulls: RequestInfo[];
  pull: (batch?: number) => Promise<void>;
  resume: (request: RequestInfo) => Promise<void>;
  /** Keep, cash out, or (where allowed) keep & relist at `relistBackingLamports`. */
  settle: (exit: Exit, card?: DrawnCard, relistBackingLamports?: bigint) => Promise<void>;
  reset: () => void;
}

export function usePlay(slug: string): Play {
  const config = poolBySlug(slug);
  if (!config) throw new Error(`no pool configured for slug "${slug}"`);
  const poolAddress = useRef(new PublicKey(config.address)).current;

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  // One wallet everywhere: the header, the screens and the manage page all
  // read the same store; a connect anywhere reaches this hook.
  const wallet = useWalletOwner();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<RequestInfo | null>(null);
  const [cards, setCards] = useState<DrawnCard[]>([]);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [openPulls, setOpenPulls] = useState<RequestInfo[]>([]);
  const poolInfo = useRef<PoolInfo | null>(null);

  const refresh = useCallback(
    async (fresh = false) => {
      const res = await fetch(`/api/pool/${slug}${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `pool read failed (${res.status})`);
      setSnapshot((await res.json()) as Snapshot);
    },
    [slug]
  );

  // First paint from the cache; a quiet refresh every few seconds after.
  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    const t = setInterval(() => void refresh().catch(() => {}), 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  // The session the wallet already trusts, and that wallet's open pulls.
  useEffect(() => {
    void restoreWallet();
  }, []);
  useEffect(() => {
    if (!wallet) return;
    void readOpenRequests(poolAddress, wallet)
      .then(setOpenPulls)
      .catch(() => {});
  }, [wallet, poolAddress, stage]);

  const connect = useCallback(() => connectWallet(), []);

  /** Names and art for the drawn positions: from the snapshot when it has
   * them, else one /api/meta call. */
  const describe = useCallback(
    async (positions: PositionInfo[], req: RequestInfo, buyer: PublicKey): Promise<DrawnCard[]> => {
      const known = new Map((snapshot?.cards ?? []).map((c) => [c.mint, c]));
      // Relist is judged against the pool's bounds, the card's collection
      // band, and the wallet's balance; read all three once per draw, and
      // only when the pool allows relisting at all.
      const info = poolInfo.current ?? (await readPool(poolAddress));
      poolInfo.current = info;
      const [bands, balance] = info.relistEnabled
        ? await Promise.all([readBounds(poolAddress), chain().connection.getBalance(buyer)])
        : [null, 0];
      const missing = positions.filter((p) => !known.has(p.mint)).map((p) => p.mint);
      if (missing.length) {
        const res = await fetch(`/api/meta?mints=${missing.join(",")}`);
        const metas = (await res.json()) as Record<string, { name: string; image: string | null; collection: string | null; tokenStandard: number | null; ruleSet: string | null }>;
        for (const p of positions) {
          const m = metas[p.mint];
          if (m) {
            known.set(p.mint, {
              address: p.address,
              mint: p.mint,
              depositor: p.depositor,
              positionId: p.positionId,
              backingLamports: p.backingLamports.toString(),
              backingSol: sol(p.backingLamports),
              slotIndex: p.slotIndex,
              status: p.status,
              pendingRequest: p.pendingRequest,
              standard: p.standard,
              odds: 0,
              name: m.name,
              image: m.image,
              collection: m.collection,
              tokenStandard: m.tokenStandard,
              ruleSet: m.ruleSet,
            });
          }
        }
      }
      return positions.map((p) => {
        const meta = known.get(p.mint) ?? {
          address: p.address, mint: p.mint, depositor: p.depositor, positionId: p.positionId,
          backingLamports: p.backingLamports.toString(), backingSol: sol(p.backingLamports),
          slotIndex: p.slotIndex, status: p.status, pendingRequest: p.pendingRequest,
          standard: p.standard, odds: 0, name: `${p.mint.slice(0, 4)}…${p.mint.slice(-4)}`,
          image: null, collection: null, tokenStandard: null, ruleSet: null,
        };
        return {
          position: p,
          meta,
          cashOutLamports: cashOutPayout(p.backingLamports, req.bidRateBps),
          relist: bands ? relistLimits(effectiveBounds(info, meta.collection, bands), p, BigInt(balance)) : null,
        };
      });
    },
    [snapshot, poolAddress]
  );

  /** From a fulfilled request to the drawn cards on screen. */
  const land = useCallback(
    async (req: RequestInfo, buyer: PublicKey) => {
      const positions = await drawnCards(poolAddress, req.requestId);
      if (positions.length === 0) throw new Error("The draw landed but the card is not visible yet. Refresh in a moment.");
      setCards(await describe(positions, req, buyer));
      setRequest(req);
      setStage("drawn");
      void refresh(true).catch(() => {});
    },
    [poolAddress, describe, refresh]
  );

  const pull = useCallback(
    async (batch = 1) => {
      setError(null);
      setSettlement(null);
      setCards([]);
      try {
        const buyer = wallet ?? (await connect());
        setStage("signing");
        // Price from the chain, now, not from the snapshot: the cap the
        // buyer signs is price plus the pool's slippage tolerance.
        const info = await readPool(poolAddress);
        poolInfo.current = info;
        if (info.acquisitionsPaused) throw new Error("This pool has paused pulls for the moment.");
        if (info.activePositions <= 3) throw new Error("The pool needs at least 4 cards before it sells a pull.");
        const cap = (info.priceLamports * BigInt(10_000 + info.slippageBps)) / 10_000n;
        const receipt = await requestPull(buyer, poolAddress, info, cap, batch);
        setStage("waiting");
        const req = await waitForDraw(new PublicKey(receipt.request), { onUpdate: setRequest });
        await land(req, buyer);
      } catch (e) {
        setError(friendly(e));
        setStage("error");
      }
    },
    [wallet, connect, poolAddress, land]
  );

  const resume = useCallback(
    async (req: RequestInfo) => {
      setError(null);
      setSettlement(null);
      try {
        const buyer = wallet ?? (await connect());
        setRequest(req);
        if (!poolInfo.current) poolInfo.current = await readPool(poolAddress);
        if (req.fulfilled) {
          await land(req, buyer);
          return;
        }
        setStage("waiting");
        const done = await waitForDraw(new PublicKey(req.address), { onUpdate: setRequest });
        await land(done, buyer);
      } catch (e) {
        setError(friendly(e));
        setStage("error");
      }
    },
    [wallet, connect, poolAddress, land]
  );

  const settle = useCallback(
    async (exit: Exit, card = cards[0], relistBackingLamports?: bigint) => {
      if (!request || !card) return;
      setError(null);
      try {
        const buyer = wallet ?? (await connect());
        setStage("settling");
        const info = poolInfo.current ?? (await readPool(poolAddress));
        const signature = await resolve(
          buyer,
          poolAddress,
          info,
          request,
          card.position,
          { collection: card.meta.collection, tokenStandard: card.meta.tokenStandard, ruleSet: card.meta.ruleSet },
          exit,
          relistBackingLamports
        );
        setSettlement({ exit, signature, card });
        setStage("settled");
        void refresh(true).catch(() => {});
      } catch (e) {
        setError(friendly(e));
        setStage("drawn");
      }
    },
    [cards, request, wallet, connect, poolAddress, refresh]
  );

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setRequest(null);
    setCards([]);
    setSettlement(null);
  }, []);

  return {
    config, snapshot, refresh, wallet, connect, stage, error, request, cards, settlement,
    openPulls, pull, resume, settle, reset,
  };
}

/** Program errors and wallet refusals, said plainly. */
function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/User rejected|rejected the request|declined/i.test(msg)) return "You closed the wallet prompt. Nothing was sent.";
  if (/SlippageExceeded|PriceAboveLimit/.test(msg)) return "The price moved past your cap. Try again for a fresh quote.";
  if (/insufficient funds|Insufficient/i.test(msg)) return "Not enough SOL for this pull plus fees.";
  if (/AcquisitionsPaused/i.test(msg)) return "This pool has paused pulls for the moment.";
  if (/RelistForbiddenForCreatorPool/.test(msg)) return "This pool does not allow keep & relist.";
  return msg;
}
