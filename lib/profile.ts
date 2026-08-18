"use client";

/**
 * useHub: the user's profile as one hook, across every pool this storefront
 * sells. Not a pool's console (that is the creator's, on opengacha.io); the
 * wallet's own cockpit: what it holds in each pool and what that has
 * earned, its unsettled pulls, and where it may deposit.
 * Modeled on nfw.fun's account hub.
 *
 * Reads come from the chain through lib/gacha. Per pool: the pool account,
 * the wallet's positions with earnings, its open requests, the admitted
 * collections and their bands. Holdings (what the wallet could deposit)
 * are scanned only for the pool the Deposit tab has picked, since a
 * token-account sweep is the expensive read here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";

import { POOLS, type PoolConfig } from "@/lib/config";
import {
  chain,
  claimRewards,
  claimRewardsMany,
  connectWallet,
  depositCard,
  effectiveBounds,
  myOpenPulls,
  myPositions,
  positionPda,
  readAdmitted,
  readBounds,
  readPool,
  restoreWallet,
  useWalletOwner,
  walletNfts,
  withdrawCard,
  type Bounds,
  type MyPosition,
  type PoolInfo,
  type RequestInfo,
  type WalletNft,
} from "@/lib/gacha";

/** One pool as the wallet sees it. */
export interface PoolView {
  config: PoolConfig;
  pool: PoolInfo;
  positions: MyPosition[];
  openPulls: RequestInfo[];
  admitted: string[];
  bands: Record<string, Bounds>;
  /** True on a decentralised pool, or on an own-stock pool for its creator. */
  canDeposit: boolean;
}

export interface DepositOutcome {
  mint: string;
  signature: string | null;
  error: string | null;
}

export interface Hub {
  wallet: PublicKey | null;
  connect: () => Promise<PublicKey>;
  pools: PoolView[];
  loading: boolean;
  /** Headline figures across every pool. */
  totals: { cards: number; backingLamports: bigint; earnedLamports: bigint; openPulls: number };
  /** The Deposit tab's holdings for one pool: what the wallet could put in. */
  holdings: (slug: string) => { list: WalletNft[]; loading: boolean; error: string | null };
  /** Scan the wallet for one pool's admitted cards; `force` rescans. */
  loadHoldings: (slug: string, force?: boolean) => void;
  /** Changes after every deposit, withdraw or claim: rescan the wallet. */
  holdingsEpoch: number;
  boundsFor: (view: PoolView, collection: string) => Bounds;
  busy: string | null;
  error: string | null;
  lastSignature: string | null;
  refresh: () => Promise<void>;
  deposit: (view: PoolView, nft: WalletNft, backingLamports: bigint) => Promise<void>;
  /** A batch of deposits into one pool, one wallet prompt per card, in
   * order; a refused prompt ends the batch and the rest are reported as
   * skipped. Resolves with every row's outcome, never throws. */
  depositMany: (
    view: PoolView,
    items: { nft: WalletNft; backingLamports: bigint }[],
    onProgress?: (done: number, total: number) => void
  ) => Promise<DepositOutcome[]>;
  withdraw: (view: PoolView, position: MyPosition) => Promise<void>;
  claim: (view: PoolView, position: MyPosition) => Promise<void>;
  /** Claim for many positions, across pools: one prompt per pool per ten
   * positions. Resolves with every position's outcome, never throws. */
  claimMany: (items: { view: PoolView; position: MyPosition }[], onProgress?: (done: number, total: number) => void) => Promise<ActionOutcome[]>;
  /** Withdraw many cards, one prompt per card in order (each moves an NFT
   * and does not pack). A refused prompt ends the batch. */
  withdrawMany: (items: { view: PoolView; position: MyPosition }[], onProgress?: (done: number, total: number) => void) => Promise<ActionOutcome[]>;
}

export interface ActionOutcome {
  /** The position's address. */
  address: string;
  signature: string | null;
  error: string | null;
}

