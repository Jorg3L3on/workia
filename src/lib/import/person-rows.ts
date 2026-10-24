import type { ImportRowError } from "@/lib/db/schema";
import { formatDateMx } from "@/lib/format/date";
import type { EmploymentSummary } from "@/lib/people/employment";
import {
  terminationTypeLabels,
  type TerminationValues,
} from "@/lib/people/employment-schema";
import { identifierOrNull } from "@/lib/people/identity";
import { personFormSchema } from "@/lib/people/schema";

import {
  catalogKey,
  parseImportDate,
  parsePersonStatus,
  parseTerminationType,
  parseYesNo,
  TERMINATION_TYPE_OPTIONS,
} from "./format";
import type {
  CatalogIndex,
  ExistingPerson,
  NormalizedBaja,
  NormalizedPerson,
  NormalizedPersonValues,
  RowOutcome,
} from "./types";

/**
 * Pure validation of one Personas row. No I/O: catalogs and matches are
 * resolved by the caller with batch queries, so this stays cheap per row.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string) => UUID_RE.test(value);

export type Cells = Record<string, string | number | boolean | null>;

const text = (cells: Cells, key: string) => {
  const value = cells[key];

  return value === null || value === undefined ? "" : String(value).trim();
};

/**
 * The form's messages say what is wrong; in a spreadsheet the person also
 * needs to know how to fix the cell.
 */
const IMPORT_MESSAGES: Record<string, string> = {
  "Los nombres son obligatorios":
    "Los nombres son obligatorios. Escríbelos en Nombres.",
  "El apellido paterno es obligatorio":
    "El apellido paterno es obligatorio. Escríbelo en Apellido paterno.",
  "Máximo 120 caracteres": "Máximo 120 caracteres. Acorta el texto.",
  "Correo electrónico inválido":
    "Correo electrónico inválido. Escribe uno como nombre@empresa.mx o deja la celda vacía.",
  "Fecha inválida":
    "Fecha inválida. Escríbela como AAAA-MM-DD o DD/MM/AAAA (día primero), por ejemplo 2026-04-03.",
  "RFC inválido":
    "RFC inválido. Escribe los 13 caracteres de persona física, como en la constancia del SAT.",
  "CURP inválida":
    "CURP inválida. Escribe los 18 caracteres tal como vienen en el documento (el último es el dígito verificador).",
  "NSS inválido":
    "NSS inválido. Escribe el NSS como texto: 11 dígitos, con ceros al inicio.",
};

/** Form field -> import column key, so errors point at the right column. */
const FIELD_TO_COLUMN: Record<string, string> = {
  areaId: "area",
  positionId: "puesto",
  siteId: "sucursal",
};

export type RowOptions = { createMissingCatalogs: boolean };

const resolveCatalogs = (
  cells: Cells,
  catalogs: CatalogIndex,
  options: RowOptions,
  errors: ImportRowError[],
) => {
  const missing: NormalizedPerson["missingCatalogs"] = {};
  let areaId: string | null = null;
  let positionId: string | null = null;
  let siteId: string | null = null;

  const area = text(cells, "area");
  const position = text(cells, "puesto");
  const site = text(cells, "sucursal");

  if (area) {
    areaId = catalogs.areas.get(catalogKey(area)) ?? null;

    if (!areaId) {
      if (options.createMissingCatalogs) missing.area = area;
      else
        errors.push({
          field: "area",
          message: `Área "${area}" no existe en el catálogo. Elígela de la lista o marca «Crear áreas, puestos y sucursales que no existan».`,
        });
    }
  }

  if (position) {
    const candidates = catalogs.positions.get(catalogKey(position)) ?? [];
    // The same position name can live in two areas: prefer the row's area.
    const chosen =
      candidates.find((candidate) => areaId && candidate.areaId === areaId) ??
      (candidates.length === 1 ? candidates[0] : undefined);

    if (chosen) {
      positionId = chosen.id;
    } else if (candidates.length > 1) {
      const areaNames = [
        ...new Set(candidates.flatMap((c) => (c.areaName ? [c.areaName] : []))),
      ];

      errors.push({
        field: "puesto",
        message: areaNames.length
          ? `Puesto "${position}" existe en varias áreas; escribe en Área una de estas: ${areaNames.join(", ")}.`
          : `Puesto "${position}" existe en varias áreas; indica el área.`,
      });
    } else if (options.createMissingCatalogs) {
      missing.position = position;
    } else {
      errors.push({
        field: "puesto",
        message: `Puesto "${position}" no existe en el catálogo. Elígelo de la lista o marca «Crear áreas, puestos y sucursales que no existan».`,
      });
    }
  }

  if (site) {
    siteId = catalogs.sites.get(catalogKey(site)) ?? null;

    if (!siteId) {
      if (options.createMissingCatalogs) missing.site = site;
      else
        errors.push({
          field: "sucursal",
          message: `Sucursal "${site}" no existe en el catálogo. Elígela de la lista o marca «Crear áreas, puestos y sucursales que no existan».`,
        });
    }
  }

  return { areaId, positionId, siteId, missing };
};

