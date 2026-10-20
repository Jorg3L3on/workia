import { describe, expect, it } from "vitest";

import { OFFICIAL_TEMPLATES } from "@/lib/contracts/official-templates";
import {
  compensationValues,
  CONTRACT_TEMPLATE_TOKENS,
  contractFormSchema,
  contractTemplateTokenLabels,
  fillContractTemplate,
  isContractInRenewalWindow,
  monthlySalary,
  noticeWindowToMonths,
  renewalStatus,
  templateTokenValues,
} from "@/lib/contracts/schema";

describe("contract template tokens", () => {
  it("fills expediente fields into template body", () => {
    const body =
      "Contrato con {{nombres}} {{apellido_paterno}} {{apellido_materno}}, puesto {{puesto}}, área {{area}}, sucursal {{sucursal}}, RFC {{rfc}}, horario {{horario}}, del {{fecha_inicio}} al {{fecha_fin}}.";

    const filled = fillContractTemplate(body, {
      nombres: "Ana",
      apellidoPaterno: "Demo",
      apellidoMaterno: "Ejemplo",
      puesto: "Analista",
      area: "RRHH",
      sucursal: "Corporativo Demo (Corporativo)",
      rfc: "XAXX010101000",
      horario:
        "entrada 08:00, salida a comer 13:00, regreso de comer 14:00, salida 17:00",
      fechaInicio: "2025-01-15",
      fechaFin: "2025-12-31",
    });

    expect(filled).toContain("Ana Demo Ejemplo");
    expect(filled).toContain("Analista");
    expect(filled).toContain("RRHH");
    expect(filled).toContain("Corporativo Demo");
    expect(filled).toContain("XAXX010101000");
    expect(filled).toContain("entrada 08:00");
    expect(filled).toContain("15/01/2025");
    expect(filled).toContain("31/12/2025");
    expect(filled).not.toContain("01/15/2025");
    expect(filled).not.toContain("{{nombres}}");
    expect(filled).not.toContain("{{horario}}");
  });
});

