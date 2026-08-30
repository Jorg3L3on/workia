import { describe, expect, it } from "vitest";

import { formatPersonName } from "@/lib/people/schema";

describe("people domain rules", () => {
  it("formats Mexican full name with optional materno", () => {
    expect(
      formatPersonName({
        nombres: "Persona",
        apellidoPaterno: "Demo",
        apellidoMaterno: "Ejemplo",
      }),
    ).toBe("Persona Demo Ejemplo");

    expect(
      formatPersonName({
        nombres: "Persona",
        apellidoPaterno: "Demo",
      }),
    ).toBe("Persona Demo");
  });

  it("treats baja and delete as distinct concepts in status labels", async () => {
    const { personStatusLabels } = await import("@/lib/people/schema");

    expect(personStatusLabels.baja).toBe("Baja");
    expect(personStatusLabels.activa).toBe("Activa");
  });

  it("marks soft-deleted people without treating them as baja", async () => {
    const { personDeletedLabel, personIsDeleted } =
      await import("@/lib/people/schema");

    expect(personDeletedLabel).toBe("Borrado");
    expect(
      personIsDeleted({ deletedAt: new Date("2026-01-15T00:00:00Z") }),
    ).toBe(true);
    expect(personIsDeleted({ deletedAt: null })).toBe(false);
  });

  it("keeps deleted people out of the default expediente list", async () => {
    const { matchesPersonaListRow } = await import("@/lib/people/schema");

    expect(
      matchesPersonaListRow(
        { status: "activa", deleted: false },
        { visibility: "expediente" },
      ),
    ).toBe(true);
    expect(
      matchesPersonaListRow(
        { status: "activa", deleted: true },
        { visibility: "expediente" },
      ),
    ).toBe(false);
    expect(
      matchesPersonaListRow(
        { status: "activa", deleted: true },
        { visibility: "deleted" },
      ),
    ).toBe(true);
    expect(
      matchesPersonaListRow(
        { status: "baja", deleted: true },
        { status: "activa", visibility: "deleted" },
      ),
    ).toBe(false);
  });
});

describe("person schedule helpers", () => {
  it("formats the horario token in Spanish without inventing PII", async () => {
    const { formatHorarioToken, toPersonScheduleValues } =
      await import("@/lib/people/schema");

    expect(
      formatHorarioToken(
        toPersonScheduleValues({
          horarioEntrada: "08:00",
          horarioSalidaComer: "13:00",
          horarioRegresoComer: "14:00",
          horarioSalida: "17:00",
        }),
      ),
    ).toBe(
      "entrada 08:00, salida a comer 13:00, regreso de comer 14:00, salida 17:00",
    );
    expect(formatHorarioToken(null)).toBe("—");
  });
});

describe("dummy identifier policy", () => {
  it("uses obviously fake RFC placeholder in tests", () => {
    const fakeRfc = "XAXX010101000";

    expect(fakeRfc.startsWith("XAXX")).toBe(true);
    expect(fakeRfc).toContain("010101");
  });
});
