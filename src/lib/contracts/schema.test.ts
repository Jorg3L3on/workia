import { describe, expect, it } from "vitest";

import {
  fillContractTemplate,
  isContractInRenewalWindow,
  noticeWindowToMonths,
} from "@/lib/contracts/schema";

describe("contract template tokens", () => {
  it("fills expediente fields into template body", () => {
    const body =
      "Contrato con {{nombres}} {{apellido_paterno}} {{apellido_materno}}, puesto {{puesto}}, área {{area}}, sucursal {{sucursal}}, RFC {{rfc}}, del {{fecha_inicio}} al {{fecha_fin}}.";

    const filled = fillContractTemplate(body, {
      nombres: "Ana",
      apellidoPaterno: "Demo",
      apellidoMaterno: "Ejemplo",
      puesto: "Analista",
      area: "RRHH",
      sucursal: "Corporativo Demo (Corporativo)",
      rfc: "XAXX010101000",
      fechaInicio: "2025-01-15",
      fechaFin: "2025-12-31",
    });

    expect(filled).toContain("Ana Demo Ejemplo");
    expect(filled).toContain("Analista");
    expect(filled).toContain("RRHH");
    expect(filled).toContain("Corporativo Demo");
    expect(filled).toContain("XAXX010101000");
    expect(filled).not.toContain("{{nombres}}");
  });
});

describe("renewal window", () => {
  it("respects notice window vs no avisar", () => {
    expect(
      isContractInRenewalWindow({
        type: "determinado",
        status: "vigente",
        endDate: "2026-09-15",
        noticeWindow: "1",
        referenceDate: "2026-08-20",
      }),
    ).toBe(true);

    expect(
      isContractInRenewalWindow({
        type: "determinado",
        status: "vigente",
        endDate: "2026-12-15",
        noticeWindow: "no_avisar",
        referenceDate: "2026-08-20",
      }),
    ).toBe(false);

    expect(
      isContractInRenewalWindow({
        type: "indeterminado",
        status: "vigente",
        endDate: null,
        noticeWindow: "3",
        referenceDate: "2026-08-20",
      }),
    ).toBe(false);
  });

  it("maps notice windows to months", () => {
    expect(noticeWindowToMonths("3")).toBe(3);
    expect(noticeWindowToMonths("no_avisar")).toBeNull();
  });
});

describe("permission catalog", () => {
  it("includes contracts permissions", async () => {
    const { PERMISSIONS } = await import("@/lib/db/schema/types");
    const slugs = PERMISSIONS.map((permission) => permission.slug);

    expect(slugs).toContain("contracts:read");
    expect(slugs).toContain("contracts:create");
    expect(slugs).toContain("contract_templates:read");
  });
});

describe("demo seed safety", () => {
  it("uses dummy RRHH fallback without real PII", async () => {
    const { DEMO_RRHH_FALLBACK } = await import("@/lib/db/schema/types");

    expect(DEMO_RRHH_FALLBACK.email).toContain(".local");
    expect(DEMO_RRHH_FALLBACK.name).toMatch(/Demo/);
    expect(DEMO_RRHH_FALLBACK.nombres).toBe("Elena");
  });
});
