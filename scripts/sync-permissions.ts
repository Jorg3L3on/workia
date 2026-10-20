/**
 * Sync the permission catalog and role grants with the code, and nothing else.
 *
 *   npm run db:sync-permissions
 *
 * The same two upserts scripts/seed.ts does first, without the demo users,
 * companies or data: what production needs after a release that adds
 * permissions (people:import and people:export in WRK-I3, members and
 * companies in WRK-I4). Re-running adds nothing. Never removes a permission
 * or a grant.
 *
 * A database that is not on this machine also needs --confirm-host <hostname>.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

const main = async () => {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  const { hostname } = new URL(url);
  const confirmIndex = process.argv.indexOf("--confirm-host");
  const confirmed =
    confirmIndex >= 0 ? process.argv[confirmIndex + 1] : undefined;

  if (!LOCAL_HOSTS.includes(hostname) && confirmed !== hostname) {
    throw new Error(
      `DATABASE_URL points to ${hostname}, which is not local. Pass --confirm-host ${hostname} if that is intended.`,
    );
  }

  const { db } = await import("@/lib/db");
  const { permissions, rolePermissions, roles } =
    await import("@/lib/db/schema");
  const { PERMISSIONS, ROLES } = await import("@/lib/db/schema/types");

  const before = (
    await db.select({ slug: permissions.slug }).from(permissions)
  ).map((row) => row.slug);

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
    permissionRows.map((row) => [row.slug, row.id]),
  );
  const added = permissionRows
    .map((row) => row.slug)
    .filter((slug) => !before.includes(slug));

  const roleRows = await db.select().from(roles);
  const roleBySlug = new Map(roleRows.map((row) => [row.slug, row.id]));
  const grants: string[] = [];

  for (const role of ROLES) {
    const roleId = roleBySlug.get(role.slug);

    if (!roleId) {
      console.log(`role ${role.slug} is not in the database; skipped`);
      continue;
    }

    for (const permissionSlug of role.permissions) {
      const permissionId = permissionBySlug.get(permissionSlug);

      if (!permissionId) {
        continue;
      }

      const result = await db
        .insert(rolePermissions)
        .values({ roleId, permissionId })
        .onConflictDoNothing()
        .returning({ roleId: rolePermissions.roleId });

      if (result.length > 0) {
        grants.push(`${role.slug} ← ${permissionSlug}`);
      }
    }
  }

  console.log(
    `Permissions on ${hostname}: ${permissionRows.length} total, ${added.length} added`,
  );

  for (const slug of added) {
    console.log(`  added ${slug}`);
  }

  console.log(`Role grants: ${grants.length} added`);

  for (const grant of grants) {
    console.log(`  ${grant}`);
  }

  process.exit(0);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
