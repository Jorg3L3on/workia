import { config } from "dotenv";
import bcrypt from "bcryptjs";

config({ path: ".env.local" });
config();

const SECOND_DEMO_COMPANY = {
  name: "Comercial del Norte",
  slug: "comercial-del-norte",
  legalName: "Comercial del Norte Demo, S.A. de C.V.",
};

const seed = async () => {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { companyMemberships, permissions, rolePermissions, roles, users } =
    await import("@/lib/db/schema");
  const { DEFAULT_COMPANY, ensureCompany } =
    await import("@/lib/tenant/companies");
  const {
    DEFAULT_USERS,
    DEMO_PASSWORD,
    DEMO_RRHH_FALLBACK,
    PERMISSIONS,
    ROLES,
  } = await import("@/lib/db/schema/types");
  const {
    seedDemoActivities,
    seedDemoCompany,
    seedDemoResguardo,
    seedDemoSchedules,
  } = await import("./demo-company-seed");
  const { cleanupBorradosResidue, ensureOfficialDeletedDemoPerson } =
    await import("./cleanup-borrados-residue");

  const isLocalDatabase = ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(process.env.DATABASE_URL ?? "postgresql://x@localhost/x").hostname,
  );
  // A second demo company shows isolation locally; never created in production
  // unless asked for explicitly.
  const seedSecondCompany =
    isLocalDatabase || process.env.SEED_DEMO_SECOND_COMPANY === "1";

  const defaultCompany = await ensureCompany(DEFAULT_COMPANY);
  const secondCompany = seedSecondCompany
    ? await ensureCompany(SECOND_DEMO_COMPANY)
    : null;

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

  /** Membership of `userId` in `companyId` with `roleSlug`; re-running keeps it in sync. */
  const addMembership = async (
    userId: string,
    companyId: string,
    roleSlug: string,
    isDefault: boolean,
  ) => {
    const roleId = roleBySlug.get(roleSlug);

    if (!roleId) {
      return;
    }

    await db
      .insert(companyMemberships)
      .values({ userId, companyId, roleId, isDefault })
      .onConflictDoUpdate({
        target: [companyMemberships.userId, companyMemberships.companyId],
        set: { roleId, status: "activa" },
      });
  };

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

    if (!userId) {
      continue;
    }

    await addMembership(userId, defaultCompany.id, user.roleSlug, true);

    if (user.roleSlug === "super_admin") {
      // The demo super admin also runs the platform (companies, members).
      await db
        .update(users)
        .set({ isPlatformAdmin: true })
        .where(eq(users.id, userId));

      if (secondCompany) {
        await addMembership(userId, secondCompany.id, "admin", false);
      }
    }
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

  if (rrhhUserId) {
    await addMembership(rrhhUserId, defaultCompany.id, rrhhRoleSlug, true);

    // Same person, another role elsewhere: admin here, viewer there.
    if (secondCompany) {
      await addMembership(rrhhUserId, secondCompany.id, "viewer", false);
    }
  }

  console.log("RBAC seed completed.");

  await seedDemoCompany(defaultCompany.id);
  await seedDemoResguardo(defaultCompany.id);
  await seedDemoActivities(defaultCompany.id);
  await seedDemoSchedules(defaultCompany.id);
  await cleanupBorradosResidue();
  await ensureOfficialDeletedDemoPerson(defaultCompany.id);

  if (secondCompany) {
    await seedDemoCompany(secondCompany.id, { personIndexOffset: 40 });
    await seedDemoResguardo(secondCompany.id);
    await seedDemoActivities(secondCompany.id);
    console.log(`Second demo company seeded: ${secondCompany.name}.`);
  }

  console.log("Seed finished. Use demo credentials documented in README.");
};

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
