/**
 * The connector's tool names in Spanish for the Conexiones activity
 * (WRK-I6-7). The raw name stays available as a tooltip.
 */
const toolLabels: Record<string, string> = {
  whoami: "Identidad",
  search: "Buscar",
  fetch: "Abrir registro",
  list_people: "Listar personas",
  get_person: "Ver persona",
  create_person: "Crear persona",
  update_person: "Editar persona",
  set_person_status: "Cambiar estado de persona",
  update_person_schedule: "Editar horario",
  update_person_schedule_blocks: "Editar bloques de horario",
  list_contracts: "Listar contratos",
  list_expiring_contracts: "Contratos por vencer",
  list_renewal_tray: "Bandeja de renovaciones",
  get_contract: "Ver contrato",
  list_contract_templates: "Listar plantillas",
  preview_contract: "Vista previa de contrato",
  issue_contract: "Emitir contrato",
  renew_contract: "Renovar contrato",
  mark_contract_no_renew: "Marcar no renovación",
  decide_contract_renewal: "Decidir renovación",
  get_seniority_certificate: "Constancia de antigüedad",
  list_assets: "Listar resguardo",
  get_asset: "Ver activo",
  register_asset: "Registrar activo",
  assign_asset: "Entregar activo",
  return_asset: "Recibir devolución",
  list_areas: "Listar áreas",
  list_positions: "Listar puestos",
  list_activities: "Listar actividades",
  list_sites: "Listar sucursales",
  list_regions: "Listar regiones",
  create_catalog_item: "Crear en catálogo",
  link_position_activity: "Asignar actividad a puesto",
  unlink_position_activity: "Quitar actividad de puesto",
  get_onboarding: "Ver alta",
  start_onboarding: "Iniciar alta",
  approve_onboarding_step: "Aprobar etapa de alta",
  list_audit_events: "Consultar auditoría",
};

/** «Registrar activo»; a tool without a label comes back as it is. */
export const toolLabel = (name: string) => toolLabels[name] ?? name;
