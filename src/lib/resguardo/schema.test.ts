import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "@/lib/db/schema/types";
import {
  assetFormSchema,
  assetMovementTypeLabels,
  assetStatusLabels,
  assignAssetFormSchema,
  formatAssetDate,
  returnAssetFormSchema,
} from "@/lib/resguardo/schema";

describe("resguardo schema", () => {
  it("validates identifiable asset registration in Spanish", () => {
    const parsed = assetFormSchema.safeParse({
      name: "Laptop demo",
      identifier: "SERIE-001",
      category: "laptop",
      tracksHistory: true,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects asset without identifier", () => {
    const parsed = assetFormSchema.safeParse({
      name: "Laptop demo",
      identifier: "",
      category: "laptop",
      tracksHistory: true,
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/identificador/i);
  });

  it("validates entrega and devolución forms", () => {
    const assign = assignAssetFormSchema.safeParse({
      assetId: "11111111-1111-4111-8111-111111111111",
      personId: "22222222-2222-4222-8222-222222222222",
      movementDate: "2026-01-15",
      conditionNote: "Buen estado",
    });

    const returnForm = returnAssetFormSchema.safeParse({
      assetId: "11111111-1111-4111-8111-111111111111",
      movementDate: "2026-02-01",
      conditionNote: "Rayón leve",
    });

    expect(assign.success).toBe(true);
    expect(returnForm.success).toBe(true);
  });

  it("uses Spanish labels for status and movement types", () => {
    expect(assetStatusLabels.disponible).toBe("En almacén");
    expect(assetStatusLabels.asignado).toBe("Asignado");
    expect(assetMovementTypeLabels.entrega).toBe("Entrega");
    expect(assetMovementTypeLabels.devolucion).toBe("Devolución");
  });

  it("formats asset dates for display", () => {
    expect(formatAssetDate("2026-03-15")).toBe("15/03/2026");
    expect(formatAssetDate(null)).toBe("—");
  });
});

describe("resguardo RBAC catalog", () => {
  it("includes assets permissions", () => {
    const slugs = PERMISSIONS.map((permission) => permission.slug);

    expect(slugs).toContain("assets:read");
    expect(slugs).toContain("assets:create");
    expect(slugs).toContain("assets:update");
    expect(slugs).toContain("assets:delete");
  });
});
