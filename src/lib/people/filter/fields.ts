/**
 * The fields of the Personas filter (Iniciativa 3). Shared by the server
 * (query, URL) and the client (chips, sheet): no database code here.
 *
 * Adding a field:
 *   1. add its id to PEOPLE_FILTER_FIELD_IDS and a definition to
 *      PEOPLE_FILTER_FIELDS (URL key, label, kind, operators, permission);
 *   2. add its SQL to FIELD_SQL in ./query.ts (TypeScript fails until you do);
 *   3. for a «ref» field, give the page its options (PeopleFilterOptions).
 * The URL format, the zod schema, the chips and the sheet follow the kind.
 */

import type { PermissionSlug } from "@/lib/db/schema/types";
import {
  TERMINATION_TYPES,
  terminationTypeLabels,
} from "@/lib/people/employment-schema";

/** How a value is picked and encoded in the URL. */
export type PeopleFilterFieldKind =
  /** A closed list of options defined here (Relación, Tipo de contrato). */
  | "enum"
  /** Catalog rows of the company, by uuid (Área, Puesto, Sucursal, Región). */
  | "ref"
  /** People of the company, by uuid (Jefe). */
  | "person"
  /** A calendar date column (Fecha de ingreso). */
  | "date"
  /** «en los próximos N días» only (Vence contrato). */
  | "days"
  /** Antigüedad: years completed, or the seniority date itself. */
  | "seniority";

export const PEOPLE_FILTER_OPERATORS = [
  "is",
  "is_not",
  "between",
  "before",
  "after",
  "empty",
  "not_empty",
  "next_days",
  "min_years",
  "max_years",
] as const;

export type PeopleFilterOperator = (typeof PEOPLE_FILTER_OPERATORS)[number];

export const peopleFilterOperatorLabels: Record<PeopleFilterOperator, string> =
  {
    is: "es",
    is_not: "no es",
    between: "entre",
    before: "antes de",
    after: "después de",
    empty: "está vacío",
    not_empty: "no está vacío",
    next_days: "en los próximos",
    min_years: "al menos",
    max_years: "menos de",
  };

/** Operators that take no value: the chip reads «Área · está vacío». */
export const VALUELESS_OPERATORS: readonly PeopleFilterOperator[] = [
  "empty",
  "not_empty",
];

export const PEOPLE_FILTER_FIELD_IDS = [
  "relacion",
  "region",
  "area",
  "puesto",
  "sucursal",
  "jefe",
  "ingreso",
  "antiguedad",
  "baja",
  "tipoBaja",
  "motivoBaja",
  "recontratable",
  "revisionBaja",
  "tipoContrato",
  "contrato",
  "vence",
  "incompletos",
] as const;

export type PeopleFilterFieldId = (typeof PEOPLE_FILTER_FIELD_IDS)[number];

export type PeopleFilterEnumOption = { value: string; label: string };

export type PeopleFilterFieldDefinition = {
  id: PeopleFilterFieldId;
  /** Two lowercase letters in the `f` URL parameter; never reuse one. */
  urlKey: string;
  label: string;
  kind: PeopleFilterFieldKind;
  /** The first one is the default when the field is added. */
  operators: readonly PeopleFilterOperator[];
  /** Only for «enum»: the options, in display order. */
  options?: readonly PeopleFilterEnumOption[];
  /** Without it the field is dropped from the filter on the server. */
  permission?: PermissionSlug;
  /** Section of the mobile sheet. */
  section: "persona" | "organizacion" | "baja" | "contrato";
  /** The editor shows the number of people per option. */
  counts?: boolean;
};

export const PEOPLE_FILTER_FIELDS: Record<
  PeopleFilterFieldId,
  PeopleFilterFieldDefinition
