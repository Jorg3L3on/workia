/**
 * Requests and approvals (Workia 2.0 W2-06) on a real database. An employee
 * asks for vacaciones or a permiso; the jefe with a live grant (or their
 * backup) approves or rejects it from the inbox; HR sees every request of its
 * company and decides the ones without a jefe. Approval writes the vacation
 * row and consumes balance, rejection does not; cancelling before the first
 * day voids it. Every transition is an audit event, a person_events row and,
 * for the one who has to act next, a notification. Nobody reaches another
 * team's or another company's requests. Titles are the surface ids of
 * docs/idor-matrix.md.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
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

// No mail leaves a test.
vi.mock("@/lib/email", () => {
  class EmailNotConfiguredError extends Error {}

  return {
    EmailNotConfiguredError,
    emailConfigured: () => false,
    sendEmail: async () => {
      throw new EmailNotConfiguredError("not configured");
    },
  };
});

import RequestDecisionPage from "@/app/mi/equipo/aprobaciones/[requestId]/page";
import MyRequestsPage from "@/app/mi/solicitudes/page";
import HrRequestPage from "@/app/app/solicitudes/[id]/page";
import HrRequestsPage from "@/app/app/solicitudes/page";
import {
  auditEvents,
  employeeAccounts,
  employmentPeriods,
  incidenciaJustifications,
  managerDelegations,
  notifications,
  payPeriods,
  people,
  personEvents,
  personSchedules,
  timeOffRequests,
  vacationRecords,
} from "@/lib/db/schema";
import {
  cancelRequestAction,
  createRequestAction,
  decideRequestAction,
} from "@/lib/employee/request-actions";
import { isoToday } from "@/lib/format/date";
import { quincenaOf, quincenaRange } from "@/lib/pay-periods/quincena";
import {
  createDelegation,
  getManagerAccess,
  setManagerGrant,
  type ManagerAccess,
} from "@/lib/managers";
import { listApprovalsInbox } from "@/lib/managers/inbox";
import {
  cancelTimeOffRequest,
  createTimeOffRequest,
  decideRequestAsHr,
  decideRequestAsManager,
  getCompanyRequest,
  getRequestForManager,
  listCompanyRequests,
  listMyRequests,
  REQUEST_COPY,
} from "@/lib/requests";
import { decideRequestByHrAction } from "@/lib/requests/actions";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";
import { getPersonVacationBalance } from "@/lib/vacations/person-balance";
import { randomCurp } from "@/test/curp";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs, NavigationThrow } from "./session-state";

type Member = { personId: string; accountId: string };

type Org = {
  boss: Member;
  otherBoss: Member;
  backup: Member;
  ana: Member;
  beto: Member;
  /** No jefe: HR decides. */
  solo: Member;
};

let a: Tenant;
let b: Tenant;
let orgA: Org;
let orgB: Org;

const today = isoToday();

const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const person = async (
  companyId: string,
  nombres: string,
  managerId: string | null,
) => {
  const [row] = await ownerDb
    .insert(people)
    .values({
      companyId,
      nombres,
      apellidoPaterno: "Solicitud",
      curp: randomCurp(),
      managerId,
      fechaIngreso: "2023-03-01",
    })
    .returning({ id: people.id });
  await ownerDb.insert(employmentPeriods).values({
    companyId,
    personId: row.id,
    fechaIngreso: "2023-03-01",
    fechaAntiguedad: "2023-03-01",
  });
  return row.id;
};

const member = async (
  companyId: string,
  nombres: string,
  managerId: string | null,
): Promise<Member> => {
  const personId = await person(companyId, nombres, managerId);
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
  return { personId, accountId: row.id };
};

const seedOrg = async (tenant: Tenant, label: string): Promise<Org> => {
  const boss = await member(tenant.companyId, `Jefa ${label}`, null);
  const otherBoss = await member(tenant.companyId, `Otro jefe ${label}`, null);
  const org = {
    boss,
    otherBoss,
    backup: await member(tenant.companyId, `Suplente ${label}`, boss.personId),
    ana: await member(tenant.companyId, `Ana ${label}`, boss.personId),
    beto: await member(tenant.companyId, `Beto ${label}`, boss.personId),
    solo: await member(tenant.companyId, `Sola ${label}`, null),
  };
  await setManagerGrant(
    tenant.companyId,
    boss.personId,
    false,
    tenant.admin.id,
  );
  await setManagerGrant(
    tenant.companyId,
    otherBoss.personId,
    false,
    tenant.admin.id,
  );
  return org;
};

