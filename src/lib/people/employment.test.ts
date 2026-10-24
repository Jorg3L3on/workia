import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    DATABASE_URL:
      "postgresql://user:password@localhost:5432/workia?sslmode=disable",
    AUTH_SECRET: "ci-auth-secret-with-at-least-32-characters",
    NODE_ENV: "test",
  },
}));

vi.mock("@/lib/db", () => ({ db: {} }));

import type { EmploymentPeriodRow } from "@/lib/people/employment";
import {
  isOpenPeriod,
  rehireWarnings,
  summarizePeriods,
} from "@/lib/people/employment";
import { planEmploymentPeriod } from "@/lib/people/employment-backfill";
import {
  rehireSchema,
  terminationSchema,
} from "@/lib/people/employment-schema";
import { blocksNewOnboarding } from "@/lib/onboarding/eligibility";

const period = (
  overrides: Partial<EmploymentPeriodRow> = {},
): EmploymentPeriodRow => ({
  id: "p1",
  companyId: "c1",
  personId: "x1",
  fechaIngreso: "2018-02-01",
  reconoceAntiguedad: false,
  fechaAntiguedadReconocida: null,
  fechaAntiguedad: "2018-02-01",
  fechaBaja: null,
  bajaSinFecha: false,
  tipoBaja: null,
  motivoBajaId: null,
  motivoBaja: null,
  comentarioBaja: null,
  recontratable: null,
  finiquitoEstado: null,
  finiquitoFecha: null,
  areaId: null,
  siteId: null,
  positionId: null,
  managerId: null,
  finiquitoMonto: null,
  fechaBajaInferida: false,
  requiereRevision: false,
  createdBy: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const closed = period({
  fechaBaja: "2023-06-30",
  tipoBaja: "voluntaria",
  motivoBaja: "Renuncia voluntaria",
  recontratable: false,
  finiquitoMonto: "15000.00",
});

describe("employment periods", () => {
  it("is open without fecha de baja, unless it is a baja «sin fecha»", () => {
    expect(isOpenPeriod(period())).toBe(true);
    expect(isOpenPeriod(closed)).toBe(false);
    expect(isOpenPeriod(period({ bajaSinFecha: true }))).toBe(false);
  });

  it("summarizes the open period, or the last one", () => {
    expect(summarizePeriods([])).toBeNull();
    expect(summarizePeriods([closed])).toMatchObject({
      abierto: false,
      fechaBaja: "2023-06-30",
      motivoBaja: "Renuncia voluntaria",
      recontratable: false,
      finiquitoMonto: "15000.00",
      fechaAntiguedad: "2018-02-01",
    });

    const rehired = period({
      id: "p2",
      fechaIngreso: "2025-01-15",
      reconoceAntiguedad: true,
    });
    expect(summarizePeriods([rehired, closed])).toMatchObject({
      periodId: "p2",
      periodCount: 2,
      abierto: true,
      fechaIngreso: "2025-01-15",
      fechaBaja: null,
      fechaAntiguedad: "2018-02-01",
    });
    expect(
      summarizePeriods([{ ...rehired, reconoceAntiguedad: false }, closed])
        ?.fechaAntiguedad,
    ).toBe("2025-01-15");
  });

  it("warns on a rehire when the last baja said not rehirable", () => {
    expect(rehireWarnings(closed)).toEqual([
      "La baja anterior la marcó como no recontratable.",
    ]);
    expect(rehireWarnings(period({ recontratable: true }))).toEqual([]);
    expect(rehireWarnings(null)).toEqual([]);
  });

  it("requires fecha, tipo, motivo and recontratable for a baja", () => {
    const parsed = terminationSchema.safeParse({ fechaBaja: "" });
    expect(parsed.success).toBe(false);
    expect(
      parsed.error?.issues.map((issue) => issue.path.join(".")).sort(),
    ).toEqual(["fechaBaja", "motivoBajaId", "recontratable", "tipoBaja"]);
    expect(
      terminationSchema.safeParse({
        fechaBaja: "2026-06-30",
        tipoBaja: "termino_contrato",
        motivoBajaId: "0b7f8c1e-2d3a-4f5b-8c6d-7e8f9a0b1c2d",
        recontratable: false,
        finiquito: { estado: "pendiente", monto: -1 },
      }).error?.issues[0]?.message,
    ).toBe("El monto no puede ser negativo.");
  });

  it("defaults the rehire to not recognizing the previous seniority", () => {
    expect(rehireSchema.parse({ fechaIngreso: "2026-01-01" })).toMatchObject({
      reconoceAntiguedad: false,
    });
    expect(
      rehireSchema.safeParse({
        fechaIngreso: "2026-01-01",
        reconoceAntiguedad: true,
        fechaAntiguedadReconocida: "2026-02-01",
      }).success,
    ).toBe(false);
  });
});

describe("backfill plan", () => {
  const person = {
    id: "x1",
    companyId: "c1",
    status: "baja" as const,
    fechaIngreso: "2019-01-01",
  };

  it("prefers the audit date, then the last contract, else «sin fecha»", () => {
    expect(planEmploymentPeriod(person, "2024-03-10", "2023-12-31")).toEqual({
      source: "audit",
      values: expect.objectContaining({
        fechaBaja: "2024-03-10",
        fechaBajaInferida: true,
        bajaSinFecha: false,
        requiereRevision: false,
      }),
    });
    expect(planEmploymentPeriod(person, null, "2023-12-31").source).toBe(
      "contract",
    );
    expect(planEmploymentPeriod(person, null, null)).toEqual({
      source: "sin_fecha",
      values: expect.objectContaining({
        fechaBaja: null,
        bajaSinFecha: true,
        requiereRevision: true,
      }),
    });
  });

  it("never infers a baja before the ingreso, and flags a missing ingreso", () => {
    expect(planEmploymentPeriod(person, "2018-05-01", null).source).toBe(
      "sin_fecha",
    );
    expect(
      planEmploymentPeriod(
        { ...person, status: "activa", fechaIngreso: null },
        null,
        null,
      ),
    ).toEqual({
      source: "open",
      values: expect.objectContaining({ requiereRevision: true }),
    });
  });
});

describe("one alta per employment period", () => {
  const open = { id: "p2", periodCount: 2 };

  it("lets a rehired person start a new alta", () => {
    expect(
      blocksNewOnboarding(
        { employmentPeriodId: "p1", stage: "completo" },
        open,
      ),
    ).toBe(false);
    expect(
      blocksNewOnboarding(
        { employmentPeriodId: "p2", stage: "rechazado" },
        open,
      ),
    ).toBe(true);
  });

  it("blocks while one is in progress, or without periods (as before)", () => {
    expect(
      blocksNewOnboarding(
        { employmentPeriodId: "p1", stage: "pendiente_nominas" },
        open,
      ),
    ).toBe(true);
    expect(
      blocksNewOnboarding(
        { employmentPeriodId: null, stage: "completo" },
        null,
      ),
    ).toBe(true);
    expect(
      blocksNewOnboarding(
        { employmentPeriodId: null, stage: "completo" },
        { id: "p1", periodCount: 1 },
      ),
    ).toBe(true);
  });
});
