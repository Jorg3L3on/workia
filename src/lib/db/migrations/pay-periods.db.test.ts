import { PgDialect } from "drizzle-orm/pg-core";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { incidenciasByPersonSql } from "@/lib/timeline/aggregates";
import { absenteeismBySql, incidenciasBySql } from "@/lib/timeline/aggregates";
import { createScratchDatabase, testServerUrl } from "@/test/db/scratch";

type Scratch = Awaited<ReturnType<typeof createScratchDatabase>>;

const A = "00000000-0000-0000-0000-0000000000a1";
const B = "00000000-0000-0000-0000-0000000000b1";
const ANA = "00000000-0000-0000-0000-00000000a001";
const BETO = "00000000-0000-0000-0000-00000000b001";
const PERIOD_A = "00000000-0000-0000-0000-0000000a0001";
const SITE = "00000000-0000-0000-0000-00000000c001";
const OTHER_SITE = "00000000-0000-0000-0000-00000000c002";
const ROLE = "workia_app_pay_periods_check";

/** Load for the plan checks: two sites of a hundred people, five years each. */
const SITE_PEOPLE = 100;

type PlanNode = {
  "Node Type": string;
  "Index Name"?: string;
  "Relation Name"?: string;
  Plans?: PlanNode[];
};

const nodesOf = (node: PlanNode): PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(nodesOf),
];

const dialect = new PgDialect();

