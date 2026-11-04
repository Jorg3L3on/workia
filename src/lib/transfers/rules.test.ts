import { describe, expect, it } from "vitest";

import { sampleCurp } from "@/lib/people/identity";

import { decodeTimelineCursor, encodeTimelineCursor } from "./cursor";
import { describeGroupEvent } from "./describe";
import { curpsMatch, dayBefore } from "./rules";

describe("curpsMatch", () => {
  it("matches the same valid CURP, ignoring case and spaces", () => {
    const curp = sampleCurp(42);
    expect(curpsMatch(curp, ` ${curp.toLowerCase()} `)).toBe(true);
  });

  it("refuses different, blank or invalid CURPs", () => {
    expect(curpsMatch(sampleCurp(1), sampleCurp(2))).toBe(false);
    expect(curpsMatch(null, null)).toBe(false);
    expect(curpsMatch("ABC", "ABC")).toBe(false);
  });
});

describe("dayBefore", () => {
  it("crosses months and leap days", () => {
    expect(dayBefore("2026-11-16")).toBe("2026-11-15");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2028-03-01")).toBe("2028-02-29");
    expect(dayBefore("2027-01-01")).toBe("2026-12-31");
  });
});

describe("timeline cursor", () => {
  it("round-trips and refuses anything else", () => {
    const cursor = {
      occurredAt: new Date("2026-11-16T18:00:00.000Z"),
      id: "6f1c1a7e-8b0e-4d7a-9a8e-2b8c7f1d0a11",
    };
    expect(decodeTimelineCursor(encodeTimelineCursor(cursor))).toEqual(cursor);
    expect(decodeTimelineCursor("x~y")).toBeNull();
    expect(decodeTimelineCursor(undefined)).toBeNull();
  });
});

describe("describeGroupEvent", () => {
  const names = new Map([["c1", "Comercial del Norte"]]);

  it("names the other company of a transfer, or keeps it generic", () => {
    expect(
      describeGroupEvent(
        {
          type: "employment",
          payload: { kind: "transfer", direction: "out", to_company_id: "c1" },
        },
        names,
      ),
    ).toBe("Se traslada a Comercial del Norte");
    expect(
      describeGroupEvent(
        {
          type: "employment",
          payload: { kind: "transfer", direction: "in", from_company_id: "c9" },
        },
        names,
      ),
    ).toBe("Llega por traslado desde otra empresa del grupo");
  });

  it("describes bajas, vacations and attendance", () => {
    expect(
      describeGroupEvent(
        { type: "employment", payload: { kind: "baja", tipo: "traslado" } },
        names,
      ),
    ).toBe("Baja · Traslado a otra empresa del grupo");
    expect(
      describeGroupEvent(
        { type: "vacation", payload: { kind: "enjoyment", days: 3 } },
        names,
      ),
    ).toBe("Vacaciones disfrutadas · 3 días");
    expect(
      describeGroupEvent(
        {
          type: "attendance",
          payload: {
            punches: [
              [1, "in"],
              [2, "out"],
            ],
          },
        },
        names,
      ),
    ).toBe("Asistencia · 2 checadas");
  });
});
