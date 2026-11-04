import { quincenaRange } from "@/lib/pay-periods/quincena";
import { formatPersonName } from "@/lib/people/schema";

import {
  emptyTotals,
  IDENTIFIER_FIELDS,
  isConcept,
  PRENOMINA_CONCEPT_LABELS,
  PRENOMINA_CONCEPTS,
  type PersonField,
  type PrenominaConcept,
  type PrenominaDateFormat,
  type PrenominaTemplateConfig,
  type PrenominaTotals,
} from "./template";

/**
 * From the close snapshot to the rows of the pre-nómina file (W2-18). Pure,
 * so the file is a function of the frozen snapshot, the people and the
 * template, and the tests check it without a database.
 */

/** One row of incidencias_period_snapshot, as readPeriodSnapshot gives it. */
export type SnapshotRowInput = {
  personId: string;
  kind: string;
  count: number;
  justified: number;
  minutes: number;
  justifiedMinutes: number;
  justifiedVacation: number;
  justifiedPermisoConGoce: number;
  justifiedPermisoSinGoce: number;
  justifiedIncapacidad: number;
};

/**
 * Per person, what payroll counts. A falta not justified is a falta; a
 * justified one counts under what justified it (vacation, permiso,
 * incapacidad) and the rest are HR overrides. A justified retardo or salida
 * anticipada does not count, nor do its minutes. Voided incidencias never
 * reached the snapshot.
 */
export const totalsFromSnapshot = (rows: readonly SnapshotRowInput[]) => {
  const byPerson = new Map<string, PrenominaTotals>();

  for (const row of rows) {
    const totals = byPerson.get(row.personId) ?? emptyTotals();
    const unjustified = row.count - row.justified;

    switch (row.kind) {
      case "falta": {
        const bySource =
          row.justifiedVacation +
          row.justifiedPermisoConGoce +
          row.justifiedPermisoSinGoce +
          row.justifiedIncapacidad;

        totals.faltas += unjustified;
        totals.vacaciones += row.justifiedVacation;
        totals.permisos_con_goce += row.justifiedPermisoConGoce;
        totals.permisos_sin_goce += row.justifiedPermisoSinGoce;
        totals.incapacidades += row.justifiedIncapacidad;
        totals.faltas_justificadas_rh += Math.max(row.justified - bySource, 0);
        break;
      }
      case "retardo":
        totals.retardos += unjustified;
        totals.minutos_retardo += Math.max(
          row.minutes - row.justifiedMinutes,
          0,
        );
        break;
      case "salida_anticipada":
        totals.salidas_anticipadas += unjustified;
        totals.minutos_salida += Math.max(
          row.minutes - row.justifiedMinutes,
          0,
        );
        break;
      default:
        // A kind the file has no concept for yet: not counted.
        continue;
    }

    byPerson.set(row.personId, totals);
  }

  return byPerson;
};

/** Every person added up: the summary of the company's quincena. */
export const sumTotals = (totals: Iterable<PrenominaTotals>) => {
  const sum = emptyTotals();

  for (const item of totals) {
    for (const concept of PRENOMINA_CONCEPTS) {
      sum[concept] += item[concept];
    }
  }

  return sum;
};

export type PrenominaPerson = {
  id: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  curp: string | null;
  rfc: string | null;
  nss: string | null;
  /** The person's checador number(s), joined by a space when more than one. */
  checador: string | null;
  sucursal: string | null;
};

export type PrenominaPeriod = { period: string; revision: number };

export type Cell = string | number;

export const formatDate = (iso: string, format: PrenominaDateFormat) => {
  const [year, month, day] = iso.split("-");

  switch (format) {
    case "iso":
      return iso;
    case "dmy":
      return `${day}/${month}/${year}`;
    case "dmy_dash":
      return `${day}-${month}-${year}`;
    case "ymd_compact":
      return `${year}${month}${day}`;
  }
};

/** 2026-01-Q1 is 1, 2026-12-Q2 is 24: the period number providers ask for. */
export const periodNumber = (period: string) => {
  const month = Number(period.slice(5, 7));

  return (month - 1) * 2 + (period.endsWith("Q2") ? 2 : 1);
};