describe("0035: pay_periods and incidencias_period_snapshot", () => {
  let database: Scratch;
  let app: Client;

  const asApp = async (companyId: string, query: string) => {
    await app.query("BEGIN");
    try {
      await app.query("SELECT set_config('app.company_id', $1, true)", [
        companyId,
      ]);
      const { rows } = await app.query(query);
      await app.query("COMMIT");
      return rows;
    } catch (error) {
      await app.query("ROLLBACK");
      throw error;
    }
  };

  /** EXPLAIN ANALYZE of a statement the aggregate helpers run. */
  const explain = async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    const query = dialect.sqlToQuery(statement);
    const [{ "QUERY PLAN": plans }] = await database.query<{
      "QUERY PLAN": Array<{ Plan: PlanNode; "Execution Time": number }>;
    }>(`EXPLAIN (ANALYZE, FORMAT JSON) ${query.sql}`, query.params);
    const nodes = nodesOf(plans[0].Plan);

    return {
      ms: plans[0]["Execution Time"],
      indexes: [
        ...new Set(nodes.flatMap((node) => node["Index Name"] ?? [])),
      ].sort(),
      seqScans: nodes
        .filter((node) => node["Node Type"] === "Seq Scan")
        .map((node) => node["Relation Name"]),
    };
  };

  beforeAll(async () => {
    database = await createScratchDatabase("m0035");
    await database.query(`
      INSERT INTO companies (id, name, slug) VALUES ('${A}', 'A', 'a'), ('${B}', 'B', 'b');
      INSERT INTO people (id, company_id, nombres, apellido_paterno)
        VALUES ('${ANA}', '${A}', 'Ana', 'A'), ('${BETO}', '${B}', 'Beto', 'B');
      INSERT INTO pay_periods (id, company_id, period, starts_on, ends_on)
        VALUES ('${PERIOD_A}', '${A}', '2026-11-Q1', '2026-11-01', '2026-11-15');`);

    const owner = new Client({ connectionString: testServerUrl() });
    await owner.connect();
    const exists = await owner.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [ROLE],
    );
    if (exists.rows.length === 0) {
      await owner.query(
        `CREATE ROLE ${ROLE} LOGIN NOBYPASSRLS PASSWORD 'pay-periods-check'`,
      );
    }
    await owner.query(`GRANT workia_app TO ${ROLE}`);
    await owner.end();

    const url = new URL(database.url);
    url.username = ROLE;
    url.password = "pay-periods-check";
    app = new Client({ connectionString: url.toString() });
    await app.connect();
  });

  afterAll(async () => {
    await app?.end();
    await database?.drop();
  });

  it("refuses a malformed period, an open period with a close time and bad counts", async () => {
    await expect(
      database.query(
        `INSERT INTO pay_periods (company_id, period, starts_on, ends_on) VALUES ('${A}', '2026-11-Q3', '2026-11-01', '2026-11-15')`,
      ),
    ).rejects.toThrow(/pay_periods_period_check/);
    await expect(
      database.query(
        `INSERT INTO pay_periods (company_id, period, starts_on, ends_on, closed_at) VALUES ('${A}', '2026-11-Q2', '2026-11-16', '2026-11-30', now())`,
      ),
    ).rejects.toThrow(/pay_periods_status_check/);
    await expect(
      database.query(
        `INSERT INTO pay_periods (company_id, period, starts_on, ends_on) VALUES ('${A}', '2026-11-Q1', '2026-11-01', '2026-11-15')`,
      ),
    ).rejects.toThrow(/pay_periods_company_period_unique/);
    await expect(
      database.query(
        `INSERT INTO incidencias_period_snapshot VALUES ('${A}', '${PERIOD_A}', '${ANA}', 'falta', 1, 2, 0)`,
      ),
    ).rejects.toThrow(/incidencias_period_snapshot_counts_check/);
  });

  it("refuses a snapshot row that points at another company's period or person", async () => {
    await expect(
      database.query(
        `INSERT INTO incidencias_period_snapshot VALUES ('${B}', '${PERIOD_A}', '${BETO}', 'falta', 1, 0, 0)`,
      ),
    ).rejects.toThrow(/incidencias_period_snapshot_company_period_fk/);
    await expect(
      database.query(
        `INSERT INTO incidencias_period_snapshot VALUES ('${A}', '${PERIOD_A}', '${BETO}', 'falta', 1, 0, 0)`,
      ),
    ).rejects.toThrow(/incidencias_period_snapshot_company_person_fk/);
  });

  it("isolates companies under RLS; the app never deletes a period nor updates a snapshot", async () => {
    await database.query(
      `INSERT INTO incidencias_period_snapshot VALUES ('${A}', '${PERIOD_A}', '${ANA}', 'falta', 1, 0, 0)`,
    );

    expect(await asApp(B, "SELECT * FROM pay_periods")).toEqual([]);
    expect(await asApp(B, "SELECT * FROM incidencias_period_snapshot")).toEqual(
      [],
    );
    expect(
      await asApp(A, "SELECT kind FROM incidencias_period_snapshot"),
    ).toEqual([{ kind: "falta" }]);
    await expect(
      asApp(A, "UPDATE incidencias_period_snapshot SET count = 2"),
    ).rejects.toThrow(/permission denied/);
    await expect(asApp(A, "DELETE FROM pay_periods")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asApp(
        A,
        `INSERT INTO pay_periods (company_id, period, starts_on, ends_on) VALUES ('${B}', '2026-11-Q2', '2026-11-16', '2026-11-30')`,
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      await asApp(
        A,
        `DELETE FROM incidencias_period_snapshot WHERE pay_period_id = '${PERIOD_A}' RETURNING kind`,
      ),
    ).toEqual([{ kind: "falta" }]);
  });

  describe("under load", () => {
    const MONTH = { from: "2026-10-01", to: "2026-10-31" };

    beforeAll(async () => {
      // Two sites of a hundred people: five years of attendance, a falta on
      // one day in thirty-two and a retardo on another. P-04 (0036) drops
      // person_events_site_day_idx; it is dropped here too so the plans are
      // the ones the helpers get once both are in.
      await database.query(`
        DROP INDEX IF EXISTS person_events_site_day_idx;
        INSERT INTO sites (id, company_id, name, kind)
          VALUES ('${SITE}', '${A}', 'S1', 'sucursal'), ('${OTHER_SITE}', '${A}', 'S2', 'sucursal');
        INSERT INTO people (company_id, nombres, apellido_paterno, site_id)
          SELECT '${A}', 'Carga ' || i, 'Carga',
                 CASE WHEN i <= ${SITE_PEOPLE} THEN '${SITE}'::uuid ELSE '${OTHER_SITE}'::uuid END
          FROM generate_series(1, ${SITE_PEOPLE * 2}) i;
        WITH load AS (
          SELECT p.company_id, p.id, d::date AS day,
                 (hashtext(p.id::text || d::text) & 31) AS roll
          FROM people p, generate_series(date '2021-11-01', date '2026-10-31', interval '1 day') d
          WHERE p.company_id = '${A}' AND p.site_id IS NOT NULL
            AND extract(isodow FROM d) < 7
        )
        INSERT INTO person_events (company_id, person_id, type, occurred_at, source, dedupe_key, payload)
          SELECT company_id, id, 'attendance'::person_event_type, day + time '14:00', 'checador',
                 'attendance:' || to_char(day, 'YYYY-MM-DD'),
                 jsonb_build_object('first_in', '08:00', 'last_out', '17:00')
          FROM load WHERE roll > 0
          UNION ALL
          SELECT company_id, id, 'incidencia'::person_event_type, day + time '15:00', 'engine',
                 'incidencia:engine:' || day,
                 jsonb_build_object('date', to_char(day, 'YYYY-MM-DD'),
                                    'kind', CASE WHEN roll = 0 THEN 'falta' ELSE 'retardo' END,
                                    'minutes', CASE WHEN roll = 0 THEN 0 ELSE 12 END, 'justified', false)
          FROM load WHERE roll IN (0, 1);
        ANALYZE sites;
        ANALYZE people;
        ANALYZE person_events;`);
    });

    it("site absenteeism for a month of a hundred people reads the person index and returns under 150 ms", async () => {
      const plan = await explain(
        absenteeismBySql(A, MONTH, { by: "site", siteId: SITE }),
      );

      expect(plan.indexes).toContain("person_events_person_time_idx");
      expect(plan.seqScans).not.toContain("person_events");
      expect(plan.ms).toBeLessThan(150);
    });

    it("every aggregate reads person_events through the person index, never a full scan", async () => {
      for (const statement of [
        incidenciasBySql(A, MONTH, { by: "site", siteId: SITE }),
        incidenciasBySql(A, MONTH, { by: "person" }),
        incidenciasBySql(A, MONTH, { by: "month", personIds: [ANA] }),
        absenteeismBySql(A, MONTH, { by: "month" }),
        absenteeismBySql(A, MONTH, { by: "site" }),
        incidenciasByPersonSql(A, { from: "2026-10-16", to: "2026-10-31" }),
      ]) {
        const plan = await explain(statement);

        expect(plan.indexes).toContain("person_events_person_time_idx");
        expect(plan.seqScans).not.toContain("person_events");
        expect(plan.ms).toBeLessThan(150);
      }
    });
  });
});
