import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction, type DbTransaction } from "@/lib/db";
import { clampPageSize, defineKeyset, keysetCursor } from "@/lib/db/keyset";
import {
  employeeAccounts,
  employmentPeriods,
  people,
  personSchedules,
  timeOffRequests,
  users,
  vacationRecords,
  type TimeOffKind,
  type TimeOffRequest,
  type TimeOffStatus,
} from "@/lib/db/schema";
import type { EmployeeContext } from "@/lib/employee-accounts/sign-in";
import { formatDateMx, isoToday } from "@/lib/format/date";
import {
  approverPersonIds,
  canDecideFor,
  currentApprover,
  type ManagerAccess,
} from "@/lib/managers/scope";
import type { InboxAfter, InboxItem } from "@/lib/managers/inbox";
import {
  createNotifications,
  hrRecipientsWithPermission,
  personRecipient,
  sendNotificationsSoon,
} from "@/lib/notifications";
import { formatPersonName } from "@/lib/people/schema";
import { withTenant } from "@/lib/tenant/scope";
import { appendPersonEvents } from "@/lib/timeline";
import {
  permisoRequestEvent,
  vacationRequestEvent,
  type VacationRequestKind,
} from "@/lib/timeline/events";
import {
  registerVacationRecordInTx,
  voidVacationRecordInTx,
  type VacationActor,
} from "@/lib/vacations";
import {
  formatVacationDays,
  previewVacationRegistration,
  VACATION_COPY,
} from "@/lib/vacations/balance";

import {
  canCancel,
  notificationKind,
  parseDecision,
  parseRequestInput,
  permisoPay,
  rangesOverlap,
  REQUEST_COPY,
  TIME_OFF_KIND_LABELS,
  workingDaysInRange,
  type RequestInput,
  type WeekDay,
} from "./rules";

export * from "./rules";

/**
 * Requests and approvals (Workia 2.0 W2-06, docs/solicitudes.md). An employee
 * asks for vacaciones or a permiso from /mi; their jefe with a live manager
 * grant (or the backup covering for them) decides from the approvals inbox;
 * HR sees every request and decides the ones without a jefe. Each transition
 * runs in one transaction with its audit event, its person_events row and
 * its notification. An approved vacation writes the vacation_records row
 * there too, so the balance moves only on approval.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who may decide a person's request in the HR app (HR writes vacation rows). */
export const HR_DECIDE_PERMISSION = "vacations:update" as const;

export type RequestResult =
  | { ok: true; id: string; warning?: string | null }
  | { ok: false; error: string };

type Employee = Pick<EmployeeContext, "accountId" | "companyId" | "personId">;

const requester = alias(people, "requester");
const approver = alias(people, "approver");
const decider = alias(people, "decider");
const deciderAccount = alias(employeeAccounts, "decider_account");

// ── Timeline, audit and notifications of one transition ─────────────────

const timelineEvent = (
  request: TimeOffRequest,
  step: VacationRequestKind,
  occurredAt: Date,
  source: string,
) =>
  request.kind === "vacaciones"
    ? vacationRequestEvent({
        personId: request.personId,
        requestId: request.id,
        kind: step,
        occurredAt,
        source,
        days: Number(request.days),
        from: request.startDate,
        to: request.endDate,
        vacationRecordId: request.vacationRecordId,
      })
    : permisoRequestEvent({
        personId: request.personId,
        requestId: request.id,
        kind: step,
        pay: permisoPay(request.kind),
        occurredAt,
        source,
        days: Number(request.days),
        from: request.startDate,
        to: request.endDate,
      });

/** What the audit keeps: never the note (it can carry health data). */
const snapshot = (request: TimeOffRequest) => ({
  personId: request.personId,
  kind: request.kind,
  status: request.status,
  startDate: request.startDate,
  endDate: request.endDate,
  days: request.days,
  managerId: request.managerId,
  vacationRecordId: request.vacationRecordId,
});

const rangeText = (request: { startDate: string; endDate: string }) =>
  request.startDate === request.endDate
    ? `el ${formatDateMx(request.startDate)}`
    : `del ${formatDateMx(request.startDate)} al ${formatDateMx(request.endDate)}`;

const summaryOf = (request: TimeOffRequest, verb: string) =>
  `${TIME_OFF_KIND_LABELS[request.kind]} ${rangeText(request)} (${formatVacationDays(request.days)}): ${verb}`;

