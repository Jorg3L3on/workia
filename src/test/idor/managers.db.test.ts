/**
 * Manager role and team scope (Workia 2.0 W2-07) on a real database. A
 * manager sees only the active people whose manager_id is theirs (plus
 * indirect reports when HR enables it), never another team or another
 * company; changing a person's jefe moves them on the next request; a
 * delegation lets a backup act for the team until its end date; a baja or
 * HR's revoke ends it all. Titles are the surface ids of docs/idor-matrix.md.
 */
import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const employee = vi.hoisted(() => ({
  context: null as null | {
    accountId: string;
    companyId: string;
    personId: string;
    sessionId: string;
  },
}));

vi.mock("@/lib/employee-accounts/session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/employee-accounts/session")>();
  const { NavigationThrow } = await import("@/test/idor/session-state");

  return {
    ...actual,
    getEmployeeContext: async () => employee.context,
    requireEmployeeContext: async () => {
      if (!employee.context) {
        throw new NavigationThrow("redirect", actual.EMPLOYEE_SIGN_IN_PATH);
      }
      return employee.context;
    },
  };
});

import TeamMemberPage from "@/app/mi/equipo/[personId]/page";
import TeamPage from "@/app/mi/equipo/page";
import InboxPage from "@/app/mi/equipo/aprobaciones/page";
import {
  auditEvents,
  employeeAccounts,
  managerDelegations,
  managerGrants,
  people,
} from "@/lib/db/schema";
import {
  cancelDelegationAction,
  createDelegationAction,
} from "@/lib/employee/manager-actions";
import { revokeEmployeeAccess } from "@/lib/employee-accounts/revoke";
import { withTransaction } from "@/lib/db";
import { isoToday } from "@/lib/format/date";
import {
  cancelDelegation,
  createDelegation,
  currentApprover,
  getManagerAccess,
  getManagerAdmin,
  getTeamMember,
  isInTeam,
  listDelegateCandidates,
  listDelegationsGiven,
  listTeam,
  MANAGER_COPY,
  revokeManagerGrant,
  setManagerGrant,
  type ManagerAccess,
} from "@/lib/managers";
import {
  cancelDelegationByHrAction,
  revokeManagerGrantAction,
  setManagerGrantAction,
} from "@/lib/managers/actions";
import { listApprovalsInbox, type InboxSource } from "@/lib/managers/inbox";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";
import { uniqueCurp } from "@/test/curp";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs, NavigationThrow } from "./session-state";

let a: Tenant;
let b: Tenant;

type Org = {
  boss: { personId: string; accountId: string };
  other: { personId: string; accountId: string };
  backup: { personId: string; accountId: string };
  reportOne: string;
  reportTwo: string;
  indirect: string;
  baja: string;
  otherTeam: string;
};

let orgA: Org;
let orgB: Org;

const person = async (
  companyId: string,
  nombres: string,
  managerId: string | null,
  status: "activa" | "baja" = "activa",
) => {
  const [row] = await ownerDb
    .insert(people)
    .values({
      companyId,
      nombres,
      apellidoPaterno: "Equipo",
      curp: uniqueCurp(),
      managerId,
      status,
    })
    .returning({ id: people.id });
  return row.id;
};

const account = async (companyId: string, personId: string) => {
  const [row] = await ownerDb
    .insert(employeeAccounts)
    .values({
      companyId,
      personId,
      status: "active",
      email: `${personId}@empleo.test`,
      emailVerifiedAt: new Date(),
      activatedAt: new Date(),
    })
    .returning({ id: employeeAccounts.id });
  return row.id;
};

const seedOrg = async (companyId: string, label: string): Promise<Org> => {
  const bossId = await person(companyId, `Jefa ${label}`, null);
  const otherId = await person(companyId, `Otro jefe ${label}`, null);
  const reportOne = await person(companyId, `Ana ${label}`, bossId);
  const reportTwo = await person(companyId, `Beto ${label}`, bossId);
  const indirect = await person(companyId, `Carla ${label}`, reportOne);
  const baja = await person(companyId, `Dora ${label}`, bossId, "baja");
  const otherTeam = await person(companyId, `Eva ${label}`, otherId);
  // The backup reports to the boss, so the boss can name them.
  const backupId = await person(companyId, `Suplente ${label}`, bossId);

  return {
    boss: { personId: bossId, accountId: await account(companyId, bossId) },
    other: { personId: otherId, accountId: await account(companyId, otherId) },
    backup: {
      personId: backupId,
      accountId: await account(companyId, backupId),
    },
    reportOne,
    reportTwo,
    indirect,
    baja,
    otherTeam,
  };
};

