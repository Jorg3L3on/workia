import { describe, expect, it } from "vitest";

import { EMPTY_PEOPLE_FILTER, type PeopleFilter } from "./schema";
import {
  MAX_FILTER_PARAM_LENGTH,
  hasPeopleFilterParams,
  parseFilterConditions,
  parsePeopleFilterParams,
  parsePeopleListParams,
  peopleFilterQueryString,
  serializeFilterConditions,
  tokenToUuid,
  uuidToToken,
  writePeopleFilterParams,
} from "./url";

const AREA_A = "0b6f2f8e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const AREA_B = "11111111-2222-4333-8444-555555555555";
const SITE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BOSS = "ffffffff-0000-4000-8000-000000000001";

const filter = (conditions: PeopleFilter["conditions"]): PeopleFilter => ({
  ...EMPTY_PEOPLE_FILTER,
  conditions,
});

describe("uuid tokens", () => {
  it("round-trips a uuid through 22 URL-safe characters", () => {
    for (const uuid of [AREA_A, AREA_B, SITE, BOSS]) {
      const token = uuidToToken(uuid);
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(tokenToUuid(token)).toBe(uuid);
    }
  });

  it("rejects anything that is not a token", () => {
    expect(tokenToUuid("abc")).toBeNull();
    expect(tokenToUuid("!".repeat(22))).toBeNull();
    // The two padding bits must be zero.
    expect(tokenToUuid(`${uuidToToken(AREA_A).slice(0, 21)}B`)).toBeNull();
  });
});

