import { describe, expect, it } from "vitest";

import {
  buildPersonDocumentCard,
  personDocumentCardWithoutPosition,
  summarizePersonDocumentRows,
  type PersonDocumentDeliverySlice,
  type PersonDocumentRequirementSlice,
} from "./person-card";

const today = "2026-10-28";

const requirement = (
  id: string,
  name: string,
  sort: number,
  extra: Partial<PersonDocumentRequirementSlice> = {},
): PersonDocumentRequirementSlice => ({
  id,
  name,
  required: true,
  validityMonths: null,
  sort,
  ...extra,
});

const delivery = (
  requirementId: string,
  deliveredOn: string,
  expiresOn: string | null,
  createdAt?: string,
): PersonDocumentDeliverySlice => ({
  personId: "person-1",
  requirementId,
  deliveredOn,
  expiresOn,
  createdAt,
});

describe("buildPersonDocumentCard", () => {
  it("shows one row per requirement with the four chips", () => {
    const card = buildPersonDocumentCard(
      [
        requirement("vencido", "Examen médico", 3, { validityMonths: 12 }),
        requirement("falta", "Identificación", 0),
        requirement("vigente", "Contrato laboral", 1, { validityMonths: 12 }),
        requirement("por-vencer", "Comprobante de domicilio", 2, {
          validityMonths: 6,
        }),
      ],
      [
        delivery("vigente", "2026-01-15", "2027-01-15"),
        delivery("por-vencer", "2026-10-01", "2026-11-20"),
        delivery("vencido", "2025-01-01", "2026-09-01"),
      ],
      today,
    );

    expect(card.rows.map((row) => [row.name, row.status])).toEqual([
      ["Identificación", "missing"],
      ["Contrato laboral", "valid"],
      ["Comprobante de domicilio", "expiring"],
      ["Examen médico", "expired"],
    ]);
    expect(card.state).toBe("expired");
    expect(card.message).toBe("Hay documentos vencidos.");
  });

  it("keeps the latest delivery when an older one is expired", () => {
    const card = buildPersonDocumentCard(
      [requirement("ine", "Identificación", 0)],
      [
        delivery("ine", "2024-01-01", "2025-01-01", "2024-01-02T00:00:00.000Z"),
        delivery("ine", "2026-08-01", "2027-08-01", "2026-08-02T00:00:00.000Z"),
      ],
      today,
    );

    expect(card.rows[0]).toMatchObject({
      status: "valid",
      deliveredOn: "2026-08-01",
      expiresOn: "2027-08-01",
    });
    expect(card.state).toBe("ok");
  });

  it("is expiring ahead of a missing paper, and missing ahead of vigente", () => {
    expect(
      summarizePersonDocumentRows([
        { status: "missing" },
        { status: "expiring" },
        { status: "valid" },
      ]).state,
    ).toBe("expiring");
    expect(
      summarizePersonDocumentRows([{ status: "missing" }, { status: "valid" }])
        .state,
    ).toBe("missing");
    expect(summarizePersonDocumentRows([{ status: "valid" }])).toEqual({
      state: "ok",
      message: "Todo en orden.",
    });
  });

  it("is empty when the puesto has no requirements", () => {
    expect(buildPersonDocumentCard([], [], today)).toEqual({
      state: "empty",
      message: "Este puesto no tiene documentos requeridos.",
      rows: [],
    });
  });

  it("says the person has no puesto", () => {
    expect(personDocumentCardWithoutPosition()).toEqual({
      state: "empty",
      message: "Esta persona no tiene puesto.",
      rows: [],
    });
  });

  it("treats a delivery without an expiry as vigente", () => {
    const card = buildPersonDocumentCard(
      [requirement("ine", "Identificación", 0)],
      [delivery("ine", "2026-03-01", null)],
      today,
    );

    expect(card.rows[0]?.status).toBe("valid");
    expect(card.rows[0]?.expiresOn).toBeNull();
  });
});
