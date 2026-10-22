import type { ImportRowAction, ImportRowError } from "@/lib/db/schema";
import type { TerminationType } from "@/lib/db/schema/employment";

/** Person fields an import row can set, already normalized and validated. */
export type NormalizedPersonValues = {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  email: string | null;
  telefono: string | null;
  fechaNacimiento: string | null;
  fechaIngreso: string | null;
  areaId: string | null;
  positionId: string | null;
  siteId: string | null;
  rfc: string | null;
  curp: string | null;
  nss: string | null;
  /** null when the file left it blank; apply then keeps the current status. */
  status: "activa" | "baja" | null;
};

export type ManagerRef =
  { type: "person"; id: string } | { type: "row"; rowNumber: number };

/**
 * Baja columns of a row (Iniciativa 2), already parsed; null fields were
 * left blank. The motivo is resolved against the company's catalog.
 */
export type NormalizedBaja = {
  fechaBaja: string | null;
  tipoBaja: TerminationType | null;
  motivoBajaId: string | null;
  /** Catalog name, for the review and the audit. */
  motivoBaja: string | null;
  /** false: the motivo exists but is inactive (only accepted unchanged). */
  motivoActivo: boolean;
  comentario: string | null;
  recontratable: boolean | null;
};

export type NormalizedPerson = {
  idWorkia: string | null;
  values: NormalizedPersonValues;
  /** Absent in rows staged before the baja columns existed. */
  baja?: NormalizedBaja | null;
  /** «Fecha de antigüedad»: recognized seniority on the open period. */
  fechaAntiguedad?: string | null;
  /** Catalog names that do not exist yet; created at apply when allowed. */
  missingCatalogs: { area?: string; position?: string; site?: string };
  managerInput: string | null;
  managerRef: ManagerRef | null;
};

export type RowOutcome = {
  action: ImportRowAction;
  errors: ImportRowError[];
  diff: Record<string, [unknown, unknown]> | null;
  targetPersonId: string | null;
  targetContractId?: string | null;
  /** Sheet-specific normalized payload (person, schedule or contract). */
  normalized: object | null;
};

export type CatalogIndex = {
  areas: Map<string, string>;
  /** name key -> candidates (the same position name can exist in two areas). */
  positions: Map<
    string,
    { id: string; areaId: string | null; areaName?: string | null }[]
  >;
  sites: Map<string, string>;
  /** name key -> motivo de baja (not deleted; active or not). */
  terminationReasons: Map<
    string,
    { id: string; name: string; active: boolean }
  >;
};

export type ExistingPerson = {
  id: string;
  deletedAt: Date | null;
  curp: string | null;
  rfc: string | null;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  email: string | null;
  telefono: string | null;
  fechaNacimiento: string | null;
  fechaIngreso: string | null;
  areaId: string | null;
  positionId: string | null;
  siteId: string | null;
  nss: string | null;
  status: "activa" | "baja";
  managerId: string | null;
};

export type NormalizedContract = {
  personKey: { idWorkia: string | null; curp: string | null };
  type: "determinado" | "indeterminado";
  startDate: string;
  endDate: string | null;
  noticeWindow: "1" | "2" | "3" | "6" | "no_avisar";
  status: "vigente" | "renovado" | "no_renovado" | "vencido" | "terminado";
  templateId: string | null;
  templateName: string | null;
};

export type ExistingContract = {
  id: string;
  personId: string;
  type: NormalizedContract["type"];
  startDate: string;
  endDate: string | null;
  noticeWindow: NormalizedContract["noticeWindow"];
  status: NormalizedContract["status"];
  templateId: string | null;
  templateName: string | null;
};
