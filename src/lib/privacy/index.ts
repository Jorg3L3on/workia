import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction, type DbExecutor } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { escapeLike } from "@/lib/db/like";
import {
  arcoRequests,
  assetMovements,
  auditEvents,
  contracts,
  documentRequirements,
  employmentPeriods,
  onboardings,
  people,
  personalDataAccessLog,
  personBeneficiaries,
  personDocuments,
  personSchedules,
  privacyNoticeAcceptances,
  privacyNotices,
  users,
  vacationRecords,
  type PersonalDataActor,
  type PersonalDataResource,
} from "@/lib/db/schema";
import { formatPersonName } from "@/lib/people/schema";
import { withTenant } from "@/lib/tenant/scope";

import {
  arcoDueOn,
  normalizeNoticeBody,
  PRIVACY_COPY,
  type CreateArcoRequestInput,
  type PublishNoticeInput,
  type RecordAcceptanceInput,
  type ResolveArcoRequestInput,
} from "./schema";

/**
 * Privacy notice, acceptances, the personal data access log and ARCO
 * requests (W2-09). Permission checks live in the actions and routes; every
 * query here filters by company_id.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const findPerson = async (
  companyId: string,
  personId: string,
  executor: DbExecutor,
) => {
  const [person] = await executor
    .select({
      id: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        eq(people.id, personId),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);

  return person ?? null;
};

// ---------------------------------------------------------------- notice

/** The version in force: the highest one. Null before the first publish. */
export const getCurrentPrivacyNotice = async (
  companyId: string,
  executor: DbExecutor = tdb(companyId),
) => {
  const [notice] = await executor
    .select()
    .from(privacyNotices)
    .where(withTenant(privacyNotices, companyId))
    .orderBy(desc(privacyNotices.version))
    .limit(1);

  return notice ?? null;
};

/** Every version, newest first, with how many people accepted each. */
export const listPrivacyNotices = async (companyId: string) => {
  const rows = await tdb(companyId)
    .select({
      id: privacyNotices.id,
      version: privacyNotices.version,
      body: privacyNotices.body,
      publishedAt: privacyNotices.publishedAt,
      publishedByName: users.name,
      acceptances: count(privacyNoticeAcceptances.id),
    })
    .from(privacyNotices)
    .leftJoin(users, eq(users.id, privacyNotices.publishedBy))
    .leftJoin(
      privacyNoticeAcceptances,
      and(
        eq(privacyNoticeAcceptances.companyId, privacyNotices.companyId),
        eq(privacyNoticeAcceptances.noticeId, privacyNotices.id),
      ),
    )
    .where(withTenant(privacyNotices, companyId))
    .groupBy(privacyNotices.id, users.name)
    .orderBy(desc(privacyNotices.version));

  return rows.map((row) => ({ ...row, acceptances: Number(row.acceptances) }));
};

/**
 * Publishes the next version. The text of the version in force is refused
 * (nothing changed). Two publishes at once: the second hits the unique
 * (company_id, version) and gets an error, never a duplicate version.
 */
export const publishPrivacyNotice = async (
  companyId: string,
  input: PublishNoticeInput,
  actorUserId?: string | null,
): Promise<Result<{ id: string; version: number }>> => {
  const body = normalizeNoticeBody(input.body);

  try {
    return await withTransaction(async (tx) => {
      const current = await getCurrentPrivacyNotice(companyId, tx);

      if (current && current.body === body) {
        return { ok: false, error: PRIVACY_COPY.noticeSame } as const;
      }

      const [created] = await tx
        .insert(privacyNotices)
        .values({
          companyId,
          version: (current?.version ?? 0) + 1,
          body,
          publishedBy: actorUserId ?? null,
        })
        .returning();

      await recordAuditEvent(
        {
          companyId,
          actorUserId,
          resourceType: "privacy_notice",
          resourceId: created.id,
          action: "create",
          payload: {
            after: { version: created.version, length: body.length },
            summary: `Aviso de privacidad publicado: versión ${created.version}`,
          },
        },
        tx,
      );

      return {
        ok: true,
        value: { id: created.id, version: created.version },
      } as const;
    }, companyId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: PRIVACY_COPY.noticeRace };
    }

    throw error;
  }
};

/**
 * The notice a person still has to accept: the version in force when they
 * have not accepted it, otherwise null. The employee app (W2-01) calls it at
 * every login and shows the notice before anything else.
 */