const INVALID_DATE = IMPORT_MESSAGES["Fecha inválida"];

/** A date cell already parsed by the browser, or parsed here (CSV, API). */
const dateCell = (
  cells: Cells,
  key: string,
  errors: ImportRowError[],
): string | null => {
  const value = text(cells, key);

  if (!value) return null;

  const parsed = parseImportDate(value);

  if (!parsed) errors.push({ field: key, message: INVALID_DATE });

  return parsed;
};

const COMENTARIO_MAX = 1000;

/**
 * The baja columns (Iniciativa 2), cell by cell. Whether they fit the row's
 * Estatus and the person's current baja is planEmployment()'s job.
 */
const resolveBaja = (
  cells: Cells,
  catalogs: CatalogIndex,
  errors: ImportRowError[],
): NormalizedBaja | null => {
  const fechaBaja = dateCell(cells, "fechaBaja", errors);
  const tipoText = text(cells, "tipoBaja");
  const motivoText = text(cells, "motivoBaja");
  const comentario = text(cells, "comentarioBaja") || null;
  const recontratableText = text(cells, "recontratable");

  if (
    !text(cells, "fechaBaja") &&
    !tipoText &&
    !motivoText &&
    !comentario &&
    !recontratableText
  ) {
    return null;
  }

  const tipoBaja = tipoText ? parseTerminationType(tipoText) : null;

  if (tipoText && !tipoBaja) {
    errors.push({
      field: "tipoBaja",
      message: `Tipo de baja debe ser ${TERMINATION_TYPE_OPTIONS.join(", ")}. Elígelo de la lista.`,
    });
  }

  const motivo = motivoText
    ? catalogs.terminationReasons.get(catalogKey(motivoText))
    : undefined;

  if (motivoText && !motivo) {
    errors.push({
      field: "motivoBaja",
      message: `Motivo de baja "${motivoText}" no existe en el catálogo. Elígelo de la lista o agrégalo en Catálogo > Motivos de baja.`,
    });
  }

  if (comentario && comentario.length > COMENTARIO_MAX) {
    errors.push({
      field: "comentarioBaja",
      message: "Máximo 1,000 caracteres. Acorta el comentario.",
    });
  }

  const recontratable = recontratableText
    ? parseYesNo(recontratableText)
    : null;

  if (recontratableText && recontratable === null) {
    errors.push({
      field: "recontratable",
      message: 'Recontratable debe ser "Sí" o "No". Elígelo de la lista.',
    });
  }

  return {
    fechaBaja,
    tipoBaja,
    motivoBajaId: motivo?.id ?? null,
    motivoBaja: motivo?.name ?? null,
    motivoActivo: motivo?.active ?? true,
    comentario,
    recontratable,
  };
};

