/**
 * Neon Free load test (Workia 2.0, P-03). Simulates daily writes from every
 * site and daily reads from every employee against a timeline-shaped table,
 * and reports read latency, storage written per day and, with the Neon API,
 * the compute the run used. See docs/neon-free-budget.md.
 *
 *   npm run db:load-test                                    # local Postgres
 *   LOAD_TEST_REMOTE_HOST=<branch host> DATABASE_URL=<Neon branch> \
 *     DATABASE_RLS=1 npm run db:load-test -- --employees 500
 *
 * Options: --employees 500 --companies 4 --sites 10 --history-days 365
 *          --days 1 --pool 10 --keep (leave the load_test schema)
 *
 * Everything it writes lives in its own schema, load_test, which it drops at
 * the end unless --keep. It never touches the app's tables. A remote run is
 * opt-in for one exact host: point it at a Neon branch made for the test,
 * never at the production branch.
 */

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
config();

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const arg = (name: string, fallback: number) => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return Math.floor(value);
};

const options = {
  employees: arg("employees", 500),
  companies: arg("companies", 4),
  sites: arg("sites", 10),
  historyDays: arg("history-days", 365),
  days: arg("days", 1),
  pool: arg("pool", 10),
  keep: process.argv.includes("--keep"),
  rls: process.env.DATABASE_RLS === "1",
};

type Queryable = {
  query: <R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: R[] }>;
};
type PoolLike = Queryable & {
  connect: () => Promise<Queryable & { release: () => void }>;
  end: () => Promise<void>;
};

const openPool = (url: string, isLocal: boolean): PoolLike => {
  if (isLocal) {
    return new pg.Pool({
      connectionString: url,
      max: options.pool,
    }) as unknown as PoolLike;
  }
  // The app's transactions use Neon's WebSocket pool; the test does too.
  neonConfig.webSocketConstructor = WebSocket;
  return new NeonPool({
    connectionString: url,
    max: options.pool,
  }) as unknown as PoolLike;
};

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];

const summarize = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  };
};

const fmtMs = (value: number) => `${value.toFixed(1)} ms`;
const fmtBytes = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(2)} GB`
    : bytes >= 1e6
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : `${(bytes / 1e3).toFixed(0)} kB`;

/** Month-to-date CU-seconds and active seconds, when the Neon API is set. */
const readNeonCompute = async () => {
  const key = process.env.NEON_API_KEY;
  const project = process.env.NEON_PROJECT_ID;
  if (!key || !project) return null;

  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(project)}`,
    { headers: { authorization: `Bearer ${key}`, accept: "application/json" } },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as {
    project?: { compute_time_seconds?: number; active_time_seconds?: number };
  };
  return {
    cuSeconds: Number(body.project?.compute_time_seconds ?? 0),
    activeSeconds: Number(body.project?.active_time_seconds ?? 0),
  };
};

const SCHEMA = "load_test";
const TABLE = `${SCHEMA}.person_events`;

/** The shape P-01 plans for person_events: one attendance row per person per day. */
const setup = async (client: Queryable) => {
  await client.query(`drop schema if exists ${SCHEMA} cascade`);
  await client.query(`create schema ${SCHEMA}`);
  await client.query(`
    create table ${TABLE} (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      person_id uuid not null,
      site_id uuid not null,
      type text not null,
      occurred_at timestamptz not null,
      payload jsonb not null default '{}',
      source text not null,
      dedupe_key text not null,
      created_at timestamptz not null default now()
    )`);
  await client.query(
    `create index on ${TABLE} (company_id, person_id, occurred_at desc)`,
  );
  await client.query(
    `create index on ${TABLE} (company_id, site_id, occurred_at) where type = 'attendance'`,
  );
  await client.query(
    `create unique index on ${TABLE} (company_id, dedupe_key)`,
  );
  await client.query(`alter table ${TABLE} enable row level security`);
  // FORCE: the owner (this connection) obeys the policy too, as the app role does.
  if (options.rls) {
    await client.query(`alter table ${TABLE} force row level security`);
  }
  await client.query(`
    create policy person_events_company_isolation on ${TABLE}
      using (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
      with check (company_id = nullif(current_setting('app.company_id', true), '')::uuid)`);
};

type Person = { companyId: string; personId: string; siteId: string };