export const pendingPrivacyNotice = async (
  companyId: string,
  personId: string,
) => {
  const current = await getCurrentPrivacyNotice(companyId);

  if (!current) {
    return null;
  }

  const [accepted] = await tdb(companyId)
    .select({ id: privacyNoticeAcceptances.id })
    .from(privacyNoticeAcceptances)
    .where(
      withTenant(
        privacyNoticeAcceptances,
        companyId,
        eq(privacyNoticeAcceptances.noticeId, current.id),
        eq(privacyNoticeAcceptances.personId, personId),
      ),
    )
    .limit(1);

  return accepted ? null : current;
};

/**
 * Records that a person accepted the version in force, with its timestamp.
 * Only the current version can be accepted. Accepting it twice keeps the
 * first acceptance. Null when the person is not in the company.
 */
export const recordPrivacyAcceptance = async (
  companyId: string,
  input: RecordAcceptanceInput,
  actorUserId?: string | null,
): Promise<Result<{ id: string; acceptedAt: Date; version: number }> | null> =>
  withTransaction(async (tx) => {
    const person = await findPerson(companyId, input.personId, tx);

    if (!person) {
      return null;
    }

    const current = await getCurrentPrivacyNotice(companyId, tx);

    if (!current) {
      return { ok: false, error: PRIVACY_COPY.noNotice } as const;
    }

    if (current.id !== input.noticeId) {
      return { ok: false, error: PRIVACY_COPY.noticeNotCurrent } as const;
    }

    const [created] = await tx
      .insert(privacyNoticeAcceptances)
      .values({
        companyId,
        noticeId: current.id,
        personId: person.id,
        channel: input.channel,
        recordedBy: input.channel === "hr" ? (actorUserId ?? null) : null,
      })
      .onConflictDoNothing()
      .returning();

    if (!created) {
      const [existing] = await tx
        .select()
        .from(privacyNoticeAcceptances)
        .where(
          withTenant(
            privacyNoticeAcceptances,
            companyId,
            eq(privacyNoticeAcceptances.noticeId, current.id),
            eq(privacyNoticeAcceptances.personId, person.id),
          ),
        )
        .limit(1);

      return {
        ok: true,
        value: {
          id: existing.id,
          acceptedAt: existing.acceptedAt,
          version: current.version,
        },
      } as const;
    }

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "privacy_acceptance",
        resourceId: created.id,
        action: "create",
        payload: {
          after: {
            personId: person.id,
            version: current.version,
            channel: created.channel,
          },
          summary: `Aviso de privacidad v${current.version} aceptado: ${formatPersonName(person)}`,
        },
      },
      tx,
    );

    return {
      ok: true,
      value: {
        id: created.id,
        acceptedAt: created.acceptedAt,
        version: current.version,
      },
    } as const;
  }, companyId);

// ------------------------------------------------------------ access log

export type PersonalDataAccessInput = {
  personId: string;
  resource: PersonalDataResource;
  resourceId?: string | null;
  actorKind: PersonalDataActor;
  actorUserId?: string | null;
};

/**
 * Logs one read of a document or receipt about a person. Call it from every
 * route that serves a file about a person, in the same request, before the
 * response leaves. A person outside the company fails the foreign key.
 */
export const recordPersonalDataAccess = async (
  companyId: string,
  input: PersonalDataAccessInput,
  executor: DbExecutor = tdb(companyId),
) => {
  const [created] = await executor
    .insert(personalDataAccessLog)
    .values({
      companyId,
      personId: input.personId,
      resource: input.resource,
      resourceId: input.resourceId ?? null,
      actorKind: input.actorKind,
      actorUserId: input.actorUserId ?? null,
    })
    .returning();

  return created;
};

