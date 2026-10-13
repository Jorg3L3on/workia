/**
 * Two complete companies, A and B, with the same shape of data, for
 * cross-company (IDOR) tests: company B's session asks for company A's
 * records and must get "not found" or "not allowed", with no effect.
 * Runs against the throwaway database of `npm run test:db`.
 */
import { createHash, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/lib/db/schema";
import {
  activities,
  areas,
  assetMovements,
  assets,
  auditEvents,
  companies,
  companyMemberships,
  contractTemplates,
  contracts,
  importJobs,
  importRows,
  people,
  permissions,
  personSchedules,
  positionActivities,
  positions,
  rolePermissions,
  roles,
  sites,
  users,
} from "@/lib/db/schema";
import { PERMISSIONS, ROLES } from "@/lib/db/schema/types";

/**
 * The test's own connection, as the database owner: fixtures and assertions
 * see every company's rows even when the app runs under row-level security.
 */
export const ownerDb = drizzle(
  new Pool({
    connectionString:
      process.env.TEST_OWNER_DATABASE_URL ?? process.env.DATABASE_URL,
  }),
  { schema },
);
const db = ownerDb;

/** Permissions and role templates, as the seed creates them. Idempotent. */
export const seedRbac = async () => {
  for (const permission of PERMISSIONS) {
    await db
      .insert(permissions)
      .values(permission)
      .onConflictDoNothing({ target: permissions.slug });
  }

  for (const role of ROLES) {
    await db
      .insert(roles)
      .values({ slug: role.slug, name: role.name })
      .onConflictDoNothing({ target: roles.slug });
  }

  const permissionRows = await db.select().from(permissions);
  const roleRows = await db.select().from(roles);
  const permissionBySlug = new Map(permissionRows.map((p) => [p.slug, p.id]));
  const roleBySlug = new Map(roleRows.map((r) => [r.slug, r.id]));

  for (const role of ROLES) {
    for (const slug of role.permissions) {
      await db
        .insert(rolePermissions)
        .values({
          roleId: roleBySlug.get(role.slug)!,
          permissionId: permissionBySlug.get(slug)!,
        })
        .onConflictDoNothing();
    }
  }

  return roleBySlug;
};

export type Tenant = Awaited<ReturnType<typeof seedTenant>>;

/** One company with one record of every kind and two users (admin, viewer). */
export const seedTenant = async (label: string) => {
  const roleBySlug = await seedRbac();
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const [company] = await db
    .insert(companies)
    .values({ name: `Empresa ${label}`, slug: `idor-${suffix}`.toLowerCase() })
    .returning();
  const companyId = company.id;

  const user = async (role: string) => {
    const [row] = await db
      .insert(users)
      .values({
        email: `${role}-${suffix}@idor.test`,
        name: `${role} ${label}`,
      })
      .returning();
    const [membership] = await db
      .insert(companyMemberships)
      .values({
        userId: row.id,
        companyId,
        roleId: roleBySlug.get(role)!,
        isDefault: true,
      })
      .returning();
    return { id: row.id, email: row.email, membershipId: membership.id };
  };

  const admin = await user("admin");
  const viewer = await user("viewer");

  const [area] = await db
    .insert(areas)
    .values({ companyId, name: `Área ${label}` })
    .returning();
  const [position] = await db
    .insert(positions)
    .values({ companyId, name: `Puesto ${label}`, areaId: area.id })
    .returning();
  const [activity] = await db
    .insert(activities)
    .values({ companyId, name: `Actividad ${label}` })
    .returning();
  await db
    .insert(positionActivities)
    .values({ companyId, positionId: position.id, activityId: activity.id });
  const [site] = await db
    .insert(sites)
    .values({ companyId, name: `Sucursal ${label}`, kind: "sucursal" })
    .returning();
  const [person] = await db
    .insert(people)
    .values({
      companyId,
      nombres: `Persona ${label}`,
      apellidoPaterno: "Idor",
      curp: `CURP${label}000000000000`.slice(0, 18).toUpperCase(),
      rfc: `RFC${label}00000000`.slice(0, 13).toUpperCase(),
      nss: `${label === "A" ? 1 : 2}0000000000`,
      areaId: area.id,
      positionId: position.id,
      siteId: site.id,
    })
    .returning();
  const [teammate] = await db
    .insert(people)
    .values({
      companyId,
      nombres: `Compañera ${label}`,
      apellidoPaterno: "Idor",
      managerId: person.id,
    })
    .returning();
  const [schedule] = await db
    .insert(personSchedules)
    .values({ companyId, personId: person.id, entrada: "09:00" })
    .returning();
  const [template] = await db
    .insert(contractTemplates)
    .values({
      companyId,
      name: `Plantilla ${label}`,
      body: "Contrato de {{nombres}}",
    })
    .returning();
  const soon = new Date(Date.now() + 10 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [contract] = await db
    .insert(contracts)
    .values({
      companyId,
      personId: person.id,
      type: "determinado",
      startDate: "2026-01-01",
      endDate: soon,
      noticeWindow: "1",
      templateId: template.id,
      templateName: template.name,
      generatedText: "texto",
    })
    .returning();
  const [asset] = await db
    .insert(assets)
    .values({
      companyId,
      name: `Laptop ${label}`,
      identifier: `LP-${suffix}`,
      category: "laptop",
      holderId: person.id,
      status: "asignado",
    })
    .returning();
  const [freeAsset] = await db
    .insert(assets)
    .values({
      companyId,
      name: `Moto ${label}`,
      identifier: `MT-${suffix}`,
      category: "moto",
    })
    .returning();
  await db.insert(assetMovements).values({
    companyId,
    assetId: asset.id,
    type: "entrega",
    personId: person.id,
    movementDate: "2026-01-02",
    conditionNote: "nueva",
  });
  await db.insert(auditEvents).values({
    companyId,
    actorUserId: admin.id,
    resourceType: "person",
    resourceId: person.id,
    action: "create",
    payload: { summary: `Alta ${label}` },
  });
  const [reviewJob] = await db
    .insert(importJobs)
    .values({
      companyId,
      fileName: `personas-${label}.xlsx`,
      fileHash: createHash("sha256").update(`review-${suffix}`).digest("hex"),
      status: "in_review",
      actorUserId: admin.id,
      counts: { total: 1 },
    })
    .returning();
  const [uploadingJob] = await db
    .insert(importJobs)
    .values({
      companyId,
      fileName: `subiendo-${label}.xlsx`,
      fileHash: createHash("sha256").update(`upload-${suffix}`).digest("hex"),
      status: "uploading",
      actorUserId: admin.id,
      counts: { total: 1 },
    })
    .returning();
  await db.insert(importRows).values({
    companyId,
    jobId: reviewJob.id,
    sheet: "personas",
    rowNumber: 2,
    raw: { nombres: "Fila", apellidoPaterno: label },
    action: "error",
    errors: [{ message: "error de prueba" }],
  });

  return {
    label,
    companyId,
    company,
    admin,
    viewer,
    area,
    position,
    activity,
    site,
    person,
    teammate,
    schedule,
    template,
    contract,
    asset,
    freeAsset,
    reviewJob,
    uploadingJob,
  };
};

/** Every id of a tenant's records, to assert none leaks into another company's results. */
export const tenantIds = (tenant: Tenant) =>
  new Set(
    [
      tenant.area,
      tenant.position,
      tenant.activity,
      tenant.site,
      tenant.person,
      tenant.teammate,
      tenant.schedule,
      tenant.template,
      tenant.contract,
      tenant.asset,
      tenant.freeAsset,
      tenant.reviewJob,
      tenant.uploadingJob,
    ].map((row) => row.id),
  );

/** Collects every uuid-looking string in a value (rows, nested objects). */
export const idsIn = (value: unknown): string[] => {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(node)) found.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node instanceof Map) {
      [...node.keys(), ...node.values()].forEach(walk);
    } else if (node && typeof node === "object" && !(node instanceof Date)) {
      Object.values(node).forEach(walk);
    }
  };
  walk(value);
  return found;
};

