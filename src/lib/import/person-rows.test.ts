import { describe, expect, it } from "vitest";

import { curpCheckDigit } from "@/lib/people/identity";

import type { EmploymentSummary } from "@/lib/people/employment";

import {
  classifyPersonRow,
  diffPerson,
  findFileDuplicates,
  findManagerCycleNodes,
  normalizePersonRow,
  planEmployment,
  possibleDuplicateKey,
  type PersonLookups,
} from "./person-rows";
import type { CatalogIndex, ExistingPerson } from "./types";

const catalogs: CatalogIndex = {
  areas: new Map([["ventas", "a1111111-1111-4111-8111-111111111111"]]),
  positions: new Map([
    [
      "cajero",
      [
        {
          id: "b1111111-1111-4111-8111-111111111111",
          areaId: "a1111111-1111-4111-8111-111111111111",
        },
      ],
    ],
    [
      "gerente",
      [
        {
          id: "b2222222-2222-4222-8222-222222222222",
          areaId: "a1111111-1111-4111-8111-111111111111",
        },
        {
          id: "b3333333-3333-4333-8333-333333333333",
          areaId: "a2222222-2222-4222-8222-222222222222",
        },
      ],
    ],
  ]),
  sites: new Map([["matriz", "c1111111-1111-4111-8111-111111111111"]]),
  terminationReasons: new Map([
    [
      "renuncia voluntaria",
      {
        id: "d1111111-1111-4111-8111-111111111111",
        name: "Renuncia voluntaria",
        active: true,
      },
    ],
    [
      "jubilacion",
      {
        id: "d2222222-2222-4222-8222-222222222222",
        name: "Jubilación",
        active: false,
      },
    ],
  ]),
};

const validCurp = (() => {
  const base = "HEGG560427MVZRRL0";

  return `${base}${curpCheckDigit(base)}`;
})();

const base = { nombres: "Ana", apellidoPaterno: "López" };
const none = { createMissingCatalogs: false };

const existing = (overrides: Partial<ExistingPerson> = {}): ExistingPerson => ({
  id: "11111111-1111-4111-8111-111111111111",
  deletedAt: null,
  curp: validCurp,
  rfc: null,
  nombres: "Ana",
  apellidoPaterno: "López",
  apellidoMaterno: null,
  email: null,
  telefono: null,
  fechaNacimiento: null,
  fechaIngreso: null,
  areaId: null,
  positionId: null,
  siteId: null,
  nss: null,
  status: "activa",
  managerId: null,
  ...overrides,
});

const lookupsOf = (...people: ExistingPerson[]): PersonLookups => ({
  byId: new Map(people.map((p) => [p.id, p])),
  byCurp: new Map(people.flatMap((p) => (p.curp ? [[p.curp, p]] : []))),
  byRfc: new Map(people.flatMap((p) => (p.rfc ? [[p.rfc, p]] : []))),
});

