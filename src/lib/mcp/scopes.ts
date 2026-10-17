import type { PermissionSlug } from "@/lib/db/schema/types";

/**
 * Least-privilege scopes of the connector (spec §6). A tool runs only when the
 * connection holds its scope AND the user's role in the connection's company
 * holds its permission (D-08); ChatGPT connections are also capped (D-01).
 */
export const MCP_SCOPES = [
  "read",
  "pii",
  "audit",
  "write:people",
  "write:contracts",
  "write:assets",
  "write:catalog",
  "offline_access",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const isMcpScope = (value: string): value is McpScope =>
  (MCP_SCOPES as readonly string[]).includes(value);

export const WRITE_SCOPES = [
  "write:people",
  "write:contracts",
  "write:assets",
  "write:catalog",
] as const satisfies McpScope[];

export const isWriteScope = (scope: McpScope) =>
  (WRITE_SCOPES as readonly McpScope[]).includes(scope);

export const scopeLabels: Record<McpScope, { label: string; hint: string }> = {
  read: {
    label: "Leer",
    hint: "Personas, contratos, resguardo y catálogo, con datos personales enmascarados.",
  },
  pii: {
    label: "Datos personales completos",
    hint: "RFC, CURP, NSS, teléfono, correo y fecha de nacimiento sin enmascarar.",
  },
  audit: {
    label: "Auditoría",
    hint: "Consultar la bitácora de cambios.",
  },
  "write:people": {
    label: "Escribir personas",
    hint: "Altas y cambios de expediente, estatus y horario.",
  },
  "write:contracts": {
    label: "Escribir contratos",
    hint: "Emitir, renovar y marcar «no renovar».",
  },
  "write:assets": {
    label: "Escribir resguardo",
    hint: "Registrar, entregar y devolver activos.",
  },
  "write:catalog": {
    label: "Escribir catálogo",
    hint: "Crear áreas, puestos, sucursales y actividades.",
  },
  offline_access: {
    label: "Mantener la sesión",
    hint: "El asistente renueva su acceso sin volver a pedirte permiso (30 días).",
  },
};

/**
 * Permissions a scope needs before it is offered: a role that cannot use it
 * never sees it. `pii` follows D-09 (any role with people:update).
 */
const SCOPE_REQUIREMENTS: Record<McpScope, PermissionSlug[]> = {
  read: [],
  pii: ["people:update"],
  audit: ["audit:read"],
  "write:people": ["people:create", "people:update"],
  "write:contracts": ["contracts:create", "contracts:update"],
  "write:assets": ["assets:create", "assets:update"],
  "write:catalog": [
    "areas:create",
    "positions:create",
    "positions:update",
    "sites:create",
  ],
  offline_access: [],
};

/** Scopes a user with `permissions` may grant (any one requirement is enough). */
export const grantableScopes = (permissions: ReadonlySet<string>): McpScope[] =>
  MCP_SCOPES.filter((scope) => {
    const required = SCOPE_REQUIREMENTS[scope];
    return (
      required.length === 0 ||
      required.some((permission) => permissions.has(permission))
    );
  });

export type ClientCeiling = {
  isChatgpt: boolean;
  /** A super_admin may turn pii on for ChatGPT, with a warning (D-01, D-09). */
  allowChatgptPii?: boolean;
};

/**
 * The client's ceiling. ChatGPT gets at most read (+ audit, + offline_access to
 * refresh); pii only when a super_admin chose it; write:* never. Other clients
 * are not capped here (D-05): the consenting user's role still applies.
 */
export const applyClientCeiling = (
  scopes: readonly McpScope[],
  ceiling: ClientCeiling,
): McpScope[] => {
  if (!ceiling.isChatgpt) {
    return [...new Set(scopes)];
  }

  const allowed = new Set<McpScope>(["read", "audit", "offline_access"]);

  if (ceiling.allowChatgptPii) {
    allowed.add("pii");
  }

  return [...new Set(scopes.filter((scope) => allowed.has(scope)))];
};

/** Parses a space-separated scope parameter; unknown values are dropped, read is implied. */
export const parseScopeParam = (value: string | null | undefined) => {
  const scopes = (value ?? "")
    .split(/[\s+]+/)
    .filter(Boolean)
    .filter(isMcpScope);

  return [...new Set<McpScope>(["read", ...scopes])];
};

/**
 * The scope a permission needs to be usable through the connector. Null: the
 * permission never applies to MCP (deletes, imports, members, settings… D-07).
 */
export const scopeForPermission = (
  permission: PermissionSlug,
): McpScope | null => {
  const [resource, action] = permission.split(":") as [string, string];

  if (permission === "audit:read") {
    return "audit";
  }

  const readable = [
    "people",
    "areas",
    "positions",
    "sites",
    "contracts",
    "contract_templates",
    "assets",
  ];

  if (action === "read" && readable.includes(resource)) {
    return "read";
  }

  if (action !== "create" && action !== "update") {
    return null;
  }

  switch (resource) {
    case "people":
      return "write:people";
    case "contracts":
      return "write:contracts";
    case "assets":
      return "write:assets";
    case "areas":
    case "positions":
    case "sites":
      return "write:catalog";
    default:
      return null;
  }
};

/** Permissions usable through this connection: the role's ∩ what the scopes cover. */
export const effectivePermissions = (
  permissions: Iterable<PermissionSlug>,
  scopes: readonly McpScope[],
): PermissionSlug[] => {
  const held = new Set(scopes);

  return [...permissions]
    .filter((permission) => {
      const scope = scopeForPermission(permission);
      return scope !== null && held.has(scope);
    })
    .sort();
};