const contextOf = (companyId: string, who: Member) => ({
  companyId,
  ...who,
  sessionId: "test",
});

const accessOf = async (
  companyId: string,
  who: Member,
): Promise<ManagerAccess> => {
  const access = await getManagerAccess(contextOf(companyId, who));
  if (!access) throw new Error("expected manager access");
  return access;
};

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

const ask = async (
  companyId: string,
  who: Member,
  input: Partial<{
    kind: string;
    startDate: string;
    endDate: string;
    days: string;
    note: string;
  }> = {},
) => {
  const result = await createTimeOffRequest(contextOf(companyId, who), {
    kind: "vacaciones",
    startDate: addDays(today, 10),
    endDate: addDays(today, 11),
    days: "2",
    ...input,
  });
  if (!result.ok) throw new Error(`request failed: ${result.error}`);
  return result.id;
};

const requestRow = async (id: string) => {
  const [row] = await ownerDb
    .select()
    .from(timeOffRequests)
    .where(eq(timeOffRequests.id, id));
  return row;
};

const auditOf = (id: string) =>
  ownerDb
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.resourceId, id))
    .orderBy(auditEvents.occurredAt);

const eventsOf = (personId: string) =>
  ownerDb
    .select()
    .from(personEvents)
    .where(eq(personEvents.personId, personId));

const notificationsOf = (personId: string) =>
  ownerDb
    .select()
    .from(notifications)
    .where(eq(notifications.recipientPersonId, personId));

const takenHalves = async (companyId: string, who: Member) =>
  (await getPersonVacationBalance(companyId, who.personId, today))?.current
    ?.takenHalves ?? 0;

beforeAll(async () => {
  a = await seedTenant("RA");
  b = await seedTenant("RB");
  orgA = await seedOrg(a, "A");
  orgB = await seedOrg(b, "B");
});

beforeEach(async () => {
  employee.context = null;
  actAs(null);
  await ownerDb.delete(timeOffRequests);
  await ownerDb.delete(vacationRecords);
  await ownerDb.delete(managerDelegations);
  await ownerDb.delete(notifications);
  await ownerDb
    .delete(incidenciaJustifications)
    .where(
      inArray(incidenciaJustifications.companyId, [a.companyId, b.companyId]),
    );
  await ownerDb
    .delete(payPeriods)
    .where(inArray(payPeriods.companyId, [a.companyId, b.companyId]));
  await ownerDb
    .delete(personEvents)
    .where(inArray(personEvents.companyId, [a.companyId, b.companyId]));
});