describe("normalizePersonRow", () => {
  it("resolves catalogs case/accent-insensitively and normalizes identifiers", () => {
    const { normalized, errors } = normalizePersonRow(
      {
        ...base,
        area: "VENTAS",
        puesto: "cajero",
        sucursal: "Matriz",
        curp: ` ${validCurp.toLowerCase()} `,
        estatus: "baja",
      },
      catalogs,
      none,
    );

    expect(errors).toEqual([]);
    expect(normalized?.values).toMatchObject({
      areaId: "a1111111-1111-4111-8111-111111111111",
      positionId: "b1111111-1111-4111-8111-111111111111",
      siteId: "c1111111-1111-4111-8111-111111111111",
      curp: validCurp,
      status: "baja",
    });
  });

  it("reports unknown catalogs unless creating them is allowed", () => {
    const row = { ...base, area: "Logística" };

    expect(normalizePersonRow(row, catalogs, none).errors[0]).toMatchObject({
      field: "area",
    });

    const allowed = normalizePersonRow(row, catalogs, {
      createMissingCatalogs: true,
    });

    expect(allowed.errors).toEqual([]);
    expect(allowed.normalized?.missingCatalogs).toEqual({ area: "Logística" });
  });

  it("disambiguates a position repeated across areas by the row's area", () => {
    expect(
      normalizePersonRow(
        { ...base, area: "Ventas", puesto: "Gerente" },
        catalogs,
        none,
      ).normalized?.values.positionId,
    ).toBe("b2222222-2222-4222-8222-222222222222");
    expect(
      normalizePersonRow({ ...base, puesto: "Gerente" }, catalogs, none)
        .errors[0].message,
    ).toContain("varias áreas");
  });

  it("lists the areas of an ambiguous position so the row can pick one", () => {
    const named: CatalogIndex = {
      ...catalogs,
      positions: new Map([
        [
          "gerente",
          [
            {
              id: "b2222222-2222-4222-8222-222222222222",
              areaId: "a1",
              areaName: "Ventas",
            },
            {
              id: "b3333333-3333-4333-8333-333333333333",
              areaId: "a2",
              areaName: "Almacén",
            },
          ],
        ],
      ]),
    };

    expect(
      normalizePersonRow({ ...base, puesto: "Gerente" }, named, none).errors[0]
        .message,
    ).toContain("Ventas, Almacén");
  });

  it("says how to fix an identifier, not only that it is wrong", () => {
    const { errors } = normalizePersonRow(
      { ...base, nss: "1234" },
      catalogs,
      none,
    );

    expect(errors[0]).toMatchObject({
      field: "nss",
      message: expect.stringContaining(
        "Escribe el NSS como texto: 11 dígitos, con ceros al inicio",
      ),
    });
  });

  it("uses the form's schema for required fields, formats and identifiers", () => {
    const { errors } = normalizePersonRow(
      {
        nombres: "",
        apellidoPaterno: "X",
        email: "nope",
        curp: "BAD",
        fechaIngreso: "31/02/2024",
        estatus: "otra",
      },
      catalogs,
      none,
    );
    const fields = errors.map((e) => e.field);

    expect(fields).toEqual(
      expect.arrayContaining([
        "nombres",
        "email",
        "curp",
        "fechaIngreso",
        "estatus",
      ]),
    );
  });
});

describe("classifyPersonRow", () => {
  const row = (extra = {}) =>
    normalizePersonRow({ ...base, curp: validCurp, ...extra }, catalogs, none)
      .normalized!;

  it("creates when nothing matches, updates on differences, ignores blanks", () => {
    expect(classifyPersonRow(row(), lookupsOf()).action).toBe("create");

    const person = existing({ email: "a@x.mx" });

    expect(classifyPersonRow(row(), lookupsOf(person)).action).toBe(
      "unchanged",
    );

    const updated = classifyPersonRow(
      row({ email: "b@x.mx", telefono: "555" }),
      lookupsOf(person),
    );

    expect(updated.action).toBe("update");
    expect(updated.diff).toEqual({
      email: ["a@x.mx", "b@x.mx"],
      telefono: [null, "555"],
    });
    expect(updated.targetPersonId).toBe(person.id);
  });

  it("matches by ID Workia first and flags conflicting keys", () => {
    const a = existing();
    const b = existing({
      id: "22222222-2222-4222-8222-222222222222",
      curp: null,
      rfc: "XAXX010101000",
    });
    const byId = row({ idWorkia: b.id, curp: "" });

    expect(
      classifyPersonRow(
        { ...byId, values: { ...byId.values, curp: null } },
        lookupsOf(a, b),
      ).targetPersonId,
    ).toBe(b.id);

    const conflict = classifyPersonRow(
      row({ idWorkia: b.id }),
      lookupsOf(a, b),
    );

    expect(conflict.action).toBe("error");
    expect(conflict.errors[0].field).toBe("curp");
  });

  it("rejects unknown and deleted ID Workia", () => {
    const ghost = row({ idWorkia: "33333333-3333-4333-8333-333333333333" });

    expect(classifyPersonRow(ghost, lookupsOf()).errors[0].message).toContain(
      "No existe",
    );

    const gone = existing({ deletedAt: new Date() });

    expect(
      classifyPersonRow(row({ idWorkia: gone.id }), lookupsOf(gone)).errors[0]
        .message,
    ).toContain("borrada");
  });
});

describe("diffPerson", () => {
  it("flags catalogs that will be created", () => {
    const { normalized } = normalizePersonRow(
      { ...base, area: "Nueva" },
      catalogs,
      { createMissingCatalogs: true },
    );

    expect(
      diffPerson(normalized!.values, existing(), normalized!.missingCatalogs),
    ).toMatchObject({ areaName: [null, "Nueva"] });
  });
});