/** A fresh read of rows that must stay untouched by a refused write. */
export const snapshotTenant = async (tenant: Tenant) => ({
  person: (
    await db.select().from(people).where(eq(people.id, tenant.person.id))
  )[0],
  teammate: (
    await db.select().from(people).where(eq(people.id, tenant.teammate.id))
  )[0],
  area: (await db.select().from(areas).where(eq(areas.id, tenant.area.id)))[0],
  position: (
    await db
      .select()
      .from(positions)
      .where(eq(positions.id, tenant.position.id))
  )[0],
  activity: (
    await db
      .select()
      .from(activities)
      .where(eq(activities.id, tenant.activity.id))
  )[0],
  site: (await db.select().from(sites).where(eq(sites.id, tenant.site.id)))[0],
  template: (
    await db
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.id, tenant.template.id))
  )[0],
  contract: (
    await db
      .select()
      .from(contracts)
      .where(eq(contracts.id, tenant.contract.id))
  )[0],
  asset: (
    await db.select().from(assets).where(eq(assets.id, tenant.asset.id))
  )[0],
  freeAsset: (
    await db.select().from(assets).where(eq(assets.id, tenant.freeAsset.id))
  )[0],
  schedule: (
    await db
      .select()
      .from(personSchedules)
      .where(eq(personSchedules.id, tenant.schedule.id))
  )[0],
  reviewJob: (
    await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, tenant.reviewJob.id))
  )[0],
  uploadingJob: (
    await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, tenant.uploadingJob.id))
  )[0],
  positionActivities: await db
    .select()
    .from(positionActivities)
    .where(eq(positionActivities.positionId, tenant.position.id)),
  memberships: await db
    .select()
    .from(companyMemberships)
    .where(eq(companyMemberships.companyId, tenant.companyId)),
  company: (
    await db.select().from(companies).where(eq(companies.id, tenant.companyId))
  )[0],
});
