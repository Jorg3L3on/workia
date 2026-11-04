import { describe, expect, it } from "vitest";

import {
  dayInstant,
  employmentChangeFromAudit,
  incidenciaEvent,
  receiptEvent,
} from "./events";

const audit = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  resourceType: "person",
  resourceId: "p1",
  action: "update",
  source: "mcp",
  occurredAt: new Date("2026-05-04T16:00:00Z"),
  payload: {
    changes: {
      positionId: { from: "old", to: "new" },
      telefono: { from: null, to: "55" },
    },
  },
  ...overrides,
});

describe("timeline events", () => {
  it("puts a calendar day at noon in central Mexico", () => {
    expect(dayInstant("2026-01-10").toISOString()).toBe(
      "2026-01-10T18:00:00.000Z",
    );
  });

  it("maps a person audit event that moves a dimension to a «cambio»", () => {
    expect(employmentChangeFromAudit(audit())).toEqual({
      personId: "p1",
      type: "employment",
      occurredAt: new Date("2026-05-04T16:00:00Z"),
      source: "mcp",
      dedupeKey: "employment:audit:a1",
      payload: { kind: "cambio", position_id: "new", from_position_id: "old" },
    });
  });

  it("ignores audit events that move nothing, or are not about a person", () => {
    expect(
      employmentChangeFromAudit(
        audit({ payload: { changes: { telefono: { from: null, to: "1" } } } }),
      ),
    ).toBeNull();
    expect(
      employmentChangeFromAudit(audit({ resourceType: "site" })),
    ).toBeNull();
    expect(employmentChangeFromAudit(audit({ action: "create" }))).toBeNull();
    expect(employmentChangeFromAudit(audit({ payload: null }))).toBeNull();
  });

  it("keys receipts by CFDI UUID and incidencias by period, day and kind", () => {
    expect(
      receiptEvent({
        personId: "p1",
        cfdiUuid: "ABC",
        period: "2026-11-1",
        deliveredAt: new Date("2026-11-15T12:00:00Z"),
        source: "payroll",
      }).dedupeKey,
    ).toBe("receipt:cfdi:abc");
    expect(
      incidenciaEvent({
        personId: "p1",
        day: "2026-11-03",
        kind: "retardo",
        period: "2026-11-Q1",
        minutes: 7,
        source: "engine",
      }),
    ).toMatchObject({
      dedupeKey: "incidencia:2026-11-Q1:2026-11-03:retardo",
      payload: { minutes: 7, justified: false },
    });
  });
});
