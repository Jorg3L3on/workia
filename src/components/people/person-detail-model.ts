import type { ReactNode } from "react";

import { renewalStatus, type RenewalUrgency } from "@/lib/contracts/schema";
import { formatDateMx } from "@/lib/format/date";
import type {
  EmploymentPeriodRow,
  EmploymentSummary,
} from "@/lib/people/employment";
import {
  MASKED_AMOUNT,
  finiquitoStatusLabels,
  terminationTypeLabels,
} from "@/lib/people/employment-schema";
import { formatSeniority } from "@/lib/people/seniority";

/**
 * The expediente «Credencial» (WRK iniciativa 4): what each card shows, where
 * its «Editar» lands in the form and what the key-facts strip says. Pure, so
 * the page stays a list of cards and the rules have unit tests.
 */

/** The person form's sections, in form order (`id="seccion-…"`). */
export const PERSON_FORM_SECTIONS = [
  "nombre",
  "empresa",
  "horario",
  "identificadores",
  "datos-mexico",
  "beneficiarios",
] as const;

export type PersonFormSection = (typeof PERSON_FORM_SECTIONS)[number];

export const isPersonFormSection = (
  value: string | undefined,
): value is PersonFormSection =>
  (PERSON_FORM_SECTIONS as readonly string[]).includes(value ?? "");

/** A form control id (`#curp`, `#fechaIngreso`); anything else is ignored. */
export const isPersonFormField = (value: string | undefined): value is string =>
  /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(value ?? "");

/** `?edit=1` opened at a section and, optionally, focused on one field. */
export const personEditHref = (
  personId: string,
  section?: PersonFormSection,
  field?: string,
) => {
  const params = new URLSearchParams({ edit: "1" });

  if (section) params.set("seccion", section);
  if (section && field) params.set("campo", field);

  return `/app/personas/${personId}?${params.toString()}`;
};

/** The cards of the expediente, in page (and chip) order. */
export const DETAIL_CARDS = {
  baja: "Baja",
  identidad: "Identidad",
  laboral: "Laboral",
  vacaciones: "Vacaciones",
  contacto: "Contacto",
  documentos: "Documentos",
  fiscal: "Fiscal e IMSS",
  contrato: "Contrato",
  "datos-mexico": "Datos México",
  resguardo: "Resguardo",
  historial: "Historial",
} as const;

export type DetailCardId = keyof typeof DETAIL_CARDS;

export const detailCardDomId = (id: DetailCardId) => `expediente-${id}`;

/** Initials for the badge avatar: first name and first surname. */
export const personInitials = (person: {
  nombres: string;
  apellidoPaterno: string;
}) =>
  [person.nombres, person.apellidoPaterno]
    .map((part) => part.trim().charAt(0))
    .join("")
    .toLocaleUpperCase("es-MX");

export type DetailField = {
  label: string;
  /** null, undefined, "" and «—» read as not captured. */
  value: ReactNode;
  /** Where the field is edited; without one it is read-only (catalog data). */
  section?: PersonFormSection;
  /** The control to focus in that section. */
  field?: string;
  /** Spans both columns of the card. */
  wide?: boolean;
  testId?: string;
};

const isEmptyValue = (value: ReactNode) =>
  value === null ||
  value === undefined ||
  value === false ||
  (typeof value === "string" && (value.trim() === "" || value === "—")) ||
  (Array.isArray(value) && value.length === 0);

/** Captured fields are listed; the rest go into one «Falta capturar» line. */
export const splitDetailFields = (fields: DetailField[]) => ({
  present: fields.filter((field) => !isEmptyValue(field.value)),
  missing: fields.filter((field) => isEmptyValue(field.value)),
});

export type KeyFact = {
  id: "antiguedad" | "ingreso" | "contrato" | "jefe" | "horario";
  label: string;
  value: string;
  /** A second line (e.g. «vence 30 nov 2026»). */
  hint?: string;
  /** Contract urgency; only the contract fact has one. */
  urgency?: RenewalUrgency | "sin_fin";
  href?: string;
};

/**
 * The date seniority is counted to: today for an active person; for a person
 * on baja, the fecha de baja (today if it is still ahead), or null when the
 * baja has no date.
 */
export const seniorityAsOf = ({
  status,
  fechaBaja,
  today,
}: {
  status: "activa" | "baja";
  fechaBaja: string | null;
  today: string;
}) => {
  if (status !== "baja") return today;
  if (!fechaBaja) return null;

  return fechaBaja < today ? fechaBaja : today;
};

