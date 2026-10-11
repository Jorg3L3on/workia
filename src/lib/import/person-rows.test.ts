import { describe, expect, it } from "vitest";

import { curpCheckDigit } from "@/lib/people/identity";

import {
  classifyPersonRow,
  diffPerson,
  findFileDuplicates,
  findManagerCycleNodes,
  normalizePersonRow,
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