/** The latest reads, newest first (100 by default, at most 500). */
export const listPersonalDataAccess = async (
  companyId: string,
  options: { personId?: string; limit?: number } = {},
) => {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = await tdb(companyId)
    .select({
      id: personalDataAccessLog.id,
      personId: personalDataAccessLog.personId,
      resource: personalDataAccessLog.resource,
      resourceId: personalDataAccessLog.resourceId,
      actorKind: personalDataAccessLog.actorKind,
      actorName: users.name,
      accessedAt: personalDataAccessLog.accessedAt,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(personalDataAccessLog)
    .innerJoin(
      people,
      and(
        eq(people.companyId, personalDataAccessLog.companyId),
        eq(people.id, personalDataAccessLog.personId),
      ),
    )
    .leftJoin(users, eq(users.id, personalDataAccessLog.actorUserId))
    .where(
      withTenant(
        personalDataAccessLog,
        companyId,
        options.personId
          ? eq(personalDataAccessLog.personId, options.personId)
          : undefined,
      ),
    )
    .orderBy(desc(personalDataAccessLog.accessedAt))
    .limit(limit);

  return rows.map(({ nombres, apellidoPaterno, apellidoMaterno, ...row }) => ({
    ...row,
    personName: formatPersonName({ nombres, apellidoPaterno, apellidoMaterno }),
  }));
};

// ------------------------------------------------------------------ ARCO

/**
 * People an ARCO request can be filed for: anyone not deleted, on baja
 * included (a former employee keeps their ARCO rights). Name or CURP.
 */
export const searchPeopleForPrivacy = async (
  companyId: string,
  query: string,
) => {
  const trimmed = query.trim().slice(0, 80);
  const pattern = `%${escapeLike(trimmed)}%`;
  const rows = await tdb(companyId)
    .select({
      id: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        isNull(people.deletedAt),
        trimmed
          ? or(
              ilike(
                sql`concat_ws(' ', ${people.nombres}, ${people.apellidoPaterno}, ${people.apellidoMaterno})`,
                pattern,
              ),
              ilike(people.curp, pattern),
            )
          : undefined,
      ),
    )
    .orderBy(asc(people.apellidoPaterno), asc(people.nombres))
    .limit(10);

  return rows.map((row) => ({ id: row.id, label: formatPersonName(row) }));
};

/**
 * Registers a request received by email, on paper or from the employee app.
 * due_on is set from the date it was received. Null when the person is not
 * in the company.
 */
export const createArcoRequest = async (
  companyId: string,
  input: CreateArcoRequestInput,
  actorUserId?: string | null,
  today?: string,
): Promise<Result<{ id: string; dueOn: string }> | null> =>
  withTransaction(async (tx) => {
    const person = await findPerson(companyId, input.personId, tx);

    if (!person) {
      return null;
    }

    if (today && input.receivedOn > today) {
      return { ok: false, error: PRIVACY_COPY.arcoFutureDate } as const;
    }

    const [created] = await tx
      .insert(arcoRequests)
      .values({
        companyId,
        personId: person.id,
        kind: input.kind,
        channel: input.channel,
        detail: input.detail,
        receivedOn: input.receivedOn,
        dueOn: arcoDueOn(input.receivedOn),
        createdBy: actorUserId ?? null,
      })
      .returning();

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "arco_request",
        resourceId: created.id,
        action: "create",
        payload: {
          after: {
            personId: person.id,
            kind: created.kind,
            channel: created.channel,
            receivedOn: created.receivedOn,
            dueOn: created.dueOn,
          },
          summary: `Solicitud ARCO registrada: ${formatPersonName(person)}`,
        },
      },
      tx,
    );

    return {
      ok: true,
      value: { id: created.id, dueOn: created.dueOn },
    } as const;
  }, companyId);

const arcoColumns = {
  id: arcoRequests.id,
  personId: arcoRequests.personId,
  kind: arcoRequests.kind,
  status: arcoRequests.status,
  channel: arcoRequests.channel,
  detail: arcoRequests.detail,
  response: arcoRequests.response,
  receivedOn: arcoRequests.receivedOn,
  dueOn: arcoRequests.dueOn,
  resolvedAt: arcoRequests.resolvedAt,
  createdAt: arcoRequests.createdAt,
  nombres: people.nombres,
  apellidoPaterno: people.apellidoPaterno,
  apellidoMaterno: people.apellidoMaterno,
};

const withPersonName = <
  T extends {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  },
>({
  nombres,
  apellidoPaterno,
  apellidoMaterno,
  ...row
}: T) => ({
  ...row,
  personName: formatPersonName({ nombres, apellidoPaterno, apellidoMaterno }),
});

/** Open requests first, by due date; then closed ones, newest first. */
export const listArcoRequests = async (
  companyId: string,
  options: { personId?: string; limit?: number } = {},
) => {
  const rows = await tdb(companyId)
    .select(arcoColumns)
    .from(arcoRequests)
    .innerJoin(
      people,
      and(
        eq(people.companyId, arcoRequests.companyId),
        eq(people.id, arcoRequests.personId),
      ),
    )
    .where(
      withTenant(
        arcoRequests,
        companyId,
        options.personId
          ? eq(arcoRequests.personId, options.personId)
          : undefined,
      ),
    )
    .orderBy(
      sql`(${arcoRequests.status} = 'received') DESC`,
      sql`CASE WHEN ${arcoRequests.status} = 'received' THEN ${arcoRequests.dueOn} END ASC`,
      desc(arcoRequests.createdAt),
    )
    .limit(Math.min(Math.max(options.limit ?? 200, 1), 500));

  return rows.map(withPersonName);
};

