import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createScratchDatabase, testServerUrl } from "@/test/db/scratch";

type Scratch = Awaited<ReturnType<typeof createScratchDatabase>>;

const A = "00000000-0000-0000-0000-0000000000a1";
const B = "00000000-0000-0000-0000-0000000000b1";
const ANA = "00000000-0000-0000-0000-00000000a001";
const BETO = "00000000-0000-0000-0000-00000000b001";
const ROLE = "workia_app_timeline_check";

/** Load for the plan check: people of company A, five years of daily attendance each. */
const LOAD_PEOPLE = 40;

type PlanNode = {
  "Node Type": string;
  "Index Name"?: string;
  Plans?: PlanNode[];
};

const nodesOf = (node: PlanNode): PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(nodesOf),
];

describe("0031: person_events", () => {
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

  const insert = (values: string) =>
    database.query(
      `INSERT INTO person_events (company_id, person_id, type, occurred_at, source, dedupe_key, payload) VALUES ${values}`,
    );

  beforeAll(async () => {
    database = await createScratchDatabase("m0031");
    await database.query(`
      INSERT INTO companies (id, name, slug) VALUES ('${A}', 'A', 'a'), ('${B}', 'B', 'b');
      INSERT INTO people (id, company_id, nombres, apellido_paterno)
        VALUES ('${ANA}', '${A}', 'Ana', 'A'), ('${BETO}', '${B}', 'Beto', 'B');`);

    const owner = new Client({ connectionString: testServerUrl() });
    await owner.connect();
    const exists = await owner.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [ROLE],
    );
    if (exists.rows.length === 0) {
      await owner.query(
        `CREATE ROLE ${ROLE} LOGIN NOBYPASSRLS PASSWORD 'timeline-check'`,
      );
    }
    await owner.query(`GRANT workia_app TO ${ROLE}`);
    await owner.end();

    const url = new URL(database.url);
    url.username = ROLE;
    url.password = "timeline-check";
    app = new Client({ connectionString: url.toString() });
    await app.connect();
  });

  afterAll(async () => {
    await app?.end();
    await database?.drop();
  });

  it("has no CURP and no account column", async () => {
    const columns = await database.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'person_events' ORDER BY ordinal_position",
    );

    expect(columns.map((column) => column.column_name)).toEqual([
      "id",
      "company_id",
      "person_id",
      "type",
      "occurred_at",
      "source",
      "dedupe_key",
      "payload",
    ]);
  });

  it("refuses an event that points at a person of another company", async () => {
    await expect(
      insert(`('${B}', '${ANA}', 'document', now(), 'app', null, '{}')`),
    ).rejects.toThrow(/person_events_company_person_fk/);
  });

  it("keeps one attendance row per person per day", async () => {
    await insert(
      `('${A}', '${ANA}', 'attendance', '2026-11-03 14:12Z', 'checador', 'attendance:2026-11-03', '{"first_in":"08:12"}')`,
    );

    await expect(
      insert(
        `('${A}', '${ANA}', 'attendance', '2026-11-03 23:01Z', 'checador', 'attendance:2026-11-03', '{}')`,
      ),
    ).rejects.toThrow(/person_events_dedupe_unique/);
    // Without its day key, or with a key that is not a date. Another person
    // may use the same day.
    await expect(
      insert(`('${A}', '${ANA}', 'attendance', now(), 'checador', null, '{}')`),
    ).rejects.toThrow(/person_events_attendance_dedupe_check/);
    await expect(
      insert(
        `('${A}', '${ANA}', 'attendance', now(), 'checador', 'attendance:2026-11-03:late', '{}')`,
      ),
    ).rejects.toThrow(/person_events_attendance_dedupe_check/);
    await insert(
      `('${B}', '${BETO}', 'attendance', '2026-11-03 14:00Z', 'checador', 'attendance:2026-11-03', '{}')`,
    );
  });

  it("scopes dedupe keys to the person", async () => {
    await insert(
      `('${A}', '${ANA}', 'receipt', now(), 'payroll', 'receipt:payroll:2026-10-Q2', '{}'),
       ('${B}', '${BETO}', 'receipt', now(), 'payroll', 'receipt:payroll:2026-10-Q2', '{}')`,
    );
    await expect(
      insert(
        `('${A}', '${ANA}', 'receipt', now(), 'payroll', 'receipt:payroll:2026-10-Q2', '{}')`,
      ),
    ).rejects.toThrow(/person_events_dedupe_unique/);
  });

  it("refuses a payload that is not an object or is too large", async () => {
    await expect(
      insert(`('${A}', '${ANA}', 'document', now(), 'app', null, '[]')`),
    ).rejects.toThrow(/person_events_payload_check/);
    await expect(
      insert(
        `('${A}', '${ANA}', 'document', now(), 'app', null, jsonb_build_object('blob', (SELECT string_agg(md5(i::text), '') FROM generate_series(1, 400) i)))`,
      ),
    ).rejects.toThrow(/person_events_payload_check/);
  });

  it("is append-only for the app role, and RLS shows one company", async () => {
    expect(await asApp(B, "SELECT company_id FROM person_events")).toEqual([
      { company_id: B },
      { company_id: B },
    ]);
    await expect(
      asApp(A, "UPDATE person_events SET source = 'x'"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asApp(
        A,
        `INSERT INTO person_events (company_id, person_id, type, occurred_at, source) VALUES ('${B}', '${BETO}', 'document', now(), 'app')`,
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      await asApp(
        A,
        `INSERT INTO person_events (company_id, person_id, type, occurred_at, source) VALUES ('${A}', '${ANA}', 'document', now(), 'app') RETURNING type`,
      ),
    ).toEqual([{ type: "document" }]);
  });

  it("goes away with the person row", async () => {
    await database.query(
      `INSERT INTO people (id, company_id, nombres, apellido_paterno) VALUES ('00000000-0000-0000-0000-00000000a0ff', '${A}', 'Tmp', 'A');
       INSERT INTO person_events (company_id, person_id, type, occurred_at, source) VALUES ('${A}', '00000000-0000-0000-0000-00000000a0ff', 'employment', now(), 'app');
       DELETE FROM people WHERE id = '00000000-0000-0000-0000-00000000a0ff';`,
    );

    expect(
      await database.query(
        "SELECT count(*)::int AS n FROM person_events WHERE person_id = '00000000-0000-0000-0000-00000000a0ff'",
      ),
    ).toEqual([{ n: 0 }]);
  });

  it("reads one person's history with one index range scan and no sort, under a five-year load", async () => {
    await database.query(`
      INSERT INTO people (company_id, nombres, apellido_paterno)
        SELECT '${A}', 'Carga ' || i, 'A' FROM generate_series(1, ${LOAD_PEOPLE}) i;
      INSERT INTO person_events (company_id, person_id, type, occurred_at, source, dedupe_key, payload)
        SELECT p.company_id, p.id, 'attendance', d + time '14:00', 'checador',
               'attendance:' || to_char(d, 'YYYY-MM-DD'),
               jsonb_build_object('site_id', 's1', 'first_in', '08:00', 'last_out', '17:00', 'punches', 2)
        FROM people p, generate_series(date '2021-11-01', date '2026-10-31', interval '1 day') d
        WHERE p.company_id = '${A}';
      ANALYZE person_events;`);

    const [{ "QUERY PLAN": plans }] = await database.query<{
      "QUERY PLAN": Array<{ Plan: PlanNode }>;
    }>(
      `EXPLAIN (FORMAT JSON)
       SELECT type, occurred_at, payload FROM person_events
       WHERE company_id = '${A}' AND person_id = '${ANA}'
       ORDER BY occurred_at DESC, id DESC LIMIT 200`,
    );
    const nodes = nodesOf(plans[0].Plan);

    expect(nodes.map((node) => node["Node Type"])).not.toContain("Sort");
    expect(nodes.map((node) => node["Node Type"])).not.toContain("Seq Scan");
    expect(
      nodes.filter((node) => node["Index Name"]).map((n) => n["Index Name"]),
    ).toEqual(["person_events_person_time_idx"]);
  });
});