const contextOf = (
  companyId: string,
  member: { personId: string; accountId: string },
) => ({ companyId, ...member, sessionId: "test" });

const accessOf = async (
  companyId: string,
  member: { personId: string; accountId: string },
  today?: string,
) => getManagerAccess(contextOf(companyId, member), today);

const mustAccess = async (
  companyId: string,
  member: { personId: string; accountId: string },
  today?: string,
): Promise<ManagerAccess> => {
  const access = await accessOf(companyId, member, today);
  if (!access) throw new Error("expected manager access");
  return access;
};

const teamIds = async (access: ManagerAccess) =>
  (await listTeam(access, { limit: 200 })).items.map((m) => m.id).sort();

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const navigationOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof NavigationThrow) return error.kind;
    throw error;
  }
  return null;
};

const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const today = isoToday();

const grantsOf = (companyId: string) =>
  ownerDb
    .select()
    .from(managerGrants)
    .where(eq(managerGrants.companyId, companyId));

beforeAll(async () => {
  a = await seedTenant("MA");
  b = await seedTenant("MB");
  orgA = await seedOrg(a.companyId, "A");
  orgB = await seedOrg(b.companyId, "B");
});

beforeEach(async () => {
  employee.context = null;
  actAs(null);
  await ownerDb.delete(managerDelegations);
  await ownerDb.delete(managerGrants);
  for (const [companyId, org] of [
    [a.companyId, orgA],
    [b.companyId, orgB],
  ] as const) {
    await ownerDb
      .update(people)
      .set({ managerId: org.boss.personId })
      .where(
        and(eq(people.companyId, companyId), eq(people.id, org.reportOne)),
      );
  }
});

