import type { ReactNode } from "react";

import { renewalStatus, type RenewalUrgency } from "@/lib/contracts/schema";
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
  contacto: "Contacto",
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
 * Seniority for the strip. `asOf` is today for an active person; a person on
 * baja has no end date yet (iniciativa 2 adds it), so it reads «Sin fecha».
 * `seniorityDate` is the hire date today and the recognised seniority date
 * once employment periods exist.
 */
export const seniorityFact = ({
  seniorityDate,
  asOf,
}: {
  seniorityDate: string | null;
  asOf: string | null;
}): Pick<KeyFact, "value" | "hint"> => {
  if (!seniorityDate) {
    return { value: "Sin fecha de ingreso" };
  }

  if (!asOf) {
    return { value: "—", hint: "Sin fecha de baja" };
  }

  return { value: formatSeniority(seniorityDate, asOf) ?? "—" };
};

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
