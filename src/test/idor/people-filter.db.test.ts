/**
 * The Personas filter (Iniciativa 3) on a real database: what each condition
 * means, that the list and «Exportar (N)» read the same rows, and that every
 * read stays in the company. Test titles that are surface ids match
 * docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { GET as exportRoute } from "@/app/app/personas/exportar/route";
import { listExpiringContracts } from "@/lib/contracts";
import {
  areas,
  auditEvents,
  contracts,
  people,
  regions,
  sites,
} from "@/lib/db/schema";
import { isoToday } from "@/lib/format/date";
import { listPeoplePage } from "@/lib/people";
import {
  countPeopleFilterAction,
  countPeopleFilterOptionsAction,
} from "@/lib/people/filter/actions";
import { peopleFilterContext } from "@/lib/people/filter/query";
import {
  coercePeopleFilter,
  EMPTY_PEOPLE_FILTER,
  type PeopleFilter,
} from "@/lib/people/filter/schema";
import {
  parsePeopleListParams,
  peopleFilterQueryString,
} from "@/lib/people/filter/url";
import {
  countPeopleFiltered,
  countPeopleFilterOptions,
  listPeopleFiltered,
  listPeopleFilteredAfter,
  listPeopleNamesByIds,
} from "@/lib/people/list";

import { idsIn, ownerDb, seedTenant, tenantIds, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;
let f: Tenant;
const today = isoToday();
const plusDays = (days: number) => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const ALL = new Set(["contracts:read", "compensation:read"]);
const ctx = (permissions: ReadonlySet<string> = ALL) =>
  peopleFilterContext(permissions, today);

const ids: Record<string, string> = {};
const refs: Record<string, string> = {};

const person = async (
  key: string,
  values: Partial<typeof people.$inferInsert> = {},
) => {
  const [row] = await ownerDb
    .insert(people)
    .values({
      companyId: f.companyId,
      nombres: `Filtro ${key}`,
      apellidoPaterno: "Prueba",
      curp: `CURP${key}`.padEnd(18, "X").slice(0, 18).toUpperCase(),
      rfc: `RFC${key}`.padEnd(13, "X").slice(0, 13).toUpperCase(),
      nss: `9${String(Object.keys(ids).length).padStart(10, "0")}`,
      ...values,
    })
    .returning();
  ids[key] = row.id;
  return row;
};

const contract = (
  key: string,
  values: Partial<typeof contracts.$inferInsert>,
) =>
  ownerDb.insert(contracts).values({
    companyId: f.companyId,
    personId: ids[key],
    type: "determinado",
    startDate: "2026-01-01",
    generatedText: "texto",
    ...values,
  });

const matching = async (
  filter: Partial<PeopleFilter> & { conditions?: unknown[] },
  permissions: ReadonlySet<string> = ALL,
) => {
  const parsed = coercePeopleFilter({ ...EMPTY_PEOPLE_FILTER, ...filter });
  expect(parsed.conditions).toHaveLength(filter.conditions?.length ?? 0);
  const { rows, total } = await listPeopleFiltered(f.companyId, {
    filter: parsed,
    context: ctx(permissions),
    columns: [],
    page: 1,
    pageSize: 50,
  });
  expect(total).toBe(rows.length);
  return new Set(rows.map((row) => row.id));
};

const keys = (set: Set<string>) =>
  Object.entries(ids)
    .filter(([, id]) => set.has(id))
    .map(([key]) => key)
    .sort();

const noLeak = (value: unknown) => {
  const leaked = idsIn(value).filter((id) => tenantIds(a).has(id));
  expect(leaked, "ids of company A in company B's result").toEqual([]);
};

beforeAll(async () => {
  a = await seedTenant("FA");
  b = await seedTenant("FB");
  f = await seedTenant("FF");

  const [norte] = await ownerDb
    .insert(regions)
    .values({ companyId: f.companyId, name: "Norte F" })
    .returning();
  const areaRows = await ownerDb
    .insert(areas)
    .values(
      ["Finanzas", "Ventas", "Almacén"].map((name) => ({
        companyId: f.companyId,
        name: `${name} F`,
      })),
    )
    .returning();
  const [centro, sinRegion] = await ownerDb
    .insert(sites)
    .values([
      {
        companyId: f.companyId,
        name: "Centro F",
        kind: "sucursal",
        regionId: norte.id,
      },
      { companyId: f.companyId, name: "Libre F", kind: "sucursal" },
    ])
    .returning();
  Object.assign(refs, {
    norte: norte.id,
    finanzas: areaRows[0].id,
    ventas: areaRows[1].id,
    almacen: areaRows[2].id,
    centro: centro.id,
    libre: sinRegion.id,
  });

  // (A ∨ B) ∧ X: Finanzas or Ventas, at Centro.
  await person("p1", {
    areaId: refs.finanzas,
    siteId: refs.centro,
    fechaIngreso: "2025-02-10",
  });
  await person("p2", {
    areaId: refs.ventas,
    siteId: refs.centro,
    fechaIngreso: "2025-06-30",
  });
  await person("p3", {
    areaId: refs.almacen,
    siteId: refs.centro,
    fechaIngreso: "2026-01-15",
    status: "baja",
  });
  await person("p4", {
    areaId: refs.finanzas,
    siteId: refs.libre,
    curp: null,
    nss: null,
  });

  // boss → m1 → m2 → m3, and a cycle c1 ↔ c2.
  await person("boss");
  await person("m1", { managerId: ids.boss });
  await person("m2", { managerId: ids.m1 });
  await person("m3", { managerId: ids.m2, rfc: null });
  await person("c1");
  await person("c2", { managerId: ids.c1 });
  await ownerDb
    .update(people)
    .set({ managerId: ids.c2 })
    .where(eq(people.id, ids.c1));

  await person("juan", { nombres: "Juan Carlos", apellidoPaterno: "Pérez" });

  await contract("p1", { endDate: plusDays(5), salarioDiario: "500.00" });
  await contract("p2", { endDate: plusDays(40) });
  await contract("p2", {
    endDate: plusDays(-300),
    status: "renovado",
    startDate: "2025-01-01",
  });
  await contract("p3", { type: "indeterminado" });
  await contract("p4", { endDate: plusDays(-3) });
  await contract("m1", { endDate: plusDays(-30), status: "vencido" });
  await contract("m2", { endDate: plusDays(20), status: "no_renovado" });
  // The fixture's own person has a contract ending in 10 days.
  ids.fixture = f.person.id;
  ids.teammate = f.teammate.id;
});

describe("filter semantics", () => {
  it("ANDs fields and ORs within one: (Finanzas ∨ Ventas) ∧ Centro", async () => {
    expect(
      keys(
        await matching({
          conditions: [
            { field: "area", op: "is", values: [refs.finanzas, refs.ventas] },
            { field: "sucursal", op: "is", values: [refs.centro] },
          ],
        }),
      ),
    ).toEqual(["p1", "p2"]);
  });

  it("is not / empty on a catalog field", async () => {
    const notFinanzas = await matching({
      conditions: [{ field: "area", op: "is_not", values: [refs.finanzas] }],
    });
    expect(notFinanzas.has(ids.p1)).toBe(false);
    expect(notFinanzas.has(ids.p2)).toBe(true);
    // Without area counts as «no es Finanzas».
    expect(notFinanzas.has(ids.boss)).toBe(true);

    const noArea = await matching({
      conditions: [{ field: "area", op: "empty" }],
    });
    expect(noArea.has(ids.boss)).toBe(true);
    expect(noArea.has(ids.p1)).toBe(false);
  });

  it("filters by region through the site", async () => {
    expect(
      keys(
        await matching({
          conditions: [{ field: "region", op: "is", values: [refs.norte] }],
        }),
      ),
    ).toEqual(["p1", "p2", "p3"]);

    const withoutRegion = await matching({
      conditions: [{ field: "region", op: "empty" }],
    });
    expect(withoutRegion.has(ids.p4)).toBe(true);
    expect(withoutRegion.has(ids.boss)).toBe(true);
    expect(withoutRegion.has(ids.p1)).toBe(false);
  });

  it("filters fecha de ingreso between, before and after", async () => {
    expect(
      keys(
        await matching({
          conditions: [
            {
              field: "ingreso",
              op: "between",
              from: "2025-01-01",
              to: "2025-06-30",
            },
          ],
        }),
      ),
    ).toEqual(["p1", "p2"]);
    expect(
      keys(
        await matching({
          conditions: [{ field: "ingreso", op: "after", from: "2025-06-30" }],
        }),
      ),
    ).toEqual(["p3"]);
    expect(
      keys(
        await matching({
          conditions: [{ field: "ingreso", op: "before", from: "2025-06-30" }],
        }),
      ),
    ).toEqual(["p1"]);
  });

  it("Jefe: direct reports by default, the whole team with the switch", async () => {
    expect(
      keys(
        await matching({
          conditions: [{ field: "jefe", op: "is", values: [ids.boss] }],
        }),
      ),
    ).toEqual(["m1"]);
    expect(
      keys(
        await matching({
          conditions: [
            { field: "jefe", op: "is", values: [ids.boss], team: true },
          ],
        }),
      ),
    ).toEqual(["m1", "m2", "m3"]);

    const notTeam = await matching({
      conditions: [
        { field: "jefe", op: "is_not", values: [ids.boss], team: true },
      ],
    });
    expect(notTeam.has(ids.boss)).toBe(true);
    expect(notTeam.has(ids.m3)).toBe(false);
  });

  it("Jefe with the team survives a cycle and keeps the manager out", async () => {
    expect(
      keys(
        await matching({
          conditions: [
            { field: "jefe", op: "is", values: [ids.c1], team: true },
          ],
        }),
      ),
    ).toEqual(["c2"]);
  });

  it("«Vence en 30 días» is exactly listExpiringContracts", async () => {
    const expiring = await listExpiringContracts(f.companyId, {
      today,
      withinDays: 30,
      limit: 1000,
    });
    const expected = new Set(expiring.map((row) => row.personId));

    const got = await matching({
      conditions: [{ field: "vence", op: "next_days", days: 30 }],
    });

    expect(keys(got)).toEqual(keys(expected));
    expect(keys(got)).toEqual(["fixture", "p1"]);
  });

  it("contract status: vigente, vencido (any status not in force) and sin contrato", async () => {
    expect(
      keys(
        await matching({
          conditions: [{ field: "contrato", op: "is", values: ["vigente"] }],
        }),
      ),
    ).toEqual(["fixture", "p1", "p2", "p3"]);
    expect(
      keys(
        await matching({
          conditions: [{ field: "contrato", op: "is", values: ["vencido"] }],
        }),
      ),
    ).toEqual(["m1", "m2", "p4"]);

    const none = await matching({
      conditions: [{ field: "contrato", op: "is", values: ["sin_contrato"] }],
    });
    expect(none.has(ids.boss)).toBe(true);
    expect(none.has(ids.p1)).toBe(false);
    expect(none.has(ids.m1)).toBe(false);

    expect(
      keys(
        await matching({
          conditions: [
            { field: "tipoContrato", op: "is", values: ["indeterminado"] },
          ],
        }),
      ),
    ).toEqual(["p3"]);
  });

  it("ignores contract conditions without contracts:read", async () => {
    const all = await matching({});
    // Restricted by the query itself: the same as no condition at all.
    const { total } = await listPeopleFiltered(f.companyId, {
      filter: coercePeopleFilter({
        conditions: [{ field: "vence", op: "next_days", days: 30 }],
      }),
      context: ctx(new Set()),
      columns: [],
      page: 1,
      pageSize: 50,
    });
    expect(total).toBe(all.size);
  });

  it("datos incompletos: missing any of the chosen identifiers", async () => {
    expect(
      keys(
        await matching({
          conditions: [
            { field: "incompletos", op: "is", values: ["curp", "rfc"] },
          ],
        }),
      ),
    ).toEqual(expect.arrayContaining(["m3", "p4"]));
    const nss = await matching({
      conditions: [{ field: "incompletos", op: "is", values: ["nss"] }],
    });
    expect(nss.has(ids.p4)).toBe(true);
    expect(nss.has(ids.p1)).toBe(false);
  });

  it("old URLs give the same people as the new filter", async () => {
    await ownerDb
      .update(people)
      .set({ updatedAt: new Date() })
      .where(eq(people.id, ids.p3));
    const old = parsePeopleListParams({ status: "baja", region: refs.norte });
    const fresh = parsePeopleListParams(
      Object.fromEntries(
        new URLSearchParams(peopleFilterQueryString(old.filter)),
      ),
    );

    expect(fresh.filter).toEqual(old.filter);
    expect(keys(await matching(old.filter))).toEqual(["p3"]);

    const legacy = await listPeoplePage(f.companyId, {
      status: "baja",
      regionId: refs.norte,
      page: 1,
      pageSize: 50,
    });
    expect(legacy.rows.map((row) => row.id)).toEqual([ids.p3]);
  });

  it("searches every word anywhere, like the list always did", async () => {
    expect(keys(await matching({ q: "Juan Pérez" }))).toEqual(["juan"]);
    expect(keys(await matching({ q: "100%" }))).toEqual([]);
  });

  it("counts per option under the rest of the filter", async () => {
    const counts = await countPeopleFilterOptions(
      f.companyId,
      coercePeopleFilter({
        conditions: [
          { field: "area", op: "is", values: [refs.finanzas] },
          { field: "sucursal", op: "is", values: [refs.centro] },
        ],
      }),
      ctx(),
      "area",
    );
    expect(counts).toEqual({
      [refs.finanzas]: 1,
      [refs.ventas]: 1,
      [refs.almacen]: 1,
    });
  });
});

describe("«Exportar (N)» has the list's rows and columns", () => {
  const csvRows = async (query: string) => {
    const response = await exportRoute(
      new Request(`http://test/app/personas/exportar?${query}`),
    );
    expect(response.status).toBe(200);
    const lines = (await response.text())
      .replace(/^﻿/, "")
      .trim()
      .split(/\r?\n/);
    return { header: lines[0], rows: lines.slice(1) };
  };

  it("exports exactly N rows with the visible columns, region included", async () => {
    actAs(f.admin);
    const filter = coercePeopleFilter({
      q: "Filtro",
      conditions: [
        { field: "region", op: "is", values: [refs.norte] },
        { field: "relacion", op: "is", values: ["activa"] },
      ],
    });
    const n = await countPeopleFiltered(f.companyId, filter, ctx());
    const { header, rows } = await csvRows(
      `${peopleFilterQueryString(filter)}&cols=area.sucursal.salarioDiario&format=csv`,
    );

    expect(n).toBe(2);
    expect(rows).toHaveLength(n);
    expect(header).toBe("ID Workia,Nombre,Área,Sucursal,Salario diario");
    expect(rows.join("\n")).toContain("500.00");
  });

  it("the import-format export uses the same filter (old region link included)", async () => {
    actAs(f.admin);
    const { rows } = await csvRows(`region=${refs.norte}&format=csv`);
    expect(rows).toHaveLength(3);
  });

  it("records the filter in the people_export audit", async () => {
    actAs(f.admin);
    await csvRows(`q=Juan%20P%C3%A9rez&cols=rfc&format=csv`);

    let payload: string | undefined;
    for (let attempt = 0; attempt < 20 && !payload; attempt += 1) {
      const events = await ownerDb
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.companyId, f.companyId),
            eq(auditEvents.resourceType, "people_export"),
          ),
        );
      payload = events
        .map((event) => JSON.stringify(event.payload))
        .find((text) => text.includes('"q":"Juan Pérez"'));
      if (!payload) await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(payload).toContain('"columns":["rfc"]');
  });

  it("drops payroll columns without compensation:read", async () => {
    const rows = await listPeopleFilteredAfter(f.companyId, {
      filter: coercePeopleFilter({ q: "Filtro p1" }),
      context: ctx(new Set(["contracts:read"])),
      columns: ["salarioDiario", "tipoContrato"],
      limit: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].contract?.type).toBe("determinado");
    expect(rows[0].contract?.salarioDiario).toBeNull();
  });
});

describe("filtered reads stay inside the company", () => {
  // Company B asks with company A's ids in its filter: nothing of A comes back.
  const foreign = () =>
    coercePeopleFilter({
      q: "Persona",
      conditions: [
        { field: "area", op: "is", values: [a.area.id] },
        { field: "jefe", op: "is", values: [a.person.id], team: true },
      ],
    });

  it("lib:people/list/listPeopleFiltered", async () => {
    const all = await listPeopleFiltered(b.companyId, {
      filter: EMPTY_PEOPLE_FILTER,
      context: ctx(),
      columns: ["jefe", "salarioDiario", "region"],
      page: 1,
      pageSize: 100,
    });
    noLeak(all);
    expect(all.rows.map((row) => row.id)).toContain(b.person.id);
    expect(
      (
        await listPeopleFiltered(b.companyId, {
          filter: foreign(),
          context: ctx(),
          columns: [],
          page: 1,
          pageSize: 100,
        })
      ).total,
    ).toBe(0);
  });

  it("lib:people/list/listPeopleFilteredAfter", async () => {
    noLeak(
      await listPeopleFilteredAfter(b.companyId, {
        filter: EMPTY_PEOPLE_FILTER,
        context: ctx(),
        columns: ["tipoContrato", "salarioMensual"],
        limit: 100,
      }),
    );
  });

  it("lib:people/list/countPeopleFiltered", async () => {
    expect(await countPeopleFiltered(b.companyId, foreign(), ctx())).toBe(0);
  });

  it("lib:people/list/countPeopleFilterOptions", async () => {
    for (const field of ["area", "puesto", "sucursal", "region"] as const) {
      noLeak(
        await countPeopleFilterOptions(
          b.companyId,
          EMPTY_PEOPLE_FILTER,
          ctx(),
          field,
        ),
      );
    }
  });

  it("lib:people/list/listPeopleNamesByIds", async () => {
    expect(
      await listPeopleNamesByIds(b.companyId, [a.person.id, a.teammate.id]),
    ).toEqual([]);
  });

  it("action:people/countPeopleFilterAction", async () => {
    actAs(b.admin);
    expect(await countPeopleFilterAction(foreign())).toBe(0);
    expect(await countPeopleFilterAction(EMPTY_PEOPLE_FILTER)).toBeGreaterThan(
      0,
    );
    actAs(null);
    expect(await countPeopleFilterAction(EMPTY_PEOPLE_FILTER)).toBe(0);
  });

  it("action:people/countPeopleFilterOptionsAction", async () => {
    actAs(b.admin);
    const counts = await countPeopleFilterOptionsAction(
      EMPTY_PEOPLE_FILTER,
      "area",
    );
    noLeak(counts);
    expect(counts[b.area.id]).toBeGreaterThan(0);
  });
});
