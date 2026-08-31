import { describe, expect, it } from "vitest";

import { matchesPersonaListRow } from "@/lib/people/schema";

import {
  OFFICIAL_DELETED_DEMO_FULL_NAME,
  OFFICIAL_DELETED_DEMO_PERSON,
  formatBorradosCleanupName,
  isLiveSeedCompanyPerson,
  isOfficialDeletedDemoPerson,
  isSoftDeletedTestResidue,
  selectSoftDeletedResidue,
} from "./borrados-cleanup";

const deleted = { deletedAt: new Date("2026-08-30T00:00:00Z") };

describe("official demo deleted expediente", () => {
  it("labels the walkthrough person in Spanish dummy copy", () => {
    expect(OFFICIAL_DELETED_DEMO_FULL_NAME).toBe("Persona Borrada Recorrido");
    expect(OFFICIAL_DELETED_DEMO_PERSON.email).toMatch(/@ejemplo\.local$/);
    expect(OFFICIAL_DELETED_DEMO_PERSON.rfc.startsWith("XAXX")).toBe(true);
  });

  it("stays visible in the Borrados filter and hidden from expediente", () => {
    const row = { status: "activa" as const, deleted: true };

    expect(matchesPersonaListRow(row, { visibility: "deleted" })).toBe(true);
    expect(matchesPersonaListRow(row, { visibility: "expediente" })).toBe(
      false,
    );
  });

  it("is never selected as residue even when soft-deleted", () => {
    expect(isOfficialDeletedDemoPerson(OFFICIAL_DELETED_DEMO_PERSON)).toBe(
      true,
    );
    expect(
      isSoftDeletedTestResidue({
        ...OFFICIAL_DELETED_DEMO_PERSON,
        ...deleted,
      }),
    ).toBe(false);
  });
});

describe("live seed company people", () => {
  it("protects active Demo/Ejemplo/Muestra expediente rows", () => {
    expect(
      isLiveSeedCompanyPerson({
        nombres: "Elena",
        apellidoPaterno: "Demo",
        apellidoMaterno: "Ejemplo",
        deletedAt: null,
      }),
    ).toBe(true);
    expect(
      isLiveSeedCompanyPerson({
        nombres: "Luis",
        apellidoPaterno: "Demo",
        apellidoMaterno: "Muestra",
        deletedAt: null,
      }),
    ).toBe(true);
    expect(
      isSoftDeletedTestResidue({
        nombres: "Elena",
        apellidoPaterno: "Demo",
        apellidoMaterno: "Ejemplo",
        deletedAt: null,
      }),
    ).toBe(false);
  });

  it("does not treat a soft-deleted seed-style name as residue unless it matches test patterns", () => {
    expect(
      isSoftDeletedTestResidue({
        nombres: "Ana",
        apellidoPaterno: "Demo",
        apellidoMaterno: "Ejemplo",
        ...deleted,
      }),
    ).toBe(false);
  });
});

describe("soft-deleted test residue patterns", () => {
  it("matches e2e Persona Borrada Demo + numeric suffix", () => {
    expect(
      isSoftDeletedTestResidue({
        nombres: "Persona",
        apellidoPaterno: "Borrada",
        apellidoMaterno: "Demo123456",
        ...deleted,
      }),
    ).toBe(true);
  });

  it("matches Prueba names that are already soft-deleted", () => {
    expect(
      isSoftDeletedTestResidue({
        nombres: "Persona",
        apellidoPaterno: "Prueba",
        apellidoMaterno: "Listado",
        ...deleted,
      }),
    ).toBe(true);
  });

  it("matches borrar-demo-suffix leftovers", () => {
    expect(
      isSoftDeletedTestResidue({
        nombres: "Caso",
        apellidoPaterno: "Borrar",
        apellidoMaterno: "Demo889900",
        ...deleted,
      }),
    ).toBe(true);
  });

  it("ignores live people and the official recorrido row", () => {
    const pile = selectSoftDeletedResidue([
      {
        nombres: "Persona",
        apellidoPaterno: "Borrada",
        apellidoMaterno: "Demo111111",
        ...deleted,
      },
      {
        nombres: "Persona",
        apellidoPaterno: "Borrada",
        apellidoMaterno: "Demo222222",
        ...deleted,
      },
      {
        ...OFFICIAL_DELETED_DEMO_PERSON,
        ...deleted,
      },
      {
        nombres: "Elena",
        apellidoPaterno: "Demo",
        apellidoMaterno: "Ejemplo",
        deletedAt: null,
      },
      {
        nombres: "Persona",
        apellidoPaterno: "Borrada",
        apellidoMaterno: "Demo333333",
        deletedAt: null,
      },
    ]);

    expect(pile.map((person) => formatBorradosCleanupName(person))).toEqual([
      "Persona Borrada Demo111111",
      "Persona Borrada Demo222222",
    ]);
  });

  it("does not grow the pile on a second pass", () => {
    const firstPass = selectSoftDeletedResidue([
      {
        nombres: "Persona",
        apellidoPaterno: "Borrada",
        apellidoMaterno: "Demo444444",
        ...deleted,
      },
      {
        ...OFFICIAL_DELETED_DEMO_PERSON,
        ...deleted,
      },
    ]);

    expect(firstPass).toHaveLength(1);

    const remaining = [
      {
        ...OFFICIAL_DELETED_DEMO_PERSON,
        ...deleted,
      },
    ];

    expect(selectSoftDeletedResidue(remaining)).toEqual([]);
  });
});
