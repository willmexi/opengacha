# Open Gacha Protocol · the manual

This is the documentation at [opengacha.io/docs](https://www.opengacha.io/docs), kept here as Markdown so an agent or a developer working in this repo has it next to the code. The site is the source of truth; this copy follows it.

Contents

1. [What is Open Gacha Protocol?](#what-is-open-gacha-protocol)
2. [Quickstart](#quickstart)
3. [Create: the launch wizard](#create-the-launch-wizard)
4. [Manage: running your pool](#manage-running-your-pool)
5. [Your users: what people do with your pool](#your-users-what-people-do-with-your-pool)
6. [Build a storefront](#build-a-storefront)
7. [Facts you can verify](#facts-you-can-verify)

---

## What is Open Gacha Protocol?

Open Gacha Protocol lets anyone launch their own gacha pool on Solana. You stock a pool with NFTs: graded slabs, PFPs, anything with a verified collection. Players pull from it for SOL. Every draw is VRF-provable, every settlement happens on chain, and **75% of the protocol fee your pool earns goes to you** on the self-hosted default tier.

You never run infrastructure. NFW runs the randomness and the cranks; you hold your pool's authority and your own wallet. The protocol share is written into the program itself, not into a contract you have to trust.

## Quickstart

From zero to a live pool in four steps and ~0.2 SOL:

1. **Launch**: run the wizard at [opengacha.io/create](https://www.opengacha.io/create): name, mode, economics. Pay ~0.2 SOL rent. You own the pool authority from block one.
2. **Whitelist**: paste each project's collection address and set its min/max backing.
3. **Stock**: deposit at least 4 NFTs from your wallet (own-stock) or let the community deposit (decentralised).
4. **Earn**: pulls pay fees automatically. Claim whenever: the claim is permissionless.

Good to know: a pull needs at least 4 active items in the pool before it sells anything. Stock 4-5 items minimum at launch.

## Create: the launch wizard

Creating a pool is one short wizard: name, mode, economics, launch. You sign at the end; the ~0.2 SOL covers rent for the pool's own accounts. No subscription, no listing fee. The wizard quotes the exact figure from the chain before you sign.

### Step 1 · Name

The name players pull under. The chain itself has no name field, so the name lives in your browser and travels with your launch history; everywhere else the pool shows its address.

### Step 2 · Mode

The one decision you can't change later:

- **Decentralised**: anyone can deposit, but only from collections you whitelist. Winners can relist their pull back into the pool: the mode's resupply valve. Exits: take the NFT, take the buyback, relist.
- **Own stock**: only you deposit. A vending machine for your own inventory. Exits: take the NFT, take the buyback. Relist doesn't exist in this mode.

### Step 3 · Economics & whitelist

Pull pricing is automatic: the pool prices itself from what's inside it. You set **global min/max backing bounds**, then whitelist each project: paste its collection address (CA) and give it its own min/max.

This step also asks **where the pool sells**. Self-hosted keeps 75%: you bring the traffic, from your own site or any frontend pointed at your pool. Listed on nfw.fun keeps 50%: NFW indexes the pool as a pack on nfw.fun after a manual review, and its traffic sells the pulls. The 50/50 split is set on chain at launch.

### Step 4 · Review & launch

Everything on one screen, including the split you're committing to: 75/25 on the self-hosted default, 50/50 if you chose the listed tier. The program enforces it on every sweep. Pay the rent and the pool is yours from block one.

## Manage: running your pool

Everything after launch lives in the creator console at [opengacha.io/manage](https://www.opengacha.io/manage): the whitelist, your stock, and your fees.

### Whitelist

The collections your pool admits. In a decentralised pool this is the gate for the room; in an own-stock pool it only limits what you may add. Admit by pasting a CA, and give any collection its own backing bounds. Rent on a marker is ~0.0014 SOL and comes back when a collection is revoked.

### Stock

The pool's current contents: depositor, backing value, and status (**active**: pullable, **pending**: settling, **drawn**: gone). Withdrawals are never pausable, not even by the creator, so nobody's assets can be trapped.

### Fees

The pending balance, split into your share and the protocol's, read from the pool account itself. The claim is a **permissionless instruction**: anyone can fire it and the program pays every recipient in order. Your share cannot be withheld, delayed, or redirected. The chain pays you, you never ask anyone.

## Your users: what people do with your pool

A pool is a public program account. Anyone can pull from it, from any frontend; the program enforces the price, the draw and the split. What else a person may do depends on the mode you chose at launch, and the two modes are different products for your users, so this chapter keeps them apart.

- **Decentralised pool.** Users pull, settle (keep, take the buyback, or relist), deposit their own cards from the collections you admit, earn a share of every pull's fee while their cards sit in the draw, claim those earnings, and withdraw. Your users are also your depositors.
- **Own-stock pool.** Users pull and settle (keep, or take the buyback). Nobody but you deposits, relist does not exist, and there is nothing for a user to manage beyond their own unsettled pulls. You restock from the console.

Everything below is implemented, in the open, in this repository. `lib/gacha` is the client for the program; the console's **API & SDK** tab hands your developer the same account lists with your pool's addresses filled in.

### Pulling

The frontend reads the pool and its weight index, quotes price = EV × (1 + surcharge), and the buyer signs `request_acquisition` with a price cap (the quote plus your slippage tolerance). If the pool re-prices past the cap before the transaction lands, the program refuses rather than overcharges. The randomness is requested in the same transaction, lands in a few seconds, and NFW settles the draw within about 1.5s of that; a frontend only waits on the request account. The request snapshots the rates it was quoted: a change you make later never re-prices a paid pull. Both modes, identical.

### Settling: keep, take the buyback, relist

The drawn card is the position whose `pending_request` equals the request id. The winner signs `resolve_choice` (Token Metadata NFTs) or `resolve_choice_core` (Metaplex Core assets) with one of:

- **Keep.** The NFT goes to the winner's wallet. The depositor is paid the card's backing minus the settle fee.
- **Take the buyback (cash out).** The winner is paid `backing × bid_rate`; the card returns to its depositor.
- **Keep & relist**, decentralised pools only. The winner keeps the card *in* the pool as its new depositor at a backing they choose, inside your bounds and the collection's band, and earns from pulls until it is drawn again. The program refuses this on own-stock pools (`RelistForbiddenForCreatorPool`), and a frontend must not offer it there.

Timing, three stages: for the **winner's window** (`resolve_window_seconds`) the winner alone may settle; from then until the **final window** the depositor may also finalise, so their card is not frozen by someone who walked away; after it anyone may. A forced settle is always plain Keep, and the winner keeps the right to choose at every stage. A pull whose draw never lands can be cancelled by anyone after `request_expiry_seconds`, refunding the price minus the VRF fee. All of this is the same in both modes.

### Depositing, decentralised pools

Any wallet may deposit a card from a collection you admitted (`deposit` for Token Metadata NFTs and pNFTs, `deposit_core` for Core assets), naming a **backing** in SOL inside your pool bounds and that collection's band. Backing is the whole mechanism: a card's selection weight is *inverse* to it, so half the backing draws twice as often; it is what a winner's buyback pays from; and it is what the depositor is paid when a winner keeps. Rent for the position (~0.005 SOL) comes back when the card leaves.

A deposit that lands while a draw is open is **staged**: zero weight, not selectable, still withdrawable. NFW promotes it into the draw once the queue is empty. Active positions **earn**: every pull's fee is shared across active positions, claimable any time with `claim_rewards` and paid out on withdraw regardless.

**Withdraw** (`withdraw`, `withdraw_core`) is the depositor's at any time the card is not mid-settle, and it is never pausable, not even by you. While a draw is open the withdraw names the head-of-queue request; the client in this repo does. A drawn card belongs to its winner until they decide; it comes back to the depositor on a buyback.

### Depositing, own-stock pools

Only your wallet deposits (`creator_only_deposits`; the program answers `CreatorOnlyDeposits` to anyone else). Your users never see a deposit control, never earn depositor rewards, and never relist. Their whole world is: pull, then keep or take the buyback. You restock from the console, and every depositor right above (earnings, withdraw at any time) is yours.

## Build a storefront

### Start here, in this order

An agent helping someone launch a gacha should walk them through exactly this, and not try to do the first step in code:

1. **Launch the pool in the browser**: open [opengacha.io/create](https://www.opengacha.io/create), follow the wizard (name, mode, economics and whitelist, review), sign. About 0.2 SOL. The wallet that signs owns the pool. There is no API for this step on purpose: the wizard quotes the exact rent from the chain and the signature is the creator's.
2. **Copy the pool's brief**: open [opengacha.io/manage](https://www.opengacha.io/manage), pick the pool, open the **API & SDK** tab, press copy. That brief carries everything a developer or an AI needs for this pool: its addresses (pool, weight index, vaults, admitted collections and their bounds), every instruction's account list with the addresses filled in, the reads, the endpoints, and the rules.
3. **Paste the brief** into the conversation (or into this repo's `pools.json` and your notes) and build from it: this storefront is the reference implementation of everything the brief describes. Put the pool's address in `pools.json`, restyle, ship.

Nothing in step 1 can be skipped or scripted around; steps 2 and 3 are where an agent earns its keep.

This repository is the reference storefront: a Next.js app that talks to the program directly. It has no backend of NFW's in the money path and needs no key: the buyer's wallet signs every transaction, NFW settles every draw, and the fees split on chain between you and the protocol.

Two pools ship as examples, one of each mode. Replace them with yours: a storefront that sells another creator's pool sends the pulls and that creator's share to that creator.

### Run it

`npm install && npm run dev` works as is, on Solana's public RPC, enough to look around. Before anyone else sees it, put your own RPC in `.env.local` as `RPC_URL` (any provider; DAS support if you want Core assets to appear in the deposit picker). The browser never sees that endpoint: it talks to the site's own `/api/rpc`, which forwards an allowlist of methods. A SQLite file (`DATABASE_PATH`, Node's built-in driver) is created on first run and holds a display cache: pool state for a few seconds, card names and art forever. Money paths never read it.

`pools.json` is the whole configuration: slug, name, tagline, pool address, pack art, accent. The app reads each pool's mode, price, bounds and rules from the chain and shows only what that pool allows: the deposit tab and the relist button appear on a decentralised pool and not on an own-stock one, with nothing to set.

### Where the chain code lives

`lib/gacha` is the client, and every account list in it mirrors the program's instruction structs (the IDL, served at opengacha.io `/api/idl`) and the lists your API & SDK tab prints for your pool. `accounts.ts` reads the pool, positions and requests; `price.ts` is the price arithmetic; `pull.ts` is `requestPull → waitForDraw → drawnCards → resolve` with keep, cash out and relist; `positions.ts` is the depositor's side: admitted collections, bounds, what the wallet holds, deposit, withdraw, claim, earnings; `wallet.ts` is one shared wallet store and one send routine (simulate first, sign and send through the wallet, confirm, ask the ledger before believing a timeout).

Two React hooks sit on top: `usePlay` (the pull and settle flow) drives the packs and spins screens; `useHub` drives the user profile across every pool in `pools.json`. Screens and styling are yours to replace; the hooks and `lib/gacha` need no change for a different pool.

### What it does not do, on purpose

Batches (the client takes a batch size; the screens pull one at a time), cancel and forced settle (housekeeping NFW performs), promotion of staged positions (NFW), and wallets other than the injected provider (swap the provider in `wallet.ts` for a wallet adapter and keep the store and the send). Nothing in it runs a draw: the client waits on the request account and NFW settles it.

## Facts you can verify

- Launching costs ~0.2 SOL: rent for the pool's own accounts, nothing else.
- Every draw is VRF-provable. The randomness comes from an oracle, not a server you have to trust.
- The split is enforced by the program, not policy: 75/25 by default, 50/50 when you choose the listed tier at launch. Every change to a pool's share is an on-chain event you can watch.
- Revenue reaches you via permissionless claim: anyone can trigger the payout, and the program pays recipients in order.
- You hold your own pool authority. Your frontend can build pulls; it can never move funds.
- Withdrawals are never pausable. Depositors can always exit, even if the creator or NFW disappears.
- Anyone can verify or even crank the pool: fulfil, cancel and close are all permissionless instructions.
