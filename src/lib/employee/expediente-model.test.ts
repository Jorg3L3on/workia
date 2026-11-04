import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { PERSON_FORM_SECTIONS } from "@/components/people/person-detail-model";
import * as schema from "@/lib/db/schema";

import {
  correctableField,
  EXPEDIENTE_FIELDS,
  expedienteSections,
  expedienteValues,
  type ExpedienteData,
} from "./expediente-model";

const columnsByTable = new Map(
  (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => value instanceof PgTable)
    .map((table) => {
      const config = getTableConfig(table);
      return [
        config.name,
        new Set(config.columns.map((column) => column.name)),
      ] as const;
    }),
);

const data = (overrides: Partial<ExpedienteData> = {}): ExpedienteData => ({
  person: {
    nombres: "Ana",
    apellidoPaterno: "López",
    apellidoMaterno: null,
    fechaNacimiento: "1990-04-02",
    fechaIngreso: "2020-03-12",
    curp: "LOPA900402MCSPXN09",
    rfc: null,
    nss: "12345678901",
    sexo: "M",
    estadoCivil: "soltero",
    lugarNacimiento: null,
    nacionalidad: "Mexicana",
    email: "ana@correo.test",
    telefono: null,
    domicilioCalle: "Calle 5",
    domicilioNumeroExterior: "12",
    domicilioNumeroInterior: null,
    domicilioColonia: "Centro",
    domicilioMunicipio: "Tuxtla Gutiérrez",
    domicilioEstado: "Chiapas",
    domicilioCodigoPostal: "29000",
    status: "activa",
  },
  companyName: "Workia Demo",
  accountEmail: "ana@correo.test",
  positionName: "Cajera",
  areaName: null,
  siteName: "Centro",
  manager: { nombres: "Luis", apellidoPaterno: "Pérez", apellidoMaterno: null },
  schedule: null,
  period: { fechaIngreso: "2022-01-10", fechaAntiguedad: "2020-03-12" },
  contract: {
    type: "determinado",
    status: "vigente",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  },
  ...overrides,
});

describe("Mi expediente fields (W2-02)", () => {
  it("every field shown traces to a column in Postgres", () => {
    for (const field of EXPEDIENTE_FIELDS) {
      expect(field.sources.length, field.key).toBeGreaterThan(0);
      for (const source of field.sources) {
        const [table, column] = source.split(".");
        expect(
          columnsByTable.get(table),
          `${field.key}: ${source}`,
        ).toBeDefined();
        expect(
          columnsByTable.get(table)?.has(column),
          `${field.key}: ${source}`,
        ).toBe(true);
      }
    }
  });

  it("the page shows exactly the catalog's fields, each with a value or empty", () => {
    const rows = expedienteSections(data(), "2026-11-04").flatMap(
      (section) => section.rows,
    );

    expect(rows.map((row) => row.key)).toEqual(
      EXPEDIENTE_FIELDS.map((field) => field.key),
    );
  });

  it("has unique keys and correctable fields point at a person form section", () => {
    const keys = EXPEDIENTE_FIELDS.map((field) => field.key);

    expect(new Set(keys).size).toBe(keys.length);
    for (const field of EXPEDIENTE_FIELDS) {
      expect(field.key).toMatch(/^[a-zA-Z]{1,40}$/);
      if ("hr" in field) {
        expect(PERSON_FORM_SECTIONS).toContain(field.hr.section);
      }
    }
  });

  it("computed and contract fields cannot be corrected from the app", () => {
    for (const key of [
      "antiguedad",
      "empresa",
      "accountEmail",
      "contratoTipo",
      "contratoInicio",
      "contratoFin",
    ]) {
      expect(correctableField(key), key).toBeNull();
    }
    expect(correctableField("curp")?.label).toBe("CURP");
    expect(correctableField("salarioDiario")).toBeNull();
    expect(correctableField(undefined)).toBeNull();
  });

  it("reads values from the record, the current period and the vigente contract", () => {
    const values = expedienteValues(data(), "2026-11-04");

    expect(values).toMatchObject({
      nombres: "Ana",
      apellidoMaterno: null,
      sexo: "Mujer",
      estadoCivil: "Soltero(a)",
      domicilio:
        "Calle 5 12, Col. Centro, Tuxtla Gutiérrez, Chiapas, C.P. 29000",
      jefe: "Luis Pérez",
      area: null,
      horario: null,
      contratoTipo: "Determinado · vigente",
    });
    // The current period's ingreso; seniority from the recognized date.
    expect(values.fechaIngreso).toBe("10/01/2022");
    expect(values.antiguedad).toBe("6 años, 7 meses");
    expect(values.contratoFin).toBe("31/12/2026");
  });

  it("falls back to people.fecha_ingreso without periods, and hides the contract section without one", () => {
    const values = expedienteValues(
      data({ period: null, contract: null }),
      "2026-11-04",
    );

    expect(values.fechaIngreso).toBe("12/03/2020");
    expect(values.antiguedad).toBe("6 años, 7 meses");
    expect(
      expedienteSections(data({ contract: null }), "2026-11-04").map(
        (section) => section.group,
      ),
    ).not.toContain("contrato");
  });

  it("never carries contract amounts", () => {
    const sources = EXPEDIENTE_FIELDS.flatMap((field) => [...field.sources]);

    expect(
      sources.filter((source) => /salario|forma_pago|monto/.test(source)),
    ).toEqual([]);
  });
});