describe("contract schedule snapshot", () => {
  it("keeps the emitted schedule when the expediente later changes", async () => {
    const { buildContractScheduleSnapshot, fillContractTemplate } =
      await import("@/lib/contracts/schema");
    const { formatHorarioToken } = await import("@/lib/people/schema");

    const scheduleAtEmit = {
      entrada: "08:00",
      salidaComer: "13:00",
      regresoComer: "14:00",
      salida: "17:00",
    };
    const laterExpediente = {
      entrada: "10:00",
      salidaComer: "15:00",
      regresoComer: "16:00",
      salida: "19:00",
    };

    const issued = {
      ...buildContractScheduleSnapshot(scheduleAtEmit),
      generatedText: fillContractTemplate("Horario: {{horario}}.", {
        nombres: "Persona",
        apellidoPaterno: "Demo",
        horario: formatHorarioToken(scheduleAtEmit),
        fechaInicio: "2026-01-15",
      }),
    };

    expect(issued.scheduleEntrada).toBe("08:00");
    expect(issued.generatedText).toContain("08:00");
    expect(issued.generatedText).not.toContain("10:00");
    expect(buildContractScheduleSnapshot(laterExpediente).scheduleEntrada).toBe(
      "10:00",
    );
    expect(formatHorarioToken(laterExpediente)).toContain("10:00");
    expect(issued.scheduleEntrada).not.toBe(
      buildContractScheduleSnapshot(laterExpediente).scheduleEntrada,
    );
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

describe("template token catalog", () => {
  it("includes horario next to the expediente tokens", async () => {
    const { CONTRACT_TEMPLATE_TOKENS } = await import("@/lib/contracts/schema");

    expect(CONTRACT_TEMPLATE_TOKENS).toContain("horario");
    expect(CONTRACT_TEMPLATE_TOKENS).toContain("puesto");
    expect(CONTRACT_TEMPLATE_TOKENS).toContain("sucursal");
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

describe("contract compensation", () => {
  const base = {
    personId: "00000000-0000-4000-8000-000000000001",
    templateId: "00000000-0000-4000-8000-000000000002",
    type: "indeterminado",
    startDate: "2026-09-01",
    endDate: "",
    noticeWindow: "no_avisar",
  };

  it("needs payment method and frequency with a salary", () => {
    const parsed = contractFormSchema.safeParse({
      ...base,
      salarioDiario: "500",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path[0])).toEqual([
      "formaPago",
      "periodicidadPago",
    ]);
  });

  it("accepts a contract without compensation", () => {
    expect(contractFormSchema.safeParse(base).success).toBe(true);
    expect(
      contractFormSchema.safeParse({ ...base, salarioDiario: "" }).success,
    ).toBe(true);
  });

  it("rejects a salary that is not positive", () => {
    const parsed = contractFormSchema.safeParse({
      ...base,
      salarioDiario: "0",
      formaPago: "efectivo",
      periodicidadPago: "semanal",
    });
    expect(parsed.success).toBe(false);
  });

  it("derives the monthly salary with 30.4 days", () => {
    expect(monthlySalary(278.8)).toBe(8475.52);
    expect(
      compensationValues({
        salarioDiario: 500,
        formaPago: "transferencia",
        periodicidadPago: "quincenal",
        diaPago: "  ",
      }),
    ).toEqual({
      salarioDiario: "500.00",
      salarioMensual: "15200.00",
      formaPago: "transferencia",
      periodicidadPago: "quincenal",
      diaPago: null,
    });
    expect(compensationValues({ salarioDiario: "" }).salarioDiario).toBeNull();
  });
});

describe("official template tokens", () => {
  const context = {
    nombres: "Ana",
    apellidoPaterno: "Demo",
    fechaInicio: "2026-09-01",
    curp: "DEMA900101MCSRNN09",
    ine: "DMANNA90010107M100",
    domicilio: "Calle 5, Col. Centro, Tuxtla Gutiérrez, Chiapas, C.P. 29000",
    estadoCivil: "Soltera",
    salarioDiario: "500.00",
    salarioMensual: "15200.00",
    formaPago: "transferencia",
    periodicidad: "quincenal",
    fechaIngreso: "2023-03-15",
    empresa: "Ferretera",
    empresaRazonSocial: "Ferretera SA de CV",
    empresaRfc: "FER010101AB1",
  };

  it("fills the new tokens", () => {
    const filled = fillContractTemplate(
      "{{curp}} {{ine}} | {{domicilio}} | {{estado_civil}} | {{salario_diario}} / {{salario_mensual}} | {{forma_pago}} {{periodicidad}} | {{fecha_ingreso}} | {{antiguedad}} | {{empresa}} {{empresa_razon_social}} {{empresa_rfc}}",
      context,
    );

    expect(filled).toBe(
      "DEMA900101MCSRNN09 DMANNA90010107M100 | Calle 5, Col. Centro, Tuxtla Gutiérrez, Chiapas, C.P. 29000 | Soltera | $500.00 / $15,200.00 | transferencia quincenal | 15/03/2023 | 3 años, 5 meses | Ferretera Ferretera SA de CV FER010101AB1",
    );
  });

  it("reports the tokens without a value as null", () => {
    const values = templateTokenValues({
      nombres: "Ana",
      apellidoPaterno: "Demo",
      fechaInicio: "2026-09-01",
      horario: "—",
    });
    expect(values.horario).toBeNull();
    expect(values.salario_diario).toBeNull();
    expect(values.antiguedad).toBeNull();
    expect(values.nombres).toBe("Ana");
  });

  it("official templates only use tokens Workia fills, and every token has a label", () => {
    for (const template of OFFICIAL_TEMPLATES) {
      const used = [...template.body.matchAll(/\{\{(\w+)\}\}/g)].map(
        (match) => match[1],
      );
      expect(
        used.filter(
          (token) =>
            !(CONTRACT_TEMPLATE_TOKENS as readonly string[]).includes(token),
        ),
        template.name,
      ).toEqual([]);
    }
    for (const token of CONTRACT_TEMPLATE_TOKENS) {
      expect(contractTemplateTokenLabels[token]).toBeTruthy();
    }
  });
});

describe("renewal status", () => {
  it("reads overdue, soon and in-window contracts", () => {
    expect(renewalStatus("2026-10-17", "2026-10-18")).toMatchObject({
      urgency: "vencido",
      label: "Vencido",
    });
    expect(renewalStatus("2026-10-18", "2026-10-18").label).toBe("Vence hoy");
    expect(renewalStatus("2026-10-19", "2026-10-18").label).toBe("En 1 día");
    expect(renewalStatus("2026-11-07", "2026-10-18")).toMatchObject({
      urgency: "proximo",
      label: "En 20 días",
    });
    expect(renewalStatus("2027-03-27", "2026-10-18")).toMatchObject({
      urgency: "en_ventana",
      label: "En ventana",
    });
  });
});