describe("findFileDuplicates", () => {
  it("rejects later rows that repeat an earlier key", () => {
    const duplicates = findFileDuplicates([
      { rowNumber: 2, idWorkia: null, curp: "AAA", rfc: null },
      { rowNumber: 3, idWorkia: null, curp: null, rfc: "RRR" },
      { rowNumber: 4, idWorkia: null, curp: "AAA", rfc: null },
      { rowNumber: 5, idWorkia: null, curp: null, rfc: "RRR" },
    ]);

    expect([...duplicates.keys()]).toEqual([4, 5]);
    expect(duplicates.get(4)?.message).toContain("fila 2");
  });
});

describe("findManagerCycleNodes", () => {
  it("finds members of cycles, not the chains feeding them", () => {
    const cycle = findManagerCycleNodes(
      new Map([
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
        ["d", "a"],
        ["e", "f"],
      ]),
    );

    expect([...cycle].sort()).toEqual(["a", "b", "c"]);
  });

  it("flags a self-loop", () => {
    expect([...findManagerCycleNodes(new Map([["x", "x"]]))]).toEqual(["x"]);
  });
});

describe("possibleDuplicateKey", () => {
  it("needs a birth date and ignores case and accents", () => {
    expect(
      possibleDuplicateKey({
        nombres: "José",
        apellidoPaterno: "PÉREZ",
        fechaNacimiento: "1990-01-02",
      }),
    ).toBe("jose|perez|1990-01-02");
    expect(
      possibleDuplicateKey({
        nombres: "José",
        apellidoPaterno: "Pérez",
        fechaNacimiento: null,
      }),
    ).toBeNull();
  });
});

