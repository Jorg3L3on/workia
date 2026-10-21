import { describe, expect, it } from "vitest";

import {
  PERSON_FORM_SECTIONS,
  bajaDetails,
  contractFact,
  employmentPeriodItems,
  finiquitoAmountLabel,
  ingresoFact,
  isPersonFormField,
  isPersonFormSection,
  personEditHref,
  personInitials,
  seniorityAsOf,
  seniorityFact,
  splitDetailFields,
} from "@/components/people/person-detail-model";

const formatDate = (value: string) => `fecha ${value}`;

describe("personEditHref", () => {
  it("opens the form, at a section and a field when given", () => {
    expect(personEditHref("p-1")).toBe("/app/personas/p-1?edit=1");
    expect(personEditHref("p-1", "identificadores")).toBe(
      "/app/personas/p-1?edit=1&seccion=identificadores",
    );
    expect(personEditHref("p-1", "identificadores", "curp")).toBe(
      "/app/personas/p-1?edit=1&seccion=identificadores&campo=curp",
    );
  });

  it("ignores a field without a section", () => {
    expect(personEditHref("p-1", undefined, "curp")).toBe(
      "/app/personas/p-1?edit=1",
    );
  });
});

describe("section and field params", () => {
  it("accepts only the form's sections", () => {
    for (const section of PERSON_FORM_SECTIONS) {
      expect(isPersonFormSection(section)).toBe(true);
    }
    expect(isPersonFormSection("contratos")).toBe(false);
    expect(isPersonFormSection(undefined)).toBe(false);
  });

  it("accepts only plain control ids", () => {
    expect(isPersonFormField("fechaIngreso")).toBe(true);
    expect(isPersonFormField("curp")).toBe(true);
    expect(isPersonFormField("a b")).toBe(false);
    expect(isPersonFormField('x"]')).toBe(false);
    expect(isPersonFormField("")).toBe(false);
  });
});

describe("personInitials", () => {
  it("takes the first name and the first surname", () => {
    expect(
      personInitials({ nombres: "élena maría", apellidoPaterno: "Ñuñez" }),
    ).toBe("ÉÑ");
  });
});

describe("splitDetailFields", () => {
  it("moves empty values (null, blank, «—», empty lists) to missing", () => {
    const { present, missing } = splitDetailFields([
      { label: "RFC", value: "XAXX010101000" },
      { label: "CURP", value: null },
      { label: "NSS", value: "  " },
      { label: "Horario", value: "—" },
      { label: "Beneficiarios", value: [] },
      { label: "Correo", value: undefined },
    ]);

    expect(present.map((field) => field.label)).toEqual(["RFC"]);
    expect(missing.map((field) => field.label)).toEqual([
      "CURP",
      "NSS",
      "Horario",
      "Beneficiarios",
      "Correo",
    ]);
  });
});

describe("seniorityFact", () => {
  it("counts from the hire date to today", () => {
    expect(
      seniorityFact({ seniorityDate: "2023-06-12", asOf: "2026-10-21" }),
    ).toEqual({ value: "3 años, 4 meses" });
  });

  it("says when there is no hire date", () => {
    expect(seniorityFact({ seniorityDate: null, asOf: "2026-10-21" })).toEqual({
      value: "Sin fecha de ingreso",
    });
  });

  it("does not count to today for a baja without a date", () => {
    expect(seniorityFact({ seniorityDate: "2023-06-12", asOf: null })).toEqual({
      value: "—",
      hint: "Sin fecha de baja",
    });
  });

  it("restarts on a rehire that did not recognize seniority", () => {
    expect(
      seniorityFact({
        seniorityDate: "2025-04-01",
        asOf: "2026-10-21",
        fechaIngreso: "2025-04-01",
      }),
    ).toEqual({ value: "1 año, 6 meses" });
  });

  it("says since when on a rehire that recognized it", () => {
    expect(
      seniorityFact({
        seniorityDate: "2019-02-15",
        asOf: "2026-10-21",
        fechaIngreso: "2025-04-01",
      }),
    ).toEqual({ value: "7 años, 8 meses", hint: "Desde 15/02/2019" });
  });

  it("stops at the fecha de baja", () => {
    expect(
      seniorityFact({
        seniorityDate: "2023-06-12",
        asOf: "2026-06-30",
        fechaIngreso: "2023-06-12",
        baja: true,
      }),
    ).toEqual({ value: "3 años", hint: "Hasta la baja (30/06/2026)" });
  });
});

