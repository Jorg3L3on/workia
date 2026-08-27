export type PermissionAction =
  "read" | "create" | "update" | "delete" | "manage";

export type PermissionResource =
  | "users"
  | "roles"
  | "permissions"
  | "content"
  | "settings"
  | "people"
  | "audit"
  | "areas"
  | "positions"
  | "sites";

export type PermissionSlug = `${PermissionResource}:${PermissionAction}`;

export const PERMISSIONS: Array<{
  slug: PermissionSlug;
  name: string;
  resource: PermissionResource;
  action: PermissionAction;
  description: string;
}> = [
  {
    slug: "users:read",
    name: "Read Users",
    resource: "users",
    action: "read",
    description: "View user accounts",
  },
  {
    slug: "users:create",
    name: "Create Users",
    resource: "users",
    action: "create",
    description: "Create new user accounts",
  },
  {
    slug: "users:update",
    name: "Update Users",
    resource: "users",
    action: "update",
    description: "Edit existing user accounts",
  },
  {
    slug: "users:delete",
    name: "Delete Users",
    resource: "users",
    action: "delete",
    description: "Remove user accounts",
  },
  {
    slug: "roles:read",
    name: "Read Roles",
    resource: "roles",
    action: "read",
    description: "View roles and assignments",
  },
  {
    slug: "roles:create",
    name: "Create Roles",
    resource: "roles",
    action: "create",
    description: "Create new roles",
  },
  {
    slug: "roles:update",
    name: "Update Roles",
    resource: "roles",
    action: "update",
    description: "Edit role definitions and permissions",
  },
  {
    slug: "roles:delete",
    name: "Delete Roles",
    resource: "roles",
    action: "delete",
    description: "Remove roles",
  },
  {
    slug: "permissions:read",
    name: "Read Permissions",
    resource: "permissions",
    action: "read",
    description: "View the permission catalog",
  },
  {
    slug: "content:read",
    name: "Read Content",
    resource: "content",
    action: "read",
    description: "View published content",
  },
  {
    slug: "content:create",
    name: "Create Content",
    resource: "content",
    action: "create",
    description: "Create new content",
  },
  {
    slug: "content:update",
    name: "Update Content",
    resource: "content",
    action: "update",
    description: "Edit existing content",
  },
  {
    slug: "content:delete",
    name: "Delete Content",
    resource: "content",
    action: "delete",
    description: "Remove content",
  },
  {
    slug: "settings:read",
    name: "Read Settings",
    resource: "settings",
    action: "read",
    description: "View application settings",
  },
  {
    slug: "settings:update",
    name: "Update Settings",
    resource: "settings",
    action: "update",
    description: "Change application settings",
  },
  {
    slug: "people:read",
    name: "Read People",
    resource: "people",
    action: "read",
    description: "View people records",
  },
  {
    slug: "people:create",
    name: "Create People",
    resource: "people",
    action: "create",
    description: "Create new people records",
  },
  {
    slug: "people:update",
    name: "Update People",
    resource: "people",
    action: "update",
    description: "Edit existing people records",
  },
  {
    slug: "people:delete",
    name: "Delete People",
    resource: "people",
    action: "delete",
    description: "Logically delete people records",
  },
  {
    slug: "audit:read",
    name: "Read Audit",
    resource: "audit",
    action: "read",
    description: "View audit event history",
  },
  {
    slug: "areas:read",
    name: "Read Areas",
    resource: "areas",
    action: "read",
    description: "View organizational areas",
  },
  {
    slug: "areas:create",
    name: "Create Areas",
    resource: "areas",
    action: "create",
    description: "Create organizational areas",
  },
  {
    slug: "areas:update",
    name: "Update Areas",
    resource: "areas",
    action: "update",
    description: "Edit organizational areas",
  },
  {
    slug: "areas:delete",
    name: "Delete Areas",
    resource: "areas",
    action: "delete",
    description: "Logically delete organizational areas",
  },
  {
    slug: "positions:read",
    name: "Read Positions",
    resource: "positions",
    action: "read",
    description: "View job positions",
  },
  {
    slug: "positions:create",
    name: "Create Positions",
    resource: "positions",
    action: "create",
    description: "Create job positions",
  },
  {
    slug: "positions:update",
    name: "Update Positions",
    resource: "positions",
    action: "update",
    description: "Edit job positions",
  },
  {
    slug: "positions:delete",
    name: "Delete Positions",
    resource: "positions",
    action: "delete",
    description: "Logically delete job positions",
  },
  {
    slug: "sites:read",
    name: "Read Sites",
    resource: "sites",
    action: "read",
    description: "View work locations",
  },
  {
    slug: "sites:create",
    name: "Create Sites",
    resource: "sites",
    action: "create",
    description: "Create work locations",
  },
  {
    slug: "sites:update",
    name: "Update Sites",
    resource: "sites",
    action: "update",
    description: "Edit work locations",
  },
  {
    slug: "sites:delete",
    name: "Delete Sites",
    resource: "sites",
    action: "delete",
    description: "Logically delete work locations",
  },
];

export const ROLES = [
  {
    slug: "super_admin",
    name: "Super Admin",
    description: "Full access to all resources and administration",
    permissions: PERMISSIONS.map((permission) => permission.slug),
  },
  {
    slug: "admin",
    name: "Admin",
    description: "Manage users, roles, and application settings",
    permissions: [
      "users:read",
      "users:create",
      "users:update",
      "roles:read",
      "roles:update",
      "permissions:read",
      "content:read",
      "content:create",
      "content:update",
      "content:delete",
      "settings:read",
      "settings:update",
      "people:read",
      "people:create",
      "people:update",
      "people:delete",
      "audit:read",
      "areas:read",
      "areas:create",
      "areas:update",
      "areas:delete",
      "positions:read",
      "positions:create",
      "positions:update",
      "positions:delete",
      "sites:read",
      "sites:create",
      "sites:update",
      "sites:delete",
    ] satisfies PermissionSlug[],
  },
  {
    slug: "editor",
    name: "Editor",
    description: "Create and manage content",
    permissions: [
      "content:read",
      "content:create",
      "content:update",
      "settings:read",
      "people:read",
      "people:create",
      "people:update",
      "areas:read",
      "positions:read",
      "sites:read",
    ] satisfies PermissionSlug[],
  },
  {
    slug: "viewer",
    name: "Viewer",
    description: "Read-only access to content and settings",
    permissions: [
      "content:read",
      "settings:read",
      "people:read",
      "areas:read",
      "positions:read",
      "sites:read",
    ] satisfies PermissionSlug[],
  },
] as const;

export type RoleSlug = (typeof ROLES)[number]["slug"];

export const DEFAULT_USERS = [
  {
    email: "admin@workia.local",
    name: "System Admin",
    roleSlug: "super_admin" as RoleSlug,
    password: "Workia123!",
  },
  {
    email: "editor@workia.local",
    name: "Content Editor",
    roleSlug: "editor" as RoleSlug,
    password: "Workia123!",
  },
  {
    email: "viewer@workia.local",
    name: "Read Only User",
    roleSlug: "viewer" as RoleSlug,
    password: "Workia123!",
  },
];
