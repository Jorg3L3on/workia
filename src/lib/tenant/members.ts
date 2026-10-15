import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { companyMemberships, roles, users } from "@/lib/db/schema";

/** A membership change that cannot be made; the message is ready to show. */
export class MemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberError";
  }
}

/** Roles that can manage members; a company always keeps at least one active. */
const MANAGER_ROLES = ["admin", "super_admin"] as const;

const isManagerRole = (roleSlug: string) =>
  (MANAGER_ROLES as readonly string[]).includes(roleSlug);

/** Refuses leaving the company with no active admin (revoke or demote the last one). */
const assertKeepsAnAdmin = async (
  companyId: string,
  membership: { id: string; roleSlug: string },
  nextRoleSlug: string | null,
) => {
  if (
    !isManagerRole(membership.roleSlug) ||
    (nextRoleSlug && isManagerRole(nextRoleSlug))
  ) {
    return;
  }

  const [other] = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .innerJoin(roles, eq(roles.id, companyMemberships.roleId))
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.status, "activa"),
        ne(companyMemberships.id, membership.id),
        inArray(roles.slug, [...MANAGER_ROLES]),
      ),
    )
    .limit(1);

  if (!other) {
    throw new MemberError(
      "Es la última persona administradora de la empresa. Agrega otra antes de quitarle el acceso o el rol.",
    );
  }
};

/** Roles a company admin may hand out. super_admin is assigned by the platform only. */
export const COMPANY_ASSIGNABLE_ROLES = ["admin", "editor", "viewer"] as const;

export const isCompanyAssignableRole = (roleSlug: string) =>
  (COMPANY_ASSIGNABLE_ROLES as readonly string[]).includes(roleSlug);

export type MemberRow = Awaited<ReturnType<typeof listCompanyMembers>>[number];

export const listCompanyMembers = async (companyId: string) =>
  db
    .select({
      id: companyMemberships.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      roleSlug: roles.slug,
      roleName: roles.name,
      status: companyMemberships.status,
      isDefault: companyMemberships.isDefault,
      createdAt: companyMemberships.createdAt,
    })
    .from(companyMemberships)
    .innerJoin(users, eq(users.id, companyMemberships.userId))
    .innerJoin(roles, eq(roles.id, companyMemberships.roleId))
    .where(eq(companyMemberships.companyId, companyId))
    .orderBy(asc(companyMemberships.status), asc(users.name));

export const listRoles = async () =>
  db
    .select({ id: roles.id, slug: roles.slug, name: roles.name })
    .from(roles)
    .orderBy(asc(roles.name));

type ChangeOptions = {
  /** Platform admins may also assign super_admin and edit their own membership. */
  platform?: boolean;
};

const roleIdFor = async (roleSlug: string, options: ChangeOptions) => {
  if (!options.platform && !isCompanyAssignableRole(roleSlug)) {
    throw new MemberError(
      "Ese rol solo lo asigna la administración de la plataforma.",
    );
  }

  const [role] = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(eq(roles.slug, roleSlug))
    .limit(1);

  if (!role) {
    throw new MemberError("El rol no existe.");
  }

  return role;
};

const getMembership = async (companyId: string, membershipId: string) => {
  const [membership] = await db
    .select({
      id: companyMemberships.id,
      userId: companyMemberships.userId,
      roleId: companyMemberships.roleId,
      status: companyMemberships.status,
      email: users.email,
      roleSlug: roles.slug,
    })
    .from(companyMemberships)
    .innerJoin(users, eq(users.id, companyMemberships.userId))
    .innerJoin(roles, eq(roles.id, companyMemberships.roleId))
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.id, membershipId),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new MemberError("No encontramos a ese miembro en esta empresa.");
  }

  return membership;
};