describe("an employee asks", () => {
  it("stores the jefe as approver, audits it, writes the timeline and notifies the jefe", async () => {
    const id = await ask(a.companyId, orgA.ana, { note: "Viaje familiar" });
    const row = await requestRow(id);

    expect(row).toMatchObject({
      companyId: a.companyId,
      personId: orgA.ana.personId,
      kind: "vacaciones",
      status: "pending",
      days: "2.0",
      managerId: orgA.boss.personId,
      requestedByAccountId: orgA.ana.accountId,
      vacationRecordId: null,
    });

    const audit = await auditOf(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      resourceType: "time_off_request",
      action: "create",
      actorEmployeeAccountId: orgA.ana.accountId,
      source: "employee",
    });
    // The note can carry health data: never in the audit trail.
    expect(JSON.stringify(audit[0].payload)).not.toContain("Viaje");

    const events = await eventsOf(orgA.ana.personId);
    expect(events.map((event) => event.payload)).toEqual([
      expect.objectContaining({ kind: "request", request_id: id, days: 2 }),
    ]);

    const toBoss = await notificationsOf(orgA.boss.personId);
    expect(toBoss).toHaveLength(1);
    expect(toBoss[0]).toMatchObject({
      template: "request_pending",
      url: `/mi/equipo/aprobaciones/${id}`,
    });
  });

  it("refuses overlaps, the past and more days than the balance has", async () => {
    await ask(a.companyId, orgA.ana);
    const context = contextOf(a.companyId, orgA.ana);

    expect(
      await createTimeOffRequest(context, {
        kind: "permiso_con_goce",
        startDate: addDays(today, 11),
        endDate: addDays(today, 11),
        days: "1",
      }),
    ).toEqual({ ok: false, error: REQUEST_COPY.overlap });
    expect(
      await createTimeOffRequest(context, {
        kind: "permiso_sin_goce",
        startDate: addDays(today, -1),
        endDate: addDays(today, -1),
        days: "1",
      }),
    ).toEqual({ ok: false, error: REQUEST_COPY.past });
    // Three years of service: 16 days. Two are pending already.
    expect(
      await createTimeOffRequest(context, {
        kind: "vacaciones",
        startDate: addDays(today, 20),
        endDate: addDays(today, 40),
        days: "15",
      }),
    ).toEqual({ ok: false, error: REQUEST_COPY.overBalance });
    expect(
      await createTimeOffRequest(context, {
        kind: "vacaciones",
        startDate: addDays(today, 20),
        endDate: addDays(today, 40),
        days: "14",
      }),
    ).toMatchObject({ ok: true });
  });

  it("sends a request without a jefe to HR", async () => {
    const id = await ask(a.companyId, orgA.solo, {
      kind: "permiso_sin_goce",
      days: "1",
      startDate: addDays(today, 3),
      endDate: addDays(today, 3),
    });
    expect((await requestRow(id)).managerId).toBeNull();

    const toHr = await ownerDb
      .select()
      .from(notifications)
      .where(eq(notifications.companyId, a.companyId));
    expect(toHr.length).toBeGreaterThan(0);
    expect(toHr.every((row) => row.recipientUserId !== null)).toBe(true);
    expect(toHr[0].url).toBe(`/app/solicitudes/${id}`);
    // The admin of company A holds vacations:update; company B's never hears of it.
    expect(toHr.map((row) => row.recipientUserId)).toContain(a.admin.id);
    expect(toHr.map((row) => row.recipientUserId)).not.toContain(b.admin.id);

    const events = await eventsOf(orgA.solo.personId);
    expect(events[0]).toMatchObject({ type: "permiso" });
    expect(events[0].payload).toMatchObject({
      kind: "request",
      pay: "sin_goce",
    });
  });

  it("lists only the employee's own requests, newest first, in keyset pages", async () => {
    for (let index = 0; index < 5; index += 1) {
      await ask(a.companyId, orgA.beto, {
        kind: "permiso_con_goce",
        startDate: addDays(today, 30 + index),
        endDate: addDays(today, 30 + index),
        days: "1",
      });
    }
    await ask(a.companyId, orgA.ana);
    await ask(b.companyId, orgB.beto);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listMyRequests>> =
        await listMyRequests(contextOf(a.companyId, orgA.beto), {
          cursor,
          limit: 2,
        });
      seen.push(...page.items.map((item) => item.startDate));
      expect(
        page.items.every((item) => item.personId === orgA.beto.personId),
      ).toBe(true);
      cursor = page.next;
    } while (cursor);

    expect(seen).toEqual(
      [34, 33, 32, 31, 30].map((offset) => addDays(today, offset)),
    );
  });
});