export function useHub(): Hub {
  const wallet = useWalletOwner();
  const [pools, setPools] = useState<PoolView[]>([]);
  const [loading, setLoading] = useState(true);
  const [holdingsBySlug, setHoldingsBySlug] = useState<Record<string, { list: WalletNft[]; loading: boolean; error: string | null }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped after every action that can change what the wallet holds; the
   * Deposit tab rescans on it, keeping the old list on screen meanwhile. */
  const [holdingsEpoch, setHoldingsEpoch] = useState(0);
  const [lastSignature, setLastSignature] = useState<string | null>(null);

  useEffect(() => {
    void restoreWallet();
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const views = await Promise.all(
        POOLS.map(async (config): Promise<PoolView> => {
          const address = new PublicKey(config.address);
          const [pool, admitted, bands] = await Promise.all([readPool(address), readAdmitted(address), readBounds(address)]);
          const [positions, openPulls] = wallet
            ? await Promise.all([myPositions(address, wallet), myOpenPulls(address, wallet)])
            : [[], []];
          const canDeposit = !pool.ownStock || (wallet !== null && pool.authority === wallet.toBase58());
          return { config, pool, positions, openPulls, admitted, bands, canDeposit };
        })
      );
      setPools(views);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Read through refs so the callback's identity does not change with every
  // pool refresh or scan result; the Deposit tab keys an effect on it.
  const latest = useRef({ pools, holdingsBySlug });
  latest.current = { pools, holdingsBySlug };
  const loadHoldings = useCallback(
    (slug: string, force = false) => {
      const view = latest.current.pools.find((v) => v.config.slug === slug);
      if (!wallet || !view || (latest.current.holdingsBySlug[slug] && !force)) return;
      setHoldingsBySlug((h) => ({ ...h, [slug]: { list: h[slug]?.list ?? [], loading: true, error: null } }));
      walletNfts(wallet, view.admitted)
        .then((list) => setHoldingsBySlug((h) => ({ ...h, [slug]: { list, loading: false, error: null } })))
        .catch((e) =>
          // A failed scan is a failed scan, not an empty wallet: say so and
          // keep whatever the last good scan showed.
          setHoldingsBySlug((h) => ({ ...h, [slug]: { list: h[slug]?.list ?? [], loading: false, error: friendly(e) } }))
        );
    },
    [wallet]
  );

  // A new wallet means new holdings; forget the old scan.
  useEffect(() => {
    setHoldingsBySlug({});
  }, [wallet]);

  const run = useCallback(
    async (label: string, act: () => Promise<string>) => {
      setError(null);
      setBusy(label);
      try {
        setLastSignature(await act());
        setHoldingsEpoch((e) => e + 1);
        await refresh();
      } catch (e) {
        setError(friendly(e));
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const totals = pools.reduce(
    (t, v) => {
      for (const p of v.positions) {
        if (p.status === "closed") continue;
        t.cards += 1;
        t.backingLamports += p.backingLamports;
        t.earnedLamports += p.earnedLamports;
      }
      t.openPulls += v.openPulls.length;
      return t;
    },
    { cards: 0, backingLamports: 0n, earnedLamports: 0n, openPulls: 0 }
  );

  return {
    wallet,
    connect: connectWallet,
    pools,
    loading,
    totals,
    holdings: (slug) => holdingsBySlug[slug] ?? { list: [], loading: false, error: null },
    loadHoldings,
    holdingsEpoch,
    boundsFor: (view, collection) => effectiveBounds(view.pool, collection, view.bands),
    busy,
    error,
    lastSignature,
    refresh,
    deposit: (view, nft, backing) =>
      run(`deposit:${nft.mint}`, async () => depositCard(wallet ?? (await connectWallet()), new PublicKey(view.config.address), nft, backing)),
    depositMany: async (view, items, onProgress) => {
      setError(null);
      setBusy(`deposit:${view.config.slug}`);
      const out: DepositOutcome[] = [];
      let payer: PublicKey;
      try {
        payer = wallet ?? (await connectWallet());
      } catch (e) {
        setBusy(null);
        return items.map((it) => ({ mint: it.nft.mint, signature: null, error: friendly(e) }));
      }
      const poolKey = new PublicKey(view.config.address);

      // The courtesy checks the console performs before it asks the wallet
      // for anything: enough SOL for the backings plus rent and fees, and
      // no card that is already in the pool.
      const preflight = new Map<string, string>();
      try {
        const { connection } = chain();
        const [balance, positions] = await Promise.all([
          connection.getBalance(payer),
          connection.getMultipleAccountsInfo(items.map((it) => positionPda(poolKey, new PublicKey(it.nft.mint)))),
        ]);
        positions.forEach((info, i) => {
          if (info) preflight.set(items[i].nft.mint, "Already in the pool. Rescan the wallet to update the list.");
        });
        const pending = items.reduce((a, it) => (preflight.has(it.nft.mint) ? a : a + it.backingLamports), 0n);
        const headroom = 6_000_000n * BigInt(items.length) + 5_000_000n; // rent per position, then fees
        if (BigInt(balance) < pending + headroom) {
          const need = Number(pending + headroom) / 1e9;
          const have = balance / 1e9;
          const msg = `Not enough SOL: backing ${items.length === 1 ? "this card" : "these cards"} needs about ${need.toFixed(3)} SOL (backing plus rent and fees) and the wallet holds ${have.toFixed(3)} SOL. Top up or lower the backing.`;
          for (const it of items) if (!preflight.has(it.nft.mint)) preflight.set(it.nft.mint, msg);
        }
      } catch {
        /* a failed read only skips the courtesy; the send itself will say */
      }

      let stopped: string | null = null;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const refused = stopped ?? preflight.get(it.nft.mint) ?? null;
        if (refused) {
          out.push({ mint: it.nft.mint, signature: null, error: refused });
          onProgress?.(i + 1, items.length);
          continue;
        }
        try {
          const sig = await depositCard(payer, poolKey, it.nft, it.backingLamports);
          out.push({ mint: it.nft.mint, signature: sig, error: null });
          setLastSignature(sig);
        } catch (e) {
          const msg = friendly(e);
          out.push({ mint: it.nft.mint, signature: null, error: msg });
          // A closed prompt means the person stopped; do not keep asking.
          if (/closed the wallet prompt/.test(msg)) stopped = "Skipped: you stopped the batch.";
        }
        onProgress?.(i + 1, items.length);
      }
      setHoldingsEpoch((e) => e + 1);
      setBusy(null);
      await refresh();
      return out;
    },
    claimMany: async (items, onProgress) => {
      setError(null);
      setBusy("claim:batch");
      const out: ActionOutcome[] = [];
      let payer: PublicKey;
      try {
        payer = wallet ?? (await connectWallet());
      } catch (e) {
        setBusy(null);
        return items.map((it) => ({ address: it.position.address, signature: null, error: friendly(e) }));
      }
      // Group by pool: a claim transaction is per pool.
      const byPool = new Map<string, { view: PoolView; positions: MyPosition[] }>();
      for (const it of items) {
        const g = byPool.get(it.view.config.slug) ?? { view: it.view, positions: [] };
        g.positions.push(it.position);
        byPool.set(it.view.config.slug, g);
      }
      let done = 0;
      let stopped = false;
      for (const { view, positions } of byPool.values()) {
        if (stopped) {
          for (const p of positions) out.push({ address: p.address, signature: null, error: "Skipped: you stopped the batch." });
          continue;
        }
        const res = await claimRewardsMany(
          payer,
          new PublicKey(view.config.address),
          positions.map((p) => new PublicKey(p.address)),
          (d) => onProgress?.(done + d, items.length)
        );
        for (const p of positions) {
          const r = res.get(p.address) ?? { signature: null, error: "No answer" };
          out.push({ address: p.address, signature: r.signature, error: r.error ? friendly(new Error(r.error)) : null });
          if (r.signature) setLastSignature(r.signature);
          if (r.error && /closed the wallet prompt|stopped the batch/.test(friendly(new Error(r.error)))) stopped = true;
        }
        done += positions.length;
      }
      setHoldingsEpoch((e) => e + 1);
      setBusy(null);
      await refresh();
      return out;
    },
    withdrawMany: async (items, onProgress) => {
      setError(null);
      setBusy("withdraw:batch");
      const out: ActionOutcome[] = [];
      let payer: PublicKey;
      try {
        payer = wallet ?? (await connectWallet());
      } catch (e) {
        setBusy(null);
        return items.map((it) => ({ address: it.position.address, signature: null, error: friendly(e) }));
      }
      let stopped: string | null = null;
      for (let i = 0; i < items.length; i++) {
        const { view, position } = items[i];
        if (stopped) {
          out.push({ address: position.address, signature: null, error: stopped });
          onProgress?.(i + 1, items.length);
          continue;
        }
        try {
          const sig = await withdrawCard(payer, new PublicKey(view.config.address), position, new PublicKey(view.pool.weightIndex));
          out.push({ address: position.address, signature: sig, error: null });
          setLastSignature(sig);
        } catch (e) {
          const msg = friendly(e);
          out.push({ address: position.address, signature: null, error: msg });
          if (/closed the wallet prompt/.test(msg)) stopped = "Skipped: you stopped the batch.";
        }
        onProgress?.(i + 1, items.length);
      }
      setHoldingsEpoch((e) => e + 1);
      setBusy(null);
      await refresh();
      return out;
    },
    withdraw: (view, position) =>
      run(`withdraw:${position.address}`, async () =>
        withdrawCard(wallet ?? (await connectWallet()), new PublicKey(view.config.address), position, new PublicKey(view.pool.weightIndex))
      ),
    claim: (view, position) =>
      run(`claim:${position.address}`, async () =>
        claimRewards(wallet ?? (await connectWallet()), new PublicKey(view.config.address), new PublicKey(position.address))
      ),
  };
}

/** Program errors and wallet refusals, said plainly. */
function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/User rejected|rejected the request|declined/i.test(msg)) return "You closed the wallet prompt. Nothing was sent.";
  if (/CreatorOnlyDeposits/.test(msg)) return "This is an own-stock pool: only its creator may deposit.";
  if (/CollectionNotAdmitted/.test(msg)) return "This card's collection is not admitted to the pool.";
  if (/Backing(Below|Above)(Collection)?(Minimum|Maximum)/.test(msg)) return "That backing is outside the pool's bounds for this collection.";
  if (/HeadRequestRequired|draw is open/i.test(msg)) return "A draw is in flight; try again in a few seconds.";
  if (/PositionNotActive|PositionStaged/.test(msg)) return "This card is not withdrawable right now (it was drawn, or is still staged behind an open draw).";
  if (/Not enough SOL/.test(msg)) return msg;
  if (/insufficient funds|Insufficient|insufficient lamports|^0x1$|custom program error: 0x1\b/i.test(msg))
    return "Not enough SOL in your wallet: a deposit locks the backing you chose plus about 0.006 SOL rent per card and fees. Top up or lower the backing.";
  if (/AlreadyInUse|already in use|^0x0$/.test(msg)) return "This card is already in the pool.";
  if (/blockhash|expired|block height exceeded/i.test(msg)) return "The network was slow and the transaction expired before it landed. Nothing was sent; try again.";
  return msg;
}