const makePeople = (): {
  people: Person[];
  sitesByCompany: Map<string, string[]>;
} => {
  const companies = Array.from({ length: options.companies }, () =>
    randomUUID(),
  );
  const sitesByCompany = new Map<string, string[]>();
  const sites = Array.from({ length: options.sites }, (_, index) => {
    const companyId = companies[index % companies.length];
    const siteId = randomUUID();
    sitesByCompany.set(companyId, [
      ...(sitesByCompany.get(companyId) ?? []),
      siteId,
    ]);
    return { companyId, siteId };
  });
  const people = Array.from({ length: options.employees }, (_, index) => {
    const site = sites[index % sites.length];
    return { ...site, personId: randomUUID() };
  });
  return { people, sitesByCompany };
};

const dayIso = (offset: number) => {
  const date = new Date();
  date.setUTCHours(14, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
};

/**
 * One transaction scoped to a company, as withTransaction runs it under RLS.
 * Returns how long the transaction took once it had a connection: waiting for
 * a free connection of the pool is not counted.
 */
const scoped = async (
  pool: PoolLike,
  companyId: string,
  fn: (client: Queryable) => Promise<unknown>,
): Promise<number> => {
  const client = await pool.connect();
  try {
    const start = performance.now();
    await client.query("begin");
    await client.query("select set_config('app.company_id', $1, true)", [
      companyId,
    ]);
    await fn(client);
    await client.query("commit");
    return performance.now() - start;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * One site's attendance for one day, as an ingestion window writes it: one
 * batched upsert, one row per person, punches merged into the payload.
 */
const writeSiteDay = (
  pool: PoolLike,
  site: Person[],
  day: Date,
  punch: string,
) =>
  scoped(pool, site[0].companyId, (client) => {
    const values: unknown[] = [];
    const tuples = site.map((person, index) => {
      const base = index * 6;
      values.push(
        person.companyId,
        person.personId,
        person.siteId,
        day.toISOString(),
        JSON.stringify({
          punches: [punch],
          date: day.toISOString().slice(0, 10),
        }),
        `attendance:${person.personId}:${day.toISOString().slice(0, 10)}`,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, 'attendance', $${base + 4}, $${base + 5}::jsonb, 'checador', $${base + 6})`;
    });
    return client.query(
      `insert into ${TABLE} (company_id, person_id, site_id, type, occurred_at, payload, source, dedupe_key)
       values ${tuples.join(", ")}
       on conflict (company_id, dedupe_key) do update
         set payload = jsonb_set(${TABLE}.payload, '{punches}',
           (${TABLE}.payload->'punches') || (excluded.payload->'punches'))`,
      values,
    );
  });

const groupBySite = (people: Person[]) => {
  const sites = new Map<string, Person[]>();
  for (const person of people) {
    sites.set(person.siteId, [...(sites.get(person.siteId) ?? []), person]);
  }
  return [...sites.values()];
};

/** Runs fn over items with at most `limit` in flight; returns each duration. */
const timedAll = async <T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<number>,
) => {
  const durations: number[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      durations.push(await fn(items[next++]));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return durations;
};

const tableBytes = async (pool: PoolLike) =>
  Number(
    (
      await pool.query<{ bytes: string }>(
        `select pg_total_relation_size('${TABLE}') as bytes`,
      )
    ).rows[0].bytes,
  );

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { hostname } = new URL(url);
  const isLocal = LOCAL_HOSTS.includes(hostname);

  if (!isLocal && process.env.LOAD_TEST_REMOTE_HOST !== hostname) {
    console.error(
      `Refusing to run: ${hostname} is not local. Set LOAD_TEST_REMOTE_HOST=${hostname} when DATABASE_URL points to a Neon branch made for this test.`,
    );
    process.exit(2);
  }

  const pool = openPool(url, isLocal);
  const { people } = makePeople();
  const sites = groupBySite(people);
  const neonBefore = await readNeonCompute().catch(() => null);
  const runStart = performance.now();

  try {
    await setup(pool);

    // History: options.historyDays of attendance, one row per person per day.
    const historyStart = performance.now();
    for (let offset = -options.historyDays; offset < 0; offset++) {
      const day = dayIso(offset);
      await Promise.all(
        sites.map((site) => writeSiteDay(pool, site, day, "08:00")),
      );
    }
    await pool.query(`analyze ${TABLE}`);
    const historyMs = performance.now() - historyStart;
    const historyBytes = await tableBytes(pool);

    const writeSamples: number[] = [];
    const readSamples: number[] = [];
    const todaySamples: number[] = [];
    const dayBytes: number[] = [];
    const burstSeconds: number[] = [];

    for (let day = 0; day < options.days; day++) {
      const date = dayIso(day);
      const before = await tableBytes(pool);

      // Two ingestion windows a day (entrada, salida), one batch per site.
      for (const punch of ["08:05", "17:02"]) {
        writeSamples.push(
          ...(await timedAll(sites, options.pool, (site) =>
            writeSiteDay(pool, site, date, punch),
          )),
        );
      }

      // Every employee opens their last 31 days once, all at the same time.
      const burstStart = performance.now();
      readSamples.push(
        ...(await timedAll(people, options.employees, (person) =>
          scoped(pool, person.companyId, (client) =>
            client.query(
              `select occurred_at, payload from ${TABLE}
                where company_id = $1 and person_id = $2
                  and occurred_at >= $3::timestamptz - interval '31 days'
                order by occurred_at desc`,
              [person.companyId, person.personId, date.toISOString()],
            ),
          ),
        )),
      );

      burstSeconds.push((performance.now() - burstStart) / 1000);

      // Each site's manager opens the today view.
      todaySamples.push(
        ...(await timedAll(sites, options.pool, (site) =>
          scoped(pool, site[0].companyId, (client) =>
            client.query(
              `select person_id, payload from ${TABLE}
                where company_id = $1 and site_id = $2 and type = 'attendance'
                  and occurred_at >= $3::timestamptz - interval '12 hours'
                  and occurred_at < $3::timestamptz + interval '12 hours'`,
              [site[0].companyId, site[0].siteId, date.toISOString()],
            ),
          ),
        )),
      );

      dayBytes.push((await tableBytes(pool)) - before);
    }

    const runSeconds = (performance.now() - runStart) / 1000;
    const neonAfter = await readNeonCompute().catch(() => null);
    const reads = summarize(readSamples);
    const writes = summarize(writeSamples);
    const today = summarize(todaySamples);
    const perDay = dayBytes.reduce((a, b) => a + b, 0) / dayBytes.length;
    const historyRows = options.employees * options.historyDays;

    const lines = [
      `## Load test ${new Date().toISOString()}`,
      "",
      `Target: ${isLocal ? "local Postgres" : hostname} · RLS ${options.rls ? "on" : "off"} · ${options.employees} employees, ${options.companies} companies, ${options.sites} sites, ${options.historyDays} days of history, ${options.days} simulated day(s), pool ${options.pool}`,
      "",
      "| Measure | Value |",
      "| --- | --- |",
      `| Employee timeline read (31 days), p50 / p95 / max | ${fmtMs(reads.p50)} / ${fmtMs(reads.p95)} / ${fmtMs(reads.max)} (${reads.count} reads) |`,
      `| All ${options.employees} employees reading at once, through ${options.pool} connections | ${Math.max(...burstSeconds).toFixed(1)} s for the whole burst |`,
      `| Manager today view, p50 / p95 / max | ${fmtMs(today.p50)} / ${fmtMs(today.p95)} / ${fmtMs(today.max)} |`,
      `| Site ingestion batch, p50 / p95 / max | ${fmtMs(writes.p50)} / ${fmtMs(writes.p95)} / ${fmtMs(writes.max)} |`,
      `| History loaded | ${historyRows.toLocaleString("en-US")} rows, ${fmtBytes(historyBytes)}, ${(historyMs / 1000).toFixed(1)} s |`,
      `| Bytes per attendance row (table + indexes) | ${Math.round(historyBytes / historyRows)} B |`,
      `| Storage written per simulated day | ${fmtBytes(perDay)} |`,
      `| Wall time of the run | ${runSeconds.toFixed(1)} s |`,
    ];

    if (neonBefore && neonAfter) {
      const cuSeconds = neonAfter.cuSeconds - neonBefore.cuSeconds;
      const activeSeconds = neonAfter.activeSeconds - neonBefore.activeSeconds;
      lines.push(
        `| Compute used by the run (Neon API) | ${(cuSeconds / 3600).toFixed(3)} CU-h over ${(activeSeconds / 60).toFixed(1)} awake min${activeSeconds > 0 ? `, average ${(cuSeconds / activeSeconds).toFixed(2)} CU` : ""} |`,
      );
    } else {
      lines.push(
        "| Compute used by the run | Set NEON_API_KEY and NEON_PROJECT_ID to read it from the Neon API |",
      );
    }

    lines.push(
      "",
      "Latencies are per transaction once it has a connection (begin, set_config, query, commit), the way withTransaction runs under RLS.",
      "Neon updates the project's compute counters with a delay; read them again a few minutes after the run if they show 0.",
    );

    console.log(lines.join("\n"));
  } finally {
    if (!options.keep) {
      await pool
        .query(`drop schema if exists ${SCHEMA} cascade`)
        .catch(() => undefined);
    }
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