type Actor =
  { kind: "employee"; accountId: string } | { kind: "hr"; userId: string };

const auditActor = (actor: Actor) =>
  actor.kind === "employee"
    ? { actorEmployeeAccountId: actor.accountId, source: "employee" as const }
    : { actorUserId: actor.userId };

const vacationActor = (actor: Actor): VacationActor =>
  actor.kind === "employee"
    ? { employeeAccountId: actor.accountId }
    : { userId: actor.userId };

const sourceOf = (actor: Actor) =>
  actor.kind === "employee" ? "employee" : "app";

// ── Create ───────────────────────────────────────────────────────────────

/** The person's spans that block new dates: live requests and vacation rows. */
const lockedSpans = async (
  tx: DbTransaction,
  companyId: string,
  personId: string,
) => {
  const [requests, records, periods] = await Promise.all([
    tx
      .select({
        id: timeOffRequests.id,
        kind: timeOffRequests.kind,
        startDate: timeOffRequests.startDate,
        endDate: timeOffRequests.endDate,
        days: timeOffRequests.days,
        vacationRecordId: timeOffRequests.vacationRecordId,
      })
      .from(timeOffRequests)
      .where(
        withTenant(
          timeOffRequests,
          companyId,
          eq(timeOffRequests.personId, personId),
          inArray(timeOffRequests.status, ["pending", "approved"]),
        ),
      )
      .for("update"),
    tx
      .select({
        id: vacationRecords.id,
        startDate: vacationRecords.startDate,
        endDate: vacationRecords.endDate,
        serviceYear: vacationRecords.serviceYear,
        days: vacationRecords.days,
        voidedAt: vacationRecords.voidedAt,
      })
      .from(vacationRecords)
      .where(
        withTenant(
          vacationRecords,
          companyId,
          eq(vacationRecords.personId, personId),
        ),
      )
      .for("update"),
    tx
      .select({
        id: employmentPeriods.id,
        fechaIngreso: employmentPeriods.fechaIngreso,
        fechaBaja: employmentPeriods.fechaBaja,
        bajaSinFecha: employmentPeriods.bajaSinFecha,
        reconoceAntiguedad: employmentPeriods.reconoceAntiguedad,
        fechaAntiguedadReconocida: employmentPeriods.fechaAntiguedadReconocida,
      })
      .from(employmentPeriods)
      .where(
        withTenant(
          employmentPeriods,
          companyId,
          eq(employmentPeriods.personId, personId),
        ),
      ),
  ]);

  return { requests, records, periods };
};

/**
 * Checks a vacation request against the balance: the ledger rows plus the
 * person's other pending vacation requests, each placed in its service year
 * the same way an approval will place it. Over the entitlement is refused
 * here; HR can still register more from the expediente.
 */
const checkVacationBalance = (
  spans: Awaited<ReturnType<typeof lockedSpans>>,
  fallbackFechaIngreso: string | null,
  request: { startDate: string; endDate: string; days: string },
) => {
  const ledger = spans.records.map((row) => ({
    startDate: row.startDate,
    endDate: row.endDate,
    serviceYear: row.serviceYear,
    days: row.days,
    voided: row.voidedAt !== null,
  }));
  const pending = spans.requests
    .filter((row) => row.kind === "vacaciones" && !row.vacationRecordId)
    .flatMap((row) => {
      const placed = previewVacationRegistration({
        periods: spans.periods,
        fallbackFechaIngreso,
        startDate: row.startDate,
        endDate: row.endDate,
        days: row.days,
        existing: [],
      });

      return placed.ok
        ? [
            {
              startDate: row.startDate,
              endDate: row.endDate,
              serviceYear: placed.serviceYear,
              days: placed.days,
              voided: false,
            },
          ]
        : [];
    });

  const preview = previewVacationRegistration({
    periods: spans.periods,
    fallbackFechaIngreso,
    startDate: request.startDate,
    endDate: request.endDate,
    days: request.days,
    existing: [...ledger, ...pending],
  });

  if (!preview.ok) {
    return {
      ok: false as const,
      error:
        preview.error === VACATION_COPY.overlap
          ? REQUEST_COPY.overlap
          : preview.error === VACATION_COPY.noServiceYear
            ? REQUEST_COPY.noServiceYear
            : preview.error,
    };
  }

  if (preview.warning) {
    return { ok: false as const, error: REQUEST_COPY.overBalance };
  }

  return { ok: true as const };
};

