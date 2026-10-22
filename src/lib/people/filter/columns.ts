/**
 * Columns of the Personas list and of «Exportar (N)». A view stores the ids
 * of its visible columns; who reads it only gets the ones they may see
 * (contract columns need contracts:read, payroll ones compensation:read:
 * salaries with contracts:read too, the finiquito amount alone), whatever the
 * view's owner saved.
 */

import type { PermissionSlug } from "@/lib/db/schema/types";

export const PEOPLE_COLUMN_IDS = [
  "rfc",
  "curp",
  "nss",
  "email",
  "telefono",
  "ingreso",
  "area",
  "puesto",
  "sucursal",
  "region",
  "jefe",
  "relacion",
  "tipoContrato",
  "finContrato",
  "salarioDiario",
  "salarioMensual",
  "fechaBaja",
  "tipoBaja",
  "motivoBaja",
  "recontratable",
  "fechaAntiguedad",
  "antiguedad",
  "finiquitoMonto",
] as const;

export type PeopleColumnId = (typeof PEOPLE_COLUMN_IDS)[number];

export type PeopleColumnDefinition = {
  id: PeopleColumnId;
  label: string;
  /** Every one of them is needed to see (and export) the column. */
  permissions?: readonly PermissionSlug[];
  /** Payroll data: masked everywhere without compensation:read. */
  payroll?: boolean;
  /** An ISO date (yyyy-mm-dd): shown and exported as dd/mm/aaaa. */
  date?: boolean;
};

export const PEOPLE_COLUMNS: Record<PeopleColumnId, PeopleColumnDefinition> = {
  rfc: { id: "rfc", label: "RFC" },
  curp: { id: "curp", label: "CURP" },
  nss: { id: "nss", label: "NSS" },
  email: { id: "email", label: "Correo electrónico" },
  telefono: { id: "telefono", label: "Teléfono" },
  ingreso: { id: "ingreso", label: "Ingreso", date: true },
  area: { id: "area", label: "Área" },
  puesto: { id: "puesto", label: "Puesto" },
  sucursal: { id: "sucursal", label: "Sucursal" },
  region: { id: "region", label: "Región" },
  jefe: { id: "jefe", label: "Jefe directo" },
  relacion: { id: "relacion", label: "Relación" },
  tipoContrato: {
    id: "tipoContrato",
    label: "Tipo de contrato",
    permissions: ["contracts:read"],
  },
  finContrato: {
    id: "finContrato",
    label: "Fin de contrato",
    permissions: ["contracts:read"],
    date: true,
  },
  salarioDiario: {
    id: "salarioDiario",
    label: "Salario diario",
    permissions: ["contracts:read", "compensation:read"],
    payroll: true,
  },
  salarioMensual: {
    id: "salarioMensual",
    label: "Salario mensual",
    permissions: ["contracts:read", "compensation:read"],
    payroll: true,
  },
  // Baja (Iniciativa 2): the current or last employment period.
  fechaBaja: { id: "fechaBaja", label: "Fecha de baja", date: true },
  tipoBaja: { id: "tipoBaja", label: "Tipo de baja" },
  motivoBaja: { id: "motivoBaja", label: "Motivo de baja" },
  recontratable: { id: "recontratable", label: "Recontratable" },
  fechaAntiguedad: {
    id: "fechaAntiguedad",
    label: "Fecha de antigüedad",
    date: true,
  },
  antiguedad: { id: "antiguedad", label: "Antigüedad" },
  finiquitoMonto: {
    id: "finiquitoMonto",
    label: "Finiquito (monto)",
    permissions: ["compensation:read"],
    payroll: true,
  },
};

/** What the list showed before views existed. */
export const DEFAULT_PEOPLE_COLUMNS: readonly PeopleColumnId[] = [
  "rfc",
  "ingreso",
  "relacion",
];

export const canSeePeopleColumn = (
  id: PeopleColumnId,
  permissions: ReadonlySet<string>,
) => (PEOPLE_COLUMNS[id].permissions ?? []).every((p) => permissions.has(p));

/** The columns a user may pick, in display order. */
export const allowedPeopleColumns = (permissions: ReadonlySet<string>) =>
  PEOPLE_COLUMN_IDS.filter((id) => canSeePeopleColumn(id, permissions)).map(
    (id) => PEOPLE_COLUMNS[id],
  );

/**
 * Known, unique column ids the user may see, in the given order. Accepts the
 * `cols` URL parameter (`rfc.ingreso`) or a stored array. «Nombre» is always
 * shown and is not a column here.
 */
export const coercePeopleColumns = (
  input: unknown,
  permissions: ReadonlySet<string>,
): PeopleColumnId[] => {
  const raw =
    typeof input === "string"
      ? input.split(".")
      : Array.isArray(input)
        ? input
        : [];
  const known = new Set<string>(PEOPLE_COLUMN_IDS);
  const seen = new Set<string>();

  return raw.filter((id): id is PeopleColumnId => {
    if (typeof id !== "string" || !known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return canSeePeopleColumn(id as PeopleColumnId, permissions);
  });
};

export const serializePeopleColumns = (columns: readonly PeopleColumnId[]) =>
  columns.join(".");
