import type { ImportRowError } from "@/lib/db/schema";
import { identifierOrNull } from "@/lib/people/identity";
import { personFormSchema } from "@/lib/people/schema";

import { catalogKey, parsePersonStatus } from "./format";
import type {
  CatalogIndex,
  ExistingPerson,
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
          message: `Área "${area}" no existe en el catálogo.`,
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
      errors.push({
        field: "puesto",
        message: `Puesto "${position}" existe en varias áreas; indica el área.`,
      });
    } else if (options.createMissingCatalogs) {
      missing.position = position;
    } else {
      errors.push({
        field: "puesto",
        message: `Puesto "${position}" no existe en el catálogo.`,
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
          message: `Sucursal "${site}" no existe en el catálogo.`,
        });
    }
  }

  return { areaId, positionId, siteId, missing };
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
      message: 'Estatus debe ser "Activa" o "Baja".',
    });
  }

  const idWorkia = text(cells, "idWorkia") || null;

  if (idWorkia && !isUuid(idWorkia)) {
    errors.push({ field: "idWorkia", message: "ID Workia inválido." });
  }

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
        errors.push({ field: column, message: issue.message });
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
      message: "No existe una persona con ese ID Workia.",
    });

    return { person: null, errors };
  }

  if (byId?.deletedAt) {
    errors.push({
      field: "idWorkia",
      message: "Esa persona está borrada; restáurala antes de importar.",
    });

    return { person: null, errors };
  }

  if (byId && byCurp && byId.id !== byCurp.id) {
    errors.push({
      field: "curp",
      message: "La CURP pertenece a otra persona activa.",
    });
  }

  if (byId && byRfc && byId.id !== byRfc.id) {
    errors.push({
      field: "rfc",
      message: "El RFC pertenece a otra persona activa.",
    });
  }

  if (!byId && byCurp && byRfc && byCurp.id !== byRfc.id) {
    errors.push({
      field: "rfc",
      message: "CURP y RFC corresponden a personas distintas.",
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

  if (!person) {
    return {
      action: "create",
      errors: [],
      diff: null,
      targetPersonId: null,
      normalized,
    };
  }

  const diff = diffPerson(
    normalized.values,
    person,
    normalized.missingCatalogs,
  );

  return {
    action: Object.keys(diff).length === 0 ? "unchanged" : "update",
    errors: [],
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
};

/**
 * Rows repeating an ID Workia, CURP or RFC already used by an earlier row.
 * Returns row number -> error, so only the later occurrences are rejected.
 */
export const findFileDuplicates = (rows: KeyedRow[]) => {
  const seen = new Map<string, number>();
  const duplicates = new Map<number, ImportRowError>();
  const labels = {
    idWorkia: "ID Workia repetido",
    curp: "CURP repetida",
    rfc: "RFC repetido",
  } as const;

  for (const row of rows) {
    for (const field of ["idWorkia", "curp", "rfc"] as const) {
      const value = row[field];

      if (!value) continue;

      const key = `${field}:${field === "idWorkia" ? value.toLowerCase() : value}`;
      const first = seen.get(key);

      if (first === undefined) {
        seen.set(key, row.rowNumber);
      } else if (!duplicates.has(row.rowNumber)) {
        duplicates.set(row.rowNumber, {
          field,
          message: `${labels[field]}: ya aparece en la fila ${first}.`,
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