describe("serializeFilterConditions / parseFilterConditions", () => {
  it("writes a compact, versioned parameter that needs no escaping", () => {
    const f = serializeFilterConditions(
      filter([
        { field: "relacion", op: "is", values: ["baja"] },
        { field: "area", op: "is", values: [AREA_B, AREA_A] },
        {
          field: "ingreso",
          op: "between",
          from: "2025-01-01",
          to: "2026-09-30",
        },
        { field: "jefe", op: "is", values: [BOSS], team: true },
        { field: "vence", op: "next_days", days: 30 },
      ]),
    );

    expect(f.startsWith("1*")).toBe(true);
    expect(f).toContain("st.i.baja");
    expect(f).toContain("in.b.20250101.20260930");
    expect(f).toContain(`je.it.${uuidToToken(BOSS)}`);
    expect(f).toContain("ve.n.30");
    expect(encodeURIComponent(f)).toBe(f);
    expect(new URLSearchParams({ f }).toString()).toBe(`f=${f}`);
  });

  it("reads back exactly what it wrote", () => {
    const original = filter([
      { field: "relacion", op: "is_not", values: ["activa"] },
      { field: "region", op: "empty" },
      { field: "area", op: "is", values: [AREA_A, AREA_B] },
      { field: "sucursal", op: "is_not", values: [SITE] },
      { field: "jefe", op: "is_not", values: [BOSS], team: true },
      { field: "ingreso", op: "before", from: "2024-12-31" },
      { field: "contrato", op: "is", values: ["sin_contrato", "vencido"] },
      { field: "tipoContrato", op: "is", values: ["determinado"] },
      { field: "incompletos", op: "is", values: ["curp", "nss"] },
    ]);
    const parsed = parsePeopleFilterParams(
      new URLSearchParams({ f: serializeFilterConditions(original) }),
    );

    expect(parsed).toEqual({
      ...original,
      conditions: [
        { field: "relacion", op: "is_not", values: ["activa"] },
        { field: "region", op: "empty" },
        { field: "area", op: "is", values: [AREA_A, AREA_B] },
        { field: "sucursal", op: "is_not", values: [SITE] },
        { field: "jefe", op: "is_not", values: [BOSS], team: true },
        { field: "ingreso", op: "before", from: "2024-12-31" },
        { field: "tipoContrato", op: "is", values: ["determinado"] },
        { field: "contrato", op: "is", values: ["sin_contrato", "vencido"] },
        { field: "incompletos", op: "is", values: ["curp", "nss"] },
      ],
    });
  });

  it("round-trips the baja and antigüedad fields", () => {
    const original = filter([
      { field: "antiguedad", op: "min_years", years: 15 },
      { field: "baja", op: "between", from: "2026-01-01", to: "2026-06-30" },
      { field: "tipoBaja", op: "is_not", values: ["despido", "otra"] },
      { field: "motivoBaja", op: "is", values: [AREA_A] },
      { field: "recontratable", op: "is", values: ["no"] },
      { field: "revisionBaja", op: "is", values: ["revision", "sin_fecha"] },
    ]);
    const f = serializeFilterConditions(original);

    expect(f).toBe(
      [
        "1",
        "an.ya.15",
        "fb.b.20260101.20260630",
        "tb.x.despido.otra",
        `mb.i.${uuidToToken(AREA_A)}`,
        "rc.i.no",
        "rv.i.revision.sin_fecha",
      ].join("*"),
    );
    expect(encodeURIComponent(f)).toBe(f);
    expect(
      parsePeopleFilterParams(new URLSearchParams({ f })).conditions,
    ).toEqual(original.conditions);

    for (const condition of [
      { field: "antiguedad", op: "max_years", years: 1 },
      { field: "antiguedad", op: "before", from: "2016-10-21" },
      { field: "baja", op: "empty" },
      { field: "baja", op: "after", from: "2026-06-30" },
    ] as const) {
      expect(
        parsePeopleFilterParams(
          new URLSearchParams({
            f: serializeFilterConditions(filter([condition])),
          }),
        ).conditions,
      ).toEqual([condition]);
    }
  });

  it("drops broken years and baja values", () => {
    const parsed = parsePeopleFilterParams(
      new URLSearchParams({
        f: [
          "1",
          "an.ya", // no years
          "an.yb.100", // more than 60
          "fb.n.30", // Fecha de baja has no «próximos N días»
          "tb.i.renuncia", // not a tipo
          "rc.i.tal_vez",
          "mb.i.nope",
        ].join("*"),
      }),
    );
    expect(parsed.conditions).toEqual([]);
  });

  it("is empty without conditions", () => {
    expect(serializeFilterConditions(EMPTY_PEOPLE_FILTER)).toBe("");
  });

  it("ignores another version, unknown parts and broken values", () => {
    expect(parseFilterConditions("2*st.i.baja")).toEqual([]);
    expect(parseFilterConditions(null)).toEqual([]);

    const parsed = parsePeopleFilterParams(
      new URLSearchParams({
        f: [
          "1",
          "zz.i.x", // unknown field
          "st.i.despedida", // not an option
          "ar.i.nope", // not a uuid token
          "in.b.20261301.20261231", // month 13
          "ve.n.9999", // more than a year
          "su.q.x", // unknown operator
          "pu.e",
        ].join("*"),
      }),
    );

    expect(parsed.conditions).toEqual([{ field: "puesto", op: "empty" }]);
  });

  it("refuses an operator the field does not have", () => {
    const parsed = parsePeopleFilterParams(
      new URLSearchParams({ f: "1*ve.i.x*st.b.20260101.20260102" }),
    );
    expect(parsed.conditions).toEqual([]);
  });

  it("drops a range whose start is after its end", () => {
    const parsed = parsePeopleFilterParams(
      new URLSearchParams({ f: "1*in.b.20261231.20260101" }),
    );
    expect(parsed.conditions).toEqual([]);
  });

  it("ignores a parameter longer than the limit", () => {
    const long = `1*${Array.from({ length: 400 }, () => "pu.e").join("*")}`;
    expect(long.length).toBeGreaterThan(MAX_FILTER_PARAM_LENGTH);
    expect(parseFilterConditions(long)).toEqual([]);
  });

  it("keeps the last condition when a field repeats", () => {
    const parsed = parsePeopleFilterParams(
      new URLSearchParams({ f: "1*st.i.activa*st.i.baja" }),
    );
    expect(parsed.conditions).toEqual([
      { field: "relacion", op: "is", values: ["baja"] },
    ]);
  });
});

