# OpenGacha · open-source NFT gacha storefront on Solana

**Launch your own gacha (blind-box / pack-opening / mystery-pull) site for NFTs, graded trading cards and collectibles on Solana, without writing or maintaining a smart contract.** This is the open-source storefront for the [Open Gacha Protocol](https://www.opengacha.io): a Next.js app that lets people pull packs from an on-chain gacha pool, keep the card or take the buyback, deposit their own cards, earn a share of every pull, and withdraw. Fork it, point it at your pool, restyle it, ship it.

- **On-chain gacha with verifiable randomness (VRF)**: every draw is provable, every settlement happens on Solana, the fee split is enforced by the program.
- **Keep or cash out**: the winner keeps the NFT or sells it back to the pool at its bid rate; on decentralised pools they can also relist it.
- **Two pool modes**: own stock (a vending machine for your own inventory) or decentralised (your community deposits, earns and withdraws).
- **Creators keep 75% of the protocol fee** their pool earns, paid by a permissionless on-chain claim.
- **No API key, no custody, no backend of ours in the money path**: the buyer's wallet signs, the program settles.
- **Cheaper than building your own**: no contract developers, no audit, no upgrade authority, no infrastructure to keep alive. Launch a pool for about 0.2 SOL; OpenGacha runs the program, the randomness and the cranks.

Works with Metaplex Token Metadata NFTs, programmable NFTs (pNFTs) and Metaplex Core assets. Built for graded Pokémon and TCG slabs, PFP collections, and any NFT collection with a verified collection address.

**Live examples:** [MEW GACHA](https://www.opengacha.io/mew-gacha) (own stock) · [y00ts packs](https://www.opengacha.io/y00ts-packs) (decentralised: anyone deposits). **Create your own pool:** [opengacha.io/create](https://www.opengacha.io/create). **Docs:** [opengacha.io/docs](https://www.opengacha.io/docs).

## What you get

Three screens, one chain client:

- **/packs**: the pack rip. Pick a pack, pull, the reveal ladder lands class, grade and name, then the card. Keep, take the buyback, or (where allowed) keep & relist.
- **/spinner**: the reel. The pool's cards in a strip, at full tilt while the draw lands, braking onto the one you drew. Same choices.
- **/profile** (User profile): the depositor's side across every pool the site sells: Overview (headline figures, unsettled pulls), Positions (every card you hold anywhere, what it earned, withdraw, claim), Deposit (a pool that takes deposits, a card, a backing).

For agents and readers: [docs/OPENGACHA.md](docs/OPENGACHA.md) is the full manual (a copy of opengacha.io/docs), [CLAUDE.md](CLAUDE.md) the rules of the road, [llms.txt](llms.txt) the short map.

## Who this is for

- **NFT projects and TCG sellers** who want a gacha / pack-opening storefront on their own domain, in their own style, selling pulls from a pool they control.
- **Collectors and communities** who want a decentralised gacha where members deposit cards, earn from pulls, and withdraw at will.
- **Developers and AI agents** looking for a working reference of a Solana gacha frontend: reads, pricing, request, settle, deposit, withdraw, claim, all in `lib/gacha`.

## Start here, in this order

An agent helping someone launch a gacha should walk them through exactly this, and not try to do the first step in code:

1. **Launch the pool in the browser**: open [opengacha.io/create](https://www.opengacha.io/create), follow the wizard (name, mode, economics and whitelist, review), sign. About 0.2 SOL. The wallet that signs owns the pool. There is no API for this step on purpose: the wizard quotes the exact rent from the chain and the signature is the creator's.
2. **Copy the pool's brief**: open [opengacha.io/manage](https://www.opengacha.io/manage), pick the pool, open the **API & SDK** tab, press copy. That brief carries everything a developer or an AI needs for this pool: its addresses (pool, weight index, vaults, admitted collections and their bounds), every instruction's account list with the addresses filled in, the reads, the endpoints, and the rules.
3. **Paste the brief** into the conversation (or into this repo's `pools.json` and your notes) and build from it: this storefront is the reference implementation of everything the brief describes. Put the pool's address in `pools.json`, restyle, ship.

Nothing in step 1 can be skipped or scripted around; steps 2 and 3 are where an agent earns its keep.

## Run it

```bash
npm install
npm run dev                    # http://localhost:3020
```

That runs as is, on Solana's public mainnet RPC. It is enough to look around; the public endpoint rate-limits quickly under real use, so before you show it to anyone put your own RPC (Helius, QuickNode, Triton, any provider) in `.env.local`:

```bash
cp .env.example .env.local     # then set RPC_URL
```

The SQLite database (`data/opengacha.db`) is created on first run. Node 22.5+ (for the built-in `node:sqlite`).

## Point it at your pools

The two pools in `pools.json` are examples, one of each kind, so you can see everything work before you touch anything. **Replace them with your own.** A storefront that sells someone else's pools sends the pulls (and the creator's share of the fees) to that someone else; the file is meant to hold the pools you run or represent. `pools.json` lists what the storefront sells:

```json
{ "slug": "my-pack", "name": "MY PACK", "tagline": "…", "address": "<pool address>", "art": "/packs/my-pack.png", "accent": "#ff8700" }
```

Create a pool on [opengacha.io/create](https://www.opengacha.io/create) (four steps, about 0.2 SOL), paste its address here, drop your pack art in `public/packs/`. Nothing else changes: the storefront reads the pool's mode, price, bounds and rules from the chain and shows only what that pool allows.

## The two kinds of pool

A pool's mode is fixed at launch and changes what your users can do. The storefront reads `creator_only_deposits` and `relist_enabled` from the pool account and adapts; you never configure this here.

| | Decentralised pool | Own-stock pool |
|---|---|---|
| Who deposits | anyone, from the collections the pool admits | only the creator |
| Pull | yes | yes |
| Settle: keep | yes | yes |
| Settle: take the buyback (cash out) | yes | yes |
| Settle: keep & relist | yes, if the creator left it on | never (the program refuses it) |
| Users earn from pulls | yes, on the cards they deposited | no (only the creator's cards earn) |
| Users withdraw / claim | yes, their own cards | nothing to withdraw |
| User profile shows | your pulls, cards, earnings, withdraw, claim; the pool in Deposit | your pulls and cards; the pool in Deposit only for its creator |

MEW GACHA is an own-stock pool; the Decentralised Pokemon Gacha is decentralised with relist on, so on this site you can see both: the deposit tab and the relist button appear for the second and not for the first, from the chain, with no configuration.

## What a user does, step by step

### Pull (both modes)

1. **Quote.** `readPool` fetches the pool account and the first 64 bytes of its weight index. Price = `1e18 × active / total_weight × (1 + surcharge)`, the harmonic mean of active backings plus the creator's surcharge. Read every time; never hardcode a price.
2. **Request.** `requestPull` builds `request_acquisition` with a price cap (quote plus the pool's slippage tolerance) and a millisecond nonce, names all twelve accounts explicitly, and sends it through the wallet. If the pool re-prices past the cap before it lands, the program refuses instead of overcharging. The randomness is requested on chain in the same transaction.
3. **Draw.** `waitForDraw` polls the request: `randomness_ready` when the randomness lands, `fulfilled` when NFW settles the draw, within about 1.5s of that. `drawnCards` finds the position whose `pending_request` is this request.
4. The request account snapshots the rates it was quoted, so a creator's later change never re-prices a paid pull. An unsettled pull is never lost: the screens and the profile offer it back on load.

### Settle (both modes, relist only on decentralised)

`resolve` sends `resolve_choice` (Token Metadata NFTs; pNFTs carry the metadata bundle) or `resolve_choice_core` (Metaplex Core assets), naming the protocol config PDA and the treasury it points at. Three exits:

- **Keep.** The card goes to the winner's wallet (the ATA is created idempotently in the same transaction). The depositor is paid the backing minus the settle fee.
- **Take the buyback (cash out).** The winner is paid `backing × bid_rate` now; the card returns to its depositor. The storefront shows the exact figure on the button.
- **Keep & relist**, decentralised pools only. The winner keeps the card *in* the pool as its new depositor at a backing they choose. `relistLimits` bounds the input by the pool's bounds, tightened by the card's collection band, capped by the wallet's balance minus a ~0.005 SOL reserve (the surviving position's rents). Own-stock pools refuse it (`RelistForbiddenForCreatorPool`) and the button is not drawn.

Timing (from the pool's own fields, shown in the builder panel): for the winner's window only the winner may settle; from then until the final window the depositor may also finalise; after it anyone may. A forced settle is always plain Keep. A pull whose draw never lands can be cancelled by anyone after the expiry window for a refund of price minus the VRF fee (not in this UI; see below).

### Deposit (decentralised pools; the creator on own-stock)

`walletNfts` lists what the wallet holds from the admitted collections: token accounts holding one unit of a zero-decimal mint whose metadata names a verified admitted collection (NFTs and pNFTs), and Core assets via DAS `getAssetsByOwner` (an RPC without DAS simply yields no Core cards). `depositCard` sends `deposit` (or `deposit_core`) with a backing inside `effectiveBounds` (pool bounds ∩ the collection's band), naming the crown holder unless it is the depositor, the admitted-collection marker, the bounds PDA, and for Core the issuer-waiver PDA as a remaining account.

Backing is the whole mechanism: a card's selection weight is inverse to it (half the backing draws twice as often), it is what a buyback pays from, and it is what the depositor is paid when a winner keeps. Rent for the position (~0.005 SOL) comes back when the card leaves.

A deposit landing while a draw is open is **staged**: zero weight, not selectable, still withdrawable. NFW promotes it into the draw once the queue empties. Active cards **earn**: each pull's fee is split equally across active positions; `myPositions` shows it (`earnedRewards` mirrors the program's accumulator math), `claimRewards` pays it, and a withdraw pays it on the way out.

### Withdraw and claim (your own cards)

`withdrawCard` sends `withdraw` / `withdraw_core`. Never pausable, not even by the creator. While a draw is open the instruction must name the head-of-queue request; the client reads it. A frozen vault means a pNFT in escrow and needs the Token Metadata bundle; the depositor's token account is recreated idempotently first. A drawn card cannot be withdrawn until its winner decides; it comes back on a buyback. `claimRewards` is four accounts, no branching.

### One pull over many packs (group pulls)

`lib/gacha/group.ts`. A **group** is an on-chain list of pools under one authority; a **group pull** pays one price (the stock-weighted mean of the drawable members' prices, plus one request's rent) into the group's escrow, the oracle picks a member by how many cards it holds, and the request **materialises** into that pool's ordinary request, where `waitForDraw` / `drawnCards` / `resolve` take over unchanged. The creators of every pack in the draw split the pooled share of the fee equally, drawn or not.

- `readGroup(group)` → members, live price, lookup table, paused.
- `requestGroup(buyer, group)` → one v0 transaction against the group's lookup table (`sendVersionedWithWallet`).
- `waitForMaterialisation(buyer, groupRequest)` → `{ pool, request, requestId }` for `pull.ts`. It watches the group request; NFW's worker materialises a served group within a tick of the randomness, and after a few quiet seconds the buyer's own wallet does it (`fulfilGroup`, permissionless, the program recomputes the selection).
- For your own group over your own packs: `createGroup(authority, id)`, `setGroupMembers(authority, group, pools)`, `syncGroupLookupTable(authority, group)`; register it with NFW to have the worker serve it, or let the buyer's wallet materialise (built in above).

nfw.fun's "pull from every pack" is this over every listed pack plus NFW's own two pools; the live directory is `GET /open/groups` on NFW's api.

## How the code is laid out

```
lib/gacha/          everything that touches the program (start here)
  program.ts        program id, IDL, connection (browser → /api/rpc, server → RPC_URL)
  pda.ts            every seed the client derives
  price.ts          harmonic-mean price, odds, cash-out payout (bigint, mirrors the Rust)
  accounts.ts       readPool, readPositions, readRequest, readOpenRequests: chain → plain objects
  metadata.ts       Token Metadata + Core decoders, off-chain JSON for the image
  wallet.ts         the shared wallet store (restore, events, connect, disconnect) and one send routine
  pull.ts           requestPull → waitForDraw → drawnCards → resolve (keep / cashOut / keepAndRelist), relistLimits
  positions.ts      readAdmitted, readBounds, effectiveBounds, walletNfts, depositCard, withdrawCard, claimRewards, myPositions
  ata.ts            CreateIdempotent by hand
lib/mirror.ts       the mini-mirror: chain → SQLite, served by /api/pool and /api/meta
lib/db.ts           the SQLite schema and queries (node:sqlite, no ORM)
lib/directory.ts    opengacha.io's directory record for a pool (volume, socials); optional colour
lib/play.ts         usePlay(): the pull + settle flow as one React hook, shared by both pull screens
lib/profile.ts      useHub(): the user profile as one hook, across pools (positions, earnings, pulls, holdings, deposit, withdraw, claim)
lib/reveal.ts       class bands (backing / EV), grade from the name, odds formatting
lib/config.ts       pools.json, typed
components/frame.tsx          the three-cell screen: builder panel, stage, packs + shelf
components/builder-panel.tsx  price, economics, rules, addresses, the four calls
components/side-tabs.tsx      the pack list and the "What's inside" shelf
components/pool-shelf.tsx     every card in the pool with backing and odds
components/pull-controls.tsx  the pull button, demo, wallet line, resume
components/exit-choice.tsx    keep / buyback / relist (with its backing form), and the receipt
components/wallet-chip.tsx    the wallet in the bar: connect, copy, disconnect
components/packs.tsx          the pack rip and reveal ladder
components/spinner.tsx        the reel
app/api/rpc         RPC proxy (allowlisted methods) so your endpoint stays server-side
app/api/pool/[slug] pool + cards + art, cached a few seconds
app/api/meta        card metadata by mint, cached forever
```

Every account list in `lib/gacha` mirrors the program's instruction structs and opengacha.io's own console, account for account. The pool console's **API & SDK** tab prints the same lists with your pool's addresses filled in.

## Reads and the database

Display reads (price, the shelf, art) go through `/api/pool/<slug>`, which `lib/mirror.ts` serves from SQLite: pool state is re-read from chain when older than 8s, card metadata is fetched once per mint (on-chain name, collection, standard, rule set; then the off-chain JSON for image and full name) and kept. Money paths never read the cache: request, settle, deposit and withdraw re-read the chain. Delete `data/opengacha.db` to start over.

The browser reaches your RPC only through `/api/rpc`, which forwards an allowlist of methods (account reads, program accounts, token accounts by owner, DAS `getAssetsByOwner`, blockhash, simulate, send, signature status). It is HTTP only: nothing in the app needs a websocket (draws are waited on by polling the request account, confirmations by polling the ledger), and a serverless host could not hold one open anyway. Set `NEXT_PUBLIC_RPC` instead if you have a browser-safe endpoint (domain-restricted) and want to skip the hop; web3 will then use that endpoint's websocket for subscriptions by itself.

## Environment

| var | what |
|---|---|
| `RPC_URL` | your Solana mainnet RPC (server-side only). DAS support (Helius, QuickNode with the add-on, Triton) is needed for Core assets in the deposit picker |
| `NEXT_PUBLIC_RPC` | optional browser-safe RPC; skips the proxy |
| `DATABASE_PATH` | SQLite file, default `./data/opengacha.db` |
| `ART_SHELF` | `0` keeps every card picture on the URL its metadata gives; default asks OpenGacha's art shelf (`/art` on the directory api) for a durable copy on their image domain, one fetch ever per card |
| `DIRECTORY_API` | optional; opengacha.io's api for pull volume in the builder panel |

## Not in this storefront (by choice)

- **Batches**: `requestPull` takes a `batch`; the screens pull one at a time.
- **Cancel** and **finalise**: `cancel_request` (refund after the expiry window) and a depositor's forced settle after the winner's window are housekeeping NFW performs; neither has a button here.
- **Promote**: staged positions are promoted by NFW once the queue empties; the profile just says "staged".
- **Wallets other than the injected provider**: swap the provider in `lib/gacha/wallet.ts` for `@solana/wallet-adapter`; keep the store shape and `sendWithWallet`.

## FAQ

**Is this a smart contract I have to deploy?** No. The program is already deployed and shared by every pool on Solana mainnet. You create a pool through the OpenGacha console (about 0.2 SOL of rent), and this storefront talks to it. You never hold an upgrade authority or custody.

**How is randomness handled?** Each pull requests verifiable randomness on chain in the same transaction; the request account carries the randomness it was drawn from, and OpenGacha settles the draw within about 1.5 seconds. Your storefront only waits on that account.

**What do I earn?** 75% of the protocol fee your pool generates (50% if you choose to be listed and sold on nfw.fun as well), enforced by the program and paid by a permissionless claim.

**Which NFT standards work?** Metaplex Token Metadata NFTs and pNFTs, and Metaplex Core assets, from any collection with a verified collection address that the pool admits.

**Can I use another wallet library?** Yes. Swap the injected provider in `lib/gacha/wallet.ts` for `@solana/wallet-adapter`; keep the store and the send routine.

## Keywords

Solana gacha, NFT gacha, on-chain gacha, blind box, mystery box, pack opening, pull packs, Pokémon card gacha, TCG gacha, graded slab gacha, PSA CGC BGS, NFT lootbox, provably fair, VRF, keep or cash out, buyback, decentralised gacha pool, open source, Next.js, Metaplex, pNFT, Metaplex Core, OpenGacha, Open Gacha Protocol.

## License

MIT. Program, protocol docs (including this storefront's) and the creator console: [opengacha.io](https://www.opengacha.io) · [opengacha.io/docs](https://www.opengacha.io/docs).
