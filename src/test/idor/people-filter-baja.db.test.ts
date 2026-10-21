/**
 * The baja fields and columns of the Personas filter (Iniciativa 3 on the
 * baja model of Iniciativa 2) on a real database: a fecha de baja range
 * implies Baja, motivos stay in the company, antigüedad after a rehire with
 * and without «Reconocer antigüedad previa», and the finiquito amount only
 * with compensation:read in the list, a shared view and «Exportar (N)».
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GET as exportRoute } from "@/app/app/personas/exportar/route";
import {
  companyMemberships,
  employmentPeriods,
  people,
  permissions as permissionsTable,
  rolePermissions,
  roles,
  terminationReasons,
  users,
} from "@/lib/db/schema";
import { rehirePerson, terminatePerson } from "@/lib/people/employment";
import type { PeopleColumnId } from "@/lib/people/filter/columns";
import { peopleFilterContext } from "@/lib/people/filter/query";
import {
  coercePeopleFilter,
  EMPTY_PEOPLE_FILTER,
} from "@/lib/people/filter/schema";
import { peopleFilterQueryString } from "@/lib/people/filter/url";
import {
  countPeopleFiltered,
  countPeopleFilterOptions,
  listPeopleFiltered,
  listPeopleFilteredAfter,
  peopleColumnValue,
} from "@/lib/people/list";
import { createPeopleView, listPeopleViews } from "@/lib/people/views";
import { listTerminationReasons } from "@/lib/termination-reasons";

import { idsIn, ownerDb, seedTenant, tenantIds, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let x: Tenant;
let y: Tenant;
let r1: typeof terminationReasons.$inferSelect;
let r2: typeof terminationReasons.$inferSelect;
let foreignReason: typeof terminationReasons.$inferSelect;
/** people:read + people:export, no compensation:read (no built-in role has that). */
let exporter: { id: string; email: string };

/** A fixed «today»: every date below is relative to it. */
const TODAY = "2026-10-21";
const ALL = new Set(["contracts:read", "compensation:read"]);
const NO_PAY = new Set(["contracts:read"]);
const ctx = (permissions: ReadonlySet<string> = ALL) =>
  peopleFilterContext(permissions, TODAY);

const BAJA_COLUMNS: PeopleColumnId[] = [
  "fechaBaja",
  "tipoBaja",
  "motivoBaja",
  "recontratable",
  "fechaAntiguedad",
  "antiguedad",
  "finiquitoMonto",
];

const ids: Record<string, string> = {};

const person = async (
  key: string,
  values: Partial<typeof people.$inferInsert> = {},
) => {
  const [row] = await ownerDb
    .insert(people)
    .values({
      companyId: x.companyId,
      nombres: `Baja ${key}`,
      apellidoPaterno: "Prueba",
      ...values,
    })
    .returning();
  ids[key] = row.id;
  return row;
};

const baja = (
  key: string,
  fechaBaja: string,
  values: {
    tipoBaja?: "voluntaria" | "despido" | "termino_contrato" | "otra";
    motivoBajaId?: string;
    recontratable?: boolean;
    monto?: number;
  } = {},
) =>
  terminatePerson(
    x.companyId,
    ids[key],
    {
      fechaBaja,
      tipoBaja: values.tipoBaja ?? "voluntaria",
      motivoBajaId: values.motivoBajaId ?? r1.id,
      recontratable: values.recontratable ?? true,
      ...(values.monto !== undefined
        ? {
            finiquito: {
              estado: "pagado" as const,
              fecha: fechaBaja,
              monto: values.monto,
            },
          }
        : {}),
    },
    x.admin.id,
  );

const matching = async (
  filter: { q?: string; conditions?: unknown[] },
  companyId = () => x.companyId,
) => {
  const parsed = coercePeopleFilter({ ...EMPTY_PEOPLE_FILTER, ...filter });
  expect(parsed.conditions).toHaveLength(filter.conditions?.length ?? 0);
  const { rows, total } = await listPeopleFiltered(companyId(), {
    filter: parsed,
    context: ctx(),
    columns: [],
    page: 1,
    pageSize: 100,
  });
  expect(total).toBe(rows.length);
  return rows;
};

const keys = async (conditions: unknown[]) => {
  const rows = await matching({ q: "Baja", conditions });
  const found = new Set(rows.map((row) => row.id));
  return Object.entries(ids)
    .filter(([, id]) => found.has(id))
    .map(([key]) => key)
    .sort();
};

