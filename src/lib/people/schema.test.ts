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