export const getArcoRequest = async (companyId: string, requestId: string) => {
  const [row] = await tdb(companyId)
    .select(arcoColumns)
    .from(arcoRequests)
    .innerJoin(
      people,
      and(
        eq(people.companyId, arcoRequests.companyId),
        eq(people.id, arcoRequests.personId),
      ),
    )
    .where(withTenant(arcoRequests, companyId, eq(arcoRequests.id, requestId)))
    .limit(1);

  return row ? withPersonName(row) : null;
};

/**
 * Closes an open request as resolved or rejected, with the answer given.
 * A closed request stays closed. Null when the id is not in the company.
 */
export const resolveArcoRequest = async (
  companyId: string,
  input: ResolveArcoRequestInput,
  actorUserId?: string | null,
): Promise<Result<{ id: string }> | null> =>
  withTransaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(arcoRequests)
      .where(
        withTenant(
          arcoRequests,
          companyId,
          eq(arcoRequests.id, input.requestId),
        ),
      )
      .limit(1);

    if (!current) {
      return null;
    }

    const [updated] = await tx
      .update(arcoRequests)
      .set({
        status: input.outcome,
        response: input.response,
        resolvedBy: actorUserId ?? null,
        resolvedAt: new Date(),
      })
      .where(
        withTenant(
          arcoRequests,
          companyId,
          eq(arcoRequests.id, current.id),
          eq(arcoRequests.status, "received"),
        ),
      )
      .returning();

    if (!updated) {
      return { ok: false, error: PRIVACY_COPY.arcoAlreadyClosed } as const;
    }

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "arco_request",
        resourceId: updated.id,
        action: input.outcome === "resolved" ? "approve" : "reject",
        payload: {
          before: { status: current.status },
          after: { status: updated.status },
          changes: { status: { from: current.status, to: updated.status } },
          summary:
            input.outcome === "resolved"
              ? "Solicitud ARCO atendida"
              : "Solicitud ARCO improcedente",
        },
      },
      tx,
    );

    return { ok: true, value: { id: updated.id } } as const;
  }, companyId);

// ---------------------------------------------------------------- export

/** Cap per section, so one export stays small on Neon Free egress. */
const EXPORT_SECTION_LIMIT = 5_000;

/**
 * Everything workia holds about one person, for an ARCO access request: the
 * expediente, contracts, employment periods, schedules, beneficiaries,
 * documents, vacations, resguardo movements, altas, privacy acceptances,
 * ARCO requests, who read their documents and the change history of their
 * record. Null when the person is not in the company.
 */
