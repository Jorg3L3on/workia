import { describe, expect, it } from "vitest";

import { personFormSchema } from "@/lib/people/schema";

describe("personFormSchema", () => {
  it("accepts valid minimum expediente fields", () => {
    const parsed = personFormSchema.safeParse({
      nombres: "Persona",
      apellidoPaterno: "Demo",
      apellidoMaterno: "",
      email: "",
      telefono: "",
      fechaNacimiento: "",
      fechaIngreso: "",
      areaId: "",
      positionId: "",
      managerId: "",
      siteId: "",
      rfc: "",
      curp: "",
      nss: "",
      status: "activa",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects missing names", () => {
    const parsed = personFormSchema.safeParse({
      nombres: "",
      apellidoPaterno: "Demo",
      apellidoMaterno: "",
      email: "",
      telefono: "",
      fechaNacimiento: "",
      fechaIngreso: "",
      areaId: "",
      positionId: "",
      managerId: "",
      siteId: "",
      rfc: "",
      curp: "",
      nss: "",
      status: "activa",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts a complete dummy schedule", () => {
    const parsed = personFormSchema.safeParse({
      nombres: "Persona",
      apellidoPaterno: "Demo",
      apellidoMaterno: "",
      email: "",
      telefono: "",
      fechaNacimiento: "",
      fechaIngreso: "",
      areaId: "",
      positionId: "",
      managerId: "",
      siteId: "",
      rfc: "",
      curp: "",
      nss: "",
      horarioEntrada: "08:00",
      horarioSalidaComer: "13:00",
      horarioRegresoComer: "14:00",
      horarioSalida: "17:00",
      status: "activa",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects an invalid schedule time", () => {
    const parsed = personFormSchema.safeParse({
      nombres: "Persona",
      apellidoPaterno: "Demo",
      apellidoMaterno: "",
      email: "",
      telefono: "",
      fechaNacimiento: "",
      fechaIngreso: "",
      areaId: "",
      positionId: "",
      managerId: "",
      siteId: "",
      rfc: "",
      curp: "",
      nss: "",
      horarioEntrada: "25:99",
      horarioSalidaComer: "",
      horarioRegresoComer: "",
      horarioSalida: "",
      status: "activa",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const parsed = personFormSchema.safeParse({
      nombres: "Persona",
      apellidoPaterno: "Demo",
      apellidoMaterno: "",
      email: "no-es-correo",
      telefono: "",
      fechaNacimiento: "",
      fechaIngreso: "",
      areaId: "",
      positionId: "",
      managerId: "",
      siteId: "",
      rfc: "",
      curp: "",
      nss: "",
      status: "activa",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("people permissions catalog", () => {
  it("includes CRUD slugs for the people resource", async () => {
    const { PERMISSIONS } = await import("@/lib/db/schema/types");
    const slugs = PERMISSIONS.map((permission) => permission.slug);

    expect(slugs).toContain("people:read");
    expect(slugs).toContain("people:create");
    expect(slugs).toContain("people:update");
    expect(slugs).toContain("people:delete");
  });

  it("includes audit and catalog permissions", async () => {
    const { PERMISSIONS } = await import("@/lib/db/schema/types");
    const slugs = PERMISSIONS.map((permission) => permission.slug);

    expect(slugs).toContain("audit:read");
    expect(slugs).toContain("areas:read");
    expect(slugs).toContain("positions:read");
    expect(slugs).toContain("sites:read");
  });
});

describe("personFormSchema identifiers", () => {
  const base = {
    nombres: "Ana",
    apellidoPaterno: "López",
    status: "activa" as const,
  };

  it("normalizes RFC and rejects invalid CURP/NSS", () => {
    const ok = personFormSchema.safeParse({
      ...base,
      rfc: " xaxx 010101 000 ",
    });

    expect(ok.success && ok.data.rfc).toBe("XAXX010101000");

    const bad = personFormSchema.safeParse({
      ...base,
      curp: "NOPE",
      nss: "123",
    });

    expect(bad.success).toBe(false);
  });

  it("accepts blank identifiers", () => {
    expect(
      personFormSchema.safeParse({ ...base, rfc: "", curp: "", nss: "" })
        .success,
    ).toBe(true);
  });
});

describe("expediente México (WRK-I5-1)", () => {
  const base = {
    nombres: "Ana",
    apellidoPaterno: "López",
    status: "activa" as const,
  };

  it("accepts a full Mexican address, civil data, INE and beneficiaries that add up to 100", () => {
    const parsed = personFormSchema.safeParse({
      ...base,
      domicilioCalle: "Av. Central",
      domicilioNumeroExterior: "123",
      domicilioColonia: "Centro",
      domicilioMunicipio: "Tuxtla Gutiérrez",
      domicilioEstado: "Chiapas",
      domicilioCodigoPostal: "29000",
      estadoCivil: "casado",
      sexo: "M",
      lugarNacimiento: "Chiapas",
      nacionalidad: "Mexicana",
      ineClaveElector: "lprzan80010107m100",
      beneficiarios: [
        { nombre: "Hija", parentesco: "Hija", porcentaje: 60 },
        { nombre: "Hijo", parentesco: "Hijo", porcentaje: 40 },
      ],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.ineClaveElector).toBe("LPRZAN80010107M100");
  });

  it.each([
    [{ domicilioCodigoPostal: "2900" }, "domicilioCodigoPostal"],
    [{ domicilioEstado: "Texas" }, "domicilioEstado"],
    [{ estadoCivil: "comprometido" }, "estadoCivil"],
    [{ sexo: "X" }, "sexo"],
    [{ ineClaveElector: "CORTA" }, "ineClaveElector"],
    [
      { beneficiarios: [{ nombre: "A", parentesco: "Hijo", porcentaje: 50 }] },
      "beneficiarios",
    ],
    [
      { beneficiarios: [{ nombre: "", parentesco: "Hijo", porcentaje: 100 }] },
      "beneficiarios",
    ],
  ])("rejects %j", (overrides, field) => {
    const parsed = personFormSchema.safeParse({ ...base, ...overrides });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path[0]).toBe(field);
  });

  it("leaves the México fields out when not sent (they stay as stored)", () => {
    const parsed = personFormSchema.parse(base);

    expect(parsed.domicilioCalle).toBeUndefined();
    expect(parsed.beneficiarios).toBeUndefined();
  });
});
