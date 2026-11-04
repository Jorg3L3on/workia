/**
 * Restore drill check (Workia 2.0, P-03). After a Neon branch is restored to a
 * point in time (steps in docs/neon-free-budget.md), compares it with the
 * source database and times how long the restored branch takes to answer.
 * Read-only on both databases: it only runs SELECTs.
 *
 *   DATABASE_URL=<source> RESTORED_DATABASE_URL=<restored branch> \
 *     npm run db:restore-drill
 *
 * It fails (exit 1) when the restored branch is missing a migration of the
 * source, misses a table, or has an empty table the source has rows in.
 * Rows written to the source after the restore point show as differences,
 * not failures.
 */

import { performance } from "node:perf_hooks";

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
config();

type Snapshot = {
  migrations: string[];
  counts: Map<string, number>;
  firstQueryMs: number;
  totalMs: number;
};

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const connect = async (url: string) => {
  const { hostname } = new URL(url);
  const client = new pg.Client({
    connectionString: url,
    ssl: LOCAL_HOSTS.includes(hostname) ? undefined : true,
  });
  await client.connect();
  return client;
};

const snapshot = async (url: string): Promise<Snapshot> => {
  const start = performance.now();
  const client = await connect(url);

  try {
    // The first query wakes a suspended compute: this is the cold start.
    await client.query("select 1");
    const firstQueryMs = performance.now() - start;

    const migrations = await client
      .query<{ tag: string }>(
        "select tag from drizzle.applied_migrations order by tag",
      )
      .then((result) => result.rows.map((row) => row.tag))
      .catch(() => [] as string[]);

    const tables = await client.query<{ name: string }>(
      `select tablename as name from pg_tables where schemaname = 'public' order by tablename`,
    );
    const counts = new Map<string, number>();
    for (const { name } of tables.rows) {
      const result = await client.query<{ count: string }>(
        `select count(*)::bigint as count from public."${name.replace(/"/g, '""')}"`,
      );
      counts.set(name, Number(result.rows[0].count));
    }

    return {
      migrations,
      counts,
      firstQueryMs,
      totalMs: performance.now() - start,
    };
  } finally {
    await client.end();
  }
};

const main = async () => {
  const sourceUrl = process.env.DATABASE_URL;
  const restoredUrl = process.env.RESTORED_DATABASE_URL;

  if (!sourceUrl || !restoredUrl) {
    console.error(
      "Set DATABASE_URL (source) and RESTORED_DATABASE_URL (restored branch).",
    );
    process.exit(2);
  }
  if (sourceUrl === restoredUrl) {
    console.error(
      "DATABASE_URL and RESTORED_DATABASE_URL are the same database.",
    );
    process.exit(2);
  }

  const [source, restored] = await Promise.all([
    snapshot(sourceUrl),
    snapshot(restoredUrl),
  ]);

  const problems: string[] = [];
  const missingMigrations = source.migrations.filter(
    (tag) => !restored.migrations.includes(tag),
  );
  if (missingMigrations.length > 0) {
    problems.push(
      `migrations missing on the restored branch: ${missingMigrations.join(", ")}`,
    );
  }

  const rows: string[] = [];
  let sourceRows = 0;
  let restoredRows = 0;
  for (const [table, count] of source.counts) {
    const restoredCount = restored.counts.get(table);
    sourceRows += count;
    restoredRows += restoredCount ?? 0;
    if (restoredCount === undefined) {
      problems.push(`table ${table} is missing on the restored branch`);
    } else if (restoredCount === 0 && count > 0) {
      problems.push(
        `table ${table} is empty on the restored branch (${count} rows in the source)`,
      );
    }
    if (restoredCount !== count) {
      rows.push(`| ${table} | ${count} | ${restoredCount ?? "missing"} |`);
    }
  }

  console.log(
    [
      `## Restore drill check ${new Date().toISOString()}`,
      "",
      `Restored branch: ${new URL(restoredUrl).hostname}`,
      `First answer from the restored branch (cold start): ${(restored.firstQueryMs / 1000).toFixed(1)} s`,
      `Full check of the restored branch: ${(restored.totalMs / 1000).toFixed(1)} s`,
      `Tables: ${source.counts.size} in the source, ${restored.counts.size} restored · rows: ${sourceRows} in the source, ${restoredRows} restored`,
      `Migrations: ${source.migrations.length} in the source, ${restored.migrations.length} restored`,
      "",
      rows.length === 0
        ? "Every table has the same number of rows."
        : [
            "Tables whose row count differs (rows written after the restore point show here):",
            "",
            "| Table | Source | Restored |",
            "| --- | --- | --- |",
            ...rows,
          ].join("\n"),
      "",
      problems.length === 0
        ? "Result: the restored branch is complete."
        : `Result: FAILED\n${problems.map((p) => `- ${p}`).join("\n")}`,
    ].join("\n"),
  );

  process.exit(problems.length === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
