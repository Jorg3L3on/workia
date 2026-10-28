/**
 * Permission slugs in words for the admin screens (WRK-I6-7): «areas:read»
 * reads «Leer áreas». The slug stays available as a tooltip.
 */

const actionLabels: Record<string, string> = {
  read: "Leer",
  create: "Crear",
  update: "Editar",
  delete: "Eliminar",
  manage: "Gestionar",
  import: "Importar",
  export: "Exportar",
  approve: "Aprobar",
};

const resourceLabels: Record<string, string> = {
  areas: "áreas",
  assets: "resguardo",
  audit: "auditoría",
  companies: "empresas",
  compensation: "sueldos",
  content: "contenido",
  contract_templates: "plantillas de contrato",
  contracts: "contratos",
  documents: "documentos",
  mcp_connections: "conexiones",
  members: "miembros",
  payroll: "altas de Nóminas",
  people: "personas",
  permissions: "permisos",
  positions: "puestos",
  reports: "reportes",
  roles: "roles",
  settings: "configuración",
  sites: "sucursales",
  users: "usuarios",
};

/** «Leer áreas»; an unknown slug comes back as it is. */
export const permissionLabel = (slug: string) => {
  const [resource = "", action = ""] = slug.split(":");
  const verb = actionLabels[action];
  const noun = resourceLabels[resource];

  return verb && noun ? `${verb} ${noun}` : slug;
};
