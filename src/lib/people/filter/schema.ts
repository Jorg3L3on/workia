import { z } from "zod";

import {
  MAX_NEXT_DAYS,
  PEOPLE_FILTER_FIELD_IDS,
  PEOPLE_FILTER_FIELDS,
  PEOPLE_FILTER_OPERATORS,
  VALUELESS_OPERATORS,
  type PeopleFilterFieldId,
} from "./fields";

/** Values of one condition (OR among them). */
export const MAX_FILTER_VALUES = 50;
/** Conditions of one filter (AND among them); one per field. */
export const MAX_FILTER_CONDITIONS = PEOPLE_FILTER_FIELD_IDS.length;
export const MAX_FILTER_QUERY_LENGTH = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (value: string) => {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
};

const isoDate = z.string().refine(isIsoDate, "Fecha inválida");

/**
 * One condition: «campo · operador · valor». Within a condition the values
 * are OR («Área es Finanzas o Ventas»); conditions are AND.
 */
export const peopleFilterConditionSchema = z
  .object({
    field: z.enum(PEOPLE_FILTER_FIELD_IDS),
    op: z.enum(PEOPLE_FILTER_OPERATORS),
    values: z
      .array(z.string().min(1).max(64))
      .max(MAX_FILTER_VALUES)
      .optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    days: z.number().int().min(1).max(MAX_NEXT_DAYS).optional(),
    /** Jefe: the whole team below (recursive), not only direct reports. */
    team: z.boolean().optional(),
  })
  .superRefine((condition, ctx) => {
    const field = PEOPLE_FILTER_FIELDS[condition.field];
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });

    if (!field.operators.includes(condition.op)) {
      issue(`${field.label} no admite el operador ${condition.op}`);
      return;
    }

    if (condition.op === "is" || condition.op === "is_not") {
      const values = condition.values ?? [];

      if (values.length === 0) issue("Falta al menos un valor");

      if (field.kind === "enum") {
        const allowed = new Set(field.options?.map((option) => option.value));
        if (values.some((value) => !allowed.has(value)))
          issue("Valor fuera de la lista");
      } else if (field.kind === "ref" || field.kind === "person") {
        if (values.some((value) => !UUID.test(value)))
          issue("Identificador inválido");
      }
    }

    if (condition.op === "between") {
      if (!condition.from || !condition.to) issue("Faltan las dos fechas");
      else if (condition.from > condition.to)
        issue("La fecha inicial es posterior a la final");
    }

    if (
      (condition.op === "before" || condition.op === "after") &&
      !condition.from
    )
      issue("Falta la fecha");

    if (condition.op === "next_days" && !condition.days)
      issue("Faltan los días");

    if (condition.team && field.kind !== "person") issue("Sólo para Jefe");
  });

export type PeopleFilterCondition = z.infer<typeof peopleFilterConditionSchema>;

/**
 * The Personas filter: the search text, which expedientes (vigentes or
 * borrados) and the conditions. Saved views store this object.
 */
export const peopleFilterSchema = z
  .object({
    q: z.string().max(MAX_FILTER_QUERY_LENGTH).default(""),
    deleted: z.boolean().default(false),
    conditions: z
      .array(peopleFilterConditionSchema)
      .max(MAX_FILTER_CONDITIONS)
      .default([]),
  })
  .superRefine((filter, ctx) => {
    const fields = filter.conditions.map((condition) => condition.field);
    if (new Set(fields).size !== fields.length)
      ctx.addIssue({ code: "custom", message: "Un campo aparece dos veces" });
  });

export type PeopleFilter = z.infer<typeof peopleFilterSchema>;

export const EMPTY_PEOPLE_FILTER: PeopleFilter = {
  q: "",
  deleted: false,
  conditions: [],
};

/** The canonical form of a condition: only what its operator uses, values sorted and unique. */
export const normalizeCondition = (
  condition: PeopleFilterCondition,
): PeopleFilterCondition => {
  const base = { field: condition.field, op: condition.op };

  switch (condition.op) {
    case "is":
    case "is_not": {
      const values = [...new Set(condition.values ?? [])].sort();
      return PEOPLE_FILTER_FIELDS[condition.field].kind === "person" &&
        condition.team
        ? { ...base, values, team: true }
        : { ...base, values };
    }
    case "between":
      return { ...base, from: condition.from, to: condition.to };
    case "before":
    case "after":
      return { ...base, from: condition.from };
    case "next_days":
      return { ...base, days: condition.days };
    default:
      return base;
  }
};

/**
 * Validates and normalizes anything that claims to be a filter (a saved
 * view, the URL). Invalid conditions are dropped one by one instead of
 * discarding the whole filter; a repeated field keeps its last condition.
 * Conditions come out in field order, so equal filters serialize equally.
 */
export const coercePeopleFilter = (input: unknown): PeopleFilter => {
  const raw = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const q =
    typeof raw.q === "string"
      ? raw.q.trim().slice(0, MAX_FILTER_QUERY_LENGTH)
      : "";
  const deleted = raw.deleted === true;
  const byField = new Map<PeopleFilterFieldId, PeopleFilterCondition>();

  for (const item of Array.isArray(raw.conditions) ? raw.conditions : []) {
    const parsed = peopleFilterConditionSchema.safeParse(item);
    if (parsed.success) {
      byField.set(parsed.data.field, normalizeCondition(parsed.data));
    }
  }

  return {
    q,
    deleted,
    conditions: PEOPLE_FILTER_FIELD_IDS.flatMap((id) => {
      const condition = byField.get(id);
      return condition ? [condition] : [];
    }),
  };
};

/** True when the filter narrows nothing (all live expedientes). */
export const isEmptyPeopleFilter = (filter: PeopleFilter) =>
  !filter.q && !filter.deleted && filter.conditions.length === 0;

export const conditionFor = (
  filter: PeopleFilter,
  field: PeopleFilterFieldId,
) => filter.conditions.find((condition) => condition.field === field);

/** The filter with `field` replaced by `condition` (or removed with null). */
export const withCondition = (
  filter: PeopleFilter,
  field: PeopleFilterFieldId,
  condition: PeopleFilterCondition | null,
): PeopleFilter =>
  coercePeopleFilter({
    ...filter,
    conditions: [
      ...filter.conditions.filter((item) => item.field !== field),
      ...(condition ? [condition] : []),
    ],
  });

export const isValuelessOperator = (op: PeopleFilterCondition["op"]): boolean =>
  VALUELESS_OPERATORS.includes(op);

/**
 * Drops the conditions on fields the user may not filter by (contract fields
 * without contracts:read). The query applies it again, so a hand-written URL
 * cannot reach them either.
 */
export const restrictPeopleFilter = (
  filter: PeopleFilter,
  permissions: ReadonlySet<string>,
): PeopleFilter => ({
  ...filter,
  conditions: filter.conditions.filter((condition) => {
    const permission = PEOPLE_FILTER_FIELDS[condition.field].permission;
    return !permission || permissions.has(permission);
  }),
});