const rowOf = async (
  key: string,
  permissions: ReadonlySet<string> = ALL,
  columns: PeopleColumnId[] = BAJA_COLUMNS,
) => {
  const [row] = await listPeopleFilteredAfter(x.companyId, {
    filter: coercePeopleFilter({ q: `Baja ${key}` }),
    context: ctx(permissions),
    columns,
    limit: 10,
  });
  expect(row?.id).toBe(ids[key]);
  return row;
};

beforeAll(async () => {
  x = await seedTenant("BX");
  y = await seedTenant("BY");

  [r1, r2] = await listTerminationReasons(x.companyId);
  [foreignReason] = await listTerminationReasons(y.companyId);

  // b1: baja in range, with a finiquito. b2 and b3: just outside it.
  await person("b1", { fechaIngreso: "2020-03-01" });
  await person("b2", { fechaIngreso: "2024-01-10" });
  await person("b3", { fechaIngreso: "2019-05-01" });
  await baja("b1", "2026-02-15", { monto: 12345.67 });
  await baja("b2", "2026-08-01", {
    tipoBaja: "despido",
    motivoBajaId: r2.id,
    recontratable: false,
  });
  await baja("b3", "2025-12-31");

  // Left in range and came back: active now, so not «baja entre…». One
  // restarts seniority (the default), the other has it recognized.
  for (const [key, reconoceAntiguedad] of [
    ["rehireNo", false],
    ["rehireYes", true],
  ] as const) {
    await person(key, { fechaIngreso: "2010-01-01" });
    await baja(key, "2026-03-01");
    await rehirePerson(
      x.companyId,
      ids[key],
      { fechaIngreso: "2026-04-01", reconoceAntiguedad },
      x.admin.id,
    );
  }

  // No employment period at all (data before the backfill).
  await person("legacy", { fechaIngreso: "2015-06-01" });

  // A backfilled baja whose date is unknown.
  await person("sinFecha", { fechaIngreso: "2018-01-01", status: "baja" });
  await ownerDb.insert(employmentPeriods).values({
    companyId: x.companyId,
    personId: ids.sinFecha,
    fechaIngreso: "2018-01-01",
    fechaAntiguedad: "2018-01-01",
    bajaSinFecha: true,
    requiereRevision: true,
  });

  // A role that exports people but has no compensation:read.
  const [role] = await ownerDb
    .insert(roles)
    .values({ slug: `exportador-${x.label}-${Date.now()}`, name: "Exportador" })
    .returning();
  const granted = (await ownerDb.select().from(permissionsTable)).filter(
    (permission) =>
      ["people:read", "people:export", "contracts:read"].includes(
        permission.slug,
      ),
  );
  await ownerDb.insert(rolePermissions).values(
    granted.map((permission) => ({
      roleId: role.id,
      permissionId: permission.id,
    })),
  );
  const [user] = await ownerDb
    .insert(users)
    .values({ email: `exportador-${role.slug}@idor.test`, name: "Exportador" })
    .returning();
  await ownerDb.insert(companyMemberships).values({
    userId: user.id,
    companyId: x.companyId,
    roleId: role.id,
    isDefault: true,
  });
  exporter = { id: user.id, email: user.email };
});