describe("HR gives the manager grant inside its company", () => {
  it("lib:managers/setManagerGrant", async () => {
    expect(await accessOf(a.companyId, orgA.boss)).toBeNull();

    // Company B's HR names company A's person: no account there, no effect.
    expect(
      await setManagerGrant(b.companyId, orgA.boss.personId, false, b.admin.id),
    ).toEqual({ ok: false, error: MANAGER_COPY.noAccount });
    expect(await grantsOf(a.companyId)).toEqual([]);

    expect(
      await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id),
    ).toEqual({ ok: true });
    // Saving again keeps one live grant.
    await setManagerGrant(a.companyId, orgA.boss.personId, true, a.admin.id);
    const grants = await grantsOf(a.companyId);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      accountId: orgA.boss.accountId,
      includeIndirect: true,
      revokedAt: null,
    });

    const audit = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, a.companyId),
          eq(auditEvents.resourceId, grants[0].id),
        ),
      );
    expect(audit.map((event) => event.action).sort()).toEqual([
      "create",
      "update",
    ]);
  });

  it("lib:managers/getManagerAdmin", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);

    expect(await getManagerAdmin(b.companyId, orgA.boss.personId)).toBeNull();
    expect(
      await getManagerAdmin(a.companyId, orgA.boss.personId),
    ).toMatchObject({
      accountId: orgA.boss.accountId,
      grant: { includeIndirect: false },
      // reportOne, reportTwo and the backup; the baja does not count.
      directReports: 3,
      delegations: [],
    });
  });

  it("lib:managers/revokeManagerGrant", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    await createDelegation(await mustAccess(a.companyId, orgA.boss), {
      delegateAccountId: orgA.backup.accountId,
      startsOn: today,
      endsOn: addDays(today, 3),
    });

    expect(
      await revokeManagerGrant(b.companyId, orgA.boss.personId, b.admin.id),
    ).toEqual({ ok: false, error: MANAGER_COPY.noAccount });
    expect(await accessOf(a.companyId, orgA.boss)).not.toBeNull();

    expect(
      await revokeManagerGrant(a.companyId, orgA.boss.personId, a.admin.id),
    ).toEqual({ ok: true });
    expect(await accessOf(a.companyId, orgA.boss)).toBeNull();
    // The delegation ended with the grant.
    expect(await accessOf(a.companyId, orgA.backup)).toBeNull();
  });

  it("action:managers/setManagerGrantAction", async () => {
    actAs(b.admin, b.companyId);
    const fromB = await setManagerGrantAction(
      {},
      formData({ companyId: b.companyId, personId: orgA.boss.personId }),
    );
    expect(fromB.error).toBe(MANAGER_COPY.noAccount);

    // A form opened in company A, sent from a session now in company B.
    const stale = await setManagerGrantAction(
      {},
      formData({ companyId: a.companyId, personId: orgA.boss.personId }),
    );
    expect(stale.error).toBe(STALE_COMPANY_MESSAGE);
    expect(await grantsOf(a.companyId)).toEqual([]);

    actAs(a.admin, a.companyId);
    expect(
      await setManagerGrantAction(
        {},
        formData({
          companyId: a.companyId,
          personId: orgA.boss.personId,
          includeIndirect: "on",
        }),
      ),
    ).toEqual({ notice: "Rol de jefe guardado." });
    expect((await grantsOf(a.companyId))[0]?.includeIndirect).toBe(true);
  });

  it("rbac:action:managers/setManagerGrantAction", async () => {
    actAs(a.viewer, a.companyId);
    expect(
      await setManagerGrantAction(
        {},
        formData({ companyId: a.companyId, personId: orgA.boss.personId }),
      ),
    ).toEqual({ error: MANAGER_COPY.denied });
    expect(await grantsOf(a.companyId)).toEqual([]);
  });

  it("action:managers/revokeManagerGrantAction", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);

    actAs(b.admin, b.companyId);
    expect(
      (
        await revokeManagerGrantAction(
          {},
          formData({ companyId: b.companyId, personId: orgA.boss.personId }),
        )
      ).error,
    ).toBe(MANAGER_COPY.noAccount);
    expect(await accessOf(a.companyId, orgA.boss)).not.toBeNull();

    actAs(a.admin, a.companyId);
    await revokeManagerGrantAction(
      {},
      formData({ companyId: a.companyId, personId: orgA.boss.personId }),
    );
    expect(await accessOf(a.companyId, orgA.boss)).toBeNull();
  });

  it("rbac:action:managers/revokeManagerGrantAction", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    actAs(a.viewer, a.companyId);
    expect(
      await revokeManagerGrantAction(
        {},
        formData({ companyId: a.companyId, personId: orgA.boss.personId }),
      ),
    ).toEqual({ error: MANAGER_COPY.denied });
    expect(await accessOf(a.companyId, orgA.boss)).not.toBeNull();
  });
});