/** Validates a Personas row with the same zod schema as the person form. */
export const normalizePersonRow = (
  cells: Cells,
  catalogs: CatalogIndex,
  options: RowOptions,
): { normalized: NormalizedPerson | null; errors: ImportRowError[] } => {
  const errors: ImportRowError[] = [];
  const { areaId, positionId, siteId, missing } = resolveCatalogs(
    cells,
    catalogs,
    options,
    errors,
  );

  const statusText = text(cells, "estatus");
  const status = statusText ? parsePersonStatus(statusText) : null;

  if (statusText && !status) {
    errors.push({
      field: "estatus",
      message:
        'Estatus debe ser "Activa" o "Baja". Elígelo de la lista o déjalo vacío para Activa.',
    });
  }

  const idWorkia = text(cells, "idWorkia") || null;

  if (idWorkia && !isUuid(idWorkia)) {
    errors.push({
      field: "idWorkia",
      message:
        "ID Workia inválido. Déjalo vacío en altas nuevas o cópialo tal cual de una exportación.",
    });
  }

  const baja = resolveBaja(cells, catalogs, errors);
  const fechaAntiguedad = dateCell(cells, "fechaAntiguedad", errors);

  const parsed = personFormSchema.safeParse({
    nombres: text(cells, "nombres"),
    apellidoPaterno: text(cells, "apellidoPaterno"),
    apellidoMaterno: text(cells, "apellidoMaterno"),
    email: text(cells, "email"),
    telefono: text(cells, "telefono"),
    fechaNacimiento: text(cells, "fechaNacimiento"),
    fechaIngreso: text(cells, "fechaIngreso"),
    areaId: areaId ?? "",
    positionId: positionId ?? "",
    siteId: siteId ?? "",
    managerId: "",
    rfc: text(cells, "rfc"),
    curp: text(cells, "curp"),
    nss: text(cells, "nss"),
    status: status ?? "activa",
  });

  if (!parsed.success) {
    const seen = new Set<string>();

    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "");
      const column = FIELD_TO_COLUMN[field] ?? field;

      if (!seen.has(column)) {
        seen.add(column);
        errors.push({
          field: column,
          message: IMPORT_MESSAGES[issue.message] ?? issue.message,
        });
      }
    }
  }

  if (!parsed.success || errors.some((error) => error.severity !== "warning")) {
    return { normalized: null, errors };
  }

  const value = parsed.data;
  const orNull = (input?: string) => (input?.trim() ? input.trim() : null);
  const values: NormalizedPersonValues = {
    nombres: value.nombres,
    apellidoPaterno: value.apellidoPaterno,
    apellidoMaterno: orNull(value.apellidoMaterno),
    email: orNull(value.email),
    telefono: orNull(value.telefono),
    fechaNacimiento: orNull(value.fechaNacimiento),
    fechaIngreso: orNull(value.fechaIngreso),
    areaId,
    positionId,
    siteId,
    rfc: identifierOrNull(value.rfc),
    curp: identifierOrNull(value.curp),
    nss: orNull(value.nss),
    status,
  };

  return {
    normalized: {
      idWorkia,
      values,
      baja,
      fechaAntiguedad,
      missingCatalogs: missing,
      managerInput: text(cells, "jefeDirecto") || null,
      managerRef: null,
    },
    errors,
  };
};

const DIFF_FIELDS = [
  "nombres",
  "apellidoPaterno",
  "apellidoMaterno",
  "email",
  "telefono",
  "fechaNacimiento",
  "fechaIngreso",
  "areaId",
  "positionId",
  "siteId",
  "rfc",
  "curp",
  "nss",
  "status",
] as const;

/**
 * Field-by-field changes an import would make to an existing person. A blank
 * cell never clears a value (it means "no information"), so only non-null file
 * values are compared.
 */
export const diffPerson = (
  values: NormalizedPersonValues,
  existing: ExistingPerson,
  missingCatalogs: NormalizedPerson["missingCatalogs"] = {},
) => {
  const diff: Record<string, [unknown, unknown]> = {};

  for (const field of DIFF_FIELDS) {
    const next = values[field];

    if (next === null) continue;

    if (next !== existing[field]) {
      diff[field] = [existing[field], next];
    }
  }

  // A catalog that does not exist yet is always a change.
  for (const [key, name] of Object.entries(missingCatalogs)) {
    diff[`${key}Name`] = [null, name];
  }

  return diff;
};

export type PersonLookups = {
  byId: Map<string, ExistingPerson>;
  byCurp: Map<string, ExistingPerson>;
  byRfc: Map<string, ExistingPerson>;
  /** Current (or last) employment period by person id; Personas rows need it. */
  employment?: Map<string, EmploymentSummary>;
};

/** What an import row does to the employment periods (Iniciativa 2). */
export type EmploymentPlan = {
  /**
   * «close»: the person becomes de baja with these values
   * (recordTermination). «correct»: the person already is, and the last
   * baja takes them (correctTermination).
   */
  termination: { mode: "close" | "correct"; values: TerminationValues } | null;
  /** Recognized seniority for the open period (recognizeSeniority). */
  antiguedad: string | null;
  /** Review lines, keyed by import column. */
  diff: Record<string, [unknown, unknown]>;
  errors: ImportRowError[];
};