/**
 * The signed-in employee asks for vacaciones or a permiso. The person comes
 * from the session, never from the form. The approver is stored now
 * (currentApprover); null sends it to HR. Notifies whoever decides.
 */
export const createTimeOffRequest = async (
  employee: Employee,
  input: RequestInput,
  today = isoToday(),
): Promise<RequestResult> => {
  const parsed = parseRequestInput(input, today);

  if (!parsed.ok) {
    return parsed;
  }

  const { companyId, personId, accountId } = employee;
  const value = parsed.value;
  const managerId = await currentApprover(companyId, personId);
  const hrRecipients = managerId
    ? []
    : await hrRecipientsWithPermission(companyId, HR_DECIDE_PERMISSION);

  const result = await withTransaction(async (tx): Promise<RequestResult> => {
    const [person] = await tx
      .select({
        id: people.id,
        nombres: people.nombres,
        apellidoPaterno: people.apellidoPaterno,
        apellidoMaterno: people.apellidoMaterno,
        fechaIngreso: people.fechaIngreso,
        status: people.status,
        deletedAt: people.deletedAt,
      })
      .from(people)
      .where(withTenant(people, companyId, eq(people.id, personId)))
      .for("update");

    if (!person || person.deletedAt || person.status !== "activa") {
      return { ok: false, error: REQUEST_COPY.notActive };
    }

    const spans = await lockedSpans(tx, companyId, personId);
    const overlaps =
      spans.requests.some((row) => rangesOverlap(row, value)) ||
      spans.records.some(
        (row) => row.voidedAt === null && rangesOverlap(row, value),
      );

    if (overlaps) {
      return { ok: false, error: REQUEST_COPY.overlap };
    }

    if (value.kind === "vacaciones") {
      const balance = checkVacationBalance(spans, person.fechaIngreso, value);

      if (!balance.ok) {
        return balance;
      }
    }

    const [created] = await tx
      .insert(timeOffRequests)
      .values({
        companyId,
        personId,
        kind: value.kind,
        startDate: value.startDate,
        endDate: value.endDate,
        days: value.days,
        note: value.note,
        managerId,
        requestedByAccountId: accountId,
      })
      .returning();

    const actor: Actor = { kind: "employee", accountId };

    await recordAuditEvent(
      {
        companyId,
        ...auditActor(actor),
        resourceType: "time_off_request",
        resourceId: created.id,
        action: "create",
        payload: {
          after: snapshot(created),
          summary: summaryOf(
            created,
            managerId ? "solicitada a su jefe" : "solicitada a RH",
          ),
        },
      },
      tx,
    );
    await appendPersonEvents(
      companyId,
      [timelineEvent(created, "request", created.createdAt, "employee")],
      tx,
    );

    const data = {
      requesterName: formatPersonName(person),
      request: notificationKind(created.kind),
      from: created.startDate,
      to: created.endDate,
    };

    if (managerId) {
      await createNotifications(
        companyId,
        {
          template: "request_pending",
          data,
          recipients: [personRecipient(managerId)],
          eventKey: `time_off_request:${created.id}:pending`,
          url: `/mi/equipo/aprobaciones/${created.id}`,
        },
        tx,
      );
    } else if (hrRecipients.length > 0) {
      await createNotifications(
        companyId,
        {
          template: "request_pending",
          data,
          recipients: hrRecipients,
          eventKey: `time_off_request:${created.id}:pending`,
          url: `/app/solicitudes/${created.id}`,
        },
        tx,
      );
    }

    return { ok: true, id: created.id };
  }, companyId);

  if (result.ok) {
    await sendNotificationsSoon(companyId);
  }

  return result;
};

// ── Decide ───────────────────────────────────────────────────────────────

type Decider =
  { kind: "manager"; access: ManagerAccess } | { kind: "hr"; userId: string };