describe("a manager sees only their team", () => {
  it("lib:managers/listTeam", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    await setManagerGrant(b.companyId, orgB.boss.personId, false, b.admin.id);
    const access = await mustAccess(a.companyId, orgA.boss);

    // Direct, active reports only: no indirect, no baja, no other team, no B.
    expect(await teamIds(access)).toEqual(
      [orgA.reportOne, orgA.reportTwo, orgA.backup.personId].sort(),
    );

    // Pages in name order with a cursor, no OFFSET.
    const first = await listTeam(access, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.next).not.toBeNull();
    const second = await listTeam(access, { cursor: first.next, limit: 2 });
    expect(second.items).toHaveLength(1);
    expect(second.next).toBeNull();
    expect(
      [...first.items, ...second.items].map((member) => member.name),
    ).toEqual(["Ana A Equipo", "Beto A Equipo", "Suplente A Equipo"]);

    // A tampered cursor starts over.
    expect(
      (await listTeam(access, { cursor: "not-a-cursor" })).items,
    ).toHaveLength(3);
  });

  it("lib:managers/isInTeam", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    const access = await mustAccess(a.companyId, orgA.boss);

    expect(await isInTeam(access, orgA.reportOne)).toBe(true);
    for (const outside of [
      orgA.indirect,
      orgA.baja,
      orgA.otherTeam,
      orgA.boss.personId,
      orgB.reportOne,
      a.person.id,
      a.teammate.id,
    ]) {
      expect(await isInTeam(access, outside)).toBe(false);
    }
  });

  it("lib:managers/getTeamMember", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    const access = await mustAccess(a.companyId, orgA.boss);

    expect(await getTeamMember(access, orgA.reportOne)).toMatchObject({
      id: orgA.reportOne,
      managerName: "Jefa A Equipo",
    });
    expect(await getTeamMember(access, orgA.otherTeam)).toBeNull();
    expect(await getTeamMember(access, orgB.reportOne)).toBeNull();

    // A forged access naming company B's boss reads nothing of A.
    const forged: ManagerAccess = {
      ...access,
      scopes: [{ ...access.scopes[0], managerPersonId: orgB.boss.personId }],
    };
    expect(await teamIds(forged)).toEqual([]);
  });

  it("includes indirect reports only when HR enables it", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, true, a.admin.id);
    const access = await mustAccess(a.companyId, orgA.boss);

    expect(await teamIds(access)).toEqual(
      [
        orgA.reportOne,
        orgA.reportTwo,
        orgA.backup.personId,
        orgA.indirect,
      ].sort(),
    );
    const indirect = (await listTeam(access)).items.find(
      (member) => member.id === orgA.indirect,
    );
    expect(indirect?.managerName).toBe("Ana A Equipo");

    // A cycle in manager_id does not loop and never lists the manager.
    await ownerDb
      .update(people)
      .set({ managerId: orgA.indirect })
      .where(eq(people.id, orgA.boss.personId));
    try {
      expect(await teamIds(access)).not.toContain(orgA.boss.personId);
    } finally {
      await ownerDb
        .update(people)
        .set({ managerId: null })
        .where(eq(people.id, orgA.boss.personId));
    }
  });

  it("moves a person to the new team on the next request", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    await setManagerGrant(a.companyId, orgA.other.personId, false, a.admin.id);
    const boss = await mustAccess(a.companyId, orgA.boss);
    const other = await mustAccess(a.companyId, orgA.other);

    expect(await isInTeam(boss, orgA.reportOne)).toBe(true);
    expect(await currentApprover(a.companyId, orgA.reportOne)).toBe(
      orgA.boss.personId,
    );

    await ownerDb
      .update(people)
      .set({ managerId: orgA.other.personId })
      .where(eq(people.id, orgA.reportOne));

    expect(await isInTeam(boss, orgA.reportOne)).toBe(false);
    expect(await isInTeam(other, orgA.reportOne)).toBe(true);
    expect(await currentApprover(a.companyId, orgA.reportOne)).toBe(
      orgA.other.personId,
    );
  });

  it("lib:managers/scope/currentApprover", async () => {
    // No grant: the request goes to HR.
    expect(await currentApprover(a.companyId, orgA.reportOne)).toBeNull();
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    expect(await currentApprover(a.companyId, orgA.reportOne)).toBe(
      orgA.boss.personId,
    );
    expect(await currentApprover(b.companyId, orgA.reportOne)).toBeNull();
  });

  it("lib:managers/getManagerAccess", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);

    // The same account ids under company B resolve to nothing.
    expect(await accessOf(b.companyId, orgA.boss)).toBeNull();
    expect(await accessOf(a.companyId, orgA.boss)).toMatchObject({
      scopes: [{ via: "own", managerPersonId: orgA.boss.personId }],
    });
  });
});

