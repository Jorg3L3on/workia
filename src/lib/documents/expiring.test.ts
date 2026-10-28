import { describe, expect, it } from "vitest";

import {
  expiringStatusFromParam,
  selectExpiringDocumentRows,
  type ExpiringDocumentCandidate,
} from "./expiring";

const today = "2026-10-28";

const candidate = (
  id: string,
  extra: Partial<ExpiringDocumentCandidate> = {},
): ExpiringDocumentCandidate => ({
  id,
  personId: "person-a",
  requirementId: "req-a",
  deliveredOn: "2026-01-01",
  expiresOn: "2026-11-07",
  createdAt: "2026-01-01T00:00:00.000Z",
  personName: "Persona Demostración",
  positionId: "puesto-a",
  positionName: "Puesto Caja",
  requirementName: "Licencia de demostración",
  ...extra,
});

describe("selectExpiringDocumentRows", () => {
  it("keeps the latest delivery that expires today or within 30 days, by date", () => {
    const rows = selectExpiringDocumentRows(
      [
        candidate("later-window", {
          requirementId: "req-30",
          expiresOn: "2026-11-27",
          requirementName: "Comprobante",
        }),
        candidate("today", {
          requirementId: "req-today",
          expiresOn: today,
          requirementName: "Identificación",
        }),
        candidate("too-far", {
          requirementId: "req-31",
          expiresOn: "2026-11-28",
          requirementName: "Carta",
        }),
        candidate("expired", {
          requirementId: "req-past",
          expiresOn: "2026-10-27",
          requirementName: "Examen",
        }),
        candidate("open", {
          requirementId: "req-open",
          expiresOn: null,
          requirementName: "Contrato",
        }),
        candidate("older", {
          requirementId: "req-replaced",
          expiresOn: "2026-11-01",
          deliveredOn: "2026-01-01",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
        candidate("newer", {
          id: "newer",
          requirementId: "req-replaced",
          expiresOn: "2026-11-10",
          deliveredOn: "2026-06-01",
          createdAt: "2026-06-01T00:00:00.000Z",
          requirementName: "Licencia de demostración",
        }),
      ],
      today,
    );

    expect(rows.map((row) => row.id)).toEqual([
      "today",
      "newer",
      "later-window",
    ]);
    expect(rows.every((row) => row.status === "expiring")).toBe(true);
  });

  it("uses the later row when two deliveries share the day", () => {
    const rows = selectExpiringDocumentRows(
      [
        candidate("first", {
          expiresOn: "2026-11-02",
          createdAt: "2026-02-01T00:00:00.000Z",
        }),
        candidate("second", {
          expiresOn: "2026-11-15",
          createdAt: "2026-03-01T00:00:00.000Z",
        }),
      ],
      today,
    );

    expect(rows.map((row) => row.id)).toEqual(["second"]);
  });

  it("lists already expired deliveries only for the vencido filter", () => {
    const rows = selectExpiringDocumentRows(
      [
        candidate("past", {
          expiresOn: "2026-10-01",
          requirementId: "req-past",
        }),
        candidate("soon", {
          expiresOn: "2026-11-01",
          requirementId: "req-soon",
        }),
      ],
      today,
      { status: "expired" },
    );

    expect(rows.map((row) => row.id)).toEqual(["past"]);
    expect(rows[0]?.status).toBe("expired");
  });

  it("filters by the person's puesto", () => {
    const rows = selectExpiringDocumentRows(
      [
        candidate("caja", { positionId: "puesto-caja", personId: "person-a" }),
        candidate("piso", {
          id: "piso",
          personId: "person-b",
          requirementId: "req-b",
          positionId: "puesto-piso",
          positionName: "Puesto Piso",
          personName: "Persona Otra",
          expiresOn: "2026-11-01",
        }),
      ],
      today,
      { positionId: "puesto-piso" },
    );

    expect(rows.map((row) => row.personId)).toEqual(["person-b"]);
  });

  it("reads the estado query", () => {
    expect(expiringStatusFromParam(undefined)).toBe("expiring");
    expect(expiringStatusFromParam("por-vencer")).toBe("expiring");
    expect(expiringStatusFromParam("vencido")).toBe("expired");
    expect(expiringStatusFromParam("otro")).toBe("expiring");
  });
});
