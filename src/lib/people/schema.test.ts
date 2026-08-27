import { describe, expect, it } from "vitest";

import { personFormSchema } from "@/lib/people/schema";

describe("personFormSchema", () => {
  it("accepts valid minimum expediente fields", () => {
    const parsed = personFormSchema.safeParse({
      givenName: "Persona",
      familyName: "Demo",
      email: "",
      status: "activa",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects missing names", () => {
    const parsed = personFormSchema.safeParse({
      givenName: "",
      familyName: "Demo",
      email: "",
      status: "activa",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const parsed = personFormSchema.safeParse({
      givenName: "Persona",
      familyName: "Demo",
      email: "no-es-correo",
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
});