/**
 * Seniority for the strip, from `seniorityDate` (the summary's
 * fechaAntiguedad, or people.fecha_ingreso without periods) to `asOf`
 * (seniorityAsOf). With the current ingreso it says when seniority was
 * recognized from an earlier date; on baja, that it stops at the baja.
 */
export const seniorityFact = ({
  seniorityDate,
  asOf,
  fechaIngreso,
  baja = false,
}: {
  seniorityDate: string | null;
  asOf: string | null;
  fechaIngreso?: string | null;
  baja?: boolean;
}): Pick<KeyFact, "value" | "hint"> => {
  if (!seniorityDate) {
    return { value: "Sin fecha de ingreso" };
  }

  if (!asOf) {
    return { value: "—", hint: "Sin fecha de baja" };
  }

  const hint = [
    fechaIngreso && fechaIngreso !== seniorityDate
      ? `Desde ${formatDateMx(seniorityDate)}`
      : null,
    baja ? `Hasta la baja (${formatDateMx(asOf)})` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    value: formatSeniority(seniorityDate, asOf) ?? "—",
    ...(hint ? { hint } : {}),
  };
};

/** «2.º periodo» (Spanish ordinal, masculine). */
export const periodOrdinal = (index: number) => `${index}.º periodo`;

/**
 * The current period's ingreso; after a rehire, which period it is and
 * whether it carried the previous seniority over.
 */
export const ingresoFact = ({
  fechaIngreso,
  periodCount = 1,
  reconoceAntiguedad = false,
}: {
  fechaIngreso: string | null;
  periodCount?: number;
  reconoceAntiguedad?: boolean;
}): Pick<KeyFact, "value" | "hint"> => ({
  value: fechaIngreso ? formatDateMx(fechaIngreso) : "Sin capturar",
  ...(periodCount > 1
    ? {
        hint: `${periodOrdinal(periodCount)} · ${
          reconoceAntiguedad ? "reconoce antigüedad" : "antigüedad reiniciada"
        }`,
      }
    : {}),
});

const pesos = (value: string) =>
  Number(value).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
  });

/** The finiquito amount: «•••» without compensation:read, always. */
export const finiquitoAmountLabel = (
  monto: string | null,
  canSeeCompensation: boolean,
) => {
  if (!canSeeCompensation) return MASKED_AMOUNT;

  return monto ? pesos(monto) : "Sin monto";
};

const NOT_RECORDED = "Sin registrar";

const recontratableLabel = (value: boolean | null) =>
  value === null ? NOT_RECORDED : value ? "Sí" : "No";

export type BajaDetail = {
  label: string;
  value: string;
  /** A muted line under the value («inferida», what to review). */
  hint?: string;
  /** Spans the whole row. */
  wide?: boolean;
  testId?: string;
};

type BajaPeriod = Pick<
  EmploymentSummary,
  | "fechaBaja"
  | "bajaSinFecha"
  | "fechaBajaInferida"
  | "requiereRevision"
  | "tipoBaja"
  | "motivoBaja"
  | "comentarioBaja"
  | "recontratable"
  | "finiquitoEstado"
  | "finiquitoFecha"
  | "finiquitoMonto"
>;

/**
 * The fecha de baja: «Sin fecha, requiere revisión» when it was never
 * recorded (backfill or a status set outside the baja dialog); a date the
 * backfill took from the audit or the last contract reads «inferida».
 */
export const bajaDateDetail = (period: BajaPeriod): BajaDetail => {
  if (!period.fechaBaja || period.bajaSinFecha) {
    return {
      label: "Fecha de baja",
      value: "Sin fecha, requiere revisión",
      hint: "No se registró al darla de baja. Confírmala en el Historial o en el último contrato.",
      testId: "baja-fecha",
    };
  }

  const hint = [
    period.fechaBajaInferida ? "inferida" : null,
    period.requiereRevision ? "requiere revisión" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    label: "Fecha de baja",
    value: formatDateMx(period.fechaBaja),
    ...(hint ? { hint } : {}),
    testId: "baja-fecha",
  };
};

/**
 * The baja block of the expediente (Iniciativa 2 data): fecha, tipo, motivo,
 * recontratable, finiquito (estado, fecha, monto) and the comentario. The
 * amount is masked without compensation:read.
 */
