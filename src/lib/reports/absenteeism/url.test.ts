import { describe, expect, it } from "vitest";

import { absenteeismFilterSchema } from "./schema";
import {
  absenteeismHref,
  parseAbsenteeismParam,
  serializeAbsenteeismFilter,
} from "./url";

const TODAY = "2026-11-04";
const SITE = "00000000-0000-4000-8000-0000000000b1";
const REGION = "00000000-0000-4000-8000-0000000000a1";

describe("absenteeism report URL", () => {
  it("defaults to the last closed month", () => {
    expect(parseAbsenteeismParam(undefined, TODAY)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      regionIds: [],
      siteIds: [],
    });
  });

  it("round-trips a filter", () => {
    const filter = absenteeismFilterSchema.parse({
      from: "2026-01-01",
      to: "2026-06-30",
      regionIds: [REGION],
      siteIds: [SITE],
    });
    const param = serializeAbsenteeismFilter(filter);

    expect(param).toBe(
      `a1*desde.2026-01-01*hasta.2026-06-30*region.${REGION}*sucursal.${SITE}`,
    );
    expect(parseAbsenteeismParam(param, TODAY)).toEqual(filter);
    expect(absenteeismHref(filter)).toBe(`/app/reportes/ausentismo?a=${param}`);
  });

  it("keeps the range when an id is invalid, and falls back on other versions", () => {
    expect(
      parseAbsenteeismParam(
        "a1*desde.2026-02-01*hasta.2026-02-28*sucursal.x",
        TODAY,
      ),
    ).toMatchObject({ from: "2026-02-01", to: "2026-02-28", siteIds: [] });
    expect(parseAbsenteeismParam("r1*desde.2026-02-01", TODAY).from).toBe(
      "2026-10-01",
    );
  });

  it("refuses a range longer than the attendance aggregates read", () => {
    expect(
      absenteeismFilterSchema.safeParse({
        from: "2025-01-01",
        to: "2026-03-01",
      }).success,
    ).toBe(false);
    expect(
      parseAbsenteeismParam("a1*desde.2025-01-01*hasta.2026-03-01", TODAY).from,
    ).toBe("2026-10-01");
  });
});