const personValue = (person: PrenominaPerson, field: PersonField): string => {
  switch (field) {
    case "workia_id":
      return person.id;
    case "curp":
      return person.curp ?? "";
    case "rfc":
      return person.rfc ?? "";
    case "nss":
      return person.nss ?? "";
    case "nombre_completo":
      return formatPersonName(person);
    case "apellido_paterno":
      return person.apellidoPaterno;
    case "apellido_materno":
      return person.apellidoMaterno ?? "";
    case "nombres":
      return person.nombres;
    case "checador":
      return person.checador ?? "";
    case "sucursal":
      return person.sucursal ?? "";
  }
};

export const comparePeople = (a: PrenominaPerson, b: PrenominaPerson) =>
  a.apellidoPaterno.localeCompare(b.apellidoPaterno, "es-MX") ||
  (a.apellidoMaterno ?? "").localeCompare(b.apellidoMaterno ?? "", "es-MX") ||
  a.nombres.localeCompare(b.nombres, "es-MX") ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export type PrenominaSheet = {
  header: string[] | null;
  rows: Cell[][];
  /** People in the file. */
  people: number;
  /** Identifier columns of the template that some person in the file lacks. */
  missing: Array<{ field: PersonField; people: number }>;
};

/**
 * The rows of the file. "wide": one row per person, in name order, a person
 * whose selected concepts are all 0 left out when skipEmpty. "long": one row
 * per person and concept with a code and a value other than 0, in the
 * template's concept order.
 */
export const buildPrenominaSheet = (
  template: PrenominaTemplateConfig,
  period: PrenominaPeriod,
  people: readonly PrenominaPerson[],
  totals: ReadonlyMap<string, PrenominaTotals>,
): PrenominaSheet => {
  const range = quincenaRange(period.period);
  const fixed = (
    field: string,
    person: PrenominaPerson,
    value: string | undefined,
  ): Cell => {
    switch (field) {
      case "periodo":
        return period.period;
      case "numero_periodo":
        return periodNumber(period.period);
      case "fecha_inicio":
        return formatDate(range.from, template.dateFormat);
      case "fecha_fin":
        return formatDate(range.to, template.dateFormat);
      case "constante":
        return value ?? "";
      default:
        return personValue(person, field as PersonField);
    }
  };
  const wideConcepts = template.columns
    .map((column) => column.field)
    .filter(isConcept);
  const longConcepts = PRENOMINA_CONCEPTS.filter(
    (concept) => template.conceptCodes[concept],
  );
  const rows: Cell[][] = [];
  const inFile: PrenominaPerson[] = [];

  for (const person of [...people].sort(comparePeople)) {
    const values = totals.get(person.id) ?? emptyTotals();

    if (template.layout === "wide") {
      if (
        template.skipEmpty &&
        wideConcepts.every((concept) => values[concept] === 0)
      ) {
        continue;
      }

      rows.push(
        template.columns.map((column) =>
          isConcept(column.field)
            ? values[column.field]
            : fixed(column.field, person, column.value),
        ),
      );
      inFile.push(person);
      continue;
    }

    const emitted = longConcepts.filter(
      (concept: PrenominaConcept) => values[concept] !== 0,
    );

    for (const concept of emitted) {
      rows.push(
        template.columns.map((column) => {
          switch (column.field) {
            case "concepto":
              return template.conceptCodes[concept] ?? "";
            case "concepto_nombre":
              return PRENOMINA_CONCEPT_LABELS[concept];
            case "cantidad":
              return values[concept];
            default:
              return fixed(column.field, person, column.value);
          }
        }),
      );
    }

    if (emitted.length > 0) inFile.push(person);
  }

  const identifiers = [
    ...new Set(
      template.columns
        .map((column) => column.field)
        .filter((field): field is PersonField =>
          (IDENTIFIER_FIELDS as readonly string[]).includes(field),
        ),
    ),
  ];

  return {
    header: template.includeHeader
      ? template.columns.map(
          (column) => column.header || column.field.toUpperCase(),
        )
      : null,
    rows,
    people: inFile.length,
    missing: identifiers
      .map((field) => ({
        field,
        people: inFile.filter((person) => personValue(person, field) === "")
          .length,
      }))
      .filter((item) => item.people > 0),
  };
};
