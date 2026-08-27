import { config } from "dotenv";
import bcrypt from "bcryptjs";

config({ path: ".env.local" });
config();

const seed = async () => {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const {
    areas,
    permissions,
    people,
    positions,
    rolePermissions,
    roles,
    sites,
    userRoles,
    users,
  } = await import("@/lib/db/schema");
  const { DEFAULT_USERS, PERMISSIONS, ROLES } =
    await import("@/lib/db/schema/types");
  const { recordAuditEvent } = await import("@/lib/audit");

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

    await db
      .insert(users)
      .values({
        email: user.email,
        name: user.name,
        passwordHash,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          name: user.name,
          passwordHash,
        },
      });

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

  let operacionesId: string | undefined;
  let sucursalNorteId: string | undefined;
  let coordinadorId: string | undefined;

  const existingOperaciones = await db
    .select({ id: areas.id })
    .from(areas)
    .where(eq(areas.name, "Operaciones"))
    .limit(1);

  if (existingOperaciones.length === 0) {
    const [operaciones] = await db
      .insert(areas)
      .values({ name: "Operaciones", active: true })
      .returning({ id: areas.id });

    operacionesId = operaciones.id;

    await recordAuditEvent({
      resourceType: "area",
      resourceId: operaciones.id,
      action: "create",
      source: "seed",
      payload: { summary: "Área demo: Operaciones" },
    });

    const [sucursalNorte] = await db
      .insert(areas)
      .values({
        name: "Sucursal Norte",
        parentAreaId: operaciones.id,
        active: true,
      })
      .returning({ id: areas.id });

    sucursalNorteId = sucursalNorte.id;

    await recordAuditEvent({
      resourceType: "area",
      resourceId: sucursalNorte.id,
      action: "create",
      source: "seed",
      payload: { summary: "Área demo: Sucursal Norte" },
    });

    console.log("Demo areas seed completed (Operaciones → Sucursal Norte).");
  } else {
    operacionesId = existingOperaciones[0].id;

    const existingSucursal = await db
      .select({ id: areas.id })
      .from(areas)
      .where(eq(areas.name, "Sucursal Norte"))
      .limit(1);

    sucursalNorteId = existingSucursal[0]?.id;
  }

  const targetAreaId = sucursalNorteId ?? operacionesId;

  const existingPosition = await db
    .select({ id: positions.id })
    .from(positions)
    .where(eq(positions.name, "Coordinador Demo"))
    .limit(1);

  if (existingPosition.length === 0 && targetAreaId) {
    const [position] = await db
      .insert(positions)
      .values({
        name: "Coordinador Demo",
        areaId: targetAreaId,
        active: true,
      })
      .returning({ id: positions.id });

    coordinadorId = position.id;

    await recordAuditEvent({
      resourceType: "position",
      resourceId: position.id,
      action: "create",
      source: "seed",
      payload: { summary: "Puesto demo: Coordinador Demo" },
    });

    console.log("Demo position seed completed.");
  } else {
    coordinadorId = existingPosition[0]?.id;
  }

  let demoSucursalSiteId: string | undefined;

  const existingCorporativo = await db
    .select({ id: sites.id })
    .from(sites)
    .where(eq(sites.name, "Corporativo Demo"))
    .limit(1);

  if (existingCorporativo.length === 0) {
    const [corporativo] = await db
      .insert(sites)
      .values({ name: "Corporativo Demo", kind: "corporativo" })
      .returning({ id: sites.id });

    await recordAuditEvent({
      resourceType: "site",
      resourceId: corporativo.id,
      action: "create",
      source: "seed",
      payload: { summary: "Ubicación demo: Corporativo Demo" },
    });

    console.log("Demo site seed completed (Corporativo Demo).");
  }

  const existingSucursal = await db
    .select({ id: sites.id })
    .from(sites)
    .where(eq(sites.name, "Sucursal Demo Norte"))
    .limit(1);

  if (existingSucursal.length === 0) {
    const [sucursal] = await db
      .insert(sites)
      .values({ name: "Sucursal Demo Norte", kind: "sucursal" })
      .returning({ id: sites.id });

    demoSucursalSiteId = sucursal.id;

    await recordAuditEvent({
      resourceType: "site",
      resourceId: sucursal.id,
      action: "create",
      source: "seed",
      payload: { summary: "Ubicación demo: Sucursal Demo Norte" },
    });

    console.log("Demo site seed completed (Sucursal Demo Norte).");
  } else {
    demoSucursalSiteId = existingSucursal[0].id;
  }

  const existingPeople = await db
    .select({ id: people.id, siteId: people.siteId })
    .from(people)
    .limit(1);

  if (existingPeople.length === 0) {
    const [demoPerson] = await db
      .insert(people)
      .values({
        nombres: "Persona",
        apellidoPaterno: "Demo",
        email: "persona.demo@ejemplo.local",
        fechaIngreso: "2024-01-15",
        areaId: targetAreaId ?? null,
        positionId: coordinadorId ?? null,
        siteId: demoSucursalSiteId ?? null,
        status: "activa",
      })
      .returning({ id: people.id });

    await recordAuditEvent({
      resourceType: "person",
      resourceId: demoPerson.id,
      action: "create",
      source: "seed",
      payload: {
        summary: "Persona demo de expediente",
      },
    });

    console.log("Demo person seed completed (Persona Demo).");
  } else if (!existingPeople[0].siteId && demoSucursalSiteId) {
    await db
      .update(people)
      .set({ siteId: demoSucursalSiteId })
      .where(eq(people.id, existingPeople[0].id));

    console.log("Assigned Sucursal Demo Norte to Persona Demo.");
  }

  console.log("Demo password for seeded users: Workia123!");
};

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
