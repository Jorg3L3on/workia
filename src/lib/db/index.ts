import { neon, neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzleNeonPool } from "drizzle-orm/neon-serverless";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/env";

import * as schema from "./schema";

// Neon's HTTP driver only speaks to Neon; a plain local Postgres needs a TCP driver.
// Both expose the same query builder, so the app keeps typing against the Neon one.
const isLocalDatabase = ["localhost", "127.0.0.1", "[::1]"].includes(
  new URL(env.DATABASE_URL).hostname,
);

export const db: NeonHttpDatabase<typeof schema> = isLocalDatabase
  ? (drizzlePg(new Pool({ connectionString: env.DATABASE_URL }), {
      schema,
    }) as unknown as NeonHttpDatabase<typeof schema>)
  : drizzleNeon(neon(env.DATABASE_URL), { schema });

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Anything queries can run on: the shared client or an open transaction. */
export type DbExecutor = typeof db | DbTransaction;

// Reads keep using the stateless HTTP client above (no connection to manage).
// Transactions need a session, so they use a lazily created WebSocket pool on
// Neon (or the TCP pool when the database is local).
let transactionalDb: NeonHttpDatabase<typeof schema> | undefined;

const getTransactionalDb = () => {
  if (transactionalDb) {
    return transactionalDb;
  }

  if (isLocalDatabase) {
    transactionalDb = db;
    return transactionalDb;
  }

  if (typeof WebSocket === "undefined") {
    throw new Error(
      "Transactions on Neon need a runtime with a global WebSocket (Node 22+).",
    );
  }

  neonConfig.webSocketConstructor = WebSocket;

  transactionalDb = drizzleNeonPool(
    new NeonPool({ connectionString: env.DATABASE_URL }),
    { schema },
  ) as unknown as NeonHttpDatabase<typeof schema>;

  return transactionalDb;
};

/**
 * Row-level security (WRK-I4-19). With DATABASE_RLS=1 the app connects as a
 * role without BYPASSRLS and every business query runs in a transaction that
 * first sets `app.company_id`, which the policies of migration 0018 compare
 * against each row. Off by default: business queries then go to `db` directly.
 */
export const rlsEnabled = () => process.env.DATABASE_RLS === "1";

const setCompany = (tx: DbTransaction, companyId: string) =>
  tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);

/**
 * Runs `fn` in one database transaction: everything commits together or rolls
 * back. With `companyId`, row-level security sees that company inside it.
 */
export const withTransaction = <T>(
  fn: (tx: DbTransaction) => Promise<T>,
  companyId?: string,
) =>
  getTransactionalDb().transaction(async (tx) => {
    if (companyId && rlsEnabled()) {
      await setCompany(tx, companyId);
    }

    return fn(tx);
  });

type ChainStep = [method: PropertyKey, args: unknown[]];

/**
 * A query builder that records its chain (select().from().where()...) and,
 * once awaited, replays it on a transaction scoped to the company.
 */
const scopedChain = (companyId: string, steps: ChainStep[]): unknown => {
  const run = () =>
    withTransaction(async (tx) => {
      let query: unknown = tx;

      for (const [method, args] of steps) {
        query = (query as Record<PropertyKey, (...a: unknown[]) => unknown>)[
          method
        ](...args);
      }

      return query;
    }, companyId);

  return new Proxy(() => {}, {
    get: (_target, property) => {
      if (property === "then") {
        return (
          resolve: (v: unknown) => unknown,
          reject: (e: unknown) => unknown,
        ) => run().then(resolve, reject);
      }

      if (property === "catch") {
        return (reject: (e: unknown) => unknown) => run().catch(reject);
      }

      if (property === "finally") {
        return (done: () => void) => run().finally(done);
      }

      return (...args: unknown[]) =>
        scopedChain(companyId, [...steps, [property, args]]);
    },
  });
};

/**
 * The client for business queries of `companyId`: the shared `db`, or with
 * row-level security on, one that runs each query scoped to the company.
 */
export const tdb = (companyId: string): typeof db =>
  rlsEnabled() ? (scopedChain(companyId, []) as typeof db) : db;
