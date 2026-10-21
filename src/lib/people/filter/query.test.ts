import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { canSeePeopleColumn, coercePeopleColumns } from "./columns";
import { PEOPLE_FILTER_FIELD_IDS, PEOPLE_FILTER_FIELDS } from "./fields";
import { buildPeopleWhere, peopleFilterContext, TEAM_MAX_DEPTH } from "./query";
import {
  coercePeopleFilter,
  EMPTY_PEOPLE_FILTER,
  restrictPeopleFilter,
  withCondition,
  type PeopleFilter,
} from "./schema";

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const AREA = "a0000000-0000-4000-8000-000000000001";
const BOSS = "b0000000-0000-4000-8000-000000000001";
const TODAY = "2026-10-21";
const dialect = new PgDialect();

const render = (filter: PeopleFilter, permissions: string[] = []) =>
  dialect.sqlToQuery(
    buildPeopleWhere(
      COMPANY,
      filter,
      peopleFilterContext(new Set(permissions), TODAY),
    ),
  );

describe("buildPeopleWhere", () => {
  it("always scopes by company and live expedientes", () => {
    const { sql, params } = render(EMPTY_PEOPLE_FILTER);
    expect(sql).toContain('"people"."company_id" = $1');
    expect(sql).toContain('"people"."deleted_at" is null');
    expect(params[0]).toBe(COMPANY);
  });

  it("shows only borrados when asked", () => {
    expect(render({ ...EMPTY_PEOPLE_FILTER, deleted: true }).sql).toContain(
      '"people"."deleted_at" is not null',
    );
  });

  it("searches word by word, escaping wildcards, like the list", () => {
    const { sql, params } = render({
      ...EMPTY_PEOPLE_FILTER,
      q: "Juan 100%",
    });
    expect(sql.match(/ilike/g)).toHaveLength(2);
    expect(params).toContain("%Juan%");
    expect(params).toContain("%100\\%%");
  });

  it("ignores contract fields without contracts:read", () => {
    const filter = coercePeopleFilter({
      conditions: [
        { field: "contrato", op: "is", values: ["vigente"] },
        { field: "vence", op: "next_days", days: 30 },
        { field: "tipoContrato", op: "is", values: ["determinado"] },
      ],
    });

    expect(render(filter).sql).not.toContain("contracts");
    expect(render(filter, ["contracts:read"]).sql).toContain(
      "from contracts c",
    );
  });

  it("walks the team with a capped, cycle-safe recursive query only when asked", () => {
    const direct = render(
      coercePeopleFilter({
        conditions: [{ field: "jefe", op: "is", values: [BOSS] }],
      }),
    );
    expect(direct.sql).not.toContain("recursive");
    expect(direct.sql).toContain('"people"."manager_id" in');

    const team = render(
      coercePeopleFilter({
        conditions: [{ field: "jefe", op: "is", values: [BOSS], team: true }],
      }),
    );
    expect(team.sql).toContain("with recursive team");
    expect(team.sql).toContain("not p.id = any(t.path)");
    expect(team.params).toContain(TEAM_MAX_DEPTH);
    // Both levels of the recursion stay in the company.
    expect(team.params.filter((param) => param === COMPANY)).toHaveLength(3);
  });

  it("ANDs fields and ORs the values of one field", () => {
    const { sql } = render(
      coercePeopleFilter({
        conditions: [
          { field: "area", op: "is", values: [AREA, BOSS] },
          { field: "incompletos", op: "is", values: ["curp", "rfc"] },
        ],
      }),
    );
    expect(sql).toContain('"people"."area_id" in ($');
    expect(sql).toMatch(
      /coalesce\("people"\."curp", ''\) = '' or coalesce\("people"\."rfc", ''\) = ''/,
    );
  });

  it("can leave one field out (option counts)", () => {
    const filter = coercePeopleFilter({
      conditions: [
        { field: "area", op: "is", values: [AREA] },
        { field: "relacion", op: "is", values: ["baja"] },
      ],
    });
    const { sql } = dialect.sqlToQuery(
      buildPeopleWhere(COMPANY, filter, peopleFilterContext(new Set(), TODAY), {
        omit: "area",
      }),
    );
    expect(sql).not.toContain("area_id");
    expect(sql).toContain('"people"."status"');
  });

  it("has SQL for every registered field", () => {
    for (const id of PEOPLE_FILTER_FIELD_IDS) {
      const field = PEOPLE_FILTER_FIELDS[id];
      const op = field.operators[0];
      const condition =
        op === "is" || op === "is_not"
          ? {
              field: id,
              op,
              values:
                field.kind === "enum" ? [field.options![0].value] : [AREA],
            }
          : op === "between"
            ? { field: id, op, from: "2026-01-01", to: "2026-02-01" }
            : op === "next_days"
              ? { field: id, op, days: 30 }
              : op === "min_years" || op === "max_years"
                ? { field: id, op, years: 5 }
                : { field: id, op };
      const filter = coercePeopleFilter({ conditions: [condition] });
      expect(filter.conditions, id).toHaveLength(1);
      const base = render(EMPTY_PEOPLE_FILTER).sql;
      expect(render(filter, ["contracts:read"]).sql.length, id).toBeGreaterThan(
        base.length,
      );
    }
  });
});

