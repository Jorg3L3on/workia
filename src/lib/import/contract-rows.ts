import type { ImportRowError } from "@/lib/db/schema";
import { identifierOrNull } from "@/lib/people/identity";

import {
  catalogKey,
  parseContractStatus,
  parseContractType,
  parseNoticeWindow,
} from "./format";
import { isUuid, type Cells } from "./person-rows";
import type { ExistingContract, NormalizedContract } from "./types";

/** Pure validation of Contratos rows (history of contracts per person). */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (cells: Cells, key: string) => {
  const value = cells[key];

  return value === null || value === undefined ? "" : String(value).trim();
};

export const IMPORTED_TEMPLATE_NAME = "Importado";

/** Status when the file leaves it blank: expired contracts are `vencido`. */
export const deriveContractStatus = (
  type: NormalizedContract["type"],
  endDate: string | null,
  today: string,
): NormalizedContract["status"] =>
  type === "determinado" && endDate && endDate < today ? "vencido" : "vigente";

export type TemplateIndex = Map<string, { id: string; name: string }>;

export const personKeyOf = (cells: Cells) => ({
  idWorkia: text(cells, "idWorkia") || null,
  curp: identifierOrNull(text(cells, "curp")),
});

export const normalizeContractRow = (
  cells: Cells,
  options: { today: string; templates: TemplateIndex },
): {
  normalized: NormalizedContract | null;
  errors: ImportRowError[];
} => {
  const errors: ImportRowError[] = [];
  const personKey = personKeyOf(cells);

  if (!personKey.idWorkia && !personKey.curp) {
    errors.push({
      field: "curp",
      message: "Indica el ID Workia o la CURP de la persona.",
    });
  }

  if (personKey.idWorkia && !isUuid(personKey.idWorkia)) {
    errors.push({ field: "idWorkia", message: "ID Workia inválido." });
  }

  const type = parseContractType(text(cells, "tipo"));

  if (!type) {
    errors.push({
      field: "tipo",
      message: 'Tipo debe ser "Determinado" o "Indeterminado".',
    });
  }

  const startDate = text(cells, "fechaInicio");

  if (!ISO_DATE.test(startDate)) {
    errors.push({
      field: "fechaInicio",
      message: startDate
        ? "Fecha de inicio inválida."
        : "La fecha de inicio es obligatoria.",
    });
  }

  const endText = text(cells, "fechaFin");

  if (endText && !ISO_DATE.test(endText)) {
    errors.push({ field: "fechaFin", message: "Fecha de fin inválida." });
  }

  // An indeterminate contract has no end date, whatever the file says.
  const endDate = type === "indeterminado" ? null : endText || null;

  if (type === "determinado" && !endText) {
    errors.push({
      field: "fechaFin",
      message: "Un contrato determinado requiere fecha de fin.",
    });
  }

  if (
    endDate &&
    ISO_DATE.test(startDate) &&
    ISO_DATE.test(endDate) &&
    endDate < startDate
  ) {
    errors.push({
      field: "fechaFin",
      message: "La fecha de fin es anterior a la de inicio.",
    });
  }

  const noticeText = text(cells, "aviso");
  const noticeWindow = noticeText ? parseNoticeWindow(noticeText) : "no_avisar";

  if (!noticeWindow) {
    errors.push({
      field: "aviso",
      message: 'Aviso debe ser 1, 2, 3, 6 o "No avisar".',
    });
  }

  const statusText = text(cells, "estatus");
  let status = statusText ? parseContractStatus(statusText) : null;

  if (statusText && !status) {
    errors.push({
      field: "estatus",
      message:
        'Estatus debe ser "Vigente", "Renovado", "No renovado", "Vencido" o "Terminado".',
    });
  }

  const templateName = text(cells, "plantilla");
  // "Importado" is what exports write for contracts that never had a template.
  const asksForTemplate =
    templateName !== "" &&
    catalogKey(templateName) !== catalogKey(IMPORTED_TEMPLATE_NAME);
  const template = asksForTemplate
    ? options.templates.get(catalogKey(templateName))
    : undefined;

  if (asksForTemplate && !template) {
    // Templates are optional for historical contracts, so keep the row.
    errors.push({
      field: "plantilla",
      severity: "warning",
      message: `Plantilla "${templateName}" no existe: el contrato se importa sin plantilla.`,
    });
  }

  if (
    errors.some((error) => error.severity !== "warning") ||
    !type ||
    !noticeWindow
  ) {
    return { normalized: null, errors };
  }

  const derived = deriveContractStatus(type, endDate, options.today);

  if (!status) {
    status = derived;
  } else if (status === "vigente" && derived === "vencido") {
    status = "vencido";
    errors.push({
      field: "estatus",
      severity: "warning",
      message: "La fecha de fin ya pasó: el contrato se importa como Vencido.",
    });
  } else if (status === "vencido" && type === "indeterminado") {
    // Indeterminate contracts cannot expire by date, but an explicit status is kept.
  } else if (status === "vencido" && endDate && endDate >= options.today) {
    errors.push({
      field: "estatus",
      message:
        "El contrato está marcado Vencido pero su fecha de fin aún no llega.",
    });

    return { normalized: null, errors };
  }

  return {
    normalized: {
      personKey,
      type,
      startDate,
      endDate,
      noticeWindow,
      status,
      templateId: template?.id ?? null,
      templateName: template?.name ?? null,
    },
    errors,
  };
};