const decide = async (
  companyId: string,
  requestId: string,
  input: { decision: string; reason?: string | null },
  decider: Decider,
): Promise<RequestResult> => {
  if (!UUID.test(requestId)) {
    return { ok: false, error: REQUEST_COPY.notFound };
  }

  const parsed = parseDecision(input.decision, input.reason);

  if (!parsed.ok) {
    return parsed;
  }

  const actor: Actor =
    decider.kind === "manager"
      ? { kind: "employee", accountId: decider.access.accountId }
      : { kind: "hr", userId: decider.userId };

  const result = await withTransaction(async (tx): Promise<RequestResult> => {
    const [current] = await tx
      .select()
      .from(timeOffRequests)
      .where(
        withTenant(
          timeOffRequests,
          companyId,
          eq(timeOffRequests.id, requestId),
        ),
      )
      .for("update");

    if (!current) {
      return { ok: false, error: REQUEST_COPY.notFound };
    }

    if (decider.kind === "manager") {
      // A request of someone else's team reads as missing (IDOR).
      if (
        !current.managerId ||
        !canDecideFor(decider.access, current.managerId)
      ) {
        return { ok: false, error: REQUEST_COPY.notFound };
      }

      if (current.personId === decider.access.personId) {
        return { ok: false, error: REQUEST_COPY.ownRequest };
      }
    }

    if (current.status !== "pending") {
      return { ok: false, error: REQUEST_COPY.notPending };
    }

    let vacationRecordId: string | null = null;
    let warning: string | null = null;

    if (parsed.decision === "approve" && current.kind === "vacaciones") {
      const written = await registerVacationRecordInTx(
        tx,
        companyId,
        {
          personId: current.personId,
          startDate: current.startDate,
          endDate: current.endDate,
          days: current.days,
          note: null,
        },
        vacationActor(actor),
      );

      if (!written) {
        return { ok: false, error: REQUEST_COPY.notActive };
      }

      if (!written.ok) {
        return {
          ok: false,
          error:
            written.error === VACATION_COPY.overlap
              ? REQUEST_COPY.overlap
              : REQUEST_COPY.vacationFailed,
        };
      }

      vacationRecordId = written.id;
      warning = written.warning;
    }

    const now = new Date();
    const [updated] = await tx
      .update(timeOffRequests)
      .set({
        status: parsed.decision === "approve" ? "approved" : "rejected",
        decidedAt: now,
        decidedByAccountId: actor.kind === "employee" ? actor.accountId : null,
        decidedByUserId: actor.kind === "hr" ? actor.userId : null,
        decisionReason: parsed.reason,
        vacationRecordId,
      })
      .where(
        withTenant(
          timeOffRequests,
          companyId,
          eq(timeOffRequests.id, current.id),
          eq(timeOffRequests.status, "pending"),
        ),
      )
      .returning();

    if (!updated) {
      return { ok: false, error: REQUEST_COPY.notPending };
    }

    const approved = parsed.decision === "approve";

    await recordAuditEvent(
      {
        companyId,
        ...auditActor(actor),
        resourceType: "time_off_request",
        resourceId: updated.id,
        action: approved ? "approve" : "reject",
        payload: {
          before: snapshot(current),
          after: snapshot(updated),
          changes: {
            status: { from: current.status, to: updated.status },
          },
          summary: summaryOf(
            updated,
            approved
              ? decider.kind === "hr"
                ? "aprobada por RH"
                : "aprobada por su jefe"
              : decider.kind === "hr"
                ? "rechazada por RH"
                : "rechazada por su jefe",
          ),
        },
      },
      tx,
    );
    await appendPersonEvents(
      companyId,
      [
        timelineEvent(
          updated,
          approved ? "approval" : "rejection",
          now,
          sourceOf(actor),
        ),
      ],
      tx,
    );
    await createNotifications(
      companyId,
      {
        template: "request_decision",
        data: {
          request: notificationKind(updated.kind),
          decision: approved ? "aprobada" : "rechazada",
          from: updated.startDate,
          to: updated.endDate,
          reason: approved ? null : parsed.reason,
        },
        recipients: [personRecipient(updated.personId)],
        eventKey: `time_off_request:${updated.id}:${updated.status}`,
        url: `/mi/solicitudes`,
      },
      tx,
    );

    return { ok: true, id: updated.id, warning };
  }, companyId);

  if (result.ok) {
    await sendNotificationsSoon(companyId);
  }

  return result;
};

/**
 * A manager (or the backup covering for them today) approves or rejects a
 * request whose stored approver they decide for. Anything else is «not
 * found». Audited with the manager's employee account as the actor.
 */
export const decideRequestAsManager = (
  access: ManagerAccess,
  requestId: string,
  input: { decision: string; reason?: string | null },
) => decide(access.companyId, requestId, input, { kind: "manager", access });