describe("the team screens", () => {
  it("page:/mi/equipo/[personId]", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    employee.context = contextOf(a.companyId, orgA.boss);

    const visit = (personId: string) =>
      navigationOf(() =>
        TeamMemberPage({ params: Promise.resolve({ personId }) }),
      );

    expect(await visit(orgA.reportOne)).toBeNull();
    expect(await visit(orgA.otherTeam)).toBe("notFound");
    expect(await visit(orgB.reportOne)).toBe("notFound");
    expect(await visit("not-a-uuid")).toBe("notFound");

    // Without a grant the whole section is a 404.
    employee.context = contextOf(a.companyId, orgA.backup);
    expect(await visit(orgA.reportOne)).toBe("notFound");

    employee.context = null;
    expect(await visit(orgA.reportOne)).toBe("redirect");
  });

  it("page:/mi/equipo", async () => {
    const visit = () =>
      navigationOf(() => TeamPage({ searchParams: Promise.resolve({}) }));

    employee.context = contextOf(a.companyId, orgA.boss);
    expect(await visit()).toBe("notFound");

    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    expect(await visit()).toBeNull();
  });

  it("page:/mi/equipo/aprobaciones", async () => {
    const visit = () =>
      navigationOf(() => InboxPage({ searchParams: Promise.resolve({}) }));

    employee.context = contextOf(a.companyId, orgA.other);
    expect(await visit()).toBe("notFound");

    await setManagerGrant(a.companyId, orgA.other.personId, false, a.admin.id);
    expect(await visit()).toBeNull();
  });

  it("lists only the approvers this account decides for", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    const access = await mustAccess(a.companyId, orgA.boss);
    const seen: string[][] = [];
    const source: InboxSource = {
      key: "test",
      list: async ({ approverIds }) => {
        seen.push(approverIds);
        return [
          {
            source: "test",
            id: "1",
            sortKey: "2026-11-04T10:00:00.000001",
            personId: orgA.reportOne,
            personName: "Ana",
            title: "Vacaciones",
            detail: null,
            approverPersonId: orgA.boss.personId,
            href: "/mi/equipo",
          },
          {
            source: "test",
            id: "2",
            sortKey: "2026-11-04T11:00:00.000000",
            personId: orgA.otherTeam,
            personName: "Eva",
            title: "Permiso",
            detail: null,
            approverPersonId: orgA.other.personId,
            href: "/mi/equipo",
          },
        ];
      },
    };

    const inbox = await listApprovalsInbox(access, { sources: [source] });
    expect(seen).toEqual([[orgA.boss.personId]]);
    expect(inbox.items.map((item) => item.id)).toEqual(["1"]);
  });
});