describe("the jefe decides from the inbox", () => {
  it("lists the team's pending requests in the inbox, never another team's or company's", async () => {
    const mine = await ask(a.companyId, orgA.ana);
    await ask(a.companyId, orgA.solo, {
      startDate: addDays(today, 5),
      endDate: addDays(today, 5),
      days: "1",
    });
    await ask(b.companyId, orgB.ana);

    const inbox = await listApprovalsInbox(
      await accessOf(a.companyId, orgA.boss),
    );
    expect(inbox.items.map((item) => item.id)).toEqual([mine]);
    expect(inbox.items[0]).toMatchObject({
      source: "time_off_request",
      personId: orgA.ana.personId,
      href: `/mi/equipo/aprobaciones/${mine}`,
    });

    const other = await listApprovalsInbox(
      await accessOf(a.companyId, orgA.otherBoss),
    );
    expect(other.items).toEqual([]);
  });

  it("pages the inbox with one cursor and no repeats", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      ids.push(
        await ask(a.companyId, index % 2 ? orgA.ana : orgA.beto, {
          kind: "permiso_con_goce",
          startDate: addDays(today, 40 + index),
          endDate: addDays(today, 40 + index),
          days: "1",
        }),
      );
    }

    const access = await accessOf(a.companyId, orgA.boss);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listApprovalsInbox>> =
        await listApprovalsInbox(access, { cursor, limit: 2 });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.next;
    } while (cursor);

    expect(seen).toEqual([...ids].reverse());
  });

  it("approval writes the vacation row, consumes balance and tells the employee", async () => {
    const id = await ask(a.companyId, orgA.ana);
    const before = await takenHalves(a.companyId, orgA.ana);
    const access = await accessOf(a.companyId, orgA.boss);

    expect(
      await decideRequestAsManager(access, id, { decision: "approve" }),
    ).toMatchObject({ ok: true, id });

    const row = await requestRow(id);
    expect(row).toMatchObject({
      status: "approved",
      decidedByAccountId: orgA.boss.accountId,
      decidedByUserId: null,
    });
    expect(row.vacationRecordId).not.toBeNull();

    const [record] = await ownerDb
      .select()
      .from(vacationRecords)
      .where(eq(vacationRecords.id, row.vacationRecordId!));
    expect(record).toMatchObject({
      personId: orgA.ana.personId,
      startDate: row.startDate,
      days: "2.0",
      voidedAt: null,
      createdBy: null,
    });
    expect(await takenHalves(a.companyId, orgA.ana)).toBe(before + 4);

    expect((await auditOf(id)).map((event) => event.action)).toEqual([
      "create",
      "approve",
    ]);
    const [recordAudit] = await auditOf(record.id);
    expect(recordAudit).toMatchObject({
      action: "create",
      actorEmployeeAccountId: orgA.boss.accountId,
      source: "employee",
    });

    const kinds = (await eventsOf(orgA.ana.personId)).map(
      (event) => (event.payload as { kind: string }).kind,
    );
    expect(kinds.sort()).toEqual(["approval", "enjoyment", "request"]);

    const toAna = await notificationsOf(orgA.ana.personId);
    expect(toAna).toHaveLength(1);
    expect(toAna[0]).toMatchObject({
      template: "request_decision",
      url: "/mi/solicitudes",
    });

    // It left the inbox.
    expect((await listApprovalsInbox(access)).items).toEqual([]);
    // A second decision is refused.
    expect(
      await decideRequestAsManager(access, id, {
        decision: "reject",
        reason: "Tarde",
      }),
    ).toEqual({ ok: false, error: REQUEST_COPY.notPending });
  });

  it("rejection needs a reason and does not consume balance", async () => {
    const id = await ask(a.companyId, orgA.ana);
    const access = await accessOf(a.companyId, orgA.boss);

    expect(
      await decideRequestAsManager(access, id, { decision: "reject" }),
    ).toEqual({ ok: false, error: REQUEST_COPY.reasonRequired });
    expect(
      await decideRequestAsManager(access, id, {
        decision: "reject",
        reason: "Cierre de mes",
      }),
    ).toMatchObject({ ok: true });

    expect(await requestRow(id)).toMatchObject({
      status: "rejected",
      decisionReason: "Cierre de mes",
      vacationRecordId: null,
    });
    expect(await takenHalves(a.companyId, orgA.ana)).toBe(0);
    const [toAna] = await notificationsOf(orgA.ana.personId);
    expect(toAna.body).toContain("Cierre de mes");
  });

  it("lib:requests/decideRequestAsManager refuses another team and another company", async () => {
    const id = await ask(a.companyId, orgA.ana);

    for (const access of [
      await accessOf(a.companyId, orgA.otherBoss),
      await accessOf(b.companyId, orgB.boss),
    ]) {
      expect(
        await decideRequestAsManager(access, id, { decision: "approve" }),
      ).toEqual({ ok: false, error: REQUEST_COPY.notFound });
      expect(await getRequestForManager(access, id)).toBeNull();
    }
    expect((await requestRow(id)).status).toBe("pending");
  });

  it("the backup decides while the delegation lasts, as themselves", async () => {
    const id = await ask(a.companyId, orgA.beto);
    await createDelegation(await accessOf(a.companyId, orgA.boss), {
      delegateAccountId: orgA.backup.accountId,
      startsOn: today,
      endsOn: addDays(today, 2),
    });

    const backup = await accessOf(a.companyId, orgA.backup);
    expect((await listApprovalsInbox(backup)).items.map((i) => i.id)).toEqual([
      id,
    ]);
    expect(
      await decideRequestAsManager(backup, id, { decision: "approve" }),
    ).toMatchObject({ ok: true });
    expect((await requestRow(id)).decidedByAccountId).toBe(
      orgA.backup.accountId,
    );
  });

  it("a backup never decides their own request", async () => {
    const id = await ask(a.companyId, orgA.backup);
    await createDelegation(await accessOf(a.companyId, orgA.boss), {
      delegateAccountId: orgA.backup.accountId,
      startsOn: today,
      endsOn: addDays(today, 2),
    });
    const backup = await accessOf(a.companyId, orgA.backup);

    expect((await listApprovalsInbox(backup)).items).toEqual([]);
    expect(await getRequestForManager(backup, id)).toBeNull();
    expect(
      await decideRequestAsManager(backup, id, { decision: "approve" }),
    ).toEqual({ ok: false, error: REQUEST_COPY.ownRequest });
  });

  it("shows the rest day and who else on the team is off", async () => {
    const start = addDays(today, 50);
    await ownerDb.insert(personSchedules).values({
      companyId: a.companyId,
      personId: orgA.ana.personId,
      restDay: "dom",
    });
    const beto = await ask(a.companyId, orgA.beto, {
      startDate: start,
      endDate: addDays(start, 2),
      days: "3",
    });
    const ana = await ask(a.companyId, orgA.ana, {
      startDate: start,
      endDate: addDays(start, 6),
      days: "6",
    });

    const detail = await getRequestForManager(
      await accessOf(a.companyId, orgA.boss),
      ana,
    );
    expect(detail?.conflicts).toMatchObject({
      restDay: "dom",
      workingDays: 6,
      teamOverlaps: [
        expect.objectContaining({
          startDate: start,
          what: "solicitud pendiente",
        }),
      ],
    });
    expect(beto).toBeTruthy();
    await ownerDb
      .delete(personSchedules)
      .where(eq(personSchedules.personId, orgA.ana.personId));
  });
});