export const bajaDetails = (
  period: BajaPeriod,
  canSeeCompensation: boolean,
): BajaDetail[] => [
  bajaDateDetail(period),
  {
    label: "Tipo de baja",
    value: period.tipoBaja
      ? terminationTypeLabels[period.tipoBaja]
      : NOT_RECORDED,
  },
  { label: "Motivo", value: period.motivoBaja ?? NOT_RECORDED },
  {
    label: "Recontratable",
    value: recontratableLabel(period.recontratable),
    testId: "baja-recontratable",
  },
  {
    label: "Finiquito",
    value: [
      period.finiquitoEstado
        ? finiquitoStatusLabels[period.finiquitoEstado]
        : NOT_RECORDED,
      period.finiquitoFecha ? formatDateMx(period.finiquitoFecha) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  },
  {
    label: "Monto del finiquito",
    value: finiquitoAmountLabel(period.finiquitoMonto, canSeeCompensation),
    testId: "baja-finiquito-monto",
  },
  ...(period.comentarioBaja?.trim()
    ? [
        {
          label: "Comentario",
          value: period.comentarioBaja.trim(),
          wide: true,
        },
      ]
    : []),
];

export type EmploymentPeriodItem = {
  id: string;
  /** «1.º periodo». */
  label: string;
  /** «12 mar 2020 → 30 jun 2023», «… → en curso», «… → sin fecha». */
  range: string;
  /** Tipo, motivo and finiquito of a closed period; «Periodo actual» of the open one. */
  details: string[];
};

/**
 * «Periodos laborales» of the Laboral card, oldest first (as
 * listEmploymentPeriods returns them). Finiquito amounts only with
 * compensation:read; without it an amount reads «•••».
 */
export const employmentPeriodItems = (
  periods: Pick<
    EmploymentPeriodRow,
    | "id"
    | "fechaIngreso"
    | "fechaBaja"
    | "bajaSinFecha"
    | "tipoBaja"
    | "motivoBaja"
    | "reconoceAntiguedad"
    | "finiquitoEstado"
    | "finiquitoMonto"
  >[],
  canSeeCompensation: boolean,
): EmploymentPeriodItem[] =>
  periods.map((period, index) => {
    const open = period.fechaBaja === null && !period.bajaSinFecha;
    const start = period.fechaIngreso
      ? formatDateMx(period.fechaIngreso)
      : "Sin fecha de ingreso";
    const end = open
      ? "en curso"
      : period.fechaBaja
        ? formatDateMx(period.fechaBaja)
        : "sin fecha";
    const finiquito =
      period.finiquitoEstado || period.finiquitoMonto
        ? [
            `Finiquito${
              period.finiquitoEstado
                ? ` ${finiquitoStatusLabels[period.finiquitoEstado].toLocaleLowerCase("es-MX")}`
                : ""
            }`,
            period.finiquitoMonto
              ? finiquitoAmountLabel(period.finiquitoMonto, canSeeCompensation)
              : null,
          ]
            .filter(Boolean)
            .join(": ")
        : null;

    return {
      id: period.id,
      label: periodOrdinal(index + 1),
      range: `${start} → ${end}`,
      details: [
        open ? "Periodo actual" : null,
        index > 0
          ? period.reconoceAntiguedad
            ? "reconoce antigüedad"
            : "antigüedad reiniciada"
          : null,
        period.tipoBaja ? terminationTypeLabels[period.tipoBaja] : null,
        period.motivoBaja,
        finiquito,
      ].filter((detail): detail is string => Boolean(detail)),
    };
  });

/**
 * The current contract in one line. Takes only type labels and dates, never
 * the contract row, so no compensation can reach the strip.
 */
export const contractFact = (
  vigente: { typeLabel: string; endDate: string | null } | null,
  today: string,
  formatDate: (value: string) => string,
): Pick<KeyFact, "value" | "hint" | "urgency"> => {
  if (!vigente) {
    return { value: "Sin contrato vigente" };
  }

  if (!vigente.endDate) {
    return {
      value: vigente.typeLabel,
      hint: "Sin fecha de fin",
      urgency: "sin_fin",
    };
  }

  const status = renewalStatus(vigente.endDate, today);
  const date = formatDate(vigente.endDate);

  return {
    value: vigente.typeLabel,
    hint:
      status.urgency === "vencido"
        ? `Venció el ${date}`
        : status.urgency === "proximo"
          ? `${status.label.replace(/^En/, "Vence en")} · ${date}`
          : `Vence el ${date}`,
    urgency: status.urgency,
  };
};
