/**
 * Measures the aggregates and the period close (Workia 2.0 P-02) under a
 * five-year load: creates a throwaway company with --people people (default
 * 500) spread over sites of a hundred, five years of attendance (Monday to
 * Saturday) with a falta and a retardo on about one day in thirty-two each,
 * then:
 *   - times site absenteeism for a month and the other aggregates with
 *     EXPLAIN ANALYZE, printing the indexes each plan uses;
 *   - closes every quincena of the five years with closePayPeriod and prints
 *     the close times and the size of incidencias_period_snapshot.
 * The throwaway company and its rows are deleted at the end (keep them with
 * --keep).
 *
 *   npm run db:measure-aggregates
 *   npm run db:measure-aggregates -- --people 500 --years 5
 *
 * Meant for a local Postgres or a Neon branch made for the test, never the
 * production branch: the load writes real rows. A database that is not on this
 * machine needs --confirm-host <hostname>.
 */

import { config } from "dotenv";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { Client } from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];
const SITE_SIZE = 100;

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);

  return index === -1 ? undefined : process.argv[index + 1];
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
};

type PlanNode = {
  "Node Type": string;
  "Index Name"?: string;
  Plans?: PlanNode[];
};

const nodesOf = (node: PlanNode): PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(nodesOf),
];

