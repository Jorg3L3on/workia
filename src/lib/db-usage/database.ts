import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

/**
 * Readings Postgres gives about itself. They run on a compute that is already
 * awake (someone is using the app), so they add no wake-ups of their own.
 */

export type TableSize = {
  name: string;
  totalBytes: number;
  /** Planner estimate from the last ANALYZE, not a count; null before one. */
  approxRows: number | null;
};

export type SlowQuery = {
  query: string;
  calls: number;
  totalMs: number;
  meanMs: number;
  rows: number;
};

export type SlowQueryReport =
  | { available: true; since: Date | null; queries: SlowQuery[] }
  | { available: false; reason: string };

const num = (value: unknown) => Number(value ?? 0) || 0;

/** Size of the current database on disk, in bytes. */
export const readDatabaseSize = async (): Promise<number> => {
  const result = await db.execute<{ bytes: string | number }>(
    sql`select pg_database_size(current_database()) as bytes`,
  );

  return num(result.rows[0]?.bytes);
};

/** The largest tables of the public schema, indexes and TOAST included. */
export const readLargestTables = async (limit = 10): Promise<TableSize[]> => {
  const result = await db.execute<{
    name: string;
    total_bytes: string | number;
    approx_rows: string | number | null;
  }>(sql`
    select c.relname as name,
           pg_total_relation_size(c.oid) as total_bytes,
           case when c.reltuples < 0 then null else c.reltuples::bigint end as approx_rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by pg_total_relation_size(c.oid) desc
     limit ${limit}
  `);

  return result.rows.map((row) => ({
    name: row.name,
    totalBytes: num(row.total_bytes),
    approxRows: row.approx_rows === null ? null : num(row.approx_rows),
  }));
};

export const SLOW_QUERY_ORDER = ["total", "mean"] as const;
export type SlowQueryOrder = (typeof SLOW_QUERY_ORDER)[number];

/**
 * The statements that took the most time since the statistics were last
 * reset, from pg_stat_statements (migration 0034). On Neon the statistics
 * reset whenever the compute scales to zero, so they cover the current
 * awake stretch only. Query text is normalized ($1, $2): it holds no values.
 */
export const readSlowQueries = async (
  options: { limit?: number; orderBy?: SlowQueryOrder } = {},
): Promise<SlowQueryReport> => {
  const limit = options.limit ?? 10;
  const order =
    options.orderBy === "mean"
      ? sql`mean_exec_time desc`
      : sql`total_exec_time desc`;

  try {
    const [rows, info] = await Promise.all([
      db.execute<{
        query: string;
        calls: string | number;
        total_ms: string | number;
        mean_ms: string | number;
        rows: string | number;
      }>(sql`
        select query,
               calls,
               total_exec_time as total_ms,
               mean_exec_time as mean_ms,
               rows
          from pg_stat_statements
         where dbid = (select oid from pg_database where datname = current_database())
           and query not ilike '%pg_stat_statements%'
         order by ${order}
         limit ${limit}
      `),
      db
        .execute<{ stats_reset: string | Date | null }>(
          sql`select stats_reset from pg_stat_statements_info`,
        )
        .catch(() => ({ rows: [] as Array<{ stats_reset: null }> })),
    ]);
    const reset = info.rows[0]?.stats_reset;

    return {
      available: true,
      since: reset ? new Date(reset) : null,
      queries: rows.rows.map((row) => ({
        query: row.query.replace(/\s+/g, " ").trim(),
        calls: num(row.calls),
        totalMs: num(row.total_ms),
        meanMs: num(row.mean_ms),
        rows: num(row.rows),
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      available: false,
      reason: /does not exist/i.test(message)
        ? "La extensión pg_stat_statements no está instalada (migración 0034)."
        : /shared_preload_libraries/i.test(message)
          ? "Este Postgres no carga pg_stat_statements (shared_preload_libraries)."
          : "No se pudieron leer las estadísticas de consultas.",
    };
  }
};