describe("seniorityAsOf", () => {
  const today = "2026-10-21";

  it("is today for an active person", () => {
    expect(
      seniorityAsOf({ status: "activa", fechaBaja: "2026-06-30", today }),
    ).toBe(today);
  });

  it("is the fecha de baja on baja, never after today", () => {
    expect(
      seniorityAsOf({ status: "baja", fechaBaja: "2026-06-30", today }),
    ).toBe("2026-06-30");
    expect(
      seniorityAsOf({ status: "baja", fechaBaja: "2026-12-31", today }),
    ).toBe(today);
    expect(seniorityAsOf({ status: "baja", fechaBaja: null, today })).toBe(
      null,
    );
  });
});

describe("ingresoFact", () => {
  it("is the current ingreso alone on a first period", () => {
    expect(ingresoFact({ fechaIngreso: "2023-06-12" })).toEqual({
      value: "12/06/2023",
    });
    expect(ingresoFact({ fechaIngreso: null })).toEqual({
      value: "Sin capturar",
    });
  });

  it("names the period and the seniority choice after a rehire", () => {
    expect(ingresoFact({ fechaIngreso: "2025-04-01", periodCount: 2 })).toEqual(
      {
        value: "01/04/2025",
        hint: "2.º periodo · antigüedad reiniciada",
      },
    );
    expect(
      ingresoFact({
        fechaIngreso: "2025-04-01",
        periodCount: 3,
        reconoceAntiguedad: true,
      }),
    ).toEqual({
      value: "01/04/2025",
      hint: "3.º periodo · reconoce antigüedad",
    });
  });
});

const closedBaja = {
  fechaBaja: "2026-06-30",
  bajaSinFecha: false,
  fechaBajaInferida: false,
  requiereRevision: false,
  tipoBaja: "voluntaria" as const,
  motivoBaja: "Cambio de residencia",
  comentarioBaja: "Se muda a otra ciudad",
  recontratable: true,
  finiquitoEstado: "pagado" as const,
  finiquitoFecha: "2026-07-15",
  finiquitoMonto: "12345.67",
};

const detail = (details: ReturnType<typeof bajaDetails>, label: string) =>
  details.find((item) => item.label === label);

describe("bajaDetails", () => {
  it("maps fecha, tipo, motivo, recontratable, finiquito and comentario", () => {
    const details = bajaDetails(closedBaja, true);

    expect(details.map((item) => [item.label, item.value])).toEqual([
      ["Fecha de baja", "30/06/2026"],
      ["Tipo de baja", "Voluntaria"],
      ["Motivo", "Cambio de residencia"],
      ["Recontratable", "Sí"],
      ["Finiquito", "Pagado · 15/07/2026"],
      ["Monto del finiquito", expect.stringMatching(/12,345\.67/)],
      ["Comentario", "Se muda a otra ciudad"],
    ]);
    expect(detail(details, "Fecha de baja")?.hint).toBeUndefined();
    expect(detail(details, "Comentario")?.wide).toBe(true);
  });

  it("masks the finiquito amount without compensation:read", () => {
    const details = bajaDetails(closedBaja, false);

    expect(detail(details, "Monto del finiquito")?.value).toBe("•••");
    expect(JSON.stringify(details)).not.toMatch(/12,?345/);
    // Masked even when there is no amount: the absence is not shown either.
    expect(
      detail(
        bajaDetails({ ...closedBaja, finiquitoMonto: null }, false),
        "Monto del finiquito",
      )?.value,
    ).toBe("•••");
  });

  it("reads «Sin fecha, requiere revisión» for a baja without a date", () => {
    const fecha = detail(
      bajaDetails(
        {
          ...closedBaja,
          fechaBaja: null,
          bajaSinFecha: true,
          requiereRevision: true,
        },
        true,
      ),
      "Fecha de baja",
    );

    expect(fecha?.value).toBe("Sin fecha, requiere revisión");
    expect(fecha?.hint).toMatch(/Confírmala/);
  });

  it("marks an inferred date «inferida», and one to review", () => {
    expect(
      detail(
        bajaDetails({ ...closedBaja, fechaBajaInferida: true }, true),
        "Fecha de baja",
      ),
    ).toMatchObject({ value: "30/06/2026", hint: "inferida" });
    expect(
      detail(
        bajaDetails(
          { ...closedBaja, fechaBajaInferida: true, requiereRevision: true },
          true,
        ),
        "Fecha de baja",
      )?.hint,
    ).toBe("inferida · requiere revisión");
  });

  it("says what was not recorded and leaves out an empty comentario", () => {
    const details = bajaDetails(
      {
        ...closedBaja,
        tipoBaja: null,
        motivoBaja: null,
        recontratable: null,
        finiquitoEstado: null,
        finiquitoFecha: null,
        finiquitoMonto: null,
        comentarioBaja: "  ",
      },
      true,
    );

    expect(detail(details, "Tipo de baja")?.value).toBe("Sin registrar");
    expect(detail(details, "Motivo")?.value).toBe("Sin registrar");
    expect(detail(details, "Recontratable")?.value).toBe("Sin registrar");
    expect(detail(details, "Finiquito")?.value).toBe("Sin registrar");
    expect(detail(details, "Monto del finiquito")?.value).toBe("Sin monto");
    expect(detail(details, "Comentario")).toBeUndefined();
    expect(
      detail(
        bajaDetails({ ...closedBaja, recontratable: false }, true),
        "Recontratable",
      )?.value,
    ).toBe("No");
  });
});