const main = async () => {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  const { hostname } = new URL(url);

  if (
    !LOCAL_HOSTS.includes(hostname) &&
    argValue("--confirm-host") !== hostname
  ) {
    throw new Error(
      `DATABASE_URL points to ${hostname}, which is not local. Pass --confirm-host ${hostname} if that is intended.`,
    );
  }

  // Imported after dotenv: static imports are hoisted and would validate env first.
  const { absenteeismBySql, incidenciasBySql, incidenciasByPersonSql } =
    await import("@/lib/timeline/aggregates");
  const { closePayPeriod, quincenaOf } = await import("@/lib/pay-periods");

  const peopleCount = Number(argValue("--people") ?? 500);
  const years = Number(argValue("--years") ?? 5);
  const client = new Client({ connectionString: url });
  await client.connect();
  const dialect = new PgDialect();

  const explain = async (label: string, statement: SQL, runs = 5) => {
    const query = dialect.sqlToQuery(statement);
    const timings: number[] = [];
    let indexes = new Set<string>();

    for (let run = 0; run < runs; run += 1) {
      const {
        rows: [{ "QUERY PLAN": plans }],
      } = await client.query<{
        "QUERY PLAN": Array<{ Plan: PlanNode; "Execution Time": number }>;
      }>(`EXPLAIN (ANALYZE, FORMAT JSON) ${query.sql}`, query.params);
      timings.push(plans[0]["Execution Time"]);
      indexes = new Set([
        ...indexes,
        ...nodesOf(plans[0].Plan).flatMap((node) => node["Index Name"] ?? []),
      ]);
    }

    console.log(
      `${label}: p50 ${percentile(timings, 0.5).toFixed(1)} ms, max ${Math.max(...timings).toFixed(1)} ms; indexes ${[...indexes].join(", ")}`,
    );
  };

  const slug = `aggregates-measure-${Date.now()}`;
  const {
    rows: [company],
  } = await client.query<{ id: string }>(
    "INSERT INTO companies (name, slug) VALUES ($1, $1) RETURNING id",
    [slug],
  );

  try {
    const started = Date.now();
    const siteCount = Math.max(1, Math.ceil(peopleCount / SITE_SIZE));
    const { rows: siteRows } = await client.query<{ id: string }>(
      `INSERT INTO sites (company_id, name, kind)
       SELECT $1, 'Sitio ' || i, 'sucursal' FROM generate_series(1, $2::int) i
       RETURNING id`,
      [company.id, siteCount],
    );
    await client.query(
      `INSERT INTO people (company_id, nombres, apellido_paterno, site_id)
       SELECT $1, 'Carga ' || i, 'Aggregates', ($3::uuid[])[1 + (i - 1) / ${SITE_SIZE}]
       FROM generate_series(1, $2::int) i`,
      [company.id, peopleCount, siteRows.map((site) => site.id)],
    );
    await client.query(
      `WITH load AS (
         SELECT p.company_id, p.id, d::date AS day,
                (hashtext(p.id::text || d::text) & 31) AS roll
         FROM people p,
              generate_series(current_date - make_interval(years => $2::int), current_date - 1, interval '1 day') d
         WHERE p.company_id = $1 AND extract(isodow FROM d) < 7
       )
       INSERT INTO person_events (company_id, person_id, type, occurred_at, source, dedupe_key, payload)
       SELECT company_id, id, 'attendance'::person_event_type, day + time '14:00', 'checador',
              'attendance:' || to_char(day, 'YYYY-MM-DD'),
              jsonb_build_object('first_in', '08:0' || (roll & 7), 'last_out', '17:01')
       FROM load WHERE roll > 0
       UNION ALL
       SELECT company_id, id, 'incidencia'::person_event_type, day + time '15:00', 'engine',
              'incidencia:engine:' || to_char(day, 'YYYYMMDD'),
              jsonb_build_object('date', to_char(day, 'YYYY-MM-DD'),
                                 'kind', CASE WHEN roll = 0 THEN 'falta' ELSE 'retardo' END,
                                 'minutes', CASE WHEN roll = 0 THEN 0 ELSE 12 END, 'justified', false)
       FROM load WHERE roll IN (0, 1)`,
      [company.id, years],
    );
    await client.query("ANALYZE people; ANALYZE person_events");

    const {
      rows: [load],
    } = await client.query<{ rows: number }>(
      "SELECT count(*)::int AS rows FROM person_events WHERE company_id = $1",
      [company.id],
    );
    console.log(
      `Loaded ${load.rows} events for ${peopleCount} people at ${siteCount} sites in ${Date.now() - started} ms.`,
    );

    const today = new Date();
    const month = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1),
    );
    const monthEnd = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
    );
    const range = {
      from: month.toISOString().slice(0, 10),
      to: monthEnd.toISOString().slice(0, 10),
    };
    const site = siteRows[0].id;

    console.log(`Month ${range.from}..${range.to}:`);
    await explain(
      `  site absenteeism (${SITE_SIZE} people)`,
      absenteeismBySql(company.id, range, { by: "site", siteId: site }),
    );
    await explain(
      `  site incidencias (${SITE_SIZE} people)`,
      incidenciasBySql(company.id, range, { by: "site", siteId: site }),
    );
    await explain(
      `  incidencias by person (${peopleCount} people)`,
      incidenciasBySql(company.id, range, { by: "person" }),
    );
    await explain(
      `  absenteeism by site (${peopleCount} people)`,
      absenteeismBySql(company.id, range, { by: "site" }),
    );
    await explain(
      `  one quincena by person (the close)`,
      incidenciasByPersonSql(company.id, {
        from: range.from,
        to: `${range.from.slice(0, 8)}15`,
      }),
    );
    await explain(
      `  a year by month (${peopleCount} people)`,
      absenteeismBySql(
        company.id,
        {
          from: new Date(today.getTime() - 365 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          to: range.to,
        },
        { by: "month" },
      ),
      1,
    );

    // Close every finished quincena of the load.
    const periods: string[] = [];
    const first = new Date(today);
    first.setUTCFullYear(first.getUTCFullYear() - years);
    for (
      let day = new Date(first);
      day < monthEnd;
      day = new Date(day.getTime() + 86_400_000)
    ) {
      const period = quincenaOf(day.toISOString().slice(0, 10));
      if (periods.at(-1) !== period) {
        periods.push(period);
      }
    }

    const closes: number[] = [];
    let rows = 0;
    for (const period of periods) {
      const startedClose = performance.now();
      const result = await closePayPeriod(company.id, period);
      closes.push(performance.now() - startedClose);
      rows += result.snapshotRows;
    }

    const {
      rows: [size],
    } = await client.query<{ table: string; indexes: string }>(
      `SELECT pg_size_pretty(pg_table_size('incidencias_period_snapshot')) AS table,
              pg_size_pretty(pg_indexes_size('incidencias_period_snapshot')) AS indexes`,
    );
    console.log(
      `Closed ${periods.length} quincenas: p50 ${percentile(closes, 0.5).toFixed(0)} ms, p95 ${percentile(closes, 0.95).toFixed(0)} ms, max ${Math.max(...closes).toFixed(0)} ms per close.`,
    );
    console.log(
      `incidencias_period_snapshot: ${rows} rows, ${size.table} + ${size.indexes} of indexes.`,
    );
  } finally {
    if (process.argv.includes("--keep")) {
      console.log(`Kept company ${slug} (${company.id}).`);
    } else {
      // people → person_events and the snapshot cascade; audit events and
      // periods go before the company.
      await client.query("DELETE FROM people WHERE company_id = $1", [
        company.id,
      ]);
      await client.query("DELETE FROM pay_periods WHERE company_id = $1", [
        company.id,
      ]);
      await client.query("DELETE FROM audit_events WHERE company_id = $1", [
        company.id,
      ]);
      await client.query("DELETE FROM sites WHERE company_id = $1", [
        company.id,
      ]);
      await client.query("DELETE FROM companies WHERE id = $1", [company.id]);
    }
    await client.end();
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
