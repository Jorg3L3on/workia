import { describe, expect, it } from "vitest";

import {
  conditionAriaLabel,
  dateRangePresets,
  describeCondition,
} from "./describe";

const AREA = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";
const THIRD = "a0000000-0000-4000-8000-000000000003";
const options = {
  area: [
    { value: AREA, label: "Finanzas" },
    { value: OTHER, label: "Ventas" },
    { value: THIRD, label: "Almacén" },
  ],
  jefe: [{ value: AREA, label: "Óscar Valdez" }],
};

describe("describeCondition", () => {
  it("reads one value as «es» and several as «es cualquiera de»", () => {
    expect(
      describeCondition({ field: "area", op: "is", values: [AREA] }, options),
    ).toEqual({ field: "Área", operator: "es", value: "Finanzas" });
    expect(
      describeCondition(
        { field: "area", op: "is", values: [AREA, OTHER, THIRD] },
        options,
      ),
    ).toEqual({
      field: "Área",
      operator: "es cualquiera de",
      value: "Finanzas, Ventas +1",
    });
  });

  it("names enum options, dates, days and the team", () => {
    expect(
      describeCondition(
        { field: "relacion", op: "is", values: ["baja"] },
        options,
      ).value,
    ).toBe("Bajas");
    expect(
      describeCondition(
        {
          field: "ingreso",
          op: "between",
          from: "2026-01-01",
          to: "2026-06-30",
        },
        options,
      ).value,
    ).toBe("01/01/2026 – 30/06/2026");
    expect(
      describeCondition({ field: "vence", op: "next_days", days: 30 }, options),
    ).toEqual({
      field: "Vence contrato",
      operator: "en los próximos",
      value: "30 días",
    });
    expect(
      describeCondition(
        { field: "jefe", op: "is", values: [AREA], team: true },
        options,
      ).value,
    ).toBe("Óscar Valdez y su equipo");
    expect(
      describeCondition({ field: "area", op: "is", values: [OTHER] }, {}).value,
    ).toBe("Valor desconocido");
  });

  it("names the baja fields and the years of antigüedad", () => {
    expect(
      describeCondition(
        { field: "antiguedad", op: "min_years", years: 5 },
        options,
      ),
    ).toEqual({ field: "Antigüedad", operator: "al menos", value: "5 años" });
    expect(
      describeCondition(
        { field: "antiguedad", op: "max_years", years: 1 },
        options,
      ),
    ).toEqual({ field: "Antigüedad", operator: "menos de", value: "1 año" });
    expect(
      describeCondition(
        { field: "tipoBaja", op: "is", values: ["termino_contrato"] },
        options,
      ).value,
    ).toBe("Término de contrato");
    expect(
      describeCondition(
        { field: "motivoBaja", op: "is", values: [AREA] },
        { motivoBaja: [{ value: AREA, label: "Renuncia voluntaria" }] },
      ),
    ).toEqual({
      field: "Motivo de baja",
      operator: "es",
      value: "Renuncia voluntaria",
    });
    expect(
      conditionAriaLabel(
        { field: "recontratable", op: "is", values: ["no"] },
        options,
      ),
    ).toBe("Recontratable: No");
    expect(
      conditionAriaLabel(
        { field: "baja", op: "between", from: "2026-01-01", to: "2026-06-30" },
        options,
      ),
    ).toBe("Fecha de baja: entre 01/01/2026 – 30/06/2026");
  });

  it("gives chips the accessible names of the old filters", () => {
    expect(
      conditionAriaLabel(
        { field: "relacion", op: "is", values: ["baja"] },
        options,
      ),
    ).toBe("Relación: Bajas");
    expect(conditionAriaLabel({ field: "area", op: "empty" }, options)).toBe(
      "Área: está vacío",
    );
  });
});

describe("dateRangePresets", () => {
  it("counts months and the year from today", () => {
    const presets = Object.fromEntries(
      dateRangePresets("2026-03-15").map((preset) => [preset.id, preset]),
    );
    expect(presets.este_mes).toMatchObject({
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(presets.mes_pasado).toMatchObject({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(presets.este_anio).toMatchObject({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(presets.ultimos_90).toMatchObject({
      from: "2025-12-16",
      to: "2026-03-15",
    });
  });

  it("crosses the year in January", () => {
    const [, pasado] = dateRangePresets("2026-01-10");
    expect(pasado).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });
});
