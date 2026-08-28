import { config } from "dotenv";
import bcrypt from "bcryptjs";

config({ path: ".env.local" });
config();

const seed = async () => {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { permissions, rolePermissions, roles, userRoles, users } =
    await import("@/lib/db/schema");
  const {
    DEFAULT_USERS,
    DEMO_PASSWORD,
    DEMO_RRHH_FALLBACK,
    PERMISSIONS,
    ROLES,
  } = await import("@/lib/db/schema/types");
  const { seedDemoCompany } = await import("./demo-company-seed");

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
    const passwordHash = await bcrypt.hash(user.password, 12);

    const [inserted] = await db
      .insert(users)
      .values({
        email: user.email,
        name: user.name,
        passwordHash,
      })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });

    const userId =
      inserted?.id ??
      (
        await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, user.email))
          .limit(1)
      )[0]?.id;

    const roleId = roleBySlug.get(user.roleSlug);

    if (!userId || !roleId) {
      continue;
    }

    await db.insert(userRoles).values({ userId, roleId }).onConflictDoNothing();
  }

  const rrhhEmail = process.env.DEMO_RRHH_EMAIL ?? DEMO_RRHH_FALLBACK.email;
  const rrhhPassword = process.env.DEMO_RRHH_PASSWORD ?? DEMO_PASSWORD;
  const rrhhFullName = process.env.DEMO_RRHH_NAME ?? DEMO_RRHH_FALLBACK.name;
  const rrhhRoleSlug = DEMO_RRHH_FALLBACK.roleSlug;

  const existingRrhh = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, rrhhEmail))
    .limit(1);

  let rrhhUserId = existingRrhh[0]?.id;

  if (!rrhhUserId) {
    const passwordHash = await bcrypt.hash(rrhhPassword, 12);

    const [created] = await db
      .insert(users)
      .values({
        email: rrhhEmail,
        name: rrhhFullName,
        passwordHash,
      })
      .returning({ id: users.id });

    rrhhUserId = created.id;
    console.log(`RRHH demo user created (${rrhhEmail}).`);
  } else if (process.env.DEMO_RRHH_PASSWORD) {
    const passwordHash = await bcrypt.hash(rrhhPassword, 12);

    await db
      .update(users)
      .set({ name: rrhhFullName, passwordHash })
      .where(eq(users.email, rrhhEmail));

    console.log(`RRHH demo user updated from DEMO_RRHH_* env (${rrhhEmail}).`);
  } else {
    await db
      .update(users)
      .set({ name: rrhhFullName })
      .where(eq(users.email, rrhhEmail));

    console.log(`RRHH demo user present — password unchanged (${rrhhEmail}).`);
  }

  const rrhhRoleId = roleBySlug.get(rrhhRoleSlug);

  if (rrhhUserId && rrhhRoleId) {
    await db
      .insert(userRoles)
      .values({ userId: rrhhUserId, roleId: rrhhRoleId })
      .onConflictDoNothing();
  }

  console.log("RBAC seed completed.");

  await seedDemoCompany();

  console.log("Seed finished. Use demo credentials documented in README.");
};

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
