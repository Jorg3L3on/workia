import { describe, expect, it } from "vitest";

import { permissionLabel } from "./labels";

describe("permissionLabel", () => {
  it("names a permission in words", () => {
    expect(permissionLabel("areas:read")).toBe("Leer áreas");
    expect(permissionLabel("mcp_connections:manage")).toBe(
      "Gestionar conexiones",
    );
    expect(permissionLabel("payroll:approve")).toBe("Aprobar altas de Nóminas");
    expect(permissionLabel("reports:read")).toBe("Leer reportes");
    expect(permissionLabel("documents:read")).toBe("Leer documentos");
    expect(permissionLabel("documents:manage")).toBe("Gestionar documentos");
    expect(permissionLabel("vacations:read")).toBe("Leer vacaciones");
    expect(permissionLabel("vacations:create")).toBe("Crear vacaciones");
    expect(permissionLabel("vacations:update")).toBe("Editar vacaciones");
  });

  it("returns an unknown slug unchanged", () => {
    expect(permissionLabel("rockets:launch")).toBe("rockets:launch");
  });
});