/**
 * HR decides any pending request of its company: the ones without a jefe,
 * and any other when the jefe cannot. The caller checks vacations:update.
 */
export const decideRequestAsHr = async (
  companyId: string,
  requestId: string,
  input: { decision: string; reason?: string | null },
  userId: string,
) => decide(companyId, requestId, input, { kind: "hr", userId });

// ── Cancel ───────────────────────────────────────────────────────────────

/**
 * The employee cancels their own request: a pending one any time, an
 * approved one before its first day, which voids its vacation row in the
 * same transaction (the days return to the balance).
 */
export const cancelTimeOffRequest = async (
  employee: Employee,
  requestId: string,
  today = isoToday(),
): Promise<RequestResult> => {
  if (!UUID.test(requestId)) {
    return { ok: false, error: REQUEST_COPY.notFound };
  }

  const { companyId, personId, accountId } = employee;
  const actor: Actor = { kind: "employee", accountId };

  return withTransaction(async (tx): Promise<RequestResult> => {
    const [current] = await tx
      .select()
      .from(timeOffRequests)
      .where(
        withTenant(
          timeOffRequests,
          companyId,
          eq(timeOffRequests.id, requestId),
          eq(timeOffRequests.personId, personId),
        ),
      )
      .for("update");

    if (!current) {
      return { ok: false, error: REQUEST_COPY.notFound };
    }

    if (!canCancel(current, today)) {
      return { ok: false, error: REQUEST_COPY.cannotCancel };
    }

    if (current.status === "approved" && current.vacationRecordId) {
      const voided = await voidVacationRecordInTx(
        tx,
        companyId,
        current.vacationRecordId,
        vacationActor(actor),
      );

      // Already voided by HR is fine: the days are back either way.
      if (
        voided &&
        !voided.ok &&
        voided.error !== VACATION_COPY.alreadyVoided
      ) {
        return { ok: false, error: voided.error };
      }
    }

    const now = new Date();
    const [updated] = await tx
      .update(timeOffRequests)
      .set({ status: "cancelled", cancelledAt: now })
      .where(
        withTenant(
          timeOffRequests,
          companyId,
          eq(timeOffRequests.id, current.id),
          eq(timeOffRequests.status, current.status),
        ),
      )
      .returning();

    if (!updated) {
      return { ok: false, error: REQUEST_COPY.cannotCancel };
    }

    await recordAuditEvent(
      {
        companyId,
        ...auditActor(actor),
        resourceType: "time_off_request",
        resourceId: updated.id,
        action: "cancel",
        payload: {
          before: snapshot(current),
          after: snapshot(updated),
          changes: { status: { from: current.status, to: updated.status } },
          summary: summaryOf(updated, "cancelada por la persona"),
        },
      },
      tx,
    );
    await appendPersonEvents(
      companyId,
      [timelineEvent(updated, "cancellation", now, "employee")],
      tx,
    );

    return { ok: true, id: updated.id };
  }, companyId);
};

// ── Reads ────────────────────────────────────────────────────────────────

export type TimeOffRequestView = {
  id: string;
  personId: string;
  personName: string;
  kind: TimeOffKind;
  status: TimeOffStatus;
  startDate: string;
  endDate: string;
  days: string;
  note: string | null;
  managerId: string | null;
  approverName: string | null;
  decidedAt: Date | null;
  decidedByName: string | null;
  decisionReason: string | null;
  createdAt: Date;
  cancelledAt: Date | null;
};

const viewColumns = {
  id: timeOffRequests.id,
  personId: timeOffRequests.personId,
  kind: timeOffRequests.kind,
  status: timeOffRequests.status,
  startDate: timeOffRequests.startDate,
  endDate: timeOffRequests.endDate,
  days: timeOffRequests.days,
  note: timeOffRequests.note,
  managerId: timeOffRequests.managerId,
  decidedAt: timeOffRequests.decidedAt,
  decisionReason: timeOffRequests.decisionReason,
  createdAt: timeOffRequests.createdAt,
  cancelledAt: timeOffRequests.cancelledAt,
  requesterNombres: requester.nombres,
  requesterApellidoPaterno: requester.apellidoPaterno,
  requesterApellidoMaterno: requester.apellidoMaterno,
  approverNombres: approver.nombres,
  approverApellidoPaterno: approver.apellidoPaterno,
  approverApellidoMaterno: approver.apellidoMaterno,
  deciderNombres: decider.nombres,
  deciderApellidoPaterno: decider.apellidoPaterno,
  deciderApellidoMaterno: decider.apellidoMaterno,
  deciderUserName: users.name,
};

