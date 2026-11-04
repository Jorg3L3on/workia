import { describe, expect, it } from "vitest";

import {
  canCancel,
  decidedHref,
  decidedNotice,
  parseDecision,
  parseRequestInput,
  REQUEST_COPY,
  workingDaysInRange,
} from "./rules";

const today = "2026-11-04";

describe("parseRequestInput", () => {
  const base = {
    kind: "vacaciones",
    startDate: "2026-11-10",
    endDate: "2026-11-12",
    days: "3",
  };

  it("accepts a request and stores days in half steps", () => {
    expect(parseRequestInput({ ...base, days: "2,5" }, today)).toEqual({
      ok: true,
      value: {
        kind: "vacaciones",
        startDate: "2026-11-10",
        endDate: "2026-11-12",
        days: "2.5",
        halves: 5,
        note: null,
      },
    });
  });

  it.each([
    [{ kind: "home_office" }, REQUEST_COPY.kind],
    [{ startDate: "2026-02-30" }, REQUEST_COPY.startDate],
    [{ endDate: "" }, REQUEST_COPY.endDate],
    [{ endDate: "2026-11-09" }, REQUEST_COPY.endBeforeStart],
    [{ startDate: "2026-11-03" }, REQUEST_COPY.past],
    [{ endDate: "2027-03-01" }, REQUEST_COPY.tooLong],
    [{ days: "0" }, REQUEST_COPY.days],
    [{ days: "1.3" }, REQUEST_COPY.days],
    [{ days: "4" }, REQUEST_COPY.daysOverRange],
    [{ note: "x".repeat(281) }, REQUEST_COPY.note],
  ])("refuses %o", (change, error) => {
    expect(parseRequestInput({ ...base, ...change }, today)).toEqual({
      ok: false,
      error,
    });
  });
});

describe("workingDaysInRange", () => {
  it("skips the rest day", () => {
    // 2026-11-09 is a Monday; the week has one Sunday.
    expect(workingDaysInRange("2026-11-09", "2026-11-15", "dom")).toBe(6);
    expect(workingDaysInRange("2026-11-09", "2026-11-15", null)).toBe(7);
    expect(workingDaysInRange("2026-11-15", "2026-11-15", "dom")).toBe(0);
  });
});

describe("decisions", () => {
  it("needs a reason to reject", () => {
    expect(parseDecision("reject", "  ")).toEqual({
      ok: false,
      error: REQUEST_COPY.reasonRequired,
    });
    expect(parseDecision("approve", "")).toEqual({
      ok: true,
      decision: "approve",
      reason: null,
    });
    expect(parseDecision("maybe", "")).toEqual({
      ok: false,
      error: REQUEST_COPY.decision,
    });
  });

  it("round-trips what was decided through the list's URL", () => {
    const form = new FormData();
    form.set("decision", "approve");
    const href = decidedHref("/mi/equipo/aprobaciones", form, "warning");
    expect(href).toBe("/mi/equipo/aprobaciones?decidida=aprobada&exceso=1");
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(decidedNotice(params)).toContain("Solicitud aprobada.");
    expect(decidedNotice({ decidida: "rechazada" })).toBe(
      "Solicitud rechazada.",
    );
    expect(decidedNotice({})).toBeNull();
  });
});

describe("canCancel", () => {
  it("allows a pending request, and an approved one before its first day", () => {
    expect(canCancel({ status: "pending", startDate: today }, today)).toBe(
      true,
    );
    expect(
      canCancel({ status: "approved", startDate: "2026-11-05" }, today),
    ).toBe(true);
    expect(canCancel({ status: "approved", startDate: today }, today)).toBe(
      false,
    );
    expect(
      canCancel({ status: "rejected", startDate: "2026-12-01" }, today),
    ).toBe(false);
  });
});