export const buildPersonDataExport = async (
  companyId: string,
  personId: string,
  now: Date = new Date(),
) => {
  const scoped = tdb(companyId);
  const [person] = await scoped
    .select()
    .from(people)
    .where(withTenant(people, companyId, eq(people.id, personId)))
    .limit(1);

  if (!person) {
    return null;
  }

  const [
    contractRows,
    periodRows,
    onboardingRows,
    scheduleRows,
    beneficiaryRows,
    documentRows,
    vacationRows,
    movementRows,
    acceptanceRows,
    arcoRows,
    accessRows,
    historyRows,
  ] = await Promise.all([
    scoped
      .select()
      .from(contracts)
      .where(withTenant(contracts, companyId, eq(contracts.personId, personId)))
      .limit(EXPORT_SECTION_LIMIT),
    scoped
      .select()
      .from(employmentPeriods)
      .where(
        withTenant(
          employmentPeriods,
          companyId,
          eq(employmentPeriods.personId, personId),
        ),
      )
      .limit(EXPORT_SECTION_LIMIT),
    scoped
      .select()
      .from(onboardings)
      .where(
        withTenant(onboardings, companyId, eq(onboardings.personId, personId)),
      )
      .limit(EXPORT_SECTION_LIMIT),
    scoped
      .select()
      .from(personSchedules)
      .where(
        withTenant(
          personSchedules,
          companyId,
          eq(personSchedules.personId, personId),
        ),
      )
      .limit(EXPORT_SECTION_LIMIT),
    scoped
      .select()
      .from(personBeneficiaries)
      .where(
        withTenant(
          personBeneficiaries,
          companyId,
          eq(personBeneficiaries.personId, personId),
        ),
      )
      .limit(EXPORT_SECTION_LIMIT),
    scoped
      .select({
        id: personDocuments.id,
        requirement: documentRequirements.name,
        deliveredOn: personDocuments.deliveredOn,
        expiresOn: personDocuments.expiresOn,
        status: personDocuments.status,
        hasFile: sql<boolean>`${personDocuments.fileKey} is not null`,
        createdAt: personDocuments.createdAt,
      })
      .from(personDocuments)
      .innerJoin(
        documentRequirements,
        and(
          eq(documentRequirements.companyId, personDocuments.companyId),
          eq(documentRequirements.id, personDocuments.requirementId),
        ),
      )
      .where(
        withTenant(
          personDocuments,
          companyId,
          eq(personDocuments.personId, personId),
        ),
      )
      .limit(EXPORT_SECTION_LIMIT),
    scoped
      .select()
      .from(vacationRecords)
      .where(
        withTenant(
          vacationRecords,
          companyId,
          eq(vacationRecords.personId, personId),
        ),
      )
      .limit(EXPORT_SECTION_LIMIT),
    scoped
      .select()
      .from(assetMovements)
      .where(
        withTenant(
          assetMovements,
          companyId,
          eq(assetMovements.personId, personId),
        ),
      )
      .limit(EXPORT_SECTION_LIMIT),
    scoped
      .select({
        version: privacyNotices.version,
        channel: privacyNoticeAcceptances.channel,
        acceptedAt: privacyNoticeAcceptances.acceptedAt,
      })
      .from(privacyNoticeAcceptances)
      .innerJoin(
        privacyNotices,
        and(
          eq(privacyNotices.companyId, privacyNoticeAcceptances.companyId),
          eq(privacyNotices.id, privacyNoticeAcceptances.noticeId),
        ),
      )
      .where(
        withTenant(
          privacyNoticeAcceptances,
          companyId,
          eq(privacyNoticeAcceptances.personId, personId),
        ),
      )
      .limit(EXPORT_SECTION_LIMIT),
    scoped
      .select({
        id: arcoRequests.id,
        kind: arcoRequests.kind,
        status: arcoRequests.status,
        detail: arcoRequests.detail,
        response: arcoRequests.response,
        receivedOn: arcoRequests.receivedOn,
        dueOn: arcoRequests.dueOn,
        resolvedAt: arcoRequests.resolvedAt,
      })
      .from(arcoRequests)
      .where(
        withTenant(
          arcoRequests,
          companyId,
          eq(arcoRequests.personId, personId),
        ),
      )
      .limit(EXPORT_SECTION_LIMIT),
    scoped
      .select({
        resource: personalDataAccessLog.resource,
        resourceId: personalDataAccessLog.resourceId,
        actorKind: personalDataAccessLog.actorKind,
        actorName: users.name,
        accessedAt: personalDataAccessLog.accessedAt,
      })
      .from(personalDataAccessLog)
      .leftJoin(users, eq(users.id, personalDataAccessLog.actorUserId))
      .where(
        withTenant(
          personalDataAccessLog,
          companyId,
          eq(personalDataAccessLog.personId, personId),
        ),
      )
      .orderBy(desc(personalDataAccessLog.accessedAt))
      .limit(EXPORT_SECTION_LIMIT),
    scoped
      .select({
        action: auditEvents.action,
        source: auditEvents.source,
        payload: auditEvents.payload,
        occurredAt: auditEvents.occurredAt,
      })
      .from(auditEvents)
      .where(
        withTenant(
          auditEvents,
          companyId,
          eq(auditEvents.resourceType, "person"),
          eq(auditEvents.resourceId, personId),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(EXPORT_SECTION_LIMIT),
  ]);

  return {
    generatedAt: now.toISOString(),
    person,
    contracts: contractRows,
    employmentPeriods: periodRows,
    onboardings: onboardingRows,
    schedules: scheduleRows,
    beneficiaries: beneficiaryRows,
    documents: documentRows,
    vacations: vacationRows,
    resguardoMovements: movementRows,
    privacyAcceptances: acceptanceRows,
    arcoRequests: arcoRows,
    accessLog: accessRows,
    history: historyRows,
  };
};
