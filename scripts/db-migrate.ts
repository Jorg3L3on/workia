/**
 * Applies pending migrations from drizzle/ and records each one by tag in
 * drizzle.applied_migrations. See docs/migrations.md.
 *
 *   npm run db:migrate                         apply pending migrations
 *   npm run db:migrate -- --status             list applied and pending, change nothing
 *   npm run db:migrate -- --baseline 0014      record 0000..0014 as applied without running them
 *
 * A database that is not on this machine also needs --confirm-host <hostname>,
 * so production is never touched by accident.
 */

import { config } from "dotenv";
import path from "node:path";
import { Client } from "pg";

import {
  applyPending,
  baseline,
  ensureRegistry,
  migrationsThrough,
  planMigrations,
  readApplied,
  readMigrations,
} from "@/lib/db/migrations/registry";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);

  return index === -1 ? undefined : process.argv[index + 1];
};

const main = async () => {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  const { hostname, pathname } = new URL(url);
  const target = `${hostname}${pathname}`;

  if (
    !LOCAL_HOSTS.includes(hostname) &&
    argValue("--confirm-host") !== hostname
  ) {
    throw new Error(
      `DATABASE_URL points to ${hostname}, which is not local. Pass --confirm-host ${hostname} if that is intended.`,
    );
  }

  const migrations = readMigrations(path.join(process.cwd(), "drizzle"));
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    if (process.argv.includes("--status")) {
      await ensureRegistry(client);
      const applied = await readApplied(client);
      const plan = planMigrations(migrations, applied);

      console.log(`Migrations on ${target}:`);
      for (const row of applied) {
        console.log(
          `  ${row.mode.padEnd(8)} ${row.tag}  ${row.appliedAt.toISOString()}`,
        );
      }
      for (const migration of plan.pending) {
        console.log(`  pending  ${migration.tag}`);
      }
      for (const row of plan.changed) {
        console.log(`  CHANGED  ${row.tag} (file edited after it was applied)`);
      }
      for (const tag of plan.unknown) {
        console.log(`  UNKNOWN  ${tag} (in the registry, not in drizzle/)`);
      }
      return;
    }

    const through = argValue("--baseline");

    if (through) {
      const tags = await baseline(
        client,
        migrationsThrough(migrations, through),
        (line) => console.log(line),
      );
      console.log(`Baselined ${tags.length} migration(s) on ${target}.`);
      return;
    }

    const tags = await applyPending(client, migrations, (line) =>
      console.log(line),
    );
    console.log(
      tags.length === 0
        ? `Nothing to apply on ${target}.`
        : `Applied ${tags.length} migration(s) on ${target}.`,
    );
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