describe("the employee cancels", () => {
  it("lib:requests/cancelTimeOffRequest voids an approved vacation before its first day", async () => {
    const id = await ask(a.companyId, orgA.ana);
    await decideRequestAsManager(await accessOf(a.companyId, orgA.boss), id, {
      decision: "approve",
    });
    const { vacationRecordId } = await requestRow(id);

    // Someone else, or another company, cannot.
    expect(
      await cancelTimeOffRequest(contextOf(a.companyId, orgA.beto), id),
    ).toEqual({ ok: false, error: REQUEST_COPY.notFound });
    expect(
      await cancelTimeOffRequest(contextOf(b.companyId, orgB.ana), id),
    ).toEqual({ ok: false, error: REQUEST_COPY.notFound });

    // On or after the first day it is HR's to void.
    expect(
      await cancelTimeOffRequest(
        contextOf(a.companyId, orgA.ana),
        id,
        addDays(today, 10),
      ),
    ).toEqual({ ok: false, error: REQUEST_COPY.cannotCancel });

    expect(
      await cancelTimeOffRequest(contextOf(a.companyId, orgA.ana), id),
    ).toMatchObject({ ok: true });
    expect(await requestRow(id)).toMatchObject({ status: "cancelled" });
    const [record] = await ownerDb
      .select()
      .from(vacationRecords)
      .where(eq(vacationRecords.id, vacationRecordId!));
    expect(record.voidedAt).not.toBeNull();
    expect(await takenHalves(a.companyId, orgA.ana)).toBe(0);
    expect((await auditOf(id)).map((event) => event.action)).toEqual([
      "create",
      "approve",
      "cancel",
    ]);
  });
});

