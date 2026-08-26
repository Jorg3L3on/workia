import { config } from "dotenv";

config({ path: ".env.local" });
config();

const seed = async () => {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const {
    permissions,
    rolePermissions,
    roles,
    userRoles,
    users,
  } = await import("@/lib/db/schema");
  const { DEFAULT_USERS, PERMISSIONS, ROLES } = await import(
    "@/lib/db/schema/types"
  );

  console.log("Seeding RBAC data...");

  for (const permission of PERMISSIONS) {
    await db
      .insert(permissions)
      .values({
        slug: permission.slug,
        name: permission.name,
        resource: permission.resource,
        action: permission.action,
        description: permission.description,
      })
      .onConflictDoNothing({ target: permissions.slug });
  }

  const permissionRows = await db.select().from(permissions);
  const permissionBySlug = new Map(
    permissionRows.map((permission) => [permission.slug, permission.id]),
  );

  for (const role of ROLES) {
    await db
      .insert(roles)
      .values({
        slug: role.slug,
        name: role.name,
        description: role.description,
      })
      .onConflictDoNothing({ target: roles.slug });
  }

  const roleRows = await db.select().from(roles);
  const roleBySlug = new Map(roleRows.map((role) => [role.slug, role.id]));

  for (const role of ROLES) {
    const roleId = roleBySlug.get(role.slug);

    if (!roleId) {
      continue;
    }

    for (const permissionSlug of role.permissions) {
      const permissionId = permissionBySlug.get(permissionSlug);

      if (!permissionId) {
        continue;
      }

      await db
        .insert(rolePermissions)
        .values({ roleId, permissionId })
        .onConflictDoNothing();
    }
  }

  for (const user of DEFAULT_USERS) {
    await db
      .insert(users)
      .values({
        email: user.email,
        name: user.name,
      })
      .onConflictDoNothing({ target: users.email });

    const [createdUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, user.email))
      .limit(1);

    const roleId = roleBySlug.get(user.roleSlug);

    if (!createdUser || !roleId) {
      continue;
    }

    await db
      .insert(userRoles)
      .values({ userId: createdUser.id, roleId })
      .onConflictDoNothing();
  }

  console.log("RBAC seed completed.");
};

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