describe("finiquitoAmountLabel", () => {
  it("shows pesos only with compensation:read", () => {
    expect(finiquitoAmountLabel("12345.67", true)).toMatch(/\$12,345\.67/);
    expect(finiquitoAmountLabel("12345.67", false)).toBe("•••");
  });
});

describe("employmentPeriodItems", () => {
  const periods = [
    {
      id: "period-1",
      fechaIngreso: "2020-03-12",
      fechaBaja: "2023-06-30",
      bajaSinFecha: false,
      tipoBaja: "termino_contrato" as const,
      motivoBaja: "Fin de proyecto",
      reconoceAntiguedad: false,
      finiquitoEstado: "pagado" as const,
      finiquitoMonto: "8000.00",
    },
    {
      id: "period-2",
      fechaIngreso: "2024-01-08",
      fechaBaja: null,
      bajaSinFecha: true,
      tipoBaja: null,
      motivoBaja: null,
      reconoceAntiguedad: true,
      finiquitoEstado: null,
      finiquitoMonto: null,
    },
    {
      id: "period-3",
      fechaIngreso: "2025-04-01",
      fechaBaja: null,
      bajaSinFecha: false,
      tipoBaja: null,
      motivoBaja: null,
      reconoceAntiguedad: false,
      finiquitoEstado: null,
      finiquitoMonto: null,
    },
  ];

  it("lists every period oldest first: ingreso → baja, tipo, motivo", () => {
    expect(employmentPeriodItems(periods, true)).toEqual([
      {
        id: "period-1",
        label: "1.º periodo",
        range: "12/03/2020 → 30/06/2023",
        details: [
          "Término de contrato",
          "Fin de proyecto",
          expect.stringMatching(/^Finiquito pagado: \$8,000\.00$/),
        ],
      },
      {
        id: "period-2",
        label: "2.º periodo",
        range: "08/01/2024 → sin fecha",
        details: ["reconoce antigüedad"],
      },
      {
        id: "period-3",
        label: "3.º periodo",
        range: "01/04/2025 → en curso",
        details: ["Periodo actual", "antigüedad reiniciada"],
      },
    ]);
  });

  it("masks finiquito amounts without compensation:read", () => {
    const items = employmentPeriodItems(periods, false);

    expect(items[0].details).toContain("Finiquito pagado: •••");
    expect(JSON.stringify(items)).not.toMatch(/8,?000/);
  });
});

describe("contractFact", () => {
  const today = "2026-10-21";

  it("reads «Sin contrato vigente» without one", () => {
    expect(contractFact(null, today, formatDate)).toEqual({
      value: "Sin contrato vigente",
    });
  });

  it("marks an open-ended contract", () => {
    expect(
      contractFact(
        { typeLabel: "Indeterminado", endDate: null },
        today,
        formatDate,
      ),
    ).toEqual({
      value: "Indeterminado",
      hint: "Sin fecha de fin",
      urgency: "sin_fin",
    });
  });

  it("uses the renewal tray's urgency", () => {
    expect(
      contractFact(
        { typeLabel: "Determinado", endDate: "2026-11-05" },
        today,
        formatDate,
      ),
    ).toEqual({
      value: "Determinado",
      hint: "Vence en 15 días · fecha 2026-11-05",
      urgency: "proximo",
    });
    expect(
      contractFact(
        { typeLabel: "Determinado", endDate: "2027-08-07" },
        today,
        formatDate,
      ),
    ).toMatchObject({
      hint: "Vence el fecha 2027-08-07",
      urgency: "en_ventana",
    });
    expect(
      contractFact(
        { typeLabel: "Determinado", endDate: "2026-10-01" },
        today,
        formatDate,
      ),
    ).toMatchObject({ hint: "Venció el fecha 2026-10-01", urgency: "vencido" });
  });
});
