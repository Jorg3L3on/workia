import { describe, expect, it } from "vitest";

import { turnoverFilterSchema } from "./schema";
import {
  parseTurnoverParam,
  presetOf,
  presetRange,
  serializeTurnoverFilter,
} from "./url";

const TODAY = "2026-10-22";
const AREA = "8e1c0c43-0000-4000-8000-000000000001";
const OTHER_AREA = "8e1c0c43-0000-4000-8000-000000000002";
const BOSS = "8e1c0c43-0000-4000-8000-000000000003";

describe("turnover URL", () => {
  it("round-trips a filter through `r`", () => {
    const filter = turnoverFilterSchema.parse({
      from: "2026-01-01",
      to: "2026-03-31",
      areaIds: [AREA, OTHER_AREA],
      managerId: BOSS,
      team: true,
      tipos: ["despido"],
      classifications: ["voluntaria", "otra"],
    });
    const param = serializeTurnoverFilter(filter);

    expect(param).toBe(
      `r1*desde.2026-01-01*hasta.2026-03-31*area.${AREA},${OTHER_AREA}*jefe.${BOSS}*equipo.1*tipo.despido*clase.voluntaria,otra`,
    );
    expect(parseTurnoverParam(param, TODAY)).toEqual(filter);
  });

  it("falls back to the last closed month for no, old or broken links", () => {
    const lastMonth = { from: "2026-09-01", to: "2026-09-30" };

    expect(parseTurnoverParam(undefined, TODAY)).toMatchObject(lastMonth);
    // Personas' version never reads as a report link.
    expect(parseTurnoverParam("1*area.in.x", TODAY)).toMatchObject(lastMonth);
    expect(
      parseTurnoverParam("r1*desde.2026-05-01*hasta.2026-02-01", TODAY),
    ).toMatchObject(lastMonth);
    // A bad id keeps the valid range and drops the rest.
    expect(
      parseTurnoverParam(
        "r1*desde.2026-01-01*hasta.2026-03-31*area.no-es-id",
        TODAY,
      ),
    ).toMatchObject({ from: "2026-01-01", to: "2026-03-31", areaIds: [] });
  });

  it("knows the presets as of today", () => {
    expect(presetRange("mes", TODAY)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(presetRange("trimestre", TODAY)).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    });
    expect(presetRange("trimestre", "2026-09-15")).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    });
    expect(presetRange("anio", TODAY)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
    expect(presetRange("12m", TODAY)).toEqual({
      from: "2025-10-01",
      to: "2026-09-30",
    });
    expect(presetOf({ from: "2025-10-01", to: "2026-09-30" }, TODAY)).toBe(
      "12m",
    );
    expect(presetOf({ from: "2025-10-05", to: "2026-09-30" }, TODAY)).toBe(
      "custom",
    );
  });
});
