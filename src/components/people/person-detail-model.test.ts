import { describe, expect, it } from "vitest";

import {
  PERSON_FORM_SECTIONS,
  contractFact,
  isPersonFormField,
  isPersonFormSection,
  personEditHref,
  personInitials,
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