describe("baja filter fields", () => {
  it("«baja entre 1 ene y 30 jun 2026» returns only people de baja in that range", async () => {
    const between = {
      field: "baja",
      op: "between",
      from: "2026-01-01",
      to: "2026-06-30",
    } as const;
    const rows = await matching({ q: "Baja", conditions: [between] });

    expect(rows.map((row) => row.id)).toEqual([ids.b1]);
    expect(rows.every((row) => row.status === "baja")).toBe(true);
    // The rehired people's old baja is in the range, but they are active.
    expect(
      await keys([
        between,
        { field: "relacion", op: "is", values: ["activa"] },
      ]),
    ).toEqual([]);
  });

  it("before, after, empty and not empty also imply Baja", async () => {
    expect(
      await keys([{ field: "baja", op: "before", from: "2026-01-01" }]),
    ).toEqual(["b3"]);
    expect(
      await keys([{ field: "baja", op: "after", from: "2026-02-15" }]),
    ).toEqual(["b2"]);
    expect(await keys([{ field: "baja", op: "empty" }])).toEqual(["sinFecha"]);
    expect(await keys([{ field: "baja", op: "not_empty" }])).toEqual([
      "b1",
      "b2",
      "b3",
    ]);
  });

  it("tipo de baja and recontratable read the current period", async () => {
    expect(
      await keys([{ field: "tipoBaja", op: "is", values: ["despido"] }]),
    ).toEqual(["b2"]);
    // The rehired people's last baja was voluntaria, but it is not current.
    expect(
      await keys([{ field: "tipoBaja", op: "is", values: ["voluntaria"] }]),
    ).toEqual(["b1", "b3"]);
    expect(
      await keys([{ field: "recontratable", op: "is", values: ["no"] }]),
    ).toEqual(["b2"]);
    expect(
      await keys([{ field: "recontratable", op: "is", values: ["si", "no"] }]),
    ).toEqual(["b1", "b2", "b3"]);
  });

  it("motivo de baja is company-scoped: another company's reason matches nothing", async () => {
    expect(
      await keys([{ field: "motivoBaja", op: "is", values: [r1.id] }]),
    ).toEqual(["b1", "b3"]);
    expect(
      await keys([
        { field: "motivoBaja", op: "is", values: [foreignReason.id] },
      ]),
    ).toEqual([]);
    expect(
      await keys([
        { field: "motivoBaja", op: "is_not", values: [foreignReason.id] },
      ]),
    ).toEqual(Object.keys(ids).sort());

    // Company Y asks for X's reason: nothing, and nothing of X.
    const fromY = await matching(
      { conditions: [{ field: "motivoBaja", op: "is", values: [r1.id] }] },
      () => y.companyId,
    );
    expect(fromY).toEqual([]);
  });

  it("por revisar finds the backfill's bajas sin fecha", async () => {
    expect(
      await keys([{ field: "revisionBaja", op: "is", values: ["sin_fecha"] }]),
    ).toEqual(["sinFecha"]);
    expect(
      await keys([{ field: "revisionBaja", op: "is", values: ["revision"] }]),
    ).toEqual(["sinFecha"]);
  });

  it("counts per tipo, motivo, recontratable and review flag, inside the company", async () => {
    const filter = coercePeopleFilter({ q: "Baja" });
    const count = (field: Parameters<typeof countPeopleFilterOptions>[3]) =>
      countPeopleFilterOptions(x.companyId, filter, ctx(), field);

    expect(await count("tipoBaja")).toEqual({ voluntaria: 2, despido: 1 });
    expect(await count("motivoBaja")).toEqual({ [r1.id]: 2, [r2.id]: 1 });
    expect(await count("recontratable")).toEqual({ si: 2, no: 1 });
    expect(await count("revisionBaja")).toEqual({
      sin_fecha: 1,
      inferida: 0,
      revision: 1,
    });

    for (const field of ["tipoBaja", "motivoBaja", "recontratable"] as const) {
      const counts = await countPeopleFilterOptions(
        y.companyId,
        EMPTY_PEOPLE_FILTER,
        ctx(),
        field,
      );
      expect(
        idsIn(counts).filter((id) => tenantIds(x).has(id) || id === r1.id),
      ).toEqual([]);
    }
  });
});

describe("antigüedad after a rehire", () => {
  it("restarts without «Reconocer antigüedad previa» and carries over with it", async () => {
    const no = await rowOf("rehireNo");
    const yes = await rowOf("rehireYes");

    expect(peopleColumnValue(no, "fechaAntiguedad")).toBe("2026-04-01");
    expect(peopleColumnValue(no, "antiguedad")).toBe("6 meses");
    expect(peopleColumnValue(yes, "fechaAntiguedad")).toBe("2010-01-01");
    expect(peopleColumnValue(yes, "antiguedad")).toBe("16 años, 9 meses");

    expect(
      await keys([{ field: "antiguedad", op: "min_years", years: 15 }]),
    ).toEqual(["rehireYes"]);
    expect(
      await keys([{ field: "antiguedad", op: "max_years", years: 1 }]),
    ).toEqual(["rehireNo"]);
    expect(
      await keys([
        {
          field: "antiguedad",
          op: "between",
          from: "2026-01-01",
          to: "2026-12-31",
        },
      ]),
    ).toEqual(["rehireNo"]);
  });

  it("falls back to fecha de ingreso without periods and counts a baja up to its date", async () => {
    const legacy = await rowOf("legacy");
    expect(peopleColumnValue(legacy, "fechaAntiguedad")).toBe("2015-06-01");
    expect(
      await keys([{ field: "antiguedad", op: "min_years", years: 10 }]),
    ).toEqual(["legacy", "rehireYes"]);

    // b1: 2020-03-01 → 2026-02-15 is 5 years and 11 months, not 6 to today.
    const b1 = await rowOf("b1");
    expect(peopleColumnValue(b1, "antiguedad")).toBe("5 años, 11 meses");
    expect(
      await keys([{ field: "antiguedad", op: "min_years", years: 5 }]),
    ).toEqual(expect.arrayContaining(["b1", "b3"]));
    expect(
      (
        await keys([{ field: "antiguedad", op: "min_years", years: 6 }])
      ).includes("b1"),
    ).toBe(false);
  });
});

