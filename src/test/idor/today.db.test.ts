/**
 * The today view (Workia 2.0 P-04). Company B cannot read company A's site,
 * area or team for the day. Also covers absent people, the day's incidencias
 * and keyset pages. Titles are the surface ids in docs/idor-matrix.md.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { people, sites } from "@/lib/db/schema";
import { appendPersonEvents, attendanceDedupeKey } from "@/lib/timeline";
import { listTodayPage, todayPageQuery } from "@/lib/timeline/today";
import { uniqueCurp } from "@/test/curp";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";

const DAY = "2026-11-04";

let a: Tenant;
let b: Tenant;
let extra: Array<{ id: string }>;

beforeAll(async () => {
  a = await seedTenant("TDA");
  b = await seedTenant("TDB");

  // Three more people at A's site, named so the order is known.
  extra = await ownerDb
    .insert(people)
    .values(
      ["Zamora", "Bravo", "Lara"].map((apellido) => ({
        companyId: a.companyId,
        nombres: "Persona",
        apellidoPaterno: apellido,
        curp: uniqueCurp(),
        siteId: a.site.id,
      })),
    )
    .returning({ id: people.id });

  await appendPersonEvents(a.companyId, [
    {
      personId: a.person.id,
      type: "attendance",
      occurredAt: new Date(`${DAY}T14:05:00Z`),
      source: "checador",
      dedupeKey: attendanceDedupeKey(DAY),
      payload: { first_in: "08:05", punches: 1 },
    },
    // Yesterday's attendance is not today's.
    {
      personId: extra[0].id,
      type: "attendance",
      occurredAt: new Date("2026-11-03T14:00:00Z"),
      source: "checador",
      dedupeKey: attendanceDedupeKey("2026-11-03"),
      payload: { first_in: "08:00", punches: 2 },
    },
    // 08:05 in Mexico City on DAY, and one late the evening before (local).
    {
      personId: a.person.id,
      type: "incidencia",
      occurredAt: new Date(`${DAY}T14:05:00Z`),
      source: "engine",
      payload: { kind: "retardo", minutes: 5 },
    },
    {
      personId: a.person.id,
      type: "incidencia",
      occurredAt: new Date(`${DAY}T05:30:00Z`),
      source: "engine",
      payload: { kind: "salida_anticipada" },
    },
  ]);
});

describe("lib:timeline/today/listTodayPage", () => {
  it("returns nothing of company A's site, area or team to company B", async () => {
    for (const scope of [
      { siteId: a.site.id },
      { areaId: a.area.id },
      { managerId: a.person.id },
    ]) {
      expect(await listTodayPage(b.companyId, scope, { day: DAY })).toEqual({
        items: [],
        next: null,
      });
    }
  });

  it("lists the whole roster by name, with the day's attendance and incidencias", async () => {
    const page = await listTodayPage(
      a.companyId,
      { siteId: a.site.id },
      { day: DAY },
    );

    expect(page.next).toBeNull();
    expect(page.items.map((row) => row.apellidoPaterno)).toEqual([
      "Bravo",
      "Idor",
      "Lara",
      "Zamora",
    ]);

    const person = page.items.find((row) => row.personId === a.person.id)!;
    expect(person.attendance).toEqual({ first_in: "08:05", punches: 1 });
    expect(person.incidencias.map((row) => row.payload.kind)).toEqual([
      "retardo",
    ]);

    // Absent today, present yesterday.
    const zamora = page.items.find((row) => row.personId === extra[0].id)!;
    expect(zamora.attendance).toBeNull();
    expect(zamora.incidencias).toEqual([]);
  });

  it("reads a manager's direct reports", async () => {
    const page = await listTodayPage(
      a.companyId,
      { managerId: a.person.id },
      { day: DAY },
    );

    expect(page.items.map((row) => row.personId)).toEqual([a.teammate.id]);
  });

  it("pages by cursor without repeating or skipping anyone", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;

    do {
      const page: Awaited<ReturnType<typeof listTodayPage>> =
        await listTodayPage(
          a.companyId,
          { siteId: a.site.id },
          { day: DAY, cursor, limit: 1 },
        );
      seen.push(...page.items.map((row) => row.apellidoPaterno));
      cursor = page.next;
    } while (cursor);

    expect(seen).toEqual(["Bravo", "Idor", "Lara", "Zamora"]);
  });

  it("starts over on a cursor it did not make, and refuses a bad day", async () => {
    const page = await listTodayPage(
      a.companyId,
      { siteId: a.site.id },
      { day: DAY, cursor: "not-a-cursor" },
    );
    expect(page.items).toHaveLength(4);

    await expect(
      listTodayPage(a.companyId, { siteId: a.site.id }, { day: "04/11/2026" }),
    ).rejects.toThrow("Invalid day");
  });
});

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

describe("today view plan (P-04)", () => {
  it("reads a site of a hundred people under a five-year load with index probes only", async () => {
    const [site] = await ownerDb
      .insert(sites)
      .values({ companyId: a.companyId, name: "Carga", kind: "sucursal" })
      .returning();
    const run = (query: string, params: unknown[] = []) =>
      ownerDb.$client.query(query, params);

    await run(
      `INSERT INTO people (company_id, nombres, apellido_paterno, site_id)
       SELECT $1, 'Carga ' || i, 'Hoy', $2 FROM generate_series(1, 100) i`,
      [a.companyId, site.id],
    );
    await run(
      `INSERT INTO person_events (company_id, person_id, type, occurred_at, source, dedupe_key, payload)
       SELECT p.company_id, p.id, 'attendance', d + time '14:00', 'checador',
              'attendance:' || to_char(d, 'YYYY-MM-DD'),
              jsonb_build_object('first_in', '08:00', 'last_out', '17:00', 'punches', 2)
       FROM people p, generate_series($2::date - interval '5 years', $2::date, interval '1 day') d
       WHERE p.company_id = $1 AND p.site_id = $3`,
      [a.companyId, DAY, site.id],
    );
    await run(
      `INSERT INTO person_events (company_id, person_id, type, occurred_at, source, payload)
       SELECT p.company_id, p.id, 'incidencia', d + time '14:10', 'engine',
              jsonb_build_object('kind', 'retardo')
       FROM people p, generate_series($2::date - interval '5 years', $2::date, interval '7 days') d
       WHERE p.company_id = $1 AND p.site_id = $3`,
      [a.companyId, DAY, site.id],
    );
    await run("ANALYZE person_events");
    await run("ANALYZE people");

    const query = todayPageQuery(
      a.companyId,
      { siteId: site.id },
      { day: DAY },
      db,
    ).toSQL();
    const {
      rows: [{ "QUERY PLAN": plans }],
    } = await run(`EXPLAIN (ANALYZE, FORMAT JSON) ${query.sql}`, query.params);
    const nodes = nodesOf(plans[0].Plan as PlanNode);
    const indexes = new Set(nodes.flatMap((node) => node["Index Name"] ?? []));

    expect(
      nodes.filter(
        (node) =>
          node["Node Type"] === "Seq Scan" &&
          node["Relation Name"] === "person_events",
      ),
    ).toEqual([]);
    expect(indexes).toContain("person_events_dedupe_unique");
    expect(indexes).toContain("person_events_person_time_idx");
    expect(plans[0]["Execution Time"]).toBeLessThan(150);

    const page = await listTodayPage(
      a.companyId,
      { siteId: site.id },
      {
        day: DAY,
      },
    );
    expect(page.items).toHaveLength(100);
    expect(page.items.every((row) => row.attendance !== null)).toBe(true);
  });
});
