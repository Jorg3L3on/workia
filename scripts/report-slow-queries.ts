/**
 * Slow-query and size report (Workia 2.0, P-03): the database size against
 * the Neon Free limit, the largest tables, and the statements that took the
 * most time from pg_stat_statements (migration 0034). Read-only.
 *
 *   npm run db:report-slow-queries                 # by total time
 *   npm run db:report-slow-queries -- --mean       # by mean time
 *   npm run db:report-slow-queries -- --limit 20
 *
 * On Neon the statistics reset when the compute scales to zero, so run it
 * while the app is in use (or right after the load test).
 */

import { config } from "dotenv";

config({ path: ".env.local" });
config();

const limitArg = process.argv.indexOf("--limit");
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) || 10 : 10;
const orderBy = process.argv.includes("--mean") ? "mean" : "total";

const main = async () => {
  // Imported after dotenv: static imports are hoisted and would validate env first.
  const {
    formatBytes,
    formatPercent,
    NEON_FREE_LIMITS,
    readLargestTables,
    readSlowQueries,
  } = await import("@/lib/db-usage");
  const { readDatabaseSize } = await import("@/lib/db-usage/database");

  const [size, tables, slow] = await Promise.all([
    readDatabaseSize(),
    readLargestTables(limit),
    readSlowQueries({ limit, orderBy }),
  ]);

  console.log(
    `Database size: ${formatBytes(size)} of ${formatBytes(NEON_FREE_LIMITS.storageBytes)} (${formatPercent(size / NEON_FREE_LIMITS.storageBytes)})\n`,
  );

  console.log("Largest tables (with indexes):");
  for (const table of tables) {
    console.log(
      `  ${table.name.padEnd(36)} ${formatBytes(table.totalBytes).padStart(10)}  ${table.approxRows === null ? "not analyzed" : `~${table.approxRows} rows`}`,
    );
  }

  console.log("");

  if (!slow.available) {
    console.log(`Slow queries: ${slow.reason}`);
    process.exit(0);
  }

  console.log(
    `Slowest statements by ${orderBy} time${slow.since ? ` since ${slow.since.toISOString()}` : ""}:`,
  );
  for (const query of slow.queries) {
    console.log(
      `  ${query.meanMs.toFixed(1).padStart(8)} ms mean  ${query.totalMs.toFixed(0).padStart(8)} ms total  ${String(query.calls).padStart(7)} calls  ${query.query.slice(0, 160)}`,
    );
  }

  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
