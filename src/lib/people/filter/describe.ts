/**
 * Words for the Personas filter: what a chip reads («Área · es cualquiera de
 * · Finanzas, Ventas») and the calendar shortcuts. Pure, for the client.
 */

import { formatDateMx } from "@/lib/format/date";

import {
  PEOPLE_FILTER_FIELDS,
  peopleFilterOperatorLabels,
  type PeopleFilterEnumOption,
  type PeopleFilterFieldDefinition,
  type PeopleFilterFieldId,
} from "./fields";
import type { PeopleFilterCondition } from "./schema";

export type PeopleFilterOption = PeopleFilterEnumOption;

/**
 * Options of the «ref» and «person» fields, from the page: the company's
 * catalogs, and the names of the people already picked as Jefe.
 */
export type PeopleFilterOptions = Partial<
  Record<PeopleFilterFieldId, PeopleFilterOption[]>
>;

export const optionsForField = (
  field: PeopleFilterFieldDefinition,
  options: PeopleFilterOptions,
): PeopleFilterOption[] =>
  field.kind === "enum"
    ? [...(field.options ?? [])]
    : (options[field.id] ?? []);

const UNKNOWN_VALUE = "Valor desconocido";

const listLabel = (labels: string[]) =>
  labels.length <= 2
    ? labels.join(", ")
    : `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;

/** The three parts of a chip. */
export const describeCondition = (
  condition: PeopleFilterCondition,
  options: PeopleFilterOptions,
) => {
  const field = PEOPLE_FILTER_FIELDS[condition.field];
  const values = condition.values ?? [];
  let operator = peopleFilterOperatorLabels[condition.op];
  let value = "";

  if (condition.op === "is" || condition.op === "is_not") {
    const byValue = new Map(
      optionsForField(field, options).map((option) => [
        option.value,
        option.label,
      ]),
    );

    if (values.length > 1) {
      operator =
        condition.op === "is" ? "es cualquiera de" : "no es ninguno de";
    }

    value = listLabel(values.map((item) => byValue.get(item) ?? UNKNOWN_VALUE));

    if (condition.team) value += " y su equipo";
  } else if (condition.op === "between") {
    value = `${formatDateMx(condition.from)} – ${formatDateMx(condition.to)}`;
  } else if (condition.op === "before" || condition.op === "after") {
    value = formatDateMx(condition.from);
  } else if (condition.op === "next_days") {
    value = condition.days === 1 ? "1 día" : `${condition.days} días`;
  }

  return { field: field.label, operator, value };
};

/** «Relación: Bajas» — the accessible name of a chip. */
export const conditionAriaLabel = (
  condition: PeopleFilterCondition,
  options: PeopleFilterOptions,
) => {
  const { field, operator, value } = describeCondition(condition, options);
  return condition.op === "is" && value
    ? `${field}: ${value}`
    : `${field}: ${[operator, value].filter(Boolean).join(" ")}`;
};

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day));

export type DateRangePreset = {
  id: "este_mes" | "mes_pasado" | "este_anio" | "ultimos_90";
  label: string;
  from: string;
  to: string;
};

/** Este mes, mes pasado, este año y últimos 90 días, counted from `today` (ISO). */
export const dateRangePresets = (today: string): DateRangePreset[] => {
  const [year, month, day] = today.split("-").map(Number);
  const m = month - 1;

  return [
    {
      id: "este_mes",
      label: "Este mes",
      from: iso(utc(year, m, 1)),
      to: iso(utc(year, m + 1, 0)),
    },
    {
      id: "mes_pasado",
      label: "Mes pasado",
      from: iso(utc(year, m - 1, 1)),
      to: iso(utc(year, m, 0)),
    },
    {
      id: "este_anio",
      label: "Este año",
      from: `${year}-01-01`,
      to: `${year}-12-31`,
    },
    {
      id: "ultimos_90",
      label: "Últimos 90 días",
      from: iso(utc(year, m, day - 89)),
      to: today,
    },
  ];
};