describe("baja columns", () => {
  const RENUNCIA = "d1111111-1111-4111-8111-111111111111";
  const JUBILACION = "d2222222-2222-4222-8222-222222222222";
  const bajaCells = {
    estatus: "Baja",
    fechaBaja: "2025-11-28",
    tipoBaja: "voluntaria",
    motivoBaja: " renuncia VOLUNTARIA ",
    comentarioBaja: "Se mudó.",
    recontratable: "si",
  };
  const row = (extra = {}) =>
    normalizePersonRow({ ...base, curp: validCurp, ...extra }, catalogs, none);
  const summary = (
    overrides: Partial<EmploymentSummary> = {},
  ): EmploymentSummary => ({
    personId: "11111111-1111-4111-8111-111111111111",
    periodId: "e1111111-1111-4111-8111-111111111111",
    periodCount: 1,
    abierto: true,
    fechaIngreso: "2020-02-03",
    fechaAntiguedad: "2020-02-03",
    reconoceAntiguedad: false,
    fechaBaja: null,
    bajaSinFecha: false,
    tipoBaja: null,
    motivoBajaId: null,
    motivoBaja: null,
    comentarioBaja: null,
    recontratable: null,
    finiquitoEstado: null,
    finiquitoFecha: null,
    finiquitoMonto: null,
    fechaBajaInferida: false,
    requiereRevision: false,
    ...overrides,
  });
  const closed = summary({
    abierto: false,
    fechaBaja: "2025-11-28",
    tipoBaja: "voluntaria",
    motivoBajaId: RENUNCIA,
    motivoBaja: "Renuncia voluntaria",
    comentarioBaja: "Se mudó.",
    recontratable: true,
  });
  const withEmployment = (
    person: ExistingPerson,
    current: EmploymentSummary,
  ): PersonLookups => ({
    ...lookupsOf(person),
    employment: new Map([[person.id, current]]),
  });

  it("parses the cells: labels or keys, Sí/No, the motivo by catalog name", () => {
    const { normalized, errors } = row(bajaCells);

    expect(errors).toEqual([]);
    expect(normalized?.baja).toEqual({
      fechaBaja: "2025-11-28",
      tipoBaja: "voluntaria",
      motivoBajaId: RENUNCIA,
      motivoBaja: "Renuncia voluntaria",
      motivoActivo: true,
      comentario: "Se mudó.",
      recontratable: true,
    });
    expect(
      row({ ...bajaCells, tipoBaja: "Término de contrato" }).normalized?.baja
        ?.tipoBaja,
    ).toBe("termino_contrato");
    expect(row({ fechaBaja: "28/11/2025" }).normalized?.baja?.fechaBaja).toBe(
      "2025-11-28",
    );
    expect(row().normalized?.baja).toBeNull();
  });

  it("explains how to fix each bad baja cell", () => {
    const { normalized, errors } = row({
      estatus: "Baja",
      fechaBaja: "31/02/2025",
      tipoBaja: "Renuncia",
      motivoBaja: "Se fue",
      comentarioBaja: "x".repeat(1001),
      recontratable: "Tal vez",
      fechaAntiguedad: "ayer",
    });
    const byField = Object.fromEntries(
      errors.map((error) => [error.field, error.message]),
    );

    expect(normalized).toBeNull();
    expect(byField.fechaBaja).toContain("AAAA-MM-DD");
    expect(byField.tipoBaja).toContain("Voluntaria, Despido");
    expect(byField.motivoBaja).toContain("Catálogo > Motivos de baja");
    expect(byField.comentarioBaja).toContain("1,000");
    expect(byField.recontratable).toContain('"Sí" o "No"');
    expect(byField.fechaAntiguedad).toContain("AAAA-MM-DD");
  });

  it("closes the open period of an active person with the row's baja", () => {
    const person = existing({ fechaIngreso: "2020-02-03" });
    const outcome = classifyPersonRow(
      row(bajaCells).normalized!,
      withEmployment(person, summary()),
    );

    expect(outcome.action).toBe("update");
    expect(outcome.diff).toMatchObject({
      status: ["activa", "baja"],
      fechaBaja: [null, "2025-11-28"],
      tipoBaja: [null, "Voluntaria"],
      motivoBaja: [null, "Renuncia voluntaria"],
      recontratable: [null, "Sí"],
    });
    expect(
      planEmployment(row(bajaCells).normalized!, person, summary()).termination,
    ).toEqual({
      mode: "close",
      values: {
        fechaBaja: "2025-11-28",
        tipoBaja: "voluntaria",
        motivoBajaId: RENUNCIA,
        comentario: "Se mudó.",
        recontratable: true,
      },
    });
  });

  it("creates a person de baja with the baja, or warns when it has no data", () => {
    const create = classifyPersonRow(row(bajaCells).normalized!, lookupsOf());

    expect(create.action).toBe("create");
    expect(
      planEmployment(row(bajaCells).normalized!, null, null).termination?.mode,
    ).toBe("close");

    const bare = classifyPersonRow(
      row({ estatus: "Baja" }).normalized!,
      lookupsOf(),
    );

    // A baja without its motivo is refused (WRK-I12).
    expect(bare.action).toBe("error");
    expect(bare.errors).toEqual([
      expect.objectContaining({
        field: "motivoBaja",
        message: expect.stringContaining("Motivo de baja"),
      }),
    ]);
    expect(bare.errors[0]).not.toHaveProperty("severity", "warning");
  });

  it("asks for the missing baja columns, recontratable included", () => {
    const outcome = classifyPersonRow(
      row({ estatus: "Baja", fechaBaja: "2025-11-28", tipoBaja: "Despido" })
        .normalized!,
      withEmployment(existing(), summary()),
    );

    expect(outcome.action).toBe("error");
    expect(outcome.errors[0]).toMatchObject({ field: "motivoBaja" });
    expect(outcome.errors[0].message).toContain(
      "falta Motivo de baja, Recontratable",
    );

    const noDate = classifyPersonRow(
      row({ estatus: "Baja", motivoBaja: "Renuncia voluntaria" }).normalized!,
      lookupsOf(),
    );

    expect(noDate.errors[0].message).toContain("Fecha de baja");
  });

  it("refuses baja data without Estatus Baja, a baja before the ingreso and an inactive motivo", () => {
    const activa = classifyPersonRow(
      row({ ...bajaCells, estatus: "Activa" }).normalized!,
      lookupsOf(),
    );

    expect(activa.action).toBe("error");
    expect(activa.errors[0]).toMatchObject({ field: "estatus" });

    const early = classifyPersonRow(
      row({ ...bajaCells, fechaIngreso: "2026-01-05" }).normalized!,
      lookupsOf(),
    );

    expect(early.errors[0]).toMatchObject({ field: "fechaBaja" });
    expect(early.errors[0].message).toContain("05/01/2026");

    const inactive = classifyPersonRow(
      row({ ...bajaCells, motivoBaja: "Jubilación" }).normalized!,
      lookupsOf(),
    );

    expect(inactive.errors[0].message).toContain("inactivo");
  });

  it("re-importing the same baja changes nothing; a new value corrects the last period", () => {
    const person = existing({ status: "baja", fechaIngreso: "2020-02-03" });
    const lookups = withEmployment(person, closed);

    expect(classifyPersonRow(row(bajaCells).normalized!, lookups).action).toBe(
      "unchanged",
    );
    // A motivo deactivated since the baja still re-imports unchanged.
    expect(
      classifyPersonRow(
        row({ ...bajaCells, motivoBaja: "Jubilación" }).normalized!,
        withEmployment(person, {
          ...closed,
          motivoBajaId: JUBILACION,
          motivoBaja: "Jubilación",
        }),
      ).action,
    ).toBe("unchanged");

    const corrected = classifyPersonRow(
      row({ estatus: "Baja", recontratable: "No" }).normalized!,
      lookups,
    );

    expect(corrected.action).toBe("update");
    expect(corrected.diff).toEqual({ recontratable: ["Sí", "No"] });
    expect(
      planEmployment(
        row({ estatus: "Baja", recontratable: "No" }).normalized!,
        person,
        closed,
      ).termination,
    ).toMatchObject({
      mode: "correct",
      values: { motivoBajaId: RENUNCIA, recontratable: false },
    });
  });

  it("completes a baja «sin fecha» and keeps it quiet when nothing is given", () => {
    const person = existing({ status: "baja" });
    const sinFecha = summary({ abierto: false, bajaSinFecha: true });

    expect(
      classifyPersonRow(
        row({ estatus: "Baja" }).normalized!,
        withEmployment(person, sinFecha),
      ),
    ).toMatchObject({ action: "unchanged", errors: [] });
    expect(
      classifyPersonRow(
        row(bajaCells).normalized!,
        withEmployment(person, sinFecha),
      ).action,
    ).toBe("update");
  });

  it("refuses a fecha de ingreso after the baja of someone de baja", () => {
    const outcome = classifyPersonRow(
      row({ estatus: "Baja", fechaIngreso: "2026-01-05" }).normalized!,
      withEmployment(existing({ status: "baja" }), closed),
    );

    expect(outcome.errors[0]).toMatchObject({ field: "fechaIngreso" });
  });

  it("takes Fecha de antigüedad only when it differs from the ingreso", () => {
    const person = existing({ fechaIngreso: "2020-02-03" });
    const lookups = withEmployment(person, summary());

    expect(
      classifyPersonRow(
        row({ fechaAntiguedad: "2020-02-03" }).normalized!,
        lookups,
      ).action,
    ).toBe("unchanged");

    const recognized = classifyPersonRow(
      row({ fechaAntiguedad: "2015-06-01" }).normalized!,
      lookups,
    );

    expect(recognized.diff).toEqual({
      fechaAntiguedad: ["2020-02-03", "2015-06-01"],
    });
    expect(
      planEmployment(
        row({ fechaAntiguedad: "2015-06-01" }).normalized!,
        person,
        summary(),
      ).antiguedad,
    ).toBe("2015-06-01");

    const later = classifyPersonRow(
      row({ fechaAntiguedad: "2021-01-01" }).normalized!,
      lookups,
    );

    expect(later.errors[0]).toMatchObject({ field: "fechaAntiguedad" });

    // Already recognized: the export writes it back unchanged.
    expect(
      classifyPersonRow(
        row({ fechaAntiguedad: "2015-06-01" }).normalized!,
        withEmployment(
          person,
          summary({ fechaAntiguedad: "2015-06-01", reconoceAntiguedad: true }),
        ),
      ).action,
    ).toBe("unchanged");

    // De baja it is not stored: a warning, not an error.
    const baja = classifyPersonRow(
      row({ ...bajaCells, fechaAntiguedad: "2015-06-01" }).normalized!,
      withEmployment(existing({ status: "baja" }), closed),
    );

    expect(baja.action).toBe("unchanged");
    expect(baja.errors[0]).toMatchObject({
      field: "fechaAntiguedad",
      severity: "warning",
    });
  });
});