describe("old URLs", () => {
  it("maps q, status, deleted and region into the filter", () => {
    const parsed = parsePeopleListParams({
      q: " Juan  Pérez ",
      status: "baja",
      deleted: "1",
      region: AREA_A,
      page: "3",
      pageSize: "50",
    });

    expect(parsed.filter).toEqual({
      q: "Juan  Pérez",
      deleted: true,
      conditions: [
        { field: "relacion", op: "is", values: ["baja"] },
        { field: "region", op: "is", values: [AREA_A] },
      ],
    });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(50);
    expect(parsed.hasFilterParams).toBe(true);
  });

  it("ignores old values that were never valid", () => {
    expect(
      parsePeopleFilterParams({ status: "todas", region: "norte" }),
    ).toEqual(EMPTY_PEOPLE_FILTER);
  });

  it("reads the export's area and site", () => {
    expect(
      parsePeopleFilterParams(new URLSearchParams({ area: AREA_A, site: SITE }))
        .conditions,
    ).toEqual([
      { field: "area", op: "is", values: [AREA_A] },
      { field: "sucursal", op: "is", values: [SITE] },
    ]);
  });

  it("lets f win over an old parameter for the same field", () => {
    const f = serializeFilterConditions(
      filter([{ field: "relacion", op: "is", values: ["activa"] }]),
    );
    expect(parsePeopleFilterParams({ status: "baja", f }).conditions).toEqual([
      { field: "relacion", op: "is", values: ["activa"] },
    ]);
  });

  it("falls back to the default paging", () => {
    const parsed = parsePeopleListParams({ page: "-1", pageSize: "7" });
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(25);
    expect(parsed.hasFilterParams).toBe(false);
    expect(parsed.viewId).toBeNull();
  });
});

describe("writePeopleFilterParams", () => {
  it("writes the new parameters and removes the old ones, keeping the rest", () => {
    const params = new URLSearchParams(
      "status=baja&region=x&view=v&cols=rfc&pageSize=50",
    );
    const ok = writePeopleFilterParams(params, {
      q: "ana",
      deleted: false,
      conditions: [{ field: "relacion", op: "is", values: ["baja"] }],
    });

    expect(ok).toBe(true);
    expect(params.get("status")).toBeNull();
    expect(params.get("region")).toBeNull();
    expect(params.get("q")).toBe("ana");
    expect(params.get("f")).toBe("1*st.i.baja");
    expect(params.get("view")).toBe("v");
    expect(params.get("cols")).toBe("rfc");
    expect(params.get("pageSize")).toBe("50");
  });

  it("refuses a filter that does not fit, leaving the URL as it was", () => {
    const many = Array.from(
      { length: 50 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const huge = filter([
      { field: "area", op: "is", values: many },
      { field: "puesto", op: "is", values: many },
    ]);
    const params = new URLSearchParams("q=x");

    expect(writePeopleFilterParams(params, huge)).toBe(false);
    expect(params.toString()).toBe("q=x");
  });

  it("round-trips through a query string (copy the URL to another session)", () => {
    const original: PeopleFilter = {
      q: "Pérez",
      deleted: false,
      conditions: [
        { field: "area", op: "is", values: [AREA_A] },
        { field: "sucursal", op: "is", values: [SITE] },
      ],
    };
    const query = peopleFilterQueryString(original);

    expect(parsePeopleFilterParams(new URLSearchParams(query))).toEqual(
      original,
    );
    expect(hasPeopleFilterParams(new URLSearchParams(query))).toBe(true);
  });
});