describe("an approved permiso justifies its days (W2-14)", () => {
  const permiso = (who: Member, kind = "permiso_con_goce") =>
    ask(a.companyId, who, { kind, days: "2" });

  const justificationsOf = (reference: string) =>
    ownerDb
      .select()
      .from(incidenciaJustifications)
      .where(eq(incidenciaJustifications.reference, reference));

  it("approval writes the justification in the same transaction, and a cancel undoes it", async () => {
    const id = await permiso(orgA.ana, "permiso_sin_goce");
    const access = await accessOf(a.companyId, orgA.boss);

    expect(
      await decideRequestAsManager(access, id, { decision: "approve" }),
    ).toMatchObject({ ok: true, id });

    const [justification] = await justificationsOf(id);
    expect(justification).toMatchObject({
      companyId: a.companyId,
      personId: orgA.ana.personId,
      kind: "permiso_sin_goce",
      fromDay: addDays(today, 10),
      toDay: addDays(today, 11),
      effect: "justify",
      reason: "Solicitud aprobada por su jefe",
      createdBy: null,
      cancelledAt: null,
    });
    // No vacation row for a permiso.
    expect((await requestRow(id)).vacationRecordId).toBeNull();

    expect(
      await cancelTimeOffRequest(contextOf(a.companyId, orgA.ana), id),
    ).toMatchObject({ ok: true });
    const [cancelled] = await justificationsOf(id);
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.cancelReason).toBe("Solicitud cancelada por la persona");
    expect(
      (await auditOf(justification.id)).map((event) => event.action),
    ).toEqual(["create", "revoke"]);
  });

  it("HR's approval names HR as the one who justified it", async () => {
    const id = await permiso(orgA.solo);

    expect(
      await decideRequestAsHr(
        a.companyId,
        id,
        { decision: "approve" },
        a.admin.id,
      ),
    ).toMatchObject({ ok: true });
    expect(await justificationsOf(id)).toEqual([
      expect.objectContaining({
        kind: "permiso_con_goce",
        reason: "Solicitud aprobada por RH",
        createdBy: a.admin.id,
      }),
    ]);
  });

  it("a rejection or an approved vacation writes no justification", async () => {
    const access = await accessOf(a.companyId, orgA.boss);
    const rejected = await permiso(orgA.ana);
    await decideRequestAsManager(access, rejected, {
      decision: "reject",
      reason: "Cierre de mes",
    });
    const vacation = await ask(a.companyId, orgA.beto);
    await decideRequestAsManager(access, vacation, { decision: "approve" });

    expect(await justificationsOf(rejected)).toEqual([]);
    expect(await justificationsOf(vacation)).toEqual([]);
  });

  it("a closed quincena refuses the approval and leaves the request pending", async () => {
    const id = await permiso(orgA.ana);
    const period = quincenaOf(addDays(today, 10));
    const range = quincenaRange(period);
    await ownerDb.insert(payPeriods).values({
      companyId: a.companyId,
      period,
      startsOn: range.from,
      endsOn: range.to,
      status: "closed",
      closedAt: new Date(),
    });

    expect(
      await decideRequestAsManager(await accessOf(a.companyId, orgA.boss), id, {
        decision: "approve",
      }),
    ).toEqual({ ok: false, error: REQUEST_COPY.periodClosed });
    expect(await requestRow(id)).toMatchObject({
      status: "pending",
      decidedAt: null,
    });
    expect(await justificationsOf(id)).toEqual([]);
    expect((await auditOf(id)).map((event) => event.action)).toEqual([
      "create",
    ]);
  });
});