const yesNo = (value: boolean | null | undefined) =>
  value === null || value === undefined ? null : value ? "Sí" : "No";

const typeLabel = (value: EmploymentSummary["tipoBaja"] | undefined) =>
  value ? terminationTypeLabels[value] : null;

const BAJA_COLUMNS = [
  ["fechaBaja", "Fecha de baja"],
  ["tipoBaja", "Tipo de baja"],
  ["motivoBaja", "Motivo de baja"],
  ["recontratable", "Recontratable"],
] as const;

/**
 * The baja and «Fecha de antigüedad» of a row against the person's current
 * (or last) period. A blank cell keeps what is stored, as for every column.
 *
 * - Estatus Baja with the baja columns closes the open period with them, or
 *   corrects the last baja of someone already de baja. Fecha, Tipo, Motivo
 *   and Recontratable are then all needed (stored values count); a new
 *   motivo must be active, a stored one may have been deactivated since.
 * - Estatus Baja without them on someone active is an error: a baja always
 *   carries its motivo (WRK-I12), so the import no longer closes periods
 *   «sin fecha».
 * - «Fecha de antigüedad» becomes the open period's recognized seniority
 *   only when it differs from the fecha de ingreso (and from what it already
 *   counts from).
 */
export const planEmployment = (
  normalized: NormalizedPerson,
  person: ExistingPerson | null,
  summary: EmploymentSummary | null,
): EmploymentPlan => {
  const plan: EmploymentPlan = {
    termination: null,
    antiguedad: null,
    diff: {},
    errors: [],
  };
  const baja = normalized.baja ?? null;
  const status = normalized.values.status ?? person?.status ?? "activa";
  const ingreso =
    normalized.values.fechaIngreso ?? person?.fechaIngreso ?? null;
  const becomesBaja = status === "baja" && person?.status !== "baja";
  // A person who is already de baja: the last period holds the baja.
  const current = becomesBaja || !summary || summary.abierto ? null : summary;

  if (status !== "baja" && baja) {
    plan.errors.push({
      field: "estatus",
      message:
        "Fecha de baja, Tipo de baja, Motivo de baja, Comentario de baja y Recontratable solo aplican con Estatus Baja. Escribe Baja en Estatus o borra esas celdas.",
    });
  } else if (becomesBaja && !baja) {
    // A baja always carries its motivo (WRK-I12, decision 088ddeff).
    plan.errors.push({
      field: "motivoBaja",
      message:
        "Para dar de baja falta Fecha de baja, Tipo de baja, Motivo de baja, Recontratable. Llena esas columnas o cambia el Estatus.",
    });
  } else if (baja) {
    const merged = {
      fechaBaja: baja.fechaBaja ?? current?.fechaBaja ?? null,
      tipoBaja: baja.tipoBaja ?? current?.tipoBaja ?? null,
      motivoBajaId: baja.motivoBajaId ?? current?.motivoBajaId ?? null,
      comentario: baja.comentario ?? current?.comentarioBaja ?? null,
      recontratable: baja.recontratable ?? current?.recontratable ?? null,
    };
    const change = (key: string, from: unknown, to: unknown) => {
      if (to !== null && to !== from) plan.diff[key] = [from, to];
    };

    change("fechaBaja", current?.fechaBaja ?? null, baja.fechaBaja);
    change("tipoBaja", typeLabel(current?.tipoBaja), typeLabel(baja.tipoBaja));
    if (baja.motivoBajaId && baja.motivoBajaId !== current?.motivoBajaId) {
      plan.diff.motivoBaja = [current?.motivoBaja ?? null, baja.motivoBaja];
    }
    change("comentarioBaja", current?.comentarioBaja ?? null, baja.comentario);
    change(
      "recontratable",
      yesNo(current?.recontratable),
      yesNo(baja.recontratable),
    );

    if (Object.keys(plan.diff).length > 0) {
      const missing = BAJA_COLUMNS.filter(([key]) =>
        key === "motivoBaja"
          ? merged.motivoBajaId === null
          : merged[key] === null,
      );
      if (missing.length > 0) {
        plan.errors.push({
          field: missing[0][0],
          message: `Para registrar la baja falta ${missing.map(([, label]) => label).join(", ")}. Llena ${missing.length === 1 ? "esa columna" : "esas columnas"} o borra los demás datos de baja.`,
        });
      } else if (plan.diff.motivoBaja && !baja.motivoActivo) {
        plan.errors.push({
          field: "motivoBaja",
          message: `El motivo de baja "${baja.motivoBaja}" está inactivo. Elige un motivo activo de la lista o reactívalo en Catálogo > Motivos de baja.`,
        });
      } else if (ingreso && merged.fechaBaja! < ingreso) {
        plan.errors.push({
          field: "fechaBaja",
          message: `La fecha de baja no puede ser anterior a la Fecha de ingreso (${formatDateMx(ingreso)}). Corrige alguna de las dos.`,
        });
      } else {
        plan.termination = {
          mode: becomesBaja ? "close" : "correct",
          values: {
            fechaBaja: merged.fechaBaja!,
            tipoBaja: merged.tipoBaja!,
            motivoBajaId: merged.motivoBajaId!,
            comentario: merged.comentario,
            recontratable: merged.recontratable!,
          },
        };
      }
    }
  }

  // Someone de baja keeps the ingreso of their last period before its baja.
  const fechaBaja = plan.termination?.values.fechaBaja ?? current?.fechaBaja;

  if (
    !becomesBaja &&
    status === "baja" &&
    fechaBaja &&
    normalized.values.fechaIngreso &&
    normalized.values.fechaIngreso > fechaBaja
  ) {
    plan.errors.push({
      field: "fechaIngreso",
      message: `La Fecha de ingreso no puede ser posterior a la Fecha de baja (${formatDateMx(fechaBaja)}). Corrige alguna de las dos.`,
    });
  }

  const antiguedad = normalized.fechaAntiguedad ?? null;

  if (antiguedad && status === "baja") {
    if (antiguedad !== (summary?.fechaAntiguedad ?? ingreso)) {
      plan.errors.push({
        field: "fechaAntiguedad",
        severity: "warning",
        message:
          "La Fecha de antigüedad solo se guarda para personas activas; en esta fila no se cambió.",
      });
    }
  } else if (antiguedad) {
    const counted = summary?.abierto ? summary.fechaAntiguedad : null;

    if (antiguedad !== counted && antiguedad !== ingreso) {
      if (ingreso && antiguedad > ingreso) {
        plan.errors.push({
          field: "fechaAntiguedad",
          message: `La Fecha de antigüedad no puede ser posterior a la Fecha de ingreso (${formatDateMx(ingreso)}). Escribe una fecha anterior o deja la celda vacía.`,
        });
      } else {
        plan.antiguedad = antiguedad;
        plan.diff.fechaAntiguedad = [counted, antiguedad];
      }
    }
  }

  return plan;
};