> = {
  relacion: {
    id: "relacion",
    urlKey: "st",
    label: "Relación",
    kind: "enum",
    operators: ["is", "is_not"],
    options: [
      { value: "activa", label: "Activas" },
      { value: "baja", label: "Bajas" },
    ],
    section: "persona",
    counts: true,
  },
  region: {
    id: "region",
    urlKey: "rg",
    label: "Región",
    kind: "ref",
    operators: ["is", "is_not", "empty", "not_empty"],
    section: "organizacion",
    counts: true,
  },
  area: {
    id: "area",
    urlKey: "ar",
    label: "Área",
    kind: "ref",
    operators: ["is", "is_not", "empty", "not_empty"],
    section: "organizacion",
    counts: true,
  },
  puesto: {
    id: "puesto",
    urlKey: "pu",
    label: "Puesto",
    kind: "ref",
    operators: ["is", "is_not", "empty", "not_empty"],
    section: "organizacion",
    counts: true,
  },
  sucursal: {
    id: "sucursal",
    urlKey: "su",
    label: "Sucursal",
    kind: "ref",
    operators: ["is", "is_not", "empty", "not_empty"],
    section: "organizacion",
    counts: true,
  },
  jefe: {
    id: "jefe",
    urlKey: "je",
    label: "Jefe directo",
    kind: "person",
    operators: ["is", "is_not", "empty", "not_empty"],
    section: "organizacion",
  },
  ingreso: {
    id: "ingreso",
    urlKey: "in",
    label: "Fecha de ingreso",
    kind: "date",
    operators: ["between", "before", "after", "empty", "not_empty"],
    section: "persona",
  },
  // Antigüedad counts from the stored fecha_antiguedad of the current (or
  // last) employment period (people.fecha_ingreso without one), the date the
  // constancia and the export use. «al menos N años» / «menos de N años»
  // split everyone in two by years completed (a baja counts up to its fecha
  // de baja); the dates find who counts from before or after a day.
  antiguedad: {
    id: "antiguedad",
    urlKey: "an",
    label: "Antigüedad",
    kind: "seniority",
    operators: ["min_years", "max_years", "between", "before", "after"],
    section: "persona",
  },
  // The baja fields read the current (or last) employment period, the one
  // the columns show. Any condition on Fecha de baja implies Relación = Baja.
  baja: {
    id: "baja",
    urlKey: "fb",
    label: "Fecha de baja",
    kind: "date",
    operators: ["between", "before", "after", "empty", "not_empty"],
    section: "baja",
  },
  tipoBaja: {
    id: "tipoBaja",
    urlKey: "tb",
    label: "Tipo de baja",
    kind: "enum",
    operators: ["is", "is_not"],
    options: TERMINATION_TYPES.map((value) => ({
      value,
      label: terminationTypeLabels[value],
    })),
    section: "baja",
    counts: true,
  },
  motivoBaja: {
    id: "motivoBaja",
    urlKey: "mb",
    label: "Motivo de baja",
    kind: "ref",
    operators: ["is", "is_not"],
    section: "baja",
    counts: true,
  },
  recontratable: {
    id: "recontratable",
    urlKey: "rc",
    label: "Recontratable",
    kind: "enum",
    operators: ["is"],
    options: [
      { value: "si", label: "Sí" },
      { value: "no", label: "No" },
    ],
    section: "baja",
    counts: true,
  },
  // Clean-up of the backfill: any period of the person, not only the last.
  revisionBaja: {
    id: "revisionBaja",
    urlKey: "rv",
    label: "Por revisar",
    kind: "enum",
    operators: ["is"],
    options: [
      { value: "sin_fecha", label: "Baja sin fecha" },
      { value: "inferida", label: "Fecha de baja inferida" },
      { value: "revision", label: "Requiere revisión" },
    ],
    section: "baja",
    counts: true,
  },
  tipoContrato: {
    id: "tipoContrato",
    urlKey: "tc",
    label: "Tipo de contrato",
    kind: "enum",
    operators: ["is", "is_not"],
    options: [
      { value: "determinado", label: "Determinado" },
      { value: "indeterminado", label: "Indeterminado" },
    ],
    permission: "contracts:read",
    section: "contrato",
  },
  contrato: {
    id: "contrato",
    urlKey: "ce",
    label: "Contrato",
    kind: "enum",
    operators: ["is", "is_not"],
    options: [
      { value: "vigente", label: "Vigente" },
      { value: "vencido", label: "Vencido" },
      { value: "sin_contrato", label: "Sin contrato" },
    ],
    permission: "contracts:read",
    section: "contrato",
  },
  vence: {
    id: "vence",
    urlKey: "ve",
    label: "Vence contrato",
    kind: "days",
    operators: ["next_days"],
    permission: "contracts:read",
    section: "contrato",
  },
  incompletos: {
    id: "incompletos",
    urlKey: "di",
    label: "Datos incompletos",
    kind: "enum",
    operators: ["is"],
    options: [
      { value: "curp", label: "Sin CURP" },
      { value: "nss", label: "Sin NSS" },
      { value: "rfc", label: "Sin RFC" },
    ],
    section: "persona",
    counts: true,
  },
};

export const PEOPLE_FILTER_FIELD_LIST = PEOPLE_FILTER_FIELD_IDS.map(
  (id) => PEOPLE_FILTER_FIELDS[id],
);

export const peopleFilterFieldByUrlKey = new Map(
  PEOPLE_FILTER_FIELD_LIST.map((field) => [field.urlKey, field]),
);

/** Presets of «Vence contrato» in the editor and the sheet. */
export const VENCE_PRESET_DAYS = [30, 60, 90] as const;

/** Upper bound of «en los próximos N días». */
export const MAX_NEXT_DAYS = 365;

/** Presets of «Antigüedad · al menos / menos de N años». */
export const SENIORITY_PRESET_YEARS = [1, 5, 10, 15] as const;

/** Upper bound of «N años» of Antigüedad. */
export const MAX_SENIORITY_YEARS = 60;

/**
 * Fields a user may filter by: those without a permission, plus those whose
 * permission the user has. The server applies the same rule (see query.ts).
 */
export const allowedPeopleFilterFields = (permissions: ReadonlySet<string>) =>
  PEOPLE_FILTER_FIELD_LIST.filter(
    (field) => !field.permission || permissions.has(field.permission),
  );