describe("a backup manager covers until the end date", () => {
  it("lib:managers/listDelegateCandidates", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    await setManagerGrant(a.companyId, orgA.other.personId, false, a.admin.id);
    await setManagerGrant(b.companyId, orgB.boss.personId, false, b.admin.id);
    const access = await mustAccess(a.companyId, orgA.boss);

    const candidates = (await listDelegateCandidates(access)).map(
      (candidate) => candidate.accountId,
    );
    // Their direct report with an account, and another manager; never B's.
    expect(candidates.sort()).toEqual(
      [orgA.backup.accountId, orgA.other.accountId].sort(),
    );
  });

  it("lib:managers/createDelegation", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    await setManagerGrant(b.companyId, orgB.boss.personId, false, b.admin.id);
    const access = await mustAccess(a.companyId, orgA.boss);

    expect(await accessOf(a.companyId, orgA.backup)).toBeNull();

    // An account of company B is not a candidate.
    expect(
      await createDelegation(access, {
        delegateAccountId: orgB.boss.accountId,
        startsOn: today,
        endsOn: today,
      }),
    ).toEqual({ ok: false, error: MANAGER_COPY.delegateInvalid });
    expect(
      await createDelegation(
        access,
        {
          delegateAccountId: orgA.backup.accountId,
          startsOn: addDays(today, -1),
          endsOn: today,
        },
        today,
      ),
    ).toEqual({ ok: false, error: MANAGER_COPY.datesInvalid });
    expect(
      await createDelegation(
        access,
        {
          delegateAccountId: orgA.backup.accountId,
          startsOn: today,
          endsOn: addDays(today, -1),
        },
        today,
      ),
    ).toEqual({ ok: false, error: MANAGER_COPY.datesInvalid });

    const endsOn = addDays(today, 2);
    expect(
      await createDelegation(
        access,
        { delegateAccountId: orgA.backup.accountId, startsOn: today, endsOn },
        today,
      ),
    ).toEqual({ ok: true });

    const backup = await mustAccess(a.companyId, orgA.backup, today);
    expect(backup.scopes).toMatchObject([
      { via: "delegation", managerPersonId: orgA.boss.personId, endsOn },
    ]);
    // The backup sees the boss's team (themself included, as one of it), not B's.
    expect(await isInTeam(backup, orgA.reportOne)).toBe(true);
    expect(await isInTeam(backup, orgB.reportOne)).toBe(false);

    // The last day still counts; the day after, it has expired.
    expect(await accessOf(a.companyId, orgA.backup, endsOn)).not.toBeNull();
    expect(
      await accessOf(a.companyId, orgA.backup, addDays(endsOn, 1)),
    ).toBeNull();
    // A delegation for later is not live yet.
    expect(
      await accessOf(a.companyId, orgA.backup, addDays(today, -1)),
    ).toBeNull();
  });

  it("lib:managers/listDelegationsGiven", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    await createDelegation(await mustAccess(a.companyId, orgA.boss), {
      delegateAccountId: orgA.backup.accountId,
      startsOn: today,
      endsOn: today,
    });

    expect(
      await listDelegationsGiven(b.companyId, orgA.boss.accountId),
    ).toEqual([]);
    expect(
      await listDelegationsGiven(a.companyId, orgA.boss.accountId),
    ).toMatchObject([{ delegateName: "Suplente A Equipo", endsOn: today }]);
  });

  it("lib:managers/cancelDelegation", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    await createDelegation(await mustAccess(a.companyId, orgA.boss), {
      delegateAccountId: orgA.backup.accountId,
      startsOn: today,
      endsOn: addDays(today, 5),
    });
    const [delegation] = await ownerDb.select().from(managerDelegations);

    // Another company's HR, and another manager of A, cannot end it.
    expect(
      await cancelDelegation(b.companyId, delegation.id, {
        userId: b.admin.id,
      }),
    ).toEqual({ ok: false, error: MANAGER_COPY.delegationNotFound });
    expect(
      await cancelDelegation(a.companyId, delegation.id, {
        accountId: orgA.other.accountId,
      }),
    ).toEqual({ ok: false, error: MANAGER_COPY.delegationNotFound });
    expect(await accessOf(a.companyId, orgA.backup)).not.toBeNull();

    expect(
      await cancelDelegation(a.companyId, delegation.id, {
        accountId: orgA.boss.accountId,
      }),
    ).toEqual({ ok: true });
    expect(await accessOf(a.companyId, orgA.backup)).toBeNull();
  });

  it("action:employee/createDelegationAction", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    employee.context = contextOf(a.companyId, orgA.backup);
    // Not a manager: nothing to delegate.
    expect(
      await createDelegationAction(
        {},
        formData({
          delegateAccountId: orgA.other.accountId,
          startsOn: today,
          endsOn: today,
        }),
      ),
    ).toEqual({ error: MANAGER_COPY.notManager });

    employee.context = contextOf(a.companyId, orgA.boss);
    expect(
      await createDelegationAction(
        {},
        formData({
          delegateAccountId: orgA.backup.accountId,
          startsOn: today,
          endsOn: today,
        }),
      ),
    ).toEqual({ notice: "Suplente guardado." });
    const [delegation] = await ownerDb.select().from(managerDelegations);
    expect(delegation).toMatchObject({
      companyId: a.companyId,
      managerAccountId: orgA.boss.accountId,
    });
    const [audit] = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, delegation.id));
    expect(audit).toMatchObject({
      actorEmployeeAccountId: orgA.boss.accountId,
      source: "employee",
      action: "create",
    });
  });

  it("action:employee/cancelDelegationAction", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    await setManagerGrant(b.companyId, orgB.boss.personId, false, b.admin.id);
    await createDelegation(await mustAccess(a.companyId, orgA.boss), {
      delegateAccountId: orgA.backup.accountId,
      startsOn: today,
      endsOn: today,
    });
    const [delegation] = await ownerDb.select().from(managerDelegations);

    employee.context = contextOf(b.companyId, orgB.boss);
    expect(
      await cancelDelegationAction(
        {},
        formData({ delegationId: delegation.id }),
      ),
    ).toEqual({ error: MANAGER_COPY.delegationNotFound });
    employee.context = contextOf(a.companyId, orgA.backup);
    expect(
      await cancelDelegationAction(
        {},
        formData({ delegationId: delegation.id }),
      ),
    ).toEqual({ error: MANAGER_COPY.delegationNotFound });

    employee.context = contextOf(a.companyId, orgA.boss);
    expect(
      await cancelDelegationAction(
        {},
        formData({ delegationId: delegation.id }),
      ),
    ).toEqual({ notice: "Suplencia terminada." });
  });

  it("action:managers/cancelDelegationByHrAction", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    await createDelegation(await mustAccess(a.companyId, orgA.boss), {
      delegateAccountId: orgA.backup.accountId,
      startsOn: today,
      endsOn: today,
    });
    const [delegation] = await ownerDb.select().from(managerDelegations);

    actAs(b.admin, b.companyId);
    expect(
      await cancelDelegationByHrAction(
        {},
        formData({
          companyId: b.companyId,
          personId: orgA.boss.personId,
          delegationId: delegation.id,
        }),
      ),
    ).toEqual({ error: MANAGER_COPY.delegationNotFound });
    expect(await accessOf(a.companyId, orgA.backup)).not.toBeNull();

    actAs(a.admin, a.companyId);
    expect(
      await cancelDelegationByHrAction(
        {},
        formData({
          companyId: a.companyId,
          personId: orgA.boss.personId,
          delegationId: delegation.id,
        }),
      ),
    ).toEqual({ notice: "Suplencia terminada." });
    expect(await accessOf(a.companyId, orgA.backup)).toBeNull();
  });

  it("rbac:action:managers/cancelDelegationByHrAction", async () => {
    await setManagerGrant(a.companyId, orgA.boss.personId, false, a.admin.id);
    await createDelegation(await mustAccess(a.companyId, orgA.boss), {
      delegateAccountId: orgA.backup.accountId,
      startsOn: today,
      endsOn: today,
    });
    const [delegation] = await ownerDb.select().from(managerDelegations);

    actAs(a.viewer, a.companyId);
    expect(
      await cancelDelegationByHrAction(
        {},
        formData({
          companyId: a.companyId,
          personId: orgA.boss.personId,
          delegationId: delegation.id,
        }),
      ),
    ).toEqual({ error: MANAGER_COPY.denied });
    expect(await accessOf(a.companyId, orgA.backup)).not.toBeNull();
  });

  it("lib:managers/endManagerAccess", async () => {
    // A baja disables the account; its grant and delegations end with it.
    const bossId = await person(a.companyId, "Jefe baja", null);
    const boss = {
      personId: bossId,
      accountId: await account(a.companyId, bossId),
    };
    const reportId = await person(a.companyId, "Reporte baja", bossId);
    const report = {
      personId: reportId,
      accountId: await account(a.companyId, reportId),
    };
    await setManagerGrant(a.companyId, bossId, false, a.admin.id);
    await createDelegation(await mustAccess(a.companyId, boss), {
      delegateAccountId: report.accountId,
      startsOn: today,
      endsOn: today,
    });

    await withTransaction(
      (tx) => revokeEmployeeAccess(tx, a.companyId, bossId, "baja", a.admin.id),
      a.companyId,
    );

    const live = await ownerDb
      .select()
      .from(managerGrants)
      .where(
        and(
          eq(managerGrants.accountId, boss.accountId),
          isNull(managerGrants.revokedAt),
        ),
      );
    expect(live).toEqual([]);
    expect(await accessOf(a.companyId, report)).toBeNull();
    // Company B's grants are untouched.
    await setManagerGrant(b.companyId, orgB.boss.personId, false, b.admin.id);
    await withTransaction(
      (tx) => revokeEmployeeAccess(tx, a.companyId, orgB.boss.personId, "baja"),
      a.companyId,
    );
    expect(await accessOf(b.companyId, orgB.boss)).not.toBeNull();
  });
});
