export const AUDIT_RESOURCE_TYPES = [
  "person",
  "area",
  "position",
  "activity",
  "position_activity",
  "site",
  "contract",
  "contract_template",
  "asset",
  "asset_movement",
  "people_import",
  "people_export",
] as const;

export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "baja",
  "reactivate",
  "delete",
  "activate",
  "deactivate",
  "renew",
  "no_renew",
  "assign",
  "return",
  "link",
  "unlink",
  "import",
  "export",
  "undo",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const auditActionLabels: Record<AuditAction, string> = {
  create: "Alta",
  update: "Edición",
  baja: "Baja laboral",
  reactivate: "Reactivación",
  delete: "Borrado lógico",
  activate: "Activación",
  deactivate: "Desactivación",
  renew: "Renovación",
  no_renew: "No renovar",
  assign: "Entrega",
  return: "Devolución",
  link: "Asignación",
  unlink: "Desasignación",
  import: "Importación",
  export: "Exportación",
  undo: "Deshacer importación",
};

export const auditResourceTypeLabels: Record<AuditResourceType, string> = {
  person: "Persona",
  area: "Área",
  position: "Puesto",
  activity: "Actividad",
  position_activity: "Actividad de puesto",
  site: "Ubicación",
  contract: "Contrato",
  contract_template: "Plantilla de contrato",
  asset: "Activo",
  asset_movement: "Movimiento de resguardo",
  people_import: "Importación de personas",
  people_export: "Exportación de personas",
};

export type AuditPayload = {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  changes?: Record<string, { from: unknown; to: unknown }>;
  summary?: string;
};

export type AuditRequestMeta = {
  path?: string;
  method?: string;
};

export type RecordAuditEventInput = {
  /** Company the event belongs to; platform events use the company they affect. */
  companyId: string;
  actorUserId?: string | null;
  resourceType: AuditResourceType;
  resourceId: string;
  action: AuditAction;
  result?: "success" | "failure";
  source?: "app" | "seed" | "system" | "import";
  payload?: AuditPayload;
  requestMeta?: AuditRequestMeta;
};

export type ListAuditEventsOptions = {
  companyId: string;
  resourceType?: AuditResourceType;
  resourceId?: string;
  actorUserId?: string;
  action?: AuditAction;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
};
