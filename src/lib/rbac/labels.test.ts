import { describe, expect, it } from "vitest";

import { permissionLabel } from "./labels";

describe("permissionLabel", () => {
  it("names a permission in words", () => {
    expect(permissionLabel("areas:read")).toBe("Leer áreas");
    expect(permissionLabel("mcp_connections:manage")).toBe(
      "Gestionar conexiones",
    );
    expect(permissionLabel("payroll:approve")).toBe("Aprobar altas de Nóminas");
  });

  it("returns an unknown slug unchanged", () => {
    expect(permissionLabel("rockets:launch")).toBe("rockets:launch");
  });
});
