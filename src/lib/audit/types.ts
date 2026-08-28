export const AUDIT_RESOURCE_TYPES = [
  "person",
  "area",
  "position",
  "site",
  "contract",
  "contract_template",
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
};

export const auditResourceTypeLabels: Record<AuditResourceType, string> = {
  person: "Persona",
  area: "Área",
  position: "Puesto",
  site: "Ubicación",
  contract: "Contrato",
  contract_template: "Plantilla de contrato",
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
  actorUserId?: string | null;
  resourceType: AuditResourceType;
  resourceId: string;
  action: AuditAction;
  result?: "success" | "failure";
  source?: "app" | "seed" | "system";
  payload?: AuditPayload;
  requestMeta?: AuditRequestMeta;
};

export type ListAuditEventsOptions = {
  resourceType?: AuditResourceType;
  resourceId?: string;
  actorUserId?: string;
  action?: AuditAction;
  from?: Date;
  to?: Date;
  limit?: number;
};
