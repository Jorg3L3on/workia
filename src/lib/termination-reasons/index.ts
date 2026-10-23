import { and, asc, count, eq, isNotNull, isNull } from "drizzle-orm";

import {
  buildChanges,
  recordAuditEvent,
  snapshotTerminationReason,
} from "@/lib/audit";
import { tdb, withTransaction, type DbExecutor } from "@/lib/db";
import { rethrowDuplicate } from "@/lib/db/errors";
import { employmentPeriods, terminationReasons } from "@/lib/db/schema";
import { withTenant } from "@/lib/tenant/scope";

import {
  TERMINATION_REASON_SEED,
  type TerminationReasonFormValues,
} from "./schema";

/**
 * Motivos de baja (Iniciativa 2): a company catalog with logical delete,
 * seeded with a base list. Reading needs people:read; editing it is company
 * configuration (settings:update), checked by the actions.
 */
export class TerminationReasonInUseError extends Error {
  constructor() {
    super(
      "El motivo está en uso en una baja: desactívalo en lugar de borrarlo.",
    );
    this.name = "TerminationReasonInUseError";
  }
}

/**
 * Gives the company the base list the first time it needs it (companies
 * created after migration 0025). A company that already has any reason,
 * even deleted ones, is left as it is.
 */
export const ensureTerminationReasons = async (
  companyId: string,
  executor: DbExecutor = tdb(companyId),
) => {
  const [existing] = await executor
    .select({ id: terminationReasons.id })
    .from(terminationReasons)
    .where(eq(terminationReasons.companyId, companyId))
    .limit(1);

  if (existing) {
    return;
  }

  await executor
    .insert(terminationReasons)
    .values(TERMINATION_REASON_SEED.map((reason) => ({ companyId, ...reason })))
    .onConflictDoNothing();
};

export const listTerminationReasons = async (
  companyId: string,
  options: { activeOnly?: boolean } = {},
) => {
  await ensureTerminationReasons(companyId);

  return tdb(companyId)
    .select()
    .from(terminationReasons)
    .where(
      withTenant(
        terminationReasons,
        companyId,
        isNull(terminationReasons.deletedAt),
        options.activeOnly ? eq(terminationReasons.active, true) : undefined,
      ),
    )
    .orderBy(asc(terminationReasons.name));
};

/**
 * Live reasons nobody classified yet (created before migration 0027): the
 * turnover report counts them as «otra» and warns about them.
 */
export const countUnclassifiedTerminationReasons = async (
  companyId: string,
) => {
  const [row] = await tdb(companyId)
    .select({ total: count() })
    .from(terminationReasons)
    .where(
      withTenant(
        terminationReasons,
        companyId,
        isNull(terminationReasons.deletedAt),
        isNull(terminationReasons.classification),
      ),
    );

  return row?.total ?? 0;
};

/** Reasons with how many bajas (employment periods) use each one. */
export const listTerminationReasonsWithUsage = async (companyId: string) => {
  const [rows, usage] = await Promise.all([
    listTerminationReasons(companyId),
    tdb(companyId)
      .select({ reasonId: employmentPeriods.motivoBajaId, uses: count() })
      .from(employmentPeriods)
      .where(
        withTenant(
          employmentPeriods,
          companyId,
          isNotNull(employmentPeriods.motivoBajaId),
        ),
      )
      .groupBy(employmentPeriods.motivoBajaId),
  ]);
  const byReason = new Map(usage.map((row) => [row.reasonId, row.uses]));

  return rows.map((reason) => ({
    ...reason,
    useCount: byReason.get(reason.id) ?? 0,
  }));
};

export const getTerminationReasonById = async (
  companyId: string,
  id: string,
  executor: DbExecutor = tdb(companyId),
) => {
  const [reason] = await executor
    .select()
    .from(terminationReasons)
    .where(
      withTenant(terminationReasons, companyId, eq(terminationReasons.id, id)),
    )
    .limit(1);
  return reason ?? null;
};

const DUPLICATE = "Ya existe un motivo de baja activo con ese nombre.";

export class TerminationReasonClassificationError extends Error {
  constructor() {
    super("Elige si el motivo es voluntario, involuntario u otro.");
    this.name = "TerminationReasonClassificationError";
  }
}

export const createTerminationReason = async (
  companyId: string,
  input: TerminationReasonFormValues,
  actorUserId?: string | null,
) => {
  if (!input.classification) {
    throw new TerminationReasonClassificationError();
  }

  await ensureTerminationReasons(companyId);

  const [created] = await tdb(companyId)
    .insert(terminationReasons)
    .values({
      companyId,
      name: input.name,
      classification: input.classification,
      active: input.active,
    })
    .returning()
    .catch(rethrowDuplicate(DUPLICATE));

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "termination_reason",
    resourceId: created.id,
    action: "create",
    payload: {
      after: snapshotTerminationReason(created),
      summary: `Motivo de baja creado: ${created.name}`,
    },
  });

  return created;
};

/**
 * Rename, reclassify or (de)activate; a past baja keeps pointing at it either
 * way, and the turnover report reads the classification it has now.
 * A classified reason cannot go back to «sin clasificar».
 */
export const updateTerminationReason = async (
  companyId: string,
  id: string,
  input: TerminationReasonFormValues,
  actorUserId?: string | null,
) => {
  const existing = await getTerminationReasonById(companyId, id);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const [updated] = await tdb(companyId)
    .update(terminationReasons)
    .set({
      name: input.name,
      active: input.active,
      classification: input.classification ?? existing.classification,
    })
    .where(
      withTenant(terminationReasons, companyId, eq(terminationReasons.id, id)),
    )
    .returning()
    .catch(rethrowDuplicate(DUPLICATE));

  if (!updated) {
    return null;
  }

  const before = snapshotTerminationReason(existing);
  const after = snapshotTerminationReason(updated);

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "termination_reason",
    resourceId: id,
    action: "update",
    payload: {
      before,
      after,
      changes: buildChanges(before, after, [
        "name",
        "classification",
        "active",
      ]),
      summary: `Motivo de baja editado: ${updated.name}`,
    },
  });

  return updated;
};

/**
 * Logical delete, only while no baja uses it (TerminationReasonInUseError):
 * one in use is deactivated instead, so history keeps its name.
 */
export const softDeleteTerminationReason = async (
  companyId: string,
  id: string,
  actorUserId?: string | null,
) =>
  withTransaction(async (tx) => {
    const existing = await getTerminationReasonById(companyId, id, tx);

    if (!existing || existing.deletedAt) {
      return null;
    }

    const [used] = await tx
      .select({ id: employmentPeriods.id })
      .from(employmentPeriods)
      .where(
        withTenant(
          employmentPeriods,
          companyId,
          eq(employmentPeriods.motivoBajaId, id),
        ),
      )
      .limit(1);

    if (used) {
      throw new TerminationReasonInUseError();
    }

    const [updated] = await tx
      .update(terminationReasons)
      .set({ deletedAt: new Date() })
      .where(
        withTenant(
          terminationReasons,
          companyId,
          and(
            eq(terminationReasons.id, id),
            isNull(terminationReasons.deletedAt),
          ),
        ),
      )
      .returning();

    if (!updated) {
      return null;
    }

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "termination_reason",
        resourceId: id,
        action: "delete",
        payload: {
          before: snapshotTerminationReason(existing),
          after: snapshotTerminationReason(updated),
          summary: `Motivo de baja borrado lógicamente: ${existing.name}`,
        },
      },
      tx,
    );

    return updated;
  }, companyId);