const nameOrNull = (
  nombres: string | null,
  apellidoPaterno: string | null,
  apellidoMaterno: string | null,
) =>
  nombres
    ? formatPersonName({
        nombres,
        apellidoPaterno: apellidoPaterno ?? "",
        apellidoMaterno,
      })
    : null;

type ViewRow = Omit<Awaited<ReturnType<typeof selectViews>>[number], "cursor">;

const toView = (row: ViewRow): TimeOffRequestView => ({
  id: row.id,
  personId: row.personId,
  personName: formatPersonName({
    nombres: row.requesterNombres,
    apellidoPaterno: row.requesterApellidoPaterno,
    apellidoMaterno: row.requesterApellidoMaterno,
  }),
  kind: row.kind,
  status: row.status,
  startDate: row.startDate,
  endDate: row.endDate,
  days: row.days,
  note: row.note,
  managerId: row.managerId,
  approverName: nameOrNull(
    row.approverNombres,
    row.approverApellidoPaterno,
    row.approverApellidoMaterno,
  ),
  decidedAt: row.decidedAt,
  decidedByName:
    nameOrNull(
      row.deciderNombres,
      row.deciderApellidoPaterno,
      row.deciderApellidoMaterno,
    ) ?? (row.deciderUserName ? `${row.deciderUserName} (RH)` : null),
  decisionReason: row.decisionReason,
  createdAt: row.createdAt,
  cancelledAt: row.cancelledAt,
});

/** The request rows with the names a screen shows, in `companyId`. */
const selectViews = (companyId: string, where: SQL) =>
  tdb(companyId)
    .select({ ...viewColumns, cursor: listKeyset.cursor })
    .from(timeOffRequests)
    .innerJoin(
      requester,
      and(
        eq(requester.companyId, timeOffRequests.companyId),
        eq(requester.id, timeOffRequests.personId),
      ),
    )
    .leftJoin(
      approver,
      and(
        eq(approver.companyId, timeOffRequests.companyId),
        eq(approver.id, timeOffRequests.managerId),
      ),
    )
    .leftJoin(
      deciderAccount,
      and(
        eq(deciderAccount.companyId, timeOffRequests.companyId),
        eq(deciderAccount.id, timeOffRequests.decidedByAccountId),
      ),
    )
    .leftJoin(
      decider,
      and(
        eq(decider.companyId, deciderAccount.companyId),
        eq(decider.id, deciderAccount.personId),
      ),
    )
    .leftJoin(users, eq(users.id, timeOffRequests.decidedByUserId))
    .where(where);

// Every list: newest first, through (…, created_at DESC, id DESC) indexes.
const listKeyset = defineKeyset([
  { column: timeOffRequests.createdAt, type: "timestamptz", direction: "desc" },
  { column: timeOffRequests.id, type: "uuid", direction: "desc" },
]);

export const REQUESTS_PAGE_SIZE = 30;

const pageOf = async (
  companyId: string,
  where: SQL,
  options: { cursor?: string | null; limit?: number },
) => {
  const limit = clampPageSize(options.limit, REQUESTS_PAGE_SIZE, 100);
  const rows = await selectViews(
    companyId,
    and(where, listKeyset.after(options.cursor)) as SQL,
  )
    .orderBy(...listKeyset.orderBy)
    .limit(limit + 1);
  const page = listKeyset.page(rows, limit);

  return { items: page.items.map(toView), next: page.next };
};

/** «Mis solicitudes»: the signed-in employee's requests, newest first. */
export const listMyRequests = (
  employee: Employee,
  options: { cursor?: string | null; limit?: number } = {},
) =>
  pageOf(
    employee.companyId,
    withTenant(
      timeOffRequests,
      employee.companyId,
      eq(timeOffRequests.personId, employee.personId),
    ),
    options,
  );

export type RequestConflicts = {
  /** Days the person works in the range by their schedule (rest day off). */
  workingDays: number;
  restDay: WeekDay | null;
  /** Other people with the same jefe who are off, or asked to be, on some of these days. */
  teamOverlaps: Array<{
    personName: string;
    startDate: string;
    endDate: string;
    what:
      "vacaciones registradas" | "solicitud pendiente" | "solicitud aprobada";
  }>;
};