/** Row identity for round trips: one contract per person and start date. */
export const contractIdentity = (personId: string, startDate: string) =>
  `${personId}|${startDate}`;

const DIFF_FIELDS = ["type", "endDate", "noticeWindow", "status"] as const;

export const diffContract = (
  next: NormalizedContract,
  existing: ExistingContract,
) => {
  const diff: Record<string, [unknown, unknown]> = {};

  for (const field of DIFF_FIELDS) {
    if (next[field] !== existing[field]) {
      diff[field] = [existing[field], next[field]];
    }
  }

  if (next.templateId && next.templateId !== existing.templateId) {
    diff.templateName = [existing.templateName, next.templateName];
  }

  return diff;
};

export type ContractFileRow = {
  rowNumber: number;
  /** idWorkia (lower) or curp: whichever identifies the person. */
  person: string | null;
  startDate: string | null;
  status: NormalizedContract["status"] | null;
};

/**
 * File-level contract rules: no two rows for the same person and start date,
 * and at most one `vigente` contract per person. Later rows are rejected.
 */
export const findContractFileConflicts = (rows: ContractFileRow[]) => {
  const conflicts = new Map<number, ImportRowError>();
  const seenStart = new Map<string, number>();
  const vigente = new Map<string, number>();

  for (const row of rows) {
    if (!row.person) continue;

    if (row.startDate) {
      const key = `${row.person}|${row.startDate}`;
      const first = seenStart.get(key);

      if (first === undefined) {
        seenStart.set(key, row.rowNumber);
      } else {
        conflicts.set(row.rowNumber, {
          field: "fechaInicio",
          message: `La persona ya tiene un contrato con esta fecha de inicio en la fila ${first}.`,
        });
        continue;
      }
    }

    if (row.status === "vigente") {
      const first = vigente.get(row.person);

      if (first === undefined) {
        vigente.set(row.person, row.rowNumber);
      } else {
        conflicts.set(row.rowNumber, {
          field: "estatus",
          message: `La persona ya tiene un contrato vigente en la fila ${first}.`,
        });
      }
    }
  }

  return conflicts;
};

/** Text stored for contracts imported without a template. */
export const importedContractText = (input: {
  fullName: string;
  type: NormalizedContract["type"];
  startDate: string;
  endDate: string | null;
  formatDate: (value: string | null) => string;
}) =>
  [
    "Contrato importado",
    "",
    `Persona: ${input.fullName}`,
    `Tipo: ${input.type === "determinado" ? "Determinado" : "Indeterminado"}`,
    `Inicio: ${input.formatDate(input.startDate)}`,
    `Fin: ${input.endDate ? input.formatDate(input.endDate) : "—"}`,
  ].join("\n");