describe("baja and antigüedad fields", () => {
  const one = (condition: unknown) =>
    render(coercePeopleFilter({ conditions: [condition] }));

  it("any condition on Fecha de baja implies Relación = Baja", () => {
    for (const condition of [
      { field: "baja", op: "between", from: "2026-01-01", to: "2026-06-30" },
      { field: "baja", op: "before", from: "2026-01-01" },
      { field: "baja", op: "after", from: "2026-01-01" },
      { field: "baja", op: "empty" },
      { field: "baja", op: "not_empty" },
    ]) {
      const { sql, params } = one(condition);
      expect(sql, condition.op).toContain('"people"."status" = $');
      expect(params, condition.op).toContain("baja");
    }
  });

  it("a fecha de baja range reads the current period and starts from (company_id, fecha_baja)", () => {
    const { sql, params } = one({
      field: "baja",
      op: "between",
      from: "2026-01-01",
      to: "2026-06-30",
    });
    expect(sql).toContain(
      "in (select ep.person_id from employment_periods ep where ep.company_id = $",
    );
    expect(sql).toContain(
      "order by (e.fecha_baja is null and not e.baja_sin_fecha) desc, e.fecha_ingreso desc nulls last, e.created_at desc",
    );
    expect(sql).toContain("ep.fecha_baja between");
    // Every subquery is scoped by the company.
    expect(params.filter((param) => param === COMPANY).length).toBe(3);
  });

  it("tipo, motivo and recontratable read the current period of the company", () => {
    const motivo = one({ field: "motivoBaja", op: "is", values: [AREA] });
    expect(motivo.sql).toContain("e.company_id = $");
    expect(motivo.sql).toContain("ep.motivo_baja_id in ($");
    expect(motivo.params).toContain(AREA);
    expect(motivo.params).toContain(COMPANY);

    expect(
      one({ field: "motivoBaja", op: "is_not", values: [AREA] }).sql,
    ).toContain("not exists (select 1 from");
    expect(
      one({ field: "tipoBaja", op: "is", values: ["despido"] }).sql,
    ).toContain("ep.tipo_baja::text in ($");

    const both = one({
      field: "recontratable",
      op: "is",
      values: ["si", "no"],
    });
    expect(both.sql).toContain("(ep.recontratable or not ep.recontratable)");
    expect(
      one({ field: "recontratable", op: "is", values: ["no"] }).sql,
    ).toContain("not ep.recontratable");
  });

  it("por revisar looks at every period of the person", () => {
    const { sql } = one({
      field: "revisionBaja",
      op: "is",
      values: ["sin_fecha", "revision"],
    });
    expect(sql).toContain("e.baja_sin_fecha");
    expect(sql).toContain("e.requiere_revision");
    expect(sql).not.toContain("limit 1");
  });

  it("antigüedad counts years from the stored seniority date, up to the baja", () => {
    const { sql, params } = one({
      field: "antiguedad",
      op: "min_years",
      years: 5,
    });
    expect(sql).toContain("coalesce((select ep.fecha_antiguedad from");
    expect(sql).toContain('"people"."fecha_ingreso")');
    expect(sql).toContain("make_interval(years => $");
    expect(sql).toContain("least(coalesce(");
    expect(sql).toMatch(/\) <= \(\(case when/);
    expect(params).toContain(5);
    expect(params).toContain(TODAY);

    expect(one({ field: "antiguedad", op: "max_years", years: 1 }).sql).toMatch(
      /\) > \(\(case when/,
    );
    expect(
      one({
        field: "antiguedad",
        op: "between",
        from: "2020-01-01",
        to: "2020-12-31",
      }).sql,
    ).toContain('"people"."fecha_ingreso") between $');
  });

  it("rejects years outside 1–60 and keeps only the years", () => {
    expect(
      coercePeopleFilter({
        conditions: [{ field: "antiguedad", op: "min_years", years: 0 }],
      }).conditions,
    ).toEqual([]);
    expect(
      coercePeopleFilter({
        conditions: [{ field: "antiguedad", op: "min_years" }],
      }).conditions,
    ).toEqual([]);
    expect(
      coercePeopleFilter({
        conditions: [
          {
            field: "antiguedad",
            op: "max_years",
            years: 3,
            from: "2020-01-01",
          },
        ],
      }).conditions,
    ).toEqual([{ field: "antiguedad", op: "max_years", years: 3 }]);
    // Years belong to Antigüedad only.
    expect(
      coercePeopleFilter({
        conditions: [{ field: "ingreso", op: "min_years", years: 3 }],
      }).conditions,
    ).toEqual([]);
  });
});

describe("filter helpers", () => {
  it("restricts permission-bound fields", () => {
    const filter = coercePeopleFilter({
      conditions: [
        { field: "area", op: "empty" },
        { field: "vence", op: "next_days", days: 30 },
      ],
    });
    expect(restrictPeopleFilter(filter, new Set()).conditions).toEqual([
      { field: "area", op: "empty" },
    ]);
  });

  it("replaces one field's condition and keeps field order", () => {
    const filter = withCondition(
      coercePeopleFilter({
        conditions: [{ field: "relacion", op: "is", values: ["baja"] }],
      }),
      "area",
      { field: "area", op: "is", values: [AREA, AREA] },
    );
    expect(filter.conditions).toEqual([
      { field: "relacion", op: "is", values: ["baja"] },
      { field: "area", op: "is", values: [AREA] },
    ]);
    expect(withCondition(filter, "relacion", null).conditions).toHaveLength(1);
  });

  it("drops arguments the operator does not use", () => {
    expect(
      coercePeopleFilter({
        conditions: [
          { field: "area", op: "empty", values: [AREA], from: "2026-01-01" },
        ],
      }).conditions,
    ).toEqual([{ field: "area", op: "empty" }]);
  });

  it("filters columns by permission and drops unknown ones", () => {
    const none = new Set<string>();
    const contractsOnly = new Set(["contracts:read"]);
    const payroll = new Set(["contracts:read", "compensation:read"]);

    expect(
      coercePeopleColumns("rfc.salarioDiario.nada.rfc.finContrato", none),
    ).toEqual(["rfc"]);
    expect(
      coercePeopleColumns(["salarioMensual", "finContrato"], contractsOnly),
    ).toEqual(["finContrato"]);
    expect(
      coercePeopleColumns(["salarioMensual", "finContrato"], payroll),
    ).toEqual(["salarioMensual", "finContrato"]);
    expect(canSeePeopleColumn("salarioDiario", contractsOnly)).toBe(false);
  });

  it("shows the baja columns to everyone and the finiquito amount only with compensation:read", () => {
    const baja = [
      "fechaBaja",
      "tipoBaja",
      "motivoBaja",
      "recontratable",
      "fechaAntiguedad",
      "antiguedad",
    ] as const;

    expect(coercePeopleColumns([...baja, "finiquitoMonto"], new Set())).toEqual(
      baja,
    );
    expect(
      coercePeopleColumns(
        "fechaBaja.finiquitoMonto",
        new Set(["contracts:read"]),
      ),
    ).toEqual(["fechaBaja"]);
    // The amount is payroll, not contract data: compensation:read alone is enough.
    expect(
      coercePeopleColumns(["finiquitoMonto"], new Set(["compensation:read"])),
    ).toEqual(["finiquitoMonto"]);
  });
});
