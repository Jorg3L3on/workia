import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
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
