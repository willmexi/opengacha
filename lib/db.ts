/**
 * The local database: one SQLite file, Node's built-in driver, no ORM.
 *
 * It is a display cache, not a source of truth. The chain is asked for
 * anything that decides money; this file remembers what the chain said so
 * the storefront paints instantly and your RPC is not hit once per visitor
 * per card. Three tables:
 *
 *   pools      the last PoolInfo per pool, as JSON, with when it was read
 *   positions  the last position set per pool
 *   nft_meta   name, image, collection and settle facts per mint (these
 *              never change for a mint, so they are fetched once)
 *
 * Server-only (route handlers). Delete the file to start over.
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

let handle: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (handle) return handle;
  const path = resolve(process.cwd(), process.env.DATABASE_PATH || "./data/opengacha.db");
  mkdirSync(dirname(path), { recursive: true });
  handle = new DatabaseSync(path);
  handle.exec(`
    pragma journal_mode = wal;
    create table if not exists pools (
      address     text primary key,
      info        text not null,
      fetched_at  integer not null
    );
    create table if not exists positions (
      pool            text not null,
      address         text primary key,
      mint            text not null,
      depositor       text not null,
      position_id     integer not null,
      backing         text not null,
      slot_index      integer not null,
      status          text not null,
      pending_request integer,
      standard        integer not null,
      odds            real not null,
      updated_at      integer not null
    );
    create index if not exists positions_pool on positions(pool);
    create table if not exists nft_sale (
      mint       text primary key,
      usd        real,
      lamports   text,
      at         integer,
      checked_at integer not null
    );
    create table if not exists nft_meta (
      mint           text primary key,
      name           text not null,
      image          text,
      uri            text not null,
      collection     text,
      token_standard integer,
      rule_set       text,
      core           integer not null,
      fetched_at     integer not null
    );
  `);
  // A column that arrived after the first release: added to databases
  // created before it, harmless on new ones.
  const cols = handle.prepare("pragma table_info(nft_meta)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "insured_usd")) {
    // Rows fetched before the column exist without it; mark them stale so
    // the next request re-reads their JSON once.
    handle.exec("alter table nft_meta add column insured_usd real; update nft_meta set fetched_at = 0");
  }
  return handle;
}

// ---------------------------------------------------------------- pools

export interface StoredPool<T> {
  info: T;
  fetchedAt: number;
}

export function getPool<T>(address: string): StoredPool<T> | null {
  const row = db().prepare("select info, fetched_at from pools where address = ?").get(address) as
    | { info: string; fetched_at: number }
    | undefined;
  return row ? { info: JSON.parse(row.info) as T, fetchedAt: row.fetched_at } : null;
}

export function putPool(address: string, info: unknown): void {
  db()
    .prepare("insert or replace into pools (address, info, fetched_at) values (?, ?, ?)")
    .run(address, JSON.stringify(info), Date.now());
}

// ------------------------------------------------------------ positions

export interface StoredPosition {
  pool: string;
  address: string;
  mint: string;
  depositor: string;
  positionId: number;
  backing: string;
  slotIndex: number;
  status: string;
  pendingRequest: number | null;
  standard: number;
  odds: number;
}

export function getPositions(pool: string): StoredPosition[] {
  const rows = db()
    .prepare("select * from positions where pool = ? order by position_id")
    .all(pool) as Record<string, unknown>[];
  return rows.map((r) => ({
    pool: r.pool as string,
    address: r.address as string,
    mint: r.mint as string,
    depositor: r.depositor as string,
    positionId: r.position_id as number,
    backing: r.backing as string,
    slotIndex: r.slot_index as number,
    status: r.status as string,
    pendingRequest: (r.pending_request as number | null) ?? null,
    standard: r.standard as number,
    odds: r.odds as number,
  }));
}

/** Replace a pool's whole position set: what the chain has now is the truth. */
export function putPositions(pool: string, rows: StoredPosition[]): void {
  const d = db();
  const insert = d.prepare(`
    insert or replace into positions
      (pool, address, mint, depositor, position_id, backing, slot_index, status, pending_request, standard, odds, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  d.exec("begin");
  try {
    d.prepare("delete from positions where pool = ?").run(pool);
    const now = Date.now();
    for (const r of rows) {
      insert.run(
        pool, r.address, r.mint, r.depositor, r.positionId, r.backing, r.slotIndex,
        r.status, r.pendingRequest, r.standard, r.odds, now
      );
    }
    d.exec("commit");
  } catch (e) {
    d.exec("rollback");
    throw e;
  }
}

// ------------------------------------------------------------- nft_meta

export interface StoredMeta {
  mint: string;
  name: string;
  image: string | null;
  uri: string;
  collection: string | null;
  tokenStandard: number | null;
  ruleSet: string | null;
  core: boolean;
  /** The issuer's insured value in USD, when the metadata carries one. */
  insuredUsd: number | null;
  /** 0 marks a row written before a column existed: read the JSON again. */
  fetchedAt: number;
}

export function getMetas(mints: string[]): Map<string, StoredMeta> {
  const out = new Map<string, StoredMeta>();
  if (mints.length === 0) return out;
  const marks = mints.map(() => "?").join(",");
  const rows = db().prepare(`select * from nft_meta where mint in (${marks})`).all(...mints) as Record<
    string,
    unknown
  >[];
  for (const r of rows) {
    out.set(r.mint as string, {
      mint: r.mint as string,
      name: r.name as string,
      image: (r.image as string | null) ?? null,
      uri: r.uri as string,
      collection: (r.collection as string | null) ?? null,
      tokenStandard: (r.token_standard as number | null) ?? null,
      ruleSet: (r.rule_set as string | null) ?? null,
      core: Boolean(r.core),
      insuredUsd: (r.insured_usd as number | null) ?? null,
      fetchedAt: (r.fetched_at as number) ?? 0,
    });
  }
  return out;
}

export function putMeta(m: StoredMeta): void {
  db()
    .prepare(
      `insert or replace into nft_meta
        (mint, name, image, uri, collection, token_standard, rule_set, core, insured_usd, fetched_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(m.mint, m.name, m.image, m.uri, m.collection, m.tokenStandard, m.ruleSet, m.core ? 1 : 0, m.insuredUsd, Date.now());
}

// ------------------------------------------------------------- last sales

/** A card's last sale as the walk found it (null = walked, none found),
 * with when it was checked; the caller decides how long each answer keeps. */
export function getSale(mint: string): { sale: { usd: number | null; lamports: string | null; at: number } | null; checkedAt: number } | null {
  const r = db().prepare("select usd, lamports, at, checked_at from nft_sale where mint = ?").get(mint) as
    | { usd: number | null; lamports: string | null; at: number | null; checked_at: number }
    | undefined;
  if (!r) return null;
  const none = r.usd === null && r.lamports === null;
  return { sale: none ? null : { usd: r.usd, lamports: r.lamports, at: r.at ?? 0 }, checkedAt: r.checked_at };
}

export function putSale(mint: string, sale: { usd: number | null; lamports: string | null; at: number } | null): void {
  db()
    .prepare("insert or replace into nft_sale (mint, usd, lamports, at, checked_at) values (?, ?, ?, ?, ?)")
    .run(mint, sale?.usd ?? null, sale?.lamports ?? null, sale?.at ?? null, Date.now());
}
