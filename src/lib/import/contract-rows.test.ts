import { describe, expect, it } from "vitest";

import {
  deriveContractStatus,
  diffContract,
  findContractFileConflicts,
  normalizeContractRow,
} from "./contract-rows";
import type { ExistingContract } from "./types";

const options = {
  today: "2026-10-11",
  templates: new Map([["estandar", { id: "t1", name: "Estándar" }]]),
};
const base = {
  curp: "HEGG560427MVZRRL04",
  tipo: "Determinado",
  fechaInicio: "2026-01-01",
  fechaFin: "2026-12-31",
};

describe("normalizeContractRow", () => {
  it("normalizes a valid determinado contract and derives the status", () => {
    const { normalized, errors } = normalizeContractRow(base, options);

    expect(errors).toEqual([]);
    expect(normalized).toMatchObject({
      type: "determinado",
      noticeWindow: "no_avisar",
      status: "vigente",
      templateId: null,
    });
    expect(
      normalizeContractRow(
        { ...base, fechaInicio: "2024-01-01", fechaFin: "2024-12-31" },
        options,
      ).normalized?.status,
    ).toBe("vencido");
  });

  it("requires an end date for determinado and drops it for indeterminado", () => {
    expect(
      normalizeContractRow({ ...base, fechaFin: null }, options).errors[0],
    ).toMatchObject({ field: "fechaFin" });

    const open = normalizeContractRow(
      { ...base, tipo: "indeterminado" },
      options,
    ).normalized;

    expect(open?.endDate).toBeNull();
    expect(open?.status).toBe("vigente");
  });

  it("rejects end before start, bad enums, unknown template and missing person", () => {
    const fields = normalizeContractRow(
      {
        tipo: "x",
        fechaInicio: "no",
        aviso: "9",
        estatus: "?",
        plantilla: "Nada",
      },
      options,
    ).errors.map((e) => e.field);

    expect(fields).toEqual(
      expect.arrayContaining([
        "curp",
        "tipo",
        "fechaInicio",
        "aviso",
        "estatus",
        "plantilla",
      ]),
    );
    expect(
      normalizeContractRow({ ...base, fechaFin: "2025-01-01" }, options)
        .errors[0].message,
    ).toContain("anterior");
  });

  it("keeps consistent statuses, coerces vigente-in-the-past with a warning, rejects future vencido", () => {
    const past = normalizeContractRow(
      {
        ...base,
        fechaInicio: "2024-01-01",
        fechaFin: "2024-12-31",
        estatus: "Vigente",
      },
      options,
    );

    expect(past.normalized?.status).toBe("vencido");
    expect(past.errors[0].severity).toBe("warning");
    expect(
      normalizeContractRow({ ...base, estatus: "Vencido" }, options).normalized,
    ).toBeNull();
    expect(
      normalizeContractRow({ ...base, plantilla: "estandar" }, options)
        .normalized?.templateId,
    ).toBe("t1");
  });
});

describe("deriveContractStatus", () => {
  it("only determinado contracts expire by date", () => {
    expect(deriveContractStatus("indeterminado", null, "2026-10-11")).toBe(
      "vigente",
    );
    expect(
      deriveContractStatus("determinado", "2026-10-10", "2026-10-11"),
    ).toBe("vencido");
    expect(
      deriveContractStatus("determinado", "2026-10-11", "2026-10-11"),
    ).toBe("vigente");
  });
});

describe("findContractFileConflicts", () => {
  it("rejects repeated starts and a second vigente per person", () => {
    const conflicts = findContractFileConflicts([
      { rowNumber: 2, person: "a", startDate: "2020-01-01", status: "vencido" },
      { rowNumber: 3, person: "a", startDate: "2021-01-01", status: "vigente" },
      { rowNumber: 4, person: "a", startDate: "2021-01-01", status: "vigente" },
      { rowNumber: 5, person: "a", startDate: "2022-01-01", status: "vigente" },
      { rowNumber: 6, person: "b", startDate: "2021-01-01", status: "vigente" },
    ]);

    expect([...conflicts.keys()]).toEqual([4, 5]);
  });
});

describe("diffContract", () => {
  const existing: ExistingContract = {
    id: "c1",
    personId: "p1",
    type: "determinado",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    noticeWindow: "no_avisar",
    status: "vigente",
    templateId: null,
    templateName: "Importado",
  };

  it("reports changed fields only", () => {
    const next = normalizeContractRow(base, options).normalized!;

    expect(diffContract(next, existing)).toEqual({});
    expect(diffContract({ ...next, endDate: "2027-01-31" }, existing)).toEqual({
      endDate: ["2026-12-31", "2027-01-31"],
    });
  });
});
