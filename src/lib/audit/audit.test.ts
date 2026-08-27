import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    DATABASE_URL:
      "postgresql://user:password@localhost:5432/workia?sslmode=disable",
    AUTH_SECRET: "ci-auth-secret-with-at-least-32-characters",
    NODE_ENV: "test",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {},
}));

describe("audit append-only surface", () => {
  it("exposes insert and list helpers only", async () => {
    const auditModule = await import("@/lib/audit");
    const exportedKeys = Object.keys(auditModule).sort();

    expect(exportedKeys).toEqual([
      "buildChanges",
      "listAuditEvents",
      "recordAuditEvent",
      "snapshotArea",
      "snapshotPerson",
      "snapshotPosition",
      "snapshotSite",
    ]);
  });

  it("does not expose mutation helpers for audit events", async () => {
    const auditModule = await import("@/lib/audit");

    expect("updateAuditEvent" in auditModule).toBe(false);
    expect("deleteAuditEvent" in auditModule).toBe(false);
    expect("softDeleteAuditEvent" in auditModule).toBe(false);
  });
});

describe("audit permissions catalog", () => {
  it("includes audit read permission", async () => {
    const { PERMISSIONS } = await import("@/lib/db/schema/types");
    const slugs = PERMISSIONS.map((permission) => permission.slug);

    expect(slugs).toContain("audit:read");
    expect(slugs).not.toContain("audit:update");
    expect(slugs).not.toContain("audit:delete");
  });
});

describe("buildChanges", () => {
  it("captures RFC before/after for person edits", async () => {
    const { buildChanges } = await import("@/lib/audit");

    const changes = buildChanges(
      { rfc: null, nombres: "Persona" },
      { rfc: "XAXX010101000", nombres: "Persona" },
      ["rfc", "nombres"],
    );

    expect(changes.rfc).toEqual({ from: null, to: "XAXX010101000" });
    expect(changes.nombres).toBeUndefined();
  });
});