/**
 * Finds the person a row refers to: ID Workia, then CURP, then RFC. Keys that
 * point at different people, or a deleted person, are errors.
 */
export const matchPerson = (
  normalized: NormalizedPerson,
  lookups: PersonLookups,
): { person: ExistingPerson | null; errors: ImportRowError[] } => {
  const errors: ImportRowError[] = [];
  const byId = normalized.idWorkia
    ? lookups.byId.get(normalized.idWorkia.toLowerCase())
    : undefined;
  const byCurp = normalized.values.curp
    ? lookups.byCurp.get(normalized.values.curp)
    : undefined;
  const byRfc = normalized.values.rfc
    ? lookups.byRfc.get(normalized.values.rfc)
    : undefined;

  if (normalized.idWorkia && !byId) {
    errors.push({
      field: "idWorkia",
      message:
        "No existe una persona con ese ID Workia. Déjalo vacío para darla de alta o cópialo de una exportación.",
    });

    return { person: null, errors };
  }

  if (byId?.deletedAt) {
    errors.push({
      field: "idWorkia",
      message:
        "Esa persona está borrada; restáurala antes de importar o quita el ID Workia para darla de alta.",
    });

    return { person: null, errors };
  }

  if (byId && byCurp && byId.id !== byCurp.id) {
    errors.push({
      field: "curp",
      message:
        "La CURP pertenece a otra persona activa. Revisa la CURP o el ID Workia de esta fila.",
    });
  }

  if (byId && byRfc && byId.id !== byRfc.id) {
    errors.push({
      field: "rfc",
      message:
        "El RFC pertenece a otra persona activa. Revisa el RFC o el ID Workia de esta fila.",
    });
  }

  if (!byId && byCurp && byRfc && byCurp.id !== byRfc.id) {
    errors.push({
      field: "rfc",
      message:
        "CURP y RFC corresponden a personas distintas. Revisa cuál de los dos está mal.",
    });
  }

  return { person: byId ?? byCurp ?? byRfc ?? null, errors };
};