describe("baja columns", () => {
  it("shows the current period's baja, with labels", async () => {
    const b2 = await rowOf("b2");
    expect(
      Object.fromEntries(
        BAJA_COLUMNS.map((id) => [id, peopleColumnValue(b2, id)]),
      ),
    ).toEqual({
      fechaBaja: "2026-08-01",
      tipoBaja: "Despido",
      motivoBaja: r2.name,
      recontratable: "No",
      fechaAntiguedad: "2024-01-10",
      antiguedad: "2 años, 6 meses",
      finiquitoMonto: null,
    });

    // Rehired: the open period has no baja.
    const back = await rowOf("rehireNo");
    expect(peopleColumnValue(back, "fechaBaja")).toBeNull();
    expect(peopleColumnValue(back, "tipoBaja")).toBeNull();
  });

  it("hides the finiquito amount without compensation:read in the list", async () => {
    expect(peopleColumnValue(await rowOf("b1"), "finiquitoMonto")).toBe(
      "12345.67",
    );
    // Even when the column is asked for, the amount does not load.
    const masked = await rowOf("b1", NO_PAY);
    expect(masked.employment?.finiquitoMonto).toBeNull();
    expect(masked.employment?.fechaBaja).toBe("2026-02-15");
  });

  it("drops the finiquito column from a shared view for whoever lacks compensation:read", async () => {
    const view = await createPeopleView(
      x.companyId,
      { userId: x.admin.id, permissions: ALL },
      {
        name: "Bajas con finiquito",
        filter: EMPTY_PEOPLE_FILTER,
        columns: ["fechaBaja", "finiquitoMonto"],
        shared: true,
      },
    );
    const seen = await listPeopleViews(x.companyId, {
      userId: x.viewer.id,
      permissions: new Set(["people:read", "contracts:read"]),
    });

    expect(seen.find((item) => item.id === view?.id)?.columns).toEqual([
      "fechaBaja",
    ]);
  });
});

describe("«Exportar (N)» with the baja columns", () => {
  const csv = async (query: string) => {
    const response = await exportRoute(
      new Request(`http://test/app/personas/exportar?${query}`),
    );
    expect(response.status).toBe(200);
    const lines = (await response.text())
      .replace(/^﻿/, "")
      .trim()
      .split(/\r?\n/);
    return { header: lines[0], rows: lines.slice(1), text: lines.join("\n") };
  };

  const filter = coercePeopleFilter({
    q: "Baja",
    conditions: [{ field: "baja", op: "not_empty" }],
  });
  const cols = `cols=${BAJA_COLUMNS.join(".")}&format=csv`;

  it("exports N rows with the baja columns and the finiquito amount", async () => {
    actAs(x.admin);
    const n = await countPeopleFiltered(x.companyId, filter, ctx());
    const { header, rows, text } = await csv(
      `${peopleFilterQueryString(filter)}&${cols}`,
    );

    expect(n).toBe(3);
    expect(rows).toHaveLength(n);
    expect(header).toBe(
      "ID Workia,Nombre,Fecha de baja,Tipo de baja,Motivo de baja,Recontratable,Fecha de antigüedad,Antigüedad,Finiquito (monto)",
    );
    expect(text).toContain("12345.67");
    expect(text).toContain("Despido");
  });

  it("drops the finiquito column without compensation:read", async () => {
    actAs(exporter);
    const { header, rows, text } = await csv(
      `${peopleFilterQueryString(filter)}&${cols}`,
    );

    expect(rows).toHaveLength(3);
    expect(header).not.toContain("Finiquito");
    expect(header).toContain("Motivo de baja");
    expect(text).not.toContain("12345.67");
  });
});
