/**
 * Measures the person timeline read (Workia 2.0 P-01) under a five-year load:
 * creates a throwaway company with --people people (default 100), five years
 * of daily attendance each plus a receipt per quincena and a few documents,
 * then times the one-person query with EXPLAIN ANALYZE on --runs people
 * (default 50) and the today view of one site of 100 people (P-04) on --runs
 * days, and prints the plans, the timings and the table size. The
 * throwaway company and its rows are deleted at the end (keep them with --keep).
 *
 *   npm run db:measure-timeline
 *   npm run db:measure-timeline -- --people 500 --runs 100
 *
 * Meant for a local Postgres or a Neon branch made for the test, never the
 * production branch: the load writes real rows. A database that is not on this
 * machine needs --confirm-host <hostname>.
 */

import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

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

  const peopleCount = Number(argValue("--people") ?? 100);
  const runs = Number(argValue("--runs") ?? 50);
  const client = new Client({ connectionString: url });
  await client.connect();

  const slug = `timeline-measure-${Date.now()}`;
  const {
    rows: [company],
  } = await client.query<{ id: string }>(
    "INSERT INTO companies (name, slug) VALUES ($1, $1) RETURNING id",
    [slug],
  );

  try {
    const started = Date.now();
    await client.query(
      `INSERT INTO people (company_id, nombres, apellido_paterno)
       SELECT $1, 'Carga ' || i, 'Timeline' FROM generate_series(1, $2::int) i`,
      [company.id, peopleCount],
    );
    // Attendance: one row per person per day for five years.
    await client.query(
      `INSERT INTO person_events (company_id, person_id, type, occurred_at, source, dedupe_key, payload)
       SELECT p.company_id, p.id, 'attendance', d + time '14:00', 'checador',
              'attendance:' || to_char(d, 'YYYY-MM-DD'),
              jsonb_build_object('site_id', 'site-' || (hashtext(p.id::text) & 7),
                                 'first_in', '08:0' || (extract(dow FROM d)::int), 'last_out', '17:01', 'punches', 2)
       FROM people p,
            generate_series(current_date - interval '5 years', current_date - interval '1 day', interval '1 day') d
       WHERE p.company_id = $1`,
      [company.id],
    );
    // Receipts: one per quincena. Documents: two a year.
    await client.query(
      `INSERT INTO person_events (company_id, person_id, type, occurred_at, source, dedupe_key, payload)
       SELECT p.company_id, p.id, 'receipt'::person_event_type, d, 'payroll',
              'receipt:payroll:' || to_char(d, 'YYYY-MM-DD'),
              jsonb_build_object('period', to_char(d, 'YYYY-MM'), 'cfdi', md5(p.id::text || d))
       FROM people p,
            generate_series(current_date - interval '5 years', current_date, interval '15 days') d
       WHERE p.company_id = $1
       UNION ALL
       SELECT p.company_id, p.id, 'document'::person_event_type, d, 'app', null::text,
              jsonb_build_object('kind', 'comprobante_domicilio', 'status', 'accepted')
       FROM people p,
            generate_series(current_date - interval '5 years', current_date, interval '6 months') d
       WHERE p.company_id = $1`,
      [company.id],
    );
    await client.query("ANALYZE person_events");

    const {
      rows: [load],
    } = await client.query<{ rows: number }>(
      "SELECT count(*)::int AS rows FROM person_events WHERE company_id = $1",
      [company.id],
    );
    console.log(
      `Loaded ${load.rows} events for ${peopleCount} people in ${Date.now() - started} ms.`,
    );

    const { rows: sample } = await client.query<{ id: string }>(
      "SELECT id FROM people WHERE company_id = $1 ORDER BY random() LIMIT $2",
      [company.id, runs],
    );
    const timings: number[] = [];
    let indexes = new Set<string>();
    let nodeTypes = new Set<string>();

    for (const person of sample) {
      const {
        rows: [{ "QUERY PLAN": plans }],
      } = await client.query<{
        "QUERY PLAN": Array<{ Plan: PlanNode; "Execution Time": number }>;
      }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         SELECT type, occurred_at, payload FROM person_events
         WHERE company_id = $1 AND person_id = $2
         ORDER BY occurred_at DESC, id DESC LIMIT 200`,
        [company.id, person.id],
      );
      const nodes = nodesOf(plans[0].Plan);
      timings.push(plans[0]["Execution Time"]);
      indexes = new Set([
        ...indexes,
        ...nodes.flatMap((node) => node["Index Name"] ?? []),
      ]);
      nodeTypes = new Set([
        ...nodeTypes,
        ...nodes.map((node) => node["Node Type"]),
      ]);
    }

    // The today view (P-04): one site of up to 100 people, a day of the load.
    const todayModule = await import("@/lib/timeline/today");
    const { db } = await import("@/lib/db");
    const {
      rows: [site],
    } = await client.query<{ id: string }>(
      "INSERT INTO sites (company_id, name, kind) VALUES ($1, 'Carga', 'sucursal') RETURNING id",
      [company.id],
    );
    await client.query(
      `UPDATE people SET site_id = $2 WHERE id IN (
         SELECT id FROM people WHERE company_id = $1 ORDER BY id LIMIT 100)`,
      [company.id, site.id],
    );
    await client.query("ANALYZE people");

    const todayTimings: number[] = [];
    let todayIndexes = new Set<string>();

    for (let run = 0; run < runs; run += 1) {
      const day = new Date(Date.now() - (1 + (run % 365)) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const query = todayModule
        .todayPageQuery(company.id, { siteId: site.id }, { day }, db)
        .toSQL();
      const {
        rows: [{ "QUERY PLAN": plans }],
      } = await client.query<{
        "QUERY PLAN": Array<{ Plan: PlanNode; "Execution Time": number }>;
      }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`, query.params);
      todayTimings.push(plans[0]["Execution Time"]);
      todayIndexes = new Set([
        ...todayIndexes,
        ...nodesOf(plans[0].Plan).flatMap((node) => node["Index Name"] ?? []),
      ]);
    }

    console.log(`Today view indexes used: ${[...todayIndexes].join(", ")}`);
    console.log(
      `Today view of one site (${Math.min(peopleCount, 100)} people) over ${todayTimings.length} days: p50 ${percentile(todayTimings, 0.5).toFixed(2)} ms, p95 ${percentile(todayTimings, 0.95).toFixed(2)} ms, max ${Math.max(...todayTimings).toFixed(2)} ms`,
    );

    const {
      rows: [size],
    } = await client.query<{ table: string; indexes: string }>(
      `SELECT pg_size_pretty(pg_table_size('person_events')) AS table,
              pg_size_pretty(pg_indexes_size('person_events')) AS indexes`,
    );

    console.log(`Plan nodes: ${[...nodeTypes].join(", ")}`);
    console.log(`Indexes used: ${[...indexes].join(", ")}`);
    console.log(
      `Execution time over ${timings.length} people: p50 ${percentile(timings, 0.5).toFixed(2)} ms, p95 ${percentile(timings, 0.95).toFixed(2)} ms, max ${Math.max(...timings).toFixed(2)} ms`,
    );
    console.log(
      `person_events on disk (whole table): ${size.table} + ${size.indexes} of indexes.`,
    );
  } finally {
    if (process.argv.includes("--keep")) {
      console.log(`Kept company ${slug} (${company.id}).`);
    } else {
      // people → person_events cascades; the company goes last.
      await client.query("DELETE FROM people WHERE company_id = $1", [
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