describe("HR sees every request of its company", () => {
  it("lib:requests/listCompanyRequests", async () => {
    const mine = await ask(a.companyId, orgA.ana);
    const solo = await ask(a.companyId, orgA.solo, {
      startDate: addDays(today, 5),
      endDate: addDays(today, 5),
      days: "1",
    });
    const other = await ask(b.companyId, orgB.ana);

    const all = await listCompanyRequests(a.companyId);
    expect(all.items.map((item) => item.id).sort()).toEqual(
      [mine, solo].sort(),
    );
    expect(all.items.map((item) => item.id)).not.toContain(other);
    expect(
      (await listCompanyRequests(a.companyId, { hrOnly: true })).items.map(
        (item) => item.id,
      ),
    ).toEqual([solo]);
    expect(
      (await listCompanyRequests(a.companyId, { status: "approved" })).items,
    ).toEqual([]);
  });

  it("lib:requests/getCompanyRequest", async () => {
    const id = await ask(a.companyId, orgA.ana);

    expect(await getCompanyRequest(b.companyId, id)).toBeNull();
    expect(await getCompanyRequest(a.companyId, id)).toMatchObject({
      id,
      personId: orgA.ana.personId,
      approverName: expect.stringContaining("Jefa A"),
    });
  });

  it("lib:requests/decideRequestAsHr", async () => {
    const id = await ask(a.companyId, orgA.solo, {
      startDate: addDays(today, 5),
      endDate: addDays(today, 5),
      days: "1",
    });

    expect(
      await decideRequestAsHr(
        b.companyId,
        id,
        { decision: "approve" },
        b.admin.id,
      ),
    ).toEqual({ ok: false, error: REQUEST_COPY.notFound });
    expect((await requestRow(id)).status).toBe("pending");

    expect(
      await decideRequestAsHr(
        a.companyId,
        id,
        { decision: "approve" },
        a.admin.id,
      ),
    ).toMatchObject({ ok: true });
    expect(await requestRow(id)).toMatchObject({
      status: "approved",
      decidedByUserId: a.admin.id,
      decidedByAccountId: null,
    });
    const [record] = await ownerDb
      .select()
      .from(vacationRecords)
      .where(eq(vacationRecords.personId, orgA.solo.personId));
    expect(record.createdBy).toBe(a.admin.id);
  });

  it("action:requests/decideRequestByHrAction", async () => {
    const id = await ask(a.companyId, orgA.solo, {
      startDate: addDays(today, 5),
      endDate: addDays(today, 5),
      days: "1",
    });

    const hr = (companyId: string, extra: Record<string, string> = {}) =>
      navigationOf(() =>
        decideRequestByHrAction(
          {},
          formData({ companyId, requestId: id, decision: "approve", ...extra }),
        ),
      );

    actAs(b.admin, b.companyId);
    expect(
      await decideRequestByHrAction(
        {},
        formData({
          companyId: b.companyId,
          requestId: id,
          decision: "approve",
        }),
      ),
    ).toEqual({ error: REQUEST_COPY.notFound });

    // A form opened in company A, sent from a session now in company B.
    expect(
      await decideRequestByHrAction(
        {},
        formData({
          companyId: a.companyId,
          requestId: id,
          decision: "approve",
        }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect((await requestRow(id)).status).toBe("pending");

    actAs(a.admin, a.companyId);
    expect(
      await hr(a.companyId, { decision: "reject", reason: "Sin cobertura" }),
    ).toBe("redirect");
    expect((await requestRow(id)).status).toBe("rejected");
  });

  it("rbac:action:requests/decideRequestByHrAction", async () => {
    const id = await ask(b.companyId, orgB.solo, {
      startDate: addDays(today, 5),
      endDate: addDays(today, 5),
      days: "1",
    });
    const send = () =>
      decideRequestByHrAction(
        {},
        formData({
          companyId: b.companyId,
          requestId: id,
          decision: "approve",
        }),
      );

    actAs(b.viewer, b.companyId);
    expect(await send()).toEqual({ error: REQUEST_COPY.deniedDecide });
    expect((await requestRow(id)).status).toBe("pending");

    actAs(b.editor, b.companyId);
    expect(await navigationOf(send)).toBe("redirect");
    expect((await requestRow(id)).status).toBe("approved");
  });

  it("page:/app/solicitudes", async () => {
    // The viewer role has no vacations:read.
    actAs(b.viewer, b.companyId);
    expect(
      await navigationOf(() =>
        HrRequestsPage({ searchParams: Promise.resolve({}) }),
      ),
    ).toBe("forbidden");

    actAs(b.editor, b.companyId);
    expect(
      await navigationOf(() =>
        HrRequestsPage({ searchParams: Promise.resolve({}) }),
      ),
    ).toBeNull();

    const id = await ask(a.companyId, orgA.ana);
    expect(
      await navigationOf(() =>
        HrRequestPage({ params: Promise.resolve({ id }) }),
      ),
    ).toBe("notFound");

    actAs(a.editor, a.companyId);
    expect(
      await navigationOf(() =>
        HrRequestPage({ params: Promise.resolve({ id }) }),
      ),
    ).toBeNull();
  });
});

describe("the /mi actions use the session, never the form", () => {
  it("action:employee/createRequestAction", async () => {
    expect(
      await navigationOf(() =>
        createRequestAction({}, formData({ kind: "vacaciones" })),
      ),
    ).toBe("redirect");
    expect(await ownerDb.select().from(timeOffRequests)).toEqual([]);

    employee.context = contextOf(a.companyId, orgA.ana);
    expect(
      await navigationOf(() =>
        createRequestAction(
          {},
          formData({
            kind: "permiso_con_goce",
            startDate: addDays(today, 2),
            endDate: addDays(today, 2),
            days: "1",
            // Ignored: the person is the session's.
            personId: orgB.ana.personId,
            companyId: b.companyId,
          }),
        ),
      ),
    ).toBe("redirect");

    const rows = await ownerDb.select().from(timeOffRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: a.companyId,
      personId: orgA.ana.personId,
    });
  });

  it("action:employee/cancelRequestAction", async () => {
    const id = await ask(b.companyId, orgB.ana);

    employee.context = contextOf(a.companyId, orgA.ana);
    expect(await cancelRequestAction({}, formData({ requestId: id }))).toEqual({
      error: REQUEST_COPY.notFound,
    });
    expect((await requestRow(id)).status).toBe("pending");

    employee.context = contextOf(b.companyId, orgB.ana);
    expect(await cancelRequestAction({}, formData({ requestId: id }))).toEqual({
      notice: "Solicitud cancelada.",
    });
  });

  it("action:employee/decideRequestAction", async () => {
    const id = await ask(a.companyId, orgA.ana);

    // Not a manager, another team's manager, another company's manager.
    for (const who of [
      contextOf(a.companyId, orgA.beto),
      contextOf(a.companyId, orgA.otherBoss),
      contextOf(b.companyId, orgB.boss),
    ]) {
      employee.context = who;
      expect(
        await decideRequestAction(
          {},
          formData({ requestId: id, decision: "approve" }),
        ),
      ).toEqual({ error: REQUEST_COPY.notFound });
    }
    expect((await requestRow(id)).status).toBe("pending");

    employee.context = contextOf(a.companyId, orgA.boss);
    expect(
      await navigationOf(() =>
        decideRequestAction(
          {},
          formData({ requestId: id, decision: "approve" }),
        ),
      ),
    ).toBe("redirect");
    expect((await requestRow(id)).status).toBe("approved");
  });

  it("page:/mi/equipo/aprobaciones/[requestId]", async () => {
    const id = await ask(a.companyId, orgA.ana);
    const visit = () =>
      navigationOf(() =>
        RequestDecisionPage({ params: Promise.resolve({ requestId: id }) }),
      );

    employee.context = contextOf(a.companyId, orgA.otherBoss);
    expect(await visit()).toBe("notFound");
    employee.context = contextOf(b.companyId, orgB.boss);
    expect(await visit()).toBe("notFound");
    employee.context = contextOf(a.companyId, orgA.beto);
    expect(await visit()).toBe("notFound");
    employee.context = contextOf(a.companyId, orgA.boss);
    expect(await visit()).toBeNull();
  });

  it("page:/mi/solicitudes", async () => {
    await ask(b.companyId, orgB.ana);
    employee.context = contextOf(a.companyId, orgA.ana);
    expect(
      await navigationOf(() =>
        MyRequestsPage({ searchParams: Promise.resolve({}) }),
      ),
    ).toBeNull();
  });
});

describe("the inbox index", () => {
  it("serves a page of the inbox with one range scan and no sort", async () => {
    const rows = Array.from({ length: 2000 }, (_, index) => ({
      companyId: a.companyId,
      personId: index % 2 ? orgA.ana.personId : orgA.solo.personId,
      kind: "permiso_con_goce" as const,
      status: index % 3 ? ("approved" as const) : ("pending" as const),
      decidedAt: index % 3 ? new Date() : null,
      startDate: addDays(today, 100 + (index % 200)),
      endDate: addDays(today, 100 + (index % 200)),
      days: "1",
      managerId: index % 2 ? orgA.boss.personId : null,
      createdAt: new Date(Date.now() - index * 60_000),
    }));
    await ownerDb.insert(timeOffRequests).values(rows);
    await ownerDb.execute(sql.raw("ANALYZE time_off_requests"));

    const plan = await ownerDb.execute(
      sql.raw(`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM time_off_requests
      WHERE company_id = '${a.companyId}'
        AND manager_id IN ('${orgA.boss.personId}')
        AND status = 'pending'
        AND (created_at, id) < (now(), 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
      ORDER BY created_at DESC, id DESC
      LIMIT 31`),
    );
    const text = JSON.stringify(plan.rows);
    expect(text).toContain("time_off_requests_inbox_idx");
    expect(text).not.toContain('"Sort"');
    await ownerDb
      .delete(timeOffRequests)
      .where(
        and(
          eq(timeOffRequests.companyId, a.companyId),
          inArray(timeOffRequests.personId, [
            orgA.ana.personId,
            orgA.solo.personId,
          ]),
        ),
      );
  });
});
