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
});

describe("dummy identifier policy", () => {
  it("uses obviously fake RFC placeholder in tests", () => {
    const fakeRfc = "XAXX010101000";

    expect(fakeRfc.startsWith("XAXX")).toBe(true);
    expect(fakeRfc).toContain("010101");
  });
});