const MAX_TEAM_OVERLAPS = 10;

/** What the approver weighs: the schedule and who else on the team is off. */
const conflictsOf = async (
  companyId: string,
  request: TimeOffRequestView,
): Promise<RequestConflicts> => {
  const database = tdb(companyId);
  const [[schedule], [person]] = await Promise.all([
    database
      .select({ restDay: personSchedules.restDay })
      .from(personSchedules)
      .where(
        withTenant(
          personSchedules,
          companyId,
          eq(personSchedules.personId, request.personId),
          isNull(personSchedules.deletedAt),
        ),
      )
      .limit(1),
    database
      .select({ managerId: people.managerId })
      .from(people)
      .where(withTenant(people, companyId, eq(people.id, request.personId)))
      .limit(1),
  ]);
  const restDay = (schedule?.restDay ?? null) as WeekDay | null;
  const teamManagerId = request.managerId ?? person?.managerId ?? null;
  let teamOverlaps: RequestConflicts["teamOverlaps"] = [];

  if (teamManagerId) {
    const teammate = and(
      eq(people.companyId, companyId),
      eq(people.managerId, teamManagerId),
      eq(people.status, "activa"),
      isNull(people.deletedAt),
      ne(people.id, request.personId),
    );
    const [asked, recorded] = await Promise.all([
      database
        .select({
          nombres: people.nombres,
          apellidoPaterno: people.apellidoPaterno,
          apellidoMaterno: people.apellidoMaterno,
          startDate: timeOffRequests.startDate,
          endDate: timeOffRequests.endDate,
          status: timeOffRequests.status,
          vacationRecordId: timeOffRequests.vacationRecordId,
        })
        .from(timeOffRequests)
        .innerJoin(
          people,
          and(
            eq(people.companyId, timeOffRequests.companyId),
            eq(people.id, timeOffRequests.personId),
          ),
        )
        .where(
          and(
            teammate,
            eq(timeOffRequests.companyId, companyId),
            inArray(timeOffRequests.status, ["pending", "approved"]),
            lte(timeOffRequests.startDate, request.endDate),
            gte(timeOffRequests.endDate, request.startDate),
          ),
        )
        .orderBy(timeOffRequests.startDate)
        .limit(MAX_TEAM_OVERLAPS),
      database
        .select({
          id: vacationRecords.id,
          nombres: people.nombres,
          apellidoPaterno: people.apellidoPaterno,
          apellidoMaterno: people.apellidoMaterno,
          startDate: vacationRecords.startDate,
          endDate: vacationRecords.endDate,
        })
        .from(vacationRecords)
        .innerJoin(
          people,
          and(
            eq(people.companyId, vacationRecords.companyId),
            eq(people.id, vacationRecords.personId),
          ),
        )
        .where(
          and(
            teammate,
            eq(vacationRecords.companyId, companyId),
            isNull(vacationRecords.voidedAt),
            lte(vacationRecords.startDate, request.endDate),
            gte(vacationRecords.endDate, request.startDate),
          ),
        )
        .orderBy(vacationRecords.startDate)
        .limit(MAX_TEAM_OVERLAPS),
    ]);
    // An approved vacation request and its ledger row are the same absence.
    const fromRequests = new Set(
      asked.map((row) => row.vacationRecordId).filter(Boolean),
    );

    teamOverlaps = [
      ...asked.map((row) => ({
        personName: formatPersonName(row),
        startDate: row.startDate,
        endDate: row.endDate,
        what:
          row.status === "approved"
            ? ("solicitud aprobada" as const)
            : ("solicitud pendiente" as const),
      })),
      ...recorded
        .filter((row) => !fromRequests.has(row.id))
        .map((row) => ({
          personName: formatPersonName(row),
          startDate: row.startDate,
          endDate: row.endDate,
          what: "vacaciones registradas" as const,
        })),
    ]
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
      .slice(0, MAX_TEAM_OVERLAPS);
  }

  return {
    workingDays: workingDaysInRange(
      request.startDate,
      request.endDate,
      restDay,
    ),
    restDay,
    teamOverlaps,
  };
};

export type RequestDetail = TimeOffRequestView & {
  conflicts: RequestConflicts;
};

