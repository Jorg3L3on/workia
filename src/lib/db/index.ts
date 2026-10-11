import { neon, neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
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

/** Runs `fn` in one database transaction: everything commits together or rolls back. */
export const withTransaction = <T>(fn: (tx: DbTransaction) => Promise<T>) =>
  getTransactionalDb().transaction(fn);