/** Classifies a validated row against the database. */
export const classifyPersonRow = (
  normalized: NormalizedPerson,
  lookups: PersonLookups,
): RowOutcome => {
  const { person, errors } = matchPerson(normalized, lookups);

  if (errors.length > 0) {
    return {
      action: "error",
      errors,
      diff: null,
      targetPersonId: null,
      normalized: null,
    };
  }

  const employment = planEmployment(
    normalized,
    person,
    person ? (lookups.employment?.get(person.id) ?? null) : null,
  );

  if (employment.errors.some((error) => error.severity !== "warning")) {
    return {
      action: "error",
      errors: employment.errors,
      diff: null,
      targetPersonId: null,
      normalized: null,
    };
  }

  if (!person) {
    return {
      action: "create",
      errors: employment.errors,
      diff: null,
      targetPersonId: null,
      normalized,
    };
  }

  const diff = {
    ...diffPerson(normalized.values, person, normalized.missingCatalogs),
    ...employment.diff,
  };

  return {
    action: Object.keys(diff).length === 0 ? "unchanged" : "update",
    errors: employment.errors,
    diff,
    targetPersonId: person.id,
    normalized,
  };
};

export type KeyedRow = {
  rowNumber: number;
  idWorkia: string | null;
  curp: string | null;
  rfc: string | null;
  /** Unique per company too (migration 0017); optional where it is not compared. */
  nss?: string | null;
};

/**
 * Rows repeating an ID Workia, CURP, RFC or NSS already used by an earlier row.
 * Returns row number -> error, so only the later occurrences are rejected.
 */
export const findFileDuplicates = (rows: KeyedRow[]) => {
  const seen = new Map<string, number>();
  const duplicates = new Map<number, ImportRowError>();
  const labels = {
    idWorkia: "ID Workia repetido",
    curp: "CURP repetida",
    rfc: "RFC repetido",
    nss: "NSS repetido",
  } as const;

  for (const row of rows) {
    for (const field of ["idWorkia", "curp", "rfc", "nss"] as const) {
      const value = row[field];

      if (!value) continue;

      const key = `${field}:${field === "idWorkia" ? value.toLowerCase() : value}`;
      const first = seen.get(key);

      if (first === undefined) {
        seen.set(key, row.rowNumber);
      } else if (!duplicates.has(row.rowNumber)) {
        duplicates.set(row.rowNumber, {
          field,
          message: `${labels[field]}: ya aparece en la fila ${first}. Deja una sola fila por persona.`,
        });
      }
    }
  }

  return duplicates;
};

export const possibleDuplicateKey = (values: {
  nombres: string;
  apellidoPaterno: string;
  fechaNacimiento: string | null;
}) =>
  values.fechaNacimiento
    ? `${catalogKey(values.nombres)}|${catalogKey(values.apellidoPaterno)}|${values.fechaNacimiento}`
    : null;

/**
 * Walks manager links to find rows that end up in a loop. `managerOf` maps a
 * node (person id or `row:N`) to its manager node.
 */
export const findManagerCycleNodes = (managerOf: Map<string, string>) => {
  const inCycle = new Set<string>();
  const done = new Set<string>();

  for (const start of managerOf.keys()) {
    if (done.has(start)) continue;

    const path: string[] = [];
    const onPath = new Map<string, number>();
    let node: string | undefined = start;

    while (node !== undefined && !done.has(node)) {
      if (onPath.has(node)) {
        for (const member of path.slice(onPath.get(node))) {
          inCycle.add(member);
        }
        break;
      }

      onPath.set(node, path.length);
      path.push(node);
      node = managerOf.get(node);
    }

    for (const member of path) done.add(member);
  }

  return inCycle;
};