const detailOf = async (
  companyId: string,
  where: SQL,
): Promise<RequestDetail | null> => {
  const [row] = await selectViews(companyId, where).limit(1);

  if (!row) {
    return null;
  }

  const view = toView(row);

  return { ...view, conflicts: await conflictsOf(companyId, view) };
};

/**
 * A request the manager decides for (their own approvals, or the ones of the
 * manager they cover for today), with what to weigh. Null otherwise: the
 * same 404 for another team and another company.
 */
export const getRequestForManager = async (
  access: ManagerAccess,
  requestId: string,
): Promise<RequestDetail | null> => {
  if (!UUID.test(requestId)) {
    return null;
  }

  const approverIds = approverPersonIds(access);

  return detailOf(
    access.companyId,
    withTenant(
      timeOffRequests,
      access.companyId,
      eq(timeOffRequests.id, requestId),
      inArray(timeOffRequests.managerId, approverIds),
      ne(timeOffRequests.personId, access.personId),
    ),
  );
};

/** HR: one request of the company, with what to weigh. */
export const getCompanyRequest = async (
  companyId: string,
  requestId: string,
): Promise<RequestDetail | null> => {
  if (!UUID.test(requestId)) {
    return null;
  }

  return detailOf(
    companyId,
    withTenant(timeOffRequests, companyId, eq(timeOffRequests.id, requestId)),
  );
};

export type CompanyRequestFilter = {
  status?: TimeOffStatus | null;
  /** Only the ones without a jefe, which HR decides. */
  hrOnly?: boolean;
};

/**
 * HR: every request of the company, newest first, optionally by status or
 * only the ones HR decides. Keyset pages, no OFFSET.
 */
export const listCompanyRequests = async (
  companyId: string,
  filter: CompanyRequestFilter = {},
  options: { cursor?: string | null; limit?: number } = {},
) =>
  pageOf(
    companyId,
    withTenant(
      timeOffRequests,
      companyId,
      filter.status ? eq(timeOffRequests.status, filter.status) : undefined,
      filter.hrOnly ? isNull(timeOffRequests.managerId) : undefined,
    ),
    options,
  );

// ── Approvals inbox source (W2-07) ───────────────────────────────────────

const inboxSortKey = sql<string>`to_char(${timeOffRequests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/**
 * The pending requests of the approvers this account decides for, after
 * the inbox's position, newest first: one range of
 * time_off_requests_inbox_idx per approver. The inbox's sort key is UTC
 * text, so it goes back to the keyset as a timestamptz with its zone.
 */
export const listPendingForInbox = async (input: {
  access: ManagerAccess;
  approverIds: string[];
  after: InboxAfter;
  limit: number;
}): Promise<InboxItem[]> => {
  const { access, approverIds, after, limit } = input;

  if (approverIds.length === 0) {
    return [];
  }

  const rows = await tdb(access.companyId)
    .select({
      id: timeOffRequests.id,
      personId: timeOffRequests.personId,
      kind: timeOffRequests.kind,
      startDate: timeOffRequests.startDate,
      endDate: timeOffRequests.endDate,
      days: timeOffRequests.days,
      managerId: timeOffRequests.managerId,
      sortKey: inboxSortKey,
      nombres: requester.nombres,
      apellidoPaterno: requester.apellidoPaterno,
      apellidoMaterno: requester.apellidoMaterno,
    })
    .from(timeOffRequests)
    .innerJoin(
      requester,
      and(
        eq(requester.companyId, timeOffRequests.companyId),
        eq(requester.id, timeOffRequests.personId),
      ),
    )
    .where(
      withTenant(
        timeOffRequests,
        access.companyId,
        inArray(timeOffRequests.managerId, approverIds),
        eq(timeOffRequests.status, "pending"),
        ne(timeOffRequests.personId, access.personId),
        after
          ? listKeyset.after(keysetCursor([`${after.sortKey}+00`, after.id]))
          : undefined,
      ),
    )
    .orderBy(...listKeyset.orderBy)
    .limit(limit);

  return rows.map((row) => ({
    source: "time_off_request",
    id: row.id,
    sortKey: row.sortKey,
    personId: row.personId,
    personName: formatPersonName(row),
    title: TIME_OFF_KIND_LABELS[row.kind],
    detail: `${rangeText(row)} · ${formatVacationDays(row.days)}`,
    approverPersonId: row.managerId as string,
    href: `/mi/equipo/aprobaciones/${row.id}`,
  }));
};
