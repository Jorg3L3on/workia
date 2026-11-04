import { describe, expect, it } from "vitest";

import { incidenciasInForce, todayStatus } from "./today-status";

const incidencia = (payload: Record<string, unknown>, id = "x") => ({
  id,
  occurredAt: "2026-11-04T18:00:00Z",
  payload,
});

describe("todayStatus (W2-17)", () => {
  it("reads the last punch: an entry is on shift, an exit left", () => {
    expect(
      todayStatus({
        attendance: { punches: [["2026-11-04T14:00:00Z", "in"]] },
        incidencias: [],
      }),
    ).toMatchObject({
      status: "on_shift",
      firstIn: "2026-11-04T14:00:00Z",
      lastOut: null,
    });
    expect(
      todayStatus({
        attendance: {
          punches: [
            ["2026-11-04T14:00:00Z", "in"],
            ["2026-11-04T23:00:00Z", "out"],
          ],
        },
        incidencias: [],
      }).status,
    ).toBe("left");
  });

  it("is pending with nothing, and absent with a falta in force", () => {
    expect(todayStatus({ attendance: null, incidencias: [] }).status).toBe(
      "pending",
    );
    expect(
      todayStatus({
        attendance: null,
        incidencias: [incidencia({ kind: "falta" })],
      }).status,
    ).toBe("absent");
  });

  it("applies corrections: the highest rev wins and voided cancels", () => {
    expect(
      incidenciasInForce([
        incidencia({ kind: "retardo", minutes: 20 }, "a"),
        incidencia({ kind: "retardo", minutes: 5, rev: 2 }, "b"),
        incidencia({ kind: "falta" }, "c"),
        incidencia({ kind: "falta", rev: 1, voided: true }, "d"),
      ]),
    ).toEqual([{ kind: "retardo", minutes: 5, justified: false }]);
  });
});
