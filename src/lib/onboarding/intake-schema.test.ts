import { describe, expect, it } from "vitest";

import type { PersonFormValues } from "@/lib/people/schema";

import {
  countIntakeFields,
  INTAKE_FIELDS,
  INTAKE_FIELDS_TOTAL,
  INTAKE_REQUIRED_MESSAGE,
  intakeDraftSchema,
  intakeShare,
  intakeSubmitSchema,
  mergeIntakeIntoPerson,
  readIntakeData,
} from "./intake-schema";

/** Every required field, as a new hire would type them. */
const REQUIRED_ONLY = {
  telefono: "55 1234 5678",
  fechaNacimiento: "1995-04-12",
  sexo: "M",
  estadoCivil: "soltero",
  lugarNacimiento: "Jalisco",
  nacionalidad: "Mexicana",
  rfc: "GOMA950412AB1",
  nss: "12345678903",
  ineClaveElector: "GOMRAN95041214M100",
  domicilioCalle: "Av. Juárez",
  domicilioNumeroExterior: "120",
  domicilioColonia: "Centro",
  domicilioMunicipio: "Guadalajara",
  domicilioEstado: "Jalisco",
  domicilioCodigoPostal: "44100",
} as const;

describe("self-service onboarding form (W2-10)", () => {
  it("an alta sent with only the required fields is at least 80 percent the employee's", () => {
    const required = INTAKE_FIELDS.filter((field) => field.required);
    const counted = countIntakeFields(intakeSubmitSchema.parse(REQUIRED_ONLY));

    expect(counted).toEqual({
      filled: required.length,
      total: INTAKE_FIELDS_TOTAL,
    });
    expect(counted.filled / counted.total).toBeGreaterThanOrEqual(0.8);
    expect(intakeShare(counted)).toBe(88);
  });

  it("refuses to send without the required fields, but saves a partial draft", () => {
    const partial = { telefono: "55 1234 5678" };
    expect(intakeDraftSchema.safeParse(partial).success).toBe(true);

    const sent = intakeSubmitSchema.safeParse(partial);
    expect(sent.success).toBe(false);
    const missing = sent.error!.issues.map((issue) => issue.path[0]);
    expect(missing).toContain("rfc");
    expect(missing).not.toContain("telefono");
    expect(missing).not.toContain("domicilioNumeroInterior");
    expect(sent.error!.issues[0]!.message).toBe(INTAKE_REQUIRED_MESSAGE);
  });

  it("checks each value with the person form's rules", () => {
    const bad = intakeDraftSchema.safeParse({
      rfc: "NOPE",
      domicilioCodigoPostal: "123",
      ineClaveElector: "corta",
    });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((issue) => issue.path[0]).sort()).toEqual([
      "domicilioCodigoPostal",
      "ineClaveElector",
      "rfc",
    ]);
  });

  it("refuses fields HR keeps, such as CURP or salary", () => {
    expect(intakeDraftSchema.safeParse({ curp: "X" }).success).toBe(false);
    expect(intakeDraftSchema.safeParse({ positionId: "x" }).success).toBe(
      false,
    );
  });

  it("beneficiaries must add up to 100 and count as one field", () => {
    expect(
      intakeDraftSchema.safeParse({
        beneficiarios: [{ nombre: "Ana", parentesco: "Madre", porcentaje: 60 }],
      }).success,
    ).toBe(false);

    const withBeneficiaries = intakeSubmitSchema.parse({
      ...REQUIRED_ONLY,
      beneficiarios: [
        { nombre: "Ana", parentesco: "Madre", porcentaje: "60" },
        { nombre: "Luis", parentesco: "Hermano", porcentaje: "40" },
      ],
    });
    expect(countIntakeFields(withBeneficiaries).filled).toBe(
      INTAKE_FIELDS.filter((field) => field.required).length + 1,
    );
  });

  it("reads stored data back, dropping keys and values that no longer validate", () => {
    expect(
      readIntakeData({ telefono: "55", rfc: "NOPE", salario: 1000 }),
    ).toEqual({ telefono: "55" });
    expect(readIntakeData(null)).toEqual({});
  });

  it("merges over the stored record: empty fields keep HR's value", () => {
    const stored = {
      nombres: "Ana",
      apellidoPaterno: "Gómez",
      curp: "GOMA950412MJCMRN09",
      telefono: "33 0000 0000",
      domicilioNumeroInterior: "4B",
      status: "activa",
    } as unknown as PersonFormValues;
    const merged = mergeIntakeIntoPerson(stored, {
      telefono: "55 1234 5678",
      domicilioCalle: "Av. Juárez",
    });

    expect(merged).toMatchObject({
      nombres: "Ana",
      curp: "GOMA950412MJCMRN09",
      telefono: "55 1234 5678",
      domicilioCalle: "Av. Juárez",
      domicilioNumeroInterior: "4B",
    });
    expect(merged.beneficiarios).toBeUndefined();
  });
});
