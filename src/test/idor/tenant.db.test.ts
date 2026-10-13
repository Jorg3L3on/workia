/**
 * Company context, membership administration and audit isolation
 * (WRK-I4-6, WRK-I4-12, WRK-I4-14). Test titles are the surface ids of
 * docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  countAuditEvents,
  listAuditActors,
  listAuditEvents,
} from "@/lib/audit";
import { db } from "@/lib/db";
import {
  auditEvents,
  companies,
  companyMemberships,
  users,
} from "@/lib/db/schema";
import { createPerson } from "@/lib/people";
import { userHasPermission } from "@/lib/rbac";
import {
  addMemberAction,
  changeMemberRoleAction,
  createCompanyAction,
  revokeMemberAction,
  setCompanyStatusAction,
  updateCompanyAction,
} from "@/lib/tenant/admin-actions";
import { switchCompanyAction } from "@/lib/tenant/actions";
import { getCompanyContext, requireCompanyContext } from "@/lib/tenant/context";
import {
  addMember,
  changeMemberRole,
  listCompanyMembers,
  revokeMember,
} from "@/lib/tenant/members";

import {
  idsIn,
  seedRbac,
  seedTenant,
  snapshotTenant,
  tenantIds,
  type Tenant,
} from "./fixtures";
import { actAs, sessionState } from "./session-state";

let a: Tenant;
let b: Tenant;

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const redirectOf = async (run: () => Promise<unknown>) => {
  try {
    return await run();
  } catch (error) {
    return (error as { url?: string }).url ?? String(error);
  }
};

const newUser = async (email: string) =>
  (await db.insert(users).values({ email, name: email }).returning())[0];

beforeAll(async () => {
  a = await seedTenant("A");
  b = await seedTenant("B");
});

describe("audit stays inside the company", () => {
  it("lists and counts only the active company's events", async () => {
    const events = await listAuditEvents({
      companyId: b.companyId,
      limit: 500,
    });
    expect(idsIn(events).filter((id) => tenantIds(a).has(id))).toEqual([]);
    expect(events.length).toBe(
      await countAuditEvents({ companyId: b.companyId }),
    );
    expect(
      await listAuditEvents({
        companyId: b.companyId,
        resourceId: a.person.id,
      }),
    ).toEqual([]);
  });

  it("lib:audit/listAuditActors", async () => {
    const actors = await listAuditActors(b.companyId);
    expect(actors.map((actor) => actor.id)).toEqual([b.admin.id]);
  });

  it("records each business write with the company it happened in", async () => {
    const person = await createPerson(
      a.companyId,
      {
        nombres: "Auditada",
        apellidoPaterno: "A",
        status: "activa",
      },
      a.admin.id,
    );
    const [event] = await db
      .select({ companyId: auditEvents.companyId })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, person.id),
          eq(auditEvents.action, "create"),
        ),
      );
    expect(event.companyId).toBe(a.companyId);
  });
});

describe("company context", () => {
  it("action:tenant/switchCompanyAction", async () => {
    const both = await newUser(`ambas-${Date.now()}@idor.test`);
    const roles = await seedRbac();
    await db.insert(companyMemberships).values([
      {
        userId: both.id,
        companyId: a.companyId,
        roleId: roles.get("admin")!,
        isDefault: true,
      },
      { userId: both.id, companyId: b.companyId, roleId: roles.get("viewer")! },
    ]);

    // Admin in A, viewer in B: permissions follow the active company.
    actAs(both, a.companyId);
    expect(await userHasPermission(both.id, "people:delete")).toBe(true);
    actAs(both, b.companyId);
    expect(await userHasPermission(both.id, "people:delete")).toBe(false);

    // Switching to a company without membership is refused and changes nothing.
    actAs(b.admin, b.companyId);
    expect(
      await switchCompanyAction({}, formData({ companyId: a.companyId })),
    ).toEqual({
      error: "Acceso no permitido",
    });
    expect(sessionState.current?.activeCompanyId).toBe(b.companyId);

    // A real switch moves the session and leaves an audit event in the new company.
    actAs(both, a.companyId);
    expect(
      await redirectOf(() =>
        switchCompanyAction({}, formData({ companyId: b.companyId })),
      ),
    ).toBe("/app");
    expect(sessionState.current?.activeCompanyId).toBe(b.companyId);
    const [switched] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorUserId, both.id),
          eq(auditEvents.action, "switch"),
        ),
      );
    expect(switched.companyId).toBe(b.companyId);
  });

  it("blocks a revoked member on the very next request", async () => {
    const person = await newUser(`revocada-${Date.now()}@idor.test`);
    const membership = await addMember(
      b.companyId,
      { email: person.email, roleSlug: "editor" },
      b.admin.id,
    );
    actAs(person, b.companyId);
    expect((await getCompanyContext())?.companyId).toBe(b.companyId);

    await revokeMember(b.companyId, membership.id, b.admin.id);
    expect(await getCompanyContext()).toBeNull();
    await expect(requireCompanyContext("people:read")).rejects.toMatchObject({
      name: "NoActiveCompanyError",
    });
  });

  it("blocks every member of a suspended company on the next request", async () => {
    actAs(b.viewer, b.companyId);
    expect(await getCompanyContext()).not.toBeNull();
    await db
      .update(companies)
      .set({ status: "suspendida" })
      .where(eq(companies.id, b.companyId));
    expect(await getCompanyContext()).toBeNull();
    await db
      .update(companies)
      .set({ status: "activa" })
      .where(eq(companies.id, b.companyId));
  });
});

describe("members of another company are out of reach", () => {
  it("lib:tenant/members/listCompanyMembers", async () => {
    const members = await listCompanyMembers(b.companyId);
    expect(members.map((member) => member.userId).sort()).not.toContain(
      a.admin.id,
    );
  });

  it("lib:tenant/members/changeMemberRole", async () => {
    await expect(
      changeMemberRole(b.companyId, a.viewer.membershipId, "admin", b.admin.id),
    ).rejects.toThrow("No encontramos a ese miembro en esta empresa.");
  });

  it("lib:tenant/members/revokeMember", async () => {
    await expect(
      revokeMember(b.companyId, a.viewer.membershipId, b.admin.id),
    ).rejects.toThrow("No encontramos a ese miembro en esta empresa.");
  });

  it("lib:tenant/members/addMember", async () => {
    // Adding someone to B never touches A's memberships.
    const before = await snapshotTenant(a);
    await addMember(
      b.companyId,
      { email: a.viewer.email, roleSlug: "viewer" },
      b.admin.id,
    );
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("refuses removing or demoting a company's last admin", async () => {
    const solo = await seedTenant("C");
    await expect(
      revokeMember(solo.companyId, solo.admin.membershipId, solo.admin.id, {
        platform: true,
      }),
    ).rejects.toThrow(/última persona administradora/);
    await expect(
      changeMemberRole(
        solo.companyId,
        solo.admin.membershipId,
        "viewer",
        solo.admin.id,
        { platform: true },
      ),
    ).rejects.toThrow(/última persona administradora/);
  });

  it.each([
    [
      "action:tenant/changeMemberRoleAction",
      () =>
        changeMemberRoleAction(
          {},
          formData({
            membershipId: a.viewer.membershipId,
            roleSlug: "admin",
            companyId: b.companyId,
          }),
        ),
    ],
    [
      "action:tenant/revokeMemberAction",
      () =>
        revokeMemberAction(
          {},
          formData({
            membershipId: a.viewer.membershipId,
            companyId: b.companyId,
          }),
        ),
    ],
  ])("%s", async (_surface, run) => {
    actAs(b.admin, b.companyId);
    const before = await snapshotTenant(a);
    expect((await run()).error).toBe(
      "No encontramos a ese miembro en esta empresa.",
    );
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("action:tenant/addMemberAction", async () => {
    actAs(b.admin, b.companyId);
    // Pretending to be the platform does not work for a company admin.
    const before = await snapshotTenant(a);
    const result = await addMemberAction(
      {},
      formData({
        scope: "platform",
        targetCompanyId: a.companyId,
        email: "intruso@idor.test",
        roleSlug: "admin",
      }),
    );
    expect(result.error).toBe("No tienes permiso para hacer este cambio.");
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it.each([
    [
      "action:tenant/createCompanyAction",
      () => createCompanyAction({}, formData({ name: "Pirata" })),
    ],
    [
      "action:tenant/updateCompanyAction",
      () =>
        updateCompanyAction(
          {},
          formData({
            targetCompanyId: a.companyId,
            name: "Robada",
            slug: "robada",
          }),
        ),
    ],
    [
      "action:tenant/setCompanyStatusAction",
      () =>
        setCompanyStatusAction(
          {},
          formData({ targetCompanyId: a.companyId, status: "suspendida" }),
        ),
    ],
  ])("%s", async (_surface, run) => {
    actAs(b.admin, b.companyId);
    const before = await snapshotTenant(a);
    expect(await run()).toEqual({
      error: "No tienes permiso para hacer este cambio.",
    });
    expect(await snapshotTenant(a)).toEqual(before);
  });
});

describe("member administration permissions", () => {
  it.each([
    [
      "rbac:action:tenant/addMemberAction",
      () =>
        addMemberAction(
          {},
          formData({
            email: "x@idor.test",
            roleSlug: "viewer",
            companyId: b.companyId,
          }),
        ),
    ],
    [
      "rbac:action:tenant/changeMemberRoleAction",
      () =>
        changeMemberRoleAction(
          {},
          formData({
            membershipId: b.admin.membershipId,
            roleSlug: "viewer",
            companyId: b.companyId,
          }),
        ),
    ],
    [
      "rbac:action:tenant/revokeMemberAction",
      () =>
        revokeMemberAction(
          {},
          formData({
            membershipId: b.admin.membershipId,
            companyId: b.companyId,
          }),
        ),
    ],
  ])("%s", async (_surface, run) => {
    actAs(b.viewer, b.companyId);
    const before = await snapshotTenant(b);
    expect((await run()).error).toBe(
      "No tienes permiso para hacer este cambio.",
    );
    expect(await snapshotTenant(b)).toEqual(before);
  });

  it.each([
    [
      "rbac:action:tenant/createCompanyAction",
      () => createCompanyAction({}, formData({ name: "x" })),
    ],
    [
      "rbac:action:tenant/updateCompanyAction",
      () =>
        updateCompanyAction(
          {},
          formData({ targetCompanyId: b.companyId, name: "x", slug: "x" }),
        ),
    ],
    [
      "rbac:action:tenant/setCompanyStatusAction",
      () =>
        setCompanyStatusAction(
          {},
          formData({ targetCompanyId: b.companyId, status: "suspendida" }),
        ),
    ],
  ])("%s", async (_surface, run) => {
    // A company admin is not a platform admin, even in their own company.
    actAs(b.admin, b.companyId);
    const before = await snapshotTenant(b);
    expect(await run()).toEqual({
      error: "No tienes permiso para hacer este cambio.",
    });
    expect(await snapshotTenant(b)).toEqual(before);
  });

  it("lets a platform admin create a company whose first admin sees only it", async () => {
    const platform = await newUser(`plataforma-${Date.now()}@idor.test`);
    await db
      .update(users)
      .set({ isPlatformAdmin: true })
      .where(eq(users.id, platform.id));
    actAs(platform);
    const url = await redirectOf(() =>
      createCompanyAction({}, formData({ name: `Nueva ${Date.now()}` })),
    );
    const companyId = String(url).split("/admin/empresas/")[1].split("?")[0];

    const firstAdmin = await newUser(`primera-${Date.now()}@idor.test`);
    expect(
      await addMemberAction(
        {},
        formData({
          scope: "platform",
          targetCompanyId: companyId,
          email: firstAdmin.email,
          roleSlug: "admin",
        }),
      ),
    ).toEqual({ ok: true });

    actAs(firstAdmin);
    const context = await getCompanyContext();
    expect(context?.companyId).toBe(companyId);
    expect(context?.memberships).toHaveLength(1);
  });
});
