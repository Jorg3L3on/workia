export const AUDIT_RESOURCE_TYPES = [
  "person",
  "area",
  "position",
  "activity",
  "position_activity",
  "site",
  "region",
  "contract",
  "contract_template",
  "asset",
  "asset_movement",
  "people_import",
  "people_export",
  "company",
  "membership",
  "mcp_connection",
  "mcp_settings",
  "onboarding",
  "termination_reason",
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
  "switch",
  "revoke",
  "approve",
  "reject",
  // Iniciativa 2: baja y periodos laborales.
  "reingreso",
  "finiquito_actualizado",
  "terminado",
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
  switch: "Cambio de empresa",
  revoke: "Revocación",
  approve: "Aprobación",
  reject: "Rechazo",
  reingreso: "Reingreso",
  finiquito_actualizado: "Finiquito actualizado",
  terminado: "Contrato terminado",
};

export const auditResourceTypeLabels: Record<AuditResourceType, string> = {
  person: "Persona",
  area: "Área",
  position: "Puesto",
  activity: "Actividad",
  position_activity: "Actividad de puesto",
  site: "Ubicación",
  region: "Región",
  contract: "Contrato",
  contract_template: "Plantilla de contrato",
  asset: "Activo",
  asset_movement: "Movimiento de resguardo",
  people_import: "Importación de personas",
  people_export: "Exportación de personas",
  company: "Empresa",
  membership: "Miembro",
  mcp_connection: "Conexión de asistente (MCP)",
  mcp_settings: "Escrituras del conector (MCP)",
  onboarding: "Alta (RH → Nóminas)",
  termination_reason: "Motivo de baja",
};

export const AUDIT_SOURCES = [
  "app",
  "import",
  "mcp",
  "seed",
  "system",
] as const;

export const auditSourceLabels: Record<(typeof AUDIT_SOURCES)[number], string> =
  {
    app: "App",
    import: "Importación",
    mcp: "Asistente (MCP)",
    seed: "Datos iniciales",
    system: "Sistema",
  };

/**
 * Readable names of the fields a baja, reingreso or finiquito records in
 * `changes`; Historial falls back to the raw key for the rest.
 */
export const auditFieldLabels: Record<string, string> = {
  status: "Estatus",
  fechaIngreso: "Fecha de ingreso",
  fechaBaja: "Fecha de baja",
  tipoBaja: "Tipo de baja",
  motivoBaja: "Motivo de baja",
  comentarioBaja: "Comentario",
  recontratable: "Recontratable",
  reconoceAntiguedad: "Reconoce antigüedad previa",
  fechaAntiguedadReconocida: "Antigüedad reconocida desde",
  fechaAntiguedad: "Fecha de antigüedad",
  finiquitoEstado: "Finiquito",
  finiquitoFecha: "Fecha del finiquito",
  finiquitoMonto: "Monto del finiquito",
  endDate: "Fin",
  classification: "Clasificación",
};

/**
 * Payroll amounts inside audit payloads: shown only with compensation:read
 * (maskAuditCompensation); everyone else sees «•••».
 */
export const AUDIT_COMPENSATION_FIELDS = [
  "salarioDiario",
  "salarioMensual",
  "finiquitoMonto",
] as const;

export type AuditPayload = {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  changes?: Record<string, { from: unknown; to: unknown }>;
  summary?: string;
};

export type AuditRequestMeta = {
  path?: string;
  method?: string;
  /** MCP calls: the client and connection that acted. */
  client?: string;
  connection_id?: string;
  tool?: string;
  request_id?: string;
  idempotency_key?: string;
};

export type RecordAuditEventInput = {
  /** Company the event belongs to; platform events use the company they affect. */
  companyId: string;
  actorUserId?: string | null;
  resourceType: AuditResourceType;
  resourceId: string;
  action: AuditAction;
  result?: "success" | "failure";
  /** Where the write came from; MCP tools record "mcp". */
  source?: "app" | "seed" | "system" | "import" | "mcp";
  payload?: AuditPayload;
  requestMeta?: AuditRequestMeta;
};

export type ListAuditEventsOptions = {
  companyId: string;
  resourceType?: AuditResourceType;
  resourceId?: string;
  actorUserId?: string;
  action?: AuditAction;
  /** Where the change came from (app, seed, system, import, mcp). */
  source?: NonNullable<RecordAuditEventInput["source"]>;
  from?: Date;
  to?: Date;
  /** Free text over the event's summary, changes and actor name or email. */
  query?: string;
  /** compensation:read: payroll amounts (salaries, finiquito) in clear; masked otherwise. */
  compensation?: boolean;
  limit?: number;
  offset?: number;
};