/** Company admins change neither their own access nor that of a role above theirs. */
const assertCanChange = (
  membership: { userId: string; roleSlug: string },
  actorUserId: string,
  options: ChangeOptions,
) => {
  if (options.platform) {
    return;
  }

  if (membership.userId === actorUserId) {
    throw new MemberError(
      "No puedes cambiar tu propio acceso; pídeselo a otra persona administradora.",
    );
  }

  if (!isCompanyAssignableRole(membership.roleSlug)) {
    throw new MemberError(
      "El acceso de esa persona solo lo cambia la administración de la plataforma.",
    );
  }
};

const audit = (
  companyId: string,
  actorUserId: string,
  membershipId: string,
  action: "create" | "update" | "deactivate" | "reactivate",
  summary: string,
  after: Record<string, unknown>,
) =>
  recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "membership",
    resourceId: membershipId,
    action,
    payload: { summary, after },
  });

/**
 * Gives a person access to the company. Without an account yet, one is
 * created for the email (no password): they sign in with Google using that
 * email and land in this company.
 */
export const addMember = async (
  companyId: string,
  input: { email: string; roleSlug: string },
  actorUserId: string,
  options: ChangeOptions = {},
) => {
  const email = input.email.trim().toLowerCase();
  const role = await roleIdFor(input.roleSlug, options);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MemberError("Escribe un correo válido.");
  }

  const [found] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  const user =
    found ??
    (
      await db
        .insert(users)
        .values({ email, name: email.split("@")[0] })
        .returning({ id: users.id, name: users.name })
    )[0];

  const [existing] = await db
    .select({ id: companyMemberships.id, status: companyMemberships.status })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.userId, user.id),
      ),
    )
    .limit(1);

  if (existing?.status === "activa") {
    throw new MemberError("Esa persona ya es miembro de la empresa.");
  }

  // Their first company becomes the one they land in.
  const [hasDefault] = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.userId, user.id),
        eq(companyMemberships.isDefault, true),
        existing ? ne(companyMemberships.id, existing.id) : undefined,
      ),
    )
    .limit(1);

  const values = {
    roleId: role.id,
    status: "activa" as const,
    isDefault: !hasDefault,
  };
  const [membership] = existing
    ? await db
        .update(companyMemberships)
        .set(values)
        .where(eq(companyMemberships.id, existing.id))
        .returning()
    : await db
        .insert(companyMemberships)
        .values({ ...values, companyId, userId: user.id })
        .returning();

  await audit(
    companyId,
    actorUserId,
    membership.id,
    existing ? "reactivate" : "create",
    `Acceso a la empresa: ${email} como ${role.name}`,
    { email, role: input.roleSlug },
  );

  return membership;
};

export const changeMemberRole = async (
  companyId: string,
  membershipId: string,
  roleSlug: string,
  actorUserId: string,
  options: ChangeOptions = {},
) => {
  const membership = await getMembership(companyId, membershipId);
  assertCanChange(membership, actorUserId, options);
  const role = await roleIdFor(roleSlug, options);
  await assertKeepsAnAdmin(companyId, membership, roleSlug);

  await db
    .update(companyMemberships)
    .set({ roleId: role.id })
    .where(eq(companyMemberships.id, membership.id));

  await audit(
    companyId,
    actorUserId,
    membership.id,
    "update",
    `Cambio de rol: ${membership.email} ahora es ${role.name}`,
    { email: membership.email, role: roleSlug },
  );
};

/** Revoking applies on the member's next request: the guard re-reads memberships every time. */
export const revokeMember = async (
  companyId: string,
  membershipId: string,
  actorUserId: string,
  options: ChangeOptions = {},
) => {
  const membership = await getMembership(companyId, membershipId);
  assertCanChange(membership, actorUserId, options);
  await assertKeepsAnAdmin(companyId, membership, null);

  await db
    .update(companyMemberships)
    .set({ status: "revocada", isDefault: false })
    .where(eq(companyMemberships.id, membership.id));

  await audit(
    companyId,
    actorUserId,
    membership.id,
    "deactivate",
    `Acceso revocado: ${membership.email}`,
    { email: membership.email, status: "revocada" },
  );
};
